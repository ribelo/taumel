module Plan = Taumel.Plan
module Plan_block = Taumel.Plan_block
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

let patch ?title ?(description = Plan.Keep_description) ?status ?reason
    ?depends_on () : Plan.task_update =
  { title; description; status; reason; depends_on }

let agent_plan ?(session = "agent-birth") () =
  expect_ok "agent plan"
    (Plan.create_task ~session_id:session ~now:1 " first task " None)

let active_plan ?(session = "active") () =
  expect_ok "user plan"
    (Plan.add_user_task ~session_id:session ~now:1 " first task " None)

let only_open_block plan =
  match Plan.block_entries plan with
  | [ Plan.Open entry ] -> entry
  | _ -> failwith "expected exactly one open plan block"

let only_closed_block plan =
  match Plan.block_entries plan with
  | [ Plan.Closed entry ] -> entry
  | _ -> failwith "expected exactly one closed plan block"

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
  assert_bool "fork unlock default" (not forked.plan.extension_unlocked);
  assert_bool "fork interrupted"
    (forked.automation = Plan.Automation_interrupted)

let test_lifecycle_and_editability () =
  let draft = agent_plan ~session:"lifecycle" () in
  let active =
    expect_ok "activate"
      (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
         (Some draft))
  in
  ignore
    (expect_ok "active reactivation is idempotent"
       (Plan.update_plan ~reason:"test transition" ~now:3 Plan.Request_active
          (Some active)));
  ignore
    (expect_error "active content frozen"
       (Plan.update_task ~now:3 ~task_id:(List.hd active.tasks).task_id
          (patch ~title:"rewrite" ())
          (Some active)));
  let blocked =
    expect_ok "blocked bypasses completion"
      (Plan.update_plan ~reason:"test block" ~now:4 Plan.Request_blocked
         (Some active))
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
          (patch ~title:"rewritten" ())
          (Some drafted)))

(* ^plan-5sl5 ^plan-w45d ^plan-q1gi: agent block/unblock and idempotence. *)
let test_agent_block_lifecycle () =
  let active = active_plan ~session:"agent-block" () in
  let empty_reason =
    expect_error "block reason required"
      (Plan.update_plan ~reason:"  " ~now:2 Plan.Request_blocked (Some active))
  in
  assert_bool "empty block reason named"
    (contains empty_reason "non-empty reason");
  assert_bool "empty block reason leaves state" (Plan.block_entries active = []);
  let blocked =
    expect_ok "agent blocks with reason"
      (Plan.update_plan ~reason:"  Waiting for credentials.  " ~now:3
         Plan.Request_blocked (Some active))
  in
  let opened = only_open_block blocked in
  assert_bool "block reason trimmed" (opened.reason = "Waiting for credentials.");
  assert_bool "agent block source"
    (Plan.block_source_to_string opened.source = "agent");
  assert_bool "block timestamp" (opened.blocked_at = 3);
  let blocked_again =
    expect_ok "same blocked idempotent"
      (Plan.update_plan ~reason:"No lifecycle change." ~now:4
         Plan.Request_blocked (Some blocked))
  in
  assert_bool "same blocked leaves one entry"
    (Plan.block_entries blocked_again = Plan.block_entries blocked);
  let empty_resolution =
    expect_error "unblock resolution required"
      (Plan.update_plan ~reason:" \t " ~now:5 Plan.Request_active (Some blocked))
  in
  assert_bool "empty resolution named"
    (contains empty_resolution "non-empty reason");
  let active_again =
    expect_ok "agent unblocks"
      (Plan.update_plan ~reason:"  Credentials supplied.  " ~now:6
         Plan.Request_active (Some blocked))
  in
  assert_bool "agent unblock active" (active_again.status = Plan.Active);
  let closed = only_closed_block active_again in
  assert_bool "agent resolution trimmed"
    (closed.resolution = "Credentials supplied.");
  assert_bool "agent clearedBy"
    (Plan.block_cleared_by_to_string closed.cleared_by = "agent");
  assert_bool "agent clearedAt" (closed.cleared_at = 6);
  let active_same =
    expect_ok "same active idempotent"
      (Plan.update_plan ~reason:"test transition" ~now:7 Plan.Request_active
         (Some active_again))
  in
  assert_bool "same active unchanged" (active_same = active_again)

(* ^plan-vdhy ^plan-tndz: every non-agent exit closes or opens history. *)
let test_system_and_user_block_history () =
  let blocked session =
    let active = active_plan ~session () in
    expect_ok "block for user closure"
      (Plan.update_plan ~reason:"Need input." ~now:2 Plan.Request_blocked
         (Some active))
  in
  let resumed =
    expect_ok "user resume closes block"
      (Plan.apply_command ~session_id:"block-resume" ~now:3 "resume"
         (Some (blocked "block-resume")))
    |> fun result -> Option.get result.plan
  in
  let resume_entry = only_closed_block resumed in
  assert_bool "resume cleared by user"
    (Plan.block_cleared_by_to_string resume_entry.cleared_by = "user");
  assert_bool "resume resolution names cause"
    (contains resume_entry.resolution "resumed");
  let drafted =
    expect_ok "user draft closes block"
      (Plan.apply_command ~session_id:"block-draft" ~now:3 "draft"
         (Some (blocked "block-draft")))
    |> fun result -> Option.get result.plan
  in
  let draft_entry = only_closed_block drafted in
  assert_bool "draft cleared by user"
    (Plan.block_cleared_by_to_string draft_entry.cleared_by = "user");
  assert_bool "draft resolution names cause"
    (contains draft_entry.resolution "draft");
  let completion_source = blocked "block-completion" in
  let completed =
    expect_ok "completion closes block"
      (Plan.user_update_task ~now:3
         ~task_id:(List.hd completion_source.tasks).task_id
         (patch ~status:Plan.Completed ())
         (Some completion_source))
  in
  let completion_entry = only_closed_block completed in
  assert_bool "completion status" (completed.status = Plan.Complete);
  assert_bool "completion cleared by user"
    (Plan.block_cleared_by_to_string completion_entry.cleared_by = "user");
  assert_bool "completion resolution names cause"
    (completion_entry.resolution
   = "Plan completed automatically because every task is completed or \
      cancelled.");
  let system_blocked =
    Plan.final_unrecoverable_error ~now:4
      (Some (active_plan ~session:"system-block" ()))
    |> Option.get
  in
  let system_entry = only_open_block system_blocked in
  assert_bool "system block source"
    (Plan.block_source_to_string system_entry.source = "system");
  assert_bool "system reason"
    (contains system_entry.reason "unrecoverable turn error")

(* ^plan-q0ri: lifecycle rejections name current status and its remedy. *)
let test_lifecycle_rejection_messages () =
  let active = active_plan ~session:"status-errors" () in
  let blocked =
    expect_ok "blocked status error source"
      (Plan.update_plan ~reason:"Need input." ~now:2 Plan.Request_blocked
         (Some active))
  in
  let blocked_error =
    expect_error "blocked create rejection"
      (Plan.create_task ~session_id:"status-errors" ~now:3 "extra"
         (Some blocked))
  in
  assert_bool "blocked rejection status and remedy"
    (contains blocked_error "current status is blocked"
    && contains blocked_error "/plan draft"
    && not (contains blocked_error "update_plan with status active"));
  let paused =
    expect_ok "paused status error source"
      (Plan.apply_command ~session_id:"status-errors-paused" ~now:2 "pause"
         (Some (active_plan ~session:"status-errors-paused" ())))
    |> fun result -> Option.get result.plan
  in
  let paused_error =
    expect_error "paused create rejection"
      (Plan.create_task ~session_id:"status-errors-paused" ~now:3 "extra"
         (Some paused))
  in
  assert_bool "paused rejection status and remedy"
    (contains paused_error "current status is paused"
    && contains paused_error "/plan draft"
    && not (contains paused_error "/plan resume"));
  let agent_draft = agent_plan ~session:"status-errors-capability" () in
  let agent_active =
    expect_ok "activate capability source"
      (Plan.update_plan ~reason:"Start work." ~now:2 Plan.Request_active
         (Some agent_draft))
  in
  let agent_blocked =
    expect_ok "block capability source"
      (Plan.update_plan ~reason:"Need input." ~now:3 Plan.Request_blocked
         (Some agent_active))
  in
  let agent_task = List.hd agent_blocked.tasks in
  let content_error =
    expect_error "blocked content rejection"
      (Plan.update_task ~now:4 ~task_id:agent_task.task_id
         (patch ~title:"rewrite" ())
         (Some agent_blocked))
  in
  assert_bool "content rejection restores content capability"
    (contains content_error "/plan draft"
    && not (contains content_error "update_plan with status active"));
  let status_error =
    expect_error "blocked status rejection"
      (Plan.update_task ~now:4 ~task_id:agent_task.task_id
         (patch ~status:Plan.In_progress ())
         (Some agent_blocked))
  in
  assert_bool "status rejection restores status capability"
    (contains status_error "update_plan with status active"
    && not (contains status_error "/plan draft"));
  let complete_source = active_plan ~session:"status-errors-complete" () in
  let complete =
    expect_ok "complete status error source"
      (Plan.update_task ~now:2 ~task_id:(List.hd complete_source.tasks).task_id
         (patch ~status:Plan.Completed ())
         (Some complete_source))
  in
  let complete_error =
    expect_error "complete create rejection"
      (Plan.create_task ~session_id:"status-errors-complete" ~now:4 "extra"
         (Some complete))
  in
  assert_bool "complete rejection status and remedy"
    (contains complete_error "current status is complete"
    && contains complete_error "after its turn ends")

let test_user_task_protection () =
  let active = active_plan ~session:"user-protection" () in
  let user_task = List.hd active.tasks in
  let in_progress =
    expect_ok "agent status user task while active"
      (Plan.update_task ~now:2 ~task_id:user_task.task_id
         (patch ~status:Plan.In_progress ())
         (Some active))
  in
  ignore
    (expect_error "agent cannot edit user title"
       (Plan.update_task ~now:3 ~task_id:user_task.task_id
          (patch ~title:"changed" ())
          (Some in_progress)));
  ignore
    (expect_error "agent cannot cancel user task"
       (Plan.update_task ~now:3 ~task_id:user_task.task_id
          (patch ~status:Plan.Cancelled ())
          (Some in_progress)));
  let draft =
    expect_ok "user draft"
      (Plan.apply_command ~session_id:"user-protection" ~now:4 "draft"
         (Some in_progress))
    |> fun result -> Option.get result.plan
  in
  ignore
    (expect_error "user status agent edit only active"
       (Plan.update_task ~now:5 ~task_id:user_task.task_id
          (patch ~status:Plan.Completed ())
          (Some draft)));
  ignore
    (expect_ok "user edit unrestricted"
       (Plan.user_update_task ~now:5 ~task_id:user_task.task_id
          (patch ~title:"user rewrite" ~status:Plan.Cancelled
             ~reason:"Cancelled by the user." ())
          (Some draft)))

(* ^plan-i4u9 ^plan-rx0w: cancellation reasons are required, trimmed, and cleared. *)
let test_agent_task_cancellation_reason () =
  let draft =
    expect_ok "cancellation plan"
      (Plan.create_tasks ~session_id:"cancellation-reason" ~now:1
         [
           creation ~id:"cancel-target" "Target";
           creation ~id:"remaining-work" "Remaining";
         ]
         None)
  in
  let active =
    expect_ok "activate cancellation plan"
      (Plan.update_plan ~reason:"Start cancellation test." ~now:2
         Plan.Request_active (Some draft))
  in
  let missing_error =
    expect_error "agent cancellation reason missing"
      (Plan.update_task ~now:3 ~task_id:"cancel-target"
         (patch ~status:Plan.Cancelled ())
         (Some active))
  in
  assert_bool "missing cancellation reason rejected"
    (contains missing_error "non-empty reason");
  assert_bool "missing cancellation reason leaves task pending"
    ((List.find
        (fun (task : Plan.task) -> task.task_id = "cancel-target")
        active.tasks)
       .status = Plan.Pending);
  let empty_error =
    expect_error "agent cancellation reason empty"
      (Plan.update_task ~now:3 ~task_id:"cancel-target"
         (patch ~status:Plan.Cancelled ~reason:" \t " ())
         (Some active))
  in
  assert_bool "empty cancellation reason rejected"
    (contains empty_error "cancellation reason");
  let misplaced_error =
    expect_error "reason without cancelled status"
      (Plan.update_task ~now:3 ~task_id:"cancel-target"
         (patch ~status:Plan.Completed ~reason:"Not a cancellation." ())
         (Some active))
  in
  assert_bool "misplaced cancellation reason rejected"
    (contains misplaced_error "cancelled");
  assert_bool "misplaced cancellation reason leaves task pending"
    ((List.find
        (fun (task : Plan.task) -> task.task_id = "cancel-target")
        active.tasks)
       .status = Plan.Pending);
  let cancelled =
    expect_ok "agent cancellation reason stored"
      (Plan.update_task ~now:4 ~task_id:"cancel-target"
         (patch ~status:Plan.Cancelled ~reason:"  Superseded by new work.  " ())
         (Some active))
  in
  let cancelled_task =
    List.find
      (fun (task : Plan.task) -> task.task_id = "cancel-target")
      cancelled.tasks
  in
  assert_bool "cancelled task stores trimmed reason"
    (cancelled_task.cancellation_reason = Some "Superseded by new work.");
  assert_bool "continuation payload omits cancelled task reason"
    (not
       (contains
          (Plan.continuation_followup_prompt cancelled)
          "Superseded by new work."));
  let reopened =
    expect_ok "leaving cancelled clears reason"
      (Plan.update_task ~now:5 ~task_id:"cancel-target"
         (patch ~status:Plan.Pending ())
         (Some cancelled))
  in
  let reopened_task =
    List.find
      (fun (task : Plan.task) -> task.task_id = "cancel-target")
      reopened.tasks
  in
  assert_bool "reopened task clears cancellation reason"
    (reopened_task.status = Plan.Pending
    && reopened_task.cancellation_reason = None)

let test_block_close_invariants () =
  let history =
    expect_ok "open block entry"
      (Plan_block.open_entry ~now:5 ~reason:"Need input."
         ~source:Plan_block.agent_source Plan_block.empty)
  in
  let carried = Option.get (Plan_block.open_entry_opt history) in
  let mismatched =
    expect_error "mismatched carried entry"
      (Plan_block.close_carried ~now:6 ~cleared_by:Plan_block.user_clearer
         ~resolution:"Done."
         { carried with reason = "Different." }
         history)
  in
  assert_bool "mismatch named" (contains mismatched "does not match");
  let rolled_back =
    expect_error "clock rollback close"
      (Plan_block.close_carried ~now:4 ~cleared_by:Plan_block.user_clearer
         ~resolution:"Done." carried history)
  in
  assert_bool "rollback named" (contains rolled_back "must not precede");
  ignore
    (expect_error "close without open entry"
       (Plan_block.close_carried ~now:6 ~cleared_by:Plan_block.user_clearer
          ~resolution:"Done." carried Plan_block.empty))

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
         (patch ~status:Plan.In_progress ())
         (Some plan))
  in
  assert_bool "blocker id" (contains blocker_error "task-a");
  assert_bool "blocker title" (contains blocker_error "\"title\":\"A\"");
  assert_bool "blocker status" (contains blocker_error "\"status\":\"pending\"");
  assert_bool "blocker suggestion" (contains blocker_error "complete or cancel");
  let a = List.hd plan.tasks in
  let plan =
    expect_ok "complete dependency"
      (Plan.update_task ~now:3 ~task_id:a.task_id
         (patch ~status:Plan.Completed ())
         (Some plan))
  in
  let plan =
    expect_ok "start dependent"
      (Plan.update_task ~now:4 ~task_id:b.task_id
         (patch ~status:Plan.In_progress ())
         (Some plan))
  in
  ignore
    (expect_ok "no WIP limit"
       (Plan.update_task ~now:5 ~task_id:a.task_id
          (patch ~status:Plan.In_progress ())
          (Some plan)));
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
         (patch ~depends_on:[ "task-b" ] ())
         (Some plan))
  in
  assert_bool "cycle named" (contains cyclic "cycle")

let unlock_complete plan ~session ~now =
  let result =
    Plan.account_turn_end ~session_id:session ~now ~active_time_seconds:0
      ~last_accounting_key:None ~latest_usage:None (Some plan)
  in
  Option.get result.plan

let test_completion_invariant () =
  let draft = agent_plan ~session:"completion" () in
  let active =
    expect_ok "activate"
      (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
         (Some draft))
  in
  let task = List.hd active.tasks in
  let complete =
    expect_ok "last task completes plan"
      (Plan.update_task ~now:3 ~task_id:task.task_id
         (patch ~status:Plan.Completed ())
         (Some active))
  in
  assert_bool "active auto-complete" (complete.status = Plan.Complete);
  assert_bool "complete starts locked" (not complete.extension_unlocked);
  let cancelled_draft = agent_plan ~session:"completion-cancel" () in
  let cancelled_active =
    expect_ok "activate cancel path"
      (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
         (Some cancelled_draft))
  in
  let cancelled =
    expect_ok "all-cancelled completes"
      (Plan.update_task ~now:3 ~task_id:(List.hd cancelled_active.tasks).task_id
         (patch ~status:Plan.Cancelled ~reason:"No longer needed." ())
         (Some cancelled_active))
  in
  assert_bool "cancelled auto-complete" (cancelled.status = Plan.Complete);
  let draft_done = agent_plan ~session:"completion-draft" () in
  let draft_finished =
    expect_ok "draft finishes tasks without completing"
      (Plan.update_task ~now:2 ~task_id:(List.hd draft_done.tasks).task_id
         (patch ~status:Plan.Completed ())
         (Some draft_done))
  in
  assert_bool "draft exempt" (draft_finished.status = Plan.Draft);
  let activated_done =
    expect_ok "activate all-done lands complete"
      (Plan.update_plan ~reason:"test transition" ~now:3 Plan.Request_active
         (Some draft_finished))
  in
  assert_bool "activate all-done" (activated_done.status = Plan.Complete);
  let paused =
    expect_ok "pause for user tick"
      (Plan.apply_command ~session_id:"completion-paused" ~now:1
         "task add {\"title\":\"only\"}" None)
    |> fun result ->
    let plan =
      expect_ok "activate paused path"
        (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
           result.plan)
    in
    expect_ok "pause"
      (Plan.apply_command ~session_id:"completion-paused" ~now:3 "pause"
         (Some plan))
    |> fun paused -> Option.get paused.plan
  in
  let paused_done =
    expect_ok "user advance completes paused"
      (Plan.apply_command ~session_id:"completion-paused" ~now:4
         ("task advance " ^ (List.hd paused.tasks).task_id)
         (Some paused))
  in
  (* advance pending -> in_progress first *)
  let paused_in_progress = Option.get paused_done.plan in
  assert_bool "first advance stays paused"
    (paused_in_progress.status = Plan.Paused);
  let paused_complete =
    expect_ok "second advance completes paused"
      (Plan.apply_command ~session_id:"completion-paused" ~now:5
         ("task advance " ^ (List.hd paused_in_progress.tasks).task_id)
         (Some paused_in_progress))
  in
  assert_bool "paused auto-complete"
    ((Option.get paused_complete.plan).status = Plan.Complete);
  assert_bool "paused complete notifies"
    (paused_complete.message = "Plan complete.");
  assert_bool "paused complete no followup" (not paused_complete.followup);
  let blocked =
    let draft = agent_plan ~session:"completion-blocked" () in
    let active =
      expect_ok "activate blocked path"
        (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
           (Some draft))
    in
    expect_ok "block"
      (Plan.update_plan ~reason:"test block" ~now:3 Plan.Request_blocked
         (Some active))
  in
  let blocked_complete =
    expect_ok "user completes blocked"
      (Plan.user_update_task ~now:4 ~task_id:(List.hd blocked.tasks).task_id
         (patch ~status:Plan.Completed ())
         (Some blocked))
  in
  assert_bool "blocked auto-complete" (blocked_complete.status = Plan.Complete);
  let limited =
    expect_ok "time limited birth"
      (Plan.add_user_task ~time_limit_seconds:1 ~session_id:"completion-tl"
         ~now:1 "limited" None)
    |> fun plan ->
    Plan.account_usage ~now:2 ~time_delta_seconds:1
      { input_tokens = 1; cached_input_tokens = 0; output_tokens = 0 }
      plan
  in
  assert_bool "time limited" (limited.status = Plan.Time_limited);
  let limited_complete =
    expect_ok "user completes time_limited"
      (Plan.user_update_task ~now:3 ~task_id:(List.hd limited.tasks).task_id
         (patch ~status:Plan.Completed ())
         (Some limited))
  in
  assert_bool "time_limited auto-complete"
    (limited_complete.status = Plan.Complete);
  let resume_source =
    let draft = agent_plan ~session:"completion-resume" () in
    let finished =
      expect_ok "finish before activate"
        (Plan.update_task ~now:2 ~task_id:(List.hd draft.tasks).task_id
           (patch ~status:Plan.Completed ())
           (Some draft))
    in
    expect_ok "activate to complete"
      (Plan.update_plan ~reason:"test transition" ~now:3 Plan.Request_active
         (Some finished))
  in
  let unlocked =
    unlock_complete resume_source ~session:"completion-resume" ~now:4
  in
  let resumed =
    expect_ok "resume all-done"
      (Plan.apply_command ~session_id:"completion-resume" ~now:5 "resume"
         (Some unlocked))
  in
  assert_bool "resume all-done lands complete"
    ((Option.get resumed.plan).status = Plan.Complete);
  assert_bool "resume all-done notifies" (resumed.message = "Plan complete.");
  assert_bool "resume all-done no continuation" (not resumed.followup);
  let blocked_still =
    let draft = agent_plan ~session:"completion-block-tool" () in
    let active =
      expect_ok "activate block tool"
        (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
           (Some draft))
    in
    expect_ok "blocked unchanged"
      (Plan.update_plan ~reason:"test block" ~now:3 Plan.Request_blocked
         (Some active))
  in
  assert_bool "blocked stays blocked"
    (match blocked_still.status with Plan.Blocked _ -> true | _ -> false)

let complete_plan ?(session = "extension") () =
  let draft = agent_plan ~session () in
  let active =
    expect_ok "activate complete plan"
      (Plan.update_plan ~reason:"test transition" ~now:2 Plan.Request_active
         (Some draft))
  in
  let task = List.hd active.tasks in
  expect_ok "finish sole task auto-completes"
    (Plan.update_task ~now:3 ~task_id:task.task_id
       (patch ~status:Plan.Completed ())
       (Some active))

let test_extension_unlock () =
  let complete = complete_plan ~session:"extension" () in
  assert_bool "same-turn locked" (not complete.extension_unlocked);
  let same_turn_error =
    expect_error "same-turn create rejected"
      (Plan.create_task ~session_id:"extension" ~now:5 "follow-on"
         (Some complete))
  in
  assert_bool "same-turn error names turn boundary"
    (contains same_turn_error "after its turn ends");
  assert_bool "same-turn leaves status" (complete.status = Plan.Complete);
  let unlocked = unlock_complete complete ~session:"extension" ~now:5 in
  assert_bool "turn-end unlocks" unlocked.extension_unlocked;
  assert_bool "turn-end keeps complete" (unlocked.status = Plan.Complete);
  let presented = Plan.present Plan.Automation_enabled unlocked in
  assert_bool "get_plan exposes unlock" presented.extension_unlocked;
  let content_error =
    expect_error "complete content frozen"
      (Plan.update_task ~now:6 ~task_id:(List.hd unlocked.tasks).task_id
         (patch ~title:"rewrite" ())
         (Some unlocked))
  in
  assert_bool "content stays draft-only" (contains content_error "draft");
  let status_error =
    expect_error "complete status frozen"
      (Plan.update_task ~now:6 ~task_id:(List.hd unlocked.tasks).task_id
         (patch ~status:Plan.Pending ())
         (Some unlocked))
  in
  assert_bool "complete status rejection names remedy"
    (contains status_error "current status is complete"
    && contains status_error "/plan draft");
  let extended =
    expect_ok "extension batch"
      (Plan.create_tasks ~session_id:"extension" ~now:6
         [ creation ~id:"task-next" "next"; creation ~id:"task-after" "after" ]
         (Some unlocked))
  in
  assert_bool "extension reopens active" (extended.status = Plan.Active);
  assert_bool "extension clears unlock" (not extended.extension_unlocked);
  assert_bool "extension appends atomically" (List.length extended.tasks = 3);
  assert_bool "extension order"
    (List.map (fun (task : Plan.task) -> task.title) extended.tasks
    = [ "first task"; "next"; "after" ]);
  let complete_again =
    List.fold_left
      (fun plan (task : Plan.task) ->
        if task.status = Plan.Completed || task.status = Plan.Cancelled then
          plan
        else
          expect_ok "finish for reopen"
            (Plan.update_task ~now:7 ~task_id:task.task_id
               (patch ~status:Plan.Completed ())
               (Some plan)))
      extended extended.tasks
  in
  assert_bool "reopen auto-completes" (complete_again.status = Plan.Complete);
  let unlocked_again =
    unlock_complete complete_again ~session:"extension" ~now:9
  in
  let resumed =
    expect_ok "resume all-done lands complete"
      (Plan.apply_command ~session_id:"extension" ~now:10 "resume"
         (Some unlocked_again))
    |> fun result -> Option.get result.plan
  in
  assert_bool "resume all-done complete" (resumed.status = Plan.Complete);
  assert_bool "resume clears unlock" (not resumed.extension_unlocked);
  let unlocked_for_draft =
    unlock_complete resumed ~session:"extension" ~now:12
  in
  let drafted =
    expect_ok "draft clears unlock"
      (Plan.apply_command ~session_id:"extension" ~now:13 "draft"
         (Some unlocked_for_draft))
    |> fun result -> Option.get result.plan
  in
  assert_bool "draft clears unlock" (not drafted.extension_unlocked);
  let complete_for_text = complete_plan ~session:"extension-text" () in
  let unlocked_text =
    unlock_complete complete_for_text ~session:"extension-text" ~now:5
  in
  let appended =
    expect_ok "/plan text on complete"
      (Plan.apply_command ~session_id:"extension-text" ~now:6 "next wave"
         (Some unlocked_text))
  in
  let appended_plan = Option.get appended.plan in
  assert_bool "text reopen active" (appended_plan.status = Plan.Active);
  assert_bool "text clears unlock" (not appended_plan.extension_unlocked);
  assert_bool "text appends task" (List.length appended_plan.tasks = 2);
  let paused =
    expect_ok "pause sticky"
      (Plan.apply_command ~session_id:"extension-text" ~now:7 "pause"
         (Some appended_plan))
    |> fun result -> Option.get result.plan
  in
  let paused_append =
    expect_ok "append while paused"
      (Plan.apply_command ~session_id:"extension-text" ~now:8 "while paused"
         (Some paused))
  in
  assert_bool "paused stays paused"
    ((Option.get paused_append.plan).status = Plan.Paused);
  let blocked =
    expect_ok "block sticky"
      (Plan.update_plan ~reason:"test block" ~now:9 Plan.Request_blocked
         (Some
            ( expect_ok "resume to block"
                (Plan.apply_command ~session_id:"extension-text" ~now:9 "resume"
                   paused_append.plan)
            |> fun result -> Option.get result.plan )))
  in
  let blocked_append =
    expect_ok "append while blocked"
      (Plan.apply_command ~session_id:"extension-text" ~now:10 "while blocked"
         (Some blocked))
  in
  assert_bool "blocked stays blocked"
    (match (Option.get blocked_append.plan).status with
    | Plan.Blocked _ -> true
    | _ -> false);
  let unlocked_fork =
    unlock_complete
      (complete_plan ~session:"extension-fork" ())
      ~session:"extension-fork" ~now:5
  in
  let forked = Plan.fork ~session_id:"forked-extension" unlocked_fork in
  assert_bool "fork preserves unlock" forked.plan.extension_unlocked;
  assert_bool "fork keeps complete" (forked.plan.status = Plan.Complete)

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
      (Plan.apply_command ~session_id:"commands" ~now:2 "pause deployment"
         (Some plan))
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
      assert_bool "no objective"
        (not (contains continuation.content "objective")));
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
        ( expect_ok "pause continuation plan"
            (Plan.apply_command ~session_id:"continuation" ~now:2 "pause"
               (Some plan))
        |> fun result -> Option.get result.plan );
    ];
  assert_bool "child cap"
    (match
       Plan.plan_child_continuation ~plan:(Some plan)
         ~automation:Plan.Automation_enabled ~iterations:25 ~max_iterations:25
         ~latest_assistant_stop_reason:None
     with
    | Plan.Child_finalize { child_reason = Some "plan_continuation_limit"; _ }
      ->
        true
    | _ -> false)

let persisted_plan ?(status = "active") ?(tokens = 0.) ?(time = 0.)
    ?(limit = Shared.Null) ?(created = 1.) ?(updated = 1.) ?(tasks = None)
    ?blocks () =
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
  let fields =
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
  in
  Shared.Object
    (match blocks with
    | None -> fields
    | Some value -> ("blocks", value) :: fields)

let persisted_task ?(status = "pending") ?cancellation_reason ?(depends_on = [])
    id title =
  let fields =
    [
      ("taskId", Shared.String id);
      ("title", Shared.String title);
      ("description", Shared.Null);
      ("status", Shared.String status);
      ( "depends_on",
        Shared.Array
          (List.map (fun dependency -> Shared.String dependency) depends_on) );
      ("origin", Shared.String "agent");
    ]
  in
  Shared.Object
    (match cancellation_reason with
    | None -> fields
    | Some reason -> ("cancellationReason", Shared.String reason) :: fields)

let persisted_block ?(source = "agent") ?cleared_at ?cleared_by ?resolution
    ?(blocked_at = 2.) ?(reason = "Need input.") () =
  let fields =
    [
      ("blockedAt", Shared.Number blocked_at);
      ("reason", Shared.String reason);
      ("source", Shared.String source);
    ]
  in
  let fields =
    match cleared_at with
    | None -> fields
    | Some value -> ("clearedAt", Shared.Number value) :: fields
  in
  let fields =
    match cleared_by with
    | None -> fields
    | Some value -> ("clearedBy", Shared.String value) :: fields
  in
  let fields =
    match resolution with
    | None -> fields
    | Some value -> ("resolution", Shared.String value) :: fields
  in
  Shared.Object fields

let test_persistence () =
  let plan = agent_plan ~session:"codec" () in
  let decoded =
    expect_ok "round trip" (Plan.codec.decode (Plan.codec.encode (Some plan)))
    |> Option.get
  in
  assert_bool "round trip" (decoded.tasks = plan.tasks);
  assert_bool "round trip locked" (not decoded.extension_unlocked);
  let blocked =
    expect_ok "block history round trip source"
      (Plan.update_plan ~reason:"Waiting." ~now:2 Plan.Request_blocked
         (Some (active_plan ~session:"codec-block" ())))
  in
  let decoded_blocked =
    expect_ok "open block round trip"
      (Plan.codec.decode (Plan.codec.encode (Some blocked)))
    |> Option.get
  in
  assert_bool "open block round trip"
    (Plan.block_entries decoded_blocked = Plan.block_entries blocked);
  let cleared =
    expect_ok "clear block for round trip"
      (Plan.update_plan ~reason:"Ready." ~now:3 Plan.Request_active
         (Some blocked))
  in
  let decoded_cleared =
    expect_ok "closed block round trip"
      (Plan.codec.decode (Plan.codec.encode (Some cleared)))
    |> Option.get
  in
  assert_bool "closed block round trip"
    (Plan.block_entries decoded_cleared = Plan.block_entries cleared);
  let unlocked_complete =
    unlock_complete
      (complete_plan ~session:"codec-unlock" ())
      ~session:"codec-unlock" ~now:5
  in
  let decoded_unlocked =
    expect_ok "unlock round trip"
      (Plan.codec.decode (Plan.codec.encode (Some unlocked_complete)))
    |> Option.get
  in
  assert_bool "unlock round trip" decoded_unlocked.extension_unlocked;
  let absent_unlock =
    persisted_plan ~status:"complete"
      ~tasks:
        (Some
           (Shared.Array
              [ persisted_task ~status:"completed" "done-task" "Done" ]))
      ()
  in
  let decoded_absent =
    expect_ok "absent unlock field" (Plan.codec.decode absent_unlock)
    |> Option.get
  in
  assert_bool "absent field locks" (not decoded_absent.extension_unlocked);
  (* ^plan-ax49: missing blocks defaults empty for an otherwise valid plan. *)
  assert_bool "missing blocks decodes empty"
    (Plan.block_entries decoded_absent = []);
  ignore
    (expect_error "missing blocks rejects blocked status"
       (Plan.codec.decode (persisted_plan ~status:"blocked" ())));
  ignore
    (expect_error "empty tasks"
       (Plan.codec.decode (persisted_plan ~tasks:(Some (Shared.Array [])) ())));
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
  (* ^plan-ezxt: persistence enforces cancellationReason/status coupling. *)
  let cancelled_state =
    persisted_plan ~status:"complete"
      ~tasks:
        (Some
           (Shared.Array
              [
                persisted_task ~status:"cancelled"
                  ~cancellation_reason:"Cancelled by the user." "cancelled-task"
                  "Cancelled";
              ]))
      ()
  in
  let decoded_cancelled =
    expect_ok "cancelled task reason decodes"
      (Plan.codec.decode cancelled_state)
    |> Option.get
  in
  assert_bool "cancelled task reason persists"
    ((List.hd decoded_cancelled.tasks).cancellation_reason
   = Some "Cancelled by the user.");
  ignore
    (expect_error "cancelled task missing reason"
       (Plan.codec.decode
          (persisted_plan ~status:"complete"
             ~tasks:
               (Some
                  (Shared.Array
                     [
                       persisted_task ~status:"cancelled" "cancelled-task"
                         "Cancelled";
                     ]))
             ())));
  ignore
    (expect_error "cancelled task empty reason"
       (Plan.codec.decode
          (persisted_plan ~status:"complete"
             ~tasks:
               (Some
                  (Shared.Array
                     [
                       persisted_task ~status:"cancelled"
                         ~cancellation_reason:"  " "cancelled-task" "Cancelled";
                     ]))
             ())));
  ignore
    (expect_error "non-cancelled task has reason"
       (Plan.codec.decode
          (persisted_plan
             ~tasks:
               (Some
                  (Shared.Array
                     [
                       persisted_task ~cancellation_reason:"Unexpected."
                         "pending-task" "Pending";
                     ]))
             ())));
  (* ^plan-909m: malformed block histories are rejected at decode. *)
  let block_array entries = Shared.Array entries in
  ignore
    (expect_error "empty block reason"
       (Plan.codec.decode
          (persisted_plan ~status:"blocked"
             ~blocks:(block_array [ persisted_block ~reason:"  " () ])
             ())));
  ignore
    (expect_error "block reason surrounding whitespace"
       (Plan.codec.decode
          (persisted_plan ~status:"blocked"
             ~blocks:
               (block_array [ persisted_block ~reason:" Need input. " () ])
             ())));
  ignore
    (expect_error "block resolution surrounding whitespace"
       (Plan.codec.decode
          (persisted_plan
             ~blocks:
               (block_array
                  [
                    persisted_block ~cleared_at:3. ~cleared_by:"user"
                      ~resolution:" Fixed. " ();
                  ])
             ())));
  ignore
    (expect_error "unknown block source"
       (Plan.codec.decode
          (persisted_plan ~status:"blocked"
             ~blocks:(block_array [ persisted_block ~source:"host" () ])
             ())));
  ignore
    (expect_error "unknown block clearedBy"
       (Plan.codec.decode
          (persisted_plan
             ~blocks:
               (block_array
                  [
                    persisted_block ~cleared_at:3. ~cleared_by:"system"
                      ~resolution:"Fixed." ();
                  ])
             ())));
  ignore
    (expect_error "block clearing precedes opening"
       (Plan.codec.decode
          (persisted_plan
             ~blocks:
               (block_array
                  [
                    persisted_block ~blocked_at:3. ~cleared_at:2.
                      ~cleared_by:"user" ~resolution:"Fixed." ();
                  ])
             ())));
  ignore
    (expect_error "cleared block lacks resolution"
       (Plan.codec.decode
          (persisted_plan
             ~blocks:
               (block_array
                  [ persisted_block ~cleared_at:3. ~cleared_by:"user" () ])
             ())));
  ignore
    (expect_error "multiple open blocks"
       (Plan.codec.decode
          (persisted_plan ~status:"blocked"
             ~blocks:(block_array [ persisted_block (); persisted_block () ])
             ())));
  ignore
    (expect_error "open block requires blocked status"
       (Plan.codec.decode
          (persisted_plan ~blocks:(block_array [ persisted_block () ]) ())));
  let legacy =
    match persisted_plan () with
    | Shared.Object fields ->
        Shared.Object (("tokenBudget", Shared.Number 1.) :: fields)
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
      ~latest_usage:(Plan.latest_assistant_usage branch)
      (Some plan)
  in
  let final = Option.get accounted.plan in
  assert_bool "terminal accounted first"
    (final.status = Plan.Complete
    && final.tokens_used = 22
    && final.time_used_seconds = 4);
  assert_bool "terminal remains locked until natural turn-end"
    (not final.extension_unlocked);
  let unlocked_turn =
    Plan.account_turn_end ~session_id:"accounting" ~now:4 ~active_time_seconds:4
      ~last_accounting_key:accounted.accounting_key
      ~latest_usage:(Plan.latest_assistant_usage branch)
      accounted.plan
  in
  let unlocked = Option.get unlocked_turn.plan in
  assert_bool "natural turn-end unlocks complete" unlocked.extension_unlocked;
  assert_bool "unlock does not re-account tokens" (unlocked.tokens_used = 22);
  assert_bool "unlock keeps accounting key"
    (unlocked_turn.accounting_key = accounted.accounting_key);
  let duplicate =
    Plan.account_turn_end ~session_id:"accounting" ~now:5 ~active_time_seconds:4
      ~last_accounting_key:unlocked_turn.accounting_key
      ~latest_usage:(Plan.latest_assistant_usage branch)
      unlocked_turn.plan
  in
  assert_bool "exactly once after unlock" (not duplicate.changed)

let test_task_manager_commands () =
  let created =
    expect_ok "task add creates draft"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:1
         "task add {\"title\":\"first\",\"description\":\"body\"}" None)
  in
  let plan = Option.get created.plan in
  assert_bool "modal birth is draft" (plan.status = Plan.Draft);
  assert_bool "modal task is user" ((List.hd plan.tasks).origin = Plan.User);
  assert_bool "modal add has no agent submit"
    (created.submit_user_message = None);
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
         ("task advance " ^ task_id)
         edited.plan)
  in
  assert_bool "advanced in progress"
    ((List.hd (Option.get advanced.plan).tasks).status = Plan.In_progress);
  let completed =
    expect_ok "task advance complete"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:4
         ("task advance " ^ task_id)
         advanced.plan)
  in
  assert_bool "advanced completed"
    ((List.hd (Option.get completed.plan).tasks).status = Plan.Completed);
  ignore
    (expect_error "terminal advance rejected"
       (Plan.apply_command ~session_id:"tasks-modal" ~now:5
          ("task advance " ^ task_id)
          completed.plan));
  let second =
    expect_ok "task add second"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:6
         "task add {\"title\":\"second\"}" completed.plan)
  in
  let second_id = (List.nth (Option.get second.plan).tasks 1).task_id in
  let cancelled =
    expect_ok "task cancel"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:7
         ("task cancel " ^ second_id)
         second.plan)
  in
  let cancelled_task = List.nth (Option.get cancelled.plan).tasks 1 in
  assert_bool "cancelled" (cancelled_task.status = Plan.Cancelled);
  assert_bool "user command cancellation reason"
    (cancelled_task.cancellation_reason
   = Some "Cancelled by the user through /tasks or /plan task cancel.");
  let deleted =
    expect_ok "task delete"
      (Plan.apply_command ~session_id:"tasks-modal" ~now:8
         ("task delete " ^ second_id)
         cancelled.plan)
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
  test_agent_block_lifecycle ();
  test_system_and_user_block_history ();
  test_lifecycle_rejection_messages ();
  test_user_task_protection ();
  test_agent_task_cancellation_reason ();
  test_block_close_invariants ();
  test_dependencies_and_atomic_batch ();
  test_completion_invariant ();
  test_extension_unlock ();
  test_commands ();
  test_task_manager_commands ();
  test_continuation ();
  test_persistence ();
  test_accounting_and_time ()
