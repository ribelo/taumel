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
      ("tokenBudget", js_optional_int goal.token_budget);
      ("tokensUsed", js_number (float_of_int goal.tokens_used));
      ("timeUsedSeconds", js_number (float_of_int goal.time_used_seconds));
      ("createdAt", js_number (float_of_int goal.created_at));
      ("updatedAt", js_number (float_of_int goal.updated_at));
    |]

let details goal report =
  let goal_value =
    match goal with
    | None -> Unsafe.inject Js.null
    | Some goal -> inject (js_goal goal)
  in
  let remaining =
    match goal with
    | None -> None
    | Some goal -> Taumel.Goal.remaining_tokens goal
  in
  Unsafe.obj
    [|
      ("goal", goal_value);
      ("remainingTokens", js_optional_int remaining);
      ( "completionBudgetReport",
        match report with
        | None -> Unsafe.inject Js.null
        | Some message -> js_string message );
    |]

let tool_result ?completion_report goal text =
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string text);
      ("details", inject (details goal completion_report));
    ]

let command_result ?completion_report ?(followup = false) goal message =
  ok_obj
    ([
       ("action", js_string "command_result");
       ("message", js_string message);
       ("details", inject (details goal completion_report));
     ]
    @ if followup then [ ("goalFollowup", js_bool true) ] else [])

let thread_id () = if state.cwd = "" then "current" else state.cwd

let plan_continuation initial ctx =
  Session_sync.sync_session_from_host ~scope:"goal continuation" ctx;
  match Taumel.Goal.plan_continuation ~initial !current_goal with
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
      match Result.bind (json_from_js params) Taumel.Goal.create_request_of_json with
      | Error message -> error_obj message
      | Ok request -> (
          match
            Taumel.Goal.create ?token_budget:request.token_budget
              ~thread_id:(thread_id ()) ~now:(now_seconds ()) request.objective
              !current_goal
          with
      | Error message -> error_obj message
      | Ok goal ->
          current_goal := Some goal;
          Session_sync.save_goal_state ctx;
          tool_result (Some goal) "Goal created."))

let prepare_update params ctx =
  with_gateway_authorized "update_goal" (fun _ ->
      match Result.bind (json_from_js params) Taumel.Goal.update_request_of_json with
      | Error message -> error_obj message
      | Ok request -> (
          match
            Taumel.Goal.update_status ~now:(now_seconds ()) request.status
              !current_goal
          with
        | Error message -> error_obj message
        | Ok goal ->
            current_goal := Some goal;
            Session_sync.save_goal_state ctx;
            tool_result
              ?completion_report:(Taumel.Goal.completion_budget_report goal)
              (Some goal) "Goal updated."))

let handle_command args ctx =
  match
    Taumel.Goal.apply_command ~thread_id:(thread_id ()) ~now:(now_seconds ()) args
      !current_goal
  with
  | Error message -> error_obj message
  | Ok plan ->
      if plan.changed then (
        current_goal := plan.goal;
        Session_sync.save_goal_state ctx);
      command_result ?completion_report:plan.completion_report
        ~followup:plan.followup plan.goal plan.message

let goal_system_prompt event ctx =
  Session_sync.sync_session_from_host ~scope:"goal system prompt" ctx;
  match !current_goal with
  | Some goal
    when goal.status = Taumel.Goal.Active
         || goal.status = Taumel.Goal.Budget_limited ->
      let base = get_string event "systemPrompt" in
      let goal_prompt =
        match goal.status with
        | Taumel.Goal.Budget_limited -> Taumel.Goal.budget_limit_prompt goal
        | _ -> Taumel.Goal.continuation_prompt goal
      in
      Unsafe.obj [| ("systemPrompt", js_string (base ^ "\n\n" ^ goal_prompt)) |]
  | _ -> Unsafe.inject Js.undefined
