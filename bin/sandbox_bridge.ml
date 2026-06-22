open Jsoo_bridge

let sandbox_network_to_string = function
  | Taumel.Sandbox.Network_enabled -> "enabled"
  | Taumel.Sandbox.Network_disabled -> "disabled"

let js_sandbox_config (sandbox : Taumel.Sandbox.config) =
  Unsafe.obj
    [|
      ( "filesystemMode",
        js_string (Taumel.Sandbox.filesystem_mode_to_string sandbox.filesystem_mode) );
      ("networkMode", js_string (sandbox_network_to_string sandbox.network_mode));
      ("workspaceRoots", js_array (List.map js_string sandbox.workspace_roots));
      ("noSandbox", js_bool sandbox.no_sandbox);
      ("subagent", js_bool sandbox.subagent);
    |]

let sandbox_config_from_js sandbox =
  let filesystem_mode =
    Taumel.Sandbox.filesystem_mode_of_string (get_string sandbox "filesystemMode")
    |> Option.value ~default:Taumel.Sandbox.Workspace_write
  in
  let network_mode =
    Taumel.Permissions.network_of_string (get_string sandbox "networkMode")
    |> Option.value ~default:Taumel.Sandbox.Network_disabled
  in
  {
    Taumel.Sandbox.filesystem_mode;
    workspace_roots = get_string_array sandbox "workspaceRoots";
    network_mode;
    approval_policy = Taumel.Sandbox.On_request;
    no_sandbox = get_bool sandbox "noSandbox";
    subagent = get_bool sandbox "subagent";
  }

let exec_workspace_metadata_listing_from_js obj =
  {
    Taumel.Sandbox.metadata_dir = get_string obj "metadataDir";
    path = get_string obj "path";
    children =
      (if has_property obj "children" then Some (get_string_array obj "children")
       else None);
  }

let exec_host_facts_from_js obj =
  {
    Taumel.Sandbox.platform = get_string obj "platform";
    temp_roots = get_string_array obj "tempRoots";
    system_ro_paths = get_string_array obj "systemRoPaths";
    home_mount = get_string obj "homeMount";
    workspace_roots = get_string_array obj "workspaceRoots";
    workspace_metadata_listings =
      get_object_array obj "workspaceMetadataListings"
      |> List.map exec_workspace_metadata_listing_from_js;
  }

let sandbox_metadata_dir_names () =
  js_array (List.map js_string Taumel.Sandbox.protected_workspace_dir_names)

let resolved_mutation_path_from_js obj =
  {
    Taumel.Sandbox.requested_path = get_string obj "path";
    resolved_path = get_string obj "resolvedPath";
  }

let validate_workspace_mutation_paths facts =
  let paths =
    get_object_array facts "paths" |> List.map resolved_mutation_path_from_js
  in
  match
    Taumel.Sandbox.validate_resolved_workspace_mutation_paths
      ~workspace_roots:(get_string_array facts "workspaceRoots")
      paths
  with
  | Ok () -> ok_obj []
  | Error message -> error_obj message

let sandbox_host_path_plan facts =
  let tmp_dir = get_string facts "tmpDir" in
  let env_tmp_dir = get_string facts "envTmpDir" in
  Unsafe.obj
    [|
      ( "tempRootCandidates",
        js_array
          (Taumel.Sandbox.temp_root_candidates ~tmp_dir ~env_tmp_dir
          |> List.map js_string) );
      ( "systemRoPathCandidates",
        js_array
          (List.map js_string Taumel.Sandbox.system_ro_path_candidates) );
    |]

let positive_float_option obj name =
  match float_field obj name with
  | Some value when value > 0.0 -> Some value
  | _ -> None

let exec_host_options_from_js prepared runtime =
  let shell =
    match optional_string_field prepared "shell" with
    | Some value when String.trim value <> "" -> String.trim value
    | _ -> (
        match optional_string_field runtime "envShell" with
        | Some value when String.trim value <> "" -> String.trim value
        | _ -> "bash")
  in
  let cwd =
    match optional_string_field prepared "workdir" with
    | Some value when String.trim value <> "" -> String.trim value
    | _ -> get_string runtime "defaultCwd"
  in
  {
    Taumel.Sandbox.cmd = get_string prepared "cmd";
    cwd;
    shell;
    login = (not (has_property prepared "login") || get_bool prepared "login");
    timeout_ms = positive_float_option prepared "timeout";
    yield_time_ms = positive_float_option prepared "yieldTimeMs";
    max_output_tokens = positive_float_option prepared "maxOutputTokens";
    tty = get_bool prepared "tty";
  }

let js_optional_float_field name = function
  | None -> []
  | Some value -> [ (name, js_number value) ]

let js_exec_host_call (call : Taumel.Sandbox.exec_host_call) =
  let option_fields =
    [ ("cwd", js_string call.cwd) ]
    @ js_optional_float_field "timeout" call.timeout_ms
    @ js_optional_float_field "yieldTimeMs" call.yield_time_ms
    @ js_optional_float_field "maxOutputTokens" call.max_output_tokens
    @ if call.tty then [ ("tty", js_bool true) ] else []
  in
  ok_obj
    [
      ("command", js_string call.invocation.command);
      ("args", js_array (List.map js_string call.invocation.args));
      ("options", Unsafe.obj (Array.of_list option_fields));
      ("sandboxed", js_bool call.invocation.sandboxed);
      ("escalated", js_bool call.escalated);
    ]

let planned_exec_host_call prepared host runtime force_unsandboxed =
  let sandbox = sandbox_config_from_js (Unsafe.get prepared "sandbox") in
  let host = exec_host_facts_from_js host in
  let options = exec_host_options_from_js prepared runtime in
  Taumel.Sandbox.plan_exec_host_call sandbox host options
    ~force_unsandboxed:(Js.to_bool (Unsafe.coerce force_unsandboxed))

let plan_exec_host_call prepared host runtime force_unsandboxed =
  match planned_exec_host_call prepared host runtime force_unsandboxed with
  | Ok call -> js_exec_host_call call
  | Error message -> error_obj message

let exec_result_from_js result =
  {
    Taumel.Sandbox.code = int_field_default result "code" 1;
    stdout = get_string result "stdout";
    stderr = get_string result "stderr";
  }

let format_exec_result prepared result sandboxed escalated =
  let sandbox = sandbox_config_from_js (Unsafe.get prepared "sandbox") in
  let sandboxed = Js.to_bool (Unsafe.coerce sandboxed) in
  let escalated = Js.to_bool (Unsafe.coerce escalated) in
  let result = exec_result_from_js result in
  let diagnostic =
    Taumel.Sandbox.failure_diagnostic
      ~filesystem_mode:sandbox.filesystem_mode
      ~network_mode:sandbox.network_mode ~sandboxed ~exit_code:result.code
      ~stdout:result.stdout ~stderr:result.stderr
  in
  text_result_with_details
    (Taumel.Sandbox.render_exec_result ?diagnostic result)
    (Taumel.Sandbox.exec_result_details ~sandboxed ~escalated ?diagnostic result)

let finish_exec_approval params =
  let outcome =
    match
      Taumel.Sandbox.approval_prompt_outcome_of_string
        (get_string params "outcome")
    with
    | Some outcome -> outcome
    | None ->
        if get_bool params "approved" then Taumel.Sandbox.Approval_approved
        else Taumel.Sandbox.Approval_denied_by_user
  in
  match Taumel.Sandbox.exec_approval_outcome ~outcome with
  | Taumel.Sandbox.Approval_granted ->
      ok_obj [ ("action", js_string "exec_command"); ("forceUnsandboxed", js_bool true) ]
  | Taumel.Sandbox.Approval_denied denied ->
      ok_obj
        [
          ("action", js_string "result");
          ( "result",
            text_result_with_details denied.message denied.details );
        ]

let plan_exec_approval_prompt prepared facts =
  let prompt =
    {
      Taumel.Sandbox.title = get_string prepared "approvalTitle";
      prompt = get_string prepared "approvalPrompt";
      timeout_ms = int_field_default prepared "approvalTimeoutMs" 0;
    }
  in
  match
    Taumel.Sandbox.plan_exec_approval_prompt
      ~ui_available:(get_bool facts "uiAvailable")
      prompt
  with
  | Taumel.Sandbox.Approval_prompt_unavailable ->
      ok_obj [ ("action", js_string "unavailable") ]
  | Taumel.Sandbox.Approval_prompt_confirm prompt ->
      let option_fields =
        if prompt.timeout_ms > 0 then
          [ ("timeout", js_number (float_of_int prompt.timeout_ms)) ]
        else []
      in
      ok_obj
        [
          ("action", js_string "confirm");
          ("title", js_string prompt.title);
          ("prompt", js_string prompt.prompt);
          ("options", Unsafe.obj (Array.of_list option_fields));
        ]

let optional_positive_float_js obj name =
  if not (has_property obj name) then None else positive_float_option obj name

let plan_write_stdin_host_call prepared facts =
  match int_field prepared "sessionId" with
  | None -> error_obj "write_stdin requires session_id"
  | Some session_id -> (
      let request =
        {
          Taumel.Sandbox.session_id;
          chars = get_string prepared "chars";
        }
      in
      match
        Taumel.Sandbox.plan_write_stdin_host_call
          ~host_available:(get_bool facts "hostAvailable")
          ?yield_time_ms:(optional_positive_float_js prepared "yieldTimeMs")
          ?max_output_tokens:(optional_positive_float_js prepared "maxOutputTokens")
          request
      with
  | Taumel.Sandbox.Stdin_result result ->
      ok_obj
        [
          ("action", js_string "result");
          ( "result",
            text_result_with_details result.message result.details );
        ]
  | Taumel.Sandbox.Stdin_call call ->
      let option_fields =
        js_optional_float_field "yieldTimeMs" call.yield_time_ms
        @ js_optional_float_field "maxOutputTokens" call.max_output_tokens
      in
      ok_obj
        [
          ("action", js_string "call");
          ("sessionId", js_number (float_of_int call.request.session_id));
          ("chars", js_string call.request.chars);
          ("options", Unsafe.obj (Array.of_list option_fields));
        ]
  )
