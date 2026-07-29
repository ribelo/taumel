module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val join : t -> (string list[@js.variadic]) -> string [@@js.call]
  val resolve : t -> (string list[@js.variadic]) -> string [@@js.call]
  val dirname : t -> string -> string [@@js.call]
  val basename : t -> string -> string [@@js.call]
  val delimiter : t -> string [@@js.get]
]

let m = lazy (Binding.t_of_js (Node_require.require "path"))
let force () = Lazy.force m

let join parts = Binding.join (force ()) parts
let resolve parts = Binding.resolve (force ()) parts
let dirname path = Binding.dirname (force ()) path
let basename path = Binding.basename (force ()) path
let delimiter () = Binding.delimiter (force ())
