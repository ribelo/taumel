module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val env : t -> Ojs.t [@@js.get]
  val platform : t -> string [@@js.get]
  val pid : t -> float [@@js.get]
  val argv : t -> Ojs.t [@@js.get]
  val kill : t -> float -> string -> unit [@@js.call]
  val get_builtin_module : t -> string -> Ojs.t [@@js.call]
]

let process () = Binding.t_of_js (Ojs.get_prop_ascii Ojs.global "process")
let to_js () = Binding.t_to_js (process ())

let env () =
  try Binding.env (process ()) with _ -> Ojs.empty_obj ()

let env_get name =
  let value = Ojs.get_prop_ascii (env ()) name in
  match Ojs.type_of value with
  | "string" -> Some (Ojs.string_of_js value)
  | _ -> None

let env_string name = Option.value (env_get name) ~default:""

let env_set name value = Ojs.set_prop_ascii (env ()) name (Ojs.string_to_js value)

let env_delete name = Ojs.delete_prop_ascii (env ()) name

let platform () =
  try Binding.platform (process ()) with _ -> ""

let pid () =
  try int_of_float (Binding.pid (process ())) with _ -> 0

let argv () =
  try Ojs.list_of_js Ojs.string_of_js (Binding.argv (process ())) with _ -> []

let kill pid signal =
  Binding.kill (process ()) (float_of_int pid) signal

let as_ojs () = to_js ()
