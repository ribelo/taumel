open Agent_runs


let profile_toggle_to_json toggle =
  Shared.Object
    [
      ("name", Shared.String toggle.toggle_profile);
      ("enabled", Shared.Bool toggle.toggle_enabled);
    ]

let profile_toggle_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* name = Shared.json_required_string path fields "name" in
  let* enabled = Shared.json_required_bool path fields "enabled" in
  Ok { toggle_profile = name; toggle_enabled = enabled }

let int_json value = Shared.Number (float_of_int value)
let int_option_json = function None -> Shared.Null | Some value -> int_json value
let string_option_json = function None -> Shared.Null | Some value -> Shared.String value
let string_list_json values =
  Shared.Array (List.map (fun value -> Shared.String value) values)

let string_list_option_json = function
  | None -> Shared.Null
  | Some values -> string_list_json values

let network_mode_to_json = function
  | Sandbox.Network_disabled -> Shared.String "disabled"
  | Sandbox.Network_enabled -> Shared.String "enabled"

let network_mode_of_json path = function
  | Shared.String "disabled" -> Ok Sandbox.Network_disabled
  | Shared.String "enabled" -> Ok Sandbox.Network_enabled
  | value -> Error (path ^ " must be disabled or enabled, got " ^ Shared.json_kind value)

let sandbox_approval_to_json = function
  | Sandbox.Never -> Shared.String "never"
  | Sandbox.On_request -> Shared.String "on-request"
  | Sandbox.On_failure -> Shared.String "on-failure"
  | Sandbox.Untrusted -> Shared.String "untrusted"

let sandbox_approval_of_json path = function
  | Shared.String "never" -> Ok Sandbox.Never
  | Shared.String "on-request" -> Ok Sandbox.On_request
  | Shared.String "on-failure" -> Ok Sandbox.On_failure
  | Shared.String "untrusted" -> Ok Sandbox.Untrusted
  | value ->
      Error
        (path ^ " must be never, on-request, on-failure, or untrusted, got "
       ^ Shared.json_kind value)

let sandbox_config_to_json (sandbox : Sandbox.config) =
  Shared.Object
    [
      ( "filesystemMode",
        Shared.String (Sandbox.filesystem_mode_to_string sandbox.Sandbox.filesystem_mode) );
      ("workspaceRoots", string_list_json sandbox.workspace_roots);
      ("networkMode", network_mode_to_json sandbox.network_mode);
      ("approvalPolicy", sandbox_approval_to_json sandbox.approval_policy);
      ("noSandbox", Shared.Bool sandbox.no_sandbox);
      ("subagent", Shared.Bool sandbox.subagent);
    ]

let sandbox_config_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* filesystem_mode_string =
    Shared.json_required_string path fields "filesystemMode"
  in
  let* filesystem_mode =
    match Sandbox.filesystem_mode_of_string filesystem_mode_string with
    | Some value -> Ok value
    | None -> Error (Shared.json_path path "filesystemMode" ^ " is invalid")
  in
  let* workspace_roots =
    Result.bind (Shared.json_required_field path fields "workspaceRoots")
      (Shared.json_string_list (Shared.json_path path "workspaceRoots"))
  in
  let* network_mode =
    Result.bind (Shared.json_required_field path fields "networkMode")
      (network_mode_of_json (Shared.json_path path "networkMode"))
  in
  let* approval_policy =
    Result.bind (Shared.json_required_field path fields "approvalPolicy")
      (sandbox_approval_of_json (Shared.json_path path "approvalPolicy"))
  in
  let* no_sandbox = Shared.json_required_bool path fields "noSandbox" in
  let* subagent = Shared.json_required_bool path fields "subagent" in
  Ok
    {
      Sandbox.filesystem_mode;
      workspace_roots;
      network_mode;
      approval_policy;
      no_sandbox;
      subagent;
    }

let optional_profile_snapshot path fields =
  Result.bind (Shared.json_optional_field fields "profile_snapshot") (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some (Capability_profile.of_json value)
        |> Result.map_error (fun message ->
               Shared.json_path path "profile_snapshot" ^ ": " ^ message))

let optional_sandbox_snapshot path fields =
  Result.bind (Shared.json_optional_field fields "sandbox_snapshot") (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some
          (sandbox_config_of_json (Shared.json_path path "sandbox_snapshot") value))

let optional_string_list_snapshot path fields name =
  Result.bind (Shared.json_optional_field fields name) (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some
          (Shared.json_string_list (Shared.json_path path name) value))

let submission_to_json submission =
  Shared.Object
    [
      ("submission_id", Shared.String submission.submission_id);
      ("kind", Shared.String submission.submission_kind);
      ("created_at", int_json submission.submission_created_at);
    ]

let submission_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* submission_id = Shared.json_required_string path fields "submission_id" in
  let* submission_kind =
    Shared.json_string_default path fields "kind" "message"
  in
  let* created_at = Shared.json_required_int path fields "created_at" in
  Ok { submission_id; submission_kind; submission_created_at = created_at }

let identity_to_json identity =
  Shared.Object
    [
      ("agent_id", Shared.String identity.identity_agent_id);
      ("parent_session_id", Shared.String identity.identity_parent_session_id);
      ("profile", Shared.String identity.identity_profile_name);
      ("child_session_id", string_option_json identity.identity_child_session_id);
      ( "profile_snapshot",
        match identity.identity_profile_snapshot with
        | None -> Shared.Null
        | Some profile -> Capability_profile.to_json profile );
      ( "sandbox_snapshot",
        match identity.identity_sandbox_snapshot with
        | None -> Shared.Null
        | Some sandbox -> sandbox_config_to_json sandbox );
      ("system_prompt", Shared.String identity.identity_system_prompt);
      ("active_tools", string_list_option_json identity.identity_active_tools);
      ("created_at", int_json identity.identity_created_at);
      ("closed_at", int_option_json identity.identity_closed_at);
    ]

let identity_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* identity_agent_id = Shared.json_required_string path fields "agent_id" in
  let* identity_parent_session_id =
    Shared.json_required_string path fields "parent_session_id"
  in
  let* identity_profile_name = Shared.json_required_string path fields "profile" in
  let* identity_child_session_id =
    Shared.json_optional_string path fields "child_session_id"
  in
  let* identity_profile_snapshot = optional_profile_snapshot path fields in
  let* identity_sandbox_snapshot = optional_sandbox_snapshot path fields in
  let* identity_system_prompt =
    Shared.json_string_default path fields "system_prompt" ""
  in
  let* identity_active_tools =
    optional_string_list_snapshot path fields "active_tools"
  in
  let* identity_created_at = Shared.json_required_int path fields "created_at" in
  let* identity_closed_at =
    Result.map (Option.map int_of_float)
      (Shared.json_optional_number path fields "closed_at")
  in
  Ok
    {
      identity_agent_id;
      identity_parent_session_id;
      identity_profile_name;
      identity_child_session_id;
      identity_profile_snapshot;
      identity_sandbox_snapshot;
      identity_system_prompt;
      identity_active_tools;
      identity_created_at;
      identity_closed_at;
    }

let run_to_json run =
  Shared.Object
    [
      ("run_id", Shared.String run.run_id);
      ("agent_id", Shared.String run.run_agent_id);
      ("initial_submission_kind", Shared.String run.run_initial_submission_kind);
      ( "submissions",
        Shared.Array (List.map submission_to_json run.run_submissions) );
      ("status", Shared.String (run_status_to_string run.run_status));
      ( "reason",
        string_option_json
          (match run.run_reason with
          | Some
              ( "interrupted_by_parent" | "closed_by_parent"
              | "stopped_by_parent" | "goal_blocked"
              | "goal_continuation_limit" | "replacement_dispatch_failed"
              | "working_directory_unavailable" | "model_unavailable"
              | "tool_surface_unavailable" | "identity_snapshot_incomplete"
              | "process_resumed_without_live_worker" | "timed_out" ) as reason
            ->
              reason
          | _ -> None) );
      ("consumed", Shared.Bool run.run_consumed);
      ("background_notified", Shared.Bool run.run_background_notified);
      ("created_at", int_json run.run_created_at);
      ("started_at", int_option_json run.run_started_at);
      ("completed_at", int_option_json run.run_completed_at);
    ]

let run_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* run_id = Shared.json_required_string path fields "run_id" in
  let* run_agent_id = Shared.json_required_string path fields "agent_id" in
  let* run_initial_submission_kind =
    Shared.json_string_default path fields "initial_submission_kind" "objective"
  in
  let* submission_values =
    match Shared.json_optional_field fields "submissions" with
    | Error _ as error -> error
    | Ok None -> Ok []
    | Ok (Some value) -> Shared.json_array (Shared.json_path path "submissions") value
  in
  let rec decode_submissions acc index = function
    | [] -> Ok (List.rev acc)
    | value :: rest -> (
        match
          submission_of_json
            (Printf.sprintf "%s.submissions[%d]" path index)
            value
        with
        | Ok submission -> decode_submissions (submission :: acc) (index + 1) rest
        | Error _ as error -> error)
  in
  let* run_submissions = decode_submissions [] 0 submission_values in
  let* status = Shared.json_required_string path fields "status" in
  let* run_status = run_status_of_string status in
  let* run_reason = Shared.json_optional_string path fields "reason" in
  let* run_consumed = Shared.json_bool_default path fields "consumed" false in
  let* run_background_notified =
    Shared.json_bool_default path fields "background_notified" false
  in
  let* run_created_at = Shared.json_required_int path fields "created_at" in
  let* run_started_at =
    Result.map (Option.map int_of_float)
      (Shared.json_optional_number path fields "started_at")
  in
  let* run_completed_at =
    Result.map (Option.map int_of_float)
      (Shared.json_optional_number path fields "completed_at")
  in
  Ok
    {
      run_id;
      run_agent_id;
      run_initial_submission_kind;
      run_submissions;
      run_status;
      run_reason;
      run_final_output = None;
      run_output_available = false;
      run_consumed;
      run_background_notified;
      run_created_at;
      run_started_at;
      run_completed_at;
    }

let decode_object_array path fields name decode =
  let ( let* ) = Result.bind in
  let* values =
    match Shared.json_optional_field fields name with
    | Error _ as error -> error
    | Ok None -> Ok []
    | Ok (Some value) -> Shared.json_array (Shared.json_path path name) value
  in
  let rec loop acc index = function
    | [] -> Ok (List.rev acc)
    | value :: rest -> (
        match decode (Printf.sprintf "%s.%s[%d]" path name index) value with
        | Ok item -> loop (item :: acc) (index + 1) rest
        | Error _ as error -> error)
  in
  loop [] 0 values

let session_state_to_json state =
  Shared.Object
    [
      ("version", Shared.Number 1.);
      ( "profiles",
        Shared.Array (List.map profile_toggle_to_json state.profile_toggles) );
      ("agents", Shared.Array (List.map identity_to_json state.identities));
      ("runs", Shared.Array (List.map run_to_json state.runs));
    ]

let session_state_of_json json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields "taumel.agents" json in
  let* profile_toggles =
    decode_object_array "taumel.agents" fields "profiles" profile_toggle_of_json
  in
  let* identities =
    decode_object_array "taumel.agents" fields "agents" identity_of_json
  in
  let* runs = decode_object_array "taumel.agents" fields "runs" run_of_json in
  Ok { profile_toggles; identities; runs }

let session_state_codec =
  { Shared.encode = session_state_to_json; decode = session_state_of_json }
