type git_delta = {
  added : int;
  removed : int;
}

type activity = {
  running_agents : int;
  orphaned_agents : int;
  single_agent_description : string option;
  live_execs : int;
  single_exec_command : string option;
}

type snapshot = {
  cwd : string;
  branch : string;
  filesystem_mode : string;
  network_mode : string;
  approval_policy : string;
  no_sandbox : bool;
  git_delta : git_delta;
  git_repo : bool;
  git_error : bool;
  provider : string;
  model : string;
  thinking : string;
  total_cost : float;
  context_percent : float;
  context_window : float;
  plan : Plan.presentation option;
  activity : activity;
}

val empty_git_delta : git_delta
val empty_activity : activity
val parse_git_numstat : string -> git_delta
val count_in_progress_issues : 'a list -> int
val provider_label : string -> string
val format_token_window : float -> string
val render_line : colorize:(string -> string -> string) -> width:int -> snapshot -> string
val render_lines : colorize:(string -> string -> string) -> width:int -> snapshot -> string list
