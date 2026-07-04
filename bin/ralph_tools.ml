open Jsoo_bridge
open App_state
open Runtime_access

let controller_session_id_from_ctx ctx =
  match optional_string_field ctx "taumelRalphControllerSessionId" with
  | Some value when String.trim value <> "" -> String.trim value
  | _ -> Session_store.session_id_from_ctx ctx

let child_session_from_ctx id ctx =
  match optional_string_field ctx "taumelRalphChildSessionId" with
  | Some value when String.trim value <> "" -> String.trim value
  | _ -> "child-" ^ id

let tool_result task message =
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string message);
      ( "details",
        inject
          (Unsafe.obj
             [|
               ("ok", js_bool true);
               ("taskId", js_string task.Taumel.Ralph_loop.id);
               ("iteration", js_number (float_of_int task.iteration));
               ("status", js_string (Taumel.Ralph_loop.status_to_string task.status));
               ("reflection", js_bool (Taumel.Ralph_loop.should_reflect task));
               ( "maxIterations",
                 match task.max_iterations with
                 | None -> Unsafe.inject Js.null
                 | Some value -> js_number (float_of_int value) );
               ( "reflectionEvery",
                 match task.reflection_every with
                 | None -> Unsafe.inject Js.null
                 | Some value -> js_number (float_of_int value) );
             |]) );
    ]

let prepare_child_tool name params ctx =
  with_gateway_authorized name (fun _ ->
      let params = Tool_contracts.RalphTaskParams.t_of_js (ojs_of_js params) in
      let task_id = Tool_contracts.RalphTaskParams.get_task_id params in
      match Taumel.Shared.trim_non_empty task_id with
      | None -> error_obj (name ^ ".task_id is required")
      | Some task_id -> (
        match Taumel.Ralph_loop.find_task task_id !ralph_tasks with
        | None -> error_obj ("unknown Ralph task: " ^ task_id)
        | Some task -> (
            let child_session = Session_store.session_id_from_ctx ctx in
            let actor = Taumel.Ralph_loop.Child child_session in
            let result =
              match name with
              | "ralph_continue" -> Taumel.Ralph_loop.ralph_continue actor task
              | "ralph_finish" -> Taumel.Ralph_loop.ralph_finish actor task
              | _ -> Error ("not a Ralph child tool: " ^ name)
            in
            match result with
            | Error message -> error_obj message
            | Ok updated ->
                ralph_tasks :=
                  Taumel.Ralph_loop.replace_task updated !ralph_tasks;
                Session_sync.save_ralph_state ctx;
                tool_result updated
                  (Printf.sprintf "%s accepted for %s" name task_id))))

let command_result ?details message =
  let fields =
    [ ("action", js_string "command_result"); ("message", js_string message) ]
  in
  let fields =
    match details with
    | None -> fields
    | Some details -> fields @ [ ("details", inject details) ]
  in
  ok_obj fields

let start_details (details : Taumel.Ralph_loop.start_details) =
  Unsafe.obj
    [|
      ("ok", js_bool true);
      ("taskId", js_string details.task_id);
      ("childSessionId", js_string details.child_session_id);
      ("childPrompt", js_string details.child_prompt);
    |]

let handle_command args ctx =
  let command, _ = Taumel.Ralph_loop.split_command args in
  let start_denied =
    if command <> "start" then None
    else match authorize_ralph_start () with Ok () -> None | Error message -> Some message
  in
  match
    Taumel.Ralph_loop.apply_command ~now:(now_seconds ())
      ~controller_session:(controller_session_id_from_ctx ctx)
      ~child_session_for_id:(fun id -> child_session_from_ctx id ctx)
      ~start_denied !ralph_tasks args
  with
  | Error message -> error_obj message
  | Ok plan ->
      if plan.changed then (
        ralph_tasks := plan.tasks;
        Session_sync.save_ralph_state ctx);
      (match plan.start_details with
      | None -> command_result plan.message
      | Some details -> command_result ~details:(start_details details) plan.message)
