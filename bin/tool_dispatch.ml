open Jsoo_bridge
open App_state

let prepare name params ctx =
  Session_sync.sync_session_from_host ~scope:"tool prepare"
    ~reset_missing:(name <> "ralph_continue" && name <> "ralph_finish")
    ctx;
  match name with
  | "exec_command" -> Mutation_tools.prepare_exec_command params
  | "write_stdin" -> Mutation_tools.prepare_write_stdin params
  | "apply_patch" -> Mutation_tools.prepare_apply_patch params
  | "write" -> Mutation_tools.prepare_write params
  | "edit" -> Mutation_tools.prepare_edit params
  | "get_goal" -> Goal_tools.prepare_get ()
  | "create_goal" -> Goal_tools.prepare_create params ctx
  | "update_goal" -> Goal_tools.prepare_update params ctx
  | "request_user_input" -> Request_input_bridge.prepare params
  | "find_thread" -> Thread_bridge.prepare_find params
  | "read_thread" -> Thread_bridge.prepare_read params
  | "agent" -> Agent_tools.prepare params ctx
  | "ralph_continue" | "ralph_finish" -> Ralph_tools.prepare_child_tool name params ctx
  | other -> error_obj ("tool executor is not connected yet: " ^ other)
