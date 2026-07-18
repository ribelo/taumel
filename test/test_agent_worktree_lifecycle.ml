(* Integration tests for agent worktree pure lifecycle helpers and broker grammar
   composition. Host-side git provisioning is exercised through the pure planning
   surface where possible. *)

open Taumel

let assert_equal label expected actual =
  if expected <> actual then
    failwith (label ^ ": expected " ^ expected ^ ", got " ^ actual)

let assert_true label value =
  if not value then failwith (label ^ ": expected true")

let assert_error label = function
  | Ok _ -> failwith (label ^ ": expected error")
  | Error _ -> ()

let test_marker_roundtrip_and_match () =
  let marker =
    {
      Agent_worktree.owner_session_id = "owner";
      agent_id = "agent-ab12";
      main_repository_root = "/repo";
      main_repository_id = "id";
      worktree_path = "/home/u/.pi/agent/taumel/worktrees/repo/own/agent-ab12";
      branch = "taumel/agent/repo/own/agent-ab12/deadbeef";
      completed_steps =
        [ Marker_recorded; Worktree_creation_started; Worktree_created ];
      cleanup_incident_id = None;
    }
  in
  assert_true "current creation journal is valid"
    (Agent_worktree.valid_creation_steps marker.completed_steps);
  assert_true "legacy journal is inert"
    (not
       (Agent_worktree.valid_creation_steps
          [ Marker_recorded; Worktree_created ]));
  match Agent_worktree.marker_of_json (Agent_worktree.marker_to_json marker) with
  | Error message -> failwith message
  | Ok decoded ->
      assert_true "matches"
        (Agent_worktree.marker_matches_resources decoded
           ~main_repository_root:"/repo" ~main_repository_id:"id"
           ~worktree_path:marker.worktree_path ~branch:marker.branch);
      assert_true "mismatch"
        (not
           (Agent_worktree.marker_matches_resources decoded
              ~main_repository_root:"/other" ~main_repository_id:"id"
              ~worktree_path:marker.worktree_path ~branch:marker.branch))

let test_spawn_persists_worktree_binding () =
  let ceiling =
    Capability_profile.resolve ~approval_policy:Capability_profile.On_request
      Capability_profile.default
  in
  let binding =
    Agent_workspace.worktree ~source_origin:"/tmp/src"
      ~main_repository_root:"/tmp/repo" ~main_repository_id:"repo-1"
  in
  match
    Agents.record_spawn Agents.empty_session_state ~now:1
      ~owner_session_id:"parent" ~kind:Generic ~effort:Medium
      ~model:"anthropic/claude" ~thinking:"medium" ~description:"Work in tree"
      ~active_tools:[ "read"; "exec_command" ] ~permission_ceiling:ceiling
      ~workspace_binding:binding ()
  with
  | Error message -> failwith message
  | Ok (_state, identity, _run) ->
      assert_equal "isolation"
        (Agent_workspace.isolation_to_string
           (Agents.identity_isolation identity))
        "worktree";
      assert_equal "source"
        (Agents.identity_source_workspace identity)
        "/tmp/src";
      match
        Agents_codec.decode
          (Agents_codec.encode
             {
               Agents.identities = [ identity ];
               runs = [];
               issued_identity_counts =
                 { Agents.generic = 1; finder = 0; oracle = 0;
                   issued_ids = [ identity.identity_agent_id ] };
               cleanup_pending = [];
             })
      with
      | Error message -> failwith message
      | Ok decoded ->
          let restored = List.hd decoded.identities in
          assert_equal "restored isolation"
            (Agent_workspace.isolation_to_string
               (Agents.identity_isolation restored))
            "worktree"

let test_delete_worktree_message_for_none () =
  assert_true "message mentions worktree"
    (String.length Agent_worktree.delete_worktree_on_none_message > 10)

let test_broker_authorization () =
  let parsed =
    match Agent_git_broker.parse_tokens [ "git"; "status"; "--short" ] with
    | Ok value -> value
    | Error error -> failwith (Agent_git_broker.error_message error)
  in
  match Agent_git_broker.authorize ~read_only:true parsed with
  | Ok _ -> ()
  | Error error -> failwith (Agent_git_broker.error_message error)

let () =
  test_marker_roundtrip_and_match ();
  test_spawn_persists_worktree_binding ();
  test_delete_worktree_message_for_none ();
  test_broker_authorization ();
  print_endline "test_agent_worktree_lifecycle: ok"
