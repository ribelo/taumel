type profile_toggle = {
  toggle_profile : string;
  toggle_enabled : bool;
}

type run_status =
  | Run_queued
  | Run_running
  | Run_suspended
  | Run_completed
  | Run_failed
  | Run_cancelled
  | Run_timed_out
  | Run_lost

type submission = {
  submission_id : string;
  submission_kind : string;
  submission_created_at : int;
}

type agent_identity = {
  identity_agent_id : string;
  identity_parent_session_id : string;
  identity_profile_name : string;
  identity_child_session_id : string option;
  identity_profile_snapshot : Capability_profile.t option;
  identity_sandbox_snapshot : Sandbox.config option;
  identity_system_prompt : string;
  identity_active_tools : string list option;
  identity_created_at : int;
  identity_closed_at : int option;
}

type agent_run = {
  run_id : string;
  run_agent_id : string;
  run_initial_submission_kind : string;
  run_submissions : submission list;
  run_status : run_status;
  run_reason : string option;
  run_final_output : string option;
  run_output_available : bool;
  run_consumed : bool;
  run_background_notified : bool;
  run_created_at : int;
  run_started_at : int option;
  run_completed_at : int option;
}

type session_state = {
  profile_toggles : profile_toggle list;
  identities : agent_identity list;
  runs : agent_run list;
}

type submission_delivery = {
  delivery_state : session_state;
  delivery_run_id : string;
  delivery_submission_id : string;
  delivery_kind : string;
  delivery_previous_status : run_status option;
}

let dispatch_deliver_as_for_delivery_kind = function
  | "steered" | "interrupted" -> "steer"
  | _ -> "followUp"

type wait_selector =
  | Wait_all_active
  | Wait_run_ids of string list
  | Wait_agent_ids of string list

type wait_item = {
  wait_agent_id : string;
  wait_run_id : string option;
  wait_status : string;
  wait_final_output : string option;
  wait_error : string option;
  wait_output_available : bool;
  wait_consumed : bool;
  wait_background_notified : bool;
}

type wait_result = {
  wait_state : session_state;
  wait_items : wait_item list;
  wait_message : string;
  wait_active_run_ids : string list;
}

let empty_session_state = { profile_toggles = []; identities = []; runs = [] }

let run_status_to_string = function
  | Run_queued -> "queued"
  | Run_running -> "running"
  | Run_suspended -> "suspended"
  | Run_completed -> "completed"
  | Run_failed -> "failed"
  | Run_cancelled -> "cancelled"
  | Run_timed_out -> "timed_out"
  | Run_lost -> "lost"

let run_status_of_string = function
  | "queued" -> Ok Run_queued
  | "running" -> Ok Run_running
  | "suspended" -> Ok Run_suspended
  | "completed" -> Ok Run_completed
  | "failed" -> Ok Run_failed
  | "cancelled" -> Ok Run_cancelled
  | "timed_out" -> Ok Run_timed_out
  | "lost" -> Ok Run_lost
  | value -> Error ("invalid agent run status: " ^ value)

let active_run_status = function
  | Run_queued | Run_running | Run_suspended -> true
  | Run_completed | Run_failed | Run_cancelled | Run_timed_out | Run_lost -> false

let active_work_run_status = function
  | Run_queued | Run_running -> true
  | Run_suspended | Run_completed | Run_failed | Run_cancelled | Run_timed_out
  | Run_lost ->
      false

let identity_open identity = identity.identity_closed_at = None

let find_identity state agent_id =
  let agent_id = String.trim agent_id in
  List.find_opt
    (fun identity -> identity.identity_agent_id = agent_id)
    state.identities

let agent_id_used state agent_id = find_identity state agent_id <> None

let default_agent_id ?(scope = "") state profile_name =
  let prefix = Subagents.sanitize_agent_id_prefix profile_name in
  let seed =
    Subagents.stable_hash
      (prefix ^ ":" ^ scope ^ ":" ^ string_of_int (List.length state.identities)
     ^ ":" ^ string_of_int (List.length state.runs))
  in
  let rec loop attempt =
    let suffix = Subagents.generated_agent_id_suffix (seed + attempt) in
    let candidate = prefix ^ "-" ^ suffix in
    if agent_id_used state candidate then loop (attempt + 1) else candidate
  in
  loop 0

let replace_identity updated identities =
  List.map
    (fun identity ->
      if identity.identity_agent_id = updated.identity_agent_id then updated
      else identity)
    identities

let replace_run updated runs =
  List.map
    (fun run -> if run.run_id = updated.run_id then updated else run)
    runs

let runs_for_agent state agent_id =
  List.filter (fun run -> run.run_agent_id = agent_id) state.runs

let find_run state run_id =
  let run_id = String.trim run_id in
  List.find_opt (fun run -> run.run_id = run_id) state.runs

let latest_run state agent_id =
  match runs_for_agent state agent_id with
  | [] -> None
  | first :: rest ->
      Some
        (List.fold_left
           (fun latest run ->
             if run.run_created_at > latest.run_created_at then run else latest)
           first rest)

let active_run state agent_id =
  runs_for_agent state agent_id
  |> List.find_opt (fun run -> active_run_status run.run_status)

let terminal_run run =
  match run.run_status with
  | Run_completed | Run_failed | Run_cancelled | Run_timed_out | Run_lost -> true
  | Run_queued | Run_running | Run_suspended -> false

let next_run_id state agent_id =
  let count = List.length (runs_for_agent state agent_id) + 1 in
  agent_id ^ "-run-" ^ string_of_int count

let submission_id run_id index =
  run_id ^ "-submission-" ^ string_of_int index

let append_submission run now kind =
  let next_index = List.length run.run_submissions + 1 in
  let submission =
    {
      submission_id = submission_id run.run_id next_index;
      submission_kind = kind;
      submission_created_at = now;
    }
  in
  ({ run with run_submissions = run.run_submissions @ [ submission ] }, submission)

let create_run ~now ~agent_id kind =
  let run_id = agent_id ^ "-run-1" in
  let submission =
    {
      submission_id = submission_id run_id 1;
      submission_kind = kind;
      submission_created_at = now;
    }
  in
  ( {
      run_id;
      run_agent_id = agent_id;
      run_initial_submission_kind = kind;
      run_submissions = [ submission ];
      run_status = Run_running;
      run_reason = None;
      run_final_output = None;
      run_output_available = false;
      run_consumed = false;
      run_background_notified = false;
      run_created_at = now;
      run_started_at = Some now;
      run_completed_at = None;
    },
    submission )

let create_next_run state ~now ~agent_id kind =
  let run_id = next_run_id state agent_id in
  let submission =
    {
      submission_id = submission_id run_id 1;
      submission_kind = kind;
      submission_created_at = now;
    }
  in
  ( {
      run_id;
      run_agent_id = agent_id;
      run_initial_submission_kind = kind;
      run_submissions = [ submission ];
      run_status = Run_running;
      run_reason = None;
      run_final_output = None;
      run_output_available = false;
      run_consumed = false;
      run_background_notified = false;
      run_created_at = now;
      run_started_at = Some now;
      run_completed_at = None;
    },
    submission )

let record_spawn state ~now ~parent_session_id ~agent_id ~profile_name
    ?profile_snapshot ?sandbox_snapshot ?(system_prompt = "")
    ?(create_goal = false) _objective =
  match Subagents.validate_agent_id agent_id with
  | Error _ as error -> error
  | Ok agent_id ->
  if agent_id_used state agent_id then
    Error ("agent id was already used in this session: " ^ agent_id)
  else
    let identity =
      {
        identity_agent_id = agent_id;
        identity_parent_session_id = parent_session_id;
        identity_profile_name = profile_name;
        identity_child_session_id = None;
        identity_profile_snapshot = profile_snapshot;
        identity_sandbox_snapshot = sandbox_snapshot;
        identity_system_prompt = system_prompt;
        identity_active_tools = None;
        identity_created_at = now;
        identity_closed_at = None;
      }
    in
    let run, submission =
      create_run ~now ~agent_id (if create_goal then "objective" else "message")
    in
    let state =
      {
        state with
        identities = identity :: state.identities;
        runs = run :: state.runs;
      }
    in
    Ok
      {
        delivery_state = state;
        delivery_run_id = run.run_id;
        delivery_submission_id = submission.submission_id;
        delivery_kind = "started";
        delivery_previous_status = None;
      }

let record_active_tools_snapshot state ~agent_id ~active_tools ?model_id () =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity ->
      let profile_snapshot =
        match (identity.identity_profile_snapshot, model_id) with
        | Some profile, Some model_id -> Some { profile with model_id }
        | snapshot, None -> snapshot
        | None, Some _ -> None
      in
      let updated =
        {
          identity with
          identity_profile_snapshot = profile_snapshot;
          identity_active_tools = Some active_tools;
        }
      in
      Ok { state with identities = replace_identity updated state.identities }

let record_send ?(interrupt = false) state ~now ~agent_id message =
  let message = String.trim message in
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity when not (identity_open identity) ->
      Error ("cannot send to a closed agent: " ^ agent_id)
  | Some _ -> (
      match active_run state agent_id with
      | Some run when interrupt && message = "" ->
          let previous_status = run.run_status in
          let suspended =
            {
              run with
              run_status = Run_suspended;
              run_reason = Some "interrupted_by_parent";
              run_completed_at = None;
            }
          in
          Ok
            {
              delivery_state =
                { state with runs = replace_run suspended state.runs };
              delivery_run_id = suspended.run_id;
              delivery_submission_id = "";
              delivery_kind = "suspended";
              delivery_previous_status = Some previous_status;
            }
      | Some run when run.run_status = Run_suspended ->
          let previous_status = run.run_status in
          let updated, submission = append_submission run now "message" in
          let updated =
            {
              updated with
              run_status = Run_running;
              run_reason = None;
              run_started_at = Some now;
            }
          in
          let state = { state with runs = replace_run updated state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = updated.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "resumed";
              delivery_previous_status = Some previous_status;
            }
      | Some run when interrupt ->
          let previous_status = run.run_status in
          let updated, submission = append_submission run now "message" in
          let state = { state with runs = replace_run updated state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = updated.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "interrupted";
              delivery_previous_status = Some previous_status;
            }
      | Some run ->
          let previous_status = run.run_status in
          let updated, submission = append_submission run now "message" in
          let state = { state with runs = replace_run updated state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = updated.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "steered";
              delivery_previous_status = Some previous_status;
            }
      | None when interrupt && message = "" ->
          Ok
            {
              delivery_state = state;
              delivery_run_id = "";
              delivery_submission_id = "";
              delivery_kind = "no_active_run";
              delivery_previous_status = None;
            }
      | None ->
          let run, submission =
            create_next_run state ~now ~agent_id "message"
          in
          let state = { state with runs = run :: state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = run.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "started";
              delivery_previous_status = None;
            })

let record_child_session_start state ~agent_id ?child_session_id ?active_tools ()
    =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity ->
      let updated =
        {
          identity with
          identity_child_session_id = child_session_id;
          identity_active_tools =
            (match active_tools with
            | Some tools -> Some tools
            | None -> identity.identity_active_tools);
        }
      in
      Ok { state with identities = replace_identity updated state.identities }

let worker_of_identity_snapshot ~(owner : Subagents.owner) identity =
  if identity.identity_parent_session_id <> owner.id then
    Error ("agent is not owned by this session: " ^ identity.identity_agent_id)
  else if not (identity_open identity) then
    Error ("cannot send to a closed agent: " ^ identity.identity_agent_id)
  else if owner.depth >= 1 then Error "nested agent limit reached"
  else
    match
      ( identity.identity_profile_snapshot,
        identity.identity_sandbox_snapshot,
        identity.identity_active_tools,
        Shared.trim_non_empty identity.identity_system_prompt )
    with
    | Some profile, Some sandbox, Some active_tools, Some system_prompt
      when sandbox.workspace_roots <> [] ->
        Ok
          {
            Subagents.id = identity.identity_agent_id;
            Subagents.parent_id = Some owner.id;
            Subagents.definition_name = identity.identity_profile_name;
            Subagents.profile = profile;
            Subagents.system_prompt;
            Subagents.active_tools_snapshot = Some active_tools;
            Subagents.sandbox = sandbox;
            Subagents.depth = owner.depth + 1;
            Subagents.lifecycle = Subagents.Running;
          }
    | _ -> Error "identity_snapshot_incomplete"

let cancel_active_run ~now reason run =
  if active_run_status run.run_status then
    {
      run with
      run_status = Run_cancelled;
      run_reason = Some reason;
      run_completed_at = Some now;
    }
  else run

let record_close state ~now ~agent_id =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity ->
      let closed =
        match identity.identity_closed_at with
        | Some _ -> identity
        | None -> { identity with identity_closed_at = Some now }
      in
      let runs =
        List.map
          (fun run ->
            if run.run_agent_id = agent_id then
              cancel_active_run ~now "closed_by_parent" run
            else run)
          state.runs
      in
      Ok
        {
          state with
          identities = replace_identity closed state.identities;
          runs;
        }

let record_close_all state ~now ~parent_session_id =
  let closing_ids =
    state.identities
    |> List.filter (fun identity ->
           identity.identity_parent_session_id = parent_session_id
           && identity.identity_closed_at = None)
    |> List.map (fun identity -> identity.identity_agent_id)
  in
  let identities =
    List.map
      (fun identity ->
        if List.mem identity.identity_agent_id closing_ids then
          { identity with identity_closed_at = Some now }
        else identity)
      state.identities
  in
  let runs =
    List.map
      (fun run ->
        if List.mem run.run_agent_id closing_ids then
          cancel_active_run ~now "closed_by_parent" run
        else run)
      state.runs
  in
  ({ state with identities; runs }, closing_ids <> [])

let cancel_run_with_reason ~now reason run =
  if active_run_status run.run_status then
    ( {
        run with
        run_status = Run_cancelled;
        run_reason = Some reason;
        run_completed_at = Some now;
      },
      true )
  else (run, false)

let record_stop_run state ~now ~run_id =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run ->
      let updated, changed = cancel_run_with_reason ~now "stopped_by_parent" run in
      Ok ({ state with runs = replace_run updated state.runs }, changed)

let record_stop_agent state ~now ~agent_id =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity when not (identity_open identity) ->
      Error ("cannot stop a closed agent: " ^ agent_id)
  | Some _ -> (
      match active_run state agent_id with
      | None -> Ok (state, false)
      | Some run ->
          let updated, changed =
            cancel_run_with_reason ~now "stopped_by_parent" run
          in
          Ok ({ state with runs = replace_run updated state.runs }, changed))

let record_stop_all state ~now ~parent_session_id =
  let changed = ref false in
  let runs =
    List.map
      (fun run ->
        match find_identity state run.run_agent_id with
        | Some identity
          when identity.identity_parent_session_id = parent_session_id
               && identity_open identity ->
            let updated, run_changed =
              cancel_run_with_reason ~now "stopped_by_parent" run
            in
            if run_changed then changed := true;
            updated
        | _ -> run)
      state.runs
  in
  ({ state with runs }, !changed)

let record_run_completion state ~now ~run_id ~status ?reason ?final_output () =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run ->
      if active_run_status status then
        Error "completion status must be terminal"
      else
        let updated =
          {
            run with
            run_status = status;
            run_reason = reason;
            run_final_output = final_output;
            run_output_available = true;
            run_background_notified = false;
            run_completed_at = Some now;
          }
        in
        Ok { state with runs = replace_run updated state.runs }

let record_background_notification state ~run_id =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run when active_run_status run.run_status ->
      Error "background notification requires a terminal run"
  | Some run ->
      let updated = { run with run_background_notified = true } in
      Ok { state with runs = replace_run updated state.runs }

let run_owned_by_parent state ~parent_session_id run =
  match find_identity state run.run_agent_id with
  | Some identity -> identity.identity_parent_session_id = parent_session_id
  | None -> false

(* Count active (queued or running, not suspended) child runs owned by the
   given parent session. Used for noninteractive drain: when the main agent
   ends a turn in print/JSON mode, the TS host keeps the turn alive while
   this count is > 0 (sub-ni01). *)
let count_active_child_runs state ~parent_session_id =
  List.fold_left
    (fun count run ->
      match find_identity state run.run_agent_id with
      | Some identity when identity.identity_parent_session_id = parent_session_id ->
          if active_work_run_status run.run_status then count + 1 else count
      | _ -> count)
    0 state.runs

let output_run_for_target state ~parent_session_id target =
  let target = String.trim target in
  if target = "" then Error "agent-runs output target is required"
  else
    match find_run state target with
    | Some run when run_owned_by_parent state ~parent_session_id run -> Ok run
    | Some run ->
        Error ("run is not owned by this session: " ^ run.run_id)
    | None -> (
        match find_identity state target with
        | Some identity when identity.identity_parent_session_id = parent_session_id -> (
            match latest_run state target with
            | Some run -> Ok run
            | None -> Error ("agent has no runs: " ^ target))
        | Some _ -> Error ("agent is not owned by this session: " ^ target)
        | None -> Error ("unknown agent or run: " ^ target))

let mark_active_runs_lost ?(live_agent_ids = []) state =
  let runs =
    List.map
      (fun run ->
        if
          active_run_status run.run_status
          && not (List.mem run.run_agent_id live_agent_ids)
        then
          {
            run with
            run_status = Run_lost;
            run_reason = Some "process_resumed_without_live_worker";
          }
        else run)
      state.runs
  in
  let identities =
    List.map
      (fun identity ->
        if List.mem identity.identity_agent_id live_agent_ids then identity
        else { identity with identity_child_session_id = None })
      state.identities
  in
  { state with identities; runs }

let consume_run_if_terminal run =
  if terminal_run run then { run with run_consumed = true } else run

let wait_item_of_run run =
  {
    wait_agent_id = run.run_agent_id;
    wait_run_id = Some run.run_id;
    wait_status = run_status_to_string run.run_status;
    wait_final_output = run.run_final_output;
    wait_error = run.run_reason;
    wait_output_available =
      ((not (terminal_run run)) || run.run_output_available);
    wait_consumed = run.run_consumed;
    wait_background_notified = run.run_background_notified;
  }

let already_consumed_wait_item run =
  {
    wait_agent_id = run.run_agent_id;
    wait_run_id = Some run.run_id;
    wait_status = "already_consumed";
    wait_final_output = None;
    wait_error = None;
    wait_output_available = false;
    wait_consumed = true;
    wait_background_notified = run.run_background_notified;
  }

let no_active_wait_item agent_id =
  {
    wait_agent_id = agent_id;
    wait_run_id = None;
    wait_status = "no_active_run";
    wait_final_output = None;
    wait_error = None;
    wait_output_available = false;
    wait_consumed = false;
    wait_background_notified = false;
  }

let no_deliverable_wait_item agent_id =
  { (no_active_wait_item agent_id) with wait_status = "no_deliverable_run" }

let unknown_run_wait_item run_id =
  {
    wait_agent_id = "";
    wait_run_id = Some run_id;
    wait_status = "not_found";
    wait_final_output = None;
    wait_error = Some ("run not found: " ^ run_id);
    wait_output_available = false;
    wait_consumed = false;
    wait_background_notified = false;
  }

let not_owned_run_wait_item run_id =
  {
    wait_agent_id = "";
    wait_run_id = Some run_id;
    wait_status = "not_owned";
    wait_final_output = None;
    wait_error = None;
    wait_output_available = false;
    wait_consumed = false;
    wait_background_notified = false;
  }

let wait_item_message item =
  let summary =
    match item.wait_run_id with
    | None -> item.wait_agent_id ^ " [no_active_run]"
    | Some run_id ->
        let agent =
          if item.wait_agent_id = "" then "" else item.wait_agent_id ^ " "
        in
        agent ^ run_id ^ " [" ^ item.wait_status ^ "]"
  in
  match item.wait_final_output with
  | None -> summary
  | Some output -> summary ^ "\n\n" ^ output

let wait_message items =
  match items with
  | [] -> "No active runs."
  | items -> String.concat "\n\n" (List.map wait_item_message items)

let active_wait_run_ids items =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | item :: rest -> (
        match (item.wait_run_id, run_status_of_string item.wait_status) with
        | Some run_id, Ok status
          when active_work_run_status status && not (List.mem run_id seen) ->
            loop (run_id :: seen) (run_id :: acc) rest
        | _ -> loop seen acc rest)
  in
  loop [] [] items

let wait_result state items =
  {
    wait_state = state;
    wait_items = items;
    wait_message = wait_message items;
    wait_active_run_ids = active_wait_run_ids items;
  }

let wait_for_selector state ~parent_session_id selector =
  let owned_open_run run =
    match find_identity state run.run_agent_id with
    | Some identity ->
        identity.identity_parent_session_id = parent_session_id
        && identity_open identity
    | None -> false
  in
  let select_default_wait_runs () =
    state.runs
     |> List.filter (fun run ->
            owned_open_run run
            && (active_work_run_status run.run_status
               || ((not run.run_consumed) && terminal_run run)))
  in
  match selector with
  | Wait_all_active ->
      let state_ref = ref state in
      let items =
        List.map
          (fun run ->
            let consumed = consume_run_if_terminal run in
            if consumed != run then
              state_ref :=
                {
                  !state_ref with
                  runs = replace_run consumed (!state_ref).runs;
                };
            wait_item_of_run consumed)
          (select_default_wait_runs ())
      in
      wait_result !state_ref items
  | Wait_agent_ids agent_ids ->
      let state_ref = ref state in
      let items =
        List.map
          (fun agent_id ->
            match find_identity !state_ref agent_id with
            | Some identity
              when identity.identity_parent_session_id = parent_session_id -> (
                match active_run !state_ref agent_id with
                | Some run -> wait_item_of_run run
                | None -> (
                    match
                      runs_for_agent !state_ref agent_id
                      |> List.find_opt (fun run ->
                             terminal_run run && not run.run_consumed)
                    with
                    | None -> no_deliverable_wait_item agent_id
                    | Some run ->
                        let consumed = consume_run_if_terminal run in
                        if consumed != run then
                          state_ref :=
                            {
                              !state_ref with
                              runs = replace_run consumed (!state_ref).runs;
                            };
                        wait_item_of_run consumed))
            | Some _ ->
                {
                  (no_active_wait_item agent_id) with
                  wait_status = "not_owned";
                  wait_error = Some ("agent is not owned by this session: " ^ agent_id);
                }
            | None ->
                {
                  (no_active_wait_item agent_id) with
                  wait_status = "unknown_agent";
                  wait_error = Some ("unknown agent: " ^ agent_id);
                })
          agent_ids
      in
      wait_result !state_ref items
  | Wait_run_ids run_ids ->
      let state_ref = ref state in
      let items =
        List.map
          (fun run_id ->
            match find_run !state_ref run_id with
            | None -> unknown_run_wait_item run_id
            | Some run -> (
                match find_identity !state_ref run.run_agent_id with
                | Some identity
                  when identity.identity_parent_session_id = parent_session_id ->
                    let already_consumed = terminal_run run && run.run_consumed in
                    let readback =
                      if already_consumed then run else consume_run_if_terminal run
                    in
                    if readback != run then
                      state_ref :=
                        {
                          !state_ref with
                          runs = replace_run readback (!state_ref).runs;
                        };
                    if already_consumed then already_consumed_wait_item run
                    else wait_item_of_run readback
                | Some _ | None -> not_owned_run_wait_item run_id))
          run_ids
      in
      wait_result !state_ref items

let profile_enabled state name =
  match
    List.find_opt
      (fun toggle -> toggle.toggle_profile = name)
      state.profile_toggles
  with
  | Some toggle -> toggle.toggle_enabled
  | None -> true

let profile_exists catalog name = Agent_profiles.find_profile_spec catalog name <> None

let set_profile_enabled ?(catalog = Agent_profiles.default_profile_catalog) state name enabled =
  let name = String.trim name in
  if name = "" then Error "profile name is required"
  else if not (profile_exists catalog name) then
    Error ("unknown agent profile: " ^ name)
  else
    let rec loop replaced acc = function
      | [] ->
          let acc =
            if replaced then acc
            else { toggle_profile = name; toggle_enabled = enabled } :: acc
          in
          Ok { state with profile_toggles = List.rev acc }
      | toggle :: rest when toggle.toggle_profile = name ->
          loop true
            ({ toggle_profile = name; toggle_enabled = enabled } :: acc)
            rest
      | toggle :: rest -> loop replaced (toggle :: acc) rest
    in
    loop false [] state.profile_toggles
