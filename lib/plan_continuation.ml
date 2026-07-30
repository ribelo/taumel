open Plan_core

type continuation_facts = {
  plan : store;
  automation : automation;
  host_idle : bool;
  has_pending_messages : bool;
  retrying : bool;
  compacting : bool;
  latest_assistant_stop_reason : string option;
}

type continuation = {
  custom_type : string;
  content : string;
  metadata : presentation;
  display : bool;
  trigger_turn : bool;
  deliver_as : string;
}

type continuation_plan = No_continuation | Send_continuation of continuation

let continuation_followup_prompt (plan : t) =
  Plan_prompt.continuation_followup
    ~unfinished_tasks_json:(Plan_task.unfinished_json plan.tasks)
    ~tokens_used:plan.tokens_used ~time_used_seconds:plan.time_used_seconds
    ~time_limit_seconds:plan.time_limit_seconds

let initial_followup_prompt = continuation_followup_prompt

let latest_stop_reason_blocks = function
  | Some "error" | Some "aborted" -> true
  | _ -> false

let should_continue facts =
  match facts.plan with
  | Some plan ->
      plan.status = Active
      && facts.automation = Automation_enabled
      && facts.host_idle
      && (not facts.has_pending_messages)
      && (not facts.retrying) && (not facts.compacting)
      && not (latest_stop_reason_blocks facts.latest_assistant_stop_reason)
  | None -> false

let continuation_for_plan (plan : t) =
  {
    custom_type = "taumel.plan.continue";
    content = continuation_followup_prompt plan;
    metadata = present Automation_enabled plan;
    display = true;
    trigger_turn = true;
    deliver_as = "followUp";
  }

let plan_continuation ~initial:_ facts =
  match facts.plan with
  | Some plan when should_continue facts ->
      Send_continuation (continuation_for_plan plan)
  | _ -> No_continuation

type child_finalize = { child_status : string; child_reason : string option }

type child_continuation_plan =
  | Child_continue of continuation
  | Child_finalize of child_finalize

let child_continuation_default_max = 25

let child_done status reason =
  Child_finalize { child_status = status; child_reason = reason }

let plan_child_continuation ~plan ~automation ~iterations ~max_iterations
    ~latest_assistant_stop_reason =
  let facts =
    {
      plan;
      automation;
      host_idle = true;
      has_pending_messages = false;
      retrying = false;
      compacting = false;
      latest_assistant_stop_reason;
    }
  in
  match plan with
  | None -> child_done "completed" None
  | Some current -> (
      match current.status with
      | Complete -> child_done "completed" None
      | Blocked _ -> child_done "failed" (Some "plan_blocked")
      | _ when iterations >= max_iterations ->
          child_done "failed" (Some "plan_continuation_limit")
      | _ -> (
          match latest_assistant_stop_reason with
          | Some "aborted" -> child_done "cancelled" (Some "aborted")
          | Some "error" -> child_done "failed" (Some "error")
          | _ when should_continue facts ->
              Child_continue (continuation_for_plan current)
          | _ -> child_done "suspended" (Some "plan_paused")))

let continuation_prompt (plan : t) =
  Plan_prompt.continuation_state
    ~status:(status_to_string plan.status)
    ~tokens_used:plan.tokens_used ~time_used_seconds:plan.time_used_seconds
    ~time_limit_seconds:plan.time_limit_seconds

let time_limit_prompt (plan : t) =
  Plan_prompt.time_limit ~tokens_used:plan.tokens_used
    ~time_used_seconds:plan.time_used_seconds
