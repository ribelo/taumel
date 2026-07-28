type status = Plan_status.t =
  | Draft
  | Active
  | Paused
  | Blocked
  | Time_limited
  | Complete

type task_status = Plan_task.status =
  | Pending
  | In_progress
  | Completed
  | Cancelled

type task_origin = Plan_task.origin = User | Agent

type task = Plan_task.t = {
  task_id : string;
  title : string;
  description : string option;
  status : task_status;
  depends_on : string list;
  origin : task_origin;
}

type task_creation = Plan_task.creation = {
  id : string option;
  title : string;
  description : string option;
  depends_on : string list;
}

type description_update = Plan_task.description_update =
  | Keep_description
  | Set_description of string
  | Clear_description

type task_update = Plan_task.update = {
  title : string option;
  description : description_update;
  status : task_status option;
  depends_on : string list option;
}

type t = private {
  plan_id : string;
  session_id : string;
  status : status;
  tasks : task list;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
  extension_unlocked : bool;
  created_at : int;
  updated_at : int;
}

type store = t option
type automation = Automation_enabled | Automation_interrupted

type token_usage = Plan_accounting.token_usage = {
  input_tokens : int;
  cached_input_tokens : int;
  output_tokens : int;
}

type turn_clock = Plan_accounting.turn_clock = {
  turn_started_at_ms : int option;
  pause_depth : int;
  current_pause_started_at_ms : int option;
  paused_accumulated_ms : int;
}

type presentation = {
  status : status;
  automation : automation;
  tasks : task list;
  completed_tasks : int;
  total_tasks : int;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
  extension_unlocked : bool;
  plan_id : string;
  session_id : string;
}

val status_to_string : status -> string
val status_label : status -> string
val status_of_string : string -> status option
val content_editable : status -> bool
val status_editable : status -> bool
val terminal : status -> bool
val unfinished : status -> bool
val task_status_to_string : task_status -> string
val task_status_of_string : string -> task_status option
val task_origin_to_string : task_origin -> string
val task_origin_of_string : string -> task_origin option
val no_task_update : task_update
val completed_task_count : task list -> int
val present : automation -> t -> presentation

val create_tasks :
  session_id:string ->
  now:int ->
  task_creation list ->
  store ->
  (t, string) result

val create_task :
  ?id:string ->
  ?description:string ->
  ?depends_on:string list ->
  session_id:string ->
  now:int ->
  string ->
  store ->
  (t, string) result

val add_user_task :
  ?id:string ->
  ?description:string ->
  ?depends_on:string list ->
  ?time_limit_seconds:int ->
  ?create_status:status ->
  session_id:string ->
  now:int ->
  string ->
  store ->
  (t, string) result

val update_task :
  now:int -> task_id:string -> task_update -> store -> (t, string) result

val user_update_task :
  now:int -> task_id:string -> task_update -> store -> (t, string) result

val update_task_status :
  now:int -> task_id:string -> task_status -> store -> (t, string) result

val user_advance_task :
  now:int -> task_id:string -> store -> (t, string) result

val user_cancel_task :
  now:int -> task_id:string -> store -> (t, string) result

val user_delete_task :
  now:int -> task_id:string -> store -> (t, string) result

val unfinished_tasks : t -> task list
val completion_gate : t -> (unit, task list) result
val update_plan : now:int -> status -> store -> (t, string) result
val final_unrecoverable_error : now:int -> store -> store
val get : store -> store

type forked = { plan : t; automation : automation }
val rebind_for_fork : session_id:string -> t -> t
val fork : session_id:string -> t -> forked

val token_delta : token_usage -> int
val token_usage_of_json : Shared.json -> token_usage option
val message_usage : Shared.json -> token_usage option
val latest_assistant_usage : Shared.json list -> (int * token_usage) option
val account_turn_key :
  session_id:string -> branch_length:int -> token_usage -> string
val empty_clock : turn_clock
val start_turn_clock : now_ms:int -> turn_clock -> turn_clock
val pause_clock_start : now_ms:int -> turn_clock -> turn_clock
val pause_clock_end : now_ms:int -> turn_clock -> turn_clock
val finish_turn_clock : now_ms:int -> turn_clock -> int * turn_clock
val time_limit_reached : t -> int -> bool
val account_usage :
  now:int -> time_delta_seconds:int -> token_usage -> t -> t

type turn_accounting_result = {
  plan : store;
  accounting_key : string option;
  changed : bool;
}

type pending_terminal_status = Pending_complete | Pending_blocked

val account_turn_end :
  ?pending_terminal_status:pending_terminal_status ->
  session_id:string ->
  now:int ->
  active_time_seconds:int ->
  last_accounting_key:string option ->
  latest_usage:(int * token_usage) option ->
  store ->
  turn_accounting_result

val automation_to_string : automation -> string
val automation_of_string : string -> automation option
val automation_requires_user_input : automation -> bool
val automation_to_json : automation -> Shared.json
val automation_of_json : Shared.json -> (automation, string) result
val automation_codec : automation Shared.codec
val format_duration : int -> string
val time_usage : t -> string
val summary : store -> string

type command_plan = {
  plan : store;
  automation : automation option;
  message : string;
  followup : bool;
  submit_user_message : string option;
  changed : bool;
}

val command_usage : string
val parse_duration : string -> (int, string) result
val parse_time_limit_args :
  string -> (string * int option option, string) result
val split_command : string -> string * string
val apply_command :
  ?automation:automation ->
  session_id:string ->
  now:int ->
  string ->
  store ->
  (command_plan, string) result

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
val continuation_followup_prompt : t -> string
val initial_followup_prompt : t -> string
val should_continue : continuation_facts -> bool
val plan_continuation : initial:bool -> continuation_facts -> continuation_plan

type child_finalize = { child_status : string; child_reason : string option }
type child_continuation_plan =
  | Child_continue of continuation
  | Child_finalize of child_finalize

val child_continuation_default_max : int
val plan_child_continuation :
  plan:store ->
  automation:automation ->
  iterations:int ->
  max_iterations:int ->
  latest_assistant_stop_reason:string option ->
  child_continuation_plan

val continuation_prompt : t -> string
val time_limit_prompt : t -> string
val to_json : t -> Shared.json
val of_json : Shared.json -> (store, string) result
val codec : store Shared.codec
val plan_entry_key : string
val automation_entry_key : string
val continuation_custom_type : string
val get_plan_description : string
val get_plan_prompt_snippet : string
val create_task_description : string
val create_task_id_description : string
val create_task_title_description : string
val create_task_description_description : string
val create_task_depends_on_description : string
val create_task_prompt_snippet : string
val update_task_description : string
val update_task_prompt_snippet : string
val update_plan_description : string
val update_plan_status_description : string
val update_plan_prompt_snippet : string
val tool_specs : Tool_gateway.spec list
