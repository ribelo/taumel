type git_delta = {
  added : int;
  removed : int;
}

type snapshot = {
  cwd : string;
  branch : string;
  filesystem_mode : string;
  network_mode : string;
  no_sandbox : bool;
  git_delta : git_delta;
  provider : string;
  model : string;
  thinking : string;
  total_cost : float;
  context_percent : float;
  context_window : float;
}

val empty_git_delta : git_delta
val parse_git_numstat : string -> git_delta
val count_in_progress_issues : 'a list -> int
val provider_label : string -> string
val format_token_window : float -> string
val render_line : colorize:(string -> string -> string) -> width:int -> snapshot -> string
