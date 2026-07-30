type source

type cleared_by

type open_entry = { blocked_at : int; reason : string; source : source }

type closed_entry = {
  blocked_at : int;
  reason : string;
  source : source;
  cleared_at : int;
  cleared_by : cleared_by;
  resolution : string;
}

type entry = Open of open_entry | Closed of closed_entry

type t

val empty : t

val source_to_string : source -> string

val source_of_string : string -> source option

val cleared_by_to_string : cleared_by -> string

val cleared_by_of_string : string -> cleared_by option

val entries : t -> entry list

val has_open : t -> bool

val open_entry :
  now:int -> reason:string -> source:source -> t -> (t, string) result

val close_open :
  now:int ->
  cleared_by:cleared_by ->
  resolution:string ->
  t ->
  (t, string) result

val agent_source : source

val system_source : source

val agent_clearer : cleared_by

val user_clearer : cleared_by

val to_json : t -> Shared.json

val of_json : Shared.json -> (t, string) result
