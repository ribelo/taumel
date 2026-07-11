module Capability = Taumel.Capability_profile
module Gateway = Taumel.Tool_gateway
module Runtime = Taumel.Runtime_policy
module Sandbox = Taumel.Sandbox

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let test_active_policy () =
  let profile =
    Runtime.active_profile ~filesystem_mode:"read-only" Capability.default
  in
  assert_bool "profile sandbox override"
    (profile.sandbox_preset = Capability.Read_only);
  let fallback_profile =
    Runtime.active_profile ~filesystem_mode:"nonsense" Capability.default
  in
  assert_bool "invalid filesystem defaults workspace"
    (fallback_profile.sandbox_preset = Capability.Workspace_write);
  let sandbox =
    Runtime.active_sandbox ~cwd:"/repo" ~network_mode:Sandbox.Network_enabled
      ~no_sandbox:true ~isolated_child:false Capability.default
  in
  assert_bool "sandbox fallback disables no-sandbox" (not sandbox.no_sandbox);
  assert_bool "sandbox fallback keeps workspace root"
    (sandbox.workspace_roots = [ "/repo" ]);
  assert_bool "sandbox fallback resets network"
    (sandbox.network_mode = Sandbox.Network_disabled)

let test_gateway_authorization () =
  let profile = Capability.default in
  let sandbox =
    {
      Sandbox.filesystem_mode = Sandbox.Read_only;
      workspace_roots = [ "/repo" ];
      network_mode = Sandbox.Network_disabled;
      approval_policy = Sandbox.Never;
      no_sandbox = false;
      isolated_child = false;
    }
  in
  (match Runtime.gateway_authorized ~profile ~sandbox "write" with
  | Error
      (Gateway.Denied_effect
        (Gateway.Mutate, "mutation is disabled in read-only sandbox")) ->
      ()
  | Error error ->
      fail "gateway effect"
        ("unexpected error: " ^ Runtime.gateway_error_message error)
  | Ok _ -> fail "gateway effect" "expected sandbox denial");
  (match Runtime.gateway_profile_authorized ~profile ~sandbox "write" with
  | Ok returned -> assert_bool "profile auth returns sandbox" (returned = sandbox)
  | Error error ->
      fail "profile auth"
        ("unexpected error: " ^ Runtime.gateway_error_message error));
  (match Runtime.authorize_ralph_start ~profile ~sandbox with
  | Ok () -> ()
  | Error message -> fail "ralph auth" message)

let () =
  test_active_policy ();
  test_gateway_authorization ()
