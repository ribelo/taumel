open Jsoo_bridge
open Sandbox_bridge
open App_state
open Runtime_access

let js_optional_number_field name = function
  | None -> []
  | Some value -> [ (name, js_number value) ]

let opt_string_default default = function Some value -> value | None -> default
let opt_bool_default default = function Some value -> value | None -> default

let resolve_authorization_path path =
  try
    match
      string_value
        (call1 (active_host_or_empty ()) "resolveAuthorizationPath" (js_string path))
    with
    | Some resolved when String.trim resolved <> "" -> Ok resolved
    | Some _ | None ->
        Error
          ("path authorization failed for " ^ path
         ^ ": host returned an empty path")
  with error ->
    Error
      ("path authorization failed for " ^ path ^ ": "
      ^ Printexc.to_string error)

let authorization_roots (sandbox : Taumel.Sandbox.config) =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | root :: rest -> (
        match resolve_authorization_path root with
        | Ok resolved -> loop (resolved :: acc) rest
        | Error _ as error -> error)
  in
  loop [] sandbox.workspace_roots

let path_authorization (sandbox : Taumel.Sandbox.config) path =
  let requested = Taumel.Sandbox.resolve_workspace_path sandbox path in
  match (resolve_authorization_path requested, authorization_roots sandbox) with
  | Ok auth_path, Ok auth_roots -> Ok (auth_path, auth_roots)
  | Error _ as error, _ | _, (Error _ as error) -> error

let patch_authorization (sandbox : Taumel.Sandbox.config) patch =
  match Taumel.Sandbox.Patch.parse patch with
  | Error _ as error -> error
  | Ok parsed -> (
      let paths =
        Taumel.Sandbox.Patch.affected_paths parsed
        |> List.sort_uniq String.compare
      in
      let rec resolve acc = function
        | [] -> Ok (List.rev acc)
        | path :: rest -> (
            let requested =
              Taumel.Sandbox.resolve_workspace_path sandbox path
            in
            match resolve_authorization_path requested with
            | Ok auth_path -> resolve ((path, auth_path) :: acc) rest
            | Error _ as error -> error)
      in
      match (resolve [] paths, authorization_roots sandbox) with
      | Ok auth_paths, Ok auth_roots -> Ok (auth_paths, auth_roots)
      | Error _ as error, _ | _, (Error _ as error) -> error)

let exec_request_from_params params =
  let params = Tool_contracts.ExecCommandParams.t_of_js (ojs_of_js params) in
  let sandbox_permissions =
    match Tool_contracts.ExecCommandParams.get_with_escalated_permissions params with
    | Some true ->
        let justification =
          opt_string_default "command requested escalation"
            (Tool_contracts.ExecCommandParams.get_justification params)
        in
        Taumel.Sandbox.Require_escalated { justification; prefix_rule = None }
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
     max_output_tokens =
       Option.map int_of_float
         (Tool_contracts.ExecCommandParams.get_max_output_tokens params);
     tty = true;
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
     max_output_tokens =
       Option.map int_of_float
         (Tool_contracts.WriteStdinParams.get_max_output_tokens params);
     output_mode =
       (match Tool_contracts.WriteStdinParams.get_output_mode params with
        | Some "status" -> "status"
        | _ -> "delta");
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
      let policy_decision =
        Exec_policy_bridge.policy_decision_for_command sandbox request.sandbox_permissions
          request.cmd
      in
      let policy_message =
        Exec_policy_bridge.policy_reason_for_command sandbox request.sandbox_permissions
          request.cmd
      in
      match Taumel.Mutation_plan.plan_exec ?policy_decision ?policy_message sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          let fields =
            [
              ("action", js_string plan.action);
              ("cmd", js_string plan.cmd);
              ("workdir", js_string plan.workdir);
              ("tty", js_bool plan.tty);
              ("sandbox", inject (js_sandbox_config sandbox));
            ]
            @ js_optional_number_field "yieldTimeMs" plan.yield_time_ms
            @ (match plan.max_output_tokens with
              | None -> []
              | Some value -> [ ("maxOutputTokens", js_number (float_of_int value)) ])
          in
          let fields =
            match plan.approval with
            | None -> fields
            | Some approval ->
                let allow_amendment_fields =
                  if not (String.starts_with ~prefix:"exec policy requires approval" approval.message) then []
                  else if Exec_policy_bridge.explicit_prompt_or_forbidden request.cmd then []
                  else
                    match Exec_policy_bridge.allow_amendment_tokens request.cmd with
                    | None -> []
                    | Some tokens ->
                        [
                          ("execPolicyAllowAlwaysTokens", js_array (List.map js_string tokens));
                        ]
                in
                fields
                @ [
                    ("approvalMessage", js_string approval.message);
                    ("approvalTitle", js_string approval.title);
                    ("approvalPrompt", js_string approval.prompt);
                    ( "approvalTimeoutMs",
                      js_number (float_of_int approval.timeout_ms) );
                  ]
                @ allow_amendment_fields
          in
          ok_obj fields)

let prepare_write_stdin params =
  with_gateway_authorized "write_stdin" (fun _sandbox ->
      let request = write_stdin_request_from_params params in
      match Taumel.Mutation_plan.plan_write_stdin request with
      | Error message -> error_obj message
      | Ok plan ->
          ok_obj
            ([
               ("action", js_string "write_stdin");
               ("sessionId", js_number (float_of_int plan.session_id));
               ("chars", js_string plan.chars);
               ("outputMode", js_string plan.output_mode);
             ]
            @ js_optional_number_field "yieldTimeMs" plan.yield_time_ms
            @ (match plan.max_output_tokens with
              | None -> []
              | Some value -> [ ("maxOutputTokens", js_number (float_of_int value)) ])))

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
      match path_authorization sandbox request.path with
      | Error message -> error_obj message
      | Ok (auth_path, auth_roots) -> (
          match
            Taumel.Mutation_plan.plan_write ~auth_path ~auth_roots sandbox
              request
          with
          | Error message -> error_obj message
          | Ok plan ->
              render_mutation_plan plan
                [
                  ( "contents",
                    js_string (Option.value plan.contents ~default:"") );
                  ("mode", js_string request.mode);
                ]))

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
      match path_authorization sandbox request.path with
      | Error message -> error_obj message
      | Ok (auth_path, auth_roots) -> (
          match
            Taumel.Mutation_plan.plan_edit ~auth_path ~auth_roots sandbox request
          with
          | Error message -> error_obj message
          | Ok plan ->
              render_mutation_plan plan
                [ ("edits", js_array (List.map js_edit_replacement plan.edits)) ]))

let apply_edit_to_file raw_facts =
  let facts = Tool_contracts.EditApplicationFacts.t_of_js (ojs_of_js raw_facts) in
  let prepared = Tool_contracts.EditApplicationFacts.get_prepared facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  let contents = Tool_contracts.EditApplicationFacts.get_contents facts in
  let request = edit_request_from_params prepared in
  let path = request.path in
  let display_path =
    match optional_string_field prepared "displayPath" with
    | Some value when String.trim value <> "" -> value
    | _ -> path
  in
  match Taumel.Sandbox.apply_edits ~display_path contents request.edits with
  | Error message ->
      Tool_contracts.MutationError.create ~kind:"error" ~message ()
      |> Tool_contracts.MutationError.t_to_js |> inject
  | Ok contents ->
      Tool_contracts.EditApplied.create ~kind:"applied" ~path ~displayPath:display_path
        ~contents ~editCount:(float_of_int (List.length request.edits)) ()
      |> Tool_contracts.EditApplied.t_to_js |> inject

let prepare_apply_patch params =
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match patch_request_from_params params with
      | Error message -> error_obj message
      | Ok request -> (
          match patch_authorization sandbox request.patch with
          | Error message -> error_obj message
          | Ok (auth_paths, auth_roots) -> (
              match
                Taumel.Mutation_plan.plan_apply_patch ~auth_paths ~auth_roots
                  sandbox request
              with
              | Error message -> error_obj message
              | Ok plan ->
                  ok_obj
                    ([
                       ( "workspaceRoots",
                         js_array (List.map js_string plan.workspace_roots) );
                       ( "validateWorkspacePaths",
                         js_bool plan.validate_workspace_paths );
                       ("action", js_string plan.action);
                       ( "affectedPaths",
                         js_array (List.map js_string plan.affected_paths) );
                       ("patch", js_string request.patch);
                     ]
                    @
                    match plan.approval with
                    | None -> []
                    | Some approval -> js_approval_fields approval))))

let files_map_from_js obj =
  object_keys obj
  |> List.fold_left
       (fun map path ->
         let contents =
           Option.value (string_value (Unsafe.get obj path)) ~default:""
         in
         Taumel.Shared.String_map.add path contents map)
       Taumel.Shared.String_map.empty

let apply_patch_to_files raw_facts =
  let facts = Tool_contracts.PatchApplicationFacts.t_of_js (ojs_of_js raw_facts) in
  let params = Tool_contracts.PatchApplicationFacts.get_params facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  let files = Tool_contracts.PatchApplicationFacts.get_files facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  let ctx = Tool_contracts.PatchApplicationFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  Session_sync.sync_session_from_host ~scope:"apply_patch files" ctx;
  let approved = Tool_contracts.PatchApplicationFacts.get_filesystemApproval facts in
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match patch_request_from_params params with
      | Error message ->
          Tool_contracts.MutationError.create ~kind:"error" ~message ()
          |> Tool_contracts.MutationError.t_to_js |> inject
      | Ok request -> (
          match patch_authorization sandbox request.patch with
          | Error message ->
              Tool_contracts.MutationError.create ~kind:"error" ~message ()
              |> Tool_contracts.MutationError.t_to_js |> inject
          | Ok (auth_paths, auth_roots) -> (
              match
                Taumel.Mutation_plan.apply_patch_to_files ~approved ~auth_paths
                  ~auth_roots sandbox request (files_map_from_js files)
              with
              | Error message ->
                  Tool_contracts.MutationError.create ~kind:"error" ~message ()
                  |> Tool_contracts.MutationError.t_to_js |> inject
              | Ok output ->
                  let write_objects =
                    output.writes
                    |> List.map (fun (path, contents) ->
                           Tool_contracts.PatchWrite.create ~path ~contents ())
                  in
                  Tool_contracts.PatchApplied.create ~kind:"applied"
                    ~deletes:output.deletes ~writes:write_objects
                    ~affectedPaths:output.affected_paths ()
                  |> Tool_contracts.PatchApplied.t_to_js |> inject)))
