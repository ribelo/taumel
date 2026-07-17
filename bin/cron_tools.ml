open Jsoo_bridge
open App_state

let cron_state : Taumel.Cron.state ref = ref Taumel.Cron.empty
let cron_loaded_session_id : string option ref = ref None
let cron_entry_type = "taumel.cron"

let save_state ctx =
  Session_store.append_custom_entry ctx cron_entry_type (Taumel.Cron.encode !cron_state)

let save_state_if_changed ctx previous =
  if previous <> !cron_state then save_state ctx

let load_state ctx =
  match Session_store.custom_entry_data ctx cron_entry_type with
  | None -> cron_state := Taumel.Cron.empty
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Cron.decode with
      | Ok state -> cron_state := state
      | Error _ -> cron_state := Taumel.Cron.empty)

let sync ctx =
  match Session_sync.try_sync_session_from_host ~scope:"cron sync" ctx with
  | Error _ -> false
  | Ok () ->
    let session_id = Session_store.session_id_from_ctx ctx in
    if !cron_loaded_session_id <> Some session_id then (
      load_state ctx;
      cron_loaded_session_id := Some session_id);
    true

let random_id () =
  let math = Unsafe.get Unsafe.global "Math" in
  let n =
    match function_field math "random" with
    | Some random -> (
        match float_value (Unsafe.fun_call random [||]) with
        | Some value -> int_of_float (value *. 2147483647.)
        | None -> App_state.now_seconds ())
    | None -> App_state.now_seconds ()
  in
  Taumel.Cron.id_from_seed n

let human_time seconds =
  try
    let date = Unsafe.new_obj (Unsafe.get Unsafe.global "Date") [| js_number (float_of_int seconds *. 1000.) |] in
    Option.value (string_value (Unsafe.meth_call date "toLocaleString" [||])) ~default:(string_of_int seconds)
  with _ -> string_of_int seconds

let task_summary (task : Taumel.Cron.task) =
  Unsafe.obj
    [|
      ("id", js_string task.id);
      ("schedule", js_string (Taumel.Cron_expr.describe task.cron));
      ("cron", js_string task.cron);
      ("prompt", js_string task.prompt);
      ("recurring", js_bool task.recurring);
      ("mode", js_string (Taumel.Cron.mode_to_string task.mode));
      ("enabled", js_bool task.enabled);
      ("nextDue", js_number (float_of_int task.next_due));
      ("nextDueText", js_string (human_time task.next_due));
      ("pending", js_bool (Option.is_some task.pending_since));
    |]

let tasks_array tasks = js_array (List.map (fun task -> inject (task_summary task)) tasks)

let typed_mode = function
  | Taumel.Cron.Message -> `V_message
  | Taumel.Cron.Goal -> `V_goal

let typed_task (task : Taumel.Cron.task) =
  let mode = typed_mode task.mode in
  Tool_contracts.CronTask.create ~id:task.id
    ~schedule:(Taumel.Cron_expr.describe task.cron) ~cron:task.cron ~prompt:task.prompt
    ~recurring:task.recurring
    ~mode:(Boundary_contracts.CronTask.mode_to_contract mode)
    ~enabled:task.enabled ~nextDue:(float_of_int task.next_due)
    ~nextDueText:(human_time task.next_due) ~pending:(Option.is_some task.pending_since) ()

let tool_result text details =
  Boundary_contracts.BridgeToolResult.create ~text
    ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details)) ()
  |> Tool_contracts.BridgeToolResult.t_to_js |> inject

let stale_session_message = "Cron unavailable while session context is stale."

let prepare_create params ctx =
  if not (sync ctx) then error_obj stale_session_message
  else
    let cron = get_string params "cron" in
    let prompt = get_string params "prompt" in
    let recurring = if has_property params "recurring" then get_bool params "recurring" else true in
    let goal = if has_property params "goal" then get_bool params "goal" else false in
    let mode = if goal then Taumel.Cron.Goal else Taumel.Cron.Message in
    let request : Taumel.Cron.create_request = { cron; prompt; recurring; mode } in
    match Taumel.Cron.create ~now:(App_state.now_seconds ()) ~id:(random_id ()) request !cron_state with
    | Error message -> error_obj message
    | Ok (state, task) ->
        cron_state := state;
        save_state ctx;
        tool_result
          (Printf.sprintf
             "Created cron task %s (%s). Tell the user this id and that they can manage crons with /cron."
             task.id (Taumel.Cron.mode_to_string task.mode))
          (Unsafe.obj
             [|
               ("task", inject (task_summary task));
               ("id", js_string task.id);
               ("schedule", js_string task.cron);
	               ("recurring", js_bool task.recurring);
	               ("mode", js_string (Taumel.Cron.mode_to_string task.mode));
	               ("enabled", js_bool task.enabled);
	               ("nextDue", js_number (float_of_int task.next_due));
	               ("nextDueText", js_string (human_time task.next_due));
	             |])

let prepare_list _params ctx =
  if not (sync ctx) then error_obj stale_session_message
  else
    let message =
      if (not !cron_state.enabled) && !cron_state.tasks <> [] then
        "Cron tasks listed. Cron is disabled; run /cron enable to arm stored tasks."
      else "Cron tasks listed."
    in
    let details =
      Tool_contracts.CronListDetails.create ~enabled:!cron_state.enabled
        ~tasks:(List.map typed_task !cron_state.tasks) ()
    in
    Boundary_contracts.CronListResult.create ~text:message
      ~details ()
    |> Tool_contracts.CronListResult.t_to_js |> inject

let prepare_delete params ctx =
  if not (sync ctx) then error_obj stale_session_message
  else
    let id = get_string params "id" in
    let before = List.length !cron_state.tasks in
    cron_state := Taumel.Cron.delete id !cron_state;
    save_state ctx;
    let deleted = List.length !cron_state.tasks < before in
    tool_result
      (if deleted then "Deleted cron task " ^ id ^ "." else "No cron task matched " ^ id ^ ".")
      (Unsafe.obj [| ("id", js_string id); ("deleted", js_bool deleted) |])

let prepare name params ctx =
  match name with
  | "cron_create" -> prepare_create params ctx
  | "cron_list" -> prepare_list params ctx
  | "cron_delete" -> prepare_delete params ctx
  | _ -> error_obj ("unknown cron tool: " ^ name)

let command_result ?(ok=true) message details =
  Boundary_contracts.CronCommandResult.create ~ok ~message
    ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details)) ()
  |> Tool_contracts.CronCommandResult.t_to_js |> inject

let starts_with ~prefix value =
  String.length value >= String.length prefix
  && String.sub value 0 (String.length prefix) = prefix

let set_task_enabled_command enabled id ctx =
  let id = String.trim id in
  let exists = List.exists (fun (task : Taumel.Cron.task) -> task.id = id) !cron_state.tasks in
  if exists then (
    cron_state := Taumel.Cron.set_task_enabled id enabled !cron_state;
    save_state ctx);
  command_result
    (if exists then
       Printf.sprintf "%s cron task %s."
         (if enabled then "Enabled" else "Disabled") id
     else "No cron task matched " ^ id ^ ".")
    (Unsafe.obj
       [|
         ("id", js_string id);
         ("enabled", js_bool enabled);
         ("changed", js_bool exists);
	       |])

let updated_task_details id =
  let task = List.find_opt (fun (task : Taumel.Cron.task) -> task.id = id) !cron_state.tasks in
  Unsafe.obj
    [|
      ("id", js_string id);
      ("changed", js_bool (Option.is_some task));
      ("task", match task with Some task -> inject (task_summary task) | None -> inject Js.null);
      ("enabled", js_bool !cron_state.enabled);
      ("tasks", tasks_array !cron_state.tasks);
    |]

let update_task_impl params ctx =
  if not (sync ctx) then command_result ~ok:false stale_session_message (Unsafe.obj [||])
  else
    let id = String.trim (get_string params "id") in
    let now = App_state.now_seconds () in
    let apply_if present update result =
      if present then Result.bind result update else result
    in
    let result =
      Ok !cron_state
      |> apply_if (has_property params "prompt")
           (Taumel.Cron.update_task_prompt id (get_string params "prompt"))
      |> apply_if (has_property params "cron")
           (Taumel.Cron.update_task_cron ~now id (get_string params "cron"))
      |> apply_if (has_property params "recurring")
           (Taumel.Cron.update_task_recurring id (get_bool params "recurring"))
      |> apply_if (has_property params "mode") (fun state ->
             match Taumel.Cron.mode_of_string (get_string params "mode") with
             | None -> Error "cron task mode must be message or goal"
             | Some mode -> Taumel.Cron.update_task_mode id mode state)
    in
    match result with
    | Error message -> command_result ~ok:false message (updated_task_details id)
    | Ok state ->
        let previous = !cron_state in
        cron_state := state;
        save_state_if_changed ctx previous;
        command_result ("Updated cron task " ^ id ^ ".") (updated_task_details id)

let update_task raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronTaskUpdateFacts.t_of_js (ojs_of_js raw_facts) in
  let params = Tool_contracts.CronTaskUpdateFacts.get_patch facts
    |> Tool_contracts.CronTaskPatch.t_to_js |> js_of_ojs
  in
  let ctx = Tool_contracts.CronTaskUpdateFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  update_task_impl params ctx |> ojs_of_js |> decode_ojs_contract Tool_contracts.CronCommandResult.t_of_js
  |> Tool_contracts.CronCommandResult.t_to_js |> inject

let handle_command args ctx =
  if not (sync ctx) then command_result ~ok:false stale_session_message (Unsafe.obj [||])
  else match String.trim args with
  | command when String.length command > 7 && String.sub command 0 7 = "cancel " ->
      let id = String.trim (String.sub command 7 (String.length command - 7)) in
      let before = List.length !cron_state.tasks in
      cron_state := Taumel.Cron.delete id !cron_state;
      save_state ctx;
      command_result
        (if List.length !cron_state.tasks < before then "Cancelled cron task " ^ id ^ "." else "No cron task matched " ^ id ^ ".")
        (Unsafe.obj [| ("id", js_string id) |])
  | command when starts_with ~prefix:"enable " command ->
      set_task_enabled_command true (String.sub command 7 (String.length command - 7)) ctx
  | command when starts_with ~prefix:"disable " command ->
      set_task_enabled_command false (String.sub command 8 (String.length command - 8)) ctx
  | "enable" ->
      cron_state := Taumel.Cron.set_enabled true !cron_state;
      save_state ctx;
      command_result "Cron enabled." (Unsafe.obj [| ("enabled", js_bool true) |])
  | "disable" ->
      cron_state := Taumel.Cron.set_enabled false !cron_state;
      save_state ctx;
      command_result "Cron disabled." (Unsafe.obj [| ("enabled", js_bool false) |])
  | "" ->
      if !cron_state.tasks = [] then
        command_result "No cron tasks." (Unsafe.obj [| ("tasks", tasks_array []) |])
      else
        Boundary_contracts.CronPrompt.create ~enabled:!cron_state.enabled
          ~tasks:(List.map typed_task !cron_state.tasks) ()
        |> Tool_contracts.CronPrompt.t_to_js |> inject
  | _ -> command_result ~ok:false "Usage: /cron [enable|disable]" (Unsafe.obj [||])

let handle_manager_command raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronManagerCommandFacts.t_of_js (ojs_of_js raw_facts) in
  let args = Tool_contracts.CronManagerCommandFacts.get_args facts in
  let ctx = Tool_contracts.CronManagerCommandFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  handle_command args ctx |> ojs_of_js |> decode_ojs_contract Tool_contracts.CronCommandResult.t_of_js
  |> Tool_contracts.CronCommandResult.t_to_js |> inject

let task_label (task : Taumel.Cron.task) =
  Printf.sprintf "%s  %s  %s  %s  next=%s" task.id
    (if task.enabled then "enabled" else "disabled") task.cron
    (Taumel.Cron.mode_to_string task.mode) (human_time task.next_due)

let task_listing_message enabled tasks =
  match tasks with
  | [] -> "No cron tasks."
  | _ ->
      String.concat "\n"
        ((Printf.sprintf "Cron is %s." (if enabled then "enabled" else "disabled"))
        :: List.map task_label tasks)

let plan_prompt_impl prompt =
  let tasks = get_object_array prompt "tasks" in
  let result =
    if tasks = [] then
      command_result "No cron tasks."
        (Unsafe.obj [| ("tasks", js_array []) |])
    else
      command_result
        (task_listing_message (get_bool prompt "enabled") !cron_state.tasks)
        (Unsafe.obj
           [|
             ("enabled", js_bool (get_bool prompt "enabled"));
             ("tasks", tasks_array !cron_state.tasks);
           |])
  in
  result |> ojs_of_js |> decode_ojs_contract Tool_contracts.CronCommandResult.t_of_js

let plan_prompt raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronPromptFacts.t_of_js (ojs_of_js raw_facts) in
  let prompt = Tool_contracts.CronPromptFacts.get_prompt facts
    |> Tool_contracts.CronPrompt.t_to_js |> js_of_ojs
  in
  let result = plan_prompt_impl prompt in
  Boundary_contracts.CronPromptPlan.create ~result ()
  |> Tool_contracts.CronPromptPlan.t_to_js |> inject

let finish_prompt _prompt selection ctx =
  if not (sync ctx) then command_result ~ok:false stale_session_message (Unsafe.obj [||])
  else match get_string selection "status" with
  | "cancelled" -> command_result "Cron selection cancelled." (Unsafe.obj [||])
  | "selected" ->
      let selected = get_string selection "selected" in
      if selected = "Enable cron" then (
        cron_state := Taumel.Cron.set_enabled true !cron_state;
        save_state ctx;
        command_result "Cron enabled." (Unsafe.obj [| ("enabled", js_bool true) |]))
      else if selected = "Disable cron" then (
        cron_state := Taumel.Cron.set_enabled false !cron_state;
        save_state ctx;
        command_result "Cron disabled." (Unsafe.obj [| ("enabled", js_bool false) |]))
      else
        let parts = String.split_on_char ' ' selected |> List.filter (( <> ) "") in
        (match parts with
        | action :: "task" :: id :: _ when action = "Enable" -> set_task_enabled_command true id ctx
        | action :: "task" :: id :: _ when action = "Disable" -> set_task_enabled_command false id ctx
        | action :: "task" :: id :: _ when action = "Cancel" ->
            let before = List.length !cron_state.tasks in
            cron_state := Taumel.Cron.delete id !cron_state;
            save_state ctx;
            command_result
              (if List.length !cron_state.tasks < before then
                 "Cancelled cron task " ^ id ^ "."
	               else "No cron task matched " ^ id ^ ".")
	              (Unsafe.obj [| ("id", js_string id) |])
        | _ -> command_result ~ok:false "Cron selection failed." (Unsafe.obj [||]))
  | _ -> command_result ~ok:false "Cron selection failed." (Unsafe.obj [||])

let facts_from_js facts =
  {
    Taumel.Cron.host_idle = Tool_contracts.CronPollFacts.get_hostIdle facts;
    goal_driving = Tool_contracts.CronPollFacts.get_goalDriving facts;
    goal_slot_free = Tool_contracts.CronPollFacts.get_goalSlotFree facts;
  }

let poll raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronPollFacts.t_of_js (ojs_of_js raw_facts) in
  let ctx = Tool_contracts.CronPollFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  let none () =
    Boundary_contracts.CronPollNone.create ()
    |> Tool_contracts.CronPollNone.t_to_js |> inject
  in
  if not (sync ctx) then none ()
  else
    let now = int_of_float (Tool_contracts.CronPollFacts.get_now facts /. 1000.) in
    let previous = !cron_state in
    cron_state := Taumel.Cron.tick ~now !cron_state;
    save_state_if_changed ctx previous;
    match Taumel.Cron.pending_delivery ~now (facts_from_js facts) !cron_state with
    | None -> none ()
    | Some delivery ->
        Boundary_contracts.CronPollDelivery.create ~id:delivery.task.id
          ~mode:
            (typed_mode delivery.task.mode
            |> Boundary_contracts.CronPollDelivery.mode_to_contract)
          ~content:delivery.content
          ~coalesced:(float_of_int delivery.coalesced) ~cron:delivery.task.cron
          ~schedule:(Taumel.Cron_expr.describe delivery.task.cron) ()
        |> Tool_contracts.CronPollDelivery.t_to_js |> inject

let delivered raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronDeliveredFacts.t_of_js (ojs_of_js raw_facts) in
  let ctx = Tool_contracts.CronDeliveredFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  let result acknowledged =
    Tool_contracts.CronDeliveredResult.create ~acknowledged ()
    |> Tool_contracts.CronDeliveredResult.t_to_js |> inject
  in
  if not (sync ctx) then result false
  else
    let id = Tool_contracts.CronDeliveredFacts.get_id facts in
    let now = int_of_float (Tool_contracts.CronDeliveredFacts.get_now facts /. 1000.) in
    match List.find_opt (fun (task : Taumel.Cron.task) -> task.id = id) !cron_state.tasks with
    | None -> result false
    | Some task ->
        let pending_since = Option.value task.pending_since ~default:task.next_due in
        let delivery : Taumel.Cron.delivery =
          {
            task;
            coalesced = Taumel.Cron.count_occurrences task.cron ~from_time:pending_since ~until_time:now;
            content = task.prompt;
          }
        in
        cron_state := Taumel.Cron.complete_delivery ~now delivery !cron_state;
        save_state ctx;
        result true

let goal_facts raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronContextFacts.t_of_js (ojs_of_js raw_facts) in
  let ctx = Tool_contracts.CronContextFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  let result goalSlotFree goalDriving =
    Tool_contracts.CronGoalFacts.create ~goalSlotFree ~goalDriving ()
    |> Tool_contracts.CronGoalFacts.t_to_js |> inject
  in
  match
    Session_sync.try_sync_session_from_host ~scope:"cron goal facts" ctx
  with
  | Error _ -> result false true
  | Ok () ->
    let goal_slot_free, goal_driving =
      match !App_state.current_goal with
      | None -> (true, false)
      | Some goal ->
          let slot_free = match goal.Taumel.Goal.status with Taumel.Goal.Complete -> true | _ -> false in
          let driving =
            goal.Taumel.Goal.status = Taumel.Goal.Active
            && !App_state.goal_automation = Taumel.Goal.Automation_enabled
          in
          (slot_free, driving)
    in
    result goal_slot_free goal_driving

let startup_reason = function
  | "new" -> Taumel.Cron.New
  | "reload" -> Taumel.Cron.Reload
  | "resume" -> Taumel.Cron.Resume
  | "startup" -> Taumel.Cron.Startup
  | "fork" -> Taumel.Cron.Fork
  | _ -> Taumel.Cron.Other

let startup raw_facts =
  let facts = decode_ojs_contract Tool_contracts.CronStartupFacts.t_of_js (ojs_of_js raw_facts) in
  let ctx = Tool_contracts.CronStartupFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  let none () =
    Boundary_contracts.CronStartupNone.create ()
    |> Tool_contracts.CronStartupNone.t_to_js |> inject
  in
  if not (sync ctx) then none ()
  else
    let plan = Taumel.Cron.apply_startup (startup_reason (Tool_contracts.CronStartupFacts.get_reason facts)) !cron_state in
    let previous = !cron_state in
    cron_state := plan.state;
    save_state_if_changed ctx previous;
    if plan.notify && String.trim plan.message <> "" then
      Boundary_contracts.CronStartupNotify.create ~message:plan.message ()
      |> Tool_contracts.CronStartupNotify.t_to_js |> inject
    else none ()
