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
  let facts = decode_ojs_contract Tool_contracts.CompactionCommandFacts.t_of_js (ojs_of_js raw_facts) in
  let args = Tool_contracts.CompactionCommandFacts.get_args facts in
  let settings = Tool_contracts.CompactionCommandFacts.get_settings facts |> settings_from_typed in
  match Taumel.Compaction_model.plan_command ~settings args with
  | Error message ->
      Boundary_contracts.CompactionPlanError.create ~message ()
      |> Tool_contracts.CompactionPlanError.t_to_js |> inject
  | Ok plan -> (
      match plan with
      | Show_current { model; source } ->
          Boundary_contracts.CompactionShow.create ~model:(model_string model) ~source ()
          |> Tool_contracts.CompactionShow.t_to_js |> inject
      | Set_project value ->
          Boundary_contracts.CompactionSetProject.create ~model:value ()
          |> Tool_contracts.CompactionSetProject.t_to_js |> inject
      | Clear_project ->
          Boundary_contracts.CompactionClearProject.create ()
          |> Tool_contracts.CompactionClearProject.t_to_js |> inject
      | Open_picker { current } ->
          Boundary_contracts.CompactionOpenPicker.create
            ~current:(model_string current) ()
          |> Tool_contracts.CompactionOpenPicker.t_to_js |> inject)

let plan_session_before_compact raw_settings =
  let settings = decode_ojs_contract Tool_contracts.CompactionSettings.t_of_js (ojs_of_js raw_settings) |> settings_from_typed in
  match Taumel.Compaction_model.plan_session_before_compact settings with
  | Use_default ->
      Boundary_contracts.CompactionDefault.create ()
      |> Tool_contracts.CompactionDefault.t_to_js |> inject
  | Use_model value ->
      Boundary_contracts.CompactionUseModel.create ~model:value ()
      |> Tool_contracts.CompactionUseModel.t_to_js |> inject
