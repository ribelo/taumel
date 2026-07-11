open Jsoo_bridge
open App_state
open Runtime_access

let apply_state (next : Taumel.Permissions.state) =
  active_profile_state := next.Taumel.Permissions.profile;
  active_network_mode := next.Taumel.Permissions.sandbox.network_mode;
  active_no_sandbox := next.Taumel.Permissions.sandbox.no_sandbox;
  active_isolated_child := next.Taumel.Permissions.sandbox.isolated_child;
  state.filesystem_mode <-
    Taumel.Capability_profile.sandbox_to_string
      next.Taumel.Permissions.profile.sandbox_preset

let js_menu_option (option : Taumel.Permissions.menu_option) =
  Unsafe.obj
    [|
      ("label", js_string option.label);
      ("value", js_string option.value);
      ("description", js_string option.description);
      ("selected", js_bool option.selected);
    |]

let menu_option_from_js obj =
  {
    Taumel.Permissions.label = get_string obj "label";
    value = get_string obj "value";
    description = get_string obj "description";
    selected = get_bool obj "selected";
  }

let prompt_with ~title ~options permissions =
  ok_obj
    [
      ("action", js_string "permissions_prompt");
      ("title", js_string title);
      ("message", js_string (Taumel.Permissions.summary permissions));
      ( "options",
        js_array (List.map (fun option -> inject (js_menu_option option)) options)
      );
    ]

let prompt_result permissions =
  prompt_with ~title:Taumel.Permissions.default_prompt_title
    ~options:(Taumel.Permissions.permissions_menu_options permissions)
    permissions

let network_prompt_result permissions =
  prompt_with ~title:Taumel.Permissions.network_prompt_title
    ~options:(Taumel.Permissions.network_menu_options permissions)
    permissions

let build_permissions () =
  let workspace_roots = if state.cwd = "" then [] else [ state.cwd ] in
  Taumel.Permissions.create ~workspace_roots ~network_mode:!active_network_mode
    ~no_sandbox:!active_no_sandbox ~isolated_child:!active_isolated_child (active_profile ())

let command_result message =
  ok_obj [ ("action", js_string "command_result"); ("message", js_string message) ]

let apply_and_persist permissions update ctx =
  match Taumel.Permissions.apply_update permissions update with
  | Error message -> error_obj message
  | Ok next ->
      apply_state next;
      Session_sync.save_permissions_state ctx;
      (match !active_host with Some host -> emit_changed host | None -> ());
      command_result (Taumel.Permissions.summary next)

let run ~parser ~on_empty args ctx =
  match build_permissions () with
  | Error message -> error_obj message
  | Ok permissions ->
      if String.trim args = "" then on_empty permissions
      else (
        match parser args with
        | Error message -> error_obj message
        | Ok None -> command_result (Taumel.Permissions.summary permissions)
        | Ok (Some update) -> apply_and_persist permissions update ctx)

let handle args ctx =
  run ~parser:Taumel.Permissions.parse_permissions ~on_empty:prompt_result args ctx

let handle_network args ctx =
  run ~parser:Taumel.Permissions.parse_network ~on_empty:network_prompt_result
    args ctx

let apply_menu_value value ctx =
  run ~parser:Taumel.Permissions.parse ~on_empty:prompt_result value ctx

let finish_prompt_impl prompt selection ctx =
  match get_string selection "status" with
  | "cancelled" ->
      ok_obj
        [
          ("action", js_string "command_result");
          ("message", js_string "Permissions unchanged.");
          ("details", inject (Unsafe.obj [| ("cancelled", js_bool true) |]));
        ]
  | "unavailable" ->
      ok_obj
        [
          ("action", js_string "command_result");
          ("message", js_string (get_string prompt "message"));
          ("details", inject (Unsafe.obj [| ("unavailable", js_bool true) |]));
        ]
  | _ ->
      let options =
        get_object_array prompt "options" |> List.map menu_option_from_js
      in
      let selected = get_string selection "selected" in
      match Taumel.Permissions.menu_selected_value options selected with
      | None ->
          Unsafe.obj
            [|
              ("ok", js_bool false);
              ("action", js_string "command_result");
              ("message", js_string "Invalid permissions selection.");
            |]
      | Some value -> apply_menu_value value ctx

let plan_prompt_impl prompt facts =
  let options =
    get_object_array prompt "options" |> List.map menu_option_from_js
  in
  match
    Taumel.Permissions.prompt_selection_plan
      ~ui_available:(get_bool facts "uiAvailable")
      ~title:(get_string prompt "title") options
  with
  | Taumel.Permissions.Prompt_unavailable ->
      ok_obj
        [
          ("action", js_string "result");
          ( "result",
            finish_prompt_impl prompt
              (Unsafe.obj [| ("status", js_string "unavailable") |])
              (Unsafe.obj [||]) );
        ]
  | Taumel.Permissions.Prompt_select plan ->
      ok_obj
        [
          ("action", js_string "select");
          ("title", js_string plan.title);
          ("labels", js_array (List.map js_string plan.labels));
        ]

let plan_prompt raw_facts =
  let facts = Tool_contracts.PermissionsPromptFacts.t_of_js (ojs_of_js raw_facts) in
  let prompt = Tool_contracts.PermissionsPromptFacts.get_prompt facts
    |> Tool_contracts.PermissionsPrompt.t_to_js |> Obj.magic
  in
  let host_facts = Unsafe.obj [| ("uiAvailable", js_bool (Tool_contracts.PermissionsPromptFacts.get_uiAvailable facts)) |] in
  let plan = plan_prompt_impl prompt host_facts in
  if get_string plan "action" = "select" then
    Tool_contracts.PermissionsPromptSelect.create ~kind:"select"
      ~title:(get_string plan "title") ~labels:(get_string_array plan "labels") ()
    |> Tool_contracts.PermissionsPromptSelect.t_to_js |> inject
  else
    let result = Unsafe.get plan "result" in
    Tool_contracts.PermissionsPromptResult.create ~kind:"result"
      ~result:(Tool_contracts.PermissionsCommandResult.t_of_js (ojs_of_js result)) ()
    |> Tool_contracts.PermissionsPromptResult.t_to_js |> inject

let finish_prompt raw_facts =
  let facts = Tool_contracts.PermissionsPromptFinishFacts.t_of_js (ojs_of_js raw_facts) in
  let prompt = Tool_contracts.PermissionsPromptFinishFacts.get_prompt facts
    |> Tool_contracts.PermissionsPrompt.t_to_js |> Obj.magic
  in
  let selection = Tool_contracts.PermissionsPromptFinishFacts.get_selection facts
    |> Tool_contracts.PermissionsSelection.t_to_js |> Obj.magic
  in
  let ctx = Tool_contracts.PermissionsPromptFinishFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> Obj.magic
  in
  let output = finish_prompt_impl prompt selection ctx in
  if get_string output "action" = "command_result" then
    output |> ojs_of_js |> Tool_contracts.PermissionsCommandResult.t_of_js
    |> Tool_contracts.PermissionsCommandResult.t_to_js |> inject
  else
    let message = get_string output "error" in
    Tool_contracts.PermissionsCommandResult.create ~ok:false ~action:"command_result"
      ~message ~error:message ()
    |> Tool_contracts.PermissionsCommandResult.t_to_js |> inject
