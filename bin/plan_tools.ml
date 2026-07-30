open Jsoo_bridge
open App_state
open Runtime_access

let notify_info ctx message =
  let ui = Unsafe.get ctx "ui" in
  if Option.is_some (function_field ui "notify") then
    ignore (call2 ui "notify" (js_string message) (js_string "info"))

let apply_plan_transition ctx ~(previous : Taumel.Plan.store)
    (plan : Taumel.Plan.t) =
  let completed_now =
    match previous with
    | Some prev ->
        prev.status <> Taumel.Plan.Complete && plan.status = Taumel.Plan.Complete
    | None -> plan.status = Taumel.Plan.Complete
  in
  if completed_now then (
    (* ^plan-ac02 / ^plan-hwit: account the in-flight turn while still active. *)
    current_plan := Some plan;
    pending_plan_terminal_status := Some Taumel.Plan.Pending_complete;
    Session_sync.account_plan_turn_end ctx;
    pending_plan_terminal_status := None;
    (* ^plan-yve7: house-ack style transient on invariant fire. *)
    notify_info ctx "Plan complete.")
  else (
    current_plan := Some plan;
    Session_sync.save_plan_state ctx)

let js_task (task : Taumel.Plan.task) =
  Unsafe.obj
    [|
      ("taskId", js_string task.task_id);
      ("title", js_string task.title);
      ("description", js_optional_string task.description);
      ("status", js_string (Taumel.Plan.task_status_to_string task.status));
      ("depends_on", js_array (List.map js_string task.depends_on));
      ("origin", js_string (Taumel.Plan.task_origin_to_string task.origin));
    |]

let js_plan (plan : Taumel.Plan.t) =
  Unsafe.obj
    [|
      ("planId", js_string plan.plan_id);
      ("sessionId", js_string plan.session_id);
      ("status", js_string (Taumel.Plan.status_to_string plan.status));
      ("statusLabel", js_string (Taumel.Plan.status_label plan.status));
      ("tasks", js_array (List.map js_task plan.tasks));
      ( "completedTasks",
        js_number (float_of_int (Taumel.Plan.completed_task_count plan.tasks))
      );
      ("totalTasks", js_number (float_of_int (List.length plan.tasks)));
      ("tokensUsed", js_number (float_of_int plan.tokens_used));
      ("timeUsedSeconds", js_number (float_of_int plan.time_used_seconds));
      ("timeUsage", js_string (Taumel.Plan.time_usage plan));
      ("timeLimitSeconds", js_optional_int plan.time_limit_seconds);
      ("extensionUnlocked", js_bool plan.extension_unlocked);
      ("createdAt", js_number (float_of_int plan.created_at));
      ("updatedAt", js_number (float_of_int plan.updated_at));
    |]

let js_automation automation =
  Unsafe.obj
    [|
      ("continuation", js_string (Taumel.Plan.automation_to_string automation));
      ( "requiresUserInput",
        js_bool (Taumel.Plan.automation_requires_user_input automation) );
    |]

let details ?created_task_ids plan automation =
  let plan_value =
    match plan with
    | None -> Unsafe.inject Js.null
    | Some plan -> inject (js_plan plan)
  in
  let fields =
    [|
      ("plan", plan_value); ("automation", inject (js_automation automation));
    |]
  in
  match created_task_ids with
  | None | Some [] -> Unsafe.obj fields
  | Some ids ->
      Unsafe.obj
        (Array.append fields
           [| ("createdTaskIds", js_array (List.map js_string ids)) |])

let model_state_text plan automation =
  let ( status,
        tokens_used,
        time_used_seconds,
        time_limit_seconds,
        extension_unlocked,
        tasks ) =
    match plan with
    | None ->
        ( Taumel.Shared.Null,
          0,
          0,
          Taumel.Shared.Null,
          false,
          Taumel.Shared.Array [] )
    | Some (plan : Taumel.Plan.t) ->
        let tasks =
          match Taumel.Plan.to_json plan with
          | Taumel.Shared.Object fields ->
              Option.value ~default:(Taumel.Shared.Array [])
                (List.assoc_opt "tasks" fields)
          | _ -> Taumel.Shared.Array []
        in
        ( Taumel.Shared.String (Taumel.Plan.status_to_string plan.status),
          plan.tokens_used,
          plan.time_used_seconds,
          (match plan.time_limit_seconds with
          | None -> Taumel.Shared.Null
          | Some value -> Taumel.Shared.Number (float_of_int value)),
          plan.extension_unlocked,
          tasks )
  in
  Taumel.Shared.encode_json
    (Taumel.Shared.Object
       [
         ("plan", Taumel.Plan.codec.encode plan);
         ("status", status);
         ("tokensUsed", Taumel.Shared.Number (float_of_int tokens_used));
         ( "timeUsedSeconds",
           Taumel.Shared.Number (float_of_int time_used_seconds) );
         ("timeLimitSeconds", time_limit_seconds);
         ("extensionUnlocked", Taumel.Shared.Bool extension_unlocked);
         ("tasks", tasks);
         ( "automation",
           Taumel.Shared.Object
             [
               ( "continuation",
                 Taumel.Shared.String
                   (Taumel.Plan.automation_to_string automation) );
               ( "requiresUserInput",
                 Taumel.Shared.Bool
                   (Taumel.Plan.automation_requires_user_input automation) );
             ] );
       ])

let tool_result ?created_task_ids plan text =
  Boundary_contracts.BridgeToolResult.create ~text
    ~details:
      (Ts2ocaml.unknown_of_js
         (ojs_of_js (details ?created_task_ids plan !plan_automation)))
    ()
  |> Tool_contracts.BridgeToolResult.t_to_js |> inject

let command_result ?(followup = false) ?(inspection = false)
    ?submit_user_message ?rollback plan message =
  let details =
    Ts2ocaml.unknown_of_js (ojs_of_js (details plan !plan_automation))
  in
  let planFollowup = if followup then Some true else None in
  let planInspection = if inspection then Some true else None in
  let planRollback =
    Option.map (fun value -> Ts2ocaml.unknown_of_js (ojs_of_js value)) rollback
  in
  Boundary_contracts.GatewayCommandResult.create ~ok:true ~message ~details
    ?planFollowup ?planSubmitUserMessage:submit_user_message ?planRollback
    ?planInspection ()
  |> Tool_contracts.GatewayCommandResult.t_to_js |> inject

let session_id ctx = Session_store.session_id_from_ctx ctx

let continuation_facts facts =
  {
    Taumel.Plan.plan = !current_plan;
    automation = !plan_automation;
    host_idle = Tool_contracts.PlanContinuationFacts.get_hostIdle facts;
    has_pending_messages =
      Tool_contracts.PlanContinuationFacts.get_hasPendingMessages facts;
    retrying = Tool_contracts.PlanContinuationFacts.get_retrying facts;
    compacting = Tool_contracts.PlanContinuationFacts.get_compacting facts;
    latest_assistant_stop_reason =
      Tool_contracts.PlanContinuationFacts.get_latestAssistantStopReason facts;
  }

let plan_continuation raw_facts =
  let facts =
    decode_ojs_contract Tool_contracts.PlanContinuationFacts.t_of_js
      (ojs_of_js raw_facts)
  in
  let ctx =
    Tool_contracts.PlanContinuationFacts.get_ctx facts
    |> Option.map (fun value -> Ts2ocaml.unknown_to_js value |> js_of_ojs)
    |> Option.value ~default:(Unsafe.obj [||])
  in
  let none () =
    Boundary_contracts.PlanContinuationNone.create ()
    |> Tool_contracts.PlanContinuationNone.t_to_js |> inject
  in
  match
    Session_sync.try_sync_session_from_host ~scope:"plan continuation" ctx
  with
  | Error _ -> none ()
  | Ok () -> (
      match
        Taumel.Plan.plan_continuation
          ~initial:(Tool_contracts.PlanContinuationFacts.get_initial facts)
          (continuation_facts facts)
      with
      | Taumel.Plan.No_continuation -> none ()
      | Taumel.Plan.Send_continuation continuation ->
          Boundary_contracts.PlanContinuationSend.create
            ~customType:continuation.custom_type ~content:continuation.content
            ~display:continuation.display ~triggerTurn:continuation.trigger_turn
            ~deliverAs:continuation.deliver_as
            ~details:
              (decode_ojs_contract
                 Tool_contracts.PlanPresentationDetails.t_of_js
                 (ojs_of_js (details !current_plan !plan_automation)))
            ()
          |> Tool_contracts.PlanContinuationSend.t_to_js |> inject)

let plan_store_of_js value =
  match json_from_js value with
  | Ok json -> (
      match Taumel.Plan.codec.decode json with
      | Ok store -> store
      | Error _ -> None)
  | Error _ -> None

let automation_of_js value =
  match json_from_js value with
  | Ok json -> (
      match Taumel.Plan.automation_codec.decode json with
      | Ok automation -> automation
      | Error _ -> Taumel.Plan.Automation_enabled)
  | Error _ -> Taumel.Plan.Automation_enabled

let plan_child_plan_continuation facts =
  let plan = plan_store_of_js (Unsafe.get facts "plan") in
  let automation = automation_of_js (Unsafe.get facts "automation") in
  let iterations = int_field_default facts "iterations" 0 in
  let max_iterations =
    match int_field facts "maxIterations" with
    | Some value when value > 0 -> value
    | _ -> Taumel.Plan.child_continuation_default_max
  in
  let latest_assistant_stop_reason =
    Option.bind
      (optional_string_field facts "latestAssistantStopReason")
      Taumel.Shared.trim_non_empty
  in
  match
    Taumel.Plan.plan_child_continuation ~plan ~automation ~iterations
      ~max_iterations ~latest_assistant_stop_reason
  with
  | Taumel.Plan.Child_continue continuation ->
      Boundary_contracts.ChildPlanContinuationSend.create
        ~customType:continuation.custom_type ~content:continuation.content
        ~display:continuation.display ~triggerTurn:continuation.trigger_turn
        ~deliverAs:continuation.deliver_as ()
      |> Tool_contracts.ChildPlanContinuationSend.t_to_js |> inject
  | Taumel.Plan.Child_finalize { child_status; child_reason } ->
      Boundary_contracts.ChildPlanContinuationFinalize.create
        ~status:child_status ?reason:child_reason ()
      |> Tool_contracts.ChildPlanContinuationFinalize.t_to_js |> inject

let prepare_get () =
  with_gateway_authorized "get_plan" (fun _ ->
      tool_result !current_plan
        (model_state_text !current_plan !plan_automation))

let task_creation (item : Tool_contracts.CreateTaskItem.t) :
    Taumel.Plan.task_creation =
  {
    id = Tool_contracts.CreateTaskItem.get_id item;
    title = Tool_contracts.CreateTaskItem.get_title item;
    description = Tool_contracts.CreateTaskItem.get_description item;
    depends_on =
      Option.value ~default:[]
        (Tool_contracts.CreateTaskItem.get_depends_on item);
  }

let prepare_create_task params ctx =
  with_gateway_authorized "create_task" (fun _ ->
      let params =
        decode_ojs_contract Tool_contracts.CreateTaskParams.t_of_js
          (ojs_of_js params)
      in
      let tasks =
        List.map task_creation
          (Tool_contracts.CreateTaskParams.get_tasks params)
      in
      let previous_count =
        match !current_plan with
        | None -> 0
        | Some plan -> List.length plan.tasks
      in
      match
        Taumel.Plan.create_tasks ~session_id:(session_id ctx)
          ~now:(now_seconds ()) tasks !current_plan
      with
      | Error message -> error_obj message
      | Ok plan ->
          current_plan := Some plan;
          pending_plan_terminal_status := None;
          Session_sync.save_plan_state ctx;
          let created_task_ids =
            List.map
              (fun (task : Taumel.Plan.task) -> task.task_id)
              (List.drop previous_count plan.tasks)
          in
          tool_result ~created_task_ids (Some plan)
            (model_state_text (Some plan) !plan_automation))

let task_status = function
  | `V_pending -> Taumel.Plan.Pending
  | `V_in_progress -> Taumel.Plan.In_progress
  | `V_completed -> Taumel.Plan.Completed
  | `V_cancelled -> Taumel.Plan.Cancelled

let prepare_update_task params ctx =
  with_gateway_authorized "update_task" (fun _ ->
      let params =
        decode_ojs_contract Tool_contracts.UpdateTaskParams.t_of_js
          (ojs_of_js params)
      in
      let update : Taumel.Plan.task_update =
        {
          title = Tool_contracts.UpdateTaskParams.get_title params;
          description =
            (match Tool_contracts.UpdateTaskParams.get_description params with
            | None -> Taumel.Plan.Keep_description
            | Some value -> Taumel.Plan.Set_description value);
          status =
            Option.map task_status
              (Boundary_contracts.UpdateTaskParams.get_status params);
          depends_on = Tool_contracts.UpdateTaskParams.get_depends_on params;
        }
      in
      let previous = !current_plan in
      match
        Taumel.Plan.update_task ~now:(now_seconds ())
          ~task_id:(Tool_contracts.UpdateTaskParams.get_taskId params)
          update !current_plan
      with
      | Error message -> error_obj message
      | Ok plan ->
          apply_plan_transition ctx ~previous plan;
          tool_result !current_plan
            (model_state_text !current_plan !plan_automation))

let prepare_update_plan params ctx =
  with_gateway_authorized "update_plan" (fun _ ->
      let params =
        decode_ojs_contract Tool_contracts.UpdatePlanParams.t_of_js
          (ojs_of_js params)
      in
      let status =
        match Boundary_contracts.UpdatePlanParams.get_status params with
        | `V_active -> Taumel.Plan.Active
        | `V_blocked -> Taumel.Plan.Blocked
      in
      let previous = !current_plan in
      match
        Taumel.Plan.update_plan ~now:(now_seconds ()) status !current_plan
      with
      | Error message -> error_obj message
      | Ok plan ->
          (match status with
          | Taumel.Plan.Blocked ->
              current_plan := Some plan;
              pending_plan_terminal_status := Some Taumel.Plan.Pending_blocked;
              Session_sync.account_plan_turn_end ctx;
              pending_plan_terminal_status := None
          | _ -> apply_plan_transition ctx ~previous plan);
          tool_result !current_plan
            (model_state_text !current_plan !plan_automation))

let create_from_cron raw_facts =
  let facts =
    decode_ojs_contract Tool_contracts.CronPlanCreationFacts.t_of_js
      (ojs_of_js raw_facts)
  in
  let title = Tool_contracts.CronPlanCreationFacts.get_title facts in
  let ctx =
    Tool_contracts.CronPlanCreationFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  let store =
    match !current_plan with
    | Some plan when plan.status = Taumel.Plan.Complete -> None
    | store -> store
  in
  (match
     Taumel.Plan.add_user_task ~session_id:(session_id ctx)
       ~now:(now_seconds ()) title store
   with
    | Error _ -> Tool_contracts.CronPlanCreationResult.create ~created:false ()
    | Ok plan ->
        current_plan := Some plan;
        plan_automation := Taumel.Plan.Automation_enabled;
        Session_sync.save_plan_state ctx;
        Session_sync.save_plan_automation_state ctx;
        Tool_contracts.CronPlanCreationResult.create ~created:true ())
  |> Tool_contracts.CronPlanCreationResult.t_to_js |> inject

let finalize_error _status ctx =
  let next =
    Taumel.Plan.final_unrecoverable_error ~now:(now_seconds ()) !current_plan
  in
  if next <> !current_plan then (
    current_plan := next;
    Session_sync.save_plan_state ctx)

let handle_command args ctx =
  let previous_plan = !current_plan in
  let previous_automation = !plan_automation in
  match
    Taumel.Plan.apply_command ~automation:!plan_automation
      ~session_id:(session_id ctx) ~now:(now_seconds ()) args !current_plan
  with
  | Error message -> error_obj message
  | Ok result ->
      if result.changed then (
        pending_plan_terminal_status := None;
        current_plan := result.plan;
        Option.iter
          (fun automation -> plan_automation := automation)
          result.automation;
        Session_sync.save_plan_state ctx;
        if Option.is_some result.automation then
          Session_sync.save_plan_automation_state ctx);
      let rollback =
        match result.submit_user_message with
        | None -> None
        | Some _ ->
            let plan =
              match previous_plan with
              | None -> Unsafe.inject Js.null
              | Some value -> inject (js_plan value)
            in
            Some
              (Unsafe.obj
                 [|
                   ("plan", plan);
                   ("automation", inject (js_automation previous_automation));
                 |])
      in
      command_result ~followup:result.followup
        ~inspection:(String.trim args = "")
        ?submit_user_message:result.submit_user_message ?rollback result.plan
        result.message

let rollback_plan_command raw_facts =
  let facts =
    decode_ojs_contract Tool_contracts.PlanRollbackFacts.t_of_js
      (ojs_of_js raw_facts)
  in
  let snapshot =
    Tool_contracts.PlanRollbackFacts.get_snapshot facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  let ctx =
    Tool_contracts.PlanRollbackFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  current_plan := plan_store_of_js (Unsafe.get snapshot "plan");
  plan_automation := automation_of_js (Unsafe.get snapshot "automation");
  pending_plan_terminal_status := None;
  Session_sync.save_plan_state ctx;
  Session_sync.save_plan_automation_state ctx;
  Boundary_contracts.PlanRollbackResult.create ()
  |> Tool_contracts.PlanRollbackResult.t_to_js |> inject
