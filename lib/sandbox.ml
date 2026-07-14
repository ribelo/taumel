module String_set = Shared.String_set

include Sandbox_types

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
    ?(no_sandbox = false) ?(isolated_child = false)
    (profile : Capability_profile.t) =
  if isolated_child && no_sandbox then Error "isolated child sessions cannot enable --no-sandbox"
  else if
    isolated_child
    && profile.Capability_profile.sandbox_preset
       = Capability_profile.Danger_full_access
  then Error "danger-full-access is not allowed for isolated children"
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
        isolated_child;
      }

let split_path = Sandbox_paths.split_path
let normalize_path = Sandbox_paths.normalize_path
let path_within = Sandbox_paths.path_within

let workspace_contains (config : config) path =
  List.exists (fun root -> path_within ~root path) config.workspace_roots

let protected_workspace_dir_names = Sandbox_paths.protected_workspace_dir_names
let join_path = Sandbox_paths.join_path
let is_absolute_path = Sandbox_paths.is_absolute_path

let resolve_workspace_path (config : config) path =
  if is_absolute_path path then path
  else
    match config.workspace_roots with
    | root :: _ -> join_path root path
    | [] -> path

let path_starts_with_dir = Sandbox_paths.path_starts_with_dir

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

let policy_path (config : config) ?auth_path path =
  match auth_path with
  | Some value when String.trim value <> "" -> Ok value
  | Some _ -> Error "authorization path is empty"
  | None -> Ok (resolve_workspace_path config path)

let policy_roots (config : config) ?auth_roots () =
  match auth_roots with
  | Some (_ :: _ as roots) -> roots
  | Some [] | None -> config.workspace_roots

let workspace_contains_roots ~roots path =
  List.exists (fun root -> path_within ~root path) roots

let is_protected_path_under ~roots path =
  List.exists
    (fun root ->
      List.exists
        (fun dir_name ->
          path_starts_with_dir ~dir:(join_path root dir_name) path)
        protected_workspace_dir_names)
    roots

let authorization_resolution_denied path message =
  Deny
    ("path authorization failed for " ^ path ^ ": " ^ message)

let authorization_path_message reason ~requested ~resolved =
  reason ^ " (requested path: " ^ requested ^ "; resolved target: " ^ resolved
  ^ ")"

(* This is the post-realpath mutation guard for workspace-write mode. Keep its
   caller-side enablement through [requires_resolved_workspace_mutation_validation]
   adjacent so the flag and validator do not drift. *)
let validate_resolved_workspace_mutation_paths ~workspace_roots paths =
  let roots =
    workspace_roots
    |> List.filter_map Shared.trim_non_empty
  in
  let rec loop = function
    | [] -> Ok ()
    | path :: rest ->
        if not (workspace_contains_roots ~roots path.resolved_path) then
          Error
            ("Sandbox: apply_patch path escapes workspace: "
            ^ path.requested_path)
        else if is_protected_path_under ~roots path.resolved_path then
          Error
            ("Sandbox: path is inside protected workspace metadata: "
            ^ path.requested_path)
        else loop rest
  in
  loop paths

let authorize_path ?auth_path ?auth_roots (config : config) access path =
  if config.no_sandbox then Allow
  else
    let roots = policy_roots config ?auth_roots () in
    match (config.filesystem_mode, access) with
    | Danger_full_access, _ -> Allow
    | Read_only, Read -> Allow
    | Read_only, (Write | Delete) -> Deny "filesystem is read-only"
    | Workspace_write, Read -> Allow
    | Workspace_write, (Write | Delete) -> (
        match policy_path config ?auth_path path with
        | Error message -> authorization_resolution_denied path message
        | Ok auth ->
            if is_protected_path_under ~roots auth then
              Deny
                (authorization_path_message
                   "path is inside protected workspace metadata"
                   ~requested:path ~resolved:auth)
            else if workspace_contains_roots ~roots auth then Allow
            else
              Deny
                (authorization_path_message "path is outside workspace roots"
                   ~requested:path ~resolved:auth))

let authorize_paths ?auth_paths ?auth_roots (config : config) access paths =
  let rec loop paths auth_paths =
    match paths with
    | [] -> Allow
    | path :: rest -> (
        let auth_path, auth_paths =
          match auth_paths with
          | value :: rest_auth -> (Some value, rest_auth)
          | [] -> (None, [])
        in
        match authorize_path ?auth_path ?auth_roots config access path with
        | Allow -> loop rest auth_paths
        | decision -> decision)
  in
  loop paths (Option.value auth_paths ~default:[])

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

let authorize_mutation_path ?(approved = false) ?auth_path ?auth_roots
    (config : config) access path =
  if config.no_sandbox then Allow
  else
    let roots = policy_roots config ?auth_roots () in
    match (config.filesystem_mode, access) with
    | Danger_full_access, _ -> Allow
    | _, Read -> Allow
    | Read_only, (Write | Delete) ->
        if approved then Allow else approval_decision config "filesystem is read-only"
    | Workspace_write, (Write | Delete) -> (
        match policy_path config ?auth_path path with
        | Error message -> authorization_resolution_denied path message
        | Ok auth ->
            if is_protected_path_under ~roots auth then
              Deny
                (authorization_path_message
                   "path is inside protected workspace metadata"
                   ~requested:path ~resolved:auth)
            else if workspace_contains_roots ~roots auth then Allow
            else if approved then Allow
            else
              approval_decision config
                (authorization_path_message "path is outside workspace roots"
                   ~requested:path ~resolved:auth))

let resolve_mutation_path ?auth_path (config : config) path =
  match auth_path with
  | Some value when String.trim value <> "" -> value
  | Some _ | None -> resolve_workspace_path config path

let authorize_effect (config : config) = function
  | Tool_gateway.Pure | Tool_gateway.Ask_user -> Ok ()
  | Tool_gateway.Execute | Tool_gateway.Spawn_agent ->
      (* Execution and agent spawning are allowed in every sandbox mode.  In
         read-only mode the child inherits a clamped ceiling; the sandbox
         constrains side effects, not whether an agent may be started. *)
      Ok ()
  | Tool_gateway.Mutate -> (
      match config.filesystem_mode with
      | Read_only -> Error "mutation is disabled in read-only sandbox"
      | Workspace_write | Danger_full_access -> Ok ())
  | Tool_gateway.Network -> (
      match config.network_mode with
      | Network_enabled -> Ok ()
      | Network_disabled -> Error "network is disabled by sandbox policy")

let decision_rank = function Allow -> 0 | Requires_approval _ -> 1 | Deny _ -> 2

let strictest_decision left right =
  if decision_rank left >= decision_rank right then left else right

let exec_policy_decision ?message config policy_decision =
  let message = Option.value message ~default:"exec policy requires approval" in
  match (policy_decision : Exec_policy.decision) with
  | Allow -> Allow
  | Forbidden -> Deny message
  | Prompt -> (
      match config.approval_policy with
      | Never -> Allow
      | On_request | On_failure | Untrusted -> approval_decision config message)

let authorize_exec ?policy_decision ?policy_message (config : config) request =
  let existing =
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
  in
  match policy_decision with
  | None -> existing
  | Some policy_decision ->
      strictest_decision existing (exec_policy_decision ?message:policy_message config policy_decision)

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

let plan_write_stdin_host_call ~host_available ?yield_time_ms request =
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
  else Stdin_call { request; yield_time_ms }

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
              "Network access is blocked by the sandbox. Retry the same command with with_escalated_permissions=true if this command requires network.";
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
                  "Filesystem access is restricted by the sandbox. Retry the same command with with_escalated_permissions=true if this command needs host filesystem access.";
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

let system_ro_path_candidates = Sandbox_exec_host.system_ro_path_candidates
let temp_root_candidates = Sandbox_exec_host.temp_root_candidates
let plan_exec_invocation = Sandbox_exec_host.plan_exec_invocation
let exec_shell_args = Sandbox_exec_host.exec_shell_args
let plan_exec_host_call = Sandbox_exec_host.plan_exec_host_call

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
      let details =
        [
          ("ok", Shared.Bool false);
          ("approvalRequired", Shared.Bool true);
          ( "approvalOutcome",
            Shared.String (approval_prompt_outcome_to_string outcome) );
        ]
      in
      let details =
        match outcome with
        | Approval_unavailable ->
            details @ [ ("reason", Shared.String "approval_unavailable") ]
        | _ -> details
      in
      Approval_denied
        {
          message = approval_denial_message outcome;
          details = Shared.Object details;
        }

let filesystem_approval_prompt ~tool ~path =
  {
    title = tool ^ ": path outside workspace";
    prompt = "Tool: " ^ tool ^ "\nPath: " ^ path ^ "\n\nAllow this operation?";
    timeout_ms = 60000;
  }

module Patch = Sandbox_patch

let authorize_patch ?(approved = false) ?(auth_paths = []) ?auth_roots config patch =
  let actions = Patch.affected_actions patch in
  let auth_path path = List.assoc_opt path auth_paths in
  let rec loop = function
    | [] -> Allow
    | Patch.Write_file path :: rest -> (
        match authorize_mutation_path ~approved ?auth_path:(auth_path path) ?auth_roots config Write path with
        | Allow -> loop rest
        | decision -> decision)
    | Patch.Delete_path path :: rest -> (
        match authorize_mutation_path ~approved ?auth_path:(auth_path path) ?auth_roots config Delete path with
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
