open Agents

let observe_announcement run =
  match run.run_announcement with
  | Pending when terminal_run_status run.run_status ->
      { run with run_announcement = Observed_by_agent_wait }
  | _ -> run

let mark_notification_sent state ~run_id =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run when not (terminal_run_status run.run_status) ->
      Error "notification requires a terminal run"
  | Some run when run.run_announcement = Observed_by_agent_wait -> Ok state
  | Some run ->
      let updated = { run with run_announcement = Notification_sent } in
      Ok { state with runs = replace_run updated state.runs }

let pending_notifications state ~owner_session_id =
  state.runs
  |> List.filter (fun run ->
         terminal_run_status run.run_status && run.run_announcement = Pending
         &&
         match find_identity state run.run_agent_id with
         | Some identity -> identity.identity_owner_session_id = owner_session_id
         | None -> false)

let completion_message identity run =
  Shared.encode_json
    (Shared.Object
       [
         ("event", Shared.String "agent_completion");
         ("agent_id", Shared.String identity.identity_agent_id);
         ("run_id", Shared.String run.run_id);
         ("kind", Shared.String (agent_kind_to_string identity.identity_kind));
         ("description", Shared.String run.run_description);
         ("status", Shared.String (run_status_to_string run.run_status));
         ( "next_action",
           Shared.Object
             [
               ("tool", Shared.String "agent_wait");
               ( "arguments",
                 Shared.Object
                   [
                     ("run_ids", Shared.Array [ Shared.String run.run_id ]);
                     ("timeout_seconds", Shared.Number 0.);
                   ] );
             ] );
       ])

let find_cleanup_pending state ~owner_session_id agent_id =
  List.find_opt
    (fun pending ->
      pending.cleanup_owner_session_id = owner_session_id
      && pending.cleanup_agent_id = agent_id)
    state.cleanup_pending

let owned_cleanup_pending state ~owner_session_id agent_id =
  match find_cleanup_pending state ~owner_session_id agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some pending -> Ok pending

let record_close state ~owner_session_id ~agent_id =
  match owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok identity ->
      Ok
        ( {
            identities = remove_identity identity.identity_agent_id state.identities;
            runs = remove_runs_for_agent identity.identity_agent_id state.runs;
            issued_identity_counts = state.issued_identity_counts;
            cleanup_pending = state.cleanup_pending;
          },
          identity )

let record_close_with_cleanup state ~owner_session_id ~agent_id ~cleanup_nonce
    ~remaining_artifacts =
  match owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok identity ->
      let pending =
        {
          cleanup_owner_session_id = owner_session_id;
          cleanup_agent_id = agent_id;
          cleanup_nonce;
          cleanup_remaining_artifacts = remaining_artifacts;
        }
      in
      let cleanup_pending =
        pending
        :: List.filter
             (fun item ->
               not
                 (item.cleanup_owner_session_id = owner_session_id
                 && item.cleanup_agent_id = agent_id))
             state.cleanup_pending
      in
      Ok
        ( {
            identities = remove_identity identity.identity_agent_id state.identities;
            runs = remove_runs_for_agent identity.identity_agent_id state.runs;
            issued_identity_counts = state.issued_identity_counts;
            cleanup_pending;
          },
          identity,
          pending )

let complete_cleanup state ~owner_session_id ~agent_id ~cleanup_nonce =
  match owned_cleanup_pending state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok pending when pending.cleanup_nonce <> cleanup_nonce ->
      Error ("cleanup nonce mismatch for agent: " ^ agent_id)
  | Ok _ ->
      Ok
        {
          state with
          cleanup_pending =
            List.filter
              (fun item ->
                not
                  (item.cleanup_owner_session_id = owner_session_id
                  && item.cleanup_agent_id = agent_id))
              state.cleanup_pending;
        }

let suspend_running_for_owner state ~now ~owner_session_id ~reason_code =
  let runs =
    List.map
      (fun run ->
        match find_identity state run.run_agent_id with
        | Some identity
          when identity.identity_owner_session_id = owner_session_id
               && run.run_status = Running -> (
            match suspend_run run ~now reason_code with
            | Ok updated -> updated
            | Error _ -> run)
        | _ -> run)
      state.runs
  in
  { state with runs }

let suspend_running_for_agent state ~now ~owner_session_id ~agent_id ~reason_code =
  match owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok _ ->
      let runs =
        List.map
          (fun run ->
            if run.run_agent_id = agent_id && run.run_status = Running then
              match suspend_run run ~now reason_code with
              | Ok updated -> updated
              | Error _ -> run
            else run)
          state.runs
      in
      Ok { state with runs }

let close_all_for_owner state ~owner_session_id =
  let closing = owned_identities state ~owner_session_id in
  let closing_ids = List.map (fun identity -> identity.identity_agent_id) closing in
  ( {
      identities =
        List.filter
          (fun identity -> not (List.mem identity.identity_agent_id closing_ids))
          state.identities;
      runs =
        List.filter
          (fun run -> not (List.mem run.run_agent_id closing_ids))
          state.runs;
      issued_identity_counts = state.issued_identity_counts;
      cleanup_pending = state.cleanup_pending;
    },
    closing )

let list_for_owner state ~owner_session_id =
  owned_identities state ~owner_session_id
  |> List.map (fun identity -> (identity, latest_run state identity.identity_agent_id))

let record_activity_event state ~run_id ~submission_id ~now ~event =
  match find_run state run_id with
  | None -> state
  | Some run
    when run.run_status <> Running || run.run_submission_id <> submission_id -> state
  | Some run ->
      let updated =
        match event with
        | Agent_start | Turn_start ->
            { run with run_activity_state = Reasoning }
        | Tool_execution_start ->
            { run with
              run_activity_state = Using_tool;
              run_active_tool_count = run.run_active_tool_count + 1;
              run_last_activity_at = Some now }
        | Tool_execution_update ->
            { run with
              run_activity_state = Using_tool;
              run_last_activity_at = Some now }
        | Tool_execution_end ->
            let active_tool_count = max 0 (run.run_active_tool_count - 1) in
            { run with
              run_activity_state = if active_tool_count = 0 then Reasoning else Using_tool;
              run_active_tool_count = active_tool_count;
              run_last_activity_at = Some now }
        | Turn_end ->
            { run with
              run_turn_count = run.run_turn_count + 1;
              run_last_activity_at = Some now;
              run_activity_state =
                if run.run_active_tool_count > 0 then Using_tool else Reasoning }
      in
      { state with runs = replace_run updated state.runs }

let reconcile_live_dispatches state ~owner_session_id ~live_agent_ids =
  let runs =
    List.map
      (fun run ->
        match find_identity state run.run_agent_id with
        | Some identity
          when identity.identity_owner_session_id = owner_session_id
               && run.run_status = Running
               && not (List.mem run.run_agent_id live_agent_ids) ->
            { run with run_activity_state = Orphaned }
        | _ -> run)
      state.runs
  in
  { state with runs }

let count_active_child_runs state ~owner_session_id =
  List.fold_left
    (fun count run ->
      match find_identity state run.run_agent_id with
      | Some identity
        when identity.identity_owner_session_id = owner_session_id
             && active_work_run_status run.run_status -> count + 1
      | _ -> count)
    0 state.runs
