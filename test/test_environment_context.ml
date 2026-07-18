module Env = Taumel.Environment_context
module Sandbox = Taumel.Sandbox

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let contains value needle =
  let value_len = String.length value in
  let needle_len = String.length needle in
  let rec loop index =
    needle_len = 0
    || (index + needle_len <= value_len
       && (String.sub value index needle_len = needle || loop (index + 1)))
  in
  loop 0

let sandbox ?(workspace_roots = [ "/repo" ]) ?(network_mode = Sandbox.Network_disabled)
    ?(approval_policy = Sandbox.On_request) filesystem_mode =
  Sandbox.validated_config ~filesystem_mode ~workspace_roots ~network_mode
    ~approval_policy ~no_sandbox:false ~isolated_child:false |> Result.get_ok

let workspace_sandbox = sandbox Sandbox.Workspace_write

let full_access_sandbox =
  sandbox ~workspace_roots:[] ~network_mode:Sandbox.Network_enabled
    ~approval_policy:Sandbox.Never Sandbox.Danger_full_access

let test_full_context_serialization () =
  let snapshot = Env.snapshot ~cwd:"/repo" ~shell:"/bin/bash" full_access_sandbox in
  let xml = Env.serialize (Env.full snapshot) in
  assert_bool "context opens" (String.starts_with ~prefix:"<environment_context>" xml);
  assert_bool "context closes" (String.ends_with ~suffix:"</environment_context>" xml);
  assert_bool "cwd included" (contains xml "<cwd>/repo</cwd>");
  assert_bool "approval included"
    (contains xml "<approval_policy>never</approval_policy>");
  assert_bool "sandbox included"
    (contains xml "<sandbox_mode>danger-full-access</sandbox_mode>");
  assert_bool "network enabled included"
    (contains xml "<network_access>enabled</network_access>");
  assert_bool "shell included" (contains xml "<shell>/bin/bash</shell>")

let test_diff_context_serialization () =
  let before = Env.snapshot ~cwd:"/repo" ~shell:"/bin/bash" full_access_sandbox in
  let after = Env.snapshot ~cwd:"/repo" ~shell:"/bin/bash" workspace_sandbox in
  match Env.diff before after with
  | None -> fail "diff context" "expected changed sandbox context"
  | Some context ->
      let xml = Env.serialize context in
      assert_bool "diff omits unchanged cwd" (not (contains xml "<cwd>"));
      assert_bool "diff includes approval"
        (contains xml "<approval_policy>on-request</approval_policy>");
      assert_bool "diff includes workspace"
        (contains xml "<sandbox_mode>workspace-write</sandbox_mode>");
      assert_bool "diff includes restricted network"
        (contains xml "<network_access>restricted</network_access>");
      assert_bool "diff includes writable root" (contains xml "<root>/repo</root>");
      assert_bool "diff omits shell" (not (contains xml "<shell>"))

let test_unchanged_context_has_no_diff () =
  let snapshot = Env.snapshot ~cwd:"/repo" ~shell:"/bin/bash" workspace_sandbox in
  match Env.diff snapshot snapshot with
  | None -> ()
  | Some _ -> fail "unchanged context" "expected no diff"

let () =
  test_full_context_serialization ();
  test_diff_context_serialization ();
  test_unchanged_context_has_no_diff ()
