module Capability = Taumel.Capability_profile
module Sandbox = Taumel.Sandbox
module Shared = Taumel.Shared
module Subagents = Taumel.Subagents
module Tool_catalog = Taumel.Tool_catalog

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let expect_ok label = function
  | Ok value -> value
  | Error message -> fail label message

let object_field name = function
  | Shared.Object fields -> List.assoc_opt name fields
  | _ -> None

let string_array = function
  | Some (Shared.Array values) ->
      List.filter_map
        (function Shared.String value -> Some value | _ -> None)
        values
  | _ -> []

let profile =
  {
    Capability.default with
    model_id = "openai-codex/gpt-worker";
    thinking_level = "high";
    tools = Capability.of_list [ "bash"; "write"; "find_thread" ];
  }

let sandbox =
  {
    Sandbox.filesystem_mode = Sandbox.Workspace_write;
    workspace_roots = [ "/repo" ];
    network_mode = Sandbox.Network_disabled;
    approval_policy = Sandbox.On_request;
    no_sandbox = false;
    subagent = true;
  }

let worker =
  {
    Subagents.id = "worker-1";
    parent_id = Some "root";
    definition_name = "worker";
    profile;
    sandbox;
    depth = 1;
    lifecycle = Subagents.Running;
  }

let test_agent_child_metadata_uses_core_catalog_rules () =
  let active_tools =
    Tool_catalog.plan_agent_child_active_tools
      ~worker_tools:(Some [ "bash"; "apply_patch"; "usage" ])
      ~current_active_tools_available:true
      ~current_active_tools:[ "read_thread" ]
  in
  assert_bool "explicit worker tools win"
    (active_tools = Some [ "exec_command"; "write_stdin"; "edit"; "write" ]);
  let inherited =
    Tool_catalog.plan_agent_child_active_tools ~worker_tools:None
      ~current_active_tools_available:true
      ~current_active_tools:[ "bash"; "usage"; "ralph_continue" ]
  in
  assert_bool "inherited tools are rewritten"
    (inherited = Some [ "exec_command"; "write_stdin" ]);
  let child =
    expect_ok "child session metadata"
      (Subagents.plan_child_session_spawn ~prompt:"inspect repo" worker
         ~active_tools:inherited)
  in
  assert_equal "worker id" "worker-1" child.worker_id;
  assert_equal "prompt" "inspect repo" child.prompt;
  assert_bool "metadata kind"
    (object_field "kind" child.metadata = Some (Shared.String "agent"));
  assert_bool "metadata worker"
    (object_field "workerId" child.metadata = Some (Shared.String "worker-1"));
  assert_bool "metadata sandbox"
    (object_field "sandbox" child.metadata
    = Some (Shared.String "workspace-write"));
  assert_bool "metadata profile"
    (match object_field "capabilityProfile" child.metadata with
    | Some (Shared.Object _) -> true
    | _ -> false);
  assert_bool "metadata active tools"
    (string_array (object_field "activeTools" child.metadata)
    = [ "exec_command"; "write_stdin" ])

let ready_bridge =
  {
    Subagents.session_id = Some "child";
    cancelled = false;
    error = None;
  }

let test_agent_bridge_update_requires_created_child () =
  assert_bool "ready spawn stores child session"
    (Subagents.plan_child_session_bridge_update ~action:"agent_spawn"
       ~prepared_worker_id:"worker-1" ~worker_id:(Some "worker-1")
       ~bridge:(Some ready_bridge)
    = Subagents.Store_child_session "worker-1");
  let cancelled = { ready_bridge with Subagents.cancelled = true } in
  assert_bool "cancelled spawn stores nothing"
    (Subagents.plan_child_session_bridge_update ~action:"agent_spawn"
       ~prepared_worker_id:"worker-1" ~worker_id:(Some "worker-1")
       ~bridge:(Some cancelled)
    = Subagents.No_bridge_update);
  let missing = { ready_bridge with Subagents.session_id = None } in
  assert_bool "missing session stores nothing"
    (Subagents.plan_child_session_bridge_update ~action:"agent_spawn"
       ~prepared_worker_id:"worker-1" ~worker_id:None ~bridge:(Some missing)
    = Subagents.No_bridge_update);
  assert_bool "close deletes child session"
    (Subagents.plan_child_session_bridge_update ~action:"agent_close"
       ~prepared_worker_id:" worker-1 " ~worker_id:None ~bridge:None
    = Subagents.Delete_child_session "worker-1")

let () =
  test_agent_child_metadata_uses_core_catalog_rules ();
  test_agent_bridge_update_requires_created_child ()
