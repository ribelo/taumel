module Compaction_model = Taumel.Compaction_model

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let expect_ok label = function
  | Ok value -> value
  | Error message -> fail label message

let test_validation () =
  assert_bool "openai/gpt-4o is valid" (Compaction_model.is_valid_model_id "openai/gpt-4o");
  assert_bool "provider with dash and slash model is valid"
    (Compaction_model.is_valid_model_id "openai-codex/gpt-4o/reasoning");
  assert_bool "empty is invalid" (not (Compaction_model.is_valid_model_id ""));
  assert_bool "missing provider is invalid" (not (Compaction_model.is_valid_model_id "/gpt-4o"));
  assert_bool "missing model is invalid" (not (Compaction_model.is_valid_model_id "openai/"));
  assert_bool "no separator is invalid" (not (Compaction_model.is_valid_model_id "gpt-4o"));
  assert_bool "openrouter nested model id is valid"
    (Compaction_model.is_valid_model_id "openrouter/deepseek/deepseek-v4-pro")

let test_parse_command () =
  let open_ok = expect_ok "picker" (Compaction_model.parse_command "") in
  assert_bool "empty parses to Pick" (open_ok = Compaction_model.Pick);
  let clear_ok = expect_ok "clear" (Compaction_model.parse_command "clear") in
  assert_bool "clear parses to Clear" (clear_ok = Compaction_model.Clear);
  let set_ok = expect_ok "set" (Compaction_model.parse_command "openai/gpt-4o") in
  assert_bool "provider/model parses to Set" (set_ok = Compaction_model.Set "openai/gpt-4o");
  let nested_set_ok =
    expect_ok "set nested model" (Compaction_model.parse_command "openrouter/deepseek/deepseek-v4-pro")
  in
  assert_bool "provider/nested-model parses to Set"
    (nested_set_ok = Compaction_model.Set "openrouter/deepseek/deepseek-v4-pro");
  assert_bool "invalid model is rejected" (Result.is_error (Compaction_model.parse_command "gpt-4o"));
  assert_bool "whitespace around model is trimmed"
    (expect_ok "trim" (Compaction_model.parse_command "  openai/gpt-4o  ") = Compaction_model.Set "openai/gpt-4o")

let test_resolve_empty_settings () =
  let empty_session_settings =
    {
      Compaction_model.session = Some "";
      project = Some " ";
      global = Some "openrouter/deepseek/deepseek-v4-pro";
    }
  in
  assert_bool "empty higher-precedence scopes do not shadow global"
    (Compaction_model.plan_session_before_compact empty_session_settings
    = Compaction_model.Use_model "openrouter/deepseek/deepseek-v4-pro");
  let empty_settings =
    { Compaction_model.session = Some ""; project = Some " "; global = None }
  in
  assert_bool "all empty settings use default"
    (Compaction_model.plan_session_before_compact empty_settings = Compaction_model.Use_default)

let test_plan_command () =
  let settings = { Compaction_model.session = None; global = Some "openai/gpt-4o"; project = None } in
  let picker = expect_ok "picker inherits global" (Compaction_model.plan_command ~settings "") in
  assert_bool "empty command opens picker with current model"
    (picker = Compaction_model.Open_picker { current = Compaction_model.Model "openai/gpt-4o" });
  let set = expect_ok "set project" (Compaction_model.plan_command ~settings "anthropic/claude-3-5-sonnet") in
  assert_bool "set plans project write"
    (set = Compaction_model.Set_project "anthropic/claude-3-5-sonnet");
  let project_settings = { Compaction_model.session = None; global = Some "openai/gpt-4o"; project = Some "anthropic/claude-3-5-sonnet" } in
  let show_project =
    expect_ok "picker prefers project" (Compaction_model.plan_command ~settings:project_settings "")
  in
  assert_bool "picker marks project model"
    (show_project = Compaction_model.Open_picker { current = Compaction_model.Model "anthropic/claude-3-5-sonnet" });
  let clear = expect_ok "clear project" (Compaction_model.plan_command ~settings:project_settings "clear") in
  assert_bool "clear plans project removal" (clear = Compaction_model.Clear_project);
  let clear_inherit =
    expect_ok "clear with no project shows inherit" (Compaction_model.plan_command ~settings "clear")
  in
  assert_bool "clear without project shows current"
    (clear_inherit = Compaction_model.Show_current { model = Compaction_model.Model "openai/gpt-4o"; source = "global" });
  let session_settings = { project_settings with session = Some "openai/gpt-5" } in
  let show_session =
    expect_ok "picker prefers session" (Compaction_model.plan_command ~settings:session_settings "")
  in
  assert_bool "picker marks session model"
    (show_session = Compaction_model.Open_picker { current = Compaction_model.Model "openai/gpt-5" });
  let empty_settings = { Compaction_model.session = None; global = None; project = None } in
  let show_empty = expect_ok "picker inherit" (Compaction_model.plan_command ~settings:empty_settings "") in
  assert_bool "picker reports inherit when unset"
    (show_empty = Compaction_model.Open_picker { current = Compaction_model.Inherit })

let test_plan_session_before_compact () =
  let inherit_settings = { Compaction_model.session = None; global = None; project = None } in
  assert_bool "inherit means default"
    (Compaction_model.plan_session_before_compact inherit_settings = Compaction_model.Use_default);
  let global_settings = { Compaction_model.session = None; global = Some "openai/gpt-4o"; project = None } in
  assert_bool "global model is used"
    (Compaction_model.plan_session_before_compact global_settings = Compaction_model.Use_model "openai/gpt-4o");
  let project_settings = { Compaction_model.session = None; global = Some "openai/gpt-4o"; project = Some "anthropic/claude-3-5-sonnet" } in
  assert_bool "project model takes precedence"
    (Compaction_model.plan_session_before_compact project_settings = Compaction_model.Use_model "anthropic/claude-3-5-sonnet");
  let session_settings = { project_settings with session = Some "openai/gpt-5" } in
  assert_bool "session model takes precedence"
    (Compaction_model.plan_session_before_compact session_settings = Compaction_model.Use_model "openai/gpt-5")

let () =
  test_validation ();
  test_parse_command ();
  test_resolve_empty_settings ();
  test_plan_command ();
  test_plan_session_before_compact ();
  print_endline "test_compaction_model: ok"
