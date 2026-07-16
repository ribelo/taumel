open Jsoo_bridge
open App_state

let accept_worktree_start facts _ctx =
  let agent_id = get_string facts "agentId" in
  match Taumel.Agents.find_identity !agent_state agent_id with
  | None -> core_ack ()
  | Some identity -> (
      match Taumel.Agents.identity_isolation identity with
      | Taumel.Agent_workspace.None -> core_ack ()
      | Taumel.Agent_workspace.Worktree -> (
          match
            Agent_worktree_host.accept_provisional
              ~owner_session_id:identity.identity_owner_session_id ~agent_id
          with
          | Ok () -> core_ack ()
          | Error message -> error_obj message))
let rollback_worktree_start facts _ctx =
  let agent_id = get_string facts "agentId" in
  let path =
    match optional_string_field facts "worktreePath" with
    | Some value -> String.trim value
    | None -> ""
  in
  let main_root =
    match optional_string_field facts "mainRepositoryRoot" with
    | Some value -> String.trim value
    | None -> ""
  in
  let branch =
    match optional_string_field facts "worktreeBranch" with
    | Some value -> String.trim value
    | None -> ""
  in
  let run ~owner ~main_root ~path ~branch =
    if owner = "" || main_root = "" || path = "" || branch = "" then core_ack ()
    else
      match
        Agent_worktree_host.rollback_failed_start ~owner_session_id:owner ~agent_id
          ~main_repository_root:main_root ~worktree_path:path ~branch
      with
      | Ok () -> core_ack ()
      | Error (_code, message) -> error_obj message
  in
  match Taumel.Agents.find_identity !agent_state agent_id with
  | Some identity when path <> "" && main_root <> "" && branch <> "" ->
      run ~owner:identity.identity_owner_session_id ~main_root ~path ~branch
  | Some identity -> (
      match identity.identity_workspace_binding with
      | Taumel.Agent_workspace.Shared _ -> core_ack ()
      | Taumel.Agent_workspace.Worktree _ as binding -> (
          match
            Taumel.Agent_workspace.derive
              ~agent_home:(Agent_worktree_host.pi_agent_dir ())
              ~owner_session_id:identity.identity_owner_session_id ~agent_id binding
          with
          | Error _ -> core_ack ()
          | Ok derived ->
              run ~owner:identity.identity_owner_session_id
                ~main_root:derived.main_repository_root ~path:derived.worktree_path
                ~branch:derived.branch))
  | None when path <> "" && main_root <> "" && branch <> "" ->
      run ~owner:"" ~main_root ~path ~branch
  | None -> core_ack ()
let delete_worktree facts _ctx =
  let worktree_path =
    match optional_string_field facts "worktree_path" with
    | Some value -> String.trim value
    | None -> ""
  in
  let main_repository_root =
    match optional_string_field facts "main_repository_root" with
    | Some value -> String.trim value
    | None -> ""
  in
  let branch =
    match optional_string_field facts "branch" with
    | Some value -> String.trim value
    | None -> ""
  in
  if worktree_path = "" || main_repository_root = "" || branch = "" then
    error_obj "cleanup_failed: worktree deletion requires path, repository, and branch"
  else
    let path_present = Agent_worktree_host.path_exists worktree_path in
    let registration =
      Agent_worktree_host.verify_broker_registration ~worktree_path
        ~main_repository_root ~branch
    in
    match (path_present, registration) with
    | false, Error _ ->
        core_ack ()
    | false, Ok _ ->
        error_obj "cleanup_failed: worktree path missing but registration remains"
    | true, Error message ->
        error_obj ("cleanup_failed: " ^ message)
    | true, Ok _ -> (
        match Agent_worktree_host.worktree_is_clean ~worktree_path with
        | Error message -> error_obj ("cleanup_failed: " ^ message)
        | Ok () -> (
            match
              Agent_worktree_host.remove_worktree ~main_repository_root
                ~worktree_path ~main_repository_id:main_repository_root ~branch
            with
            | Ok () -> core_ack ()
            | Error message -> error_obj ("cleanup_failed: " ^ message)))
let reconcile_provisional_worktrees () =
  Agent_worktree_host.reconcile_provisional_markers ();
  core_ack ()
