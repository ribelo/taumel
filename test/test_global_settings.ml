module Settings = Taumel.Global_settings

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let expect_ok label = function
  | Ok value -> value
  | Error message -> fail label message

let expect_error label = function
  | Ok _ -> fail label "expected an error"
  | Error _ -> ()

let builtin_override (settings : Settings.t) name =
  List.assoc_opt name settings.taumel.agents.builtins

let expect_builtin_override label settings name =
  match builtin_override settings name with
  | Some override -> override
  | None -> fail label ("missing built-in override: " ^ name)

let test_composer_defaults () =
  assert_bool "composer default enabled" Settings.default.composer.enabled;
  assert_bool "agent built-in overrides default count"
    (List.length Settings.default.taumel.agents.builtins = 8);
  let finder =
    expect_builtin_override "finder default override" Settings.default "finder"
  in
  assert_equal "finder provider default" "inherit" finder.provider;
  assert_equal "finder model default" "inherit" finder.model;
  assert_equal "finder thinking default" "inherit" finder.thinking;
  assert_equal "default message" "Composer: on (/tmp/settings.json)"
    (Settings.message ~path:"/tmp/settings.json" Settings.default)

let test_composer_command_plans () =
  let custom_finder =
    ({
       Settings.provider = "openai-codex";
       model = "gpt-override";
       thinking = "high";
     }
      : Settings.agent_builtin_override)
  in
  let settings =
    {
      Settings.default with
      taumel = { agents = { builtins = [ ("finder", custom_finder) ] } };
    }
  in
  let off =
    expect_ok "composer off"
      (Settings.plan_composer_command ~settings
         ~path:"/tmp/settings.json" "off")
  in
  assert_bool "composer off writes" off.write_settings;
  assert_bool "composer off disables" (not off.settings.composer.enabled);
  let preserved =
    expect_builtin_override "composer preserves finder override" off.settings
      "finder"
  in
  assert_equal "preserved provider" "openai-codex" preserved.provider;
  assert_equal "preserved model" "gpt-override" preserved.model;
  assert_equal "preserved thinking" "high" preserved.thinking;
  assert_equal "composer off message" "Composer: off (/tmp/settings.json)"
    off.message;
  let show =
    expect_ok "composer show"
      (Settings.plan_composer_command ~settings:off.settings
         ~path:"/tmp/settings.json" "show")
  in
  assert_bool "composer show does not write" (not show.write_settings);
  assert_bool "composer show keeps state" (not show.settings.composer.enabled);
  let toggled =
    expect_ok "composer toggle"
      (Settings.plan_composer_command ~settings:off.settings
         ~path:"/tmp/settings.json" "toggle")
  in
  assert_bool "composer toggle writes" toggled.write_settings;
  assert_bool "composer toggle enables" toggled.settings.composer.enabled

let test_composer_parse_aliases () =
  (match Settings.parse_composer_command "enabled" with
  | Ok (Settings.Set_enabled true) -> ()
  | _ -> fail "composer enabled alias" "expected Set_enabled true");
  (match Settings.parse_composer_command "disabled" with
  | Ok (Settings.Set_enabled false) -> ()
  | _ -> fail "composer disabled alias" "expected Set_enabled false");
  expect_error "composer invalid command"
    (Settings.parse_composer_command "true")

let () =
  test_composer_defaults ();
  test_composer_command_plans ();
  test_composer_parse_aliases ()
