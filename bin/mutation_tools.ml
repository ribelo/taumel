open Jsoo_bridge
open Sandbox_bridge
open App_state

let decode_params params decode =
  match Result.bind (json_from_js params) decode with
  | Ok request -> Ok request
  | Error message -> Error message

let decode_error = error_obj

let js_optional_number = function
  | None -> Unsafe.inject Js.null
  | Some value -> js_number value

let prepare_exec_command params =
  with_gateway_authorized "exec_command" (fun sandbox ->
      match
        decode_params params
          (Taumel.Mutation_plan.exec_request_of_json ~default_workdir:state.cwd)
      with
      | Error message -> decode_error message
      | Ok request -> (
      match Taumel.Mutation_plan.plan_exec sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          let fields =
            [
              ("action", js_string plan.action);
              ("cmd", js_string plan.cmd);
              ("workdir", js_string plan.workdir);
              ("yieldTimeMs", js_optional_number plan.yield_time_ms);
              ("maxOutputTokens", js_optional_number plan.max_output_tokens);
              ("tty", js_bool plan.tty);
              ("shell", js_string plan.shell);
              ("login", js_bool plan.login);
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
      )

let prepare_write_stdin params =
  with_gateway_authorized "write_stdin" (fun _sandbox ->
      match
        decode_params params Taumel.Mutation_plan.write_stdin_request_of_json
      with
      | Error message -> decode_error message
      | Ok request -> (
      match Taumel.Mutation_plan.plan_write_stdin request with
      | Error message -> error_obj message
      | Ok plan ->
          ok_obj
            [
              ("action", js_string "write_stdin");
              ("sessionId", js_number (float_of_int plan.session_id));
              ("chars", js_string plan.chars);
              ("yieldTimeMs", js_optional_number plan.yield_time_ms);
              ("maxOutputTokens", js_optional_number plan.max_output_tokens);
            ])
      )

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
      match decode_params params Taumel.Mutation_plan.write_request_of_json with
      | Error message -> decode_error message
      | Ok request -> (
      match Taumel.Mutation_plan.plan_write sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          render_mutation_plan plan
            [
              ( "contents",
                js_string (Option.value plan.contents ~default:"") );
            ])
      )

let prepare_edit params =
  with_gateway_profile_authorized "edit" (fun sandbox ->
      match decode_params params Taumel.Mutation_plan.edit_request_of_json with
      | Error message -> decode_error message
      | Ok request -> (
      match Taumel.Mutation_plan.plan_edit sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          render_mutation_plan plan
            [ ("edits", js_array (List.map js_edit_replacement plan.edits)) ])
      )

let apply_edit_to_file prepared contents =
  match
    decode_params prepared Taumel.Mutation_plan.edit_request_of_json
  with
  | Error message -> error_obj message
  | Ok request -> (
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
            ])

let prepare_apply_patch params =
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match decode_params params Taumel.Mutation_plan.patch_request_of_json with
      | Error message -> decode_error message
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
            | Some approval -> js_approval_fields approval))
      )

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
      match
        decode_params params Taumel.Mutation_plan.patch_request_of_json
      with
      | Error message -> decode_error message
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
            ])
      )
