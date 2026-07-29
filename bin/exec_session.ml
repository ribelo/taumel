open Jsoo_bridge

module Effect = Eta.Effect
module Promise = Eta.Promise
module Exit = Eta.Exit

type terminal_outcome =
  | Ordinary_exit of int
  | Timeout of int
  | Output_limit of int
  | Forced_termination of int

type lifecycle = Running | Terminal of terminal_outcome
type terminal_consumption = Pending | Consumed_by_tool
type notification_state = Pending | Sent

type session = {
  id : int;
  owner_id : string;
  command : string;
  started_at : float;
  tty : bool;
  mutable process : Exec_process_jsoo.t option;
  output : Exec_output.t;
  completion : (terminal_outcome, string) Promise.t;
  mutable lifecycle : lifecycle;
  mutable session_id_exposed : bool;
  mutable terminal_consumption : terminal_consumption;
  mutable notification_state : notification_state;
  mutable notification_delivery_claimed : bool;
  mutable active_write_stdin_claims : int;
  mutable broker_agent_id : string option;
}
type retained_session = {
  retained_id : int;
  retained_owner_id : string;
  retained_command : string;
  retained_started_at : float;
  retained_exit_code : int option;
}
let live_session_cap_per_owner = 64
let command_display_cap = 240
let truncate_command command =
  let trimmed = String.trim command in
  if String.length trimmed <= command_display_cap then trimmed
  else String.sub trimmed 0 command_display_cap
let is_background_session (session : session) =
  session.lifecycle = Running && session.session_id_exposed
type truncation = Exec_output.truncation
type run_result = {
  chunk_id : string;
  original_token_count : int;
  output : string;
  truncation : truncation;
  wall_time_ms : float;
  session_id : int option;
  exit_code : int option;
  output_mode : string;
  suppressed_lines : int;
  suppressed_bytes : int;
  output_limit_exceeded : bool;
  timeout_exceeded : bool;
}
let exec_default_yield_time_ms = 10_000.
let write_stdin_default_yield_time_ms = 250.
let min_yield_time_ms = 250.
let max_yield_time_ms = 30_000.
let min_empty_write_stdin_yield_time_ms = 5_000.
let max_empty_write_stdin_yield_time_ms = 300_000.
let sessions : (int, session) Hashtbl.t = Hashtbl.create 16
let retained_sessions : (int, retained_session) Hashtbl.t = Hashtbl.create 16
let count_live_sessions_for_owner owner_id =
  Hashtbl.fold
    (fun _ session count ->
      if session.owner_id = owner_id && session.lifecycle = Running then count + 1
      else count)
    sessions 0
let background_activity_for_owner owner_id =
  let live =
    Hashtbl.fold
      (fun _ session acc ->
        if session.owner_id = owner_id && is_background_session session then
          session :: acc
        else acc)
      sessions []
    |> List.sort (fun a b -> compare a.id b.id)
  in
  match live with
  | [ session ] -> (1, Some session.command)
  | _ -> (List.length live, None)
let next_session_id = ref 1
let next_chunk_id = ref 0
let generate_chunk_id () =
  let value = !next_chunk_id land 0xffffff in
  next_chunk_id := (!next_chunk_id + 1) land 0xffffff;
  Printf.sprintf "%06x" value
let now_ms = Node_globals.now_ms
let clamp value lower upper = min (max value lower) upper
let normalize_exec_yield_ms = function
  | Some value when value >= 0. ->
      clamp (Float.round value) min_yield_time_ms max_yield_time_ms
  | _ -> exec_default_yield_time_ms
let normalize_write_yield_ms value input_is_empty output_mode =
  let normalized =
    match value with
    | Some value when value >= 0. -> Float.round value
    | _ ->
        if output_mode = "status" then min_empty_write_stdin_yield_time_ms
        else write_stdin_default_yield_time_ms
  in
  let responsive = max normalized min_yield_time_ms in
  if input_is_empty && output_mode = "status" then
    clamp responsive min_empty_write_stdin_yield_time_ms
      max_empty_write_stdin_yield_time_ms
  else min responsive max_yield_time_ms
let default_max_output_tokens = Exec_output.default_max_output_tokens
let approximate_bytes_per_token = Exec_output.approximate_bytes_per_token
let total_output_limit_bytes = Exec_output.total_output_limit_bytes
let make_truncation = Exec_output.make_truncation
let add_output (session : session) text = Exec_output.add session.output text
let close_temp (session : session) = Exec_output.close session.output
let kill_session (session : session) =
  Option.iter Exec_process_jsoo.request_sigterm session.process

let terminal_exit_code = function
  | Ordinary_exit code
  | Timeout code
  | Output_limit code
  | Forced_termination code ->
      code

let session_terminal_outcome session =
  match session.lifecycle with Running -> None | Terminal outcome -> Some outcome

let session_exited session = session_terminal_outcome session <> None
let make_result ?(output_mode = "delta") ?(max_output_tokens = default_max_output_tokens)
    (session : session) =
  let delta_output, delta_truncation = Exec_output.codex_display session.output max_output_tokens in
  let suppressed_lines =
    session.output.chunk_lines
    + if session.output.chunk_bytes > 0 && not session.output.chunk_ends_with_newline then 1 else 0
  in
  let suppressed_bytes = session.output.chunk_bytes in
  let output, truncation =
    if output_mode = "status" then
      ( "",
        make_truncation ?full_output_path:session.output.temp_path ~truncated:false
          ~truncated_by:"none" ~total_lines:suppressed_lines
          ~total_bytes:suppressed_bytes ~output_lines:0 ~output_bytes:0 () )
    else (delta_output, delta_truncation)
  in
  Exec_output.reset_chunk session.output;
  let base =
    {
      chunk_id = generate_chunk_id ();
      original_token_count =
        (delta_truncation.trunc_total_bytes + approximate_bytes_per_token - 1)
        / approximate_bytes_per_token;
      output;
      truncation;
      wall_time_ms = now_ms () -. session.started_at;
      session_id = None;
      exit_code = None;
      output_mode;
      suppressed_lines = (if output_mode = "status" then suppressed_lines else 0);
      suppressed_bytes = (if output_mode = "status" then suppressed_bytes else 0);
      output_limit_exceeded =
        (match session.lifecycle with
        | Terminal (Output_limit _) -> true
        | Running | Terminal _ -> session.output.output_limit_exceeded);
      timeout_exceeded =
        (match session.lifecycle with
        | Terminal (Timeout _) -> true
        | Running | Terminal _ -> false);
    }
  in
  match session.lifecycle with
  | Terminal outcome -> { base with exit_code = Some (terminal_exit_code outcome) }
  | Running ->
    session.session_id_exposed <- true;
    { base with session_id = Some session.id }
let shell_result_text result =
  let body = result.output in
  let append status = if body = "" then status else body ^ "\n\n" ^ status in
  let suppression =
    Printf.sprintf "suppressed %d lines / %d bytes"
      result.suppressed_lines result.suppressed_bytes
  in
  let output_limit_message =
    Printf.sprintf
      "Command terminated after exceeding the fixed %d-byte output limit. Redirect intentionally large output to a file and inspect it selectively."
      total_output_limit_bytes
  in
  let timeout_message =
    Printf.sprintf "Command timed out after %.0f seconds"
      (result.wall_time_ms /. 1000.)
  in
  if result.timeout_exceeded then append timeout_message
  else if result.output_limit_exceeded then append output_limit_message
  else if result.output_mode = "status" then
    (match (result.session_id, result.exit_code) with
    | Some id, _ -> Printf.sprintf "Session %d still running; %s — end the turn to get notified via exec_completion when it finishes" id suppression
    | None, Some code -> Printf.sprintf "Command completed with code %d; %s" code suppression
    | _ -> "Command completed; " ^ suppression)
  else
    let lifecycle =
      match (result.session_id, result.exit_code) with
      | Some id, _ -> Printf.sprintf "Process running with session ID %d" id
      | None, Some code -> Printf.sprintf "Process exited with code %d" code
      | _ -> "Process exited with code 0"
    in
    Printf.sprintf
      "Chunk ID: %s\nWall time: %.4f seconds\n%s\nOriginal token count: %d\nOutput:\n%s"
      result.chunk_id (result.wall_time_ms /. 1000.) lifecycle
      result.original_token_count body
let typed_truncation (truncation : truncation) =
  Tool_contracts.ExecTruncation.create
    ~truncated:truncation.trunc_truncated
    ~truncatedBy:truncation.trunc_truncated_by
    ~totalLines:(float_of_int truncation.trunc_total_lines)
    ~totalBytes:(float_of_int truncation.trunc_total_bytes)
    ~outputLines:(float_of_int truncation.trunc_output_lines)
    ~outputBytes:(float_of_int truncation.trunc_output_bytes)
    ~maxLines:(float_of_int truncation.trunc_max_lines)
    ~maxBytes:(float_of_int truncation.trunc_max_bytes)
    ~lastLinePartial:truncation.trunc_last_line_partial
    ~firstLineExceedsLimit:truncation.trunc_first_line_exceeds_limit
    ?fullOutputPath:truncation.trunc_full_output_path ()
let shell_result_details result extra =
  let optional_bool name =
    if has_property extra name then Some (get_bool extra name) else None
  in
  let optional_string name =
    if has_property extra name then optional_string_field extra name else None
  in
  let exit_code = Option.map float_of_int result.exit_code in
  let session_id = Option.map float_of_int result.session_id in
  Tool_contracts.ExecResultDetails.create
    ~ok:(not result.output_limit_exceeded) ~output:result.output
    ~stdout:result.output ~stderr:""
    ~truncation:(typed_truncation result.truncation)
    ~wallTimeMs:result.wall_time_ms ~outputMode:result.output_mode
    ~suppressedLines:(float_of_int result.suppressed_lines)
    ~suppressedBytes:(float_of_int result.suppressed_bytes)
    ?reasonCode:(if result.output_limit_exceeded then Some "output_limit_exceeded" else None)
    ?outputLimitBytes:
      (if result.output_limit_exceeded then Some (float_of_int total_output_limit_bytes) else None)
    ?truncated:(if result.truncation.trunc_truncated then Some true else None)
    ?fullOutputPath:result.truncation.trunc_full_output_path
    ?exitCode:exit_code ?code:exit_code ?sessionId:session_id
    ?session_id ?sandboxed:(optional_bool "sandboxed")
    ?escalated:(optional_bool "escalated") ?kind:(optional_string "kind")
    ?alreadyCompleted:(optional_bool "alreadyCompleted") ()
let shell_tool_result result extra =
  let content =
    Boundary_contracts.ToolResultTextContent.create
      ~text:(shell_result_text result) ()
  in
  Tool_contracts.ExecToolResult.create ~content:[ content ]
    ~details:(shell_result_details result extra) ()
  |> Tool_contracts.ExecToolResult.t_to_js |> inject
let release_broker_lease session =
  match session.broker_agent_id with
  | None -> ()
  | Some agent_id ->
      Taumel.Agent_git_broker.Lease.release agent_id;
      session.broker_agent_id <- None
let resolve_completion session outcome =
  Eta_jsoo.run
    (fun () -> Promise.resolve session.completion (Exit.Ok outcome))
    ~on_result:(fun _ -> ())

let transition_terminal session outcome =
  match session.lifecycle with
  | Terminal _ -> false
  | Running ->
      session.lifecycle <- Terminal outcome;
      release_broker_lease session;
      resolve_completion session outcome;
      true

let new_session owner_id command tty =
  let id = !next_session_id in
  incr next_session_id;
  {
    id;
    owner_id;
    command = truncate_command command;
    started_at = now_ms ();
    tty;
    process = None;
    output = Exec_output.create id;
    completion = Promise.create ();
    lifecycle = Running;
    session_id_exposed = false;
    terminal_consumption = Pending;
    notification_state = Pending;
    notification_delivery_claimed = false;
    active_write_stdin_claims = 0;
    broker_agent_id = None;
  }
let retained_session_cap_per_owner = 128
let prune_retained_sessions owner_id =
  let owned =
    Hashtbl.fold
      (fun _ retained acc ->
        if retained.retained_owner_id = owner_id then retained :: acc else acc)
      retained_sessions []
    |> List.sort (fun a b -> compare b.retained_id a.retained_id)
  in
  owned
  |> List.mapi (fun index retained -> (index, retained))
  |> List.iter (fun (index, retained) ->
         if index >= retained_session_cap_per_owner then
           Hashtbl.remove retained_sessions retained.retained_id)
let retain_completed_session session =
  let exit_code = Option.map terminal_exit_code (session_terminal_outcome session) in
  Hashtbl.replace retained_sessions session.id
    {
      retained_id = session.id;
      retained_owner_id = session.owner_id;
      retained_command = session.command;
      retained_started_at = session.started_at;
      retained_exit_code = exit_code;
    };
  prune_retained_sessions session.owner_id
type wait_winner =
  | Completion of terminal_outcome
  | Yield
  | Abort

let wait_for_session session yield_ms signal =
  Effect.race
    [
      Promise.await session.completion |> Effect.map (fun outcome -> Completion outcome);
      Effect.sleep (Eta.Duration.ms (int_of_float yield_ms))
      |> Effect.map (fun () -> Yield);
      Eta_host_doors.await_abort_signal signal |> Effect.map (fun () -> Abort);
    ]

let rec string_cause_message = function
  | Eta.Cause.Fail message -> message
  | Eta.Cause.Sequential (cause :: _)
  | Eta.Cause.Concurrent (cause :: _) ->
      string_cause_message cause
  | cause -> Format.asprintf "%a" (Eta.Cause.pp Format.pp_print_string) cause

let promise_of_effect program =
  Eta_host_doors.js_promise_of_effect_rejecting
    ~error_message:string_cause_message program

let rejected_effect message = promise_of_effect (Effect.fail message)
let resolved_effect value = promise_of_effect (Effect.pure value)

let consume_terminal ?(output_mode = "delta") ?max_output_tokens session extra =
  match (session.lifecycle, session.terminal_consumption) with
  | Running, _ -> Error "shell session is still running"
  | Terminal _, Consumed_by_tool ->
      Error (Printf.sprintf "session %d terminal result already consumed" session.id)
  | Terminal _, Pending ->
      session.terminal_consumption <- Consumed_by_tool;
      let result = make_result ~output_mode ?max_output_tokens session in
      close_temp session;
      if session.session_id_exposed then retain_completed_session session;
      Hashtbl.remove sessions session.id;
      Ok (result, shell_tool_result result extra)

let spawn_session session ~file ~args ~cwd ?env () =
  let on_data text = add_output session text in
  let on_exit code =
    let outcome =
      if session.output.output_limit_exceeded then Output_limit code
      else Ordinary_exit code
    in
    ignore (transition_terminal session outcome)
  in
  session.process <-
    Some
      (Exec_process_jsoo.spawn ~file ~args ~cwd ?env ~tty:session.tty ~on_data
         ~on_exit ())

let launch_timeout session timeout_ms =
  match timeout_ms with
  | Some timeout_ms when timeout_ms > 0. ->
      Eta_jsoo.run
        (fun () ->
          let open Eta.Syntax in
          let* () = Effect.sleep (Eta.Duration.ms (int_of_float timeout_ms)) in
          Effect.sync (fun () ->
              if transition_terminal session (Timeout 143) then kill_session session))
        ~on_result:(fun () -> ())
  | Some _ | None -> ()

let cancel_broker_sessions_for_agent agent_id =
  let agent_id = String.trim agent_id in
  let live =
    Hashtbl.fold
      (fun _ session acc ->
        match session.broker_agent_id with
        | Some id when id = agent_id -> session :: acc
        | Some _ | None -> acc)
      sessions []
  in
  List.iter
    (fun session -> if session.lifecycle = Running then kill_session session)
    live;
  let waits =
    List.map
      (fun session -> Promise.await session.completion |> Effect.map (fun _ -> ()))
      live
  in
  let open Eta.Syntax in
  let wait_for_all =
    Effect.all ~max_concurrent:(max 1 (List.length waits)) waits
    |> Effect.map (fun _ -> ())
  in
  let* () =
    Effect.timeout_as (Eta.Duration.seconds 5) ~on_timeout:"cleanup timeout"
      wait_for_all
  in
  Effect.pure true
let authority_retry_eligible (plan : Authority_plans.exec_plan)
    (call : Taumel.Sandbox.exec_host_call) result =
  let policy_allows_retry =
    match plan.sandbox.approval_policy with
    | Taumel.Sandbox.On_failure | Taumel.Sandbox.Untrusted -> true
    | Taumel.Sandbox.Never | Taumel.Sandbox.On_request -> false
  in
  policy_allows_retry
  && result.session_id = None
  &&
  match result.exit_code with
  | None | Some 0 -> false
  | Some exit_code ->
      Taumel.Sandbox.failure_diagnostic
        ~filesystem_mode:plan.sandbox.filesystem_mode
        ~network_mode:plan.sandbox.network_mode
        ~sandboxed:call.invocation.sandboxed ~exit_code ~stdout:result.output
        ~stderr:""
      <> None

let run_exec_command prepared owner_id signal owner_context =
  let plan_id = get_string prepared "planId" in
  match Authority_plans.claim_exec ~owner_context plan_id with
  | Error message -> rejected_effect message
  | Ok (plan, force_unsandboxed) ->
      if count_live_sessions_for_owner owner_id >= live_session_cap_per_owner then (
        ignore
          (Authority_plans.finish_exec ~owner_context plan_id
             ~retry_eligible:false);
        rejected_effect
          (Printf.sprintf
             "at most %d concurrently live command sessions are allowed per owning session"
             live_session_cap_per_owner))
      else
        match
          Sandbox_bridge.planned_exec_host_call plan (inject Js.null)
            (inject Js.null) force_unsandboxed
        with
        | Error message ->
            ignore
              (Authority_plans.finish_exec ~owner_context plan_id
                 ~retry_eligible:false);
            rejected_effect message
        | Ok call ->
            let session = new_session owner_id plan.cmd call.tty in
            Hashtbl.replace sessions session.id session;
            (try
               let broker_agent_id =
                 Option.bind plan.brokered_git (fun broker -> broker.agent_id)
               in
               (match broker_agent_id with
               | None -> ()
               | Some agent_id -> (
                   match Taumel.Agent_git_broker.Lease.try_acquire agent_id with
                   | Error message -> failwith message
                   | Ok () -> session.broker_agent_id <- Some agent_id));
               match plan.brokered_git with
               | Some broker when broker.subcommand = "add" -> (
                   match
                     Agent_worktree_host.perform_secure_broker_add
                       ~worktree_path:broker.git_work_tree broker.argv
                   with
                   | Error message -> failwith message
                   | Ok () ->
                       ignore (transition_terminal session (Ordinary_exit 0)))
               | Some _ | None ->
                   let env =
                     Option.map
                       (fun (broker : Authority_plans.brokered_git) ->
                         Trusted_git.broker_environment ~git_dir:broker.git_dir
                           ~git_work_tree:broker.git_work_tree
                           ~commit:(broker.subcommand = "commit"))
                       plan.brokered_git
                   in
                   spawn_session session ~file:call.invocation.command
                     ~args:call.invocation.args ~cwd:call.cwd ?env ()
             with exn ->
               let message = Printexc.to_string exn ^ "\n" in
               ignore (add_output session message);
               ignore (transition_terminal session (Ordinary_exit 1)));
            launch_timeout session call.timeout_ms;
            let extra =
              Unsafe.obj
                [|
                  ("sandboxed", js_bool call.invocation.sandboxed);
                  ("escalated", js_bool call.escalated);
                |]
            in
            let open Eta.Syntax in
            let program =
              let* winner =
                wait_for_session session
                  (normalize_exec_yield_ms call.yield_time_ms)
                  signal
              in
              match winner with
              | Completion _ ->
                  Effect.sync_result (fun () ->
                      consume_terminal ?max_output_tokens:plan.max_output_tokens
                        session extra)
              | Yield ->
                  Effect.sync (fun () ->
                      let result =
                        make_result ?max_output_tokens:plan.max_output_tokens
                          session
                      in
                      (result, shell_tool_result result extra))
              | Abort ->
                  let* () =
                    Effect.sync (fun () ->
                        ignore
                          (transition_terminal session (Forced_termination 143));
                        kill_session session;
                        close_temp session;
                        Hashtbl.remove sessions session.id)
                  in
                  Effect.fail "Shell command aborted"
            in
            let program =
              let* result, tool_result = program in
              let* () =
                Effect.sync (fun () ->
                    ignore
                      (Authority_plans.finish_exec ~owner_context plan_id
                         ~retry_eligible:
                           (authority_retry_eligible plan call result)))
              in
              Effect.pure tool_result
            in
            promise_of_effect program

let already_completed_result session_id exit_code =
  {
    chunk_id = generate_chunk_id ();
    original_token_count = 0;
    output =
      Printf.sprintf "(session %d already completed; no new output)" session_id;
    truncation =
      make_truncation ~truncated:false ~truncated_by:"none" ~total_lines:1
        ~total_bytes:0 ~output_lines:1 ~output_bytes:0 ();
    wall_time_ms = 0.;
    session_id = None;
    exit_code;
    output_mode = "delta";
    suppressed_lines = 0;
    suppressed_bytes = 0;
    output_limit_exceeded = false;
    timeout_exceeded = false;
  }

let already_completed_tool_result session_id exit_code =
  let result = already_completed_result session_id exit_code in
  let extra =
    Unsafe.obj
      [| ("kind", js_string "write_stdin"); ("alreadyCompleted", js_bool true) |]
  in
  shell_tool_result result extra

type write_claim = {
  claimed_session : session;
  mutable write_claim_released : bool;
}

let acquire_write_claim session =
  session.active_write_stdin_claims <- session.active_write_stdin_claims + 1;
  { claimed_session = session; write_claim_released = false }

let release_write_claim claim =
  if not claim.write_claim_released then (
    claim.write_claim_released <- true;
    let session = claim.claimed_session in
    session.active_write_stdin_claims <-
      max 0 (session.active_write_stdin_claims - 1))

let write_stdin raw_facts =
  let facts = decode_ojs_contract Tool_contracts.WriteStdinFacts.t_of_js (ojs_of_js raw_facts) in
  let session_id = Tool_contracts.WriteStdinFacts.get_sessionId facts |> int_of_float in
  let chars = Tool_contracts.WriteStdinFacts.get_chars facts in
  let owner_id = Tool_contracts.WriteStdinFacts.get_ownerId facts in
  let signal =
    Tool_contracts.WriteStdinFacts.get_signal facts
    |> Option.map (fun value -> Ts2ocaml.unknown_to_js value |> js_of_ojs)
    |> Option.value ~default:(inject Js.null)
  in
  match Hashtbl.find_opt sessions session_id with
  | None -> (
      match Hashtbl.find_opt retained_sessions session_id with
      | Some retained when retained.retained_owner_id <> owner_id ->
          rejected_effect
            (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
      | Some retained ->
          if chars <> "" then
            rejected_effect
              (Printf.sprintf "session %d already completed; cannot write stdin" session_id)
          else
            resolved_effect
              (already_completed_tool_result session_id retained.retained_exit_code)
      | None ->
          rejected_effect (Printf.sprintf "Unknown shell session: %d" session_id))
  | Some session when session.owner_id <> owner_id ->
      rejected_effect
        (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
  | Some session ->
      let stdin_error =
        if Eta_host_doors.signal_aborted signal then Some "Operation aborted"
        else if chars <> "" && session_exited session then
          Some
            (Printf.sprintf "session %d already completed; cannot write stdin"
               session_id)
        else if chars = "" then None
        else
          match session.process with
          | Some process -> (
              match Exec_process_jsoo.write process chars with
              | Ok () -> None
              | Error message -> Some message)
          | None -> Some "stdin is closed for this session"
      in
      (match stdin_error with
      | Some message -> rejected_effect message
      | None ->
          let extra = Unsafe.obj [| ("kind", js_string "write_stdin") |] in
          let output_mode =
            match Boundary_contracts.WriteStdinFacts.get_output_mode facts with
            | Some `V_status -> "status"
            | Some `V_delta | None -> "delta"
          in
          let max_output_tokens =
            Option.map int_of_float
              (Tool_contracts.WriteStdinFacts.get_maxOutputTokens facts)
          in
          let claim = acquire_write_claim session in
          let terminal_result () =
            match
              consume_terminal ~output_mode ?max_output_tokens session extra
            with
            | Ok (_, tool_result) -> tool_result
            | Error _ ->
                already_completed_tool_result session.id
                  (Option.map terminal_exit_code
                     (session_terminal_outcome session))
          in
          let open Eta.Syntax in
          let program =
            let* winner =
              wait_for_session session
                (normalize_write_yield_ms
                   (Tool_contracts.WriteStdinFacts.get_yieldTimeMs facts)
                   (chars = "") output_mode)
                signal
            in
            match winner with
            | Abort -> Effect.fail "Operation aborted"
            | Completion _ -> Effect.sync terminal_result
            | Yield ->
                Effect.sync (fun () ->
                    match session.lifecycle with
                    | Terminal _ -> terminal_result ()
                    | Running ->
                        let result =
                          make_result ~output_mode ?max_output_tokens session
                        in
                        shell_tool_result result extra)
          in
          promise_of_effect
            (Effect.finally
               (Effect.sync (fun () -> release_write_claim claim))
               program))
let shutdown_owner owner_id =
  Agent_action_capability.discard_owner owner_id;
  Authority_plans.discard_owner owner_id;
  Hashtbl.filter_map_inplace
    (fun _ session ->
      if session.owner_id = owner_id then (
        ignore (transition_terminal session (Forced_termination 143));
        kill_session session;
        close_temp session;
        None)
      else Some session)
    sessions;
  Hashtbl.filter_map_inplace
    (fun _ retained ->
      if retained.retained_owner_id = owner_id then None else Some retained)
    retained_sessions;
  core_ack ()
let exec_notification_content (session : session) =
  Printf.sprintf
    "Command session %d has finished. To read and consume the result, call write_stdin with session_id=%d, chars=\"\", yield_time_ms=5000."
    session.id session.id
let exec_notification_deliverable owner_id session =
  session.owner_id = owner_id && session_exited session
  && session.terminal_consumption = Pending
  && session.active_write_stdin_claims = 0
  && session.notification_state = Pending
  && not session.notification_delivery_claimed
let exec_notification_obj session =
  Tool_contracts.ExecNotification.create ~sessionId:(float_of_int session.id)
    ~customType:"notification" ~content:(exec_notification_content session)
    ~display:true ()
let pending_exec_notifications owner_id =
  let pending =
    Hashtbl.fold
      (fun _ session acc ->
        if exec_notification_deliverable owner_id session then session :: acc
        else acc)
      sessions []
  in
  let pending = List.sort (fun a b -> compare a.id b.id) pending in
  let result =
    Tool_contracts.PendingExecNotificationsResult.create
      ~notifications:(List.map exec_notification_obj pending) ()
  in
  Tool_contracts.PendingExecNotificationsResult.t_to_js result |> inject
let claim_exec_notification_delivery owner_id session_id =
  match Hashtbl.find_opt sessions session_id with
  | Some session when exec_notification_deliverable owner_id session ->
      session.notification_delivery_claimed <- true;
      let claim =
        Boundary_contracts.ExecNotificationClaimed.create
          ~sessionId:(float_of_int session.id) ~customType:"notification"
          ~content:(exec_notification_content session) ~display:true ()
      in
      Tool_contracts.ExecNotificationClaimed.t_to_js claim |> inject
  | _ ->
      let claim =
        Boundary_contracts.ExecNotificationUnavailable.create ()
      in
      Tool_contracts.ExecNotificationUnavailable.t_to_js claim |> inject
let release_exec_notification_delivery session_id =
  (match Hashtbl.find_opt sessions session_id with
  | Some session when session.notification_state = Pending ->
      session.notification_delivery_claimed <- false
  | _ -> ());
  core_ack ()
let mark_exec_notification_delivered session_id =
  (match Hashtbl.find_opt sessions session_id with
  | Some session ->
      session.notification_delivery_claimed <- false;
      session.notification_state <- Sent
  | None -> ());
  core_ack ()
let await_exec_completion session_id =
  let completion_result () =
    Boundary_contracts.ExecCompletionWaitResult.create ~exited:true ()
    |> Tool_contracts.ExecCompletionWaitResult.t_to_js
    |> inject
  in
  match Hashtbl.find_opt sessions session_id with
  | None -> resolved_effect (completion_result ())
  | Some session ->
      Promise.await session.completion
      |> Effect.map (fun _ -> completion_result ())
      |> promise_of_effect

let age_seconds_of started_at =
  max 0 (int_of_float (Float.floor ((now_ms () -. started_at) /. 1000.)))

let process_manager_entry_of_session (session : session) =
  let exit_code = Option.map terminal_exit_code (session_terminal_outcome session) in
  Tool_contracts.ProcessManagerEntry.create
    ~sessionId:(float_of_int session.id) ~command:session.command
    ~runState:
      (Boundary_contracts.ProcessManagerEntry.run_state_to_contract
         (if session_exited session then `V_exited else `V_running))
    ?exitCode:(Option.map float_of_int exit_code)
    ~ageSeconds:(float_of_int (age_seconds_of session.started_at))
    ~retained:false ()

let process_manager_entry_of_retained (retained : retained_session) =
  Tool_contracts.ProcessManagerEntry.create
    ~sessionId:(float_of_int retained.retained_id)
    ~command:retained.retained_command
    ~runState:
      (Boundary_contracts.ProcessManagerEntry.run_state_to_contract `V_exited)
    ?exitCode:(Option.map float_of_int retained.retained_exit_code)
    ~ageSeconds:(float_of_int (age_seconds_of retained.retained_started_at))
    ~retained:true ()

let process_manager_snapshot owner_id =
  let live =
    Hashtbl.fold
      (fun _ session acc ->
        if session.owner_id = owner_id then session :: acc else acc)
      sessions []
    |> List.sort (fun a b -> compare a.id b.id)
    |> List.map process_manager_entry_of_session
  in
  let retained =
    Hashtbl.fold
      (fun _ retained acc ->
        if retained.retained_owner_id = owner_id then retained :: acc else acc)
      retained_sessions []
    |> List.sort (fun a b -> compare a.retained_id b.retained_id)
    |> List.map process_manager_entry_of_retained
  in
  Tool_contracts.ProcessManagerSnapshot.create ~sessions:(live @ retained) ()
  |> Tool_contracts.ProcessManagerSnapshot.t_to_js
  |> inject

let process_manager_output owner_id session_id =
  let unavailable () =
    Tool_contracts.ProcessManagerOutput.create ~available:false
      ~text:"no longer available" ()
    |> Tool_contracts.ProcessManagerOutput.t_to_js
    |> inject
  in
  match Hashtbl.find_opt sessions session_id with
  | Some session when session.owner_id <> owner_id -> unavailable ()
  | Some session -> (
      match Exec_output.collectable_display session.output with
      | None -> unavailable ()
      | Some text ->
          Tool_contracts.ProcessManagerOutput.create ~available:true ~text ()
          |> Tool_contracts.ProcessManagerOutput.t_to_js
          |> inject)
  | None -> unavailable ()

let process_manager_kill owner_id session_id =
  match Hashtbl.find_opt sessions session_id with
  | None ->
      error_obj (Printf.sprintf "Unknown shell session: %d" session_id)
  | Some session when session.owner_id <> owner_id ->
      error_obj
        (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
  | Some session when session_exited session ->
      error_obj
        (Printf.sprintf "session %d already completed; cannot kill" session_id)
  | Some session ->
      ignore (transition_terminal session (Forced_termination 143));
      kill_session session;
      core_ack ()
