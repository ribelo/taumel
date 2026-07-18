type custom_entry = {
  custom_type : string;
  data : Shared.json;
}

type agent_kind = Generic | Finder | Oracle

type worktree_agent = {
  agent_id : string;
  worktree_path : string;
  main_repository_root : string;
  main_repository_id : string;
  branch : string;
}

type agent_workspace =
  | Shared_workspace of { root : string }
  | Worktree_workspace of worktree_agent

type persisted_metadata =
  | Ralph_metadata
  | Agent_metadata of {
      agent_id : string;
      agent_kind : agent_kind;
      workspace : agent_workspace;
    }

type start_plan = {
  parent_session : string option;
  model_id : string option;
  thinking_level : string option;
  active_tools : string list option;
  setup_entries : custom_entry list;
}

type bridge = {
  session_id : string option;
  session_file : string option;
  cancelled : bool;
  error : string option;
  active_tools : string list option;
  active_tools_applied : bool;
  model_id : string option;
  model_applied : bool;
  thinking_level : string option;
  thinking_applied : bool;
}

type dispatch_plan = {
  send : bool;
  prompt : string;
  deliver_as : string;
  result : Shared.json;
}

let missing_session_identifier_error =
  "createAgentSession did not expose a child session id"

let option_string_to_json = function
  | None -> Shared.Null
  | Some value -> Shared.String value

let option_string_list_to_json = function
  | None -> Shared.Null
  | Some values -> Shared.Array (List.map (fun value -> Shared.String value) values)

let object_fields = function
  | Shared.Object fields -> fields
  | _ -> []

let replace_field name value fields =
  (name, value) :: List.remove_assoc name fields

let bool_field name fields =
  match List.assoc_opt name fields with
  | Some (Shared.Bool value) -> value
  | _ -> false

let string_field name fields =
  match List.assoc_opt name fields with
  | Some (Shared.String value) -> Shared.trim_non_empty value
  | _ -> None

let string_array_field name fields =
  match List.assoc_opt name fields with
  | Some (Shared.Array values) ->
      let values =
        values
        |> List.filter_map (function
             | Shared.String value -> Shared.trim_non_empty value
             | _ -> None)
      in
      Some values
  | _ -> None

let required_string fields name =
  match Shared.json_required_string "child session metadata" fields name with
  | Ok value when String.trim value <> "" -> Ok (String.trim value)
  | Ok _ -> Error ("child session metadata." ^ name ^ " is required")
  | Error message -> Error message

let decode_agent_kind = function
  | "generic" -> Ok Generic
  | "finder" -> Ok Finder
  | "oracle" -> Ok Oracle
  | value -> Error ("invalid child session agentKind: " ^ value)

let validate_optional_positive_int fields name =
  match List.assoc_opt name fields with
  | Some Shared.Null -> Ok ()
  | Some (Shared.Number value)
    when value >= 1. && Float.floor value = value -> Ok ()
  | Some _ ->
      Error ("child session metadata." ^ name ^ " must be null or a positive integer")
  | None -> Error ("child session metadata." ^ name ^ " is required")

let decode_persisted_metadata = function
  | Shared.Object fields ->
      let ( let* ) = Result.bind in
      let* kind = required_string fields "kind" in
      if kind = "ralph" then
        let* _objective = required_string fields "objective" in
        let* _controller = required_string fields "controllerSessionId" in
        let* () = validate_optional_positive_int fields "maxIterations" in
        let* () = validate_optional_positive_int fields "reflectionEvery" in
        Ok Ralph_metadata
      else if kind <> "agent" then Error ("invalid child session kind: " ^ kind)
      else
        let* agent_id = required_string fields "agentId" in
        let* agent_kind =
          let* value = required_string fields "agentKind" in
          decode_agent_kind value
        in
        let* workspace_directory = required_string fields "workspaceDirectory" in
        let* source_workspace = required_string fields "sourceWorkspace" in
        let* isolation = required_string fields "isolation" in
        let* binding =
          match List.assoc_opt "workspaceBinding" fields with
          | Some value -> Agent_workspace.binding_of_json value
          | None -> Error "child session metadata.workspaceBinding is required"
        in
        (match (isolation, binding) with
        | "none", Agent_workspace.Shared { source_root }
          when workspace_directory = source_root && source_workspace = source_root ->
            Ok
              (Agent_metadata
                 {
                   agent_id;
                   agent_kind;
                   workspace = Shared_workspace { root = source_root };
                 })
        | "worktree",
          Agent_workspace.Worktree
            { source_origin; main_repository_root; main_repository_id }
          when source_workspace = source_origin ->
            let* worktree_path = required_string fields "worktreePath" in
            let* branch = required_string fields "worktreeBranch" in
            let* metadata_main_root =
              required_string fields "mainRepositoryRoot"
            in
            if workspace_directory <> worktree_path then
              Error "child session worktreePath must equal workspaceDirectory"
            else if metadata_main_root <> main_repository_root then
              Error
                "child session mainRepositoryRoot must match workspaceBinding"
            else
              Ok
                (Agent_metadata
                   {
                     agent_id;
                     agent_kind;
                     workspace =
                       Worktree_workspace
                         {
                           agent_id;
                           worktree_path;
                           main_repository_root;
                           main_repository_id;
                           branch;
                         };
                   })
        | "none", _ ->
            Error "shared child session requires a shared workspaceBinding"
        | "worktree", _ ->
            Error "worktree child session requires a worktree workspaceBinding"
        | value, _ -> Error ("invalid child session isolation: " ^ value))
  | _ -> Error "child session metadata must be an object"

let effective_workspace = function
  | Ralph_metadata -> None
  | Agent_metadata { workspace = Shared_workspace { root }; _ } -> Some root
  | Agent_metadata
      { workspace = Worktree_workspace { worktree_path; _ }; _ } ->
      Some worktree_path

let worktree_agent = function
  | Agent_metadata { workspace = Worktree_workspace worktree; _ } -> Some worktree
  | Ralph_metadata | Agent_metadata _ -> None

let persisted_agent_id = function
  | Agent_metadata { agent_id; _ } -> Some agent_id
  | Ralph_metadata -> None

let rejects_escalation = function
  | Ralph_metadata -> false
  | Agent_metadata { agent_kind = Finder | Oracle; _ } -> true
  | Agent_metadata { workspace = Worktree_workspace _; _ } -> true
  | Agent_metadata _ -> false

let ralph_child_capability_profile (parent : Capability_profile.t) active_tools =
  let tools =
    Capability_profile.allowlist_intersection parent.Capability_profile.tools
      (Capability_profile.of_list active_tools)
  in
  let sandbox_preset =
    match parent.sandbox_preset with
    | Capability_profile.Danger_full_access -> Capability_profile.Workspace_write
    | sandbox_preset -> sandbox_preset
  in
  Capability_profile.resolve ~sandbox_preset ~tools ~no_sandbox_allowed:false parent

let enrich_command_child_metadata ~parent_profile ~current_active_tools_available
    ~current_active_tools ~active_tools_mode metadata =
  if not current_active_tools_available then metadata
  else
    match active_tools_mode with
    | "ralph_child" ->
        let active_tools =
          Tool_catalog.rewrite_active_tools ~ralph_child:true current_active_tools
        in
        let profile =
          ralph_child_capability_profile parent_profile active_tools
        in
        metadata |> object_fields
        |> replace_field "activeTools"
             (Shared.Array (List.map (fun value -> Shared.String value) active_tools))
        |> replace_field "capabilityProfile" (Capability_profile.to_json profile)
        |> fun fields -> Shared.Object fields
    | _ -> metadata

let child_entry ~metadata ~parent_session_id ~parent_session_file =
  let fields =
    metadata |> object_fields
    |> replace_field "parentSessionId" (option_string_to_json parent_session_id)
    |> replace_field "parentSessionFile" (option_string_to_json parent_session_file)
  in
  { custom_type = "taumel.childSession"; data = Shared.Object fields }

let permissions_entry metadata =
  let fields = object_fields metadata in
  match List.assoc_opt "capabilityProfile" fields with
  | Some (Shared.Object _ as profile) ->
      Some
        {
          custom_type = "taumel.permissions";
          data =
            Shared.Object
              [
                ("version", Shared.Number 1.);
                ("profile", profile);
                ( "networkMode",
                  match List.assoc_opt "networkMode" fields with
                  | Some (Shared.String value) -> Shared.String value
                  | _ -> Shared.String "disabled" );
                ("noSandbox", Shared.Bool false);
                ("isolated_child", Shared.Bool true);
              ];
        }
  | _ -> None

let fail_closed_child_permissions_entry () =
  let profile =
    Capability_profile.resolve ~sandbox_preset:Capability_profile.Read_only
      ~approval_policy:Capability_profile.Untrusted
      ~tools:Capability_profile.None_allowed Capability_profile.default
  in
  match
    Permissions.create ~network_mode:Sandbox.Network_disabled ~no_sandbox:false
      ~isolated_child:true profile
  with
  | Ok permissions -> Permissions.codec.encode permissions
  | Error message -> failwith message

let refresh_permissions_entry ~host_sandbox_preset ~host_network_mode
    ~host_no_sandbox ~parent_permissions metadata =
  let ( let* ) = Result.bind in
  let fields = object_fields metadata in
  let decoded_ceiling =
    let* ceiling =
      match List.assoc_opt "capabilityProfile" fields with
      | Some profile -> Capability_profile.of_json profile
      | None -> Error "child metadata requires capabilityProfile"
    in
    let* ceiling_network =
      match List.assoc_opt "networkMode" fields with
      | None when string_field "kind" fields = Some "ralph" ->
          Ok Sandbox.Network_disabled
      | None -> Error "child metadata requires networkMode"
      | Some (Shared.String value) -> (
          match Permissions.persisted_network_of_string value with
          | Some network_mode -> Ok network_mode
          | None -> Error ("unknown child network mode: " ^ value))
      | Some _ -> Error "child networkMode must be a string"
    in
    Ok (ceiling, ceiling_network)
  in
  match decoded_ceiling with
  | Error _ -> fail_closed_child_permissions_entry ()
  | Ok (ceiling, ceiling_network) ->
      let persisted_parent =
        match parent_permissions with
        | None | Some Shared.Null -> Permissions.Missing
        | Some permissions -> (
            match Permissions.codec.decode permissions with
            | Ok permissions -> Permissions.Persisted permissions
            | Error _ -> Permissions.Invalid)
      in
      let parent =
        Permissions.resolve_active ~host_sandbox_preset ~host_network_mode
          ~host_no_sandbox ~session_isolated_child:false persisted_parent
      in
      let sandbox_preset =
        match
          Capability_profile.stricter_sandbox ceiling.sandbox_preset
            parent.profile.sandbox_preset
        with
        | Capability_profile.Danger_full_access ->
            Capability_profile.Workspace_write
        | sandbox_preset -> sandbox_preset
      in
      let approval_policy =
        Capability_profile.stricter_approval ceiling.approval_policy
          parent.profile.approval_policy
      in
      let network_mode =
        match (ceiling_network, parent.network_mode) with
        | Sandbox.Network_enabled, Sandbox.Network_enabled ->
            Sandbox.Network_enabled
        | _ -> Sandbox.Network_disabled
      in
      let profile =
        Capability_profile.resolve ~sandbox_preset ~approval_policy
          ~no_sandbox_allowed:false ceiling
      in
      (match
         Permissions.create ~network_mode ~no_sandbox:false ~isolated_child:true
           profile
       with
      | Ok permissions -> Permissions.codec.encode permissions
      | Error _ -> fail_closed_child_permissions_entry ())

let initial_goal_entries fields =
  match string_field "initialGoalObjective" fields with
  | None -> []
  | Some objective -> (
      let worker_id = string_field "agentId" fields |> Option.value ~default:"agent" in
      let thread_id = "agent:" ^ worker_id in
      match Goal.create ~thread_id ~now:0 objective None with
      | Error _ -> []
      | Ok goal ->
          [
            {
              custom_type = "taumel.goal";
              data = Goal.codec.encode (Some goal);
            };
            {
              custom_type = "taumel.goal_automation";
              data = Goal.automation_codec.encode Goal.Automation_enabled;
            };
          ])

let setup_entries ~metadata ~parent_session_id ~parent_session_file =
  let fields = object_fields metadata in
  let child = child_entry ~metadata ~parent_session_id ~parent_session_file in
  let base =
    match permissions_entry metadata with
    | None -> [ child ]
    | Some permissions -> [ child; permissions ]
  in
  base @ initial_goal_entries fields

let start_plan ~metadata ~parent_session_id ~parent_session_file =
  let fields = object_fields metadata in
  let parent_session =
    match parent_session_file with
    | Some value when String.trim value <> "" -> Some (String.trim value)
    | _ -> Option.bind parent_session_id Shared.trim_non_empty
  in
  {
    parent_session;
    model_id = string_field "modelId" fields;
    thinking_level = string_field "thinkingLevel" fields;
    active_tools = string_array_field "activeTools" fields;
    setup_entries = setup_entries ~metadata ~parent_session_id ~parent_session_file;
  }

let bridge_details = function
  | None ->
      Shared.Object
        [
          ( "childSession",
            Shared.Object
              [
                ("created", Shared.Bool false);
                ("reason", Shared.String "host createAgentSession unavailable");
              ] );
        ]
  | Some bridge ->
      let created =
        bridge.error = None && (not bridge.cancelled) && bridge.session_id <> None
      in
      Shared.Object
        [
          ( "childSession",
            Shared.Object
              [
                ("created", Shared.Bool created);
                ("cancelled", Shared.Bool bridge.cancelled);
                ("sessionId", option_string_to_json bridge.session_id);
                ("sessionFile", option_string_to_json bridge.session_file);
                ("error", option_string_to_json bridge.error);
                ("activeTools", option_string_list_to_json bridge.active_tools);
                ("activeToolsApplied", Shared.Bool bridge.active_tools_applied);
                ("modelId", option_string_to_json bridge.model_id);
                ("modelApplied", Shared.Bool bridge.model_applied);
                ("thinkingLevel", option_string_to_json bridge.thinking_level);
                ("thinkingApplied", Shared.Bool bridge.thinking_applied);
              ] );
        ]

let dispatch_result ?session_id ?reason ~dispatched () =
  let fields = [ ("dispatched", Shared.Bool dispatched) ] in
  let fields =
    match reason with
    | None -> fields
    | Some reason -> fields @ [ ("reason", Shared.String reason) ]
  in
  let fields =
    match session_id with
    | None -> fields
    | Some session_id -> fields @ [ ("sessionId", Shared.String session_id) ]
  in
  Shared.Object fields

let dispatch_plan ?(empty_reason = "empty prompt") ?(deliver_as = "followUp")
    ?bridge ~prompt ~send_available () =
  let prompt = String.trim prompt in
  let deliver_as =
    match deliver_as with
    | "steer" -> "steer"
    | _ -> "followUp"
  in
  let session_id = Option.bind bridge (fun bridge -> bridge.session_id) in
  let immediate ?session_id reason =
    {
      send = false;
      prompt = "";
      deliver_as = "followUp";
      result = dispatch_result ?session_id ~dispatched:false ~reason ();
    }
  in
  if prompt = "" then immediate empty_reason
  else
    match bridge with
    | Some { cancelled = true; _ } -> immediate "child session was cancelled"
    | Some { error = Some error; _ } -> immediate error
    | _ when not send_available ->
        immediate ?session_id "host sendUserMessage unavailable"
    | _ ->
        {
          send = true;
          prompt;
          deliver_as;
          result = dispatch_result ?session_id ~dispatched:true ();
        }
