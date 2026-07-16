open Jsoo_bridge
open App_state

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None ->
      let require = Unsafe.get Unsafe.global "require" in
      Unsafe.fun_call require [| js_string name |]

let pi_agent_dir = Agent_worktree_host.pi_agent_dir

let read_settings_json path =
  let fs = node_require "fs" in
  try
    if not (Js.to_bool (Unsafe.meth_call fs "existsSync" [| js_string path |])) then Ok None
    else
      let raw =
        Js.to_string
          (Unsafe.meth_call fs "readFileSync" [| js_string path; js_string "utf8" |])
      in
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
        match
          Taumel.Agent_routing.of_taumel_json (taumel_object_from_settings root)
        with
        | Ok catalog -> catalog
        | Error message ->
            { Taumel.Agent_routing.empty with diagnostics = [ message ] })
  in
  let global = from_path global_path in
  let project =
    if project_path = "" then Taumel.Agent_routing.empty
    else from_path project_path
  in
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

let parent_model () =
  if state.provider = "" || state.model = "" then None
  else Some (state.provider ^ "/" ^ state.model)

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
