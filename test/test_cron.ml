module Cron = Taumel.Cron
module Cron_expr = Taumel.Cron_expr
module Shared = Taumel.Shared

let expect_ok label = function
  | Ok value -> value
  | Error message -> failwith (label ^ ": " ^ message)

let assert_bool label value = if not value then failwith label

let assert_equal_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let assert_error label = function
  | Ok _ -> failwith (label ^ ": expected error")
  | Error _ -> ()

let persisted ?(version = 1.) ?(id = "aaaaaaaa") ?(cron = "* * * * *")
    ?(prompt = "check") ?(created_at = 0.) ?(next_due = 60.)
    ?pending_since tasks_tail =
  let task =
    let fields =
      [
        ("id", Shared.String id);
        ("cron", Shared.String cron);
        ("prompt", Shared.String prompt);
        ("recurring", Shared.Bool true);
        ("mode", Shared.String "message");
        ("enabled", Shared.Bool true);
        ("createdAt", Shared.Number created_at);
        ("nextDue", Shared.Number next_due);
      ]
    in
    Shared.Object
      (fields
      @
      match pending_since with
      | None -> []
      | Some value -> [ ("pendingSince", value) ])
  in
  Shared.Object
    [
      ("version", Shared.Number version);
      ("enabled", Shared.Bool true);
      ("tasks", Shared.Array (task :: tasks_tail));
    ]

let test_cron_60bw_persisted_codec_reconstructs_task_invariants () =
  assert_error "unsupported cron version" (Cron.decode (persisted ~version:2. []));
  assert_error "invalid cron expression" (Cron.decode (persisted ~cron:"bad" []));
  assert_error "invalid cron task id" (Cron.decode (persisted ~id:"x" []));
  assert_error "blank cron prompt" (Cron.decode (persisted ~prompt:"  " []));
  assert_error "negative cron timestamp"
    (Cron.decode (persisted ~created_at:(-1.) []));
  assert_error "fractional cron timestamp"
    (Cron.decode (persisted ~next_due:60.5 []));
  assert_error "off-schedule cron due time"
    (Cron.decode (persisted ~next_due:61. []));
  assert_error "null pending timestamp"
    (Cron.decode (persisted ~pending_since:Shared.Null []));
  let without_enabled =
    match persisted [] with
    | Shared.Object fields ->
        Shared.Object (List.remove_assoc "enabled" fields)
    | _ -> failwith "expected persisted cron state"
  in
  assert_error "missing root enabled" (Cron.decode without_enabled);
  let with_unknown_root =
    match persisted [] with
    | Shared.Object fields -> Shared.Object (("unknown", Shared.Bool true) :: fields)
    | _ -> failwith "expected persisted cron state"
  in
  assert_error "unknown cron root field" (Cron.decode with_unknown_root);
  let duplicate =
    match persisted [] with
    | Shared.Object fields -> (
        match List.assoc "tasks" fields with
        | Shared.Array [ task ] -> task
        | _ -> failwith "expected persisted cron task")
    | _ -> failwith "expected persisted cron state"
  in
  assert_error "duplicate cron ids" (Cron.decode (persisted [ duplicate ]))

let local_epoch ~year ~month ~day ~hour ~minute =
  let tm =
    {
      Unix.tm_sec = 0;
      tm_min = minute;
      tm_hour = hour;
      tm_mday = day;
      tm_mon = month - 1;
      tm_year = year - 1900;
      tm_wday = 0;
      tm_yday = 0;
      tm_isdst = false;
    }
  in
  int_of_float (fst (Unix.mktime tm))

let local_parts seconds =
  let tm = Unix.localtime (float_of_int seconds) in
  (tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_wday)

let task ?(mode = Cron.Message) ?(recurring = true) ?(enabled = true) ?(pending_since = Some 60)
    ?(next_due = 60) id =
  {
    Cron.id;
    cron = "* * * * *";
    prompt = "check";
    recurring;
    mode;
    enabled;
    created_at = 0;
    next_due;
    pending_since;
  }

let test_deliverable_precedence () =
  let message_task = task "deadbeef" in
  let active_goal =
    { Cron.host_idle = true; goal_driving = true; goal_slot_free = false }
  in
  let paused_goal =
    { Cron.host_idle = true; goal_driving = false; goal_slot_free = false }
  in
  assert_bool "active goal automation holds message cron"
    (not (Cron.deliverable active_goal message_task));
  assert_bool "paused/non-driving goal permits message cron"
    (Cron.deliverable paused_goal message_task);
  assert_bool "goal mode still needs free slot"
    (not (Cron.deliverable paused_goal { message_task with mode = Cron.Goal }));
  assert_bool "busy host holds cron"
    (not (Cron.deliverable { paused_goal with host_idle = false } message_task))

let test_disabled_state_holds_pending_fire () =
  let pending = task "dddddddd" ~pending_since:(Some 60) in
  let facts = { Cron.host_idle = true; goal_driving = false; goal_slot_free = true } in
  let disabled = { Cron.enabled = false; tasks = [ pending ] } in
  assert_bool "disabled cron does not deliver pending fire"
    (Cron.pending_delivery ~now:240 facts disabled = None);
  let enabled = { disabled with enabled = true } in
  match Cron.pending_delivery ~now:240 facts enabled with
  | Some delivery -> assert_equal_int "coalescing preserved while disabled" 4 delivery.coalesced
  | None -> failwith "re-enabled cron should deliver held fire"

let test_disabled_task_holds_pending_fire () =
  let disabled_task = task "eeeeeeee" ~enabled:false ~pending_since:None in
  let state = { Cron.enabled = true; tasks = [ disabled_task ] } in
  let ticked = Cron.tick ~now:240 state in
  (match ticked.tasks with
  | [ task ] -> assert_bool "disabled task does not become pending" (task.pending_since = None)
  | _ -> failwith "expected one disabled task");
  let reenabled = Cron.set_task_enabled "eeeeeeee" true ticked in
  let ticked = Cron.tick ~now:240 reenabled in
  let facts = { Cron.host_idle = true; goal_driving = false; goal_slot_free = true } in
  match Cron.pending_delivery ~now:240 facts ticked with
  | Some delivery -> assert_equal_int "disabled task coalesces after re-enable" 4 delivery.coalesced
  | None -> failwith "re-enabled task should deliver held fire"

let test_coalescing_and_completion () =
  assert_equal_int "coalesced every minute" 4
    (Cron.count_occurrences "* * * * *" ~from_time:60 ~until_time:240);
  let recurring = task "aaaaaaaa" ~recurring:true ~pending_since:(Some 60) in
  let delivery = { Cron.task = recurring; coalesced = 4; content = recurring.prompt } in
  let state = Cron.complete_delivery ~now:240 delivery { Cron.enabled = true; tasks = [ recurring ] } in
  (match state.tasks with
  | [ updated ] ->
      assert_bool "pending cleared" (updated.pending_since = None);
      assert_equal_int "next due rearmed" 300 updated.next_due
  | _ -> failwith "recurring completion should keep one task");
  let one_shot = task "bbbbbbbb" ~recurring:false in
  let delivery = { Cron.task = one_shot; coalesced = 1; content = one_shot.prompt } in
  let state = Cron.complete_delivery ~now:60 delivery { Cron.enabled = true; tasks = [ one_shot ] } in
  assert_bool "one-shot deleted" (state.tasks = [])

let test_task_updates () =
  let pending = task "ffffffff" ~pending_since:(Some 60) ~next_due:60 in
  let state = { Cron.enabled = true; tasks = [ pending ] } in

  let prompt_updated =
    expect_ok "update prompt" (Cron.update_task_prompt "ffffffff" "new prompt" state)
  in
  (match prompt_updated.tasks with
  | [ updated ] ->
      assert_bool "prompt updated" (updated.prompt = "new prompt");
      assert_equal_int "prompt edit preserves next due" 60 updated.next_due;
      assert_bool "prompt edit preserves pending" (updated.pending_since = Some 60)
  | _ -> failwith "expected one prompt-updated task");

  let schedule_updated =
    expect_ok "update schedule"
      (Cron.update_task_cron ~now:60 "ffffffff" "*/5 * * * *" state)
  in
  (match schedule_updated.tasks with
  | [ updated ] ->
      assert_bool "schedule updated" (updated.cron = "*/5 * * * *");
      assert_equal_int "schedule edit recomputes next due" 300 updated.next_due;
      assert_bool "schedule edit clears pending" (updated.pending_since = None)
  | _ -> failwith "expected one schedule-updated task");

  (match Cron.update_task_cron ~now:60 "ffffffff" "bad" state with
  | Ok _ -> failwith "invalid schedule should fail"
  | Error _ -> ());

  let mode_updated =
    expect_ok "update mode" (Cron.update_task_mode "ffffffff" Cron.Goal state)
  in
  (match mode_updated.tasks with
  | [ updated ] ->
      assert_bool "mode updated" (updated.mode = Cron.Goal);
      assert_bool "mode edit preserves pending" (updated.pending_since = Some 60)
  | _ -> failwith "expected one mode-updated task");

  let recurring_updated =
    expect_ok "update recurring" (Cron.update_task_recurring "ffffffff" false state)
  in
  match recurring_updated.tasks with
  | [ updated ] ->
      assert_bool "recurring updated" (not updated.recurring);
      assert_bool "recurring edit preserves pending" (updated.pending_since = Some 60)
  | _ -> failwith "expected one recurring-updated task"

let test_startup_reason_matrix () =
  let armed =
    {
      Cron.enabled = true;
      tasks =
        [ task "cccccccc" ~pending_since:None; task "dddddddd" ~enabled:false ~pending_since:None ];
    }
  in
  let resumed = Cron.apply_startup Cron.Resume armed in
  assert_bool "resume disables" (not resumed.state.enabled);
  assert_bool "resume notifies" resumed.notify;
  assert_bool "resume preserves task enabled flags" (List.map (fun (task : Cron.task) -> task.enabled) resumed.state.tasks = [ true; false ]);
  assert_bool "resume notification mentions stored crons" (String.contains resumed.message '2');
  assert_bool "resume notification tells user how to arm" (String.contains resumed.message '/');
  let reloaded = Cron.apply_startup Cron.Reload armed in
  assert_bool "reload preserves enabled" reloaded.state.enabled;
  assert_bool "reload quiet" (not reloaded.notify);
  let new_session = Cron.apply_startup Cron.New armed in
  assert_bool "new session clears tasks" (new_session.state.tasks = [])

let test_cron_expr_step_ranges () =
  let expr = expect_ok "parse step range" (Cron_expr.parse "3-20/5 * * * *") in
  assert_bool "range step starts at range lower bound"
    (Cron_expr.matches expr ~minute:3 ~hour:0 ~day:1 ~month:1 ~weekday:0);
  assert_bool "range step includes lower-bound plus step"
    (Cron_expr.matches expr ~minute:8 ~hour:0 ~day:1 ~month:1 ~weekday:0);
  assert_bool "range step excludes field-min aligned value"
    (not (Cron_expr.matches expr ~minute:5 ~hour:0 ~day:1 ~month:1 ~weekday:0))

let test_cron_expr_local_time_and_dom_dow_or () =
  let expr = expect_ok "parse local" (Cron_expr.parse "0 9 * * *") in
  let after = local_epoch ~year:2021 ~month:1 ~day:3 ~hour:8 ~minute:59 in
  let due = Option.get (Cron_expr.next_due_after expr ~after) in
  let _, _, hour, minute, _ = local_parts due in
  assert_equal_int "fires at local hour" 9 hour;
  assert_equal_int "fires at local minute" 0 minute;

  let expr = expect_ok "parse dom/dow" (Cron_expr.parse "0 9 1 * 1") in
  let after = local_epoch ~year:2021 ~month:1 ~day:3 ~hour:9 ~minute:0 in
  let due = Option.get (Cron_expr.next_due_after expr ~after) in
  let _, mday, hour, minute, wday = local_parts due in
  assert_equal_int "DOM/DOW OR picks Monday Jan 4" 4 mday;
  assert_equal_int "Monday" 1 wday;
  assert_equal_int "Monday hour" 9 hour;
  assert_equal_int "Monday minute" 0 minute

let () =
  test_cron_60bw_persisted_codec_reconstructs_task_invariants ();
  test_deliverable_precedence ();
  test_disabled_state_holds_pending_fire ();
  test_disabled_task_holds_pending_fire ();
  test_coalescing_and_completion ();
  test_task_updates ();
  test_startup_reason_matrix ();
  test_cron_expr_step_ranges ();
  test_cron_expr_local_time_and_dom_dow_or ()
