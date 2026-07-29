module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val from : Ojs.t -> t [@@js.global "Buffer.from"]
  val to_string : t -> string -> string [@@js.call]
  val to_string_default : t -> string [@@js.call "toString"]
]

type t = Binding.t

let t_of_js = Binding.t_of_js
let t_to_js = Binding.t_to_js

let from value = Binding.from value
let to_string buffer encoding = Binding.to_string buffer encoding
let to_string_default value = Binding.to_string_default (t_of_js value)

(** Decode a Node data event payload: plain string, otherwise Buffer/typed
    value [toString("utf8")]. *)
let data_to_string data =
  match Ojs.type_of data with
  | "string" -> Ojs.string_of_js data
  | _ -> (
      try to_string (t_of_js data) "utf8" with _ -> "")

let base64_of_bytes bytes = to_string (from bytes) "base64"
