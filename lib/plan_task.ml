type status = Pending | In_progress | Completed | Cancelled

type origin = User | Agent

type t = {
  task_id : string;
  title : string;
  description : string option;
  status : status;
  cancellation_reason : string option;
  depends_on : string list;
  origin : origin;
}

type creation = {
  id : string option;
  title : string;
  description : string option;
  depends_on : string list;
}

type description_update =
  | Keep_description
  | Set_description of string
  | Clear_description

type update = {
  title : string option;
  description : description_update;
  status : status option;
  reason : string option;
  depends_on : string list option;
}

let no_update =
  {
    title = None;
    description = Keep_description;
    status = None;
    reason = None;
    depends_on = None;
  }

let status_to_string = function
  | Pending -> "pending"
  | In_progress -> "in_progress"
  | Completed -> "completed"
  | Cancelled -> "cancelled"

let status_of_string = function
  | "pending" -> Some Pending
  | "in_progress" -> Some In_progress
  | "completed" -> Some Completed
  | "cancelled" -> Some Cancelled
  | _ -> None

let origin_to_string = function User -> "user" | Agent -> "agent"

let origin_of_string = function
  | "user" -> Some User
  | "agent" -> Some Agent
  | _ -> None

let unfinished (task : t) = task.status = Pending || task.status = In_progress

let dependency_finished (task : t) =
  task.status = Completed || task.status = Cancelled

let normalize_title title = Shared.require_non_empty "plan task title" title

let normalize_cancellation_reason = function
  | None -> Error "cancelling a plan task requires a non-empty reason"
  | Some reason ->
      Shared.require_non_empty "plan task cancellation reason" reason
      |> Result.map Option.some

let normalize_explicit_id = function
  | None -> Ok None
  | Some id ->
      let id = String.trim id in
      if id = "" then Error "explicit plan task id must not be empty"
      else Ok (Some id)

let duplicate values =
  let rec loop seen = function
    | [] -> None
    | value :: rest ->
        if List.mem value seen then Some value else loop (value :: seen) rest
  in
  loop [] values

let validate_graph (tasks : t list) =
  let ids = List.map (fun task -> task.task_id) tasks in
  match duplicate ids with
  | Some id -> Error ("duplicate plan taskId: " ^ id)
  | None -> (
      match
        List.find_map
          (fun task ->
            List.find_opt
              (fun dependency -> not (List.mem dependency ids))
              task.depends_on
            |> Option.map (fun dependency -> (task.task_id, dependency)))
          tasks
      with
      | Some (task_id, dependency) ->
          Error
            (Printf.sprintf "plan task %s depends on unknown task: %s" task_id
               dependency)
      | None -> (
          let dependencies id =
            List.find_opt (fun task -> task.task_id = id) tasks
            |> Option.map (fun (task : t) -> task.depends_on)
            |> Option.value ~default:[]
          in
          let rec reaches target visited id =
            if id = target then true
            else if List.mem id visited then false
            else List.exists (reaches target (id :: visited)) (dependencies id)
          in
          match
            List.find_opt
              (fun task ->
                List.exists (reaches task.task_id []) task.depends_on)
              tasks
          with
          | Some task ->
              Error ("plan task dependency cycle includes task: " ^ task.task_id)
          | None -> Ok ()))

let blocking_dependencies (tasks : t list) (task : t) =
  task.depends_on
  |> List.filter_map (fun id ->
      List.find_opt (fun candidate -> candidate.task_id = id) tasks)
  |> List.filter (fun dependency -> not (dependency_finished dependency))

let blocker_to_json (task : t) =
  Shared.Object
    [
      ("taskId", Shared.String task.task_id);
      ("title", Shared.String task.title);
      ("status", Shared.String (status_to_string task.status));
    ]

let blockers_error blockers =
  let payload =
    Shared.encode_json (Shared.Array (List.map blocker_to_json blockers))
  in
  "cannot set plan task to in_progress while dependencies are unfinished: "
  ^ payload ^ "; complete or cancel the blocking tasks first"

let to_json (task : t) =
  let fields =
    [
      ("taskId", Shared.String task.task_id);
      ("title", Shared.String task.title);
      ("description", Shared.option_string_to_json task.description);
      ("status", Shared.String (status_to_string task.status));
      ( "depends_on",
        Shared.Array (List.map (fun id -> Shared.String id) task.depends_on) );
      ("origin", Shared.String (origin_to_string task.origin));
    ]
  in
  Shared.Object
    (match task.cancellation_reason with
    | None -> fields
    | Some reason -> ("cancellationReason", Shared.String reason) :: fields)

let continuation_to_json (tasks : t list) (task : t) =
  let blockers = blocking_dependencies tasks task in
  match to_json task with
  | Shared.Object fields ->
      Shared.Object
        (( "readiness",
           Shared.String
             (if blockers = [] then "runnable" else "waiting_on_dependency") )
        :: List.remove_assoc "description" fields)
  | _ -> assert false

let unfinished_json tasks =
  tasks |> List.filter unfinished |> List.map (continuation_to_json tasks)
  |> fun values ->
  Shared.encode_json (Shared.Array values)
  |> String.split_on_char '<' |> String.concat "\\u003c"
  |> String.split_on_char '>' |> String.concat "\\u003e"

let string_list_field path fields name =
  match List.assoc_opt name fields with
  | Some (Shared.Array values) ->
      let rec loop index acc = function
        | [] -> Ok (List.rev acc)
        | Shared.String value :: rest -> loop (index + 1) (value :: acc) rest
        | _ ->
            Error (Printf.sprintf "%s.%s[%d] must be a string" path name index)
      in
      loop 0 [] values
  | _ -> Error (path ^ "." ^ name ^ " must be an array")

let of_json index = function
  | Shared.Object fields ->
      let path = Printf.sprintf "tasks[%d]" index in
      let string_field name =
        match List.assoc_opt name fields with
        | Some (Shared.String value) -> Ok value
        | _ -> Error (path ^ "." ^ name ^ " must be a string")
      in
      let option_string_field name =
        match List.assoc_opt name fields with
        | Some Shared.Null -> Ok None
        | Some (Shared.String value) -> Ok (Some value)
        | _ -> Error (path ^ "." ^ name ^ " must be null or a string")
      in
      let ( let* ) = Result.bind in
      let fields_without_cancellation_reason =
        List.filter (fun (name, _) -> name <> "cancellationReason") fields
      in
      let* () =
        Shared.json_exact_fields path
          [ "taskId"; "title"; "description"; "status"; "depends_on"; "origin" ]
          fields_without_cancellation_reason
      in
      let* task_id = string_field "taskId" in
      let* title = string_field "title" in
      let* description = option_string_field "description" in
      let* status_name = string_field "status" in
      let* status =
        match status_of_string status_name with
        | Some status -> Ok status
        | None -> Error ("unknown plan task status: " ^ status_name)
      in
      let* cancellation_reason =
        match (status, List.assoc_opt "cancellationReason" fields) with
        | Cancelled, Some (Shared.String reason) ->
            let trimmed = String.trim reason in
            if trimmed = "" then
              Error (path ^ ".cancellationReason must not be empty")
            else if trimmed <> reason then
              Error
                (path
               ^ ".cancellationReason must not have surrounding whitespace")
            else Ok (Some reason)
        | Cancelled, _ ->
            Error (path ^ ".cancelled task requires cancellationReason")
        | _, None -> Ok None
        | _, Some _ ->
            Error
              (path
             ^ ".cancellationReason is permitted only on a cancelled task")
      in
      let* depends_on = string_list_field path fields "depends_on" in
      let* origin_name = string_field "origin" in
      let* origin =
        match origin_of_string origin_name with
        | Some origin -> Ok origin
        | None -> Error ("unknown plan task origin: " ^ origin_name)
      in
      let* () =
        if String.trim task_id = "" then
          Error (path ^ ".taskId must not be empty")
        else if title <> String.trim title then
          Error (path ^ ".title must not have surrounding whitespace")
        else Result.map (fun _ -> ()) (normalize_title title)
      in
      Ok
        {
          task_id;
          title;
          description;
          status;
          cancellation_reason;
          depends_on;
          origin;
        }
  | _ -> Error (Printf.sprintf "tasks[%d] must be an object" index)

let list_of_json = function
  | Shared.Array values ->
      let rec loop index acc = function
        | [] ->
            let tasks = List.rev acc in
            if tasks = [] then Error "plan must contain at least one task"
            else Result.map (fun () -> tasks) (validate_graph tasks)
        | value :: rest ->
            Result.bind (of_json index value) (fun task ->
                loop (index + 1) (task :: acc) rest)
      in
      loop 0 [] values
  | _ -> Error "tasks must be an array"
