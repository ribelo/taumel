module String_set = Set.Make (String)
module String_map = Map.Make (String)

type json =
  | Null
  | Bool of bool
  | Number of float
  | String of string
  | Array of json list
  | Object of (string * json) list

let min_persisted_int = -2_147_483_648.

let max_persisted_int = 2_147_483_647.

let persisted_int_float value =
  Float.is_finite value && value >= min_persisted_int
  && value <= max_persisted_int
  && Float.equal value (Float.trunc value)

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
  | `Int value ->
      let number = float_of_int value in
      if Int64.of_float number = Int64.of_int value then Ok (Number number)
      else Error "JSON integer literal loses precision"
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
      match (Int64.of_string_opt value, float_of_string_opt value) with
      | Some exact, Some number
        when Float.is_finite number && Int64.of_float number = exact ->
          Ok (Number number)
      | _ -> Error "JSON integer literal loses precision")
  | `Tuple _ | `Variant _ -> Error "unsupported non-standard JSON value"

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
      | Some (Number value) when persisted_int_float value ->
          let converted = int_of_float value in
          if Float.equal value (float_of_int converted) then Some converted
          else None
      | _ -> None)
  | _ -> None

let json_path parent name = if parent = "" then name else parent ^ "." ^ name

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

let json_exact_fields path expected fields =
  let expected =
    List.fold_left
      (fun names name -> String_set.add name names)
      String_set.empty expected
  in
  let rec validate seen = function
    | [] -> (
        match String_set.choose_opt (String_set.diff expected seen) with
        | None -> Ok ()
        | Some name -> Error (json_path path name ^ " is required"))
    | (name, _) :: rest ->
        if not (String_set.mem name expected) then
          Error (json_path path name ^ " is not allowed")
        else if String_set.mem name seen then
          Error (json_path path name ^ " must not be repeated")
        else validate (String_set.add name seen) rest
  in
  validate String_set.empty fields

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
  Result.bind
    (json_required_field path fields name)
    (json_string (json_path path name))

let json_int path value =
  Result.bind (json_number path value) (fun number ->
      if persisted_int_float number then
        let converted = int_of_float number in
        if Float.equal number (float_of_int converted) then Ok converted
        else Error (path ^ " must be a representable integer")
      else Error (path ^ " must be a representable integer"))

let json_required_int path fields name =
  Result.bind
    (json_required_field path fields name)
    (json_int (json_path path name))

let json_optional_int path fields name =
  Result.bind (json_optional_field fields name) (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some (json_int (json_path path name) value))

let json_int_default path fields name default =
  Result.map (Option.value ~default) (json_optional_int path fields name)

let json_required_bool path fields name =
  Result.bind
    (json_required_field path fields name)
    (json_bool (json_path path name))

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

type 'a codec = { encode : 'a -> json; decode : json -> ('a, string) result }

let split_command input =
  let input = String.trim input in
  if input = "" then ("", "")
  else
    match String.index_opt input ' ' with
    | None -> (input, "")
    | Some index ->
        ( String.sub input 0 index,
          String.sub input (index + 1) (String.length input - index - 1)
          |> String.trim )

let split_words input =
  input |> String.split_on_char ' ' |> List.map String.trim
  |> List.filter (fun word -> word <> "")

let option_int_to_json = function
  | None -> Null
  | Some value -> Number (float_of_int value)

let option_string_to_json = function None -> Null | Some value -> String value

(* Short random handles shared by agent identities (^agent-ym73) and plan
   tasks (^plan-tk03). Alphabet omits ambiguous characters (i/l/o/0/1). *)
let nano_id_alphabet = "abcdefghjkmnpqrstuvwxyz23456789"

let nano_id_length = 4

let nano_id_radix = String.length nano_id_alphabet

let nano_id_namespace_size =
  nano_id_radix * nano_id_radix * nano_id_radix * nano_id_radix

let nano_id index =
  let value = ref index in
  let result = Bytes.make nano_id_length nano_id_alphabet.[0] in
  for position = nano_id_length - 1 downto 0 do
    Bytes.set result position nano_id_alphabet.[!value mod nano_id_radix];
    value := !value / nano_id_radix
  done;
  Bytes.to_string result

let valid_nano_id value =
  String.length value = nano_id_length
  && String.for_all
       (fun character -> String.contains nano_id_alphabet character)
       value
