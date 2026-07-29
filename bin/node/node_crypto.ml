module Hash = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val update : t -> Ojs.t -> unit [@@js.call]
  val digest : t -> string -> string [@@js.call]
]

module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val create_hash : t -> string -> Hash.t [@@js.call "createHash"]
  val random_bytes : t -> int -> Ojs.t [@@js.call "randomBytes"]
]

let m = lazy (Binding.t_of_js (Node_require.require "crypto"))
let force () = Lazy.force m

let digest_hex value =
  let hash = Binding.create_hash (force ()) "sha256" in
  Hash.update hash value;
  Hash.digest hash "hex"

let sha256_hex value = digest_hex (Ojs.string_to_js value)

let sha256_bytes value = digest_hex value

let random_hex size =
  let bytes = Binding.random_bytes (force ()) size in
  Node_buffer.to_string (Node_buffer.t_of_js bytes) "hex"
