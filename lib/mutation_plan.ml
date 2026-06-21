type approval = {
  action : string;
  message : string;
  title : string;
  prompt : string;
  timeout_ms : int;
}

type exec_request = {
  cmd : string;
  workdir : string;
  default_workdir : string;
  sandbox_permissions : Sandbox.sandbox_permissions;
  yield_time_ms : float option;
  max_output_tokens : float option;
  tty : bool;
  shell : string;
  login : bool;
}

type exec_plan = {
  action : string;
  cmd : string;
  workdir : string;
  yield_time_ms : float option;
  max_output_tokens : float option;
  tty : bool;
  shell : string;
  login : bool;
  approval : approval option;
}

type write_stdin_request = {
  session_id : int;
  chars : string;
  yield_time_ms : float option;
  max_output_tokens : float option;
}

type write_stdin_plan = {
  session_id : int;
  chars : string;
  yield_time_ms : float option;
  max_output_tokens : float option;
}

type write_request = {
  path : string;
  contents : string;
}

type edit_request = {
  path : string;
  edits : Sandbox.edit_replacement list;
}

type patch_request = {
  patch : string;
}

type mutation_plan = {
  action : string;
  workspace_roots : string list;
  validate_workspace_paths : bool;
  path : string;
  display_path : string;
  contents : string option;
  edits : Sandbox.edit_replacement list;
  approval : approval option;
}

type patch_plan = {
  action : string;
  workspace_roots : string list;
  validate_workspace_paths : bool;
  affected_paths : string list;
  approval : approval option;
}

type patch_output = {
  deletes : string list;
  writes : (string * string) list;
  affected_paths : string list;
}

let approval ?(message = "") action prompt =
  { action; message; title = prompt.Sandbox.title; prompt = prompt.prompt; timeout_ms = prompt.timeout_ms }

let ( let* ) = Result.bind

let non_empty_field tool field value =
  match Shared.trim_non_empty value with
  | Some value -> Ok value
  | None -> Error (tool ^ "." ^ field ^ " must not be empty")

let decode_sandbox_permissions tool fields =
  let* mode = Shared.json_optional_string tool fields "sandbox_permissions" in
  match mode with
  | None -> Ok Sandbox.Use_default
  | Some "require_escalated" ->
      let* justification =
        Shared.json_string_default tool fields "justification"
          "command requested escalation"
      in
      let* prefix_rule =
        Shared.json_optional_string_list tool fields "prefix_rule"
      in
      let prefix_rule =
        match prefix_rule with
        | Some (_ :: _ as values) -> Some values
        | Some [] | None -> None
      in
      Ok (Sandbox.Require_escalated { justification; prefix_rule })
  | Some _ ->
      Error
        (tool ^ ".sandbox_permissions must be \"require_escalated\" when provided")

let exec_request_of_json ~default_workdir json : (exec_request, string) result =
  let tool = "exec_command" in
  let* fields = Shared.json_object_fields tool json in
  let* cmd = Shared.json_required_string tool fields "cmd" in
  let* workdir = Shared.json_string_default tool fields "workdir" "" in
  let* sandbox_permissions = decode_sandbox_permissions tool fields in
  let* yield_time_ms = Shared.json_optional_number tool fields "yield_time_ms" in
  let* max_output_tokens = Shared.json_optional_number tool fields "max_output_tokens" in
  let* tty = Shared.json_bool_default tool fields "tty" false in
  let* shell = Shared.json_string_default tool fields "shell" "" in
  let* login = Shared.json_bool_default tool fields "login" true in
  Ok
    {
      cmd;
      workdir;
      default_workdir;
      sandbox_permissions;
      yield_time_ms;
      max_output_tokens;
      tty;
      shell;
      login;
    }

let write_stdin_request_of_json json : (write_stdin_request, string) result =
  let tool = "write_stdin" in
  let* fields = Shared.json_object_fields tool json in
  let* session_id = Shared.json_required_int tool fields "session_id" in
  let* chars = Shared.json_string_default tool fields "chars" "" in
  let* yield_time_ms = Shared.json_optional_number tool fields "yield_time_ms" in
  let* max_output_tokens = Shared.json_optional_number tool fields "max_output_tokens" in
  Ok
    ({
       session_id;
       chars;
       yield_time_ms;
       max_output_tokens;
     } : write_stdin_request)

let write_request_of_json json : (write_request, string) result =
  let tool = "write" in
  let* fields = Shared.json_object_fields tool json in
  let* path = Shared.json_required_string tool fields "path" in
  let* path = non_empty_field tool "path" path in
  let* contents = Shared.json_required_string tool fields "content" in
  Ok { path; contents }

let edit_replacement_of_fields tool index fields =
  let path = Printf.sprintf "%s.edits[%d]" tool index in
  let* old_text = Shared.json_required_string path fields "oldText" in
  let* new_text = Shared.json_required_string path fields "newText" in
  Ok { Sandbox.old_text; new_text }

let edit_replacements_of_json tool fields =
  let* entries = Shared.json_required_object_list tool fields "edits" in
  match entries with
  | [] -> Error (tool ^ ".edits must contain at least one replacement")
  | _ ->
      let rec loop acc index = function
        | [] -> Ok (List.rev acc)
        | fields :: rest ->
            let* edit = edit_replacement_of_fields tool index fields in
            loop (edit :: acc) (index + 1) rest
      in
      loop [] 0 entries

let edit_request_of_json json : (edit_request, string) result =
  let tool = "edit" in
  let* fields = Shared.json_object_fields tool json in
  let* path = Shared.json_required_string tool fields "path" in
  let* path = non_empty_field tool "path" path in
  let* edits = edit_replacements_of_json tool fields in
  Ok { path; edits }

let patch_request_of_json json : (patch_request, string) result =
  let tool = "apply_patch" in
  match json with
  | Shared.String patch -> Ok { patch }
  | _ ->
      let* fields = Shared.json_object_fields tool json in
      let* input = Shared.json_optional_string tool fields "input" in
      let* patch_field = Shared.json_optional_string tool fields "patch" in
      let patch =
        match input with
        | Some value when value <> "" -> Some value
        | _ -> patch_field
      in
      (match patch with
      | Some patch -> Ok { patch }
      | None -> Error "apply_patch.input or apply_patch.patch is required")

let plan_exec (sandbox : Sandbox.config) (request : exec_request) =
  let cmd = request.cmd in
  if String.trim cmd = "" then Error "exec_command requires cmd"
  else
    let workdir = if request.workdir = "" then request.default_workdir else request.workdir in
    let sandbox_request =
      {
        Sandbox.cmd;
        workdir = (if workdir = "" then None else Some workdir);
        sandbox_permissions = request.sandbox_permissions;
      }
    in
    let base action approval =
      {
        action;
        cmd;
        workdir;
        yield_time_ms = request.yield_time_ms;
        max_output_tokens = request.max_output_tokens;
        tty = request.tty;
        shell = request.shell;
        login = request.login;
        approval;
      }
    in
    match Sandbox.authorize_exec sandbox sandbox_request with
    | Sandbox.Allow -> Ok (base "exec_command" None)
    | Requires_approval message ->
        let prompt = Sandbox.exec_approval_prompt ~cmd message in
        Ok
          (base "exec_command_approval"
             (Some (approval ~message "exec_command" prompt)))
    | Deny message -> Error message

let plan_write_stdin (request : write_stdin_request) =
  if request.session_id < 0 then Error "write_stdin requires session_id"
  else
    Ok
      {
        session_id = request.session_id;
        chars = request.chars;
        yield_time_ms = request.yield_time_ms;
        max_output_tokens = request.max_output_tokens;
      }

let resolved_mutation_plan ?contents ?(edits = []) ?approval action path
    (sandbox : Sandbox.config) =
  {
    action;
    workspace_roots = sandbox.Sandbox.workspace_roots;
    validate_workspace_paths =
      Sandbox.requires_resolved_workspace_mutation_validation sandbox;
    path = Sandbox.resolve_workspace_path sandbox path;
    display_path = path;
    contents;
    edits;
    approval;
  }

let filesystem_approval action path =
  Sandbox.filesystem_approval_prompt ~tool:action ~path |> approval action

let plan_write (sandbox : Sandbox.config) (request : write_request) =
  let path = request.path in
  let contents = request.contents in
  let resolved = Sandbox.resolve_workspace_path sandbox path in
  match Sandbox.authorize_mutation_path sandbox Sandbox.Write resolved with
  | Allow -> Ok (resolved_mutation_plan ~contents "write" path sandbox)
  | Requires_approval _ ->
      Ok
        (resolved_mutation_plan ~contents
           ~approval:(filesystem_approval "write" path)
           "write_approval" path sandbox)
  | Deny message -> Error message

let plan_edit (sandbox : Sandbox.config) (request : edit_request) =
  let path = request.path in
  let resolved = Sandbox.resolve_workspace_path sandbox path in
  match Sandbox.authorize_mutation_path sandbox Sandbox.Write resolved with
  | Allow -> Ok (resolved_mutation_plan ~edits:request.edits "edit" path sandbox)
  | Requires_approval _ ->
      Ok
        (resolved_mutation_plan ~edits:request.edits
           ~approval:(filesystem_approval "edit" path)
           "edit_approval" path sandbox)
  | Deny message -> Error message

let resolved_patch_paths (sandbox : Sandbox.config) parsed =
  Sandbox.Patch.affected_paths parsed
  |> List.sort_uniq String.compare
  |> List.map (Sandbox.resolve_workspace_path sandbox)

let plan_apply_patch (sandbox : Sandbox.config) request =
  match Sandbox.Patch.parse request.patch with
  | Error _ as error -> error
  | Ok parsed -> (
      match Sandbox.authorize_patch sandbox parsed with
      | Allow ->
          Ok
            {
              action = "apply_patch";
              workspace_roots = sandbox.workspace_roots;
              validate_workspace_paths =
                Sandbox.requires_resolved_workspace_mutation_validation sandbox;
              affected_paths = resolved_patch_paths sandbox parsed;
              approval = None;
            }
      | Requires_approval _ ->
          let paths =
            Sandbox.Patch.affected_paths parsed |> List.sort_uniq String.compare
          in
          Ok
            {
              action = "apply_patch_approval";
              workspace_roots = sandbox.workspace_roots;
              validate_workspace_paths =
                Sandbox.requires_resolved_workspace_mutation_validation sandbox;
              affected_paths =
                List.map (Sandbox.resolve_workspace_path sandbox) paths;
              approval =
                Some
                  (filesystem_approval "apply_patch" (String.concat "\n" paths));
            }
      | Deny message -> Error message)

let remap_files_to_original_paths (sandbox : Sandbox.config) parsed files =
  Sandbox.Patch.affected_paths parsed
  |> List.fold_left
       (fun acc original ->
         let resolved = Sandbox.resolve_workspace_path sandbox original in
         match Shared.String_map.find_opt resolved files with
         | Some contents -> Shared.String_map.add original contents acc
         | None -> acc)
       Shared.String_map.empty

let action_paths actions =
  actions
  |> List.map (function
       | Sandbox.Patch.Write_file path -> path
       | Sandbox.Patch.Delete_path path -> path)
  |> List.sort_uniq String.compare

let apply_patch_to_files ~approved (sandbox : Sandbox.config) request files =
  match Sandbox.Patch.parse request.patch with
  | Error _ as error -> error
  | Ok parsed -> (
      match Sandbox.authorize_patch ~approved sandbox parsed with
      | Requires_approval message -> Error ("approval required: " ^ message)
      | Deny message -> Error message
      | Allow -> (
          let input = remap_files_to_original_paths sandbox parsed files in
          match Sandbox.Patch.apply_to_map input parsed with
          | Error _ as error -> error
          | Ok output ->
              let resolve = Sandbox.resolve_workspace_path sandbox in
              let actions = Sandbox.Patch.affected_actions parsed in
              let deletes =
                actions
                |> List.filter_map (function
                     | Sandbox.Patch.Delete_path path -> Some (resolve path)
                     | Sandbox.Patch.Write_file _ -> None)
                |> List.sort_uniq String.compare
              in
              let write_pairs =
                actions
                |> List.filter_map (function
                     | Sandbox.Patch.Write_file path -> Some (path, resolve path)
                     | Sandbox.Patch.Delete_path _ -> None)
                |> List.sort_uniq (fun (left, _) (right, _) ->
                       String.compare left right)
              in
              let rec collect acc = function
                | [] ->
                    Ok
                      {
                        deletes;
                        writes = List.rev acc;
                        affected_paths = action_paths actions |> List.map resolve;
                      }
                | (original, resolved) :: rest -> (
                    match Shared.String_map.find_opt original output with
                    | None ->
                        Error
                          ("apply_patch internal error: missing contents for "
                         ^ original)
                    | Some contents -> collect ((resolved, contents) :: acc) rest)
              in
              collect [] write_pairs))
