type t = Draft | Active | Paused | Blocked | Time_limited | Complete

let to_string = function
  | Draft -> "draft"
  | Active -> "active"
  | Paused -> "paused"
  | Blocked -> "blocked"
  | Time_limited -> "time_limited"
  | Complete -> "complete"

let label = function
  | Draft -> "draft"
  | Active -> "active"
  | Paused -> "paused"
  | Blocked -> "blocked"
  | Time_limited -> "time limited"
  | Complete -> "complete"

let of_string = function
  | "draft" -> Some Draft
  | "active" -> Some Active
  | "paused" -> Some Paused
  | "blocked" -> Some Blocked
  | "time_limited" -> Some Time_limited
  | "complete" -> Some Complete
  | _ -> None

let content_editable = function Draft -> true | _ -> false

let status_editable = function Draft | Active -> true | _ -> false

let terminal = function
  | Blocked | Time_limited | Complete -> true
  | Draft | Active | Paused -> false

let unfinished = function Complete -> false | _ -> true
