open Jsoo_bridge
type session = {
  id : int;
  owner_id : string;
  started_at : float;
  tty : bool;
  mutable child : Unsafe.any option;
  pending : Buffer.t;
  mutable pending_start_line : int;
  mutable chunk_bytes : int;
  mutable chunk_lines : int;
  mutable chunk_ends_with_newline : bool;
  mutable chunk_trimmed : bool;
  mutable total_output_bytes : int;
  mutable output_limit_exceeded : bool;
  mutable timeout_exceeded : bool;
  mutable temp_path : string option;
  mutable temp_fd : Unsafe.any option;
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
  retained_exit_code : int option;
}
type truncation = {
  trunc_truncated : bool;
  trunc_truncated_by : string;
  trunc_total_lines : int;
  trunc_total_bytes : int;
  trunc_output_lines : int;
  trunc_output_bytes : int;
  trunc_max_lines : int;
  trunc_max_bytes : int;
  trunc_last_line_partial : bool;
  trunc_first_line_exceeds_limit : bool;
  trunc_full_output_path : string option;
}
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
let max_display_lines = 2000
let max_display_bytes = 50 * 1024
let default_max_output_tokens = 10_000
let approximate_bytes_per_token = 4
let total_output_limit_bytes = 16 * 1024 * 1024
(* In-memory bound for the unread (pending) buffer. The full output always lives
   in the temp file, so trimming the oldest unread bytes never loses data. *)
let pending_cap = total_output_limit_bytes
let count_newlines s =
  let n = ref 0 in
  String.iter (fun c -> if c = '\n' then incr n) s;
  !n
let line_count text =
  if text = "" then 0
  else
    count_newlines text
    + if text.[String.length text - 1] = '\n' then 0 else 1
let split_display_lines text =
  if text = "" then []
  else
    match List.rev (String.split_on_char '\n' text) with
    | "" :: rest -> List.rev rest
    | rest -> List.rev rest
let safe_suffix max_bytes text =
  let len = String.length text in
  if len <= max_bytes then text
  else
    let raw_start = len - max_bytes in
    let rec boundary index =
      if index >= len then len
      else
        let code = Char.code text.[index] in
        if code land 0b1100_0000 = 0b1000_0000 then boundary (index + 1)
        else index
    in
    let start = boundary raw_start in
    String.sub text start (len - start)
let safe_prefix max_bytes text =
  let len = String.length text in
  if len <= max_bytes then text
  else
    let rec boundary index =
      if index <= 0 then 0
      else
        let code = Char.code text.[index] in
        if code land 0b1100_0000 = 0b1000_0000 then boundary (index - 1)
        else index
    in
    let stop = boundary max_bytes in
    String.sub text 0 stop
let truncation_reason ~by_lines ~by_bytes =
  match (by_lines, by_bytes) with
  | false, false -> "none"
  | true, false -> "lines"
  | false, true -> "bytes"
  | true, true -> "lines,bytes"
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
  if text = "" || session.output_limit_exceeded then false
  else begin
    let remaining = max 0 (total_output_limit_bytes - session.total_output_bytes) in
    let accepted = safe_prefix remaining text in
    let crossed = String.length accepted < String.length text in
    session.total_output_bytes <- session.total_output_bytes + String.length accepted;
    if crossed then session.output_limit_exceeded <- true;
    if accepted <> "" then begin
    ensure_temp_file session;
    write_temp session accepted;
    session.chunk_bytes <- session.chunk_bytes + String.length accepted;
    session.chunk_lines <- session.chunk_lines + count_newlines accepted;
    session.chunk_ends_with_newline <- accepted.[String.length accepted - 1] = '\n';
    Buffer.add_string session.pending accepted;
    if Buffer.length session.pending > pending_cap then begin
      let s = Buffer.contents session.pending in
      let drop_bytes = String.length s - pending_cap in
      let dropped = String.sub s 0 drop_bytes in
      let keep = String.sub s drop_bytes pending_cap in
      Buffer.clear session.pending;
      Buffer.add_string session.pending keep;
      session.pending_start_line <- session.pending_start_line + count_newlines dropped;
      session.chunk_trimmed <- true
    end
    end;
    crossed
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
let make_truncation ?full_output_path ?(last_line_partial = false)
    ?(first_line_exceeds_limit = false) ?(max_lines = max_display_lines)
    ?(max_bytes = max_display_bytes) ~truncated ~truncated_by ~total_lines
    ~total_bytes ~output_lines ~output_bytes () =
  {
    trunc_truncated = truncated;
    trunc_truncated_by = truncated_by;
    trunc_total_lines = total_lines;
    trunc_total_bytes = total_bytes;
    trunc_output_lines = output_lines;
    trunc_output_bytes = output_bytes;
    trunc_max_lines = max_lines;
    trunc_max_bytes = max_bytes;
    trunc_last_line_partial = last_line_partial;
    trunc_first_line_exceeds_limit = first_line_exceeds_limit;
    trunc_full_output_path = full_output_path;
  }
let truncation_footer ?(last_line_partial = false) ~start_line ~end_line
    ~total_lines ~shown_bytes ~line_bytes ~reason full_output_path =
  match full_output_path with
  | None -> ""
  | Some path when last_line_partial ->
      Printf.sprintf
        "[Showing last %d bytes of line %d (line is %d bytes). Full output: %s]"
        shown_bytes end_line line_bytes path
  | Some path ->
      Printf.sprintf
        "[Showing lines %d-%d of %d (limited by %s; max %d lines / %d bytes). Full output: %s]"
        start_line end_line total_lines reason max_display_lines max_display_bytes
        path
(* Compute the display output without mutating the session. Shared by the inline
   drain (make_result) and notifications. *)
let display_output (session : session) =
  let raw = Buffer.contents session.pending in
  let total_lines =
    session.chunk_lines
    + if session.chunk_bytes > 0 && not session.chunk_ends_with_newline then 1 else 0
  in
  let total_bytes = session.chunk_bytes in
  let truncated =
    session.chunk_trimmed
    || total_bytes > max_display_bytes
    || total_lines > max_display_lines
  in
  if not truncated then
    let truncation =
      make_truncation ~truncated:false ~truncated_by:"none" ~total_lines
        ~total_bytes ~output_lines:(line_count raw) ~output_bytes:(String.length raw)
        ()
    in
    (raw, truncation)
  else
    let full_output_path = session.temp_path in
    let by_lines = total_lines > max_display_lines in
    let by_bytes = session.chunk_trimmed || total_bytes > max_display_bytes in
    let reason = truncation_reason ~by_lines ~by_bytes in
    let indexed =
      raw |> split_display_lines
      |> List.mapi (fun index line -> (session.pending_start_line + index, line))
    in
    let rec take_tail selected selected_bytes selected_count = function
      | [] -> (`Lines selected, selected_bytes, selected_count)
      | (line_no, line) :: rest ->
          if selected_count >= max_display_lines then
            (`Lines selected, selected_bytes, selected_count)
          else
            let separator = if selected_count = 0 then 0 else 1 in
            let line_bytes = String.length line + separator in
            if selected_bytes + line_bytes <= max_display_bytes then
              take_tail ((line_no, line) :: selected)
                (selected_bytes + line_bytes) (selected_count + 1) rest
            else if selected_count = 0 then
              (`Partial_line (line_no, line), selected_bytes, selected_count)
            else (`Lines selected, selected_bytes, selected_count)
    in
    let selection, selected_bytes, selected_count = take_tail [] 0 0 (List.rev indexed) in
    match selection with
    | `Partial_line (line_no, line) ->
        let shown = safe_suffix max_display_bytes line in
        let shown_bytes = String.length shown in
        let footer =
          truncation_footer ~last_line_partial:true ~start_line:line_no
            ~end_line:line_no ~total_lines ~shown_bytes
            ~line_bytes:(if total_lines = 1 then max (String.length line) total_bytes else String.length line)
            ~reason full_output_path
        in
        let output =
          if footer = "" then shown
          else if shown = "" then footer
          else shown ^ "\n\n" ^ footer
        in
        let truncation =
          make_truncation ?full_output_path ~last_line_partial:true
            ~first_line_exceeds_limit:true ~truncated:true ~truncated_by:reason
            ~total_lines ~total_bytes ~output_lines:1 ~output_bytes:shown_bytes ()
        in
        (output, truncation)
    | `Lines selected ->
        let payload =
          selected |> List.map snd |> String.concat "\n"
        in
        let start_line, end_line =
          match selected with
          | [] -> (0, 0)
          | (first, _) :: rest ->
              let last =
                match List.rev rest with
                | (line_no, _) :: _ -> line_no
                | [] -> first
              in
              (first, last)
        in
        let footer =
          truncation_footer ~start_line ~end_line ~total_lines
            ~shown_bytes:selected_bytes ~line_bytes:selected_bytes ~reason
            full_output_path
        in
        let output =
          if footer = "" then payload
          else if payload = "" then footer
          else payload ^ "\n\n" ^ footer
        in
        let truncation =
          make_truncation ?full_output_path ~truncated:true
            ~truncated_by:reason ~total_lines ~total_bytes
            ~output_lines:selected_count ~output_bytes:selected_bytes ()
        in
        (output, truncation)
let codex_display_output session max_output_tokens =
  let source = Buffer.contents session.pending in
  let total_bytes = String.length source in
  let total_lines = line_count source in
  let budget = max 0 max_output_tokens * approximate_bytes_per_token in
  if total_bytes <= budget then
    ( source,
      make_truncation ?full_output_path:session.temp_path ~truncated:false
        ~truncated_by:"none" ~total_lines ~total_bytes ~output_lines:total_lines
        ~output_bytes:total_bytes ~max_lines:max_int ~max_bytes:budget () )
  else
    let left_budget = budget / 2 in
    let right_budget = budget - left_budget in
    let left = safe_prefix left_budget source in
    let right = safe_suffix right_budget source in
    let removed_bytes = max 0 (total_bytes - String.length left - String.length right) in
    let removed_tokens =
      (removed_bytes + approximate_bytes_per_token - 1) / approximate_bytes_per_token
    in
    let marker = Printf.sprintf "…%d tokens truncated…" removed_tokens in
    let path_notice =
      match session.temp_path with
      | None -> ""
      | Some path -> "\n\n[Output truncated. Full output: " ^ path ^ "]"
    in
    let output = left ^ marker ^ right ^ path_notice in
    ( output,
      make_truncation ?full_output_path:session.temp_path ~truncated:true
        ~truncated_by:"tokens" ~total_lines ~total_bytes
        ~output_lines:(line_count output) ~output_bytes:(String.length output)
        ~max_lines:max_int ~max_bytes:budget () )
(* Drain the unread chunk for display and reset accounting so the next call
   returns only new output. *)
let make_result ?(output_mode = "delta") ?(max_output_tokens = default_max_output_tokens)
    (session : session) =
  let delta_output, delta_truncation = codex_display_output session max_output_tokens in
  let suppressed_lines =
    session.chunk_lines
    + if session.chunk_bytes > 0 && not session.chunk_ends_with_newline then 1 else 0
  in
  let suppressed_bytes = session.chunk_bytes in
  let output, truncation =
    if output_mode = "status" then
      ( "",
        make_truncation ?full_output_path:session.temp_path ~truncated:false
          ~truncated_by:"none" ~total_lines:suppressed_lines
          ~total_bytes:suppressed_bytes ~output_lines:0 ~output_bytes:0 () )
    else (delta_output, delta_truncation)
  in
  Buffer.clear session.pending;
  session.pending_start_line <- 1;
  session.chunk_bytes <- 0;
  session.chunk_lines <- 0;
  session.chunk_ends_with_newline <- false;
  session.chunk_trimmed <- false;
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
      output_limit_exceeded = session.output_limit_exceeded;
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
let typed_truncation truncation =
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
    pending_start_line = 1;
    chunk_bytes = 0;
    chunk_lines = 0;
    chunk_ends_with_newline = false;
    chunk_trimmed = false;
    total_output_bytes = 0;
    output_limit_exceeded = false;
    timeout_exceeded = false;
    temp_path = None;
    temp_fd = None;
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
      retained_exit_code = session.exit_code;
    };
  prune_retained_sessions session.owner_id
let finish_session ?(output_mode = "delta") ?max_output_tokens session extra resolve =
  let result = make_result ~output_mode ?max_output_tokens session in
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
    ?(output_mode = "delta") ?max_output_tokens signal
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
                 finish_session ~output_mode ?max_output_tokens session extra resolve)
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
let run_exec_command prepared host runtime owner_id signal force_unsandboxed =
  match Sandbox_bridge.planned_exec_host_call prepared host runtime force_unsandboxed with
  | Error message -> rejected_promise message
  | Ok call ->
      let session = new_session owner_id call.tty in
      let broker_agent_id =
        match optional_string_field prepared "brokerAgentId" with
        | Some value when String.trim value <> "" -> Some (String.trim value)
        | _ -> None
      in
      (match broker_agent_id with
      | None -> ()
      | Some agent_id -> (
          match Taumel.Agent_git_broker.Lease.try_acquire agent_id with
          | Error message -> failwith message
          | Ok () -> session.broker_agent_id <- Some agent_id));
      (try
         let env =
           if not (get_bool prepared "brokeredGit") then None
           else
             let base = node_env false ~shell:call.invocation.command in
             let extra =
               List.filter_map
                 (fun (field, key) ->
                   match optional_string_field prepared field with
                   | Some v when String.trim v <> "" ->
                       Some (key, js_string (String.trim v))
                   | _ -> None)
                 [ ("gitDir", "GIT_DIR"); ("gitWorkTree", "GIT_WORK_TREE") ]
             in
             let harden =
               [
                 ("GIT_CONFIG_NOSYSTEM", js_string "1");
                 ("GIT_CONFIG_GLOBAL", js_string "/dev/null");
                 ("GIT_CONFIG_SYSTEM", js_string "/dev/null");
                 ("GIT_OPTIONAL_LOCKS", js_string "0");
                 ("GIT_EDITOR", js_string "true");
                 ("GIT_ASKPASS", js_string "true");
               ]
             in
             Some
               (Unsafe.fun_call
                  (Unsafe.get (Unsafe.get Unsafe.global "Object") "assign")
                  [|
                    inject (Unsafe.obj [||]);
                    inject base;
                    inject (Unsafe.obj (Array.of_list (extra @ harden)));
                  |])
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
        ?max_output_tokens:(int_field prepared "maxOutputTokens") signal extra
let write_stdin raw_facts =
  let facts = Tool_contracts.WriteStdinFacts.t_of_js (ojs_of_js raw_facts) in
  let session_id = Tool_contracts.WriteStdinFacts.get_sessionId facts |> int_of_float in
  let chars = Tool_contracts.WriteStdinFacts.get_chars facts in
  let owner_id = Tool_contracts.WriteStdinFacts.get_ownerId facts in
  let signal =
    Tool_contracts.WriteStdinFacts.get_signal facts
    |> Option.map (fun value -> Ts2ocaml.unknown_to_js value |> Obj.magic)
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
(* Background completion notification (mirrors isolated_child completion delivery).
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
(* Pending deliverable background completions for [owner_id]: terminal sessions
   that have not yet been consumed, are not currently claimed by write_stdin,
   and whose completion notification has not been sent. Read-only; successful
   delivery updates only notification state. *)
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
(* Resolves when the session has exited (or is already gone/drained), without
   draining or removing it, so the turn_end/idle flush can deliver its output.
   The TS layer starts this detached for each async session and, on resolution,
   does an idle flush (triggerTurn) - the exec analogue of the isolated_child
   onCompletion -> deliverCompletionIfParentIdle path. *)
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
