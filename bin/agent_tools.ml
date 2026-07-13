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
  Session_store.append_custom_entry ctx "taumel.agents.v2"
    (Taumel.Agents_codec.encode !agent_state)

let js_string_array values = js_array (List.map js_string values)

let option_string = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_string value

let option_number = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_number (float_of_int value)

let js_run_status status =
  js_string (Taumel.Agents.run_status_to_string status)

let js_kind kind = js_string (Taumel.Agents.agent_kind_to_string kind)

let js_effort = function
  | None -> Unsafe.inject Js.null
  | Some effort -> js_string (Taumel.Agents.effort_to_string effort)

let js_reason = function
  | None -> Unsafe.inject Js.null
  | Some reason -> js_string (Taumel.Agents.reason_code_to_string reason)

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

let max_output_lines = 2000
let max_output_bytes = 50 * 1024

let owner_storage_token value =
  let crypto = node_require "crypto" in
  let hash =
    Unsafe.fun_call (Unsafe.get crypto "createHash") [| js_string "sha256" |]
  in
  ignore (Unsafe.meth_call hash "update" [| js_string value |]);
  Js.to_string (Unsafe.meth_call hash "digest" [| js_string "hex" |])

let truncate_output ?owner_session_id ?agent_id ?run_id text =
  let lines = String.split_on_char '\n' text in
  let line_count = List.length lines in
  let byte_count = String.length text in
  if line_count <= max_output_lines && byte_count <= max_output_bytes then
    (text, false, None)
  else
    let rec take acc n = function
      | [] -> List.rev acc
      | _ when n <= 0 -> List.rev acc
      | line :: rest -> take (line :: acc) (n - 1) rest
    in
    let kept_lines = take [] max_output_lines lines in
    let candidate = String.concat "\n" kept_lines in
    let clipped =
      if String.length candidate <= max_output_bytes then candidate
      else String.sub candidate 0 max_output_bytes
    in
    let path =
      try
        let fs = node_require "fs" in
        let path_mod = node_require "path" in
        let directory =
          Js.to_string
            (Unsafe.meth_call path_mod "join"
               [|
                 js_string (pi_agent_dir ());
                 js_string "taumel";
                 js_string "agents";
                 js_string "owners";
                 js_string
                   (Option.fold ~none:"unowned" ~some:owner_storage_token
                      owner_session_id);
                 js_string (Option.value agent_id ~default:"unowned");
                 js_string "outputs";
               |])
        in
        ignore
          (Unsafe.meth_call fs "mkdirSync"
             [|
               js_string directory;
               inject (Unsafe.obj [| ("recursive", js_bool true) |]);
             |]);
        let tmp =
          Js.to_string
            (Unsafe.meth_call path_mod "join"
               [|
                 js_string directory;
                 js_string
                   (Option.value run_id
                      ~default:(string_of_int (now_milliseconds ()))
                  ^ ".txt");
               |])
        in
        ignore
          (Unsafe.meth_call fs "writeFileSync"
             [| js_string tmp; js_string text; js_string "utf8" |]);
        Some tmp
      with _ -> None
    in
    let notice =
      match path with
      | Some path ->
          "\n\n[Output truncated. Full output: " ^ path ^ "]"
      | None -> "\n\n[Output truncated.]"
    in
    (clipped ^ notice, true, path)

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
        | Ok kind -> (
            match
              ( Option.bind (optional_string_field params "message")
                  Taumel.Shared.trim_non_empty,
                effort_of_params params )
            with
            | None, _ -> error_obj (name ^ ".message is required")
            | _, Error message -> error_obj message
            | Some message, Ok effort -> (
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
                    ~thinking ~active_tools ~permission_ceiling:ceiling
                    ~network_allowed
                    ~workspace:state.cwd ()
                with
                | Error message -> error_obj message
                | Ok
                    ( next,
                      (identity : Taumel.Agents.identity),
                      (run : Taumel.Agents.agent_run) ) ->
                    agent_state := next;
                    save_agent_state ctx;
                    let text =
                      Printf.sprintf
                        "agent_id=%s\nrun_id=%s\nkind=%s\nmodel=%s\nthinking=%s\nstatus=running%s"
                        identity.identity_agent_id run.run_id
                        (Taumel.Agents.agent_kind_to_string identity.identity_kind)
                        identity.identity_model identity.identity_thinking
                        (match identity.identity_effort with
                        | None -> ""
                        | Some effort ->
                            "\neffort=" ^ Taumel.Agents.effort_to_string effort)
                    in
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
                    |> Tool_contracts.PreparedAgentStart.t_to_js |> inject)))

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
            let previous_run =
              Taumel.Agents.active_or_suspended_run !agent_state agent_id
            in
            let now = now_seconds () in
            match
              Taumel.Agents.record_send !agent_state ~now
                ~owner_session_id:(owner_id ctx) ~agent_id ~interrupt message
            with
            | Error message -> error_obj message
            | Ok delivery ->
                agent_state := delivery.delivery_state;
                save_agent_state ctx;
                let outcome =
                  Taumel.Agents.send_outcome_to_string delivery.delivery_outcome
                in
                let details =
                  let fields =
                    [
                      ("ok", js_bool true);
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
                let text =
                  "agent_id=" ^ agent_id ^ "\noutcome=" ^ outcome
                  ^
                  match delivery.delivery_run_id with
                  | None -> ""
                  | Some run_id ->
                      "\nrun_id=" ^ run_id
                      ^
                      match delivery.delivery_status with
                      | None -> ""
                      | Some status ->
                          "\nstatus=" ^ Taumel.Agents.run_status_to_string status
                in
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
                |> Tool_contracts.PreparedAgentSend.t_to_js |> inject)

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
        agent_state := recover_selected_outputs !agent_state run_ids;
        match
          Taumel.Agent_wait.wait_for_run_ids !agent_state ~owner_session_id:(owner_id ctx)
            run_ids
        with
        | Error message -> error_obj message
        | Ok wait when wait.wait_items <> [] || timeout_seconds = Some 0. ->
            agent_state := wait.wait_state;
            save_agent_state ctx;
            let results =
              wait.wait_items
              |> List.map (fun (item : Taumel.Agents.wait_item) ->
                     let fields =
                       [
                         ("agent_id", js_string item.wait_agent_id);
                         ("run_id", js_string item.wait_run_id);
                         ("kind", js_kind item.wait_kind);
                         ("model", js_string item.wait_model);
                         ("thinking", js_string item.wait_thinking);
                         ("status", js_run_status item.wait_status);
                         ("output_available", js_bool item.wait_output_available);
                         ("started_at", js_number (float_of_int item.wait_started_at));
                         ("ended_at", option_number item.wait_ended_at);
                         ("reason_code", js_reason item.wait_reason_code);
                         ("error", option_string item.wait_error);
                       ]
                     in
                     let fields =
                       match item.wait_output with
                       | None -> fields
                       | Some output ->
                           let text, truncated, path =
                             truncate_output ~owner_session_id:(owner_id ctx)
                               ~agent_id:item.wait_agent_id
                               ~run_id:item.wait_run_id output
                           in
                           let fields = fields @ [ ("output", js_string text) ] in
                           let fields =
                             if truncated then
                               fields
                               @ [
                                   ("truncated", js_bool true);
                                   ("full_output_path", option_string path);
                                 ]
                             else fields
                           in
                           fields
                     in
                     let fields =
                       match item.wait_partial_output with
                       | None -> fields
                       | Some output ->
                           let text, truncated, path =
                             truncate_output ~owner_session_id:(owner_id ctx)
                               ~agent_id:item.wait_agent_id
                               ~run_id:item.wait_run_id output
                           in
                           let fields =
                             fields @ [ ("partial_output", js_string text) ]
                           in
                           if truncated then
                             fields
                             @ [
                                 ("truncated", js_bool true);
                                 ("full_output_path", option_string path);
                               ]
                           else fields
                     in
                     Unsafe.obj (Array.of_list fields))
            in
            let pending =
              wait.wait_pending_run_ids |> List.map js_string |> js_array
            in
            let result_text (item : Taumel.Agents.wait_item) =
              let base =
                Printf.sprintf
                  "agent_id=%s\nrun_id=%s\nkind=%s\nmodel=%s\nthinking=%s\nstatus=%s\nstarted_at=%d\noutput_available=%b"
                  item.wait_agent_id item.wait_run_id
                  (Taumel.Agents.agent_kind_to_string item.wait_kind)
                  item.wait_model item.wait_thinking
                  (Taumel.Agents.run_status_to_string item.wait_status)
                  item.wait_started_at item.wait_output_available
              in
              let base =
                match item.wait_ended_at with
                | None -> base
                | Some value -> base ^ "\nended_at=" ^ string_of_int value
              in
              let base =
                match item.wait_reason_code with
                | None -> base
                | Some value ->
                    base ^ "\nreason_code="
                    ^ Taumel.Agents.reason_code_to_string value
              in
              let base =
                match item.wait_error with
                | None -> base
                | Some value -> base ^ "\nerror=" ^ value
              in
              match (item.wait_output, item.wait_partial_output) with
              | Some output, _ ->
                  let output, _, _ =
                    truncate_output ~owner_session_id:(owner_id ctx)
                      ~agent_id:item.wait_agent_id
                      ~run_id:item.wait_run_id output
                  in
                  base ^ "\noutput:\n" ^ output
              | _, Some output ->
                  let output, _, _ =
                    truncate_output ~owner_session_id:(owner_id ctx)
                      ~agent_id:item.wait_agent_id
                      ~run_id:item.wait_run_id output
                  in
                  base ^ "\npartial_output:\n" ^ output
              | _ -> base
            in
            let text =
              if wait.wait_timed_out then
                "agent_wait timed out\npending_run_ids="
                ^ String.concat "," wait.wait_pending_run_ids
              else if wait.wait_items = [] then
                "agent_wait: no ready runs\npending_run_ids="
                ^ String.concat "," wait.wait_pending_run_ids
              else
                let results =
                  wait.wait_items |> List.map result_text
                  |> String.concat "\n\n---\n\n"
                in
                if wait.wait_pending_run_ids = [] then results
                else
                  results ^ "\n\npending_run_ids="
                  ^ String.concat "," wait.wait_pending_run_ids
            in
            let details =
              Unsafe.obj
                [|
                  ("ok", js_bool true);
                  ("timed_out", js_bool wait.wait_timed_out);
                  ("results", js_array (List.map inject results));
                  ("pending_run_ids", pending);
                |]
            in
            tool_result text details
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
        let agents =
          Taumel.Agents.list_for_owner !agent_state ~owner_session_id:(owner_id ctx)
          |> List.map
               (fun
                 ( (identity : Taumel.Agents.identity),
                   (latest : Taumel.Agents.agent_run option) ) ->
                 let fields =
                   [
                     ("agent_id", js_string identity.identity_agent_id);
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
                   | None ->
                       fields
                       @ [
                           ("latest_run_id", Unsafe.inject Js.null);
                           ("latest_run_status", Unsafe.inject Js.null);
                         ]
                   | Some run ->
                       fields
                       @ [
                           ("latest_run_id", js_string run.run_id);
                           ("latest_run_status", js_run_status run.run_status);
                         ]
                 in
                 Unsafe.obj (Array.of_list fields))
        in
        let text =
          if agents = [] then "No agents."
          else
            agents
            |> List.map (fun agent ->
                   let effort = get_string agent "effort" in
                   get_string agent "agent_id" ^ " kind="
                   ^ get_string agent "kind" ^ " model="
                   ^ get_string agent "model" ^ " thinking="
                   ^ get_string agent "thinking" ^ " workspace="
                   ^ get_string agent "workspace" ^ " latest_run_id="
                   ^ get_string agent "latest_run_id" ^ " latest_run_status="
                   ^ get_string agent "latest_run_status"
                   ^ if effort = "" then "" else " effort=" ^ effort)
            |> String.concat "\n"
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
                      ("ok", js_bool true);
                      ("agent_id", js_string agent_id);
                      ("status", js_string "closed");
                    |]
                in
                let run_ids =
                  Taumel.Agents.runs_for_agent !agent_state agent_id
                  |> List.map (fun (run : Taumel.Agents.agent_run) -> run.run_id)
                in
                Boundary_contracts.PreparedAgentClose.create
                  ~text:("Closed agent " ^ agent_id)
                  ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                  ~agentId:agent_id ~runIds:run_ids
                  ?childSessionFile:identity.identity_child_session_file ()
                |> Tool_contracts.PreparedAgentClose.t_to_js |> inject))

let finish_close facts ctx =
  Session_sync.sync_persisted_session ctx;
  let agent_id = get_string facts "agent_id" in
  match
    Taumel.Agents.record_close !agent_state ~owner_session_id:(owner_id ctx)
      ~agent_id
  with
  | Error message -> error_obj message
  | Ok (next, _) ->
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
      save_agent_state ctx;
      core_ack ()

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
