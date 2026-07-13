open Jsoo_bridge
open App_state

type category = Taumel.Visibility.category =
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
  | "tools" -> Some Tools
  | "skills" -> Some Skills
  | _ -> None

let category_of_contract = function
  | `V_tools -> Taumel.Visibility.Tools
  | `V_skills -> Taumel.Visibility.Skills

let contract_category = function
  | Tools -> `V_tools
  | Skills -> `V_skills

let category_name = Taumel.Visibility.category_key

let category_title = function
  | Tools -> "Taumel tools"
  | Skills -> "Taumel skills"

let usage = function
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

let available_items category ctx =
  match category with
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
  let details =
    Option.map (fun value -> Ts2ocaml.unknown_of_js (ojs_of_js value)) details
  in
  Boundary_contracts.GatewayCommandResult.create ~ok ~message
    ?error:(if ok then None else Some message) ?details ()
  |> Tool_contracts.GatewayCommandResult.t_to_js |> inject

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
  Boundary_contracts.VisibilityPrompt.create
    ~category:
      (contract_category category
      |> Boundary_contracts.VisibilityPrompt.category_to_contract)
    ~title:(category_title category) ()
  |> Tool_contracts.VisibilityPrompt.t_to_js |> inject

let save_result category ctx =
  Boundary_contracts.VisibilitySavePlan.create
    ~category:
      (contract_category category
      |> Boundary_contracts.VisibilitySavePlan.category_to_contract)
    ~disabled:(Taumel.Visibility.disabled category !visibility_state)
    ~details:
      (Tool_contracts.VisibilityRowsResult.t_of_js
         (ojs_of_js (visibility_details category ctx))) ()
  |> Tool_contracts.VisibilitySavePlan.t_to_js |> inject

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

let toggle_row_for category name ctx =
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

let toggle_row raw_facts =
  let facts = Tool_contracts.VisibilityToggleFacts.t_of_js (ojs_of_js raw_facts) in
  let category = category_of_contract (Boundary_contracts.VisibilityToggleFacts.get_category facts) in
  let name = Tool_contracts.VisibilityToggleFacts.get_name facts in
  let ctx = Tool_contracts.VisibilityToggleFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  let result = toggle_row_for category name ctx in
  if get_bool result "ok" then
    Tool_contracts.VisibilityToggleSuccess.t_of_js (ojs_of_js result)
    |> Tool_contracts.VisibilityToggleSuccess.t_to_js |> inject
  else
    Tool_contracts.VisibilityToggleError.t_of_js (ojs_of_js result)
    |> Tool_contracts.VisibilityToggleError.t_to_js |> inject

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

let rows raw_facts =
  let facts = Tool_contracts.VisibilityRowsFacts.t_of_js (ojs_of_js raw_facts) in
  let category = category_of_contract (Boundary_contracts.VisibilityRowsFacts.get_category facts) in
  let ctx = Tool_contracts.VisibilityRowsFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  Session_sync.sync_persisted_session ctx;
  let visible_rows =
    visibility_rows category ctx
    |> List.map (fun (row : Taumel.Visibility.row) ->
           Tool_contracts.VisibilityRow.create ~name:row.name ~state:row.state
             ~available:row.available ~description:row.description ())
  in
  Tool_contracts.VisibilityRowsResult.create
    ~category:
      (contract_category category
      |> Boundary_contracts.VisibilityRowsResult.category_to_contract)
    ~title:(category_title category) ~rows:visible_rows
    ~disabled:(Taumel.Visibility.disabled category !visibility_state)
    ~unavailable:(unavailable_names category ctx) ()
  |> Tool_contracts.VisibilityRowsResult.t_to_js |> inject

let category_context_from_facts raw_facts =
  let facts = Tool_contracts.VisibilityRowsFacts.t_of_js (ojs_of_js raw_facts) in
  let category = category_of_contract (Boundary_contracts.VisibilityRowsFacts.get_category facts) in
  let ctx = Tool_contracts.VisibilityRowsFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> Obj.magic in
  (category, ctx)

let save_project_plan raw_facts =
  let category, ctx = category_context_from_facts raw_facts in
  Session_sync.sync_persisted_session ctx;
  save_result category ctx |> ojs_of_js |> Tool_contracts.VisibilitySavePlan.t_of_js
  |> Tool_contracts.VisibilitySavePlan.t_to_js |> inject

let list_command raw_facts =
  let category, ctx = category_context_from_facts raw_facts in
  handle category "list" ctx |> ojs_of_js |> Tool_contracts.VisibilityListResult.t_of_js
  |> Tool_contracts.VisibilityListResult.t_to_js |> inject

let warnings raw_facts =
  let facts = Tool_contracts.VisibilityWarningFacts.t_of_js (ojs_of_js raw_facts) in
  let category_available name =
    if name = "tools" then Tool_contracts.VisibilityWarningFacts.get_tools facts
    else Tool_contracts.VisibilityWarningFacts.get_skills facts
  in
  let categories =
    [
      (Tools, category_available "tools");
      (Skills, category_available "skills");
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
  Tool_contracts.VisibilityWarningsResult.create ~messages:(List.rev !messages) ()
  |> Tool_contracts.VisibilityWarningsResult.t_to_js |> inject
