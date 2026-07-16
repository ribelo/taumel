open Taumel

let assert_equal label expected actual =
  if expected <> actual then
    failwith (label ^ ": expected " ^ expected ^ ", got " ^ actual)

let assert_true label value =
  if not value then failwith (label ^ ": expected true")

let ast_command words =
  let children =
    List.mapi
      (fun index word ->
        if index = 0 then
          Exec_policy.
            {
              kind = "command_name";
              text = word;
              children = [ { kind = "word"; text = word; children = [] } ];
            }
        else Exec_policy.{ kind = "word"; text = word; children = [] })
      words
  in
  Exec_policy.
    {
      kind = "program";
      text = String.concat " " words;
      children =
        [ { kind = "command"; text = String.concat " " words; children } ];
    }

let ast_pipeline left right =
  Exec_policy.
    {
      kind = "program";
      text = "";
      children =
        [
          {
            kind = "pipeline";
            text = "";
            children =
              [
                {
                  kind = "command";
                  text = "";
                  children =
                    [
                      {
                        kind = "command_name";
                        text = left;
                        children = [ { kind = "word"; text = left; children = [] } ];
                      };
                    ];
                };
                {
                  kind = "command";
                  text = "";
                  children =
                    [
                      {
                        kind = "command_name";
                        text = right;
                        children =
                          [ { kind = "word"; text = right; children = [] } ];
                      };
                    ];
                };
              ];
          };
        ];
    }

let ast_environment_prefixed_git () =
  Exec_policy.
    {
      kind = "program";
      text = "TAUMEL_PROBE=1 git status";
      children =
        [
          {
            kind = "command";
            text = "TAUMEL_PROBE=1 git status";
            children =
              [
                { kind = "variable_assignment"; text = "TAUMEL_PROBE=1"; children = [] };
                {
                  kind = "command_name";
                  text = "git";
                  children = [ { kind = "word"; text = "git"; children = [] } ];
                };
                { kind = "word"; text = "status"; children = [] };
              ];
          };
        ];
    }

let test_ast_accepts_simple_git () =
  match Agent_git_broker.parse_simple_git_ast (ast_command [ "git"; "status" ]) with
  | Error error -> failwith (Agent_git_broker.error_message error)
  | Ok parsed ->
      assert_equal "status"
        (Agent_git_broker.subcommand_to_string parsed.subcommand)
        "status"

let test_ast_rejects_pipeline () =
  match
    Agent_git_broker.simple_git_tokens_from_ast
      (ast_pipeline "git" "grep")
  with
  | Ok _ -> failwith "pipeline must be rejected"
  | Error Agent_git_broker.Not_simple_git -> ()
  | Error error ->
      failwith ("expected not_simple, got " ^ Agent_git_broker.error_message error)

let test_ast_detects_environment_prefixed_git () =
  assert_true "environment-prefixed git detected"
    (Agent_git_broker.ast_invokes_git (ast_environment_prefixed_git ()))

let test_lease_is_exclusive_per_identity () =
  Agent_git_broker.Lease.release "agent-ab12";
  Agent_git_broker.Lease.release "agent-cd34";
  (match Agent_git_broker.Lease.try_acquire "agent-ab12" with
  | Ok () -> ()
  | Error message -> failwith message);
  (match Agent_git_broker.Lease.try_acquire "agent-ab12" with
  | Ok () -> failwith "overlapping lease"
  | Error _ -> ());
  (match Agent_git_broker.Lease.try_acquire "agent-cd34" with
  | Ok () -> ()
  | Error message -> failwith message);
  assert_true "held" (Agent_git_broker.Lease.is_held "agent-ab12");
  Agent_git_broker.Lease.release "agent-ab12";
  assert_true "released" (not (Agent_git_broker.Lease.is_held "agent-ab12"));
  Agent_git_broker.Lease.release "agent-cd34"

let () =
  test_ast_accepts_simple_git ();
  test_ast_rejects_pipeline ();
  test_ast_detects_environment_prefixed_git ();
  test_lease_is_exclusive_per_identity ();
  print_endline "test_agent_git_broker_hardening: ok"
