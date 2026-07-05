open Jsoo_bridge

type session = {
  id : int;
  owner_id : string;
  started_at : float;
  tty : bool;
  mutable child : Unsafe.any option;
  pending : Buffer.t;
  mutable chunk_bytes : int;
  mutable chunk_lines : int;
  mutable chunk_trimmed : bool;
  mutable temp_path : string option;
  mutable temp_fd : Unsafe.any option;
  mutable exited : bool;
  mutable exit_code : int option;
  mutable session_id_exposed : bool;
  mutable terminal_consumed : bool;
  mutable notification_sent : bool;
  mutable waiters : (int * (unit -> unit)) list;
  mutable next_waiter_id : int;
}

type retained_session = {
  retained_id : int;
  retained_owner_id : string;
  retained_exit_code : int option;
}

type run_result = {
  output : string;
  truncated : bool;
  full_output_path : string option;
  wall_time_ms : float;
  session_id : int option;
  exit_code : int option;
}

let exec_default_yield_time_ms = 10_000.
let write_stdin_default_yield_time_ms = 250.
let min_yield_time_ms = 250.
let max_yield_time_ms = 30_000.
let min_empty_write_stdin_yield_time_ms = 5_000.
let max_empty_write_stdin_yield_time_ms = 300_000.

let sessions : (int, session) Hashtbl.t = Hashtbl.create 16
let retained_sessions : (int, retained_session) Hashtbl.t = Hashtbl.create 16
let next_session_id = ref 1

let now_ms () =
  let date = Unsafe.get Unsafe.global "Date" in
  match function_field date "now" with
  | None -> 0.0
  | Some now -> Option.value (float_value (Unsafe.fun_call now [||])) ~default:0.0

let optional_positive_float obj name =
  match float_field obj name with
  | Some value when value > 0. -> Some value
  | _ -> None

let clamp value lower upper = min (max value lower) upper

let normalize_exec_yield_ms = function
  | Some value when value >= 0. ->
      clamp (Float.round value) min_yield_time_ms max_yield_time_ms
  | _ -> exec_default_yield_time_ms

let normalize_write_yield_ms value input_is_empty =
  let normalized =
    match value with
    | Some value when value >= 0. -> Float.round value
    | _ -> write_stdin_default_yield_time_ms
  in
  let responsive = max normalized min_yield_time_ms in
  if input_is_empty then
    clamp responsive min_empty_write_stdin_yield_time_ms
      max_empty_write_stdin_yield_time_ms
  else min responsive max_yield_time_ms

let max_display_lines = 2000
let max_display_bytes = 50 * 1024

(* In-memory bound for the unread (pending) buffer. The full output always lives
   in the temp file, so trimming the oldest unread bytes never loses data. *)
let pending_cap = 1024 * 1024

let count_newlines s =
  let n = ref 0 in
  String.iter (fun c -> if c = '\n' then incr n) s;
  !n

(* Return the suffix of [s] holding at most its last [n] lines. *)
let last_lines s n =
  if n <= 0 || s = "" then ""
  else
    let len = String.length s in
    (* Ignore a single trailing newline so it is not counted as a separator. *)
    let scan_from = if s.[len - 1] = '\n' then len - 2 else len - 1 in
    let rec scan i seen =
      if i < 0 then 0
      else if s.[i] = '\n' then
        if seen + 1 >= n then i + 1 else scan (i - 1) (seen + 1)
      else scan (i - 1) seen
    in
    let start = if scan_from < 0 then 0 else scan (scan_from) 0 in
    String.sub s start (len - start)

(* Last [max_display_bytes] bytes, then further limited to the last
   [max_display_lines] lines (whichever tail is shorter), matching Pi. *)
let display_tail s =
  let by_bytes =
    if String.length s > max_display_bytes then
      String.sub s (String.length s - max_display_bytes) max_display_bytes
    else s
  in
  last_lines by_bytes max_display_lines

let js_require name =
  Unsafe.fun_call (Unsafe.js_expr "require") [| js_string name |]

let node_process () = Unsafe.get Unsafe.global "process"

let js_error message =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Error") [| js_string message |]

let reject_error reject message =
  ignore (Unsafe.fun_call reject [| inject (js_error message) |])

let property obj name =
  optional_field obj name

let data_to_string data =
  match function_field data "toString" with
  | None -> ""
  | Some _ ->
    match
      string_value (Unsafe.meth_call data "toString" [| js_string "utf8" |])
    with
    | Some value -> value
    | None -> ""

let int_from_js_default value default =
  match float_value value with
  | Some value -> int_of_float value
  | None -> default

let math_random () =
  let m = Unsafe.get Unsafe.global "Math" in
  Option.value (float_value (Unsafe.fun_call (Unsafe.get m "random") [||])) ~default:0.

let os_tmpdir () =
  let os = js_require "node:os" in
  match string_value (Unsafe.fun_call (Unsafe.get os "tmpdir") [||]) with
  | Some dir when dir <> "" -> dir
  | _ -> "/tmp"

let path_join a b =
  let path = js_require "node:path" in
  match
    string_value
      (Unsafe.fun_call (Unsafe.get path "join") [| js_string a; js_string b |])
  with
  | Some p -> p
  | None -> a ^ "/" ^ b

(* Lazily open the full-output temp file on first output. *)
let ensure_temp_file (session : session) =
  match session.temp_fd with
  | Some _ -> ()
  | None -> (
      try
        let name =
          Printf.sprintf "taumel-exec-%d-%d.log" session.id
            (int_of_float (math_random () *. 1.0e9))
        in
        let path = path_join (os_tmpdir ()) name in
        let fs = js_require "node:fs" in
        let fd =
          Unsafe.fun_call (Unsafe.get fs "openSync")
            [| js_string path; js_string "a" |]
        in
        session.temp_path <- Some path;
        session.temp_fd <- Some fd
      with _ -> ())

let write_temp (session : session) text =
  match session.temp_fd with
  | None -> ()
  | Some fd -> (
      try
        let fs = js_require "node:fs" in
        ignore (Unsafe.fun_call (Unsafe.get fs "writeSync") [| fd; js_string text |])
      with _ -> ())

(* stdout and stderr are merged into one ordered stream (Pi semantics). The full
   stream goes to the temp file; only a bounded rolling tail stays in memory. *)
let add_output (session : session) text =
  if text <> "" then begin
    ensure_temp_file session;
    write_temp session text;
    session.chunk_bytes <- session.chunk_bytes + String.length text;
    session.chunk_lines <- session.chunk_lines + count_newlines text;
    Buffer.add_string session.pending text;
    if Buffer.length session.pending > pending_cap then begin
      let s = Buffer.contents session.pending in
      let keep = String.sub s (String.length s - pending_cap) pending_cap in
      Buffer.clear session.pending;
      Buffer.add_string session.pending keep;
      session.chunk_trimmed <- true
    end
  end

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
  match process_pid session with
  | None -> ()
  | Some pid -> kill_pid pid

let timer_set callback delay_ms =
  Unsafe.fun_call (Unsafe.get Unsafe.global "setTimeout")
    [| inject (Js.wrap_callback callback); js_number delay_ms |]

let timer_clear timer =
  match function_field Unsafe.global "clearTimeout" with
  | None -> ()
  | Some clear_timeout -> ignore (Unsafe.fun_call clear_timeout [| timer |])

let signal_aborted signal =
  (not (is_nullish signal)) && get_bool signal "aborted"

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

let close_temp (session : session) =
  (match session.temp_fd with
  | None -> ()
  | Some fd -> (
      try
        let fs = js_require "node:fs" in
        ignore (Unsafe.fun_call (Unsafe.get fs "closeSync") [| fd |])
      with _ -> ()));
  session.temp_fd <- None

(* Compute the display output (last 2000 lines / 50KB) with Pi's truncation
   footer, WITHOUT mutating the session. Shared by the inline drain
   (make_result) and the background completion notification. *)
let display_output (session : session) =
  let raw = Buffer.contents session.pending in
  let disp = display_tail raw in
  let truncated =
    session.chunk_trimmed
    || session.chunk_bytes > max_display_bytes
    || session.chunk_lines > max_display_lines
  in
  let output =
    if not truncated then disp
    else begin
      let shown =
        count_newlines disp
        + (if disp <> "" && disp.[String.length disp - 1] <> '\n' then 1 else 0)
      in
      let footer =
        match session.temp_path with
        | None -> ""
        | Some path ->
            let total = max session.chunk_lines shown in
            let start_line = max 1 (total - shown + 1) in
            Printf.sprintf
              "[Showing lines %d-%d of %d. Full output: %s]" start_line total
              total path
      in
      if footer = "" then disp
      else if disp = "" then footer
      else disp ^ "\n\n" ^ footer
    end
  in
  let full_output_path = if truncated then session.temp_path else None in
  (output, truncated, full_output_path)

(* Drain the unread chunk for display: the last 2000 lines / 50KB, with a Pi
   footer when the chunk was truncated (the full output stays in the temp file).
   Resets the per-chunk accounting so the next call returns only new output. *)
let make_result (session : session) =
  let output, truncated, full_output_path = display_output session in
  Buffer.clear session.pending;
  session.chunk_bytes <- 0;
  session.chunk_lines <- 0;
  session.chunk_trimmed <- false;
  let base =
    {
      output;
      truncated;
      full_output_path;
      wall_time_ms = now_ms () -. session.started_at;
      session_id = None;
      exit_code = None;
    }
  in
  if session.exited then
    { base with exit_code = Some (Option.value session.exit_code ~default:1) }
  else (
    session.session_id_exposed <- true;
    { base with session_id = Some session.id })

let shell_result_text result =
  let body =
    if result.output = "" then
      match result.session_id with Some _ -> "" | None -> "(no output)"
    else result.output
  in
  let append status = if body = "" then status else body ^ "\n\n" ^ status in
  match (result.session_id, result.exit_code) with
  | Some id, _ ->
      append
        (Printf.sprintf "[Running - session %d; use write_stdin to read more]" id)
  | None, Some code when code <> 0 ->
      append (Printf.sprintf "Command exited with code %d" code)
  | _ -> body

let shell_result_details result extra =
  let fields =
    [
      ( "ok",
        js_bool (match result.exit_code with None -> true | Some code -> code = 0)
      );
      ("output", js_string result.output);
      ("wallTimeMs", js_number result.wall_time_ms);
    ]
  in
  let fields =
    if result.truncated then fields @ [ ("truncated", js_bool true) ] else fields
  in
  let fields =
    match result.full_output_path with
    | Some path -> fields @ [ ("fullOutputPath", js_string path) ]
    | None -> fields
  in
  let fields =
    match result.exit_code with
    | None -> fields
    | Some code ->
        fields
        @ [
            ("exitCode", js_number (float_of_int code));
            ("code", js_number (float_of_int code));
          ]
  in
  let fields =
    match result.session_id with
    | None -> fields
    | Some id ->
        fields
        @ [
            ("sessionId", js_number (float_of_int id));
            ("session_id", js_number (float_of_int id));
          ]
  in
  merge_js_details (Unsafe.obj (Array.of_list fields)) extra

let shell_tool_result result extra =
  tool_result_envelope
    (Unsafe.obj
       [|
         ("text", js_string (shell_result_text result));
         ("details", shell_result_details result extra);
       |])

let node_env tty ~shell =
  let process = node_process () in
  let env = Unsafe.get process "env" in
  let assign overrides =
    Unsafe.fun_call (Unsafe.get (Unsafe.get Unsafe.global "Object") "assign")
      [| inject (Unsafe.obj [||]); inject env; inject (Unsafe.obj overrides) |]
  in
  if tty then
    let term =
      match optional_string_field env "TERM" with
      | Some value when value <> "" -> value
      | _ -> "xterm-256color"
    in
    assign [| ("TERM", js_string term) |]
  else
    (* Non-interactive hygiene (improves on Pi): strip colour, disable pagers
       and cursor-addressing, and make git fail fast instead of waiting on a
       terminal. Honour an explicit ambient GIT_TERMINAL_PROMPT. SHELL points at
       the resolved bash so child tools that spawn $SHELL get bash. *)
    let git_prompt =
      match optional_string_field env "GIT_TERMINAL_PROMPT" with
      | Some value when value <> "" -> value
      | _ -> "0"
    in
    assign
      [|
        ("NO_COLOR", js_string "1");
        ("TERM", js_string "dumb");
        ("GIT_TERMINAL_PROMPT", js_string git_prompt);
        ("SHELL", js_string shell);
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
                    add_output session (data_to_string data);
                    notify session));
           |])

let spawn_session session ~file ~args ~cwd =
  let fs = js_require "node:fs" in
  let exists = Unsafe.fun_call (Unsafe.get fs "existsSync") [| js_string cwd |] in
  if not (Js.to_bool (Unsafe.coerce exists)) then
    failwith ("Working directory does not exist: " ^ cwd);
  let child_process = js_require "node:child_process" in
  let child =
    Unsafe.fun_call (Unsafe.get child_process "spawn")
      [|
        js_string file;
        js_array (List.map js_string args);
        inject (spawn_options cwd session.tty ~shell:file);
      |]
  in
  session.child <- Some child;
  wire_stream session child "stdout";
  wire_stream session child "stderr";
  ignore
    (Unsafe.meth_call child "on"
       [|
         js_string "close";
         inject
           (Js.wrap_callback (fun code ->
                session.exited <- true;
                session.exit_code <- Some (int_from_js_default code 1);
                notify session));
       |]);
  ignore
    (Unsafe.meth_call child "on"
       [|
         js_string "error";
         inject
           (Js.wrap_callback (fun error ->
                let message =
                  match optional_string_field error "message" with
                  | Some message when message <> "" -> message
                  | _ -> js_error_to_string error
                in
                add_output session (message ^ "\n");
                session.exited <- true;
                session.exit_code <- Some 1;
                notify session));
       |])

let new_session owner_id tty =
  let id = !next_session_id in
  incr next_session_id;
  {
    id;
    owner_id;
    started_at = now_ms ();
    tty;
    child = None;
    pending = Buffer.create 256;
    chunk_bytes = 0;
    chunk_lines = 0;
    chunk_trimmed = false;
    temp_path = None;
    temp_fd = None;
    exited = false;
    exit_code = None;
    session_id_exposed = false;
    terminal_consumed = false;
    notification_sent = false;
    waiters = [];
    next_waiter_id = 1;
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
      retained_exit_code = session.exit_code;
    };
  prune_retained_sessions session.owner_id

let finish_session session extra resolve =
  let result = make_result session in
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

let promise_of_session session yield_ms ?timeout_ms signal extra =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Promise")
    [|
      inject
        (Js.wrap_callback (fun resolve reject ->
             let settled = ref false in
             let timeout_ref = ref None in
             let cleanup () = Option.iter timer_clear !timeout_ref in
             let resolve_once () =
               if not !settled then (
                 settled := true;
                 cleanup ();
                 finish_session session extra resolve)
             in
             let reject_once message =
               if not !settled then (
                 settled := true;
                 cleanup ();
                 kill_session session;
                 close_temp session;
                 Hashtbl.remove sessions session.id;
                 reject_error reject message)
             in
             let on_abort () =
               let body = (make_result session).output in
               let message =
                 if body = "" then "Command aborted"
                 else body ^ "\n\nCommand aborted"
               in
               reject_once message
             in
             if signal_aborted signal then on_abort ()
             else (
               timeout_ref :=
                 (match timeout_ms with
                 | Some timeout_ms when timeout_ms > 0. ->
                     Some (timer_set (fun () -> kill_session session) timeout_ms)
                 | _ -> None);
               wait_for_settle session yield_ms signal ~on_done:resolve_once
                 ~on_abort;
               ())));
    |]

let run_exec_command prepared host runtime owner_id signal force_unsandboxed =
  match Sandbox_bridge.planned_exec_host_call prepared host runtime force_unsandboxed with
  | Error message -> rejected_promise message
  | Ok call ->
      let session = new_session owner_id call.tty in
      (try
         spawn_session session ~file:call.invocation.command
           ~args:call.invocation.args ~cwd:call.cwd
       with exn ->
         let message = Printexc.to_string exn ^ "\n" in
         add_output session message;
         session.exited <- true;
         session.exit_code <- Some 1);
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
        ?timeout_ms:call.timeout_ms signal extra

let write_stdin prepared owner_id =
  match int_field prepared "sessionId" with
  | None -> rejected_promise "write_stdin requires sessionId"
  | Some session_id -> (
  match Hashtbl.find_opt sessions session_id with
  | None -> (
      match Hashtbl.find_opt retained_sessions session_id with
      | Some retained when retained.retained_owner_id <> owner_id ->
          rejected_promise
            (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
      | Some retained ->
          let chars = get_string prepared "chars" in
          if chars <> "" then
            rejected_promise
              (Printf.sprintf "session %d already completed; cannot write stdin" session_id)
          else
            let result =
              {
                output =
                  Printf.sprintf
                    "(session %d already completed; no new output)" session_id;
                truncated = false;
                full_output_path = None;
                wall_time_ms = 0.;
                session_id = None;
                exit_code = None;
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
      let chars = get_string prepared "chars" in
      let stdin_error =
        if chars <> "" && session.exited then
          Some
            (Printf.sprintf "session %d already completed; cannot write stdin"
               session_id)
        else if chars = "" then None
        else
          match (session.tty, Option.bind session.child (fun child -> property child "stdin")) with
          | true, Some stdin when get_bool stdin "writable" ->
              ignore (Unsafe.meth_call stdin "write" [| js_string chars |]);
              None
          | _ ->
              Some
                "stdin is closed for this session; rerun exec_command with tty=true to keep stdin open"
      in
      (match stdin_error with
      | Some message -> rejected_promise message
      | None ->
        let extra = Unsafe.obj [| ("kind", js_string "write_stdin") |] in
        promise_of_session session
          (normalize_write_yield_ms
             (optional_positive_float prepared "yieldTimeMs")
             (chars = ""))
          (Unsafe.inject Js.undefined)
          extra)
  )

let shutdown_owner owner_id =
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
  ok_obj [ ("action", js_string "shutdown_exec_owner") ]

(* Background completion notification (mirrors subagent completion delivery).

   An async session (one that returned a sessionId) that exits while no call is
   consuming its terminal result is left in [sessions] with [exited = true].
   Notification delivery marks only [notification_sent]; an explicit
   write_stdin poll is still required to consume and remove the terminal
   result. Synchronous commands, aborted commands, and owner-shutdown kills are
   removed, so they never appear here. *)

let exec_notification_content (session : session) =
  Printf.sprintf
    "Command session %d has finished. To read and consume the result, call write_stdin with session_id=%d, chars=\"\", yield_time_ms=5000."
    session.id session.id

(* Pending deliverable background completions for [owner_id]: terminal sessions
   that have not yet been consumed and whose completion notification has not
   been sent. Read-only; successful delivery updates only notification state. *)
let pending_exec_notifications owner_id =
  let pending =
    Hashtbl.fold
      (fun _ session acc ->
        if
          session.owner_id = owner_id && session.exited
          && (not session.terminal_consumed)
          && not session.notification_sent
        then session :: acc
        else acc)
      sessions []
  in
  let pending = List.sort (fun a b -> compare a.id b.id) pending in
  let notification (session : session) =
    Unsafe.obj
      [|
        ("session_id", js_number (float_of_int session.id));
        ("customType", js_string "notification");
        ("content", js_string (exec_notification_content session));
        ("display", js_bool true);
      |]
  in
  ok_obj [ ("notifications", js_array (List.map notification pending)) ]

let mark_exec_notification_delivered session_id =
  (match Hashtbl.find_opt sessions session_id with
  | Some session ->
      session.notification_sent <- true
  | None -> ());
  ok_obj [ ("action", js_string "mark_exec_notification_delivered") ]

(* Resolves when the session has exited (or is already gone/drained), without
   draining or removing it, so the turn_end/idle flush can deliver its output.
   The TS layer starts this detached for each async session and, on resolution,
   does an idle flush (triggerTurn) - the exec analogue of the subagent
   onCompletion -> deliverCompletionIfParentIdle path. *)
let await_exec_completion session_id =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Promise")
    [|
      inject
        (Js.wrap_callback (fun resolve _reject ->
             let resolve_now () =
               ignore
                 (Unsafe.fun_call resolve
                    [| inject (ok_obj [ ("exited", js_bool true) ]) |])
             in
             let rec wait () =
               match Hashtbl.find_opt sessions session_id with
               | None -> resolve_now ()
               | Some session when session.exited -> resolve_now ()
               | Some session -> ignore (add_waiter session (fun () -> wait ()))
             in
             wait ()));
    |]
