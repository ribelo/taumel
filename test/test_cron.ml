module Cron = Taumel.Cron
module Cron_expr = Taumel.Cron_expr

let expect_ok label = function
  | Ok value -> value
  | Error message -> failwith (label ^ ": " ^ message)

let assert_bool label value = if not value then failwith label

let assert_equal_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

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

let task ?(mode = Cron.Message) ?(recurring = true) ?(pending_since = Some 60)
    ?(next_due = 60) id =
  {
    Cron.id;
    cron = "* * * * *";
    prompt = "check";
    recurring;
    mode;
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

let test_startup_reason_matrix () =
  let armed = { Cron.enabled = true; tasks = [ task "cccccccc" ~pending_since:None ] } in
  let resumed = Cron.apply_startup Cron.Resume armed in
  assert_bool "resume disables" (not resumed.state.enabled);
  assert_bool "resume notifies" resumed.notify;
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
  test_deliverable_precedence ();
  test_disabled_state_holds_pending_fire ();
  test_coalescing_and_completion ();
  test_startup_reason_matrix ();
  test_cron_expr_step_ranges ();
  test_cron_expr_local_time_and_dom_dow_or ()
