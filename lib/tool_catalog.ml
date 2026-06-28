type command_spec = {
  name : string;
  description : string;
}

type command_notification = {
  message : string;
  level : string;
}

type command_notification_plan =
  | Notification_unavailable
  | Notification_send of command_notification

type active_tools_sync = {
  tools : string list;
  changed : bool;
}

let tool_specs =
  Sandbox.canonical_tool_specs
  @ Subagents.tool_specs
  @ Goal.tool_specs @ Ralph_loop.tool_specs
  @ Thread_tools.tool_specs @ Exa.tool_specs

let command_specs =
  [
    {
      name = "permissions";
      description = "Configure sandbox preset, approval, and tool/agent access.";
    };
    { name = "network"; description = "Enable or disable sandbox network access." };
    { name = "composer"; description = "Configure the Taumel composer UI." };
    { name = "ralph"; description = "Start, pause, resume, finish, and list Ralph tasks." };
    { name = "usage"; description = "Show OpenAI account and quota usage." };
    { name = "goal"; description = "Show or update the thread goal." };
    { name = "agents"; description = "List, enable, or disable Taumel agent profiles." };
    { name = "agent-runs"; description = "Inspect and close Taumel agent identities and runs." };
    { name = "execpolicy"; description = "Show or check exec command policy decisions." };
  ]

let tool_names = List.map (fun (spec : Tool_gateway.spec) -> spec.name) tool_specs
let command_names = List.map (fun spec -> spec.name) command_specs

let has_tool name = List.exists (( = ) name) tool_names
let has_command name = List.exists (( = ) name) command_names

let command_notification ~command_name ~ok ~message ~error =
  let message =
    if message <> "" then message
    else if error <> "" then error
    else command_name ^ " completed."
  in
  { message; level = (if ok then "info" else "warning") }

let plan_command_notification ~ui_available notification =
  if ui_available then Notification_send notification else Notification_unavailable

let unique_tool_names tool_names =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | name :: rest ->
        if List.mem name seen then loop seen acc rest
        else loop (name :: seen) (name :: acc) rest
  in
  loop [] [] tool_names

let openai_apply_patch_providers = [ "openai"; "openai-codex" ]

let should_use_apply_patch_for_provider = function
  | Some provider -> List.mem provider openai_apply_patch_providers
  | None -> false

let legacy_mutation_selection tool_names =
  tool_names
  |> List.filter (fun name -> name = "edit" || name = "write")
  |> unique_tool_names

let rewrite_mutation_tool_names ?provider tool_names =
  let mutation_tools = [ "edit"; "write"; "apply_patch" ] in
  if not (List.exists (fun name -> List.mem name mutation_tools) tool_names) then
    unique_tool_names tool_names
  else
    let replacement =
      if should_use_apply_patch_for_provider provider then [ "apply_patch" ]
      else
        match legacy_mutation_selection tool_names with
        | [] -> [ "edit"; "write" ]
        | selected -> selected
    in
    let rec loop inserted acc = function
      | [] -> List.rev acc
      | name :: rest when List.mem name mutation_tools ->
          if inserted then loop inserted acc rest
          else loop true (List.rev_append replacement acc) rest
      | name :: rest -> loop inserted (name :: acc) rest
  in
  loop false [] tool_names |> unique_tool_names

let remove_tool_names removed tool_names =
  List.filter (fun name -> not (List.mem name removed)) tool_names

let ensure_tool_names required tool_names =
  unique_tool_names (tool_names @ required)

let ralph_control_tool_names = [ "ralph_continue"; "ralph_finish" ]
let ambient_hidden_tool_names = [ "usage"; "user_detection_tool" ]
let child_goal_removed_tool_names = [ "create_goal" ]
let child_goal_required_tool_names = [ "update_goal" ]

let rewrite_shell_tool_names tool_names =
  let push name values = if List.mem name values then values else values @ [ name ] in
  let rec loop inserted acc = function
    | [] -> acc
    | "bash" :: rest when inserted -> loop inserted acc rest
    | "bash" :: rest ->
        loop true (acc |> push "exec_command" |> push "write_stdin") rest
    | "exec_command" :: rest when not inserted ->
        loop true (acc |> push "exec_command" |> push "write_stdin") rest
    | name :: rest -> loop inserted (push name acc) rest
  in
  loop false [] tool_names

let rewrite_active_tools ?provider ?(ralph_child = false) tool_names =
  let tool_names =
    tool_names |> rewrite_mutation_tool_names ?provider |> rewrite_shell_tool_names
    |> remove_tool_names ambient_hidden_tool_names
  in
  let tool_names =
    if ralph_child then remove_tool_names Subagents.all_agent_tool_names tool_names
    else tool_names
  in
  if ralph_child then ensure_tool_names ralph_control_tool_names tool_names
  else remove_tool_names ralph_control_tool_names tool_names

let plan_agent_child_active_tools ~worker_tools ~current_active_tools_available
    ~current_active_tools =
  let agent_child_tools tool_names =
    tool_names
    |> remove_tool_names Subagents.all_agent_tool_names
    |> remove_tool_names child_goal_removed_tool_names
    |> ensure_tool_names child_goal_required_tool_names
  in
  match worker_tools with
  | Some tools -> Some (agent_child_tools tools)
  | None when current_active_tools_available ->
      Some (rewrite_active_tools current_active_tools |> agent_child_tools)
  | None -> None

let plan_active_tools_sync ?provider ?(ralph_child = false) tool_names =
  let current = unique_tool_names tool_names in
  let tools = rewrite_active_tools ?provider ~ralph_child current in
  { tools; changed = current <> tools }
