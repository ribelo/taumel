open Jsoo_bridge

let arg_at args index =
  if index < Array.length args then args.(index) else Unsafe.inject Js.undefined

let string_arg args index =
  Js.to_string (Unsafe.coerce (arg_at args index))

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
   | "planActiveToolsSync" -> Tool_catalog_bridge.plan_active_tools_sync_js (arg 0)
  | "planEnvironmentContext" ->
      Environment_context_bridge.plan_context (arg 0) (arg 1)
  | "resolveSkillMentions" -> Skill_tools.resolve_mentions (arg 0)
  | "listSkills" -> Skill_tools.list_skills (arg 0)
   | "planCompactionModelCommand" ->
       Compaction_model_bridge.plan_command (arg 0)
  | "planSessionBeforeCompact" ->
       Compaction_model_bridge.plan_session_before_compact (arg 0)
  | "refreshExecPolicy" -> Exec_policy_bridge.compile_settings (arg 0)
   | "appendExecPolicyAllowRule" ->
       Exec_policy_bridge.append_allow_rule (arg 0)
  | "sandboxMetadataDirNames" -> Sandbox_bridge.sandbox_metadata_dir_names ()
  | "validateWorkspaceMutationPaths" ->
      Sandbox_bridge.validate_workspace_mutation_paths (arg 0)
  | "sandboxHostPathPlan" -> Sandbox_bridge.sandbox_host_path_plan (arg 0)
   | "planChildSessionStart" -> Child_session_bridge.plan_child_session_start (arg 0)
  | "planChildDispatch" -> Child_session_bridge.plan_child_dispatch (arg 0)
  | "prepareTool" -> Tool_dispatch.prepare (arg 0)
   | "applyPatchToFiles" ->
       Mutation_tools.apply_patch_to_files (arg 0)
   | "applyEditToFile" -> Mutation_tools.apply_edit_to_file (arg 0)
  | "planExecHostCall" ->
      Sandbox_bridge.plan_exec_host_call (arg 0) (arg 1) (arg 2) (arg 3)
  | "formatExecResult" ->
      Sandbox_bridge.format_exec_result (arg 0) (arg 1) (arg 2) (arg 3)
   | "planExecApprovalPrompt" ->
       Sandbox_bridge.plan_exec_approval_prompt (arg 0)
  | "finishExecApproval" -> Sandbox_bridge.finish_exec_approval (arg 0)
  | "planWriteStdinHostCall" ->
      Sandbox_bridge.plan_write_stdin_host_call (arg 0) (arg 1)
  | "runExecCommand" ->
      Exec_session.run_exec_command (arg 0) (arg 1) (arg 2)
        (string_arg args 3) (arg 4) (arg 5)
   | "writeExecStdin" ->
       Exec_session.write_stdin (arg 0)
   | "readFile" -> Read_tool.read_file (arg 0)
   | "viewMedia" -> View_media_tool.view_media (arg 0)
  | "shutdownExecOwner" -> Exec_session.shutdown_owner (string_arg args 0)
  | "pendingExecNotifications" ->
      Exec_session.pending_exec_notifications (string_arg args 0)
  | "claimExecNotificationDelivery" ->
      Exec_session.claim_exec_notification_delivery (string_arg args 0)
        (int_arg args 1)
  | "releaseExecNotificationDelivery" ->
      Exec_session.release_exec_notification_delivery (int_arg args 0)
  | "markExecNotificationDelivered" ->
      Exec_session.mark_exec_notification_delivered (int_arg args 0)
  | "awaitExecCompletion" ->
      Exec_session.await_exec_completion (int_arg args 0)
   | "planCommandExecution" ->
       Command_bridge.plan_execution (arg 0)
   | "planGoalContinuation" ->
       Goal_tools.plan_continuation (arg 0)
   | "rollbackGoalCommand" -> Goal_tools.rollback_goal_command (arg 0)
   | "cronPoll" -> Cron_tools.poll (arg 0)
   | "cronDelivered" -> Cron_tools.delivered (arg 0)
  | "cronGoalFacts" -> Cron_tools.goal_facts (arg 0)
  | "createCronGoal" -> Goal_tools.create_from_cron (arg 0)
   | "cronStartup" -> Cron_tools.startup (arg 0)
  | "cronUpdateTask" -> Cron_tools.update_task (arg 0)
  | "handleCronManagerCommand" -> Cron_tools.handle_manager_command (arg 0)
  | "refreshFooterState" -> Footer_runtime.refresh_state (arg 0)
  | "planChildGoalContinuation" ->
      Goal_tools.plan_child_goal_continuation (arg 0)
  | "startGoalTurn" ->
      Session_sync.start_goal_turn ();
      core_ack ()
  | "goalClockPauseStart" ->
      Session_sync.goal_clock_pause_start ();
      core_ack ()
  | "goalClockPauseEnd" ->
      Session_sync.goal_clock_pause_end ();
      core_ack ()
  | "interruptGoalAutomation" ->
      Session_sync.interrupt_goal_automation (arg 0);
      core_ack ()
  | "clearInterruptedGoalAutomation" ->
      Session_sync.clear_interrupted_goal_automation (arg 0);
      core_ack ()
  | "finalizeGoalError" ->
      let facts = arg 0 in
      Goal_tools.finalize_error (get_string facts "status")
        (Unsafe.get facts "ctx");
      core_ack ()
  | "planCommandChildSession" -> Command_bridge.plan_child_session (arg 0)
  | "planCommandChildDispatch" -> Command_bridge.plan_child_dispatch (arg 0)
  | "finishCommandChildDispatch" -> Command_bridge.finish_child_dispatch (arg 0)
  | "recordAgentChildSessionStart" -> Agent_lifecycle.record_child_session_start (arg 0) (arg 1)
  | "agentRoutingDiagnostics" -> Agent_tools.routing_diagnostics ()
  | "rollbackUnacceptedAgentStart" ->
      Agent_lifecycle.rollback_unaccepted_start (arg 0) (arg 1)
  | "rollbackAgentSendPreflight" ->
      Agent_lifecycle.rollback_send_preflight (arg 0) (arg 1)
  | "recordAgentSendDispatchFailure" ->
      Agent_lifecycle.record_send_dispatch_failure (arg 0) (arg 1)
  | "rollbackFailedAgentInterruption" ->
      Agent_lifecycle.rollback_failed_interruption (arg 0) (arg 1)
  | "recordAgentDispatchCompletion" -> Agent_lifecycle.record_dispatch_completion (arg 0) (arg 1)
  | "recordAgentActivity" -> Agent_lifecycle.record_activity (arg 0) (arg 1)
  | "recordAgentDispatchBoundary" -> Agent_lifecycle.record_dispatch_boundary (arg 0) (arg 1)
  | "reconcileLiveAgentDispatches" -> Agent_lifecycle.reconcile_live_dispatches (arg 0) (arg 1)
  | "pendingAgentNotifications" -> Agent_lifecycle.pending_agent_notifications (arg 0)
  | "recordAgentBackgroundNotification" -> Agent_lifecycle.record_background_notification (arg 0) (arg 1)
  | "releaseAgentBackgroundNotification" ->
      Agent_lifecycle.release_background_notification (arg 0)
  | "validateAgentBackgroundNotificationClaim" ->
      Agent_lifecycle.validate_background_notification_claim (arg 0) (arg 1)
  | "countActiveChildRuns" -> Agent_lifecycle.count_active_child_runs (arg 0)
  | "ephemeralAgentCleanupPlan" -> Agent_lifecycle.ephemeral_cleanup_plan (arg 0)
  | "agentManagerSnapshot" -> Agent_lifecycle.manager_snapshot (arg 0)
  | "finishEphemeralAgentCleanup" -> Agent_lifecycle.finish_ephemeral_cleanup (arg 0)
  | "suspendOwnerAgentsOnShutdown" -> Agent_lifecycle.suspend_owner_on_shutdown (arg 0)
  | "finishAgentWait" -> Agent_lifecycle.finish_wait (arg 0) (arg 1)
  | "finishAgentClose" -> Agent_tools.finish_close (arg 0) (arg 1)
  | "releaseAgentClose" -> Agent_tools.release_close (arg 0)
  | "handleCommand" -> Command_bridge.handle (arg 0)
  | "handleComposerCommand" -> Composer_commands.handle (arg 0)
   | "planCommandNotification" ->
       Tool_catalog_bridge.plan_command_notification (arg 0)
   | "visibilityRows" -> Visibility_commands.rows (arg 0)
   | "visibilitySaveProjectPlan" -> Visibility_commands.save_project_plan (arg 0)
   | "visibilityListCommand" -> Visibility_commands.list_command (arg 0)
   | "toggleVisibilityRow" -> Visibility_commands.toggle_row (arg 0)
  | "visibilityWarnings" -> Visibility_commands.warnings (arg 0)
  | "reloadSessionState" ->
      Session_sync.load_session_state (arg 0);
      App_state.loaded_session_id := Some (Session_store.session_id_from_ctx (arg 0));
      core_ack ()
   | "planCronPrompt" -> Cron_tools.plan_prompt (arg 0)
  | "finishCronPrompt" -> Cron_tools.finish_prompt (arg 0) (arg 1) (arg 2)
   | "planPermissionsPrompt" -> Permissions_commands.plan_prompt (arg 0)
  | "finishPermissionsPrompt" ->
       Permissions_commands.finish_prompt (arg 0)
  | "toolResultEnvelope" -> tool_result_envelope (arg 0)
  | "hostToolResult" -> host_tool_result (arg 0)
  | "toolResultToCommandResult" -> tool_result_to_command_result (arg 0)
   | "runThreadTool" -> Thread_bridge.run (arg 0)
  | "planThreadCatalogScans" -> Thread_bridge.plan_catalog_scans (arg 0)
  | "openAiUsageHostAuth" -> Usage_bridge.openai_host_auth ()
  | "openAiUsageHostParams" -> Usage_bridge.openai_host_params (arg 0)
  | "executeOpenAiUsage" -> Usage_bridge.execute_openai (arg 0) (arg 1)
   | "executeExa" -> Exa_bridge.execute (arg 0)
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
