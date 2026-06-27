open Jsoo_bridge

let arg_at args index =
  if index < Array.length args then args.(index) else Unsafe.inject Js.undefined

let string_arg args index =
  Js.to_string (Unsafe.coerce (arg_at args index))

let bool_arg args index =
  Js.to_bool (Unsafe.coerce (arg_at args index))

let int_arg args index =
  match float_value (arg_at args index) with
  | Some value -> int_of_float value
  | None -> -1

let core_call name_js args_js =
  let name = Js.to_string name_js in
  let args = Option.value (array_value args_js) ~default:[||] in
  let arg = arg_at args in
  match name with
  | "toolPolicyNames" -> Tool_catalog_bridge.tool_policy_names_js ()
  | "allowedToolNames" -> Tool_catalog_bridge.allowed_tool_names_js ()
  | "commandSpecs" -> Tool_catalog_bridge.command_specs_js ()
  | "planActiveToolsSync" ->
      Tool_catalog_bridge.plan_active_tools_sync_js (arg 0) (arg 1)
  | "planEnvironmentContext" ->
      Environment_context_bridge.plan_context (arg 0) (arg 1)
  | "sandboxMetadataDirNames" -> Sandbox_bridge.sandbox_metadata_dir_names ()
  | "validateWorkspaceMutationPaths" ->
      Sandbox_bridge.validate_workspace_mutation_paths (arg 0)
  | "sandboxHostPathPlan" -> Sandbox_bridge.sandbox_host_path_plan (arg 0)
  | "planChildSessionStart" ->
      Child_session_bridge.plan_child_session_start (arg 0) (arg 1)
  | "planChildDispatch" -> Child_session_bridge.plan_child_dispatch (arg 0)
  | "prepareTool" -> Tool_dispatch.prepare (string_arg args 0) (arg 1) (arg 2)
  | "applyPatchToFiles" ->
      Mutation_tools.apply_patch_to_files (arg 0) (arg 1) (arg 2) (arg 3)
  | "applyEditToFile" -> Mutation_tools.apply_edit_to_file (arg 0) (string_arg args 1)
  | "planExecHostCall" ->
      Sandbox_bridge.plan_exec_host_call (arg 0) (arg 1) (arg 2) (arg 3)
  | "formatExecResult" ->
      Sandbox_bridge.format_exec_result (arg 0) (arg 1) (arg 2) (arg 3)
  | "planExecApprovalPrompt" ->
      Sandbox_bridge.plan_exec_approval_prompt (arg 0) (arg 1)
  | "finishExecApproval" -> Sandbox_bridge.finish_exec_approval (arg 0)
  | "planWriteStdinHostCall" ->
      Sandbox_bridge.plan_write_stdin_host_call (arg 0) (arg 1)
  | "runExecCommand" ->
      Exec_session.run_exec_command (arg 0) (arg 1) (arg 2)
        (string_arg args 3) (arg 4) (arg 5)
  | "writeExecStdin" -> Exec_session.write_stdin (arg 0) (string_arg args 1)
  | "readFile" -> Read_tool.read_file (arg 0) (arg 1)
  | "shutdownExecOwner" -> Exec_session.shutdown_owner (string_arg args 0)
  | "pendingExecNotifications" ->
      Exec_session.pending_exec_notifications (string_arg args 0)
  | "markExecNotificationDelivered" ->
      Exec_session.mark_exec_notification_delivered (int_arg args 0)
  | "awaitExecCompletion" ->
      Exec_session.await_exec_completion (int_arg args 0)
  | "planCommandExecution" ->
      Command_bridge.plan_execution (string_arg args 0) (string_arg args 1) (arg 2)
  | "planGoalContinuation" ->
      Goal_tools.plan_continuation (bool_arg args 0) (arg 1) (arg 2) (arg 3)
  | "planChildGoalContinuation" ->
      Goal_tools.plan_child_goal_continuation (arg 0)
  | "startGoalTurn" ->
      Session_sync.start_goal_turn ();
      ok_obj []
  | "goalClockPauseStart" ->
      Session_sync.goal_clock_pause_start ();
      ok_obj []
  | "goalClockPauseEnd" ->
      Session_sync.goal_clock_pause_end ();
      ok_obj []
  | "interruptGoalAutomation" ->
      Session_sync.interrupt_goal_automation (arg 0);
      ok_obj []
  | "clearInterruptedGoalAutomation" ->
      Session_sync.clear_interrupted_goal_automation (arg 0);
      ok_obj []
  | "planCommandChildSession" -> Command_bridge.plan_child_session (arg 0)
  | "planCommandChildDispatch" -> Command_bridge.plan_child_dispatch (arg 0)
  | "finishCommandChildDispatch" -> Command_bridge.finish_child_dispatch (arg 0)
  | "planAgentSpawn" -> Agent_tools.plan_spawn (arg 0)
  | "finishAgentAction" -> Agent_tools.finish_action (arg 0) (arg 1)
  | "recordAgentDispatchCompletion" ->
      Agent_tools.record_dispatch_completion (arg 0) (arg 1)
  | "recordAgentBackgroundNotification" ->
      Agent_tools.record_background_notification (arg 0) (arg 1)
  | "pendingAgentNotifications" ->
      Agent_tools.pending_agent_notifications (arg 0)
  | "recordAgentChildSessionStart" ->
      Agent_tools.record_child_session_start (arg 0) (arg 1)
  | "recordAgentActiveToolsSnapshot" ->
      Agent_tools.record_active_tools_snapshot (arg 0) (arg 1)
  | "planAgentBridgeUpdate" -> Agent_tools.plan_bridge_update (arg 0)
  | "refreshAgentProfileCatalog" -> Agent_tools.refresh_profile_catalog (arg 0)
  | "handleCommand" ->
      Command_bridge.handle (string_arg args 0) (string_arg args 1) (arg 2)
  | "handleComposerCommand" -> Composer_commands.handle (string_arg args 0) (arg 1)
  | "planCommandNotification" ->
      Tool_catalog_bridge.plan_command_notification (Unsafe.coerce (arg 0)) (arg 1)
        (arg 2)
  | "planAgentsPrompt" -> Agent_tools.plan_agents_prompt (arg 0) (arg 1)
  | "finishAgentsPrompt" -> Agent_tools.finish_agents_prompt (arg 0) (arg 1) (arg 2)
  | "planAgentRunsPrompt" -> Agent_tools.plan_agent_runs_prompt (arg 0) (arg 1)
  | "finishAgentRunsPrompt" -> Agent_tools.finish_agent_runs_prompt (arg 0) (arg 1) (arg 2)
  | "planPermissionsPrompt" -> Permissions_commands.plan_prompt (arg 0) (arg 1)
  | "finishPermissionsPrompt" ->
      Permissions_commands.finish_prompt (arg 0) (arg 1) (arg 2)
  | "toolResultEnvelope" -> tool_result_envelope (arg 0)
  | "hostToolResult" -> host_tool_result (arg 0)
  | "toolResultToCommandResult" -> tool_result_to_command_result (arg 0)
  | "runThreadTool" -> Thread_bridge.run (string_arg args 0) (arg 1) (arg 2) (arg 3)
  | "planThreadCatalogScans" -> Thread_bridge.plan_catalog_scans (arg 0)
  | "currentThreadSource" -> Thread_bridge.current_source (arg 0)
  | "openAiUsageHostAuth" -> Usage_bridge.openai_host_auth ()
  | "openAiUsageHostParams" -> Usage_bridge.openai_host_params (arg 0)
  | "executeOpenAiUsage" -> Usage_bridge.execute_openai (arg 0) (arg 1)
  | "executeExa" -> Exa_bridge.execute (arg 0) (arg 1)
  | other -> failwith ("unknown Taumel core method: " ^ other)

let () =
  let exported =
    Unsafe.obj
      [|
        ("init", inject (Js.wrap_callback Footer_runtime.init));
        ("call", inject (Js.wrap_callback core_call));
      |]
  in
  Unsafe.set Unsafe.global "taumel" exported
