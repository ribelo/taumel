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
  max_output_tokens : int option;
  tty : bool;
}

type exec_plan = {
  action : string;
  cmd : string;
  workdir : string;
  yield_time_ms : float option;
  max_output_tokens : int option;
  tty : bool;
  approval : approval option;
}

type write_stdin_request = {
  session_id : int;
  chars : string;
  yield_time_ms : float option;
  max_output_tokens : int option;
  output_mode : string;
}

type write_stdin_plan = {
  session_id : int;
  chars : string;
  yield_time_ms : float option;
  max_output_tokens : int option;
  output_mode : string;
}

type write_request = {
  path : string;
  contents : string;
  mode : string;
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

let patch_request_of_values ?input ?patch () =
  let patch =
    match input with
    | Some value when value <> "" -> Some value
    | _ -> patch
  in
  match patch with
  | Some patch -> Ok { patch }
  | None -> Error "apply_patch.input or apply_patch.patch is required"

let plan_exec ?policy_decision ?policy_message (sandbox : Sandbox.config) (request : exec_request) =
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
        approval;
      }
    in
    match Sandbox.authorize_exec ?policy_decision ?policy_message sandbox sandbox_request with
    | Sandbox.Allow -> Ok (base "exec_command" None)
    | Requires_approval message ->
        let prompt = Sandbox.exec_approval_prompt ~cmd message in
        Ok
          (base "exec_command_approval"
             (Some (approval ~message "exec_command" prompt)))
    | Deny message -> Error message

let plan_write_stdin (request : write_stdin_request) =
  if request.session_id < 0 then Error "write_stdin requires session_id"
  else if request.output_mode = "status" && request.chars <> "" then
    Error "write_stdin output_mode=status requires empty chars"
  else
    Ok
      {
        session_id = request.session_id;
        chars = request.chars;
        yield_time_ms = request.yield_time_ms;
        max_output_tokens = request.max_output_tokens;
        output_mode = request.output_mode;
      }

let resolved_mutation_plan ?contents ?(edits = []) ?approval ?auth_path action path
    (sandbox : Sandbox.config) =
  {
    action;
    workspace_roots = sandbox.Sandbox.workspace_roots;
    validate_workspace_paths =
      Sandbox.requires_resolved_workspace_mutation_validation sandbox;
    path = Sandbox.resolve_mutation_path ?auth_path sandbox path;
    display_path = path;
    contents;
    edits;
    approval;
  }

let filesystem_approval action path =
  Sandbox.filesystem_approval_prompt ~tool:action ~path |> approval action

let plan_write ?auth_path ?auth_roots (sandbox : Sandbox.config)
    (request : write_request) =
  let path = request.path in
  let contents = request.contents in
  match Sandbox.authorize_mutation_path ?auth_path ?auth_roots sandbox Sandbox.Write path with
  | Allow -> Ok (resolved_mutation_plan ~contents ?auth_path "write" path sandbox)
  | Requires_approval _ ->
      Ok
        (resolved_mutation_plan ~contents ?auth_path
           ~approval:(filesystem_approval "write" path)
           "write_approval" path sandbox)
  | Deny message -> Error message

let plan_edit ?auth_path ?auth_roots (sandbox : Sandbox.config)
    (request : edit_request) =
  let path = request.path in
  match Sandbox.authorize_mutation_path ?auth_path ?auth_roots sandbox Sandbox.Write path with
  | Allow ->
      Ok (resolved_mutation_plan ~edits:request.edits ?auth_path "edit" path sandbox)
  | Requires_approval _ ->
      Ok
        (resolved_mutation_plan ~edits:request.edits ?auth_path
           ~approval:(filesystem_approval "edit" path)
           "edit_approval" path sandbox)
  | Deny message -> Error message

let authorization_path auth_paths path =
  List.assoc_opt path auth_paths

let resolved_patch_paths ?(auth_paths = []) (sandbox : Sandbox.config) parsed =
  Sandbox.Patch.affected_paths parsed
  |> List.sort_uniq String.compare
  |> List.map (fun path ->
         Sandbox.resolve_mutation_path
           ?auth_path:(authorization_path auth_paths path)
           sandbox path)

let plan_apply_patch ?(auth_paths = []) ?auth_roots (sandbox : Sandbox.config) request =
  match Sandbox.Patch.parse request.patch with
  | Error _ as error -> error
  | Ok parsed -> (
      match Sandbox.authorize_patch ~auth_paths ?auth_roots sandbox parsed with
      | Allow ->
          Ok
            {
              action = "apply_patch";
              workspace_roots = sandbox.workspace_roots;
              validate_workspace_paths =
                Sandbox.requires_resolved_workspace_mutation_validation sandbox;
              affected_paths = resolved_patch_paths ~auth_paths sandbox parsed;
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
                List.map
                  (fun path ->
                    Sandbox.resolve_mutation_path
                      ?auth_path:(authorization_path auth_paths path)
                      sandbox path)
                  paths;
              approval =
                Some
                  (filesystem_approval "apply_patch" (String.concat "\n" paths));
            }
      | Deny message -> Error message)

let remap_files_to_original_paths ?(auth_paths = []) (sandbox : Sandbox.config)
    parsed files =
  Sandbox.Patch.affected_paths parsed
  |> List.fold_left
       (fun acc original ->
         let resolved =
           Sandbox.resolve_mutation_path
             ?auth_path:(authorization_path auth_paths original)
             sandbox original
         in
         match Shared.String_map.find_opt resolved files with
         | Some contents -> Shared.String_map.add original contents acc
         | None -> (
             match Shared.String_map.find_opt (Sandbox.resolve_workspace_path sandbox original) files with
             | Some contents -> Shared.String_map.add original contents acc
             | None -> acc))
       Shared.String_map.empty

let action_paths actions =
  actions
  |> List.map (function
       | Sandbox.Patch.Write_file path -> path
       | Sandbox.Patch.Delete_path path -> path)
  |> List.sort_uniq String.compare

let apply_patch_to_files ~approved ?(auth_paths = []) ?auth_roots
    (sandbox : Sandbox.config) request files =
  match Sandbox.Patch.parse request.patch with
  | Error _ as error -> error
  | Ok parsed -> (
      match Sandbox.authorize_patch ~approved ~auth_paths ?auth_roots sandbox parsed with
      | Requires_approval message -> Error ("approval required: " ^ message)
      | Deny message -> Error message
      | Allow -> (
          let input = remap_files_to_original_paths ~auth_paths sandbox parsed files in
          match Sandbox.Patch.apply_to_map input parsed with
          | Error _ as error -> error
          | Ok output ->
              let resolve path =
                Sandbox.resolve_mutation_path
                  ?auth_path:(authorization_path auth_paths path)
                  sandbox path
              in
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
