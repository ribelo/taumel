open Jsoo_bridge
open Runtime_access

let js_command_spec (spec : Taumel.Tool_catalog.command_spec) =
  Tool_contracts.CommandSpec.create ~name:spec.name
    ~description:spec.description ()

let plan_command_notification facts =
  let facts = Tool_contracts.CommandNotificationFacts.t_of_js (ojs_of_js facts) in
  let notification =
    Taumel.Tool_catalog.command_notification
      ~command_name:(Tool_contracts.CommandNotificationFacts.get_commandName facts)
      ~ok:(Tool_contracts.CommandNotificationFacts.get_ok facts)
      ~message:(Tool_contracts.CommandNotificationFacts.get_message facts)
      ~error:(Tool_contracts.CommandNotificationFacts.get_error facts)
  in
  match
    Taumel.Tool_catalog.plan_command_notification
      ~ui_available:(Tool_contracts.CommandNotificationFacts.get_uiAvailable facts)
      notification
  with
  | Taumel.Tool_catalog.Notification_unavailable ->
      Tool_contracts.CommandNotificationUnavailable.create ~kind:"unavailable" ()
      |> Tool_contracts.CommandNotificationUnavailable.t_to_js |> inject
  | Taumel.Tool_catalog.Notification_send notification ->
      Tool_contracts.CommandNotificationSend.create ~kind:"notify"
        ~message:notification.message ~level:notification.level ()
      |> Tool_contracts.CommandNotificationSend.t_to_js |> inject

let active_ralph_child_session session_id =
  List.exists
    (fun (task : Taumel.Ralph_loop.task) ->
      task.status = Taumel.Ralph_loop.Running
      && task.child_session = Some session_id)
    !App_state.ralph_tasks

let ralph_child_context ctx =
  match optional_string_field ctx "taumelRalphChildSessionId" with
  | Some value when String.trim value <> "" -> true
  | _ ->
      let session_id = Session_store.session_id_from_ctx ctx in
      if active_ralph_child_session session_id then true
      else
        match Session_store.custom_entry_data ctx "taumel.childSession" with
        | Some data when get_string data "kind" = "ralph" -> true
        | _ -> false

let plan_active_tools_sync_js facts =
  let facts = Tool_contracts.ActiveToolsSyncFacts.t_of_js (ojs_of_js facts) in
  let ctx =
    Tool_contracts.ActiveToolsSyncFacts.get_ctx facts
    |> Option.map Obj.magic |> Option.value ~default:(Unsafe.obj [||])
  in
  Session_sync.refresh_session_state_from_host ~scope:"active tools sync" ctx;
  Session_sync.sync_persisted_session ctx;
  let tool_names = Tool_contracts.ActiveToolsSyncFacts.get_tools facts in
  let ralph_child = ralph_child_context ctx in
  let provider =
    if App_state.state.provider = "" then None else Some App_state.state.provider
  in
  let plan =
    Taumel.Tool_catalog.plan_active_tools_sync ?provider ~ralph_child tool_names
      ~disabled_tools:
        (Taumel.Visibility.disabled Taumel.Visibility.Tools
           !App_state.visibility_state)
  in
  let result =
    Tool_contracts.ActiveToolsPlan.create ~changed:plan.changed
      ~tools:plan.tools ()
  in
  Tool_contracts.ActiveToolsPlan.t_to_js result |> inject

let tool_policy_names_js () =
  let result =
    Tool_contracts.ToolNamesResult.create ~names:Taumel.Tool_catalog.tool_names ()
  in
  Tool_contracts.ToolNamesResult.t_to_js result |> inject

let allowed_tool_names_js () =
  let names =
    Taumel.Tool_gateway.exposeable_specs (active_profile ())
      Taumel.Runtime_policy.gateway_registry
    |> List.map (fun (spec : Taumel.Tool_gateway.spec) -> spec.name)
  in
  let result = Tool_contracts.ToolNamesResult.create ~names () in
  Tool_contracts.ToolNamesResult.t_to_js result |> inject

let command_specs_js () =
  let result =
    Tool_contracts.CommandSpecsResult.create
      ~specs:(List.map js_command_spec Taumel.Tool_catalog.command_specs) ()
  in
  Tool_contracts.CommandSpecsResult.t_to_js result |> inject
