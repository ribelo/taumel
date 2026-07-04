open Jsoo_bridge
open App_state
open Agent_render

let dispatch_failure_reason dispatch =
  if has_property dispatch "dispatched" && not (get_bool dispatch "dispatched")
  then
    Some
      (Option.value
         (Option.bind (optional_string_field dispatch "reason")
            Taumel.Shared.trim_non_empty)
         ~default:"child dispatch did not start")
  else None

let record_dispatch_start_failure prepared dispatch ctx =
  match (Taumel.Shared.trim_non_empty (get_string prepared "run_id"), dispatch_failure_reason dispatch) with
  | Some run_id, Some reason -> (
      Session_sync.load_agent_state ctx;
      match
        Taumel.Agent_runs.record_run_completion !agent_state
          ~now:(now_seconds ()) ~run_id ~status:Taumel.Agent_runs.Run_failed
          ~reason ()
      with
      | Ok state ->
          agent_state := state;
          Session_sync.save_agent_state ctx;
          Unsafe.obj
            [|
              ("ok", js_bool false);
              ("dispatchFailed", js_bool true);
              ("status", js_string "failed");
              ("error", js_string reason);
            |]
      | Error message ->
          Unsafe.obj
            [|
              ("ok", js_bool false);
              ("dispatchFailed", js_bool true);
              ("status", js_string "failed");
              ("error", js_string reason);
              ("stateError", js_string message);
            |])
  | _ -> Unsafe.obj [||]

let finish_action params ctx =
  let prepared = Unsafe.get params "prepared" in
  let action = get_string prepared "action" in
  let dispatch = Unsafe.get params "dispatch" in
  let dispatch_failure_extra =
    record_dispatch_start_failure prepared dispatch ctx
  in
  let dispatch_extra =
    merge_js_details
      (Unsafe.obj [| ("dispatch", dispatch) |])
      dispatch_failure_extra
  in
  let extra =
    match action with
    | "agent_spawn" ->
        let bridge_details =
          Child_session_bridge.child_bridge_details (Unsafe.get params "bridge")
        in
        merge_js_details bridge_details dispatch_extra
    | "agent_send" -> dispatch_extra
    | _ -> Unsafe.obj [||]
  in
  prepared_tool_result_with_extra prepared extra

let completion_status completion =
  match optional_string_field completion "status" with
  | Some "failed" -> Taumel.Agent_runs.Run_failed
  | Some "cancelled" | Some "aborted" -> Taumel.Agent_runs.Run_cancelled
  | Some "timed_out" -> Taumel.Agent_runs.Run_timed_out
  | _ -> Taumel.Agent_runs.Run_completed

let agent_completion_message run status ?reason ?final_output () =
  let profile =
    match Taumel.Agent_runs.find_identity !agent_state run.Taumel.Agent_runs.run_agent_id with
    | Some identity -> identity.identity_profile_name
    | None -> "unknown"
  in
  let status = Taumel.Agent_runs.run_status_to_string status in
  let block =
    match (final_output, reason) with
    | Some output, _ ->
        [ "  <final_output>"; output; "  </final_output>" ]
    | None, Some reason -> [ "  <error>"; reason; "  </error>" ]
    | None, None -> []
  in
  String.concat "\n"
    ([
       "<taumel_notification kind=\"agent_completion\" severity=\"info\">";
       Printf.sprintf "  <agent id=\"%s\" profile=\"%s\" />"
         (xml_attr run.run_agent_id) (xml_attr profile);
       Printf.sprintf "  <run id=\"%s\" status=\"%s\" />"
         (xml_attr run.run_id) (xml_attr status);
     ]
    @ block
    @ [ "</taumel_notification>" ])

let latest_submission_id (run : Taumel.Agent_runs.agent_run) =
  match List.rev run.run_submissions with
  | submission :: _ -> Some submission.submission_id
  | [] -> None

let run_with_completion_payload run ?reason ?final_output () =
  {
    run with
    Taumel.Agent_runs.run_reason =
      (match reason with
      | Some _ -> reason
      | None -> run.Taumel.Agent_runs.run_reason);
    run_final_output =
      (match final_output with
      | Some _ -> final_output
      | None -> run.run_final_output);
    run_output_available = true;
  }

let merge_volatile_run_fields ~from run =
  {
    run with
    Taumel.Agent_runs.run_reason =
      (match run.Taumel.Agent_runs.run_reason with
      | Some _ -> run.run_reason
      | None -> from.Taumel.Agent_runs.run_reason);
    run_final_output =
      (match run.run_final_output with
      | Some _ -> run.run_final_output
      | None -> from.run_final_output);
    run_output_available =
      run.run_output_available || from.run_output_available
      || Option.is_some from.run_final_output
      || Option.is_some from.run_reason;
  }

let merge_volatile_run_into_state volatile_run state run_id =
  match volatile_run with
  | None -> state
  | Some volatile -> (
      match Taumel.Agent_runs.find_run state run_id with
      | None -> state
      | Some run ->
          let updated = merge_volatile_run_fields ~from:volatile run in
          { state with runs = Taumel.Agent_runs.replace_run updated state.runs })

let record_dispatch_completion params ctx =
  Session_sync.sync_persisted_session ctx;
  let prepared = Unsafe.get params "prepared" in
  let completion = Unsafe.get params "completion" in
  match Taumel.Shared.trim_non_empty (get_string prepared "run_id") with
  | None -> ok_obj [ ("ok", js_bool true) ]
  | Some run_id ->
      let status = completion_status completion in
      let reason =
        Option.bind (optional_string_field completion "reason")
          Taumel.Shared.trim_non_empty
      in
      let final_output =
        Option.bind (optional_string_field completion "finalOutput")
          Taumel.Shared.trim_non_empty
      in
      let prepared_submission_id =
        Option.bind (optional_string_field prepared "submission_id")
          Taumel.Shared.trim_non_empty
      in
      let completion_result_fields run status ?reason ?final_output () =
        [
          ("notify", js_bool true);
          ("customType", js_string "taumel.notification");
          ( "content",
            js_string
              (agent_completion_message run status ?reason ?final_output ()) );
          ("display", js_bool true);
          ("triggerTurn", js_bool true);
          ("deliverAs", js_string "followUp");
        ]
      in
      (match Taumel.Agent_runs.find_run !agent_state run_id with
      | Some run when run.run_consumed || run.run_background_notified ->
          ok_obj [ ("ok", js_bool true); ("notify", js_bool false) ]
      | Some run
        when Option.is_some prepared_submission_id
             && latest_submission_id run <> prepared_submission_id ->
          ok_obj [ ("ok", js_bool true); ("notify", js_bool false) ]
      | Some run when run.run_status = Taumel.Agent_runs.Run_suspended ->
          ok_obj [ ("ok", js_bool true); ("notify", js_bool false) ]
      | Some run when run.run_status = Taumel.Agent_runs.Run_cancelled ->
          ok_obj [ ("ok", js_bool true); ("notify", js_bool false) ]
      | Some run when not (Taumel.Agent_runs.active_run_status run.run_status) ->
          let run = run_with_completion_payload run ?reason ?final_output () in
          agent_state :=
            {
              !agent_state with
              runs = Taumel.Agent_runs.replace_run run !agent_state.runs;
            };
          ok_obj
            (completion_result_fields run run.run_status
               ?reason:
                 (match reason with
                 | Some _ -> reason
                 | None -> run.run_reason)
               ?final_output:
                 (match final_output with
                 | Some _ -> final_output
                 | None -> run.run_final_output)
               ())
      | _ -> (
          let previous_run = Taumel.Agent_runs.find_run !agent_state run_id in
          match
            Taumel.Agent_runs.record_run_completion !agent_state
              ~now:(now_seconds ()) ~run_id ~status ?reason ?final_output ()
          with
          | Error message -> error_obj message
          | Ok state ->
              agent_state := state;
              Session_sync.save_agent_state ctx;
              let fields = [ ("ok", js_bool true) ] in
              let fields =
                match previous_run with
                | None -> ("notify", js_bool false) :: fields
                | Some run ->
                    completion_result_fields run status ?reason ?final_output ()
                    @ fields
              in
              ok_obj fields))

let record_background_notification params ctx =
  let prepared = Unsafe.get params "prepared" in
  let run_id = Taumel.Shared.trim_non_empty (get_string prepared "run_id") in
  Session_sync.sync_persisted_session ctx;
  let volatile_run =
    Option.bind run_id (Taumel.Agent_runs.find_run !agent_state)
  in
  match run_id with
  | None -> error_obj "missing agent run id"
  | Some run_id -> (
      match
        Taumel.Agent_runs.record_background_notification !agent_state ~run_id
      with
      | Error message -> error_obj message
      | Ok state ->
          agent_state := merge_volatile_run_into_state volatile_run state run_id;
          Session_sync.save_agent_state ctx;
          ok_obj [ ("ok", js_bool true) ])

let notifiable_terminal_run (run : Taumel.Agent_runs.agent_run) =
  (match run.run_status with
   | Taumel.Agent_runs.Run_completed | Taumel.Agent_runs.Run_failed
   | Taumel.Agent_runs.Run_timed_out -> true
   | _ -> false)
  && (not run.run_consumed)
  && not run.run_background_notified

let record_child_session_start params ctx =
  let prepared = Unsafe.get params "prepared" in
  let bridge = Unsafe.get params "bridge" in
  let agent_id = get_string prepared "workerId" in
  let child_session_id =
    Option.bind (optional_string_field bridge "sessionId")
      Taumel.Shared.trim_non_empty
  in
  let active_tools = optional_string_array bridge "activeTools" in
  match
    Taumel.Agent_runs.record_child_session_start !agent_state ~agent_id
      ?child_session_id ?active_tools ()
  with
  | Error message -> error_obj message
  | Ok state ->
      agent_state := state;
      Session_sync.save_agent_state ctx;
      ok_obj [ ("ok", js_bool true) ]

let record_active_tools_snapshot params ctx =
  let prepared = Unsafe.get params "prepared" in
  let agent_id = get_string prepared "workerId" in
  let active_tools = get_string_array params "activeTools" in
  match
    Taumel.Agent_runs.record_active_tools_snapshot !agent_state ~agent_id
      ~active_tools
  with
  | Error message -> error_obj message
  | Ok state ->
      agent_state := state;
      Session_sync.save_agent_state ctx;
      ok_obj [ ("ok", js_bool true) ]

let plan_bridge_update params =
  let prepared = Unsafe.get params "prepared" in
  let action = get_string prepared "action" in
  let bridge =
    match
      Child_session_bridge.child_session_bridge_from_js
        (Unsafe.get params "bridge")
    with
    | None -> None
    | Some bridge ->
        Some
          {
            Taumel.Subagents.session_id = bridge.session_id;
            cancelled = bridge.cancelled;
            error = bridge.error;
          }
  in
  match
    Taumel.Subagents.plan_child_session_bridge_update ~action
      ~prepared_worker_id:(get_string prepared "workerId")
      ~worker_id:(optional_string_field params "workerId") ~bridge
  with
  | No_bridge_update -> ok_obj [ ("action", js_string "none") ]
  | Store_child_session key ->
      ok_obj [ ("action", js_string "store_child_session"); ("key", js_string key) ]
  | Delete_child_session key ->
      ok_obj
        [ ("action", js_string "delete_child_session"); ("key", js_string key) ]

