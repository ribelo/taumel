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
       (match Boundary_contracts.WriteStdinParams.get_output_mode params with
        | Some `V_status -> "status"
        | Some `V_delta | None -> "delta");
   }
    : Taumel.Mutation_plan.write_stdin_request)

let write_request_from_params params =
  let params = Tool_contracts.WriteParams.t_of_js (ojs_of_js params) in
  ({
     Taumel.Mutation_plan.path = Tool_contracts.WriteParams.get_path params;
     contents = Tool_contracts.WriteParams.get_content params;
     mode =
       (match Boundary_contracts.WriteParams.get_mode params with
        | Some `V_append -> "append"
        | Some `V_overwrite | None -> "overwrite");
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
    (Tool_contracts.ApplyPatchParams.get_input params)

let child_worktree_context = function
  | None -> None
  | Some metadata -> Taumel.Child_session.worktree_agent metadata

let child_agent_id = function
  | None -> None
  | Some metadata -> Taumel.Child_session.persisted_agent_id metadata

let resolve_trusted_git () =
  Agent_worktree_host.trusted_git_executable ()

let parse_brokered_git cmd =
  match Exec_policy_bridge.reflect_bash_script cmd with
  | Error _ ->
      Error
        (Taumel.Agent_git_broker.error_message Taumel.Agent_git_broker.Not_simple_git)
  | Ok ast -> (
      match Taumel.Agent_git_broker.parse_simple_git_ast ast with
      | Error error -> Error (Taumel.Agent_git_broker.error_message error)
      | Ok parsed -> Ok parsed)

let rec ast_invokes_git ast =
  Taumel.Agent_git_broker.ast_invokes_git
    ~shell_source_classifier:(fun source ->
      match Exec_policy_bridge.reflect_bash_script source with
      | Error _ -> false
      | Ok nested -> ast_invokes_git nested)
    ast

let child_rejects_escalation = function
  | None -> false
  | Some metadata -> Taumel.Child_session.rejects_escalation metadata

let with_child_session_metadata ctx run =
  match Session_store.child_session_metadata ctx with
  | Error message -> error_obj message
  | Ok metadata -> run metadata

let worktree_metadata = function
  | None -> None
  | Some metadata -> Taumel.Child_session.worktree_agent metadata

let authorize_child_mutation_paths child_metadata paths =
  match worktree_metadata child_metadata with
  | None -> Ok ()
  | Some worktree -> (
      match resolve_authorization_path worktree.worktree_path with
      | Error _ as error -> error
      | Ok root ->
          if List.for_all (Taumel.Sandbox.path_within ~root) paths then Ok ()
          else Error "worktree-isolated child mutation must stay inside its worktree")

let path_authorization_for_child child_metadata sandbox path =
  match path_authorization sandbox path with
  | Error _ as error -> error
  | Ok (auth_path, auth_roots) ->
      Result.map (fun () -> (auth_path, auth_roots))
        (authorize_child_mutation_paths child_metadata [ auth_path ])

let patch_authorization_for_child child_metadata sandbox patch =
  match patch_authorization sandbox patch with
  | Error _ as error -> error
  | Ok (auth_paths, auth_roots) ->
      Result.map (fun () -> (auth_paths, auth_roots))
        (authorize_child_mutation_paths child_metadata (List.map snd auth_paths))

let child_rejects_filesystem_approval child_metadata approval =
  worktree_metadata child_metadata <> None && approval <> None

let prepare_exec_command params ctx =
  match Session_store.child_session_metadata ctx with
  | Error message -> error_obj message
  | Ok child_metadata ->
  with_gateway_authorized "exec_command" (fun sandbox ->
      let request = exec_request_from_params params in
      match request.sandbox_permissions with
      | Taumel.Sandbox.Require_escalated _ when child_rejects_escalation child_metadata ->
          error_obj
            "command escalation is rejected for finder, oracle, and worktree-isolated agents"
      | _ ->
      let worktree_ctx = child_worktree_context child_metadata in
      let looks_like_git =
        match Exec_policy_bridge.reflect_bash_script request.cmd with
        | Error _ -> false
        | Ok ast -> ast_invokes_git ast
      in
      let policy_decision =
        Exec_policy_bridge.policy_decision_for_command sandbox
          request.sandbox_permissions request.cmd
      in
      let policy_message =
        Exec_policy_bridge.policy_reason_for_command sandbox
          request.sandbox_permissions request.cmd
      in
      match (worktree_ctx, looks_like_git, policy_decision) with
      | Some _, true, Some Taumel.Exec_policy.Forbidden ->
          error_obj
            (Option.value policy_message ~default:"exec policy forbids command")
      | Some _, true, Some Taumel.Exec_policy.Prompt ->
          error_obj
            (Option.value policy_message
               ~default:"exec policy requires approval before brokered agent Git")
      | _ ->
      let brokered =
        match worktree_ctx with
        | None -> Error ""
        | Some _ when not looks_like_git -> Error ""
        | Some worktree_context ->
            let worktree = worktree_context.worktree_path in
            let main_repo = worktree_context.main_repository_root in
            let branch = worktree_context.branch in
            begin match parse_brokered_git request.cmd with
            | Error message -> Error message
            | Ok parsed ->
                begin match request.sandbox_permissions with
                | Taumel.Sandbox.Require_escalated _ ->
                    Error "brokered agent Git rejects with_escalated_permissions"
                | Taumel.Sandbox.Use_default ->
                    let read_only =
                      match sandbox.filesystem_mode with
                      | Taumel.Sandbox.Read_only -> true
                      | _ -> false
                    in
                    begin match Taumel.Agent_git_broker.authorize ~read_only parsed with
                    | Error error ->
                        Error (Taumel.Agent_git_broker.error_message error)
                    | Ok authorized ->
                        begin match
                          Taumel.Agent_worktree.authorize_mutation ~operation:Broker
                            ~main_repository_root:main_repo
                            ~main_repository_id:"verified" ~worktree_path:worktree
                            ~branch ~trusted_adapter:true
                        with
                        | Denied message -> Error message
                        | Authorized _ ->
                            let agent_id =
                              Option.value (child_agent_id child_metadata) ~default:""
                            in
                            if
                              agent_id <> ""
                              && Taumel.Agent_git_broker.Lease.is_held agent_id
                            then
                              Error
                                "brokered agent Git is already running for this identity"
                            else
                              begin match
                                Agent_worktree_host.verify_broker_registration
                                  ~worktree_path:worktree
                                  ~main_repository_root:main_repo ~branch
                              with
                              | Error message -> Error message
                              | Ok git_dir ->
                                  Ok
                                    ( worktree,
                                      git_dir,
                                      authorized.argv,
                                      agent_id,
                                      authorized.subcommand )
                              end
                        end
                    end
                end
            end
      in
      match brokered with
      | Ok (worktree, git_dir, argv, agent_id, subcommand) ->
          let sandbox_cfg = typed_sandbox_config sandbox in
          let workdir =
            if request.workdir = "" then worktree
            else if
              request.workdir = worktree
              || Taumel.Sandbox.path_within ~root:worktree request.workdir
            then request.workdir
            else worktree
          in
          if
            request.workdir <> ""
            && request.workdir <> worktree
            && not (Taumel.Sandbox.path_within ~root:worktree request.workdir)
          then error_obj "brokered agent Git workdir must stay inside the agent worktree"
          else
          (match resolve_trusted_git () with
          | Error message -> error_obj message
          | Ok trusted_git ->
              Boundary_contracts.PreparedExec.create ~cmd:request.cmd ~workdir
                ~tty:false ~sandbox:sandbox_cfg ~brokeredGit:true
                ~directCommand:trusted_git ~directArgv:argv ~gitDir:git_dir
                ~gitWorkTree:worktree
                ?brokerAgentId:(if agent_id = "" then None else Some agent_id)
                ~brokerSubcommand:
                  (Taumel.Agent_git_broker.subcommand_to_string subcommand) ()
              |> Tool_contracts.PreparedExec.t_to_js |> inject)
      | Error message when message <> "" && worktree_ctx <> None ->
          error_obj message
      | Error _ ->
      match Taumel.Mutation_plan.plan_exec ?policy_decision ?policy_message sandbox request with
      | Error message -> error_obj message
      | Ok plan ->
          let sandbox = typed_sandbox_config sandbox in
          let yieldTimeMs = plan.yield_time_ms in
          let maxOutputTokens = Option.map float_of_int plan.max_output_tokens in
          (match plan.approval with
          | None ->
              Boundary_contracts.PreparedExec.create ~cmd:plan.cmd
                ~workdir:plan.workdir ?yieldTimeMs ?maxOutputTokens ~tty:plan.tty
                ~sandbox ()
              |> Tool_contracts.PreparedExec.t_to_js |> inject
          | Some approval ->
              let execPolicyAllowAlwaysTokens =
                if not (String.starts_with ~prefix:"exec policy requires approval" approval.message) then None
                else if Exec_policy_bridge.explicit_prompt_or_forbidden request.cmd then None
                else Exec_policy_bridge.allow_amendment_tokens request.cmd
              in
              Boundary_contracts.PreparedExecApproval.create ~cmd:plan.cmd
                ~workdir:plan.workdir ?yieldTimeMs ?maxOutputTokens ~tty:plan.tty
                ~sandbox ~approvalMessage:approval.message
                ~approvalTitle:approval.title ~approvalPrompt:approval.prompt
                ~approvalTimeoutMs:(float_of_int approval.timeout_ms)
                ?execPolicyAllowAlwaysTokens ()
              |> Tool_contracts.PreparedExecApproval.t_to_js |> inject))

let prepare_write_stdin params =
  with_gateway_authorized "write_stdin" (fun _sandbox ->
      let request = write_stdin_request_from_params params in
      match Taumel.Mutation_plan.plan_write_stdin request with
      | Error message -> error_obj message
      | Ok plan ->
          let outputMode =
            (match plan.output_mode with
            | "delta" -> `V_delta
            | "status" -> `V_status
            | _ -> failwith "invalid planned write_stdin output mode")
            |> Boundary_contracts.PreparedWriteStdin.output_mode_to_contract
          in
          Boundary_contracts.PreparedWriteStdin.create
            ~sessionId:(float_of_int plan.session_id) ~chars:plan.chars
            ?yieldTimeMs:plan.yield_time_ms
            ?maxOutputTokens:(Option.map float_of_int plan.max_output_tokens)
            ~outputMode ()
          |> Tool_contracts.PreparedWriteStdin.t_to_js |> inject)

let js_edit_replacement (edit : Taumel.Sandbox.edit_replacement) =
  Unsafe.obj
    [|
      ("oldText", js_string edit.old_text);
      ("newText", js_string edit.new_text);
    |]

let unknown_edit edit =
  Ts2ocaml.unknown_of_js (ojs_of_js (js_edit_replacement edit))

let prepare_write params ctx =
  with_child_session_metadata ctx (fun child_metadata ->
  with_gateway_profile_authorized "write" (fun sandbox ->
      let request = write_request_from_params params in
      match path_authorization_for_child child_metadata sandbox request.path with
      | Error message -> error_obj message
      | Ok (auth_path, auth_roots) -> (
          match
            Taumel.Mutation_plan.plan_write ~auth_path ~auth_roots sandbox
              request
          with
          | Error message -> error_obj message
          | Ok plan
            when child_rejects_filesystem_approval child_metadata plan.approval ->
              error_obj "worktree-isolated child filesystem approval is forbidden"
          | Ok plan ->
              let contents = Option.value plan.contents ~default:"" in
              (match plan.approval with
              | None ->
                  Boundary_contracts.PreparedWrite.create
                    ~workspaceRoots:plan.workspace_roots
                    ~validateWorkspacePaths:plan.validate_workspace_paths
                    ~path:plan.path ~displayPath:plan.display_path ~contents
                    ~mode:request.mode ()
                  |> Tool_contracts.PreparedWrite.t_to_js |> inject
              | Some approval ->
                  Boundary_contracts.PreparedWriteApproval.create
                    ~workspaceRoots:plan.workspace_roots
                    ~validateWorkspacePaths:plan.validate_workspace_paths
                    ~path:plan.path ~displayPath:plan.display_path ~contents
                    ~mode:request.mode ~approvalAction:"write"
                    ~approvalTitle:approval.title ~approvalPrompt:approval.prompt
                    ~approvalTimeoutMs:(float_of_int approval.timeout_ms) ()
                  |> Tool_contracts.PreparedWriteApproval.t_to_js |> inject))))

let prepare_read params =
  with_gateway_authorized "read" (fun _sandbox ->
      let params = Tool_contracts.ReadParams.t_of_js (ojs_of_js params) in
      let path = Tool_contracts.ReadParams.get_path params in
      if String.trim path = "" then error_obj "read requires a non-empty path"
      else
        let offset = Tool_contracts.ReadParams.get_offset params in
        let limit = Tool_contracts.ReadParams.get_limit params in
        Boundary_contracts.PreparedRead.create ~path ?offset ?limit ()
        |> Tool_contracts.PreparedRead.t_to_js |> inject)

let prepare_edit params ctx =
  with_child_session_metadata ctx (fun child_metadata ->
  with_gateway_profile_authorized "edit" (fun sandbox ->
      let request = edit_request_from_params params in
      match path_authorization_for_child child_metadata sandbox request.path with
      | Error message -> error_obj message
      | Ok (auth_path, auth_roots) -> (
          match
            Taumel.Mutation_plan.plan_edit ~auth_path ~auth_roots sandbox request
          with
          | Error message -> error_obj message
          | Ok plan
            when child_rejects_filesystem_approval child_metadata plan.approval ->
              error_obj "worktree-isolated child filesystem approval is forbidden"
          | Ok plan ->
              let edits = List.map unknown_edit plan.edits in
              (match plan.approval with
              | None ->
                  Boundary_contracts.PreparedEdit.create
                    ~workspaceRoots:plan.workspace_roots
                    ~validateWorkspacePaths:plan.validate_workspace_paths
                    ~path:plan.path ~displayPath:plan.display_path ~edits ()
                  |> Tool_contracts.PreparedEdit.t_to_js |> inject
              | Some approval ->
                  Boundary_contracts.PreparedEditApproval.create
                    ~workspaceRoots:plan.workspace_roots
                    ~validateWorkspacePaths:plan.validate_workspace_paths
                    ~path:plan.path ~displayPath:plan.display_path ~edits
                    ~approvalAction:"edit" ~approvalTitle:approval.title
                    ~approvalPrompt:approval.prompt
                    ~approvalTimeoutMs:(float_of_int approval.timeout_ms) ()
                  |> Tool_contracts.PreparedEditApproval.t_to_js |> inject))))

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
      Boundary_contracts.MutationError.create ~message ()
      |> Tool_contracts.MutationError.t_to_js |> inject
  | Ok contents ->
      Boundary_contracts.EditApplied.create ~path ~displayPath:display_path
        ~contents ~editCount:(float_of_int (List.length request.edits)) ()
      |> Tool_contracts.EditApplied.t_to_js |> inject

let prepare_apply_patch params ctx =
  with_child_session_metadata ctx (fun child_metadata ->
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match patch_request_from_params params with
      | Error message -> error_obj message
      | Ok request -> (
          match patch_authorization_for_child child_metadata sandbox request.patch with
          | Error message -> error_obj message
          | Ok (auth_paths, auth_roots) -> (
              match
                Taumel.Mutation_plan.plan_apply_patch ~auth_paths ~auth_roots
                  sandbox request
              with
              | Error message -> error_obj message
              | Ok plan
                when child_rejects_filesystem_approval child_metadata plan.approval ->
                  error_obj "worktree-isolated child filesystem approval is forbidden"
              | Ok plan ->
                  (match plan.approval with
                  | None ->
                      Boundary_contracts.PreparedPatch.create
                        ~workspaceRoots:plan.workspace_roots
                        ~validateWorkspacePaths:plan.validate_workspace_paths
                        ~affectedPaths:plan.affected_paths ~patch:request.patch ()
                      |> Tool_contracts.PreparedPatch.t_to_js |> inject
                  | Some approval ->
                      Boundary_contracts.PreparedPatchApproval.create
                        ~workspaceRoots:plan.workspace_roots
                        ~validateWorkspacePaths:plan.validate_workspace_paths
                        ~affectedPaths:plan.affected_paths ~patch:request.patch
                        ~approvalAction:"apply_patch"
                        ~approvalTitle:approval.title ~approvalPrompt:approval.prompt
                        ~approvalTimeoutMs:(float_of_int approval.timeout_ms) ()
                      |> Tool_contracts.PreparedPatchApproval.t_to_js |> inject)))))

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
  let mutation_error message =
    Boundary_contracts.MutationError.create ~message ()
    |> Tool_contracts.MutationError.t_to_js |> inject
  in
  match Session_store.child_session_metadata ctx with
  | Error message -> mutation_error message
  | Ok child_metadata ->
  with_gateway_profile_authorized "apply_patch" (fun sandbox ->
      match patch_request_from_params params with
      | Error message -> mutation_error message
      | Ok request -> (
          match patch_authorization_for_child child_metadata sandbox request.patch with
          | Error message -> mutation_error message
          | Ok (auth_paths, auth_roots) -> (
              match
                Taumel.Mutation_plan.apply_patch_to_files ~approved ~auth_paths
                  ~auth_roots sandbox request (files_map_from_js files)
              with
              | Error message -> mutation_error message
              | Ok output ->
                  let write_objects =
                    output.writes
                    |> List.map (fun (path, contents) ->
                           Tool_contracts.PatchWrite.create ~path ~contents ())
                  in
                  Boundary_contracts.PatchApplied.create
                    ~deletes:output.deletes ~writes:write_objects
                    ~affectedPaths:output.affected_paths ()
                  |> Tool_contracts.PatchApplied.t_to_js |> inject)))
