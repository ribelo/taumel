type category =
  | Agents
  | Tools
  | Skills

type t = {
  agents_disabled : string list;
  tools_disabled : string list;
  skills_disabled : string list;
}

type row = {
  name : string;
  state : string;
  available : bool;
  description : string;
}

type warning_flags = {
  agents_warned : bool;
  tools_warned : bool;
  skills_warned : bool;
}

let empty = { agents_disabled = []; tools_disabled = []; skills_disabled = [] }

let empty_warning_flags =
  { agents_warned = false; tools_warned = false; skills_warned = false }

let category_key = function
  | Agents -> "agents"
  | Tools -> "tools"
  | Skills -> "skills"

let category_label = function
  | Agents -> "agent profile"
  | Tools -> "tool"
  | Skills -> "skill"

let category_plural = function
  | Agents -> "agent profiles"
  | Tools -> "tools"
  | Skills -> "skills"

let disabled category state =
  match category with
  | Agents -> state.agents_disabled
  | Tools -> state.tools_disabled
  | Skills -> state.skills_disabled

let with_disabled category values state =
  match category with
  | Agents -> { state with agents_disabled = values }
  | Tools -> { state with tools_disabled = values }
  | Skills -> { state with skills_disabled = values }

let normalize_name value = String.trim value

let rec unique acc = function
  | [] -> List.rev acc
  | value :: rest ->
      let value = normalize_name value in
      if value = "" || List.mem value acc then unique acc rest
      else unique (value :: acc) rest

let normalize_list values = unique [] values

let string_list_json values =
  Shared.Array (List.map (fun value -> Shared.String value) (normalize_list values))

let category_json values =
  Shared.Object [ ("disabled", string_list_json values) ]

let encode state =
  Shared.Object
    [
      ("version", Shared.Number 1.);
      ("agents", category_json state.agents_disabled);
      ("tools", category_json state.tools_disabled);
      ("skills", category_json state.skills_disabled);
    ]

let decode_category path fields name =
  let ( let* ) = Result.bind in
  match Shared.json_optional_field fields name with
  | Error _ as error -> error
  | Ok None -> Ok []
  | Ok (Some value) ->
      let* category_fields = Shared.json_object_fields (Shared.json_path path name) value in
      let* disabled =
        Result.bind
          (Shared.json_optional_field category_fields "disabled")
          (function
            | None -> Ok []
            | Some value ->
                Shared.json_string_list
                  (Shared.json_path (Shared.json_path path name) "disabled")
                  value)
      in
      Ok (normalize_list disabled)

let decode json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields "taumel.visibility" json in
  let* agents_disabled = decode_category "taumel.visibility" fields "agents" in
  let* tools_disabled = decode_category "taumel.visibility" fields "tools" in
  let* skills_disabled = decode_category "taumel.visibility" fields "skills" in
  Ok { agents_disabled; tools_disabled; skills_disabled }

let codec = { Shared.encode; decode }

let enabled_from_legacy_profile_toggles toggles =
  toggles
  |> List.filter_map (fun (toggle : Agent_runs.profile_toggle) ->
         if toggle.toggle_enabled then None else Some toggle.toggle_profile)
  |> normalize_list

let of_legacy_agents_state (state : Agent_runs.session_state) =
  { empty with agents_disabled = enabled_from_legacy_profile_toggles state.profile_toggles }

let is_disabled state category name =
  List.mem (normalize_name name) (disabled category state)

let is_enabled state category name = not (is_disabled state category name)

let add_disabled name values =
  let name = normalize_name name in
  if name = "" || List.mem name values then values else values @ [ name ]

let remove_disabled name values =
  let name = normalize_name name in
  List.filter (fun value -> value <> name) values

let set_disabled_unchecked state category name value =
  let current = disabled category state in
  let next =
    if value then add_disabled name current else remove_disabled name current
  in
  with_disabled category next state

let set_disabled ~available state category name value =
  let name = normalize_name name in
  if name = "" then Error (category_label category ^ " name is required")
  else if
    not (List.mem name available)
    && (value || not (is_disabled state category name))
  then
    Error
      (Printf.sprintf "Unknown %s: %s" (category_label category) name)
  else Ok (set_disabled_unchecked state category name value)

let toggle_row state category name =
  set_disabled_unchecked state category name
    (not (is_disabled state category name))

let unavailable_disabled state category ~available =
  disabled category state
  |> List.filter (fun name -> not (List.mem name available))

let unavailable_warning state category ~available =
  match unavailable_disabled state category ~available with
  | [] -> None
  | names ->
      Some
        (Printf.sprintf
           "Taumel visibility has unavailable disabled %s: %s"
           (category_plural category)
           (String.concat ", " names))

let maybe_warn_once state flags category ~available =
  let already =
    match category with
    | Agents -> flags.agents_warned
    | Tools -> flags.tools_warned
    | Skills -> flags.skills_warned
  in
  if already then (None, flags)
  else
    let flags =
      match category with
      | Agents -> { flags with agents_warned = true }
      | Tools -> { flags with tools_warned = true }
      | Skills -> { flags with skills_warned = true }
    in
    (unavailable_warning state category ~available, flags)

let row ?(description = "") state category name =
  {
    name;
    state = (if is_disabled state category name then "disabled" else "enabled");
    available = true;
    description;
  }

let rows state category available =
  let available_names = List.map fst available in
  let available_rows =
    available
    |> List.map (fun (name, description) -> row ~description state category name)
  in
  let unavailable_rows =
    unavailable_disabled state category ~available:available_names
    |> List.map (fun name ->
           { name; state = "unavailable"; available = false; description = "" })
  in
  available_rows @ unavailable_rows
