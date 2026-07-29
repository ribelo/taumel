module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val tmpdir : t -> string [@@js.call]
  val homedir : t -> string [@@js.call]
  val user_info : t -> Ojs.t [@@js.call]
]

let m = lazy (Binding.t_of_js (Node_require.require "os"))
let force () = Lazy.force m

let tmpdir () =
  match Binding.tmpdir (force ()) with
  | "" -> "/tmp"
  | dir -> dir

let homedir () = Binding.homedir (force ())

let user_info_username () =
  try
    let info = Binding.user_info (force ()) in
    match Ojs.type_of (Ojs.get_prop_ascii info "username") with
    | "string" -> Some (Ojs.string_of_js (Ojs.get_prop_ascii info "username"))
    | _ -> None
  with _ -> None
