open Jsoo_bridge
open App_state

let contains text needle =
  let rec loop index =
    index + String.length needle <= String.length text
    && (String.sub text index (String.length needle) = needle || loop (index + 1))
  in
  needle = "" || loop 0

let run_git host cwd args =
  match function_field host "exec" with
  | Some _ -> (
      let promise =
        call3 host "exec" (js_string "git") (js_array_of_strings args)
          (js_options ~cwd ~timeout:15000)
      in
      match await_js_result promise with
      | Error _ -> Error "git execution failed"
      | Ok result ->
          if int_field_default result "code" 1 <> 0 then Error (get_string result "stderr")
          else Ok (get_string result "stdout"))
  | _ -> Error "git execution unavailable"

let run_numstat host cwd args =
  Result.map Model.parse_git_numstat (run_git host cwd args)

let collect_git_line_delta host cwd =
  match run_git host cwd [ "rev-parse"; "--is-inside-work-tree" ] with
  | Ok output when String.trim output = "true" -> (
      match
        ( run_numstat host cwd [ "diff"; "--numstat"; "--no-ext-diff" ],
          run_numstat host cwd [ "diff"; "--cached"; "--numstat"; "--no-ext-diff" ] )
      with
      | Ok unstaged, Ok staged ->
          `Ready
            {
              Model.added = unstaged.added + staged.added;
              removed = unstaged.removed + staged.removed;
            }
      | _ -> `Error)
  | Ok _ -> `Not_repo
  | Error message ->
      if contains (String.lowercase_ascii message) "not a git repository" then `Not_repo
      else `Error

let refresh_footer_hygiene_now host =
  if state.cwd = "" then ()
  else
    let cwd = state.cwd in
    let next = collect_git_line_delta host cwd in
    if state.cwd = cwd then (
      let delta, repo, error =
        match next with
        | `Ready delta -> (delta, true, false)
        | `Not_repo -> (Model.empty_git_delta, false, false)
        | `Error -> (Model.empty_git_delta, false, true)
      in
      if delta <> state.git_delta || repo <> state.git_repo || error <> state.git_error then (
        state.git_delta <- delta;
        state.git_repo <- repo;
        state.git_error <- error;
        emit_changed host))

let refresh_footer_hygiene host =
  Effect.sync (fun () -> refresh_footer_hygiene_now host)

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

let goal_presentation () =
  Option.map
    (Taumel.Goal.present !goal_automation)
    !current_goal

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
    approval_policy =
      Taumel.Capability_profile.approval_to_string
        !active_profile_state.approval_policy;
    no_sandbox = !active_no_sandbox;
    git_delta = state.git_delta;
    git_repo = state.git_repo;
    git_error = state.git_error;
    provider = state.provider;
    model = state.model;
    thinking = state.thinking;
    total_cost = state.total_cost;
    context_percent = state.context_percent;
    context_window = state.context_window;
    goal = goal_presentation ();
  }
