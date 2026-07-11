module Settings = Taumel.Global_settings

let fail label message = failwith (Printf.sprintf "%s: %s" label message)
let assert_bool label condition = if not condition then fail label "expected condition to hold"

let () =
  assert_bool "default composer enabled" Settings.default.taumel.composer.enabled;
  let result =
    match Settings.plan_composer_command ~settings:Settings.default ~path:"/tmp/settings.json" "off" with
    | Ok value -> value
    | Error message -> fail "composer command" message
  in
  assert_bool "composer disabled" (not result.settings.taumel.composer.enabled);
  assert_bool "composer write requested" result.write_settings
