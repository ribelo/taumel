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

val issue_exec : owner_id:string -> owner_context:Js_of_ocaml.Js.Unsafe.any -> approval_required:bool -> exec_plan -> string
val inspect_exec : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (exec_plan * bool, string) result
val claim_exec : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (exec_plan * bool, string) result
val approve_exec : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (unit, string) result
val finish_exec : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> retry_eligible:bool -> (unit, string) result
val reissue_exec_retry : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (string, string) result

val issue_exa : owner_id:string -> owner_context:Js_of_ocaml.Js.Unsafe.any -> approval_required:bool -> exa_plan -> string
val approve_exa : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (unit, string) result
val consume_exa : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (exa_plan, string) result

val discard : owner_context:Js_of_ocaml.Js.Unsafe.any -> string -> (unit, string) result
val discard_owner : string -> unit

type agent_action = Agent_start | Agent_send | Agent_close
val issue_agent_action : owner_id:string -> owner_context:Js_of_ocaml.Js.Unsafe.any -> action:agent_action -> agent_id:string -> owner_epoch:int -> permission_epoch:int -> expires_at_ms:float -> string
val claim_agent_action : owner_id:string -> action:agent_action -> agent_id:string -> owner_epoch:int -> permission_epoch:int -> now_ms:float -> string -> (unit, string) result
val revalidate_agent_action : owner_id:string -> action:agent_action -> agent_id:string -> owner_epoch:int -> permission_epoch:int -> now_ms:float -> string -> (unit, string) result
val authorize_agent_cleanup : owner_id:string -> action:agent_action -> agent_id:string -> string -> (unit, string) result
val release_agent_action : owner_id:string -> string -> (unit, string) result
val revoke_agent_action : string -> unit
val agent_action_in_progress : owner_id:string -> agent_id:string -> bool
val agent_action_expired_issued : now_ms:float -> string -> bool
