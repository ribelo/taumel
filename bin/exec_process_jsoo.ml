open Jsoo_bridge

type t = {
  child : Unsafe.any;
  tty : bool;
}

let node_process () = Unsafe.get Unsafe.global "process"
let require name = Unsafe.fun_call (Unsafe.js_expr "require") [| js_string name |]

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

let node_env ~shell =
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

let process_pid process =
  match int_field process.child "pid" with
  | Some pid when pid > 0 -> Some pid
  | _ -> None

let request_sigterm process =
  let node = node_process () in
  let kill pid =
    try
      ignore
        (Unsafe.meth_call node "kill"
           [| js_number (float_of_int pid); js_string "SIGTERM" |])
    with _ -> ()
  in
  (match process_pid process with
  | Some pid when get_string node "platform" <> "win32" ->
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
  let fs = node_require "node:fs" in
  let exists = Unsafe.fun_call (Unsafe.get fs "existsSync") [| js_string cwd |] in
  if not (Js.to_bool (Unsafe.coerce exists)) then
    failwith ("Working directory does not exist: " ^ cwd);
  let node_pty = require "node-pty" in
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
