open Taumel

let assert_equal label expected actual =
  if expected <> actual then
    failwith (label ^ ": expected " ^ expected ^ ", got " ^ actual)

let assert_true label value =
  if not value then failwith (label ^ ": expected true")

let assert_error label = function
  | Ok _ -> failwith (label ^ ": expected error")
  | Error _ -> ()

let ceiling =
  {
    Capability_profile.model_id = "inherit";
    thinking_level = "medium";
    sandbox_preset = Capability_profile.Workspace_write;
    approval_policy = Capability_profile.On_request;
    tools = Capability_profile.All;
    no_sandbox_allowed = false;
  }

let spawn ?(kind = Agents.Generic) ?(effort = Agents.Medium) state =
  Agents.record_spawn state ~now:1 ~owner_session_id:"parent-1" ~kind ~effort
    ~model:"anthropic/claude" ~thinking:"medium" ~description:"Investigate agent work"
    ~active_tools:[ "read"; "bash"; "edit"; "agent_spawn" ]
    ~permission_ceiling:ceiling
    ~workspace_binding:(Agent_workspace.shared ~source_root:"/tmp/project") ()

let test_spawn_strips_agent_tools_and_returns_running () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) ->
      assert_equal "kind" "generic"
        (Agents.agent_kind_to_string identity.identity_kind);
      assert_equal "model" "anthropic/claude" identity.identity_model;
      assert_equal "status" "running"
        (Agents.run_status_to_string run.run_status);
      assert_true "agent tools removed"
        (not (List.mem "agent_spawn" identity.identity_active_tools));
      assert_true "read kept" (List.mem "read" identity.identity_active_tools);
      assert_true "generic mutation kept"
        (List.mem "edit" identity.identity_active_tools);
      assert_equal "identity count" "1"
        (string_of_int (List.length state.identities))

let test_unaccepted_spawn_rolls_back_identity_and_run () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) -> (
      match
        Agents.rollback_unaccepted_spawn state ~owner_session_id:"parent-1"
          ~agent_id:identity.identity_agent_id ~run_id:run.run_id
          ~submission_id:run.run_submission_id
      with
      | Error message -> failwith message
      | Ok rolled_back ->
          assert_equal "rollback identity count" "0"
            (string_of_int (List.length rolled_back.identities));
          assert_equal "rollback run count" "0"
            (string_of_int (List.length rolled_back.runs));
          assert_error "stale callback cannot roll back again"
            (Agents.rollback_unaccepted_spawn rolled_back
               ~owner_session_id:"parent-1"
               ~agent_id:identity.identity_agent_id ~run_id:run.run_id
               ~submission_id:run.run_submission_id))

let test_closed_identity_id_is_never_reused () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, first, _run) -> (
      match
        Agent_registry.record_close state ~owner_session_id:"parent-1"
          ~agent_id:first.identity_agent_id
      with
      | Error message -> failwith message
      | Ok (closed, _) -> (
          match spawn closed with
          | Error message -> failwith message
          | Ok (_, second, _) ->
              assert_true "closed agent id is not reused"
                (first.identity_agent_id <> second.identity_agent_id)))

let test_specialist_tool_effect_clamps () =
  let active =
    [ "read"; "exec_command"; "edit"; "web_search_exa"; "agent_spawn" ]
  in
  let finder = Agents.specialist_tools ~kind:Agents.Finder active in
  let oracle = Agents.specialist_tools ~kind:Agents.Oracle active in
  assert_true "finder keeps read" (List.mem "read" finder);
  assert_true "finder keeps execute" (List.mem "exec_command" finder);
  assert_true "finder removes mutation" (not (List.mem "edit" finder));
  assert_true "finder removes network" (not (List.mem "web_search_exa" finder));
  assert_true "oracle keeps network" (List.mem "web_search_exa" oracle);
  assert_true "oracle removes mutation" (not (List.mem "edit" oracle));
  assert_true "oracle removes nested agents" (not (List.mem "agent_spawn" oracle))

let test_send_preflight_rollback_restores_state () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, first_run) -> (
      match
        Agents.record_run_completion state ~now:2 ~run_id:first_run.run_id
          ~status:Agents.Completed ~final_output:"done" ()
      with
      | Error message -> failwith message
      | Ok idle -> (
          match
            Agents.record_send idle ~now:3 ~owner_session_id:"parent-1"
              ~agent_id:identity.identity_agent_id "again"
          with
          | Error message -> failwith message
          | Ok delivery ->
              let run_id = Option.value delivery.delivery_run_id ~default:"" in
              let submission_id =
                Option.value delivery.delivery_submission_id ~default:""
              in
              match
                Agents.rollback_send_preflight delivery.delivery_state
                  ~owner_session_id:"parent-1"
                  ~agent_id:identity.identity_agent_id ~run_id ~submission_id
                  ~outcome:delivery.delivery_outcome ~previous_submission_id:""
                  ~previous_reason_code:None
              with
              | Error message -> failwith message
              | Ok restored ->
                  assert_true "unaccepted idle send removes allocated run"
                    (Agents.find_run restored run_id = None);
                  (match
                     Agents.record_send restored ~now:4
                       ~owner_session_id:"parent-1"
                       ~agent_id:identity.identity_agent_id "third"
                   with
                  | Error message -> failwith message
                  | Ok retried ->
                      let retried_run_id =
                        Option.value retried.delivery_run_id ~default:""
                      in
                      assert_true "rolled-back run id remains retired"
                        (retried_run_id <> run_id);
                      assert_equal "run numbering remains monotonic"
                        (identity.identity_agent_id ^ "-run-3") retried_run_id)))

let test_send_matrix () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) -> (
      match
        Agents.record_send state ~now:2 ~owner_session_id:"parent-1"
          ~agent_id:identity.identity_agent_id ~interrupt:true ""
      with
      | Error message -> failwith message
      | Ok suspended ->
          assert_equal "suspend outcome" "suspended"
            (Agents.send_outcome_to_string suspended.delivery_outcome);
          assert_equal "same run" run.run_id
            (Option.value suspended.delivery_run_id ~default:"");
          match
            Agents.record_send suspended.delivery_state ~now:3
              ~owner_session_id:"parent-1" ~agent_id:identity.identity_agent_id
              "continue"
          with
          | Error message -> failwith message
          | Ok resumed ->
              assert_equal "resume outcome" "resumed"
                (Agents.send_outcome_to_string resumed.delivery_outcome);
              assert_equal "resume same run" run.run_id
                (Option.value resumed.delivery_run_id ~default:"");
              match
                Agents.record_send resumed.delivery_state ~now:4
                  ~owner_session_id:"parent-1"
                  ~agent_id:identity.identity_agent_id "steer"
              with
              | Error message -> failwith message
              | Ok steered -> (
                  assert_equal "steer outcome" "message_sent"
                    (Agents.send_outcome_to_string steered.delivery_outcome);
                  match
                    Agents.record_run_completion steered.delivery_state ~now:5
                      ~run_id:run.run_id ~status:Agents.Completed
                      ~final_output:"done" ()
                  with
                  | Error message -> failwith message
                  | Ok completed -> (
                      match
                        Agents.record_send completed ~now:6
                          ~owner_session_id:"parent-1"
                          ~agent_id:identity.identity_agent_id "next"
                      with
                      | Error message -> failwith message
                      | Ok next ->
                          assert_equal "new run outcome" "started"
                            (Agents.send_outcome_to_string next.delivery_outcome);
                          assert_true "new run id"
                            (next.delivery_run_id <> Some run.run_id))))

let test_wait_is_idempotent_and_observes_announcement () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) -> (
      match
        Agents.record_run_completion state ~now:2 ~run_id:run.run_id
          ~status:Agents.Completed ~final_output:"answer" ()
      with
      | Error message -> failwith message
      | Ok completed -> (
          match
            Agent_wait.wait_for_run_ids completed ~owner_session_id:"parent-1"
              [ run.run_id ]
          with
          | Error message -> failwith message
          | Ok first -> (
              assert_true "not timed out" (not first.wait_timed_out);
              assert_equal "one result" "1"
                (string_of_int (List.length first.wait_items));
              let item = List.hd first.wait_items in
              assert_equal "output" "answer"
                (Option.value item.wait_output ~default:"");
              assert_equal "agent" identity.identity_agent_id item.wait_agent_id;
              match
                Agent_wait.wait_for_run_ids first.wait_state
                  ~owner_session_id:"parent-1" [ run.run_id ]
              with
              | Error message -> failwith message
              | Ok second -> (
                  let again = List.hd second.wait_items in
                  assert_equal "idempotent output" "answer"
                    (Option.value again.wait_output ~default:"");
                  match Agents.find_run second.wait_state run.run_id with
                  | None -> failwith "run missing"
                  | Some observed ->
                      assert_equal "observed" "observed_by_agent_wait"
                        (Agents.announcement_to_string observed.run_announcement)))))

let test_wait_rejects_unknown_before_claiming () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, _identity, run) ->
      assert_error "unknown rejected"
        (Agent_wait.wait_for_run_ids state ~owner_session_id:"parent-1"
           [ run.run_id; "missing-run" ])

let test_close_removes_identity_and_runs () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) -> (
      match
        Agent_registry.record_close state ~owner_session_id:"parent-1"
          ~agent_id:identity.identity_agent_id
      with
      | Error message -> failwith message
      | Ok (closed, _) ->
          assert_equal "no identities" "0"
            (string_of_int (List.length closed.identities));
          assert_equal "no runs" "0" (string_of_int (List.length closed.runs));
          assert_error "unknown after close"
            (Agents.owned_identity closed ~owner_session_id:"parent-1"
               identity.identity_agent_id);
          assert_true "run gone" (Agents.find_run closed run.run_id = None))

let test_shutdown_suspends_running_not_lost () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, _identity, run) -> (
      let suspended =
        Agent_registry.suspend_running_for_owner state ~now:9
          ~owner_session_id:"parent-1" ~reason_code:Agents.Parent_shutdown
      in
      match Agents.find_run suspended run.run_id with
      | None -> failwith "run missing"
      | Some run ->
          assert_equal "suspended" "suspended"
            (Agents.run_status_to_string run.run_status);
          assert_equal "reason" "parent_shutdown"
            (Option.fold ~none:"" ~some:Agents.reason_code_to_string
               run.run_reason_code))

let test_close_cleanup_failure_suspends_only_selected_agent () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) -> (
      match
        Agent_registry.suspend_running_for_agent state ~now:10
          ~owner_session_id:"parent-1" ~agent_id:identity.identity_agent_id
          ~reason_code:Agents.Close_cleanup_failed
      with
      | Error message -> failwith message
      | Ok suspended -> (
          match Agents.find_run suspended run.run_id with
          | None -> failwith "run missing"
          | Some run ->
              assert_equal "close cleanup status" "suspended"
                (Agents.run_status_to_string run.run_status);
              assert_equal "close cleanup reason" "close_cleanup_failed"
                (Option.fold ~none:"" ~some:Agents.reason_code_to_string
                   run.run_reason_code);
              match Agents_codec.decode (Agents_codec.encode suspended) with
              | Error message -> failwith message
              | Ok decoded ->
                  assert_equal "persisted close cleanup reason"
                    "close_cleanup_failed"
                    (Option.bind (Agents.find_run decoded run.run_id)
                       (fun item -> item.run_reason_code)
                    |> Option.fold ~none:""
                         ~some:Agents.reason_code_to_string)))

let test_process_loss_uses_child_session_availability () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, identity, run) ->
      let with_file =
        match
          Agents.record_child_session state ~agent_id:identity.identity_agent_id
            ~child_session_file:"/tmp/child.jsonl" ()
        with
        | Ok state -> state
        | Error message -> failwith message
      in
      let available =
        Agents.mark_running_after_process_loss with_file
          ~now:10
          ~child_session_available:(fun _ -> true)
      in
      (match Agents.find_run available run.run_id with
      | None -> failwith "run missing"
      | Some run ->
          assert_equal "process interrupted" "process_interrupted"
            (Option.fold ~none:"" ~some:Agents.reason_code_to_string
               run.run_reason_code));
      let lost =
        Agents.mark_running_after_process_loss with_file
          ~now:10
          ~child_session_available:(fun _ -> false)
      in
      match Agents.find_run lost run.run_id with
      | None -> failwith "run missing"
      | Some run ->
          assert_equal "lost" "lost" (Agents.run_status_to_string run.run_status);
          assert_equal "child session lost" "child_session_lost"
            (Option.fold ~none:"" ~some:Agents.reason_code_to_string
               run.run_reason_code)

let test_identity_limit () =
  let rec fill state count =
    if count = 0 then state
    else
      match spawn state with
      | Error message -> failwith message
      | Ok (state, _, _) -> fill state (count - 1)
  in
  let full = fill Agents.empty_session_state Agents.max_identities_per_owner in
  assert_error "limit enforced" (spawn full)

let test_codec_roundtrip_and_legacy_rejection () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, _, _) -> (
      match Agents_codec.decode (Agents_codec.encode state) with
      | Error message -> failwith message
      | Ok decoded ->
          assert_equal "roundtrip identities" "1"
            (string_of_int (List.length decoded.identities));
          assert_error "legacy rejected"
            (Agents_codec.decode
               (Shared.Object
                  [
                    ("version", Shared.Number 0.);
                    ("identities", Shared.Array []);
                    ("runs", Shared.Array []);
                  ]));
          assert_error "partial current schema rejected"
            (Agents_codec.decode
               (Shared.Object
                  [
                    ("version", Shared.Number (float_of_int Agents.schema_version));
                    ( "issued_identity_counts",
                      Shared.Object
                        [
                          ("agent", Shared.Number 0.);
                          ("finder", Shared.Number 0.);
                          ("oracle", Shared.Number 0.);
                        ] );
                    ("identities", Shared.Array []);
                  ])))

let test_codec_persists_locator_not_assistant_output () =
  match spawn Agents.empty_session_state with
  | Error message -> failwith message
  | Ok (state, _, run) -> (
      match
        Agents.record_run_completion state ~now:2 ~run_id:run.run_id
          ~status:Agents.Completed ~final_output:"secret answer"
          ~result_entry_id:"entry-1" ()
      with
      | Error message -> failwith message
      | Ok completed -> (
          match Agents_codec.decode (Agents_codec.encode completed) with
          | Error message -> failwith message
          | Ok decoded -> (
              match Agents.find_run decoded run.run_id with
              | None -> failwith "decoded run missing"
              | Some decoded_run ->
                  assert_true "output availability persisted"
                    decoded_run.run_output_available;
                  assert_true "assistant output not duplicated in parent state"
                    (decoded_run.run_final_output = None);
                  assert_equal "result locator persisted" "entry-1"
                    (Option.value decoded_run.run_result_entry_id ~default:""))))

let test_routing_merge_and_validation () =
  let base =
    match
      Agent_routing.of_taumel_json
        (Shared.Object
           [
             ( "agents",
               Shared.Object
                 [
                   ( "generic",
                     Shared.Object
                       [
                         ( "low",
                           Shared.Object
                             [
                               ("model", Shared.String "inherit");
                               ("thinking", Shared.String "low");
                             ] );
                       ] );
                 ] );
           ])
    with
    | Ok catalog -> catalog
    | Error message -> failwith message
  in
  let override =
    match
      Agent_routing.of_taumel_json
        (Shared.Object
           [
             ( "agents",
               Shared.Object
                 [
                   ( "finder",
                     Shared.Object
                       [
                         ("model", Shared.String "openai/gpt-5");
                         ("thinking", Shared.String "high");
                       ] );
                 ] );
           ])
    with
    | Ok catalog -> catalog
    | Error message -> failwith message
  in
  let merged = Agent_routing.merge ~base ~override in
  (match Agent_routing.entry_for merged ~kind:Agents.Generic ~effort:(Some Agents.Low) with
  | Some entry ->
      assert_equal "generic low model" "inherit" entry.model;
      assert_equal "generic low thinking" "low" entry.thinking
  | None -> failwith "missing generic low");
  (match Agent_routing.entry_for merged ~kind:Agents.Finder ~effort:None with
  | Some entry ->
      assert_equal "finder model" "openai/gpt-5" entry.model;
      assert_equal "finder thinking" "high" entry.thinking
  | None -> failwith "missing finder");
  (match
     Agent_routing.of_taumel_json
       (Shared.Object
          [
            ( "agents",
              Shared.Object
                [
                  ( "oracle",
                    Shared.Object [ ("model", Shared.String "inherit") ] );
                ] );
          ])
   with
  | Error _ -> ()
  | Ok catalog ->
      assert_true "malformed specialist becomes diagnostic"
        (catalog.diagnostics <> []);
      assert_true "malformed specialist is not selected"
        (Agent_routing.entry_for catalog ~kind:Agents.Oracle ~effort:None = None));
  (match
     Agent_routing.parse_entry "taumel.agents.finder"
       (Shared.Object
          [
            ("model", Shared.String "openrouter/deepseek/deepseek-v4-flash");
            ("thinking", Shared.String "low");
          ])
   with
  | Error message -> failwith message
  | Ok entry ->
      assert_equal "nested provider model id accepted"
        "openrouter/deepseek/deepseek-v4-flash" entry.model);
  assert_error "model without provider rejected"
    (Agent_routing.parse_entry "taumel.agents.finder"
       (Shared.Object
          [
            ("model", Shared.String "model-only");
            ("thinking", Shared.String "low");
          ]))

let () =
  test_spawn_strips_agent_tools_and_returns_running ();
  test_unaccepted_spawn_rolls_back_identity_and_run ();
  test_closed_identity_id_is_never_reused ();
  test_specialist_tool_effect_clamps ();
  test_send_preflight_rollback_restores_state ();
  test_send_matrix ();
  test_wait_is_idempotent_and_observes_announcement ();
  test_wait_rejects_unknown_before_claiming ();
  test_close_removes_identity_and_runs ();
  test_shutdown_suspends_running_not_lost ();
  test_close_cleanup_failure_suspends_only_selected_agent ();
  test_process_loss_uses_child_session_availability ();
  test_identity_limit ();
  test_codec_roundtrip_and_legacy_rejection ();
  test_codec_persists_locator_not_assistant_output ();
  test_routing_merge_and_validation ();
  print_endline "test_agents_plan: ok"
