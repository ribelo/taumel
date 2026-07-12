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

let test_pending_terminal_accounting () =
  let goal =
    expect_ok "create"
      (Goal.create ~thread_id:"thread" ~now:1 "finish with telemetry" None)
  in
  let terminal_goal = { goal with status = Goal.Complete; updated_at = 2 } in
  let branch =
    [
      Shared.Object
        [
          ( "message",
            Shared.Object
              [
                ("role", Shared.String "assistant");
                ( "usage",
                  Shared.Object
                    [
                      ("input_tokens", Shared.Number 20.);
                      ("cached_input_tokens", Shared.Number 5.);
                      ("output_tokens", Shared.Number 7.);
                    ] );
              ] );
        ];
    ]
  in
  let accounted =
    Goal.account_turn_end ~pending_terminal_status:Goal.Complete
      ~session_id:"session" ~now:9 ~active_time_seconds:4
      ~last_accounting_key:None ~branch (Some terminal_goal)
  in
  assert_bool "pending terminal accounting changed" accounted.changed;
  match accounted.goal with
  | Some goal ->
      assert_bool "terminal status reapplied" (goal.status = Goal.Complete);
      assert_bool "terminal tokens accounted" (goal.tokens_used = 22);
      assert_bool "terminal time accounted" (goal.time_used_seconds = 4);
      assert_bool "terminal updated at accounting time" (goal.updated_at = 9)
  | None -> failwith "pending terminal accounting returned no goal"

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
      assert_bool (label ^ ": trigger") plan.trigger_turn;
      assert_bool (label ^ ": visible") plan.display
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

let test_model_cannot_replace_or_rewrite_inactive_goal () =
  let goal =
    expect_ok "create"
      (Goal.create ~thread_id:"session" ~now:1 "ship" None)
  in
  let complete =
    expect_ok "complete" (Goal.update_status ~now:2 Goal.Complete (Some goal))
  in
  expect_error "create over complete"
    "cannot create a new goal because this session already has a goal; clear it first"
    (Goal.create ~thread_id:"session" ~now:3 "replace" (Some complete));
  expect_error "rewrite complete"
    "cannot update goal because only an active goal may be completed or blocked"
    (Goal.update_status ~now:4 Goal.Blocked (Some complete))

let test_canonical_command_grammar () =
  let created =
    expect_ok "reserved objective"
      (Goal.apply_command ~thread_id:"session" ~now:1
         "pause deployment automation" None)
  in
  let goal = Option.get created.goal in
  assert_bool "reserved word remains objective"
    (goal.objective = "pause deployment automation");
  expect_error "duplicate limits" "time limit may be specified only once"
    (Goal.apply_command ~thread_id:"session" ~now:1
       "ship --time-limit 1m --no-time-limit" None);
  let paused =
    expect_ok "pause"
      (Goal.apply_command ~thread_id:"session" ~now:2 "pause" (Some goal))
  in
  let paused_again =
    expect_ok "pause idempotent"
      (Goal.apply_command ~thread_id:"session" ~now:3 "pause" paused.goal)
  in
  assert_bool "pause idempotent unchanged" (not paused_again.changed);
  assert_bool "pause acknowledgement"
    (paused_again.message = "Goal already paused.");
  expect_error "removed complete command"
    "cannot create a new goal because this session already has a goal; clear it first"
    (Goal.apply_command ~thread_id:"session" ~now:4 "complete" paused.goal)

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

let persisted_goal ?(status = "active") ?(tokens = 0.) ?(time = 0.)
    ?(limit = Shared.Null) ?(created = 1.) ?(updated = 1.) () =
  Shared.Object
    [
      ("goalId", Shared.String "g");
      ("sessionId", Shared.String "s");
      ("objective", Shared.String "ship");
      ("status", Shared.String status);
      ("tokensUsed", Shared.Number tokens);
      ("timeUsedSeconds", Shared.Number time);
      ("timeLimitSeconds", limit);
      ("createdAt", Shared.Number created);
      ("updatedAt", Shared.Number updated);
    ]

let test_persisted_invariants () =
  expect_error "negative tokens" "tokensUsed must be non-negative"
    (Goal.codec.decode (persisted_goal ~tokens:(-1.) ()));
  expect_error "timestamp order" "updatedAt must not precede createdAt"
    (Goal.codec.decode (persisted_goal ~created:2. ~updated:1. ()));
  expect_error "contradictory time limited"
    "time_limited status requires a reached timeLimitSeconds"
    (Goal.codec.decode (persisted_goal ~status:"time_limited" ()))

let test_fork_rebinds_identity_only () =
  let goal =
    expect_ok "fork source"
      (Goal.create ~thread_id:"parent" ~now:1 "ship" None)
  in
  let goal = { goal with tokens_used = 10; time_used_seconds = 4 } in
  let forked = Goal.rebind_for_fork ~session_id:"fork" goal in
  assert_bool "fork session identity" (forked.thread_id = "fork");
  assert_bool "fork goal identity" (forked.goal_id <> goal.goal_id);
  assert_bool "fork objective" (forked.objective = goal.objective);
  assert_bool "fork telemetry"
    (forked.tokens_used = 10 && forked.time_used_seconds = 4)

let test_user_reopens_completed_goal () =
  let active =
    expect_ok "reopen source"
      (Goal.create ~thread_id:"session" ~now:1 "ship" None)
  in
  let complete =
    expect_ok "model completes"
      (Goal.update_status ~now:2 Goal.Complete (Some active))
  in
  let resumed =
    expect_ok "user resumes complete"
      (Goal.apply_command ~thread_id:"session" ~now:3 "resume" (Some complete))
  in
  let reopened = Option.get resumed.goal in
  assert_bool "reopen active" (reopened.status = Goal.Active);
  assert_bool "reopen identity" (reopened.goal_id = complete.goal_id);
  assert_bool "reopen objective" (reopened.objective = complete.objective);
  assert_bool "reopen continuation" resumed.followup

let () =
  test_time_limit_accounting ();
  test_turn_clock_excludes_pause_time ();
  test_pending_terminal_accounting ();
  test_continuation_gates ();
  test_automation_codec ();
  test_commands ();
  test_model_cannot_replace_or_rewrite_inactive_goal ();
  test_canonical_command_grammar ();
  test_legacy_goal_rejected ();
  test_persisted_invariants ();
  test_fork_rebinds_identity_only ();
  test_user_reopens_completed_goal ()
