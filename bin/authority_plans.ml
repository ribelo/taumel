open Jsoo_bridge

type brokered_git = {
  command : string;
  argv : string list;
  git_dir : string;
  git_work_tree : string;
  agent_id : string option;
  subcommand : string;
}

type exec_plan = {
  cmd : string;
  workdir : string;
  yield_time_ms : float option;
  max_output_tokens : int option;
  tty : bool;
  sandbox : Taumel.Sandbox.config;
  host : Taumel.Sandbox.exec_host_facts;
  shell : string;
  brokered_git : brokered_git option;
}

type exa_plan = {
  tool_name : string;
  method_ : string;
  path : string;
  body_json : string option;
  last_event_id : string option;
}

type exec_state = Awaiting_approval | Ready of bool | Claimed of bool

type exec_entry = {
  owner_id : string;
  owner_context : Unsafe.any;
  plan : exec_plan;
  mutable state : exec_state;
}

type exa_state = Exa_awaiting_approval | Exa_ready
type exa_entry = {
  owner_id : string;
  owner_context : Unsafe.any;
  plan : exa_plan;
  mutable state : exa_state;
}
type agent_action_state = Agent_issued | Agent_claimed
type agent_action = Agent_start | Agent_send | Agent_close
type agent_action_entry = {
  owner_id : string;
  owner_context : Unsafe.any;
  action : agent_action;
  agent_id : string;
  owner_epoch : int;
  permission_epoch : int;
  state_epoch : int;
  expires_at_ms : float;
  mutable agent_action_state : agent_action_state;
}

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string name |]

let crypto = lazy (node_require "crypto")
let exec_entries : (string, exec_entry) Hashtbl.t = Hashtbl.create 32
let exa_entries : (string, exa_entry) Hashtbl.t = Hashtbl.create 32
let agent_action_entries : (string, agent_action_entry) Hashtbl.t = Hashtbl.create 32
let agent_action_epochs : (string, int) Hashtbl.t = Hashtbl.create 32

let rec fresh_id () =
  let id =
    Js.to_string
      (Unsafe.coerce
         (Unsafe.meth_call (Lazy.force crypto) "randomUUID" [||]))
  in
  let id = "plan-" ^ id in
  if
    Hashtbl.mem exec_entries id || Hashtbl.mem exa_entries id
    || Hashtbl.mem agent_action_entries id
  then fresh_id ()
  else id

let invalid_plan = "authority plan is invalid or already consumed"
let wrong_owner = "authority plan belongs to another session"
let same_context left right =
  let object_ = Unsafe.get Unsafe.global "Object" in
  Js.to_bool (Unsafe.coerce (Unsafe.fun_call (Unsafe.get object_ "is") [| left; right |]))

let agent_epoch_key owner_id agent_id = owner_id ^ "\000" ^ agent_id

let issue_agent_action ~owner_id ~owner_context ~action ~agent_id ~owner_epoch
    ~permission_epoch ~expires_at_ms =
  let epoch_key = agent_epoch_key owner_id agent_id in
  let state_epoch = Option.value (Hashtbl.find_opt agent_action_epochs epoch_key) ~default:0 + 1 in
  Hashtbl.replace agent_action_epochs epoch_key state_epoch;
  let id = fresh_id () in
  Hashtbl.add agent_action_entries id
    {
      owner_id;
      owner_context;
      action;
      agent_id;
      owner_epoch;
      permission_epoch;
      state_epoch;
      expires_at_ms;
      agent_action_state = Agent_issued;
    };
  id

let validate_agent_action ~owner_id ~action ~agent_id ~owner_epoch
    ~permission_epoch ~now_ms id required_state =
  match Hashtbl.find_opt agent_action_entries id with
  | None -> Error invalid_plan
  | Some entry when entry.owner_id <> owner_id ->
      Error wrong_owner
  | Some entry when entry.action <> action || entry.agent_id <> agent_id ->
      Error "agent action capability does not match the prepared action"
  | Some entry when now_ms > entry.expires_at_ms ->
      Hashtbl.remove agent_action_entries id;
      Error "agent action capability expired"
  | Some entry
    when entry.owner_epoch <> owner_epoch
         || entry.permission_epoch <> permission_epoch
         || entry.state_epoch
            <> Option.value
                 (Hashtbl.find_opt agent_action_epochs
                    (agent_epoch_key entry.owner_id entry.agent_id))
                 ~default:0 ->
      Error "agent action capability is stale"
  | Some entry when entry.agent_action_state <> required_state -> Error invalid_plan
  | Some entry -> Ok entry

let claim_agent_action ~owner_id ~action ~agent_id ~owner_epoch
    ~permission_epoch ~now_ms id =
  match
    validate_agent_action ~owner_id ~action ~agent_id ~owner_epoch
      ~permission_epoch ~now_ms id Agent_issued
  with
  | Error _ as error -> error
  | Ok entry ->
      entry.agent_action_state <- Agent_claimed;
      Ok ()

let revalidate_agent_action ~owner_id ~action ~agent_id ~owner_epoch
    ~permission_epoch ~now_ms id =
  Result.map (fun _ -> ())
    (validate_agent_action ~owner_id ~action ~agent_id ~owner_epoch
       ~permission_epoch ~now_ms id Agent_claimed)

let authorize_agent_cleanup ~owner_id ~action ~agent_id id =
  match Hashtbl.find_opt agent_action_entries id with
  | None -> Error invalid_plan
  | Some entry when entry.owner_id <> owner_id ->
      Error wrong_owner
  | Some entry
    when entry.action <> action || entry.agent_id <> agent_id
         || entry.agent_action_state <> Agent_claimed ->
      Error invalid_plan
  | Some _ -> Ok ()

let release_agent_action ~owner_id id =
  match Hashtbl.find_opt agent_action_entries id with
  | None -> Ok ()
  | Some entry when entry.owner_id <> owner_id ->
      Error wrong_owner
  | Some _ ->
      Hashtbl.remove agent_action_entries id;
      Ok ()

let revoke_agent_action id = Hashtbl.remove agent_action_entries id

let agent_action_in_progress ~owner_id ~agent_id =
  Hashtbl.fold
    (fun _ entry found ->
      found
      || (entry.owner_id = owner_id && entry.agent_id = agent_id
         && entry.agent_action_state = Agent_claimed))
    agent_action_entries false

let agent_action_expired_issued ~now_ms id =
  match Hashtbl.find_opt agent_action_entries id with
  | Some entry ->
      entry.agent_action_state = Agent_issued && now_ms > entry.expires_at_ms
  | None -> false

let issue_exec ~owner_id ~owner_context ~approval_required plan =
  let id = fresh_id () in
  let state = if approval_required then Awaiting_approval else Ready false in
  Hashtbl.add exec_entries id { owner_id; owner_context; plan; state };
  id

let exec_entry ~owner_context id =
  match Hashtbl.find_opt exec_entries id with
  | None -> Error invalid_plan
  | Some entry when not (same_context entry.owner_context owner_context) ->
      Error wrong_owner
  | Some entry -> Ok entry

let inspect_exec ~owner_context id =
  match exec_entry ~owner_context id with
  | Error _ as error -> error
  | Ok { state = Ready force_unsandboxed; plan; _ } ->
      Ok (plan, force_unsandboxed)
  | Ok { state = Awaiting_approval; _ } -> Error "authority plan requires approval"
  | Ok { state = Claimed _; _ } -> Error invalid_plan

let claim_exec ~owner_context id =
  match exec_entry ~owner_context id with
  | Error _ as error -> error
  | Ok ({ state = Ready force_unsandboxed; plan; _ } as entry) ->
      entry.state <- Claimed false;
      Ok (plan, force_unsandboxed)
  | Ok { state = Awaiting_approval; _ } -> Error "authority plan requires approval"
  | Ok { state = Claimed _; _ } -> Error invalid_plan

let approve_exec ~owner_context id =
  match exec_entry ~owner_context id with
  | Error _ as error -> error
  | Ok ({ state = Awaiting_approval; plan; _ } as entry) ->
      let restricted = plan.sandbox.isolated_child || plan.brokered_git <> None in
      entry.state <- Ready (not restricted);
      Ok ()
  | Ok _ -> Error invalid_plan

let finish_exec ~owner_context id ~retry_eligible =
  match exec_entry ~owner_context id with
  | Error _ as error -> error
  | Ok ({ state = Claimed false; _ } as entry) when retry_eligible ->
      entry.state <- Claimed true;
      Ok ()
  | Ok { state = Claimed false; _ } ->
      Hashtbl.remove exec_entries id;
      Ok ()
  | Ok _ -> Error invalid_plan

let reissue_exec_retry ~owner_context id =
  match exec_entry ~owner_context id with
  | Error _ as error -> error
  | Ok { state = Claimed true; plan; owner_id; owner_context; _ }
    when not plan.sandbox.isolated_child && plan.brokered_git = None ->
      Hashtbl.remove exec_entries id;
      let next_id = fresh_id () in
      Hashtbl.add exec_entries next_id
        { owner_id; owner_context; plan; state = Ready true };
      Ok next_id
  | Ok { state = Claimed true; _ } ->
      Error "restricted execution cannot be retried outside the sandbox"
  | Ok _ -> Error invalid_plan

let issue_exa ~owner_id ~owner_context ~approval_required plan =
  let id = fresh_id () in
  let state = if approval_required then Exa_awaiting_approval else Exa_ready in
  Hashtbl.add exa_entries id { owner_id; owner_context; plan; state };
  id

let approve_exa ~owner_context id =
  match Hashtbl.find_opt exa_entries id with
  | None -> Error invalid_plan
  | Some entry when not (same_context entry.owner_context owner_context) ->
      Error wrong_owner
  | Some ({ state = Exa_awaiting_approval; _ } as entry) ->
      entry.state <- Exa_ready;
      Ok ()
  | Some { state = Exa_ready; _ } -> Error invalid_plan

let consume_exa ~owner_context id =
  match Hashtbl.find_opt exa_entries id with
  | None -> Error invalid_plan
  | Some entry when not (same_context entry.owner_context owner_context) ->
      Error wrong_owner
  | Some { state = Exa_awaiting_approval; _ } ->
      Error "authority plan requires approval"
  | Some entry ->
      Hashtbl.remove exa_entries id;
      Ok entry.plan

let discard ~owner_context id =
  match (Hashtbl.find_opt exec_entries id, Hashtbl.find_opt exa_entries id) with
  | Some entry, _ when not (same_context entry.owner_context owner_context) ->
      Error wrong_owner
  | _, Some entry when not (same_context entry.owner_context owner_context) ->
      Error wrong_owner
  | Some _, _ ->
      Hashtbl.remove exec_entries id;
      Ok ()
  | _, Some _ ->
      Hashtbl.remove exa_entries id;
      Ok ()
  | None, None -> Error invalid_plan

let discard_owner owner_id =
  Hashtbl.filter_map_inplace
    (fun _ (entry : exec_entry) ->
      if entry.owner_id = owner_id then None else Some entry)
    exec_entries;
  Hashtbl.filter_map_inplace
    (fun _ (entry : exa_entry) ->
      if entry.owner_id = owner_id then None else Some entry)
    exa_entries;
  Hashtbl.filter_map_inplace
    (fun _ (entry : agent_action_entry) ->
      if entry.owner_id = owner_id then None else Some entry)
    agent_action_entries;
  Hashtbl.filter_map_inplace
    (fun key epoch ->
      if String.starts_with ~prefix:(owner_id ^ "\000") key then None
      else Some epoch)
    agent_action_epochs
