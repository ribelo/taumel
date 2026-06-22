type network_access =
  | Restricted
  | Enabled

type snapshot = {
  cwd : string;
  approval_policy : Sandbox.approval_policy;
  sandbox_mode : Sandbox.filesystem_mode;
  network_access : network_access;
  writable_roots : string list;
  no_sandbox : bool;
  subagent : bool;
  shell : string;
}

type t = {
  cwd : string option;
  approval_policy : Sandbox.approval_policy option;
  sandbox_mode : Sandbox.filesystem_mode option;
  network_access : network_access option;
  writable_roots : string list option;
  no_sandbox : bool option;
  subagent : bool option;
  shell : string option;
}

let network_access_of_mode = function
  | Sandbox.Network_enabled -> Enabled
  | Sandbox.Network_disabled -> Restricted

let writable_roots_for_context (sandbox : Sandbox.config) =
  match sandbox.filesystem_mode with
  | Sandbox.Workspace_write -> sandbox.workspace_roots
  | Sandbox.Read_only | Sandbox.Danger_full_access -> []

let snapshot ~cwd ~shell (sandbox : Sandbox.config) : snapshot =
  {
    cwd;
    approval_policy = sandbox.approval_policy;
    sandbox_mode = sandbox.filesystem_mode;
    network_access = network_access_of_mode sandbox.network_mode;
    writable_roots = writable_roots_for_context sandbox;
    no_sandbox = sandbox.no_sandbox;
    subagent = sandbox.subagent;
    shell;
  }

let full (snapshot : snapshot) : t =
  {
    cwd = Some snapshot.cwd;
    approval_policy = Some snapshot.approval_policy;
    sandbox_mode = Some snapshot.sandbox_mode;
    network_access = Some snapshot.network_access;
    writable_roots =
      (match snapshot.writable_roots with [] -> None | roots -> Some roots);
    no_sandbox = Some snapshot.no_sandbox;
    subagent = Some snapshot.subagent;
    shell =
      (match String.trim snapshot.shell with "" -> None | value -> Some value);
  }

let empty context =
  context.cwd = None && context.approval_policy = None
  && context.sandbox_mode = None && context.network_access = None
  && context.writable_roots = None && context.no_sandbox = None
  && context.subagent = None && context.shell = None

let diff (before : snapshot) (after : snapshot) =
  let context =
    {
      cwd = (if before.cwd = after.cwd then None else Some after.cwd);
      approval_policy =
        (if before.approval_policy = after.approval_policy then None
         else Some after.approval_policy);
      sandbox_mode =
        (if before.sandbox_mode = after.sandbox_mode then None
         else Some after.sandbox_mode);
      network_access =
        (if before.network_access = after.network_access then None
         else Some after.network_access);
      writable_roots =
        (if before.writable_roots = after.writable_roots then None
         else
           match after.writable_roots with [] -> None | roots -> Some roots);
      no_sandbox =
        (if before.no_sandbox = after.no_sandbox then None
         else Some after.no_sandbox);
      subagent =
        (if before.subagent = after.subagent then None else Some after.subagent);
      shell = None;
    }
  in
  if empty context then None else Some context

let network_access_to_string = function
  | Restricted -> "restricted"
  | Enabled -> "enabled"

let approval_policy_to_string = function
  | Sandbox.Never -> "never"
  | Sandbox.On_request -> "on-request"
  | Sandbox.On_failure -> "on-failure"
  | Sandbox.Untrusted -> "unless-trusted"

let escape_xml_text input =
  input |> String.split_on_char '&' |> String.concat "&amp;"
  |> String.split_on_char '<' |> String.concat "&lt;"
  |> String.split_on_char '>' |> String.concat "&gt;"

let bool_to_string value = if value then "true" else "false"

let serialize context =
  let lines = [ "<environment_context>" ] in
  let lines =
    match context.cwd with
    | None -> lines
    | Some cwd -> lines @ [ "  <cwd>" ^ escape_xml_text cwd ^ "</cwd>" ]
  in
  let lines =
    match context.approval_policy with
    | None -> lines
    | Some approval_policy ->
        lines
        @ [
            "  <approval_policy>"
            ^ approval_policy_to_string approval_policy
            ^ "</approval_policy>";
          ]
  in
  let lines =
    match context.sandbox_mode with
    | None -> lines
    | Some sandbox_mode ->
        lines
        @ [
            "  <sandbox_mode>"
            ^ Sandbox.filesystem_mode_to_string sandbox_mode
            ^ "</sandbox_mode>";
          ]
  in
  let lines =
    match context.network_access with
    | None -> lines
    | Some network_access ->
        lines
        @ [
            "  <network_access>"
            ^ network_access_to_string network_access
            ^ "</network_access>";
          ]
  in
  let lines =
    match context.writable_roots with
    | None | Some [] -> lines
    | Some roots ->
        lines @ [ "  <writable_roots>" ]
        @ List.map
            (fun root -> "    <root>" ^ escape_xml_text root ^ "</root>")
            roots
        @ [ "  </writable_roots>" ]
  in
  let lines =
    match context.no_sandbox with
    | None -> lines
    | Some no_sandbox ->
        lines
        @ [
            "  <no_sandbox>"
            ^ bool_to_string no_sandbox
            ^ "</no_sandbox>";
          ]
  in
  let lines =
    match context.subagent with
    | None -> lines
    | Some subagent ->
        lines @ [ "  <subagent>" ^ bool_to_string subagent ^ "</subagent>" ]
  in
  let lines =
    match context.shell with
    | None -> lines
    | Some shell -> lines @ [ "  <shell>" ^ escape_xml_text shell ^ "</shell>" ]
  in
  String.concat "\n" (lines @ [ "</environment_context>" ])
