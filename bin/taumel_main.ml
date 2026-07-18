open Jsoo_bridge

let arg_at args index =
  if index < Array.length args then args.(index) else Unsafe.inject Js.undefined

let string_arg args index =
  match string_value (arg_at args index) with
  | Some value -> value
  | None ->
      invalid_arg
        (Printf.sprintf "core.call argument %d: expected string" index)

let int_arg args index =
  match float_value (arg_at args index) with
  | Some value
    when Float.is_finite value && Float.floor value = value
         && value >= float_of_int min_int && value <= float_of_int max_int ->
      int_of_float value
  | _ ->
      invalid_arg
        (Printf.sprintf "core.call argument %d: expected integer" index)

let core_call name_js args_js =
  let name =
    match string_value (inject name_js) with
    | Some value -> value
    | None -> invalid_arg "core.call name: expected string"
  in
  let args =
    match array_value args_js with
    | Some value -> value
    | None -> invalid_arg "core.call arguments: expected array"
  in
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
   | "planChildSessionStart" ->
       Child_session_bridge.plan_child_session_start (arg 0) (arg 1)
  | "planChildDispatch" -> Child_session_bridge.plan_child_dispatch (arg 0)
  | "planChildPermissionRefresh" ->
      Child_session_bridge.plan_permission_refresh (arg 0) (arg 1) (arg 2)
  | "prepareTool" -> Tool_dispatch.prepare (arg 0)
   | "applyPatchToFiles" ->
       Mutation_tools.apply_patch_to_files (arg 0)
   | "applyEditToFile" -> Mutation_tools.apply_edit_to_file (arg 0)
  | "planExecHostCall" ->
      Sandbox_bridge.plan_exec_host_call (arg 0) (arg 1)
  | "formatExecResult" ->
      Sandbox_bridge.format_exec_result (arg 0) (arg 1) (arg 2) (arg 3)
   | "planExecApprovalPrompt" ->
       Sandbox_bridge.plan_exec_approval_prompt (arg 0)
  | "finishExecApproval" -> Sandbox_bridge.finish_exec_approval (arg 0)
  | "discardAuthorityPlan" -> Sandbox_bridge.discard_authority_plan (arg 0)
  | "reissueExecPlan" -> Sandbox_bridge.reissue_exec_plan (arg 0)
  | "planWriteStdinHostCall" ->
      Sandbox_bridge.plan_write_stdin_host_call (arg 0) (arg 1)
  | "runExecCommand" ->
      Exec_session.run_exec_command (arg 0) (string_arg args 1) (arg 2)
        (arg 3)
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
  | "updateFooterThinking" ->
      Footer_runtime.update_thinking (string_arg args 0) (arg 1)
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
      let facts =
        decode_ojs_contract Tool_contracts.FinalizeGoalErrorFacts.t_of_js
          (ojs_of_js (arg 0))
      in
      Goal_tools.finalize_error
        (Tool_contracts.FinalizeGoalErrorFacts.get_status facts)
        (Tool_contracts.FinalizeGoalErrorFacts.get_ctx facts
        |> Ts2ocaml.unknown_to_js |> js_of_ojs);
      core_ack ()
  | "planCommandChildSession" -> Command_bridge.plan_child_session (arg 0)
  | "planCommandChildDispatch" -> Command_bridge.plan_child_dispatch (arg 0)
  | "finishCommandChildDispatch" -> Command_bridge.finish_child_dispatch (arg 0)
  | "persistRalphControllerState" -> Ralph_tools.persist_controller_state (arg 0)
  | "recordAgentChildSessionStartAuthorized" ->
      Agent_lifecycle.record_child_session_start_authorized (arg 0) (arg 1)
        (Agent_tools.agent_owner_context (arg 2))
  | "agentRoutingDiagnostics" -> Agent_tools.routing_diagnostics ()
  | "rollbackUnacceptedAgentStart" ->
      Agent_lifecycle.rollback_unaccepted_start (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "rollbackAgentSendPreflight" ->
      Agent_lifecycle.rollback_send_preflight (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "recordAgentSendDispatchFailure" ->
      Agent_lifecycle.record_send_dispatch_failure (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "rollbackFailedAgentInterruption" ->
      Agent_lifecycle.rollback_failed_interruption (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "recordAgentDispatchCompletion" ->
      Agent_lifecycle.record_dispatch_completion (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "recordAgentActivity" ->
      Agent_lifecycle.record_activity (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "recordAgentDispatchBoundaryAuthorized" ->
      Agent_lifecycle.record_dispatch_boundary_authorized (arg 0) (arg 1)
        (Agent_tools.agent_owner_context (arg 2))
  | "reconcileLiveAgentDispatches" ->
      Agent_lifecycle.reconcile_live_dispatches (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "pendingAgentNotifications" ->
      Agent_lifecycle.pending_agent_notifications
        (Agent_tools.agent_owner_context (arg 0))
  | "recordAgentBackgroundNotification" ->
      Agent_lifecycle.record_background_notification (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "releaseAgentBackgroundNotification" ->
      Agent_lifecycle.release_background_notification (arg 0)
  | "validateAgentBackgroundNotificationClaim" ->
      Agent_lifecycle.validate_background_notification_claim (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "countActiveChildRuns" ->
      Agent_lifecycle.count_active_child_runs
        (Agent_tools.agent_owner_context (arg 0))
  | "ephemeralAgentCleanupPlan" ->
      Agent_lifecycle.ephemeral_cleanup_plan
        (Agent_tools.agent_owner_context (arg 0))
  | "agentManagerSnapshot" ->
      Agent_lifecycle.manager_snapshot (Agent_tools.agent_owner_context (arg 0))
  | "finishEphemeralAgentCleanup" ->
      Agent_lifecycle.finish_ephemeral_cleanup
        (Agent_tools.agent_owner_context (arg 0))
  | "releaseEphemeralAgentCleanupLease" ->
      Agent_lifecycle.release_ephemeral_cleanup_lease
        (Agent_tools.agent_owner_context (arg 0))
  | "suspendOwnerAgentsOnShutdown" ->
      Agent_lifecycle.suspend_owner_on_shutdown
        (Agent_tools.agent_owner_context (arg 0))
  | "finishAgentWait" ->
      Agent_lifecycle.finish_wait (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "finishAgentClose" ->
      Agent_tools.finish_close (arg 0) (Agent_tools.agent_owner_context (arg 1))
  | "claimAgentAction" -> Agent_action_capability.claim (arg 0)
  | "revalidateAgentAction" -> Agent_action_capability.revalidate (arg 0)
  | "ratchetAgentAction" -> Agent_action_capability.ratchet (arg 0)
  | "authorizeAgentActionCleanup" ->
      Agent_action_capability.authorize_cleanup (arg 0)
  | "prepareAgentCloseStop" -> Agent_action_capability.prepare_close_stop (arg 0)
  | "completeAgentCloseStop" -> Agent_action_capability.complete_close_stop (arg 0)
  | "releaseAgentAction" -> Agent_action_capability.release (arg 0)
  | "acceptAgentWorktreeStart" ->
      Agent_tools.accept_worktree_start (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "rollbackAgentWorktreeStart" ->
      Agent_tools.rollback_worktree_start (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "deleteAgentWorktree" ->
      Agent_tools.delete_worktree (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "reconcileProvisionalAgentWorktrees" -> Agent_tools.reconcile_provisional_worktrees ()
  | "cancelAgentBrokerSessions" ->
      let facts =
        decode_ojs_contract Tool_contracts.AgentIdFacts.t_of_js
          (ojs_of_js (arg 0))
      in
      let agent_id = Tool_contracts.AgentIdFacts.get_agent_id facts in
      let clean = Exec_session.cancel_broker_sessions_for_agent agent_id in
      if clean then core_ack ()
      else error_obj "cleanup_failed: could not terminate identity-owned broker sessions"
  | "deleteAgentChildSession" ->
      Agent_tools.delete_child_session (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
  | "recordAgentCloseCleanupFailure" ->
      Agent_tools.record_close_cleanup_failure (arg 0)
        (Agent_tools.agent_owner_context (arg 1))
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
	      let owner = Session_store.session_id_from_ctx (arg 0) in
	      if !(App_state.loaded_session_id) <> Some owner then
	        incr App_state.owner_session_epoch;
	      App_state.loaded_session_id := Some owner;
      core_ack ()
   | "planCronPrompt" -> Cron_tools.plan_prompt (arg 0)
  | "finishCronPrompt" -> Cron_tools.finish_prompt (arg 0) (arg 1) (arg 2)
   | "planPermissionsPrompt" -> Permissions_commands.plan_prompt (arg 0)
  | "finishPermissionsPrompt" ->
       Permissions_commands.finish_prompt (arg 0)
  | "toolResultEnvelope" ->
      let facts =
        decode_ojs_contract Tool_contracts.ToolResultConstructionFacts.t_of_js
          (ojs_of_js (arg 0))
      in
      let prepared = Tool_contracts.ToolResultConstructionFacts.get_prepared facts in
      let extra = Tool_contracts.ToolResultConstructionFacts.get_extraDetails facts in
      let error = Tool_contracts.ToolResultConstructionFacts.get_error facts in
      let text = Tool_contracts.ToolResultConstructionFacts.get_text facts in
      let details = Tool_contracts.ToolResultConstructionFacts.get_details facts in
      (match (prepared, extra, error, text, details) with
      | Some _, Some _, None, None, None
      | None, None, Some _, None, _
      | None, None, None, Some _, _ -> ()
      | _ -> invalid_arg "tool result construction facts select exactly one branch");
      tool_result_envelope
        (Tool_contracts.ToolResultConstructionFacts.t_to_js facts |> js_of_ojs)
  | "hostToolResult" ->
      let facts =
        decode_ojs_contract Tool_contracts.HostToolResultFacts.t_of_js
          (ojs_of_js (arg 0))
      in
      host_tool_result (Tool_contracts.HostToolResultFacts.t_to_js facts |> js_of_ojs)
  | "toolResultToCommandResult" -> tool_result_to_command_result (arg 0)
   | "runThreadTool" -> Thread_bridge.run (arg 0)
  | "planThreadCatalogScans" -> Thread_bridge.plan_catalog_scans (arg 0)
  | "openAiUsageHostAuth" -> Usage_bridge.openai_host_auth ()
  | "openAiUsageHostParams" -> Usage_bridge.openai_host_params (arg 0)
  | "executeOpenAiUsage" -> Usage_bridge.execute_openai (arg 0) (arg 1)
   | "executeExa" -> Exa_bridge.execute (arg 0)
  | "approveExaPlan" -> Exa_bridge.approve_plan (arg 0)
  | other -> failwith ("unknown Taumel core method: " ^ other)

let initialized_core : Unsafe.any option ref = ref None

let initialize host =
  match !initialized_core with
  | Some _ when Footer_runtime.active_extension_is_live () ->
      failwith "Taumel core is already initialized"
  | Some core ->
      Footer_runtime.init host;
      core
  | None ->
      Footer_runtime.init host;
      let core = Unsafe.obj [| ("call", inject (Js.wrap_callback core_call)) |] in
      initialized_core := Some core;
      core

let () =
  let exported =
    Unsafe.obj [| ("init", inject (Js.wrap_callback initialize)) |]
  in
  Unsafe.set Unsafe.global "taumel" exported
