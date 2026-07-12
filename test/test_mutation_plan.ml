module Mutation = Taumel.Mutation_plan
module Sandbox = Taumel.Sandbox
module Shared = Taumel.Shared

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_false label condition =
  if condition then fail label "expected condition to be false"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let assert_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let expect_ok label = function
  | Ok value -> value
  | Error message -> fail label message

let expect_error label expected = function
  | Error message when message = expected -> ()
  | Error message -> fail label ("expected " ^ expected ^ ", got " ^ message)
  | Ok _ -> fail label "expected error"

let sandbox =
  {
    Sandbox.filesystem_mode = Sandbox.Workspace_write;
    workspace_roots = [ "/repo" ];
    network_mode = Sandbox.Network_disabled;
    approval_policy = Sandbox.On_request;
    no_sandbox = false;
    isolated_child = false;
  }

let test_exec_plan () =
  (match
     Mutation.plan_exec sandbox
       {
         cmd = " ";
         workdir = "";
         default_workdir = "/repo";
         sandbox_permissions = Sandbox.Use_default;
         yield_time_ms = None;
         max_output_tokens = None;
         tty = false;
       }
   with
  | Error "exec_command requires cmd" -> ()
  | Error message -> fail "exec empty" ("unexpected error: " ^ message)
  | Ok _ -> fail "exec empty" "expected error");
  let plan =
    match
      Mutation.plan_exec sandbox
        {
          cmd = "echo hi";
          workdir = "";
          default_workdir = "/repo";
          sandbox_permissions =
            Sandbox.Require_escalated
              { justification = "need host"; prefix_rule = None };
          yield_time_ms = Some 250.;
          max_output_tokens = Some 10000;
          tty = true;
        }
    with
    | Ok plan -> plan
    | Error message -> fail "exec approval" message
  in
  assert_equal "exec action" "exec_command_approval" plan.action;
  assert_equal "exec workdir default" "/repo" plan.workdir;
  assert_bool "exec tty" plan.tty;
  (match plan.approval with
  | Some approval ->
      assert_equal "exec approval message" "need host" approval.message;
      assert_equal "exec approval title" "Command requires approval"
        approval.title
  | None -> fail "exec approval" "expected approval");
  let expect_escalation_rejected label policy expected =
    expect_error label expected
      (Mutation.plan_exec { sandbox with approval_policy = policy }
         {
           cmd = "echo hi";
           workdir = "";
           default_workdir = "/repo";
           sandbox_permissions =
             Sandbox.Require_escalated
               { justification = "need host"; prefix_rule = None };
           yield_time_ms = None;
           max_output_tokens = None;
           tty = false;
         })
  in
  expect_escalation_rejected "exec escalation never"
    Sandbox.Never
    "approval policy is Never; reject command — you cannot ask for escalated permissions if the approval policy is Never";
  expect_escalation_rejected "exec escalation on-failure"
    Sandbox.On_failure
    "approval policy is OnFailure; reject command — you cannot ask for escalated permissions if the approval policy is OnFailure";
  expect_escalation_rejected "exec escalation untrusted"
    Sandbox.Untrusted
    "approval policy is UnlessTrusted; reject command — you cannot ask for escalated permissions if the approval policy is UnlessTrusted"

let test_write_edit_plan () =
  let write =
    match
      Mutation.plan_write sandbox
        { path = "/outside/file.txt"; contents = "x"; mode = "overwrite" }
    with
    | Ok plan -> plan
    | Error message -> fail "write approval" message
  in
  assert_equal "write approval action" "write_approval" write.action;
  assert_equal "write display path" "/outside/file.txt" write.display_path;
  assert_bool "write validates workspace paths" write.validate_workspace_paths;
  (match write.approval with
  | Some approval ->
      assert_equal "write approval action field" "write" approval.action
  | None -> fail "write approval" "expected approval")

let test_write_stdin_plan () =
  let status =
    expect_ok "write_stdin status"
      (Mutation.plan_write_stdin
         {
           session_id = 7;
           chars = "";
           yield_time_ms = Some 30_000.;
           max_output_tokens = Some 10000;
           output_mode = "status";
         })
  in
  assert_equal "write_stdin output mode" "status" status.output_mode;
  expect_error "write_stdin status input"
    "write_stdin output_mode=status requires empty chars"
    (Mutation.plan_write_stdin
       {
         session_id = 7;
         chars = "x";
         yield_time_ms = None;
         max_output_tokens = None;
         output_mode = "status";
       })

let test_workspace_validation_policy () =
  assert_bool "workspace-write validates resolved mutation paths"
    (Sandbox.requires_resolved_workspace_mutation_validation sandbox);
  assert_false "no sandbox skips resolved mutation validation"
    (Sandbox.requires_resolved_workspace_mutation_validation
       { sandbox with no_sandbox = true });
  assert_false "danger full access skips resolved mutation validation"
    (Sandbox.requires_resolved_workspace_mutation_validation
       { sandbox with filesystem_mode = Sandbox.Danger_full_access });
  assert_false "read only skips resolved mutation validation"
    (Sandbox.requires_resolved_workspace_mutation_validation
       { sandbox with filesystem_mode = Sandbox.Read_only })

let test_apply_patch_plan () =
  let patch =
    "*** Begin Patch\n*** Add File: inside.txt\n+hello\n*** End Patch\n"
  in
  let request =
    expect_ok "apply patch decode"
      (Mutation.patch_request_of_values ~input:patch ())
  in
  let plan =
    match Mutation.plan_apply_patch sandbox request with
    | Ok plan -> plan
    | Error message -> fail "apply patch plan" message
  in
  assert_equal "patch action" "apply_patch" plan.action;
  assert_int "patch affected paths" 1 (List.length plan.affected_paths);
  assert_equal "patch affected path" "/repo/inside.txt"
    (List.hd plan.affected_paths);
  let output =
    match
      Mutation.apply_patch_to_files ~approved:false sandbox request
        Shared.String_map.empty
    with
    | Ok output -> output
    | Error message -> fail "apply patch files" message
  in
  assert_int "patch writes" 1 (List.length output.writes);
  assert_int "patch deletes" 0 (List.length output.deletes);
  let path, contents = List.hd output.writes in
  assert_equal "patch write path" "/repo/inside.txt" path;
  assert_equal "patch write contents" "hello\n" contents;
  expect_error "apply patch missing input"
    "apply_patch.input or apply_patch.patch is required"
    (Mutation.patch_request_of_values ())

let () =
  test_exec_plan ();
  test_write_edit_plan ();
  test_write_stdin_plan ();
  test_workspace_validation_policy ();
  test_apply_patch_plan ()
