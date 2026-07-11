type filesystem_mode =
  | Read_only
  | Workspace_write
  | Danger_full_access

type network_mode =
  | Network_disabled
  | Network_enabled

type sandbox_permissions =
  | Use_default
  | Require_escalated of {
      justification : string;
      prefix_rule : string list option;
    }

type approval_policy =
  | Never
  | On_request
  | On_failure
  | Untrusted

type config = {
  filesystem_mode : filesystem_mode;
  workspace_roots : string list;
  network_mode : network_mode;
  approval_policy : approval_policy;
  no_sandbox : bool;
  isolated_child : bool;
}

type decision =
  | Allow
  | Requires_approval of string
  | Deny of string

type path_access =
  | Read
  | Write
  | Delete

type resolved_mutation_path = { requested_path : string; resolved_path : string }

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
  | Approval_granted
  | Approval_denied of {
      message : string;
      details : Shared.json;
    }

type approval_prompt_outcome =
  | Approval_approved
  | Approval_denied_by_user
  | Approval_timed_out
  | Approval_unavailable
  | Approval_interrupted

type approval_prompt_plan =
  | Approval_prompt_unavailable
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
  | Stdin_call of stdin_host_call
  | Stdin_result of {
      message : string;
      details : Shared.json;
    }

type exec_host_facts = {
  platform : string;
  temp_roots : string list;
  system_ro_paths : string list;
  home_mount : string;
  workspace_roots : string list;
  workspace_metadata_listings : workspace_metadata_listing list;
}

and workspace_metadata_listing = {
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
  | Network_failure
  | Filesystem_failure

type failure_diagnostic = {
  kind : failure_kind;
  message : string;
  evidence : string;
  filesystem_mode : filesystem_mode;
  network_mode : network_mode;
}
