let active_profile ~filesystem_mode (profile : Capability_profile.t) =
  let sandbox_preset =
    match Capability_profile.sandbox_of_string filesystem_mode with
    | Some preset -> preset
    | None -> Capability_profile.Workspace_write
  in
  Capability_profile.resolve ~sandbox_preset profile

let workspace_roots_of_cwd cwd = if cwd = "" then [] else [ cwd ]

let fallback_sandbox ~workspace_roots ~isolated_child =
  Sandbox.fail_closed_config ~workspace_roots ~isolated_child

let active_sandbox ~cwd ~network_mode ~no_sandbox ~isolated_child
    (profile : Capability_profile.t) =
  let workspace_roots = workspace_roots_of_cwd cwd in
  match
    Sandbox.config_of_profile ~workspace_roots ~network_mode ~no_sandbox ~isolated_child
      profile
  with
  | Ok config -> config
  | Error _ -> fallback_sandbox ~workspace_roots ~isolated_child

let gateway_registry =
  List.fold_left
    (fun registry spec -> Tool_gateway.register spec registry)
    Tool_gateway.empty Tool_catalog.tool_specs

let authorize_tool ~authorize_effect ~profile name =
  let context = { Tool_gateway.profile; authorize_effect } in
  Tool_gateway.authorize gateway_registry context ~name

let gateway_authorized ~profile ~sandbox name =
  authorize_tool ~profile ~authorize_effect:(Sandbox.authorize_effect sandbox) name
  |> Result.map (fun _ -> sandbox)

let gateway_profile_authorized ~profile ~sandbox name =
  authorize_tool ~profile ~authorize_effect:(fun _ -> Ok ()) name
  |> Result.map (fun _ -> sandbox)

let gateway_error_message = function
  | Tool_gateway.Unknown_tool name -> "unknown tool: " ^ name
  | Denied_tool name -> "tool denied by capability profile: " ^ name
  | Denied_effect (_, message) -> message

let authorize_ralph_start ~profile ~sandbox =
  ignore profile;
  ignore sandbox;
  Ok ()
