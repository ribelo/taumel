type git_delta = { added : int; removed : int }

type activity = {
  running_agents : int;
  orphaned_agents : int;
  single_agent_description : string option;
  live_execs : int;
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

let empty_activity =
  {
    running_agents = 0;
    orphaned_agents = 0;
    single_agent_description = None;
    live_execs = 0;
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
    | true -> String.sub rendered 0 (String.length rendered - 3) ^ "k"
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
    let length = List.length chars in
    String.concat "" (List.drop (max 0 (length - width)) chars)

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

let network_dot_token = function "enabled" -> "error" | _ -> "success"

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
  match String.trim value with "" -> default | value -> value

let render_line ~colorize ~width snapshot =
  if width <= 0 then ""
  else
    let dot = "•" in
    let repo_name = basename snapshot.cwd in
    let repo_line =
      if snapshot.git_repo && snapshot.branch <> "" then
        repo_name ^ ":" ^ snapshot.branch
      else repo_name
    in
    let git_suffix =
      if snapshot.git_error then " git error"
      else if snapshot.git_repo then
        Printf.sprintf " Δ+%d/-%d" snapshot.git_delta.added
          snapshot.git_delta.removed
      else ""
    in
    let indicator = render_permission_indicator ~colorize snapshot in
    let repo_part = repo_line ^ git_suffix in
    let left_raw =
      String.concat "" (List.init permission_indicator_width (fun _ -> dot))
      ^ "  " ^ repo_part
    in
    let left_rendered =
      indicator ^ "  " ^ colorize "dim" repo_line
      ^ colorize (if snapshot.git_error then "error" else "dim") git_suffix
    in
    let provider = provider_label snapshot.provider in
    let model = display_default ~default:"no-model" snapshot.model in
    let thinking = display_default ~default:"off" snapshot.thinking in
    let model_and_meta = model ^ " • " ^ thinking in
    let middle_raw =
      if provider = "" then model_and_meta
      else provider ^ " • " ^ model_and_meta
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
      left_rendered ^ String.make left_gap ' '
      ^ colorize "dim" rendered_middle
      ^ String.make right_gap ' ' ^ colorize "dim" right_raw
    in
    let full_required =
      left_width + middle_width + right_width + (min_gap * 2)
    in
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
          if provider <> "" && visible_width compact_middle <= middle_budget
          then compact_middle
          else middle_raw
        in
        let rendered_middle =
          if visible_width preferred_middle <= middle_budget then
            preferred_middle
          else truncate_middle preferred_middle middle_budget
        in
        let consumed =
          left_width
          + visible_width rendered_middle
          + right_width + (min_gap * 2)
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

let plan_status_label = function
  | Plan.Draft -> "Plan draft"
  | Plan.Active -> "Plan active"
  | Plan.Paused -> "Plan paused"
  | Plan.Blocked _ -> "Plan blocked"
  | Plan.Time_limited -> "Plan time limited"
  | Plan.Complete -> "Plan complete"

(* ^footer-13xq: exceptional states earn semantic color; all other second-line
   text stays dim. *)
let plan_status_token = function
  | Plan.Blocked _ -> "warning"
  | Plan.Complete -> "success"
  | _ -> "dim"

let plan_time_text (plan : Plan.presentation) =
  match plan.time_limit_seconds with
  | None -> Plan.format_duration plan.time_used_seconds
  | Some limit ->
      Plan.format_duration plan.time_used_seconds
      ^ "/" ^ Plan.format_duration limit

(* ^footer-loua: the status label appears only for non-active statuses. *)
let plan_zone_parts (plan : Plan.presentation) =
  let progress =
    Printf.sprintf "%d/%d" plan.completed_tasks plan.total_tasks
  in
  let status_parts =
    match plan.status with
    | Plan.Active -> [ ("Plan", "dim") ]
    | status -> [ (plan_status_label status, plan_status_token status) ]
  in
  let interrupted_parts =
    match plan.automation with
    | Plan.Automation_enabled -> []
    | Plan.Automation_interrupted -> [ (" (interrupted)", "warning") ]
  in
  status_parts @ interrupted_parts
  @ [ (" · " ^ progress ^ " · " ^ plan_time_text plan, "dim") ]

(* ^footer-tse7 / ^footer-lkk2: the center zone is the current focus — the
   plan's first in-progress task, or the single running agent's description
   while no plan exists. *)
let center_zone_raw snapshot =
  match snapshot.plan with
  | Some plan -> (
      let in_progress =
        List.filter
          (fun (task : Plan.task) -> task.Plan.status = Plan.In_progress)
          plan.tasks
      in
      match in_progress with
      | [] -> ""
      | first :: rest -> (
          match List.length rest with
          | 0 -> first.Plan.title
          | n -> Printf.sprintf "%s +%d" first.Plan.title n))
  | None -> (
      match snapshot.activity.single_agent_description with
      | Some description when String.trim description <> "" ->
          String.trim description
      | _ -> "")

(* ^footer-gwja: counts only — no command or description text; the orphaned
   count keeps the error color per ^footer-djhf. *)
let activity_counts_parts activity =
  let agents =
    if activity.running_agents > 0 then
      [ (Printf.sprintf "%d agents" activity.running_agents, "dim") ]
    else []
  in
  let execs =
    if activity.live_execs > 0 then
      [ (Printf.sprintf "%d exec" activity.live_execs, "dim") ]
    else []
  in
  let orphaned =
    if activity.orphaned_agents > 0 then
      [ (Printf.sprintf "%d orphaned" activity.orphaned_agents, "error") ]
    else []
  in
  let rec intersperse = function
    | [] -> []
    | [ part ] -> [ part ]
    | part :: rest -> part :: (" · ", "dim") :: intersperse rest
  in
  intersperse (agents @ execs @ orphaned)

let parts_width parts =
  List.fold_left (fun acc (text, _) -> acc + visible_width text) 0 parts

let colorize_parts ~colorize parts =
  String.concat "" (List.map (fun (text, token) -> colorize token text) parts)

let take_parts width parts =
  let rec loop remaining acc = function
    | [] -> List.rev acc
    | (text, token) :: rest ->
        if remaining <= 0 then List.rev acc
        else
          let part_width = visible_width text in
          if part_width <= remaining then
            loop (remaining - part_width) ((text, token) :: acc) rest
          else List.rev ((take_width remaining text, token) :: acc)
  in
  loop width [] parts

(* ^footer-xd4u / ^footer-pcp3: three zones — left plan, center focus,
   right-aligned counts — composed into exactly one terminal line; the center
   shrinks first and the line never wraps. *)
let compose_zones ~colorize ~width left_parts center_raw right_parts =
  let min_gap = 2 in
  let right_w = parts_width right_parts in
  let left_w = parts_width left_parts in
  let left_parts, left_w =
    if right_w = 0 then
      if left_w <= width then (left_parts, left_w)
      else (take_parts width left_parts, width)
    else
      let budget = width - right_w - min_gap in
      if left_w <= max 0 budget then (left_parts, left_w)
      else if budget > 0 then (take_parts budget left_parts, budget)
      else ([], 0)
  in
  let right_parts, right_w =
    if right_w <= width then (right_parts, right_w)
    else (take_parts width right_parts, width)
  in
  let gaps =
    match (left_w > 0, right_w > 0) with
    | true, true -> min_gap * 2
    | true, false | false, true -> min_gap
    | false, false -> 0
  in
  let center_budget = width - left_w - right_w - gaps in
  let center =
    if center_raw = "" || center_budget <= 0 then ""
    else take_width center_budget center_raw
  in
  let center_w = visible_width center in
  let left_s = colorize_parts ~colorize left_parts in
  let center_s = colorize "dim" center in
  let right_s = colorize_parts ~colorize right_parts in
  match (left_w > 0, center_w > 0, right_w > 0) with
  | false, false, false -> ""
  | true, false, false -> left_s
  | false, true, false -> center_s
  | false, false, true -> String.make (width - right_w) ' ' ^ right_s
  | true, true, false -> left_s ^ String.make min_gap ' ' ^ center_s
  | false, true, true ->
      center_s ^ String.make (width - center_w - right_w) ' ' ^ right_s
  | true, false, true ->
      left_s ^ String.make (width - left_w - right_w) ' ' ^ right_s
  | true, true, true ->
      let free = max 0 (width - left_w - center_w - right_w - (min_gap * 2)) in
      let left_gap = min_gap + (free / 2) in
      let right_gap = min_gap + (free - (free / 2)) in
      left_s ^ String.make left_gap ' ' ^ center_s ^ String.make right_gap ' '
      ^ right_s

let render_second_line ~colorize ~width snapshot =
  if width <= 0 then None
  else
    let right_parts = activity_counts_parts snapshot.activity in
    let left_parts =
      match snapshot.plan with
      | None -> []
      | Some plan -> plan_zone_parts plan
    in
    match (left_parts, right_parts) with
    | [], [] -> None
    | _ ->
        Some
          (compose_zones ~colorize ~width left_parts
             (center_zone_raw snapshot) right_parts)

let render_lines ~colorize ~width snapshot =
  let primary = render_line ~colorize ~width snapshot in
  match render_second_line ~colorize ~width snapshot with
  | None -> [ primary ]
  | Some second -> [ primary; second ]
