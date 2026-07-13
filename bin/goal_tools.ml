open Jsoo_bridge
open App_state
open Runtime_access

let js_optional_int = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_number (float_of_int value)

let js_goal (goal : Taumel.Goal.t) =
  Unsafe.obj
    [|
      ("goalId", js_string goal.goal_id);
      ("sessionId", js_string goal.thread_id);
      ("objective", js_string goal.objective);
      ("status", js_string (Taumel.Goal.status_to_string goal.status));
      ("statusLabel", js_string (Taumel.Goal.status_label goal.status));
      ("tokensUsed", js_number (float_of_int goal.tokens_used));
      ("timeUsedSeconds", js_number (float_of_int goal.time_used_seconds));
      ("timeUsage", js_string (Taumel.Goal.goal_usage goal));
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

let details ?(accounting_pending = false) goal automation =
  let goal_value =
    match goal with
    | None -> Unsafe.inject Js.null
    | Some goal -> inject (js_goal goal)
  in
  let fields =
    [
      ("goal", goal_value);
      ("automation", inject (js_automation automation));
    ]
    @
    if accounting_pending then [ ("accountingPending", js_bool true) ] else []
  in
  Unsafe.obj (Array.of_list fields)

let tool_result ?(accounting_pending = false) goal text =
  Boundary_contracts.BridgeToolResult.create ~text
    ~details:
      (Ts2ocaml.unknown_of_js
         (ojs_of_js (details ~accounting_pending goal !goal_automation))) ()
  |> Tool_contracts.BridgeToolResult.t_to_js |> inject

let command_result ?(followup = false) ?(inspection = false) ?start_objective
    ?rollback goal message =
  let details = Ts2ocaml.unknown_of_js (ojs_of_js (details goal !goal_automation)) in
  let goalFollowup = if followup then Some true else None in
  let goalInspection = if inspection then Some true else None in
  let goalRollback =
    Option.map (fun value -> Ts2ocaml.unknown_of_js (ojs_of_js value)) rollback
  in
  Boundary_contracts.GatewayCommandResult.create ~ok:true ~message ~details
    ?goalFollowup ?goalStartObjective:start_objective ?goalRollback ?goalInspection ()
  |> Tool_contracts.GatewayCommandResult.t_to_js |> inject

let session_id ctx = Session_store.session_id_from_ctx ctx

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

let continuation_facts facts =
  {
    Taumel.Goal.goal = !current_goal;
    automation = !goal_automation;
    host_idle = Tool_contracts.GoalContinuationFacts.get_hostIdle facts;
    has_pending_messages = Tool_contracts.GoalContinuationFacts.get_hasPendingMessages facts;
    retrying = Tool_contracts.GoalContinuationFacts.get_retrying facts;
    compacting = Tool_contracts.GoalContinuationFacts.get_compacting facts;
    latest_assistant_stop_reason = Tool_contracts.GoalContinuationFacts.get_latestAssistantStopReason facts;
  }

let plan_continuation raw_facts =
  let facts = Tool_contracts.GoalContinuationFacts.t_of_js (ojs_of_js raw_facts) in
  let ctx =
    Tool_contracts.GoalContinuationFacts.get_ctx facts
    |> Option.map (fun value -> Ts2ocaml.unknown_to_js value |> Obj.magic)
    |> Option.value ~default:(Unsafe.obj [||])
  in
  let initial = Tool_contracts.GoalContinuationFacts.get_initial facts in
  if not (Session_sync.try_sync_session_from_host ~scope:"goal continuation" ctx) then
    Boundary_contracts.GoalContinuationNone.create ()
    |> Tool_contracts.GoalContinuationNone.t_to_js |> inject
  else
    match
      Taumel.Goal.plan_continuation ~initial
        (continuation_facts facts)
    with
    | Taumel.Goal.Send_continuation plan ->
        let details = details !current_goal !goal_automation in
        Boundary_contracts.GoalContinuationSend.create
          ~customType:plan.custom_type ~content:plan.content ~display:plan.display
          ~triggerTurn:plan.trigger_turn ~deliverAs:plan.deliver_as
          ~details:(Obj.magic details) ()
        |> Tool_contracts.GoalContinuationSend.t_to_js |> inject
    | Taumel.Goal.No_continuation ->
        Boundary_contracts.GoalContinuationNone.create ()
        |> Tool_contracts.GoalContinuationNone.t_to_js |> inject

let goal_store_of_js value =
  match json_from_js value with
  | Ok json -> ( match Taumel.Goal.codec.decode json with Ok store -> store | Error _ -> None)
  | Error _ -> None

let automation_of_js value =
  match json_from_js value with
  | Ok json -> (
      match Taumel.Goal.automation_codec.decode json with
      | Ok automation -> automation
      | Error _ -> Taumel.Goal.Automation_enabled)
  | Error _ -> Taumel.Goal.Automation_enabled

let plan_child_goal_continuation facts =
  let goal = goal_store_of_js (Unsafe.get facts "goal") in
  let automation = automation_of_js (Unsafe.get facts "automation") in
  let iterations = int_field_default facts "iterations" 0 in
  let max_iterations =
    match int_field facts "maxIterations" with
    | Some value when value > 0 -> value
    | _ -> Taumel.Goal.child_continuation_default_max
  in
  let latest_assistant_stop_reason =
    Option.bind (optional_string_field facts "latestAssistantStopReason")
      Taumel.Shared.trim_non_empty
  in
  match
    Taumel.Goal.plan_child_continuation ~goal ~automation ~iterations
      ~max_iterations ~latest_assistant_stop_reason
  with
  | Taumel.Goal.Child_continue plan ->
      Boundary_contracts.ChildGoalContinuationSend.create
        ~customType:plan.custom_type ~content:plan.content ~display:plan.display
        ~triggerTurn:plan.trigger_turn ~deliverAs:plan.deliver_as ()
      |> Tool_contracts.ChildGoalContinuationSend.t_to_js |> inject
  | Taumel.Goal.Child_finalize { child_status; child_reason } ->
      Boundary_contracts.ChildGoalContinuationFinalize.create ~status:child_status
        ?reason:child_reason ()
      |> Tool_contracts.ChildGoalContinuationFinalize.t_to_js |> inject

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
        Taumel.Goal.create ?time_limit_seconds ~thread_id:(session_id ctx)
          ~now:(now_seconds ()) objective !current_goal
      with
      | Error message -> error_obj message
      | Ok goal ->
          current_goal := Some goal;
          goal_automation := Taumel.Goal.Automation_enabled;
          pending_goal_terminal_status := None;
          Session_sync.save_goal_state ctx;
          Session_sync.save_goal_automation_state ctx;
          tool_result (Some goal) "Goal created.")

let create_from_cron raw_facts =
  let facts = Tool_contracts.CronGoalCreationFacts.t_of_js (ojs_of_js raw_facts) in
  let objective = Tool_contracts.CronGoalCreationFacts.get_objective facts in
  let ctx = Tool_contracts.CronGoalCreationFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> Obj.magic
  in
  let params = Tool_contracts.CreateGoalParams.create ~objective ()
    |> Tool_contracts.CreateGoalParams.t_to_js |> Obj.magic
  in
  let result = prepare_create params ctx in
  Tool_contracts.CronGoalCreationResult.create ~created:(get_bool result "ok") ()
  |> Tool_contracts.CronGoalCreationResult.t_to_js |> inject

let prepare_update params ctx =
  with_gateway_authorized "update_goal" (fun _ ->
      let params = Tool_contracts.UpdateGoalParams.t_of_js (ojs_of_js params) in
      let status = Boundary_contracts.UpdateGoalParams.get_status params in
      let status =
        match status with
        | `V_complete -> Taumel.Goal.Complete
        | `V_blocked -> Taumel.Goal.Blocked
      in
      let was_active =
        match !current_goal with
        | Some goal when goal.status = Taumel.Goal.Active -> true
        | _ -> false
      in
      if was_active then Session_sync.account_goal_turn_end ctx;
      match Taumel.Goal.update_status ~now:(now_seconds ()) status !current_goal with
      | Error message -> error_obj message
      | Ok goal ->
          current_goal := Some goal;
          pending_goal_terminal_status := None;
          Session_sync.save_goal_state ctx;
          tool_result (Some goal) "Goal updated.")

let finalize_error status ctx =
  let status =
    if status = "usage_limited" then Taumel.Goal.Usage_limited
    else Taumel.Goal.Blocked
  in
  match !current_goal with
  | Some goal when goal.status = Taumel.Goal.Active -> (
      let goal = { goal with status; updated_at = now_seconds () } in
      current_goal := Some goal;
      Session_sync.save_goal_state ctx)
  | _ -> ()

let handle_command args ctx =
  let previous_goal = !current_goal in
  let previous_automation = !goal_automation in
  match
    Taumel.Goal.apply_command ~automation:!goal_automation
      ~thread_id:(session_id ctx) ~now:(now_seconds ()) args !current_goal
  with
  | Error message -> error_obj message
  | Ok plan ->
      if plan.changed then (
        pending_goal_terminal_status := None;
        current_goal := plan.goal;
        (match plan.automation with
        | None -> ()
        | Some automation -> goal_automation := automation);
        Session_sync.save_goal_state ctx;
        if Option.is_some plan.automation then
          Session_sync.save_goal_automation_state ctx);
      let command, _ = Taumel.Goal.split_command args in
      let starts_goal =
        plan.followup && String.lowercase_ascii command <> "resume"
      in
      let start_objective =
        if starts_goal then
          let (goal : Taumel.Goal.t option) = plan.goal in
          Option.map (fun (g : Taumel.Goal.t) -> g.objective) goal
        else None
      in
      let rollback =
        if not starts_goal then None
        else
          let goal =
            match previous_goal with
            | None -> Unsafe.inject Js.null
            | Some goal -> inject (js_goal goal)
          in
          Some
            (Unsafe.obj
               [|
                 ("goal", goal);
                 ("automation", inject (js_automation previous_automation));
               |])
      in
      command_result ~followup:(plan.followup && not starts_goal)
        ~inspection:(String.trim args = "")
        ?start_objective ?rollback plan.goal plan.message

let rollback_goal_command raw_facts =
  let facts = Tool_contracts.GoalRollbackFacts.t_of_js (ojs_of_js raw_facts) in
  let snapshot = Tool_contracts.GoalRollbackFacts.get_snapshot facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  let ctx = Tool_contracts.GoalRollbackFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  current_goal := goal_store_of_js (Unsafe.get snapshot "goal");
  goal_automation := automation_of_js (Unsafe.get snapshot "automation");
  pending_goal_terminal_status := None;
  Session_sync.save_goal_state ctx;
  Session_sync.save_goal_automation_state ctx;
  Boundary_contracts.GoalRollbackResult.create ()
  |> Tool_contracts.GoalRollbackResult.t_to_js |> inject
