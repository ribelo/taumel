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
  Tool_contracts.PermissionsMenuOption.create ~label:option.label
    ~value:option.value ~description:option.description ~selected:option.selected ()

let menu_option_from_js obj =
  {
    Taumel.Permissions.label = get_string obj "label";
    value = get_string obj "value";
    description = get_string obj "description";
    selected = get_bool obj "selected";
  }

let prompt_with ~title ~options permissions =
  Boundary_contracts.PermissionsPrompt.create ~title
    ~message:(Taumel.Permissions.summary permissions)
    ~options:(List.map js_menu_option options) ()
  |> Tool_contracts.PermissionsPrompt.t_to_js |> inject

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
  Boundary_contracts.PermissionsCommandResult.create ~ok:true ~message ()
  |> Tool_contracts.PermissionsCommandResult.t_to_js |> inject

let apply_and_persist permissions update ctx =
  match Taumel.Permissions.apply_update permissions update with
  | Error message -> error_obj message
  | Ok next ->
      apply_state next;
      if not next.Taumel.Permissions.sandbox.isolated_child then
        capture_loaded_footer_permissions ();
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
      Boundary_contracts.PermissionsCommandResult.create ~ok:true
        ~message:"Permissions unchanged."
        ~details:
          (Ts2ocaml.unknown_of_js
             (ojs_of_js (Unsafe.obj [| ("cancelled", js_bool true) |]))) ()
      |> Tool_contracts.PermissionsCommandResult.t_to_js |> inject
  | "unavailable" ->
      Boundary_contracts.PermissionsCommandResult.create ~ok:true
        ~message:(get_string prompt "message")
        ~details:
          (Ts2ocaml.unknown_of_js
             (ojs_of_js (Unsafe.obj [| ("unavailable", js_bool true) |]))) ()
      |> Tool_contracts.PermissionsCommandResult.t_to_js |> inject
  | _ ->
      let options =
        get_object_array prompt "options" |> List.map menu_option_from_js
      in
      let selected = get_string selection "selected" in
      match Taumel.Permissions.menu_selected_value options selected with
      | None ->
          Boundary_contracts.PermissionsCommandResult.create ~ok:false
            ~message:"Invalid permissions selection."
            ~error:"Invalid permissions selection." ()
          |> Tool_contracts.PermissionsCommandResult.t_to_js |> inject
      | Some value -> apply_menu_value value ctx

let plan_prompt raw_facts =
  let facts = decode_ojs_contract Tool_contracts.PermissionsPromptFacts.t_of_js (ojs_of_js raw_facts) in
  let prompt = Tool_contracts.PermissionsPromptFacts.get_prompt facts
    |> Tool_contracts.PermissionsPrompt.t_to_js |> js_of_ojs
  in
  let options =
    get_object_array prompt "options" |> List.map menu_option_from_js
  in
  match
    Taumel.Permissions.prompt_selection_plan
      ~ui_available:(Tool_contracts.PermissionsPromptFacts.get_uiAvailable facts)
      ~title:(get_string prompt "title") options
  with
  | Taumel.Permissions.Prompt_unavailable ->
      let result =
        finish_prompt_impl prompt
          (Unsafe.obj [| ("status", js_string "unavailable") |])
          (Unsafe.obj [||])
        |> ojs_of_js |> decode_ojs_contract Tool_contracts.PermissionsCommandResult.t_of_js
      in
      Boundary_contracts.PermissionsPromptResult.create ~result ()
      |> Tool_contracts.PermissionsPromptResult.t_to_js |> inject
  | Taumel.Permissions.Prompt_select plan ->
      Boundary_contracts.PermissionsPromptSelect.create ~title:plan.title
        ~labels:plan.labels ()
      |> Tool_contracts.PermissionsPromptSelect.t_to_js |> inject

let finish_prompt raw_facts =
  let facts = decode_ojs_contract Tool_contracts.PermissionsPromptFinishFacts.t_of_js (ojs_of_js raw_facts) in
  let prompt = Tool_contracts.PermissionsPromptFinishFacts.get_prompt facts
    |> Tool_contracts.PermissionsPrompt.t_to_js |> js_of_ojs
  in
  let selection = Tool_contracts.PermissionsPromptFinishFacts.get_selection facts
    |> Tool_contracts.PermissionsSelection.t_to_js |> js_of_ojs
  in
  let ctx = Tool_contracts.PermissionsPromptFinishFacts.get_ctx facts
    |> Ts2ocaml.unknown_to_js |> js_of_ojs
  in
  finish_prompt_impl prompt selection ctx
