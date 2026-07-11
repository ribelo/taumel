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
      ("isolated_child", js_bool sandbox.isolated_child);
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
    isolated_child = get_bool sandbox "isolated_child";
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
  let result =
    Tool_contracts.ToolNamesResult.create
      ~names:Taumel.Sandbox.protected_workspace_dir_names ()
  in
  Tool_contracts.ToolNamesResult.t_to_js result |> inject

let resolved_mutation_path_from_js obj =
  {
    Taumel.Sandbox.requested_path = Tool_contracts.ResolvedMutationPath.get_path obj;
    resolved_path = Tool_contracts.ResolvedMutationPath.get_resolvedPath obj;
  }

let validate_workspace_mutation_paths raw_facts =
  let facts = Tool_contracts.WorkspaceMutationFacts.t_of_js (ojs_of_js raw_facts) in
  let paths = Tool_contracts.WorkspaceMutationFacts.get_paths facts |> List.map resolved_mutation_path_from_js in
  match
    Taumel.Sandbox.validate_resolved_workspace_mutation_paths
      ~workspace_roots:(Tool_contracts.WorkspaceMutationFacts.get_workspaceRoots facts)
      paths
  with
  | Ok () ->
      Tool_contracts.WorkspaceMutationValid.create ~kind:"valid" ()
      |> Tool_contracts.WorkspaceMutationValid.t_to_js |> inject
  | Error message ->
      Tool_contracts.WorkspaceMutationInvalid.create ~kind:"invalid" ~message ()
      |> Tool_contracts.WorkspaceMutationInvalid.t_to_js |> inject

let sandbox_host_path_plan facts =
  let facts = Tool_contracts.SandboxHostPathFacts.t_of_js (ojs_of_js facts) in
  let tempRootCandidates =
    Taumel.Sandbox.temp_root_candidates
      ~tmp_dir:(Tool_contracts.SandboxHostPathFacts.get_tmpDir facts)
      ~env_tmp_dir:(Tool_contracts.SandboxHostPathFacts.get_envTmpDir facts)
  in
  Tool_contracts.SandboxHostPathPlan.create ~tempRootCandidates
    ~systemRoPathCandidates:Taumel.Sandbox.system_ro_path_candidates ()
  |> Tool_contracts.SandboxHostPathPlan.t_to_js |> inject

let positive_float_option obj name =
  match float_field obj name with
  | Some value when value > 0.0 -> Some value
  | _ -> None

let exec_host_options_from_js prepared runtime =
  let shell =
    match optional_string_field runtime "bashPath" with
    | Some value when String.trim value <> "" -> String.trim value
    | _ -> "bash"
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
    timeout_ms = positive_float_option prepared "timeout";
    yield_time_ms = positive_float_option prepared "yieldTimeMs";
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

let finish_exec_approval raw_facts =
  let facts = Tool_contracts.ExecApprovalOutcomeFacts.t_of_js (ojs_of_js raw_facts) in
  let outcome =
    match
      Taumel.Sandbox.approval_prompt_outcome_of_string
        (Tool_contracts.ExecApprovalOutcomeFacts.get_outcome facts)
    with
    | Some outcome -> outcome
    | None ->
         Taumel.Sandbox.Approval_denied_by_user
  in
  match Taumel.Sandbox.exec_approval_outcome ~outcome with
  | Taumel.Sandbox.Approval_granted ->
      Tool_contracts.ExecApprovalRun.create ~kind:"run" ~forceUnsandboxed:true ()
      |> Tool_contracts.ExecApprovalRun.t_to_js |> inject
  | Taumel.Sandbox.Approval_denied denied ->
      let result = text_result_with_details denied.message denied.details in
      Tool_contracts.ExecApprovalDenied.create ~kind:"denied"
        ~result:(Tool_contracts.ToolResultEnvelope.t_of_js (ojs_of_js result)) ()
      |> Tool_contracts.ExecApprovalDenied.t_to_js |> inject

let plan_exec_approval_prompt raw_facts =
  let facts = Tool_contracts.ExecApprovalPromptFacts.t_of_js (ojs_of_js raw_facts) in
  let prompt =
    {
      Taumel.Sandbox.title = Tool_contracts.ExecApprovalPromptFacts.get_approvalTitle facts;
      prompt = Tool_contracts.ExecApprovalPromptFacts.get_approvalPrompt facts;
      timeout_ms = int_of_float (Tool_contracts.ExecApprovalPromptFacts.get_approvalTimeoutMs facts);
    }
  in
  match
    Taumel.Sandbox.plan_exec_approval_prompt
      ~ui_available:(Tool_contracts.ExecApprovalPromptFacts.get_uiAvailable facts)
      prompt
  with
  | Taumel.Sandbox.Approval_prompt_unavailable ->
      Tool_contracts.ExecApprovalUnavailable.create ~kind:"unavailable" ()
      |> Tool_contracts.ExecApprovalUnavailable.t_to_js |> inject
  | Taumel.Sandbox.Approval_prompt_confirm prompt ->
      let timeoutMs = if prompt.timeout_ms > 0 then Some (float_of_int prompt.timeout_ms) else None in
      Tool_contracts.ExecApprovalConfirm.create ~kind:"confirm" ~title:prompt.title
        ~prompt:prompt.prompt ?timeoutMs ()
      |> Tool_contracts.ExecApprovalConfirm.t_to_js |> inject

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
      in
      ok_obj
        [
          ("action", js_string "call");
          ("sessionId", js_number (float_of_int call.request.session_id));
          ("chars", js_string call.request.chars);
          ("options", Unsafe.obj (Array.of_list option_fields));
        ]
  )
