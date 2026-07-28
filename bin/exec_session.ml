open Jsoo_bridge
type session = {
  id : int;
  owner_id : string;
  command : string;
  started_at : float;
  tty : bool;
  mutable child : Unsafe.any option;
  output : Exec_output.t;
  mutable timeout_exceeded : bool;
  mutable exited : bool;
  mutable exit_code : int option;
  mutable session_id_exposed : bool;
  mutable terminal_consumed : bool;
  mutable notification_sent : bool;
  mutable notification_delivery_claimed : bool;
  mutable active_write_stdin_waiters : int;
  mutable waiters : (int * (unit -> unit)) list;
  mutable next_waiter_id : int;
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
  (not session.exited) && session.session_id_exposed
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
      if session.owner_id = owner_id && not session.exited then count + 1 else count)
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
let now_ms () =
  let date = Unsafe.get Unsafe.global "Date" in
  match function_field date "now" with
  | None -> 0.0
  | Some now -> Option.value (float_value (Unsafe.fun_call now [||])) ~default:0.0
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
let js_require = Exec_output.js_require
let make_truncation = Exec_output.make_truncation
let add_output (session : session) text = Exec_output.add session.output text
let close_temp (session : session) = Exec_output.close session.output
let node_process () = Unsafe.get Unsafe.global "process"
let js_error message =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Error") [| js_string message |]
let reject_error reject message =
  ignore (Unsafe.fun_call reject [| inject (js_error message) |])
let property obj name =
  optional_field obj name
let data_to_string data =
  match string_value data with
  | Some value -> value
  | None -> (
      match function_field data "toString" with
      | None -> ""
      | Some _ ->
          Option.value
            (string_value
               (Unsafe.meth_call data "toString" [| js_string "utf8" |]))
            ~default:"")
let int_from_js_default value default =
  match float_value value with
  | Some value -> int_of_float value
  | None -> default
let notify (session : session) =
  let waiters = session.waiters in
  session.waiters <- [];
  List.iter (fun (_, waiter) -> waiter ()) waiters
let add_waiter (session : session) waiter =
  let id = session.next_waiter_id in
  session.next_waiter_id <- id + 1;
  session.waiters <- (id, waiter) :: session.waiters;
  id
let remove_waiter (session : session) id =
  session.waiters <- List.filter (fun (waiter_id, _) -> waiter_id <> id) session.waiters
let process_pid (session : session) =
  match session.child with
  | None -> None
  | Some child ->
      (match int_field child "pid" with
      | Some pid when pid > 0 -> Some pid
      | _ -> None)
let kill_pid pid =
  let process = node_process () in
  ignore
    (Unsafe.meth_call process "kill"
       [| js_number (float_of_int (-pid)); js_string "SIGTERM" |]);
  ignore
    (Unsafe.meth_call process "kill"
       [| js_number (float_of_int pid); js_string "SIGTERM" |])
let kill_session (session : session) =
  match session.child with
  | Some child when session.tty -> (
      try ignore (Unsafe.meth_call child "kill" [||]) with _ -> ())
  | _ -> (
      match process_pid session with
      | None -> ()
      | Some pid -> kill_pid pid)
let timer_set callback delay_ms =
  Unsafe.fun_call (Unsafe.get Unsafe.global "setTimeout")
    [| inject (Js.wrap_callback callback); js_number delay_ms |]
let timer_clear timer =
  match function_field Unsafe.global "clearTimeout" with
  | None -> ()
  | Some clear_timeout -> ignore (Unsafe.fun_call clear_timeout [| timer |])
let signal_aborted signal =
  (not (is_nullish signal)) && get_bool_property signal "aborted"
let add_abort_listener signal callback =
  if is_nullish signal then fun () -> ()
  else
    let wrapped = Js.wrap_callback callback in
    let options = Unsafe.obj [| ("once", js_bool true) |] in
    ignore
      (Unsafe.meth_call signal "addEventListener"
         [| js_string "abort"; inject wrapped; inject options |]);
    fun () ->
      ignore
        (Unsafe.meth_call signal "removeEventListener"
           [| js_string "abort"; inject wrapped |])
let wait_for_notification session wait_ms signal ~on_wake ~on_abort =
  if session.exited || wait_ms <= 0. then on_wake ()
  else if signal_aborted signal then on_abort ()
  else
    let active = ref true in
    let waiter_id = ref None in
    let timeout = ref None in
    let cleanup () =
      if !active then (
        active := false;
        Option.iter (remove_waiter session) !waiter_id;
        Option.iter timer_clear !timeout)
    in
    let remove_abort = ref (fun () -> ()) in
    let finish callback () =
      if !active then (
        cleanup ();
        !remove_abort ();
        callback ())
    in
    waiter_id := Some (add_waiter session (finish on_wake));
    timeout := Some (timer_set (finish on_wake) wait_ms);
    remove_abort := add_abort_listener signal (finish on_abort)
let wait_for_settle session yield_ms signal ~on_done ~on_abort =
  let deadline = now_ms () +. yield_ms in
  let rec loop () =
    if session.exited || now_ms () >= deadline then on_done ()
    else
      wait_for_notification session (deadline -. now_ms ()) signal
        ~on_wake:loop ~on_abort
  in
  loop ()
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
      output_limit_exceeded = session.output.output_limit_exceeded;
      timeout_exceeded = session.timeout_exceeded;
    }
  in
  if session.exited then
    { base with exit_code = Some (Option.value session.exit_code ~default:1) }
  else (
    session.session_id_exposed <- true;
    { base with session_id = Some session.id })
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
let node_env _tty ~shell =
  let process = node_process () in
  let env = Unsafe.get process "env" in
  Unsafe.fun_call (Unsafe.get (Unsafe.get Unsafe.global "Object") "assign")
    [|
      inject (Unsafe.obj [||]);
      inject env;
      inject
        (Unsafe.obj
           [|
             ("NO_COLOR", js_string "1");
             ("TERM", js_string "dumb");
             ("LANG", js_string "C.UTF-8");
             ("LC_CTYPE", js_string "C.UTF-8");
             ("LC_ALL", js_string "C.UTF-8");
             ("COLORTERM", js_string "");
             ("PAGER", js_string "cat");
             ("GIT_PAGER", js_string "cat");
             ("GIT_TERMINAL_PROMPT", js_string "0");
             ("SHELL", js_string shell);
           |]);
    |]
let spawn_options cwd tty ~shell =
  let process = node_process () in
  Unsafe.obj
    [|
      ("cwd", js_string cwd);
      ("detached", js_bool (get_string process "platform" <> "win32"));
      ("env", node_env tty ~shell);
      ( "stdio",
        js_array
          [
            js_string (if tty then "pipe" else "ignore");
            js_string "pipe";
            js_string "pipe";
          ] );
      ("windowsHide", js_bool true);
    |]
let wire_stream session child name =
  match property child name with
  | None -> ()
  | Some stream ->
      ignore
        (Unsafe.meth_call stream "on"
           [|
             js_string "data";
             inject
               (Js.wrap_callback (fun data ->
                    let crossed = add_output session (data_to_string data) in
                    if crossed then kill_session session;
                    notify session));
           |])
let release_broker_lease session =
  match session.broker_agent_id with
  | None -> ()
  | Some agent_id ->
      Taumel.Agent_git_broker.Lease.release agent_id;
      session.broker_agent_id <- None
let cancel_broker_sessions_for_agent agent_id =
  let agent_id = String.trim agent_id in
  let live = ref [] in
  Hashtbl.iter
    (fun _ session ->
      match session.broker_agent_id with
      | Some id when id = agent_id -> live := session :: !live
      | _ -> ())
    sessions;
  List.iter (fun session -> if not session.exited then kill_session session) !live;
  let deadline = now_ms () +. 5000. in
  let rec wait () =
    if List.for_all (fun session -> session.exited) !live then true
    else if now_ms () >= deadline then false
    else (
      let start = now_ms () in
      while now_ms () -. start < 25. do () done;
      wait ())
  in
  if wait () then (
    List.iter release_broker_lease !live;
    Taumel.Agent_git_broker.Lease.release agent_id;
    true)
  else false
let spawn_session session ~file ~args ~cwd ?env () =
  let fs = js_require "node:fs" in
  let exists = Unsafe.fun_call (Unsafe.get fs "existsSync") [| js_string cwd |] in
  if not (Js.to_bool (Unsafe.coerce exists)) then
    failwith ("Working directory does not exist: " ^ cwd);
  let node_pty = js_require "node-pty" in
  let options =
    Unsafe.obj
      [|
        ("name", js_string "dumb");
        ("cols", js_number 80.);
        ("rows", js_number 24.);
        ("cwd", js_string cwd);
        ("env", Option.value env ~default:(node_env true ~shell:file));
      |]
  in
  let child =
    Unsafe.fun_call (Unsafe.get node_pty "spawn")
      [| js_string file; js_array (List.map js_string args); inject options |]
  in
  session.child <- Some child;
  ignore
    (Unsafe.meth_call child "onData"
       [| inject (Js.wrap_callback (fun data ->
            let crossed = add_output session (data_to_string data) in
            if crossed then kill_session session;
            notify session)) |]);
  ignore
    (Unsafe.meth_call child "onExit"
       [| inject (Js.wrap_callback (fun event ->
            session.exited <- true;
            session.exit_code <- Some (int_field_default event "exitCode" 1);
            release_broker_lease session;
            notify session)) |])
let new_session owner_id command tty =
  let id = !next_session_id in
  incr next_session_id;
  {
    id;
    owner_id;
    command = truncate_command command;
    started_at = now_ms ();
    tty;
    child = None;
    output = Exec_output.create id;
    timeout_exceeded = false;
    exited = false;
    exit_code = None;
    session_id_exposed = false;
    terminal_consumed = false;
    notification_sent = false;
    notification_delivery_claimed = false;
    active_write_stdin_waiters = 0;
    waiters = [];
    next_waiter_id = 1;
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
  Hashtbl.replace retained_sessions session.id
    {
      retained_id = session.id;
      retained_owner_id = session.owner_id;
      retained_command = session.command;
      retained_started_at = session.started_at;
      retained_exit_code = session.exit_code;
    };
  prune_retained_sessions session.owner_id
let finish_session ?(output_mode = "delta") ?max_output_tokens ?on_finish session
    extra resolve =
  let result = make_result ~output_mode ?max_output_tokens session in
  Option.iter (fun finish -> finish result) on_finish;
  if session.exited then (
    session.terminal_consumed <- true;
    close_temp session;
    if session.session_id_exposed then retain_completed_session session;
    Hashtbl.remove sessions session.id);
  ignore (Unsafe.fun_call resolve [| inject (shell_tool_result result extra) |])
let rejected_promise message =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Promise")
    [|
      inject
        (Js.wrap_callback (fun _resolve reject -> reject_error reject message));
    |]
let resolved_promise value =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Promise")
    [|
      inject
        (Js.wrap_callback (fun resolve _reject ->
             ignore (Unsafe.fun_call resolve [| inject value |])));
    |]
let promise_of_session session yield_ms ?timeout_ms
    ?(abort_disposition = `Kill_session) ?(write_stdin_waiter = false)
    ?(output_mode = "delta") ?max_output_tokens ?on_finish signal
    extra =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Promise")
    [|
      inject
        (Js.wrap_callback (fun resolve reject ->
             let settled = ref false in
             let timeout_ref = ref None in
             if write_stdin_waiter then
               session.active_write_stdin_waiters <-
                 session.active_write_stdin_waiters + 1;
             let cleanup () = Option.iter timer_clear !timeout_ref in
             let clear_write_stdin_waiter () =
               if write_stdin_waiter then
                 session.active_write_stdin_waiters <-
                   max 0 (session.active_write_stdin_waiters - 1)
             in
             let resolve_once () =
               if not !settled then (
                 settled := true;
                 cleanup ();
                 clear_write_stdin_waiter ();
                 finish_session ~output_mode ?max_output_tokens ?on_finish session
                   extra resolve)
             in
             let reject_once ?(kill = false) message =
               if not !settled then (
                 settled := true;
                 cleanup ();
                 clear_write_stdin_waiter ();
                 if kill then (
                   kill_session session;
                   close_temp session;
                   Hashtbl.remove sessions session.id);
                 reject_error reject message)
             in
             let on_abort () =
               match abort_disposition with
               | `Kill_session ->
                   let body = (make_result ?max_output_tokens session).output in
                   let message =
                     if body = "" then "Command aborted"
                     else body ^ "\n\nCommand aborted"
                   in
                   reject_once ~kill:true message
               | `Keep_session -> reject_once "Operation aborted"
             in
             if signal_aborted signal then on_abort ()
             else (
               timeout_ref :=
                 (match timeout_ms with
                 | Some timeout_ms when timeout_ms > 0. ->
                     Some (timer_set (fun () -> session.timeout_exceeded <- true; kill_session session) timeout_ms)
                 | _ -> None);
               wait_for_settle session yield_ms signal ~on_done:resolve_once
                 ~on_abort;
               ())));
    |]
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
  | Error message -> rejected_promise message
  | Ok (plan, force_unsandboxed) ->
      if count_live_sessions_for_owner owner_id >= live_session_cap_per_owner then (
        ignore
          (Authority_plans.finish_exec ~owner_context plan_id
             ~retry_eligible:false);
        rejected_promise
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
            rejected_promise message
        | Ok call ->
            let session = new_session owner_id plan.cmd call.tty in
            let broker_agent_id =
              Option.bind plan.brokered_git (fun broker -> broker.agent_id)
            in
            (match broker_agent_id with
            | None -> ()
            | Some agent_id -> (
                match Taumel.Agent_git_broker.Lease.try_acquire agent_id with
                | Error message -> failwith message
                | Ok () -> session.broker_agent_id <- Some agent_id));
            (match plan.brokered_git with
            | Some broker when broker.subcommand = "add" -> (
                match
                  Agent_worktree_host.perform_secure_broker_add
                    ~worktree_path:broker.git_work_tree broker.argv
                with
                | Error message ->
                    release_broker_lease session;
                    failwith message
                | Ok () ->
                    (* Staging completed via filter-free plumbing; release lease and
                       mark the synthetic session successful without spawning Git. *)
                    session.exited <- true;
                    session.exit_code <- Some 0;
                    release_broker_lease session)
            | Some _ | None -> ());
            (try
               if session.exited then ()
               else
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
               session.exited <- true;
               session.exit_code <- Some 1;
               release_broker_lease session);
            Hashtbl.replace sessions session.id session;
            let extra =
              Unsafe.obj
                [|
                  ("sandboxed", js_bool call.invocation.sandboxed);
                  ("escalated", js_bool call.escalated);
                |]
            in
            promise_of_session session
              (normalize_exec_yield_ms call.yield_time_ms)
              ?timeout_ms:call.timeout_ms
              ?max_output_tokens:plan.max_output_tokens
              ~on_finish:(fun result ->
                ignore
                  (Authority_plans.finish_exec ~owner_context plan_id
                     ~retry_eligible:(authority_retry_eligible plan call result)))
              signal extra
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
          rejected_promise
            (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
      | Some retained ->
          if chars <> "" then
            rejected_promise
              (Printf.sprintf "session %d already completed; cannot write stdin" session_id)
          else
            let result =
              {
                chunk_id = generate_chunk_id ();
                original_token_count = 0;
                output =
                  Printf.sprintf
                    "(session %d already completed; no new output)" session_id;
                truncation =
                  make_truncation ~truncated:false ~truncated_by:"none"
                    ~total_lines:1 ~total_bytes:0 ~output_lines:1
                    ~output_bytes:0 ();
                wall_time_ms = 0.;
                session_id = None;
                exit_code = None;
                output_mode = "delta";
                suppressed_lines = 0;
                suppressed_bytes = 0;
                output_limit_exceeded = false;
                timeout_exceeded = false;
              }
            in
            let extra_fields =
              [ ("kind", js_string "write_stdin"); ("alreadyCompleted", js_bool true) ]
              @
              match retained.retained_exit_code with
              | None -> []
              | Some code -> [ ("exitCode", js_number (float_of_int code)) ]
            in
            resolved_promise
              (shell_tool_result result (Unsafe.obj (Array.of_list extra_fields)))
      | None ->
          rejected_promise (Printf.sprintf "Unknown shell session: %d" session_id))
  | Some session when session.owner_id <> owner_id ->
      rejected_promise
        (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
  | Some session ->
      let stdin_error =
        if signal_aborted signal then Some "Operation aborted"
        else if chars <> "" && session.exited then
          Some
            (Printf.sprintf "session %d already completed; cannot write stdin"
               session_id)
        else if chars = "" then None
        else
          match session.child with
          | Some child when session.tty ->
              ignore (Unsafe.meth_call child "write" [| js_string chars |]);
              None
          | _ ->
              Some
                "stdin is closed for this session"
      in
      (match stdin_error with
      | Some message -> rejected_promise message
      | None ->
          let extra = Unsafe.obj [| ("kind", js_string "write_stdin") |] in
          let output_mode =
            match Boundary_contracts.WriteStdinFacts.get_output_mode facts with
            | Some `V_status -> "status"
            | Some `V_delta | None -> "delta"
          in
          promise_of_session session
            (normalize_write_yield_ms
               (Tool_contracts.WriteStdinFacts.get_yieldTimeMs facts)
               (chars = "") output_mode)
            ~abort_disposition:`Keep_session ~write_stdin_waiter:true ~output_mode
            ?max_output_tokens:
              (Option.map int_of_float
                 (Tool_contracts.WriteStdinFacts.get_maxOutputTokens facts))
            signal extra)
let shutdown_owner owner_id =
  Agent_action_capability.discard_owner owner_id;
  Authority_plans.discard_owner owner_id;
  Hashtbl.filter_map_inplace
    (fun _ session ->
      if session.owner_id = owner_id then (
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
  session.owner_id = owner_id && session.exited
  && (not session.terminal_consumed)
  && session.active_write_stdin_waiters = 0
  && (not session.notification_sent)
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
  | Some session when not session.notification_sent ->
      session.notification_delivery_claimed <- false
  | _ -> ());
  core_ack ()
let mark_exec_notification_delivered session_id =
  (match Hashtbl.find_opt sessions session_id with
  | Some session ->
      session.notification_delivery_claimed <- false;
      session.notification_sent <- true
  | None -> ());
  core_ack ()
let await_exec_completion session_id =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Promise")
    [|
      inject
        (Js.wrap_callback (fun resolve _reject ->
             let resolve_now () =
               ignore
                 (Unsafe.fun_call resolve
                    [|
                      inject
                        (Boundary_contracts.ExecCompletionWaitResult.create
                           ~exited:true ()
                        |> Tool_contracts.ExecCompletionWaitResult.t_to_js)
                    |])
             in
             let rec wait () =
               match Hashtbl.find_opt sessions session_id with
               | None -> resolve_now ()
               | Some session when session.exited -> resolve_now ()
               | Some session -> ignore (add_waiter session (fun () -> wait ()))
             in
             wait ()));
    |]

let age_seconds_of started_at =
  max 0 (int_of_float (Float.floor ((now_ms () -. started_at) /. 1000.)))

let process_manager_entry_of_session (session : session) =
  Tool_contracts.ProcessManagerEntry.create
    ~sessionId:(float_of_int session.id) ~command:session.command
    ~runState:
      (Boundary_contracts.ProcessManagerEntry.run_state_to_contract
         (if session.exited then `V_exited else `V_running))
    ?exitCode:(Option.map float_of_int session.exit_code)
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
  | Some session when session.exited ->
      error_obj
        (Printf.sprintf "session %d already completed; cannot kill" session_id)
  | Some session ->
      kill_session session;
      if not session.exited then (
        session.exited <- true;
        session.exit_code <- Some (Option.value session.exit_code ~default:143);
        release_broker_lease session;
        notify session);
      core_ack ()
