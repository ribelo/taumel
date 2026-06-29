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
    (Compaction_model.is_valid_model_id "openai-codex/gpt-4o/reasoning" = false);
  assert_bool "empty is invalid" (not (Compaction_model.is_valid_model_id ""));
  assert_bool "missing provider is invalid" (not (Compaction_model.is_valid_model_id "/gpt-4o"));
  assert_bool "missing model is invalid" (not (Compaction_model.is_valid_model_id "openai/"));
  assert_bool "no separator is invalid" (not (Compaction_model.is_valid_model_id "gpt-4o"));
  assert_bool "multiple separators are invalid"
    (not (Compaction_model.is_valid_model_id "openai/gpt-4o/reasoning"))

let test_parse_command () =
  let open_ok = expect_ok "show" (Compaction_model.parse_command "") in
  assert_bool "empty parses to Show" (open_ok = Compaction_model.Show);
  let clear_ok = expect_ok "clear" (Compaction_model.parse_command "clear") in
  assert_bool "clear parses to Clear" (clear_ok = Compaction_model.Clear);
  let set_ok = expect_ok "set" (Compaction_model.parse_command "openai/gpt-4o") in
  assert_bool "provider/model parses to Set" (set_ok = Compaction_model.Set "openai/gpt-4o");
  assert_bool "invalid model is rejected" (Result.is_error (Compaction_model.parse_command "gpt-4o"));
  assert_bool "whitespace around model is trimmed"
    (expect_ok "trim" (Compaction_model.parse_command "  openai/gpt-4o  ") = Compaction_model.Set "openai/gpt-4o")

let test_plan_command () =
  let settings = { Compaction_model.global = Some "openai/gpt-4o"; project = None } in
  let show = expect_ok "show inherits global" (Compaction_model.plan_command ~settings "") in
  assert_bool "show reports global model"
    (show = Compaction_model.Show_current { model = Compaction_model.Model "openai/gpt-4o"; source = "global" });
  let set = expect_ok "set project" (Compaction_model.plan_command ~settings "anthropic/claude-3-5-sonnet") in
  assert_bool "set plans project write"
    (set = Compaction_model.Set_project "anthropic/claude-3-5-sonnet");
  let project_settings = { Compaction_model.global = Some "openai/gpt-4o"; project = Some "anthropic/claude-3-5-sonnet" } in
  let show_project =
    expect_ok "show prefers project" (Compaction_model.plan_command ~settings:project_settings "")
  in
  assert_bool "show reports project model"
    (show_project = Compaction_model.Show_current { model = Compaction_model.Model "anthropic/claude-3-5-sonnet"; source = "project" });
  let clear = expect_ok "clear project" (Compaction_model.plan_command ~settings:project_settings "clear") in
  assert_bool "clear plans project removal" (clear = Compaction_model.Clear_project);
  let clear_inherit =
    expect_ok "clear with no project shows inherit" (Compaction_model.plan_command ~settings "clear")
  in
  assert_bool "clear without project shows current"
    (clear_inherit = Compaction_model.Show_current { model = Compaction_model.Model "openai/gpt-4o"; source = "global" });
  let empty_settings = { Compaction_model.global = None; project = None } in
  let show_empty = expect_ok "show inherit" (Compaction_model.plan_command ~settings:empty_settings "") in
  assert_bool "show reports inherit when unset"
    (show_empty = Compaction_model.Show_current { model = Compaction_model.Inherit; source = "inherit" })

let test_plan_session_before_compact () =
  let inherit_settings = { Compaction_model.global = None; project = None } in
  assert_bool "inherit means default"
    (Compaction_model.plan_session_before_compact inherit_settings = Compaction_model.Use_default);
  let global_settings = { Compaction_model.global = Some "openai/gpt-4o"; project = None } in
  assert_bool "global model is used"
    (Compaction_model.plan_session_before_compact global_settings = Compaction_model.Use_model "openai/gpt-4o");
  let project_settings = { Compaction_model.global = Some "openai/gpt-4o"; project = Some "anthropic/claude-3-5-sonnet" } in
  assert_bool "project model takes precedence"
    (Compaction_model.plan_session_before_compact project_settings = Compaction_model.Use_model "anthropic/claude-3-5-sonnet")

let () =
  test_validation ();
  test_parse_command ();
  test_plan_command ();
  test_plan_session_before_compact ();
  print_endline "test_compaction_model: ok"
