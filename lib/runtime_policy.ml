let active_profile ~filesystem_mode (profile : Capability_profile.t) =
  let sandbox_preset =
    match Capability_profile.sandbox_of_string filesystem_mode with
    | Some preset -> preset
    | None -> Capability_profile.Workspace_write
  in
  { profile with sandbox_preset }

let workspace_roots_of_cwd cwd = if cwd = "" then [] else [ cwd ]

let fallback_sandbox ~workspace_roots ~subagent =
  {
    Sandbox.filesystem_mode = Sandbox.Workspace_write;
    workspace_roots;
    network_mode = Sandbox.Network_disabled;
    approval_policy = Sandbox.On_request;
    no_sandbox = false;
    subagent;
  }

let active_sandbox ~cwd ~network_mode ~no_sandbox ~subagent
    (profile : Capability_profile.t) =
  let workspace_roots = workspace_roots_of_cwd cwd in
  match
    Sandbox.config_of_profile ~workspace_roots ~network_mode ~no_sandbox ~subagent
      profile
  with
  | Ok config -> config
  | Error _ -> fallback_sandbox ~workspace_roots ~subagent

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
  match gateway_authorized ~profile ~sandbox "agent" with
  | Error error -> Error (gateway_error_message error)
  | Ok _ ->
      if Capability_profile.allow_agent profile "ralph" then Ok ()
      else Error "agent denied by capability profile: ralph"
