module String_set = Set.Make (String)
module String_map = Map.Make (String)

type session_ref = {
  thread_id : string;
  branch_id : string option;
  turn_id : string option;
}

type message_injection = {
  source : string;
  content : string;
}

type json =
  | Null
  | Bool of bool
  | Number of float
  | String of string
  | Array of json list
  | Object of (string * json) list

let trim_non_empty value =
  let value = String.trim value in
  if value = "" then None else Some value

let require_non_empty label value =
  match trim_non_empty value with
  | Some value -> Ok value
  | None -> Error (label ^ " must not be empty")

let rec to_yojson = function
  | Null -> `Null
  | Bool value -> `Bool value
  | Number value -> if Float.is_finite value then `Float value else `Null
  | String value -> `String value
  | Array values -> `List (List.map to_yojson values)
  | Object fields ->
      `Assoc (List.map (fun (name, value) -> (name, to_yojson value)) fields)

let rec of_yojson = function
  | `Null -> Ok Null
  | `Bool value -> Ok (Bool value)
  | `Int value -> Ok (Number (float_of_int value))
  | `Float value when Float.is_finite value -> Ok (Number value)
  | `Float _ -> Error "JSON number must be finite"
  | `String value -> Ok (String value)
  | `List values ->
      let rec loop acc = function
        | [] -> Ok (Array (List.rev acc))
        | value :: rest -> (
            match of_yojson value with
            | Ok value -> loop (value :: acc) rest
            | Error _ as error -> error)
      in
      loop [] values
  | `Assoc fields ->
      let rec loop acc = function
        | [] -> Ok (Object (List.rev acc))
        | (name, value) :: rest -> (
            match of_yojson value with
            | Ok value -> loop ((name, value) :: acc) rest
            | Error _ as error -> error)
      in
      loop [] fields
  | `Intlit value -> (
      match float_of_string_opt value with
      | Some value when Float.is_finite value -> Ok (Number value)
      | _ -> Error "JSON integer literal must be finite")
  | `Tuple _ | `Variant _ ->
      Error "unsupported non-standard JSON value"

let encode_json value = Yojson.Safe.to_string (to_yojson value)

let decode_json_string value =
  try Yojson.Safe.from_string value |> of_yojson
  with Yojson.Json_error message -> Error message

let json_string_field name = function
  | Object fields -> (
      match List.assoc_opt name fields with
      | Some (String value) -> Some value
      | _ -> None)
  | _ -> None

let json_int_field name = function
  | Object fields -> (
      match List.assoc_opt name fields with
      | Some (Number value) when Float.is_finite value -> Some (int_of_float value)
      | _ -> None)
  | _ -> None

let json_path parent name =
  if parent = "" then name else parent ^ "." ^ name

let json_kind = function
  | Null -> "null"
  | Bool _ -> "boolean"
  | Number _ -> "number"
  | String _ -> "string"
  | Array _ -> "array"
  | Object _ -> "object"

let json_object_fields path = function
  | Object fields -> Ok fields
  | value -> Error (path ^ " must be an object, got " ^ json_kind value)

let json_required_field path fields name =
  match List.assoc_opt name fields with
  | Some value -> Ok value
  | None -> Error (json_path path name ^ " is required")

let json_optional_field fields name =
  match List.assoc_opt name fields with
  | None | Some Null -> Ok None
  | Some value -> Ok (Some value)

let json_string path = function
  | String value -> Ok value
  | value -> Error (path ^ " must be a string, got " ^ json_kind value)

let json_number path = function
  | Number value when Float.is_finite value -> Ok value
  | Number _ -> Error (path ^ " must be a finite number")
  | value -> Error (path ^ " must be a number, got " ^ json_kind value)

let json_bool path = function
  | Bool value -> Ok value
  | value -> Error (path ^ " must be a boolean, got " ^ json_kind value)

let json_array path = function
  | Array values -> Ok values
  | value -> Error (path ^ " must be an array, got " ^ json_kind value)

let json_required_string path fields name =
  Result.bind (json_required_field path fields name)
    (json_string (json_path path name))

let json_optional_string path fields name =
  Result.bind (json_optional_field fields name) (function
    | None -> Ok None
    | Some value -> Result.map Option.some (json_string (json_path path name) value))

let json_string_default path fields name default =
  Result.map (Option.value ~default) (json_optional_string path fields name)

let json_required_number path fields name =
  Result.bind (json_required_field path fields name)
    (json_number (json_path path name))

let json_optional_number path fields name =
  Result.bind (json_optional_field fields name) (function
    | None -> Ok None
    | Some value -> Result.map Option.some (json_number (json_path path name) value))

let json_number_default path fields name default =
  Result.map (Option.value ~default) (json_optional_number path fields name)

let json_required_int path fields name =
  Result.map int_of_float (json_required_number path fields name)

let json_int_default path fields name default =
  Result.map int_of_float (json_number_default path fields name (float_of_int default))

let json_required_bool path fields name =
  Result.bind (json_required_field path fields name)
    (json_bool (json_path path name))

let json_bool_default path fields name default =
  Result.bind (json_optional_field fields name) (function
    | None -> Ok default
    | Some value -> json_bool (json_path path name) value)

let json_string_list path = function
  | Array values ->
      let rec loop acc index = function
        | [] -> Ok (List.rev acc)
        | value :: rest -> (
            match json_string (Printf.sprintf "%s[%d]" path index) value with
            | Ok value -> loop (value :: acc) (index + 1) rest
            | Error _ as error -> error)
      in
      loop [] 0 values
  | value -> Error (path ^ " must be an array, got " ^ json_kind value)

let json_optional_string_list path fields name =
  Result.bind (json_optional_field fields name) (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some (json_string_list (json_path path name) value))

let json_required_object_list path fields name =
  Result.bind (json_required_field path fields name) (fun value ->
      match json_array (json_path path name) value with
      | Error _ as error -> error
      | Ok values ->
          let rec loop acc index = function
            | [] -> Ok (List.rev acc)
            | value :: rest -> (
                match
                  json_object_fields
                    (Printf.sprintf "%s.%s[%d]" path name index)
                    value
                with
                | Ok fields -> loop (fields :: acc) (index + 1) rest
                | Error _ as error -> error)
          in
          loop [] 0 values)

type persistence_error =
  | Read_failed of string
  | Write_failed of string
  | Decode_failed of string

type 'a codec = {
  encode : 'a -> json;
  decode : json -> ('a, string) result;
}

type 'a persisted_state = {
  path : string;
  codec : 'a codec;
}

type atomic_writer = {
  write_atomic : path:string -> contents:string -> (unit, string) result;
}

let write_persisted writer state value =
  writer.write_atomic ~path:state.path ~contents:(encode_json (state.codec.encode value))
  |> Result.map_error (fun message -> Write_failed message)

type lock = { release : unit -> unit }

type lock_manager = {
  with_lock : 'a. string -> (unit -> ('a, string) result) -> ('a, string) result;
}

let without_lock =
  { with_lock = (fun _path action -> action ()) }

let model_provider model_id =
  match String.split_on_char '/' model_id with
  | provider :: _model :: _ when provider <> "" -> Some provider
  | _ -> None

let model_name model_id =
  match List.rev (String.split_on_char '/' model_id) with
  | name :: _ when name <> "" -> name
  | _ -> model_id

let session_ref ?branch_id ?turn_id thread_id = { thread_id; branch_id; turn_id }

let decoded_tool_helper ~name ~arguments =
  Object [ ("name", String name); ("arguments", arguments) ]

let inject_message ~source ~content = { source; content }
