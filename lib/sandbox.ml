module String_set = Shared.String_set

type filesystem_mode =
  | Read_only
  | Workspace_write
  | Danger_full_access

type network_mode =
  | Network_disabled
  | Network_enabled

type sandbox_permissions =
  | Use_default
  | Require_escalated of {
      justification : string;
      prefix_rule : string list option;
    }

type approval_policy =
  | Never
  | On_request
  | On_failure
  | Untrusted

type config = {
  filesystem_mode : filesystem_mode;
  workspace_roots : string list;
  network_mode : network_mode;
  approval_policy : approval_policy;
  no_sandbox : bool;
  subagent : bool;
}

type decision =
  | Allow
  | Requires_approval of string
  | Deny of string

type path_access =
  | Read
  | Write
  | Delete

type resolved_mutation_path = { requested_path : string; resolved_path : string }

type exec_request = {
  cmd : string;
  workdir : string option;
  sandbox_permissions : sandbox_permissions;
}

type exec_result = {
  code : int;
  stdout : string;
  stderr : string;
}

type exec_runner = exec_request -> (exec_result, string) result

type approval_prompt = {
  title : string;
  prompt : string;
  timeout_ms : int;
}

type approval_outcome =
  | Approval_granted
  | Approval_denied of {
      message : string;
      details : Shared.json;
    }

type approval_prompt_outcome =
  | Approval_approved
  | Approval_denied_by_user
  | Approval_timed_out
  | Approval_unavailable
  | Approval_interrupted

type approval_prompt_plan =
  | Approval_prompt_unavailable
  | Approval_prompt_confirm of approval_prompt

type stdin_request = {
  session_id : int;
  chars : string;
}

type stdin_writer = stdin_request -> (unit, string) result

type stdin_host_call = {
  request : stdin_request;
  yield_time_ms : float option;
  max_output_tokens : float option;
}

type stdin_host_plan =
  | Stdin_call of stdin_host_call
  | Stdin_result of {
      message : string;
      details : Shared.json;
    }

type exec_host_facts = {
  platform : string;
  temp_roots : string list;
  system_ro_paths : string list;
  home_mount : string;
  workspace_roots : string list;
  workspace_metadata_listings : workspace_metadata_listing list;
}

and workspace_metadata_listing = {
  metadata_dir : string;
  path : string;
  children : string list option;
}

type exec_invocation = {
  command : string;
  args : string list;
  sandboxed : bool;
}

type exec_host_options = {
  cmd : string;
  cwd : string;
  shell : string;
  login : bool;
  timeout_ms : float option;
  yield_time_ms : float option;
  max_output_tokens : float option;
  tty : bool;
}

type exec_host_call = {
  invocation : exec_invocation;
  cwd : string;
  timeout_ms : float option;
  yield_time_ms : float option;
  max_output_tokens : float option;
  tty : bool;
  escalated : bool;
}

let filesystem_mode_to_string = function
  | Read_only -> "read-only"
  | Workspace_write -> "workspace-write"
  | Danger_full_access -> "danger-full-access"

let filesystem_mode_of_string = function
  | "read-only" -> Some Read_only
  | "workspace-write" -> Some Workspace_write
  | "danger-full-access" | "full-access" -> Some Danger_full_access
  | _ -> None

let filesystem_mode_of_profile = function
  | Capability_profile.Read_only -> Read_only
  | Capability_profile.Workspace_write -> Workspace_write
  | Capability_profile.Danger_full_access -> Danger_full_access

let approval_policy_of_profile = function
  | Capability_profile.Never -> Never
  | Capability_profile.On_request -> On_request
  | Capability_profile.On_failure -> On_failure
  | Capability_profile.Untrusted -> Untrusted

let config_of_profile ?(workspace_roots = []) ?(network_mode = Network_disabled)
    ?(no_sandbox = false) ?(subagent = false) profile =
  if subagent && no_sandbox then Error "sub-agents cannot enable --no-sandbox"
  else if no_sandbox && not profile.Capability_profile.no_sandbox_allowed then
    Error "--no-sandbox is not allowed by the active capability profile"
  else
    Ok
      {
        filesystem_mode = filesystem_mode_of_profile profile.sandbox_preset;
        workspace_roots;
        network_mode;
        approval_policy = approval_policy_of_profile profile.approval_policy;
        no_sandbox;
        subagent;
      }

let split_path path =
  path |> String.split_on_char '/'
  |> List.filter (fun part -> part <> "" && part <> ".")

let normalize_path path =
  let absolute = String.length path > 0 && path.[0] = '/' in
  let rec loop acc = function
    | [] -> List.rev acc
    | ".." :: rest -> (
        match acc with
        | [] -> loop acc rest
        | _ :: acc -> loop acc rest)
    | part :: rest -> loop (part :: acc) rest
  in
  let parts = loop [] (split_path path) in
  (if absolute then "/" else "") ^ String.concat "/" parts

let path_within ~root path =
  let root = normalize_path root in
  let path = normalize_path path in
  path = root
  || (String.length path > String.length root
     && String.sub path 0 (String.length root) = root
     && path.[String.length root] = '/')

let workspace_contains (config : config) path =
  List.exists (fun root -> path_within ~root path) config.workspace_roots

let protected_workspace_dir_names = [ ".git"; ".hg"; ".svn" ]

let join_path parent child =
  if parent = "" then child
  else if String.ends_with ~suffix:"/" parent then parent ^ child
  else parent ^ "/" ^ child

let is_absolute_path path = String.length path > 0 && path.[0] = '/'

let resolve_workspace_path (config : config) path =
  if is_absolute_path path then path
  else
    match config.workspace_roots with
    | root :: _ -> join_path root path
    | [] -> path

let path_starts_with_dir ~dir path =
  let dir = normalize_path dir in
  let path = normalize_path path in
  path = dir
  || (String.length path > String.length dir
     && String.sub path 0 (String.length dir) = dir
     && path.[String.length dir] = '/')

let is_protected_workspace_metadata_path (config : config) path =
  List.exists
    (fun root ->
      List.exists
        (fun dir_name ->
          path_starts_with_dir
            ~dir:(join_path root dir_name)
            path)
        protected_workspace_dir_names)
    config.workspace_roots

let requires_resolved_workspace_mutation_validation (config : config) =
  (not config.no_sandbox)
  &&
  match config.filesystem_mode with
  | Workspace_write -> true
  | Read_only | Danger_full_access -> false

(* This is the post-realpath mutation guard for workspace-write mode. Keep its
   caller-side enablement through [requires_resolved_workspace_mutation_validation]
   adjacent so the flag and validator do not drift. *)
let validate_resolved_workspace_mutation_paths ~workspace_roots paths =
  let workspace_roots = List.filter_map Shared.trim_non_empty workspace_roots in
  let config =
    {
      filesystem_mode = Workspace_write;
      workspace_roots;
      network_mode = Network_disabled;
      approval_policy = Never;
      no_sandbox = false;
      subagent = false;
    }
  in
  let rec loop = function
    | [] -> Ok ()
    | path :: rest ->
        if not (workspace_contains config path.resolved_path) then
          Error
            ("Sandbox: apply_patch path escapes workspace: "
            ^ path.requested_path)
        else if
          is_protected_workspace_metadata_path config path.resolved_path
        then
          Error
            ("Sandbox: path is inside protected workspace metadata: "
            ^ path.requested_path)
        else loop rest
  in
  loop paths

let authorize_path (config : config) access path =
  if config.no_sandbox then Allow
  else
    let resolved = resolve_workspace_path config path in
    match (config.filesystem_mode, access) with
    | Danger_full_access, _ -> Allow
    | Read_only, Read -> Allow
    | Read_only, (Write | Delete) -> Deny "filesystem is read-only"
    | Workspace_write, Read -> Allow
    | Workspace_write, (Write | Delete) ->
        if is_protected_workspace_metadata_path config resolved then
          Deny ("path is inside protected workspace metadata: " ^ path)
        else if workspace_contains config resolved then Allow
        else Deny ("path is outside workspace roots: " ^ path)

let authorize_paths (config : config) access paths =
  let rec loop = function
    | [] -> Allow
    | path :: rest -> (
        match authorize_path config access path with
        | Allow -> loop rest
        | decision -> decision)
  in
  loop paths

let approval_decision (config : config) message =
  match config.approval_policy with
  | Never -> Deny message
  | On_request | On_failure | Untrusted -> Requires_approval message

let approval_policy_to_codex_string = function
  | Never -> "Never"
  | On_request -> "OnRequest"
  | On_failure -> "OnFailure"
  | Untrusted -> "UnlessTrusted"

let reject_exec_escalation_message policy =
  let policy = approval_policy_to_codex_string policy in
  Printf.sprintf
    "approval policy is %s; reject command — you cannot ask for escalated permissions if the approval policy is %s"
    policy policy

let authorize_mutation_path ?(approved = false) (config : config) access path =
  if config.no_sandbox then Allow
  else
    let resolved = resolve_workspace_path config path in
    match (config.filesystem_mode, access) with
    | Danger_full_access, _ -> Allow
    | _, Read -> Allow
    | _, (Write | Delete) when is_protected_workspace_metadata_path config resolved ->
        Deny ("path is inside protected workspace metadata: " ^ path)
    | Read_only, (Write | Delete) ->
        if approved then Allow else approval_decision config "filesystem is read-only"
    | Workspace_write, (Write | Delete) ->
        if workspace_contains config resolved then Allow
        else if approved then Allow
        else approval_decision config ("path is outside workspace roots: " ^ path)

let authorize_effect (config : config) = function
  | Tool_gateway.Pure | Tool_gateway.Ask_user -> Ok ()
  | Tool_gateway.Execute ->
      (* Execution is allowed in every sandbox mode.  In read-only mode the
         command runs inside a read-only bubblewrap mount; the sandbox
         constrains how the command executes, not whether it may run. *)
      Ok ()
  | Tool_gateway.Mutate -> (
      match config.filesystem_mode with
      | Read_only -> Error "mutation is disabled in read-only sandbox"
      | Workspace_write | Danger_full_access -> Ok ())
  | Tool_gateway.Network -> (
      match config.network_mode with
      | Network_enabled -> Ok ()
      | Network_disabled -> Error "network is disabled by sandbox policy")
  | Tool_gateway.Spawn_agent ->
      (* Nesting and ownership are enforced by Subagents; the sandbox only
         authorizes the spawn effect itself. *)
      Ok ()

let authorize_exec (config : config) request =
  match request.sandbox_permissions with
  | Require_escalated { justification; _ } ->
      if config.approval_policy <> On_request then
        Deny (reject_exec_escalation_message config.approval_policy)
      else
        approval_decision config
          (if justification = "" then "command requested escalation" else justification)
  | Use_default -> (
      match request.workdir with
      | Some workdir -> authorize_path config Read workdir
      | None -> Allow)

let exec_command config runner request =
  match authorize_exec config request with
  | Allow -> runner request
  | Requires_approval message -> Error ("approval required: " ^ message)
  | Deny message -> Error message

let write_stdin _config writer request = writer request

let write_stdin_success_message = "stdin written"
let write_stdin_unavailable_message = "write_stdin is unavailable in this Pi host adapter"
let write_stdin_invalid_session_message = "write_stdin preparation omitted sessionId"
let apply_patch_success_message = "Patch applied."

let write_stdin_error_details ?(unavailable = false) message =
  Shared.Object
    [
      ("ok", Shared.Bool false);
      ("error", Shared.String message);
      ("unavailable", Shared.Bool unavailable);
    ]

let plan_write_stdin_host_call ~host_available ?yield_time_ms
    ?max_output_tokens request =
  if not host_available then
    Stdin_result
      {
        message = write_stdin_unavailable_message;
        details =
          write_stdin_error_details ~unavailable:true
            write_stdin_unavailable_message;
      }
  else if request.session_id < 0 then
    Stdin_result
      {
        message = write_stdin_invalid_session_message;
        details = write_stdin_error_details write_stdin_invalid_session_message;
      }
  else Stdin_call { request; yield_time_ms; max_output_tokens }

type failure_kind =
  | Network_failure
  | Filesystem_failure

type failure_diagnostic = {
  kind : failure_kind;
  message : string;
  evidence : string;
  filesystem_mode : filesystem_mode;
  network_mode : network_mode;
}

let lowercase = String.lowercase_ascii

let string_contains haystack needle =
  let haystack_len = String.length haystack in
  let needle_len = String.length needle in
  let rec loop index =
    needle_len = 0
    || (index + needle_len <= haystack_len
       && (String.sub haystack index needle_len = needle || loop (index + 1)))
  in
  loop 0

let contains_any patterns value =
  let value = lowercase value in
  List.exists (string_contains value) patterns

let first_matching_line patterns output =
  output |> String.split_on_char '\n'
  |> List.find_map (fun line ->
         let line = String.trim line in
         if line <> "" && contains_any patterns line then Some line else None)

let failure_diagnostic ~filesystem_mode ~network_mode ~sandboxed ~exit_code
    ~stdout ~stderr =
  if (not sandboxed) || exit_code = 0 then None
  else
    let output = stderr ^ "\n" ^ stdout in
    match
      first_matching_line
        [
          "temporary failure";
          "could not resolve";
          "name resolution";
          "network is unreachable";
          "no route to host";
          "failed to connect";
          "connection timed out";
          "dns";
        ]
        output
    with
    | Some evidence when network_mode <> Network_enabled ->
        Some
          {
            kind = Network_failure;
            message =
              "Network access is blocked by the sandbox. Retry the same command with sandbox_permissions=\"require_escalated\" if this command requires network.";
            evidence;
            filesystem_mode;
            network_mode;
          }
    | _ -> (
        match
          first_matching_line
            [
              "permission denied";
              "operation not permitted";
              "read-only file system";
              "erofs";
              "eacces";
              "eperm";
            ]
            output
        with
        | Some evidence when filesystem_mode <> Danger_full_access ->
            Some
              {
                kind = Filesystem_failure;
                message =
                  "Filesystem access is restricted by the sandbox. Retry the same command with sandbox_permissions=\"require_escalated\" if this command needs host filesystem access.";
                evidence;
                filesystem_mode;
                network_mode;
              }
        | _ -> None)

let failure_kind_to_string = function
  | Network_failure -> "network"
  | Filesystem_failure -> "filesystem"

let network_mode_to_string = function
  | Network_disabled -> "disabled"
  | Network_enabled -> "enabled"

let unique_strings values =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | value :: rest ->
        if value = "" || List.mem value seen then loop seen acc rest
        else loop (value :: seen) (value :: acc) rest
  in
  loop [] [] values

let system_ro_path_candidates =
  [ "/nix"; "/bin"; "/sbin"; "/etc"; "/run/current-system"; "/lib64"; "/usr"; "/lib" ]

let temp_root_candidates ~tmp_dir ~env_tmp_dir =
  unique_strings [ tmp_dir; "/tmp"; env_tmp_dir ]

let protected_workspace_listing_paths listing =
  if not (List.mem listing.metadata_dir protected_workspace_dir_names) then []
  else
    match listing.children with
    | None -> [ listing.path ]
    | Some children ->
        children
        |> List.filter (fun child ->
               not (listing.metadata_dir = ".git" && child = "hooks"))
        |> List.map (join_path listing.path)

let protected_workspace_children host =
  host.workspace_metadata_listings
  |> List.concat_map protected_workspace_listing_paths

let bind_pair flag path = [ flag; path; path ]

let strict_child_path ~root path =
  let root = normalize_path root in
  let path = normalize_path path in
  String.length path > String.length root
  && String.sub path 0 (String.length root) = root
  && path.[String.length root] = '/'

let plan_exec_invocation config host ~shell ~shell_args ~force_unsandboxed =
  if force_unsandboxed || config.no_sandbox then
    Ok { command = shell; args = shell_args; sandboxed = false }
  else if
    config.filesystem_mode = Danger_full_access
    && config.network_mode = Network_enabled
  then Ok { command = shell; args = shell_args; sandboxed = false }
  else if host.platform <> "linux" then
    Error
      "sandboxed execution is only supported on Linux; use /permissions to change sandbox mode"
  else
    let args =
      [
        "--new-session";
        "--die-with-parent";
        "--unshare-user";
        "--unshare-pid";
        "--unshare-ipc";
      ]
    in
    let args =
      match config.filesystem_mode with
      | Workspace_write ->
          args @ List.concat_map (bind_pair "--bind") host.temp_roots
      | Read_only | Danger_full_access -> args @ [ "--tmpfs"; "/tmp" ]
    in
    let args = args @ [ "--tmpfs"; "/run" ] in
    let args =
      args @ List.concat_map (bind_pair "--ro-bind") host.system_ro_paths
    in
    let args =
      if host.home_mount = "" then args
      else args @ bind_pair "--ro-bind" host.home_mount
    in
    let args =
      match config.filesystem_mode with
      | Workspace_write ->
          args
          @ List.concat_map (bind_pair "--bind") host.workspace_roots
          @ List.concat_map
              (bind_pair "--ro-bind")
              (protected_workspace_children host)
      | Read_only ->
          args
          @ (host.workspace_roots
            |> List.filter (fun root ->
                   host.home_mount = ""
                   || not (strict_child_path ~root:host.home_mount root))
            |> List.concat_map (bind_pair "--ro-bind"))
      | Danger_full_access -> args @ bind_pair "--bind" "/"
    in
    let args =
      match config.network_mode with
      | Network_enabled -> args
      | Network_disabled -> args @ [ "--unshare-net" ]
    in
    let args = args @ [ "--dev"; "/dev"; "--proc"; "/proc" ] in
    Ok { command = "bwrap"; args = args @ ("--" :: shell :: shell_args); sandboxed = true }

let exec_shell_args ~login ~cmd = [ (if login then "-lc" else "-c"); cmd ]

let plan_exec_host_call config host (options : exec_host_options)
    ~force_unsandboxed =
  let shell_args = exec_shell_args ~login:options.login ~cmd:options.cmd in
  plan_exec_invocation config host ~shell:options.shell ~shell_args
    ~force_unsandboxed
  |> Result.map (fun invocation ->
         {
           invocation;
           cwd = options.cwd;
           timeout_ms = options.timeout_ms;
           yield_time_ms = options.yield_time_ms;
           max_output_tokens = options.max_output_tokens;
           tty = options.tty;
           escalated = force_unsandboxed;
         })

let failure_diagnostic_to_json diagnostic =
  Shared.Object
    [
      ("kind", Shared.String (failure_kind_to_string diagnostic.kind));
      ("message", Shared.String diagnostic.message);
      ("evidence", Shared.String diagnostic.evidence);
      ( "sandbox",
        Shared.Object
          [
            ( "filesystemMode",
              Shared.String
                (filesystem_mode_to_string diagnostic.filesystem_mode) );
            ("networkMode", Shared.String (network_mode_to_string diagnostic.network_mode));
          ] );
    ]

let exec_base_text result =
  if result.stdout <> "" then result.stdout
  else if result.stderr <> "" then result.stderr
  else "Command exited with code " ^ string_of_int result.code

let render_exec_result ?diagnostic result =
  let base = exec_base_text result in
  match diagnostic with
  | None -> base
  | Some diagnostic ->
      let separator = if String.ends_with ~suffix:"\n" base then "" else "\n" in
      base ^ separator ^ "SANDBOX_DIAGNOSTIC="
      ^ Shared.encode_json (failure_diagnostic_to_json diagnostic)
      ^ "\n[sandbox] " ^ diagnostic.message ^ "\n"

let exec_result_details ~sandboxed ~escalated ?diagnostic result =
  let fields =
    [
      ("ok", Shared.Bool (result.code = 0));
      ("sandboxed", Shared.Bool sandboxed);
      ("escalated", Shared.Bool escalated);
      ("code", Shared.Number (float_of_int result.code));
      ("stdout", Shared.String result.stdout);
      ("stderr", Shared.String result.stderr);
    ]
  in
  let fields =
    match diagnostic with
    | None -> fields
    | Some diagnostic ->
        fields @ [ ("sandboxDiagnostic", failure_diagnostic_to_json diagnostic) ]
  in
  Shared.Object fields

let exec_approval_prompt ~cmd message =
  let message =
    match Shared.trim_non_empty message with
    | Some value -> value
    | None -> "Command requested escalation"
  in
  {
    title = "Command requires approval";
    prompt = (if cmd = "" then message else message ^ "\n\n" ^ cmd);
    timeout_ms = 120000;
  }

let plan_exec_approval_prompt ~ui_available prompt =
  if not ui_available then Approval_prompt_unavailable
  else
    match
      (Shared.trim_non_empty prompt.title, Shared.trim_non_empty prompt.prompt)
    with
    | Some title, Some prompt_text ->
        Approval_prompt_confirm
          {
            title;
            prompt = prompt_text;
            timeout_ms = max 0 prompt.timeout_ms;
          }
    | _ -> Approval_prompt_unavailable

let approval_prompt_outcome_to_string = function
  | Approval_approved -> "approved"
  | Approval_denied_by_user -> "denied_by_user"
  | Approval_timed_out -> "timed_out"
  | Approval_unavailable -> "unavailable"
  | Approval_interrupted -> "interrupted"

let approval_prompt_outcome_of_string = function
  | "approved" -> Some Approval_approved
  | "denied_by_user" | "denied" -> Some Approval_denied_by_user
  | "timed_out" | "timeout" -> Some Approval_timed_out
  | "unavailable" -> Some Approval_unavailable
  | "interrupted" | "aborted" -> Some Approval_interrupted
  | _ -> None

let approval_denial_message = function
  | Approval_approved -> ""
  | Approval_denied_by_user ->
      "Sandbox: command blocked (approval denied by user)"
  | Approval_timed_out -> "Sandbox: command blocked (approval timed out)"
  | Approval_unavailable -> "Sandbox: command blocked (approval unavailable)"
  | Approval_interrupted -> "Sandbox: command blocked (approval interrupted)"

let exec_approval_outcome ~outcome =
  match outcome with
  | Approval_approved -> Approval_granted
  | Approval_denied_by_user | Approval_timed_out | Approval_unavailable
  | Approval_interrupted ->
      Approval_denied
        {
          message = approval_denial_message outcome;
          details =
            Shared.Object
              [
                ("ok", Shared.Bool false);
                ("approvalRequired", Shared.Bool true);
                ( "approvalOutcome",
                  Shared.String (approval_prompt_outcome_to_string outcome) );
              ];
        }

let filesystem_approval_prompt ~tool ~path =
  {
    title = tool ^ ": path outside workspace";
    prompt = "Tool: " ^ tool ^ "\nPath: " ^ path ^ "\n\nAllow this operation?";
    timeout_ms = 60000;
  }

module Patch = Sandbox_patch

let authorize_patch ?(approved = false) config patch =
  let actions = Patch.affected_actions patch in
  let rec loop = function
    | [] -> Allow
    | Patch.Write_file path :: rest -> (
        match authorize_mutation_path ~approved config Write path with
        | Allow -> loop rest
        | decision -> decision)
    | Patch.Delete_path path :: rest -> (
        match authorize_mutation_path ~approved config Delete path with
        | Allow -> loop rest
        | decision -> decision)
  in
  loop actions

let apply_patch_to_map config files text =
  match Patch.parse text with
  | Error message -> Error message
  | Ok patch -> (
      match authorize_patch config patch with
      | Allow -> Patch.apply_to_map files patch
      | Requires_approval message -> Error ("approval required: " ^ message)
      | Deny message -> Error message)

type edit_replacement = {
  old_text : string;
  new_text : string;
}

type edit_match = {
  edit_index : int;
  match_index : int;
  match_length : int;
  replacement : string;
}

let utf8_bom = "\239\187\191"

let starts_with ~prefix text =
  let prefix_len = String.length prefix in
  String.length text >= prefix_len && String.sub text 0 prefix_len = prefix

let normalize_to_lf text =
  let length = String.length text in
  let buffer = Buffer.create length in
  let rec loop index =
    if index >= length then Buffer.contents buffer
    else
      match text.[index] with
      | '\r' ->
          Buffer.add_char buffer '\n';
          if index + 1 < length && text.[index + 1] = '\n' then loop (index + 2)
          else loop (index + 1)
      | ch ->
          Buffer.add_char buffer ch;
          loop (index + 1)
  in
  loop 0

let contains_crlf text =
  let rec loop index =
    index + 1 < String.length text
    && ((text.[index] = '\r' && text.[index + 1] = '\n') || loop (index + 1))
  in
  loop 0

let restore_line_endings text original =
  if not (contains_crlf original) then text
  else
    let buffer = Buffer.create (String.length text) in
    String.iter
      (fun ch ->
        if ch = '\n' then Buffer.add_string buffer "\r\n"
        else Buffer.add_char buffer ch)
      text;
    Buffer.contents buffer

let find_substring_occurrences haystack needle =
  let haystack_len = String.length haystack in
  let needle_len = String.length needle in
  let rec matches_at haystack_index needle_index =
    needle_index = needle_len
    || (haystack_index + needle_index < haystack_len
       && haystack.[haystack_index + needle_index] = needle.[needle_index]
       && matches_at haystack_index (needle_index + 1))
  in
  let rec loop index acc =
    if index + needle_len > haystack_len then List.rev acc
    else if matches_at index 0 then loop (index + 1) (index :: acc)
    else loop (index + 1) acc
  in
  loop 0 []

let apply_edits ~display_path content edits =
  match edits with
  | [] -> Error "Edit tool input is invalid. edits must contain at least one replacement."
  | _ ->
      let bom, text =
        if starts_with ~prefix:utf8_bom content then
          (utf8_bom, String.sub content (String.length utf8_bom) (String.length content - String.length utf8_bom))
        else ("", content)
      in
      let normalized_content = normalize_to_lf text in
      let normalized_edits =
        List.map
          (fun edit ->
            {
              old_text = normalize_to_lf edit.old_text;
              new_text = normalize_to_lf edit.new_text;
            })
          edits
      in
      let edit_count = List.length normalized_edits in
      let rec collect_matches index acc = function
        | [] -> Ok (List.rev acc)
        | edit :: rest ->
            if edit.old_text = "" then
              Error
                (if edit_count = 1 then "oldText must not be empty in " ^ display_path ^ "."
                 else
                   Printf.sprintf "edits[%d].oldText must not be empty in %s." index
                     display_path)
            else
              let occurrences =
                find_substring_occurrences normalized_content edit.old_text
              in
              (match occurrences with
              | [] ->
                  Error
                    (if edit_count = 1 then
                       "Could not find the exact text in " ^ display_path
                       ^ ". The old text must match exactly including all whitespace and newlines."
                     else
                       Printf.sprintf
                         "Could not find edits[%d] in %s. The oldText must match exactly including all whitespace and newlines."
                         index display_path)
              | [ match_index ] ->
                  collect_matches (index + 1)
                    ({
                       edit_index = index;
                       match_index;
                       match_length = String.length edit.old_text;
                       replacement = edit.new_text;
                     }
                      :: acc)
                    rest
              | matches ->
                  Error
                    (if edit_count = 1 then
                       Printf.sprintf
                         "Found %d occurrences of the text in %s. The text must be unique. Please provide more context to make it unique."
                         (List.length matches) display_path
                     else
                       Printf.sprintf
                         "Found %d occurrences of edits[%d] in %s. Each oldText must be unique. Please provide more context to make it unique."
                         (List.length matches) index display_path))
      in
      let ( let* ) = Result.bind in
      let* matches = collect_matches 0 [] normalized_edits in
      let matches = List.sort (fun left right -> compare left.match_index right.match_index) matches in
      let rec check_overlaps = function
        | previous :: current :: rest
          when previous.match_index + previous.match_length > current.match_index ->
            Error
              (Printf.sprintf
                 "edits[%d] and edits[%d] overlap in %s. Merge them into one edit or target disjoint regions."
                 previous.edit_index current.edit_index display_path)
        | _ :: rest -> check_overlaps rest
        | [] -> Ok ()
      in
      let* () = check_overlaps matches in
      let next =
        List.fold_left
          (fun text edit ->
            String.sub text 0 edit.match_index ^ edit.replacement
            ^ String.sub text
                (edit.match_index + edit.match_length)
                (String.length text - edit.match_index - edit.match_length))
          normalized_content (List.rev matches)
      in
      if next = normalized_content then
        Error
          (if edit_count = 1 then
             "No changes made to " ^ display_path
             ^ ". The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected."
           else "No changes made to " ^ display_path ^ ". The replacements produced identical content.")
      else Ok (bom ^ restore_line_endings next text)

let canonical_tool_specs = Sandbox_tool_specs.canonical_tool_specs
