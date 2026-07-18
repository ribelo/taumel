open Jsoo_bridge
open App_state

let ttl_ms = 10 * 60 * 1000

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

let issue ?run_id ?submission_id ?(commit = fun () -> Ok ())
    ?(release = fun () -> ()) ~action ~agent_id ctx =
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
  let action = Tool_contracts.AgentActionCapabilityFacts.get_action facts in
  let ctx =
    Tool_contracts.AgentActionCapabilityFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  ( facts,
    action,
    Tool_contracts.AgentActionCapabilityFacts.get_agentId facts,
    Tool_contracts.AgentActionCapabilityFacts.get_capabilityId facts,
    Tool_contracts.AgentActionCapabilityFacts.get_runId facts,
    Tool_contracts.AgentActionCapabilityFacts.get_submissionId facts,
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
