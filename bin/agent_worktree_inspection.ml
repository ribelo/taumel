open Jsoo_bridge
open App_state
module Effect = Eta.Effect
module Duration = Eta.Duration
module Delta = Taumel.Agent_worktree_delta

let hardened_args ~git_dir ~worktree args =
  [
    "--no-replace-objects";
    "--git-dir";
    git_dir;
    "--work-tree";
    worktree;
    "-c";
    "core.hooksPath=/dev/null";
    "-c";
    "core.fsmonitor=false";
    "-c";
    "core.useBuiltinFSMonitor=false";
    "-c";
    "diff.external=";
    "-c";
    "interactive.diffFilter=";
    "-c";
    "commit.gpgsign=false";
    "-c";
    "submodule.recurse=false";
    "-c";
    "color.ui=false";
  ]
  @ args

let run_git ~worktree ~git_dir ~accepted_codes args =
  let env =
    Trusted_git.restricted_environment ~git_dir ~git_work_tree:worktree
      [ ("GIT_NO_REPLACE_OBJECTS", js_string "1") ]
    |> ojs_of_js
  in
  Node_child_process_eta.exec_file
    ~file:(Agent_worktree_host.require_trusted_git ())
    ~args:(hardened_args ~git_dir ~worktree args)
    ~cwd:worktree ~env
  |> Effect.bind (fun (result : Node_child_process_eta.result) ->
      if result.killed then Effect.fail "Git process was killed"
      else if List.mem result.code accepted_codes then Effect.pure result.stdout
      else
        let stderr = String.trim result.stderr in
        Effect.fail
          (if stderr = "" then
             Printf.sprintf "Git exited with code %d" result.code
           else stderr))

let resolve_worktree (identity : Taumel.Agents.identity) =
  let ( let* ) = Result.bind in
  let* derived =
    Taumel.Agent_workspace.derive
      ~agent_home:(Agent_worktree_host.pi_agent_dir ())
      ~owner_session_id:identity.identity_owner_session_id
      ~agent_id:identity.identity_agent_id identity.identity_workspace_binding
  in
  match derived.isolation with
  | Taumel.Agent_workspace.None -> Error "agent identity has no worktree"
  | Taumel.Agent_workspace.Worktree ->
      let* git_dir =
        Agent_worktree_host.verify_broker_registration
          ~worktree_path:derived.worktree_path
          ~main_repository_root:derived.main_repository_root
          ~main_repository_id:derived.main_repository_id ~branch:derived.branch
      in
      Ok (derived.worktree_path, git_dir)

let baseline ~worktree ~git_dir =
  run_git ~worktree ~git_dir ~accepted_codes:[ 0 ]
    [
      "log";
      "--first-parent";
      "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00";
      "HEAD";
    ]
  |> Effect.bind (fun output ->
      match Delta.baseline_commit output with
      | Some commit -> Effect.pure commit
      | None -> Effect.fail "automatic agent baseline is unavailable")

let tracked_delta ~worktree ~git_dir baseline =
  run_git ~worktree ~git_dir ~accepted_codes:[ 0 ]
    [ "diff"; "--numstat"; "--no-ext-diff"; "--no-textconv"; baseline; "--" ]
  |> Effect.bind (fun output -> Effect.from_result (Delta.parse_numstat output))

let untracked_paths ~worktree ~git_dir =
  run_git ~worktree ~git_dir ~accepted_codes:[ 0 ]
    [ "ls-files"; "--others"; "--exclude-standard"; "-z"; "--" ]
  |> Effect.map Taumel.Agent_worktree.nul_paths

let untracked_delta ~worktree ~git_dir path =
  run_git ~worktree ~git_dir ~accepted_codes:[ 0; 1 ]
    [
      "diff";
      "--no-index";
      "--numstat";
      "--no-ext-diff";
      "--no-textconv";
      "--";
      Node_os.dev_null ();
      path;
    ]
  |> Effect.bind (fun output -> Effect.from_result (Delta.parse_numstat output))

let measure identity =
  let open Eta.Syntax in
  let* worktree, git_dir =
    Effect.sync_result (fun () -> resolve_worktree identity)
  in
  let* baseline = baseline ~worktree ~git_dir in
  let* tracked = tracked_delta ~worktree ~git_dir baseline in
  let* paths = untracked_paths ~worktree ~git_dir in
  let* untracked =
    paths
    |> List.map (untracked_delta ~worktree ~git_dir)
    |> Effect.all ~max_concurrent:4
  in
  Effect.from_result
    (List.fold_left
       (fun total delta ->
         Result.bind total (fun total -> Delta.add total delta))
       (Ok tracked) untracked)

let ready_update delta =
  Boundary_contracts.AgentWorktreeLineDeltaReady.create
    ~added:(float_of_int (Delta.added delta))
    ~removed:(float_of_int (Delta.removed delta))
    ()
  |> Tool_contracts.AgentWorktreeLineDeltaReady.t_to_js |> js_of_ojs

let unavailable_update () =
  Boundary_contracts.AgentWorktreeLineDeltaUnavailable.create ()
  |> Tool_contracts.AgentWorktreeLineDeltaUnavailable.t_to_js |> js_of_ojs

let publish listener value =
  Effect.sync_result (fun () ->
      try
        ignore (Unsafe.fun_call listener [| inject value |]);
        Ok ()
      with error -> Error (Printexc.to_string error))

let watch ~agent_id signal listener ctx =
  Session_sync.require_agent_owner ctx;
  if not (Eta_host_doors.is_js_function listener) then
    invalid_arg "worktree line-delta listener must be a function";
  let owner_session_id = Agent_tools.owner_id ctx in
  let identity =
    match
      Taumel.Agents.owned_identity !agent_state ~owner_session_id agent_id
    with
    | Ok identity -> identity
    | Error message -> failwith message
  in
  let rec refresh () =
    let open Eta.Syntax in
    let* result =
      measure identity
      |> Effect.timeout_as (Duration.seconds 15)
           ~on_timeout:"worktree line-delta measurement timed out"
      |> Effect.to_result
    in
    let* () =
      publish listener
        (match result with
        | Ok delta -> ready_update delta
        | Error _ -> unavailable_update ())
    in
    let* () = Effect.sleep (Duration.seconds 5) in
    refresh ()
  in
  let refresh =
    refresh () |> Effect.map_error (fun message -> `Watcher message)
  in
  let abort =
    Eta_host_doors.await_abort_signal signal
    |> Effect.bind (fun () -> Effect.fail `Abort)
  in
  let program =
    Effect.par refresh abort
    |> Effect.map (fun _ -> inject Js.null)
    |> Effect.catch_some (function
      | `Abort -> Some (Effect.pure (inject Js.null))
      | `Watcher _ -> None)
  in
  Eta_host_doors.js_promise_of_effect_rejecting program
