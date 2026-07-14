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

let save_agent_state ctx =
  Session_store.append_custom_entry ctx "taumel.agents.v3"
    (Taumel.Agents_codec.encode !agent_state)

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

let js_effort = function
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

let pi_agent_dir () =
  let home =
    try Js.to_string (Unsafe.meth_call (node_require "os") "homedir" [||])
    with _ -> ""
  in
  let process = Unsafe.get Unsafe.global "process" in
  let env = Unsafe.get process "env" in
  match string_value (Unsafe.get env "PI_CODING_AGENT_DIR") with
  | Some value when String.trim value <> "" ->
      let value = String.trim value in
      if String.length value >= 2 && String.sub value 0 2 = "~/" then
        home ^ String.sub value 1 (String.length value - 1)
      else value
  | _ -> home ^ "/.pi/agent"

let read_settings_json path =
  let fs = node_require "fs" in
  try
    if not (Js.to_bool (Unsafe.meth_call fs "existsSync" [| js_string path |])) then Ok None
    else
      let raw = Js.to_string (Unsafe.meth_call fs "readFileSync" [| js_string path; js_string "utf8" |]) in
      match Taumel.Shared.decode_json_string raw with
      | Ok json -> Ok (Some json)
      | Error message -> Error (path ^ ": " ^ message)
  with error -> Error (path ^ ": " ^ Printexc.to_string error)

let taumel_object_from_settings = function
  | Taumel.Shared.Object fields -> (
      match List.assoc_opt "taumel" fields with
      | Some value -> value
      | None -> Taumel.Shared.Object [])
  | _ -> Taumel.Shared.Object []

let load_routing_catalog () =
  let global_path = pi_agent_dir () ^ "/settings.json" in
  let project_path =
    if state.cwd = "" then "" else state.cwd ^ "/.pi/settings.json"
  in
  let from_path path =
    match read_settings_json path with
    | Ok None -> Taumel.Agent_routing.empty
    | Error message ->
        { Taumel.Agent_routing.empty with diagnostics = [ message ] }
    | Ok (Some root) -> (
        match Taumel.Agent_routing.of_taumel_json (taumel_object_from_settings root) with
        | Ok catalog -> catalog
        | Error message ->
            {
              Taumel.Agent_routing.empty with
              diagnostics = [ message ];
            })
  in
  let global = from_path global_path in
  let project = if project_path = "" then Taumel.Agent_routing.empty else from_path project_path in
  Taumel.Agent_routing.merge ~base:global ~override:project

let string_starts_with ~prefix value =
  let prefix_length = String.length prefix in
  String.length value >= prefix_length
  && String.sub value 0 prefix_length = prefix

let routing_key kind effort =
  match (kind, effort) with
  | Taumel.Agents.Generic, Some value ->
      "taumel.agents.generic." ^ Taumel.Agents.effort_to_string value
  | Taumel.Agents.Generic, None -> "taumel.agents.generic.medium"
  | Taumel.Agents.Finder, _ -> "taumel.agents.finder"
  | Taumel.Agents.Oracle, _ -> "taumel.agents.oracle"

let resolve_routing ~kind ?effort () =
  let parent = parent_model () in
  let catalog = load_routing_catalog () in
  let key = routing_key kind effort in
  let relevant_diagnostic =
    List.find_opt
      (fun message ->
        string_starts_with ~prefix:key message
        || string_starts_with ~prefix:"taumel.agents must" message
        || not (string_starts_with ~prefix:"taumel." message)
        ||
        match kind with
        | Taumel.Agents.Generic ->
            string_starts_with ~prefix:"taumel.agents.generic must" message
        | Taumel.Agents.Finder | Taumel.Agents.Oracle -> false)
      catalog.diagnostics
  in
  match relevant_diagnostic with
  | Some message -> Error message
  | None ->
      let default_model, default_thinking, effort =
        Taumel.Agent_routing.default_routing ~kind ~effort ~parent_model:parent
      in
      let entry = Taumel.Agent_routing.entry_for catalog ~kind ~effort in
      let model, thinking =
        match entry with
        | Some entry -> (entry.model, entry.thinking)
        | None -> (default_model, default_thinking)
      in
      let model =
        match model with
        | "inherit" -> Option.value parent ~default:state.model
        | value -> value
      in
      if model = "" then Error "resolved agent model is empty"
      else Ok (model, thinking, effort)

let routing_diagnostics () =
  let catalog = load_routing_catalog () in
  Tool_contracts.AgentRoutingDiagnosticsResult.create
    ~diagnostics:catalog.diagnostics ()
  |> Tool_contracts.AgentRoutingDiagnosticsResult.t_to_js |> inject

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

let effort_of_params params =
  match optional_string_field params "effort" with
  | None -> Ok None
  | Some value -> (
      match Taumel.Agents.effort_of_string (String.trim value) with
      | Ok effort -> Ok (Some effort)
      | Error _ as error -> error)

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
      ("workspace", js_string identity.identity_workspace);
    ]
  in
  let fields =
    match identity.identity_effort with
    | None -> fields
    | Some effort ->
        fields @ [ ("effort", js_string (Taumel.Agents.effort_to_string effort)) ]
  in
  Unsafe.obj (Array.of_list fields)

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
                effort_of_params params )
            with
            | None, _, _ -> error_obj (name ^ "." ^ message_field ^ " is required")
            | _, None, _ -> error_obj (name ^ ".description is required")
            | _, _, Error message -> error_obj message
            | Some message, Some description, Ok effort -> (
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
                match
                  Taumel.Agents.record_spawn !agent_state ~now
                    ~owner_session_id:(owner_id ctx) ~kind ?effort ~model
                    ~thinking ~description ~active_tools ~permission_ceiling:ceiling
                    ~network_allowed
                    ~workspace:state.cwd ()
                with
                | Error message -> error_obj message
                | Ok
                    ( next,
                      (identity : Taumel.Agents.identity),
                      (run : Taumel.Agents.agent_run) ) ->
                    (match commit_agent_state ctx next with
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
                          @ [ ("effort", Taumel.Shared.String (Taumel.Agents.effort_to_string value)) ]
                    in
                    let text = json_success result_fields in
                    let details =
                      start_details ~identity ~run ~prompt:message
                    in
                    let metadata =
                      json_to_js
                        (Taumel.Shared.Object
                               [
                                 ("kind", Taumel.Shared.String "agent");
                                 ( "agentKind",
                                   Taumel.Shared.String
                                     (Taumel.Agents.agent_kind_to_string
                                        identity.identity_kind) );
                                 ("agentId", Taumel.Shared.String identity.identity_agent_id);
                                 ("modelId", Taumel.Shared.String identity.identity_model);
                                 ( "thinkingLevel",
                                   Taumel.Shared.String identity.identity_thinking );
                                 ( "activeTools",
                                   Taumel.Shared.Array
                                     (List.map
                                        (fun value -> Taumel.Shared.String value)
                                        identity.identity_active_tools) );
                                 ( "capabilityProfile",
                                   Taumel.Capability_profile.to_json
                                     identity.identity_permission_ceiling );
                                 ( "networkMode",
                                   Taumel.Shared.String
                                     (if identity.identity_network_allowed then
                                        "enabled"
                                      else "disabled") );
                                 ("isolated_child", Taumel.Shared.Bool true);
                                 ("workspaceDirectory", Taumel.Shared.String identity.identity_workspace);
                               ])
                    in
                    Boundary_contracts.PreparedAgentStart.create ~text
                      ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                      ~prompt:message ~agentId:identity.identity_agent_id
                      ~runId:run.run_id ~submissionId:run.run_submission_id
                      ~metadata:(Ts2ocaml.unknown_of_js (ojs_of_js metadata)) ()
                    |> Tool_contracts.PreparedAgentStart.t_to_js |> inject))))

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
            let interrupt = get_bool params "interrupt" in
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
                        (Taumel.Shared.Object
                           [
                             ("kind", Taumel.Shared.String "agent");
                             ( "agentKind",
                               Taumel.Shared.String
                                 (Taumel.Agents.agent_kind_to_string
                                    identity.identity_kind) );
                             ("agentId", Taumel.Shared.String identity.identity_agent_id);
                             ("modelId", Taumel.Shared.String identity.identity_model);
                             ( "thinkingLevel",
                               Taumel.Shared.String identity.identity_thinking );
                             ( "activeTools",
                               Taumel.Shared.Array
                                 (List.map
                                    (fun value -> Taumel.Shared.String value)
                                    identity.identity_active_tools) );
                             ( "capabilityProfile",
                               Taumel.Capability_profile.to_json
                                 identity.identity_permission_ceiling );
                             ( "networkMode",
                               Taumel.Shared.String
                                 (if identity.identity_network_allowed then
                                    "enabled"
                                  else "disabled") );
                             ("isolated_child", Taumel.Shared.Bool true);
                             ( "workspaceDirectory",
                               Taumel.Shared.String identity.identity_workspace );
                             ( "childSessionFile",
                               match identity.identity_child_session_file with
                               | None -> Taumel.Shared.Null
                               | Some value -> Taumel.Shared.String value );
                           ])
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
            (* Still waiting: return a prepared pending wait action for TS. *)
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
              ("workspace", Taumel.Shared.String identity.identity_workspace);
            ]
          in
          let fields =
            match identity.identity_effort with
            | None -> fields
            | Some value -> fields @ [ ("effort", Taumel.Shared.String (Taumel.Agents.effort_to_string value)) ]
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
                     ("workspace", js_string identity.identity_workspace);
                   ]
                 in
                 let fields =
                   match identity.identity_effort with
                   | None -> fields
                   | Some effort ->
                       fields
                       @ [
                           ( "effort",
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

let prepare_close params ctx =
  if is_agent_child ctx then reject_nested "agent_close"
  else
    with_gateway_authorized "agent_close" (fun _ ->
        match
          Option.bind (optional_string_field params "agent_id")
            Taumel.Shared.trim_non_empty
        with
        | None -> error_obj "agent_close.agent_id is required"
        | Some agent_id -> (
            match
              Taumel.Agents.owned_identity !agent_state
                ~owner_session_id:(owner_id ctx) agent_id
            with
            | Error message -> error_obj message
            | Ok (identity : Taumel.Agents.identity) ->
                agent_closing_ids :=
                  if List.mem agent_id !agent_closing_ids then !agent_closing_ids
                  else agent_id :: !agent_closing_ids;
                let details =
                  Unsafe.obj
                    [|
                      ("agent_id", js_string agent_id);
                      ("status", js_string "closed");
                    |]
                in
                let run_ids =
                  Taumel.Agents.runs_for_agent !agent_state agent_id
                  |> List.map (fun (run : Taumel.Agents.agent_run) -> run.run_id)
                in
                Boundary_contracts.PreparedAgentClose.create
                  ~text:
                    (json_success
                       [
                         ("agent_id", Taumel.Shared.String agent_id);
                         ("status", Taumel.Shared.String "closed");
                       ])
                  ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                  ~agentId:agent_id ~runIds:run_ids
                  ?childSessionFile:identity.identity_child_session_file ()
                |> Tool_contracts.PreparedAgentClose.t_to_js |> inject))

let finish_close facts ctx =
  Session_sync.sync_persisted_session ctx;
  let agent_id = get_string facts "agent_id" in
  match
    Taumel.Agent_registry.record_close !agent_state ~owner_session_id:(owner_id ctx)
      ~agent_id
  with
  | Error message -> error_obj message
  | Ok (next, _) ->
      let previous = !agent_state in
      agent_closing_ids :=
        List.filter (fun value -> value <> agent_id) !agent_closing_ids;
      agent_notification_claims :=
        List.filter
          (fun run_id ->
            match Taumel.Agents.find_run !agent_state run_id with
            | Some run -> run.run_agent_id <> agent_id
            | None -> false)
          !agent_notification_claims;
      agent_state := next;
      (try
         save_agent_state ctx;
         core_ack ()
       with error ->
         agent_state := previous;
         error_obj ("agent state persistence failed: " ^ Printexc.to_string error))

let release_close facts =
  let agent_id = get_string facts "agent_id" in
  agent_closing_ids :=
    List.filter (fun value -> value <> agent_id) !agent_closing_ids;
  core_ack ()

let prepare name params ctx =
  match !agent_state_load_error with
  | Some message ->
      error_obj ("agent state is unavailable: " ^ message)
  | None -> (
      match name with
      | "agent_spawn" | "finder" | "oracle" -> prepare_start name params ctx
      | "agent_send" -> prepare_send params ctx
      | "agent_wait" -> prepare_wait params ctx
      | "agent_list" -> prepare_list ctx
      | "agent_close" -> prepare_close params ctx
      | other -> error_obj ("unknown agent tool: " ^ other))
