module Plan = Taumel.Plan
module Shared = Taumel.Shared

let expect_ok label = function
  | Ok value -> value
  | Error message -> failwith (label ^ ": " ^ message)

let expect_error label = function
  | Ok _ -> failwith (label ^ ": expected error")
  | Error message -> message

let assert_bool label value = if not value then failwith label

let contains text fragment =
  let text_length = String.length text in
  let fragment_length = String.length fragment in
  let rec loop index =
    index + fragment_length <= text_length
    && (String.sub text index fragment_length = fragment || loop (index + 1))
  in
  fragment_length = 0 || loop 0

let creation ?id ?description ?(depends_on = []) title : Plan.task_creation =
  { id; title; description; depends_on }

let patch ?title ?(description = Plan.Keep_description) ?status ?depends_on () :
    Plan.task_update =
  { title; description; status; depends_on }

let agent_plan ?(session = "agent-birth") () =
  expect_ok "agent plan"
    (Plan.create_task ~session_id:session ~now:1 " first task " None)

let active_plan ?(session = "active") () =
  expect_ok "user plan"
    (Plan.add_user_task ~session_id:session ~now:1 " first task " None)

let test_birth_and_identity () =
  let draft = agent_plan () in
  assert_bool "agent births draft" (draft.status = Plan.Draft);
  let task = List.hd draft.tasks in
  assert_bool "title trimmed" (task.title = "first task");
  assert_bool "generated id prefixed"
    (String.starts_with ~prefix:"task-" task.task_id);
  (* ^plan-tk03: task-<nano-id> with exactly four alphabet chars. *)
  let nano = String.sub task.task_id 5 (String.length task.task_id - 5) in
  assert_bool "generated id nano shape" (Shared.valid_nano_id nano);
  assert_bool "agent origin" (task.origin = Plan.Agent);
  let active = active_plan () in
  assert_bool "user births active" (active.status = Plan.Active);
  assert_bool "user origin" ((List.hd active.tasks).origin = Plan.User);
  let second =
    expect_ok "explicit task"
      (Plan.create_task ~id:"explicit-a" ~session_id:"agent-birth" ~now:2
         "second" (Some draft))
  in
  assert_bool "order preserved"
    (List.map (fun (task : Plan.task) -> task.title) second.tasks
    = [ "first task"; "second" ]);
  ignore
    (expect_error "duplicate explicit id"
       (Plan.create_task ~id:"explicit-a" ~session_id:"agent-birth" ~now:3
          "duplicate" (Some second)));
  let forked = Plan.fork ~session_id:"forked" second in
  assert_bool "fork plan id" (forked.plan.plan_id <> second.plan_id);
  assert_bool "fork session id" (forked.plan.session_id = "forked");
  assert_bool "fork tasks" (forked.plan.tasks = second.tasks);
  assert_bool "fork interrupted"
    (forked.automation = Plan.Automation_interrupted)

let test_lifecycle_and_editability () =
  let draft = agent_plan ~session:"lifecycle" () in
  ignore
    (expect_error "draft cannot complete"
       (Plan.update_plan ~now:2 Plan.Complete (Some draft)));
  let active =
    expect_ok "activate" (Plan.update_plan ~now:2 Plan.Active (Some draft))
  in
  ignore
    (expect_error "agent cannot pause"
       (Plan.update_plan ~now:3 Plan.Paused (Some active)));
  ignore
    (expect_error "active cannot reactivate"
       (Plan.update_plan ~now:3 Plan.Active (Some active)));
  ignore
    (expect_error "active content frozen"
       (Plan.update_task ~now:3 ~task_id:(List.hd active.tasks).task_id
          (patch ~title:"rewrite" ()) (Some active)));
  let blocked =
    expect_ok "blocked bypasses completion"
      (Plan.update_plan ~now:4 Plan.Blocked (Some active))
  in
  let resumed =
    expect_ok "user resumes blocked"
      (Plan.apply_command ~session_id:"lifecycle" ~now:5 "resume" (Some blocked))
    |> fun result -> Option.get result.plan
  in
  assert_bool "resumed active" (resumed.status = Plan.Active);
  let drafted =
    expect_ok "user drafts"
      (Plan.apply_command ~session_id:"lifecycle" ~now:6 "draft" (Some resumed))
    |> fun result -> Option.get result.plan
  in
  assert_bool "draft enables content" (drafted.status = Plan.Draft);
  ignore
    (expect_ok "draft edit"
       (Plan.update_task ~now:7 ~task_id:(List.hd drafted.tasks).task_id
          (patch ~title:"rewritten" ()) (Some drafted)))

let test_user_task_protection () =
  let active = active_plan ~session:"user-protection" () in
  let user_task = List.hd active.tasks in
  let in_progress =
    expect_ok "agent status user task while active"
      (Plan.update_task ~now:2 ~task_id:user_task.task_id
         (patch ~status:Plan.In_progress ()) (Some active))
  in
  ignore
    (expect_error "agent cannot edit user title"
       (Plan.update_task ~now:3 ~task_id:user_task.task_id
          (patch ~title:"changed" ()) (Some in_progress)));
  ignore
    (expect_error "agent cannot cancel user task"
       (Plan.update_task ~now:3 ~task_id:user_task.task_id
          (patch ~status:Plan.Cancelled ()) (Some in_progress)));
  let draft =
    expect_ok "user draft"
      (Plan.apply_command ~session_id:"user-protection" ~now:4 "draft"
         (Some in_progress))
    |> fun result -> Option.get result.plan
  in
  ignore
    (expect_error "user status agent edit only active"
       (Plan.update_task ~now:5 ~task_id:user_task.task_id
          (patch ~status:Plan.Completed ()) (Some draft)));
  ignore
    (expect_ok "user edit unrestricted"
       (Plan.user_update_task ~now:5 ~task_id:user_task.task_id
          (patch ~title:"user rewrite" ~status:Plan.Cancelled ()) (Some draft)))

let test_dependencies_and_atomic_batch () =
  let plan =
    expect_ok "batch"
      (Plan.create_tasks ~session_id:"dependencies" ~now:1
         [
           creation ~id:"task-a" "A";
           creation ~id:"task-b" ~depends_on:[ "task-a" ] "B";
         ]
         None)
  in
  assert_bool "batch draft" (plan.status = Plan.Draft);
  let b = List.nth plan.tasks 1 in
  let blocker_error =
    expect_error "unfinished dependency"
      (Plan.update_task ~now:2 ~task_id:b.task_id
         (patch ~status:Plan.In_progress ()) (Some plan))
  in
  assert_bool "blocker id" (contains blocker_error "task-a");
  assert_bool "blocker title" (contains blocker_error "\"title\":\"A\"");
  assert_bool "blocker status" (contains blocker_error "\"status\":\"pending\"");
  assert_bool "blocker suggestion" (contains blocker_error "complete or cancel");
  let a = List.hd plan.tasks in
  let plan =
    expect_ok "complete dependency"
      (Plan.update_task ~now:3 ~task_id:a.task_id
         (patch ~status:Plan.Completed ()) (Some plan))
  in
  let plan =
    expect_ok "start dependent"
      (Plan.update_task ~now:4 ~task_id:b.task_id
         (patch ~status:Plan.In_progress ()) (Some plan))
  in
  ignore
    (expect_ok "no WIP limit"
       (Plan.update_task ~now:5 ~task_id:a.task_id
          (patch ~status:Plan.In_progress ()) (Some plan)));
  ignore
    (expect_error "later same-call reference rejected atomically"
       (Plan.create_tasks ~session_id:"atomic-later" ~now:1
          [
            creation ~id:"early" ~depends_on:[ "later" ] "Early";
            creation ~id:"later" "Later";
          ]
          None));
  let cyclic =
    expect_error "cycle"
      (Plan.update_task ~now:5 ~task_id:a.task_id
         (patch ~depends_on:[ "task-b" ] ()) (Some plan))
  in
  assert_bool "cycle named" (contains cyclic "cycle")

let test_completion_gate () =
  let draft = agent_plan ~session:"completion" () in
  let active =
    expect_ok "activate" (Plan.update_plan ~now:2 Plan.Active (Some draft))
  in
  let task = List.hd active.tasks in
  let error =
    expect_error "pending blocks complete"
      (Plan.update_plan ~now:3 Plan.Complete (Some active))
  in
  assert_bool "unfinished id" (contains error task.task_id);
  assert_bool "unfinished title" (contains error "first task");
  assert_bool "unfinished status" (contains error "pending");
  let cancelled =
    expect_ok "cancel agent task"
      (Plan.update_task ~now:3 ~task_id:task.task_id
         (patch ~status:Plan.Cancelled ()) (Some active))
  in
  let complete =
    expect_ok "cancelled passes"
      (Plan.update_plan ~now:4 Plan.Complete (Some cancelled))
  in
  assert_bool "complete" (complete.status = Plan.Complete)

let test_commands () =
  let created =
    expect_ok "text creates"
      (Plan.apply_command ~session_id:"commands" ~now:1
         "ship it --time-limit 30m" None)
  in
  let plan = Option.get created.plan in
  assert_bool "visible user message"
    (created.submit_user_message = Some "ship it");
  assert_bool "active with limit"
    (plan.status = Plan.Active && plan.time_limit_seconds = Some 1800);
  let appended =
    expect_ok "reserved word remains text"
      (Plan.apply_command ~session_id:"commands" ~now:2
         "pause deployment" (Some plan))
  in
  assert_bool "appended in active"
    (List.length (Option.get appended.plan).tasks = 2);
  let without_limit =
    expect_ok "task text removes limit"
      (Plan.apply_command ~session_id:"commands" ~now:2
         "verify release --no-time-limit" appended.plan)
  in
  assert_bool "task text cleared limit"
    ((Option.get without_limit.plan).time_limit_seconds = None);
  ignore
    (expect_error "duplicate flags"
       (Plan.apply_command ~session_id:"other-command" ~now:1
          "ship --time-limit 1m --no-time-limit" None));
  ignore
    (expect_error "unit required"
       (Plan.apply_command ~session_id:"unit-command" ~now:1
          "ship --time-limit 30" None));
  let paused =
    expect_ok "pause"
      (Plan.apply_command ~session_id:"commands" ~now:3 "pause"
         without_limit.plan)
  in
  assert_bool "paused" ((Option.get paused.plan).status = Plan.Paused);
  let paused_again =
    expect_ok "pause idempotent"
      (Plan.apply_command ~session_id:"commands" ~now:4 "pause" paused.plan)
  in
  assert_bool "pause ack" (paused_again.message = "Plan already paused.");
  let drafted =
    expect_ok "draft"
      (Plan.apply_command ~session_id:"commands" ~now:5 "draft" paused.plan)
  in
  assert_bool "draft command" ((Option.get drafted.plan).status = Plan.Draft);
  let resumed =
    expect_ok "resume"
      (Plan.apply_command ~session_id:"commands" ~now:6 "resume" drafted.plan)
  in
  assert_bool "resume followup" resumed.followup;
  let cleared =
    expect_ok "clear"
      (Plan.apply_command ~session_id:"commands" ~now:7 "clear" resumed.plan)
  in
  assert_bool "cleared" (cleared.plan = None);
  let no_plan =
    expect_ok "clear idempotent"
      (Plan.apply_command ~session_id:"commands" ~now:8 "clear" None)
  in
  assert_bool "clear ack" (no_plan.message = "No plan to clear.")

let facts ?(automation = Plan.Automation_enabled) ?(host_idle = true)
    ?(has_pending_messages = false) ?(retrying = false) ?(compacting = false)
    ?latest_assistant_stop_reason plan =
  {
    Plan.plan = Some plan;
    automation;
    host_idle;
    has_pending_messages;
    retrying;
    compacting;
    latest_assistant_stop_reason;
  }

let test_continuation () =
  let plan = active_plan ~session:"continuation" () in
  (match Plan.plan_continuation ~initial:false (facts plan) with
  | Plan.No_continuation -> failwith "active plan did not continue"
  | Plan.Send_continuation continuation ->
      assert_bool "custom type"
        (continuation.custom_type = "taumel.plan.continue");
      assert_bool "followup" (continuation.deliver_as = "followUp");
      assert_bool "untrusted tasks"
        (contains continuation.content "<untrusted_plan_tasks_json>");
      assert_bool "task payload" (contains continuation.content "first task");
      assert_bool "runnable mark"
        (contains continuation.content "\"readiness\":\"runnable\"");
      assert_bool "telemetry" (contains continuation.content "0 tokens");
      assert_bool "no objective" (not (contains continuation.content "objective")));
  List.iter
    (fun blocked ->
      match Plan.plan_continuation ~initial:false blocked with
      | Plan.No_continuation -> ()
      | _ -> failwith "suppressed continuation was sent")
    [
      facts ~automation:Plan.Automation_interrupted plan;
      facts ~host_idle:false plan;
      facts ~has_pending_messages:true plan;
      facts ~retrying:true plan;
      facts ~compacting:true plan;
      facts ~latest_assistant_stop_reason:"error" plan;
      facts
        (expect_ok "pause continuation plan"
           (Plan.apply_command ~session_id:"continuation" ~now:2 "pause"
              (Some plan))
        |> fun result -> Option.get result.plan);
    ];
  assert_bool "child cap"
    (match
       Plan.plan_child_continuation ~plan:(Some plan)
         ~automation:Plan.Automation_enabled ~iterations:25 ~max_iterations:25
         ~latest_assistant_stop_reason:None
     with
    | Plan.Child_finalize { child_reason = Some "plan_continuation_limit"; _ } ->
        true
    | _ -> false)

let persisted_plan ?(status = "active") ?(tokens = 0.) ?(time = 0.)
    ?(limit = Shared.Null) ?(created = 1.) ?(updated = 1.) ?(tasks = None) () =
  let tasks =
    Option.value tasks
      ~default:
        (Shared.Array
           [
             Shared.Object
               [
                 ("taskId", Shared.String "persisted-task");
                 ("title", Shared.String "Ship");
                 ("description", Shared.Null);
                 ("status", Shared.String "pending");
                 ("depends_on", Shared.Array []);
                 ("origin", Shared.String "agent");
               ];
           ])
  in
  Shared.Object
    [
      ("planId", Shared.String "p");
      ("sessionId", Shared.String "persisted-session");
      ("status", Shared.String status);
      ("tasks", tasks);
      ("tokensUsed", Shared.Number tokens);
      ("timeUsedSeconds", Shared.Number time);
      ("timeLimitSeconds", limit);
      ("createdAt", Shared.Number created);
      ("updatedAt", Shared.Number updated);
    ]

let persisted_task ?(status = "pending") ?(depends_on = []) id title =
  Shared.Object
    [
      ("taskId", Shared.String id);
      ("title", Shared.String title);
      ("description", Shared.Null);
      ("status", Shared.String status);
      ( "depends_on",
        Shared.Array (List.map (fun dependency -> Shared.String dependency) depends_on) );
      ("origin", Shared.String "agent");
    ]

let test_persistence () =
  let plan = agent_plan ~session:"codec" () in
  let decoded =
    expect_ok "round trip" (Plan.codec.decode (Plan.codec.encode (Some plan)))
    |> Option.get
  in
  assert_bool "round trip" (decoded.tasks = plan.tasks);
  ignore
    (expect_error "empty tasks"
       (Plan.codec.decode
          (persisted_plan ~tasks:(Some (Shared.Array [])) ())));
  ignore
    (expect_error "negative tokens"
       (Plan.codec.decode (persisted_plan ~tokens:(-1.) ())));
  ignore
    (expect_error "timestamp order"
       (Plan.codec.decode (persisted_plan ~created:2. ~updated:1. ())));
  ignore
    (expect_error "unknown status"
       (Plan.codec.decode (persisted_plan ~status:"usage_limited" ())));
  ignore
    (expect_error "time limited invariant"
       (Plan.codec.decode (persisted_plan ~status:"time_limited" ())));
  ignore
    (expect_error "duplicate ids"
       (Plan.codec.decode
          (persisted_plan
             ~tasks:
               (Some
                  (Shared.Array
                     [ persisted_task "same" "A"; persisted_task "same" "B" ]))
             ())));
  ignore
    (expect_error "unknown dependency"
       (Plan.codec.decode
          (persisted_plan
             ~tasks:
               (Some
                  (Shared.Array
                     [ persisted_task ~depends_on:[ "missing" ] "a" "A" ]))
             ())));
  ignore
    (expect_error "persisted cycle"
       (Plan.codec.decode
          (persisted_plan
             ~tasks:
               (Some
                  (Shared.Array
                     [
                       persisted_task ~depends_on:[ "b" ] "a" "A";
                       persisted_task ~depends_on:[ "a" ] "b" "B";
                     ]))
             ())));
  let legacy =
    match persisted_plan () with
    | Shared.Object fields -> Shared.Object (("tokenBudget", Shared.Number 1.) :: fields)
    | _ -> assert false
  in
  ignore (expect_error "legacy field" (Plan.codec.decode legacy))

let test_accounting_and_time () =
  let plan =
    expect_ok "limited plan"
      (Plan.add_user_task ~time_limit_seconds:10 ~session_id:"accounting" ~now:1
         "ship" None)
  in
  let updated =
    Plan.account_usage ~now:2 ~time_delta_seconds:11
      { input_tokens = 20; cached_input_tokens = 5; output_tokens = 7 }
      plan
  in
  assert_bool "time limited" (updated.status = Plan.Time_limited);
  assert_bool "active time actual" (updated.time_used_seconds = 11);
  assert_bool "uncached tokens" (updated.tokens_used = 22);
  ignore
    (expect_error "resume reached limit"
       (Plan.apply_command ~session_id:"accounting" ~now:3 "resume"
          (Some updated)));
  let resumed =
    expect_ok "remove reached limit"
      (Plan.apply_command ~session_id:"accounting" ~now:3
         "resume --no-time-limit" (Some updated))
    |> fun result -> Option.get result.plan
  in
  assert_bool "resumed without limit"
    (resumed.status = Plan.Active && resumed.time_limit_seconds = None);
  let clock = Plan.start_turn_clock ~now_ms:0 Plan.empty_clock in
  let clock = Plan.pause_clock_start ~now_ms:1_000 clock in
  let clock = Plan.pause_clock_start ~now_ms:2_000 clock in
  let clock = Plan.pause_clock_end ~now_ms:4_000 clock in
  let clock = Plan.pause_clock_end ~now_ms:6_000 clock in
  let elapsed, _ = Plan.finish_turn_clock ~now_ms:11_000 clock in
  assert_bool "nested waits excluded" (elapsed = 6);
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
    Plan.account_turn_end ~pending_terminal_status:Plan.Pending_complete
      ~session_id:"accounting" ~now:3 ~active_time_seconds:4
      ~last_accounting_key:None
      ~latest_usage:(Plan.latest_assistant_usage branch) (Some plan)
  in
  let final = Option.get accounted.plan in
  assert_bool "terminal accounted first"
    (final.status = Plan.Complete && final.tokens_used = 22
   && final.time_used_seconds = 4);
  let duplicate =
    Plan.account_turn_end ~session_id:"accounting" ~now:4
      ~active_time_seconds:4 ~last_accounting_key:accounted.accounting_key
      ~latest_usage:(Plan.latest_assistant_usage branch) accounted.plan
  in
  assert_bool "exactly once" (not duplicate.changed)

let test_task_manager_commands () =
  let created =
    expect_ok "task add creates draft"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:1
         "task add {\"title\":\"first\",\"description\":\"body\"}" None)
  in
  let plan = Option.get created.plan in
  assert_bool "modal birth is draft" (plan.status = Plan.Draft);
  assert_bool "modal task is user" ((List.hd plan.tasks).origin = Plan.User);
  assert_bool "modal add has no agent submit" (created.submit_user_message = None);
  let task_id = (List.hd plan.tasks).task_id in
  let edited =
    expect_ok "task edit"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:2
         ("task edit " ^ task_id ^ " {\"title\":\"renamed\"}")
         created.plan)
  in
  assert_bool "edited title"
    ((List.hd (Option.get edited.plan).tasks).title = "renamed");
  let advanced =
    expect_ok "task advance"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:3
         ("task advance " ^ task_id) edited.plan)
  in
  assert_bool "advanced in progress"
    ((List.hd (Option.get advanced.plan).tasks).status = Plan.In_progress);
  let completed =
    expect_ok "task advance complete"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:4
         ("task advance " ^ task_id) advanced.plan)
  in
  assert_bool "advanced completed"
    ((List.hd (Option.get completed.plan).tasks).status = Plan.Completed);
  ignore
    (expect_error "terminal advance rejected"
       (Plan.apply_command ~session_id:"tasks-modal" ~now:5
          ("task advance " ^ task_id) completed.plan));
  let second =
    expect_ok "task add second"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:6
         "task add {\"title\":\"second\"}" completed.plan)
  in
  let second_id = (List.nth (Option.get second.plan).tasks 1).task_id in
  let cancelled =
    expect_ok "task cancel"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:7
         ("task cancel " ^ second_id) second.plan)
  in
  assert_bool "cancelled"
    ((List.nth (Option.get cancelled.plan).tasks 1).status = Plan.Cancelled);
  let deleted =
    expect_ok "task delete"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:8
         ("task delete " ^ second_id) cancelled.plan)
  in
  assert_bool "deleted leaves one"
    (List.length (Option.get deleted.plan).tasks = 1);
  ignore
    (expect_error "last task delete rejected"
       (Plan.apply_command ~session_id:"tasks-modal" ~now:9
          ("task delete " ^ task_id) deleted.plan));
  let blocked =
    expect_ok "dep pair"
      (Plan.create_tasks ~session_id:"tasks-dep" ~now:10
         [
           creation ~id:"task-dep-a" "A";
           creation ~id:"task-dep-b" ~depends_on:[ "task-dep-a" ] "B";
         ]
         None)
  in
  let dep_error =
    expect_error "advance dependency gate"
      (Plan.apply_command ~session_id:"tasks-dep" ~now:11
         "task advance task-dep-b" (Some blocked))
  in
  assert_bool "dep gate names blocker" (contains dep_error "task-dep-a")

let () =
  test_birth_and_identity ();
  test_lifecycle_and_editability ();
  test_user_task_protection ();
  test_dependencies_and_atomic_batch ();
  test_completion_gate ();
  test_commands ();
  test_task_manager_commands ();
  test_continuation ();
  test_persistence ();
  test_accounting_and_time ()
