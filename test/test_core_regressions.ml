module Capability = Taumel.Capability_profile
module Child_session = Taumel.Child_session
module Gateway = Taumel.Tool_gateway
module Goal = Taumel.Goal
module Input = Taumel.Request_user_input
module Permissions = Taumel.Permissions
module Ralph = Taumel.Ralph_loop
module Sandbox = Taumel.Sandbox
module Shared = Taumel.Shared
module Subagents = Taumel.Subagents
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

let sandbox_config =
  {
    Sandbox.filesystem_mode = Sandbox.Workspace_write;
    workspace_roots = [ "/repo" ];
    network_mode = Sandbox.Network_disabled;
    approval_policy = Sandbox.Never;
    no_sandbox = false;
    subagent = false;
  }

let test_component_codecs () =
  let profile =
    {
      Capability.default with
      sandbox_preset = Capability.Read_only;
      approval_policy = Capability.Never;
      tools = Capability.of_list [ "get_goal"; "usage" ];
      agents = Capability.None_allowed;
      no_sandbox_allowed = true;
    }
  in
  let decoded_profile =
    expect_ok "profile codec"
      (Capability.codec.decode (Capability.codec.encode profile))
  in
  assert_bool "profile sandbox round trip"
    (decoded_profile.sandbox_preset = Capability.Read_only);
  assert_bool "profile tools round trip"
    (Capability.allow_tool decoded_profile "usage");
  assert_bool "profile agents round trip"
    (not (Capability.allow_agent decoded_profile "worker"));
  let permissions_state =
    expect_ok "permissions create for codec"
      (Permissions.create ~network_mode:Sandbox.Network_enabled ~no_sandbox:true profile)
  in
  let permissions_state =
    expect_ok "permissions codec"
      (Permissions.codec.decode (Permissions.codec.encode permissions_state))
  in
  assert_bool "permissions profile round trip"
    (permissions_state.profile.approval_policy = Capability.Never);
  assert_bool "permissions network round trip"
    (permissions_state.sandbox.network_mode = Sandbox.Network_enabled);
  assert_bool "permissions no-sandbox round trip" permissions_state.sandbox.no_sandbox;
  let child_permissions =
    expect_ok "child permissions create for codec"
      (Permissions.create ~subagent:true profile)
  in
  let child_permissions =
    expect_ok "child permissions codec"
      (Permissions.codec.decode (Permissions.codec.encode child_permissions))
  in
  assert_bool "permissions subagent round trip" child_permissions.sandbox.subagent;
  let goal =
    expect_ok "goal codec create"
      (Goal.create ~token_budget:42 ~thread_id:"thread" ~now:10 "persist goal" None)
  in
  let decoded_goal =
    expect_ok "goal codec" (Goal.codec.decode (Goal.codec.encode (Some goal)))
  in
  (match decoded_goal with
  | Some decoded ->
      assert_equal "goal objective round trip" "persist goal" decoded.objective;
      assert_int "goal budget round trip" 42
        (Option.value decoded.token_budget ~default:0)
  | None -> fail "goal codec" "expected goal");
  let task =
    expect_ok "ralph codec start"
      (Ralph.start ~max_iterations:3 ~id:"r-persist"
         ~controller_session:"controller" "loop")
  in
  let task =
    expect_ok "ralph codec attach"
      (Ralph.attach_child (Ralph.Controller "controller") "child" task)
  in
  let decoded_tasks =
    expect_ok "ralph codec"
      (Ralph.codec.decode (Ralph.codec.encode [ task ]))
  in
  assert_int "ralph task count round trip" 1 (List.length decoded_tasks);
  assert_equal "ralph child round trip" "child"
    (Option.value (List.hd decoded_tasks).child_session ~default:"")

let test_read_only_allows_execution () =
  let read_only_config =
    {
      Sandbox.filesystem_mode = Sandbox.Read_only;
      workspace_roots = [ "/repo" ];
      network_mode = Sandbox.Network_disabled;
      approval_policy = Sandbox.On_request;
      no_sandbox = false;
      subagent = false;
    }
  in
  (* Execute must be allowed in read-only mode — the sandbox constrains how,
     not whether. *)
  assert_bool "read-only allows execute effect"
    (Sandbox.authorize_effect read_only_config Gateway.Execute = Ok ());
  (* Mutate must still be denied in read-only mode (filesystem mutation). *)
  (match Sandbox.authorize_effect read_only_config Gateway.Mutate with
  | Error _ -> ()
  | Ok _ -> fail "read-only mutate" "expected mutation denied in read-only");
  assert_bool "root session may spawn agent"
    (Sandbox.authorize_effect read_only_config Gateway.Spawn_agent = Ok ());
  assert_bool "subagent spawn effect is sandbox-neutral"
    (Sandbox.authorize_effect
       { read_only_config with Sandbox.subagent = true }
       Gateway.Spawn_agent
    = Ok ());
  (* The bwrap plan for read-only must mount the workspace read-only. *)
  let host =
    {
      Sandbox.platform = "linux";
      temp_roots = [];
      system_ro_paths = [];
      home_mount = "";
      workspace_roots = [ "/repo" ];
      workspace_metadata_listings = [];
    }
  in
  let invocation =
    expect_ok "read-only invocation"
      (Sandbox.plan_exec_invocation read_only_config host ~shell:"bash"
         ~shell_args:[ "-lc"; "ls" ] ~force_unsandboxed:false)
  in
  assert_bool "read-only invocation is sandboxed" invocation.sandboxed;
  assert_bool "read-only mounts workspace via --ro-bind"
    (List.mem "--ro-bind" invocation.args
    && List.mem "/repo" invocation.args);
  assert_bool "read-only does not bind workspace writable"
    (not
       (let rec check = function
          | [] | [ _ ] -> false
          | "--bind" :: path :: _ when path = "/repo" -> true
          | _ :: rest -> check rest
    in
        check invocation.args))

let test_bwrap_keeps_dev_mount_after_root_bind () =
  let config =
    {
      Sandbox.filesystem_mode = Sandbox.Danger_full_access;
      workspace_roots = [ "/repo" ];
      network_mode = Sandbox.Network_disabled;
      approval_policy = Sandbox.On_request;
      no_sandbox = false;
      subagent = false;
    }
  in
  let host =
    {
      Sandbox.platform = "linux";
      temp_roots = [];
      system_ro_paths = [];
      home_mount = "";
      workspace_roots = [ "/repo" ];
      workspace_metadata_listings = [];
    }
  in
  let invocation =
    expect_ok "full-access network-restricted invocation"
      (Sandbox.plan_exec_invocation config host ~shell:"bash"
         ~shell_args:[ "-lc"; "git status" ] ~force_unsandboxed:false)
  in
  let rec index_of_sequence needle haystack index =
    let rec starts_with needle haystack =
      match (needle, haystack) with
      | [], _ -> true
      | expected :: needle_rest, actual :: haystack_rest ->
          expected = actual && starts_with needle_rest haystack_rest
      | _ :: _, [] -> false
    in
    match haystack with
    | [] -> -1
    | _ :: rest ->
        if starts_with needle haystack then index
        else index_of_sequence needle rest (index + 1)
  in
  let root_bind = index_of_sequence [ "--bind"; "/"; "/" ] invocation.args 0 in
  let dev_mount = index_of_sequence [ "--dev"; "/dev" ] invocation.args 0 in
  assert_bool "full-access restricted network uses bwrap" invocation.sandboxed;
  assert_bool "root bind present" (root_bind >= 0);
  assert_bool "dev mount present" (dev_mount >= 0);
  assert_bool "dev mount comes after root bind" (dev_mount > root_bind)

let test_sandbox_patch_metadata_protection () =
  (* apply_patch must deny writes to protected workspace metadata dirs. *)
  let git_patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: /repo/.git/config";
        "+malicious";
        "*** End Patch";
      ]
  in
  expect_error "git config denied by apply_patch"
    (Sandbox.apply_patch_to_map sandbox_config Shared.String_map.empty git_patch);
  let hg_patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: /repo/.hg/store/00manifest.i";
        "+malicious";
        "*** End Patch";
      ]
  in
  expect_error "hg store denied by apply_patch"
    (Sandbox.apply_patch_to_map sandbox_config Shared.String_map.empty hg_patch);
  let svn_patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: /repo/.svn/entries";
        "+malicious";
        "*** End Patch";
      ]
  in
  expect_error "svn entries denied by apply_patch"
    (Sandbox.apply_patch_to_map sandbox_config Shared.String_map.empty svn_patch);
  (* Normal workspace files are still allowed. *)
  let normal_patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: /repo/src/main.ml";
        "+code";
        "*** End Patch";
      ]
  in
  let files =
    expect_ok "normal workspace file allowed"
      (Sandbox.apply_patch_to_map sandbox_config Shared.String_map.empty normal_patch)
  in
  assert_bool "normal file written"
    (Shared.String_map.mem "/repo/src/main.ml" files)

let test_sandbox_resolved_workspace_mutation_paths () =
  let allow =
    Sandbox.validate_resolved_workspace_mutation_paths
      ~workspace_roots:[ "/repo" ]
      [
        {
          Sandbox.requested_path = "/repo/src/main.ml";
          resolved_path = "/repo/src/main.ml";
        };
      ]
  in
  expect_ok_any "resolved workspace mutation allowed" allow;
  (match
     Sandbox.validate_resolved_workspace_mutation_paths
       ~workspace_roots:[ "/repo" ]
       [
         {
           Sandbox.requested_path = "/repo/link/pwned";
           resolved_path = "/tmp/outside/pwned";
         };
       ]
   with
  | Error "Sandbox: apply_patch path escapes workspace: /repo/link/pwned" -> ()
  | Error message ->
      fail "resolved workspace escape" ("unexpected error: " ^ message)
  | Ok _ -> fail "resolved workspace escape" "expected escape denial");
  (match
     Sandbox.validate_resolved_workspace_mutation_paths
       ~workspace_roots:[ "/repo" ]
       [
         {
           Sandbox.requested_path = "/repo/gitlink/config";
           resolved_path = "/repo/.git/config";
         };
       ]
   with
  | Error
      "Sandbox: path is inside protected workspace metadata: /repo/gitlink/config" ->
      ()
  | Error message ->
      fail "resolved metadata path" ("unexpected error: " ^ message)
  | Ok _ -> fail "resolved metadata path" "expected metadata denial")

let test_sandbox_patch_relative_paths () =
  (* Relative Codex patch paths must resolve against the workspace root. *)
  let patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Add File: src/relative.txt";
        "+relative content";
        "*** End Patch";
      ]
  in
  let files =
    expect_ok "relative path patch applied"
      (Sandbox.apply_patch_to_map sandbox_config Shared.String_map.empty patch)
  in
  (* Map keys stay as the original patch path. *)
  assert_bool "relative path in result map"
    (Shared.String_map.mem "src/relative.txt" files);
  assert_equal "relative path content" "relative content\n"
    (Shared.String_map.find "src/relative.txt" files);
  (* Update on a relative path also works. *)
  let update =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Update File: src/relative.txt";
        "@@";
        "-relative content";
        "+updated content";
        "*** End Patch";
      ]
  in
  let files = expect_ok "relative path update" (Sandbox.apply_patch_to_map sandbox_config files update) in
  assert_equal "relative path updated" "updated content\n"
    (Shared.String_map.find "src/relative.txt" files)

let test_sandbox_patch_tolerant_tau_cases () =
  let files =
    Shared.String_map.empty
    |> Shared.String_map.add "src/app.ts" "alpha  \nDon't wait…\nomega\n"
    |> Shared.String_map.add "src/old.ts" "before\n"
	    |> Shared.String_map.add "obsolete.txt" "delete me\n"
	    |> Shared.String_map.add "crlf.txt" "old\r\n"
	    |> Shared.String_map.add "eof.txt" "start\nmarker\nend\nmiddle\nmarker\nend\n"
	    |> Shared.String_map.add "blank.txt" "one\ntwo\n"
  in
  let heredoc_missing_end =
    String.concat "\n"
      [
        "<<'PATCH'";
        "*** Begin Patch";
        "*** Update File: src/app.ts";
        "@@";
        "-alpha";
        "+beta";
        "PATCH";
      ]
  in
  let files =
    expect_ok "heredoc and missing end marker"
      (Sandbox.apply_patch_to_map sandbox_config files heredoc_missing_end)
  in
  assert_equal "trimEnd fallback" "beta\nDon't wait…\nomega\n"
    (Shared.String_map.find "src/app.ts" files);
  let unicode_patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Update File: src/app.ts";
        "@@";
        "-Don't wait...";
        "+Done";
        "*** End Patch";
      ]
  in
  let files =
    expect_ok "unicode punctuation fallback"
      (Sandbox.apply_patch_to_map sandbox_config files unicode_patch)
  in
  assert_equal "unicode fallback" "beta\nDone\nomega\n"
    (Shared.String_map.find "src/app.ts" files);
  let git_diff =
    String.concat "\n"
      [
        "diff --git a/src/old.ts b/src/new.ts";
        "rename from src/old.ts";
        "rename to src/new.ts";
        "--- a/src/old.ts";
        "+++ b/src/new.ts";
        "@@ -1 +1 @@";
        "-before";
        "+after";
        "diff --git a/obsolete.txt b/obsolete.txt";
        "deleted file mode 100644";
        "--- a/obsolete.txt";
        "+++ /dev/null";
        "diff --git a/dev/null b/notes/hello.txt";
        "new file mode 100644";
        "--- /dev/null";
        "+++ b/notes/hello.txt";
        "@@ -0,0 +1 @@";
        "+Hello world";
      ]
  in
  let files = expect_ok "git diff add rename delete" (Sandbox.apply_patch_to_map sandbox_config files git_diff) in
  assert_bool "a/b source removed" (not (Shared.String_map.mem "src/old.ts" files));
  assert_equal "rename target normalized" "after\n"
    (Shared.String_map.find "src/new.ts" files);
  assert_bool "dev null delete removed" (not (Shared.String_map.mem "obsolete.txt" files));
  assert_equal "dev null add normalized" "Hello world\n"
    (Shared.String_map.find "notes/hello.txt" files);
  let eof_patch =
    String.concat "\n"
      [
        "*** Begin Patch";
        "*** Update File: eof.txt";
        "@@";
        "-marker";
        "-end";
        "+marker-changed";
        "+end";
        "*** End of File";
        "*** End Patch";
      ]
  in
  let files = expect_ok "end of file hunk" (Sandbox.apply_patch_to_map sandbox_config files eof_patch) in
  assert_equal "eof hunk matches from end"
    "start\nmarker\nend\nmiddle\nmarker-changed\nend\n"
    (Shared.String_map.find "eof.txt" files);
  let crlf_patch =
    String.concat "\n"
      [
        "--- a/crlf.txt";
        "+++ b/crlf.txt";
        "@@ -1 +1 @@";
        "-old";
        "+new";
      ]
  in
	  let files = expect_ok "unified diff and crlf preservation" (Sandbox.apply_patch_to_map sandbox_config files crlf_patch) in
	  assert_equal "crlf preserved" "new\r\n" (Shared.String_map.find "crlf.txt" files);
	  let trailing_blank_patch =
	    String.concat "\n"
	      [
	        "*** Begin Patch";
	        "*** Update File: blank.txt";
	        "@@";
	        "-one";
	        "-two";
	        "-";
	        "+uno";
	        "+dos";
	        "+";
	        "*** End Patch";
	      ]
	  in
	  let files =
	    expect_ok "trailing blank-line mismatch fallback"
      (Sandbox.apply_patch_to_map sandbox_config files trailing_blank_patch)
  in
  assert_equal "trailing blank mismatch fallback" "uno\ndos\n"
    (Shared.String_map.find "blank.txt" files)

let test_sandbox_edit_application () =
  let edit old_text new_text : Sandbox.edit_replacement = { old_text; new_text } in
  let updated =
    expect_ok "edit preserves bom and crlf"
      (Sandbox.apply_edits ~display_path:"file.txt"
         "\239\187\191one\r\ntwo\r\nthree\r\n"
         [ edit "one\ntwo" "uno\ndos" ])
  in
  assert_equal "edit preserves bom and crlf"
    "\239\187\191uno\r\ndos\r\nthree\r\n" updated;
  expect_error "edit duplicate oldText denied"
    (Sandbox.apply_edits ~display_path:"dup.txt" "same\nsame\n"
       [ edit "same" "changed" ]);
  expect_error "edit no-op denied"
    (Sandbox.apply_edits ~display_path:"noop.txt" "same\n" [ edit "same" "same" ])

let test_child_approval_clamping () =
  (* Child cannot widen approval/escalation beyond parent. *)
  let base_parent =
    { Capability.default with agents = Capability.of_list [ "worker" ] }
  in
  (* Parent Never, child requests On_request → clamped to Never. *)
  let parent = { base_parent with approval_policy = Capability.Never } in
  let child =
    expect_ok "never parent child"
      (Capability.child_profile parent
         {
           Capability.name = "worker";
           enabled = true;
           model_id = None;
           thinking_level = None;
           sandbox_preset = None;
           approval_policy = Some Capability.On_request;
           tools = None;
           agents = None;
           allow_no_sandbox = true;
         })
  in
  assert_bool "child approval clamped to parent Never"
    (child.approval_policy = Capability.Never);
  (* Parent On_failure, child requests Never → Never (stricter is fine). *)
  let parent_strict = { base_parent with approval_policy = Capability.On_failure } in
  let child_strict =
    expect_ok "stricter child allowed"
      (Capability.child_profile parent_strict
         {
           Capability.name = "worker";
           enabled = true;
           model_id = None;
           thinking_level = None;
           sandbox_preset = None;
           approval_policy = Some Capability.Never;
           tools = None;
           agents = None;
           allow_no_sandbox = false;
         })
  in
  assert_bool "child can be stricter than parent"
    (child_strict.approval_policy = Capability.Never);
  (* Parent Untrusted, child requests On_failure → clamped to Untrusted. *)
  let parent_untrusted =
    { base_parent with approval_policy = Capability.Untrusted }
  in
  let child_widened =
    expect_ok "untrusted clamped child"
      (Capability.child_profile parent_untrusted
         {
           Capability.name = "worker";
           enabled = true;
           model_id = None;
           thinking_level = None;
           sandbox_preset = None;
           approval_policy = Some Capability.On_failure;
           tools = None;
           agents = None;
           allow_no_sandbox = false;
         })
  in
  assert_bool "child On_failure clamped to Untrusted"
    (child_widened.approval_policy = Capability.Untrusted)

let test_gateway_wraps_legacy_mutation_tools () =
  (* bash still has no Taumel wrapper; edit/write are Taumel-owned mutation
     wrappers and therefore go through gateway sandbox authorization. *)
  let context =
    { Gateway.profile = Capability.default; authorize_effect = (fun _ -> Ok ()) }
  in
  (match Gateway.authorize Gateway.empty context ~name:"bash" with
  | Error (Gateway.Unknown_tool "bash") -> ()
  | _ -> fail "gateway bash builtin" "expected Unknown_tool for bash");
  let registry =
    List.fold_left
      (fun registry spec -> Gateway.register spec registry)
      Gateway.empty Sandbox.canonical_tool_specs
  in
  List.iter
    (fun name ->
      expect_ok_any ("gateway " ^ name)
        (Gateway.authorize registry context ~name))
    [ "edit"; "write" ];
  let read_only =
    {
      sandbox_config with
      Sandbox.filesystem_mode = Sandbox.Read_only;
      approval_policy = Sandbox.Never;
    }
  in
  let denied_context =
    {
      Gateway.profile = Capability.default;
      authorize_effect = Sandbox.authorize_effect read_only;
    }
  in
  List.iter
    (fun name ->
      match Gateway.authorize registry denied_context ~name with
      | Error (Gateway.Denied_effect (Gateway.Mutate, _)) -> ()
      | _ -> fail "legacy wrapper sandbox" ("expected mutation denial for " ^ name))
    [ "edit"; "write" ];
  (* Active-tools rewrite must replace raw bash and route mutation tools by provider. *)
  let sync =
    Tool_catalog.plan_active_tools_sync ~provider:"openai-codex"
      [ "bash"; "edit"; "write"; "find_thread" ]
  in
  assert_bool "rewrite removes bash" (not (List.mem "bash" sync.tools));
  assert_bool "rewrite removes edit" (not (List.mem "edit" sync.tools));
  assert_bool "rewrite removes write" (not (List.mem "write" sync.tools));
  assert_bool "rewrite adds exec_command" (List.mem "exec_command" sync.tools);
  assert_bool "rewrite adds write_stdin" (List.mem "write_stdin" sync.tools);
  assert_bool "rewrite adds apply_patch" (List.mem "apply_patch" sync.tools);
  assert_bool "rewrite preserves find_thread" (List.mem "find_thread" sync.tools);
  assert_bool "rewrite changed" sync.changed

let test_goal_turn_accounting () =
  let goal =
    expect_ok "goal create"
      (Goal.create ~token_budget:15 ~thread_id:"thread" ~now:10 "ship core"
         None)
  in
  let branch =
    [
      Shared.Object
        [
          ( "message",
            Shared.Object
              [
                ("role", Shared.String "assistant");
                ( "usage",
                  Shared.Object
                    [
                      ("input_tokens", Shared.Number 100.);
                      ("output_tokens", Shared.Number 1.);
                    ] );
              ] );
        ];
      Shared.Object
        [ ("message", Shared.Object [ ("role", Shared.String "user") ]) ];
      Shared.Object
        [
          ( "message",
            Shared.Object
              [
                ("role", Shared.String "assistant");
                ( "usage",
                  Shared.Object
                    [
                      ( "totalTokenUsage",
                        Shared.Object
                          [
                            ("inputTokens", Shared.Number 12.);
                            ("cachedInputTokens", Shared.Number 2.);
                            ("outputTokens", Shared.Number 5.);
                          ] );
                    ] );
              ] );
        ];
    ]
  in
  let accounted =
    Goal.account_turn_end ~session_id:"session" ~now:20
      ~last_accounting_key:None ~branch (Some goal)
  in
  assert_bool "goal accounting changed" accounted.changed;
  let updated =
    match accounted.goal with
    | Some goal -> goal
    | None -> fail "goal accounting" "expected updated goal"
  in
  assert_int "goal accounting token delta" 15 updated.tokens_used;
  assert_int "goal accounting time delta" 10 updated.time_used_seconds;
  assert_bool "goal accounting budget limit"
    (updated.status = Goal.Budget_limited);
  let repeated =
    Goal.account_turn_end ~session_id:"session" ~now:30
      ~last_accounting_key:accounted.accounting_key ~branch accounted.goal
  in
  assert_bool "goal accounting dedupes same turn" (not repeated.changed);
  let repeated_goal =
    match repeated.goal with
    | Some goal -> goal
    | None -> fail "goal accounting dedupe" "expected goal"
  in
  assert_int "goal accounting dedupe tokens" 15 repeated_goal.tokens_used;
  assert_int "goal accounting dedupe time" 10 repeated_goal.time_used_seconds

let test_permissions_active_resolution () =
  let resolved =
    Permissions.resolve_active
      ~host_sandbox_preset:(Some Capability.Read_only)
      ~host_network_mode:(Some Sandbox.Network_enabled)
      ~host_no_sandbox:(Some true) ~session_subagent:false
      Permissions.Missing
  in
  assert_bool "missing permissions uses host sandbox"
    (resolved.profile.sandbox_preset = Capability.Read_only);
  assert_bool "missing permissions uses host network"
    (resolved.network_mode = Sandbox.Network_enabled);
  assert_bool "missing permissions uses host no-sandbox" resolved.no_sandbox;
  assert_bool "missing permissions records root session"
    (not resolved.subagent);
  assert_equal "missing permissions filesystem mode" "read-only"
    resolved.filesystem_mode;
  let persisted_profile =
    {
      Capability.default with
      sandbox_preset = Capability.Danger_full_access;
      no_sandbox_allowed = true;
    }
  in
  let persisted =
    expect_ok "persisted permissions"
      (Permissions.create ~network_mode:Sandbox.Network_enabled ~no_sandbox:true
         persisted_profile)
  in
  let child =
    Permissions.resolve_active ~host_sandbox_preset:None ~host_network_mode:None
      ~host_no_sandbox:None ~session_subagent:true
      (Permissions.Persisted persisted)
  in
  assert_bool "subagent persisted permissions are clamped"
    (not child.profile.no_sandbox_allowed);
  assert_bool "subagent no-sandbox disabled" (not child.no_sandbox);
  assert_bool "subagent marker kept" child.subagent;
  assert_equal "subagent filesystem mode" "danger-full-access"
    child.filesystem_mode

let test_goal_command_planning () =
  let created =
    expect_ok "goal command create"
      (Goal.apply_command ~thread_id:"thread" ~now:10 "start ship the thing"
         None)
  in
  assert_bool "goal command create followup" created.followup;
  let active =
    match created.goal with
    | Some goal -> goal
    | None -> fail "goal command create" "expected goal"
  in
  assert_equal "goal command create summary" "Goal active: ship the thing"
    created.message;
  assert_equal "goal command create objective" "ship the thing" active.objective;
  let shown =
    expect_ok "goal command show"
      (Goal.apply_command ~thread_id:"thread" ~now:11 "status" created.goal)
  in
  assert_bool "goal command show no followup" (not shown.followup);
  assert_equal "goal command show summary" "Goal active: ship the thing"
    shown.message;
  let completed =
    expect_ok "goal command complete"
      (Goal.apply_command ~thread_id:"thread" ~now:12 "complete" shown.goal)
  in
  assert_bool "goal command complete no followup" (not completed.followup);
  assert_equal "goal command complete summary" "Goal complete: ship the thing"
    completed.message;
  assert_bool "goal command completion report absent without usage"
    (completed.completion_report = None)

let test_goal_continuation_planning () =
  let goal =
    expect_ok "goal continuation create"
      (Goal.create ~thread_id:"thread" ~now:10 "continue me" None)
  in
  (match Goal.plan_continuation ~initial:true (Some goal) with
  | Goal.Send_continuation plan ->
      assert_equal "initial continuation custom type" "taumel.goal.continue"
        plan.custom_type;
      assert_bool "initial continuation triggers turn" plan.trigger_turn;
      assert_equal "initial continuation deliver as" "followUp" plan.deliver_as;
      assert_equal "initial continuation content"
        "Active goal started.\n\nObjective:\ncontinue me\n\nWork toward this objective. Before declaring completion, audit concrete evidence: files, command output, tests, and other current state. If the goal is achieved and no required work remains, call update_goal with status \"complete\". Otherwise continue with the next concrete action."
        plan.content
  | Goal.No_continuation ->
      fail "goal continuation" "expected active continuation");
  let complete = { goal with status = Goal.Complete } in
  (match Goal.plan_continuation ~initial:false (Some complete) with
  | Goal.No_continuation -> ()
  | Goal.Send_continuation _ ->
      fail "goal continuation complete" "expected no continuation")

let ralph_child_session id = "child-" ^ id

let test_ralph_command_planning () =
  let started =
    expect_ok "ralph command start"
      (Ralph.apply_command ~now:42 ~controller_session:"controller"
         ~child_session_for_id:ralph_child_session ~start_denied:None []
         "start --max 2 --reflect 1 build the thing")
  in
  assert_bool "ralph command start changed" started.changed;
  assert_equal "ralph command start message"
    "Started ralph-42 [running] child=child-ralph-42 iteration=0 max=2 reflect=1 objective=build the thing"
    started.message;
  (match started.start_details with
  | Some details ->
      assert_equal "ralph command start details task" "ralph-42"
        details.task_id;
      assert_equal "ralph command start details child" "child-ralph-42"
        details.child_session_id;
      assert_bool "ralph command start details prompt"
        (String.length details.child_prompt > 0)
  | None -> fail "ralph command start details" "expected start details");
  assert_int "ralph command start task count" 1 (List.length started.tasks);
  let paused =
    expect_ok "ralph command pause"
      (Ralph.apply_command ~now:43 ~controller_session:"controller"
         ~child_session_for_id:ralph_child_session ~start_denied:None
         started.tasks "pause ralph-42")
  in
  assert_bool "ralph command pause changed" paused.changed;
  assert_equal "ralph command pause message"
    "ralph-42 [paused] child=child-ralph-42 iteration=0 max=2 reflect=1 objective=build the thing"
    paused.message;
  let archived =
    expect_ok "ralph command archive"
      (Ralph.apply_command ~now:44 ~controller_session:"controller"
         ~child_session_for_id:ralph_child_session ~start_denied:None
         paused.tasks "archive ralph-42")
  in
  let listed =
    expect_ok "ralph command list"
      (Ralph.apply_command ~now:45 ~controller_session:"controller"
         ~child_session_for_id:ralph_child_session ~start_denied:None
         archived.tasks "list")
  in
  assert_bool "ralph command list unchanged" (not listed.changed);
  assert_equal "ralph command list hides archived" "No Ralph tasks."
    listed.message;
  (match
     Ralph.apply_command ~now:46 ~controller_session:"controller"
       ~child_session_for_id:ralph_child_session
       ~start_denied:(Some "agent denied") [] "start blocked"
   with
  | Error "agent denied" -> ()
  | Error message ->
      fail "ralph command denied" ("unexpected error: " ^ message)
  | Ok _ -> fail "ralph command denied" "expected error")

let test_subagent_tool_planning () =
  let parent_profile =
    { Capability.default with agents = Capability.of_list [ "worker" ] }
  in
  let owner : Subagents.owner = { id = "root"; is_subagent = false; depth = 0 } in
  let spawn_request =
    Subagents.Spawn
      {
        id = "w1";
        name = "worker";
        prompt = "do work";
        model_id = None;
        thinking_level = None;
        sandbox_preset = None;
        tools = None;
        workspace_roots = [ "/repo" ];
        no_sandbox = false;
      }
  in
  let spawned =
    expect_ok "agent spawn"
      (Subagents.apply_request ~parent_profile ~owner [] spawn_request)
  in
  assert_bool "agent spawn changed" spawned.changed;
  assert_equal "agent spawn action" "agent_spawn" spawned.action;
  assert_equal "agent spawn prompt" "do work" spawned.prompt;
  assert_equal "agent spawn message"
    "Spawned w1 [running] sandbox=workspace-write subagent=true"
    spawned.message;
  assert_int "agent spawn worker count" 1 (List.length spawned.workers);
  (match
     Subagents.apply_request ~parent_profile ~owner spawned.workers spawn_request
   with
  | Error "worker already exists: w1" -> ()
  | Error message -> fail "agent duplicate" ("unexpected error: " ^ message)
  | Ok _ -> fail "agent duplicate" "expected duplicate error");
  let sent =
    expect_ok "agent send"
      (Subagents.apply_request ~parent_profile ~owner spawned.workers
         (Subagents.Send { id = "w1"; prompt = "next" }))
  in
  assert_equal "agent send action" "agent_send" sent.action;
  assert_equal "agent send prompt" "next" sent.prompt;
  assert_equal "agent send message"
    "Sent prompt to w1 [waiting] sandbox=workspace-write subagent=true"
    sent.message;
  let listed =
    expect_ok "agent list"
      (Subagents.apply_request ~parent_profile ~owner sent.workers Subagents.List)
  in
  assert_bool "agent list unchanged" (not listed.changed);
  assert_equal "agent list text"
    "w1 [waiting] sandbox=workspace-write subagent=true" listed.message;
  let other_owner : Subagents.owner =
    { id = "other"; is_subagent = false; depth = 0 }
  in
  (match
     Subagents.apply_request ~parent_profile ~owner:other_owner sent.workers
       (Subagents.Close { id = "w1" })
   with
  | Error "worker is not owned by this session: w1" -> ()
  | Error message -> fail "agent ownership" ("unexpected error: " ^ message)
  | Ok _ -> fail "agent ownership" "expected ownership error")

let () =
  test_component_codecs ();
  test_read_only_allows_execution ();
  test_bwrap_keeps_dev_mount_after_root_bind ();
  test_sandbox_patch_metadata_protection ();
  test_sandbox_resolved_workspace_mutation_paths ();
  test_sandbox_patch_relative_paths ();
  test_sandbox_patch_tolerant_tau_cases ();
  test_sandbox_edit_application ();
  test_child_approval_clamping ();
  test_gateway_wraps_legacy_mutation_tools ();
  test_goal_turn_accounting ();
  test_permissions_active_resolution ();
  test_goal_command_planning ();
  test_goal_continuation_planning ();
  test_ralph_command_planning ();
  test_subagent_tool_planning ()
