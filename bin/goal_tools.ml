open Jsoo_bridge
open App_state

let js_optional_int = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_number (float_of_int value)

let js_goal (goal : Taumel.Goal.t) =
  Unsafe.obj
    [|
      ("goalId", js_string goal.goal_id);
      ("threadId", js_string goal.thread_id);
      ("objective", js_string goal.objective);
      ("status", js_string (Taumel.Goal.status_to_string goal.status));
      ("tokensUsed", js_number (float_of_int goal.tokens_used));
      ("timeUsedSeconds", js_number (float_of_int goal.time_used_seconds));
      ("timeLimitSeconds", js_optional_int goal.time_limit_seconds);
      ("createdAt", js_number (float_of_int goal.created_at));
      ("updatedAt", js_number (float_of_int goal.updated_at));
    |]

let js_automation automation =
  Unsafe.obj
    [|
      ("continuation", js_string (Taumel.Goal.automation_to_string automation));
      ( "requiresUserInput",
        js_bool (Taumel.Goal.automation_requires_user_input automation) );
    |]

let details goal automation =
  let goal_value =
    match goal with
    | None -> Unsafe.inject Js.null
    | Some goal -> inject (js_goal goal)
  in
  Unsafe.obj
    [|
      ("goal", goal_value);
      ("automation", inject (js_automation automation));
    |]

let tool_result goal text =
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string text);
      ("details", inject (details goal !goal_automation));
    ]

let command_result ?(followup = false) goal message =
  ok_obj
    ([
       ("action", js_string "command_result");
       ("message", js_string message);
       ("details", inject (details goal !goal_automation));
     ]
    @ if followup then [ ("goalFollowup", js_bool true) ] else [])

let thread_id () = if state.cwd = "" then "current" else state.cwd

let latest_assistant_stop_reason event =
  let messages = get_object_array event "messages" in
  let rec loop = function
    | [] -> None
    | message :: rest ->
        if get_string message "role" = "assistant" then
          match get_string message "stopReason" with
          | "" -> loop rest
          | value -> Some value
        else loop rest
  in
  loop (List.rev messages)

let continuation_facts facts event ctx =
  {
    Taumel.Goal.goal = !current_goal;
    automation = !goal_automation;
    host_idle = get_bool facts "hostIdle";
    has_pending_messages = get_bool facts "hasPendingMessages";
    retrying = get_bool facts "retrying";
    compacting = get_bool facts "compacting";
    latest_assistant_stop_reason = latest_assistant_stop_reason event;
  }

let plan_continuation initial facts event ctx =
  Session_sync.sync_session_from_host ~scope:"goal continuation" ctx;
  match
    Taumel.Goal.plan_continuation ~initial
      (continuation_facts facts event ctx)
  with
  | Taumel.Goal.Send_continuation plan ->
      ok_obj
        [
          ("action", js_string "send_goal_continuation");
          ("customType", js_string plan.custom_type);
          ("content", js_string plan.content);
          ("display", js_bool plan.display);
          ("triggerTurn", js_bool plan.trigger_turn);
          ("deliverAs", js_string plan.deliver_as);
        ]
  | Taumel.Goal.No_continuation -> ok_obj [ ("action", js_string "none") ]

let prepare_get () =
  with_gateway_authorized "get_goal" (fun _ ->
      let text =
        match !current_goal with
        | None -> "No active goal."
        | Some _ -> Taumel.Goal.summary !current_goal
      in
      tool_result !current_goal text)

let prepare_create params ctx =
  with_gateway_authorized "create_goal" (fun _ ->
      let params = Tool_contracts.CreateGoalParams.t_of_js (ojs_of_js params) in
      let objective = Tool_contracts.CreateGoalParams.get_objective params in
      let time_limit_seconds =
        Option.map int_of_float
          (Tool_contracts.CreateGoalParams.get_time_limit_seconds params)
      in
      match
        Taumel.Goal.create ?time_limit_seconds ~thread_id:(thread_id ())
          ~now:(now_seconds ()) objective !current_goal
      with
      | Error message -> error_obj message
      | Ok goal ->
          current_goal := Some goal;
          goal_automation := Taumel.Goal.Automation_enabled;
          Session_sync.save_goal_state ctx;
          Session_sync.save_goal_automation_state ctx;
          tool_result (Some goal) "Goal created.")

let prepare_update params ctx =
  with_gateway_authorized "update_goal" (fun _ ->
      let params = Tool_contracts.UpdateGoalParams.t_of_js (ojs_of_js params) in
      let status = Tool_contracts.UpdateGoalParams.get_status params in
      let status =
        match status with
        | "complete" -> Taumel.Goal.Complete
        | "blocked" -> Taumel.Goal.Blocked
        | _ -> failwith "invalid parsed update_goal.status"
      in
      match Taumel.Goal.update_status ~now:(now_seconds ()) status !current_goal with
      | Error message -> error_obj message
      | Ok goal ->
          current_goal := Some goal;
          Session_sync.save_goal_state ctx;
          tool_result (Some goal) "Goal updated.")

let handle_command args ctx =
  match
    Taumel.Goal.apply_command ~thread_id:(thread_id ()) ~now:(now_seconds ()) args
      !current_goal
  with
  | Error message -> error_obj message
  | Ok plan ->
      if plan.changed then (
        current_goal := plan.goal;
        (match plan.automation with
        | None -> ()
        | Some automation -> goal_automation := automation);
        Session_sync.save_goal_state ctx;
        if Option.is_some plan.automation then
          Session_sync.save_goal_automation_state ctx);
      command_result ~followup:plan.followup plan.goal plan.message

let goal_system_prompt event ctx =
  Session_sync.sync_session_from_host ~scope:"goal system prompt" ctx;
  match (!current_goal, !goal_automation) with
  | Some goal, Taumel.Goal.Automation_enabled when goal.status = Taumel.Goal.Active
    ->
      let base = get_string event "systemPrompt" in
      let goal_prompt = Taumel.Goal.continuation_prompt goal in
      Unsafe.obj [| ("systemPrompt", js_string (base ^ "\n\n" ^ goal_prompt)) |]
  | Some _, Taumel.Goal.Automation_interrupted ->
      Session_sync.clear_interrupted_goal_automation ctx;
      Unsafe.inject Js.undefined
  | _ -> Unsafe.inject Js.undefined
