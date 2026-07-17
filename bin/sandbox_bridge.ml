open Jsoo_bridge

let sandbox_network_to_string = function
  | Taumel.Sandbox.Network_enabled -> "enabled"
  | Taumel.Sandbox.Network_disabled -> "disabled"

let approval_policy_to_string = function
  | Taumel.Sandbox.Never -> "never"
  | Taumel.Sandbox.On_request -> "on-request"
  | Taumel.Sandbox.On_failure -> "on-failure"
  | Taumel.Sandbox.Untrusted -> "untrusted"

let approval_policy_of_string = function
  | "never" -> Taumel.Sandbox.Never
  | "on-failure" -> Taumel.Sandbox.On_failure
  | "untrusted" -> Taumel.Sandbox.Untrusted
  | _ -> Taumel.Sandbox.On_request

let typed_sandbox_config (sandbox : Taumel.Sandbox.config) =
  Tool_contracts.SandboxConfig.create
    ~filesystemMode:(Taumel.Sandbox.filesystem_mode_to_string sandbox.filesystem_mode)
    ~networkMode:(sandbox_network_to_string sandbox.network_mode)
    ~workspaceRoots:sandbox.workspace_roots ~noSandbox:sandbox.no_sandbox
    ~isolatedChild:sandbox.isolated_child
    ~approvalPolicy:(approval_policy_to_string sandbox.approval_policy) ()

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
    approval_policy = approval_policy_of_string (get_string sandbox "approvalPolicy");
    no_sandbox = get_bool sandbox "noSandbox";
    isolated_child = get_bool sandbox "isolatedChild";
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
    authorization_cwd = get_string obj "authorizationCwd";
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
  let facts = decode_ojs_contract Tool_contracts.WorkspaceMutationFacts.t_of_js (ojs_of_js raw_facts) in
  let paths = Tool_contracts.WorkspaceMutationFacts.get_paths facts |> List.map resolved_mutation_path_from_js in
  match
    Taumel.Sandbox.validate_resolved_workspace_mutation_paths
      ~workspace_roots:(Tool_contracts.WorkspaceMutationFacts.get_workspaceRoots facts)
      paths
  with
  | Ok () ->
      Boundary_contracts.WorkspaceMutationValid.create ()
      |> Tool_contracts.WorkspaceMutationValid.t_to_js |> inject
  | Error message ->
      Boundary_contracts.WorkspaceMutationInvalid.create ~message ()
      |> Tool_contracts.WorkspaceMutationInvalid.t_to_js |> inject

let sandbox_host_path_plan facts =
  let facts = decode_ojs_contract Tool_contracts.SandboxHostPathFacts.t_of_js (ojs_of_js facts) in
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

let exec_host_options_from_plan (plan : Authority_plans.exec_plan) =
  let cwd =
    match Taumel.Shared.trim_non_empty plan.workdir with
    | Some value -> value
    | None -> plan.host.authorization_cwd
  in
  {
    Taumel.Sandbox.cmd = plan.cmd;
    cwd;
    shell = plan.shell;
    timeout_ms = None;
    yield_time_ms = plan.yield_time_ms;
    tty = plan.tty;
  }

let js_optional_float_field name = function
  | None -> []
  | Some value -> [ (name, js_number value) ]

let js_exec_host_call (call : Taumel.Sandbox.exec_host_call) =
  let options =
    Tool_contracts.ExecHostOptions.create ~cwd:call.cwd ?timeout:call.timeout_ms
      ?yieldTimeMs:call.yield_time_ms ?tty:(if call.tty then Some true else None) ()
  in
  Boundary_contracts.ExecHostCall.create ~command:call.invocation.command
    ~args:call.invocation.args ~options ~sandboxed:call.invocation.sandboxed
    ~escalated:call.escalated ()
  |> Tool_contracts.ExecHostCall.t_to_js |> inject

let planned_exec_host_call (plan : Authority_plans.exec_plan) _host _runtime
    force_unsandboxed =
  match plan.brokered_git with
  | Some broker ->
      if force_unsandboxed then
        Error "brokered agent Git rejects escalated unsandboxed execution"
      else
        let cwd = plan.host.authorization_cwd in
        Ok
          {
            Taumel.Sandbox.invocation =
              {
                command = broker.command;
                args = broker.argv;
                sandboxed = true;
              };
            cwd;
            timeout_ms = None;
            yield_time_ms = plan.yield_time_ms;
            tty = false;
            escalated = false;
          }
  | None ->
      let options = exec_host_options_from_plan plan in
      Taumel.Sandbox.plan_exec_host_call plan.sandbox plan.host options
        ~force_unsandboxed

let plan_exec_host_call prepared owner_context =
  let plan_id = get_string prepared "planId" in
  match Authority_plans.inspect_exec ~owner_context plan_id with
  | Error message -> error_obj message
  | Ok (plan, force_unsandboxed) -> (
      match
        planned_exec_host_call plan (inject Js.null) (inject Js.null)
          force_unsandboxed
      with
      | Ok call -> js_exec_host_call call
      | Error message -> error_obj message)

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
  let facts = decode_ojs_contract Tool_contracts.ExecApprovalOutcomeFacts.t_of_js (ojs_of_js raw_facts) in
  let plan_id = Tool_contracts.ExecApprovalOutcomeFacts.get_planId facts in
  let owner_context =
    Tool_contracts.ExecApprovalOutcomeFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  let outcome =
    match Boundary_contracts.ExecApprovalOutcomeFacts.get_outcome facts with
    | `V_approved -> Taumel.Sandbox.Approval_approved
    | `V_denied_by_user -> Taumel.Sandbox.Approval_denied_by_user
    | `V_timed_out -> Taumel.Sandbox.Approval_timed_out
    | `V_interrupted -> Taumel.Sandbox.Approval_interrupted
    | `V_unavailable -> Taumel.Sandbox.Approval_unavailable
  in
  match Taumel.Sandbox.exec_approval_outcome ~outcome with
  | Taumel.Sandbox.Approval_granted -> (
      match Authority_plans.approve_exec ~owner_context plan_id with
      | Ok () ->
          Boundary_contracts.ExecApprovalRun.create ()
          |> Tool_contracts.ExecApprovalRun.t_to_js |> inject
      | Error message -> error_obj message)
  | Taumel.Sandbox.Approval_denied denied ->
      ignore (Authority_plans.discard ~owner_context plan_id);
      let result = text_result_with_details denied.message denied.details in
      Boundary_contracts.ExecApprovalDenied.create
        ~result:(decode_ojs_contract Tool_contracts.ToolResultEnvelope.t_of_js (ojs_of_js result)) ()
      |> Tool_contracts.ExecApprovalDenied.t_to_js |> inject

let discard_authority_plan raw_facts =
  let facts = decode_ojs_contract Tool_contracts.AuthorityPlanRef.t_of_js (ojs_of_js raw_facts) in
  let owner_context =
    Tool_contracts.AuthorityPlanRef.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  match
    Authority_plans.discard ~owner_context
      (Tool_contracts.AuthorityPlanRef.get_planId facts)
  with
  | Ok () -> core_ack ()
  | Error message -> error_obj message

let reissue_exec_plan raw_facts =
  let facts = decode_ojs_contract Tool_contracts.AuthorityPlanRef.t_of_js (ojs_of_js raw_facts) in
  let owner_context =
    Tool_contracts.AuthorityPlanRef.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  match
    Authority_plans.reissue_exec_retry ~owner_context
      (Tool_contracts.AuthorityPlanRef.get_planId facts)
  with
  | Error message -> error_obj message
  | Ok planId ->
      Tool_contracts.AuthorityPlanIssued.create ~planId ()
      |> Tool_contracts.AuthorityPlanIssued.t_to_js |> inject

let plan_exec_approval_prompt raw_facts =
  let facts = decode_ojs_contract Tool_contracts.ExecApprovalPromptFacts.t_of_js (ojs_of_js raw_facts) in
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
      Boundary_contracts.ExecApprovalUnavailable.create ()
      |> Tool_contracts.ExecApprovalUnavailable.t_to_js |> inject
  | Taumel.Sandbox.Approval_prompt_confirm prompt ->
      let timeoutMs = if prompt.timeout_ms > 0 then Some (float_of_int prompt.timeout_ms) else None in
      Boundary_contracts.ExecApprovalConfirm.create ~title:prompt.title
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
      let result =
        text_result_with_details result.message result.details
        |> ojs_of_js |> decode_ojs_contract Tool_contracts.ToolResultEnvelope.t_of_js
      in
      Boundary_contracts.WriteStdinHostResult.create ~result ()
      |> Tool_contracts.WriteStdinHostResult.t_to_js |> inject
  | Taumel.Sandbox.Stdin_call call ->
      let options =
        Tool_contracts.WriteStdinHostOptions.create
          ?yieldTimeMs:call.yield_time_ms ()
      in
      Boundary_contracts.WriteStdinHostCall.create
        ~sessionId:(float_of_int call.request.session_id)
        ~chars:call.request.chars ~options ()
      |> Tool_contracts.WriteStdinHostCall.t_to_js |> inject
  )
