open Jsoo_bridge
open App_state

type category = Taumel.Visibility.category =
  | Agents
  | Tools
  | Skills

let js_string_array values = js_array (List.map js_string values)

let effect_kind_label = function
  | Taumel.Tool_gateway.Pure -> "pure"
  | Taumel.Tool_gateway.Execute -> "execute"
  | Taumel.Tool_gateway.Mutate -> "mutate"
  | Taumel.Tool_gateway.Network -> "network"
  | Taumel.Tool_gateway.Spawn_agent -> "spawn agent"
  | Taumel.Tool_gateway.Ask_user -> "ask user"

let category_of_name = function
  | "agents" -> Some Agents
  | "tools" -> Some Tools
  | "skills" -> Some Skills
  | _ -> None

let category_name = Taumel.Visibility.category_key

let category_title = function
  | Agents -> "Taumel agent profiles"
  | Tools -> "Taumel tools"
  | Skills -> "Taumel skills"

let usage = function
  | Agents -> "usage: /agents [list|enable <profile>|disable <profile>|save]"
  | Tools -> "usage: /tools [list|enable <tool>|disable <tool>|save]"
  | Skills -> "usage: /skills [list|enable <skill>|disable <skill>|save]"

let tool_items () =
  Taumel.Tool_catalog.tool_specs
  |> List.map (fun (spec : Taumel.Tool_gateway.spec) ->
         (spec.name, effect_kind_label spec.effect_kind))

let skill_items ctx =
  let cwd =
    match optional_string_field ctx "cwd" with
    | Some cwd when cwd <> "" -> cwd
    | _ -> if state.cwd = "" then "." else state.cwd
  in
  Skill_tools.discover_skills cwd
  |> List.map (fun (skill : Skill_tools.skill) ->
         let description =
           if skill.description <> "" then skill.description else skill.path
         in
         (skill.name, description))

let agent_items () =
  (!agent_catalog).catalog_profiles
  |> List.map (fun (profile : Taumel.Agent_profiles.profile_spec) ->
         (profile.spec_name, profile.spec_description))

let available_items category ctx =
  match category with
  | Agents -> agent_items ()
  | Tools -> tool_items ()
  | Skills -> skill_items ctx

let available_names category ctx =
  available_items category ctx |> List.map fst

let js_row (row : Taumel.Visibility.row) =
  Unsafe.obj
    [|
      ("name", js_string row.name);
      ("state", js_string row.state);
      ("available", js_bool row.available);
      ("description", js_string row.description);
    |]

let visibility_rows category ctx =
  Taumel.Visibility.rows !visibility_state category (available_items category ctx)

let unavailable_names category ctx =
  Taumel.Visibility.unavailable_disabled !visibility_state category
    ~available:(available_names category ctx)

let visibility_details category ctx =
  let disabled = Taumel.Visibility.disabled category !visibility_state in
  let rows = visibility_rows category ctx in
  Unsafe.obj
    [|
      ("category", js_string (category_name category));
      ("title", js_string (category_title category));
      ("rows", js_array (List.map js_row rows));
      ("disabled", js_string_array disabled);
      ("unavailable", js_string_array (unavailable_names category ctx));
    |]

let command_result ?(ok = true) ?details message =
  let fields =
    [
      ("ok", js_bool ok);
      ("action", js_string "command_result");
      ("message", js_string message);
    ]
  in
  let fields =
    if ok then fields else fields @ [ ("error", js_string message) ]
  in
  let fields =
    match details with
    | None -> fields
    | Some details -> fields @ [ ("details", inject details) ]
  in
  Unsafe.obj (Array.of_list fields)

let row_line (row : Taumel.Visibility.row) =
  let suffix =
    if row.description = "" then "" else " - " ^ row.description
  in
  row.name ^ " [" ^ row.state ^ "]" ^ suffix

let summary category ctx =
  let rows = visibility_rows category ctx in
  let body =
    match rows with
    | [] -> "No " ^ Taumel.Visibility.category_plural category ^ "."
    | rows -> rows |> List.map row_line |> String.concat "\n"
  in
  match
    Taumel.Visibility.unavailable_warning !visibility_state category
      ~available:(available_names category ctx)
  with
  | None -> body
  | Some warning -> body ^ "\n\n" ^ warning

let prompt_result category =
  ok_obj
    [
      ("action", js_string "visibility_prompt");
      ("category", js_string (category_name category));
      ("title", js_string (category_title category));
    ]

let save_result category ctx =
  ok_obj
    [
      ("action", js_string "visibility_save_project");
      ("category", js_string (category_name category));
      ("disabled", js_string_array (Taumel.Visibility.disabled category !visibility_state));
      ("details", inject (visibility_details category ctx));
    ]

let mutation_details category ctx ?enabled_name ?disabled_name () =
  let base = visibility_details category ctx in
  let fields =
    [
      ("visibilityChanged", js_bool true);
      ("category", js_string (category_name category));
    ]
  in
  let fields =
    match enabled_name with
    | None -> fields
    | Some value -> ("enabledName", js_string value) :: fields
  in
  let fields =
    match disabled_name with
    | None -> fields
    | Some value -> ("disabledName", js_string value) :: fields
  in
  merge_js_details base (Unsafe.obj (Array.of_list fields))

let set_category category ctx name disabled =
  match
    Taumel.Visibility.set_disabled
      ~available:(available_names category ctx)
      !visibility_state category name disabled
  with
  | Error message -> command_result ~ok:false ~details:(visibility_details category ctx) message
  | Ok next ->
      visibility_state := next;
      Session_sync.save_visibility_state ctx;
      let name = String.trim name in
      let details =
        if disabled then mutation_details category ctx ~disabled_name:name ()
        else mutation_details category ctx ~enabled_name:name ()
      in
      command_result ~details
        (Printf.sprintf "%s %s."
           (String.capitalize_ascii (Taumel.Visibility.category_label category))
           (name ^ if disabled then " disabled" else " enabled"))

let toggle_row category name ctx =
  Session_sync.sync_persisted_session ctx;
  let name = String.trim name in
  let rows = visibility_rows category ctx in
  match List.find_opt (fun (row : Taumel.Visibility.row) -> row.name = name) rows with
  | None ->
      command_result ~ok:false ~details:(visibility_details category ctx)
        ("Unknown " ^ Taumel.Visibility.category_label category ^ ": " ^ name)
  | Some row ->
      let disabling = row.state = "enabled" in
      visibility_state :=
        Taumel.Visibility.set_disabled_unchecked !visibility_state category name disabling;
      Session_sync.save_visibility_state ctx;
      let details =
        if disabling then mutation_details category ctx ~disabled_name:name ()
        else mutation_details category ctx ~enabled_name:name ()
      in
      command_result ~details
        (Printf.sprintf "%s %s."
           (String.capitalize_ascii (Taumel.Visibility.category_label category))
           (name ^ if disabling then " disabled" else " enabled"))

let handle category args ctx =
  Session_sync.sync_persisted_session ctx;
  let command, rest = Command_util.split_command args in
  match command with
  | "" -> prompt_result category
  | "list" -> command_result ~details:(visibility_details category ctx) (summary category ctx)
  | "enable" ->
      set_category category ctx (String.trim rest) false
  | "disable" ->
      set_category category ctx (String.trim rest) true
  | "save" -> save_result category ctx
  | _ -> error_obj (usage category)

let rows category ctx =
  Session_sync.sync_persisted_session ctx;
  ok_obj
    [
      ("action", js_string "visibility_rows");
      ("category", js_string (category_name category));
      ("title", js_string (category_title category));
      ("details", inject (visibility_details category ctx));
    ]

let warnings facts =
  let category_available name =
    let value = Unsafe.get facts name in
    array_items value |> List.filter_map string_value
  in
  let categories =
    [
      (Tools, category_available "tools");
      (Skills, category_available "skills");
      (Agents, category_available "agents");
    ]
  in
  let messages = ref [] in
  List.iter
    (fun (category, available) ->
      let warning, flags =
        Taumel.Visibility.maybe_warn_once !visibility_state
          !visibility_warning_flags category ~available
      in
      visibility_warning_flags := flags;
      match warning with
      | None -> ()
      | Some message -> messages := message :: !messages)
    categories;
  ok_obj [ ("messages", js_string_array (List.rev !messages)) ]
