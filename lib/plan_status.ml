type t =
  | Draft
  | Active
  | Paused
  | Blocked of Plan_block.open_entry
  | Time_limited
  | Complete

type request = Request_active | Request_blocked

let to_string = function
  | Draft -> "draft"
  | Active -> "active"
  | Paused -> "paused"
  | Blocked _ -> "blocked"
  | Time_limited -> "time_limited"
  | Complete -> "complete"

let label = function
  | Draft -> "draft"
  | Active -> "active"
  | Paused -> "paused"
  | Blocked _ -> "blocked"
  | Time_limited -> "time limited"
  | Complete -> "complete"

let of_string = function
  | "draft" -> Some Draft
  | "active" -> Some Active
  | "paused" -> Some Paused
  | "time_limited" -> Some Time_limited
  | "complete" -> Some Complete
  | "blocked" | _ -> None

let of_wire ~name ~open_entry =
  match (name, open_entry) with
  | "blocked", Some entry -> Ok (Blocked entry)
  | "blocked", None ->
      Error "blocked status requires exactly one open blocks entry"
  | _, Some _ -> Error "an open blocks entry requires blocked plan status"
  | name, None -> (
      match of_string name with
      | Some status -> Ok status
      | None -> Error ("unknown plan status: " ^ name))

let content_editable = function Draft -> true | _ -> false

let status_editable = function Draft | Active -> true | _ -> false

let terminal = function
  | Blocked _ | Time_limited | Complete -> true
  | Draft | Active | Paused -> false

let unfinished = function Complete -> false | _ -> true

let create_task_error = function
  | Draft -> invalid_arg "draft plans permit task creation"
  | Active ->
      "cannot create plan tasks because the current status is active; ask the \
       user to run /plan draft to enable editing"
  | Blocked _ ->
      "cannot create plan tasks because the current status is blocked; ask the \
       user to run /plan draft to enable editing"
  | Paused ->
      "cannot create plan tasks because the current status is paused; the user \
       must run /plan draft to enable editing"
  | Time_limited ->
      "cannot create plan tasks because the current status is time_limited; \
       the user must run /plan draft to enable editing"
  | Complete ->
      "cannot create plan tasks because the current status is complete; a \
       completed plan may be extended after its turn ends"

type task_capability = Status_change | Content_edit

let edit_error ~capability action status =
  let remedy =
    match (capability, status) with
    | Content_edit, _ -> "ask the user to run /plan draft to enable editing"
    | Status_change, Draft ->
        "ask the user to run /plan resume to activate the plan"
    | Status_change, Blocked _ ->
        "call update_plan with status active and a non-empty resolution to \
         unblock"
    | Status_change, (Paused | Time_limited) -> "the user must run /plan resume"
    | Status_change, Complete ->
        "ask the user to run /plan draft to enable editing"
    | Status_change, Active ->
        invalid_arg "active plans permit task status changes"
  in
  Printf.sprintf "cannot %s because the current status is %s; %s" action
    (to_string status) remedy

let update_plan_error ~extension_unlocked ~requested current =
  match (requested, current) with
  | Request_active, Paused ->
      "update_plan cannot activate because the current status is paused; the \
       user must run /plan resume"
  | Request_active, Time_limited ->
      "update_plan cannot activate because the current status is time_limited; \
       the user must run /plan resume with a usable time limit"
  | Request_active, Complete when not extension_unlocked ->
      "update_plan cannot activate because the current status is complete; a \
       completed plan may be extended after its turn ends"
  | Request_active, Complete ->
      "update_plan cannot activate because the current status is complete; \
       create a task to extend this extension-unlocked plan"
  | Request_blocked, Draft ->
      "update_plan cannot block because the current status is draft; call \
       update_plan with status active to commit the task list first"
  | Request_blocked, Paused ->
      "update_plan cannot block because the current status is paused; the user \
       must run /plan resume"
  | Request_blocked, Time_limited ->
      "update_plan cannot block because the current status is time_limited; \
       the user must run /plan resume with a usable time limit"
  | Request_blocked, Complete when not extension_unlocked ->
      "update_plan cannot block because the current status is complete; a \
       completed plan may be extended after its turn ends"
  | Request_blocked, Complete ->
      "update_plan cannot block because the current status is complete; create \
       a task to extend this extension-unlocked plan"
  | _ -> invalid_arg "valid or idempotent update_plan transition"

let pause_error = function
  | Blocked _ ->
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
