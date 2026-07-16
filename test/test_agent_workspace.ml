open Taumel

let assert_equal label expected actual =
  if expected <> actual then
    failwith (label ^ ": expected " ^ expected ^ ", got " ^ actual)

let assert_true label value =
  if not value then failwith (label ^ ": expected true")

let assert_error label = function
  | Ok _ -> failwith (label ^ ": expected error")
  | Error _ -> ()

let contains ~needle haystack =
  let needle_len = String.length needle in
  let hay_len = String.length haystack in
  let rec loop index =
    if index + needle_len > hay_len then false
    else if String.sub haystack index needle_len = needle then true
    else loop (index + 1)
  in
  loop 0

let test_isolation_modes_and_defaults () =
  assert_equal "none"
    (Agent_workspace.isolation_to_string Agent_workspace.None)
    "none";
  assert_equal "worktree"
    (Agent_workspace.isolation_to_string Agent_workspace.Worktree)
    "worktree";
  assert_equal "default isolation"
    (Agent_workspace.isolation_to_string Agent_workspace.default_isolation)
    "none";
  (match Agent_workspace.isolation_of_string "worktree" with
  | Ok Agent_workspace.Worktree -> ()
  | _ -> failwith "worktree parse");
  (match Agent_workspace.isolation_of_string "none" with
  | Ok Agent_workspace.None -> ()
  | _ -> failwith "none parse");
  assert_error "unknown isolation"
    (Agent_workspace.isolation_of_string "tmp")

let test_shared_binding_effective_workspace () =
  let binding = Agent_workspace.shared ~source_root:"/tmp/project" in
  assert_equal "isolation"
    (Agent_workspace.isolation_to_string
       (Agent_workspace.isolation_of_binding binding))
    "none";
  assert_equal "source" (Agent_workspace.source_workspace binding) "/tmp/project";
  match Agent_workspace.effective_workspace binding with
  | Ok path -> assert_equal "effective shared" path "/tmp/project"
  | Error message -> failwith message

let test_worktree_binding_derives_path_and_branch () =
  let binding =
    Agent_workspace.worktree ~source_origin:"/tmp/linked-worktree"
      ~main_repository_root:"/tmp/project" ~main_repository_id:"repo-abc"
  in
  match
    Agent_workspace.derive ~agent_home:"/home/u/.pi/agent"
      ~owner_session_id:"session-42" ~agent_id:"agent-ab12" binding
  with
  | Error message -> failwith message
  | Ok derived ->
      assert_equal "isolation"
        (Agent_workspace.isolation_to_string derived.isolation)
        "worktree";
      assert_equal "project name" derived.project_name "project";
      assert_equal "worktree path" derived.worktree_path
        ("/home/u/.pi/agent/taumel/worktrees/project/"
       ^ derived.owner_component ^ "/agent-ab12");
      assert_true "owner component is filesystem-safe"
        (String.for_all
           (function
             | 'a' .. 'z' | '0' .. '9' | '-' | '_' -> true | _ -> false)
           derived.owner_component);
      assert_true "owner component is non-empty"
        (String.length derived.owner_component >= 12);
      assert_true "branch prefix"
        (contains ~needle:"taumel/agent/project/" derived.branch);
      assert_true "branch contains agent id"
        (contains ~needle:"agent-ab12" derived.branch);
      assert_true "branch contains owner component"
        (contains ~needle:derived.owner_component derived.branch)

let test_owner_component_is_deterministic_and_non_reversible () =
  let a = Agent_workspace.owner_component "owner-session-xyz" in
  let b = Agent_workspace.owner_component "owner-session-xyz" in
  let c = Agent_workspace.owner_component "owner-session-other" in
  assert_equal "deterministic" a b;
  assert_true "collision resistant distinct owners" (a <> c);
  assert_true "not the raw owner id" (a <> "owner-session-xyz")

let test_project_name_from_main_repo_root () =
  assert_equal "basename"
    (Agent_workspace.project_name_of_repository_root "/var/repos/my-app")
    "my-app";
  assert_equal "trailing slash"
    (Agent_workspace.project_name_of_repository_root "/var/repos/my-app/")
    "my-app"

let test_shared_binding_json_roundtrip () =
  let binding = Agent_workspace.shared ~source_root:"/tmp/project" in
  match
    Agent_workspace.binding_of_json (Agent_workspace.binding_to_json binding)
  with
  | Error message -> failwith message
  | Ok decoded ->
      assert_equal "shared source"
        (Agent_workspace.source_workspace decoded)
        "/tmp/project";
      assert_equal "shared isolation"
        (Agent_workspace.isolation_to_string
           (Agent_workspace.isolation_of_binding decoded))
        "none"

let test_worktree_binding_json_roundtrip () =
  let binding =
    Agent_workspace.worktree ~source_origin:"/tmp/wt"
      ~main_repository_root:"/tmp/repo" ~main_repository_id:"id-1"
  in
  match
    Agent_workspace.binding_of_json (Agent_workspace.binding_to_json binding)
  with
  | Error message -> failwith message
  | Ok decoded ->
      assert_equal "worktree isolation"
        (Agent_workspace.isolation_to_string
           (Agent_workspace.isolation_of_binding decoded))
        "worktree";
      assert_equal "source origin"
        (Agent_workspace.source_workspace decoded)
        "/tmp/wt"

let () =
  test_isolation_modes_and_defaults ();
  test_shared_binding_effective_workspace ();
  test_worktree_binding_derives_path_and_branch ();
  test_owner_component_is_deterministic_and_non_reversible ();
  test_project_name_from_main_repo_root ();
  test_shared_binding_json_roundtrip ();
  test_worktree_binding_json_roundtrip ();
  print_endline "test_agent_workspace: ok"
