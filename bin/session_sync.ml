open Jsoo_bridge
open App_state

let report_session_sync_error scope error =
  let console = Unsafe.get Unsafe.global "console" in
  if Option.is_some (function_field console "warn") then
    ignore
      (Unsafe.fun_call (Unsafe.get console "warn")
         [|
           js_string
             ("Taumel session sync failed (" ^ scope ^ "): "
            ^ Printexc.to_string error);
         |])

let message_cost entry =
  let message =
    match object_field entry "message" with
    | Some value -> value
    | None -> entry
  in
  if get_string message "role" <> "assistant" then None
  else
    match first_object_field message [ "usage" ] with
    | None -> None
    | Some usage -> (
        match first_object_field usage [ "cost" ] with
        | None -> None
        | Some cost ->
            if not (has_property cost "total") then None
            else
              float_field cost "total")

let total_cost_from_ctx ctx =
  match Session_store.branch_entries_opt ctx with
  | None -> None
  | Some entries ->
      Some
        (List.fold_left
           (fun total entry ->
             match message_cost entry with
             | None -> total
             | Some cost -> total +. cost)
           0.0 entries)

let bool_of_flag_string value =
  match String.lowercase_ascii (String.trim value) with
  | "1" | "true" | "yes" | "on" | "enabled" -> Some true
  | "0" | "false" | "no" | "off" | "disabled" -> Some false
  | _ -> None

let update_session_state host ctx =
  let previous_cwd = state.cwd in
  let snapshot = call1 host "sessionSnapshot" (inject ctx) in
  state.cwd <- get_string snapshot "cwd";
  state.provider <- get_string snapshot "provider";
  state.model <- get_string snapshot "model";
  state.thinking <- get_string snapshot "thinking";
  state.total_cost <-
    (match total_cost_from_ctx ctx with
    | Some cost -> cost
    | None -> float_field_default snapshot "totalCost" 0.0);
  state.context_percent <- float_field_default snapshot "contextPercent" 0.0;
  state.context_window <- float_field_default snapshot "contextWindow" 0.0;
  host_sandbox_preset :=
    Taumel.Capability_profile.sandbox_of_string (get_string snapshot "sandboxMode");
  host_network_mode :=
    Taumel.Permissions.network_of_string (get_string snapshot "networkMode");
  host_no_sandbox :=
    if has_property snapshot "noSandbox" then Some (get_bool snapshot "noSandbox")
    else bool_of_flag_string (get_string snapshot "noSandboxFlag");
  if previous_cwd <> "" && previous_cwd <> state.cwd then
    state.git_delta <- Model.empty_git_delta

let refresh_session_state_from_host ?(scope = "session state refresh") ctx =
  try update_session_state (active_host_or_empty ()) ctx
  with error -> report_session_sync_error scope error

let load_goal_state ctx =
  match Session_store.custom_entry_data ctx "taumel.goal" with
  | None -> current_goal := None
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Goal.codec.decode with
      | Ok goal -> current_goal := goal
      | Error message ->
          report_session_sync_error "goal load"
            (Failure ("Ignoring incompatible saved Taumel goal entry: " ^ message));
          current_goal := None)

let load_goal_automation_state ctx =
  match Session_store.custom_entry_data ctx "taumel.goal_automation" with
  | None -> goal_automation := Taumel.Goal.Automation_enabled
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Goal.automation_codec.decode with
      | Ok automation -> goal_automation := automation
      | Error message ->
          report_session_sync_error "goal automation load"
            (Failure ("Ignoring incompatible saved Taumel goal automation entry: " ^ message));
          goal_automation := Taumel.Goal.Automation_enabled)

let apply_active_permissions (resolved : Taumel.Permissions.active) =
  active_profile_state := resolved.profile;
  active_network_mode := resolved.network_mode;
  active_no_sandbox := resolved.no_sandbox;
  active_subagent := resolved.subagent;
  state.filesystem_mode <- resolved.filesystem_mode

let session_is_subagent ctx =
  match Session_store.custom_entry_data ctx "taumel.childSession" with
  | None -> false
  | Some data ->
      get_bool data "subagent"
      ||
      match get_string data "kind" with
      | "agent" | "ralph" -> true
      | _ -> false

let load_permissions_state ctx =
  let session_subagent = session_is_subagent ctx in
  let persisted =
    match Session_store.custom_entry_data ctx "taumel.permissions" with
    | None -> Taumel.Permissions.Missing
    | Some data -> (
        match Result.bind (json_from_js data) Taumel.Permissions.codec.decode with
        | Ok permissions -> Taumel.Permissions.Persisted permissions
        | Error _ -> Taumel.Permissions.Invalid)
  in
  Taumel.Permissions.resolve_active
    ~host_sandbox_preset:!host_sandbox_preset
    ~host_network_mode:!host_network_mode ~host_no_sandbox:!host_no_sandbox
    ~session_subagent persisted
  |> apply_active_permissions

let load_ralph_state ctx =
  match Session_store.custom_entry_data ctx "taumel.ralph" with
  | None -> ralph_tasks := []
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Ralph_loop.codec.decode with
      | Ok tasks -> ralph_tasks := tasks
      | Error _ -> ralph_tasks := [])

let load_agent_state ctx =
  match Session_store.custom_entry_data ctx "taumel.agents" with
  | None -> agent_state := Taumel.Subagents.empty_session_state
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Subagents.session_state_codec.decode with
      | Ok state -> agent_state := Taumel.Subagents.mark_active_runs_lost state
      | Error message ->
          report_session_sync_error "agent state load"
            (Failure ("Ignoring incompatible saved Taumel agents entry: " ^ message));
          agent_state := Taumel.Subagents.empty_session_state)

let load_session_state ctx =
  load_goal_state ctx;
  load_goal_automation_state ctx;
  load_permissions_state ctx;
  load_ralph_state ctx;
  load_agent_state ctx;
  last_goal_accounting_key := None;
  goal_turn_clock := Taumel.Goal.empty_clock;
  goal_retrying := false;
  goal_compacting := false

let has_persisted_component_entry ctx =
  Session_store.custom_entry_data ctx "taumel.goal" <> None
  || Session_store.custom_entry_data ctx "taumel.goal_automation" <> None
  || Session_store.custom_entry_data ctx "taumel.permissions" <> None
  || Session_store.custom_entry_data ctx "taumel.ralph" <> None
  || Session_store.custom_entry_data ctx "taumel.agents" <> None

let sync_persisted_session ?(reset_missing = true) ctx =
  let session_id = Session_store.session_id_from_ctx ctx in
  if
    !loaded_session_id <> Some session_id
    && (reset_missing || has_persisted_component_entry ctx)
  then (
    load_session_state ctx;
    loaded_session_id := Some session_id)

let sync_session_from_host ?(scope = "session sync") ?(reset_missing = true) ctx =
  try
    update_session_state (active_host_or_empty ()) ctx;
    sync_persisted_session ~reset_missing ctx
  with error -> report_session_sync_error scope error

let save_goal_state ctx =
  Session_store.append_custom_entry ctx "taumel.goal"
    (Taumel.Goal.codec.encode !current_goal)

let save_goal_automation_state ctx =
  Session_store.append_custom_entry ctx "taumel.goal_automation"
    (Taumel.Goal.automation_codec.encode !goal_automation)

let set_goal_automation ctx automation =
  if !goal_automation <> automation then (
    goal_automation := automation;
    save_goal_automation_state ctx)

let clear_goal_automation ctx =
  set_goal_automation ctx Taumel.Goal.Automation_enabled

let save_permissions_state ctx =
  let workspace_roots = if state.cwd = "" then [] else [ state.cwd ] in
  match
    Taumel.Permissions.create ~workspace_roots
      ~network_mode:!active_network_mode ~no_sandbox:!active_no_sandbox
      ~subagent:!active_subagent (active_profile ())
  with
  | Ok permissions ->
      Session_store.append_custom_entry ctx "taumel.permissions"
        (Taumel.Permissions.codec.encode permissions)
  | Error _ -> ()

let save_ralph_state ctx =
  Session_store.append_custom_entry ctx "taumel.ralph"
    (Taumel.Ralph_loop.codec.encode !ralph_tasks)

let save_agent_state ctx =
  Session_store.append_custom_entry ctx "taumel.agents"
    (Taumel.Subagents.session_state_codec.encode !agent_state)

let account_goal_turn_end ctx =
  let active_time_seconds, next_clock =
    Taumel.Goal.finish_turn_clock ~now_ms:(now_milliseconds ()) !goal_turn_clock
  in
  goal_turn_clock := next_clock;
  let result =
    Taumel.Goal.account_turn_end
      ~session_id:(Session_store.session_id_from_ctx ctx) ~now:(now_seconds ())
      ~active_time_seconds ~last_accounting_key:!last_goal_accounting_key
      ~branch:(Session_store.branch_json_entries ctx) !current_goal
  in
  if result.changed then (
    current_goal := result.goal;
    last_goal_accounting_key := result.accounting_key;
    save_goal_state ctx)

let start_goal_turn () =
  goal_turn_clock :=
    Taumel.Goal.start_turn_clock ~now_ms:(now_milliseconds ()) !goal_turn_clock

let goal_clock_pause_start () =
  goal_turn_clock :=
    Taumel.Goal.pause_clock_start ~now_ms:(now_milliseconds ()) !goal_turn_clock

let goal_clock_pause_end () =
  goal_turn_clock :=
    Taumel.Goal.pause_clock_end ~now_ms:(now_milliseconds ()) !goal_turn_clock

let interrupt_goal_automation ctx =
  set_goal_automation ctx Taumel.Goal.Automation_interrupted

let clear_interrupted_goal_automation ctx =
  clear_goal_automation ctx
