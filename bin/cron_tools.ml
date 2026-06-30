open Jsoo_bridge
open App_state

let cron_state : Taumel.Cron.state ref = ref Taumel.Cron.empty
let cron_loaded_session_id : string option ref = ref None
let cron_entry_type = "taumel.cron"

let save_state ctx =
  Session_store.append_custom_entry ctx cron_entry_type (Taumel.Cron.encode !cron_state)

let load_state ctx =
  match Session_store.custom_entry_data ctx cron_entry_type with
  | None -> cron_state := Taumel.Cron.empty
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Cron.decode with
      | Ok state -> cron_state := state
      | Error _ -> cron_state := Taumel.Cron.empty)

let sync ctx =
  Session_sync.sync_session_from_host ~scope:"cron sync" ctx;
  let session_id = Session_store.session_id_from_ctx ctx in
  if !cron_loaded_session_id <> Some session_id then (
    load_state ctx;
    cron_loaded_session_id := Some session_id)

let random_id () =
  let math = Unsafe.get Unsafe.global "Math" in
  let n =
    match function_field math "random" with
    | Some random -> (
        match float_value (Unsafe.fun_call random [||]) with
        | Some value -> int_of_float (value *. 4294967295.)
        | None -> App_state.now_seconds ())
    | None -> App_state.now_seconds ()
  in
  Taumel.Cron.id_from_seed n

let task_summary (task : Taumel.Cron.task) =
  Unsafe.obj
    [|
      ("id", js_string task.id);
      ("schedule", js_string (Taumel.Cron_expr.describe task.cron));
      ("cron", js_string task.cron);
      ("prompt", js_string task.prompt);
      ("recurring", js_bool task.recurring);
      ("mode", js_string (Taumel.Cron.mode_to_string task.mode));
      ("nextDue", js_number (float_of_int task.next_due));
      ("pending", js_bool (Option.is_some task.pending_since));
    |]

let tasks_array tasks = js_array (List.map (fun task -> inject (task_summary task)) tasks)

let tool_result text details =
  Unsafe.obj
    [|
      ("ok", js_bool true);
      ("action", js_string "tool_result");
      ("text", js_string text);
      ("details", details);
    |]

let prepare_create params ctx =
  sync ctx;
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
             ("nextDue", js_number (float_of_int task.next_due));
           |])

let prepare_list _params ctx =
  sync ctx;
  tool_result "Cron tasks listed." (Unsafe.obj [| ("tasks", tasks_array !cron_state.tasks) |])

let prepare_delete params ctx =
  sync ctx;
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
  Unsafe.obj
    [|
      ("ok", js_bool ok);
      ("action", js_string "command_result");
      ("message", js_string message);
      ("details", details);
    |]

let handle_command args ctx =
  sync ctx;
  match String.trim args with
  | command when String.length command > 7 && String.sub command 0 7 = "cancel " ->
      let id = String.trim (String.sub command 7 (String.length command - 7)) in
      let before = List.length !cron_state.tasks in
      cron_state := Taumel.Cron.delete id !cron_state;
      save_state ctx;
      command_result
        (if List.length !cron_state.tasks < before then "Cancelled cron task " ^ id ^ "." else "No cron task matched " ^ id ^ ".")
        (Unsafe.obj [| ("id", js_string id) |])
  | "enable" ->
      cron_state := Taumel.Cron.set_enabled true !cron_state;
      save_state ctx;
      command_result "Cron enabled." (Unsafe.obj [| ("enabled", js_bool true) |])
  | "disable" ->
      cron_state := Taumel.Cron.set_enabled false !cron_state;
      save_state ctx;
      command_result "Cron disabled." (Unsafe.obj [| ("enabled", js_bool false) |])
  | "" ->
      let lines =
        if !cron_state.tasks = [] then [ "No cron tasks." ]
        else
          (Printf.sprintf "Cron is %s." (if !cron_state.enabled then "enabled" else "disabled"))
          :: List.map
               (fun (task : Taumel.Cron.task) ->
                 Printf.sprintf "%s  %s  %s  next=%d" task.id task.cron
                   (Taumel.Cron.mode_to_string task.mode) task.next_due)
               !cron_state.tasks
      in
      command_result (String.concat "\n" lines) (Unsafe.obj [| ("tasks", tasks_array !cron_state.tasks) |])
  | _ -> command_result ~ok:false "Usage: /cron [enable|disable]" (Unsafe.obj [||])

let facts_from_js facts =
  {
    Taumel.Cron.host_idle = get_bool facts "hostIdle";
    goal_driving = get_bool facts "goalDriving";
    goal_slot_free = get_bool facts "goalSlotFree";
  }

let poll params ctx =
  sync ctx;
  let now = int_of_float (float_field_default params "now" (float_of_int (App_state.now_seconds ())) /. 1000.) in
  cron_state := Taumel.Cron.tick ~now !cron_state;
  save_state ctx;
  match Taumel.Cron.pending_delivery ~now (facts_from_js params) !cron_state with
  | None -> Unsafe.obj [| ("action", js_string "none") |]
  | Some delivery ->
      Unsafe.obj
        [|
          ("action", js_string "deliver");
          ("id", js_string delivery.task.id);
          ("mode", js_string (Taumel.Cron.mode_to_string delivery.task.mode));
          ("content", js_string delivery.content);
          ("coalesced", js_number (float_of_int delivery.coalesced));
        |]

let delivered params ctx =
  sync ctx;
  let id = get_string params "id" in
  let now = int_of_float (float_field_default params "now" (float_of_int (App_state.now_seconds ())) /. 1000.) in
  match List.find_opt (fun (task : Taumel.Cron.task) -> task.id = id) !cron_state.tasks with
  | None -> Unsafe.obj [| ("ok", js_bool false) |]
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
      Unsafe.obj [| ("ok", js_bool true) |]

let goal_facts ctx =
  Session_sync.sync_session_from_host ~scope:"cron goal facts" ctx;
  let goal_slot_free =
    match !App_state.current_goal with
    | None -> true
    | Some goal -> (match goal.Taumel.Goal.status with Taumel.Goal.Complete -> true | _ -> false)
  in
  Unsafe.obj [| ("goalSlotFree", js_bool goal_slot_free) |]

let startup event ctx =
  sync ctx;
  let reason = get_string event "reason" in
  let has_tasks = !cron_state.tasks <> [] in
  if has_tasks && List.mem reason [ "resume"; "startup"; "fork" ] then (
    cron_state := Taumel.Cron.set_enabled false !cron_state;
    save_state ctx;
    Unsafe.obj
      [|
        ("notify", js_bool true);
        ("message", js_string "Stored cron tasks are disabled on resume; run /cron enable to arm them.");
      |])
  else Unsafe.obj [| ("notify", js_bool false) |]
