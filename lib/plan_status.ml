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

let create_task_error = function
  | Draft -> invalid_arg "draft plans permit task creation"
  | Active ->
      "cannot create plan tasks because the current status is active; ask the \
       user to run /plan draft to enable editing"
  | Blocked ->
      "cannot create plan tasks because the current status is blocked; call \
       update_plan with status active and a non-empty resolution to unblock, \
       or ask the user to run /plan draft to enable editing"
  | Paused ->
      "cannot create plan tasks because the current status is paused; the user \
       must run /plan resume to continue, or /plan draft to enable editing"
  | Time_limited ->
      "cannot create plan tasks because the current status is time_limited; \
       the user must run /plan resume with a usable time limit, or /plan draft \
       to enable editing"
  | Complete ->
      "cannot create plan tasks because the current status is complete; a \
       completed plan may be extended after its turn ends"

let edit_error action = function
  | Draft ->
      Printf.sprintf
        "cannot %s because the current status is draft; ask the user to run \
         /plan resume to activate the plan"
        action
  | Active ->
      Printf.sprintf
        "cannot %s because the current status is active; ask the user to run \
         /plan draft to enable content editing"
        action
  | Blocked ->
      Printf.sprintf
        "cannot %s because the current status is blocked; call update_plan \
         with status active and a non-empty resolution to unblock"
        action
  | Paused ->
      Printf.sprintf
        "cannot %s because the current status is paused; the user must run \
         /plan resume"
        action
  | Time_limited ->
      Printf.sprintf
        "cannot %s because the current status is time_limited; the user must \
         run /plan resume with a usable time limit"
        action
  | Complete ->
      Printf.sprintf
        "cannot %s because the current status is complete; ask the user to run \
         /plan draft to enable editing"
        action

let update_plan_error ~extension_unlocked ~requested current =
  match (requested, current) with
  | Active, Paused ->
      "update_plan cannot activate because the current status is paused; the \
       user must run /plan resume"
  | Active, Time_limited ->
      "update_plan cannot activate because the current status is time_limited; \
       the user must run /plan resume with a usable time limit"
  | Active, Complete when not extension_unlocked ->
      "update_plan cannot activate because the current status is complete; a \
       completed plan may be extended after its turn ends"
  | Active, Complete ->
      "update_plan cannot activate because the current status is complete; \
       create a task to extend this extension-unlocked plan"
  | Blocked, Draft ->
      "update_plan cannot block because the current status is draft; call \
       update_plan with status active to commit the task list first"
  | Blocked, Paused ->
      "update_plan cannot block because the current status is paused; the user \
       must run /plan resume"
  | Blocked, Time_limited ->
      "update_plan cannot block because the current status is time_limited; \
       the user must run /plan resume with a usable time limit"
  | Blocked, Complete when not extension_unlocked ->
      "update_plan cannot block because the current status is complete; a \
       completed plan may be extended after its turn ends"
  | Blocked, Complete ->
      "update_plan cannot block because the current status is complete; create \
       a task to extend this extension-unlocked plan"
  | _ -> invalid_arg "valid or idempotent update_plan transition"

let pause_error = function
  | Blocked ->
      "cannot pause because the current status is blocked; the agent may call \
       update_plan with status active and a non-empty resolution to unblock, \
       or the user may run /plan draft to enable editing"
  | Time_limited ->
      "cannot pause because the current status is time_limited; the user must \
       run /plan resume with a usable time limit, or /plan draft to enable \
       editing"
  | Complete ->
      "cannot pause because the current status is complete; run /plan draft to \
       enable editing"
  | Draft ->
      "cannot pause because the current status is draft; run /plan resume to \
       activate it, or continue editing"
  | Active | Paused -> invalid_arg "active or idempotent pause transition"
