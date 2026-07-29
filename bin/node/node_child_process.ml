module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val exec_file_sync : t -> string -> Ojs.t -> Ojs.t -> Ojs.t [@@js.call]
]

let m = lazy (Binding.t_of_js (Node_require.require "child_process"))
let force () = Lazy.force m

let args_to_js args =
  Ojs.list_to_js Ojs.string_to_js args

let exec_file_sync ~file ~args ~options =
  let result =
    Binding.exec_file_sync (force ()) file (args_to_js args) options
  in
  match Ojs.type_of result with
  | "string" -> Ojs.string_of_js result
  | _ -> Node_buffer.data_to_string result

let stdio_ignore_pipe_pipe () =
  Ojs.list_to_js Ojs.string_to_js [ "ignore"; "pipe"; "pipe" ]

let utf8_options ?cwd ?env () =
  let obj = Ojs.empty_obj () in
  Ojs.set_prop_ascii obj "encoding" (Ojs.string_to_js "utf8");
  Ojs.set_prop_ascii obj "stdio" (stdio_ignore_pipe_pipe ());
  (match cwd with
  | Some value -> Ojs.set_prop_ascii obj "cwd" (Ojs.string_to_js value)
  | None -> ());
  (match env with
  | Some value -> Ojs.set_prop_ascii obj "env" value
  | None -> ());
  obj
