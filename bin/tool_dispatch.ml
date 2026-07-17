open Jsoo_bridge
open App_state

let prepare raw_facts =
  let facts = decode_ojs_contract Tool_contracts.PrepareToolFacts.t_of_js (ojs_of_js raw_facts) in
  let name = Tool_contracts.PrepareToolFacts.get_name facts in
  let params =
    Tool_contracts.PrepareToolFacts.get_params facts
    |> Ts2ocaml.unknown_to_js |> Tool_param_decoders.decode name
    |> require_contract |> js_of_ojs
  in
  let ctx = Tool_contracts.PrepareToolFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  (* Every generic preparation may read session-scoped authority. A failed
     refresh must abort before dispatch so no tool can authorize against the
     previously loaded session projection. *)
  let host_sync =
    Session_sync.try_sync_session_from_host ~scope:"tool prepare"
      ~reset_missing:(name <> "ralph_continue" && name <> "ralph_finish") ctx
  in
  match host_sync with
  | Error message -> error_obj message
  | Ok () -> (
      match name with
      | "agent_spawn" | "agent_send" | "agent_wait" | "agent_list"
      | "agent_close" | "finder" | "oracle" ->
          Agent_tools.prepare name params ctx
      | "exec_command" -> Mutation_tools.prepare_exec_command params ctx
      | "write_stdin" -> Mutation_tools.prepare_write_stdin params
      | "apply_patch" -> Mutation_tools.prepare_apply_patch params ctx
      | "write" -> Mutation_tools.prepare_write params ctx
      | "read" -> Mutation_tools.prepare_read params
      | "view_media" -> View_media_tool.prepare params
      | "edit" -> Mutation_tools.prepare_edit params ctx
      | "get_goal" -> Goal_tools.prepare_get ()
      | "create_goal" -> Goal_tools.prepare_create params ctx
      | "update_goal" -> Goal_tools.prepare_update params ctx
      | "query_threads" -> Thread_bridge.prepare_query params
      | "read_thread" -> Thread_bridge.prepare_read params
      | "cron_create" | "cron_list" | "cron_delete" ->
          Cron_tools.prepare name params ctx
      | "ralph_continue" | "ralph_finish" ->
          Ralph_tools.prepare_child_tool name params ctx
      | "web_search_exa" -> Exa_bridge.prepare_web_search params ctx
      | "crawling_exa" -> Exa_bridge.prepare_crawling params ctx
      | "get_code_context_exa" -> Exa_bridge.prepare_code_context params ctx
      | "exa_agent_create_run" -> Exa_bridge.prepare_agent_create_run params ctx
      | "exa_agent_get_run" -> Exa_bridge.prepare_agent_get_run params ctx
      | "exa_agent_list_runs" -> Exa_bridge.prepare_agent_list_runs params ctx
      | "exa_agent_cancel_run" -> Exa_bridge.prepare_agent_cancel_run params ctx
      | "exa_agent_list_events" -> Exa_bridge.prepare_agent_list_events params ctx
      | other ->
          Boundary_contracts.GatewayCommandError.create
            ~error:("tool executor is not connected yet: " ^ other) ()
          |> Tool_contracts.GatewayCommandError.t_to_js |> inject)
