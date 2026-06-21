type child_session_plan = {
  metadata : Shared.json;
  context_overrides : (string * string) list;
  active_tools_mode : string;
  child_session_context_key : string;
}

type execution_plan =
  | Command_direct
  | Command_child_session of child_session_plan

type result_details = {
  task_id : string;
  child_prompt : string;
}

type command_result = {
  object_like : bool;
  ok : bool;
  details : result_details;
}

type child_dispatch = {
  bridge_update_action : string;
  bridge_update_key : string;
  prompt : string;
}

type child_dispatch_plan =
  | Command_return
  | Command_child_dispatch of child_dispatch

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

let option_int_to_json = function
  | None -> Shared.Null
  | Some value -> Shared.Number (float_of_int value)

let ralph_metadata ~controller_session_id (parsed : Ralph_loop.start_args) =
  Shared.Object
    [
      ("kind", Shared.String "ralph");
      ("objective", Shared.String parsed.objective);
      ("controllerSessionId", Shared.String controller_session_id);
      ("maxIterations", option_int_to_json parsed.max_iterations);
      ("reflectionEvery", option_int_to_json parsed.reflection_every);
    ]

let plan_execution ~controller_session_id ~ralph_start_denial name args =
  match name with
  | "ralph" ->
      let command, rest = split_command args in
      if command = "start" && String.trim rest <> "" then
        match ralph_start_denial with
        | Some message -> Error message
        | None -> (
            match Ralph_loop.parse_start_args rest with
            | Error _ as error -> error
            | Ok parsed ->
                Ok
                  (Command_child_session
                     {
                       metadata = ralph_metadata ~controller_session_id parsed;
                       context_overrides =
                         [
                           ( "taumelRalphControllerSessionId",
                             controller_session_id );
                         ];
                       active_tools_mode = "ralph_child";
                       child_session_context_key = "taumelRalphChildSessionId";
                     }))
      else Ok Command_direct
  | _ -> Ok Command_direct

let trim_non_empty value = Shared.trim_non_empty value

let plan_child_dispatch result bridge =
  if (not result.object_like) || not result.ok then Command_return
  else
    match bridge with
    | Some bridge -> (
        let details = result.details in
        match
          ( trim_non_empty details.task_id,
            trim_non_empty details.child_prompt,
            bridge.Child_session.session_id )
        with
        | Some task_id, Some prompt, Some _
          when (not bridge.cancelled) && bridge.error = None ->
            Command_child_dispatch
              {
                bridge_update_action = "store_child_session";
                bridge_update_key = "ralph:" ^ task_id;
                prompt;
              }
        | _ -> Command_return)
    | None -> Command_return
