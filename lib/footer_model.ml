type git_delta = {
  added : int;
  removed : int;
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
  goal : Goal.presentation option;
}

let empty_git_delta = { added = 0; removed = 0 }

let parse_int_opt value =
  try Some (int_of_string value) with Failure _ -> None

let parse_git_numstat output =
  let added = ref 0 in
  let removed = ref 0 in
  let add_line line =
    match String.split_on_char '\t' (String.trim line) with
    | raw_added :: raw_removed :: _ when raw_added <> "-" && raw_removed <> "-"
      -> (
        match (parse_int_opt raw_added, parse_int_opt raw_removed) with
        | Some parsed_added, Some parsed_removed ->
            added := !added + parsed_added;
            removed := !removed + parsed_removed
        | _ -> ())
    | _ -> ()
  in
  List.iter add_line (String.split_on_char '\n' output);
  { added = !added; removed = !removed }

let count_in_progress_issues _issues = 0

let provider_label = function
  | "" -> ""
  | "google-gemini-cli" -> "gemini-cli"
  | "openai-codex" -> "codex"
  | provider -> provider

let format_token_window tokens =
  let rounded = int_of_float (Float.round tokens) in
  if rounded < 1000 then string_of_int rounded
  else if rounded mod 1000 = 0 then Printf.sprintf "%dk" (rounded / 1000)
  else
    let value = float_of_int rounded /. 1000.0 in
    let rendered = Printf.sprintf "%.1fk" value in
    match String.ends_with ~suffix:".0k" rendered with
    | true ->
        String.sub rendered 0 (String.length rendered - 3) ^ "k"
    | false -> rendered

let utf8_char_len byte =
  let code = Char.code byte in
  if code land 0x80 = 0 then 1
  else if code land 0xE0 = 0xC0 then 2
  else if code land 0xF0 = 0xE0 then 3
  else if code land 0xF8 = 0xF0 then 4
  else 1

let utf8_chars text =
  let rec loop acc index =
    if index >= String.length text then List.rev acc
    else
      let len = utf8_char_len text.[index] in
      let len = min len (String.length text - index) in
      loop (String.sub text index len :: acc) (index + len)
  in
  loop [] 0

let visible_width text = List.length (utf8_chars text)

let take_width width text =
  if width <= 0 then ""
  else
    let rec loop acc remaining = function
      | [] -> String.concat "" (List.rev acc)
      | ch :: rest ->
          if remaining <= 0 then String.concat "" (List.rev acc)
          else loop (ch :: acc) (remaining - 1) rest
    in
    loop [] width (utf8_chars text)

let take_suffix_width width text =
  if width <= 0 then ""
  else
    let chars = utf8_chars text in
    let rec drop n xs =
      if n <= 0 then xs
      else match xs with [] -> [] | _ :: rest -> drop (n - 1) rest
    in
    let length = List.length chars in
    String.concat "" (drop (max 0 (length - width)) chars)

let truncate_middle text width =
  if width <= 0 then ""
  else if visible_width text <= width then text
  else if width <= 3 then take_width width text
  else
    let keep = (width - 3) / 2 in
    let suffix_width = width - 3 - keep in
    take_width keep text ^ "..." ^ take_suffix_width suffix_width text

let basename path =
  let rec trim_end index =
    if index > 0 && path.[index] = '/' then trim_end (index - 1) else index
  in
  if path = "" then ""
  else
    let last = trim_end (String.length path - 1) in
    let rec find_slash index =
      if index < 0 then None
      else if path.[index] = '/' then Some index
      else find_slash (index - 1)
    in
    match find_slash last with
    | None -> String.sub path 0 (last + 1)
    | Some slash -> String.sub path (slash + 1) (last - slash)

let sandbox_dot_token = function
  | "danger-full-access" -> "error"
  | "read-only" -> "success"
  | _ -> "warning"

let network_dot_token = function
  | "enabled" -> "error"
  | _ -> "success"

let approval_dot_token = function
  | "untrusted" -> "success"
  | "on-request" -> "accent"
  | "on-failure" -> "warning"
  | "never" -> "error"
  | _ -> "dim"

let permission_dot_tokens snapshot =
  if snapshot.no_sandbox then [ "text"; "text"; "text" ]
  else
    [
      sandbox_dot_token snapshot.filesystem_mode;
      network_dot_token snapshot.network_mode;
      approval_dot_token snapshot.approval_policy;
    ]

let render_permission_indicator ~colorize snapshot =
  let dot = "•" in
  permission_dot_tokens snapshot
  |> List.map (fun token -> colorize token dot)
  |> String.concat ""

let permission_indicator_width = 3

let context_text percent window =
  if Float.is_finite window && window > 0.0 then
    let percent = if Float.is_finite percent then percent else 0.0 in
    Some
      (Printf.sprintf "%d%%/%s"
         (int_of_float (Float.round percent))
         (format_token_window window))
  else None

let display_default ~default value =
  match String.trim value with
  | "" -> default
  | value -> value

let render_line ~colorize ~width snapshot =
  if width <= 0 then ""
  else
    let dot = "•" in
    let repo_name = basename snapshot.cwd in
    let repo_line = if snapshot.git_repo && snapshot.branch <> "" then repo_name ^ ":" ^ snapshot.branch else repo_name in
    let git_suffix =
      if snapshot.git_error then " git error"
      else if snapshot.git_repo then Printf.sprintf " Δ+%d/-%d" snapshot.git_delta.added snapshot.git_delta.removed
      else ""
    in
    let indicator = render_permission_indicator ~colorize snapshot in
    let repo_part = repo_line ^ git_suffix in
    let left_raw = String.concat "" (List.init permission_indicator_width (fun _ -> dot)) ^ "  " ^ repo_part in
    let left_rendered =
      indicator ^ "  " ^ colorize "dim" repo_line
      ^ colorize (if snapshot.git_error then "error" else "dim") git_suffix
    in
    let provider = provider_label snapshot.provider in
    let model = display_default ~default:"no-model" snapshot.model in
    let thinking = display_default ~default:"off" snapshot.thinking in
    let model_and_meta = model ^ " • " ^ thinking in
    let middle_raw =
      if provider = "" then model_and_meta else provider ^ " • " ^ model_and_meta
    in
    let cost = Printf.sprintf "$%.3f" snapshot.total_cost in
    let right_raw =
      match context_text snapshot.context_percent snapshot.context_window with
      | None -> cost
      | Some context -> cost ^ " " ^ context
    in
    let left_width = visible_width left_raw in
    let middle_width = visible_width middle_raw in
    let right_width = visible_width right_raw in
    let min_gap = 2 in
    let render_full rendered_middle left_gap right_gap =
      left_rendered ^ String.make left_gap ' ' ^ colorize "dim" rendered_middle
      ^ String.make right_gap ' ' ^ colorize "dim" right_raw
    in
    let full_required = left_width + middle_width + right_width + (min_gap * 2) in
    if full_required <= width then
      let free = width - full_required in
      let left_gap = min_gap + (free / 2) in
      let right_gap = min_gap + ((free + 1) / 2) in
      render_full middle_raw left_gap right_gap
    else
      let middle_budget = width - left_width - right_width - (min_gap * 2) in
      if middle_budget > 0 then
        let compact_middle = model_and_meta in
        let preferred_middle =
          if provider <> "" && visible_width compact_middle <= middle_budget then
            compact_middle
          else middle_raw
        in
        let rendered_middle =
          if visible_width preferred_middle <= middle_budget then preferred_middle
          else truncate_middle preferred_middle middle_budget
        in
        let consumed =
          left_width + visible_width rendered_middle + right_width + (min_gap * 2)
        in
        let free = max 0 (width - consumed) in
        let left_gap = min_gap + (free / 2) in
        let right_gap = min_gap + ((free + 1) / 2) in
        render_full rendered_middle left_gap right_gap
      else
        let gap = if width > permission_indicator_width then 1 else 0 in
        let rest_budget = width - permission_indicator_width - gap in
        if rest_budget <= 0 then take_width width indicator
        else
          let rest_raw = repo_part ^ " " ^ right_raw in
          indicator ^ String.make gap ' '
          ^ colorize "dim" (take_width rest_budget rest_raw)

let goal_status_label = function
  | Goal.Active -> "Goal active"
  | Goal.Paused -> "Goal paused"
  | Goal.Blocked -> "Goal blocked"
  | Goal.Usage_limited -> "Goal usage limited"
  | Goal.Time_limited -> "Goal time limited"
  | Goal.Complete -> "Goal complete"

let render_goal_line ~colorize ~width (goal : Goal.presentation) =
  let status = goal_status_label goal.status in
  let automation =
    match goal.automation with
    | Goal.Automation_enabled -> ""
    | Goal.Automation_interrupted -> " · interrupted"
  in
  let time =
    match goal.time_limit_seconds with
    | None -> Goal.format_duration goal.time_used_seconds
    | Some limit ->
        Goal.format_duration goal.time_used_seconds ^ "/" ^ Goal.format_duration limit
  in
  let fixed = status ^ automation ^ " · " ^ time in
  let objective_budget = width - visible_width fixed - 3 in
  let objective = truncate_middle goal.objective (max 0 objective_budget) in
  let raw = if objective = "" then fixed else status ^ automation ^ " · " ^ objective ^ " · " ^ time in
  colorize "dim" (take_width width raw)

let render_lines ~colorize ~width snapshot =
  let primary = render_line ~colorize ~width snapshot in
  match snapshot.goal with
  | None -> [ primary ]
  | Some goal -> [ primary; render_goal_line ~colorize ~width goal ]
