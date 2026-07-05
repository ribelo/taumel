type compaction_model =
  | Inherit
  | Model of string

type command =
  | Pick
  | Set of string
  | Clear

type settings_values = {
  session : string option;
  global : string option;
  project : string option;
}

type command_plan =
  | Show_current of { model : compaction_model; source : string }
  | Set_project of string
  | Clear_project
  | Open_picker of { current : compaction_model }

type session_plan =
  | Use_default
  | Use_model of string

let trim_non_empty value =
  match Shared.trim_non_empty value with
  | None -> ""
  | Some value -> value

let is_valid_model_id value =
  let value = trim_non_empty value in
  if value = "" then false
  else
    match String.index_opt value '/' with
    | None -> false
    | Some index ->
        index > 0
        && index < String.length value - 1
        && String.index_from_opt value (index + 1) '/' = None

let resolve_configured settings =
  match (settings.session, settings.project, settings.global) with
  | Some value, _, _ -> (Model value, "session")
  | None, Some value, _ -> (Model value, "project")
  | None, None, Some value -> (Model value, "global")
  | None, None, None -> (Inherit, "inherit")

let parse_command input =
  let input = String.trim input in
  if input = "" then Ok Pick
  else if input = "clear" then Ok Clear
  else if is_valid_model_id input then Ok (Set input)
  else Error "usage: /compaction-model [<provider/model>|clear]"

let plan_command ~settings input =
  let current, source = resolve_configured settings in
  match parse_command input with
  | Error _ as error -> error
  | Ok Pick -> Ok (Open_picker { current })
  | Ok Clear -> (
      match (settings.session, settings.project) with
      | Some _, _ | None, Some _ -> Ok Clear_project
      | None, None ->
          Ok (Show_current { model = current; source }))
  | Ok (Set value) -> Ok (Set_project value)

let plan_session_before_compact settings =
  let configured, _source = resolve_configured settings in
  match configured with
  | Inherit -> Use_default
  | Model value -> Use_model value
