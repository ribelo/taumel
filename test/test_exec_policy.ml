module Exec_policy = Taumel.Exec_policy
module Capability = Taumel.Capability_profile
module Permissions = Taumel.Permissions
module Sandbox = Taumel.Sandbox

let assert_equal label expected actual =
  if expected <> actual then
    failwith
      (Printf.sprintf "%s: expected %s, got %s" label expected actual)

let assert_bool label value =
  if not value then failwith (label ^ ": expected true")

let assert_false label value =
  if value then failwith (label ^ ": expected false")

let assert_decision label expected actual =
  assert_equal label (Exec_policy.decision_to_string expected)
    (Exec_policy.decision_to_string actual)

let rule ?(decision = Exec_policy.Allow) ?(matches = []) ?(not_matches = []) pattern =
  Exec_policy.{
    raw_id = None;
    raw_pattern = pattern;
    raw_decision = decision;
    raw_justification = None;
    raw_match_examples = matches;
    raw_not_match_examples = not_matches;
  }

let one value = Exec_policy.One value
let any values = Exec_policy.Alternatives values

let test_prefix_alternatives () =
  let compiled =
    Exec_policy.compile
      [
        ( "global",
          [
            rule ~decision:Exec_policy.Prompt
              [ one "git"; any [ "reset"; "checkout" ]; one "--hard" ];
          ] );
      ]
  in
  let check = Exec_policy.decide_tokens compiled [ "git"; "reset"; "--hard"; "HEAD" ] in
  assert_decision "alternatives match" Exec_policy.Prompt check.decision;
  assert_equal "matched rule count" "1" (string_of_int (List.length check.matched_rules))

let test_strictest_wins () =
  let compiled =
    Exec_policy.compile
      [
        ( "global",
          [
            rule ~decision:Exec_policy.Allow [ one "git" ];
            rule ~decision:Exec_policy.Forbidden [ one "git"; one "reset" ];
            rule ~decision:Exec_policy.Prompt [ one "git"; one "reset"; one "--soft" ];
          ] );
      ]
  in
  let check = Exec_policy.decide_tokens compiled [ "git"; "reset"; "--soft" ] in
  assert_decision "strictest" Exec_policy.Forbidden check.decision

let test_no_match_defaults () =
  let clean = Exec_policy.compile [ ("global", [ rule [ one "ls" ] ]) ] in
  let clean_no_match = Exec_policy.decide_tokens clean [ "pwd" ] in
  assert_decision "clean no-match" Exec_policy.Allow clean_no_match.decision;
  assert_bool "clean no-match has no override"
    (Exec_policy.override_decision clean_no_match = None);
  let invalid =
    Exec_policy.compile
      [
        ( "global",
          [
            rule ~matches:[ Exec_policy.Tokens [ "git"; "reset" ] ]
              [ one "git"; one "reset"; one "--hard" ];
          ] );
      ]
  in
  assert_equal "invalid skipped" "0" (string_of_int (Exec_policy.active_rule_count invalid));
  assert_decision "error no-match prompt" Exec_policy.Prompt
    (Exec_policy.decide_tokens invalid [ "pwd" ]).decision;
  assert_bool "error no-match overrides"
    (Exec_policy.override_decision (Exec_policy.decide_tokens invalid [ "pwd" ]) = Some Exec_policy.Prompt)

let test_validation_not_match () =
  let compiled =
    Exec_policy.compile
      [
        ( "global",
          [
            rule ~not_matches:[ Exec_policy.Tokens [ "rm"; "file" ] ]
              [ one "rm" ];
          ] );
      ]
  in
  assert_equal "not_match invalid skipped" "0"
    (string_of_int (Exec_policy.active_rule_count compiled));
  assert_equal "validation error count" "1"
    (string_of_int (List.length compiled.errors))

let test_ast_walk () =
  let ast =
    Exec_policy.{
      kind = "program";
      text = "ls -l | grep ml";
      children =
        [
          {
            kind = "pipeline";
            text = "ls -l | grep ml";
            children =
              [
                {
                  kind = "command";
                  text = "ls -l";
                  children =
                    [
                      { kind = "command_name"; text = "ls"; children = [] };
                      { kind = "word"; text = "-l"; children = [] };
                    ];
                };
                { kind = "|"; text = "|"; children = [] };
                {
                  kind = "command";
                  text = "grep ml";
                  children =
                    [
                      { kind = "command_name"; text = "grep"; children = [] };
                      { kind = "word"; text = "ml"; children = [] };
                    ];
                };
              ];
          };
        ];
    }
  in
  match Exec_policy.command_tokens_from_ast ast with
  | Ok tokens -> assert_equal "walk tokens" "ls,-l,grep,ml" (String.concat "," tokens)
  | Error message -> failwith message

let test_ast_sequence_strictest () =
  let compiled =
    Exec_policy.compile
      [
        ( "global",
          [
            rule [ one "ls" ];
            rule ~decision:Exec_policy.Forbidden [ one "rm" ];
          ] );
      ]
  in
  let ast =
    Exec_policy.{
      kind = "program";
      text = "ls; rm file";
      children =
        [
          {
            kind = "list";
            text = "ls; rm file";
            children =
              [
                {
                  kind = "command";
                  text = "ls";
                  children =
                    [ { kind = "command_name"; text = "ls"; children = [ { kind = "word"; text = "ls"; children = [] } ] } ];
                };
                { kind = ";"; text = ";"; children = [] };
                {
                  kind = "command";
                  text = "rm file";
                  children =
                    [
                      { kind = "command_name"; text = "rm"; children = [ { kind = "word"; text = "rm"; children = [] } ] };
                      { kind = "word"; text = "file"; children = [] };
                    ];
                };
              ];
          };
        ];
    }
  in
  assert_decision "sequence strictest" Exec_policy.Forbidden
    (Exec_policy.decide_ast compiled ast).decision

let test_ast_unsupported_prompts () =
  let compiled = Exec_policy.compile [ ("global", [ rule [ one "echo" ] ]) ] in
  let ast =
    Exec_policy.{
      kind = "program";
      text = "echo $HOME";
      children =
        [
          {
            kind = "command";
            text = "echo $HOME";
            children =
              [
                { kind = "command_name"; text = "echo"; children = [] };
                { kind = "simple_expansion"; text = "$HOME"; children = [] };
              ];
          };
        ];
    }
  in
  assert_decision "unsupported ast prompts" Exec_policy.Prompt
    (Exec_policy.decide_ast compiled ast).decision

let test_empty_policy_fallback () =
  let context =
    Exec_policy.{
      approval_never = false;
      approval_prompts_available = true;
      sandbox_restricted = true;
      sandbox_disabled = false;
      requests_sandbox_override = false;
    }
  in
  assert_decision "safe fallback" Exec_policy.Allow
    (Exec_policy.decision_for_unmatched_command context [ "ls"; "-l" ]);
  assert_decision "dangerous fallback prompts under on-request" Exec_policy.Prompt
    (Exec_policy.decision_for_unmatched_command context [ "rm"; "-rf"; "target" ]);
  assert_decision "dangerous fallback prompts without sandbox" Exec_policy.Prompt
    (Exec_policy.decision_for_unmatched_command
       { context with sandbox_restricted = false; sandbox_disabled = true }
       [ "rm"; "-rf"; "target" ]);
  assert_decision "dangerous fallback allowed under never" Exec_policy.Allow
    (Exec_policy.decision_for_unmatched_command
       { context with approval_never = true; approval_prompts_available = false; sandbox_restricted = false; sandbox_disabled = true }
       [ "rm"; "-rf"; "target" ]);
  assert_decision "sudo dangerous fallback allowed under never full access" Exec_policy.Allow
    (Exec_policy.decision_for_unmatched_command
       { context with approval_never = true; approval_prompts_available = false; sandbox_restricted = false; sandbox_disabled = true }
       [ "sudo"; "rm"; "-rf"; "/tmp/target" ]);
  assert_bool "git status is safe" (Exec_policy.is_known_safe_command [ "git"; "status" ]);
  assert_false "git branch delete is not safe"
    (Exec_policy.is_known_safe_command [ "git"; "branch"; "-d"; "feature" ])

let test_unsupported_defers_to_sandbox () =
  let unsupported =
    Exec_policy.{
      kind = "program";
      text = "for d in a b; do echo $d; done";
      children =
        [ { kind = "for_statement"; text = "for d in a b; do echo $d; done"; children = [] } ];
    }
  in
  let compiled = Exec_policy.empty in
  let sandbox_on =
    Exec_policy.{
      approval_never = false;
      approval_prompts_available = true;
      sandbox_restricted = true;
      sandbox_disabled = false;
      requests_sandbox_override = false;
    }
  in
  assert_decision "unsupported construct runs under an active sandbox" Exec_policy.Allow
    (Exec_policy.decide_ast_with_fallback compiled sandbox_on unsupported).decision;
  let yolo =
    Exec_policy.{
      approval_never = true;
      approval_prompts_available = false;
      sandbox_restricted = false;
      sandbox_disabled = true;
      requests_sandbox_override = false;
    }
  in
  assert_decision "unsupported construct runs under never with no sandbox" Exec_policy.Allow
    (Exec_policy.decide_ast_with_fallback compiled yolo unsupported).decision;
  let escalated = { sandbox_on with requests_sandbox_override = true } in
  assert_decision "unsupported construct prompts when escalation is requested" Exec_policy.Prompt
    (Exec_policy.decide_ast_with_fallback compiled escalated unsupported).decision

let test_approval_rank_ordering () =
  assert_bool "untrusted stricter than on-request"
    (Capability.stricter_approval Capability.Untrusted Capability.On_request
    = Capability.Untrusted);
  assert_bool "on-request stricter than on-failure"
    (Capability.stricter_approval Capability.On_request Capability.On_failure
    = Capability.On_request);
  assert_bool "on-failure stricter than never"
    (Capability.stricter_approval Capability.On_failure Capability.Never
    = Capability.On_failure)

let test_exec_policy_prompt_under_never_allows_but_boundaries_deny () =
  let never_read_only =
    {
      Sandbox.filesystem_mode = Sandbox.Read_only;
      workspace_roots = [ "/repo" ];
      network_mode = Sandbox.Network_disabled;
      approval_policy = Sandbox.Never;
      no_sandbox = false;
      isolated_child = false;
    }
  in
  (match
     Sandbox.authorize_exec ~policy_decision:Exec_policy.Prompt never_read_only
       { cmd = "rm -rf target"; workdir = Some "/repo"; sandbox_permissions = Sandbox.Use_default }
   with
  | Sandbox.Allow -> ()
  | _ -> failwith "exec policy prompt under never: expected allow");
  (match Sandbox.authorize_mutation_path never_read_only Sandbox.Write "/repo/file" with
  | Sandbox.Deny _ -> ()
  | _ -> failwith "read-only write under never: expected denial")

let test_fresh_full_access_dangerous_prompts () =
  let active =
    Permissions.resolve_active ~host_sandbox_preset:None ~host_network_mode:None
      ~host_no_sandbox:None ~session_isolated_child:false Permissions.Missing
  in
  assert_bool "fresh session is on-request full access"
    (active.profile.sandbox_preset = Capability.Danger_full_access
    && active.profile.approval_policy = Capability.On_request);
  let context =
    Exec_policy.{
      approval_never = false;
      approval_prompts_available = true;
      sandbox_restricted = false;
      sandbox_disabled = true;
      requests_sandbox_override = false;
    }
  in
  assert_decision "fresh rm -rf prompts" Exec_policy.Prompt
    (Exec_policy.decision_for_unmatched_command context [ "rm"; "-rf"; "target" ])

let () =
  test_prefix_alternatives ();
  test_strictest_wins ();
  test_no_match_defaults ();
  test_validation_not_match ();
  test_ast_walk ();
  test_ast_sequence_strictest ();
  test_ast_unsupported_prompts ();
  test_unsupported_defers_to_sandbox ();
  test_approval_rank_ordering ();
  test_exec_policy_prompt_under_never_allows_but_boundaries_deny ();
  test_fresh_full_access_dangerous_prompts ();
  test_empty_policy_fallback ()
