open Shared

type mode = Message | Goal

type task = {
  id : string;
  cron : string;
  prompt : string;
  recurring : bool;
  mode : mode;
  enabled : bool;
  created_at : int;
  next_due : int;
  pending_since : int option;
}

type state = { enabled : bool; tasks : task list }

type create_request = {
  cron : string;
  prompt : string;
  recurring : bool;
  mode : mode;
}

type deliverability_facts = {
  host_idle : bool;
  goal_driving : bool;
  goal_slot_free : bool;
}

type delivery = {
  task : task;
  coalesced : int;
  content : string;
}

type startup_reason = New | Reload | Resume | Startup | Fork | Other

type startup_plan = {
  state : state;
  notify : bool;
  message : string;
}

let empty = { enabled = true; tasks = [] }
let mode_to_string = function Message -> "message" | Goal -> "goal"
let mode_of_string = function "goal" -> Some Goal | "message" -> Some Message | _ -> None

let validate_prompt prompt = Shared.require_non_empty "cron prompt" prompt

let valid_task_id value =
  String.length value = 8
  && String.for_all
       (fun character ->
         (character >= '0' && character <= '9')
         || (character >= 'a' && character <= 'f'))
       value

let scheduled_at expr timestamp =
  let parts = Unix.localtime (float_of_int timestamp) in
  parts.tm_sec = 0
  && Cron_expr.matches expr ~minute:parts.tm_min ~hour:parts.tm_hour
       ~day:parts.tm_mday ~month:(parts.tm_mon + 1) ~weekday:parts.tm_wday

let next_due cron ~now =
  Result.bind (Cron_expr.parse cron) (fun expr ->
      match Cron_expr.next_due_after expr ~after:now with
      | Some due -> Ok due
      | None -> Error "cron expression has no matching instant in the searchable range")

let id_from_seed seed =
  Printf.sprintf "%08lx" (Int32.logand (Int32.of_int seed) Int32.minus_one)

let create ~now ~id (request : create_request) state =
  Result.bind (validate_prompt request.prompt) (fun prompt ->
      Result.bind (next_due request.cron ~now) (fun due ->
          let task =
            {
              id;
              cron = request.cron;
              prompt;
              recurring = request.recurring;
              mode = request.mode;
              enabled = true;
              created_at = now;
              next_due = due;
              pending_since = None;
            }
          in
          Ok ({ state with tasks = state.tasks @ [ task ] }, task)))

let delete id state = { state with tasks = List.filter (fun task -> task.id <> id) state.tasks }
let set_enabled enabled state = { state with enabled }

let find_task id state = List.find_opt (fun task -> task.id = id) state.tasks

let replace_task updated state =
  {
    state with
    tasks =
      List.map
        (fun task -> if task.id = updated.id then updated else task)
        state.tasks;
  }

let set_task_enabled id enabled state =
  let tasks =
    List.map
      (fun task -> if task.id = id then { task with enabled } else task)
      state.tasks
  in
  { state with tasks }

let update_task_prompt id prompt state =
  Result.bind (validate_prompt prompt) (fun prompt ->
      match find_task id state with
      | None -> Error ("No cron task matched " ^ id ^ ".")
      | Some task -> Ok (replace_task { task with prompt } state))

let update_task_cron ~now id cron state =
  Result.bind (next_due cron ~now) (fun due ->
      match find_task id state with
      | None -> Error ("No cron task matched " ^ id ^ ".")
      | Some task ->
          Ok (replace_task { task with cron; next_due = due; pending_since = None } state))

let update_task_recurring id recurring state =
  match find_task id state with
  | None -> Error ("No cron task matched " ^ id ^ ".")
  | Some task -> Ok (replace_task { task with recurring } state)

let update_task_mode id mode state =
  match find_task id state with
  | None -> Error ("No cron task matched " ^ id ^ ".")
  | Some task -> Ok (replace_task { task with mode } state)

let startup_message count =
  Printf.sprintf "%d stored cron task%s exist in this session. Cron is disabled on startup; run /cron enable to arm them."
    count (if count = 1 then "" else "s")

let apply_startup reason state =
  match (reason, state.tasks) with
  | (Resume | Startup | Fork), _ :: _ ->
      { state = { state with enabled = false }; notify = true; message = startup_message (List.length state.tasks) }
  | New, _ -> { state = empty; notify = false; message = "" }
  | (Resume | Startup | Fork), [] | Reload, _ | Other, _ ->
      { state; notify = false; message = "" }

let tick ~now state =
  if not state.enabled then state
  else
    let tasks =
      List.map
        (fun task ->
          match task.pending_since with
          | Some _ -> task
          | None when (not task.enabled) -> task
          | None when now >= task.next_due -> { task with pending_since = Some task.next_due }
          | None -> task)
        state.tasks
    in
    { state with tasks }

let count_occurrences cron ~from_time ~until_time =
  match Cron_expr.parse cron with
  | Error _ -> 1
  | Ok expr ->
      let rec loop count cursor =
        match Cron_expr.next_due_after expr ~after:(cursor - 1) with
        | None -> max 1 count
        | Some due when due <= until_time -> loop (count + 1) (due + 60)
        | Some _ -> max 1 count
      in
      loop 0 from_time

let deliverable facts task =
  match task.pending_since with
  | None -> false
  | Some _ ->
      task.enabled
      && facts.host_idle
      && (not facts.goal_driving)
      && (match task.mode with Message -> true | Goal -> facts.goal_slot_free)

let pending_delivery ~now facts state =
  if not state.enabled then None
  else
    state.tasks
    |> List.find_opt (deliverable facts)
    |> Option.map (fun task ->
         let pending_since = Option.value task.pending_since ~default:task.next_due in
         {
           task;
           coalesced = count_occurrences task.cron ~from_time:pending_since ~until_time:now;
           content = task.prompt;
         })

let complete_delivery ~now delivery state =
  match delivery.task.recurring with
  | false -> delete delivery.task.id state
  | true -> (
      match next_due delivery.task.cron ~now with
      | Error _ -> delete delivery.task.id state
      | Ok due ->
          let tasks =
            List.map
              (fun task ->
                if task.id = delivery.task.id then
                  { task with pending_since = None; next_due = due }
                else task)
              state.tasks
          in
          { state with tasks })

let task_json task =
  Shared.Object
    ([
       ("id", String task.id);
       ("cron", String task.cron);
	       ("prompt", String task.prompt);
	       ("recurring", Bool task.recurring);
	       ("mode", String (mode_to_string task.mode));
	       ("enabled", Bool task.enabled);
	       ("createdAt", Number (float_of_int task.created_at));
       ("nextDue", Number (float_of_int task.next_due));
     ]
    @
    match task.pending_since with
    | None -> []
    | Some time -> [("pendingSince", Number (float_of_int time))])

let task_of_json json =
  let open Shared in
  Result.bind (json_object_fields "taumel.cron.task" json) (fun fields ->
      let expected =
        [ "id"; "cron"; "prompt"; "recurring"; "mode"; "enabled";
          "createdAt"; "nextDue" ]
        @ if List.mem_assoc "pendingSince" fields then [ "pendingSince" ] else []
      in
      Result.bind (json_exact_fields "taumel.cron.task" expected fields) (fun () ->
      Result.bind (json_required_string "taumel.cron.task" fields "id") (fun id ->
          Result.bind (json_required_string "taumel.cron.task" fields "cron") (fun cron ->
              Result.bind (json_required_string "taumel.cron.task" fields "prompt") (fun prompt ->
                  Result.bind (json_required_bool "taumel.cron.task" fields "recurring") (fun recurring ->
                      Result.bind (json_required_string "taumel.cron.task" fields "mode") (fun mode_s ->
                          match mode_of_string mode_s with
                          | None -> Error "taumel.cron.task.mode is invalid"
                          | Some mode ->
                              Result.bind (json_required_bool "taumel.cron.task" fields "enabled") (fun enabled ->
                              Result.bind (json_required_int "taumel.cron.task" fields "createdAt") (fun created_at ->
	                                  Result.bind (json_required_int "taumel.cron.task" fields "nextDue") (fun next_due ->
                                      Result.bind
                                        (match List.assoc_opt "pendingSince" fields with
                                        | None -> Ok None
                                        | Some Null -> Error "taumel.cron.task.pendingSince must be an integer"
                                        | Some value ->
                                            Result.map Option.some
                                              (json_int "taumel.cron.task.pendingSince" value))
                                        (fun pending_since ->
                                          Result.bind (validate_prompt prompt) (fun prompt ->
                                          Result.bind (Cron_expr.parse cron) (fun expr ->
                                          if not (valid_task_id id) then
                                            Error "taumel.cron.task.id must be eight lowercase hexadecimal characters"
                                          else if created_at < 0 || next_due <= created_at then
                                            Error "taumel.cron.task timestamps are invalid"
                                          else if not (scheduled_at expr next_due) then
                                            Error "taumel.cron.task.nextDue is not a scheduled occurrence"
                                          else if
                                            match pending_since with
                                            | Some value -> value <> next_due
                                            | None -> false
                                          then
                                            Error "taumel.cron.task.pendingSince must equal nextDue"
                                          else Ok
                                            {
                                              id;
                                              cron;
                                              prompt;
	                                              recurring;
	                                              mode;
	                                              enabled;
	                                              created_at;
	                                              next_due;
	                                              pending_since;
	                                            })))))))))))))

let encode state =
  Shared.Object
    [
      ("version", Number 1.);
      ("enabled", Bool state.enabled);
      ("tasks", Array (List.map task_json state.tasks));
    ]

let decode json =
  let open Shared in
  Result.bind (json_object_fields "taumel.cron" json) (fun fields ->
      Result.bind
        (json_exact_fields "taumel.cron" [ "version"; "enabled"; "tasks" ] fields)
        (fun () ->
      Result.bind (json_required_int "taumel.cron" fields "version") (fun version ->
          if version <> 1 then Error "unsupported cron state version"
          else
      Result.bind (json_required_bool "taumel.cron" fields "enabled") (fun enabled ->
          Result.bind (json_required_field "taumel.cron" fields "tasks") (fun tasks_json ->
              Result.bind (json_array "taumel.cron.tasks" tasks_json) (fun values ->
                  let rec loop seen acc = function
                    | [] -> Ok { enabled; tasks = List.rev acc }
                    | value :: rest -> (
                        match task_of_json value with
                        | Ok task when List.mem task.id seen ->
                            Error "taumel.cron.tasks must not contain duplicate ids"
                        | Ok task -> loop (task.id :: seen) (task :: acc) rest
                        | Error _ as error -> error)
                  in
                  loop [] [] values))))))
