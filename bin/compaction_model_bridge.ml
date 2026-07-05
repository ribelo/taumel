open Jsoo_bridge

let settings_from_js values =
  {
    Taumel.Compaction_model.session = optional_string_field values "session";
    Taumel.Compaction_model.global = optional_string_field values "global";
    project = optional_string_field values "project";
  }

let model_string = function
  | Taumel.Compaction_model.Inherit -> ""
  | Model value -> value

let plan_command args ctx =
  Session_sync.sync_session_from_host ~scope:"command plan" ctx;
  let settings = settings_from_js ctx in
  match Taumel.Compaction_model.plan_command ~settings args with
  | Error message -> error_obj message
  | Ok plan -> (
      match plan with
      | Show_current { model; source } ->
          ok_obj
            [
              ("action", js_string "show");
              ("model", js_string (model_string model));
              ("source", js_string source);
            ]
      | Set_project value ->
          ok_obj
            [
              ("action", js_string "set_project");
              ("model", js_string value);
            ]
      | Clear_project -> ok_obj [ ("action", js_string "clear_project") ]
      | Open_picker { current } ->
          ok_obj
            [
              ("action", js_string "open_picker");
              ("current", js_string (model_string current));
            ])

let plan_session_before_compact _event ctx =
  let settings = settings_from_js ctx in
  match Taumel.Compaction_model.plan_session_before_compact settings with
  | Use_default -> ok_obj [ ("action", js_string "default") ]
  | Use_model value ->
      ok_obj [ ("action", js_string "compact"); ("model", js_string value) ]
