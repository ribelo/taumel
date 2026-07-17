open Jsoo_bridge
open App_state
open Runtime_access

let owner_id ctx = Session_store.session_id_from_ctx ctx

let is_agent_child ctx =
  match Session_store.custom_entry_data ctx "taumel.childSession" with
  | Some data -> (
      match get_string data "kind" with
      | "agent" | "generic" | "finder" | "oracle" -> true
      | _ -> false)
  | None -> false

let reject_nested name =
  error_obj (name ^ " is unavailable inside a child agent")

let save_agent_state = Session_sync.save_agent_state

let commit_agent_state ctx next =
  let previous = !agent_state in
  agent_state := next;
  try
    save_agent_state ctx;
    Ok ()
  with error ->
    agent_state := previous;
    Error ("agent state persistence failed: " ^ Printexc.to_string error)

let json_text value = Taumel.Shared.encode_json value
let json_success fields = json_text (Taumel.Shared.Object fields)

let prepare_close params ctx =
  if is_agent_child ctx then reject_nested "agent_close"
  else
    with_gateway_authorized "agent_close" (fun _ ->
        match
          Option.bind (optional_string_field params "agent_id")
            Taumel.Shared.trim_non_empty
        with
        | None -> error_obj "agent_close.agent_id is required"
        | Some agent_id -> (
            let delete_worktree = get_bool params "delete_worktree" in
            let owner = owner_id ctx in
            match
              Taumel.Agents.owned_identity !agent_state ~owner_session_id:owner
                agent_id
            with
            | Ok (identity : Taumel.Agents.identity) ->
                let isolation = Taumel.Agents.identity_isolation identity in
                if
                  delete_worktree
                  && isolation = Taumel.Agent_workspace.None
                then
                  error_obj Taumel.Agent_worktree.delete_worktree_on_none_message
                else (
                  agent_closing_ids :=
                    if List.mem agent_id !agent_closing_ids then !agent_closing_ids
                    else agent_id :: !agent_closing_ids;
                  let details =
                    Unsafe.obj
                      [|
                        ("agent_id", js_string agent_id);
                        ("status", js_string "closed");
                      |]
                  in
                  let run_ids =
                    Taumel.Agents.runs_for_agent !agent_state agent_id
                    |> List.map (fun (run : Taumel.Agents.agent_run) -> run.run_id)
                  in
                  let worktree_fields =
                    match identity.identity_workspace_binding with
                    | Taumel.Agent_workspace.Shared _ -> None
                    | Taumel.Agent_workspace.Worktree _ as binding -> (
                        match
                          Taumel.Agent_workspace.derive
                            ~agent_home:(Agent_worktree_host.pi_agent_dir ())
                            ~owner_session_id:identity.identity_owner_session_id
                            ~agent_id:identity.identity_agent_id binding
                        with
                        | Ok derived -> Some derived
                        | Error _ -> None)
                  in
                  Boundary_contracts.PreparedAgentClose.create
                    ~text:
                      (json_success
                         [
                           ("agent_id", Taumel.Shared.String agent_id);
                           ("status", Taumel.Shared.String "closed");
                         ])
                    ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                    ~agentId:agent_id ~runIds:run_ids
                    ~deleteWorktree:delete_worktree
                    ?worktreePath:
                      (Option.map
                         (fun d -> d.Taumel.Agent_workspace.worktree_path)
                         worktree_fields)
                    ?worktreeBranch:
                      (Option.map
                         (fun d -> d.Taumel.Agent_workspace.branch)
                         worktree_fields)
                    ?mainRepositoryRoot:
                      (Option.map
                         (fun d -> d.Taumel.Agent_workspace.main_repository_root)
                         worktree_fields)
                    ?isolation:
                      (Some
                         (Boundary_contracts.PreparedAgentClose.isolation_to_contract
                            (match isolation with
                            | Taumel.Agent_workspace.None -> `V_none
                            | Taumel.Agent_workspace.Worktree -> `V_worktree)))
                    ()
                  |> Tool_contracts.PreparedAgentClose.t_to_js |> inject)
            | Error _ -> (
                match
                  Taumel.Agent_registry.owned_cleanup_pending !agent_state
                    ~owner_session_id:owner agent_id
                with
                | Error message -> error_obj message
                | Ok _pending ->
                    agent_closing_ids :=
                      if List.mem agent_id !agent_closing_ids then
                        !agent_closing_ids
                      else agent_id :: !agent_closing_ids;
                    let details =
                      Unsafe.obj
                        [|
                          ("agent_id", js_string agent_id);
                          ("status", js_string "closed");
                        |]
                    in
                    Boundary_contracts.PreparedAgentClose.create
                      ~text:
                        (json_success
                           [
                             ("agent_id", Taumel.Shared.String agent_id);
                             ("status", Taumel.Shared.String "closed");
                           ])
                      ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details))
                      ~agentId:agent_id ~runIds:[] ~deleteWorktree:false ()
                    |> Tool_contracts.PreparedAgentClose.t_to_js |> inject)))

let finish_close facts ctx =
  Session_sync.require_agent_owner ctx;
  let agent_id = get_string facts "agent_id" in
  let owner = owner_id ctx in
  let clear_agent_tracking () =
    agent_closing_ids :=
      List.filter (fun value -> value <> agent_id) !agent_closing_ids;
    agent_notification_claims :=
      List.filter
        (fun run_id ->
          match Taumel.Agents.find_run !agent_state run_id with
          | Some run -> run.run_agent_id <> agent_id
          | None -> false)
        !agent_notification_claims
  in
  let persist_or_error () =
    try
      save_agent_state ctx;
      core_ack ()
    with error ->
      error_obj ("agent state persistence failed: " ^ Printexc.to_string error)
  in
  match Taumel.Agents.owned_identity !agent_state ~owner_session_id:owner agent_id with
  | Error _ -> (
      match
        Taumel.Agent_registry.owned_cleanup_pending !agent_state
          ~owner_session_id:owner agent_id
      with
      | Error message -> error_obj message
      | Ok pending -> (
          match Agent_child_session_host.finalize_cleanup_pending pending with
          | Error message -> error_obj ("cleanup_failed: " ^ message)
          | Ok () ->
              ignore
                (Agent_child_session_host.remove_cleanup_journal_record
                   ~owner_session_id:owner ~agent_id
                   ~cleanup_nonce:pending.cleanup_nonce);
              match
                Taumel.Agent_registry.complete_cleanup !agent_state
                  ~owner_session_id:owner ~agent_id
                  ~cleanup_nonce:pending.cleanup_nonce
              with
              | Error message -> error_obj message
              | Ok completed ->
                  agent_state := completed;
                  clear_agent_tracking ();
                  persist_or_error ()))
  | Ok identity -> (
      match
        Agent_child_session_host.recover_uncommitted_envelope_for_identity
          ~identity
      with
      | Error message -> error_obj ("cleanup_failed: " ^ message)
      | Ok _ -> (
      match Agent_child_session_host.authorized_private_session ~identity with
      | Error message -> error_obj ("cleanup_failed: " ^ message)
      | Ok authorized -> (
          match
            Agent_child_session_host.stage_authorized_private_session ~identity
              authorized
          with
          | Error message -> error_obj ("cleanup_failed: " ^ message)
          | Ok staged -> (
              match Agent_child_session_host.staged_cleanup_nonce staged with
              | None -> (
                  match
                    Taumel.Agent_registry.record_close !agent_state
                      ~owner_session_id:owner ~agent_id
                  with
                  | Error message -> error_obj message
                  | Ok (next, _) ->
                      agent_state := next;
                      clear_agent_tracking ();
                      persist_or_error ())
              | Some cleanup_nonce -> (
                  match
                    Taumel.Agent_registry.record_close_with_cleanup !agent_state
                      ~owner_session_id:owner ~agent_id ~cleanup_nonce
                      ~remaining_artifacts:[ "private_session" ]
                  with
                  | Error message ->
                      ignore
                        (Agent_child_session_host.unstage_private_session staged);
                      error_obj message
                  | Ok (next, _identity, pending) ->
                      let previous = !agent_state in
                      let previous_claims = !agent_notification_claims in
                      let previous_closing = !agent_closing_ids in
                      agent_state := next;
                      clear_agent_tracking ();
                      try
                        save_agent_state ctx;
                        (* Journal only after durable tombstone commit. *)
                        (match
                           Agent_child_session_host.append_cleanup_journal_record
                             ~owner_session_id:owner ~agent_id
                             ~cleanup_nonce:pending.cleanup_nonce
                         with
                        | Error message ->
                            error_obj ("cleanup_failed: " ^ message)
                        | Ok () -> (
                            match
                              Agent_child_session_host.finalize_private_session
                                staged
                            with
                            | Error message ->
                                error_obj ("cleanup_failed: " ^ message)
                            | Ok () -> (
                                ignore
                                  (Agent_child_session_host
                                   .remove_cleanup_journal_record
                                     ~owner_session_id:owner ~agent_id
                                     ~cleanup_nonce:pending.cleanup_nonce);
                                match
                                  Taumel.Agent_registry.complete_cleanup
                                    !agent_state ~owner_session_id:owner ~agent_id
                                    ~cleanup_nonce:pending.cleanup_nonce
                                with
                                | Error message -> error_obj message
                                | Ok completed ->
                                    agent_state := completed;
                                    persist_or_error ())))
                      with error ->
                        agent_state := previous;
                        agent_notification_claims := previous_claims;
                        agent_closing_ids := previous_closing;
                        let unstage_error =
                          match
                            Agent_child_session_host.unstage_private_session
                              staged
                          with
                          | Ok () -> None
                          | Error message -> Some message
                        in
                        let restore_error =
                          try
                            save_agent_state ctx;
                            None
                          with restore_exn ->
                            Some (Printexc.to_string restore_exn)
                        in
                        error_obj
                          (Agent_child_session_host.restore_failure_detail
                             ~primary:
                               ("agent state persistence failed: "
                              ^ Printexc.to_string error)
                             ~unstage_error ~restore_error))))))

let release_close facts =
  let agent_id = get_string facts "agent_id" in
  agent_closing_ids :=
    List.filter (fun value -> value <> agent_id) !agent_closing_ids;
  core_ack ()

let delete_child_session facts ctx =
  Session_sync.require_agent_owner ctx;
  let agent_id = get_string facts "agent_id" in
  match
    Taumel.Agents.owned_identity !agent_state ~owner_session_id:(owner_id ctx)
      agent_id
  with
  | Error message -> error_obj message
  | Ok identity -> (
      match Agent_child_session_host.remove_private_session ~identity with
      | Ok () -> core_ack ()
      | Error message -> error_obj ("cleanup_failed: " ^ message))

let record_close_cleanup_failure facts ctx =
  Session_sync.require_agent_owner ctx;
  let agent_id = get_string facts "agent_id" in
  match
    Taumel.Agent_registry.suspend_running_for_agent !agent_state
      ~now:(now_seconds ()) ~owner_session_id:(owner_id ctx) ~agent_id
      ~reason_code:Taumel.Agents.Close_cleanup_failed
  with
  | Error message -> error_obj message
  | Ok next -> (
      match commit_agent_state ctx next with
      | Ok () -> core_ack ()
      | Error message -> error_obj message)

