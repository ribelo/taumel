module Date =
  [%js:
  type t = private Ojs.t

  val t_of_js : Ojs.t -> t

  val t_to_js : t -> Ojs.t

  val create : float -> t [@@js.new "Date"]

  val to_locale_string : t -> string [@@js.call "toLocaleString"]

  val get_timezone_offset : t -> float [@@js.call "getTimezoneOffset"]]

type t = Date.t

let t_of_js = Date.t_of_js

let t_to_js = Date.t_to_js

let of_unix_ms ms = Date.create ms

let of_unix_seconds seconds = Date.create (float_of_int seconds *. 1000.)

let to_locale_string date = Date.to_locale_string date

let get_timezone_offset date = Date.get_timezone_offset date
