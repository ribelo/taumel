type composer = { enabled : bool }

type agent_builtin_override = {
  provider : string;
  model : string;
  thinking : string;
}

type taumel = {
  composer : composer;
  agents : (string * agent_builtin_override) list;
}

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

let builtin_profile_names =
  [ "smart"; "deep"; "rush"; "finder"; "librarian"; "oracle"; "painter"; "review" ]

let inherit_override =
  { provider = "inherit"; model = "inherit"; thinking = "inherit" }

let default_builtin_overrides =
  List.map (fun name -> (name, inherit_override)) builtin_profile_names

let default =
  {
    taumel =
      { composer = { enabled = true }; agents = default_builtin_overrides };
  }

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
      ({ taumel = { settings.taumel with composer = { enabled } } }, true)
  | Toggle ->
      ( {
          taumel =
            {
              settings.taumel with
              composer = { enabled = not settings.taumel.composer.enabled };
            };
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
            ( "agents",
              Shared.Object
                (List.map
                   (fun (name, override) ->
                     ( name,
                       Shared.Object
                         [
                           ("provider", Shared.String override.provider);
                           ("model", Shared.String override.model);
                           ("thinking", Shared.String override.thinking);
                         ] ))
                   settings.taumel.agents) );
          ] );
    ]
