module Capability = Taumel.Capability_profile
module Child_session = Taumel.Child_session
module Gateway = Taumel.Tool_gateway
module Goal = Taumel.Goal
module Permissions = Taumel.Permissions
module Ralph = Taumel.Ralph_loop
module Sandbox = Taumel.Sandbox
module Shared = Taumel.Shared
module Threads = Taumel.Thread_tools
module Tool_catalog = Taumel.Tool_catalog
module Usage = Taumel.Usage

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let assert_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let expect_ok label = function
  | Ok value -> value
  | Error message -> fail label message

let expect_ok_any label = function
  | Ok value -> value
  | Error _ -> fail label "unexpected error"

let expect_error label = function
  | Ok _ -> fail label "expected an error"
  | Error _ -> ()

let test_gateway_enforces_profile_and_sandbox () =
  let spec =
    {
      Gateway.name = "exec_command";
      effect_kind = Gateway.Execute;
    }
  in
  let registry = Gateway.empty |> Gateway.register spec in
  let profile = { Capability.default with tools = Capability.of_list [ "exec_command" ] } in
  let denied_profile = { Capability.default with tools = Capability.None_allowed } in
  let allowed_context =
    { Gateway.profile; authorize_effect = (fun _ -> Ok ()) }
  in
  let denied_context =
    { Gateway.profile = denied_profile; authorize_effect = (fun _ -> Ok ()) }
  in
  let sandbox_denied_context =
    { Gateway.profile; authorize_effect = (fun _ -> Error "read-only") }
  in
  expect_ok_any "gateway authorize"
    (Gateway.authorize registry allowed_context ~name:"exec_command");
  (match Gateway.authorize registry denied_context ~name:"exec_command" with
  | Error (Gateway.Denied_tool "exec_command") -> ()
  | _ -> fail "gateway deny profile" "expected profile denial");
  (match Gateway.authorize registry sandbox_denied_context ~name:"exec_command" with
  | Error (Gateway.Denied_effect (Gateway.Execute, "read-only")) -> ()
  | _ -> fail "gateway deny effect" "expected sandbox effect denial")

let sandbox_config =
  {
    Sandbox.filesystem_mode = Sandbox.Workspace_write;
    workspace_roots = [ "/repo" ];
    network_mode = Sandbox.Network_disabled;
    approval_policy = Sandbox.Never;
    no_sandbox = false;
    isolated_child = false;
  }

let test_sandbox_patch_policy () =
  assert_equal "write_stdin success message" "stdin written"
    Sandbox.write_stdin_success_message;
  (match
     Sandbox.plan_write_stdin_host_call ~host_available:true
       ~yield_time_ms:250.
       { Sandbox.session_id = 7; chars = "q" }
   with
  | Sandbox.Stdin_call call ->
      assert_int "stdin plan session" 7 call.request.session_id;
      assert_bool "stdin plan yield" (call.yield_time_ms = Some 250.)
  | Sandbox.Stdin_result _ ->
      fail "stdin host plan" "expected host call");
  (match
     Sandbox.plan_write_stdin_host_call ~host_available:false
       { Sandbox.session_id = 7; chars = "q" }
   with
  | Sandbox.Stdin_result result ->
      assert_equal "stdin unavailable"
        Sandbox.write_stdin_unavailable_message result.message
  | Sandbox.Stdin_call _ ->
      fail "stdin unavailable plan" "expected planned result");
  assert_equal "apply_patch success message" "Patch applied."
    Sandbox.apply_patch_success_message;
  let patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: /repo/a.txt";
        "+hello";
        "*** End Patch";
      ]
  in
  let files =
    expect_ok "apply add"
      (Sandbox.apply_patch_to_map sandbox_config Shared.String_map.empty patch)
  in
  assert_equal "added file" "hello\n" (Shared.String_map.find "/repo/a.txt" files);
  let update =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Update File: /repo/a.txt";
        "@@";
        "-hello";
        "+goodbye";
        "*** End Patch";
      ]
  in
  let files = expect_ok "apply update" (Sandbox.apply_patch_to_map sandbox_config files update) in
  assert_equal "updated file" "goodbye\n" (Shared.String_map.find "/repo/a.txt" files);
  let outside =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: /tmp/outside.txt";
        "+nope";
        "*** End Patch";
      ]
  in
  expect_error "outside workspace denied"
    (Sandbox.apply_patch_to_map sandbox_config files outside)

let test_sandbox_workspace_metadata_protection () =
  assert_bool "system ro candidates owned by sandbox"
    (List.mem "/run/current-system" Sandbox.system_ro_path_candidates);
  assert_bool "temp roots deduplicated"
    (Sandbox.temp_root_candidates ~tmp_dir:"/tmp" ~env_tmp_dir:"/tmp"
    = [ "/tmp" ]);
  let host =
    {
      Sandbox.platform = "linux";
      temp_roots = [];
      system_ro_paths = [];
      home_mount = "";
      workspace_roots = [ "/repo" ];
      authorization_cwd = "/repo";
      workspace_metadata_listings =
        [
          {
            metadata_dir = ".git";
            path = "/repo/.git";
            children = Some [ "config"; "hooks"; "objects" ];
          };
          { metadata_dir = ".hg"; path = "/repo/.hg"; children = None };
          {
            metadata_dir = ".idea";
            path = "/repo/.idea";
            children = Some [ "workspace.xml" ];
          };
        ];
    }
  in
  let invocation =
    expect_ok "sandbox invocation"
      (Sandbox.plan_exec_invocation sandbox_config host ~shell:"bash"
         ~shell_args:[ "-lc"; "pwd" ] ~force_unsandboxed:false)
  in
  let host_call =
    expect_ok "sandbox host call"
      (Sandbox.plan_exec_host_call sandbox_config host
         {
           Sandbox.cmd = "pwd";
           cwd = "/repo";
           shell = "bash";
           timeout_ms = Some 1000.;
           yield_time_ms = None;
           tty = false;
         }
         ~force_unsandboxed:false)
  in
  assert_equal "host call cwd" "/repo" host_call.cwd;
  assert_bool "host call shell args"
    (List.exists
       (fun arg -> arg = "-c")
       host_call.Sandbox.invocation.args);
  assert_bool "host call timeout" (host_call.timeout_ms = Some 1000.);
  assert_bool ".git config is protected"
    (List.mem "/repo/.git/config" invocation.args);
  assert_bool ".git objects are protected"
    (List.mem "/repo/.git/objects" invocation.args);
  assert_bool ".git hooks stay writable"
    (not (List.mem "/repo/.git/hooks" invocation.args));
  assert_bool "unreadable metadata dir is protected"
    (List.mem "/repo/.hg" invocation.args);
  assert_bool "unrelated hidden dirs are ignored"
    (not (List.mem "/repo/.idea/workspace.xml" invocation.args));
  let expect_approval_denied label outcome expected_message expected_outcome =
    match Sandbox.exec_approval_outcome ~outcome with
    | Sandbox.Approval_denied denied ->
        assert_equal (label ^ " text") expected_message denied.message;
        let fields =
          [
            ("ok", Shared.Bool false);
            ("approvalRequired", Shared.Bool true);
            ("approvalOutcome", Shared.String expected_outcome);
          ]
        in
        let fields =
          if expected_outcome = "unavailable" then
            fields @ [ ("reason", Shared.String "approval_unavailable") ]
          else fields
        in
        assert_bool (label ^ " details") (denied.details = Shared.Object fields)
    | Sandbox.Approval_granted ->
        fail (label ^ " outcome") "expected denied result"
  in
  (match Sandbox.exec_approval_outcome ~outcome:Sandbox.Approval_approved with
  | Sandbox.Approval_granted -> ()
  | Sandbox.Approval_denied _ ->
      fail "approval granted outcome" "expected granted result");
  expect_approval_denied "approval denied by user" Sandbox.Approval_denied_by_user
    "Sandbox: command blocked (approval denied by user)" "denied_by_user";
  expect_approval_denied "approval timed out" Sandbox.Approval_timed_out "Sandbox: command blocked (approval timed out)" "timed_out";
  expect_approval_denied "approval unavailable" Sandbox.Approval_unavailable "Sandbox: command blocked (approval unavailable)" "unavailable";
  expect_approval_denied "approval interrupted" Sandbox.Approval_interrupted "Sandbox: command blocked (approval interrupted)" "interrupted";
  let prompt = Sandbox.exec_approval_prompt ~cmd:"pwd" "needs escalation" in
  (match Sandbox.plan_exec_approval_prompt ~ui_available:true prompt with
  | Sandbox.Approval_prompt_confirm planned ->
      assert_equal "approval prompt title" "Command requires approval"
        planned.title;
      assert_bool "approval prompt includes command"
        (String.contains planned.prompt 'p');
      assert_int "approval prompt timeout" 120000 planned.timeout_ms
  | Sandbox.Approval_prompt_unavailable ->
      fail "approval prompt plan" "expected confirm plan");
  (match Sandbox.plan_exec_approval_prompt ~ui_available:false prompt with
  | Sandbox.Approval_prompt_unavailable -> ()
  | Sandbox.Approval_prompt_confirm _ ->
      fail "approval prompt unavailable" "expected unavailable plan")

let test_child_session_setup_entries () =
  let metadata =
    Shared.Object
      [
        ("kind", Shared.String "agent");
        ("agentId", Shared.String "worker-1");
        ("modelId", Shared.String "openai-codex/gpt-worker");
        ("thinkingLevel", Shared.String "high");
        ("activeTools", Shared.Array [ Shared.String "exec_command" ]);
        ("capabilityProfile", Capability.to_json Capability.default);
        ("noSandbox", Shared.Bool true);
        ("isolated_child", Shared.Bool true);
      ]
  in
  let entries =
    Child_session.setup_entries ~metadata ~parent_session_id:(Some "parent")
      ~parent_session_file:(Some "/sessions/parent.json")
  in
  let plan =
    Child_session.start_plan ~metadata ~parent_session_id:(Some "parent")
      ~parent_session_file:(Some "/sessions/parent.json")
  in
  assert_equal "child start parent session" "/sessions/parent.json"
    (Option.value plan.parent_session ~default:"");
  assert_equal "child start model" "openai-codex/gpt-worker"
    (Option.value plan.model_id ~default:"");
  assert_equal "child start thinking" "high"
    (Option.value plan.thinking_level ~default:"");
  assert_bool "child start active tools"
    (plan.active_tools = Some [ "exec_command" ]);
  assert_equal "missing child session id error"
    "createAgentSession did not expose a child session id"
    Child_session.missing_session_identifier_error;
  let parent_profile =
    {
      Capability.default with
      sandbox_preset = Capability.Danger_full_access;
      tools = Capability.of_list [ "exec_command"; "ralph_continue" ];
      no_sandbox_allowed = true;
    }
  in
  let ralph_metadata =
    Child_session.enrich_command_child_metadata ~parent_profile
      ~current_active_tools_available:true
      ~current_active_tools:[ "bash"; "usage" ] ~active_tools_mode:"ralph_child"
      (Shared.Object [ ("kind", Shared.String "ralph") ])
  in
  (match ralph_metadata with
  | Shared.Object fields -> (
      match
        (List.assoc_opt "activeTools" fields, List.assoc_opt "capabilityProfile" fields)
      with
      | Some (Shared.Array active_tools), Some profile_json ->
          let active_tools =
            List.filter_map
              (function Shared.String value -> Some value | _ -> None)
              active_tools
          in
          assert_bool "ralph metadata rewrites shell"
            (List.mem "exec_command" active_tools);
          assert_bool "ralph metadata hides usage"
            (not (List.mem "usage" active_tools));
          assert_bool "ralph metadata includes child controls"
            (List.mem "ralph_continue" active_tools
            && List.mem "ralph_finish" active_tools);
          let profile =
            expect_ok "ralph child profile"
              (Capability.of_json profile_json)
          in
          assert_bool "ralph child profile clamps no-sandbox"
            (not profile.no_sandbox_allowed);
          assert_bool "profile-ch02 ralph child profile clamps full access"
            (profile.sandbox_preset = Capability.Workspace_write);
          assert_bool "ralph child profile intersects active tools"
            (Capability.allow_tool profile "exec_command"
            && Capability.allow_tool profile "ralph_continue"
            && not (Capability.allow_tool profile "ralph_finish")
            )
      | _ -> fail "ralph metadata" "expected active tools and profile")
  | _ -> fail "ralph metadata" "expected object metadata");
  let ralph_permissions =
    Child_session.setup_entries ~metadata:ralph_metadata
      ~parent_session_id:(Some "parent") ~parent_session_file:None
    |> List.tl |> List.hd
  in
  (match ralph_permissions.data with
  | Shared.Object fields ->
      assert_bool "sandbox-qb00 ralph permissions persist child isolation"
        (List.assoc_opt "isolated_child" fields = Some (Shared.Bool true));
      ignore
        (expect_ok "ralph generated permissions decode"
           (Permissions.codec.decode ralph_permissions.data))
  | _ -> fail "ralph permissions" "expected object data");
  assert_int "child start setup entry count" 2 (List.length plan.setup_entries);
  assert_int "child session entry count" 2 (List.length entries);
  let child = List.hd entries in
  assert_equal "child entry type" "taumel.childSession" child.custom_type;
  assert_equal "child kind" "agent"
    (Option.value (Shared.json_string_field "kind" child.data) ~default:"");
  assert_equal "child parent id" "parent"
    (Option.value (Shared.json_string_field "parentSessionId" child.data)
       ~default:"");
  let permissions = List.hd (List.tl entries) in
  assert_equal "permissions entry type" "taumel.permissions"
    permissions.custom_type;
  (match permissions.data with
  | Shared.Object fields ->
      assert_bool "permissions carries profile"
        (match List.assoc_opt "profile" fields with
        | Some (Shared.Object _) -> true
        | _ -> false);
      assert_bool "sandbox-5pf1 permissions disable child no-sandbox"
        (List.assoc_opt "noSandbox" fields = Some (Shared.Bool false));
      assert_bool "permissions carries isolated_child flag"
        (List.assoc_opt "isolated_child" fields = Some (Shared.Bool true));
      ignore
        (expect_ok "agent generated permissions decode"
           (Permissions.codec.decode permissions.data))
  | _ -> fail "permissions entry" "expected object data")
  ;
  let bridge =
    {
      Child_session.session_id = Some "child";
      session_file = Some "/sessions/child.json";
      cancelled = false;
      error = None;
      active_tools = Some [ "exec_command" ];
      active_tools_applied = true;
      model_id = Some "gpt-worker";
      model_applied = true;
      thinking_level = Some "high";
      thinking_applied = true;
    }
  in
  (match Child_session.bridge_details (Some bridge) with
  | Shared.Object fields -> (
      match List.assoc_opt "childSession" fields with
      | Some (Shared.Object child_fields) ->
          assert_bool "child bridge created"
            (List.assoc_opt "created" child_fields = Some (Shared.Bool true));
          assert_bool "child bridge session id"
            (List.assoc_opt "sessionId" child_fields
            = Some (Shared.String "child"))
      | _ -> fail "child bridge details" "expected childSession object")
  | _ -> fail "child bridge details" "expected object");
  let dispatch =
    Child_session.dispatch_plan ~bridge ~prompt:"  hello child  "
      ~send_available:true ()
  in
  assert_bool "child dispatch sends" dispatch.send;
  assert_equal "child dispatch trims prompt" "hello child" dispatch.prompt;
  assert_equal "child dispatch delivery mode" "followUp" dispatch.deliver_as;
  let steer_dispatch =
    Child_session.dispatch_plan ~bridge ~deliver_as:"steer" ~prompt:"steer child"
      ~send_available:true ()
  in
  assert_equal "child dispatch steer mode" "steer" steer_dispatch.deliver_as;
  (match dispatch.result with
  | Shared.Object fields ->
      assert_bool "child dispatch result sent"
        (List.assoc_opt "dispatched" fields = Some (Shared.Bool true));
      assert_bool "child dispatch result session"
        (List.assoc_opt "sessionId" fields = Some (Shared.String "child"))
  | _ -> fail "child dispatch result" "expected object");
  let empty_dispatch =
    Child_session.dispatch_plan ~empty_reason:"no initial prompt" ~prompt:" "
      ~send_available:true ()
  in
  assert_bool "empty child dispatch does not send" (not empty_dispatch.send);
  (match empty_dispatch.result with
  | Shared.Object fields ->
      assert_bool "empty child dispatch reason"
        (List.assoc_opt "reason" fields
        = Some (Shared.String "no initial prompt"))
  | _ -> fail "empty child dispatch result" "expected object")

let test_goal_state_machine () =
  let goal = expect_ok "create goal" (Goal.create ~time_limit_seconds:5 ~thread_id:"t1" ~now:1 " ship " None) in
  assert_equal "objective trimmed" "ship" goal.objective;
  expect_error "unfinished create denied"
    (Goal.create ~thread_id:"t1" ~now:2 "second" (Some goal));
  let goal =
    Goal.account_usage ~now:3 ~time_delta_seconds:5
      { input_tokens = 12; cached_input_tokens = 4; output_tokens = 3 }
      goal
  in
  assert_int "tokens accounted" 11 goal.tokens_used;
  assert_bool "time limited" (goal.status = Goal.Time_limited);
  expect_error "inactive goal cannot be completed"
    (Goal.update_status ~now:4 Goal.Complete (Some goal))

let test_ralph_ownership () =
  let task =
    expect_ok "start ralph"
      (Ralph.start ~max_iterations:1 ~id:"r1" ~controller_session:"controller" "iterate")
  in
  let task = expect_ok "attach child" (Ralph.attach_child (Ralph.Controller "controller") "child" task) in
  expect_error "controller cannot continue child" (Ralph.ralph_continue (Ralph.Controller "controller") task);
  let task = expect_ok "child continue" (Ralph.ralph_continue (Ralph.Child "child") task) in
  assert_int "iteration advanced" 1 task.iteration;
  assert_equal "child prompt"
    "Ralph task r1\nObjective: iterate\n\nUse ralph_continue with task_id r1 for each iteration, or ralph_finish when complete."
    (Ralph.child_prompt task);
  let paused = expect_ok "max iterations pauses" (Ralph.ralph_continue (Ralph.Child "child") task) in
  assert_bool "paused at limit" (paused.status = Ralph.Paused)

let test_thread_tools () =
  let scans =
    Threads.catalog_scans ~override:"/override" ~cwd:"/repo" ~home:"/home/me" ()
  in
  assert_int "thread scan count" 10 (List.length scans);
  assert_equal "thread override scan root" "/override" (List.hd scans).root;
  assert_int "thread scan max depth" 4 (List.hd scans).max_depth;
  assert_int "thread scan max files" 200 (List.hd scans).max_files;
  assert_equal "thread scan suffix" ".jsonl" (List.hd scans).suffix;
  let catalog =
    [
      (match
         Threads.thread_of_source_json
           (Threads.current_source_json ~cwd:"/repo" ~session_id:"current-1"
               ~branch:
                 (Shared.Array
                    [
                      Shared.Object
                        [
                          ("message", Shared.Object [ ("role", Shared.String "user"); ("content", Shared.String "current branch signal") ]);
                        ];
                    ])
               ~entries:
                 (Shared.Array
                    [
                      Shared.Object
                        [
                          ("customType", Shared.String "summary:branch");
                          ("data", Shared.Object [ ("summary", Shared.String "Current branch summary") ]);
                        ];
                    ]))
       with
      | Ok thread -> thread
      | Error _ -> fail "current source parse" "expected thread");
      {
        Threads.id = "abc-local";
        title = "Local build";
        workspace = Some "/repo";
        messages = [ { role = "user"; content = "fix sandbox" } ];
        goal_summary = Some "Goal: ship sandbox";
        branch_summary = Some "Branch summary";
        compaction_summary = None;
        source_path = Some "/repo/.pi/agent/sessions/abc-local.jsonl";
        started_at = None;
        updated_at = None;
        entries = [ { entry_id = Some "abc-local-1"; line = Some 1; timestamp = None; role = Some "user"; kind = "message"; tool_name = None; text = "fix sandbox" } ];
        diagnostics = [];
      };
      {
        Threads.id = "abc-global";
        title = "Other build";
        workspace = Some "/other";
        messages = [ { role = "user"; content = "fix sandbox" } ];
        goal_summary = None;
        branch_summary = None;
        compaction_summary = None;
        source_path = Some "/other/.pi/agent/sessions/abc-global.jsonl";
        started_at = None;
        updated_at = None;
        entries = [ { entry_id = Some "abc-global-1"; line = Some 1; timestamp = None; role = Some "user"; kind = "message"; tool_name = None; text = "fix sandbox" } ];
        diagnostics = [];
      };
    ]
  in
  let current_results =
    Threads.find ~workspace:"/repo" ~query:"current branch signal" catalog
  in
  assert_equal "current source id" "current-1" (List.hd current_results).id;
  let thread_catalog : Threads.catalog = { threads = catalog; diagnostics = [] } in
  (match Threads.read ~id:"current-1" thread_catalog with
  | Threads.Found thread ->
      assert_equal "current source branch summary" "Current branch summary"
        (Option.value thread.branch_summary ~default:"")
  | _ -> fail "current source read" "expected current thread");
  let results = Threads.find ~workspace:"/repo" ~query:"sandbox" catalog in
  assert_equal "current workspace first" "abc-local" (List.hd results).id;
  (match Threads.read ~id:"abc-" thread_catalog with
  | Threads.Ambiguous ids -> assert_int "ambiguous ids" 2 (List.length ids)
  | _ -> fail "ambiguous read" "expected ambiguous prefix");
  (match Threads.read ~id:"abc-local" thread_catalog with
  | Threads.Found thread ->
      assert_equal "goal transcript" "Goal: ship sandbox"
        (Threads.transcript ~goal_only:true thread)
  | _ -> fail "exact read" "expected exact thread")

let test_usage_openai_rendering () =
  assert_equal "usage host provider key" "openai-codex"
    Usage.openai_host_auth.provider_key;
  assert_equal "usage host credential key" "openai-codex"
    Usage.openai_host_auth.credential_key;
  let request = Usage.openai_usage_request ~account_id:"acct-test" ~token:"tok" () in
  assert_equal "usage request url" "https://chatgpt.com/backend-api/wham/usage" request.url;
  assert_equal "usage request method" "GET" request.meth;
  assert_equal "usage request authorization" "Bearer tok"
    (Option.value (List.assoc_opt "Authorization" request.headers) ~default:"");
  assert_equal "usage request account header" "acct-test"
    (Option.value (List.assoc_opt "ChatGPT-Account-Id" request.headers) ~default:"");
  let credential =
    Usage.openai_credential_from_json
      (Shared.Object
         [
           ("accountId", Shared.String "acct-test");
           ("email", Shared.String "person@example.com");
         ])
  in
  assert_equal "credential account id" "acct-test"
    (Option.value credential.account_id ~default:"");
  assert_equal "credential account label" "person@example.com"
    (Option.value credential.account_label ~default:"");
  assert_bool "token lookup present"
    (Usage.token_lookup_from_host " tok " = Usage.Token_lookup_present "tok");
  assert_bool "token lookup missing"
    (Usage.token_lookup_from_host "" = Usage.Token_lookup_missing);
  assert_bool "token lookup error"
    (Usage.token_state_of_lookup
       (Usage.token_lookup_from_host ~error:"boom" "")
    = Usage.Token_error "boom");
  let account =
    {
      Usage.provider = Usage.Openai;
      api_key_present = true;
      account_label = Some "team";
      plan = Some "pro";
      credits_balance = Some 87.5;
      not_configured = false;
      error = None;
      rate_limits = [];
    }
  in
  let rendered = Usage.render account in
  assert_bool "openai provider" (String.contains rendered 'o');
  assert_bool "credits balance" (String.contains rendered '8');
  let host_result ?(api_key_present = false) ?account_label ?account_id
      ?(fetched_at_ms = 1000.0) token_state fetch_state =
    Usage.openai_host_result
      {
        Usage.api_key_present;
        account_label;
        account_id;
        fetched_at_ms;
        token_state;
        fetch_state;
      }
  in
  let missing = host_result Usage.Token_missing Usage.Fetch_not_started in
  assert_bool "missing token is not configured" missing.account.not_configured;
  assert_bool "missing token is not live" (not missing.live);
  let http_error =
    host_result ~api_key_present:true ~account_id:"acct_1" Usage.Token_present
      (Usage.Fetch_http_error "429 Too Many Requests")
  in
  assert_bool "http error is live" http_error.live;
  assert_equal "http error normalized" "OpenAI usage request failed: 429 Too Many Requests"
    (Option.value http_error.account.error ~default:"");
  (match Usage.result_details http_error with
  | Shared.Object fields ->
      assert_bool "details carries account id"
        (List.assoc_opt "accountId" fields = Some (Shared.String "acct_1"));
      assert_bool "details carries source"
        (List.assoc_opt "source" fields = Some (Shared.String "openai-codex"))
  | _ -> fail "usage details" "expected object");
  let payload =
    Shared.Object
      [
        ("plan_type", Shared.String "pro");
        ( "credits",
          Shared.Object
            [
              ("has_credits", Shared.Bool true);
              ("unlimited", Shared.Bool false);
              ("balance", Shared.String "990.563425");
            ] );
        ( "rate_limit",
          Shared.Object
            [
              ( "primary_window",
                Shared.Object
                  [
                    ("limit_window_seconds", Shared.Number 18000.0);
                    ("reset_at", Shared.Number 1800.0);
                    ("used_percent", Shared.Number 25.0);
                  ] );
            ] );
      ]
  in
  let live =
    host_result ~api_key_present:true ~account_label:"team" Usage.Token_present
      (Usage.Fetch_ok payload)
  in
  assert_bool "successful usage is live" live.live;
  assert_equal "plan normalized" "Pro"
    (Option.value live.account.plan ~default:"");
  assert_bool "unitless credits parsed"
    (live.account.credits_balance = Some 990.563425);
  assert_int "rate limit normalized" 1 (List.length live.account.rate_limits);
  let unlimited =
    Usage.openai_payload_to_account ~fetched_at_ms:1000.0 ~api_key_present:true
      (Shared.Object
         [
           ( "credits",
             Shared.Object
               [
                 ("has_credits", Shared.Bool true);
                 ("unlimited", Shared.Bool true);
                 ("balance", Shared.String "990.563425");
               ] );
         ])
  in
  assert_bool "unlimited credits omitted" (unlimited.credits_balance = None);
  let epoch_safe =
    Usage.openai_payload_to_account ~fetched_at_ms:1_783_883_042_000.0
      ~api_key_present:true
      (Shared.Object
         [
           ( "rate_limit",
             Shared.Object
               [
                 ( "primary_window",
                   Shared.Object
                     [
                       ("limit_window_seconds", Shared.Number 604800.0);
                       ("reset_at", Shared.Number 1784487674.0);
                       ("reset_after_seconds", Shared.Number 602000.0);
                       ("used_percent", Shared.Number 1.0);
                     ] );
               ] );
         ])
  in
  match epoch_safe.rate_limits with
  | [ row ] ->
      assert_bool "epoch-safe exhaustion remains in the future"
        (Option.value row.exhausts_in_seconds ~default:0 > 3600)
  | _ -> fail "epoch-safe usage" "expected one rate limit"

let test_tool_catalog_scope () =
  List.iter
    (fun name -> assert_bool ("kept tool " ^ name) (Tool_catalog.has_tool name))
    [
      "exec_command";
      "write_stdin";
      "apply_patch";
      "get_goal";
      "create_goal";
      "update_goal";
      "ralph_continue";
      "ralph_finish";
      "query_threads";
      "read_thread";
    ];
  List.iter
    (fun name -> assert_bool ("omitted tool " ^ name) (not (Tool_catalog.has_tool name)))
    [ "backlog"; "memory"; "skill_manage"; "dream_finish"; "request_user_input" ];
  assert_bool "normal active tools hide scoped controls"
    (Tool_catalog.rewrite_active_tools ~provider:"openai-codex"
       [
         "bash";
         "write";
         "usage";
         "query_threads";
         "user_detection_tool";
         "ralph_continue";
         "ralph_finish";
       ]
    = [ "exec_command"; "write_stdin"; "apply_patch"; "query_threads" ]);
  assert_bool "non-openai active tools keep sandboxed legacy mutation wrappers"
    (Tool_catalog.rewrite_active_tools ~provider:"anthropic"
       [ "bash"; "apply_patch"; "query_threads" ]
    = [ "exec_command"; "write_stdin"; "edit"; "write"; "query_threads" ]);
  assert_bool "ralph child active tools include scoped controls"
    (Tool_catalog.rewrite_active_tools ~provider:"openai-codex" ~ralph_child:true
       [ "exec_command"; "write_stdin"; "query_threads" ]
    = [
        "exec_command";
        "write_stdin";
        "query_threads";
        "ralph_continue";
        "ralph_finish";
      ]);
  let sync =
    Tool_catalog.plan_active_tools_sync ~provider:"openai-codex"
      [ "bash"; "bash"; "write" ]
  in
  assert_bool "active tool sync detects rewrite" sync.changed;
  assert_bool "active tool sync plans catalog tools"
    (sync.tools = [ "exec_command"; "write_stdin"; "apply_patch" ]);
  let non_openai_sync =
    Tool_catalog.plan_active_tools_sync ~provider:"anthropic"
      [ "bash"; "bash"; "write" ]
  in
  assert_bool "non-openai active tool sync detects rewrite" non_openai_sync.changed;
  assert_bool "non-openai active tool sync avoids apply_patch"
    (non_openai_sync.tools = [ "exec_command"; "write_stdin"; "write" ]);
  let stable =
    Tool_catalog.plan_active_tools_sync [ "exec_command"; "write_stdin" ]
  in
  assert_bool "active tool sync skips stable list" (not stable.changed);
  assert_bool "permissions command" (Tool_catalog.has_command "permissions");
  assert_bool "goal command" (Tool_catalog.has_command "goal");
  assert_bool "usage command" (Tool_catalog.has_command "usage");
  assert_bool "usage tool omitted" (not (Tool_catalog.has_tool "usage"));
  assert_bool "approval command omitted" (not (Tool_catalog.has_command "approval"));
  assert_bool "status command omitted" (not (Tool_catalog.has_command "status"));
  let notification =
    Tool_catalog.command_notification ~command_name:"usage" ~ok:false ~message:""
      ~error:"network disabled"
  in
  assert_equal "command notification error message" "network disabled"
    notification.message;
  assert_equal "command notification warning" "warning" notification.level;
  (match Tool_catalog.plan_command_notification ~ui_available:true notification with
  | Tool_catalog.Notification_send planned ->
      assert_equal "command notification plan message" "network disabled"
        planned.message
  | Tool_catalog.Notification_unavailable ->
      fail "command notification plan" "expected send plan");
  (match Tool_catalog.plan_command_notification ~ui_available:false notification with
  | Tool_catalog.Notification_unavailable -> ()
  | Tool_catalog.Notification_send _ ->
      fail "command notification unavailable" "expected unavailable plan");
  let notification =
    Tool_catalog.command_notification ~command_name:"usage" ~ok:true ~message:""
      ~error:""
  in
  assert_equal "command notification default message" "usage completed."
    notification.message;
  assert_equal "command notification info" "info" notification.level;
  (match
     Gateway.text_result_json ~details:(Shared.Object [ ("ok", Shared.Bool true) ])
       "hello"
   with
  | Shared.Object fields ->
      assert_bool "tool result content"
        (match List.assoc_opt "content" fields with
        | Some (Shared.Array [ Shared.Object content_fields ]) ->
            List.assoc_opt "type" content_fields = Some (Shared.String "text")
            && List.assoc_opt "text" content_fields = Some (Shared.String "hello")
        | _ -> false);
      assert_bool "tool result details"
        (List.assoc_opt "details" fields
        = Some (Shared.Object [ ("ok", Shared.Bool true) ]))
  | _ -> fail "tool result envelope" "expected object");
  assert_bool "full-access aliases danger-full-access"
    (Capability.sandbox_of_string "full-access" = Some Capability.Danger_full_access)

let test_permissions_state () =
  let state =
    expect_ok "create permissions"
      (Permissions.create ~workspace_roots:[ "/repo" ] Capability.default)
  in
  let update =
    expect_ok "parse sandbox permission"
      (Permissions.parse "sandbox read-only")
  in
  let state =
    match update with
    | None -> fail "permissions parse" "expected update"
    | Some update -> expect_ok "apply sandbox permission" (Permissions.apply_update state update)
  in
  assert_bool "profile sandbox updated"
    (state.profile.sandbox_preset = Capability.Read_only);
  assert_bool "sandbox config updated"
    (state.sandbox.filesystem_mode = Sandbox.Read_only);
  let state =
    match expect_ok "parse approval permission" (Permissions.parse "approval never") with
    | None -> fail "permissions approval parse" "expected update"
    | Some update -> expect_ok "apply approval permission" (Permissions.apply_update state update)
  in
  assert_bool "approval updated"
    (state.profile.approval_policy = Capability.Never);
  let state =
    match expect_ok "parse network permission" (Permissions.parse "network enabled") with
    | None -> fail "permissions network parse" "expected update"
    | Some update -> expect_ok "apply network permission" (Permissions.apply_update state update)
  in
  assert_bool "network enabled" (state.sandbox.network_mode = Sandbox.Network_enabled);
  let state =
    match expect_ok "parse full access permission" (Permissions.parse "sandbox full-access") with
    | None -> fail "permissions full access parse" "expected update"
    | Some update -> expect_ok "apply full access permission" (Permissions.apply_update state update)
  in
  assert_bool "full access preset updated"
    (state.profile.sandbox_preset = Capability.Danger_full_access);
  assert_bool "full access forces network enabled"
    (state.sandbox.network_mode = Sandbox.Network_enabled);
  assert_bool "full access preserves approval"
    (state.profile.approval_policy = Capability.Never);
  expect_error "full access rejects network disabled"
    (Permissions.apply_update state (Permissions.Set_network Sandbox.Network_disabled));
  let state =
    match expect_ok "parse workspace permission" (Permissions.parse "sandbox workspace-write") with
    | None -> fail "permissions workspace parse" "expected update"
    | Some update -> expect_ok "apply workspace permission" (Permissions.apply_update state update)
  in
  assert_bool "workspace preset resets network disabled"
    (state.sandbox.network_mode = Sandbox.Network_disabled);
  assert_bool "workspace preset preserves approval"
    (state.profile.approval_policy = Capability.Never);
  let state =
    match expect_ok "parse no-sandbox permission" (Permissions.parse "no-sandbox enabled") with
    | None -> fail "permissions no-sandbox parse" "expected update"
    | Some update -> expect_ok "apply no-sandbox permission" (Permissions.apply_update state update)
  in
  assert_bool "no-sandbox enabled" state.sandbox.no_sandbox;
  expect_error "permissions command rejects network"
    (Permissions.parse_permissions "network enabled");
  (match expect_ok "parse network command" (Permissions.parse_network "enabled") with
  | Some (Permissions.Set_network Sandbox.Network_enabled) -> ()
  | _ -> fail "parse network command" "expected Set_network enabled");
  let state =
    expect_ok "deny tools" (Permissions.apply_update state Permissions.Deny_all_tools)
  in
  assert_bool "tool denied" (not (Capability.allow_tool state.profile "exec_command"));
  assert_bool "summary mentions workspace-write"
    (String.contains (Permissions.summary state) 'w');
  let menu = Permissions.sandbox_menu_options state in
  assert_equal "menu selection by label" "sandbox workspace-write"
    (Option.value
       (Permissions.menu_selected_value menu "Workspace write (current)")
       ~default:"");
  assert_equal "menu selection by value" "sandbox workspace-write"
    (Option.value
       (Permissions.menu_selected_value menu "sandbox workspace-write")
       ~default:"");
  assert_bool "invalid menu selection"
    (Permissions.menu_selected_value menu "missing" = None);
  let permissions_menu = Permissions.permissions_menu_options state in
  assert_bool "permissions menu excludes network"
    (Permissions.menu_selected_value permissions_menu "Network disabled (current)"
    = None);
  assert_equal "approval menu selection by label" "approval never"
    (Option.value
       (Permissions.menu_selected_value permissions_menu "Approval: never (current)")
       ~default:"");
  let network_menu = Permissions.network_menu_options state in
  assert_equal "network menu selection by label" "network disabled"
    (Option.value
       (Permissions.menu_selected_value network_menu "Network disabled (current)")
       ~default:"");
  (match
     Permissions.prompt_selection_plan ~ui_available:true ~title:"" permissions_menu
   with
  | Permissions.Prompt_select plan ->
      assert_equal "permissions prompt title"
        Permissions.default_prompt_title plan.title;
      assert_bool "permissions prompt labels"
        (List.mem "Workspace write (current)" plan.labels
        && List.mem "Approval: never (current)" plan.labels
        && not (List.mem "Network disabled (current)" plan.labels))
  | Permissions.Prompt_unavailable ->
      fail "permissions prompt plan" "expected select plan");
  (match
     Permissions.prompt_selection_plan ~ui_available:false ~title:"x" menu
   with
  | Permissions.Prompt_unavailable -> ()
  | Permissions.Prompt_select _ ->
      fail "permissions unavailable prompt plan" "expected unavailable")
  ;
  let child_state =
    expect_ok "create isolated_child permissions"
      (Permissions.create ~isolated_child:true Capability.default)
  in
  expect_error "isolated_child cannot enable no-sandbox"
    (Permissions.apply_update child_state (Permissions.Set_no_sandbox true))

let test_child_session_persisted_metadata () =
  let worktree_binding =
    Taumel.Agent_workspace.worktree ~source_origin:"/repo"
      ~main_repository_root:"/repo" ~main_repository_id:"repo-id"
  in
  let fields =
    [
      ("kind", Shared.String "agent");
      ("agentKind", Shared.String "generic");
      ("agentId", Shared.String "agent-1");
      ("workspaceDirectory", Shared.String "/agents/agent-1");
      ("sourceWorkspace", Shared.String "/repo");
      ("isolation", Shared.String "worktree");
      ( "workspaceBinding",
        Taumel.Agent_workspace.binding_to_json worktree_binding );
      ("worktreePath", Shared.String "/agents/agent-1");
      ("worktreeBranch", Shared.String "taumel/agent/agent-1");
      ("mainRepositoryRoot", Shared.String "/repo");
    ]
  in
  let metadata =
    expect_ok "decode worktree child metadata"
      (Child_session.decode_persisted_metadata (Shared.Object fields))
  in
  assert_bool "typed worktree effective workspace"
    (Child_session.effective_workspace metadata = Some "/agents/agent-1");
  (match Child_session.worktree_agent metadata with
  | Some worktree ->
      assert_equal "typed worktree agent id" "agent-1" worktree.agent_id;
      assert_equal "typed worktree repository" "/repo"
        worktree.main_repository_root
  | None -> fail "typed worktree metadata" "expected worktree agent");
  expect_error "worktree metadata requires repository root"
    (Child_session.decode_persisted_metadata
       (Shared.Object (List.remove_assoc "mainRepositoryRoot" fields)));
  expect_error "worktree path must match effective workspace"
    (Child_session.decode_persisted_metadata
       (Shared.Object
          (("worktreePath", Shared.String "/agents/other")
          :: List.remove_assoc "worktreePath" fields)));
  let shared_binding = Taumel.Agent_workspace.shared ~source_root:"/repo" in
  let shared =
    Child_session.decode_persisted_metadata
      (Shared.Object
         [
           ("kind", Shared.String "agent");
           ("agentKind", Shared.String "finder");
           ("agentId", Shared.String "agent-2");
           ("workspaceDirectory", Shared.String "/repo");
           ("sourceWorkspace", Shared.String "/repo");
           ("isolation", Shared.String "none");
           ( "workspaceBinding",
             Taumel.Agent_workspace.binding_to_json shared_binding );
         ])
    |> expect_ok "decode shared child metadata"
  in
  assert_bool "shared child has no broker context"
    (Child_session.worktree_agent shared = None);
  assert_bool "finder rejects escalation"
    (Child_session.rejects_escalation shared);
  ignore
    (Child_session.decode_persisted_metadata
       (Shared.Object
          [
            ("kind", Shared.String "ralph");
            ("objective", Shared.String "finish task");
            ("controllerSessionId", Shared.String "parent");
            ("maxIterations", Shared.Null);
            ("reflectionEvery", Shared.Number 2.);
          ])
    |> expect_ok "decode Ralph child metadata");
  expect_error "Ralph child metadata requires its objective"
    (Child_session.decode_persisted_metadata
       (Shared.Object [ ("kind", Shared.String "ralph") ]))


let () =
  test_gateway_enforces_profile_and_sandbox ();
  test_sandbox_patch_policy ();
  test_sandbox_workspace_metadata_protection ();
  test_child_session_setup_entries ();
  test_child_session_persisted_metadata ();
  test_goal_state_machine ();
  test_ralph_ownership ();
  test_thread_tools ();
  test_usage_openai_rendering ();
  test_tool_catalog_scope ();
  test_permissions_state ()
