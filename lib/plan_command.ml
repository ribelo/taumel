(* Pure /plan argument parsing. Task mutations stay in Plan to avoid a cycle. *)

let parse_task_payload payload =
  match Shared.decode_json_string payload with
  | Error message -> Error ("invalid task payload: " ^ message)
  | Ok json -> (
      match Shared.json_object_fields "task payload" json with
      | Error message -> Error message
      | Ok fields ->
          let title =
            match List.assoc_opt "title" fields with
            | Some (Shared.String value) -> Shared.trim_non_empty value
            | Some Shared.Null | None -> None
            | Some _ -> None
          in
          let description =
            match List.assoc_opt "description" fields with
            | None -> None
            | Some Shared.Null -> Some None
            | Some (Shared.String value) -> Some (Some value)
            | Some _ -> None
          in
          Ok (title, description))

let parse_duration value =
  let value = String.trim value in
  if value = "" then Error "time limit must not be empty"
  else
    let last = value.[String.length value - 1] in
    let multiplier =
      match last with
      | 's' -> Some 1
      | 'm' -> Some 60
      | 'h' -> Some 3600
      | _ -> None
    in
    match multiplier with
    | None -> Error "time limit must use s, m, or h"
    | Some multiplier -> (
        let number = String.sub value 0 (String.length value - 1) in
        try
          let parsed = int_of_string number in
          if parsed <= 0 then Error "time limit must be positive"
          else if parsed > 2_147_483_647 / multiplier then
            Error "time limit is too large"
          else Ok (parsed * multiplier)
        with Failure _ ->
          Error "time limit must be a duration like 90s, 30m, or 2h")

let parse_time_limit_args args =
  let words =
    args |> String.split_on_char ' ' |> List.map String.trim
    |> List.filter (fun word -> word <> "")
  in
  let rec loop text_parts setting = function
    | [] -> Ok (String.concat " " (List.rev text_parts), setting)
    | "--time-limit" :: _ when Option.is_some setting ->
        Error "time limit may be specified only once"
    | "--time-limit" :: value :: rest ->
        Result.bind (parse_duration value) (fun seconds ->
            loop text_parts (Some (Some seconds)) rest)
    | [ "--time-limit" ] ->
        Error "time limit must be a duration like 90s, 30m, or 2h"
    | "--no-time-limit" :: _ when Option.is_some setting ->
        Error "time limit may be specified only once"
    | "--no-time-limit" :: rest -> loop text_parts (Some None) rest
    | flag :: _
      when String.starts_with ~prefix:"--time-limit=" flag
           && Option.is_some setting ->
        Error "time limit may be specified only once"
    | flag :: rest when String.starts_with ~prefix:"--time-limit=" flag ->
        let value = String.sub flag 13 (String.length flag - 13) in
        Result.bind (parse_duration value) (fun seconds ->
            loop text_parts (Some (Some seconds)) rest)
    | word :: rest -> loop (word :: text_parts) setting rest
  in
  loop [] None words
