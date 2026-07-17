open Jsoo_bridge
open App_state
open Runtime_access
let owner_id ctx = Session_store.session_id_from_ctx ctx
let is_agent_child ctx =
  match Session_store.custom_entry_data ctx "taumel.childSession" with
  | Some data -> (
      match get_string data "kind" with
      | "agent" | "generic" | "finder" | "oracle" -> true
      | _ -> false)
  | None -> false
let reject_nested name =
  error_obj (name ^ " is unavailable inside a child agent")
let save_agent_state = Session_sync.save_agent_state
let commit_agent_state ctx next =
  let previous = !agent_state in
  agent_state := next;
  try
    save_agent_state ctx;
    Ok ()
  with error ->
    agent_state := previous;
    Error ("agent state persistence failed: " ^ Printexc.to_string error)
let js_string_array values = js_array (List.map js_string values)
let option_string = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_string value
let js_run_status status =
  js_string (Taumel.Agents.run_status_to_string status)
let js_kind kind = js_string (Taumel.Agents.agent_kind_to_string kind)
let js_tier = function
  | None -> Unsafe.inject Js.null
  | Some effort -> js_string (Taumel.Agents.effort_to_string effort)
let local_timestamp seconds =
  let value = Unix.localtime (float_of_int seconds) in
  let date =
    Unsafe.new_obj (Unsafe.get Unsafe.global "Date")
      [| js_number (float_of_int seconds *. 1000.) |]
  in
  let offset =
    match float_value (Unsafe.meth_call date "getTimezoneOffset" [||]) with
    | Some minutes -> -int_of_float (minutes *. 60.)
    | None -> 0
  in
  let sign = if offset < 0 then "-" else "+" in
  let absolute = abs offset in
  Printf.sprintf "%04d-%02d-%02dT%02d:%02d:%02d%s%02d:%02d"
    (value.Unix.tm_year + 1900) (value.Unix.tm_mon + 1) value.Unix.tm_mday
    value.Unix.tm_hour value.Unix.tm_min value.Unix.tm_sec sign
    (absolute / 3600) ((absolute mod 3600) / 60)
let js_timestamp seconds = js_string (local_timestamp seconds)
let recommendation_for status activity =
  match (status, activity) with
  | "running", ("starting" | "reasoning" | "using_tool") -> "wait"
  | "running", "orphaned" -> "interrupt_or_close"
  | ("completed" | "failed" | "cancelled" | "lost"), "inactive" -> "call_agent_wait"
  | "suspended", "inactive" -> "resume_or_close"
  | _ -> "wait"
let current_active_tools ctx =
  match optional_string_array ctx "activeTools" with
  | Some tools -> tools
  | None ->
      match optional_string_array (active_host_or_empty ()) "activeTools" with
      | Some tools -> tools
      | None -> []
let parent_model () =
  if state.provider = "" || state.model = "" then None
  else Some (state.provider ^ "/" ^ state.model)
let provider_of_model_id model =
  match String.index_opt model '/' with
  | Some index when index > 0 -> Some (String.sub model 0 index)
  | _ -> None
let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None ->
      let require = Unsafe.get Unsafe.global "require" in
      Unsafe.fun_call require [| js_string name |]
let pi_agent_dir = Agent_worktree_host.pi_agent_dir
let resolve_routing = Agent_routing_host.resolve_routing
let routing_diagnostics = Agent_routing_host.routing_diagnostics
let truncate_output ?owner_session_id ?agent_id ?run_id text =
  Agent_output.truncate ~agent_dir:(pi_agent_dir ()) ?owner_session_id ?agent_id
    ?run_id text
let permission_ceiling_for ~kind (parent : Taumel.Capability_profile.t) =
  let sandbox_preset =
    match kind with
    | Taumel.Agents.Finder | Taumel.Agents.Oracle ->
        Taumel.Capability_profile.Read_only
    | Taumel.Agents.Generic -> (
        match parent.sandbox_preset with
        | Taumel.Capability_profile.Danger_full_access ->
            Taumel.Capability_profile.Workspace_write
        | other -> other)
  in
  {
    parent with
    sandbox_preset;
    no_sandbox_allowed = false;
    model_id = parent.model_id;
    thinking_level = parent.thinking_level;
  }
let kind_of_tool = function
  | "agent_spawn" -> Ok Taumel.Agents.Generic
  | "finder" -> Ok Taumel.Agents.Finder
  | "oracle" -> Ok Taumel.Agents.Oracle
  | name -> Error ("unknown agent start tool: " ^ name)
let tier_of_params params =
  match optional_string_field params "tier" with
  | None -> Ok None
  | Some value -> (
      match Taumel.Agents.effort_of_string (String.trim value) with
      | Ok effort -> Ok (Some effort)
      | Error _ as error -> error)
let isolation_of_params params =
  match optional_string_field params "isolation" with
  | None -> Ok Taumel.Agent_workspace.default_isolation
  | Some value -> Taumel.Agent_workspace.isolation_of_string (String.trim value)
let identity_metadata = Agent_worktree_ops.identity_metadata
let tool_result text details =
  Boundary_contracts.BridgeToolResult.create ~text
    ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details)) ()
  |> Tool_contracts.BridgeToolResult.t_to_js |> inject
let json_text value = Taumel.Shared.encode_json value
let json_success fields = json_text (Taumel.Shared.Object fields)
let start_details ~(identity : Taumel.Agents.identity) ~(run : Taumel.Agents.agent_run)
    ~prompt =
  let fields =
    [
      ("ok", js_bool true);
      ("agent_id", js_string identity.identity_agent_id);
      ("run_id", js_string run.run_id);
      ("kind", js_kind identity.identity_kind);
      ("model", js_string identity.identity_model);
      ("thinking", js_string identity.identity_thinking);
      ("status", js_run_status run.run_status);
      ("prompt", js_string prompt);
      ("agentId", js_string identity.identity_agent_id);
      ("activeTools", js_string_array identity.identity_active_tools);
      ("workspace", js_string (Taumel.Agents.identity_source_workspace identity));
      ( "isolation",
        js_string
          (Taumel.Agent_workspace.isolation_to_string
             (Taumel.Agents.identity_isolation identity)) );
    ]
  in
  let fields =
    match identity.identity_effort with
    | None -> fields
    | Some effort ->
        fields @ [ ("tier", js_string (Taumel.Agents.effort_to_string effort)) ]
  in
  Unsafe.obj (Array.of_list fields)
let recover_owned_private_sessions ~owner_session_id =
  Taumel.Agents.owned_identities !agent_state ~owner_session_id
  |> List.iter (fun identity ->
         ignore
           (Agent_child_session_host.recover_uncommitted_envelope_for_identity
              ~identity))

let prepare_start name params ctx =
  if is_agent_child ctx then reject_nested name
  else
    with_gateway_authorized name (fun _ ->
        match kind_of_tool name with
        | Error message -> error_obj message
        | Ok _
          when Taumel.Agents.identity_count_for_owner !agent_state
                 ~owner_session_id:(owner_id ctx)
               >= Taumel.Agents.max_identities_per_owner ->
            error_obj "owner already has 64 agents"
        | Ok kind -> (
            let message_field =
              match kind with Taumel.Agents.Finder -> "query" | _ -> "message"
            in
            match
              ( Option.bind (optional_string_field params message_field)
                  Taumel.Shared.trim_non_empty,
                Option.bind (optional_string_field params "description")
                  Taumel.Shared.trim_non_empty,
                tier_of_params params,
                isolation_of_params params )
            with
            | None, _, _, _ -> error_obj (name ^ "." ^ message_field ^ " is required")
            | _, None, _, _ -> error_obj (name ^ ".description is required")
            | _, _, Error message, _ -> error_obj message
            | _, _, _, Error message -> error_obj message
            | Some message, Some description, Ok effort, Ok isolation -> (
                match
                  resolve_routing ~kind ?effort:
                    (match effort with Some value -> Some value | None -> None)
                    ()
                with
                | Error message -> error_obj message
                | Ok (model, thinking, effort) ->
                let effort =
                  match kind with
                  | Taumel.Agents.Generic ->
                      Some (Option.value effort ~default:Taumel.Agents.Medium)
                  | _ -> None
                in
                let active_tools =
                  current_active_tools ctx
                  |> Taumel.Tool_catalog.rewrite_active_tools
                       ?provider:(provider_of_model_id model)
                       ~agent_child:true
                in
                let ceiling =
                  permission_ceiling_for ~kind (active_profile ())
                in
                let now = now_seconds () in
                let network_allowed =
                  match !active_network_mode with
                  | Taumel.Sandbox.Network_enabled -> true
                  | Taumel.Sandbox.Network_disabled -> false
                in
                let owner = owner_id ctx in
                let workspace_binding =
                  match isolation with
                  | Taumel.Agent_workspace.None ->
                      Ok (Taumel.Agent_workspace.shared ~source_root:state.cwd)
                  | Taumel.Agent_workspace.Worktree -> (
                      match Agent_worktree_host.resolve_repository state.cwd with
                      | Error (_code, message) -> Error message
                      | Ok (_toplevel, main_repository_root, main_repository_id, _head)
                        ->
                          Ok
                            (Taumel.Agent_workspace.worktree
                               ~source_origin:state.cwd ~main_repository_root
                               ~main_repository_id))
                in
                match workspace_binding with
                | Error message -> error_obj message
                | Ok workspace_binding -> (
                match
                  Taumel.Agents.record_spawn !agent_state ~now
                    ~owner_session_id:owner ~kind ?effort ~model ~thinking
                    ~description ~active_tools ~permission_ceiling:ceiling
                    ~network_allowed ~workspace_binding ()
                with
                | Error message -> error_obj message
                | Ok
                    ( next,
                      (identity : Taumel.Agents.identity),
                      (run : Taumel.Agents.agent_run) ) ->
                    let rollback () =
                      match
                        Taumel.Agents.rollback_unaccepted_spawn next
                          ~owner_session_id:owner
                          ~agent_id:identity.identity_agent_id ~run_id:run.run_id
                          ~submission_id:run.run_submission_id
                      with
                      | Ok rolled -> agent_state := rolled
                      | Error _ -> ()
                    in
                    let identity_result =
                      match isolation with
                      | Taumel.Agent_workspace.None -> Ok (next, identity)
                      | Taumel.Agent_workspace.Worktree -> (
                          match
                            Agent_worktree_host.provision
                              ~owner_session_id:owner
                              ~agent_id:identity.identity_agent_id
                              ~source_workspace:state.cwd
                          with
                          | Error (_code, message) ->
                              Error ("workspace_unavailable: " ^ message)
                          | Ok (binding, _derived, _marker) ->
                              let identity =
                                {
                                  identity with
                                  identity_workspace_binding = binding;
                                }
                              in
                              let next =
                                {
                                  next with
                                  identities =
                                    Taumel.Agents.replace_identity identity
                                      next.identities;
                                }
                              in
                              Ok (next, identity))
                    in
                    match identity_result with
                    | Error message ->
                        rollback ();
                        error_obj message
                    | Ok (next, identity) -> (
                    match commit_agent_state ctx next with
                    | Error message -> error_obj message
                    | Ok () ->
                    let result_fields =
                      [
                        ("agent_id", Taumel.Shared.String identity.identity_agent_id);
                        ("run_id", Taumel.Shared.String run.run_id);
                        ( "kind",
                          Taumel.Shared.String
                            (Taumel.Agents.agent_kind_to_string identity.identity_kind) );
                        ("status", Taumel.Shared.String "running");
                      ]
                    in
                    let result_fields =
                      match identity.identity_effort with
                      | None -> result_fields
                      | Some value ->
                          result_fields
                          @ [ ("tier", Taumel.Shared.String (Taumel.Agents.effort_to_string value)) ]
                    in
                    let text = json_success result_fields in
                    let details =
                      start_details ~identity ~run ~prompt:message
                    in
                    let metadata =
                      json_to_js (identity_metadata ~identity ())
                    in
                    Boundary_contracts.PreparedAgentStart.create ~text
                      ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                      ~prompt:message ~agentId:identity.identity_agent_id
                      ~runId:run.run_id ~submissionId:run.run_submission_id
                      ~metadata:(Ts2ocaml.unknown_of_js (ojs_of_js metadata)) ()
                    |> Tool_contracts.PreparedAgentStart.t_to_js |> inject)))))
let prepare_send params ctx =
  if is_agent_child ctx then reject_nested "agent_send"
  else
    with_gateway_authorized "agent_send" (fun _ ->
        match
          Option.bind (optional_string_field params "agent_id")
            Taumel.Shared.trim_non_empty
        with
        | None -> error_obj "agent_send.agent_id is required"
        | Some agent_id when List.mem agent_id !agent_closing_ids ->
            error_obj ("agent is closing: " ^ agent_id)
        | Some agent_id ->
            let interrupt =
              if has_property params "interrupt" then get_bool params "interrupt"
              else false
            in
            let message =
              match optional_string_field params "message" with
              | None -> ""
              | Some value -> value
            in
            let description =
              match optional_string_field params "description" with
              | None -> ""
              | Some value -> String.trim value
            in
            let previous_run =
              Taumel.Agents.active_or_suspended_run !agent_state agent_id
            in
            let now = now_seconds () in
            match
              Taumel.Agents.record_send !agent_state ~now
                ~owner_session_id:(owner_id ctx) ~agent_id ~interrupt
                ~description message
            with
            | Error message -> error_obj message
            | Ok delivery ->
                (match commit_agent_state ctx delivery.delivery_state with
                | Error message -> error_obj message
                | Ok () ->
                (match Taumel.Agents.find_identity !agent_state agent_id with
                | Some identity ->
                    ignore
                      (Agent_child_session_host
                       .recover_uncommitted_envelope_for_identity ~identity)
                | None -> ());
                let outcome =
                  Taumel.Agents.send_outcome_to_string delivery.delivery_outcome
                in
                let details =
                  let fields =
                    [
                      ("agent_id", js_string agent_id);
                      ("outcome", js_string outcome);
                    ]
                  in
                  let fields =
                    match delivery.delivery_run_id with
                    | None -> fields
                    | Some run_id -> fields @ [ ("run_id", js_string run_id) ]
                  in
                  let fields =
                    match delivery.delivery_status with
                    | None -> fields
                    | Some status -> fields @ [ ("status", js_run_status status) ]
                  in
                  let fields =
                    match delivery.delivery_submission_id with
                    | None -> fields
                    | Some submission_id ->
                        fields @ [ ("submission_id", js_string submission_id) ]
                  in
                  Unsafe.obj (Array.of_list fields)
                in
                let dispatch =
                  match delivery.delivery_outcome with
                  | Taumel.Agents.Suspended_outcome
                  | Taumel.Agents.Already_suspended
                  | Taumel.Agents.No_active_run ->
                      false
                  | _ -> String.trim message <> ""
                in
                let deliver_as =
                  match delivery.delivery_outcome with
                  | Taumel.Agents.Message_sent -> "steer"
                  | _ -> "followUp"
                in
                let identity : Taumel.Agents.identity option =
                  Taumel.Agents.find_identity !agent_state agent_id
                in
                let metadata =
                  match identity with
                  | None -> Unsafe.inject Js.null
                  | Some identity ->
                      json_to_js
                        (match identity.identity_child_session_file with
                        | Some file ->
                            identity_metadata ~identity ~child_session_file:file
                              ()
                        | None -> identity_metadata ~identity ())
                in
                let result_fields =
                  [
                    ("agent_id", Taumel.Shared.String agent_id);
                    ("outcome", Taumel.Shared.String outcome);
                  ]
                in
                let result_fields =
                  match (delivery.delivery_run_id, delivery.delivery_status) with
                  | Some run_id, Some status ->
                      result_fields
                      @ [
                          ("run_id", Taumel.Shared.String run_id);
                          ("status", Taumel.Shared.String (Taumel.Agents.run_status_to_string status));
                        ]
                  | _ -> result_fields
                in
                let text = json_success result_fields in
                let previous_submission_id =
                  Option.map
                    (fun (run : Taumel.Agents.agent_run) -> run.run_submission_id)
                    previous_run
                in
                let previous_reason_code =
                  Option.bind previous_run
                    (fun (run : Taumel.Agents.agent_run) ->
                      Option.map Taumel.Agents.reason_code_to_string
                        run.run_reason_code)
                in
                Boundary_contracts.PreparedAgentSend.create ~text
                  ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                  ~prompt:message ~agentId:agent_id ~dispatch ~interrupt
                  ~dispatchDeliverAs:deliver_as ?runId:delivery.delivery_run_id
                  ?submissionId:delivery.delivery_submission_id
                  ?previousSubmissionId:previous_submission_id
                  ?previousReasonCode:previous_reason_code ~outcome
                  ~metadata:(Ts2ocaml.unknown_of_js (ojs_of_js metadata)) ()
                |> Tool_contracts.PreparedAgentSend.t_to_js |> inject))
let assistant_text_from_entry_json = function
  | Taumel.Shared.Object fields -> (
      match
        (List.assoc_opt "type" fields, List.assoc_opt "message" fields)
      with
      | Some (Taumel.Shared.String "message"),
        Some (Taumel.Shared.Object message_fields) -> (
          match List.assoc_opt "role" message_fields with
          | Some (Taumel.Shared.String "assistant") -> (
              match List.assoc_opt "content" message_fields with
              | Some (Taumel.Shared.String text) -> Some text
              | Some (Taumel.Shared.Array parts) ->
                  let texts =
                    List.filter_map
                      (function
                        | Taumel.Shared.Object part_fields -> (
                            match List.assoc_opt "text" part_fields with
                            | Some (Taumel.Shared.String text) -> Some text
                            | _ -> None)
                        | _ -> None)
                      parts
                  in
                  Some (String.concat "\n" texts)
              | _ -> Some "")
          | _ -> None)
      | _ -> None)
  | _ -> None
let recover_output_from_file ~path ~entry_id =
  try
    let fs = node_require "fs" in
    let raw =
      Js.to_string
        (Unsafe.meth_call fs "readFileSync"
           [| js_string path; js_string "utf8" |])
    in
    raw |> String.split_on_char '\n'
    |> List.find_map (fun line ->
           match Taumel.Shared.decode_json_string line with
           | Ok (Taumel.Shared.Object fields as json) -> (
               match List.assoc_opt "id" fields with
               | Some (Taumel.Shared.String value) when value = entry_id ->
                   assistant_text_from_entry_json json
               | _ -> None)
           | _ -> None)
  with _ -> None
let recover_selected_outputs state run_ids =
  List.fold_left
    (fun state run_id ->
      match Taumel.Agents.find_run state run_id with
      | Some run
        when Taumel.Agents.terminal_run_status run.run_status
             && run.run_output_available
             && run.run_final_output = None
             && run.run_partial_output = None ->
          let output =
            match
              ( Taumel.Agents.find_identity state run.run_agent_id,
                run.run_result_entry_id )
            with
            | Some identity, Some entry_id -> (
                match identity.identity_child_session_file with
                | Some path -> recover_output_from_file ~path ~entry_id
                | None -> None)
            | _ -> None
          in
          (match Taumel.Agents.record_recovered_output state ~run_id output with
          | Ok next -> next
          | Error _ -> state)
      | _ -> state)
    state run_ids
let prepare_wait params ctx =
  if is_agent_child ctx then reject_nested "agent_wait"
  else
    with_gateway_authorized "agent_wait" (fun _ ->
        let run_ids =
          match optional_string_array params "run_ids" with
          | None -> []
          | Some values -> values
        in
        let timeout_seconds =
          match float_field params "timeout_seconds" with
          | None -> None
          | Some value when value < 0. -> None
          | Some value -> Some value
        in
        let reconciled = Session_sync.reconcile_settled_runs !agent_state in
        if reconciled != !agent_state then (
          match commit_agent_state ctx reconciled with
          | Ok () -> ()
          | Error message -> failwith message);
        agent_state := recover_selected_outputs !agent_state run_ids;
        match
          Taumel.Agent_wait.wait_for_run_ids !agent_state ~owner_session_id:(owner_id ctx)
            run_ids
        with
        | Error message -> error_obj message
        | Ok wait when wait.wait_items <> [] || timeout_seconds = Some 0. ->
            (match commit_agent_state ctx wait.wait_state with
            | Error message -> error_obj message
            | Ok () ->
            let nullable_string = function
              | None -> Taumel.Shared.Null
              | Some value -> Taumel.Shared.String value
            in
            let result_json (item : Taumel.Agents.wait_item) =
              let common =
                [
                  ("agent_id", Taumel.Shared.String item.wait_agent_id);
                  ("run_id", Taumel.Shared.String item.wait_run_id);
                  ("kind", Taumel.Shared.String (Taumel.Agents.agent_kind_to_string item.wait_kind));
                  ("status", Taumel.Shared.String (Taumel.Agents.run_status_to_string item.wait_status));
                  ("started_at", Taumel.Shared.String (local_timestamp item.wait_started_at));
                ]
              in
              let output_field name value =
                match value with
                | None -> ([ (name, Taumel.Shared.Null) ], None)
                | Some output ->
                    let text, truncated, path =
                      truncate_output ~owner_session_id:(owner_id ctx)
                        ~agent_id:item.wait_agent_id ~run_id:item.wait_run_id output
                    in
                    let truncation =
                      match (truncated, path) with
                      | true, Some full_output_path ->
                          Some
                            ( "truncation",
                              Taumel.Shared.Object
                                [
                                  ("original_bytes", Taumel.Shared.Number (float_of_int (String.length output)));
                                  ("returned_bytes", Taumel.Shared.Number (float_of_int (String.length text)));
                                  ("full_output_path", Taumel.Shared.String full_output_path);
                                ] )
                      | _ -> None
                    in
                    ([ (name, Taumel.Shared.String text) ], truncation)
              in
              let fields =
                match item.wait_status with
                | Taumel.Agents.Completed ->
                    let output, truncation = output_field "output" item.wait_output in
                    common
                    @ [ ("ended_at", Taumel.Shared.String (local_timestamp (Option.value item.wait_ended_at ~default:item.wait_started_at))) ]
                    @ output @ Option.to_list truncation
                | Taumel.Agents.Failed | Taumel.Agents.Cancelled | Taumel.Agents.Lost ->
                    let output, truncation = output_field "partial_output" item.wait_partial_output in
                    common
                    @ [
                        ("ended_at", Taumel.Shared.String (local_timestamp (Option.value item.wait_ended_at ~default:item.wait_started_at)));
                        ("reason", nullable_string (Option.map Taumel.Agents.reason_code_to_string item.wait_reason_code));
                        ("error", nullable_string item.wait_error);
                      ]
                    @ output @ Option.to_list truncation
                | Taumel.Agents.Suspended ->
                    common
                    @ [
                        ("suspended_at", Taumel.Shared.String (local_timestamp (Option.value item.wait_suspended_at ~default:item.wait_started_at)));
                        ("reason", nullable_string (Option.map Taumel.Agents.reason_code_to_string item.wait_reason_code));
                      ]
                | Taumel.Agents.Running -> common
              in
              Taumel.Shared.Object fields
            in
            let result_values = List.map result_json wait.wait_items in
            let payload =
              Taumel.Shared.Object
                [
                  ("timed_out", Taumel.Shared.Bool wait.wait_timed_out);
                  ("results", Taumel.Shared.Array result_values);
                  ("pending_run_ids", Taumel.Shared.Array (List.map (fun value -> Taumel.Shared.String value) wait.wait_pending_run_ids));
                ]
            in
            let results =
              List.map2
                (fun (item : Taumel.Agents.wait_item) value ->
                  let result = json_to_js value in
                  Unsafe.set result "model" (js_string item.wait_model);
                  Unsafe.set result "thinking" (js_string item.wait_thinking);
                  result)
                wait.wait_items result_values
            in
            let pending = wait.wait_pending_run_ids |> List.map js_string |> js_array in
            let text = Taumel.Shared.encode_json payload in
            let details =
              Unsafe.obj
                [|
                  ("timed_out", js_bool wait.wait_timed_out);
                  ("results", js_array (List.map inject results));
                  ("pending_run_ids", pending);
                |]
            in
            tool_result text details)
        | Ok wait ->
            let details =
              Unsafe.obj
                [|
                  ("ok", js_bool true);
                  ("timed_out", js_bool false);
                  ("results", js_array []);
                  ( "pending_run_ids",
                    js_array (List.map js_string wait.wait_pending_run_ids) );
                  ( "timeout_seconds",
                    match timeout_seconds with
                    | None -> Unsafe.inject Js.null
                    | Some value -> js_number value );
                |]
            in
            Boundary_contracts.PreparedAgentWait.create
              ~text:"Waiting for agent runs."
              ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
              ~runIds:wait.wait_pending_run_ids ?timeoutSeconds:timeout_seconds ()
            |> Tool_contracts.PreparedAgentWait.t_to_js |> inject)
let prepare_list ctx =
  if is_agent_child ctx then reject_nested "agent_list"
  else
    with_gateway_authorized "agent_list" (fun _ ->
        let reconciled = Session_sync.reconcile_settled_runs !agent_state in
        if reconciled != !agent_state then (
          match commit_agent_state ctx reconciled with
          | Ok () -> ()
          | Error message -> failwith message);
        let json_agent (identity : Taumel.Agents.identity) latest =
          let fields =
            [
              ("agent_id", Taumel.Shared.String identity.identity_agent_id);
              ("created_at", Taumel.Shared.String (local_timestamp identity.identity_created_at));
              ("kind", Taumel.Shared.String (Taumel.Agents.agent_kind_to_string identity.identity_kind));
              ( "workspace",
                Taumel.Shared.String
                  (Taumel.Agents.identity_source_workspace identity) );
              ( "isolation",
                Taumel.Shared.String
                  (Taumel.Agent_workspace.isolation_to_string
                     (Taumel.Agents.identity_isolation identity)) );
            ]
          in
          let fields =
            match identity.identity_effort with
            | None -> fields
            | Some value -> fields @ [ ("tier", Taumel.Shared.String (Taumel.Agents.effort_to_string value)) ]
          in
          match latest with
          | None -> Taumel.Shared.Object fields
          | Some (run : Taumel.Agents.agent_run) ->
              let activity = Taumel.Agents.activity_state_to_string run.run_activity_state in
              let activity_fields =
                [
                  ("state", Taumel.Shared.String activity);
                  ( "last_at",
                    match run.run_last_activity_at with
                    | None -> Taumel.Shared.Null
                    | Some value -> Taumel.Shared.String (local_timestamp value) );
                  ( "recommendation",
                    Taumel.Shared.String
                      (recommendation_for
                         (Taumel.Agents.run_status_to_string run.run_status) activity) );
                ]
              in
              Taumel.Shared.Object
                (fields
                @ [
                    ("run_id", Taumel.Shared.String run.run_id);
                    ("started_at", Taumel.Shared.String (local_timestamp run.run_started_at));
                    ("status", Taumel.Shared.String (Taumel.Agents.run_status_to_string run.run_status));
                    ("turn_count", Taumel.Shared.Number (float_of_int run.run_turn_count));
                    ("activity", Taumel.Shared.Object activity_fields);
                  ])
        in
        let json_agents =
          Taumel.Agent_registry.list_for_owner !agent_state ~owner_session_id:(owner_id ctx)
          |> List.map (fun (identity, latest) -> json_agent identity latest)
        in
        let agents =
          Taumel.Agent_registry.list_for_owner !agent_state ~owner_session_id:(owner_id ctx)
          |> List.map
               (fun
                 ( (identity : Taumel.Agents.identity),
                   (latest : Taumel.Agents.agent_run option) ) ->
                 let fields =
                   [
                     ("agent_id", js_string identity.identity_agent_id);
                     ("created_at", js_timestamp identity.identity_created_at);
                     ("kind", js_kind identity.identity_kind);
                     ("model", js_string identity.identity_model);
                     ("thinking", js_string identity.identity_thinking);
                     ( "workspace",
                       js_string
                         (Taumel.Agents.identity_source_workspace identity) );
                     ( "isolation",
                       js_string
                         (Taumel.Agent_workspace.isolation_to_string
                            (Taumel.Agents.identity_isolation identity)) );
                   ]
                 in
                 let fields =
                   match identity.identity_effort with
                   | None -> fields
                   | Some effort ->
                       fields
                       @ [
                           ( "tier",
                             js_string (Taumel.Agents.effort_to_string effort) );
                         ]
                 in
                 let fields =
                   match latest with
                   | None -> fields
                   | Some run ->
                       let activity = Taumel.Agents.activity_state_to_string run.run_activity_state in
                       let activity_fields =
                         [
                           ("state", js_string activity);
                           ( "last_at",
                             Option.fold ~none:(Unsafe.inject Js.null) ~some:js_timestamp
                               run.run_last_activity_at );
                           ( "recommendation",
                             js_string
                               (recommendation_for
                                  (Taumel.Agents.run_status_to_string run.run_status)
                                  activity) );
                         ]
                       in
                       fields
                       @ [
                           ("run_id", js_string run.run_id);
                           ("started_at", js_timestamp run.run_started_at);
                           ("status", js_run_status run.run_status);
                           ("turn_count", js_number (float_of_int run.run_turn_count));
                           ("activity", Unsafe.obj (Array.of_list activity_fields));
                         ]
                 in
                 Unsafe.obj (Array.of_list fields))
        in
        let text = Taumel.Shared.encode_json (Taumel.Shared.Array json_agents)
        in
        tool_result text
          (Unsafe.obj
             [|
               ("ok", js_bool true);
               ("agents", js_array (List.map inject agents));
             |]))
let prepare_close = Agent_close.prepare_close
let finish_close = Agent_close.finish_close
let release_close = Agent_close.release_close
let delete_child_session = Agent_close.delete_child_session
let record_close_cleanup_failure = Agent_close.record_close_cleanup_failure

let accept_worktree_start = Agent_worktree_ops.accept_worktree_start
let rollback_worktree_start = Agent_worktree_ops.rollback_worktree_start
let delete_worktree = Agent_worktree_ops.delete_worktree
let reconcile_provisional_worktrees = Agent_worktree_ops.reconcile_provisional_worktrees

let prepare name params ctx =
  Session_sync.require_agent_owner ctx;
  match !agent_state_load_error with
  | Some message ->
      error_obj ("agent state is unavailable: " ^ message)
  | None -> (
      match name with
      | "agent_spawn" | "finder" | "oracle" ->
          prepare_start name params ctx
      | "agent_send" -> prepare_send params ctx
      | "agent_wait" -> prepare_wait params ctx
      | "agent_list" -> prepare_list ctx
      | "agent_close" -> prepare_close params ctx
      | other -> error_obj ("unknown agent tool: " ^ other))
