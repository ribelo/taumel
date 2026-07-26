type status = Plan_status.t =
  | Draft
  | Active
  | Paused
  | Blocked
  | Time_limited
  | Complete

type task_status = Plan_task.status =
  | Pending
  | In_progress
  | Completed
  | Cancelled

type task_origin = Plan_task.origin = User | Agent

type task = Plan_task.t = {
  task_id : string;
  title : string;
  description : string option;
  status : task_status;
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
  depends_on : string list option;
}

type t = {
  plan_id : string;
  session_id : string;
  status : status;
  tasks : task list;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
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
  plan_id : string;
  session_id : string;
}

let status_to_string = Plan_status.to_string
let status_label = Plan_status.label
let status_of_string = Plan_status.of_string
let content_editable = Plan_status.content_editable
let status_editable = Plan_status.status_editable
let terminal = Plan_status.terminal
let unfinished = Plan_status.unfinished
let task_status_to_string = Plan_task.status_to_string
let task_status_of_string = Plan_task.status_of_string
let task_origin_to_string = Plan_task.origin_to_string
let task_origin_of_string = Plan_task.origin_of_string
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
    plan_id = plan.plan_id;
    session_id = plan.session_id;
  }

let validate_time_limit = function
  | Some limit when limit <= 0 ->
      Error "plan time limits must be positive when provided"
  | _ -> Ok ()

let plan_id_sequence = ref 0
let plan_id_rng = Random.State.make_self_init ()

let next_plan_id session_id now =
  incr plan_id_sequence;
  Printf.sprintf "plan-%s:%d:%d:%08x%08x" session_id now !plan_id_sequence
    (Random.State.bits plan_id_rng) (Random.State.bits plan_id_rng)

module String_set = Set.Make (String)

let issued_task_ids : (string, String_set.t) Hashtbl.t = Hashtbl.create 17
let task_id_sequence = ref 0
let task_id_rng = Random.State.make_self_init ()

let issued_ids session_id =
  Hashtbl.find_opt issued_task_ids session_id
  |> Option.value ~default:String_set.empty

let remember_task_ids session_id ids =
  let updated =
    List.fold_left (fun set id -> String_set.add id set) (issued_ids session_id) ids
  in
  Hashtbl.replace issued_task_ids session_id updated

let next_task_id session_id now reserved =
  let rec generate () =
    incr task_id_sequence;
    let id =
      Printf.sprintf "task-%s:%d:%d:%08x%08x" session_id now !task_id_sequence
        (Random.State.bits task_id_rng) (Random.State.bits task_id_rng)
    in
    if String_set.mem id reserved then generate () else id
  in
  generate ()

let create_record ?time_limit_seconds ~session_id ~now ~status tasks =
  {
    plan_id = next_plan_id session_id now;
    session_id;
    status;
    tasks;
    tokens_used = 0;
    time_used_seconds = 0;
    time_limit_seconds;
    created_at = now;
    updated_at = now;
  }

let ensure_owner session_id (plan : t) =
  if plan.session_id = session_id then Ok ()
  else Error "cannot access a plan owned by a different session"

let make_tasks ~session_id ~now ~origin ~(existing : task list)
    (creations : task_creation list) =
  if creations = [] then Error "create_task requires at least one task"
  else
    let existing_ids = List.map (fun task -> task.task_id) existing in
    let previously_issued = issued_ids session_id in
    let reserved = ref previously_issued in
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
                Error ("plan task id has already been used in this session: " ^ id)
            | Some id -> Ok id
            | None -> Ok (next_task_id session_id now !reserved)
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
                     "plan task %s depends on unknown or later same-call task: %s"
                     task_id dependency)
          in
          let task =
            {
              task_id;
              title;
              description = creation.description;
              status = Pending;
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
      if plan.status <> Draft then
        Error
          "cannot create plan tasks because agent task creation requires a draft plan"
      else
        let* tasks =
          make_tasks ~session_id ~now ~origin:Agent ~existing:plan.tasks creations
        in
        remember_task_ids session_id
          (List.map (fun task -> task.task_id) tasks);
        Ok { plan with tasks = plan.tasks @ tasks; updated_at = now }
  | None ->
      Result.map
        (fun tasks ->
          remember_task_ids session_id
            (List.map (fun task -> task.task_id) tasks);
          create_record ~session_id ~now ~status:Draft tasks)
        (make_tasks ~session_id ~now ~origin:Agent ~existing:[] creations)

let create_task ?id ?description ?(depends_on = []) ~session_id ~now title store =
  create_tasks ~session_id ~now
    [ { id; title; description; depends_on } ]
    store

let add_user_task ?id ?description ?(depends_on = []) ?time_limit_seconds
    ~session_id ~now title (store : store) =
  let ( let* ) = Result.bind in
  let* () = validate_time_limit time_limit_seconds in
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
        (create_record ?time_limit_seconds ~session_id ~now ~status:Active tasks)
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
          "cannot raise a time-limited plan's limit without resuming the plan"
      else
        let () =
          remember_task_ids session_id (List.map (fun task -> task.task_id) tasks)
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
  Ok
    {
      task with
      title;
      description;
      status = Option.value patch.status ~default:task.status;
      depends_on = Option.value patch.depends_on ~default:task.depends_on;
    }

let update_task_for ~user ~now ~task_id patch (store : store) =
  match store with
  | None -> Error "cannot update a plan task because this session has no plan"
  | Some plan -> (
      match find_task task_id plan.tasks with
      | None -> Error ("unknown plan task: " ^ task_id)
      | Some task ->
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
                "agent cannot edit the title, description, or dependencies of a user-authored task"
            else if
              task.origin = User
              && patch.status = Some Cancelled
            then Some "agent cannot cancel a user-authored task"
            else if task.origin = User && status_change && plan.status <> Active then
              Some
                "agent may change a user-authored task's status only while the plan is active"
            else if content_change && not (content_editable plan.status) then
              Some "plan task content and dependencies may be edited only in draft"
            else if status_change && not (status_editable plan.status) then
              Some "plan task status may be changed only in active or draft"
            else None
          in
          (match agent_error with
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
              Ok { plan with tasks = candidate_tasks; updated_at = now }))

let update_task ~now ~task_id patch store =
  update_task_for ~user:false ~now ~task_id patch store

let user_update_task ~now ~task_id patch store =
  update_task_for ~user:true ~now ~task_id patch store

let update_task_status ~now ~task_id status store =
  update_task ~now ~task_id { no_task_update with status = Some status } store

let unfinished_tasks (plan : t) = List.filter Plan_task.unfinished plan.tasks

let completion_gate (plan : t) =
  match unfinished_tasks plan with [] -> Ok () | tasks -> Error tasks

let unfinished_tasks_error tasks =
  let payload =
    Shared.encode_json
      (Shared.Array (List.map Plan_task.blocker_to_json tasks))
  in
  "cannot complete plan while tasks remain unfinished: " ^ payload

let update_plan ~now status (store : store) =
  match store with
  | None -> Error "cannot update plan because this session has no plan"
  | Some plan -> (
      match (status, plan.status) with
      | Active, Draft -> Ok { plan with status = Active; updated_at = now }
      | (Complete | Blocked), Active ->
          if status = Complete then
            Result.map
              (fun () -> { plan with status; updated_at = now })
              (match completion_gate plan with
              | Ok () -> Ok ()
              | Error tasks -> Error (unfinished_tasks_error tasks))
          else Ok { plan with status; updated_at = now }
      | (Draft | Paused | Time_limited), _ ->
          Error
            "update_plan accepts only active, complete, or blocked; draft, paused, time_limited, time limits, and automation are user or system controlled"
      | Active, _ -> Error "update_plan can activate only a draft plan"
      | (Complete | Blocked), _ ->
          Error "update_plan can complete or block only an active plan")

let user_set_status ~now status (store : store) =
  match store with
  | None -> Error "cannot update plan because this session has no plan"
  | Some plan -> Ok { plan with status; updated_at = now }

let update_time_limit ~now time_limit_seconds (store : store) =
  match store with
  | None -> Error "cannot update plan because this session has no plan"
  | Some plan ->
      Result.map
        (fun () -> { plan with time_limit_seconds; updated_at = now })
        (validate_time_limit time_limit_seconds)

let final_unrecoverable_error ~now (store : store) =
  match store with
  | Some plan when plan.status = Active ->
      Some { plan with status = Blocked; updated_at = now }
  | _ -> store

let get store = store

type forked = { plan : t; automation : automation }

let rebind_for_fork ~session_id (plan : t) =
  remember_task_ids session_id (List.map (fun task -> task.task_id) plan.tasks);
  {
    plan with
    plan_id = next_plan_id session_id plan.created_at;
    session_id;
  }

let fork ~session_id (plan : t) =
  { plan = rebind_for_fork ~session_id plan; automation = Automation_interrupted }

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

let account_usage ~now ~time_delta_seconds usage (plan : t) =
  if plan.status <> Active then plan
  else
    let tokens_used = plan.tokens_used + token_delta usage in
    let time_used_seconds = plan.time_used_seconds + max 0 time_delta_seconds in
    let status =
      if time_limit_reached plan time_used_seconds then Time_limited
      else plan.status
    in
    { plan with tokens_used; time_used_seconds; status; updated_at = now }

type turn_accounting_result = {
  plan : store;
  accounting_key : string option;
  changed : bool;
}

type pending_terminal_status = Pending_complete | Pending_blocked

let status_of_pending_terminal = function
  | Pending_complete -> Complete
  | Pending_blocked -> Blocked

let account_turn_end ?pending_terminal_status ~session_id ~now
    ~active_time_seconds ~last_accounting_key ~latest_usage (store : store) =
  let accounting_store =
    match (pending_terminal_status, store) with
    | Some _, Some plan -> Some { plan with status = Active }
    | _ -> store
  in
  let result =
    match (accounting_store, latest_usage) with
    | Some plan, Some (branch_length, usage) when plan.status = Active ->
        let key = account_turn_key ~session_id ~branch_length usage in
        if last_accounting_key = Some key then
          { plan = accounting_store; accounting_key = last_accounting_key; changed = false }
        else
          {
            plan = Some (account_usage ~now ~time_delta_seconds:active_time_seconds usage plan);
            accounting_key = Some key;
            changed = true;
          }
    | _ ->
        { plan = accounting_store; accounting_key = last_accounting_key; changed = false }
  in
  match (pending_terminal_status, result.plan) with
  | Some pending, Some plan ->
      let status = status_of_pending_terminal pending in
      { result with plan = Some { plan with status; updated_at = now }; changed = true }
  | Some _, None -> { result with changed = true }
  | None, _ -> result

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
          [ "continuation"; "requiresUserInput" ] fields
      in
      if
        List.assoc_opt "continuation" fields = Some (Shared.String "interrupted")
        && List.assoc_opt "requiresUserInput" fields = Some (Shared.Bool true)
      then Ok Automation_interrupted
      else
        Error
          "plan automation must be interrupted and require user input, or be null"
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

type command_plan = {
  plan : store;
  automation : automation option;
  message : string;
  followup : bool;
  submit_user_message : string option;
  changed : bool;
}

let command_result ?automation ?(followup = false) ?submit_user_message
    ?(changed = false) ?message plan =
  {
    plan;
    automation;
    message = Option.value message ~default:(summary plan);
    followup;
    submit_user_message;
    changed;
  }

let command_usage =
  "usage: /plan [pause|resume [--time-limit 30m|--no-time-limit]|draft|clear|<text> [--time-limit 30m]]"

let parse_duration value =
  let value = String.trim value in
  if value = "" then Error "time limit must not be empty"
  else
    let last = value.[String.length value - 1] in
    let multiplier =
      match last with 's' -> Some 1 | 'm' -> Some 60 | 'h' -> Some 3600 | _ -> None
    in
    match multiplier with
    | None -> Error "time limit must use s, m, or h"
    | Some multiplier ->
        let number = String.sub value 0 (String.length value - 1) in
        (try
           let parsed = int_of_string number in
           if parsed <= 0 then Error "time limit must be positive"
           else if parsed > 2_147_483_647 / multiplier then
             Error "time limit is too large"
           else Ok (parsed * multiplier)
         with Failure _ ->
           Error "time limit must be a duration like 90s, 30m, or 2h")

let parse_time_limit_args args =
  let words =
    args |> String.split_on_char ' ' |> List.map String.trim
    |> List.filter (fun word -> word <> "")
  in
  let rec loop text_parts setting = function
    | [] -> Ok (String.concat " " (List.rev text_parts), setting)
    | "--time-limit" :: _ when Option.is_some setting ->
        Error "time limit may be specified only once"
    | "--time-limit" :: value :: rest ->
        Result.bind (parse_duration value) (fun seconds ->
            loop text_parts (Some (Some seconds)) rest)
    | [ "--time-limit" ] ->
        Error "time limit must be a duration like 90s, 30m, or 2h"
    | "--no-time-limit" :: _ when Option.is_some setting ->
        Error "time limit may be specified only once"
    | "--no-time-limit" :: rest -> loop text_parts (Some None) rest
    | flag :: _
      when String.starts_with ~prefix:"--time-limit=" flag
           && Option.is_some setting ->
        Error "time limit may be specified only once"
    | flag :: rest when String.starts_with ~prefix:"--time-limit=" flag ->
        let value = String.sub flag 13 (String.length flag - 13) in
        Result.bind (parse_duration value) (fun seconds ->
            loop text_parts (Some (Some seconds)) rest)
    | word :: rest -> loop (word :: text_parts) setting rest
  in
  loop [] None words

let split_command = Shared.split_command

let apply_command_text ~session_id ~now input (store : store) =
  match parse_time_limit_args input with
  | Error _ as error -> error
  | Ok (_, Some None) when store = None ->
      Error "--no-time-limit is redundant when creating a plan"
  | Ok (text, setting) ->
      let text = String.trim text in
      if text = "" then Error command_usage
      else (
        match (store, setting) with
        | Some plan, Some None when plan.status = Time_limited ->
            Error
              "cannot remove a reached time limit while appending a task; use /plan resume --no-time-limit"
        | _ ->
            let requested_limit = Option.bind setting Fun.id in
            Result.map
              (fun (plan : t) ->
                let plan =
                  match setting with
                  | Some None -> { plan with time_limit_seconds = None }
                  | None | Some (Some _) -> plan
                in
                command_result ~automation:Automation_enabled ~changed:true
                  ~submit_user_message:text (Some plan))
              (add_user_task ?time_limit_seconds:requested_limit ~session_id ~now
                 text store))

let apply_command_pause ~now (store : store) =
  match store with
  | None -> Error "cannot pause plan because this session has no plan"
  | Some plan when plan.status = Paused ->
      Ok (command_result ~message:"Plan already paused." store)
  | Some plan when plan.status <> Active ->
      Error
        "cannot pause this plan without erasing why continuation stopped; use /plan draft to enable editing"
  | Some plan ->
      Ok
        (command_result ~automation:Automation_enabled ~changed:true
           ~message:"Plan paused."
           (Some { plan with status = Paused; updated_at = now }))

let apply_command_draft ~now (store : store) =
  match store with
  | None -> Error "cannot draft plan because this session has no plan"
  | Some plan when plan.status = Draft ->
      Ok (command_result ~message:"Plan already in draft." store)
  | Some plan ->
      Ok
        (command_result ~changed:true ~message:"Plan moved to draft."
           (Some { plan with status = Draft; updated_at = now }))

let apply_command_clear (store : store) =
  let message = if store = None then "No plan to clear." else "Plan cleared." in
  Ok
    (command_result ~automation:Automation_enabled ~changed:true ~message None)

let apply_command_resume ~now ~automation args (store : store) =
  match parse_time_limit_args args with
  | Error _ as error -> error
  | Ok (extra, setting) when String.trim extra <> "" -> Error command_usage
  | Ok (_, setting) -> (
      match store with
      | None -> Error "cannot resume plan because this session has no plan"
      | Some plan when plan.status = Active && automation = Automation_enabled ->
          Ok (command_result ~message:"Plan already active." store)
      | Some plan ->
          let time_limit_seconds =
            match setting with None -> plan.time_limit_seconds | Some value -> value
          in
          (match validate_time_limit time_limit_seconds with
          | Error _ as error -> error
          | Ok () ->
              if
                plan.status = Time_limited
                && Option.fold ~none:false
                     ~some:(fun limit -> plan.time_used_seconds >= limit)
                     time_limit_seconds
              then
                Error
                  "cannot resume plan because its time limit is already reached; use /plan resume --time-limit <duration> or /plan resume --no-time-limit"
              else
                Ok
                  (command_result ~automation:Automation_enabled ~followup:true
                     ~changed:true
                     (Some
                        {
                          plan with
                          status = Active;
                          time_limit_seconds;
                          updated_at = now;
                        }))))

let apply_command ?(automation = Automation_enabled) ~session_id ~now args store =
  let input = String.trim args in
  if input = "" then Ok (command_result store)
  else if input = "pause" then apply_command_pause ~now store
  else if input = "draft" then apply_command_draft ~now store
  else if input = "clear" then apply_command_clear store
  else
    let command, rest = split_command input in
    if command = "resume" then
      match parse_time_limit_args rest with
      | Ok (extra, _) when String.trim extra = "" ->
          apply_command_resume ~now ~automation rest store
      | Error _ as error -> error
      | Ok _ -> apply_command_text ~session_id ~now input store
    else apply_command_text ~session_id ~now input store

type continuation_facts = {
  plan : store;
  automation : automation;
  host_idle : bool;
  has_pending_messages : bool;
  retrying : bool;
  compacting : bool;
  latest_assistant_stop_reason : string option;
}

type continuation = {
  custom_type : string;
  content : string;
  metadata : presentation;
  display : bool;
  trigger_turn : bool;
  deliver_as : string;
}

type continuation_plan =
  | No_continuation
  | Send_continuation of continuation

let continuation_followup_prompt (plan : t) =
  Plan_prompt.continuation_followup
    ~unfinished_tasks_json:(Plan_task.unfinished_json plan.tasks)
    ~tokens_used:plan.tokens_used ~time_used_seconds:plan.time_used_seconds
    ~time_limit_seconds:plan.time_limit_seconds

let initial_followup_prompt = continuation_followup_prompt

let latest_stop_reason_blocks = function
  | Some "error" | Some "aborted" -> true
  | _ -> false

let should_continue facts =
  match facts.plan with
  | Some plan ->
      plan.status = Active
      && facts.automation = Automation_enabled
      && facts.host_idle
      && not facts.has_pending_messages
      && not facts.retrying
      && not facts.compacting
      && not (latest_stop_reason_blocks facts.latest_assistant_stop_reason)
  | None -> false

let continuation_for_plan (plan : t) =
  {
    custom_type = "taumel.plan.continue";
    content = continuation_followup_prompt plan;
    metadata = present Automation_enabled plan;
    display = true;
    trigger_turn = true;
    deliver_as = "followUp";
  }

let plan_continuation ~initial:_ facts =
  match facts.plan with
  | Some plan when should_continue facts ->
      Send_continuation (continuation_for_plan plan)
  | _ -> No_continuation

type child_finalize = { child_status : string; child_reason : string option }

type child_continuation_plan =
  | Child_continue of continuation
  | Child_finalize of child_finalize

let child_continuation_default_max = 25

let plan_child_continuation ~plan ~automation ~iterations ~max_iterations
    ~latest_assistant_stop_reason =
  let facts =
    {
      plan;
      automation;
      host_idle = true;
      has_pending_messages = false;
      retrying = false;
      compacting = false;
      latest_assistant_stop_reason;
    }
  in
  match plan with
  | None -> Child_finalize { child_status = "completed"; child_reason = None }
  | Some current -> (
      match current.status with
      | Complete -> Child_finalize { child_status = "completed"; child_reason = None }
      | Blocked ->
          Child_finalize
            { child_status = "failed"; child_reason = Some "plan_blocked" }
      | _ when iterations >= max_iterations ->
          Child_finalize
            {
              child_status = "failed";
              child_reason = Some "plan_continuation_limit";
            }
      | _ -> (
          match latest_assistant_stop_reason with
          | Some "aborted" ->
              Child_finalize
                { child_status = "cancelled"; child_reason = Some "aborted" }
          | Some "error" ->
              Child_finalize
                { child_status = "failed"; child_reason = Some "error" }
          | _ when should_continue facts ->
              Child_continue (continuation_for_plan current)
          | _ ->
              Child_finalize
                { child_status = "suspended"; child_reason = Some "plan_paused" }))

let continuation_prompt (plan : t) =
  Plan_prompt.continuation_state ~status:(status_to_string plan.status)
    ~tokens_used:plan.tokens_used ~time_used_seconds:plan.time_used_seconds
    ~time_limit_seconds:plan.time_limit_seconds

let time_limit_prompt (plan : t) =
  Plan_prompt.time_limit ~tokens_used:plan.tokens_used
    ~time_used_seconds:plan.time_used_seconds

let to_json (plan : t) =
  Plan_codec.encode ~plan_id:plan.plan_id ~session_id:plan.session_id
    ~status:plan.status ~tasks:plan.tasks ~tokens_used:plan.tokens_used
    ~time_used_seconds:plan.time_used_seconds
    ~time_limit_seconds:plan.time_limit_seconds ~created_at:plan.created_at
    ~updated_at:plan.updated_at

let of_json json =
  Result.map
    (Option.map (fun (decoded : Plan_codec.decoded) ->
         remember_task_ids decoded.session_id
           (List.map (fun task -> task.task_id) decoded.tasks);
         {
           plan_id = decoded.plan_id;
           session_id = decoded.session_id;
           status = decoded.status;
           tasks = decoded.tasks;
           tokens_used = decoded.tokens_used;
           time_used_seconds = decoded.time_used_seconds;
           time_limit_seconds = decoded.time_limit_seconds;
           created_at = decoded.created_at;
           updated_at = decoded.updated_at;
         }))
    (Plan_codec.decode json)

let codec =
  {
    Shared.encode = (function None -> Shared.Null | Some plan -> to_json plan);
    decode = of_json;
  }

let plan_entry_key = "taumel.plan"
let automation_entry_key = "taumel.plan_automation"
let continuation_custom_type = "taumel.plan.continue"

let get_plan_description =
  "Get the current plan for this thread, including status, automation state, tasks, token telemetry, elapsed active time, and optional time limit."

let get_plan_prompt_snippet =
  "Inspect the current plan, tasks, status, usage, and automation state."

let create_task_description =
  "Create one or more tasks for the current plan. Tasks are the living breakdown of the work: order, dependencies, and completion state drive continuation and gate plan completion. Creating a task while no plan exists creates a draft plan; activate it with update_plan to start continuation. Tasks may be created only while the plan is in draft."

let create_task_id_description =
  "Optional explicit task identity, unique within this plan. Omit to auto-generate a task- identity."

let create_task_title_description =
  "Short statement of the work. Trimmed; must not be empty."

let create_task_description_description =
  "Optional longer specification of this step."

let create_task_depends_on_description =
  "Task identities that must reach completed or cancelled before this task may enter in_progress. May reference identities supplied earlier in this call."

let create_task_prompt_snippet =
  "Create one or more plan tasks while the plan is in draft."

let update_task_description =
  "Update one task's status, title, description, or dependencies. Content edits require a draft plan; status changes require an active or draft plan. Setting in_progress requires every depended task to be completed or cancelled. Mark a task completed only when its work is verifiably done; cancel tasks that are no longer needed. User-authored task text and cancellation are reserved to the user."

let update_task_prompt_snippet =
  "Update one plan task's status or content within editability rules."

let update_plan_description =
  "Update the plan lifecycle: activate a draft plan to commit its task list and start continuation, or mark an active plan complete or genuinely blocked. Completion requires every task to be completed or cancelled first."

let update_plan_status_description =
  "Lifecycle status to set: active commits the task list and starts continuation; complete declares every required outcome satisfied; blocked marks a genuine impasse requiring user input or an external-state change."

let update_plan_prompt_snippet =
  "Activate the plan, or mark it complete or genuinely blocked."

let tool_specs =
  [
    { Tool_gateway.name = "get_plan"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "create_task"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "update_task"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "update_plan"; effect_kind = Tool_gateway.Mutate };
  ]
