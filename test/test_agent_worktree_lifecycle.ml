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

let test_mutation_authorization_requires_trusted_adapter () =
  match
    Agent_worktree.authorize_mutation ~operation:Provision
      ~main_repository_root:"/repo" ~main_repository_id:"id"
      ~worktree_path:"/wt" ~branch:"taumel/agent/x" ~trusted_adapter:false
  with
  | Authorized _ -> failwith "untrusted adapter must be denied"
  | Denied _ -> ();
  match
    Agent_worktree.authorize_mutation ~operation:Broker
      ~main_repository_root:"/repo" ~main_repository_id:"id"
      ~worktree_path:"/wt" ~branch:"taumel/agent/x" ~trusted_adapter:true
  with
  | Denied message -> failwith message
  | Authorized auth ->
      assert_equal "op"
        (Agent_worktree.lifecycle_op_to_string auth.operation)
        "broker";
      assert_equal "admin" auth.worktree_admin_path "/wt/.git";
      assert_equal "branch ref" auth.branch_ref "refs/heads/taumel/agent/x"

let test_marker_roundtrip_and_match () =
  let marker =
    {
      Agent_worktree.owner_session_id = "owner";
      agent_id = "agent-ab12";
      main_repository_root = "/repo";
      main_repository_id = "id";
      worktree_path = "/home/u/.pi/agent/taumel/worktrees/repo/own/agent-ab12";
      branch = "taumel/agent/repo/own/agent-ab12/deadbeef";
      completed_steps = [ Marker_recorded; Worktree_created ];
      cleanup_incident_id = None;
    }
  in
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
    {
      Capability_profile.model_id = "inherit";
      thinking_level = "medium";
      sandbox_preset = Capability_profile.Workspace_write;
      approval_policy = Capability_profile.On_request;
      tools = Capability_profile.All;
      no_sandbox_allowed = false;
    }
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
                 { Agents.generic = 1; finder = 0; oracle = 0 };
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

let test_broker_and_sandbox_auth_compose () =
  let parsed =
    match Agent_git_broker.parse_tokens [ "git"; "status"; "--short" ] with
    | Ok value -> value
    | Error error -> failwith (Agent_git_broker.error_message error)
  in
  (match Agent_git_broker.authorize ~read_only:true parsed with
  | Ok _ -> ()
  | Error error -> failwith (Agent_git_broker.error_message error));
  let mutation =
    {
      Sandbox.operation = Sandbox.Agent_worktree_broker;
      main_repository_root = "/repo";
      main_repository_id = "id";
      worktree_path = "/wt";
      worktree_admin_path = "/wt/.git";
      branch = "taumel/agent/x";
      branch_ref = "refs/heads/taumel/agent/x";
      object_store_path = "/repo/.git/objects";
    }
  in
  match Sandbox.authorize_agent_worktree_mutation ~trusted_adapter:true mutation with
  | Sandbox.Allow -> ()
  | Sandbox.Deny message -> failwith message
  | Sandbox.Requires_approval _ -> failwith "unexpected approval"

let () =
  test_mutation_authorization_requires_trusted_adapter ();
  test_marker_roundtrip_and_match ();
  test_spawn_persists_worktree_binding ();
  test_delete_worktree_message_for_none ();
  test_broker_and_sandbox_auth_compose ();
  print_endline "test_agent_worktree_lifecycle: ok"
