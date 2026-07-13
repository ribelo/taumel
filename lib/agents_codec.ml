open Agents

let option_string = function
  | None -> Shared.Null
  | Some value -> Shared.String value

let option_reason = function
  | None -> Shared.Null
  | Some value -> Shared.String (reason_code_to_string value)

let option_effort = function
  | None -> Shared.Null
  | Some value -> Shared.String (effort_to_string value)

let required_nullable_string path fields name =
  match List.assoc_opt name fields with
  | None -> Error (Shared.json_path path name ^ " is required")
  | Some Shared.Null -> Ok None
  | Some (Shared.String value) -> Ok (Some value)
  | Some _ -> Error (Shared.json_path path name ^ " must be a string or null")

let required_nullable_number path fields name =
  match List.assoc_opt name fields with
  | None -> Error (Shared.json_path path name ^ " is required")
  | Some Shared.Null -> Ok None
  | Some (Shared.Number value) -> Ok (Some value)
  | Some _ -> Error (Shared.json_path path name ^ " must be a number or null")

let string_list values =
  Shared.Array (List.map (fun value -> Shared.String value) values)

let encode_issued_identity_counts (counts : issued_identity_counts) =
  Shared.Object
    [
      ("agent", Shared.Number (float_of_int counts.generic));
      ("finder", Shared.Number (float_of_int counts.finder));
      ("oracle", Shared.Number (float_of_int counts.oracle));
    ]

let encode_identity (identity : identity) =
  Shared.Object
    [
      ("agent_id", Shared.String identity.identity_agent_id);
      ("owner_session_id", Shared.String identity.identity_owner_session_id);
      ("issued_run_count", Shared.Number (float_of_int identity.identity_issued_run_count));
      ("kind", Shared.String (agent_kind_to_string identity.identity_kind));
      ("effort", option_effort identity.identity_effort);
      ("model", Shared.String identity.identity_model);
      ("thinking", Shared.String identity.identity_thinking);
      ("active_tools", string_list identity.identity_active_tools);
      ( "permission_ceiling",
        Capability_profile.to_json identity.identity_permission_ceiling );
      ("network_allowed", Shared.Bool identity.identity_network_allowed);
      ("workspace", Shared.String identity.identity_workspace);
      ("child_session_file", option_string identity.identity_child_session_file);
      ("child_session_id", option_string identity.identity_child_session_id);
      ("created_at", Shared.Number (float_of_int identity.identity_created_at));
    ]

let encode_run (run : agent_run) =
  Shared.Object
    [
      ("run_id", Shared.String run.run_id);
      ("agent_id", Shared.String run.run_agent_id);
      ("status", Shared.String (run_status_to_string run.run_status));
      ("reason_code", option_reason run.run_reason_code);
      ("error", option_string run.run_error);
      ("output_available", Shared.Bool run.run_output_available);
      ("announcement", Shared.String (announcement_to_string run.run_announcement));
      ("started_at", Shared.Number (float_of_int run.run_started_at));
      ( "ended_at",
        match run.run_ended_at with
        | None -> Shared.Null
        | Some value -> Shared.Number (float_of_int value) );
      ("submission_id", Shared.String run.run_submission_id);
      ("result_entry_id", option_string run.run_result_entry_id);
    ]

let encode (state : session_state) =
  Shared.Object
    [
      ("version", Shared.Number (float_of_int schema_version));
      ("issued_identity_counts", encode_issued_identity_counts state.issued_identity_counts);
      ("identities", Shared.Array (List.map encode_identity state.identities));
      ("runs", Shared.Array (List.map encode_run state.runs));
    ]

let decode_string_list path = function
  | Shared.Array values ->
      let rec loop acc index = function
        | [] -> Ok (List.rev acc)
        | Shared.String value :: rest -> loop (value :: acc) (index + 1) rest
        | _ :: _ -> Error (Printf.sprintf "%s[%d] must be a string" path index)
      in
      loop [] 0 values
  | _ -> Error (path ^ " must be an array")

let decode_identity path fields =
  let ( let* ) = Result.bind in
  let* agent_id = Shared.json_required_string path fields "agent_id" in
  let* owner_session_id = Shared.json_required_string path fields "owner_session_id" in
  let* issued_run_count = Shared.json_required_int path fields "issued_run_count" in
  let* () =
    if issued_run_count > 0 then Ok ()
    else Error (Shared.json_path path "issued_run_count" ^ " must be positive")
  in
  let* kind_raw = Shared.json_required_string path fields "kind" in
  let* kind = agent_kind_of_string kind_raw in
  let* () =
    if valid_agent_id kind agent_id then Ok ()
    else Error (Shared.json_path path "agent_id" ^ " does not match the current handle grammar")
  in
  let* effort =
    match required_nullable_string path fields "effort" with
    | Error _ as error -> error
    | Ok None -> Ok None
    | Ok (Some value) -> Result.map Option.some (effort_of_string value)
  in
  let* model = Shared.json_required_string path fields "model" in
  let* thinking = Shared.json_required_string path fields "thinking" in
  let* active_tools =
    match List.assoc_opt "active_tools" fields with
    | None -> Error (Shared.json_path path "active_tools" ^ " is required")
    | Some value -> decode_string_list (Shared.json_path path "active_tools") value
  in
  let* permission_ceiling =
    match List.assoc_opt "permission_ceiling" fields with
    | None -> Error (Shared.json_path path "permission_ceiling" ^ " is required")
    | Some value -> Capability_profile.of_json value
  in
  let* network_allowed = Shared.json_required_bool path fields "network_allowed" in
  let* workspace = Shared.json_required_string path fields "workspace" in
  let* child_session_file = required_nullable_string path fields "child_session_file" in
  let* child_session_id = required_nullable_string path fields "child_session_id" in
  let* created_at = Shared.json_required_int path fields "created_at" in
  Ok
    {
      identity_agent_id = agent_id;
      identity_owner_session_id = owner_session_id;
      identity_issued_run_count = issued_run_count;
      identity_kind = kind;
      identity_effort = effort;
      identity_model = model;
      identity_thinking = thinking;
      identity_active_tools = active_tools;
      identity_permission_ceiling = permission_ceiling;
      identity_network_allowed = network_allowed;
      identity_workspace = workspace;
      identity_child_session_file = child_session_file;
      identity_child_session_id = child_session_id;
      identity_created_at = created_at;
    }

let decode_run path fields =
  let ( let* ) = Result.bind in
  let* run_id = Shared.json_required_string path fields "run_id" in
  let* agent_id = Shared.json_required_string path fields "agent_id" in
  let run_prefix = agent_id ^ "-run-" in
  let* () =
    let prefix_length = String.length run_prefix in
    if String.length run_id <= prefix_length
       || String.sub run_id 0 prefix_length <> run_prefix
    then Error (Shared.json_path path "run_id" ^ " does not match its agent handle")
    else
      match int_of_string_opt (String.sub run_id prefix_length (String.length run_id - prefix_length)) with
      | Some value when value > 0 -> Ok ()
      | _ -> Error (Shared.json_path path "run_id" ^ " must end in a positive integer")
  in
  let* status_raw = Shared.json_required_string path fields "status" in
  let* status = run_status_of_string status_raw in
  let* reason_code =
    match required_nullable_string path fields "reason_code" with
    | Error _ as error -> error
    | Ok None -> Ok None
    | Ok (Some value) -> Result.map Option.some (reason_code_of_string value)
  in
  let* error = required_nullable_string path fields "error" in
  let* output_available = Shared.json_required_bool path fields "output_available" in
  let final_output = None in
  let partial_output = None in
  let* announcement_raw = Shared.json_required_string path fields "announcement" in
  let* announcement = announcement_of_string announcement_raw in
  let* started_at = Shared.json_required_int path fields "started_at" in
  let* ended_at =
    match required_nullable_number path fields "ended_at" with
    | Error _ as error -> error
    | Ok None -> Ok None
    | Ok (Some value) -> Ok (Some (int_of_float value))
  in
  let* submission_id = Shared.json_required_string path fields "submission_id" in
  let* result_entry_id = required_nullable_string path fields "result_entry_id" in
  if not (reason_compatible status reason_code) then
    Error (path ^ " has incompatible status/reason_code")
  else
    Ok
      {
        run_id;
        run_agent_id = agent_id;
        run_status = status;
        run_reason_code = reason_code;
        run_error = error;
        run_output_available = output_available;
        run_final_output = final_output;
        run_partial_output = partial_output;
        run_announcement = announcement;
        run_started_at = started_at;
        run_ended_at = ended_at;
        run_submission_id = submission_id;
        run_result_entry_id = result_entry_id;
      }

let decode_list path decode_item = function
  | Shared.Array values ->
      let rec loop acc index = function
        | [] -> Ok (List.rev acc)
        | value :: rest -> (
            match Shared.json_object_fields (Printf.sprintf "%s[%d]" path index) value with
            | Error _ as error -> error
            | Ok fields -> (
                match decode_item (Printf.sprintf "%s[%d]" path index) fields with
                | Error _ as error -> error
                | Ok item -> loop (item :: acc) (index + 1) rest))
      in
      loop [] 0 values
  | _ -> Error (path ^ " must be an array")

let decode = function
  | Shared.Object fields -> (
      match Shared.json_required_int "" fields "version" with
      | Error _ as error -> error
      | Ok version when version <> schema_version ->
          Error
            ("unsupported agents schema version: " ^ string_of_int version
           ^ " (expected " ^ string_of_int schema_version ^ ")")
      | Ok _ ->
          let ( let* ) = Result.bind in
          let* issued_identity_counts =
            match List.assoc_opt "issued_identity_counts" fields with
            | Some (Shared.Object count_fields) ->
                let* generic = Shared.json_required_int "issued_identity_counts" count_fields "agent" in
                let* finder = Shared.json_required_int "issued_identity_counts" count_fields "finder" in
                let* oracle = Shared.json_required_int "issued_identity_counts" count_fields "oracle" in
                if generic < 0 || finder < 0 || oracle < 0 then
                  Error "issued_identity_counts must be non-negative"
                else Ok { generic; finder; oracle }
            | Some _ -> Error "issued_identity_counts must be an object"
            | None -> Error "issued_identity_counts is required"
          in
          let* identities =
            match List.assoc_opt "identities" fields with
            | None -> Error "identities is required"
            | Some value -> decode_list "identities" decode_identity value
          in
          let* runs =
            match List.assoc_opt "runs" fields with
            | None -> Error "runs is required"
            | Some value -> decode_list "runs" decode_run value
          in
          Ok { identities; runs; issued_identity_counts })
  | _ -> Error "agents state must be an object"
