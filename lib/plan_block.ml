type source = Agent | System

type cleared_by = Agent | User

type open_entry = { blocked_at : int; reason : string; source : source }

type closed_entry = {
  blocked_at : int;
  reason : string;
  source : source;
  cleared_at : int;
  cleared_by : cleared_by;
  resolution : string;
}

type entry = Open of open_entry | Closed of closed_entry

type t =
  | No_open of closed_entry list
  | Has_open of closed_entry list * open_entry

let empty = No_open []

let source_to_string (source : source) =
  match source with Agent -> "agent" | System -> "system"

let source_of_string : string -> source option = function
  | "agent" -> Some Agent
  | "system" -> Some System
  | _ -> None

let cleared_by_to_string (cleared_by : cleared_by) =
  match cleared_by with Agent -> "agent" | User -> "user"

let cleared_by_of_string : string -> cleared_by option = function
  | "agent" -> Some Agent
  | "user" -> Some User
  | _ -> None

let agent_source : source = Agent

let system_source : source = System

let agent_clearer : cleared_by = Agent

let user_clearer : cleared_by = User

let entries = function
  | No_open closed -> List.map (fun entry -> Closed entry) closed
  | Has_open (closed, open_entry) ->
      List.map (fun entry -> Closed entry) closed @ [ Open open_entry ]

let has_open = function No_open _ -> false | Has_open _ -> true

let open_entry ~now ~reason ~source = function
  | Has_open _ -> Error "plan block history already has an open entry"
  | No_open closed ->
      let reason = String.trim reason in
      if reason = "" then Error "blocking a plan requires a non-empty reason"
      else Ok (Has_open (closed, { blocked_at = now; reason; source }))

let close_open ~now ~cleared_by ~resolution = function
  | No_open _ -> Error "plan block history has no open entry to close"
  | Has_open (closed, open_entry) ->
      let resolution = String.trim resolution in
      if resolution = "" then
        Error "unblocking a plan requires a non-empty resolution"
      else
        Ok
          (No_open
             (closed
             @ [
                 {
                   blocked_at = open_entry.blocked_at;
                   reason = open_entry.reason;
                   source = open_entry.source;
                   cleared_at = now;
                   cleared_by;
                   resolution;
                 };
               ]))

let entry_to_json = function
  | Open entry ->
      Shared.Object
        [
          ("blockedAt", Shared.Number (float_of_int entry.blocked_at));
          ("reason", Shared.String entry.reason);
          ("source", Shared.String (source_to_string entry.source));
        ]
  | Closed entry ->
      Shared.Object
        [
          ("blockedAt", Shared.Number (float_of_int entry.blocked_at));
          ("reason", Shared.String entry.reason);
          ("source", Shared.String (source_to_string entry.source));
          ("clearedAt", Shared.Number (float_of_int entry.cleared_at));
          ("clearedBy", Shared.String (cleared_by_to_string entry.cleared_by));
          ("resolution", Shared.String entry.resolution);
        ]

let to_json history = Shared.Array (List.map entry_to_json (entries history))

let int_field name fields =
  match List.assoc_opt name fields with
  | Some (Shared.Number value)
    when Float.is_finite value
         && value = Float.round value
         && Float.abs value <= 2_147_483_647. ->
      Ok (int_of_float value)
  | _ -> Error (name ^ " must be a representable integer")

let string_field name fields =
  match List.assoc_opt name fields with
  | Some (Shared.String value) -> Ok value
  | _ -> Error (name ^ " must be a string")

let decode_entry = function
  | Shared.Object fields -> (
      let ( let* ) = Result.bind in
      let clearing_fields = [ "clearedAt"; "clearedBy"; "resolution" ] in
      let has_clearing_field =
        List.exists (fun name -> List.mem_assoc name fields) clearing_fields
      in
      let* () =
        Shared.json_exact_fields "plan block"
          ([ "blockedAt"; "reason"; "source" ]
          @ if has_clearing_field then clearing_fields else [])
          fields
      in
      let* blocked_at = int_field "blockedAt" fields in
      let* reason = string_field "reason" fields in
      let reason = String.trim reason in
      let* source_name = string_field "source" fields in
      let* source =
        match source_of_string source_name with
        | Some source -> Ok source
        | None -> Error ("unknown plan block source: " ^ source_name)
      in
      if blocked_at < 0 then Error "blockedAt must be non-negative"
      else if reason = "" then Error "plan block reason must not be empty"
      else if not has_clearing_field then
        Ok (Open { blocked_at; reason; source })
      else
        match
          ( List.assoc_opt "clearedAt" fields,
            List.assoc_opt "clearedBy" fields,
            List.assoc_opt "resolution" fields )
        with
        | ( Some (Shared.Number _),
            Some (Shared.String cleared_by_name),
            Some (Shared.String resolution) ) ->
            let* cleared_at = int_field "clearedAt" fields in
            let* cleared_by =
              match cleared_by_of_string cleared_by_name with
              | Some cleared_by -> Ok cleared_by
              | None ->
                  Error
                    ("unknown plan block clearedBy value: " ^ cleared_by_name)
            in
            let resolution = String.trim resolution in
            if cleared_at < blocked_at then
              Error "plan block clearedAt must not precede blockedAt"
            else if resolution = "" then
              Error "cleared plan block requires a non-empty resolution"
            else
              Ok
                (Closed
                   {
                     blocked_at;
                     reason;
                     source;
                     cleared_at;
                     cleared_by;
                     resolution;
                   })
        | _ ->
            Error
              "plan block clearing fields must all be present with valid values"
      )
  | _ -> Error "plan block must be an object"

let of_json = function
  | Shared.Array values ->
      let ( let* ) = Result.bind in
      let* decoded =
        List.fold_left
          (fun result value ->
            let* entries = result in
            let* entry = decode_entry value in
            Ok (entry :: entries))
          (Ok []) values
        |> Result.map List.rev
      in
      let rec build closed = function
        | [] -> Ok (No_open (List.rev closed))
        | Closed entry :: rest -> build (entry :: closed) rest
        | [ Open entry ] -> Ok (Has_open (List.rev closed, entry))
        | Open _ :: _ ->
            Error
              "plan block history may contain only one open entry, at the end"
      in
      build [] decoded
  | _ -> Error "blocks must be an array"
