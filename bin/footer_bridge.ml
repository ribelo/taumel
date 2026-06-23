open Jsoo_bridge
open App_state

let run_numstat host cwd args =
  match function_field host "exec" with
  | Some _ -> (
      let promise =
        call3 host "exec" (js_string "git") (js_array_of_strings args)
          (js_options ~cwd ~timeout:15000)
      in
      match await_js_result promise with
      | Error _ -> Model.empty_git_delta
      | Ok result ->
          if int_field_default result "code" 1 <> 0 then Model.empty_git_delta
          else Model.parse_git_numstat (get_string result "stdout"))
  | _ -> Model.empty_git_delta

let collect_git_line_delta host cwd =
  let unstaged =
    run_numstat host cwd [ "diff"; "--numstat"; "--no-ext-diff" ]
  in
  let staged =
    run_numstat host cwd [ "diff"; "--cached"; "--numstat"; "--no-ext-diff" ]
  in
  {
    Model.added = unstaged.added + staged.added;
    removed = unstaged.removed + staged.removed;
  }

let refresh_footer_hygiene host =
  Effect.sync (fun () ->
      if state.cwd = "" then ()
      else
        let cwd = state.cwd in
        let next = collect_git_line_delta host cwd in
        if state.cwd = cwd && next <> state.git_delta then (
          state.git_delta <- next;
          emit_changed host))

let colorize host theme color value =
  match function_field host "themeFg" with
  | Some _ -> (
      match
        string_value
          (call3 host "themeFg" (inject theme) (js_string color)
             (js_string value))
      with
      | Some colored -> colored
      | None -> value)
  | _ -> value

let active_network_mode_string () =
  match !active_network_mode with
  | Taumel.Sandbox.Network_enabled -> "enabled"
  | Taumel.Sandbox.Network_disabled -> "disabled"

let time_usage (goal : Taumel.Goal.t) =
  match goal.time_limit_seconds with
  | None -> None
  | Some limit ->
      Some
        (Taumel.Goal.format_duration goal.time_used_seconds ^ "/"
       ^ Taumel.Goal.format_duration limit)

let goal_status_text () =
  match (!current_goal, !goal_automation) with
  | Some _, Taumel.Goal.Automation_interrupted ->
      Some "Goal interrupted"
  | Some goal, _ -> (
      match goal.status with
      | Taumel.Goal.Active -> (
          match time_usage goal with
          | None -> Some "Pursuing goal"
          | Some usage -> Some ("Pursuing goal (" ^ usage ^ ")"))
      | Taumel.Goal.Paused -> Some "Goal paused (/goal resume)"
      | Taumel.Goal.Blocked -> Some "Goal blocked (/goal resume)"
      | Taumel.Goal.Usage_limited -> Some "Goal hit usage limits (/goal resume)"
      | Taumel.Goal.Time_limited -> (
          match time_usage goal with
          | None -> Some "Goal time limit reached"
          | Some usage -> Some ("Goal time limit reached (" ^ usage ^ ")"))
      | Taumel.Goal.Complete -> Some "Goal complete")
  | None, _ -> None

let snapshot_for_render host footer_data =
  let branch =
    match function_field host "getGitBranch" with
    | Some _ -> (
        match string_value (call1 host "getGitBranch" (inject footer_data)) with
        | Some value -> value
        | None -> "")
    | _ -> ""
  in
  {
    Model.cwd = state.cwd;
    branch;
    filesystem_mode = state.filesystem_mode;
    network_mode = active_network_mode_string ();
    no_sandbox = !active_no_sandbox;
    git_delta = state.git_delta;
    provider = state.provider;
    model = state.model;
    thinking = state.thinking;
    total_cost = state.total_cost;
    context_percent = state.context_percent;
    context_window = state.context_window;
    goal_status = goal_status_text ();
  }
