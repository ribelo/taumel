type state = {
  profile : Capability_profile.t;
  sandbox : Sandbox.config;
}

type update =
  | Set_sandbox of Capability_profile.sandbox_preset
  | Set_approval of Capability_profile.approval_policy
  | Set_network of Sandbox.network_mode
  | Set_no_sandbox of bool
  | Allow_tools of string list
  | Deny_all_tools

type menu_option = {
  label : string;
  value : string;
  description : string;
  selected : bool;
}

type prompt_plan =
  | Prompt_unavailable
  | Prompt_select of {
      title : string;
      labels : string list;
    }

let default_prompt_title = "Sandbox settings"
let network_prompt_title = "Network access"

let menu_selected_value options selected =
  match Shared.trim_non_empty selected with
  | None -> None
  | Some selected ->
      options
      |> List.find_opt (fun option ->
             option.label = selected || option.value = selected)
      |> Option.map (fun option -> option.value)

let prompt_selection_plan ~ui_available ~title options =
  if not ui_available then Prompt_unavailable
  else
    let labels =
      options |> List.map (fun option -> option.label)
      |> List.filter (fun label -> String.trim label <> "")
    in
    match labels with
    | [] -> Prompt_unavailable
    | labels ->
        let title =
          match Shared.trim_non_empty title with
          | Some value -> value
          | None -> default_prompt_title
        in
        Prompt_select { title; labels }

let create ?(workspace_roots = []) ?(network_mode = Sandbox.Network_disabled)
    ?(no_sandbox = false) ?(isolated_child = false) (profile : Capability_profile.t) =
  let network_mode =
    match profile.sandbox_preset with
    | Capability_profile.Danger_full_access -> Sandbox.Network_enabled
    | Capability_profile.Read_only | Capability_profile.Workspace_write -> network_mode
  in
  Sandbox.config_of_profile ~workspace_roots ~network_mode ~no_sandbox ~isolated_child
    profile
  |> Result.map (fun sandbox -> { profile; sandbox })

type persisted =
  | Missing
  | Invalid
  | Persisted of state

type active = {
  profile : Capability_profile.t;
  network_mode : Sandbox.network_mode;
  no_sandbox : bool;
  isolated_child : bool;
  filesystem_mode : string;
}

let network_for_active_profile (profile : Capability_profile.t) requested =
  match profile.Capability_profile.sandbox_preset with
  | Capability_profile.Danger_full_access -> Sandbox.Network_enabled
  | Capability_profile.Read_only | Capability_profile.Workspace_write -> requested

let network_mode_for_sandbox_preset = function
  | Capability_profile.Danger_full_access -> Sandbox.Network_enabled
  | Capability_profile.Read_only | Capability_profile.Workspace_write ->
      Sandbox.Network_disabled

let profile_for_sandbox_preset (profile : Capability_profile.t)
    (sandbox_preset : Capability_profile.sandbox_preset) =
  { profile with Capability_profile.sandbox_preset = sandbox_preset }

let active_state ~(profile : Capability_profile.t) ~network_mode ~no_sandbox
    ~isolated_child =
  let network_mode = network_for_active_profile profile network_mode in
  {
    profile;
    network_mode;
    no_sandbox;
    isolated_child;
    filesystem_mode =
      Capability_profile.sandbox_to_string profile.sandbox_preset;
  }

let default_active_state ~session_isolated_child =
  active_state
    ~profile:
      (profile_for_sandbox_preset Capability_profile.default
         Capability_profile.Danger_full_access)
    ~network_mode:Sandbox.Network_enabled ~no_sandbox:false
    ~isolated_child:session_isolated_child

let persisted_active_state ~session_isolated_child permissions =
  let isolated_child = session_isolated_child || permissions.sandbox.isolated_child in
  let profile =
    if isolated_child then { permissions.profile with no_sandbox_allowed = false }
    else permissions.profile
  in
  active_state ~profile ~network_mode:permissions.sandbox.network_mode
    ~no_sandbox:(if isolated_child then false else permissions.sandbox.no_sandbox)
    ~isolated_child

let apply_flag_overrides ~host_sandbox_preset ~host_network_mode
    ~host_no_sandbox active =
  let active =
    match host_sandbox_preset with
    | None -> active
    | Some sandbox_preset ->
        active_state
          ~profile:(profile_for_sandbox_preset active.profile sandbox_preset)
          ~network_mode:(network_mode_for_sandbox_preset sandbox_preset)
          ~no_sandbox:active.no_sandbox ~isolated_child:active.isolated_child
  in
  let active =
    match host_network_mode with
    | None -> active
    | Some network_mode ->
        active_state ~profile:active.profile ~network_mode
          ~no_sandbox:active.no_sandbox ~isolated_child:active.isolated_child
  in
  match host_no_sandbox with
  | None -> active
  | Some requested ->
      let no_sandbox = (not active.isolated_child) && requested in
      active_state
        ~profile:{ active.profile with no_sandbox_allowed = no_sandbox }
        ~network_mode:active.network_mode ~no_sandbox ~isolated_child:active.isolated_child

let resolve_active ~host_sandbox_preset ~host_network_mode ~host_no_sandbox
    ~session_isolated_child persisted =
  let active =
    match persisted with
    | Missing -> default_active_state ~session_isolated_child
    | Invalid ->
        active_state ~profile:Capability_profile.default
          ~network_mode:Sandbox.Network_disabled ~no_sandbox:false
          ~isolated_child:session_isolated_child
    | Persisted permissions ->
        persisted_active_state ~session_isolated_child permissions
  in
  apply_flag_overrides ~host_sandbox_preset ~host_network_mode ~host_no_sandbox
    active

let rebuild_sandbox (state : state) =
  let network_mode =
    match state.profile.sandbox_preset with
    | Capability_profile.Danger_full_access -> Sandbox.Network_enabled
    | Capability_profile.Read_only | Capability_profile.Workspace_write ->
        state.sandbox.network_mode
  in
  Sandbox.config_of_profile ~workspace_roots:state.sandbox.workspace_roots
    ~network_mode ~no_sandbox:state.sandbox.no_sandbox
    ~isolated_child:state.sandbox.isolated_child state.profile
  |> Result.map (fun sandbox -> { state with sandbox })

let apply_update (state : state) = function
  | Set_sandbox sandbox_preset ->
      {
        profile = profile_for_sandbox_preset state.profile sandbox_preset;
        sandbox =
          {
            state.sandbox with
            network_mode = network_mode_for_sandbox_preset sandbox_preset;
          };
      }
      |> rebuild_sandbox
  | Set_approval approval_policy ->
      {
        state with
        profile = { state.profile with approval_policy };
      }
      |> rebuild_sandbox
  | Set_network network_mode ->
      if
        state.profile.sandbox_preset = Capability_profile.Danger_full_access
        && network_mode = Sandbox.Network_disabled
      then Error "full access always enables network; choose read-only or workspace-write before disabling network"
      else { state with sandbox = { state.sandbox with network_mode } } |> rebuild_sandbox
  | Set_no_sandbox no_sandbox ->
      {
        profile = { state.profile with no_sandbox_allowed = no_sandbox };
        sandbox = { state.sandbox with no_sandbox };
      }
      |> rebuild_sandbox
  | Allow_tools tools ->
      Ok
        {
          state with
          profile = { state.profile with tools = Capability_profile.of_list tools };
        }
  | Deny_all_tools ->
      Ok
        {
          state with
          profile = { state.profile with tools = Capability_profile.None_allowed };
        }

let network_to_string = function
  | Sandbox.Network_disabled -> "disabled"
  | Sandbox.Network_enabled -> "enabled"

let network_of_string = function
  | "disabled" | "off" | "deny" -> Some Sandbox.Network_disabled
  | "enabled" | "on" | "allow" | "allow-all" -> Some Sandbox.Network_enabled
  | _ -> None

let bool_of_toggle = function
  | "enabled" | "on" | "true" -> Some true
  | "disabled" | "off" | "false" -> Some false
  | _ -> None

let summary (state : state) =
  let tools =
    match Capability_profile.allowlist_names state.profile.tools with
    | None -> "all"
    | Some [] -> "none"
    | Some values -> String.concat "," values
  in
  Printf.sprintf "sandbox=%s approval=%s network=%s tools=%s no_sandbox=%b isolated_child=%b"
    (Capability_profile.sandbox_to_string state.profile.sandbox_preset)
    (Capability_profile.approval_to_string state.profile.approval_policy)
    (network_to_string state.sandbox.network_mode)
    tools state.sandbox.no_sandbox state.sandbox.isolated_child

let sandbox_menu_options (state : state) =
  let option preset label value description =
    let selected = state.profile.sandbox_preset = preset in
    {
      label = label ^ if selected then " (current)" else "";
      value = "sandbox " ^ value;
      description;
      selected;
    }
  in
  [
    option Capability_profile.Read_only "Read only" "read-only"
      "Read files, write only to temporary paths, deny network, ask before escalation.";
    option Capability_profile.Workspace_write "Workspace write" "workspace-write"
      "Write in this workspace and temporary paths, deny network, ask before escalation.";
    option Capability_profile.Danger_full_access "Full access" "full-access"
      "Unrestricted filesystem and network access.";
  ]

let approval_menu_options (state : state) =
  let option policy label value description =
    let selected = state.profile.approval_policy = policy in
    {
      label = label ^ if selected then " (current)" else "";
      value = "approval " ^ value;
      description;
      selected;
    }
  in
  [
    option Capability_profile.Never "Approval: never" "never"
      "Run everything without prompts (full YOLO).";
    option Capability_profile.On_request "Approval: on-request" "on-request"
      "Run freely, but confirm destructive commands like rm -rf and sudo.";
    option Capability_profile.On_failure "Approval: on-failure" "on-failure"
      "Run freely; ask only to retry a sandbox failure with escalation.";
    option Capability_profile.Untrusted "Approval: untrusted" "untrusted"
      "Confirm every command that isn't known-safe.";
  ]

let network_menu_options (state : state) =
  let option mode label value description =
    let selected = state.sandbox.network_mode = mode in
    {
      label = label ^ if selected then " (current)" else "";
      value = "network " ^ value;
      description;
      selected;
    }
  in
  [
    option Sandbox.Network_enabled "Network enabled" "enabled"
      "Allow commands and network tools to reach the network.";
    option Sandbox.Network_disabled "Network disabled" "disabled"
      "Block network access in read-only and workspace-write modes.";
  ]

let permissions_menu_options (state : state) =
  sandbox_menu_options state @ approval_menu_options state

let persisted_to_json (state : state) =
  Shared.Object
    [
      ("version", Shared.Number 1.);
      ("profile", Capability_profile.to_json state.profile);
      ("networkMode", Shared.String (network_to_string state.sandbox.network_mode));
      ("noSandbox", Shared.Bool state.sandbox.no_sandbox);
      ("isolated_child", Shared.Bool state.sandbox.isolated_child);
    ]

let persisted_of_json = function
  | Shared.Object fields -> (
      match List.assoc_opt "profile" fields with
      | Some profile_json ->
          let ( let* ) = Result.bind in
          let* profile = Capability_profile.of_json profile_json in
          let network_mode =
            match List.assoc_opt "networkMode" fields with
            | Some (Shared.String value) -> Option.value (network_of_string value) ~default:Sandbox.Network_disabled
            | _ -> Sandbox.Network_disabled
          in
          let no_sandbox =
            match List.assoc_opt "noSandbox" fields with
            | Some (Shared.Bool value) -> value
            | _ -> false
          in
          let isolated_child =
            match List.assoc_opt "isolated_child" fields with
            | Some (Shared.Bool value) -> value
            | _ -> false
          in
          create ~network_mode ~no_sandbox ~isolated_child profile
      | None -> Error "permissions state requires profile")
  | _ -> Error "permissions state must be an object"

let codec = { Shared.encode = persisted_to_json; decode = persisted_of_json }

let parse_words input =
  input |> String.split_on_char ' ' |> List.map String.trim
  |> List.filter (fun part -> part <> "")

let parse input =
  match parse_words input with
  | [] | [ "show" ] -> Ok None
  | [ "sandbox"; value ] -> (
      match Capability_profile.sandbox_of_string value with
      | Some preset -> Ok (Some (Set_sandbox preset))
      | None -> Error ("unknown sandbox preset: " ^ value))
  | [ "approval"; "never" ] -> Ok (Some (Set_approval Capability_profile.Never))
  | [ "approval"; "on-request" ] ->
      Ok (Some (Set_approval Capability_profile.On_request))
  | [ "approval"; "on-failure" ] ->
      Ok (Some (Set_approval Capability_profile.On_failure))
  | [ "approval"; "untrusted" ] ->
      Ok (Some (Set_approval Capability_profile.Untrusted))
  | [ "network"; value ] -> (
      match network_of_string value with
      | Some mode -> Ok (Some (Set_network mode))
      | None -> Error ("unknown network mode: " ^ value))
  | [ "no-sandbox"; value ] -> (
      match bool_of_toggle value with
      | Some enabled -> Ok (Some (Set_no_sandbox enabled))
      | None -> Error ("unknown no-sandbox value: " ^ value))
  | "tools" :: "allow" :: tools -> Ok (Some (Allow_tools tools))
  | [ "tools"; "deny-all" ] -> Ok (Some Deny_all_tools)
  | _ ->
      Error
        "usage: /permissions [show|sandbox <preset>|approval <policy>|no-sandbox <enabled|disabled>|tools allow <names...>|tools deny-all]"

(* /permissions configures everything except network access, which now lives in
   the dedicated /network command. The permissive [parse] above still accepts a
   [network ...] selection so the shared menu-finish path can apply it. *)
let parse_permissions input =
  match parse_words input with
  | "network" :: _ -> Error "network access is configured with /network"
  | _ -> parse input

let parse_network input =
  match parse_words input with
  | [] | [ "show" ] -> Ok None
  | [ value ] | [ "network"; value ] -> (
      match network_of_string value with
      | Some mode -> Ok (Some (Set_network mode))
      | None -> Error ("unknown network mode: " ^ value))
  | _ -> Error "usage: /network [show|enabled|disabled]"
