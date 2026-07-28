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
  | Some _ ->
      let promise =
        call3 host "exec" (js_string "git") (js_array_of_strings args)
          (js_options ~cwd ~timeout:15000)
      in
      await_js_result promise
      |> Effect.fold
           ~ok:(fun result ->
             if int_field_default result "code" 1 <> 0 then
               Error (get_string result "stderr")
             else Ok (get_string result "stdout"))
           ~error:(fun _ -> Error "git execution failed")
  | _ -> Effect.pure (Error "git execution unavailable")

let run_numstat host cwd args =
  run_git host cwd args
  |> Effect.map (function
       | Error _ as error -> error
       | Ok output -> Ok (Model.parse_git_numstat output))

let collect_git_line_delta host cwd =
  run_git host cwd [ "rev-parse"; "--is-inside-work-tree" ]
  |> Effect.bind (function
       | Ok output when String.trim output = "true" ->
           run_numstat host cwd [ "diff"; "--numstat"; "--no-ext-diff" ]
           |> Effect.bind (fun unstaged_result ->
                  run_numstat host cwd
                    [ "diff"; "--cached"; "--numstat"; "--no-ext-diff" ]
                  |> Effect.map (fun staged_result ->
                         match (unstaged_result, staged_result) with
                         | Ok unstaged, Ok staged ->
                             let open Model in
                             `Ready
                               {
                                 added = unstaged.added + staged.added;
                                 removed = unstaged.removed + staged.removed;
                               }
                         | _ -> `Error))
       | Ok _ -> Effect.pure `Not_repo
       | Error message ->
           Effect.pure
             (if contains (String.lowercase_ascii message) "not a git repository"
              then `Not_repo
              else `Error))

let refresh_footer_hygiene host =
  if state.footer_cwd = "" then Effect.unit
  else
    let cwd = state.footer_cwd in
    collect_git_line_delta host cwd
    |> Effect.map (fun next ->
           if state.footer_cwd = cwd then (
             let delta, repo, error =
               match next with
               | `Ready delta -> (delta, true, false)
               | `Not_repo -> (Model.empty_git_delta, false, false)
               | `Error -> (Model.empty_git_delta, false, true)
             in
             if
               delta <> state.git_delta || repo <> state.git_repo
               || error <> state.git_error
             then (
               state.git_delta <- delta;
               state.git_repo <- repo;
               state.git_error <- error;
               emit_changed host)))

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

let network_mode_string = function
  | Taumel.Sandbox.Network_enabled -> "enabled"
  | Taumel.Sandbox.Network_disabled -> "disabled"

let plan_presentation () = !loaded_footer_plan

let activity_for_render () =
  let owner_id =
    match !loaded_session_id with
    | Some id when String.trim id <> "" -> String.trim id
    | _ -> ""
  in
  let running_runs =
    if owner_id = "" then []
    else
      let owned_ids =
        Taumel.Agents.owned_identities !agent_state ~owner_session_id:owner_id
        |> List.map (fun (identity : Taumel.Agents.identity) ->
               identity.identity_agent_id)
      in
      (!agent_state).runs
      |> List.filter (fun (run : Taumel.Agents.agent_run) ->
             List.mem run.run_agent_id owned_ids
             && run.run_status = Taumel.Agents.Running)
  in
  let active_runs, orphaned_runs =
    List.partition
      (fun (run : Taumel.Agents.agent_run) ->
        run.run_activity_state <> Taumel.Agents.Orphaned)
      running_runs
  in
  let running_agents = List.length active_runs in
  let orphaned_agents = List.length orphaned_runs in
  let single_agent_description =
    match active_runs with
    | [ run ] -> Some run.run_description
    | _ -> None
  in
  let live_execs, single_exec_command =
    if owner_id = "" then (0, None)
    else
      match Exec_session.background_activity_for_owner owner_id with
      | count, command -> (count, command)
  in
  {
    Model.running_agents;
    orphaned_agents;
    single_agent_description;
    live_execs;
    single_exec_command;
  }

let snapshot_for_render host footer_data =
  let permissions = !loaded_footer_permissions in
  let branch =
    match function_field host "getGitBranch" with
    | Some _ -> (
        match string_value (call1 host "getGitBranch" (inject footer_data)) with
        | Some value -> value
        | None -> "")
    | _ -> ""
  in
  {
    Model.cwd = state.footer_cwd;
    branch;
    filesystem_mode = permissions.footer_filesystem_mode;
    network_mode = network_mode_string permissions.footer_network_mode;
    approval_policy =
      Taumel.Capability_profile.approval_to_string
        permissions.footer_approval_policy;
    no_sandbox = permissions.footer_no_sandbox;
    git_delta = state.git_delta;
    git_repo = state.git_repo;
    git_error = state.git_error;
    provider = state.provider;
    model = state.model;
    thinking = state.thinking;
    total_cost = state.total_cost;
    context_percent = state.context_percent;
    context_window = state.context_window;
    plan = plan_presentation ();
    activity = activity_for_render ();
  }
