module Goal = Taumel.Goal
module Shared = Taumel.Shared

let expect_ok label = function
  | Ok value -> value
  | Error message -> failwith (label ^ ": " ^ message)

let expect_error label expected = function
  | Ok _ -> failwith (label ^ ": expected error")
  | Error message ->
      if message <> expected then
        failwith
          (Printf.sprintf "%s: expected %S, got %S" label expected message)

let assert_bool label value = if not value then failwith label

let test_time_limit_accounting () =
  let goal =
    expect_ok "create"
      (Goal.create ~time_limit_seconds:10 ~thread_id:"thread" ~now:1 "ship" None)
  in
  let updated =
    Goal.account_usage ~now:2 ~time_delta_seconds:11
      { input_tokens = 20; cached_input_tokens = 5; output_tokens = 7 }
      goal
  in
  assert_bool "status becomes time_limited"
    (updated.status = Goal.Time_limited);
  assert_bool "active time recorded" (updated.time_used_seconds = 11);
  assert_bool "uncached tokens recorded" (updated.tokens_used = 22)

let test_turn_clock_excludes_pause_time () =
  let clock = Goal.start_turn_clock ~now_ms:0 Goal.empty_clock in
  let clock = Goal.pause_clock_start ~now_ms:1_000 clock in
  let clock = Goal.pause_clock_start ~now_ms:2_000 clock in
  let clock = Goal.pause_clock_end ~now_ms:4_000 clock in
  let clock = Goal.pause_clock_end ~now_ms:6_000 clock in
  let elapsed, clock = Goal.finish_turn_clock ~now_ms:11_000 clock in
  assert_bool "elapsed excludes nested pause" (elapsed = 6);
  assert_bool "clock resets" (clock = Goal.empty_clock)

let facts ?(automation = Goal.Automation_enabled) ?(host_idle = true)
    ?(has_pending_messages = false) ?(retrying = false) ?(compacting = false)
    ?latest_assistant_stop_reason goal =
  {
    Goal.goal = Some goal;
    automation;
    host_idle;
    has_pending_messages;
    retrying;
    compacting;
    latest_assistant_stop_reason;
  }

let assert_continues label initial goal =
  match Goal.plan_continuation ~initial (facts goal) with
  | Goal.Send_continuation plan ->
      assert_bool (label ^ ": trigger") plan.trigger_turn
  | Goal.No_continuation -> failwith (label ^ ": expected continuation")

let assert_no_continuation label facts =
  match Goal.plan_continuation ~initial:false facts with
  | Goal.No_continuation -> ()
  | Goal.Send_continuation _ -> failwith (label ^ ": expected no continuation")

let test_continuation_gates () =
  let goal =
    expect_ok "create"
      (Goal.create ~thread_id:"thread" ~now:1 "keep going" None)
  in
  assert_continues "active goal" false goal;
  assert_no_continuation "interrupted"
    (facts ~automation:Goal.Automation_interrupted goal);
  assert_no_continuation "pending" (facts ~has_pending_messages:true goal);
  assert_no_continuation "retrying" (facts ~retrying:true goal);
  assert_no_continuation "compacting" (facts ~compacting:true goal);
  assert_no_continuation "host busy" (facts ~host_idle:false goal);
  assert_no_continuation "assistant error"
    (facts ~latest_assistant_stop_reason:"error" goal);
  assert_no_continuation "assistant aborted"
    (facts ~latest_assistant_stop_reason:"aborted" goal);
  assert_no_continuation "paused" (facts { goal with status = Goal.Paused });
  assert_no_continuation "missing"
    {
      Goal.goal = None;
      automation = Goal.Automation_enabled;
      host_idle = true;
      has_pending_messages = false;
      retrying = false;
      compacting = false;
      latest_assistant_stop_reason = None;
    }

let test_automation_codec () =
  let enabled =
    expect_ok "enabled"
      (Goal.automation_codec.decode
         (Goal.automation_codec.encode Goal.Automation_enabled))
  in
  let interrupted =
    expect_ok "interrupted"
      (Goal.automation_codec.decode
         (Goal.automation_codec.encode Goal.Automation_interrupted))
  in
  assert_bool "enabled round trip" (enabled = Goal.Automation_enabled);
  assert_bool "interrupted round trip"
    (interrupted = Goal.Automation_interrupted)

let test_commands () =
  let created =
    expect_ok "create command"
      (Goal.apply_command ~thread_id:"thread" ~now:1
         "ship it --time-limit 30m" None)
  in
  let goal =
    match created.goal with
    | Some goal -> goal
    | None -> failwith "create command returned no goal"
  in
  assert_bool "time limit parsed" (goal.time_limit_seconds = Some 1800);
  expect_error "missing time limit"
    "time limit must be a duration like 90s, 30m, or 2h"
    (Goal.apply_command ~thread_id:"thread" ~now:1 "ship --time-limit" None);
  let limited = { goal with status = Goal.Time_limited; time_used_seconds = 1800 } in
  expect_error "resume exhausted"
    "cannot resume goal because its time limit is already reached; use /goal \
     resume --time-limit <duration> or /goal resume --no-time-limit"
    (Goal.apply_command ~thread_id:"thread" ~now:2 "resume" (Some limited));
  let resumed =
    expect_ok "resume no limit"
      (Goal.apply_command ~thread_id:"thread" ~now:3 "resume --no-time-limit"
         (Some limited))
  in
  match resumed.goal with
  | Some goal ->
      assert_bool "resumed active" (goal.status = Goal.Active);
      assert_bool "limit cleared" (goal.time_limit_seconds = None);
      assert_bool "resume enables automation"
        (resumed.automation = Some Goal.Automation_enabled)
  | None -> failwith "resume returned no goal"

let test_legacy_goal_rejected () =
  let legacy =
    Shared.Object
      [
        ("goalId", Shared.String "g");
        ("threadId", Shared.String "t");
        ("objective", Shared.String "ship");
        ("status", Shared.String "active");
        ("tokensUsed", Shared.Number 0.);
        ("timeUsedSeconds", Shared.Number 0.);
        ("tokenBudget", Shared.Number 10.);
        ("createdAt", Shared.Number 1.);
        ("updatedAt", Shared.Number 1.);
      ]
  in
  expect_error "legacy" "incompatible saved Taumel goal entry"
    (Goal.codec.decode legacy)

let () =
  test_time_limit_accounting ();
  test_turn_clock_excludes_pause_time ();
  test_continuation_gates ();
  test_automation_codec ();
  test_commands ();
  test_legacy_goal_rejected ()
