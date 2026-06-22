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

let test_composer_defaults () =
  assert_bool "composer default enabled" Settings.default.composer.enabled;
  assert_equal "default message" "Composer: on (/tmp/settings.json)"
    (Settings.message ~path:"/tmp/settings.json" Settings.default)

let test_composer_command_plans () =
  let off =
    expect_ok "composer off"
      (Settings.plan_composer_command ~settings:Settings.default
         ~path:"/tmp/settings.json" "off")
  in
  assert_bool "composer off writes" off.write_settings;
  assert_bool "composer off disables" (not off.settings.composer.enabled);
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
