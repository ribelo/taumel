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
  match Taumel.Agents.find_identity !agent_state agent_id with
  | None -> error_obj ("unknown agent: " ^ agent_id)
  | Some identity -> (
      match identity.identity_workspace_binding with
      | Taumel.Agent_workspace.Shared _ -> core_ack ()
      | Taumel.Agent_workspace.Worktree _ as binding -> (
          match
            Taumel.Agent_workspace.derive
              ~agent_home:(Agent_worktree_host.pi_agent_dir ())
              ~owner_session_id:identity.identity_owner_session_id ~agent_id binding
          with
          | Error message -> error_obj message
          | Ok derived -> (
              match
                Agent_worktree_host.rollback_failed_start
                  ~owner_session_id:identity.identity_owner_session_id ~agent_id
                  ~main_repository_root:derived.main_repository_root
                  ~main_repository_id:derived.main_repository_id
                  ~worktree_path:derived.worktree_path ~branch:derived.branch
              with
              | Ok () -> core_ack ()
              | Error (_code, message) -> error_obj message)))
let delete_worktree facts ctx =
  let agent_id = get_string facts "agent_id" in
  match
    Taumel.Agents.owned_identity !agent_state
      ~owner_session_id:(Session_store.session_id_from_ctx ctx) agent_id
  with
  | Error message -> error_obj ("cleanup_failed: " ^ message)
  | Ok identity -> (
      match
        Taumel.Agent_workspace.derive
          ~agent_home:(Agent_worktree_host.pi_agent_dir ())
          ~owner_session_id:identity.identity_owner_session_id ~agent_id
          identity.identity_workspace_binding
      with
      | Error message -> error_obj ("cleanup_failed: " ^ message)
      | Ok derived when derived.isolation = Taumel.Agent_workspace.None ->
          error_obj "cleanup_failed: identity does not own an agent worktree"
      | Ok derived ->
    let worktree_path = derived.worktree_path in
    let main_repository_root = derived.main_repository_root in
    let main_repository_id = derived.main_repository_id in
    let branch = derived.branch in
    let path_present = Agent_worktree_host.path_exists worktree_path in
    match
      Agent_worktree_host.registration_present ~main_repository_root
        ~worktree_path
    with
    | Error message -> error_obj ("cleanup_failed: " ^ message)
    | Ok registered -> (
    match (path_present, registered) with
    | false, false -> core_ack ()
    | false, true ->
        error_obj "cleanup_failed: worktree path missing but registration remains"
    | true, false ->
        error_obj "cleanup_failed: worktree path exists without native registration"
    | true, true -> (
        match
          Agent_worktree_host.verify_broker_registration ~worktree_path
            ~main_repository_root ~branch
        with
        | Error message -> error_obj ("cleanup_failed: " ^ message)
        | Ok _ -> (
            match Agent_worktree_host.worktree_is_clean ~worktree_path with
            | Error message -> error_obj ("cleanup_failed: " ^ message)
            | Ok () -> (
                match
                  Agent_worktree_host.remove_worktree ~main_repository_root
                    ~worktree_path ~main_repository_id
                    ~branch
                with
                | Ok () -> core_ack ()
                | Error message -> error_obj ("cleanup_failed: " ^ message))))))
let reconcile_provisional_worktrees () =
  Agent_worktree_host.reconcile_provisional_markers ();
  ignore (Agent_ephemeral_cleanup.reconcile_deferred ());
  ignore (Agent_child_session_host.reconcile_cleanup_journal ());
  core_ack ()

let identity_metadata ~(identity : Taumel.Agents.identity) ?child_session_file () =
  let source = Taumel.Agents.identity_source_workspace identity in
  let isolation =
    Taumel.Agent_workspace.isolation_to_string
      (Taumel.Agents.identity_isolation identity)
  in
  let effective, derived =
    match Agent_worktree_host.effective_workspace_for_identity ~identity with
    | Ok (path, derived) -> (path, Some derived)
    | Error _ ->
        match identity.identity_workspace_binding with
        | Taumel.Agent_workspace.Shared { source_root } -> (source_root, None)
        | Taumel.Agent_workspace.Worktree _ -> ("", None)
  in
  let fields =
    [
      ("kind", Taumel.Shared.String "agent");
      ( "agentKind",
        Taumel.Shared.String
          (Taumel.Agents.agent_kind_to_string identity.identity_kind) );
      ("agentId", Taumel.Shared.String identity.identity_agent_id);
      ("modelId", Taumel.Shared.String identity.identity_model);
      ("thinkingLevel", Taumel.Shared.String identity.identity_thinking);
      ( "activeTools",
        Taumel.Shared.Array
          (List.map
             (fun value -> Taumel.Shared.String value)
             identity.identity_active_tools) );
      ( "capabilityProfile",
        Taumel.Capability_profile.to_json identity.identity_permission_ceiling );
      ( "networkMode",
        Taumel.Shared.String
          (if identity.identity_network_allowed then "enabled" else "disabled") );
      ("isolated_child", Taumel.Shared.Bool true);
      ("workspaceDirectory", Taumel.Shared.String effective);
      ("sourceWorkspace", Taumel.Shared.String source);
      ("isolation", Taumel.Shared.String isolation);
      ( "workspaceBinding",
        Taumel.Agent_workspace.binding_to_json identity.identity_workspace_binding );
    ]
  in
  let fields =
    match derived with
    | Some derived when derived.isolation = Taumel.Agent_workspace.Worktree ->
        fields
        @ [
            ("worktreePath", Taumel.Shared.String derived.worktree_path);
            ("worktreeBranch", Taumel.Shared.String derived.branch);
            ( "mainRepositoryRoot",
              Taumel.Shared.String derived.main_repository_root );
          ]
    | _ -> fields
  in
  let fields =
    match child_session_file with
    | Some value -> fields @ [ ("childSessionFile", Taumel.Shared.String value) ]
    | None -> fields
  in
  Taumel.Shared.Object fields
