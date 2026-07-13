open Agents

let wait_item_of_run identity run =
  {
    wait_agent_id = identity.identity_agent_id;
    wait_run_id = run.run_id;
    wait_kind = identity.identity_kind;
    wait_model = identity.identity_model;
    wait_thinking = identity.identity_thinking;
    wait_status = run.run_status;
    wait_reason_code = run.run_reason_code;
    wait_error = run.run_error;
    wait_output_available = run.run_output_available;
    wait_output =
      (match run.run_status with Completed -> run.run_final_output | _ -> None);
    wait_partial_output =
      (match run.run_status with
      | Failed | Cancelled | Lost -> run.run_partial_output
      | _ -> None);
    wait_started_at = run.run_started_at;
    wait_ended_at = run.run_ended_at;
  }

let validate_wait_selection state ~owner_session_id run_ids =
  match validate_unique_ids "run_ids" run_ids with
  | Error _ as error -> error
  | Ok () ->
      if run_ids = [] then Error "run_ids must not be empty"
      else
        let rec loop = function
          | [] -> Ok ()
          | run_id :: rest -> (
              match find_run state run_id with
              | None -> Error ("unknown run: " ^ run_id)
              | Some run -> (
                  match find_identity state run.run_agent_id with
                  | Some identity
                    when identity.identity_owner_session_id = owner_session_id ->
                      loop rest
                  | Some _ | None ->
                      Error ("run is not owned by this session: " ^ run_id)))
        in
        loop (List.map String.trim run_ids)

let wait_for_run_ids state ~owner_session_id run_ids =
  match validate_wait_selection state ~owner_session_id run_ids with
  | Error _ as error -> error
  | Ok () ->
      let state_ref = ref state in
      let items =
        List.filter_map
          (fun run_id ->
            match find_run !state_ref run_id with
            | None -> None
            | Some run when not (ready_wait_status run.run_status) -> None
            | Some run -> (
                match find_identity !state_ref run.run_agent_id with
                | None -> None
                | Some identity ->
                    let observed = observe_announcement run in
                    if observed != run then
                      state_ref :=
                        {
                          !state_ref with
                          runs = replace_run observed (!state_ref).runs;
                        };
                    Some (wait_item_of_run identity observed)))
          (List.map String.trim run_ids)
      in
      let pending =
        List.filter_map
          (fun run_id ->
            match find_run !state_ref run_id with
            | Some run when run.run_status = Running -> Some run.run_id
            | _ -> None)
          (List.map String.trim run_ids)
      in
      Ok
        {
          wait_state = !state_ref;
          wait_timed_out = false;
          wait_items = items;
          wait_pending_run_ids = pending;
        }

let timeout_wait_result state run_ids =
  {
    wait_state = state;
    wait_timed_out = true;
    wait_items = [];
    wait_pending_run_ids = List.map String.trim run_ids;
  }
