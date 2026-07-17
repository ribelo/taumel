open Jsoo_bridge

let settings_from_js settings =
  let taumel = Unsafe.get settings "taumel" in
  let composer = Unsafe.get taumel "composer" in
  {
    Taumel.Global_settings.taumel =
      { composer = { enabled = get_bool composer "enabled" } };
  }

let handle raw_facts =
  let facts = decode_ojs_contract Tool_contracts.ComposerCommandFacts.t_of_js (ojs_of_js raw_facts) in
  let args = Tool_contracts.ComposerCommandFacts.get_args facts in
  let settings_js = Tool_contracts.ComposerCommandFacts.get_settings facts
    |> Tool_contracts.ComposerSettings.t_to_js |> js_of_ojs
  in
  let settings = settings_from_js settings_js in
  let path = Tool_contracts.ComposerCommandFacts.get_path facts in
  match Taumel.Global_settings.plan_composer_command ~settings ~path args with
  | Error message ->
      Boundary_contracts.ComposerCommandError.create ~message ()
      |> Tool_contracts.ComposerCommandError.t_to_js |> inject
  | Ok result ->
      let settings =
        Taumel.Global_settings.to_json result.settings |> json_to_js |> ojs_of_js
        |> decode_ojs_contract Tool_contracts.ComposerSettings.t_of_js
      in
      Boundary_contracts.ComposerCommandSuccess.create ~message:result.message
        ~settings ~writeSettings:result.write_settings ()
      |> Tool_contracts.ComposerCommandSuccess.t_to_js |> inject
