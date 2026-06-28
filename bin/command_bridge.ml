open Jsoo_bridge
open App_state

let js_context_overrides overrides =
  overrides
  |> List.map (fun (name, value) -> (name, js_string value))
  |> Array.of_list |> Unsafe.obj

let plan_execution name args ctx =
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
  | Error message -> error_obj message
  | Ok Taumel.Command_plan.Command_direct ->
      ok_obj [ ("action", js_string "command_direct") ]
  | Ok (Command_child_session plan) ->
      ok_obj
        [
          ("action", js_string "command_child_session");
          ("metadata", json_to_js plan.metadata);
          ("contextOverrides", js_context_overrides plan.context_overrides);
          ("activeToolsMode", js_string plan.active_tools_mode);
          ("childSessionContextKey", js_string plan.child_session_context_key);
        ]

let plan_child_session facts =
  let plan = Unsafe.get facts "plan" in
  let metadata = Unsafe.get plan "metadata" in
  let metadata =
    match json_from_js metadata with
    | Ok json -> json
    | Error _ -> Taumel.Shared.Object []
  in
  let metadata =
    Taumel.Child_session.enrich_command_child_metadata
      ~parent_profile:(active_profile ())
      ~current_active_tools_available:(get_bool facts "currentActiveToolsAvailable")
      ~current_active_tools:(get_string_array facts "currentActiveTools")
      ~active_tools_mode:(get_string plan "activeToolsMode")
      metadata
  in
  ok_obj [ ("metadata", json_to_js metadata) ]

let plan_child_dispatch params =
  let result = Unsafe.get params "result" in
  let bridge_facts = Unsafe.get params "bridge" in
  let result_with_child =
    command_result_with_details result
      (Child_session_bridge.child_bridge_details bridge_facts)
  in
  let return_result result =
    ok_obj [ ("action", js_string "command_return"); ("result", inject result) ]
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
      ok_obj
        [
          ("action", js_string "command_child_dispatch");
          ("result", inject result_with_child);
          ( "bridgeUpdate",
            Unsafe.obj
              [|
                ("action", js_string plan.bridge_update_action);
                ("key", js_string plan.bridge_update_key);
              |] );
          ("prompt", js_string plan.prompt);
        ]

let finish_child_dispatch params =
  let result = Unsafe.get params "result" in
  let dispatch = Unsafe.get params "dispatch" in
  command_result_with_details result
    (Unsafe.obj [| ("dispatch", inject dispatch) |])

let handle name args ctx =
  Session_sync.sync_session_from_host ~scope:"command handle" ctx;
  match name with
  | "permissions" -> Permissions_commands.handle args ctx
  | "network" -> Permissions_commands.handle_network args ctx
  | "goal" -> Goal_tools.handle_command args ctx
  | "ralph" -> Ralph_tools.handle_command args ctx
  | "usage" -> Usage_bridge.handle_command ()
  | "agents" -> Agent_tools.handle_agents_command args ctx
  | "agent-runs" -> Agent_tools.handle_agent_runs_command args ctx
  | "execpolicy" -> Exec_policy_bridge.handle_command args
  | other -> error_obj ("command is not connected yet: " ^ other)
