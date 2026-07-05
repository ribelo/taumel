open Jsoo_bridge
open App_state
open Runtime_access

let optional_int_field obj name =
  Option.map int_of_float (float_field obj name)

let optional_bool_field obj name =
  match optional_field obj name with
  | Some value when is_js_boolean value -> Some (Js_of_ocaml.Js.to_bool (Unsafe.coerce value))
  | _ -> None

let bool_field_default obj name default =
  Option.value (optional_bool_field obj name) ~default

let prepare_query params =
  with_gateway_authorized "query_threads" (fun _ ->
      match
        Taumel.Thread_tools.prepare_query_request
          ?limit:(optional_int_field params "limit")
          ?scope:(optional_string_field params "scope")
          ~include_tools:(bool_field_default params "includeTools" true)
          (get_string params "query")
      with
      | Error message -> error_obj message
      | Ok request ->
          ok_obj
            [
              ("action", js_string "query_threads");
              ("query", js_string request.query);
              ("limit", js_number (float_of_int request.limit));
              ("scope", js_string request.scope);
              ("includeTools", js_bool request.include_tools);
            ])

let locator_object params =
  match optional_field params "locator" with
  | Some locator when is_js_object locator -> Some locator
  | _ -> None

let read_input_from_params params : Taumel.Thread_tools.read_request_input =
  let locator = locator_object params in
  {
    thread_id = optional_string_field params "threadID";
    locator_thread_id = Option.bind locator (fun locator -> optional_string_field locator "threadID");
    locator_source_path =
      Option.bind locator (fun locator -> optional_string_field locator "sourcePath");
    locator_entry_id =
      Option.bind locator (fun locator -> optional_string_field locator "entryID");
    locator_line = Option.bind locator (fun locator -> optional_int_field locator "line");
    entry_id = optional_string_field params "entryID";
    line = optional_int_field params "line";
    mode = optional_string_field params "mode";
    around = optional_int_field params "around";
    cursor = optional_string_field params "cursor";
  }

let prepare_read params =
  with_gateway_authorized "read_thread" (fun _ ->
      match Taumel.Thread_tools.prepare_read_request (read_input_from_params params) with
      | Error message -> error_obj message
      | Ok request ->
          let locator_fields =
            match request.locator with
            | None -> []
            | Some locator ->
                [
                  ( "locator",
                    inject
                      (Unsafe.obj
                         [|
                           ("threadID", js_string locator.locator_thread_id);
                           ( "sourcePath",
                             match locator.locator_source_path with
                             | None -> inject Js_of_ocaml.Js.null
                             | Some path -> js_string path );
                           ( "entryID",
                             match locator.locator_entry_id with
                             | None -> inject Js_of_ocaml.Js.null
                             | Some id -> js_string id );
                           ( "line",
                             match locator.locator_line with
                             | None -> inject Js_of_ocaml.Js.null
                             | Some line -> js_number (float_of_int line) );
                         |]) );
                ]
          in
          ok_obj
            ([
               ("action", js_string "read_thread");
               ("threadID", js_string request.thread_id);
               ("mode", js_string (Taumel.Thread_tools.read_mode_to_string request.mode));
               ("around", js_number (float_of_int request.around));
               ( "entryID",
                 match request.entry_id with
                 | None -> inject Js_of_ocaml.Js.null
                 | Some id -> js_string id );
               ( "line",
                 match request.line with
                 | None -> inject Js_of_ocaml.Js.null
                 | Some line -> js_number (float_of_int line) );
               ( "cursor",
                 match request.cursor with
                 | None -> inject Js_of_ocaml.Js.null
                 | Some cursor -> js_string cursor );
             ]
            @ locator_fields))

let js_catalog_scan (scan : Taumel.Thread_tools.catalog_scan) =
  Unsafe.obj
    [|
      ("root", js_string scan.root);
      ("maxDepth", js_number (float_of_int scan.max_depth));
      ("maxFiles", js_number (float_of_int scan.max_files));
      ("suffix", js_string scan.suffix);
    |]

let plan_catalog_scans facts =
  let override =
    Option.bind (optional_string_field facts "override") Taumel.Shared.trim_non_empty
  in
  Taumel.Thread_tools.catalog_scans ?override
    ~cwd:(get_string facts "cwd")
    ~home:(get_string facts "home") ()
  |> List.map js_catalog_scan |> js_array

let json_field_or_empty_array obj name =
  if not (has_property obj name) then Taumel.Shared.Array []
  else match json_from_js (Unsafe.get obj name) with Ok json -> json | Error _ -> Array []

let current_source facts =
  Taumel.Thread_tools.current_source_json
    ~cwd:(get_string facts "cwd")
    ~session_id:(get_string facts "sessionId")
    ~branch:(json_field_or_empty_array facts "branch")
    ~entries:(json_field_or_empty_array facts "entries")
  |> json_to_js

let catalog_from_js catalog =
  array_items catalog
  |> List.map (fun item ->
         match json_from_js item with
         | Ok json -> json
         | Error message ->
             Taumel.Shared.Object
               [
                 ("kind", Taumel.Shared.String "diagnostic");
                 ("message", Taumel.Shared.String ("invalid thread source payload: " ^ message));
               ])
  |> Taumel.Thread_tools.catalog_of_sources

let js_option_string = function
  | None -> inject Js_of_ocaml.Js.null
  | Some value -> js_string value

let js_option_int = function
  | None -> inject Js_of_ocaml.Js.null
  | Some value -> js_number (float_of_int value)

let js_locator (locator : Taumel.Thread_tools.locator) =
  Unsafe.obj
    [|
      ("threadID", js_string locator.locator_thread_id);
      ("sourcePath", js_option_string locator.locator_source_path);
      ("entryID", js_option_string locator.locator_entry_id);
      ("line", js_option_int locator.locator_line);
    |]

let js_hit (hit : Taumel.Thread_tools.hit) =
  Unsafe.obj
    [|
      ("locator", inject (js_locator hit.hit_locator));
      ("kind", js_string hit.hit_kind);
      ("field", js_string hit.hit_field);
      ("role", js_option_string hit.hit_role);
      ("toolName", js_option_string hit.hit_tool_name);
      ("timestamp", js_option_string hit.hit_timestamp);
      ("snippet", js_string hit.hit_snippet);
    |]

let js_summary (summary : Taumel.Thread_tools.thread_summary) =
  Unsafe.obj
    [|
      ("id", js_string summary.id);
      ("title", js_string summary.title);
      ("workspace", js_option_string summary.workspace);
      ("messageCount", js_number (float_of_int summary.message_count));
      ("sourcePath", js_option_string summary.source_path);
      ("goalSummary", js_option_string summary.goal_summary);
      ("branchSummary", js_option_string summary.branch_summary);
      ("compactionSummary", js_option_string summary.compaction_summary);
      ("hits", js_array (List.map js_hit summary.hits));
    |]

let js_entry (entry : Taumel.Thread_tools.visible_entry) =
  Unsafe.obj
    [|
      ("entryID", js_option_string entry.entry_id);
      ("line", js_option_int entry.line);
      ("timestamp", js_option_string entry.timestamp);
      ("role", js_option_string entry.role);
      ("kind", js_string entry.kind);
      ("toolName", js_option_string entry.tool_name);
      ("text", js_string entry.text);
    |]

let js_diagnostic (diagnostic : Taumel.Thread_tools.diagnostic) =
  Unsafe.obj
    [|
      ("sourcePath", js_option_string diagnostic.source_path);
      ("line", js_option_int diagnostic.line);
      ("message", js_string diagnostic.message);
    |]

let js_truncation fields =
  Unsafe.obj
    (fields
    |> List.map (fun (name, value) -> (name, js_string value))
    |> Array.of_list)

let run_query params catalog =
  match
    Taumel.Thread_tools.prepare_query_request
      ?limit:(optional_int_field params "limit")
      ?scope:(optional_string_field params "scope")
      ~include_tools:(bool_field_default params "includeTools" true)
      (get_string params "query")
  with
  | Error message -> error_obj message
  | Ok request ->
      let plan =
        Taumel.Thread_tools.plan_query ~workspace:state.cwd request
          (catalog_from_js catalog)
      in
      ok_obj
        [
          ("action", js_string "tool_result");
          ("text", js_string plan.text);
          ( "details",
            inject
              (Unsafe.obj
                 [|
                   ("ok", js_bool plan.ok);
                   ("query", js_string plan.query);
                   ("scope", js_string plan.scope);
                   ("threads", js_array (List.map js_summary plan.threads));
                   ("diagnostics", js_array (List.map js_diagnostic plan.diagnostics));
                 |]) );
        ]

let run_read params catalog =
  match Taumel.Thread_tools.prepare_read_request (read_input_from_params params) with
  | Error message -> error_obj message
  | Ok request ->
      let plan =
        Taumel.Thread_tools.plan_read ~id:request.thread_id request
          (catalog_from_js catalog)
      in
      ok_obj
        [
          ("action", js_string "tool_result");
          ("text", js_string plan.text);
          ( "details",
            inject
              (Unsafe.obj
                 [|
                   ("ok", js_bool plan.ok);
                   ( "thread",
                     match plan.thread with
                     | None -> inject Js_of_ocaml.Js.null
                     | Some summary -> inject (js_summary summary) );
                   ("entries", js_array (List.map js_entry plan.entries));
                   ("diagnostics", js_array (List.map js_diagnostic plan.diagnostics));
                   ("ambiguous", js_bool plan.ambiguous);
                   ("matches", js_array (List.map js_string plan.matches));
                   ("mode", js_string plan.mode);
                   ("cursor", js_option_string plan.cursor);
                   ("truncation", inject (js_truncation plan.truncation));
                 |]) );
        ]

let run name params catalog ctx =
  Session_sync.sync_session_from_host ~scope:"thread tool run" ctx;
  let result =
    match name with
    | "query_threads" -> run_query params catalog
    | "read_thread" -> run_read params catalog
    | other -> error_obj ("not a thread tool: " ^ other)
  in
  if get_bool result "ok" then
    prepared_tool_result_with_extra result (Unsafe.obj [||])
  else text_tool_result (get_string result "error") result
