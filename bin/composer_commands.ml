open Jsoo_bridge

let settings_from_js settings =
  let composer = Unsafe.get settings "composer" in
  {
    Taumel.Global_settings.composer =
      { enabled = get_bool composer "enabled" };
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
