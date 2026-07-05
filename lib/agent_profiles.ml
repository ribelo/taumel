type builtin_profile = {
  profile_name : string;
  description : string;
}

type inherit_string =
  | Inherit_string
  | Concrete_string of string

type builtin_profile_override = {
  override_name : string;
  override_provider : inherit_string;
  override_model : inherit_string;
  override_thinking : inherit_string;
}

type sandbox_setting =
  | Inherit_sandbox
  | Concrete_sandbox of Capability_profile.sandbox_preset

type approval_setting =
  | Inherit_approval
  | Concrete_approval of Capability_profile.approval_policy

type tools_setting =
  | Inherit_tools
  | Concrete_tools of string list

type profile_source =
  | Builtin
  | User_markdown of string

type profile_spec = {
  spec_name : string;
  spec_description : string;
  spec_provider : inherit_string;
  spec_model : inherit_string;
  spec_thinking : inherit_string;
  spec_sandbox : sandbox_setting;
  spec_approval : approval_setting;
  spec_tools : tools_setting;
  spec_prompt : string;
  spec_source : profile_source;
}

let inherit_string_to_summary = function
  | Inherit_string -> "inherit"
  | Concrete_string value -> value

let sandbox_setting_to_summary = function
  | Inherit_sandbox -> "inherit"
  | Concrete_sandbox sandbox -> Capability_profile.sandbox_to_string sandbox

let approval_setting_to_summary = function
  | Inherit_approval -> "inherit"
  | Concrete_approval approval -> Capability_profile.approval_to_string approval

let tools_setting_to_summary = function
  | Inherit_tools -> "inherit"
  | Concrete_tools tools -> String.concat ", " tools

let profile_spec_model_id spec =
  match (spec.spec_provider, spec.spec_model) with
  | Inherit_string, Inherit_string -> None
  | Concrete_string provider, Concrete_string model_ ->
      Some (provider ^ "/" ^ model_)
  | Inherit_string, Concrete_string value -> Some value
  | Concrete_string _, Inherit_string -> None

let profile_spec_to_definition spec =
  {
    Capability_profile.name = spec.spec_name;
    enabled = true;
    model_id = profile_spec_model_id spec;
    thinking_level =
      (match spec.spec_thinking with
      | Inherit_string -> None
      | Concrete_string value -> Some value);
    sandbox_preset =
      (match spec.spec_sandbox with
      | Inherit_sandbox -> None
      | Concrete_sandbox sandbox -> Some sandbox);
    approval_policy =
      (match spec.spec_approval with
      | Inherit_approval -> None
      | Concrete_approval approval -> Some approval);
    tools =
      (match spec.spec_tools with
      | Inherit_tools -> None
      | Concrete_tools tools -> Some (Capability_profile.of_list tools));
    agents = Some Capability_profile.None_allowed;
    allow_no_sandbox = false;
  }

let spawn_request_with_profile spec (request : Subagents.spawn_tool_request) =
  let definition = profile_spec_to_definition spec in
  {
    request with
    Subagents.name = definition.name;
    system_prompt = spec.spec_prompt;
    model_id = definition.model_id;
    thinking_level = definition.thinking_level;
    sandbox_preset = definition.sandbox_preset;
    approval_policy = definition.approval_policy;
    tools = definition.tools;
    no_sandbox = false;
  }

let builtin_specs =
  [
    ("smart", "Balanced general-purpose agent.");
    ("deep", "Thorough investigation agent.");
    ("rush", "Fast execution agent.");
    ("finder", "Read-only codebase exploration agent.");
    ("librarian", "Documentation and reference research agent.");
    ("oracle", "Analysis and answer synthesis agent.");
    ("painter", "Visual and UI-oriented agent.");
    ("review", "Code review agent.");
  ]
  |> List.map (fun (name, description) ->
         {
           spec_name = name;
           spec_description = description;
           spec_provider = Inherit_string;
           spec_model = Inherit_string;
           spec_thinking = Inherit_string;
           spec_sandbox = Inherit_sandbox;
           spec_approval = Inherit_approval;
           spec_tools = Inherit_tools;
           spec_prompt =
             "You are the " ^ name
             ^ " Taumel subagent. Complete the assigned objective directly. Do not spawn or delegate to other agents.";
           spec_source = Builtin;
         })

let builtin_profiles =
  List.map
    (fun spec ->
      { profile_name = spec.spec_name; description = spec.spec_description })
    builtin_specs

type profile_catalog = {
  catalog_profiles : profile_spec list;
  catalog_errors : string list;
}

let default_profile_catalog = { catalog_profiles = builtin_specs; catalog_errors = [] }

let find_profile_spec catalog name =
  let name = String.trim name in
  List.find_opt (fun spec -> spec.spec_name = name) catalog.catalog_profiles

let builtin_profile_exists name =
  List.exists (fun spec -> spec.spec_name = name) builtin_specs

type yaml_value =
  | Yaml_scalar of string
  | Yaml_list of string list

let strip_simple_quotes value =
  let value = String.trim value in
  let length = String.length value in
  if length >= 2 then
    match (value.[0], value.[length - 1]) with
    | '"', '"' | '\'', '\'' -> String.sub value 1 (length - 2)
    | _ -> value
  else value

let starts_with ~prefix value =
  let prefix_length = String.length prefix in
  String.length value >= prefix_length
  && String.sub value 0 prefix_length = prefix

let split_key_value line =
  match String.index_opt line ':' with
  | None -> None
  | Some index ->
      let key = String.sub line 0 index |> String.trim in
      let value =
        String.sub line (index + 1) (String.length line - index - 1)
        |> String.trim |> strip_simple_quotes
      in
      Some (key, value)

let add_yaml_field path key value fields =
  if List.mem_assoc key fields then
    Error (path ^ ": duplicate frontmatter key: " ^ key)
  else Ok ((key, value) :: fields)

let parse_frontmatter_fields path lines =
  let finish_pending key items fields =
    match key with
    | None -> Ok fields
    | Some key -> add_yaml_field path key (Yaml_list (List.rev items)) fields
  in
  let rec loop pending_key pending_items fields = function
    | [] -> finish_pending pending_key pending_items fields
    | line :: rest ->
        let trimmed = String.trim line in
        if trimmed = "" then loop pending_key pending_items fields rest
        else if starts_with ~prefix:"-" trimmed then
          match pending_key with
          | None -> Error (path ^ ": list item without a key")
          | Some key ->
              let item =
                String.sub trimmed 1 (String.length trimmed - 1)
                |> String.trim |> strip_simple_quotes
              in
              loop (Some key) (item :: pending_items) fields rest
        else
          match split_key_value line with
          | None -> Error (path ^ ": invalid frontmatter line: " ^ line)
          | Some (key, value) ->
              let ( let* ) = Result.bind in
              let* fields = finish_pending pending_key pending_items fields in
              if value = "" then loop (Some key) [] fields rest
              else
                let* fields = add_yaml_field path key (Yaml_scalar value) fields in
                loop None [] fields rest
  in
  Result.map List.rev (loop None [] [] lines)

let split_markdown_frontmatter path text =
  let lines = String.split_on_char '\n' text in
  match lines with
  | first :: rest when String.trim first = "---" ->
      let rec collect_frontmatter acc = function
        | [] -> Error (path ^ ": missing closing frontmatter delimiter")
        | line :: rest when String.trim line = "---" ->
            Ok (List.rev acc, String.concat "\n" rest)
        | line :: rest -> collect_frontmatter (line :: acc) rest
      in
      collect_frontmatter [] rest
  | _ -> Error (path ^ ": profile must start with YAML frontmatter")

let required_scalar path fields key =
  match List.assoc_opt key fields with
  | Some (Yaml_scalar value) when String.trim value <> "" -> Ok value
  | Some (Yaml_list _) -> Error (path ^ ": " ^ key ^ " must be a scalar")
  | _ -> Error (path ^ ": " ^ key ^ " is required")

let optional_forbidden_key path fields key =
  if List.mem_assoc key fields then Error (path ^ ": unsupported frontmatter key: " ^ key)
  else Ok ()

let parse_inherit_string path fields key =
  Result.map
    (fun value ->
      if value = "inherit" then Inherit_string else Concrete_string value)
    (required_scalar path fields key)

let parse_sandbox_setting path fields =
  match required_scalar path fields "sandbox" with
  | Error _ as error -> error
  | Ok "inherit" -> Ok Inherit_sandbox
  | Ok value -> (
      match Capability_profile.sandbox_of_string value with
      | Some Capability_profile.Danger_full_access ->
          Error (path ^ ": danger-full-access is not allowed for subagent profiles")
      | Some sandbox -> Ok (Concrete_sandbox sandbox)
      | None -> Error (path ^ ": invalid sandbox: " ^ value))

let parse_approval_setting path fields =
  match List.assoc_opt "approval" fields with
  | None | Some (Yaml_scalar "inherit") -> Ok Inherit_approval
  | Some (Yaml_scalar value) -> (
      match Capability_profile.approval_of_string value with
      | Some approval -> Ok (Concrete_approval approval)
      | None -> Error (path ^ ": invalid approval: " ^ value))
  | Some (Yaml_list _) -> Error (path ^ ": approval must be a scalar")

let parse_tools_setting path fields =
  match List.assoc_opt "tools" fields with
  | Some (Yaml_scalar "inherit") -> Ok Inherit_tools
  | Some (Yaml_scalar value) ->
      Error (path ^ ": tools must be inherit or a non-empty list, got " ^ value)
  | Some (Yaml_list tools) ->
      let tools = List.filter_map Shared.trim_non_empty tools in
      if tools = [] then Error (path ^ ": tools list must not be empty")
      else Ok (Concrete_tools tools)
  | None -> Error (path ^ ": tools is required")

let validate_provider_model_pair path provider model_ =
  match (provider, model_) with
  | Inherit_string, Inherit_string -> Ok ()
  | Concrete_string _, Concrete_string _ -> Ok ()
  | Inherit_string, Concrete_string _ ->
      Error (path ^ ": provider and model must both be inherit or both be concrete")
  | Concrete_string _, Inherit_string ->
      Error (path ^ ": provider and model must both be inherit or both be concrete")

let parse_markdown_profile ~path text =
  let ( let* ) = Result.bind in
  let* frontmatter_lines, body = split_markdown_frontmatter path text in
  let* fields = parse_frontmatter_fields path frontmatter_lines in
  let* () = optional_forbidden_key path fields "models" in
  let* () = optional_forbidden_key path fields "spawns" in
  let* () = optional_forbidden_key path fields "approval_timeout" in
  let* name = required_scalar path fields "name" in
  let* description = required_scalar path fields "description" in
  let* provider = parse_inherit_string path fields "provider" in
  let* model_ = parse_inherit_string path fields "model" in
  let* () = validate_provider_model_pair path provider model_ in
  let* thinking = parse_inherit_string path fields "thinking" in
  let* sandbox = parse_sandbox_setting path fields in
  let* approval = parse_approval_setting path fields in
  let* tools = parse_tools_setting path fields in
  Ok
    {
      spec_name = name;
      spec_description = description;
      spec_provider = provider;
      spec_model = model_;
      spec_thinking = thinking;
      spec_sandbox = sandbox;
      spec_approval = approval;
      spec_tools = tools;
      spec_prompt = body;
      spec_source = User_markdown path;
    }

let profile_tool_names = function
  | Inherit_tools -> []
  | Concrete_tools tools -> tools

let validate_builtin_overrides overrides =
  let rec loop seen errors = function
    | [] -> List.rev errors
    | override :: rest ->
        let name = String.trim override.override_name in
        let errors =
          if builtin_profile_exists name then errors
          else ("unknown built-in agent profile override: " ^ name) :: errors
        in
        let errors =
          if List.mem name seen then
            ("duplicate built-in agent profile override: " ^ name) :: errors
          else errors
        in
        let errors =
          match
            validate_provider_model_pair
              ("taumel.agents." ^ name)
              override.override_provider override.override_model
          with
          | Ok () -> errors
          | Error message -> message :: errors
        in
        loop (name :: seen) errors rest
  in
  loop [] [] overrides

let apply_builtin_override overrides spec =
  match spec.spec_source with
  | User_markdown _ -> spec
  | Builtin -> (
      match
        List.find_opt
          (fun override -> String.trim override.override_name = spec.spec_name)
          overrides
      with
      | None -> spec
      | Some override ->
          {
            spec with
            spec_provider = override.override_provider;
            spec_model = override.override_model;
            spec_thinking = override.override_thinking;
          })

let validate_profile_specs ~live_tools specs =
  let live_tools = Capability_profile.of_list live_tools in
  let validate_one errors spec =
    let errors =
      match spec.spec_source with
      | User_markdown path when builtin_profile_exists spec.spec_name ->
          (path ^ ": user profile cannot override built-in profile: " ^ spec.spec_name)
          :: errors
      | _ -> errors
    in
    List.fold_left
      (fun errors tool ->
        if Subagents.is_agent_tool_name tool then
          (spec.spec_name ^ ": profile tools must not include agent tool " ^ tool)
          :: errors
        else if Capability_profile.allows live_tools tool then errors
        else (spec.spec_name ^ ": unknown tool in profile: " ^ tool) :: errors)
      errors (profile_tool_names spec.spec_tools)
  in
  let errors = List.fold_left validate_one [] specs in
  let rec duplicate_errors seen errors = function
    | [] -> errors
    | spec :: rest ->
        if List.mem spec.spec_name seen then
          duplicate_errors seen
            (("duplicate agent profile name: " ^ spec.spec_name) :: errors)
            rest
        else duplicate_errors (spec.spec_name :: seen) errors rest
  in
  let errors = duplicate_errors [] errors specs |> List.rev in
  if errors = [] then { catalog_profiles = specs; catalog_errors = [] }
  else { catalog_profiles = specs; catalog_errors = errors }

let build_profile_catalog ?(builtin_overrides = []) ~live_tools user_profiles =
  let builtin_specs =
    List.map (apply_builtin_override builtin_overrides) builtin_specs
  in
  let catalog = validate_profile_specs ~live_tools (builtin_specs @ user_profiles) in
  let override_errors = validate_builtin_overrides builtin_overrides in
  { catalog with catalog_errors = override_errors @ catalog.catalog_errors }
