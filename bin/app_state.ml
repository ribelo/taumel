open Jsoo_bridge

module Model = Taumel.Footer_model

type state = {
  mutable cwd : string;
  mutable filesystem_mode : string;
  mutable git_delta : Model.git_delta;
  mutable provider : string;
  mutable model : string;
  mutable thinking : string;
  mutable total_cost : float;
  mutable context_percent : float;
  mutable context_window : float;
}

let state =
  {
    cwd = "";
    filesystem_mode = "workspace-write";
    git_delta = Model.empty_git_delta;
    provider = "";
    model = "no-model";
    thinking = "off";
    total_cost = 0.0;
    context_percent = 0.0;
    context_window = 0.0;
  }

let runtime : unit Runtime.t option ref = ref None
let active_host : Unsafe.any option ref = ref None
let current_goal : Taumel.Goal.t option ref = ref None
let goal_automation = ref Taumel.Goal.Automation_enabled
let goal_turn_clock = ref Taumel.Goal.empty_clock
let pending_goal_terminal_status : Taumel.Goal.status option ref = ref None
let goal_retrying = ref false
let goal_compacting = ref false
let active_profile_state = ref Taumel.Capability_profile.default
let active_network_mode = ref Taumel.Sandbox.Network_disabled
let active_no_sandbox = ref false
let active_subagent = ref false
let host_sandbox_preset : Taumel.Capability_profile.sandbox_preset option ref = ref None
let host_network_mode : Taumel.Sandbox.network_mode option ref = ref None
let host_no_sandbox : bool option ref = ref None
let ralph_tasks : Taumel.Ralph_loop.task list ref = ref []
let workers : Taumel.Subagents.worker list ref = ref []
let exec_policy : Taumel.Exec_policy.compiled ref = ref Taumel.Exec_policy.empty
let agent_state : Taumel.Agent_runs.session_state ref =
  ref Taumel.Agent_runs.empty_session_state
let visibility_state : Taumel.Visibility.t ref = ref Taumel.Visibility.empty
let visibility_warning_flags : Taumel.Visibility.warning_flags ref =
  ref Taumel.Visibility.empty_warning_flags
let agent_catalog : Taumel.Agent_profiles.profile_catalog ref =
  ref Taumel.Agent_profiles.default_profile_catalog
let loaded_session_id : string option ref = ref None
let last_goal_accounting_key : string option ref = ref None
let footer_event = "taumel:footer:changed"

let active_host_or_empty () =
  match !active_host with
  | Some host -> host
  | None -> Unsafe.obj [||]

let emit_changed host =
  ignore (call2 host "emit" (js_string footer_event) (Unsafe.inject Js.null))

let now_seconds () =
  let date = Unsafe.get Unsafe.global "Date" in
  match function_field date "now" with
  | Some now -> (
    match float_value (Unsafe.fun_call now [||]) with
    | Some milliseconds -> int_of_float (milliseconds /. 1000.0)
    | None -> 0)
  | _ -> 0

let now_milliseconds () =
  let date = Unsafe.get Unsafe.global "Date" in
  match function_field date "now" with
  | Some now -> (
    match float_value (Unsafe.fun_call now [||]) with
    | Some milliseconds -> int_of_float milliseconds
    | None -> 0)
  | _ -> 0

let env_string name =
  let process = Unsafe.get Unsafe.global "process" in
  let env =
    match object_field process "env" with Some env -> env | None -> Unsafe.obj [||]
  in
  match Option.bind (object_field env name) string_value with
  | Some value -> value
  | None -> ""

let active_profile () =
  Taumel.Runtime_policy.active_profile ~filesystem_mode:state.filesystem_mode
    !active_profile_state

let active_sandbox () =
  Taumel.Runtime_policy.active_sandbox ~cwd:state.cwd
    ~network_mode:!active_network_mode ~no_sandbox:!active_no_sandbox
    ~subagent:!active_subagent (active_profile ())

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
