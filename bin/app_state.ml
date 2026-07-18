open Jsoo_bridge

module Model = Taumel.Footer_model

type state = {
  mutable cwd : string;
  (* Footer-owned view of the main session cwd. Isolated child sessions keep
     [cwd] current for enforcement, but must never move the footer. *)
  mutable footer_cwd : string;
  mutable filesystem_mode : string;
  mutable git_delta : Model.git_delta;
  mutable git_repo : bool;
  mutable git_error : bool;
  mutable provider : string;
  mutable model : string;
  mutable thinking : string;
  mutable total_cost : float;
  mutable context_percent : float;
  mutable context_window : float;
}

type footer_permissions = {
  footer_filesystem_mode : string;
  footer_network_mode : Taumel.Sandbox.network_mode;
  footer_approval_policy : Taumel.Capability_profile.approval_policy;
  footer_no_sandbox : bool;
}

let state =
  {
    cwd = "";
    footer_cwd = "";
    filesystem_mode = "workspace-write";
    git_delta = Model.empty_git_delta;
    git_repo = false;
    git_error = false;
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
let active_isolated_child = ref false
let loaded_footer_permissions =
  ref
    {
      footer_filesystem_mode = state.filesystem_mode;
      footer_network_mode = !active_network_mode;
      footer_approval_policy = !active_profile_state.approval_policy;
      footer_no_sandbox = !active_no_sandbox;
    }
(* Parent-only footer goal line. The shared goal state is swapped out while
   isolated children load their own projection, so the footer renders this
   retained presentation, captured only from main-session contexts. *)
let loaded_footer_goal = ref None
let capture_loaded_footer_goal () =
  loaded_footer_goal :=
    Option.map (Taumel.Goal.present !goal_automation) !current_goal
let host_sandbox_preset : Taumel.Capability_profile.sandbox_preset option ref = ref None
let host_network_mode : Taumel.Sandbox.network_mode option ref = ref None
let host_no_sandbox : bool option ref = ref None
let ralph_tasks : Taumel.Ralph_loop.task list ref = ref []
let exec_policy : Taumel.Exec_policy.compiled ref = ref Taumel.Exec_policy.empty
let visibility_state : Taumel.Visibility.t ref = ref Taumel.Visibility.empty
let visibility_warning_flags : Taumel.Visibility.warning_flags ref =
  ref Taumel.Visibility.empty_warning_flags
let agent_state : Taumel.Agents.session_state ref =
  ref Taumel.Agents.empty_session_state

let authority_agent_ids (state : Taumel.Agents.session_state) =
  let from_identities =
    List.map (fun (identity : Taumel.Agents.identity) -> identity.identity_agent_id) state.identities
  in
  let from_runs =
    List.map (fun (run : Taumel.Agents.agent_run) -> run.run_agent_id) state.runs
  in
  let from_cleanup =
    List.map
      (fun (pending : Taumel.Agents.cleanup_pending) -> pending.cleanup_agent_id)
      state.cleanup_pending
  in
  List.sort_uniq String.compare (from_identities @ from_runs @ from_cleanup)

let authority_projection (state : Taumel.Agents.session_state) agent_id =
  let identity = Taumel.Agents.find_identity state agent_id in
  let runs =
    Taumel.Agents.runs_for_agent state agent_id
    |> List.map (fun (run : Taumel.Agents.agent_run) ->
           ( run.run_id,
             run.run_status,
             run.run_reason_code,
             run.run_submission_id,
             run.run_result_entry_id,
             run.run_previous_assistant_entry_id ))
    |> List.sort compare
  in
  let cleanup =
    state.cleanup_pending
    |> List.filter (fun (pending : Taumel.Agents.cleanup_pending) ->
           pending.cleanup_agent_id = agent_id)
  in
  (identity, runs, cleanup)

let authority_owner state agent_id =
  match Taumel.Agents.find_identity state agent_id with
  | Some identity -> Some identity.identity_owner_session_id
  | None ->
      List.find_opt
        (fun (pending : Taumel.Agents.cleanup_pending) ->
          pending.cleanup_agent_id = agent_id)
        state.cleanup_pending
      |> Option.map (fun (pending : Taumel.Agents.cleanup_pending) ->
             pending.cleanup_owner_session_id)

let set_agent_state next =
  let previous = !agent_state in
  let agent_ids =
    List.sort_uniq String.compare
      (authority_agent_ids previous @ authority_agent_ids next)
  in
  List.iter
    (fun agent_id ->
      if authority_projection previous agent_id <> authority_projection next agent_id
      then
        match authority_owner next agent_id with
        | Some owner_id ->
            ignore (Agent_state_epochs.advance ~owner_id ~agent_id)
        | None -> (
            match authority_owner previous agent_id with
            | Some owner_id ->
                ignore (Agent_state_epochs.advance ~owner_id ~agent_id)
            | None -> ()))
    agent_ids;
  agent_state := next
(* Activity events whose persistence is still pending. Activity bookkeeping
   is applied to the in-memory registry immediately but persisted coalesced;
   when a parent/child projection swap reloads the owner's persisted
   registry, these events are replayed on top so no observed activity is
   lost. Entries are prepended and cleared when the owner's registry is
   persisted (a persisted snapshot includes every journaled effect). *)
type agent_activity_journal_entry = {
  journal_owner : string;
  journal_run_id : string;
  journal_submission_id : string;
  journal_event : Taumel.Agents.activity_event;
  journal_now : int;
}
let agent_activity_journal : agent_activity_journal_entry list ref = ref []
let agent_notification_claims : string list ref = ref []
let agent_state_load_error : string option ref = ref None
let agent_closing_ids : string list ref = ref []
let loaded_session_id : string option ref = ref None
let owner_session_epoch = ref 0
let permission_state_epoch = ref 0
let last_goal_accounting_key : string option ref = ref None
let pending_goal_load_warning : string option ref = ref None
let footer_event = "taumel:footer:changed"

let active_host_or_empty () =
  match !active_host with
  | Some host -> host
  | None -> Unsafe.obj [||]

let emit_changed host =
  ignore (call2 host "emit" (js_string footer_event) (Unsafe.inject Js.null))

let capture_loaded_footer_permissions () =
  loaded_footer_permissions :=
    {
      footer_filesystem_mode = state.filesystem_mode;
      footer_network_mode = !active_network_mode;
      footer_approval_policy = !active_profile_state.approval_policy;
      footer_no_sandbox = !active_no_sandbox;
    }

let now_seconds () =
  let date = Unsafe.get Unsafe.global "Date" in
  match function_field date "now" with
  | Some now -> (
    match float_value (Unsafe.fun_call now [||]) with
    | Some milliseconds -> int_of_float (milliseconds /. 1000.0)
    | None -> 0)
  | _ -> 0

let now_milliseconds_float () =
  let date = Unsafe.get Unsafe.global "Date" in
  match function_field date "now" with
  | Some now -> (
    match float_value (Unsafe.fun_call now [||]) with
    | Some milliseconds -> milliseconds
    | None -> 0.0)
  | _ -> 0.0

let now_milliseconds () = int_of_float (now_milliseconds_float ())

let env_string name =
  let process = Unsafe.get Unsafe.global "process" in
  let env =
    match object_field process "env" with Some env -> env | None -> Unsafe.obj [||]
  in
  match Option.bind (object_field env name) string_value with
  | Some value -> value
  | None -> ""
