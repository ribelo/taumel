open Jsoo_bridge

type t = {
  child : Unsafe.any;
  tty : bool;
}

let data_to_string data = Node_buffer.data_to_string (ojs_of_js data)

let node_env ~shell =
  let overrides =
    Node_object.of_fields
      [
        Node_object.string_field "NO_COLOR" "1";
        Node_object.string_field "TERM" "dumb";
        Node_object.string_field "LANG" "C.UTF-8";
        Node_object.string_field "LC_CTYPE" "C.UTF-8";
        Node_object.string_field "LC_ALL" "C.UTF-8";
        Node_object.string_field "COLORTERM" "";
        Node_object.string_field "PAGER" "cat";
        Node_object.string_field "GIT_PAGER" "cat";
        Node_object.string_field "GIT_TERMINAL_PROMPT" "0";
        Node_object.string_field "SHELL" shell;
      ]
  in
  js_of_ojs (Node_object.assign [ Node_process.env (); overrides ])

let process_pid process =
  match int_field process.child "pid" with
  | Some pid when pid > 0 -> Some pid
  | _ -> None

let request_sigterm process =
  let kill pid =
    try Node_process.kill pid "SIGTERM" with _ -> ()
  in
  (match process_pid process with
  | Some pid when Node_process.platform () <> "win32" ->
      kill (-pid);
      kill pid
  | Some pid -> kill pid
  | None -> ());
  if process.tty then
    try ignore (Unsafe.meth_call process.child "kill" [||]) with _ -> ()

let write process chars =
  if not process.tty then Error "stdin is closed for this session"
  else
    try
      ignore (Unsafe.meth_call process.child "write" [| js_string chars |]);
      Ok ()
    with _ -> Error "stdin is closed for this session"

let spawn ~file ~args ~cwd ?env ~tty ~on_data ~on_exit () =
  if not (Node_fs.exists_sync cwd) then
    failwith ("Working directory does not exist: " ^ cwd);
  let node_pty = node_require "node-pty" in
  let options =
    Unsafe.obj
      [|
        ("name", js_string "dumb");
        ("cols", js_number 80.);
        ("rows", js_number 24.);
        ("cwd", js_string cwd);
        ("env", Option.value env ~default:(node_env ~shell:file));
      |]
  in
  let child =
    Unsafe.fun_call (Unsafe.get node_pty "spawn")
      [| js_string file; js_array (List.map js_string args); inject options |]
  in
  let process = { child; tty } in
  ignore
    (Unsafe.meth_call child "onData"
       [|
         inject
           (Js.wrap_callback (fun data ->
                if on_data (data_to_string data) then request_sigterm process));
       |]);
  ignore
    (Unsafe.meth_call child "onExit"
       [|
         inject
           (Js.wrap_callback (fun event ->
                on_exit (int_field_default event "exitCode" 1)));
       |]);
  process
