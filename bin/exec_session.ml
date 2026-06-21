open Jsoo_bridge

type session = {
  id : int;
  owner_id : string;
  started_at : float;
  tty : bool;
  mutable child : Unsafe.any option;
  mutable output : string;
  mutable stdout : string;
  mutable stderr : string;
  mutable read_offset : int;
  mutable exited : bool;
  mutable exit_code : int option;
  mutable waiters : (int * (unit -> unit)) list;
  mutable next_waiter_id : int;
}

type run_result = {
  output : string;
  stdout : string;
  stderr : string;
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

let max_chars_from_tokens = function
  | Some tokens when tokens > 0. ->
      max 1_000 (min (int_of_float (Float.round (tokens *. 4.))) 200_000)
  | _ -> 40_000

let truncate_output output max_output_tokens =
  let max_chars = max_chars_from_tokens max_output_tokens in
  if String.length output <= max_chars then output
  else
    let omitted = String.length output - max_chars in
    Printf.sprintf "[output truncated, omitted %d chars]\n%s" omitted
      (String.sub output omitted max_chars)

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

let add_output (session : session) ~stderr text =
  if stderr then session.stderr <- session.stderr ^ text
  else session.stdout <- session.stdout ^ text;
  session.output <- session.output ^ text

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

let drain_output (session : session) max_output_tokens =
  let start = session.read_offset in
  let length = String.length session.output - start in
  let output = if length <= 0 then "" else String.sub session.output start length in
  session.read_offset <- String.length session.output;
  truncate_output output max_output_tokens

let make_result (session : session) output max_output_tokens =
  let base =
    {
      output;
      stdout = truncate_output session.stdout max_output_tokens;
      stderr = truncate_output session.stderr max_output_tokens;
      wall_time_ms = now_ms () -. session.started_at;
      session_id = None;
      exit_code = None;
    }
  in
  if session.exited then { base with exit_code = Some (Option.value session.exit_code ~default:1) }
  else { base with session_id = Some session.id }

let shell_result_text result =
  let parts =
    [
      Printf.sprintf "Wall time: %.4f seconds" (result.wall_time_ms /. 1000.);
    ]
  in
  let parts =
    match result.exit_code with
    | None -> parts
    | Some code -> parts @ [ Printf.sprintf "Process exited with code %d" code ]
  in
  let parts =
    match result.session_id with
    | None -> parts
    | Some id -> parts @ [ Printf.sprintf "Process running with session ID %d" id ]
  in
  String.concat "\n" (parts @ [ "Output:"; result.output ])

let shell_result_details result extra =
  let fields =
    [
      ("ok", js_bool (match result.exit_code with None -> true | Some code -> code = 0));
      ("output", js_string result.output);
      ("stdout", js_string result.stdout);
      ("stderr", js_string result.stderr);
      ("wallTimeMs", js_number result.wall_time_ms);
    ]
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

let node_env tty =
  let process = node_process () in
  let env = Unsafe.get process "env" in
  if not tty then env
  else
    let term =
      match optional_string_field env "TERM" with
      | Some value when value <> "" -> value
      | _ -> "xterm-256color"
    in
    Unsafe.fun_call (Unsafe.get (Unsafe.get Unsafe.global "Object") "assign")
      [|
        inject (Unsafe.obj [||]);
        inject env;
        inject (Unsafe.obj [| ("TERM", js_string term) |]);
      |]

let spawn_options cwd tty =
  let process = node_process () in
  Unsafe.obj
    [|
      ("cwd", js_string cwd);
      ("detached", js_bool (get_string process "platform" <> "win32"));
      ("env", node_env tty);
      ( "stdio",
        js_array
          [
            js_string (if tty then "pipe" else "ignore");
            js_string "pipe";
            js_string "pipe";
          ] );
      ("windowsHide", js_bool true);
    |]

let wire_stream session child name ~stderr =
  match property child name with
  | None -> ()
  | Some stream ->
      ignore
        (Unsafe.meth_call stream "on"
           [|
             js_string "data";
             inject
               (Js.wrap_callback (fun data ->
                    add_output session ~stderr (data_to_string data);
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
        inject (spawn_options cwd session.tty);
      |]
  in
  session.child <- Some child;
  wire_stream session child "stdout" ~stderr:false;
  wire_stream session child "stderr" ~stderr:true;
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
                add_output session ~stderr:true (message ^ "\n");
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
    output = "";
    stdout = "";
    stderr = "";
    read_offset = 0;
    exited = false;
    exit_code = None;
    waiters = [];
    next_waiter_id = 1;
  }

let finish_session session max_output_tokens extra resolve =
  let output = drain_output session max_output_tokens in
  if session.exited then Hashtbl.remove sessions session.id;
  let result = make_result session output max_output_tokens in
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

let promise_of_session session max_output_tokens yield_ms ?timeout_ms signal extra =
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
                 finish_session session max_output_tokens extra resolve)
             in
             let reject_once message =
               if not !settled then (
                 settled := true;
                 cleanup ();
                 kill_session session;
                 Hashtbl.remove sessions session.id;
                 reject_error reject message)
             in
             let on_abort () = reject_once "Shell command aborted" in
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
         session.stderr <- message;
         session.output <- message;
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
      promise_of_session session call.max_output_tokens
        (normalize_exec_yield_ms call.yield_time_ms)
        ?timeout_ms:call.timeout_ms signal extra

let write_stdin prepared owner_id =
  match int_field prepared "sessionId" with
  | None -> rejected_promise "write_stdin requires sessionId"
  | Some session_id -> (
  match Hashtbl.find_opt sessions session_id with
  | None -> rejected_promise (Printf.sprintf "Unknown shell session: %d" session_id)
  | Some session when session.owner_id <> owner_id ->
      rejected_promise
        (Printf.sprintf "Shell session %d belongs to another pi session" session_id)
  | Some session ->
      let chars = get_string prepared "chars" in
      let stdin_error =
        if chars = "" || session.exited then None
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
          (optional_positive_float prepared "maxOutputTokens")
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
        None)
      else Some session)
    sessions;
  ok_obj [ ("action", js_string "shutdown_exec_owner") ]
