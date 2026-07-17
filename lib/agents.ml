(* Durable asynchronous child agents owned by a main Pi session.
   Domain rules follow plans/subagents.md. *)

module String_set = Shared.String_set

let schema_version = 5
let max_identities_per_owner = 64
let max_error_chars = 4096
let nano_id_alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
let nano_id_length = 4
let nano_id_radix = String.length nano_id_alphabet
let nano_id_namespace_size = nano_id_radix * nano_id_radix * nano_id_radix * nano_id_radix

type agent_kind =
  | Generic
  | Finder
  | Oracle

type effort =
  | Low
  | Medium
  | High

type run_status =
  | Running
  | Suspended
  | Completed
  | Failed
  | Cancelled
  | Lost

type activity_state =
  | Starting
  | Reasoning
  | Using_tool
  | Orphaned
  | Inactive

type reason_code =
  | Interrupted_by_parent
  | Parent_shutdown
  | Process_interrupted
  | Close_cleanup_failed
  | Host_cancelled
  | Dispatch_failed
  | Agent_failed
  | Internal_error
  | Child_session_lost

type announcement =
  | Pending
  | Observed_by_agent_wait
  | Notification_sent

type send_outcome =
  | Message_sent
  | Interrupted_and_sent
  | Suspended_outcome
  | Already_suspended
  | Resumed
  | Started
  | No_active_run

type identity = {
  identity_agent_id : string;
  identity_owner_session_id : string;
  identity_issued_run_count : int;
  identity_kind : agent_kind;
  identity_effort : effort option;
  identity_model : string;
  identity_thinking : string;
  identity_active_tools : string list;
  identity_permission_ceiling : Capability_profile.t;
  identity_network_allowed : bool;
  identity_workspace_binding : Agent_workspace.workspace_binding;
  identity_child_session_file : string option;
  identity_child_session_id : string option;
  identity_created_at : int;
}

type agent_run = {
  run_id : string;
  run_agent_id : string;
  run_status : run_status;
  run_reason_code : reason_code option;
  run_error : string option;
  run_output_available : bool;
  run_final_output : string option;
  run_partial_output : string option;
  run_announcement : announcement;
  run_started_at : int;
  run_ended_at : int option;
  run_suspended_at : int option;
  run_submission_id : string;
  run_result_entry_id : string option;
  run_previous_assistant_entry_id : string option;
  run_description : string;
  run_turn_count : int;
  run_last_activity_at : int option;
  run_activity_state : activity_state;
  run_active_tool_count : int;
}

type issued_identity_counts = {
  generic : int;
  finder : int;
  oracle : int;
}

type cleanup_pending = {
  cleanup_owner_session_id : string;
  cleanup_agent_id : string;
  cleanup_nonce : string;
  cleanup_remaining_artifacts : string list;
}

type session_state = {
  identities : identity list;
  runs : agent_run list;
  issued_identity_counts : issued_identity_counts;
  cleanup_pending : cleanup_pending list;
}

type send_delivery = {
  delivery_state : session_state;
  delivery_outcome : send_outcome;
  delivery_run_id : string option;
  delivery_status : run_status option;
  delivery_submission_id : string option;
  delivery_previous_status : run_status option;
}

type wait_item = {
  wait_agent_id : string;
  wait_run_id : string;
  wait_kind : agent_kind;
  wait_model : string;
  wait_thinking : string;
  wait_status : run_status;
  wait_reason_code : reason_code option;
  wait_error : string option;
  wait_output_available : bool;
  wait_output : string option;
  wait_partial_output : string option;
  wait_started_at : int;
  wait_ended_at : int option;
  wait_suspended_at : int option;
}

type wait_result = {
  wait_state : session_state;
  wait_timed_out : bool;
  wait_items : wait_item list;
  wait_pending_run_ids : string list;
}

let empty_issued_identity_counts = { generic = 0; finder = 0; oracle = 0 }

let empty_session_state =
  {
    identities = [];
    runs = [];
    issued_identity_counts = empty_issued_identity_counts;
    cleanup_pending = [];
  }
let agent_kind_to_string = function
  | Generic -> "generic"
  | Finder -> "finder"
  | Oracle -> "oracle"

let agent_kind_of_string = function
  | "generic" -> Ok Generic
  | "finder" -> Ok Finder
  | "oracle" -> Ok Oracle
  | value -> Error ("invalid agent kind: " ^ value)

let effort_to_string = function
  | Low -> "low"
  | Medium -> "medium"
  | High -> "high"

let effort_of_string = function
  | "low" -> Ok Low
  | "medium" -> Ok Medium
  | "high" -> Ok High
  | value -> Error ("invalid agent effort: " ^ value)

let run_status_to_string = function
  | Running -> "running"
  | Suspended -> "suspended"
  | Completed -> "completed"
  | Failed -> "failed"
  | Cancelled -> "cancelled"
  | Lost -> "lost"

let activity_state_to_string = function
  | Starting -> "starting"
  | Reasoning -> "reasoning"
  | Using_tool -> "using_tool"
  | Orphaned -> "orphaned"
  | Inactive -> "inactive"

let activity_state_of_string = function
  | "starting" -> Ok Starting
  | "reasoning" -> Ok Reasoning
  | "using_tool" -> Ok Using_tool
  | "orphaned" -> Ok Orphaned
  | "inactive" -> Ok Inactive
  | value -> Error ("invalid agent activity state: " ^ value)

let run_status_of_string = function
  | "running" -> Ok Running
  | "suspended" -> Ok Suspended
  | "completed" -> Ok Completed
  | "failed" -> Ok Failed
  | "cancelled" -> Ok Cancelled
  | "lost" -> Ok Lost
  | value -> Error ("invalid agent run status: " ^ value)

let reason_code_to_string = function
  | Interrupted_by_parent -> "interrupted_by_parent"
  | Parent_shutdown -> "parent_shutdown"
  | Process_interrupted -> "process_interrupted"
  | Close_cleanup_failed -> "close_cleanup_failed"
  | Host_cancelled -> "host_cancelled"
  | Dispatch_failed -> "dispatch_failed"
  | Agent_failed -> "agent_failed"
  | Internal_error -> "internal_error"
  | Child_session_lost -> "child_session_lost"

let reason_code_of_string = function
  | "interrupted_by_parent" -> Ok Interrupted_by_parent
  | "parent_shutdown" -> Ok Parent_shutdown
  | "process_interrupted" -> Ok Process_interrupted
  | "close_cleanup_failed" -> Ok Close_cleanup_failed
  | "host_cancelled" -> Ok Host_cancelled
  | "dispatch_failed" -> Ok Dispatch_failed
  | "agent_failed" -> Ok Agent_failed
  | "internal_error" -> Ok Internal_error
  | "child_session_lost" -> Ok Child_session_lost
  | value -> Error ("invalid agent reason code: " ^ value)

let announcement_to_string = function
  | Pending -> "pending"
  | Observed_by_agent_wait -> "observed_by_agent_wait"
  | Notification_sent -> "notification_sent"

let announcement_of_string = function
  | "pending" -> Ok Pending
  | "observed_by_agent_wait" -> Ok Observed_by_agent_wait
  | "notification_sent" -> Ok Notification_sent
  | value -> Error ("invalid announcement state: " ^ value)

let send_outcome_to_string = function
  | Message_sent -> "message_sent"
  | Interrupted_and_sent -> "interrupted_and_sent"
  | Suspended_outcome -> "suspended"
  | Already_suspended -> "already_suspended"
  | Resumed -> "resumed"
  | Started -> "started"
  | No_active_run -> "no_active_run"

let send_outcome_of_string = function
  | "message_sent" -> Ok Message_sent
  | "interrupted_and_sent" -> Ok Interrupted_and_sent
  | "suspended" -> Ok Suspended_outcome
  | "already_suspended" -> Ok Already_suspended
  | "resumed" -> Ok Resumed
  | "started" -> Ok Started
  | "no_active_run" -> Ok No_active_run
  | value -> Error ("invalid agent send outcome: " ^ value)

let terminal_run_status = function
  | Completed | Failed | Cancelled | Lost -> true
  | Running | Suspended -> false

let active_work_run_status = function
  | Running -> true
  | Suspended | Completed | Failed | Cancelled | Lost -> false

let ready_wait_status = function
  | Suspended | Completed | Failed | Cancelled | Lost -> true
  | Running -> false

let reason_compatible status reason =
  match (status, reason) with
  | Running, None | Completed, None -> true
  | Suspended, Some Interrupted_by_parent
  | Suspended, Some Parent_shutdown
  | Suspended, Some Process_interrupted
  | Suspended, Some Close_cleanup_failed -> true
  | Cancelled, Some Host_cancelled -> true
  | Failed, Some Dispatch_failed
  | Failed, Some Agent_failed
  | Failed, Some Internal_error -> true
  | Lost, Some Child_session_lost -> true
  | _ -> false

let bound_error = function
  | None -> None
  | Some text ->
      let text = String.trim text in
      if text = "" then None
      else if String.length text <= max_error_chars then Some text
      else Some (String.sub text 0 max_error_chars)

let stable_hash value =
  let rec loop index acc =
    if index >= String.length value then acc land 0x7fffffff
    else
      let acc = ((acc lsl 5) - acc) + Char.code value.[index] in
      loop (index + 1) acc
  in
  loop 0 0

let agent_tools =
  [
    "agent_spawn";
    "agent_send";
    "agent_wait";
    "agent_list";
    "agent_close";
    "finder";
    "oracle";
  ]

let unique_names names =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | name :: rest ->
        if List.mem name seen then loop seen acc rest
        else loop (name :: seen) (name :: acc) rest
  in
  loop [] [] names

let remove_agent_tools tools =
  List.filter (fun name -> not (List.mem name agent_tools)) tools |> unique_names

let tool_effect name =
  Tool_catalog.tool_specs
  |> List.find_opt (fun (spec : Tool_gateway.spec) -> spec.name = name)
  |> Option.map (fun (spec : Tool_gateway.spec) -> spec.effect_kind)

let specialist_tools ~kind parent_tools =
  let parent = remove_agent_tools parent_tools in
  let allowed =
    match kind with
    | Generic -> parent
    | Finder ->
        parent
        |> List.filter (fun name ->
               match tool_effect name with
               | Some Tool_gateway.Pure | Some Tool_gateway.Execute -> true
               | _ -> false)
    | Oracle ->
        parent
        |> List.filter (fun name ->
               match tool_effect name with
               | Some Tool_gateway.Pure
               | Some Tool_gateway.Execute
               | Some Tool_gateway.Network -> true
               | _ -> false)
  in
  allowed
  |> List.filter (fun name -> not (List.mem name agent_tools))
  |> unique_names

let find_identity state agent_id =
  let agent_id = String.trim agent_id in
  List.find_opt
    (fun identity -> identity.identity_agent_id = agent_id)
    state.identities

let find_run state run_id =
  let run_id = String.trim run_id in
  List.find_opt (fun run -> run.run_id = run_id) state.runs

let runs_for_agent state agent_id =
  List.filter (fun run -> run.run_agent_id = agent_id) state.runs

let latest_run state agent_id =
  match runs_for_agent state agent_id with
  | [] -> None
  | first :: rest ->
      Some
        (List.fold_left
           (fun latest run ->
             if run.run_started_at > latest.run_started_at
             then run
             else latest)
           first rest)

let active_or_suspended_run state agent_id =
  runs_for_agent state agent_id
  |> List.find_opt (fun run ->
         match run.run_status with Running | Suspended -> true | _ -> false)

let replace_identity updated identities =
  List.map
    (fun identity ->
      if identity.identity_agent_id = updated.identity_agent_id then updated
      else identity)
    identities

let replace_run updated runs =
  List.map (fun run -> if run.run_id = updated.run_id then updated else run) runs

let remove_identity agent_id identities =
  List.filter (fun identity -> identity.identity_agent_id <> agent_id) identities

let remove_runs_for_agent agent_id runs =
  List.filter (fun run -> run.run_agent_id <> agent_id) runs

let owned_identity state ~owner_session_id agent_id =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity when identity.identity_owner_session_id <> owner_session_id ->
      Error ("agent is not owned by this session: " ^ agent_id)
  | Some identity -> Ok identity

let owned_identities state ~owner_session_id =
  List.filter
    (fun identity -> identity.identity_owner_session_id = owner_session_id)
    state.identities

let identity_count_for_owner state ~owner_session_id =
  List.length (owned_identities state ~owner_session_id)

let agent_id_used state agent_id = find_identity state agent_id <> None
let run_id_used state run_id = find_run state run_id <> None

let kind_prefix = function
  | Generic -> "agent"
  | Finder -> "finder"
  | Oracle -> "oracle"

let issued_count counts = function
  | Generic -> counts.generic
  | Finder -> counts.finder
  | Oracle -> counts.oracle

let with_issued_count counts kind value =
  match kind with
  | Generic -> { counts with generic = value }
  | Finder -> { counts with finder = value }
  | Oracle -> { counts with oracle = value }

let nano_id index =
  let value = ref index in
  let result = Bytes.make nano_id_length nano_id_alphabet.[0] in
  for position = nano_id_length - 1 downto 0 do
    Bytes.set result position nano_id_alphabet.[!value mod nano_id_radix];
    value := !value / nano_id_radix
  done;
  Bytes.to_string result

let valid_nano_id value =
  String.length value = nano_id_length
  && String.for_all (fun character -> String.contains nano_id_alphabet character) value

let valid_agent_id kind value =
  let prefix = kind_prefix kind in
  let prefix_length = String.length prefix in
  String.length value = prefix_length + 1 + nano_id_length
  && String.sub value 0 prefix_length = prefix
  && value.[prefix_length] = '-'
  && valid_nano_id (String.sub value (prefix_length + 1) nano_id_length)

let generate_agent_id state kind ~owner_session_id =
  let count = issued_count state.issued_identity_counts kind in
  let prefix = kind_prefix kind in
  let offset = stable_hash (owner_session_id ^ ":" ^ prefix) mod nano_id_namespace_size in
  let step = 65537 in
  let rec loop cursor =
    if cursor >= nano_id_namespace_size then
      Error (prefix ^ " handle namespace is exhausted")
    else
      let index = (offset + (cursor * step)) mod nano_id_namespace_size in
      let candidate = prefix ^ "-" ^ nano_id index in
      if agent_id_used state candidate then loop (cursor + 1)
      else Ok (candidate, cursor + 1)
  in
  loop count

let generate_run_id agent_id count = agent_id ^ "-run-" ^ string_of_int count

let submission_id run_id index = run_id ^ "-submission-" ^ string_of_int index

let default_thinking_for_kind ~effort = function
  | Generic -> (
      match effort with
      | Some Low -> "low"
      | Some High -> "high"
      | Some Medium | None -> "medium")
  | Finder -> "low"
  | Oracle -> "high"

let create_run ~now ~agent_id ~run_id ~description =
  {
    run_id;
    run_agent_id = agent_id;
    run_status = Running;
    run_reason_code = None;
    run_error = None;
    run_output_available = false;
    run_final_output = None;
    run_partial_output = None;
    run_announcement = Pending;
    run_started_at = now;
    run_ended_at = None;
    run_suspended_at = None;
    run_submission_id = submission_id run_id 1;
    run_result_entry_id = None;
    run_previous_assistant_entry_id = None;
    run_description = description;
    run_turn_count = 0;
    run_last_activity_at = None;
    run_activity_state = Starting;
    run_active_tool_count = 0;
  }

let validate_unique_ids label ids =
  let rec loop seen = function
    | [] -> Ok ()
    | id :: rest ->
        let id = String.trim id in
        if id = "" then Error (label ^ " must not contain empty ids")
        else if List.mem id seen then Error (label ^ " must not contain duplicate ids")
        else loop (id :: seen) rest
  in
  loop [] ids

let identity_source_workspace identity =
  Agent_workspace.source_workspace identity.identity_workspace_binding

let identity_isolation identity =
  Agent_workspace.isolation_of_binding identity.identity_workspace_binding

let record_spawn state ~now ~owner_session_id ~kind ?effort ~model ~thinking
    ~description
    ~active_tools ~permission_ceiling ?(network_allowed = false)
    ~workspace_binding () =
  let owner_session_id = String.trim owner_session_id in
  let model = String.trim model in
  let thinking = String.trim thinking in
  let source_workspace =
    String.trim (Agent_workspace.source_workspace workspace_binding)
  in
  if owner_session_id = "" then Error "owner session id is required"
  else if source_workspace = "" then Error "workspace is required"
  else if model = "" then Error "model is required"
  else if thinking = "" then Error "thinking level is required"
  else if identity_count_for_owner state ~owner_session_id >= max_identities_per_owner
  then Error ("owner already has " ^ string_of_int max_identities_per_owner ^ " agents")
  else
    let effort =
      match kind with
      | Generic -> Some (Option.value effort ~default:Medium)
      | Finder | Oracle -> None
    in
    match generate_agent_id state kind ~owner_session_id with
    | Error _ as error -> error
    | Ok (agent_id, next_issued_count) ->
    let run_id = generate_run_id agent_id 1 in
    let identity =
      {
        identity_agent_id = agent_id;
        identity_owner_session_id = owner_session_id;
        identity_issued_run_count = 1;
        identity_kind = kind;
        identity_effort = effort;
        identity_model = model;
        identity_thinking = thinking;
        identity_active_tools = specialist_tools ~kind active_tools;
        identity_permission_ceiling = permission_ceiling;
        identity_network_allowed =
          (match kind with Finder -> false | Generic | Oracle -> network_allowed);
        identity_workspace_binding = workspace_binding;
        identity_child_session_file = None;
        identity_child_session_id = None;
        identity_created_at = now;
      }
    in
    let run = create_run ~now ~agent_id ~run_id ~description in
    let state =
      {
        identities = identity :: state.identities;
        runs = run :: state.runs;
        issued_identity_counts =
          with_issued_count state.issued_identity_counts kind next_issued_count;
        cleanup_pending = state.cleanup_pending;
      }
    in
    Ok (state, identity, run)

let record_child_session state ~agent_id ?child_session_id ?child_session_file () =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity ->
      let updated =
        {
          identity with
          identity_child_session_id =
            (match child_session_id with
            | Some value -> Shared.trim_non_empty value
            | None -> identity.identity_child_session_id);
          identity_child_session_file =
            (match child_session_file with
            | Some value -> Shared.trim_non_empty value
            | None -> identity.identity_child_session_file);
        }
      in
      Ok { state with identities = replace_identity updated state.identities }

let rollback_unaccepted_spawn state ~owner_session_id ~agent_id ~run_id
    ~submission_id =
  match owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok _identity -> (
      match find_run state run_id with
      | Some run
        when run.run_agent_id = agent_id
             && run.run_status = Running
             && run.run_submission_id = submission_id ->
          Ok
            {
              identities =
                List.filter
                  (fun item -> item.identity_agent_id <> agent_id)
                  state.identities;
              runs =
                List.filter (fun item -> item.run_agent_id <> agent_id) state.runs;
              issued_identity_counts = state.issued_identity_counts;
              cleanup_pending = state.cleanup_pending;
            }
      | _ -> Error ("agent spawn is already accepted: " ^ agent_id))

let next_submission run =
  let index =
    match String.rindex_opt run.run_submission_id '-' with
    | None -> 2
    | Some index -> (
        match
          int_of_string_opt
            (String.sub run.run_submission_id (index + 1)
               (String.length run.run_submission_id - index - 1))
        with
        | Some value -> value + 1
        | None -> 2)
  in
  { run with run_submission_id = submission_id run.run_id index }

let record_send ?(interrupt = false) state ~now ~owner_session_id ~agent_id
    ?(description = "") message =
  let message = String.trim message in
  if message = "" && not interrupt then
    Error "agent_send.message is required unless interrupt is true"
  else
    match owned_identity state ~owner_session_id agent_id with
    | Error _ as error -> error
    | Ok identity -> (
        match active_or_suspended_run state agent_id with
        | Some run when interrupt && message = "" && run.run_status = Running ->
            let updated =
              {
                run with
                run_status = Suspended;
                run_reason_code = Some Interrupted_by_parent;
                run_error = None;
                run_ended_at = None;
                run_suspended_at = Some now;
                run_activity_state = Inactive;
                run_active_tool_count = 0;
              }
            in
            Ok
              {
                delivery_state = { state with runs = replace_run updated state.runs };
                delivery_outcome = Suspended_outcome;
                delivery_run_id = Some updated.run_id;
                delivery_status = Some Suspended;
                delivery_submission_id = None;
                delivery_previous_status = Some Running;
              }
        | Some run when interrupt && message = "" && run.run_status = Suspended ->
            Ok
              {
                delivery_state = state;
                delivery_outcome = Already_suspended;
                delivery_run_id = Some run.run_id;
                delivery_status = Some Suspended;
                delivery_submission_id = None;
                delivery_previous_status = Some Suspended;
              }
        | Some run when run.run_status = Suspended && message <> "" ->
            let updated =
              next_submission
                {
                  run with
                  run_status = Running;
                  run_reason_code = None;
                  run_error = None;
                  run_output_available = false;
                  run_final_output = None;
                  run_partial_output = None;
                  run_announcement = Pending;
                  run_ended_at = None;
                  run_description = if description = "" then run.run_description else description;
                  run_activity_state = Starting;
                  run_active_tool_count = 0;
                }
            in
            Ok
              {
                delivery_state = { state with runs = replace_run updated state.runs };
                delivery_outcome = Resumed;
                delivery_run_id = Some updated.run_id;
                delivery_status = Some Running;
                delivery_submission_id = Some updated.run_submission_id;
                delivery_previous_status = Some Suspended;
              }
        | Some run when run.run_status = Running && interrupt && message <> "" ->
            let updated =
              next_submission
                { run with
                  run_description = if description = "" then run.run_description else description }
            in
            Ok
              {
                delivery_state = { state with runs = replace_run updated state.runs };
                delivery_outcome = Interrupted_and_sent;
                delivery_run_id = Some updated.run_id;
                delivery_status = Some Running;
                delivery_submission_id = Some updated.run_submission_id;
                delivery_previous_status = Some Running;
              }
        | Some run when run.run_status = Running && message <> "" ->
            let updated =
              next_submission
                { run with
                  run_description = if description = "" then run.run_description else description }
            in
            Ok
              {
                delivery_state = { state with runs = replace_run updated state.runs };
                delivery_outcome = Message_sent;
                delivery_run_id = Some updated.run_id;
                delivery_status = Some Running;
                delivery_submission_id = Some updated.run_submission_id;
                delivery_previous_status = Some Running;
              }
        | None when interrupt && message = "" ->
            Ok
              {
                delivery_state = state;
                delivery_outcome = No_active_run;
                delivery_run_id = None;
                delivery_status = None;
                delivery_submission_id = None;
                delivery_previous_status = None;
              }
        | None when message <> "" ->
            let next_run_count = identity.identity_issued_run_count + 1 in
            let run_id = generate_run_id agent_id next_run_count in
            let run = create_run ~now ~agent_id ~run_id ~description in
            let identity =
              { identity with identity_issued_run_count = next_run_count }
            in
            Ok
              {
                delivery_state =
                  {
                    state with
                    identities = replace_identity identity state.identities;
                    runs = run :: state.runs;
                  };
                delivery_outcome = Started;
                delivery_run_id = Some run.run_id;
                delivery_status = Some Running;
                delivery_submission_id = Some run.run_submission_id;
                delivery_previous_status = None;
              }
        | _ -> Error "invalid agent_send state")

let rollback_send_preflight state ~owner_session_id ~agent_id ~run_id
    ~submission_id ~outcome ~previous_submission_id ~previous_reason_code =
  match owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok _ -> (
      match find_run state run_id with
      | Some run when run.run_submission_id = submission_id -> (
          match outcome with
          | Started ->
              Ok
                {
                  state with
                  runs = List.filter (fun item -> item.run_id <> run_id) state.runs;
                }
          | Resumed ->
              let reason =
                match previous_reason_code with
                | Some value
                  when value = Interrupted_by_parent || value = Parent_shutdown
                       || value = Process_interrupted
                       || value = Close_cleanup_failed ->
                    value
                | _ -> Process_interrupted
              in
              let restored =
                {
                  run with
                  run_status = Suspended;
                  run_reason_code = Some reason;
                  run_submission_id = previous_submission_id;
                  run_ended_at = None;
                }
              in
              Ok { state with runs = replace_run restored state.runs }
          | Message_sent | Interrupted_and_sent ->
              let restored = { run with run_submission_id = previous_submission_id } in
              Ok { state with runs = replace_run restored state.runs }
          | Suspended_outcome | Already_suspended | No_active_run -> Ok state)
      | _ -> Error ("agent send is already superseded: " ^ run_id))

let rollback_failed_interruption state ~owner_session_id ~agent_id ~run_id =
  match owned_identity state ~owner_session_id agent_id with
  | Error _ as error -> error
  | Ok _ -> (
      match find_run state run_id with
      | Some run
        when run.run_agent_id = agent_id && run.run_status = Suspended
             && run.run_reason_code = Some Interrupted_by_parent ->
          let restored =
            {
              run with
              run_status = Running;
              run_reason_code = None;
              run_ended_at = None;
            }
          in
          Ok { state with runs = replace_run restored state.runs }
      | _ -> Error ("agent interruption is already superseded: " ^ run_id))

let mark_run_terminal run ~now ~status ?reason_code ?error ?final_output
    ?partial_output ?result_entry_id () =
  if not (terminal_run_status status) then Error "completion status must be terminal"
  else if not (reason_compatible status reason_code) then
    Error "reason code is incompatible with status"
  else
    let result_entry_id = Option.bind result_entry_id Shared.trim_non_empty in
    let output_available =
      match status with
      | Completed -> final_output <> None || result_entry_id <> None
      | Failed | Cancelled | Lost -> partial_output <> None || result_entry_id <> None
      | Running | Suspended -> false
    in
    Ok
      {
        run with
        run_status = status;
        run_reason_code = reason_code;
        run_error = bound_error error;
        run_final_output =
          (match status with Completed -> final_output | _ -> None);
        run_partial_output =
          (match status with
          | Failed | Cancelled | Lost -> partial_output
          | _ -> None);
        run_output_available = output_available;
        run_ended_at = Some now;
        run_suspended_at = None;
        run_result_entry_id = result_entry_id;
        run_activity_state = Inactive;
        run_active_tool_count = 0;
      }

let record_run_completion state ~now ~run_id ~status ?reason_code ?error
    ?final_output ?partial_output ?result_entry_id ?submission_id () =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run
    when Option.is_some submission_id && submission_id <> Some run.run_submission_id ->
      Ok state
  | Some run when terminal_run_status run.run_status -> Ok state
  | Some run when run.run_status = Suspended -> Ok state
  | Some run -> (
      match
        mark_run_terminal run ~now ~status ?reason_code ?error ?final_output
          ?partial_output ?result_entry_id ()
      with
      | Error _ as error -> error
      | Ok updated -> Ok { state with runs = replace_run updated state.runs })

let record_dispatch_boundary state ~run_id ~submission_id
    ~previous_assistant_entry_id =
  match find_run state run_id with
  | Some run
    when run.run_status = Running && run.run_submission_id = submission_id ->
      let updated =
        { run with
          run_previous_assistant_entry_id =
            Option.bind previous_assistant_entry_id Shared.trim_non_empty }
      in
      Ok { state with runs = replace_run updated state.runs }
  | Some _ -> Ok state
  | None -> Error ("unknown run: " ^ run_id)

let record_dispatch_failure state ~now ~run_id ?error ?submission_id () =
  record_run_completion state ~now ~run_id ~status:Failed
    ~reason_code:Dispatch_failed ?error ?submission_id ()

let record_recovered_output state ~run_id output =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run when not (terminal_run_status run.run_status) ->
      Error ("run is not terminal: " ^ run_id)
  | Some run ->
      let updated =
        match (run.run_status, output) with
        | Completed, Some text ->
            {
              run with
              run_final_output = Some text;
              run_partial_output = None;
              run_output_available = true;
            }
        | (Failed | Cancelled | Lost), Some text ->
            {
              run with
              run_final_output = None;
              run_partial_output = Some text;
              run_output_available = true;
            }
        | _, None ->
            {
              run with
              run_final_output = None;
              run_partial_output = None;
              run_output_available = false;
            }
        | Suspended, Some _ | Running, Some _ -> run
      in
      Ok { state with runs = replace_run updated state.runs }

let suspend_run run ~now reason_code =
  if not (reason_compatible Suspended (Some reason_code)) then
    Error "invalid suspension reason"
  else
    Ok
      {
        run with
        run_status = Suspended;
        run_reason_code = Some reason_code;
        run_error = None;
        run_final_output = None;
        run_partial_output = None;
        run_output_available = false;
        run_ended_at = None;
        run_suspended_at = Some now;
        run_started_at = run.run_started_at;
        run_activity_state = Inactive;
        run_active_tool_count = 0;
      }

let mark_running_after_process_loss state ~now ~child_session_available =
  let runs =
    List.map
      (fun run ->
        if run.run_status <> Running then run
        else if child_session_available run then
          {
            run with
            run_status = Suspended;
            run_reason_code = Some Process_interrupted;
            run_error = None;
            run_output_available = false;
            run_final_output = None;
            run_partial_output = None;
            run_ended_at = None;
            run_suspended_at = Some now;
            run_activity_state = Inactive;
            run_active_tool_count = 0;
          }
        else
          {
            run with
            run_status = Lost;
            run_reason_code = Some Child_session_lost;
            run_error = None;
            run_output_available = false;
            run_final_output = None;
            run_partial_output = None;
            run_ended_at = Some now;
            run_suspended_at = None;
            run_activity_state = Inactive;
            run_active_tool_count = 0;
          })
      state.runs
  in
  { state with runs }
