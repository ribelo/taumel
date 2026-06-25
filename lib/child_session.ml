type custom_entry = {
  custom_type : string;
  data : Shared.json;
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

let ralph_child_capability_profile (parent : Capability_profile.t) active_tools =
  let tools =
    Capability_profile.allowlist_intersection parent.Capability_profile.tools
      (Capability_profile.of_list active_tools)
  in
  { parent with tools; no_sandbox_allowed = false }

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
                ("noSandbox", Shared.Bool (bool_field "noSandbox" fields));
                ("subagent", Shared.Bool (bool_field "subagent" fields));
              ];
        }
  | _ -> None

let initial_goal_entries fields =
  match string_field "initialGoalObjective" fields with
  | None -> []
  | Some objective -> (
      let worker_id = string_field "workerId" fields |> Option.value ~default:"agent" in
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
