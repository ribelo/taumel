open Jsoo_bridge

let js_child_session_custom_entry (entry : Taumel.Child_session.custom_entry) =
  Unsafe.obj
    [|
      ("customType", js_string entry.custom_type);
      ("data", json_to_js entry.data);
    |]
  |> ojs_of_js
  |> decode_ojs_contract Tool_contracts.ChildSessionSetupEntry.t_of_js

let child_session_metadata_from_js metadata =
  match json_from_js metadata with
  | Ok metadata -> metadata
  | Error _ -> Taumel.Shared.Object []

let plan_permission_refresh parent_permissions_js metadata_js parent_ctx =
  let parent_permissions =
    match json_from_js parent_permissions_js with
    | Ok Taumel.Shared.Null -> None
    | Ok permissions -> Some permissions
    | Error _ -> Some (Taumel.Shared.Object [])
  in
  let metadata = child_session_metadata_from_js metadata_js in
  let permissions =
    (match
       Session_sync.try_sync_session_from_host
         ~scope:"child permission refresh" parent_ctx
     with
    | Error _ -> Taumel.Child_session.fail_closed_child_permissions_entry ()
    | Ok () ->
        Taumel.Child_session.refresh_permissions_entry
          ~host_sandbox_preset:!App_state.host_sandbox_preset
          ~host_network_mode:!App_state.host_network_mode
          ~host_no_sandbox:!App_state.host_no_sandbox ~parent_permissions metadata)
    |> json_to_js |> ojs_of_js
    |> decode_ojs_contract Tool_contracts.PermissionsStateV1.t_of_js
  in
  Tool_contracts.ChildPermissionRefreshPlan.create ~permissions ()
  |> Tool_contracts.ChildPermissionRefreshPlan.t_to_js |> inject

let child_session_bridge_from_js facts =
  if not (get_bool facts "available") then None
  else
    Some
      {
        Taumel.Child_session.session_id =
          Option.bind (optional_string_field facts "sessionId")
            Taumel.Shared.trim_non_empty;
        session_file =
          Option.bind (optional_string_field facts "sessionFile")
            Taumel.Shared.trim_non_empty;
        cancelled = get_bool facts "cancelled";
        error =
          (match
             Option.bind (optional_string_field facts "error")
               Taumel.Shared.trim_non_empty
           with
          | Some error -> Some error
          | None when get_bool facts "missingSessionIdentifier" ->
              Some Taumel.Child_session.missing_session_identifier_error
          | None -> None);
        active_tools = optional_string_array facts "activeTools";
        active_tools_applied = get_bool facts "activeToolsApplied";
        model_id =
          Option.bind (optional_string_field facts "modelId")
            Taumel.Shared.trim_non_empty;
        model_applied = get_bool facts "modelApplied";
        thinking_level =
          Option.bind (optional_string_field facts "thinkingLevel")
            Taumel.Shared.trim_non_empty;
        thinking_applied = get_bool facts "thinkingApplied";
      }

let child_bridge_details facts =
  json_to_js
    (Taumel.Child_session.bridge_details
       (child_session_bridge_from_js facts))

let plan_child_dispatch facts =
  let facts = decode_ojs_contract Tool_contracts.ChildDispatchFacts.t_of_js (ojs_of_js facts) in
  let bridge =
    if not (Tool_contracts.ChildDispatchFacts.get_available facts) then None
    else
      Some
        {
          Taumel.Child_session.session_id = Option.bind (Tool_contracts.ChildDispatchFacts.get_sessionId facts) Taumel.Shared.trim_non_empty;
          session_file = Option.bind (Tool_contracts.ChildDispatchFacts.get_sessionFile facts) Taumel.Shared.trim_non_empty;
          cancelled = Option.value (Tool_contracts.ChildDispatchFacts.get_cancelled facts) ~default:false;
          error =
            (match Option.bind (Tool_contracts.ChildDispatchFacts.get_error facts) Taumel.Shared.trim_non_empty with
            | Some error -> Some error
            | None when Option.value (Tool_contracts.ChildDispatchFacts.get_missingSessionIdentifier facts) ~default:false ->
                Some Taumel.Child_session.missing_session_identifier_error
            | None -> None);
          active_tools = Tool_contracts.ChildDispatchFacts.get_activeTools facts;
          active_tools_applied = Option.value (Tool_contracts.ChildDispatchFacts.get_activeToolsApplied facts) ~default:false;
          model_id = Option.bind (Tool_contracts.ChildDispatchFacts.get_modelId facts) Taumel.Shared.trim_non_empty;
          model_applied = Option.value (Tool_contracts.ChildDispatchFacts.get_modelApplied facts) ~default:false;
          thinking_level = Option.bind (Tool_contracts.ChildDispatchFacts.get_thinkingLevel facts) Taumel.Shared.trim_non_empty;
          thinking_applied = Option.value (Tool_contracts.ChildDispatchFacts.get_thinkingApplied facts) ~default:false;
        }
  in
  let empty_reason =
    Option.value
      (Option.bind (Some (Tool_contracts.ChildDispatchFacts.get_emptyReason facts))
         Taumel.Shared.trim_non_empty)
      ~default:"empty prompt"
  in
  let deliver_as =
    Option.bind (Tool_contracts.ChildDispatchFacts.get_deliverAs facts)
      Taumel.Shared.trim_non_empty
  in
  Taumel.Child_session.dispatch_plan ?bridge ~empty_reason
    ?deliver_as ~prompt:(Tool_contracts.ChildDispatchFacts.get_prompt facts)
    ~send_available:(Tool_contracts.ChildDispatchFacts.get_sendAvailable facts)
    ()
  |> fun plan ->
  Tool_contracts.ChildDispatchPlan.create ~send:plan.send ~prompt:plan.prompt
    ~deliverAs:plan.deliver_as
    ~result:(decode_ojs_contract Tool_contracts.ChildDispatchResult.t_of_js (ojs_of_js (json_to_js plan.result))) ()
  |> Tool_contracts.ChildDispatchPlan.t_to_js |> inject

let plan_child_session_start raw_facts ctx =
  let facts = decode_ojs_contract Tool_contracts.ChildSessionStartFacts.t_of_js (ojs_of_js raw_facts) in
  let metadata_js =
    Tool_contracts.ChildSessionStartFacts.get_metadata facts
    |> Tool_contracts.ChildSessionMetadata.t_to_js |> js_of_ojs
  in
  let metadata = child_session_metadata_from_js metadata_js in
  let parent_session_id = Some (Session_store.session_id_from_ctx ctx) in
  let parent_session_file = Tool_contracts.ChildSessionStartFacts.get_parentSessionFile facts in
  let plan =
    Taumel.Child_session.start_plan ~metadata ~parent_session_id
      ~parent_session_file
  in
  let result =
    let privateSessionDirectory =
      match
        Option.bind (optional_string_field metadata_js "agentId")
          Taumel.Shared.trim_non_empty
      with
      | None -> None
      | Some agent_id -> (
          (if
             Option.bind parent_session_file Taumel.Shared.trim_non_empty = None
           then
             match
               Agent_ephemeral_cleanup.register
                 ~owner_session_id:(Session_store.session_id_from_ctx ctx)
                 ~agent_id
             with
             | Ok () -> ()
             | Error message -> failwith message);
          match
            Agent_child_session_host.private_directory
              ~owner_session_id:(Session_store.session_id_from_ctx ctx) ~agent_id
          with
          | Ok directory -> Some directory
          | Error message -> failwith message)
    in
    Tool_contracts.ChildSessionStartPlan.create ?parentSession:plan.parent_session
      ?modelId:plan.model_id ?thinkingLevel:plan.thinking_level
      ?activeTools:plan.active_tools ?privateSessionDirectory
      ~setupEntries:(List.map js_child_session_custom_entry plan.setup_entries) ()
  in
  Tool_contracts.ChildSessionStartPlan.t_to_js result |> inject
