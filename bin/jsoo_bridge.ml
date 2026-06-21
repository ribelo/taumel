module Js = Js_of_ocaml.Js
module Unsafe = Js_of_ocaml.Js.Unsafe
module Effect = Eta.Effect
module Duration = Eta.Duration
module Schedule = Eta.Schedule
module Runtime = Eta_jsoo.Runtime

let inject = Unsafe.inject
let js_string value = inject (Js.string value)
let js_number value = inject (Js.number_of_float value)
let js_bool value = inject (Js.bool value)

let call0 obj name = Unsafe.fun_call (Unsafe.get obj name) [||]
let call1 obj name a = Unsafe.fun_call (Unsafe.get obj name) [| a |]
let call2 obj name a b = Unsafe.fun_call (Unsafe.get obj name) [| a; b |]
let call3 obj name a b c = Unsafe.fun_call (Unsafe.get obj name) [| a; b; c |]

let predicate_bool predicate value =
  Js.to_bool (Unsafe.coerce (Unsafe.fun_call predicate [| value |]))

let is_nullish =
  let predicate = Unsafe.js_expr "((value) => value === null || value === undefined)" in
  fun value -> predicate_bool predicate value

let is_js_array =
  let predicate = Unsafe.js_expr "((value) => Array.isArray(value))" in
  fun value -> predicate_bool predicate value

let is_js_function =
  let predicate = Unsafe.js_expr "((value) => typeof value === 'function')" in
  fun value -> predicate_bool predicate value

let is_js_string =
  let predicate = Unsafe.js_expr "((value) => typeof value === 'string')" in
  fun value -> predicate_bool predicate value

let is_js_number =
  let predicate = Unsafe.js_expr "((value) => typeof value === 'number')" in
  fun value -> predicate_bool predicate value

let is_js_boolean =
  let predicate = Unsafe.js_expr "((value) => typeof value === 'boolean')" in
  fun value -> predicate_bool predicate value

let is_js_object =
  let predicate =
    Unsafe.js_expr
      "((value) => value !== null && typeof value === 'object' && !Array.isArray(value))"
  in
  fun value -> predicate_bool predicate value

let is_property_container value =
  is_js_object value || is_js_array value || is_js_function value

let string_value value =
  if is_js_string value then Some (Js.to_string (Unsafe.coerce value)) else None

let array_value value =
  if is_js_array value then Some (Js.to_array (Unsafe.coerce value)) else None

let array_items value =
  match array_value value with Some items -> Array.to_list items | None -> []

let function_value value = if is_js_function value then Some value else None

let has_property obj name =
  if not (is_property_container (inject obj)) then false
  else
    Js.to_bool
      (Unsafe.coerce
         (call2 (Unsafe.get Unsafe.global "Object") "hasOwn" (inject obj)
            (js_string name)))

let object_field obj name =
  if has_property obj name then Some (Unsafe.get obj name) else None

let first_object_field obj names = List.find_map (object_field obj) names

let property_value obj name =
  if is_property_container (inject obj) then Some (Unsafe.get obj name) else None

let optional_field obj name =
  match object_field obj name with
  | Some value when not (is_nullish value) -> Some value
  | _ -> None

let function_field obj name = Option.bind (property_value obj name) function_value

let get_string obj name =
  match Option.bind (object_field obj name) string_value with
  | Some value -> value
  | None -> ""

let get_bool obj name =
  match object_field obj name with
  | Some value when is_js_boolean value -> Js.to_bool (Unsafe.coerce value)
  | _ -> false

let float_value value =
  if is_js_number value then
      let value = Js.to_float (Unsafe.coerce value) in
      if Float.is_finite value then Some value else None
  else None

let float_field obj name = Option.bind (object_field obj name) float_value

let int_field obj name = Option.map int_of_float (float_field obj name)

let float_field_default obj name default =
  Option.value (float_field obj name) ~default

let int_field_default obj name default =
  Option.value (int_field obj name) ~default

let optional_string_field obj name =
  match optional_field obj name with
  | None -> None
  | Some value -> (
      match string_value value with
      | Some value -> Some value
      | None ->
          failwith
            (Printf.sprintf "Invalid Taumel string field: %s" name))

let get_string_array obj name =
  match object_field obj name with
  | Some value -> array_items value |> List.filter_map string_value
  | _ -> []

let get_object_array obj name =
  match object_field obj name with
  | Some value -> array_items value
  | _ -> []

let js_array_of_strings values =
  values |> List.map Js.string |> Array.of_list |> Js.array |> inject

let js_options ~cwd ~timeout =
  Unsafe.obj
    [|
      ("cwd", js_string cwd);
      ("timeout", js_number (float_of_int timeout));
    |]

let js_error_to_string error =
  match string_value error with
  | Some value -> value
  | None -> (
      match object_field error "message" with
      | Some message -> Option.value (string_value message) ~default:"JavaScript promise rejected"
      | None -> "JavaScript promise rejected")

let await_js_result promise =
  let eta_promise, resolver = Eta_jsoo.Private.create_promise () in
  let resolve_ok =
    Js.wrap_callback (fun value -> Eta_jsoo.Private.resolve resolver (Ok value))
  in
  let resolve_error =
    Js.wrap_callback (fun error ->
        Eta_jsoo.Private.resolve resolver (Error (js_error_to_string error)))
  in
  ignore
    (Unsafe.meth_call promise "then"
       [| inject resolve_ok; inject resolve_error |]);
  Eta_jsoo.Private.await eta_promise

let js_lines lines =
  lines |> List.map Js.string |> Array.of_list |> Js.array

let effect_kind_to_string = function
  | Taumel.Tool_gateway.Pure -> "pure"
  | Taumel.Tool_gateway.Execute -> "execute"
  | Taumel.Tool_gateway.Mutate -> "mutate"
  | Taumel.Tool_gateway.Network -> "network"
  | Taumel.Tool_gateway.Spawn_agent -> "spawn_agent"
  | Taumel.Tool_gateway.Ask_user -> "ask_user"

let js_array values = values |> Array.of_list |> Js.array |> inject

let ok_obj fields =
  Unsafe.obj (Array.of_list (("ok", js_bool true) :: fields))

let error_obj message =
  Unsafe.obj [| ("ok", js_bool false); ("error", js_string message) |]

let text_result text =
  Unsafe.obj
    [|
      ( "content",
        js_array
          [ Unsafe.obj [| ("type", js_string "text"); ("text", js_string text) |] ]
      );
      ("details", Unsafe.obj [| ("ok", js_bool true) |]);
    |]

let object_keys obj =
  if not (is_property_container (inject obj)) then []
  else
    let object_ctor = Unsafe.get Unsafe.global "Object" in
    let keys = Unsafe.fun_call (Unsafe.get object_ctor "keys") [| inject obj |] in
    Js.to_array (Unsafe.coerce keys)
    |> Array.to_list |> List.filter_map string_value

let json_to_js value =
  let json_ctor = Unsafe.get Unsafe.global "JSON" in
  Unsafe.fun_call (Unsafe.get json_ctor "parse")
    [| js_string (Taumel.Shared.encode_json value) |]

let text_result_with_details text details =
  Unsafe.obj
    [|
      ( "content",
        js_array
          [ Unsafe.obj [| ("type", js_string "text"); ("text", js_string text) |] ]
      );
      ("details", json_to_js details);
    |]

let async_error_obj cause =
  error_obj
    ("Taumel async operation failed: "
    ^ Format.asprintf "%a"
        (Eta.Cause.pp (fun fmt () ->
             Format.pp_print_string fmt "async failure"))
        cause)

let js_promise_of_effect (eff : (Unsafe.any, unit) Effect.t) =
  let promise_ctor = Unsafe.get Unsafe.global "Promise" in
  let executor =
    Js.wrap_callback (fun resolve _reject ->
        let rt = Runtime.create () in
        Runtime.run rt eff ~on_result:(function
          | Eta.Exit.Ok value -> ignore (Unsafe.fun_call resolve [| inject value |])
          | Eta.Exit.Error cause ->
              ignore
                (Unsafe.fun_call resolve [| inject (async_error_obj cause) |])))
  in
  Unsafe.new_obj promise_ctor [| inject executor |]

let optional_string_array obj name =
  Option.map
    (fun value -> array_items value |> List.filter_map string_value)
    (optional_field obj name)

let json_from_js value =
  try
    let json_ctor = Unsafe.get Unsafe.global "JSON" in
    let encoded =
      Unsafe.fun_call (Unsafe.get json_ctor "stringify") [| value |]
    in
    match string_value encoded with
    | None -> Error "unsupported JavaScript JSON value"
    | Some encoded -> Taumel.Shared.decode_json_string encoded
  with exn ->
    Error ("unsupported JavaScript JSON value: " ^ Printexc.to_string exn)

let js_text_content value =
  match json_from_js value with
  | Ok (Taumel.Shared.String text) -> text
  | Ok (Object fields) -> (
      match List.assoc_opt "text" fields with
      | Some (String text) -> text
      | _ -> "")
  | _ -> ""

let js_content_to_text value =
  let rec json_text = function
    | Taumel.Shared.String text -> text
    | Object fields -> (
        match List.assoc_opt "text" fields with
        | Some (String text) -> text
        | _ -> "")
    | Array values ->
        values |> List.map json_text
        |> List.filter (fun part -> part <> "")
        |> String.concat "\n"
    | _ -> ""
  in
  match json_from_js value with Ok json -> json_text json | Error _ -> ""

let command_result_obj ~ok ~message ~details =
  Unsafe.obj
    [|
      ("ok", js_bool ok);
      ("action", js_string "command_result");
      ("message", js_string message);
      ("details", inject details);
    |]

let tool_result_to_command_result result =
  if not (is_js_object result) then
    command_result_obj ~ok:false ~message:"Invalid tool result" ~details:result
  else
    let details =
      if has_property result "details" then Unsafe.get result "details"
      else Unsafe.obj [||]
    in
    let ok =
      not
        (is_js_object details
        && has_property details "ok"
        && get_bool details "ok" = false)
    in
    command_result_obj ~ok
      ~message:(js_content_to_text (Unsafe.get result "content"))
      ~details

let js_object_or_empty value =
  if is_js_object value then value else Unsafe.obj [||]

let merge_js_details base extra =
  let object_ctor = Unsafe.get Unsafe.global "Object" in
  Unsafe.fun_call (Unsafe.get object_ctor "assign")
    [|
      inject (Unsafe.obj [||]);
      inject (js_object_or_empty base);
      inject (js_object_or_empty extra);
    |]

let command_result_with_details result extra =
  if not (is_js_object result) then result
  else
    let object_ctor = Unsafe.get Unsafe.global "Object" in
    let next =
      Unsafe.fun_call (Unsafe.get object_ctor "assign")
        [| inject (Unsafe.obj [||]); inject result |]
    in
    let details =
      if has_property result "details" then Unsafe.get result "details"
      else Unsafe.obj [||]
    in
    Unsafe.set next "details" (merge_js_details details extra);
    next

let text_tool_result text details =
  Unsafe.obj
    [|
      ( "content",
        js_array
          [
            Unsafe.obj
              [|
                ("type", js_string "text");
                ("text", js_string text);
              |];
          ] );
      ("details", inject details);
    |]

let prepared_tool_result_with_extra prepared extra =
  text_tool_result (get_string prepared "text")
    (merge_js_details (Unsafe.get prepared "details") extra)

let tool_result_envelope params =
  if has_property params "prepared" then
    let prepared = Unsafe.get params "prepared" in
    let extra =
      if has_property params "extraDetails" then Unsafe.get params "extraDetails"
      else Unsafe.obj [||]
    in
    prepared_tool_result_with_extra prepared extra
  else if has_property params "error" then
    let error = get_string params "error" in
    let details =
      if has_property params "details" then Unsafe.get params "details"
      else
        Unsafe.obj
          [|
            ("ok", js_bool false);
            ("error", js_string error);
          |]
    in
    text_tool_result error details
  else
    let text = get_string params "text" in
    let details =
      if has_property params "details" then Unsafe.get params "details"
      else Unsafe.inject Js.null
    in
    text_tool_result text details

let host_tool_result params =
  let action = get_string params "action" in
  let details =
    if has_property params "details" then Unsafe.get params "details"
    else Unsafe.inject Js.null
  in
  match action with
  | "write_stdin" ->
      text_tool_result Taumel.Sandbox.write_stdin_success_message
        (Unsafe.obj
           [|
             ("ok", js_bool true);
             ("result", inject details);
           |])
  | "apply_patch" ->
      text_tool_result Taumel.Sandbox.apply_patch_success_message details
  | "write" ->
      text_tool_result
        (Printf.sprintf "Successfully wrote %d bytes to %s"
           (int_field_default details "byteLength" 0)
           (get_string details "displayPath"))
        details
  | "edit" ->
      text_tool_result
        (Printf.sprintf "Successfully replaced %d block(s) in %s."
           (int_field_default details "editCount" 0)
           (get_string details "displayPath"))
        details
  | _ -> text_tool_result ("unknown host tool result: " ^ action) details
