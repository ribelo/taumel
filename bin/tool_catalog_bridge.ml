open Jsoo_bridge

let js_command_spec (spec : Taumel.Tool_catalog.command_spec) =
  Unsafe.obj
    [|
      ("name", js_string spec.name);
      ("description", js_string spec.description);
    |]

let command_notification_record name result =
  if is_js_object result then
    Taumel.Tool_catalog.command_notification ~command_name:(Js.to_string name)
      ~ok:(get_bool result "ok") ~message:(get_string result "message")
      ~error:(get_string result "error")
  else
    Taumel.Tool_catalog.command_notification ~command_name:(Js.to_string name)
      ~ok:false ~message:"" ~error:""

let plan_command_notification name result facts =
  let notification = command_notification_record name result in
  match
    Taumel.Tool_catalog.plan_command_notification
      ~ui_available:(get_bool facts "uiAvailable")
      notification
  with
  | Taumel.Tool_catalog.Notification_unavailable ->
      ok_obj [ ("action", js_string "unavailable") ]
  | Taumel.Tool_catalog.Notification_send notification ->
      ok_obj
        [
          ("action", js_string "notify");
          ("message", js_string notification.message);
          ("level", js_string notification.level);
        ]

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

let tool_names_from_js tool_names =
  array_items tool_names |> List.filter_map string_value

let plan_active_tools_sync_js tool_names ctx =
  Session_sync.refresh_session_state_from_host ~scope:"active tools sync" ctx;
  Session_sync.sync_persisted_session ctx;
  let tool_names = tool_names_from_js tool_names in
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
  ok_obj
    [
      ("changed", js_bool plan.changed);
      ("tools", js_array (List.map js_string plan.tools));
    ]

let tool_policy_names_js () =
  js_array (List.map js_string Taumel.Tool_catalog.tool_names)

let allowed_tool_names_js () =
  Taumel.Tool_gateway.exposeable_specs (App_state.active_profile ())
    Taumel.Runtime_policy.gateway_registry
  |> List.map (fun (spec : Taumel.Tool_gateway.spec) -> spec.name)
  |> js_array_of_strings

let command_specs_js () =
  js_array (List.map js_command_spec Taumel.Tool_catalog.command_specs)
