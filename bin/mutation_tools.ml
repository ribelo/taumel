open Jsoo_bridge
open Sandbox_bridge
open App_state

let js_optional_number = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_number value

let opt_string_default default = function Some value -> value | None -> default
let opt_bool_default default = function Some value -> value | None -> default

let exec_request_from_params params =
  let params = Tool_contracts.ExecCommandParams.t_of_js (ojs_of_js params) in
  let sandbox_permissions =
    match Tool_contracts.ExecCommandParams.get_sandbox_permissions params with
    | Some "require_escalated" ->
        let justification =
          opt_string_default "command requested escalation"
            (Tool_contracts.ExecCommandParams.get_justification params)
        in
        let prefix_rule =
          match Tool_contracts.ExecCommandParams.get_prefix_rule params with
          | Some (_ :: _ as values) -> Some values
          | Some [] | None -> None
        in
        Taumel.Sandbox.Require_escalated { justification; prefix_rule }
    | _ -> Taumel.Sandbox.Use_default
  in
  ({
     Taumel.Mutation_plan.cmd =
       Tool_contracts.ExecCommandParams.get_cmd params;
     workdir =
       opt_string_default ""
         (Tool_contracts.ExecCommandParams.get_workdir params);
     default_workdir = state.cwd;
     sandbox_permissions;
     yield_time_ms = Tool_contracts.ExecCommandParams.get_yield_time_ms params;
     tty =
       opt_bool_default false (Tool_contracts.ExecCommandParams.get_tty params);
   }
    : Taumel.Mutation_plan.exec_request)

let write_stdin_request_from_params params =
  let params = Tool_contracts.WriteStdinParams.t_of_js (ojs_of_js params) in
  ({
     Taumel.Mutation_plan.session_id =
       int_of_float (Tool_contracts.WriteStdinParams.get_session_id params);
     chars =
       opt_string_default "" (Tool_contracts.WriteStdinParams.get_chars params);
     yield_time_ms = Tool_contracts.WriteStdinParams.get_yield_time_ms params;
   }
    : Taumel.Mutation_plan.write_stdin_request)

let write_request_from_params params =
  let params = Tool_contracts.WriteParams.t_of_js (ojs_of_js params) in
  ({
     Taumel.Mutation_plan.path = Tool_contracts.WriteParams.get_path params;
     contents = Tool_contracts.WriteParams.get_content params;
     mode =
       (match Tool_contracts.WriteParams.get_mode params with
        | Some "append" -> "append"
        | _ -> "overwrite");
   }
    : Taumel.Mutation_plan.write_request)

let edit_replacement_from_params edit =
  ({
     Taumel.Sandbox.old_text = Tool_contracts.EditReplacement.get_oldText edit;
     new_text = Tool_contracts.EditReplacement.get_newText edit;
   }
    : Taumel.Sandbox.edit_replacement)

let edit_request_from_params params =
  let params = Tool_contracts.EditParams.t_of_js (ojs_of_js params) in
  ({
     Taumel.Mutation_plan.path = Tool_contracts.EditParams.get_path params;
     edits =
       List.map edit_replacement_from_params
         (Tool_contracts.EditParams.get_edits params);
   }
    : Taumel.Mutation_plan.edit_request)

let patch_request_from_params params =
  let params = Tool_contracts.ApplyPatchParams.t_of_js (ojs_of_js params) in
  Taumel.Mutation_plan.patch_request_of_values
    ?input:(Tool_contracts.ApplyPatchParams.get_input params)
    ?patch:(Tool_contracts.ApplyPatchParams.get_patch params)
    ()

let prepare_exec_command params =
  with_gateway_authorized "exec_command" (fun sandbox ->
      let request = exec_request_from_params params in
      match Taumel.Mutation_plan.plan_exec sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          let fields =
            [
              ("action", js_string plan.action);
              ("cmd", js_string plan.cmd);
              ("workdir", js_string plan.workdir);
              ("yieldTimeMs", js_optional_number plan.yield_time_ms);
              ("tty", js_bool plan.tty);
              ("sandbox", inject (js_sandbox_config sandbox));
            ]
          in
          let fields =
            match plan.approval with
            | None -> fields
            | Some approval ->
                fields
                @ [
                    ("approvalMessage", js_string approval.message);
                    ("approvalTitle", js_string approval.title);
                    ("approvalPrompt", js_string approval.prompt);
                    ( "approvalTimeoutMs",
                      js_number (float_of_int approval.timeout_ms) );
                  ]
          in
          ok_obj fields)

let prepare_write_stdin params =
  with_gateway_authorized "write_stdin" (fun _sandbox ->
      let request = write_stdin_request_from_params params in
      match Taumel.Mutation_plan.plan_write_stdin request with
      | Error message -> error_obj message
      | Ok plan ->
          ok_obj
            [
              ("action", js_string "write_stdin");
              ("sessionId", js_number (float_of_int plan.session_id));
              ("chars", js_string plan.chars);
              ("yieldTimeMs", js_optional_number plan.yield_time_ms);
            ])

let js_edit_replacement (edit : Taumel.Sandbox.edit_replacement) =
  Unsafe.obj
    [|
      ("oldText", js_string edit.old_text);
      ("newText", js_string edit.new_text);
    |]

let js_approval_fields (approval : Taumel.Mutation_plan.approval) =
  [
    ("approvalAction", js_string approval.action);
    ("approvalTitle", js_string approval.title);
    ("approvalPrompt", js_string approval.prompt);
    ("approvalTimeoutMs", js_number (float_of_int approval.timeout_ms));
  ]

let render_mutation_plan (plan : Taumel.Mutation_plan.mutation_plan) fields =
  ok_obj
    ([
       ("action", js_string plan.action);
       ("workspaceRoots", js_array (List.map js_string plan.workspace_roots));
       ("validateWorkspacePaths", js_bool plan.validate_workspace_paths);
       ("path", js_string plan.path);
       ("displayPath", js_string plan.display_path);
     ]
    @ fields
    @
    match plan.approval with
    | None -> []
    | Some approval -> js_approval_fields approval)

let prepare_write params =
  with_gateway_profile_authorized "write" (fun sandbox ->
      let request = write_request_from_params params in
      match Taumel.Mutation_plan.plan_write sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          render_mutation_plan plan
            [
              ( "contents",
                js_string (Option.value plan.contents ~default:"") );
              ("mode", js_string request.mode);
            ])

let prepare_read params =
  with_gateway_authorized "read" (fun _sandbox ->
      let params = Tool_contracts.ReadParams.t_of_js (ojs_of_js params) in
      let path = Tool_contracts.ReadParams.get_path params in
      if String.trim path = "" then error_obj "read requires a non-empty path"
      else
        let int_opt = function
          | Some value -> [ value ]
          | None -> []
        in
        let offset = Tool_contracts.ReadParams.get_offset params in
        let limit = Tool_contracts.ReadParams.get_limit params in
        ok_obj
          ([
             ("action", js_string "read");
             ("path", js_string path);
           ]
          @ List.map (fun v -> ("offset", js_number v)) (int_opt offset)
          @ List.map (fun v -> ("limit", js_number v)) (int_opt limit)))

let prepare_edit params =
  with_gateway_profile_authorized "edit" (fun sandbox ->
      let request = edit_request_from_params params in
      match Taumel.Mutation_plan.plan_edit sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          render_mutation_plan plan
            [ ("edits", js_array (List.map js_edit_replacement plan.edits)) ])

let apply_edit_to_file prepared contents =
  let request = edit_request_from_params prepared in
  let path = request.path in
  let display_path =
    match optional_string_field prepared "displayPath" with
    | Some value when String.trim value <> "" -> value
    | _ -> path
  in
  match Taumel.Sandbox.apply_edits ~display_path contents request.edits with
  | Error message -> error_obj message
  | Ok contents ->
      ok_obj
        [
          ("action", js_string "edit");
          ("path", js_string path);
          ("displayPath", js_string display_path);
          ("contents", js_string contents);
          ("editCount", js_number (float_of_int (List.length request.edits)));
        ]

let prepare_apply_patch params =
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match patch_request_from_params params with
      | Error message -> error_obj message
      | Ok request -> (
          match Taumel.Mutation_plan.plan_apply_patch sandbox request with
          | Error message -> error_obj message
          | Ok plan ->
              ok_obj
                ([
                   ("workspaceRoots", js_array (List.map js_string plan.workspace_roots));
                   ("validateWorkspacePaths", js_bool plan.validate_workspace_paths);
                   ("action", js_string plan.action);
                   ("affectedPaths", js_array (List.map js_string plan.affected_paths));
                 ]
                @
                match plan.approval with
                | None -> []
                | Some approval -> js_approval_fields approval)))

let files_map_from_js obj =
  object_keys obj
  |> List.fold_left
       (fun map path ->
         let contents =
           Option.value (string_value (Unsafe.get obj path)) ~default:""
         in
         Taumel.Shared.String_map.add path contents map)
       Taumel.Shared.String_map.empty

let apply_patch_to_files params files ctx approval =
  Session_sync.sync_session_from_host ~scope:"apply_patch files" ctx;
  let approved =
    get_bool approval "approved" || get_bool approval "filesystemApproval"
  in
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match patch_request_from_params params with
      | Error message -> error_obj message
      | Ok request -> (
          match
            Taumel.Mutation_plan.apply_patch_to_files ~approved sandbox request
              (files_map_from_js files)
          with
          | Error message -> error_obj message
          | Ok output ->
              let write_objects =
                output.writes
                |> List.map (fun (path, contents) ->
                       Unsafe.obj
                         [|
                           ("path", js_string path);
                           ("contents", js_string contents);
                         |])
              in
              ok_obj
                [
                  ("action", js_string "apply_patch");
                  ("deletes", js_array (List.map js_string output.deletes));
                  ("writes", js_array write_objects);
                  ( "affectedPaths",
                    js_array (List.map js_string output.affected_paths) );
                ]))
