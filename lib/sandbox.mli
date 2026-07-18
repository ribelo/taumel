module String_set = Shared.String_set
type filesystem_mode =
    Read_only
  | Workspace_write
  | Danger_full_access
type network_mode =
    Network_disabled
  | Network_enabled
type sandbox_permissions =
    Use_default
  | Require_escalated of { justification : string;
      prefix_rule : string list option;
    }
type approval_policy =
    Never
  | On_request
  | On_failure
  | Untrusted
type config = private {
  filesystem_mode : filesystem_mode;
  workspace_roots : string list;
  network_mode : network_mode;
  approval_policy : approval_policy;
  no_sandbox : bool;
  isolated_child : bool;
}
type decision =
    Allow
  | Requires_approval of string
  | Deny of string
type path_access = Read | Write | Delete
type resolved_mutation_path = {
  requested_path : string;
  resolved_path : string;
}
type exec_request = {
  cmd : string;
  workdir : string option;
  sandbox_permissions : sandbox_permissions;
}
type exec_result = {
  code : int;
  stdout : string;
  stderr : string;
}
type exec_runner = exec_request -> (exec_result, string) result
type approval_prompt = {
  title : string;
  prompt : string;
  timeout_ms : int;
}
type approval_outcome =
    Approval_granted
  | Approval_denied of { message : string; details : Shared.json; }
type approval_prompt_outcome =
    Approval_approved
  | Approval_denied_by_user
  | Approval_timed_out
  | Approval_unavailable
  | Approval_interrupted
type approval_prompt_plan =
    Approval_prompt_unavailable
  | Approval_prompt_confirm of approval_prompt
type stdin_request = {
  session_id : int;
  chars : string;
}
type stdin_writer = stdin_request -> (unit, string) result
type stdin_host_call = {
  request : stdin_request;
  yield_time_ms : float option;
}
type stdin_host_plan =
    Stdin_call of stdin_host_call
  | Stdin_result of { message : string; details : Shared.json; }
type exec_host_facts = {
  platform : string;
  temp_roots : string list;
  system_ro_paths : string list;
  home_mount : string;
  workspace_roots : string list;
  authorization_cwd : string;
  workspace_metadata_listings : workspace_metadata_listing list;
}
and workspace_metadata_listing =
  {
  metadata_dir : string;
  path : string;
  children : string list option;
}
type exec_invocation = {
  command : string;
  args : string list;
  sandboxed : bool;
}
type exec_host_options = {
  cmd : string;
  cwd : string;
  shell : string;
  timeout_ms : float option;
  yield_time_ms : float option;
  tty : bool;
}
type exec_host_call = {
  invocation : exec_invocation;
  cwd : string;
  timeout_ms : float option;
  yield_time_ms : float option;
  tty : bool;
  escalated : bool;
}
type failure_kind =
    Network_failure
  | Filesystem_failure
type failure_diagnostic = {
  kind : failure_kind;
  message : string;
  evidence : string;
  filesystem_mode : filesystem_mode;
  network_mode : network_mode;
}
val filesystem_mode_to_string : filesystem_mode -> string
val filesystem_mode_of_string : string -> filesystem_mode option
val filesystem_mode_of_profile :
  Capability_profile.sandbox_preset -> filesystem_mode
val approval_policy_of_profile :
  Capability_profile.approval_policy -> approval_policy
val validated_config : filesystem_mode:filesystem_mode -> workspace_roots:string list -> network_mode:network_mode -> approval_policy:approval_policy -> no_sandbox:bool -> isolated_child:bool -> (config, string) result
val config_of_profile :
  ?workspace_roots:string list ->
  ?network_mode:network_mode ->
  ?no_sandbox:bool ->
  ?isolated_child:bool -> Capability_profile.t -> (config, string) result
val fail_closed_config : workspace_roots:string list -> isolated_child:bool -> config
val split_path : string -> string list
val normalize_path : string -> string
val path_within : root:string -> string -> bool
val workspace_contains : config -> string -> bool
val protected_workspace_dir_names : string list
val join_path : string -> string -> string
val is_absolute_path : string -> bool
val resolve_workspace_path : config -> string -> string
val path_starts_with_dir : dir:string -> string -> bool
val is_protected_workspace_metadata_path : config -> string -> bool
val requires_resolved_workspace_mutation_validation : config -> bool
val policy_path :
  config -> ?auth_path:string -> string -> (string, string) result
val policy_roots : config -> ?auth_roots:string list -> unit -> string list
val workspace_contains_roots : roots:string list -> string -> bool
val is_protected_path_under : roots:string list -> string -> bool
val authorization_resolution_denied : string -> string -> decision
val authorization_path_message :
  string -> requested:string -> resolved:string -> string
val validate_resolved_workspace_mutation_paths :
  workspace_roots:string list ->
  resolved_mutation_path list -> (unit, string) result
val authorize_path :
  ?auth_path:string ->
  ?auth_roots:string list -> config -> path_access -> string -> decision
val authorize_paths :
  ?auth_paths:string list ->
  ?auth_roots:string list -> config -> path_access -> string list -> decision
val approval_decision : config -> string -> decision
val approval_policy_to_codex_string : approval_policy -> string
val reject_exec_escalation_message : approval_policy -> string
val authorize_mutation_path :
  ?approved:bool ->
  ?auth_path:string ->
  ?auth_roots:string list -> config -> path_access -> string -> decision
val resolve_mutation_path : ?auth_path:string -> config -> string -> string
val authorize_effect :
  config -> Tool_gateway.effect_kind -> (unit, string) result
val decision_rank : decision -> int
val strictest_decision : decision -> decision -> decision
val exec_policy_decision :
  ?message:string -> config -> Exec_policy.decision -> decision
val authorize_exec :
  ?policy_decision:Exec_policy.decision ->
  ?policy_message:string -> config -> exec_request -> decision
val exec_command :
  config ->
  (exec_request -> ('a, string) result) ->
  exec_request -> ('a, string) result
val write_stdin : 'a -> ('b -> 'c) -> 'b -> 'c
val write_stdin_success_message : string
val write_stdin_unavailable_message : string
val write_stdin_invalid_session_message : string
val apply_patch_success_message : string
val write_stdin_error_details : ?unavailable:bool -> string -> Shared.json
val plan_write_stdin_host_call :
  host_available:bool ->
  ?yield_time_ms:float -> stdin_request -> stdin_host_plan
val lowercase : string -> string
val string_contains : string -> string -> bool
val contains_any : string list -> string -> bool
val first_matching_line : string list -> string -> string option
val failure_diagnostic :
  filesystem_mode:filesystem_mode ->
  network_mode:network_mode ->
  sandboxed:bool ->
  exit_code:int ->
  stdout:string -> stderr:string -> failure_diagnostic option
val failure_kind_to_string : failure_kind -> string
val network_mode_to_string : network_mode -> string
val system_ro_path_candidates : string list
val temp_root_candidates :
  tmp_dir:string -> env_tmp_dir:string -> string list
val plan_exec_invocation :
  config ->
  exec_host_facts ->
  shell:string ->
  shell_args:string list ->
  force_unsandboxed:bool ->
  (exec_invocation, string) result
val exec_shell_args : cmd:string -> string list
val plan_exec_host_call :
  config ->
  exec_host_facts ->
  exec_host_options ->
  force_unsandboxed:bool ->
  (exec_host_call, string) result
val failure_diagnostic_to_json : failure_diagnostic -> Shared.json
val exec_base_text : exec_result -> string
val render_exec_result :
  ?diagnostic:failure_diagnostic -> exec_result -> string
val exec_result_details :
  sandboxed:bool ->
  escalated:bool ->
  ?diagnostic:failure_diagnostic -> exec_result -> Shared.json
val exec_approval_prompt : cmd:string -> string -> approval_prompt
val plan_exec_approval_prompt :
  ui_available:bool -> approval_prompt -> approval_prompt_plan
val approval_prompt_outcome_to_string : approval_prompt_outcome -> string
val approval_prompt_outcome_of_string :
  string -> approval_prompt_outcome option
val approval_denial_message : approval_prompt_outcome -> string
val exec_approval_outcome :
  outcome:approval_prompt_outcome -> approval_outcome
val filesystem_approval_prompt :
  tool:string -> path:string -> approval_prompt
module Patch = Sandbox_patch
val authorize_patch :
  ?approved:bool ->
  ?auth_paths:(string * string) list ->
  ?auth_roots:string list -> config -> Patch.hunk list -> decision
val apply_patch_to_map :
  config ->
  string Patch.String_map.t ->
  string -> (string Patch.String_map.t, string) result
type edit_replacement = { old_text : string; new_text : string; }
type edit_match = {
  edit_index : int;
  match_index : int;
  match_length : int;
  replacement : string;
}
val utf8_bom : string
val starts_with : prefix:string -> string -> bool
val normalize_to_lf : string -> string
val contains_crlf : string -> bool
val restore_line_endings : string -> string -> string
val find_substring_occurrences : string -> string -> int list
val apply_edits :
  display_path:string ->
  string -> edit_replacement list -> (string, string) result
val canonical_tool_specs : Tool_gateway.spec list
