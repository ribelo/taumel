open Jsoo_bridge
open App_state
open Runtime_access
open Agent_tools

let record_child_session_start facts ctx =
  let facts = decode_ojs_contract Tool_contracts.RecordAgentChildSessionStartFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let agent_id = Tool_contracts.RecordAgentChildSessionStartFacts.get_agent_id facts in
  let child_session_id = Tool_contracts.RecordAgentChildSessionStartFacts.get_sessionId facts in
  let child_session_file = Tool_contracts.RecordAgentChildSessionStartFacts.get_sessionFile facts in
  match
    Taumel.Agents.record_child_session !agent_state ~agent_id ?child_session_id
      ?child_session_file ()
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let rollback_unaccepted_start facts ctx =
  let facts = decode_ojs_contract Tool_contracts.RollbackUnacceptedAgentStartFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let agent_id = Tool_contracts.RollbackUnacceptedAgentStartFacts.get_agent_id facts in
  let run_id = Tool_contracts.RollbackUnacceptedAgentStartFacts.get_run_id facts in
  let submission_id = Tool_contracts.RollbackUnacceptedAgentStartFacts.get_submission_id facts in
  match
    Taumel.Agents.rollback_unaccepted_spawn !agent_state
      ~owner_session_id:(owner_id ctx) ~agent_id ~run_id ~submission_id
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let rollback_send_preflight facts ctx =
  let facts = decode_ojs_contract Boundary_contracts.RollbackAgentSendPreflightFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let agent_id = Tool_contracts.RollbackAgentSendPreflightFacts.get_agent_id facts in
  let run_id = Tool_contracts.RollbackAgentSendPreflightFacts.get_run_id facts in
  let submission_id = Tool_contracts.RollbackAgentSendPreflightFacts.get_submission_id facts in
  let previous_submission_id = Tool_contracts.RollbackAgentSendPreflightFacts.get_previous_submission_id facts in
  let outcome =
    match Boundary_contracts.RollbackAgentSendPreflightFacts.get_outcome facts with
    | `V_message_sent -> Taumel.Agents.Message_sent
    | `V_interrupted_and_sent -> Interrupted_and_sent
    | `V_suspended -> Suspended_outcome
    | `V_already_suspended -> Already_suspended
    | `V_resumed -> Resumed
    | `V_started -> Started
    | `V_no_active_run -> No_active_run
  in
  let previous_reason_code =
    Option.map
      (function
        | `V_interrupted_by_parent -> Taumel.Agents.Interrupted_by_parent
        | `V_parent_shutdown -> Parent_shutdown
        | `V_process_interrupted -> Process_interrupted
        | `V_close_cleanup_failed -> Close_cleanup_failed)
      (Boundary_contracts.RollbackAgentSendPreflightFacts.get_previous_reason_code facts)
  in
  match
    Taumel.Agents.rollback_send_preflight !agent_state
      ~owner_session_id:(owner_id ctx) ~agent_id ~run_id ~submission_id
      ~outcome ~previous_submission_id ~previous_reason_code
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let record_send_dispatch_failure facts ctx =
  let facts = decode_ojs_contract Tool_contracts.RecordAgentSendDispatchFailureFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let run_id = Tool_contracts.RecordAgentSendDispatchFailureFacts.get_run_id facts in
  let submission_id = Tool_contracts.RecordAgentSendDispatchFailureFacts.get_submission_id facts in
  let error = Tool_contracts.RecordAgentSendDispatchFailureFacts.get_error facts in
  match
    Taumel.Agents.record_dispatch_failure !agent_state ~now:(now_seconds ())
      ~run_id ?error ?submission_id ()
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let rollback_failed_interruption facts ctx =
  let facts = decode_ojs_contract Tool_contracts.RollbackFailedAgentInterruptionFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let agent_id = Tool_contracts.RollbackFailedAgentInterruptionFacts.get_agent_id facts in
  let run_id = Tool_contracts.RollbackFailedAgentInterruptionFacts.get_run_id facts in
  match
    Taumel.Agents.rollback_failed_interruption !agent_state
      ~owner_session_id:(owner_id ctx) ~agent_id ~run_id
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let record_dispatch_completion facts ctx =
  let facts = decode_ojs_contract Tool_contracts.AgentDispatchCompletionFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let run_id = Tool_contracts.AgentDispatchCompletionFacts.get_run_id facts in
  let submission_id = Tool_contracts.AgentDispatchCompletionFacts.get_submission_id facts in
  let completion = Tool_contracts.AgentDispatchCompletionFacts.get_completion facts in
  let status =
    match Boundary_contracts.AgentDispatchCompletion.get_status completion with
    | `V_completed -> Taumel.Agents.Completed
    | `V_failed | `V_timed_out -> Taumel.Agents.Failed
    | `V_cancelled -> Taumel.Agents.Cancelled
  in
  let reason_code =
    match status with
    | Taumel.Agents.Failed -> Some Taumel.Agents.Agent_failed
    | Taumel.Agents.Cancelled -> Some Taumel.Agents.Host_cancelled
    | _ -> None
  in
  let final_output = Tool_contracts.AgentDispatchCompletion.get_finalOutput completion in
  let result_entry_id = Tool_contracts.AgentDispatchCompletion.get_resultEntryId completion in
  let error = Tool_contracts.AgentDispatchCompletion.get_reason completion in
  let now = now_seconds () in
  match
    match status with
    | Taumel.Agents.Completed ->
        Taumel.Agents.record_run_completion !agent_state ~now ~run_id
          ~status:Completed ?final_output ?result_entry_id ?submission_id ()
    | Taumel.Agents.Failed ->
        Taumel.Agents.record_run_completion !agent_state ~now ~run_id ~status:Failed
          ?reason_code ?error ?partial_output:final_output ?result_entry_id
          ?submission_id ()
    | Taumel.Agents.Cancelled ->
        Taumel.Agents.record_run_completion !agent_state ~now ~run_id
          ~status:Cancelled ?reason_code ?error ?partial_output:final_output
          ?result_entry_id ?submission_id ()
    | other ->
        Taumel.Agents.record_run_completion !agent_state ~now ~run_id ~status:other
          ?reason_code ?error ?partial_output:final_output ?result_entry_id
          ?submission_id ()
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

(* Activity events arrive per child turn/tool update; persisting every one
   rewrites the session several times per second and bloats it (measured:
   ~90% of a 186MB session's recent growth). Events are applied to the
   in-memory registry immediately and journaled; a parent/child projection
   swap that reloads an older persisted snapshot replays the journal, so
   observed activity is never lost. File persistence is coalesced to one
   append per 2s; terminal transitions still persist immediately via the
   completion path, so crash recovery loses only the last few seconds of
   activity bookkeeping, which the reconcile path already tolerates. *)
let last_activity_persist_at = ref 0

(* Trailing flush: leading-edge persistence alone would leave the last
   journal entries unpersisted until the next state transition. Schedule a
   one-shot timer so pending activity is persisted within ~2s even when no
   further events arrive. Contexts are tracked per owner (one global timer
   would starve other owners) and released once their journal drains, so a
   closed session is not retained. The timer is unref'd so it never keeps
   the process alive, and the flush is best-effort: on any failure the
   journal survives for the next persist or replay. *)
let activity_flush_scheduled = ref false
let activity_flush_contexts : (string * Unsafe.any) list ref = ref []

let flush_pending_activity () =
  activity_flush_scheduled := false;
  List.iter
    (fun (owner, ctx) ->
      if List.exists (fun entry -> entry.journal_owner = owner) !agent_activity_journal then
        try
          Session_sync.require_agent_owner ctx;
          save_agent_state ctx;
          last_activity_persist_at := now_milliseconds ()
        with _ -> ())
    !activity_flush_contexts;
  activity_flush_contexts :=
    List.filter
      (fun (owner, _) ->
        List.exists (fun entry -> entry.journal_owner = owner) !agent_activity_journal)
      !activity_flush_contexts

let schedule_activity_flush ctx =
  let owner = owner_id ctx in
  activity_flush_contexts :=
    (owner, ctx) :: List.remove_assoc owner !activity_flush_contexts;
  if not !activity_flush_scheduled then (
    activity_flush_scheduled := true;
    let timer =
      Unsafe.fun_call
        (Unsafe.get Unsafe.global "setTimeout")
        [| inject (Js.wrap_callback flush_pending_activity); js_number 2000.0 |]
    in
    match function_field timer "unref" with
    | Some _ -> ignore (call0 timer "unref")
    | None -> ())

let record_activity facts ctx =
  let facts = decode_ojs_contract Boundary_contracts.AgentActivityFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let run_id = Tool_contracts.AgentActivityFacts.get_run_id facts in
  let submission_id = Tool_contracts.AgentActivityFacts.get_submission_id facts in
  let event = match Boundary_contracts.AgentActivityFacts.get_event facts with
    | `V_agent_start -> Taumel.Agents.Agent_start | `V_turn_start -> Turn_start
    | `V_turn_end -> Turn_end | `V_tool_execution_start -> Tool_execution_start
    | `V_tool_execution_update -> Tool_execution_update
    | `V_tool_execution_end -> Tool_execution_end
  in
  let now = now_seconds () in
  let previous = !agent_state in
  let next =
    Taumel.Agent_registry.record_activity_event previous ~run_id ~submission_id
      ~now ~event
  in
  agent_state := next;
  if next != previous then (
    agent_activity_journal :=
      {
        journal_owner = owner_id ctx;
        journal_run_id = run_id;
        journal_submission_id = submission_id;
        journal_event = event;
        journal_now = now;
      }
      :: !agent_activity_journal;
    let now_ms = now_milliseconds () in
    if now_ms - !last_activity_persist_at >= 2000 then (
      last_activity_persist_at := now_ms;
      save_agent_state ctx)
    else schedule_activity_flush ctx);
  core_ack ()

let record_dispatch_boundary facts ctx =
  let facts = decode_ojs_contract Tool_contracts.AgentDispatchBoundaryFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let run_id = Tool_contracts.AgentDispatchBoundaryFacts.get_run_id facts in
  let submission_id = Tool_contracts.AgentDispatchBoundaryFacts.get_submission_id facts in
  let previous_assistant_entry_id = Tool_contracts.AgentDispatchBoundaryFacts.get_previous_assistant_entry_id facts in
  match
    Taumel.Agents.record_dispatch_boundary !agent_state ~run_id ~submission_id
      ~previous_assistant_entry_id
  with
  | Error message -> error_obj message
  | Ok next -> (
      match commit_agent_state ctx next with
      | Ok () -> core_ack ()
      | Error message -> error_obj message)

let reconcile_live_dispatches facts ctx =
  let facts = decode_ojs_contract Tool_contracts.LiveAgentDispatchesFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let live_agent_ids = Tool_contracts.LiveAgentDispatchesFacts.get_live_agent_ids facts in
  let next =
    Taumel.Agent_registry.reconcile_live_dispatches !agent_state
      ~owner_session_id:(owner_id ctx) ~live_agent_ids
  in
  if next = !agent_state then core_ack ()
  else
    match commit_agent_state ctx next with
    | Ok () -> core_ack ()
    | Error message -> error_obj message

let pending_agent_notifications ctx =
  Session_sync.require_agent_owner ctx;
  let owner = owner_id ctx in
  let pending =
    Taumel.Agent_registry.pending_notifications !agent_state ~owner_session_id:owner
    |> List.filter (fun (run : Taumel.Agents.agent_run) ->
           not (List.mem run.run_id !agent_notification_claims)
           && not (List.mem run.run_agent_id !agent_closing_ids))
  in
  agent_notification_claims :=
    List.fold_left
      (fun claims (run : Taumel.Agents.agent_run) -> run.run_id :: claims)
      !agent_notification_claims pending;
  let notifications =
    List.filter_map
      (fun (run : Taumel.Agents.agent_run) ->
        match Taumel.Agents.find_identity !agent_state run.run_agent_id with
        | None -> None
        | Some identity ->
            let details =
              Tool_contracts.AgentNotificationDetails.create
                ~notificationId:("agent_completion:" ^ run.run_id) ()
            in
            Some
              (Boundary_contracts.AgentNotification.create ~runId:run.run_id
                 ~content:(Taumel.Agent_registry.completion_message identity run)
                 ~details ()))
      pending
  in
  Tool_contracts.PendingAgentNotificationsResult.create ~notifications ()
  |> Tool_contracts.PendingAgentNotificationsResult.t_to_js |> inject

let record_background_notification facts ctx =
  let facts = decode_ojs_contract Tool_contracts.AgentRunIdFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let run_id = Tool_contracts.AgentRunIdFacts.get_run_id facts in
  let owned =
    match Taumel.Agents.find_run !agent_state run_id with
    | Some run -> (
        match Taumel.Agents.find_identity !agent_state run.run_agent_id with
        | Some identity -> identity.identity_owner_session_id = owner_id ctx
        | None -> false)
    | None -> false
  in
  match
    if owned then Taumel.Agent_registry.mark_notification_sent !agent_state ~run_id
    else Error ("unknown run: " ^ run_id)
  with
  | Error message -> error_obj message
  | Ok next ->
      agent_notification_claims :=
        List.filter (fun value -> value <> run_id) !agent_notification_claims;
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let release_background_notification facts =
  let facts = decode_ojs_contract Tool_contracts.AgentRunIdFacts.t_of_js (ojs_of_js facts) in
  let run_id = Tool_contracts.AgentRunIdFacts.get_run_id facts in
  agent_notification_claims :=
    List.filter (fun value -> value <> run_id) !agent_notification_claims;
  core_ack ()

let validate_background_notification_claim facts ctx =
  let facts = decode_ojs_contract Tool_contracts.AgentRunIdFacts.t_of_js (ojs_of_js facts) in
  Session_sync.require_agent_owner ctx;
  let run_id = Tool_contracts.AgentRunIdFacts.get_run_id facts in
  let valid =
    List.mem run_id !agent_notification_claims
    &&
    match Taumel.Agents.find_run !agent_state run_id with
    | Some run when run.run_announcement = Taumel.Agents.Pending -> (
        match Taumel.Agents.find_identity !agent_state run.run_agent_id with
        | Some identity -> identity.identity_owner_session_id = owner_id ctx
        | None -> false)
    | _ -> false
  in
  if not valid then
    agent_notification_claims :=
      List.filter (fun value -> value <> run_id) !agent_notification_claims;
  Tool_contracts.AgentNotificationClaimValidation.create ~valid ()
  |> Tool_contracts.AgentNotificationClaimValidation.t_to_js |> inject

let count_active_child_runs ctx =
  Session_sync.require_agent_owner ctx;
  let count =
    Taumel.Agent_registry.count_active_child_runs !agent_state ~owner_session_id:(owner_id ctx)
  in
  Tool_contracts.AgentActiveCountResult.create ~count:(float_of_int count) ()
  |> Tool_contracts.AgentActiveCountResult.t_to_js |> inject

let ephemeral_cleanup_plan ctx =
  Session_sync.require_agent_owner ctx;
  let agents =
    Taumel.Agents.owned_identities !agent_state
      ~owner_session_id:(owner_id ctx)
    |> List.map (fun (identity : Taumel.Agents.identity) ->
           Tool_contracts.AgentCleanupItem.create
             ~agentId:identity.identity_agent_id ())
  in
  Tool_contracts.AgentCleanupPlan.create ~agents ()
  |> Tool_contracts.AgentCleanupPlan.t_to_js |> inject

let manager_snapshot ctx =
  Session_sync.require_agent_owner ctx;
  let reconciled = Session_sync.reconcile_settled_runs !agent_state in
  if reconciled != !agent_state then (
    match commit_agent_state ctx reconciled with
    | Ok () -> ()
    | Error message -> failwith message);
  (match !agent_state_load_error with
  | Some message -> failwith ("agent state is unavailable: " ^ message)
  | None -> ());
  let owner = owner_id ctx in
  let identities = Taumel.Agents.owned_identities !agent_state ~owner_session_id:owner in
  let agents =
    List.map
      (fun (identity : Taumel.Agents.identity) ->
        let isolation = Taumel.Agents.identity_isolation identity in
        let effective_workspace =
          match Agent_worktree_host.effective_workspace_for_identity ~identity with
          | Ok (path, _) -> Some path
          | Error _ -> None
        in
        Tool_contracts.AgentManagerIdentity.create
          ~agentId:identity.identity_agent_id
          ~kind:(Boundary_contracts.AgentManagerIdentity.kind_to_contract
                   (match identity.identity_kind with
                   | Taumel.Agents.Generic -> `V_generic
                   | Finder -> `V_finder
                   | Oracle -> `V_oracle))
          ~model:identity.identity_model ~thinking:identity.identity_thinking
          ~workspace:(Taumel.Agents.identity_source_workspace identity)
          ?isolation:
            (Some
               (Boundary_contracts.AgentManagerIdentity.isolation_to_contract
                  (match isolation with
                  | Taumel.Agent_workspace.None -> `V_none
                  | Taumel.Agent_workspace.Worktree -> `V_worktree)))
          ?effectiveWorkspace:effective_workspace
          ~createdAt:(float_of_int identity.identity_created_at)
          ?childSessionFile:identity.identity_child_session_file
          ?tier:
            (Option.map
               (function
                 | Taumel.Agents.Low -> `V_low
                 | Taumel.Agents.Medium -> `V_medium
                 | Taumel.Agents.High -> `V_high)
               identity.identity_effort
            |> Option.map Boundary_contracts.AgentManagerIdentity.tier_to_contract)
          ())
      identities
  in
  let owned_ids = List.map (fun (identity : Taumel.Agents.identity) -> identity.identity_agent_id) identities in
  let runs =
    (!agent_state).runs
    |> List.filter (fun (run : Taumel.Agents.agent_run) -> List.mem run.run_agent_id owned_ids)
    |> List.map (fun (run : Taumel.Agents.agent_run) ->
           let activity =
             Boundary_contracts.AgentManagerRun.activity_state_to_contract
               (match run.run_activity_state with
               | Taumel.Agents.Starting -> `V_starting
               | Reasoning -> `V_reasoning
               | Using_tool -> `V_using_tool
               | Orphaned -> `V_orphaned
               | Inactive -> `V_inactive)
           in
           let recommendation =
             match (run.run_status, run.run_activity_state) with
             | Taumel.Agents.Running,
               (Taumel.Agents.Starting | Taumel.Agents.Reasoning | Taumel.Agents.Using_tool) -> `V_wait
             | Taumel.Agents.Running, Taumel.Agents.Orphaned -> `V_interrupt_or_close
             | (Taumel.Agents.Completed | Taumel.Agents.Failed | Taumel.Agents.Cancelled | Taumel.Agents.Lost),
               Taumel.Agents.Inactive -> `V_call_agent_wait
             | Taumel.Agents.Suspended, Taumel.Agents.Inactive -> `V_resume_or_close
             | _ -> invalid_arg "invalid agent status/activity combination"
           in
           Tool_contracts.AgentManagerRun.create ~runId:run.run_id
             ~agentId:run.run_agent_id
             ~status:(Boundary_contracts.AgentManagerRun.status_to_contract
                        (match run.run_status with
                        | Taumel.Agents.Running -> `V_running
                        | Suspended -> `V_suspended | Completed -> `V_completed
                        | Failed -> `V_failed | Cancelled -> `V_cancelled | Lost -> `V_lost))
             ?reasonCode:
               (Option.map
                  (fun reason ->
                    Boundary_contracts.AgentManagerRun.reason_code_to_contract
                      (match reason with
                      | Taumel.Agents.Interrupted_by_parent -> `V_interrupted_by_parent
                      | Parent_shutdown -> `V_parent_shutdown
                      | Process_interrupted -> `V_process_interrupted
                      | Close_cleanup_failed -> `V_close_cleanup_failed
                      | Host_cancelled -> `V_host_cancelled
                      | Dispatch_failed -> `V_dispatch_failed
                      | Agent_failed -> `V_agent_failed
                      | Internal_error -> `V_internal_error
                      | Child_session_lost -> `V_child_session_lost))
                  run.run_reason_code)
             ~startedAt:(float_of_int run.run_started_at)
             ?endedAt:(Option.map float_of_int run.run_ended_at)
             ?suspendedAt:(Option.map float_of_int run.run_suspended_at)
             ~description:run.run_description ~turnCount:(float_of_int run.run_turn_count)
             ?lastActivityAt:(Option.map float_of_int run.run_last_activity_at)
             ~activityState:activity
             ~recommendation:(Boundary_contracts.AgentManagerRun.recommendation_to_contract recommendation)
             ~submissionId:run.run_submission_id
             ?error:run.run_error
             ~announcement:(Boundary_contracts.AgentManagerRun.announcement_to_contract
                              (match run.run_announcement with
                              | Taumel.Agents.Pending -> `V_pending
                              | Observed_by_agent_wait -> `V_observed_by_agent_wait
                              | Notification_sent -> `V_notification_sent)) ())
  in
  Tool_contracts.AgentManagerSnapshot.create ~agents ~runs ()
  |> Tool_contracts.AgentManagerSnapshot.t_to_js |> inject

let finish_ephemeral_cleanup ctx =
  Session_sync.require_agent_owner ctx;
  match !agent_state_load_error with
  | Some message -> error_obj ("agent state is unavailable: " ^ message)
  | None ->
      let owner = owner_id ctx in
      match Agent_ephemeral_cleanup.acquire ~owner_session_id:owner with
      | Error error ->
          error_obj
            ("cleanup_failed: "
            ^ Agent_ephemeral_cleanup.lease_error_message error)
      | Ok _lease ->
      let previous = !agent_state in
      let previous_claims = !agent_notification_claims in
      let identities =
        Taumel.Agents.owned_identities !agent_state ~owner_session_id:owner
      in
      let existing_pending =
        (!agent_state).cleanup_pending
        |> List.filter (fun item ->
               item.Taumel.Agents.cleanup_owner_session_id = owner)
      in
      let unstage_all staged_items =
        Agent_child_session_host.unstage_private_sessions
          (List.map snd staged_items)
      in
      let rec stage_all acc = function
        | [] -> Ok (List.rev acc)
        | identity :: rest -> (
            match
              Agent_child_session_host.recover_uncommitted_envelope_for_identity
                ~identity
            with
            | Error message -> Error message
            | Ok _ -> (
                match
                  Agent_child_session_host.authorized_private_session ~identity
                with
                | Error message -> Error message
                | Ok authorized -> (
                    match
                      Agent_child_session_host.stage_authorized_private_session
                        ~ephemeral:true ~identity authorized
                    with
                    | Error message -> (
                        match unstage_all (List.rev acc) with
                        | Ok () -> Error message
                        | Error unstage_message ->
                            Error
                              (message ^ "; unstage failed: " ^ unstage_message))
                    | Ok staged -> stage_all ((identity, staged) :: acc) rest)))
      in
      let rec tombstone state pending_acc = function
        | [] -> Ok (state, List.rev pending_acc)
        | (identity, staged) :: rest -> (
            match Agent_child_session_host.staged_cleanup_nonce staged with
            | None -> (
                match
                  Taumel.Agent_registry.record_close state ~owner_session_id:owner
                    ~agent_id:identity.Taumel.Agents.identity_agent_id
                with
                | Error message -> Error message
                | Ok (next, _) -> tombstone next pending_acc rest)
            | Some cleanup_nonce -> (
                match
                  Taumel.Agent_registry.record_close_with_cleanup state
                    ~owner_session_id:owner
                    ~agent_id:identity.Taumel.Agents.identity_agent_id
                    ~cleanup_nonce ~remaining_artifacts:[ "private_session" ]
                with
                | Error message -> Error message
                | Ok (next, _identity, pending_item) ->
                    tombstone next (pending_item :: pending_acc) rest))
      in
      let finalize_pending state pending_items =
        List.fold_left
          (fun result pending_item ->
            match result with
            | Error _ as error -> error
            | Ok current -> (
                match
                  Agent_child_session_host.finalize_cleanup_pending pending_item
                with
                | Error message -> Error message
                | Ok () -> (
                    ignore
                      (Agent_child_session_host.remove_cleanup_journal_record
                         ~owner_session_id:pending_item.cleanup_owner_session_id
                         ~agent_id:pending_item.cleanup_agent_id
                         ~cleanup_nonce:pending_item.cleanup_nonce);
                    Taumel.Agent_registry.complete_cleanup current
                      ~owner_session_id:pending_item.cleanup_owner_session_id
                      ~agent_id:pending_item.cleanup_agent_id
                      ~cleanup_nonce:pending_item.cleanup_nonce)))
          (Ok state) pending_items
      in
      match stage_all [] identities with
      | Error message -> error_obj ("cleanup_failed: " ^ message)
      | Ok staged_items -> (
          match tombstone !agent_state [] staged_items with
          | Error message -> (
              match unstage_all staged_items with
              | Ok () -> error_obj ("cleanup_failed: " ^ message)
              | Error unstage_message ->
                  error_obj
                    ("cleanup_failed: " ^ message ^ "; unstage failed: "
                   ^ unstage_message))
          | Ok (tombstoned_state, new_pending) ->
              agent_state := tombstoned_state;
              agent_notification_claims := [];
              try
                save_agent_state ctx;
                (* Journal only after tombstones are committed. Ephemeral state is
                   not restart-durable, so a journal failure must not strand the
                   already staged envelopes: finish them directly while their
                   in-process cleanup authority is still available. *)
                let journal_error =
                  match
                    Agent_child_session_host.append_cleanup_journal_records
                      new_pending
                  with
                  | Ok () -> None
                  | Error message -> Some message
                in
                let all_pending = existing_pending @ new_pending in
                (match finalize_pending !agent_state all_pending with
                | Error message -> (
                    match journal_error with
                    | None -> error_obj ("cleanup_failed: " ^ message)
                    | Some journal_message ->
                        error_obj
                          ("cleanup_failed: cleanup journal publication failed: "
                         ^ journal_message
                         ^ "; cleanup finalization failed: " ^ message))
                | Ok completed ->
                    agent_state := completed;
                    try
                      save_agent_state ctx;
                      core_ack ()
                    with error ->
                      error_obj
                        ("agent state persistence failed: "
                       ^ Printexc.to_string error))
              with error ->
                agent_state := previous;
                agent_notification_claims := previous_claims;
                let unstage_error =
                  match unstage_all staged_items with
                  | Ok () -> None
                  | Error message -> Some message
                in
                let restore_error =
                  try
                    save_agent_state ctx;
                    None
                  with restore_exn -> Some (Printexc.to_string restore_exn)
                in
                error_obj
                  (Agent_child_session_host.restore_failure_detail
                     ~primary:
                       ("agent state persistence failed: "
                      ^ Printexc.to_string error)
                     ~unstage_error ~restore_error))

let release_ephemeral_cleanup_lease ctx =
  match
    try
      Session_sync.require_agent_owner ctx;
      Ok ()
    with error -> Error (Printexc.to_string error)
  with
  | Error _ ->
      (* Ownership unprovable: fail closed and retain the lease. *)
      core_ack ()
  | Ok () -> (
      let owner = owner_id ctx in
      if
        !agent_state_load_error <> None
        || Taumel.Agents.owned_identities !agent_state ~owner_session_id:owner <> []
      then
        (* A failed shutdown may have restored usable identities. Retain the
           lifetime lease until process death so deferred markers cannot be
           promoted while those identities remain live. *)
        core_ack ()
      else
        match Agent_ephemeral_cleanup.release_owner owner with
        | Ok () -> core_ack ()
        | Error message -> error_obj ("cleanup_failed: " ^ message))

let suspend_owner_on_shutdown ctx =
  Session_sync.require_agent_owner ctx;
  match !agent_state_load_error with
  | Some message -> error_obj ("agent state is unavailable: " ^ message)
  | None ->
      let owner = owner_id ctx in
      let next =
        Taumel.Agent_registry.suspend_running_for_owner !agent_state
          ~now:(now_seconds ()) ~owner_session_id:owner
          ~reason_code:Taumel.Agents.Parent_shutdown
      in
      agent_state := next;
      save_agent_state ctx;
      core_ack ()

let finish_wait raw_facts ctx =
  let facts = decode_ojs_contract Tool_contracts.FinishAgentWaitFacts.t_of_js (ojs_of_js raw_facts) in
  Session_sync.require_agent_owner ctx;
  let run_ids = Tool_contracts.FinishAgentWaitFacts.get_run_ids facts in
  match
    Taumel.Agent_wait.wait_for_run_ids !agent_state ~owner_session_id:(owner_id ctx)
      run_ids
  with
  | Error message -> error_obj message
  | Ok wait ->
      agent_state := wait.wait_state;
      save_agent_state ctx;
      prepare_wait raw_facts ctx

let command_result ?(details = Unsafe.obj [||]) message =
  Boundary_contracts.GatewayCommandResult.create ~ok:true ~message
    ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details)) ()
  |> Tool_contracts.GatewayCommandResult.t_to_js |> inject

let agent_identity_line (identity : Taumel.Agents.identity) latest =
  let status =
    match latest with
    | None -> "no runs"
    | Some (run : Taumel.Agents.agent_run) ->
        Taumel.Agents.run_status_to_string run.run_status
  in
  Printf.sprintf "%s [%s] %s thinking=%s workspace=%s latest=%s"
    identity.identity_agent_id
    (Taumel.Agents.agent_kind_to_string identity.identity_kind)
    identity.identity_model identity.identity_thinking
    (Taumel.Agents.identity_source_workspace identity)
    status

let agent_runs_summary owner_id =
  match Taumel.Agent_registry.list_for_owner !agent_state ~owner_session_id:owner_id with
  | [] -> "No agents."
  | items ->
      String.concat "\n"
        (List.map (fun (identity, latest) -> agent_identity_line identity latest) items)

let stop_active_run state ~now ~owner_session_id ~agent_id =
  match Taumel.Agents.owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok _ -> (
      match Taumel.Agents.active_or_suspended_run state agent_id with
      | Some run when run.run_status = Taumel.Agents.Running -> (
          match
            Taumel.Agents.record_send state ~now ~owner_session_id ~agent_id
              ~interrupt:true ""
          with
          | Error _ as error -> error
          | Ok delivery ->
              Ok (delivery.delivery_state, true, run.run_id))
      | Some run when run.run_status = Taumel.Agents.Suspended ->
          Ok (state, false, run.run_id)
      | _ -> Ok (state, false, ""))

let handle_agent_runs_command args ctx =
  Session_sync.require_agent_owner ctx;
  match !agent_state_load_error with
  | Some message -> error_obj ("agent state is unavailable: " ^ message)
  | None ->
  let command, rest = Command_util.split_command args in
  let owner = owner_id ctx in
  match command with
  | "" | "list" -> command_result (agent_runs_summary owner)
  | "stop" -> (
      let target = String.trim rest in
      if target = "" then error_obj "usage: /agent-runs stop <agent-id>"
      else
        match stop_active_run !agent_state ~now:(now_seconds ()) ~owner_session_id:owner ~agent_id:target with
        | Error message -> error_obj message
        | Ok (next, changed, run_id) ->
            agent_state := next;
            save_agent_state ctx;
            let details =
              Unsafe.obj
                [|
                  ("agent_id", js_string target);
                  ("changed", js_bool changed);
                  ("run_id", js_string run_id);
                  ( "childSessionUpdates",
                    js_array
                       (if changed then
                         [
                           Tool_contracts.AgentChildSessionUpdate.create
                                ~action:
                                  (Boundary_contracts.AgentChildSessionUpdate.action_to_contract
                                     `V_stop_child_session)
                                ~key:target ~reason:"interrupted_by_parent" ()
                             |> Tool_contracts.AgentChildSessionUpdate.t_to_js
                             |> inject;
                         ]
                       else []) );
                |]
            in
            command_result ~details
              (if changed then "Stopped " ^ target ^ "."
               else "No active run for " ^ target ^ "."))
  | "close" ->
      error_obj "agent close requires manager confirmation"
  | "output" -> (
      let target = String.trim rest in
      if target = "" then error_obj "usage: /agent-runs output <agent-id|run-id>"
      else
        let run =
          match Taumel.Agents.find_run !agent_state target with
          | Some run -> (
              match Taumel.Agents.find_identity !agent_state run.run_agent_id with
              | Some identity when identity.identity_owner_session_id = owner ->
                  Ok run
              | _ -> Error ("run is not owned by this session: " ^ target))
          | None -> (
              match Taumel.Agents.owned_identity !agent_state ~owner_session_id:owner target with
              | Error _ as error -> error
              | Ok _ -> (
                  match Taumel.Agents.latest_run !agent_state target with
                  | None -> Error ("agent has no runs: " ^ target)
                  | Some run -> Ok run))
        in
        match run with
        | Error message -> error_obj message
        | Ok selected_run ->
            agent_state :=
              recover_selected_outputs !agent_state [ selected_run.run_id ];
            let run =
              Option.value
                (Taumel.Agents.find_run !agent_state selected_run.run_id)
                ~default:selected_run
            in
            let output =
              match (run.run_final_output, run.run_partial_output) with
              | Some text, _ when String.trim text <> "" -> text
              | _, Some text when String.trim text <> "" -> text
              | _ ->
                  Printf.sprintf "No final output for %s [%s]." run.run_id
                    (Taumel.Agents.run_status_to_string run.run_status)
            in
            let text, truncated, path =
              truncate_output ~owner_session_id:owner
                ~agent_id:run.run_agent_id ~run_id:run.run_id
                output
            in
            let details =
              Unsafe.obj
                [|
                  ("run_id", js_string run.run_id);
                  ("agent_id", js_string run.run_agent_id);
                  ("status", js_run_status run.run_status);
                  ("truncated", js_bool truncated);
                  ("full_output_path", option_string path);
                |]
            in
            command_result ~details text)
  | _ ->
      error_obj
        "usage: /agent-runs [list|stop <agent-id>|close <agent-id>|output <agent-id|run-id>]"
