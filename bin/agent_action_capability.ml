open Jsoo_bridge
open App_state

let ttl_ms = 10 * 60 * 1000

let action_of_string = function
  | "agent_start" -> Authority_plans.Agent_start
  | "agent_send" -> Authority_plans.Agent_send
  | "agent_close" -> Authority_plans.Agent_close
  | action -> invalid_arg ("unknown agent action: " ^ action)

type send_binding =
  | New_run of { run_id : string; submission_id : string }
  | Existing_run of string
  | No_run

type issuance =
  | Start of { run_id : string; submission_id : string }
  | Send of send_binding
  | Close

type pending_action = {
  owner_id : string;
  run_id : string option;
  submission_id : string option;
  commit : unit -> (unit, string) result;
  release : unit -> unit;
}

let pending_actions : (string, pending_action) Hashtbl.t = Hashtbl.create 32
let latest_by_agent : (string, string) Hashtbl.t = Hashtbl.create 32

let agent_key ctx agent_id =
  Session_store.session_id_from_ctx ctx ^ "\000" ^ agent_id

let in_progress ~agent_id ctx =
  Authority_plans.agent_action_in_progress
    ~owner_id:(Session_store.session_id_from_ctx ctx) ~agent_id

let remove_pending capability_id =
  (match Hashtbl.find_opt pending_actions capability_id with
  | None -> ()
  | Some pending -> pending.release ());
  Hashtbl.remove pending_actions capability_id;
  Hashtbl.filter_map_inplace
    (fun _ current -> if current = capability_id then None else Some current)
    latest_by_agent

let sweep_expired () =
  let now_ms = now_milliseconds_float () in
  pending_actions |> Hashtbl.to_seq_keys |> List.of_seq
  |> List.iter (fun capability_id ->
         if Authority_plans.agent_action_expired_issued ~now_ms capability_id then (
           Authority_plans.revoke_agent_action capability_id;
           remove_pending capability_id))

let issue ?(commit = fun () -> Ok ()) ?(release = fun () -> ()) issuance
    ~agent_id ctx =
  let action, run_id, submission_id =
    match issuance with
    | Start { run_id; submission_id } ->
        (Authority_plans.Agent_start, Some run_id, Some submission_id)
    | Send (New_run { run_id; submission_id }) ->
        (Authority_plans.Agent_send, Some run_id, Some submission_id)
    | Send (Existing_run run_id) ->
        (Authority_plans.Agent_send, Some run_id, None)
    | Send No_run -> (Authority_plans.Agent_send, None, None)
    | Close -> (Authority_plans.Agent_close, None, None)
  in
  sweep_expired ();
  let key = agent_key ctx agent_id in
  (match Hashtbl.find_opt latest_by_agent key with
  | None -> ()
  | Some previous ->
      Authority_plans.revoke_agent_action previous;
      Hashtbl.remove pending_actions previous);
  let capability_id =
    Authority_plans.issue_agent_action
    ~owner_id:(Session_store.session_id_from_ctx ctx) ~owner_context:ctx
    ~action ~agent_id ~owner_epoch:!owner_session_epoch
    ~permission_epoch:!permission_state_epoch
    ~expires_at_ms:(now_milliseconds_float () +. float_of_int ttl_ms)
  in
  Hashtbl.replace pending_actions capability_id
    { owner_id = Session_store.session_id_from_ctx ctx; run_id; submission_id; commit; release };
  Hashtbl.replace latest_by_agent key capability_id;
  capability_id

let discard_owner owner_id =
  Hashtbl.filter_map_inplace
    (fun capability_id pending ->
      if pending.owner_id = owner_id then (
        pending.release ();
        Authority_plans.revoke_agent_action capability_id;
        None)
      else Some pending)
    pending_actions;
  Hashtbl.filter_map_inplace
    (fun key capability_id ->
      if String.starts_with ~prefix:(owner_id ^ "\000") key then None
      else Some capability_id)
    latest_by_agent

let decode raw_facts =
  let facts =
    decode_ojs_contract Tool_contracts.AgentActionCapabilityFacts.t_of_js
      (ojs_of_js raw_facts)
  in
  let action =
    Tool_contracts.AgentActionCapabilityFacts.get_action facts |> action_of_string
  in
  let ctx =
    Tool_contracts.AgentActionCapabilityFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  let run_id = Tool_contracts.AgentActionCapabilityFacts.get_runId facts in
  let submission_id = Tool_contracts.AgentActionCapabilityFacts.get_submissionId facts in
  (match (action, run_id, submission_id) with
  | Authority_plans.Agent_start, Some _, Some _
  | Agent_send, Some _, Some _
  | Agent_send, Some _, None
  | Agent_send, None, None
  | Agent_close, None, None -> ()
  | Agent_start, _, _ -> invalid_arg "agent_start capability requires runId and submissionId"
  | Agent_close, _, _ -> invalid_arg "agent_close capability forbids runId and submissionId"
  | Agent_send, None, Some _ -> invalid_arg "agent_send submissionId requires runId");
  ( facts,
    action,
    Tool_contracts.AgentActionCapabilityFacts.get_agentId facts,
    Tool_contracts.AgentActionCapabilityFacts.get_capabilityId facts,
    run_id,
    submission_id,
    ctx )

let check operation raw_facts =
  let _facts, action, agent_id, capability_id, _run_id, _submission_id, ctx = decode raw_facts in
  Session_sync.require_agent_owner ctx;
  let result =
    operation ~owner_id:(Session_store.session_id_from_ctx ctx) ~action ~agent_id
      ~owner_epoch:!owner_session_epoch ~permission_epoch:!permission_state_epoch
      ~now_ms:(now_milliseconds_float ()) capability_id
  in
  match result with Ok () -> core_ack () | Error message -> error_obj message

let claim raw_facts =
  sweep_expired ();
  let _facts, action, agent_id, capability_id, run_id, submission_id, ctx = decode raw_facts in
  Session_sync.require_agent_owner ctx;
  match
    Authority_plans.claim_agent_action
      ~owner_id:(Session_store.session_id_from_ctx ctx) ~action ~agent_id
      ~owner_epoch:!owner_session_epoch
      ~permission_epoch:!permission_state_epoch
      ~now_ms:(now_milliseconds_float ()) capability_id
  with
  | Error message -> error_obj message
  | Ok () -> (
      match Hashtbl.find_opt pending_actions capability_id with
      | None ->
          Authority_plans.revoke_agent_action capability_id;
          error_obj "agent action reservation is unavailable"
      | Some pending -> (
          if pending.run_id <> run_id || pending.submission_id <> submission_id then (
            Authority_plans.revoke_agent_action capability_id;
            remove_pending capability_id;
            error_obj "agent action run or submission does not match reservation")
          else let committed =
            try pending.commit ()
            with error ->
              Error ("agent action commit failed: " ^ Printexc.to_string error)
          in
          match committed with
          | Ok () -> core_ack ()
          | Error message ->
              Authority_plans.revoke_agent_action capability_id;
              Hashtbl.remove pending_actions capability_id;
              pending.release ();
              error_obj message))

let revalidate raw_facts =
  check Authority_plans.revalidate_agent_action raw_facts

let authorize_cleanup raw_facts =
  let _facts, action, agent_id, capability_id, _run_id, _submission_id, ctx = decode raw_facts in
  match
    Authority_plans.authorize_agent_cleanup
      ~owner_id:(Session_store.session_id_from_ctx ctx) ~action ~agent_id
      capability_id
  with
  | Ok () -> core_ack ()
  | Error message -> error_obj message

let release raw_facts =
  let _facts, _action, agent_id, capability_id, _run_id, _submission_id, ctx = decode raw_facts in
  match
    Authority_plans.release_agent_action
      ~owner_id:(Session_store.session_id_from_ctx ctx) capability_id
  with
  | Ok () ->
      (match Hashtbl.find_opt pending_actions capability_id with
      | None -> ()
      | Some pending -> pending.release ());
      Hashtbl.remove pending_actions capability_id;
      let key = agent_key ctx agent_id in
      if Hashtbl.find_opt latest_by_agent key = Some capability_id then
        Hashtbl.remove latest_by_agent key;
      core_ack ()
  | Error message -> error_obj message
