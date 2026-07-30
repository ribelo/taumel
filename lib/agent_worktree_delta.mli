type t

val empty : t

val added : t -> int

val removed : t -> int

val add : t -> t -> (t, string) result

val parse_numstat : string -> (t, string) result

val baseline_commit : string -> string option
