open Jsoo_bridge

let builtin_overrides_from_js settings =
  match
    Option.bind (optional_field settings "taumel") (fun taumel ->
        optional_field taumel "agents")
  with
  | None -> Taumel.Global_settings.default.taumel.agents
  | Some agents ->
      object_keys agents
      |> List.filter (fun name -> List.mem name Taumel.Global_settings.builtin_profile_names)
      |> List.map (fun name ->
             let override = Unsafe.get agents name in
             ( name,
               ({
                  provider = get_string override "provider";
                  model = get_string override "model";
                  thinking = get_string override "thinking";
                }
                 : Taumel.Global_settings.agent_builtin_override) ))

let settings_from_js settings =
  let taumel = Unsafe.get settings "taumel" in
  let composer = Unsafe.get taumel "composer" in
  let builtins = builtin_overrides_from_js settings in
  {
    Taumel.Global_settings.taumel =
      { composer = { enabled = get_bool composer "enabled" }; agents = builtins };
  }

let handle args facts =
  let settings = settings_from_js (Unsafe.get facts "settings") in
  let path = get_string facts "path" in
  match Taumel.Global_settings.plan_composer_command ~settings ~path args with
  | Error message -> error_obj message
  | Ok result ->
      ok_obj
        [
          ("action", js_string "command_result");
          ("message", js_string result.message);
          ("settings", json_to_js (Taumel.Global_settings.to_json result.settings));
          ("writeSettings", js_bool result.write_settings);
        ]
