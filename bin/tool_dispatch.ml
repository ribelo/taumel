open Jsoo_bridge
open App_state

let prepare raw_facts =
  let facts = Tool_contracts.PrepareToolFacts.t_of_js (ojs_of_js raw_facts) in
  let name = Tool_contracts.PrepareToolFacts.get_name facts in
  let params = Tool_contracts.PrepareToolFacts.get_params facts
    |> Ts2ocaml.unknown_to_js |> Obj.magic
  in
  let ctx = Tool_contracts.PrepareToolFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> Obj.magic
  in
  Session_sync.sync_session_from_host ~scope:"tool prepare"
    ~reset_missing:(name <> "ralph_continue" && name <> "ralph_finish") ctx;
  match name with
  | "exec_command" -> Mutation_tools.prepare_exec_command params
  | "write_stdin" -> Mutation_tools.prepare_write_stdin params
  | "apply_patch" -> Mutation_tools.prepare_apply_patch params
  | "write" -> Mutation_tools.prepare_write params
  | "read" -> Mutation_tools.prepare_read params
  | "view_media" -> View_media_tool.prepare params
  | "edit" -> Mutation_tools.prepare_edit params
  | "get_goal" -> Goal_tools.prepare_get ()
  | "create_goal" -> Goal_tools.prepare_create params ctx
  | "update_goal" -> Goal_tools.prepare_update params ctx
  | "query_threads" -> Thread_bridge.prepare_query params
  | "read_thread" -> Thread_bridge.prepare_read params
  | "cron_create" | "cron_list" | "cron_delete" -> Cron_tools.prepare name params ctx
  | "ralph_continue" | "ralph_finish" -> Ralph_tools.prepare_child_tool name params ctx
  | "web_search_exa" -> Exa_bridge.prepare_web_search params
  | "crawling_exa" -> Exa_bridge.prepare_crawling params
  | "get_code_context_exa" -> Exa_bridge.prepare_code_context params
  | "exa_agent_create_run" -> Exa_bridge.prepare_agent_create_run params
  | "exa_agent_get_run" -> Exa_bridge.prepare_agent_get_run params
  | "exa_agent_list_runs" -> Exa_bridge.prepare_agent_list_runs params
  | "exa_agent_cancel_run" -> Exa_bridge.prepare_agent_cancel_run params
  | "exa_agent_list_events" -> Exa_bridge.prepare_agent_list_events params
  | other -> error_obj ("tool executor is not connected yet: " ^ other)
