module Capability = Taumel.Capability_profile
module Sandbox = Taumel.Sandbox
module Shared = Taumel.Shared
module Subagents = Taumel.Subagents
module Agent_profiles = Taumel.Agent_profiles
module Agent_runs = Taumel.Agent_runs
module Agent_runs_codec = Taumel.Agent_runs_codec
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
      ~worker_tools:
        (Some
           [ "bash"; "apply_patch"; "usage"; "agent_spawn"; "create_goal" ])
      ~current_active_tools_available:true
      ~current_active_tools:[ "read_thread" ]
  in
  assert_bool "explicit worker tools win"
    (active_tools = Some [ "bash"; "apply_patch"; "usage"; "update_goal" ]);
  let inherited =
    Tool_catalog.plan_agent_child_active_tools ~worker_tools:None
      ~current_active_tools_available:true
      ~current_active_tools:
        [ "bash"; "usage"; "ralph_continue"; "agent_list"; "create_goal" ]
  in
  assert_bool "inherited tools are rewritten"
    (inherited = Some [ "exec_command"; "write_stdin"; "update_goal" ]);
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
  assert_bool "metadata child goal objective"
    (object_field "initialGoalObjective" child.metadata
    = Some (Shared.String "inspect repo"));
  assert_bool "metadata active tools"
    (string_array (object_field "activeTools" child.metadata)
    = [ "exec_command"; "write_stdin"; "update_goal" ]);
  let recreated_for_message =
    expect_ok "message child session metadata"
      (Subagents.plan_child_session_spawn_from_input ~prompt:"plain message"
         {
           worker_id = worker.id;
           profile_name = worker.definition_name;
           depth = worker.depth;
           filesystem_mode = worker.sandbox.filesystem_mode;
           no_sandbox = worker.sandbox.no_sandbox;
           subagent = worker.sandbox.subagent;
           profile = worker.profile;
           system_prompt = worker.system_prompt;
           active_tools = inherited;
         })
  in
  assert_bool "message recreate has no child goal objective"
    (object_field "initialGoalObjective" recreated_for_message.metadata = None)

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
      (Agent_runs.set_profile_enabled Agent_runs.empty_session_state "finder" false)
  in
  assert_bool "finder disabled" (not (Agent_runs.profile_enabled disabled "finder"));
  assert_bool "other profile defaults enabled"
    (Agent_runs.profile_enabled disabled "review");
  (match Agent_runs.set_profile_enabled disabled "plan" false with
  | Error "unknown agent profile: plan" -> ()
  | Error message -> fail "unknown profile" ("unexpected error: " ^ message)
  | Ok _ -> fail "unknown profile" "expected validation error");
  let encoded = Agent_runs_codec.session_state_codec.encode disabled in
  let decoded =
    expect_ok "toggle codec" (Agent_runs_codec.session_state_codec.decode encoded)
  in
  assert_bool "codec preserves disabled profile"
    (not (Agent_runs.profile_enabled decoded "finder"));
  let enabled =
    expect_ok "enable profile" (Agent_runs.set_profile_enabled decoded "finder" true)
  in
  assert_bool "finder enabled" (Agent_runs.profile_enabled enabled "finder");
  let scout =
    {
      Agent_profiles.spec_name = "scout";
      spec_description = "Repository scout";
      spec_provider = Agent_profiles.Inherit_string;
      spec_model = Agent_profiles.Inherit_string;
      spec_thinking = Agent_profiles.Inherit_string;
      spec_sandbox = Agent_profiles.Inherit_sandbox;
      spec_tools = Agent_profiles.Inherit_tools;
      spec_prompt = "Inspect directly.";
      spec_source = Agent_profiles.User_markdown "/profiles/scout.md";
    }
  in
  let catalog = Agent_profiles.build_profile_catalog ~live_tools:[] [ scout ] in
  let user_disabled =
    expect_ok "disable user profile"
      (Agent_runs.set_profile_enabled ~catalog enabled "scout" false)
  in
  assert_bool "user profile disabled"
    (not (Agent_runs.profile_enabled user_disabled "scout"))

let test_agent_profile_catalog () =
  let catalog = Agent_profiles.default_profile_catalog in
  assert_bool "catalog has finder"
    (Option.is_some (Agent_profiles.find_profile_spec catalog "finder"));
  assert_bool "catalog has no plan"
    (Option.is_none (Agent_profiles.find_profile_spec catalog "plan"));
  let finder =
    match Agent_profiles.find_profile_spec catalog "finder" with
    | Some finder -> finder
    | None -> fail "finder profile" "expected built-in"
  in
  let request =
    {
      Subagents.id = "finder-a1";
      name = "finder";
      prompt = "inspect";
      create_goal = false;
      system_prompt = "";
      model_id = Some "bad/model";
      thinking_level = Some "bad";
      sandbox_preset = Some Capability.Danger_full_access;
      tools = Some (Capability.of_list [ "agent_spawn" ]);
      workspace_roots = [ "/repo" ];
      no_sandbox = true;
    }
  in
  let resolved = Agent_profiles.spawn_request_with_profile finder request in
  assert_bool "profile clears per-call model override" (resolved.model_id = None);
  assert_bool "profile applies system prompt"
    (resolved.system_prompt = finder.spec_prompt);
  assert_bool "profile clears per-call tools override" (resolved.tools = None);
  assert_bool "profile clears no-sandbox" (not resolved.no_sandbox);
  let finder_override =
    {
      Agent_profiles.override_name = "finder";
      override_provider = Agent_profiles.Concrete_string "openai-codex";
      override_model = Agent_profiles.Concrete_string "gpt-override";
      override_thinking = Agent_profiles.Concrete_string "high";
    }
  in
  let override_catalog =
    Agent_profiles.build_profile_catalog ~builtin_overrides:[ finder_override ]
      ~live_tools:[] []
  in
  let overridden_finder =
    match Agent_profiles.find_profile_spec override_catalog "finder" with
    | Some finder -> finder
    | None -> fail "overridden finder profile" "expected built-in"
  in
  let overridden =
    Agent_profiles.spawn_request_with_profile overridden_finder request
  in
  assert_bool "override catalog valid"
    (override_catalog.catalog_errors = []);
  assert_bool "override applies provider-qualified model"
    (overridden.model_id = Some "openai-codex/gpt-override");
  assert_bool "override applies thinking"
    (overridden.thinking_level = Some "high");
  let unknown_override =
    { finder_override with Agent_profiles.override_name = "ghost" }
  in
  let invalid_catalog =
    Agent_profiles.build_profile_catalog ~builtin_overrides:[ unknown_override ]
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
      (Agent_profiles.parse_markdown_profile ~path:"/profiles/scout.md" markdown)
  in
  assert_equal "markdown profile name" "scout" scout.spec_name;
  assert_equal "markdown sandbox" "read-only"
    (Agent_profiles.sandbox_setting_to_summary scout.spec_sandbox);
  let catalog =
    Agent_profiles.build_profile_catalog
      ~live_tools:[ "exec_command"; "find_thread" ]
      [ scout ]
  in
  assert_bool "valid catalog has scout"
    (catalog.catalog_errors = []
    && Option.is_some (Agent_profiles.find_profile_spec catalog "scout"));
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
     Agent_profiles.parse_markdown_profile ~path:"/profiles/mismatch.md"
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
  (match Agent_profiles.parse_markdown_profile ~path:"/profiles/tau.md" tau_key with
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
     Agent_profiles.parse_markdown_profile ~path:"/profiles/full.md"
       full_access_profile
   with
  | Error "/profiles/full.md: danger-full-access is not allowed for subagent profiles" -> ()
  | Error message -> fail "full-access sandbox" ("unexpected error: " ^ message)
  | Ok _ -> fail "full-access sandbox" "expected error");
  let override = { scout with Agent_profiles.spec_name = "finder" } in
  let invalid =
    Agent_profiles.build_profile_catalog ~live_tools:[ "exec_command" ] [ override ]
  in
  assert_bool "built-in override is invalid" (invalid.catalog_errors <> []);
  let agent_tool =
    { scout with spec_name = "delegator"; spec_tools = Agent_profiles.Concrete_tools [ "agent_spawn" ] }
  in
  let invalid_tools =
    Agent_profiles.build_profile_catalog ~live_tools:[ "agent_spawn" ] [ agent_tool ]
  in
  assert_bool "agent tools are invalid in profile"
    (invalid_tools.catalog_errors <> [])

let test_agent_run_metadata_state () =
  let spawned =
    expect_ok "record spawn"
      (Agent_runs.record_spawn Agent_runs.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"finder-a1"
         ~profile_name:"finder" "inspect")
  in
  assert_equal "spawn run id" "finder-a1-run-1" spawned.delivery_run_id;
  assert_equal "spawn submission id" "finder-a1-run-1-submission-1"
    spawned.delivery_submission_id;
  assert_equal "spawn delivery" "started" spawned.delivery_kind;
  let state = spawned.delivery_state in
  assert_bool "agent id used" (Agent_runs.agent_id_used state "finder-a1");
  let generated_id = Agent_runs.default_agent_id state "finder" in
  assert_starts_with "generated id prefix" ~prefix:"finder-" generated_id;
  assert_bool "generated id length"
    (String.length generated_id = String.length "finder-" + 4);
  let parent_a_id =
    Agent_runs.default_agent_id ~scope:"parent-a" Agent_runs.empty_session_state
      "finder"
  in
  let parent_b_id =
    Agent_runs.default_agent_id ~scope:"parent-b" Agent_runs.empty_session_state
      "finder"
  in
  assert_bool "generated id includes parent scope" (parent_a_id <> parent_b_id);
  let generated =
    expect_ok "record generated spawn"
      (Agent_runs.record_spawn state ~now:11 ~parent_session_id:"parent"
         ~agent_id:generated_id ~profile_name:"finder" "generated")
  in
  assert_bool "generated id persisted"
    (Agent_runs.agent_id_used generated.delivery_state generated_id);
  let retry_generated_id = Agent_runs.default_agent_id generated.delivery_state "finder" in
  assert_bool "generated id retries on collision"
    (retry_generated_id <> generated_id);
  (match
     Agent_runs.record_spawn state ~now:11 ~parent_session_id:"parent"
       ~agent_id:"Finder_bad" ~profile_name:"finder" "bad id"
   with
  | Error message when starts_with ~prefix:"invalid agent_id" message -> ()
  | Error message -> fail "invalid agent id" ("unexpected error: " ^ message)
  | Ok _ -> fail "invalid agent id" "expected validation error");
  (match
     Agent_runs.record_spawn state ~now:11 ~parent_session_id:"parent"
       ~agent_id:"finder-a1" ~profile_name:"finder" "again"
   with
  | Error "agent id was already used in this session: finder-a1" -> ()
  | Error message -> fail "duplicate agent id" ("unexpected error: " ^ message)
  | Ok _ -> fail "duplicate agent id" "expected error");
  let sent =
    expect_ok "record send"
      (Agent_runs.record_send state ~now:12 ~agent_id:"finder-a1" "continue")
  in
  assert_equal "send steers active run" "steered" sent.delivery_kind;
  assert_equal "send steered delivery mode" "steer"
    (Agent_runs.dispatch_deliver_as_for_delivery_kind sent.delivery_kind);
  assert_equal "send keeps run" spawned.delivery_run_id sent.delivery_run_id;
  assert_equal "send submission id" "finder-a1-run-1-submission-2"
    sent.delivery_submission_id;
  let same_second_interrupted =
    expect_ok "record same-second interrupted send"
      (Agent_runs.record_send state ~now:10 ~agent_id:"finder-a1"
         ~interrupt:true "priority in same second")
  in
  (match Agent_runs.latest_run same_second_interrupted.delivery_state "finder-a1" with
  | Some run ->
      assert_equal "priority interrupt keeps same run" "finder-a1-run-1"
        run.run_id
  | None -> fail "same-second latest run" "expected run");
  let interrupted =
    expect_ok "record interrupted send"
      (Agent_runs.record_send state ~now:12 ~agent_id:"finder-a1"
         ~interrupt:true "priority")
  in
  assert_equal "interrupted send keeps run" "finder-a1-run-1"
    interrupted.delivery_run_id;
  assert_equal "interrupted send delivery" "interrupted" interrupted.delivery_kind;
  assert_equal "interrupted delivery mode" "steer"
    (Agent_runs.dispatch_deliver_as_for_delivery_kind interrupted.delivery_kind);
  assert_bool "interrupted send reports previous status"
    (interrupted.delivery_previous_status = Some Agent_runs.Run_running);
  (match Agent_runs.find_run interrupted.delivery_state "finder-a1-run-1" with
  | Some run ->
      assert_bool "interrupted send keeps running"
        (run.run_status = Agent_runs.Run_running);
      assert_bool "interrupted send appends submission"
        (List.length run.run_submissions = 2)
  | None -> fail "interrupted run" "expected run");
  let suspended =
    expect_ok "record interrupt-only send"
      (Agent_runs.record_send state ~now:12 ~agent_id:"finder-a1"
         ~interrupt:true "")
  in
  assert_equal "interrupt-only keeps run" "finder-a1-run-1"
    suspended.delivery_run_id;
  assert_equal "interrupt-only delivery" "suspended" suspended.delivery_kind;
  (match Agent_runs.find_run suspended.delivery_state "finder-a1-run-1" with
  | Some run ->
      assert_bool "interrupt-only suspends run"
        (run.run_status = Agent_runs.Run_suspended);
      assert_bool "interrupt-only reason"
        (run.run_reason = Some "interrupted_by_parent")
  | None -> fail "suspended run" "expected run");
  let resumed =
    expect_ok "record suspended resume"
      (Agent_runs.record_send suspended.delivery_state ~now:13
         ~agent_id:"finder-a1" "resume")
  in
  assert_equal "resume keeps run" "finder-a1-run-1" resumed.delivery_run_id;
  assert_equal "resume delivery" "resumed" resumed.delivery_kind;
  (match Agent_runs.find_run resumed.delivery_state "finder-a1-run-1" with
  | Some run ->
      assert_bool "resume marks running"
        (run.run_status = Agent_runs.Run_running);
      assert_bool "resume appends submission"
        (List.length run.run_submissions = 2)
  | None -> fail "resumed run" "expected run");
  let idle =
    expect_ok "complete run for idle send"
      (Agent_runs.record_run_completion state ~now:14
         ~run_id:"finder-a1-run-1" ~status:Agent_runs.Run_completed ())
  in
  let idle_interrupt =
    expect_ok "record idle interrupt-only send"
      (Agent_runs.record_send idle ~now:15 ~agent_id:"finder-a1"
         ~interrupt:true "")
  in
  assert_equal "idle interrupt has no run" "" idle_interrupt.delivery_run_id;
  assert_equal "idle interrupt has no submission" ""
    idle_interrupt.delivery_submission_id;
  assert_equal "idle interrupt delivery" "no_active_run"
    idle_interrupt.delivery_kind;
  assert_bool "idle interrupt preserves run list"
    (List.length idle_interrupt.delivery_state.runs = List.length idle.runs);
  let closed =
    expect_ok "record close"
      (Agent_runs.record_close sent.delivery_state ~now:13 ~agent_id:"finder-a1")
  in
  (match Agent_runs.latest_run closed "finder-a1" with
  | Some run ->
      assert_bool "close cancels active run"
        (run.run_status = Agent_runs.Run_cancelled);
      assert_bool "close reason"
        (run.run_reason = Some "closed_by_parent")
  | None -> fail "closed latest run" "expected run");
  let decoded =
    expect_ok "agent metadata codec"
      (Agent_runs_codec.session_state_codec.decode
         (Agent_runs_codec.session_state_codec.encode closed))
  in
  assert_bool "codec preserves identity"
    (Agent_runs.agent_id_used decoded "finder-a1");
  let lost = Agent_runs.mark_active_runs_lost state in
  (match Agent_runs.latest_run lost "finder-a1" with
  | Some run ->
      assert_bool "resume marks running lost" (run.run_status = Agent_runs.Run_lost)
  | None -> fail "lost latest run" "expected run")

let test_agent_identity_snapshot_state () =
  let spawned =
    expect_ok "snapshot spawn"
      (Agent_runs.record_spawn Agent_runs.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"snapshot-a1"
         ~profile_name:"finder" ~profile_snapshot:profile
         ~sandbox_snapshot:sandbox ~system_prompt:"Snapshot prompt" "inspect")
  in
  let snapshotted =
    expect_ok "record active tools snapshot"
      (Agent_runs.record_active_tools_snapshot spawned.delivery_state
         ~agent_id:"snapshot-a1"
         ~active_tools:[ "exec_command"; "write_stdin" ])
  in
  let started =
    expect_ok "record child session start"
      (Agent_runs.record_child_session_start snapshotted
         ~agent_id:"snapshot-a1" ~child_session_id:"child-1" ())
  in
  (match Agent_runs.find_identity started "snapshot-a1" with
  | Some identity ->
      assert_bool "live snapshot prompt retained"
        (identity.identity_system_prompt = "Snapshot prompt")
  | None -> fail "live snapshot identity" "expected identity");
  let decoded =
    expect_ok "snapshot codec"
      (Agent_runs_codec.session_state_codec.decode
         (Agent_runs_codec.session_state_codec.encode started))
  in
  let identity =
    match Agent_runs.find_identity decoded "snapshot-a1" with
    | Some identity -> identity
    | None -> fail "snapshot identity" "expected identity"
  in
  assert_bool "snapshot child id persisted"
    (identity.identity_child_session_id = Some "child-1");
  assert_bool "snapshot prompt is not persisted"
    (identity.identity_system_prompt = "");
  assert_bool "snapshot active tools persisted"
    (identity.identity_active_tools = Some [ "exec_command"; "write_stdin" ]);
  let live = Agent_runs.mark_active_runs_lost ~live_agent_ids:[ "snapshot-a1" ] decoded in
  (match Agent_runs.find_identity live "snapshot-a1" with
  | Some identity ->
      assert_bool "session switch keeps live child id"
        (identity.identity_child_session_id = Some "child-1")
  | None -> fail "live snapshot identity" "expected identity");
  (match Agent_runs.find_run live "snapshot-a1-run-1" with
  | Some run ->
      assert_bool "session switch keeps live run running"
        (run.run_status = Agent_runs.Run_running)
  | None -> fail "live snapshot run" "expected run");
  let owner : Subagents.owner = { id = "parent"; is_subagent = false; depth = 0 } in
  let worker =
    expect_ok "worker from snapshot"
      (Agent_runs.worker_of_identity_snapshot ~owner identity)
  in
  assert_equal "snapshot worker model" profile.model_id worker.profile.model_id;
  assert_bool "snapshot worker active tools"
    (worker.active_tools_snapshot = Some [ "exec_command"; "write_stdin" ]);
  assert_bool "decoded snapshot worker prompt is empty"
    (worker.system_prompt = "");
  let lost = Agent_runs.mark_active_runs_lost decoded in
  match Agent_runs.find_identity lost "snapshot-a1" with
  | Some identity ->
      assert_bool "resume clears stale child id"
        (identity.identity_child_session_id = None)
  | None -> fail "lost snapshot identity" "expected identity"

let test_agent_wait_state () =
  let spawned =
    expect_ok "wait spawn"
      (Agent_runs.record_spawn Agent_runs.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"finder-a1"
         ~profile_name:"finder" "inspect")
  in
  let active =
    Agent_runs.wait_for_selector spawned.delivery_state ~parent_session_id:"parent"
      Agent_runs.Wait_all_active
  in
  assert_equal "wait active message" "finder-a1 finder-a1-run-1 [running]"
    active.wait_message;
  assert_bool "wait pins active run ids"
    (active.wait_active_run_ids = [ "finder-a1-run-1" ]);
  let completed =
    expect_ok "complete run"
      (Agent_runs.record_run_completion spawned.delivery_state ~now:20
         ~run_id:"finder-a1-run-1" ~status:Agent_runs.Run_completed
         ~final_output:"done" ())
  in
  (match Agent_runs.find_run completed "finder-a1-run-1" with
  | Some run ->
      assert_bool "completion starts unnotified"
        (not run.run_background_notified)
  | None -> fail "completion run" "expected run");
  let default_waited =
    Agent_runs.wait_for_selector completed ~parent_session_id:"parent"
      Agent_runs.Wait_all_active
  in
  (match default_waited.wait_items with
  | [ item ] ->
      assert_equal "default wait terminal status" "completed" item.wait_status;
      assert_bool "default wait terminal consumed" item.wait_consumed
  | _ -> fail "default wait terminal item" "expected one item");
  assert_equal "default wait terminal message includes output"
    "finder-a1 finder-a1-run-1 [completed]\n\ndone" default_waited.wait_message;
  (match Agent_runs.find_run default_waited.wait_state "finder-a1-run-1" with
  | Some run ->
      assert_bool "default wait marks run consumed" run.run_consumed;
      assert_bool "default wait does not mark background notification"
        (not run.run_background_notified)
  | None -> fail "default wait consumed run" "expected run");
  let notified =
    expect_ok "record background notification"
      (Agent_runs.record_background_notification completed
         ~run_id:"finder-a1-run-1")
  in
  let decoded_notified =
    expect_ok "background notification codec"
      (Agent_runs_codec.session_state_codec.decode
         (Agent_runs_codec.session_state_codec.encode notified))
  in
  (match Agent_runs.find_run decoded_notified "finder-a1-run-1" with
  | Some run ->
      assert_bool "codec preserves background notification"
        run.run_background_notified
  | None -> fail "notified run" "expected run");
  let default_after_notification =
    Agent_runs.wait_for_selector notified ~parent_session_id:"parent"
      Agent_runs.Wait_all_active
  in
  assert_equal "default wait ignores background-notified terminal runs"
    "No active runs." default_after_notification.wait_message;
  let explicit_after_notification =
    Agent_runs.wait_for_selector notified ~parent_session_id:"parent"
      (Agent_runs.Wait_run_ids [ "finder-a1-run-1" ])
  in
  (match explicit_after_notification.wait_items with
  | [ item ] ->
      assert_equal "explicit notified readback status" "completed"
        item.wait_status;
      assert_bool "explicit notified readback reports delivered"
        item.wait_consumed;
      assert_bool "explicit notified readback preserves notification flag"
        item.wait_background_notified
  | _ -> fail "explicit notified readback" "expected one item");
  assert_equal "explicit notified readback includes output"
    "finder-a1 finder-a1-run-1 [completed]\n\ndone"
    explicit_after_notification.wait_message;
  (match
     Agent_runs.find_run explicit_after_notification.wait_state
       "finder-a1-run-1"
   with
  | Some run ->
      assert_bool "explicit notified readback does not consume persisted run"
        (not run.run_consumed);
      assert_bool
        "explicit notified readback keeps background notification metadata"
        run.run_background_notified
  | None -> fail "explicit notified run" "expected run");
  let waited =
    Agent_runs.wait_for_selector completed ~parent_session_id:"parent"
      (Agent_runs.Wait_run_ids [ "finder-a1-run-1" ])
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
  (match Agent_runs.find_run waited.wait_state "finder-a1-run-1" with
  | Some run ->
      assert_bool "wait marks run consumed" run.run_consumed;
      assert_bool "wait does not mark background notification"
        (not run.run_background_notified)
  | None -> fail "wait consumed run" "expected run");
  let other_spawned =
    expect_ok "wait other spawn"
      (Agent_runs.record_spawn completed ~now:30 ~parent_session_id:"other"
         ~agent_id:"finder-b1" ~profile_name:"finder" "inspect other")
  in
  let other_completed =
    expect_ok "complete other run"
      (Agent_runs.record_run_completion other_spawned.delivery_state ~now:40
         ~run_id:"finder-b1-run-1" ~status:Agent_runs.Run_completed
         ~final_output:"secret child answer" ())
  in
  let other_waited =
    Agent_runs.wait_for_selector other_completed ~parent_session_id:"parent"
      (Agent_runs.Wait_run_ids [ "finder-b1-run-1" ])
  in
  (match other_waited.wait_items with
  | [ item ] ->
      assert_equal "not-owned wait status" "not_owned" item.wait_status;
      assert_bool "not-owned wait hides output" (item.wait_final_output = None)
  | _ -> fail "not-owned wait item" "expected one item");
  assert_equal "not-owned wait message hides output"
    "finder-b1-run-1 [not_owned]" other_waited.wait_message;
  let no_active =
    Agent_runs.wait_for_selector waited.wait_state ~parent_session_id:"parent"
      (Agent_runs.Wait_agent_ids [ "finder-a1" ])
  in
  (match no_active.wait_items with
  | [ item ] ->
      assert_equal "no deliverable status" "no_deliverable_run"
        item.wait_status
  | _ -> fail "no active item" "expected one item")

let test_agent_stop_and_output_state () =
  let spawned =
    expect_ok "stop spawn"
      (Agent_runs.record_spawn Agent_runs.empty_session_state ~now:10
         ~parent_session_id:"parent" ~agent_id:"finder-a1"
         ~profile_name:"finder" "inspect")
  in
  let stopped, changed =
    expect_ok "stop agent"
      (Agent_runs.record_stop_agent spawned.delivery_state ~now:11
         ~agent_id:"finder-a1")
  in
  assert_bool "stop changed active run" changed;
  (match Agent_runs.latest_run stopped "finder-a1" with
  | Some run ->
      assert_bool "stop cancels run" (run.run_status = Agent_runs.Run_cancelled);
      assert_bool "stop reason"
        (run.run_reason = Some "stopped_by_parent")
  | None -> fail "stopped run" "expected run");
  let completed =
    expect_ok "complete for output"
      (Agent_runs.record_run_completion spawned.delivery_state ~now:12
         ~run_id:"finder-a1-run-1" ~status:Agent_runs.Run_completed
         ~final_output:"done" ())
  in
  (match
     Agent_runs.output_run_for_target completed ~parent_session_id:"parent"
       "finder-a1"
   with
  | Ok run ->
      assert_equal "output picks latest run" "finder-a1-run-1" run.run_id;
      assert_bool "output has final" (run.run_final_output = Some "done")
  | Error message -> fail "output target" message);
  (match
     Agent_runs.output_run_for_target completed ~parent_session_id:"other"
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
