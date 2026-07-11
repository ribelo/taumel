type composer = { enabled : bool }

type taumel = { composer : composer }

type t = { taumel : taumel }

type composer_command_result = {
  settings : t;
  write_settings : bool;
  message : string;
}

type composer_command =
  | Show
  | Set_enabled of bool
  | Toggle

let default =
  { taumel = { composer = { enabled = true } } }

let parse_words input =
  input |> String.split_on_char ' ' |> List.map String.trim
  |> List.filter (fun part -> part <> "")

let parse_composer_command input =
  match parse_words input with
  | [] | [ "show" ] -> Ok Show
  | [ "on" ] | [ "enabled" ] -> Ok (Set_enabled true)
  | [ "off" ] | [ "disabled" ] -> Ok (Set_enabled false)
  | [ "toggle" ] -> Ok Toggle
  | _ -> Error "usage: /composer [show|on|off|toggle]"

let composer_text settings = if settings.taumel.composer.enabled then "on" else "off"

let message ~path settings =
  Printf.sprintf "Composer: %s (%s)" (composer_text settings) path

let apply_composer_command settings = function
  | Show -> (settings, false)
  | Set_enabled enabled ->
      ({ taumel = { composer = { enabled } } }, true)
  | Toggle ->
      ( {
          taumel =
            { composer = { enabled = not settings.taumel.composer.enabled } };
        },
        true )

let plan_composer_command ~settings ~path input =
  Result.map
    (fun command ->
      let settings, write_settings = apply_composer_command settings command in
      { settings; write_settings; message = message ~path settings })
    (parse_composer_command input)

let to_json settings =
  Shared.Object
    [
      ( "taumel",
        Shared.Object
          [
            ( "composer",
              Shared.Object [ ("enabled", Shared.Bool settings.taumel.composer.enabled) ] );
          ] );
    ]
