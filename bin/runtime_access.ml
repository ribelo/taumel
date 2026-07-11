open Jsoo_bridge
open App_state

let active_profile () =
  Taumel.Runtime_policy.active_profile ~filesystem_mode:state.filesystem_mode
    !active_profile_state

let active_sandbox () =
  Taumel.Runtime_policy.active_sandbox ~cwd:state.cwd
    ~network_mode:!active_network_mode ~no_sandbox:!active_no_sandbox
    ~isolated_child:!active_isolated_child (active_profile ())

let gateway_authorized name =
  let sandbox = active_sandbox () in
  Taumel.Runtime_policy.gateway_authorized ~profile:(active_profile ()) ~sandbox
    name

let gateway_profile_authorized name =
  let sandbox = active_sandbox () in
  Taumel.Runtime_policy.gateway_profile_authorized ~profile:(active_profile ())
    ~sandbox name

let gateway_error_message = Taumel.Runtime_policy.gateway_error_message

let gateway_error_obj error = error_obj (gateway_error_message error)

let with_gateway_authorized name run =
  match gateway_authorized name with
  | Error error -> gateway_error_obj error
  | Ok sandbox -> run sandbox

let with_gateway_profile_authorized name run =
  match gateway_profile_authorized name with
  | Error error -> gateway_error_obj error
  | Ok sandbox -> run sandbox

let authorize_ralph_start () =
  Taumel.Runtime_policy.authorize_ralph_start ~profile:(active_profile ())
    ~sandbox:(active_sandbox ())
