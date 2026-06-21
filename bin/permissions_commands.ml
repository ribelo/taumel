open Jsoo_bridge
open App_state

let apply_state (next : Taumel.Permissions.state) =
  active_profile_state := next.Taumel.Permissions.profile;
  active_network_mode := next.Taumel.Permissions.sandbox.network_mode;
  active_no_sandbox := next.Taumel.Permissions.sandbox.no_sandbox;
  active_subagent := next.Taumel.Permissions.sandbox.subagent;
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

let prompt_result permissions =
  ok_obj
    [
      ("action", js_string "permissions_prompt");
      ("title", js_string Taumel.Permissions.default_prompt_title);
      ("message", js_string (Taumel.Permissions.summary permissions));
      ( "options",
        js_array
          (Taumel.Permissions.permissions_menu_options permissions
          |> List.map (fun option -> inject (js_menu_option option))) );
    ]

let handle args ctx =
  let workspace_roots = if state.cwd = "" then [] else [ state.cwd ] in
  match
    Taumel.Permissions.create ~workspace_roots
      ~network_mode:!active_network_mode ~no_sandbox:!active_no_sandbox
      ~subagent:!active_subagent (active_profile ())
  with
  | Error message -> error_obj message
  | Ok permissions -> (
      if String.trim args = "" then prompt_result permissions
      else
      match Taumel.Permissions.parse args with
      | Error message -> error_obj message
      | Ok None ->
          ok_obj
            [
              ("action", js_string "command_result");
              ("message", js_string (Taumel.Permissions.summary permissions));
            ]
      | Ok (Some update) -> (
          match Taumel.Permissions.apply_update permissions update with
          | Error message -> error_obj message
          | Ok next ->
              apply_state next;
              Session_sync.save_permissions_state ctx;
              (match !active_host with Some host -> emit_changed host | None -> ());
              ok_obj
                [
                  ("action", js_string "command_result");
                  ("message", js_string (Taumel.Permissions.summary next));
                ]))

let finish_prompt prompt selection ctx =
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
      | Some args -> handle args ctx

let plan_prompt prompt facts =
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
            finish_prompt prompt
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
