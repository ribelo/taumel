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

let starts_with ~prefix value =
  let prefix_length = String.length prefix in
  String.length value >= prefix_length
  && String.sub value 0 prefix_length = prefix

let assert_starts_with label ~prefix value =
  if not (starts_with ~prefix value) then
    fail label (Printf.sprintf "expected %S to start with %S" value prefix)

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
    system_prompt = "Use the worker profile prompt.";
    active_tools_snapshot = None;
    sandbox;
    depth = 1;
    lifecycle = Subagents.Running;
  }

let test_agent_child_metadata_uses_core_catalog_rules () =
  let root_sync =
    Tool_catalog.plan_active_tools_sync
      [ "exec_command"; "agent_spawn"; "agent_profiles"; "usage" ]
  in
  assert_bool "root active tools keep agent tools"
    (List.mem "agent_spawn" root_sync.tools
    && List.mem "agent_profiles" root_sync.tools);
  let active_tools =
    Tool_catalog.plan_agent_child_active_tools
      ~worker_tools:(Some [ "bash"; "apply_patch"; "usage"; "agent_spawn" ])
      ~current_active_tools_available:true
      ~current_active_tools:[ "read_thread" ]
  in
  assert_bool "explicit worker tools win"
    (active_tools = Some [ "bash"; "apply_patch"; "usage" ]);
  let inherited =
    Tool_catalog.plan_agent_child_active_tools ~worker_tools:None
      ~current_active_tools_available:true
      ~current_active_tools:[ "bash"; "usage"; "ralph_continue"; "agent_list" ]
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
  assert_bool "metadata agent prompt"
    (object_field "agentSystemPrompt" child.metadata
    = Some (Shared.String "Use the worker profile prompt."));
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
  assert_bool "ready send stores child session"
    (Subagents.plan_child_session_bridge_update ~action:"agent_send"
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

let test_agent_profile_toggle_state () =
  let disabled =
    expect_ok "disable profile"
      (Subagents.set_profile_enabled Subagents.empty_session_state "finder" false)
  in
  assert_bool "finder disabled" (not (Subagents.profile_enabled disabled "finder"));
  assert_bool "other profile defaults enabled"
    (Subagents.profile_enabled disabled "review");
  (match Subagents.set_profile_enabled disabled "plan" false with
  | Error "unknown agent profile: plan" -> ()
  | Error message -> fail "unknown profile" ("unexpected error: " ^ message)
  | Ok _ -> fail "unknown profile" "expected validation error");
  let encoded = Subagents.session_state_codec.encode disabled in
  let decoded =
    expect_ok "toggle codec" (Subagents.session_state_codec.decode encoded)
  in
  assert_bool "codec preserves disabled profile"
    (not (Subagents.profile_enabled decoded "finder"));
  let enabled =
    expect_ok "enable profile" (Subagents.set_profile_enabled decoded "finder" true)
  in
  assert_bool "finder enabled" (Subagents.profile_enabled enabled "finder");
  let scout =
    {
      Subagents.spec_name = "scout";
      spec_description = "Repository scout";
      spec_provider = Subagents.Inherit_string;
      spec_model = Subagents.Inherit_string;
      spec_thinking = Subagents.Inherit_string;
      spec_sandbox = Subagents.Inherit_sandbox;
      spec_tools = Subagents.Inherit_tools;
      spec_prompt = "Inspect directly.";
      spec_source = Subagents.User_markdown "/profiles/scout.md";
    }
  in
  let catalog = Subagents.build_profile_catalog ~live_tools:[] [ scout ] in
  let user_disabled =
    expect_ok "disable user profile"
      (Subagents.set_profile_enabled ~catalog enabled "scout" false)
  in
  assert_bool "user profile disabled"
    (not (Subagents.profile_enabled user_disabled "scout"))

let test_agent_profile_catalog () =
  let catalog = Subagents.default_profile_catalog in
  assert_bool "catalog has finder"
    (Option.is_some (Subagents.find_profile_spec catalog "finder"));
  assert_bool "catalog has no plan"
    (Option.is_none (Subagents.find_profile_spec catalog "plan"));
  let finder =
    match Subagents.find_profile_spec catalog "finder" with
    | Some finder -> finder
    | None -> fail "finder profile" "expected built-in"
  in
  let request =
    {
      Subagents.id = "finder-a1";
      name = "finder";
      prompt = "inspect";
      description = None;
      system_prompt = "";
      model_id = Some "bad/model";
      thinking_level = Some "bad";
      sandbox_preset = Some Capability.Danger_full_access;
      tools = Some (Capability.of_list [ "agent_spawn" ]);
      workspace_roots = [ "/repo" ];
      no_sandbox = true;
    }
  in
  let resolved = Subagents.spawn_request_with_profile finder request in
  assert_bool "profile clears per-call model override" (resolved.model_id = None);
  assert_bool "profile applies system prompt"
    (resolved.system_prompt = finder.spec_prompt);
  assert_bool "profile clears per-call tools override" (resolved.tools = None);
  assert_bool "profile clears no-sandbox" (not resolved.no_sandbox);
  let finder_override =
    {
      Subagents.override_name = "finder";
      override_provider = Subagents.Concrete_string "openai-codex";
      override_model = Subagents.Concrete_string "gpt-override";
      override_thinking = Subagents.Concrete_string "high";
    }
  in
  let override_catalog =
    Subagents.build_profile_catalog ~builtin_overrides:[ finder_override ]
      ~live_tools:[] []
  in
  let overridden_finder =
    match Subagents.find_profile_spec override_catalog "finder" with
    | Some finder -> finder
    | None -> fail "overridden finder profile" "expected built-in"
  in
  let overridden =
    Subagents.spawn_request_with_profile overridden_finder request
  in
  assert_bool "override catalog valid"
    (override_catalog.catalog_errors = []);
  assert_bool "override applies provider-qualified model"
    (overridden.model_id = Some "openai-codex/gpt-override");
  assert_bool "override applies thinking"
    (overridden.thinking_level = Some "high");
  let unknown_override =
    { finder_override with Subagents.override_name = "ghost" }
  in
  let invalid_catalog =
    Subagents.build_profile_catalog ~builtin_overrides:[ unknown_override ]
      ~live_tools:[] []
  in
  assert_bool "unknown built-in override is invalid"
    (invalid_catalog.catalog_errors <> [])

let test_markdown_profile_validation () =
  let markdown =
    String.concat "\n"
      [
        "---";
        "name: scout";
        "description: Fast scanner";
        "provider: inherit";
        "model: inherit";
        "thinking: inherit";
        "sandbox: read-only";
        "tools:";
        "  - exec_command";
        "  - find_thread";
        "---";
        "You inspect the repository directly.";
      ]
  in
  let scout =
    expect_ok "parse markdown profile"
      (Subagents.parse_markdown_profile ~path:"/profiles/scout.md" markdown)
  in
  assert_equal "markdown profile name" "scout" scout.spec_name;
  assert_equal "markdown sandbox" "read-only"
    (Subagents.sandbox_setting_to_summary scout.spec_sandbox);
  let catalog =
    Subagents.build_profile_catalog
      ~live_tools:[ "exec_command"; "find_thread" ]
      [ scout ]
  in
  assert_bool "valid catalog has scout"
    (catalog.catalog_errors = []
    && Option.is_some (Subagents.find_profile_spec catalog "scout"));
  let provider_mismatch =
    String.concat "\n"
      [
        "---";
        "name: mismatch";
        "description: Bad";
        "provider: inherit";
        "model: gpt-x";
        "thinking: inherit";
        "sandbox: inherit";
        "tools: inherit";
        "---";
        "Body";
      ]
  in
  (match
     Subagents.parse_markdown_profile ~path:"/profiles/mismatch.md"
       provider_mismatch
   with
  | Error message when String.contains message 'p' -> ()
  | Error message -> fail "provider mismatch" ("unexpected error: " ^ message)
  | Ok _ -> fail "provider mismatch" "expected error");
  let tau_key =
    String.concat "\n"
      [
        "---";
        "name: tau";
        "description: Bad";
        "provider: inherit";
        "model: inherit";
        "thinking: inherit";
        "sandbox: inherit";
        "tools: inherit";
        "spawns: []";
        "---";
        "Body";
      ]
  in
  (match Subagents.parse_markdown_profile ~path:"/profiles/tau.md" tau_key with
  | Error message when String.contains message 's' -> ()
  | Error message -> fail "tau key" ("unexpected error: " ^ message)
  | Ok _ -> fail "tau key" "expected error");
  let full_access_profile =
    String.concat "\n"
      [
        "---";
        "name: full";
        "description: Bad";
        "provider: inherit";
        "model: inherit";
        "thinking: inherit";
        "sandbox: danger-full-access";
        "tools: inherit";
        "---";
        "Body";
      ]
  in
  (match
     Subagents.parse_markdown_profile ~path:"/profiles/full.md"
       full_access_profile
   with
  | Error "/profiles/full.md: danger-full-access is not allowed for subagent profiles" -> ()
  | Error message -> fail "full-access sandbox" ("unexpected error: " ^ message)
  | Ok _ -> fail "full-access sandbox" "expected error");
  let override = { scout with Subagents.spec_name = "finder" } in
  let invalid =
    Subagents.build_profile_catalog ~live_tools:[ "exec_command" ] [ override ]
  in
  assert_bool "built-in override is invalid" (invalid.catalog_errors <> []);
  let agent_tool =
    { scout with spec_name = "delegator"; spec_tools = Subagents.Concrete_tools [ "agent_spawn" ] }
  in
  let invalid_tools =
    Subagents.build_profile_catalog ~live_tools:[ "agent_spawn" ] [ agent_tool ]
  in
  assert_bool "agent tools are invalid in profile"
    (invalid_tools.catalog_errors <> [])

let test_agent_run_metadata_state () =
  let spawned =
    expect_ok "record spawn"
      (Subagents.record_spawn Subagents.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"finder-a1"
         ~profile_name:"finder" "inspect")
  in
  assert_equal "spawn run id" "finder-a1-run-1" spawned.delivery_run_id;
  assert_equal "spawn submission id" "finder-a1-run-1-submission-1"
    spawned.delivery_submission_id;
  assert_equal "spawn delivery" "started" spawned.delivery_kind;
  let state = spawned.delivery_state in
  assert_bool "agent id used" (Subagents.agent_id_used state "finder-a1");
  let generated_id = Subagents.default_agent_id state "finder" in
  assert_starts_with "generated id prefix" ~prefix:"finder-" generated_id;
  assert_bool "generated id length"
    (String.length generated_id = String.length "finder-" + 4);
  let parent_a_id =
    Subagents.default_agent_id ~scope:"parent-a" Subagents.empty_session_state
      "finder"
  in
  let parent_b_id =
    Subagents.default_agent_id ~scope:"parent-b" Subagents.empty_session_state
      "finder"
  in
  assert_bool "generated id includes parent scope" (parent_a_id <> parent_b_id);
  let generated =
    expect_ok "record generated spawn"
      (Subagents.record_spawn state ~now:11 ~parent_session_id:"parent"
         ~agent_id:generated_id ~profile_name:"finder" "generated")
  in
  assert_bool "generated id persisted"
    (Subagents.agent_id_used generated.delivery_state generated_id);
  let retry_generated_id = Subagents.default_agent_id generated.delivery_state "finder" in
  assert_bool "generated id retries on collision"
    (retry_generated_id <> generated_id);
  (match
     Subagents.record_spawn state ~now:11 ~parent_session_id:"parent"
       ~agent_id:"Finder_bad" ~profile_name:"finder" "bad id"
   with
  | Error message when starts_with ~prefix:"invalid agent_id" message -> ()
  | Error message -> fail "invalid agent id" ("unexpected error: " ^ message)
  | Ok _ -> fail "invalid agent id" "expected validation error");
  (match
     Subagents.record_spawn state ~now:11 ~parent_session_id:"parent"
       ~agent_id:"finder-a1" ~profile_name:"finder" "again"
   with
  | Error "agent id was already used in this session: finder-a1" -> ()
  | Error message -> fail "duplicate agent id" ("unexpected error: " ^ message)
  | Ok _ -> fail "duplicate agent id" "expected error");
  let sent =
    expect_ok "record send"
      (Subagents.record_send state ~now:12 ~agent_id:"finder-a1" "continue")
  in
  assert_equal "send steers active run" "steered" sent.delivery_kind;
  assert_equal "send steered delivery mode" "steer"
    (Subagents.dispatch_deliver_as_for_delivery_kind sent.delivery_kind);
  assert_equal "send keeps run" spawned.delivery_run_id sent.delivery_run_id;
  assert_equal "send submission id" "finder-a1-run-1-submission-2"
    sent.delivery_submission_id;
  let interrupted =
    expect_ok "record interrupted send"
      (Subagents.record_send state ~now:12 ~agent_id:"finder-a1"
         ~interrupt:true "replace")
  in
  assert_equal "interrupted send starts next run" "finder-a1-run-2"
    interrupted.delivery_run_id;
  assert_equal "interrupted send delivery" "started" interrupted.delivery_kind;
  assert_equal "started delivery mode" "followUp"
    (Subagents.dispatch_deliver_as_for_delivery_kind interrupted.delivery_kind);
  assert_bool "interrupted send reports previous status"
    (interrupted.delivery_previous_status = Some Subagents.Run_running);
  (match Subagents.find_run interrupted.delivery_state "finder-a1-run-1" with
  | Some run ->
      assert_bool "interrupted send cancels old run"
        (run.run_status = Subagents.Run_cancelled);
      assert_bool "interrupted send reason"
        (run.run_reason = Some "interrupted_by_parent")
  | None -> fail "interrupted old run" "expected run");
  let closed =
    expect_ok "record close"
      (Subagents.record_close sent.delivery_state ~now:13 ~agent_id:"finder-a1")
  in
  (match Subagents.latest_run closed "finder-a1" with
  | Some run ->
      assert_bool "close cancels active run"
        (run.run_status = Subagents.Run_cancelled);
      assert_bool "close reason"
        (run.run_reason = Some "closed_by_parent")
  | None -> fail "closed latest run" "expected run");
  let decoded =
    expect_ok "agent metadata codec"
      (Subagents.session_state_codec.decode
         (Subagents.session_state_codec.encode closed))
  in
  assert_bool "codec preserves identity"
    (Subagents.agent_id_used decoded "finder-a1");
  let lost = Subagents.mark_active_runs_lost state in
  (match Subagents.latest_run lost "finder-a1" with
  | Some run ->
      assert_bool "resume marks running lost" (run.run_status = Subagents.Run_lost)
  | None -> fail "lost latest run" "expected run")

let test_agent_identity_snapshot_state () =
  let spawned =
    expect_ok "snapshot spawn"
      (Subagents.record_spawn Subagents.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"snapshot-a1"
         ~profile_name:"finder" ~profile_snapshot:profile
         ~sandbox_snapshot:sandbox ~system_prompt:"Snapshot prompt" "inspect")
  in
  let started =
    expect_ok "record child session start"
      (Subagents.record_child_session_start spawned.delivery_state
         ~agent_id:"snapshot-a1" ~child_session_id:"child-1"
         ~active_tools:[ "exec_command"; "write_stdin" ] ())
  in
  let decoded =
    expect_ok "snapshot codec"
      (Subagents.session_state_codec.decode
         (Subagents.session_state_codec.encode started))
  in
  let identity =
    match Subagents.find_identity decoded "snapshot-a1" with
    | Some identity -> identity
    | None -> fail "snapshot identity" "expected identity"
  in
  assert_bool "snapshot child id persisted"
    (identity.identity_child_session_id = Some "child-1");
  assert_bool "snapshot prompt persisted"
    (identity.identity_system_prompt = "Snapshot prompt");
  assert_bool "snapshot active tools persisted"
    (identity.identity_active_tools = Some [ "exec_command"; "write_stdin" ]);
  let live = Subagents.mark_active_runs_lost ~live_agent_ids:[ "snapshot-a1" ] decoded in
  (match Subagents.find_identity live "snapshot-a1" with
  | Some identity ->
      assert_bool "session switch keeps live child id"
        (identity.identity_child_session_id = Some "child-1")
  | None -> fail "live snapshot identity" "expected identity");
  (match Subagents.find_run live "snapshot-a1-run-1" with
  | Some run ->
      assert_bool "session switch keeps live run running"
        (run.run_status = Subagents.Run_running)
  | None -> fail "live snapshot run" "expected run");
  let owner : Subagents.owner = { id = "parent"; is_subagent = false; depth = 0 } in
  let worker =
    expect_ok "worker from snapshot"
      (Subagents.worker_of_identity_snapshot ~owner identity)
  in
  assert_equal "snapshot worker model" profile.model_id worker.profile.model_id;
  assert_bool "snapshot worker active tools"
    (worker.active_tools_snapshot = Some [ "exec_command"; "write_stdin" ]);
  assert_bool "snapshot worker prompt"
    (worker.system_prompt = "Snapshot prompt");
  let lost = Subagents.mark_active_runs_lost decoded in
  match Subagents.find_identity lost "snapshot-a1" with
  | Some identity ->
      assert_bool "resume clears stale child id"
        (identity.identity_child_session_id = None)
  | None -> fail "lost snapshot identity" "expected identity"

let test_agent_wait_state () =
  let spawned =
    expect_ok "wait spawn"
      (Subagents.record_spawn Subagents.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"finder-a1"
         ~profile_name:"finder" "inspect")
  in
  let active =
    Subagents.wait_for_selector spawned.delivery_state ~parent_session_id:"parent"
      Subagents.Wait_all_active
  in
  assert_equal "wait active message" "finder-a1 finder-a1-run-1 [running]"
    active.wait_message;
  assert_bool "wait pins active run ids"
    (active.wait_active_run_ids = [ "finder-a1-run-1" ]);
  let completed =
    expect_ok "complete run"
      (Subagents.record_run_completion spawned.delivery_state ~now:20
         ~run_id:"finder-a1-run-1" ~status:Subagents.Run_completed
         ~final_output:"done" ())
  in
  let waited =
    Subagents.wait_for_selector completed ~parent_session_id:"parent"
      (Subagents.Wait_run_ids [ "finder-a1-run-1" ])
  in
  (match waited.wait_items with
  | [ item ] ->
      assert_equal "wait terminal status" "completed" item.wait_status;
      assert_bool "wait terminal consumed" item.wait_consumed
  | _ -> fail "wait terminal item" "expected one item");
  assert_equal "wait terminal message includes output"
    "finder-a1 finder-a1-run-1 [completed]\n\ndone" waited.wait_message;
  assert_bool "terminal wait has no active run ids"
    (waited.wait_active_run_ids = []);
  (match Subagents.find_run waited.wait_state "finder-a1-run-1" with
  | Some run -> assert_bool "wait marks run consumed" run.run_consumed
  | None -> fail "wait consumed run" "expected run");
  let no_active =
    Subagents.wait_for_selector waited.wait_state ~parent_session_id:"parent"
      (Subagents.Wait_agent_ids [ "finder-a1" ])
  in
  (match no_active.wait_items with
  | [ item ] -> assert_equal "no active status" "no_active_run" item.wait_status
  | _ -> fail "no active item" "expected one item")

let test_agent_stop_and_output_state () =
  let spawned =
    expect_ok "stop spawn"
      (Subagents.record_spawn Subagents.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"finder-a1"
         ~profile_name:"finder" "inspect")
  in
  let stopped, changed =
    expect_ok "stop agent"
      (Subagents.record_stop_agent spawned.delivery_state ~now:11
         ~agent_id:"finder-a1")
  in
  assert_bool "stop changed active run" changed;
  (match Subagents.latest_run stopped "finder-a1" with
  | Some run ->
      assert_bool "stop cancels run" (run.run_status = Subagents.Run_cancelled);
      assert_bool "stop reason"
        (run.run_reason = Some "stopped_by_parent")
  | None -> fail "stopped run" "expected run");
  let completed =
    expect_ok "complete for output"
      (Subagents.record_run_completion spawned.delivery_state ~now:12
         ~run_id:"finder-a1-run-1" ~status:Subagents.Run_completed
         ~final_output:"done" ())
  in
  (match
     Subagents.output_run_for_target completed ~parent_session_id:"parent"
       "finder-a1"
   with
  | Ok run ->
      assert_equal "output picks latest run" "finder-a1-run-1" run.run_id;
      assert_bool "output has final" (run.run_final_output = Some "done")
  | Error message -> fail "output target" message);
  (match
     Subagents.output_run_for_target completed ~parent_session_id:"other"
       "finder-a1-run-1"
   with
  | Error "run is not owned by this session: finder-a1-run-1" -> ()
  | Error message -> fail "output ownership" ("unexpected error: " ^ message)
  | Ok _ -> fail "output ownership" "expected ownership error")

let () =
  test_agent_child_metadata_uses_core_catalog_rules ();
  test_agent_bridge_update_requires_created_child ();
  test_agent_profile_toggle_state ();
  test_agent_profile_catalog ();
  test_markdown_profile_validation ();
  test_agent_run_metadata_state ();
  test_agent_identity_snapshot_state ();
  test_agent_wait_state ();
  test_agent_stop_and_output_state ()
