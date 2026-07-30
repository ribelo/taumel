include Plan_core

type command_plan = Plan_commands.command_plan = {
  plan : store;
  automation : automation option;
  message : string;
  followup : bool;
  submit_user_message : string option;
  changed : bool;
}

let command_usage = Plan_commands.command_usage

let parse_duration = Plan_commands.parse_duration

let parse_time_limit_args = Plan_commands.parse_time_limit_args

let split_command = Plan_commands.split_command

let apply_command = Plan_commands.apply_command

type continuation_facts = Plan_continuation.continuation_facts = {
  plan : store;
  automation : automation;
  host_idle : bool;
  has_pending_messages : bool;
  retrying : bool;
  compacting : bool;
  latest_assistant_stop_reason : string option;
}

type continuation = Plan_continuation.continuation = {
  custom_type : string;
  content : string;
  metadata : presentation;
  display : bool;
  trigger_turn : bool;
  deliver_as : string;
}

type continuation_plan = Plan_continuation.continuation_plan =
  | No_continuation
  | Send_continuation of continuation

let continuation_followup_prompt =
  Plan_continuation.continuation_followup_prompt

let initial_followup_prompt = Plan_continuation.initial_followup_prompt

let should_continue = Plan_continuation.should_continue

let plan_continuation = Plan_continuation.plan_continuation

type child_finalize = Plan_continuation.child_finalize = {
  child_status : string;
  child_reason : string option;
}

type child_continuation_plan = Plan_continuation.child_continuation_plan =
  | Child_continue of continuation
  | Child_finalize of child_finalize

let child_continuation_default_max =
  Plan_continuation.child_continuation_default_max

let plan_child_continuation = Plan_continuation.plan_child_continuation

let continuation_prompt = Plan_continuation.continuation_prompt

let time_limit_prompt = Plan_continuation.time_limit_prompt

let to_json (plan : t) =
  Plan_codec.encode ~plan_id:plan.plan_id ~session_id:plan.session_id
    ~status:plan.status ~tasks:plan.tasks ~blocks:plan.blocks
    ~tokens_used:plan.tokens_used ~time_used_seconds:plan.time_used_seconds
    ~time_limit_seconds:plan.time_limit_seconds
    ~extension_unlocked:plan.extension_unlocked ~created_at:plan.created_at
    ~updated_at:plan.updated_at

let of_json json =
  Result.map
    (Option.map (fun (decoded : Plan_codec.decoded) ->
         remember_task_ids decoded.session_id
           (List.map (fun task -> task.task_id) decoded.tasks);
         {
           plan_id = decoded.plan_id;
           session_id = decoded.session_id;
           status = decoded.status;
           tasks = decoded.tasks;
           blocks = decoded.blocks;
           tokens_used = decoded.tokens_used;
           time_used_seconds = decoded.time_used_seconds;
           time_limit_seconds = decoded.time_limit_seconds;
           extension_unlocked = decoded.extension_unlocked;
           created_at = decoded.created_at;
           updated_at = decoded.updated_at;
         }))
    (Plan_codec.decode json)

let codec =
  {
    Shared.encode = (function None -> Shared.Null | Some plan -> to_json plan);
    decode = of_json;
  }

let plan_entry_key = "taumel.plan"

let automation_entry_key = "taumel.plan_automation"

let continuation_custom_type = "taumel.plan.continue"

let get_plan_description = Plan_prompt.get_plan_description

let get_plan_prompt_snippet = Plan_prompt.get_plan_prompt_snippet

let create_task_description = Plan_prompt.create_task_description

let create_task_id_description = Plan_prompt.create_task_id_description

let create_task_title_description = Plan_prompt.create_task_title_description

let create_task_description_description =
  Plan_prompt.create_task_description_description

let create_task_depends_on_description =
  Plan_prompt.create_task_depends_on_description

let create_task_prompt_snippet = Plan_prompt.create_task_prompt_snippet

let update_task_description = Plan_prompt.update_task_description

let update_task_prompt_snippet = Plan_prompt.update_task_prompt_snippet

let update_plan_description = Plan_prompt.update_plan_description

let update_plan_status_description = Plan_prompt.update_plan_status_description

let update_plan_reason_description = Plan_prompt.update_plan_reason_description

let update_plan_prompt_snippet = Plan_prompt.update_plan_prompt_snippet

let tool_specs =
  [
    { Tool_gateway.name = "get_plan"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "create_task"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "update_task"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "update_plan"; effect_kind = Tool_gateway.Mutate };
  ]
