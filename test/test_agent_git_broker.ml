open Taumel

let assert_equal label expected actual =
  if expected <> actual then
    failwith (label ^ ": expected " ^ expected ^ ", got " ^ actual)

let assert_true label value =
  if not value then failwith (label ^ ": expected true")

let assert_error_kind label expected tokens =
  match Agent_git_broker.parse_tokens tokens with
  | Ok _ -> failwith (label ^ ": expected error")
  | Error error ->
      let actual =
        match error with
        | Agent_git_broker.Not_simple_git -> "not_simple"
        | Agent_git_broker.Unsupported_subcommand _ -> "unsupported"
        | Agent_git_broker.Invalid_arguments _ -> "invalid"
        | Agent_git_broker.Permission_denied _ -> "permission"
        | Agent_git_broker.Limits_exceeded _ -> "limits"
      in
      assert_equal label expected actual

let parse_ok tokens =
  match Agent_git_broker.parse_tokens tokens with
  | Ok parsed -> parsed
  | Error error ->
      failwith ("parse failed: " ^ Agent_git_broker.error_message error)

let test_accepts_status_and_injects_log_count () =
  let status =
    parse_ok [ "git"; "status"; "--short"; "--branch"; "--"; "src" ]
  in
  assert_equal "status sub"
    (Agent_git_broker.subcommand_to_string status.subcommand)
    "status";
  assert_true "status not mutating" (not status.mutating);
  assert_equal "status argv"
    (String.concat " " status.argv)
    "status --short --branch -- src";
  let log = parse_ok [ "git"; "log"; "--oneline" ] in
  assert_true "log injects max-count"
    (List.mem "--max-count=100" log.argv)

let test_accepts_add_restore_commit () =
  let add = parse_ok [ "git"; "add"; "--"; "a.txt"; "b.txt" ] in
  assert_true "add mutating" add.mutating;
  let restore =
    parse_ok [ "git"; "restore"; "--staged"; "--"; "a.txt" ]
  in
  assert_equal "restore"
    (Agent_git_broker.subcommand_to_string restore.subcommand)
    "restore";
  let commit = parse_ok [ "git"; "commit"; "-m"; "ship it" ] in
  assert_equal "commit message"
    (Option.value commit.commit_message ~default:"")
    "ship it"

let test_rejects_unsupported_and_non_simple () =
  assert_error_kind "branch" "unsupported" [ "git"; "branch" ];
  assert_error_kind "rev-parse" "unsupported" [ "git"; "rev-parse"; "HEAD" ];
  assert_error_kind "global option" "not_simple"
    [ "git"; "-C"; "/tmp"; "status" ];
  assert_error_kind "not git" "not_simple" [ "echo"; "hi" ];
  assert_error_kind "add force" "invalid" [ "git"; "add"; "-f"; "--"; "a" ];
  assert_error_kind "commit amend" "invalid"
    [ "git"; "commit"; "--amend"; "-m"; "x" ];
  assert_error_kind "status nul" "invalid" [ "git"; "status"; "-z" ];
  assert_error_kind "status -b alias" "invalid" [ "git"; "status"; "-b" ];
  assert_error_kind "status --porcelain alias" "invalid"
    [ "git"; "status"; "--porcelain" ];
  assert_error_kind "status -uno alias" "invalid" [ "git"; "status"; "-uno" ];
  assert_error_kind "log --max-count space form" "invalid"
    [ "git"; "log"; "--max-count"; "5" ];
  assert_error_kind "multiline commit" "invalid"
    [ "git"; "commit"; "-m"; "line1\nline2" ]

let test_read_only_authorization () =
  let commit = parse_ok [ "git"; "commit"; "-m"; "x" ] in
  (match Agent_git_broker.authorize ~read_only:true commit with
  | Ok _ -> failwith "read-only should reject commit"
  | Error (Agent_git_broker.Permission_denied _) -> ()
  | Error _ -> failwith "expected permission denied");
  let status = parse_ok [ "git"; "status" ] in
  (match Agent_git_broker.authorize ~read_only:true status with
  | Ok _ -> ()
  | Error error ->
      failwith ("status should be allowed: " ^ Agent_git_broker.error_message error))

let () =
  test_accepts_status_and_injects_log_count ();
  test_accepts_add_restore_commit ();
  test_rejects_unsupported_and_non_simple ();
  test_read_only_authorization ();
  print_endline "test_agent_git_broker: ok"
