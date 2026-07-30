module Binding =
  [%js:
  module Process : sig
    type t = private Ojs.t

    val kill : t -> string -> bool [@@js.call]
  end

  type exec_file_callback = Ojs.t -> string -> string -> unit [@@js.callback]

  type t = private Ojs.t

  val t_of_js : Ojs.t -> t

  val t_to_js : t -> Ojs.t

  val exec_file_sync : t -> string -> Ojs.t -> Ojs.t -> Ojs.t [@@js.call]

  val exec_file :
    t -> string -> Ojs.t -> Ojs.t -> exec_file_callback -> Process.t
  [@@js.call]]

type process = Binding.Process.t

let m = lazy (Binding.t_of_js (Node_require.require "child_process"))

let force () = Lazy.force m

let args_to_js args = Ojs.list_to_js Ojs.string_to_js args

let exec_file_sync ~file ~args ~options =
  let result =
    Binding.exec_file_sync (force ()) file (args_to_js args) options
  in
  match Ojs.type_of result with
  | "string" -> Ojs.string_of_js result
  | _ -> Node_buffer.data_to_string result

let exec_file ~file ~args ~options callback =
  Binding.exec_file (force ()) file (args_to_js args) options callback

let kill process signal = Binding.Process.kill process signal

let stdio_ignore_pipe_pipe () =
  Ojs.list_to_js Ojs.string_to_js [ "ignore"; "pipe"; "pipe" ]

let utf8_options ?cwd ?env ?kill_signal ?max_buffer () =
  let obj = Ojs.empty_obj () in
  Ojs.set_prop_ascii obj "encoding" (Ojs.string_to_js "utf8");
  Ojs.set_prop_ascii obj "stdio" (stdio_ignore_pipe_pipe ());
  (match cwd with
  | Some value -> Ojs.set_prop_ascii obj "cwd" (Ojs.string_to_js value)
  | None -> ());
  (match env with
  | Some value -> Ojs.set_prop_ascii obj "env" value
  | None -> ());
  (match kill_signal with
  | Some value -> Ojs.set_prop_ascii obj "killSignal" (Ojs.string_to_js value)
  | None -> ());
  (match max_buffer with
  | Some value -> Ojs.set_prop_ascii obj "maxBuffer" (Ojs.int_to_js value)
  | None -> ());
  obj
