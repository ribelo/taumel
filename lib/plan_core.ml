type status = Plan_status.t =
  | Draft
  | Active
  | Paused
  | Blocked of Plan_block.open_entry
  | Time_limited
  | Complete

type status_request = Plan_status.request = Request_active | Request_blocked

type task_status = Plan_task.status =
  | Pending
  | In_progress
  | Completed
  | Cancelled

type task_origin = Plan_task.origin = User | Agent

type block_source = Plan_block.source

type block_cleared_by = Plan_block.cleared_by

type block = Plan_block.entry =
  | Open of Plan_block.open_entry
  | Closed of Plan_block.closed_entry

type task = Plan_task.t = {
  task_id : string;
  title : string;
  description : string option;
  status : task_status;
  cancellation_reason : string option;
  depends_on : string list;
  origin : task_origin;
}

type task_creation = Plan_task.creation = {
  id : string option;
  title : string;
  description : string option;
  depends_on : string list;
}

type description_update = Plan_task.description_update =
  | Keep_description
  | Set_description of string
  | Clear_description

type task_update = Plan_task.update = {
  title : string option;
  description : description_update;
  status : task_status option;
  reason : string option;
  depends_on : string list option;
}

type t = {
  plan_id : string;
  session_id : string;
  status : status;
  tasks : task list;
  blocks : Plan_block.t;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
  extension_unlocked : bool;
  created_at : int;
  updated_at : int;
}

type store = t option

type automation = Automation_enabled | Automation_interrupted

type token_usage = Plan_accounting.token_usage = {
  input_tokens : int;
  cached_input_tokens : int;
  output_tokens : int;
}

type turn_clock = Plan_accounting.turn_clock = {
  turn_started_at_ms : int option;
  pause_depth : int;
  current_pause_started_at_ms : int option;
  paused_accumulated_ms : int;
}

type presentation = {
  status : status;
  automation : automation;
  tasks : task list;
  completed_tasks : int;
  total_tasks : int;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
  extension_unlocked : bool;
  plan_id : string;
  session_id : string;
}

let status_to_string = Plan_status.to_string

let status_label = Plan_status.label

let content_editable = Plan_status.content_editable

let status_editable = Plan_status.status_editable

let terminal = Plan_status.terminal

let unfinished = Plan_status.unfinished

let task_status_to_string = Plan_task.status_to_string

let task_status_of_string = Plan_task.status_of_string

let task_origin_to_string = Plan_task.origin_to_string

let task_origin_of_string = Plan_task.origin_of_string

let block_source_to_string = Plan_block.source_to_string

let block_cleared_by_to_string = Plan_block.cleared_by_to_string

let block_entries (plan : t) = Plan_block.entries plan.blocks

let no_task_update = Plan_task.no_update

let completed_task_count (tasks : task list) =
  List.filter
    (fun (task : task) -> task.status = Completed || task.status = Cancelled)
    tasks
  |> List.length

let present automation (plan : t) =
  {
    status = plan.status;
    automation;
    tasks = plan.tasks;
    completed_tasks = completed_task_count plan.tasks;
    total_tasks = List.length plan.tasks;
    tokens_used = plan.tokens_used;
    time_used_seconds = plan.time_used_seconds;
    time_limit_seconds = plan.time_limit_seconds;
    extension_unlocked = plan.extension_unlocked;
    plan_id = plan.plan_id;
    session_id = plan.session_id;
  }

(* Leaving complete clears the unlock so only a fresh turn-end re-enables it. *)
let with_status ~now status (plan : t) =
  let extension_unlocked =
    if status = Complete then plan.extension_unlocked else false
  in
  { plan with status; extension_unlocked; updated_at = now }

let validate_time_limit = function
  | Some limit when limit <= 0 ->
      Error "plan time limits must be positive when provided"
  | _ -> Ok ()

let handle_rng = Random.State.make_self_init ()

let next_plan_id () =
  "plan-"
  ^ Shared.nano_id
      (Random.State.full_int handle_rng Shared.nano_id_namespace_size)

module String_set = Set.Make (String)

let issued_task_ids : (string, String_set.t) Hashtbl.t = Hashtbl.create 17

let issued_ids session_id =
  Hashtbl.find_opt issued_task_ids session_id
  |> Option.value ~default:String_set.empty

let remember_task_ids session_id ids =
  let updated =
    List.fold_left
      (fun set id -> String_set.add id set)
      (issued_ids session_id) ids
  in
  Hashtbl.replace issued_task_ids session_id updated

(* ^plan-tk03: task-<nano-id>, collision retry, never lengthen on exhaustion. *)
let next_task_id reserved =
  let rec attempt remaining =
    if remaining <= 0 then Error "task handle namespace is exhausted"
    else
      let index =
        Random.State.full_int handle_rng Shared.nano_id_namespace_size
      in
      let id = "task-" ^ Shared.nano_id index in
      if String_set.mem id reserved then attempt (remaining - 1) else Ok id
  in
  attempt Shared.nano_id_namespace_size

let create_record ?time_limit_seconds ~session_id ~now ~status tasks =
  {
    plan_id = next_plan_id ();
    session_id;
    status;
    tasks;
    blocks = Plan_block.empty;
    tokens_used = 0;
    time_used_seconds = 0;
    time_limit_seconds;
    extension_unlocked = false;
    created_at = now;
    updated_at = now;
  }

let ensure_owner session_id (plan : t) =
  if plan.session_id = session_id then Ok ()
  else Error "cannot access a plan owned by a different session"

let make_tasks ~session_id ~now:_ ~origin ~(existing : task list)
    (creations : task_creation list) =
  if creations = [] then Error "create_task requires at least one task"
  else
    let existing_ids = List.map (fun task -> task.task_id) existing in
    (* Uniqueness spans the plan's lifetime: issued set may be empty after a
       process restart, so also reserve every id already on the plan. *)
    let reserved =
      ref
        (List.fold_left
           (fun set id -> String_set.add id set)
           (issued_ids session_id) existing_ids)
    in
    let available_dependencies = ref (String_set.of_list existing_ids) in
    let rec loop acc = function
      | [] ->
          let created = List.rev acc in
          let all = existing @ created in
          Result.map (fun () -> created) (Plan_task.validate_graph all)
      | (creation : task_creation) :: rest ->
          let ( let* ) = Result.bind in
          let* title = Plan_task.normalize_title creation.title in
          let* explicit_id = Plan_task.normalize_explicit_id creation.id in
          let* task_id =
            match explicit_id with
            | Some id when String_set.mem id !reserved ->
                Error
                  ("plan task id has already been used in this session: " ^ id)
            | Some id -> Ok id
            | None -> next_task_id !reserved
          in
          let* () =
            match
              List.find_opt
                (fun dependency ->
                  not (String_set.mem dependency !available_dependencies))
                creation.depends_on
            with
            | None -> Ok ()
            | Some dependency ->
                Error
                  (Printf.sprintf
                     "plan task %s depends on unknown or later same-call task: \
                      %s"
                     task_id dependency)
          in
          let task =
            {
              task_id;
              title;
              description = creation.description;
              status = Pending;
              cancellation_reason = None;
              depends_on = creation.depends_on;
              origin;
            }
          in
          reserved := String_set.add task_id !reserved;
          available_dependencies :=
            String_set.add task_id !available_dependencies;
          loop (task :: acc) rest
    in
    loop [] creations

let create_tasks ~session_id ~now creations (store : store) =
  match store with
  | Some plan ->
      let ( let* ) = Result.bind in
      let* () = ensure_owner session_id plan in
      let* () =
        match plan.status with
        | Draft -> Ok ()
        | Complete when plan.extension_unlocked -> Ok ()
        | status -> Error (Plan_status.create_task_error status)
      in
      let* tasks =
        make_tasks ~session_id ~now ~origin:Agent ~existing:plan.tasks creations
      in
      remember_task_ids session_id (List.map (fun task -> task.task_id) tasks);
      (* ^plan-z19k: extension batch applies and reopens complete -> active. *)
      let plan =
        if plan.status = Complete then with_status ~now Active plan else plan
      in
      Ok { plan with tasks = plan.tasks @ tasks; updated_at = now }
  | None ->
      Result.map
        (fun tasks ->
          remember_task_ids session_id
            (List.map (fun task -> task.task_id) tasks);
          create_record ~session_id ~now ~status:Draft tasks)
        (make_tasks ~session_id ~now ~origin:Agent ~existing:[] creations)

let create_task ?id ?description ?(depends_on = []) ~session_id ~now title store
    =
  create_tasks ~session_id ~now [ { id; title; description; depends_on } ] store

let add_user_task ?id ?description ?(depends_on = []) ?time_limit_seconds
    ?(create_status = Active) ~session_id ~now title (store : store) =
  let ( let* ) = Result.bind in
  let* () = validate_time_limit time_limit_seconds in
  let* () =
    match (store, create_status) with
    | None, (Draft | Active) -> Ok ()
    | None, _ -> Error "a new plan may be created only in draft or active"
    | Some _, _ -> Ok ()
  in
  let* () =
    match store with None -> Ok () | Some plan -> ensure_owner session_id plan
  in
  let existing =
    Option.map (fun (plan : t) -> plan.tasks) store |> Option.value ~default:[]
  in
  let* tasks =
    make_tasks ~session_id ~now ~origin:User ~existing
      [ { id; title; description; depends_on } ]
  in
  match store with
  | None ->
      remember_task_ids session_id (List.map (fun task -> task.task_id) tasks);
      Ok
        (create_record ?time_limit_seconds ~session_id ~now
           ~status:create_status tasks)
  | Some plan ->
      let time_limit_seconds =
        match time_limit_seconds with
        | Some _ as requested -> requested
        | None -> plan.time_limit_seconds
      in
      if
        plan.status = Time_limited
        &&
        match time_limit_seconds with
        | Some limit -> plan.time_used_seconds < limit
        | None -> false
      then
        Error
          "cannot raise the limit because the current status is time_limited; \
           the user must run /plan resume with a usable time limit"
      else
        let () =
          remember_task_ids session_id
            (List.map (fun task -> task.task_id) tasks)
        in
        (* ^plan-6ngi: user append on complete reopens to active. *)
        let plan =
          if plan.status = Complete then with_status ~now Active plan else plan
        in
        Ok
          {
            plan with
            tasks = plan.tasks @ tasks;
            time_limit_seconds;
            updated_at = now;
          }

let find_task task_id (tasks : task list) =
  List.find_opt (fun (task : task) -> task.task_id = task_id) tasks

let unfinished_tasks (plan : t) = List.filter Plan_task.unfinished plan.tasks

(* ^plan-zv0s: committed statuses complete themselves when no unfinished work remains. *)
let apply_completion_invariant ~now (plan : t) =
  match plan.status with
  | Blocked open_entry when unfinished_tasks plan = [] -> (
      match
        Plan_block.close_carried ~now ~cleared_by:Plan_block.user_clearer
          ~resolution:
            "Plan completed automatically because every task is completed or \
             cancelled."
          open_entry plan.blocks
      with
      | Ok blocks -> with_status ~now Complete { plan with blocks }
      | Error _ -> plan)
  | (Active | Paused | Time_limited) when unfinished_tasks plan = [] ->
      with_status ~now Complete plan
  | _ -> plan

let apply_task_patch (task : task) patch =
  let ( let* ) = Result.bind in
  let* title =
    match patch.title with
    | None -> Ok task.title
    | Some title -> Plan_task.normalize_title title
  in
  let description =
    match patch.description with
    | Keep_description -> task.description
    | Set_description description -> Some description
    | Clear_description -> None
  in
  let* cancellation_reason =
    match (patch.status, patch.reason) with
    | Some Cancelled, reason -> Plan_task.normalize_cancellation_reason reason
    | Some _, _ -> Ok None
    | None, None -> Ok task.cancellation_reason
    | None, Some _ ->
        Error
          "plan task cancellation reason may be provided only when setting \
           status to cancelled"
  in
  Ok
    {
      task with
      title;
      description;
      status = Option.value patch.status ~default:task.status;
      cancellation_reason;
      depends_on = Option.value patch.depends_on ~default:task.depends_on;
    }

let update_task_for ~user ~now ~task_id patch (store : store) =
  match store with
  | None -> Error "cannot update a plan task because this session has no plan"
  | Some plan -> (
      match find_task task_id plan.tasks with
      | None -> Error ("unknown plan task: " ^ task_id)
      | Some task -> (
          let content_change =
            Option.is_some patch.title
            || patch.description <> Keep_description
            || Option.is_some patch.depends_on
          in
          let status_change = Option.is_some patch.status in
          let agent_error =
            if user then None
            else if task.origin = User && content_change then
              Some
                "agent cannot edit the title, description, or dependencies of \
                 a user-authored task"
            else if task.origin = User && patch.status = Some Cancelled then
              Some "agent cannot cancel a user-authored task"
            else if task.origin = User && status_change && plan.status <> Active
            then
              Some
                (Plan_status.edit_error ~capability:Plan_status.Status_change
                   "change a user-authored task's status" plan.status)
            else if content_change && not (content_editable plan.status) then
              Some
                (Plan_status.edit_error ~capability:Plan_status.Content_edit
                   "edit plan task content or dependencies" plan.status)
            else if status_change && not (status_editable plan.status) then
              Some
                (Plan_status.edit_error ~capability:Plan_status.Status_change
                   "change a plan task status" plan.status)
            else None
          in
          match agent_error with
          | Some error -> Error error
          | None ->
              let ( let* ) = Result.bind in
              let* updated = apply_task_patch task patch in
              let candidate_tasks =
                List.map
                  (fun candidate ->
                    if candidate.task_id = task_id then updated else candidate)
                  plan.tasks
              in
              let* () = Plan_task.validate_graph candidate_tasks in
              let* () =
                if updated.status <> In_progress then Ok ()
                else
                  match
                    Plan_task.blocking_dependencies candidate_tasks updated
                  with
                  | [] -> Ok ()
                  | blockers -> Error (Plan_task.blockers_error blockers)
              in
              Ok
                (apply_completion_invariant ~now
                   { plan with tasks = candidate_tasks; updated_at = now })))

let update_task ~now ~task_id patch store =
  update_task_for ~user:false ~now ~task_id patch store

let user_update_task ~now ~task_id patch store =
  update_task_for ~user:true ~now ~task_id patch store

let update_task_status ?reason ~now ~task_id status store =
  update_task ~now ~task_id
    { no_task_update with status = Some status; reason }
    store

let next_advance_status = function
  | Pending -> Some In_progress
  | In_progress -> Some Completed
  | Completed | Cancelled -> None

let require_task ~action ~task_id (store : store) : (t * task, string) result =
  match store with
  | None ->
      Error
        ("cannot " ^ action ^ " a plan task because this session has no plan")
  | Some plan -> (
      match find_task task_id plan.tasks with
      | None -> Error ("unknown plan task: " ^ task_id)
      | Some task -> Ok (plan, task))

let user_advance_task ~now ~task_id (store : store) =
  match require_task ~action:"advance" ~task_id store with
  | Error _ as error -> error
  | Ok (_plan, task) -> (
      match next_advance_status task.status with
      | None ->
          Error
            ("cannot advance a " ^ task_status_to_string task.status ^ " task")
      | Some next_status ->
          user_update_task ~now ~task_id
            { no_task_update with status = Some next_status }
            store)

let user_cancel_task ~now ~task_id (store : store) =
  match require_task ~action:"cancel" ~task_id store with
  | Error _ as error -> error
  | Ok (_plan, task) -> (
      match task.status with
      | Completed | Cancelled ->
          Error
            ("cannot cancel a " ^ task_status_to_string task.status ^ " task")
      | Pending | In_progress ->
          user_update_task ~now ~task_id
            {
              no_task_update with
              status = Some Cancelled;
              reason =
                Some
                  "Cancelled by the user through /tasks or /plan task cancel.";
            }
            store)

(* ^plan-tk04: keep >=1 task; strip inbound depends_on (^plan-md05 read-only). *)
let user_delete_task ~now ~task_id (store : store) =
  match require_task ~action:"delete" ~task_id store with
  | Error _ as error -> error
  | Ok (plan, _task) -> (
      let remaining =
        plan.tasks
        |> List.filter (fun (task : task) -> task.task_id <> task_id)
        |> List.map (fun (task : task) ->
            {
              task with
              depends_on = List.filter (( <> ) task_id) task.depends_on;
            })
      in
      if remaining = [] then
        Error "cannot delete the last task of a plan; clear the plan instead"
      else
        match Plan_task.validate_graph remaining with
        | Error _ as error -> error
        | Ok () ->
            Ok
              (apply_completion_invariant ~now
                 { plan with tasks = remaining; updated_at = now }))

let update_plan ~reason ~now requested (store : store) =
  match store with
  | None -> Error "cannot update plan because this session has no plan"
  | Some plan -> (
      let reason = String.trim reason in
      if reason = "" then Error "update_plan requires a non-empty reason"
      else
        match (requested, plan.status) with
        | Request_active, Draft ->
            (* ^plan-oua0: all-done activate lands complete in the same transition. *)
            Ok (apply_completion_invariant ~now (with_status ~now Active plan))
        | Request_active, Blocked open_entry ->
            Result.map
              (fun blocks ->
                apply_completion_invariant ~now
                  (with_status ~now Active { plan with blocks }))
              (Plan_block.close_carried ~now
                 ~cleared_by:Plan_block.agent_clearer ~resolution:reason
                 open_entry plan.blocks)
        | Request_active, Active | Request_blocked, Blocked _ -> Ok plan
        | Request_blocked, Active ->
            Result.map
              (fun blocks ->
                match Plan_block.open_entry_opt blocks with
                | Some entry ->
                    with_status ~now (Blocked entry) { plan with blocks }
                | None -> plan)
              (Plan_block.open_entry ~now ~reason
                 ~source:Plan_block.agent_source plan.blocks)
        | _ ->
            Error
              (Plan_status.update_plan_error
                 ~extension_unlocked:plan.extension_unlocked ~requested
                 plan.status))

let final_unrecoverable_error ~now (store : store) =
  match store with
  | Some plan when plan.status = Active -> (
      match
        Plan_block.open_entry ~now ~reason:"Final unrecoverable turn error."
          ~source:Plan_block.system_source plan.blocks
      with
      | Error _ -> store
      | Ok blocks -> (
          match Plan_block.open_entry_opt blocks with
          | None -> store
          | Some entry ->
              Some (with_status ~now (Blocked entry) { plan with blocks })))
  | _ -> store

let get store = store

type forked = { plan : t; automation : automation }

let rebind_for_fork ~session_id (plan : t) =
  remember_task_ids session_id (List.map (fun task -> task.task_id) plan.tasks);
  { plan with plan_id = next_plan_id (); session_id }

let fork ~session_id (plan : t) =
  {
    plan = rebind_for_fork ~session_id plan;
    automation = Automation_interrupted;
  }

let token_delta = Plan_accounting.token_delta

let token_usage_of_json = Plan_accounting.token_usage_of_json

let message_usage = Plan_accounting.message_usage

let latest_assistant_usage = Plan_accounting.latest_assistant_usage

let account_turn_key = Plan_accounting.account_turn_key

let empty_clock = Plan_accounting.empty_clock

let start_turn_clock = Plan_accounting.start_turn_clock

let pause_clock_start = Plan_accounting.pause_clock_start

let pause_clock_end = Plan_accounting.pause_clock_end

let finish_turn_clock = Plan_accounting.finish_turn_clock

let time_limit_reached (plan : t) time_used_seconds =
  match plan.time_limit_seconds with
  | Some limit -> time_used_seconds >= limit
  | None -> false

let add_usage ~now ~time_delta_seconds usage (plan : t) =
  let tokens_used = plan.tokens_used + token_delta usage in
  let time_used_seconds = plan.time_used_seconds + max 0 time_delta_seconds in
  { plan with tokens_used; time_used_seconds; updated_at = now }

let account_usage ~now ~time_delta_seconds usage (plan : t) =
  if plan.status <> Active then plan
  else
    let plan = add_usage ~now ~time_delta_seconds usage plan in
    let status =
      if time_limit_reached plan plan.time_used_seconds then Time_limited
      else plan.status
    in
    if status = plan.status then plan else with_status ~now status plan

type turn_accounting_result = {
  plan : store;
  accounting_key : string option;
  changed : bool;
}

type pending_terminal_status = Pending_complete | Pending_blocked

let account_turn_end ?pending_terminal_status ~session_id ~now
    ~active_time_seconds ~last_accounting_key ~latest_usage (store : store) =
  let result =
    match (store, latest_usage) with
    | Some plan, Some (branch_length, usage)
      when plan.status = Active || Option.is_some pending_terminal_status ->
        let key = account_turn_key ~session_id ~branch_length usage in
        if last_accounting_key = Some key then
          {
            plan = store;
            accounting_key = last_accounting_key;
            changed = false;
          }
        else
          let plan =
            match pending_terminal_status with
            | Some _ ->
                add_usage ~now ~time_delta_seconds:active_time_seconds usage
                  plan
            | None ->
                account_usage ~now ~time_delta_seconds:active_time_seconds usage
                  plan
          in
          { plan = Some plan; accounting_key = Some key; changed = true }
    | _ ->
        { plan = store; accounting_key = last_accounting_key; changed = false }
  in
  (* Terminal status is applied here when update_plan completes mid-turn; the
     extension unlock waits for a later natural turn-end so same-turn extend
     stays rejected (^plan-x47h, ^plan-zty5). *)
  let result =
    match (pending_terminal_status, result.plan) with
    | Some Pending_complete, Some plan when plan.status = Active ->
        {
          result with
          plan = Some (with_status ~now Complete plan);
          changed = true;
        }
    | Some _, None -> { result with changed = true }
    | Some _, Some _ | None, _ -> result
  in
  match (pending_terminal_status, result.plan) with
  | None, Some plan when plan.status = Complete && not plan.extension_unlocked
    ->
      {
        result with
        plan = Some { plan with extension_unlocked = true; updated_at = now };
        changed = true;
      }
  | _ -> result

let automation_to_string = function
  | Automation_enabled -> "enabled"
  | Automation_interrupted -> "interrupted"

let automation_of_string = function
  | "enabled" -> Some Automation_enabled
  | "interrupted" -> Some Automation_interrupted
  | _ -> None

let automation_requires_user_input = function
  | Automation_enabled -> false
  | Automation_interrupted -> true

let automation_to_json = function
  | Automation_enabled -> Shared.Null
  | Automation_interrupted ->
      Shared.Object
        [
          ("continuation", Shared.String "interrupted");
          ("requiresUserInput", Shared.Bool true);
        ]

let automation_of_json = function
  | Shared.Null -> Ok Automation_enabled
  | Shared.Object fields ->
      let ( let* ) = Result.bind in
      let* () =
        Shared.json_exact_fields "plan automation"
          [ "continuation"; "requiresUserInput" ]
          fields
      in
      if
        List.assoc_opt "continuation" fields
        = Some (Shared.String "interrupted")
        && List.assoc_opt "requiresUserInput" fields = Some (Shared.Bool true)
      then Ok Automation_interrupted
      else
        Error
          "plan automation must be interrupted and require user input, or be \
           null"
  | _ -> Error "plan automation must be an object or null"

let automation_codec =
  { Shared.encode = automation_to_json; decode = automation_of_json }

let format_duration seconds =
  let seconds = max 0 seconds in
  if seconds mod 3600 = 0 && seconds >= 3600 then
    Printf.sprintf "%dh" (seconds / 3600)
  else if seconds mod 60 = 0 && seconds >= 60 then
    Printf.sprintf "%dm" (seconds / 60)
  else Printf.sprintf "%ds" seconds

let time_usage (plan : t) =
  match plan.time_limit_seconds with
  | None -> format_duration plan.time_used_seconds
  | Some limit ->
      format_duration plan.time_used_seconds ^ "/" ^ format_duration limit

let summary (store : store) =
  match store with
  | None -> "No plan."
  | Some plan ->
      Printf.sprintf "Plan %s: %d/%d tasks (%s)"
        (status_to_string plan.status)
        (completed_task_count plan.tasks)
        (List.length plan.tasks) (time_usage plan)
