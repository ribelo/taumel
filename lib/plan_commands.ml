open Plan_core

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
  "usage: /plan [pause|resume [--time-limit \
   30m|--no-time-limit]|draft|clear|task add <json>|task edit <id> <json>|task \
   advance <id>|task cancel <id>|task delete <id>|<text> [--time-limit 30m]]"

let parse_duration = Plan_command.parse_duration

let parse_time_limit_args = Plan_command.parse_time_limit_args

let split_command = Shared.split_command

let task_command_ok ~(before : store) message (plan : t) =
  let message =
    match before with
    | Some previous when previous.status <> Complete && plan.status = Complete
      ->
        "Plan complete."
    | _ -> message
  in
  command_result ~changed:true ~message (Some plan)

let require_lone_task_id ~usage rest =
  let task_id, extra = split_command rest in
  if task_id = "" || extra <> "" then Error usage else Ok task_id

let apply_command_task ~session_id ~now args store =
  let action, rest = split_command args in
  match action with
  | "add" -> (
      match Plan_command.parse_task_payload rest with
      | Error _ as error -> error
      | Ok (None, _) -> Error "task title is required"
      | Ok (Some title, description_opt) ->
          Result.map
            (task_command_ok ~before:store "Task added.")
            (add_user_task
               ?description:(Option.join description_opt)
               ~create_status:Draft ~session_id ~now title store))
  | "edit" -> (
      let task_id, payload = split_command rest in
      if task_id = "" then Error "task edit requires a task id"
      else
        match Plan_command.parse_task_payload payload with
        | Error _ as error -> error
        | Ok (title, description_opt) ->
            let description =
              match description_opt with
              | None -> Keep_description
              | Some None -> Clear_description
              | Some (Some value) -> Set_description value
            in
            if Option.is_none title && description = Keep_description then
              Error "task edit requires a title or description change"
            else
              Result.map
                (task_command_ok ~before:store "Task updated.")
                (user_update_task ~now ~task_id
                   { no_task_update with title; description }
                   store))
  | "advance" ->
      Result.bind
        (require_lone_task_id ~usage:"usage: /plan task advance <task-id>" rest)
        (fun task_id ->
          Result.map
            (task_command_ok ~before:store "Task advanced.")
            (user_advance_task ~now ~task_id store))
  | "cancel" ->
      Result.bind
        (require_lone_task_id ~usage:"usage: /plan task cancel <task-id>" rest)
        (fun task_id ->
          Result.map
            (task_command_ok ~before:store "Task cancelled.")
            (user_cancel_task ~now ~task_id store))
  | "delete" ->
      Result.bind
        (require_lone_task_id ~usage:"usage: /plan task delete <task-id>" rest)
        (fun task_id ->
          Result.map
            (task_command_ok ~before:store "Task deleted.")
            (user_delete_task ~now ~task_id store))
  | _ -> Error "usage: /plan task <add|edit|advance|cancel|delete> ..."

let apply_command_text ~session_id ~now input (store : store) =
  match parse_time_limit_args input with
  | Error _ as error -> error
  | Ok (_, Some None) when store = None ->
      Error "--no-time-limit is redundant when creating a plan"
  | Ok (text, setting) -> (
      let text = String.trim text in
      if text = "" then Error command_usage
      else
        match (store, setting) with
        | Some plan, Some None when plan.status = Time_limited ->
            Error
              "cannot remove a reached time limit while the current status is \
               time_limited; use /plan resume --no-time-limit"
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
              (add_user_task ?time_limit_seconds:requested_limit ~session_id
                 ~now text store))

let apply_command_pause ~now (store : store) =
  match store with
  | None -> Error "cannot pause plan because this session has no plan"
  | Some plan when plan.status = Paused ->
      Ok (command_result ~message:"Plan already paused." store)
  | Some plan when plan.status <> Active ->
      Error (Plan_status.pause_error plan.status)
  | Some plan ->
      Ok
        (command_result ~automation:Automation_enabled ~changed:true
           ~message:"Plan paused."
           (Some (with_status ~now Paused plan)))

let apply_command_draft ~now (store : store) =
  match store with
  | None -> Error "cannot draft plan because this session has no plan"
  | Some plan when plan.status = Draft ->
      Ok (command_result ~message:"Plan already in draft." store)
  | Some plan -> (
      match plan.status with
      | Blocked open_entry ->
          Result.map
            (fun blocks ->
              command_result ~changed:true ~message:"Plan moved to draft."
                (Some (with_status ~now Draft { plan with blocks })))
            (Plan_block.close_carried ~now ~cleared_by:Plan_block.user_clearer
               ~resolution:"The user moved the plan to draft." open_entry
               plan.blocks)
      | _ ->
          Ok
            (command_result ~changed:true ~message:"Plan moved to draft."
               (Some (with_status ~now Draft plan))))

let apply_command_clear (store : store) =
  let message = if store = None then "No plan to clear." else "Plan cleared." in
  Ok (command_result ~automation:Automation_enabled ~changed:true ~message None)

let apply_command_resume ~now ~automation args (store : store) =
  match parse_time_limit_args args with
  | Error _ as error -> error
  | Ok (extra, setting) when String.trim extra <> "" -> Error command_usage
  | Ok (_, setting) -> (
      match store with
      | None -> Error "cannot resume plan because this session has no plan"
      | Some plan when plan.status = Active && automation = Automation_enabled
        ->
          Ok (command_result ~message:"Plan already active." store)
      | Some plan -> (
          let time_limit_seconds =
            match setting with
            | None -> plan.time_limit_seconds
            | Some value -> value
          in
          match validate_time_limit time_limit_seconds with
          | Error _ as error -> error
          | Ok () -> (
              if
                plan.status = Time_limited
                && Option.fold ~none:false
                     ~some:(fun limit -> plan.time_used_seconds >= limit)
                     time_limit_seconds
              then
                Error
                  "cannot resume plan because the current status is \
                   time_limited and its time limit is already reached; use \
                   /plan resume --time-limit <duration> or /plan resume \
                   --no-time-limit"
              else
                match
                  match plan.status with
                  | Blocked open_entry ->
                      Plan_block.close_carried ~now
                        ~cleared_by:Plan_block.user_clearer
                        ~resolution:"The user resumed the plan." open_entry
                        plan.blocks
                      |> Result.map (fun blocks -> { plan with blocks })
                  | _ -> Ok plan
                with
                | Error _ as error -> error
                | Ok plan ->
                    let plan =
                      (* ^plan-oua0: all-done resume lands complete with no continuation. *)
                      apply_completion_invariant ~now
                        {
                          (with_status ~now Active plan) with
                          time_limit_seconds;
                        }
                    in
                    if plan.status = Complete then
                      Ok
                        (command_result ~automation:Automation_enabled
                           ~changed:true ~message:"Plan complete." (Some plan))
                    else
                      Ok
                        (command_result ~automation:Automation_enabled
                           ~followup:true ~changed:true (Some plan)))))

let apply_command ?(automation = Automation_enabled) ~session_id ~now args store
    =
  let input = String.trim args in
  if input = "" then Ok (command_result store)
  else if input = "pause" then apply_command_pause ~now store
  else if input = "draft" then apply_command_draft ~now store
  else if input = "clear" then apply_command_clear store
  else
    let command, rest = split_command input in
    if command = "task" then apply_command_task ~session_id ~now rest store
    else if command = "resume" then
      match parse_time_limit_args rest with
      | Ok (extra, _) when String.trim extra = "" ->
          apply_command_resume ~now ~automation rest store
      | Error _ as error -> error
      | Ok _ -> apply_command_text ~session_id ~now input store
    else apply_command_text ~session_id ~now input store
