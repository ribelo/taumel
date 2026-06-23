type lifecycle =
  | Running
  | Waiting
  | Closed
  | Failed of string

type definition = {
  name : string;
  enabled : bool;
  profile : Capability_profile.agent_definition;
  max_depth : int;
}

type worker = {
  id : string;
  parent_id : string option;
  definition_name : string;
  profile : Capability_profile.t;
  system_prompt : string;
  active_tools_snapshot : string list option;
  sandbox : Sandbox.config;
  depth : int;
  lifecycle : lifecycle;
}

type spawn_request = {
  id : string;
  parent_id : string option;
  parent_is_subagent : bool;
  parent_depth : int;
  workspace_roots : string list;
  definition : definition;
}

let create_definition ?(enabled = true) ?(max_depth = 1) profile =
  { name = profile.Capability_profile.name; enabled; profile; max_depth }

let spawn parent_profile request =
  if not request.definition.enabled then
    Error ("agent " ^ request.definition.name ^ " is disabled")
  else if request.parent_depth >= request.definition.max_depth then
    Error "nested agent limit reached"
  else
    match Capability_profile.child_profile parent_profile request.definition.profile with
    | Error _ as error -> error
    | Ok child_profile -> (
        match
          Sandbox.config_of_profile ~workspace_roots:request.workspace_roots
            ~no_sandbox:false ~subagent:true child_profile
        with
        | Error _ as error -> error
        | Ok sandbox ->
            Ok
              {
                id = request.id;
                parent_id = request.parent_id;
                definition_name = request.definition.name;
                profile = child_profile;
                system_prompt = "";
                active_tools_snapshot = None;
                sandbox;
                depth = request.parent_depth + 1;
                lifecycle = Running;
              })

let send worker =
  match worker.lifecycle with
  | Running | Waiting -> Ok { worker with lifecycle = Waiting }
  | Closed -> Error "cannot send to a closed worker"
  | Failed message -> Error ("cannot send to a failed worker: " ^ message)

let mark_running worker =
  match worker.lifecycle with
  | Waiting -> Ok { worker with lifecycle = Running }
  | Running -> Ok worker
  | Closed -> Error "cannot resume a closed worker"
  | Failed message -> Error ("cannot resume a failed worker: " ^ message)

let close worker = { worker with lifecycle = Closed }

let fail worker message = { worker with lifecycle = Failed message }

let list_owned ~parent_id (workers : worker list) =
  List.filter (fun (worker : worker) -> worker.parent_id = Some parent_id) workers

type owner = {
  id : string;
  is_subagent : bool;
  depth : int;
}

type spawn_tool_request = {
  id : string;
  name : string;
  prompt : string;
  description : string option;
  system_prompt : string;
  model_id : string option;
  thinking_level : string option;
  sandbox_preset : Capability_profile.sandbox_preset option;
  tools : Capability_profile.allowlist option;
  workspace_roots : string list;
  no_sandbox : bool;
}

type prompt_request = {
  id : string;
  prompt : string;
  interrupt : bool;
}

type id_request = { id : string }

type request =
  | Spawn of spawn_tool_request
  | Send of prompt_request
  | Wait of id_request
  | Wait_all
  | Close of id_request
  | Close_all
  | List

let model_tool_names =
  [
    "agent_spawn";
    "agent_send";
    "agent_wait";
    "agent_list";
    "agent_close";
    "agent_profiles";
  ]

let legacy_tool_names = [ "agent" ]
let all_agent_tool_names = legacy_tool_names @ model_tool_names
let is_agent_tool_name name = List.mem name all_agent_tool_names

type plan = {
  workers : worker list;
  action : string;
  message : string;
  prompt : string;
  worker : worker option;
  listed_workers : worker list;
  changed : bool;
}

let lifecycle_to_string = function
  | Running -> "running"
  | Waiting -> "waiting"
  | Closed -> "closed"
  | Failed message -> "failed: " ^ message

let summary (worker : worker) =
  Printf.sprintf "%s [%s] sandbox=%s subagent=%b" worker.id
    (lifecycle_to_string worker.lifecycle)
    (Sandbox.filesystem_mode_to_string worker.sandbox.filesystem_mode)
    worker.sandbox.subagent

let default_worker_id workers = "worker-" ^ string_of_int (List.length workers + 1)

let agent_id_max_length = 64
let generated_agent_id_suffix_length = 4
let generated_agent_id_alphabet = "abcdefghjkmnpqrstuvwxyz23456789"

let lowercase_ascii_letter c = c >= 'a' && c <= 'z'
let ascii_digit c = c >= '0' && c <= '9'
let agent_id_char c = lowercase_ascii_letter c || ascii_digit c || c = '-'

let invalid_agent_id_message =
  "invalid agent_id: must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 64 characters)"

let validate_agent_id value =
  let value = String.trim value in
  let length = String.length value in
  if length = 0 then Error "agent_id is required"
  else if length > agent_id_max_length then Error invalid_agent_id_message
  else if not (lowercase_ascii_letter value.[0]) then
    Error invalid_agent_id_message
  else
    let rec valid_chars index =
      index >= length || (agent_id_char value.[index] && valid_chars (index + 1))
    in
    if valid_chars 0 then Ok value else Error invalid_agent_id_message

let sanitize_agent_id_prefix value =
  let value = String.lowercase_ascii (String.trim value) in
  let buffer = Buffer.create (String.length value) in
  String.iter
    (fun c -> if agent_id_char c then Buffer.add_char buffer c)
    value;
  let value = Buffer.contents buffer in
  let value =
    if value = "" then "agent"
    else if lowercase_ascii_letter value.[0] then value
    else "agent-" ^ value
  in
  let max_prefix =
    agent_id_max_length - generated_agent_id_suffix_length - 1
  in
  if String.length value <= max_prefix then value
  else String.sub value 0 max_prefix

let stable_hash value =
  let hash = ref 5381 in
  String.iter
    (fun c -> hash := (((!hash lsl 5) + !hash) lxor Char.code c) land max_int)
    value;
  !hash

let generated_agent_id_suffix seed =
  let alphabet_length = String.length generated_agent_id_alphabet in
  String.init generated_agent_id_suffix_length (fun index ->
      let shifted = seed lsr (index * 5) in
      generated_agent_id_alphabet.[shifted mod alphabet_length])

let find_worker id workers =
  let id = String.trim id in
  List.find_opt (fun (worker : worker) -> worker.id = id) workers

type child_session_spawn_plan = {
  worker_id : string;
  prompt : string;
  metadata : Shared.json;
}

type child_session_spawn_input = {
  worker_id : string;
  profile_name : string;
  depth : int;
  filesystem_mode : Sandbox.filesystem_mode;
  no_sandbox : bool;
  subagent : bool;
  profile : Capability_profile.t;
  system_prompt : string;
  active_tools : string list option;
}

type child_session_bridge_update =
  | No_bridge_update
  | Store_child_session of string
  | Delete_child_session of string

type child_session_bridge_facts = {
  session_id : string option;
  cancelled : bool;
  error : string option;
}

let string_option_json value =
  match Option.bind value Shared.trim_non_empty with
  | None -> Shared.Null
  | Some value -> Shared.String value

let string_list_option_json = function
  | None -> Shared.Null
  | Some values -> Shared.Array (List.map (fun value -> Shared.String value) values)

let plan_child_session_spawn_from_input ~prompt input =
  match Shared.trim_non_empty input.worker_id with
  | None -> Error "agent spawn plan requires worker details"
  | Some worker_id ->
      Ok
        {
          worker_id;
          prompt;
          metadata =
            Shared.Object
              [
                ("kind", Shared.String "agent");
                ("workerId", Shared.String worker_id);
                ("profileName", Shared.String input.profile_name);
                ("depth", Shared.Number (float_of_int input.depth));
                ( "sandbox",
                  Shared.String (Sandbox.filesystem_mode_to_string input.filesystem_mode)
                );
                ("noSandbox", Shared.Bool input.no_sandbox);
                ("subagent", Shared.Bool input.subagent);
                ("capabilityProfile", Capability_profile.to_json input.profile);
                ("agentSystemPrompt", string_option_json (Some input.system_prompt));
                ("modelId", string_option_json (Some input.profile.model_id));
                ( "thinkingLevel",
                  string_option_json (Some input.profile.thinking_level) );
                ("activeTools", string_list_option_json input.active_tools);
              ];
        }

let plan_child_session_spawn ~prompt (worker : worker) ~active_tools =
  plan_child_session_spawn_from_input ~prompt
    {
      worker_id = worker.id;
      profile_name = worker.definition_name;
      depth = worker.depth;
      filesystem_mode = worker.sandbox.filesystem_mode;
      no_sandbox = worker.sandbox.no_sandbox;
      subagent = worker.sandbox.subagent;
      profile = worker.profile;
      system_prompt = worker.system_prompt;
      active_tools =
        (match worker.active_tools_snapshot with
        | Some _ as snapshot -> snapshot
        | None -> active_tools);
    }

let child_session_created = function
  | Some (bridge : child_session_bridge_facts) ->
      (not bridge.cancelled) && bridge.error = None && bridge.session_id <> None
  | None -> false

let plan_child_session_bridge_update ~action ~prepared_worker_id ~worker_id ~bridge =
  match action with
  | "agent_spawn" | "agent_send" -> (
      let key =
        match Option.bind worker_id Shared.trim_non_empty with
        | Some value -> Some value
        | None -> Shared.trim_non_empty prepared_worker_id
      in
      match key with
      | Some key when child_session_created bridge -> Store_child_session key
      | _ -> No_bridge_update)
  | "agent_close" -> (
      match Shared.trim_non_empty prepared_worker_id with
      | Some key -> Delete_child_session key
      | None -> No_bridge_update)
  | _ -> No_bridge_update

let find_owned_worker (owner : owner) workers id =
  let id = String.trim id in
  if id = "" then Error "worker id is required"
  else
    match find_worker id workers with
    | None -> Error ("unknown worker: " ^ id)
    | Some worker when worker.parent_id <> Some owner.id ->
        Error ("worker is not owned by this session: " ^ id)
    | Some worker -> Ok worker

let replace_worker (updated : worker) workers =
  List.map
    (fun (worker : worker) -> if worker.id = updated.id then updated else worker)
    workers

let plan ?(prompt = "") ?worker ?(listed_workers = []) ?(changed = false) workers
    action message =
  { workers; action; message; prompt; worker; listed_workers; changed }

let apply_spawn ~parent_profile ~(owner : owner) workers
    (request : spawn_tool_request) =
  match validate_agent_id request.id with
  | Error _ as error -> error
  | Ok id ->
  let request = { request with id } in
  if request.no_sandbox then Error "sub-agents cannot enable --no-sandbox"
  else if find_worker request.id workers <> None then
    Error ("worker already exists: " ^ String.trim request.id)
  else
    let definition_profile =
      {
        Capability_profile.name = request.name;
        enabled = true;
        model_id = request.model_id;
        thinking_level = request.thinking_level;
        sandbox_preset = request.sandbox_preset;
        approval_policy = None;
        tools = request.tools;
        agents = None;
        allow_no_sandbox = false;
      }
    in
    let definition = create_definition ~max_depth:1 definition_profile in
    match
      spawn parent_profile
        {
          id = request.id;
          parent_id = Some owner.id;
          parent_is_subagent = owner.is_subagent;
          parent_depth = owner.depth;
          workspace_roots = request.workspace_roots;
          definition;
        }
    with
    | Error _ as error -> error
    | Ok worker ->
        let worker = { worker with system_prompt = request.system_prompt } in
        let workers = worker :: workers in
        Ok
          (plan ~prompt:request.prompt ~worker ~changed:true workers "agent_spawn"
             ("Spawned " ^ summary worker))

let apply_request ~parent_profile ~(owner : owner) workers = function
  | Spawn request -> apply_spawn ~parent_profile ~owner workers request
  | Send request -> (
      match find_owned_worker owner workers request.id with
      | Error _ as error -> error
      | Ok worker -> (
          match send worker with
          | Error _ as error -> error
          | Ok updated ->
              Ok
                (plan ~prompt:request.prompt ~worker:updated ~changed:true
                   (replace_worker updated workers) "agent_send"
                   ("Sent prompt to " ^ summary updated))))
  | Wait request -> (
      match find_owned_worker owner workers request.id with
      | Error _ as error -> error
      | Ok worker -> (
          match mark_running worker with
          | Error _ as error -> error
          | Ok updated ->
              Ok
                (plan ~worker:updated ~changed:true
                   (replace_worker updated workers) "agent_wait" (summary updated))))
  | Wait_all ->
      let owned = list_owned ~parent_id:owner.id workers in
      let message =
        match owned with
        | [] -> "No active runs."
        | workers -> String.concat "\n" (List.map summary workers)
      in
      Ok (plan ~listed_workers:owned workers "tool_result" message)
  | Close request -> (
      match find_owned_worker owner workers request.id with
      | Error _ as error -> error
      | Ok worker ->
          let updated = close worker in
          Ok
            (plan ~worker:updated ~changed:true (replace_worker updated workers)
               "agent_close" ("Closed " ^ summary updated)))
  | Close_all ->
      let owner_matches (worker : worker) = worker.parent_id = Some owner.id in
      let closed_count =
        List.fold_left
          (fun count worker -> if owner_matches worker then count + 1 else count)
          0 workers
      in
      let updated =
        List.map
          (fun worker -> if owner_matches worker then close worker else worker)
          workers
      in
      Ok
        (plan ~changed:(closed_count > 0) updated "agent_close"
           (Printf.sprintf "Closed %d agent%s." closed_count
              (if closed_count = 1 then "" else "s")))
  | List ->
      let owned = list_owned ~parent_id:owner.id workers in
      let message =
        match owned with
        | [] -> "No workers."
        | workers -> String.concat "\n" (List.map summary workers)
      in
      Ok (plan ~listed_workers:owned workers "tool_result" message)

let request_of_values ~workspace_roots ~default_id ?action ?id ?agent ?prompt
    ?description ?model_id ?thinking_level ?sandbox_preset ?tools
    ?(no_sandbox = false) ?(interrupt = false) () =
  let opt_trim = Option.bind in
  match String.trim (Option.value action ~default:"list") with
  | "" | "list" -> Ok List
  | "spawn" ->
      let name =
        match opt_trim agent Shared.trim_non_empty with
        | Some value -> value
        | None -> "worker"
      in
      let id =
        match opt_trim id Shared.trim_non_empty with
        | Some value -> value
        | None -> default_id
      in
      let sandbox_preset =
        match sandbox_preset with
        | None -> Ok None
        | Some value -> (
            match Capability_profile.sandbox_of_string value with
            | Some preset -> Ok (Some preset)
            | None -> Error ("agent.sandbox_preset is invalid: " ^ value))
      in
      let ( let* ) = Result.bind in
      let* sandbox_preset = sandbox_preset in
      let tools =
        match tools with
        | Some (_ :: _ as tools) -> Some (Capability_profile.of_list tools)
        | Some [] | None -> None
      in
      Ok
        (Spawn
           {
             id;
             name;
             prompt = Option.value prompt ~default:"";
             description = opt_trim description Shared.trim_non_empty;
             system_prompt = "";
             model_id = opt_trim model_id Shared.trim_non_empty;
             thinking_level = opt_trim thinking_level Shared.trim_non_empty;
             sandbox_preset;
             tools;
             workspace_roots;
             no_sandbox;
           })
  | "send" -> (
      match opt_trim id Shared.trim_non_empty with
      | Some id ->
          Ok (Send { id; prompt = Option.value prompt ~default:""; interrupt })
      | None -> Error "agent.id must not be empty")
  | "wait" -> (
      match opt_trim id Shared.trim_non_empty with
      | Some id -> Ok (Wait { id })
      | None -> Error "agent.id must not be empty")
  | "close" -> (
      match opt_trim id Shared.trim_non_empty with
      | Some id -> Ok (Close { id })
      | None -> Error "agent.id must not be empty")
  | _ -> Error "agent action must be spawn, send, wait, close, or list"

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
    approval_policy = None;
    tools =
      (match spec.spec_tools with
      | Inherit_tools -> None
      | Concrete_tools tools -> Some (Capability_profile.of_list tools));
    agents = Some Capability_profile.None_allowed;
    allow_no_sandbox = false;
  }

let spawn_request_with_profile spec request =
  let definition = profile_spec_to_definition spec in
  {
    request with
    name = definition.name;
    system_prompt = spec.spec_prompt;
    model_id = definition.model_id;
    thinking_level = definition.thinking_level;
    sandbox_preset = definition.sandbox_preset;
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
      | Some sandbox -> Ok (Concrete_sandbox sandbox)
      | None -> Error (path ^ ": invalid sandbox: " ^ value))

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
  let* tools = parse_tools_setting path fields in
  Ok
    {
      spec_name = name;
      spec_description = description;
      spec_provider = provider;
      spec_model = model_;
      spec_thinking = thinking;
      spec_sandbox = sandbox;
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
              ("taumel.agents.builtins." ^ name)
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
        if is_agent_tool_name tool then
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

type profile_toggle = {
  toggle_profile : string;
  toggle_enabled : bool;
}

type run_status =
  | Run_queued
  | Run_running
  | Run_suspended
  | Run_completed
  | Run_failed
  | Run_cancelled
  | Run_timed_out
  | Run_lost

type submission = {
  submission_id : string;
  submission_objective : string;
  submission_created_at : int;
}

type agent_identity = {
  identity_agent_id : string;
  identity_parent_session_id : string;
  identity_profile_name : string;
  identity_child_session_id : string option;
  identity_profile_snapshot : Capability_profile.t option;
  identity_sandbox_snapshot : Sandbox.config option;
  identity_system_prompt : string;
  identity_active_tools : string list option;
  identity_created_at : int;
  identity_closed_at : int option;
}

type agent_run = {
  run_id : string;
  run_agent_id : string;
  run_objective : string;
  run_description : string option;
  run_submissions : submission list;
  run_status : run_status;
  run_reason : string option;
  run_final_output : string option;
  run_consumed : bool;
  run_created_at : int;
  run_started_at : int option;
  run_completed_at : int option;
}

type session_state = {
  profile_toggles : profile_toggle list;
  identities : agent_identity list;
  runs : agent_run list;
}

type submission_delivery = {
  delivery_state : session_state;
  delivery_run_id : string;
  delivery_submission_id : string;
  delivery_kind : string;
  delivery_previous_status : run_status option;
}

let dispatch_deliver_as_for_delivery_kind = function
  | "steered" -> "steer"
  | _ -> "followUp"

type wait_selector =
  | Wait_all_active
  | Wait_run_ids of string list
  | Wait_agent_ids of string list

type wait_item = {
  wait_agent_id : string;
  wait_run_id : string option;
  wait_status : string;
  wait_final_output : string option;
  wait_error : string option;
  wait_consumed : bool;
}

type wait_result = {
  wait_state : session_state;
  wait_items : wait_item list;
  wait_message : string;
  wait_active_run_ids : string list;
}

let empty_session_state = { profile_toggles = []; identities = []; runs = [] }

let run_status_to_string = function
  | Run_queued -> "queued"
  | Run_running -> "running"
  | Run_suspended -> "suspended"
  | Run_completed -> "completed"
  | Run_failed -> "failed"
  | Run_cancelled -> "cancelled"
  | Run_timed_out -> "timed_out"
  | Run_lost -> "lost"

let run_status_of_string = function
  | "queued" -> Ok Run_queued
  | "running" -> Ok Run_running
  | "suspended" -> Ok Run_suspended
  | "completed" -> Ok Run_completed
  | "failed" -> Ok Run_failed
  | "cancelled" -> Ok Run_cancelled
  | "timed_out" -> Ok Run_timed_out
  | "lost" -> Ok Run_lost
  | value -> Error ("invalid agent run status: " ^ value)

let active_run_status = function
  | Run_queued | Run_running | Run_suspended -> true
  | Run_completed | Run_failed | Run_cancelled | Run_timed_out | Run_lost -> false

let identity_open identity = identity.identity_closed_at = None

let find_identity state agent_id =
  let agent_id = String.trim agent_id in
  List.find_opt
    (fun identity -> identity.identity_agent_id = agent_id)
    state.identities

let agent_id_used state agent_id = find_identity state agent_id <> None

let default_agent_id ?(scope = "") state profile_name =
  let prefix = sanitize_agent_id_prefix profile_name in
  let seed =
    stable_hash
      (prefix ^ ":" ^ scope ^ ":" ^ string_of_int (List.length state.identities)
     ^ ":" ^ string_of_int (List.length state.runs))
  in
  let rec loop attempt =
    let suffix = generated_agent_id_suffix (seed + attempt) in
    let candidate = prefix ^ "-" ^ suffix in
    if agent_id_used state candidate then loop (attempt + 1) else candidate
  in
  loop 0

let replace_identity updated identities =
  List.map
    (fun identity ->
      if identity.identity_agent_id = updated.identity_agent_id then updated
      else identity)
    identities

let replace_run updated runs =
  List.map
    (fun run -> if run.run_id = updated.run_id then updated else run)
    runs

let runs_for_agent state agent_id =
  List.filter (fun run -> run.run_agent_id = agent_id) state.runs

let find_run state run_id =
  let run_id = String.trim run_id in
  List.find_opt (fun run -> run.run_id = run_id) state.runs

let latest_run state agent_id =
  match runs_for_agent state agent_id with
  | [] -> None
  | first :: rest ->
      Some
        (List.fold_left
           (fun latest run ->
             if run.run_created_at >= latest.run_created_at then run else latest)
           first rest)

let active_run state agent_id =
  runs_for_agent state agent_id
  |> List.find_opt (fun run -> active_run_status run.run_status)

let terminal_run run = not (active_run_status run.run_status)

let next_run_id state agent_id =
  let count = List.length (runs_for_agent state agent_id) + 1 in
  agent_id ^ "-run-" ^ string_of_int count

let submission_id run_id index =
  run_id ^ "-submission-" ^ string_of_int index

let append_submission run now objective =
  let next_index = List.length run.run_submissions + 1 in
  let submission =
    {
      submission_id = submission_id run.run_id next_index;
      submission_objective = objective;
      submission_created_at = now;
    }
  in
  ({ run with run_submissions = run.run_submissions @ [ submission ] }, submission)

let create_run ~now ~agent_id ?description objective =
  let run_id = agent_id ^ "-run-1" in
  let submission =
    {
      submission_id = submission_id run_id 1;
      submission_objective = objective;
      submission_created_at = now;
    }
  in
  ( {
      run_id;
      run_agent_id = agent_id;
      run_objective = objective;
      run_description = description;
      run_submissions = [ submission ];
      run_status = Run_running;
      run_reason = None;
      run_final_output = None;
      run_consumed = false;
      run_created_at = now;
      run_started_at = Some now;
      run_completed_at = None;
    },
    submission )

let create_next_run state ~now ~agent_id ?description objective =
  let run_id = next_run_id state agent_id in
  let submission =
    {
      submission_id = submission_id run_id 1;
      submission_objective = objective;
      submission_created_at = now;
    }
  in
  ( {
      run_id;
      run_agent_id = agent_id;
      run_objective = objective;
      run_description = description;
      run_submissions = [ submission ];
      run_status = Run_running;
      run_reason = None;
      run_final_output = None;
      run_consumed = false;
      run_created_at = now;
      run_started_at = Some now;
      run_completed_at = None;
    },
    submission )

let record_spawn state ~now ~parent_session_id ~agent_id ~profile_name
    ?profile_snapshot ?sandbox_snapshot ?(system_prompt = "") ?description
    objective =
  match validate_agent_id agent_id with
  | Error _ as error -> error
  | Ok agent_id ->
  if agent_id_used state agent_id then
    Error ("agent id was already used in this session: " ^ agent_id)
  else
    let identity =
      {
        identity_agent_id = agent_id;
        identity_parent_session_id = parent_session_id;
        identity_profile_name = profile_name;
        identity_child_session_id = None;
        identity_profile_snapshot = profile_snapshot;
        identity_sandbox_snapshot = sandbox_snapshot;
        identity_system_prompt = system_prompt;
        identity_active_tools = None;
        identity_created_at = now;
        identity_closed_at = None;
      }
    in
    let run, submission = create_run ~now ~agent_id ?description objective in
    let state =
      {
        state with
        identities = identity :: state.identities;
        runs = run :: state.runs;
      }
    in
    Ok
      {
        delivery_state = state;
        delivery_run_id = run.run_id;
        delivery_submission_id = submission.submission_id;
        delivery_kind = "started";
        delivery_previous_status = None;
      }

let record_send ?(interrupt = false) state ~now ~agent_id objective =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity when not (identity_open identity) ->
      Error ("cannot send to a closed agent: " ^ agent_id)
  | Some _ -> (
      match active_run state agent_id with
      | Some run when interrupt ->
          let previous_status = run.run_status in
          let cancelled =
            {
              run with
              run_status = Run_cancelled;
              run_reason = Some "interrupted_by_parent";
              run_completed_at = Some now;
            }
          in
          let state = { state with runs = replace_run cancelled state.runs } in
          let run, submission =
            create_next_run state ~now ~agent_id objective
          in
          let state = { state with runs = run :: state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = run.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "started";
              delivery_previous_status = Some previous_status;
            }
      | Some run ->
          let previous_status = run.run_status in
          let updated, submission = append_submission run now objective in
          let state = { state with runs = replace_run updated state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = updated.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "steered";
              delivery_previous_status = Some previous_status;
            }
      | None ->
          let run, submission =
            create_next_run state ~now ~agent_id objective
          in
          let state = { state with runs = run :: state.runs } in
          Ok
            {
              delivery_state = state;
              delivery_run_id = run.run_id;
              delivery_submission_id = submission.submission_id;
              delivery_kind = "started";
              delivery_previous_status = None;
            })

let record_child_session_start state ~agent_id ?child_session_id ?active_tools ()
    =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity ->
      let updated =
        {
          identity with
          identity_child_session_id = child_session_id;
          identity_active_tools =
            (match active_tools with
            | Some tools -> Some tools
            | None -> identity.identity_active_tools);
        }
      in
      Ok { state with identities = replace_identity updated state.identities }

let worker_of_identity_snapshot ~(owner : owner) identity =
  if identity.identity_parent_session_id <> owner.id then
    Error ("agent is not owned by this session: " ^ identity.identity_agent_id)
  else if not (identity_open identity) then
    Error ("cannot send to a closed agent: " ^ identity.identity_agent_id)
  else if owner.depth >= 1 then Error "nested agent limit reached"
  else
    match (identity.identity_profile_snapshot, identity.identity_sandbox_snapshot) with
    | Some profile, Some sandbox ->
        Ok
          {
            id = identity.identity_agent_id;
            parent_id = Some owner.id;
            definition_name = identity.identity_profile_name;
            profile;
            system_prompt = identity.identity_system_prompt;
            active_tools_snapshot = identity.identity_active_tools;
            sandbox;
            depth = owner.depth + 1;
            lifecycle = Running;
          }
    | _ ->
        Error
          ("agent profile snapshot is missing for " ^ identity.identity_agent_id)

let cancel_active_run ~now reason run =
  if active_run_status run.run_status then
    {
      run with
      run_status = Run_cancelled;
      run_reason = Some reason;
      run_completed_at = Some now;
    }
  else run

let record_close state ~now ~agent_id =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity ->
      let closed =
        match identity.identity_closed_at with
        | Some _ -> identity
        | None -> { identity with identity_closed_at = Some now }
      in
      let runs =
        List.map
          (fun run ->
            if run.run_agent_id = agent_id then
              cancel_active_run ~now "closed_by_parent" run
            else run)
          state.runs
      in
      Ok
        {
          state with
          identities = replace_identity closed state.identities;
          runs;
        }

let record_close_all state ~now ~parent_session_id =
  let closing_ids =
    state.identities
    |> List.filter (fun identity ->
           identity.identity_parent_session_id = parent_session_id
           && identity.identity_closed_at = None)
    |> List.map (fun identity -> identity.identity_agent_id)
  in
  let identities =
    List.map
      (fun identity ->
        if List.mem identity.identity_agent_id closing_ids then
          { identity with identity_closed_at = Some now }
        else identity)
      state.identities
  in
  let runs =
    List.map
      (fun run ->
        if List.mem run.run_agent_id closing_ids then
          cancel_active_run ~now "closed_by_parent" run
        else run)
      state.runs
  in
  ({ state with identities; runs }, closing_ids <> [])

let cancel_run_with_reason ~now reason run =
  if active_run_status run.run_status then
    ( {
        run with
        run_status = Run_cancelled;
        run_reason = Some reason;
        run_completed_at = Some now;
      },
      true )
  else (run, false)

let record_stop_run state ~now ~run_id =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run ->
      let updated, changed = cancel_run_with_reason ~now "stopped_by_parent" run in
      Ok ({ state with runs = replace_run updated state.runs }, changed)

let record_stop_agent state ~now ~agent_id =
  match find_identity state agent_id with
  | None -> Error ("unknown agent: " ^ agent_id)
  | Some identity when not (identity_open identity) ->
      Error ("cannot stop a closed agent: " ^ agent_id)
  | Some _ -> (
      match active_run state agent_id with
      | None -> Ok (state, false)
      | Some run ->
          let updated, changed =
            cancel_run_with_reason ~now "stopped_by_parent" run
          in
          Ok ({ state with runs = replace_run updated state.runs }, changed))

let record_stop_all state ~now ~parent_session_id =
  let changed = ref false in
  let runs =
    List.map
      (fun run ->
        match find_identity state run.run_agent_id with
        | Some identity
          when identity.identity_parent_session_id = parent_session_id
               && identity_open identity ->
            let updated, run_changed =
              cancel_run_with_reason ~now "stopped_by_parent" run
            in
            if run_changed then changed := true;
            updated
        | _ -> run)
      state.runs
  in
  ({ state with runs }, !changed)

let record_run_completion state ~now ~run_id ~status ?reason ?final_output () =
  match find_run state run_id with
  | None -> Error ("unknown run: " ^ run_id)
  | Some run ->
      if active_run_status status then
        Error "completion status must be terminal"
      else
        let updated =
          {
            run with
            run_status = status;
            run_reason = reason;
            run_final_output = final_output;
            run_completed_at = Some now;
          }
        in
        Ok { state with runs = replace_run updated state.runs }

let run_owned_by_parent state ~parent_session_id run =
  match find_identity state run.run_agent_id with
  | Some identity -> identity.identity_parent_session_id = parent_session_id
  | None -> false

let output_run_for_target state ~parent_session_id target =
  let target = String.trim target in
  if target = "" then Error "agent-runs output target is required"
  else
    match find_run state target with
    | Some run when run_owned_by_parent state ~parent_session_id run -> Ok run
    | Some run ->
        Error ("run is not owned by this session: " ^ run.run_id)
    | None -> (
        match find_identity state target with
        | Some identity when identity.identity_parent_session_id = parent_session_id -> (
            match latest_run state target with
            | Some run -> Ok run
            | None -> Error ("agent has no runs: " ^ target))
        | Some _ -> Error ("agent is not owned by this session: " ^ target)
        | None -> Error ("unknown agent or run: " ^ target))

let mark_active_runs_lost ?(live_agent_ids = []) state =
  let runs =
    List.map
      (fun run ->
        if
          active_run_status run.run_status
          && not (List.mem run.run_agent_id live_agent_ids)
        then
          {
            run with
            run_status = Run_lost;
            run_reason = Some "process_resumed_without_live_worker";
          }
        else run)
      state.runs
  in
  let identities =
    List.map
      (fun identity ->
        if List.mem identity.identity_agent_id live_agent_ids then identity
        else { identity with identity_child_session_id = None })
      state.identities
  in
  { state with identities; runs }

let consume_run_if_terminal run =
  if terminal_run run then { run with run_consumed = true } else run

let wait_item_of_run run =
  {
    wait_agent_id = run.run_agent_id;
    wait_run_id = Some run.run_id;
    wait_status = run_status_to_string run.run_status;
    wait_final_output = run.run_final_output;
    wait_error = run.run_reason;
    wait_consumed = run.run_consumed || terminal_run run;
  }

let no_active_wait_item agent_id =
  {
    wait_agent_id = agent_id;
    wait_run_id = None;
    wait_status = "no_active_run";
    wait_final_output = None;
    wait_error = None;
    wait_consumed = false;
  }

let unknown_run_wait_item run_id =
  {
    wait_agent_id = "";
    wait_run_id = Some run_id;
    wait_status = "unknown_run";
    wait_final_output = None;
    wait_error = Some ("unknown run: " ^ run_id);
    wait_consumed = false;
  }

let wait_message items =
  match items with
  | [] -> "No active runs."
  | items ->
      String.concat "\n"
        (List.map
           (fun item ->
             match item.wait_run_id with
             | None -> item.wait_agent_id ^ " [no_active_run]"
             | Some run_id ->
                 let agent =
                   if item.wait_agent_id = "" then "" else item.wait_agent_id ^ " "
                 in
                 agent ^ run_id ^ " [" ^ item.wait_status ^ "]")
           items)

let active_wait_run_ids items =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | item :: rest -> (
        match (item.wait_run_id, run_status_of_string item.wait_status) with
        | Some run_id, Ok status
          when active_run_status status && not (List.mem run_id seen) ->
            loop (run_id :: seen) (run_id :: acc) rest
        | _ -> loop seen acc rest)
  in
  loop [] [] items

let wait_result state items =
  {
    wait_state = state;
    wait_items = items;
    wait_message = wait_message items;
    wait_active_run_ids = active_wait_run_ids items;
  }

let wait_for_selector state ~parent_session_id selector =
  let select_all_active () =
    state.runs
    |> List.filter (fun run ->
           active_run_status run.run_status
           &&
           match find_identity state run.run_agent_id with
           | Some identity ->
               identity.identity_parent_session_id = parent_session_id
               && identity_open identity
           | None -> false)
  in
  match selector with
  | Wait_all_active ->
      let items = List.map wait_item_of_run (select_all_active ()) in
      wait_result state items
  | Wait_agent_ids agent_ids ->
      let items =
        List.map
          (fun agent_id ->
            match find_identity state agent_id with
            | Some identity
              when identity.identity_parent_session_id = parent_session_id -> (
                match active_run state agent_id with
                | Some run -> wait_item_of_run run
                | None -> no_active_wait_item agent_id)
            | Some _ ->
                {
                  (no_active_wait_item agent_id) with
                  wait_status = "not_owned";
                  wait_error = Some ("agent is not owned by this session: " ^ agent_id);
                }
            | None ->
                {
                  (no_active_wait_item agent_id) with
                  wait_status = "unknown_agent";
                  wait_error = Some ("unknown agent: " ^ agent_id);
                })
          agent_ids
      in
      wait_result state items
  | Wait_run_ids run_ids ->
      let state_ref = ref state in
      let items =
        List.map
          (fun run_id ->
            match find_run !state_ref run_id with
            | None -> unknown_run_wait_item run_id
            | Some run -> (
                match find_identity !state_ref run.run_agent_id with
                | Some identity
                  when identity.identity_parent_session_id = parent_session_id ->
                    let consumed = consume_run_if_terminal run in
                    if consumed != run then
                      state_ref :=
                        {
                          !state_ref with
                          runs = replace_run consumed (!state_ref).runs;
                        };
                    wait_item_of_run consumed
                | Some _ ->
                    {
                      (wait_item_of_run run) with
                      wait_status = "not_owned";
                      wait_error =
                        Some
                          ("run is not owned by this session: " ^ run.run_id);
                    }
                | None -> wait_item_of_run run))
          run_ids
      in
      wait_result !state_ref items

let profile_enabled state name =
  match
    List.find_opt
      (fun toggle -> toggle.toggle_profile = name)
      state.profile_toggles
  with
  | Some toggle -> toggle.toggle_enabled
  | None -> true

let profile_exists catalog name = find_profile_spec catalog name <> None

let set_profile_enabled ?(catalog = default_profile_catalog) state name enabled =
  let name = String.trim name in
  if name = "" then Error "profile name is required"
  else if not (profile_exists catalog name) then
    Error ("unknown agent profile: " ^ name)
  else
    let rec loop replaced acc = function
      | [] ->
          let acc =
            if replaced then acc
            else { toggle_profile = name; toggle_enabled = enabled } :: acc
          in
          Ok { state with profile_toggles = List.rev acc }
      | toggle :: rest when toggle.toggle_profile = name ->
          loop true
            ({ toggle_profile = name; toggle_enabled = enabled } :: acc)
            rest
      | toggle :: rest -> loop replaced (toggle :: acc) rest
    in
    loop false [] state.profile_toggles

let profile_toggle_to_json toggle =
  Shared.Object
    [
      ("name", Shared.String toggle.toggle_profile);
      ("enabled", Shared.Bool toggle.toggle_enabled);
    ]

let profile_toggle_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* name = Shared.json_required_string path fields "name" in
  let* enabled = Shared.json_required_bool path fields "enabled" in
  Ok { toggle_profile = name; toggle_enabled = enabled }

let int_json value = Shared.Number (float_of_int value)
let int_option_json = function None -> Shared.Null | Some value -> int_json value
let string_option_json = function None -> Shared.Null | Some value -> Shared.String value
let string_list_json values =
  Shared.Array (List.map (fun value -> Shared.String value) values)

let string_list_option_json = function
  | None -> Shared.Null
  | Some values -> string_list_json values

let network_mode_to_json = function
  | Sandbox.Network_disabled -> Shared.String "disabled"
  | Sandbox.Network_enabled -> Shared.String "enabled"

let network_mode_of_json path = function
  | Shared.String "disabled" -> Ok Sandbox.Network_disabled
  | Shared.String "enabled" -> Ok Sandbox.Network_enabled
  | value -> Error (path ^ " must be disabled or enabled, got " ^ Shared.json_kind value)

let sandbox_approval_to_json = function
  | Sandbox.Never -> Shared.String "never"
  | Sandbox.On_request -> Shared.String "on-request"
  | Sandbox.On_failure -> Shared.String "on-failure"
  | Sandbox.Untrusted -> Shared.String "untrusted"

let sandbox_approval_of_json path = function
  | Shared.String "never" -> Ok Sandbox.Never
  | Shared.String "on-request" -> Ok Sandbox.On_request
  | Shared.String "on-failure" -> Ok Sandbox.On_failure
  | Shared.String "untrusted" -> Ok Sandbox.Untrusted
  | value ->
      Error
        (path ^ " must be never, on-request, on-failure, or untrusted, got "
       ^ Shared.json_kind value)

let sandbox_config_to_json (sandbox : Sandbox.config) =
  Shared.Object
    [
      ( "filesystemMode",
        Shared.String (Sandbox.filesystem_mode_to_string sandbox.Sandbox.filesystem_mode) );
      ("workspaceRoots", string_list_json sandbox.workspace_roots);
      ("networkMode", network_mode_to_json sandbox.network_mode);
      ("approvalPolicy", sandbox_approval_to_json sandbox.approval_policy);
      ("noSandbox", Shared.Bool sandbox.no_sandbox);
      ("subagent", Shared.Bool sandbox.subagent);
    ]

let sandbox_config_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* filesystem_mode_string =
    Shared.json_required_string path fields "filesystemMode"
  in
  let* filesystem_mode =
    match Sandbox.filesystem_mode_of_string filesystem_mode_string with
    | Some value -> Ok value
    | None -> Error (Shared.json_path path "filesystemMode" ^ " is invalid")
  in
  let* workspace_roots =
    Result.bind (Shared.json_required_field path fields "workspaceRoots")
      (Shared.json_string_list (Shared.json_path path "workspaceRoots"))
  in
  let* network_mode =
    Result.bind (Shared.json_required_field path fields "networkMode")
      (network_mode_of_json (Shared.json_path path "networkMode"))
  in
  let* approval_policy =
    Result.bind (Shared.json_required_field path fields "approvalPolicy")
      (sandbox_approval_of_json (Shared.json_path path "approvalPolicy"))
  in
  let* no_sandbox = Shared.json_required_bool path fields "noSandbox" in
  let* subagent = Shared.json_required_bool path fields "subagent" in
  Ok
    {
      Sandbox.filesystem_mode;
      workspace_roots;
      network_mode;
      approval_policy;
      no_sandbox;
      subagent;
    }

let optional_profile_snapshot path fields =
  Result.bind (Shared.json_optional_field fields "profile_snapshot") (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some (Capability_profile.of_json value)
        |> Result.map_error (fun message ->
               Shared.json_path path "profile_snapshot" ^ ": " ^ message))

let optional_sandbox_snapshot path fields =
  Result.bind (Shared.json_optional_field fields "sandbox_snapshot") (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some
          (sandbox_config_of_json (Shared.json_path path "sandbox_snapshot") value))

let optional_string_list_snapshot path fields name =
  Result.bind (Shared.json_optional_field fields name) (function
    | None -> Ok None
    | Some value ->
        Result.map Option.some
          (Shared.json_string_list (Shared.json_path path name) value))

let submission_to_json submission =
  Shared.Object
    [
      ("submission_id", Shared.String submission.submission_id);
      ("objective", Shared.String submission.submission_objective);
      ("created_at", int_json submission.submission_created_at);
    ]

let submission_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* submission_id = Shared.json_required_string path fields "submission_id" in
  let* objective = Shared.json_required_string path fields "objective" in
  let* created_at = Shared.json_required_int path fields "created_at" in
  Ok { submission_id; submission_objective = objective; submission_created_at = created_at }

let identity_to_json identity =
  Shared.Object
    [
      ("agent_id", Shared.String identity.identity_agent_id);
      ("parent_session_id", Shared.String identity.identity_parent_session_id);
      ("profile", Shared.String identity.identity_profile_name);
      ("child_session_id", string_option_json identity.identity_child_session_id);
      ( "profile_snapshot",
        match identity.identity_profile_snapshot with
        | None -> Shared.Null
        | Some profile -> Capability_profile.to_json profile );
      ( "sandbox_snapshot",
        match identity.identity_sandbox_snapshot with
        | None -> Shared.Null
        | Some sandbox -> sandbox_config_to_json sandbox );
      ("system_prompt", Shared.String identity.identity_system_prompt);
      ("active_tools", string_list_option_json identity.identity_active_tools);
      ("created_at", int_json identity.identity_created_at);
      ("closed_at", int_option_json identity.identity_closed_at);
    ]

let identity_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* identity_agent_id = Shared.json_required_string path fields "agent_id" in
  let* identity_parent_session_id =
    Shared.json_required_string path fields "parent_session_id"
  in
  let* identity_profile_name = Shared.json_required_string path fields "profile" in
  let* identity_child_session_id =
    Shared.json_optional_string path fields "child_session_id"
  in
  let* identity_profile_snapshot = optional_profile_snapshot path fields in
  let* identity_sandbox_snapshot = optional_sandbox_snapshot path fields in
  let* identity_system_prompt =
    Shared.json_string_default path fields "system_prompt" ""
  in
  let* identity_active_tools =
    optional_string_list_snapshot path fields "active_tools"
  in
  let* identity_created_at = Shared.json_required_int path fields "created_at" in
  let* identity_closed_at =
    Result.map (Option.map int_of_float)
      (Shared.json_optional_number path fields "closed_at")
  in
  Ok
    {
      identity_agent_id;
      identity_parent_session_id;
      identity_profile_name;
      identity_child_session_id;
      identity_profile_snapshot;
      identity_sandbox_snapshot;
      identity_system_prompt;
      identity_active_tools;
      identity_created_at;
      identity_closed_at;
    }

let run_to_json run =
  Shared.Object
    [
      ("run_id", Shared.String run.run_id);
      ("agent_id", Shared.String run.run_agent_id);
      ("objective", Shared.String run.run_objective);
      ("description", string_option_json run.run_description);
      ( "submissions",
        Shared.Array (List.map submission_to_json run.run_submissions) );
      ("status", Shared.String (run_status_to_string run.run_status));
      ("reason", string_option_json run.run_reason);
      ("final_output", string_option_json run.run_final_output);
      ("consumed", Shared.Bool run.run_consumed);
      ("created_at", int_json run.run_created_at);
      ("started_at", int_option_json run.run_started_at);
      ("completed_at", int_option_json run.run_completed_at);
    ]

let run_of_json path json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields path json in
  let* run_id = Shared.json_required_string path fields "run_id" in
  let* run_agent_id = Shared.json_required_string path fields "agent_id" in
  let* run_objective = Shared.json_required_string path fields "objective" in
  let* run_description = Shared.json_optional_string path fields "description" in
  let* submission_values =
    match Shared.json_optional_field fields "submissions" with
    | Error _ as error -> error
    | Ok None -> Ok []
    | Ok (Some value) -> Shared.json_array (Shared.json_path path "submissions") value
  in
  let rec decode_submissions acc index = function
    | [] -> Ok (List.rev acc)
    | value :: rest -> (
        match
          submission_of_json
            (Printf.sprintf "%s.submissions[%d]" path index)
            value
        with
        | Ok submission -> decode_submissions (submission :: acc) (index + 1) rest
        | Error _ as error -> error)
  in
  let* run_submissions = decode_submissions [] 0 submission_values in
  let* status = Shared.json_required_string path fields "status" in
  let* run_status = run_status_of_string status in
  let* run_reason = Shared.json_optional_string path fields "reason" in
  let* run_final_output = Shared.json_optional_string path fields "final_output" in
  let* run_consumed = Shared.json_bool_default path fields "consumed" false in
  let* run_created_at = Shared.json_required_int path fields "created_at" in
  let* run_started_at =
    Result.map (Option.map int_of_float)
      (Shared.json_optional_number path fields "started_at")
  in
  let* run_completed_at =
    Result.map (Option.map int_of_float)
      (Shared.json_optional_number path fields "completed_at")
  in
  Ok
    {
      run_id;
      run_agent_id;
      run_objective;
      run_description;
      run_submissions;
      run_status;
      run_reason;
      run_final_output;
      run_consumed;
      run_created_at;
      run_started_at;
      run_completed_at;
    }

let decode_object_array path fields name decode =
  let ( let* ) = Result.bind in
  let* values =
    match Shared.json_optional_field fields name with
    | Error _ as error -> error
    | Ok None -> Ok []
    | Ok (Some value) -> Shared.json_array (Shared.json_path path name) value
  in
  let rec loop acc index = function
    | [] -> Ok (List.rev acc)
    | value :: rest -> (
        match decode (Printf.sprintf "%s.%s[%d]" path name index) value with
        | Ok item -> loop (item :: acc) (index + 1) rest
        | Error _ as error -> error)
  in
  loop [] 0 values

let session_state_to_json state =
  Shared.Object
    [
      ("version", Shared.Number 1.);
      ( "profiles",
        Shared.Array (List.map profile_toggle_to_json state.profile_toggles) );
      ("agents", Shared.Array (List.map identity_to_json state.identities));
      ("runs", Shared.Array (List.map run_to_json state.runs));
    ]

let session_state_of_json json =
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields "taumel.agents" json in
  let* profile_toggles =
    decode_object_array "taumel.agents" fields "profiles" profile_toggle_of_json
  in
  let* identities =
    decode_object_array "taumel.agents" fields "agents" identity_of_json
  in
  let* runs = decode_object_array "taumel.agents" fields "runs" run_of_json in
  Ok { profile_toggles; identities; runs }

let session_state_codec =
  { Shared.encode = session_state_to_json; decode = session_state_of_json }

let tool_specs =
  [
    { Tool_gateway.name = "agent_spawn"; effect_kind = Tool_gateway.Spawn_agent };
    { Tool_gateway.name = "agent_send"; effect_kind = Tool_gateway.Spawn_agent };
    { Tool_gateway.name = "agent_wait"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "agent_list"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "agent_close"; effect_kind = Tool_gateway.Spawn_agent };
    { Tool_gateway.name = "agent_profiles"; effect_kind = Tool_gateway.Pure };
  ]
