type task_status =
  | Running
  | Paused
  | Finished
  | Archived

type actor =
  | Controller of string
  | Child of string

type task = {
  id : string;
  objective : string;
  controller_session : string;
  child_session : string option;
  iteration : int;
  max_iterations : int option;
  reflection_every : int option;
  status : task_status;
}

let status_to_string = function
  | Running -> "running"
  | Paused -> "paused"
  | Finished -> "finished"
  | Archived -> "archived"

let status_of_string = function
  | "running" -> Some Running
  | "paused" -> Some Paused
  | "finished" -> Some Finished
  | "archived" -> Some Archived
  | _ -> None

let start ?max_iterations ?reflection_every ~id ~controller_session objective =
  let valid_limit = function None -> true | Some value -> value > 0 && value <= 2_147_483_647 in
  if not (valid_limit max_iterations && valid_limit reflection_every) then
    Error "ralph iteration controls must be representable positive integers"
  else match Shared.require_non_empty "ralph objective" objective with
  | Error _ as error -> error
  | Ok objective ->
      Ok
        {
          id;
          objective;
          controller_session;
          child_session = None;
          iteration = 0;
          max_iterations;
          reflection_every;
          status = Running;
        }

let ensure_controller task = function
  | Controller session when session = task.controller_session -> Ok ()
  | Controller _ -> Error "ralph command belongs to a different controller session"
  | Child _ -> Error "controller command cannot be called by the child session"

let ensure_child task = function
  | Child session when task.child_session = Some session -> Ok ()
  | Child _ -> Error "child command belongs to a different child session"
  | Controller _ -> Error "child command cannot be called by the controller session"

let attach_child actor child_session task =
  ensure_controller task actor
  |> Result.map (fun () -> { task with child_session = Some child_session })

let pause actor task =
  ensure_controller task actor |> Result.map (fun () -> { task with status = Paused })

let resume actor task =
  ensure_controller task actor |> Result.map (fun () -> { task with status = Running })

let finish actor task =
  ensure_controller task actor |> Result.map (fun () -> { task with status = Finished })

let archive actor task =
  ensure_controller task actor |> Result.map (fun () -> { task with status = Archived })

let should_reflect task =
  match task.reflection_every with
  | Some every when every > 0 -> task.iteration > 0 && task.iteration mod every = 0
  | _ -> false

let ralph_continue actor task =
  match ensure_child task actor with
  | Error _ as error -> error
  | Ok () ->
      if task.status <> Running then Error "ralph task is not running"
      else if task.iteration >= 2_147_483_647 then
        Error "ralph iteration limit is exhausted"
      else
        let next_iteration = task.iteration + 1 in
        match task.max_iterations with
        | Some max_iterations when next_iteration > max_iterations ->
            Ok { task with status = Paused }
        | _ -> Ok { task with iteration = next_iteration }

let ralph_finish actor task =
  ensure_child task actor |> Result.map (fun () -> { task with status = Finished })

let child_prompt task =
  String.concat "\n"
    [
      "Ralph task " ^ task.id;
      "Objective: " ^ task.objective;
      "";
      "Use ralph_continue with task_id " ^ task.id
      ^ " for each iteration, or ralph_finish when complete.";
    ]

type start_args = {
  objective : string;
  max_iterations : int option;
  reflection_every : int option;
}

type start_details = {
  task_id : string;
  child_session_id : string;
  child_prompt : string;
}

type command_plan = {
  tasks : task list;
  message : string;
  start_details : start_details option;
  changed : bool;
}

let split_command input =
  let input = String.trim input in
  if input = "" then ("", "")
  else
    match String.index_opt input ' ' with
    | None -> (input, "")
    | Some index ->
        let command = String.sub input 0 index |> String.trim in
        let rest =
          String.sub input (index + 1) (String.length input - index - 1)
          |> String.trim
        in
        (command, rest)

let words value =
  value |> String.split_on_char ' ' |> List.filter (fun item -> item <> "")

let parse_positive_int label value =
  match int_of_string_opt value with
  | Some int when int > 0 && int <= 2_147_483_647 -> Ok int
  | _ -> Error (label ^ " must be a positive integer")

let parse_start_args args =
  let rec loop max_iterations reflection_every objective_parts = function
    | [] ->
        let objective = String.concat " " (List.rev objective_parts) |> String.trim in
        if objective = "" then Error "ralph objective is required"
        else Ok { objective; max_iterations; reflection_every }
    | ("--max-iterations" | "--max") :: value :: rest when objective_parts = [] -> (
        match parse_positive_int "max iterations" value with
        | Error _ as error -> error
        | Ok max_iterations ->
            loop (Some max_iterations) reflection_every objective_parts rest)
    | ("--max-iterations" | "--max") :: [] when objective_parts = [] ->
        Error "max iterations requires a value"
    | ("--reflection-every" | "--reflect-every" | "--reflect") :: value :: rest
      when objective_parts = [] -> (
        match parse_positive_int "reflection cadence" value with
        | Error _ as error -> error
        | Ok reflection_every ->
            loop max_iterations (Some reflection_every) objective_parts rest)
    | ("--reflection-every" | "--reflect-every" | "--reflect") :: []
      when objective_parts = [] ->
        Error "reflection cadence requires a value"
    | part :: rest -> loop max_iterations reflection_every (part :: objective_parts) rest
  in
  loop None None [] (words args)

let task_line (task : task) =
  let child = Option.value task.child_session ~default:"none" in
  let max =
    match task.max_iterations with
    | None -> ""
    | Some value -> Printf.sprintf " max=%d" value
  in
  let reflection =
    match task.reflection_every with
    | None -> ""
    | Some value -> Printf.sprintf " reflect=%d" value
  in
  Printf.sprintf "%s [%s] child=%s iteration=%d%s%s objective=%s" task.id
    (status_to_string task.status)
    child task.iteration max reflection task.objective

let replace_task updated tasks =
  List.map
    (fun (task : task) -> if task.id = updated.id then updated else task)
    tasks

let find_task id tasks = List.find_opt (fun (task : task) -> task.id = id) tasks

let list_plan tasks =
  let visible = List.filter (fun (task : task) -> task.status <> Archived) tasks in
  let message =
    match visible with
    | [] -> "No Ralph tasks."
    | tasks -> String.concat "\n" (List.map task_line tasks)
  in
  { tasks; message; start_details = None; changed = false }

let start_plan ~now ~controller_session ~child_session_for_id ~start_denied tasks
    args =
  match start_denied with
  | Some message -> Error message
  | None ->
      let ( let* ) = Result.bind in
      let* parsed = parse_start_args args in
      let id = "ralph-" ^ string_of_int now in
      let* task =
        start ?max_iterations:parsed.max_iterations
          ?reflection_every:parsed.reflection_every ~id ~controller_session
          parsed.objective
      in
      let child_session = child_session_for_id id in
      let task = { task with child_session = Some child_session } in
      Ok
        {
          tasks = task :: tasks;
          message = "Started " ^ task_line task;
          start_details =
            Some
              {
                task_id = task.id;
                child_session_id = child_session;
                child_prompt = child_prompt task;
              };
          changed = true;
        }

let update_plan ~controller_session action id tasks =
  match find_task (String.trim id) tasks with
  | None -> Error ("unknown Ralph task: " ^ String.trim id)
  | Some task ->
      let actor = Controller controller_session in
      let result =
        match action with
        | "pause" -> pause actor task
        | "resume" -> resume actor task
        | "finish" -> finish actor task
        | "archive" -> archive actor task
        | _ -> Error "unknown Ralph action"
      in
      Result.map
        (fun updated ->
          {
            tasks = replace_task updated tasks;
            message = task_line updated;
            start_details = None;
            changed = true;
          })
        result

let command_usage =
  "usage: /ralph [list|start <objective>|pause <id>|resume <id>|finish <id>|archive <id>]"

let apply_command ~now ~controller_session ~child_session_for_id ~start_denied
    tasks args =
  let command, rest = split_command args in
  match command with
  | "" | "list" -> Ok (list_plan tasks)
  | "start" ->
      start_plan ~now ~controller_session ~child_session_for_id ~start_denied
        tasks rest
  | ("pause" | "resume" | "finish" | "archive") as action ->
      update_plan ~controller_session action rest tasks
  | _ -> Error command_usage

let option_string_to_json = function
  | None -> Shared.Null
  | Some value -> Shared.String value

let option_int_to_json = function
  | None -> Shared.Null
  | Some value -> Shared.Number (float_of_int value)

let task_to_json task =
  Shared.Object
    [
      ("id", Shared.String task.id);
      ("objective", Shared.String task.objective);
      ("controllerSession", Shared.String task.controller_session);
      ("childSession", option_string_to_json task.child_session);
      ("iteration", Shared.Number (float_of_int task.iteration));
      ("maxIterations", option_int_to_json task.max_iterations);
      ("reflectionEvery", option_int_to_json task.reflection_every);
      ("status", Shared.String (status_to_string task.status));
    ]

let task_of_json = function
  | Shared.Object fields ->
      let string_field name =
        match List.assoc_opt name fields with
        | Some (Shared.String value) -> Ok value
        | _ -> Error (name ^ " must be a string")
      in
      let option_string_field name =
        match List.assoc_opt name fields with
        | Some Shared.Null -> Ok None
        | Some (Shared.String value) -> Ok (Some value)
        | None -> Error (name ^ " is required")
        | _ -> Error (name ^ " must be null or a string")
      in
      let int_field name = Shared.json_required_int "Ralph task" fields name in
      let option_int_field name =
        match List.assoc_opt name fields with
        | None -> Error (name ^ " is required")
        | Some Shared.Null -> Ok None
        | Some value ->
            Result.map Option.some (Shared.json_int ("Ralph task." ^ name) value)
      in
      let ( let* ) = Result.bind in
      let* () =
        Shared.json_exact_fields "Ralph task"
          [ "id"; "objective"; "controllerSession"; "childSession";
            "iteration"; "maxIterations"; "reflectionEvery"; "status" ]
          fields
      in
      let* status_name = string_field "status" in
      let* status =
        match status_of_string status_name with
        | None -> Error ("unknown Ralph task status: " ^ status_name)
        | Some value -> Ok value
      in
      let* id = string_field "id" in
      let* objective = string_field "objective" in
      let* controller_session = string_field "controllerSession" in
      let* child_session = option_string_field "childSession" in
      let* iteration = int_field "iteration" in
      let* max_iterations = option_int_field "maxIterations" in
      let* reflection_every = option_int_field "reflectionEvery" in
      let* () =
        if iteration < 0 then Error "iteration must be non-negative"
        else
          match (max_iterations, reflection_every) with
          | Some value, _ when value <= 0 -> Error "maxIterations must be positive"
          | _, Some value when value <= 0 -> Error "reflectionEvery must be positive"
          | _ -> Ok ()
      in
      Ok
        {
          id;
          objective;
          controller_session;
          child_session;
          iteration;
          max_iterations;
          reflection_every;
          status;
        }
  | _ -> Error "Ralph task must be an object"

let tasks_to_json tasks =
  Shared.Object
    [
      ("version", Shared.Number 1.);
      ("tasks", Shared.Array (List.map task_to_json tasks));
    ]

let tasks_of_json = function
  | Shared.Object fields -> (
      match
        Result.bind
          (Shared.json_exact_fields "Ralph state" [ "version"; "tasks" ] fields)
          (fun () -> Shared.json_required_int "Ralph state" fields "version")
      with
      | Error _ as error -> error
      | Ok version when version <> 1 -> Error "unsupported Ralph state version"
      | Ok _ -> (
      match List.assoc_opt "tasks" fields with
      | Some (Shared.Array values) ->
          let rec collect acc = function
            | [] -> Ok (List.rev acc)
            | value :: rest -> (
                match task_of_json value with
                | Ok task -> collect (task :: acc) rest
                | Error _ as error -> error)
          in
          collect [] values
      | _ -> Error "Ralph state requires tasks"))
  | _ -> Error "Ralph state must be an object"

let codec = { Shared.encode = tasks_to_json; decode = tasks_of_json }

let tool_specs =
  [
    { Tool_gateway.name = "ralph_continue"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "ralph_finish"; effect_kind = Tool_gateway.Pure };
  ]
