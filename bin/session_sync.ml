open Jsoo_bridge
open App_state
open Runtime_access

let string_contains_substring value needle =
  let value_length = String.length value in
  let needle_length = String.length needle in
  if needle_length = 0 then true
  else if needle_length > value_length then false
  else
    let rec loop index =
      if index + needle_length > value_length then false
      else if String.sub value index needle_length = needle then true
      else loop (index + 1)
    in
    loop 0

let is_stale_context_error error =
  let message = Printexc.to_string error in
  string_contains_substring message "ctx is stale"
  || string_contains_substring message
       "This extension ctx is stale after session replacement or reload"

let report_session_sync_error scope error =
  if not (is_stale_context_error error) then
    let console = Unsafe.get Unsafe.global "console" in
    if Option.is_some (function_field console "warn") then
      ignore
        (Unsafe.fun_call (Unsafe.get console "warn")
           [|
             js_string
               ("Taumel session sync failed (" ^ scope ^ "): "
              ^ Printexc.to_string error);
           |])

let notify_pending_goal_warning ctx =
  match !pending_goal_load_warning with
  | None -> ()
  | Some message ->
      let ui = Unsafe.get ctx "ui" in
      if Option.is_some (function_field ui "notify") then (
        ignore (call2 ui "notify" (js_string message) (js_string "warning"));
        pending_goal_load_warning := None)

let message_cost entry =
  let message =
    match object_field entry "message" with
    | Some value -> value
    | None -> entry
  in
  if get_string message "role" <> "assistant" then None
  else
    match object_field message "usage" with
    | None -> None
    | Some usage -> (
        match object_field usage "cost" with
        | None -> None
        | Some cost ->
            if not (has_property cost "total") then None
            else
              float_field cost "total")

let assistant_message entry =
  let message =
    match object_field entry "message" with
    | Some value -> value
    | None -> entry
  in
  get_string message "role" = "assistant"

type total_cost_cache = {
  session_id : string;
  branch_length : int;
  total : float;
  last_assistant_index : int option;
  last_assistant_entry : Unsafe.any option;
  last_assistant_cost : float option;
}

let total_cost_cache : total_cost_cache option ref = ref None

let js_strict_equal =
  let equal = Unsafe.js_expr "((a, b) => a === b)" in
  fun left right ->
    Js.to_bool (Unsafe.coerce (Unsafe.fun_call equal [| left; right |]))

type total_cost_acc = {
  acc_total : float;
  acc_last_assistant_index : int option;
  acc_last_assistant_entry : Unsafe.any option;
  acc_last_assistant_cost : float option;
}

let scan_cost_entries entries ~start acc =
  let next = ref acc in
  for index = start to Array.length entries - 1 do
    let entry = entries.(index) in
    let cost = message_cost entry in
    Option.iter
      (fun cost ->
        next := { !next with acc_total = !next.acc_total +. cost })
      cost;
    if assistant_message entry then
      next :=
        {
          !next with
          acc_last_assistant_index = Some index;
          acc_last_assistant_entry = Some entry;
          acc_last_assistant_cost = cost;
        }
  done;
  !next

let empty_cost_acc =
  {
    acc_total = 0.0;
    acc_last_assistant_index = None;
    acc_last_assistant_entry = None;
    acc_last_assistant_cost = None;
  }

let cache_acc session_id branch_length acc =
  total_cost_cache :=
    Some
      {
        session_id;
        branch_length;
        total = acc.acc_total;
        last_assistant_index = acc.acc_last_assistant_index;
        last_assistant_entry = acc.acc_last_assistant_entry;
        last_assistant_cost = acc.acc_last_assistant_cost;
      };
  acc.acc_total

let cache_total_cost session_id entries =
  let branch_length = Array.length entries in
  let cache_scan acc = cache_acc session_id branch_length acc in
  let recompute () = cache_scan (scan_cost_entries entries ~start:0 empty_cost_acc) in
  match !total_cost_cache with
  | Some cache
    when cache.session_id = session_id && cache.branch_length <= branch_length -> (
      let same_last_assistant =
        match (cache.last_assistant_index, cache.last_assistant_entry) with
        | None, None -> true
        | Some index, Some previous when index < branch_length ->
            js_strict_equal previous entries.(index)
            && message_cost entries.(index) = cache.last_assistant_cost
        | _ -> false
      in
      if not same_last_assistant then recompute ()
      else if cache.branch_length = branch_length then cache.total
      else
        cache_scan
          (scan_cost_entries entries ~start:cache.branch_length
             {
               acc_total = cache.total;
               acc_last_assistant_index = cache.last_assistant_index;
               acc_last_assistant_entry = cache.last_assistant_entry;
               acc_last_assistant_cost = cache.last_assistant_cost;
             }))
  | _ -> recompute ()

let total_cost_from_ctx ctx =
  match Session_store.branch_entries_array_opt ctx with
  | None -> None
  | Some entries ->
      Some (cache_total_cost (Session_store.session_id_from_ctx ctx) entries)

let bool_of_flag_string value =
  match String.lowercase_ascii (String.trim value) with
  | "1" | "true" | "yes" | "on" | "enabled" -> Some true
  | "0" | "false" | "no" | "off" | "disabled" -> Some false
  | _ -> None

let session_is_isolated_child_data = function
  | None -> false
  | Some data ->
      get_bool data "isolated_child"
      ||
      match get_string data "kind" with
      | "agent" | "ralph" -> true
      | _ -> false

let session_is_isolated_child ctx =
  session_is_isolated_child_data (Session_store.custom_entry_data ctx "taumel.childSession")

let update_session_state host ctx =
  let snapshot = call1 host "sessionSnapshot" (inject ctx) in
  let next_host_sandbox_preset =
    Taumel.Capability_profile.sandbox_of_string (get_string snapshot "sandboxMode")
  in
  let next_host_network_mode =
    Taumel.Permissions.network_of_string (get_string snapshot "networkMode")
  in
  let next_host_no_sandbox =
    if has_property snapshot "noSandbox" then Some (get_bool snapshot "noSandbox")
    else bool_of_flag_string (get_string snapshot "noSandboxFlag")
  in
  let next_session_state =
    if session_is_isolated_child ctx then None
    else
      Some
        (
          get_string snapshot "cwd",
          get_string snapshot "provider",
          get_string snapshot "model",
          get_string snapshot "thinking",
          (match total_cost_from_ctx ctx with
          | Some cost -> cost
          | None -> float_field_default snapshot "totalCost" 0.0),
          float_field_default snapshot "contextPercent" 0.0,
          float_field_default snapshot "contextWindow" 0.0 )
  in
  host_sandbox_preset := next_host_sandbox_preset;
  host_network_mode := next_host_network_mode;
  host_no_sandbox := next_host_no_sandbox;
  match next_session_state with
  | None -> ()
  | Some
      ( next_cwd,
        next_provider,
        next_model,
        next_thinking,
        next_total_cost,
        next_context_percent,
        next_context_window ) ->
      let previous_cwd = state.cwd in
      state.cwd <- next_cwd;
      state.provider <- next_provider;
      state.model <- next_model;
      state.thinking <- next_thinking;
      state.total_cost <- next_total_cost;
      state.context_percent <- next_context_percent;
      state.context_window <- next_context_window;
      if previous_cwd <> "" && previous_cwd <> state.cwd then
        state.git_delta <- Model.empty_git_delta

let try_refresh_session_state_from_host ?(scope = "session state refresh") ctx =
  try
    update_session_state (active_host_or_empty ()) ctx;
    true
  with error ->
    report_session_sync_error scope error;
    false

let refresh_session_state_from_host ?(scope = "session state refresh") ctx =
  ignore (try_refresh_session_state_from_host ~scope ctx)

type persisted_session_snapshot = {
  session_id : string;
  child_session : Unsafe.any option;
  goal : Unsafe.any option;
  goal_automation_entry : Unsafe.any option;
  permissions : Unsafe.any option;
  ralph : Unsafe.any option;
  visibility : Unsafe.any option;
  agents : Unsafe.any option;
}

let persisted_session_snapshot ctx =
  {
    session_id = Session_store.session_id_from_ctx ctx;
    child_session = Session_store.custom_entry_data ctx "taumel.childSession";
    goal = Session_store.custom_entry_data ctx "taumel.goal";
    goal_automation_entry =
      Session_store.custom_entry_data ctx "taumel.goal_automation";
    permissions = Session_store.custom_entry_data ctx "taumel.permissions";
    ralph = Session_store.custom_entry_data ctx "taumel.ralph";
    visibility = Session_store.custom_entry_data ctx "taumel.visibility";
    agents = Session_store.custom_entry_data ctx "taumel.agents.v4";
  }

let load_goal_state_data ~session_id = function
  | None ->
      current_goal := None;
      false
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Goal.codec.decode with
      | Ok (Some goal) when goal.thread_id <> session_id ->
          current_goal := Some (Taumel.Goal.rebind_for_fork ~session_id goal);
          true
      | Ok goal ->
          current_goal := goal;
          false
      | Error message ->
          pending_goal_load_warning :=
            Some ("Ignoring incompatible saved Taumel goal entry: " ^ message);
          report_session_sync_error "goal load"
            (Failure ("Ignoring incompatible saved Taumel goal entry: " ^ message));
          current_goal := None;
          false)

let load_goal_automation_state_data = function
  | None -> goal_automation := Taumel.Goal.Automation_enabled
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Goal.automation_codec.decode with
      | Ok automation -> goal_automation := automation
      | Error message ->
          pending_goal_load_warning :=
            Some
              ("Ignoring incompatible saved Taumel goal automation entry: "
             ^ message);
          report_session_sync_error "goal automation load"
            (Failure ("Ignoring incompatible saved Taumel goal automation entry: " ^ message));
          goal_automation := Taumel.Goal.Automation_enabled)

let apply_active_permissions (resolved : Taumel.Permissions.active) =
  active_profile_state := resolved.profile;
  active_network_mode := resolved.network_mode;
  active_no_sandbox := resolved.no_sandbox;
  active_isolated_child := resolved.isolated_child;
  state.filesystem_mode <- resolved.filesystem_mode

let load_permissions_state_data ~child_session permissions =
  let session_isolated_child = session_is_isolated_child_data child_session in
  let persisted =
    match permissions with
    | None -> Taumel.Permissions.Missing
    | Some data -> (
        match Result.bind (json_from_js data) Taumel.Permissions.codec.decode with
        | Ok permissions -> Taumel.Permissions.Persisted permissions
        | Error _ -> Taumel.Permissions.Invalid)
  in
  Taumel.Permissions.resolve_active
    ~host_sandbox_preset:!host_sandbox_preset
    ~host_network_mode:!host_network_mode ~host_no_sandbox:!host_no_sandbox
    ~session_isolated_child persisted
  |> apply_active_permissions

let load_ralph_state_data = function
  | None -> ralph_tasks := []
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Ralph_loop.codec.decode with
      | Ok tasks -> ralph_tasks := tasks
      | Error _ -> ralph_tasks := [])

let load_visibility_state_data visibility =
  visibility_warning_flags := Taumel.Visibility.empty_warning_flags;
  match visibility with
  | None -> visibility_state := Taumel.Visibility.empty
  | Some data -> (
      match Result.bind (json_from_js data) Taumel.Visibility.codec.decode with
      | Ok state -> visibility_state := state
      | Error message ->
          report_session_sync_error "visibility state load"
            (Failure
               ("Ignoring incompatible saved Taumel visibility entry: " ^ message));
          visibility_state := Taumel.Visibility.empty)

let child_marker_matches (identity : Taumel.Agents.identity) raw =
  raw |> String.split_on_char '\n'
  |> List.fold_left
       (fun found line ->
         match Taumel.Shared.decode_json_string line with
         | Ok (Taumel.Shared.Object fields) -> (
             match
               ( List.assoc_opt "type" fields,
                 List.assoc_opt "customType" fields,
                 List.assoc_opt "data" fields )
             with
             | Some (Taumel.Shared.String "custom"),
               Some (Taumel.Shared.String "taumel.childSession"),
               Some (Taumel.Shared.Object data) ->
                 let string name =
                   match List.assoc_opt name data with
                   | Some (Taumel.Shared.String value) -> value
                   | _ -> ""
                 in
                 string "agentId" = identity.identity_agent_id
                 && string "parentSessionId"
                    = identity.identity_owner_session_id
             | _ -> found)
         | _ -> found)
       false

let child_session_file_available (identity : Taumel.Agents.identity) =
  match identity.identity_child_session_file with
  | None -> false
  | Some path -> (
      try
        let process = Unsafe.get Unsafe.global "process" in
        let fs =
          match function_field process "getBuiltinModule" with
          | Some get_builtin ->
              Unsafe.fun_call get_builtin [| js_string "fs" |]
          | None ->
              let require = Unsafe.get Unsafe.global "require" in
              Unsafe.fun_call require [| js_string "fs" |]
        in
        if
          not
            (Js.to_bool
               (Unsafe.meth_call fs "existsSync" [| js_string path |]))
        then false
        else
          let raw =
            Js.to_string
              (Unsafe.meth_call fs "readFileSync"
                 [| js_string path; js_string "utf8" |])
          in
          child_marker_matches identity raw
      with _ -> false)

let settled_entry_id (identity : Taumel.Agents.identity)
    (run : Taumel.Agents.agent_run) =
  match identity.identity_child_session_file with
  | None -> None
  | Some path -> (
      try
        let process = Unsafe.get Unsafe.global "process" in
        let fs =
          match function_field process "getBuiltinModule" with
          | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string "fs" |]
          | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string "fs" |]
        in
        let raw =
          Js.to_string
            (Unsafe.meth_call fs "readFileSync" [| js_string path; js_string "utf8" |])
        in
        if not (child_marker_matches identity raw) then None
        else
          let rec scan = function
            | [] -> None
            | line :: rest -> (
                match Taumel.Shared.decode_json_string line with
                | Ok (Taumel.Shared.Object fields) -> (
                    match List.assoc_opt "id" fields with
                    | Some (Taumel.Shared.String id)
                      when Some id = run.run_previous_assistant_entry_id -> None
                    | Some (Taumel.Shared.String id) -> (
                        match List.assoc_opt "message" fields with
                        | Some (Taumel.Shared.Object message) -> (
                            match
                              ( List.assoc_opt "role" message,
                                List.assoc_opt "stopReason" message )
                            with
                            | Some (Taumel.Shared.String "assistant"),
                              Some (Taumel.Shared.String ("stop" | "completed")) -> Some id
                            | _ -> scan rest)
                        | _ -> scan rest)
                    | _ -> scan rest)
                | _ -> scan rest)
          in
          scan (List.rev (String.split_on_char '\n' raw))
      with _ -> None)

let reconcile_settled_runs state =
  List.fold_left
    (fun state (run : Taumel.Agents.agent_run) ->
      if run.run_status <> Taumel.Agents.Running then state
      else
        match Taumel.Agents.find_identity state run.run_agent_id with
        | None -> state
        | Some identity -> (
            match settled_entry_id identity run with
            | None -> state
            | Some result_entry_id -> (
                match
                  Taumel.Agents.record_run_completion state ~now:(now_seconds ())
                    ~run_id:run.run_id ~status:Taumel.Agents.Completed
                    ~result_entry_id ~submission_id:run.run_submission_id ()
                with
                | Ok next -> next
                | Error _ -> state)))
    state state.runs

let seen_agent_session_ids : string list ref = ref []

let first_agent_session_load session_id =
  not (List.mem session_id !seen_agent_session_ids)

let remember_agent_session session_id =
  if not (List.mem session_id !seen_agent_session_ids) then
    seen_agent_session_ids := session_id :: !seen_agent_session_ids

let load_agent_state_data ~recover_running = function
  | None ->
      agent_notification_claims := [];
      agent_closing_ids := [];
      agent_state_load_error := None;
      agent_state := Taumel.Agents.empty_session_state
  | Some data -> (
      agent_notification_claims := [];
      agent_closing_ids := [];
      match Result.bind (json_from_js data) Taumel.Agents_codec.decode with
      | Ok state ->
          agent_state_load_error := None;
          let state = if recover_running then reconcile_settled_runs state else state in
          agent_state :=
            if recover_running then
              Taumel.Agents.mark_running_after_process_loss state
                ~now:(now_seconds ())
                ~child_session_available:(fun run ->
                  match Taumel.Agents.find_identity state run.run_agent_id with
                  | Some identity ->
                      child_session_file_available identity
                  | None -> false)
            else state
      | Error message ->
          agent_state_load_error := Some message;
          report_session_sync_error "agents load"
            (Failure ("Ignoring incompatible saved Taumel agents entry: " ^ message));
          agent_state := Taumel.Agents.empty_session_state)

let load_session_state ctx =
  let snapshot = persisted_session_snapshot ctx in
  let forked = load_goal_state_data ~session_id:snapshot.session_id snapshot.goal in
  if forked then goal_automation := Taumel.Goal.Automation_interrupted
  else load_goal_automation_state_data snapshot.goal_automation_entry;
  load_permissions_state_data ~child_session:snapshot.child_session
    snapshot.permissions;
  load_ralph_state_data snapshot.ralph;
  load_visibility_state_data snapshot.visibility;
  load_agent_state_data
    ~recover_running:(first_agent_session_load snapshot.session_id)
    snapshot.agents;
  remember_agent_session snapshot.session_id;
  last_goal_accounting_key := None;
  goal_turn_clock := Taumel.Goal.empty_clock;
  pending_goal_terminal_status := None;
  goal_retrying := false;
  goal_compacting := false;
  notify_pending_goal_warning ctx

let has_persisted_component_entry snapshot =
  snapshot.goal <> None
  || snapshot.goal_automation_entry <> None
  || snapshot.permissions <> None
  || snapshot.ralph <> None
  || snapshot.visibility <> None
  || snapshot.agents <> None

let sync_persisted_session_snapshot ?(reset_missing = true)
    ?(clear_retained_outputs = false) snapshot =
  let session_id = snapshot.session_id in
  if
    !loaded_session_id <> Some session_id
    && (reset_missing || has_persisted_component_entry snapshot)
  then (
    let forked =
      load_goal_state_data ~session_id:snapshot.session_id snapshot.goal
    in
    if forked then goal_automation := Taumel.Goal.Automation_interrupted
    else load_goal_automation_state_data snapshot.goal_automation_entry;
    load_permissions_state_data ~child_session:snapshot.child_session
      snapshot.permissions;
    load_ralph_state_data snapshot.ralph;
    load_visibility_state_data snapshot.visibility;
    load_agent_state_data
      ~recover_running:(first_agent_session_load snapshot.session_id)
      snapshot.agents;
    remember_agent_session snapshot.session_id;
    last_goal_accounting_key := None;
    goal_turn_clock := Taumel.Goal.empty_clock;
    pending_goal_terminal_status := None;
    goal_retrying := false;
    goal_compacting := false;
    loaded_session_id := Some session_id)

let finish_goal_load ctx snapshot =
  let inherited_owner =
    match snapshot.goal with
    | None -> None
    | Some data -> (
        match Result.bind (json_from_js data) Taumel.Goal.codec.decode with
        | Ok (Some goal) -> Some goal.thread_id
        | _ -> None)
  in
  if inherited_owner <> None && inherited_owner <> Some snapshot.session_id then (
    Session_store.append_custom_entry ctx "taumel.goal"
      (Taumel.Goal.codec.encode !current_goal);
    Session_store.append_custom_entry ctx "taumel.goal_automation"
      (Taumel.Goal.automation_codec.encode !goal_automation));
  notify_pending_goal_warning ctx

let sync_persisted_session ?(reset_missing = true)
    ?(clear_retained_outputs = false) ctx =
  let snapshot = persisted_session_snapshot ctx in
  sync_persisted_session_snapshot ~reset_missing ~clear_retained_outputs snapshot;
  finish_goal_load ctx snapshot

let persisted_session_snapshot_is_isolated_child snapshot =
  session_is_isolated_child_data snapshot.child_session

let try_sync_session_from_host_with ?(scope = "session sync")
    ?(reset_missing = true) ?(clear_retained_outputs = false) host ctx =
  try
    let snapshot = persisted_session_snapshot ctx in
    update_session_state host ctx;
    sync_persisted_session_snapshot ~reset_missing ~clear_retained_outputs
      snapshot;
    finish_goal_load ctx snapshot;
    Some snapshot
  with error ->
    report_session_sync_error scope error;
    None

let try_sync_session_from_host ?(scope = "session sync") ?(reset_missing = true) ctx =
  Option.is_some
    (try_sync_session_from_host_with ~scope ~reset_missing (active_host_or_empty ()) ctx)

let sync_session_from_host ?(scope = "session sync") ?(reset_missing = true) ctx =
  ignore (try_sync_session_from_host ~scope ~reset_missing ctx)

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
      ~isolated_child:!active_isolated_child (active_profile ())
  with
  | Ok permissions ->
      Session_store.append_custom_entry ctx "taumel.permissions"
        (Taumel.Permissions.codec.encode permissions)
  | Error _ -> ()

let save_ralph_state ctx =
  Session_store.append_custom_entry ctx "taumel.ralph"
    (Taumel.Ralph_loop.codec.encode !ralph_tasks)

let save_visibility_state ctx =
  Session_store.append_custom_entry ctx "taumel.visibility"
    (Taumel.Visibility.codec.encode !visibility_state)

let account_goal_turn_end ctx =
  let active_time_seconds, next_clock =
    Taumel.Goal.finish_turn_clock ~now_ms:(now_milliseconds ()) !goal_turn_clock
  in
  goal_turn_clock := next_clock;
  let now = now_seconds () in
  let result =
    Taumel.Goal.account_turn_end
      ?pending_terminal_status:!pending_goal_terminal_status
      ~session_id:(Session_store.session_id_from_ctx ctx) ~now
      ~active_time_seconds ~last_accounting_key:!last_goal_accounting_key
      ~branch:(Session_store.branch_json_entries ctx) !current_goal
  in
  pending_goal_terminal_status := None;
  if result.changed then (
    current_goal := result.goal;
    last_goal_accounting_key := result.accounting_key;
    save_goal_state ctx)

let try_account_goal_turn_end ?(scope = "goal turn accounting") ctx =
  try
    account_goal_turn_end ctx;
    true
  with error ->
    report_session_sync_error scope error;
    false

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
