open Jsoo_bridge
open App_state
open Runtime_access

let js_context_overrides overrides =
  List.map
    (fun (name, value) -> Tool_contracts.CommandContextOverride.create ~name ~value ())
    overrides

let plan_execution raw_facts =
  let facts = Tool_contracts.CommandExecutionFacts.t_of_js (ojs_of_js raw_facts) in
  let name = Tool_contracts.CommandExecutionFacts.get_name facts in
  let args = Tool_contracts.CommandExecutionFacts.get_args facts in
  let ctx =
    Tool_contracts.CommandExecutionFacts.get_ctx facts
    |> Option.map (fun value -> Ts2ocaml.unknown_to_js value |> Obj.magic)
    |> Option.value ~default:(Unsafe.obj [||])
  in
  Session_sync.sync_session_from_host ~scope:"command plan" ctx;
  let ralph_start_denial =
    match name with
    | "ralph" -> (match authorize_ralph_start () with Ok () -> None | Error message -> Some message)
    | _ -> None
  in
  match
    Taumel.Command_plan.plan_execution
      ~controller_session_id:(Session_store.session_id_from_ctx ctx)
      ~ralph_start_denial name args
  with
  | Error message ->
      Boundary_contracts.CommandExecutionError.create ~message ()
      |> Tool_contracts.CommandExecutionError.t_to_js |> inject
  | Ok Taumel.Command_plan.Command_direct ->
      Boundary_contracts.CommandExecutionDirect.create ()
      |> Tool_contracts.CommandExecutionDirect.t_to_js |> inject
  | Ok (Command_child_session plan) ->
      Boundary_contracts.CommandExecutionChild.create
        ~metadata:(Tool_contracts.ChildSessionMetadata.t_of_js (ojs_of_js (json_to_js plan.metadata)))
        ~contextOverrides:(js_context_overrides plan.context_overrides)
        ~activeToolsMode:plan.active_tools_mode
        ~childSessionContextKey:plan.child_session_context_key ()
      |> Tool_contracts.CommandExecutionChild.t_to_js |> inject

let plan_child_session raw_facts =
  let facts = Tool_contracts.CommandChildSessionFacts.t_of_js (ojs_of_js raw_facts) in
  let metadata =
    Tool_contracts.CommandChildSessionFacts.get_metadata facts
    |> Tool_contracts.ChildSessionMetadata.t_to_js |> Obj.magic
  in
  let metadata =
    match json_from_js metadata with
    | Ok json -> json
    | Error _ -> Taumel.Shared.Object []
  in
  let metadata =
    Taumel.Child_session.enrich_command_child_metadata
      ~parent_profile:(active_profile ())
      ~current_active_tools_available:(Tool_contracts.CommandChildSessionFacts.get_currentActiveToolsAvailable facts)
      ~current_active_tools:(Tool_contracts.CommandChildSessionFacts.get_currentActiveTools facts)
      ~active_tools_mode:(Tool_contracts.CommandChildSessionFacts.get_activeToolsMode facts)
      metadata
  in
  Tool_contracts.CommandChildSessionPlan.create
    ~metadata:(Tool_contracts.ChildSessionMetadata.t_of_js (ojs_of_js (json_to_js metadata))) ()
  |> Tool_contracts.CommandChildSessionPlan.t_to_js |> inject

let plan_child_dispatch raw_facts =
  let facts = Tool_contracts.CommandChildDispatchFacts.t_of_js (ojs_of_js raw_facts) in
  let result =
    Tool_contracts.CommandChildDispatchFacts.get_result facts
    |> Tool_contracts.BridgeCommandResult.t_to_js |> Obj.magic
  in
  let bridge_facts =
    Tool_contracts.CommandChildDispatchFacts.get_bridge facts
    |> Ts2ocaml.unknown_to_js |> Obj.magic
  in
  let result_with_child =
    command_result_with_details result
      (Child_session_bridge.child_bridge_details bridge_facts)
  in
  let return_result result =
    Boundary_contracts.CommandChildReturn.create
      ~result:(Tool_contracts.BridgeCommandResult.t_of_js (ojs_of_js result)) ()
    |> Tool_contracts.CommandChildReturn.t_to_js |> inject
  in
  let details =
    if has_property result "details" then Unsafe.get result "details"
    else Unsafe.obj [||]
  in
  let input : Taumel.Command_plan.command_result =
    {
      object_like = is_js_object result;
      ok = get_bool result "ok";
      details =
        {
          task_id = get_string details "taskId";
          child_prompt = get_string details "childPrompt";
        };
    }
  in
  match
    Taumel.Command_plan.plan_child_dispatch input
      (Child_session_bridge.child_session_bridge_from_js bridge_facts)
  with
  | Command_return -> return_result result_with_child
  | Command_child_dispatch plan ->
      let bridgeUpdate =
        Tool_contracts.CommandBridgeUpdate.create ~action:plan.bridge_update_action
          ~key:plan.bridge_update_key ()
      in
      Boundary_contracts.CommandChildDispatch.create
        ~result:(Tool_contracts.BridgeCommandResult.t_of_js (ojs_of_js result_with_child))
        ~bridgeUpdate ~prompt:plan.prompt ()
      |> Tool_contracts.CommandChildDispatch.t_to_js |> inject

let finish_child_dispatch raw_facts =
  let facts = Tool_contracts.CommandChildDispatchFinishFacts.t_of_js (ojs_of_js raw_facts) in
  let result =
    Tool_contracts.CommandChildDispatchFinishFacts.get_result facts
    |> Tool_contracts.BridgeCommandResult.t_to_js |> Obj.magic
  in
  let dispatch =
    Tool_contracts.CommandChildDispatchFinishFacts.get_dispatch facts
    |> Tool_contracts.ChildDispatchResult.t_to_js |> Obj.magic
  in
  command_result_with_details result (Unsafe.obj [| ("dispatch", inject dispatch) |])
  |> ojs_of_js |> Tool_contracts.BridgeCommandResult.t_of_js
  |> Tool_contracts.BridgeCommandResult.t_to_js |> inject

let handle raw_facts =
  let facts = Tool_contracts.HandleCommandFacts.t_of_js (ojs_of_js raw_facts) in
  let name = Tool_contracts.HandleCommandFacts.get_name facts in
  let args = Tool_contracts.HandleCommandFacts.get_args facts in
  let ctx = Tool_contracts.HandleCommandFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> Obj.magic
  in
  Session_sync.sync_session_from_host ~scope:"command handle" ctx;
  match name with
  | "permissions" -> Permissions_commands.handle args ctx
  | "network" -> Permissions_commands.handle_network args ctx
  | "goal" -> Goal_tools.handle_command args ctx
  | "cron" -> Cron_tools.handle_command args ctx
  | "ralph" -> Ralph_tools.handle_command args ctx
  | "usage" -> Usage_bridge.handle_command ()
  | "tools" -> Visibility_commands.handle Taumel.Visibility.Tools args ctx
  | "skills" -> Visibility_commands.handle Taumel.Visibility.Skills args ctx
  | "execpolicy" -> Exec_policy_bridge.handle_command args
  | "agent-runs" -> Agent_lifecycle.handle_agent_runs_command args ctx
  | other -> error_obj ("command is not connected yet: " ^ other)
