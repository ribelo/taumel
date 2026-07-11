open Jsoo_bridge

let settings_from_typed values =
  {
    Taumel.Compaction_model.session = Tool_contracts.CompactionSettings.get_session values;
    Taumel.Compaction_model.global = Tool_contracts.CompactionSettings.get_global values;
    project = Tool_contracts.CompactionSettings.get_project values;
  }

let model_string = function
  | Taumel.Compaction_model.Inherit -> ""
  | Model value -> value

let plan_command raw_facts =
  let facts = Tool_contracts.CompactionCommandFacts.t_of_js (ojs_of_js raw_facts) in
  let args = Tool_contracts.CompactionCommandFacts.get_args facts in
  let settings = Tool_contracts.CompactionCommandFacts.get_settings facts |> settings_from_typed in
  match Taumel.Compaction_model.plan_command ~settings args with
  | Error message ->
      Tool_contracts.CompactionPlanError.create ~kind:"error" ~message ()
      |> Tool_contracts.CompactionPlanError.t_to_js |> inject
  | Ok plan -> (
      match plan with
      | Show_current { model; source } ->
          Tool_contracts.CompactionShow.create ~kind:"show" ~model:(model_string model) ~source ()
          |> Tool_contracts.CompactionShow.t_to_js |> inject
      | Set_project value ->
          Tool_contracts.CompactionSetProject.create ~kind:"set_project" ~model:value ()
          |> Tool_contracts.CompactionSetProject.t_to_js |> inject
      | Clear_project ->
          Tool_contracts.CompactionClearProject.create ~kind:"clear_project" ()
          |> Tool_contracts.CompactionClearProject.t_to_js |> inject
      | Open_picker { current } ->
          Tool_contracts.CompactionOpenPicker.create ~kind:"open_picker"
            ~current:(model_string current) ()
          |> Tool_contracts.CompactionOpenPicker.t_to_js |> inject)

let plan_session_before_compact raw_settings =
  let settings = Tool_contracts.CompactionSettings.t_of_js (ojs_of_js raw_settings) |> settings_from_typed in
  match Taumel.Compaction_model.plan_session_before_compact settings with
  | Use_default ->
      Tool_contracts.CompactionDefault.create ~kind:"default" ()
      |> Tool_contracts.CompactionDefault.t_to_js |> inject
  | Use_model value ->
      Tool_contracts.CompactionUseModel.create ~kind:"compact" ~model:value ()
      |> Tool_contracts.CompactionUseModel.t_to_js |> inject
