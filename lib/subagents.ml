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
  else if
    request.definition.profile.sandbox_preset
    = Some Capability_profile.Danger_full_access
  then Error "danger-full-access is not allowed for subagents"
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
  create_goal : bool;
  system_prompt : string;
  model_id : string option;
  thinking_level : string option;
  sandbox_preset : Capability_profile.sandbox_preset option;
  approval_policy : Capability_profile.approval_policy option;
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

let find_worker_for_parent ~parent_id id workers =
  let id = String.trim id in
  List.find_opt
    (fun (worker : worker) -> worker.id = id && worker.parent_id = Some parent_id)
    workers

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

let model_id_option_json value =
  match Option.bind value Shared.trim_non_empty with
  | None | Some "inherit" -> Shared.Null
  | Some value -> Shared.String value

let string_list_option_json = function
  | None -> Shared.Null
  | Some values -> Shared.Array (List.map (fun value -> Shared.String value) values)

let plan_child_session_spawn_from_input ?initial_goal_objective ~prompt input =
  match Shared.trim_non_empty input.worker_id with
  | None -> Error "agent spawn plan requires worker details"
  | Some worker_id ->
      let metadata_fields =
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
          ("modelId", model_id_option_json (Some input.profile.model_id));
          ( "thinkingLevel",
            string_option_json (Some input.profile.thinking_level) );
          ("activeTools", string_list_option_json input.active_tools);
        ]
      in
      let metadata_fields =
        match Option.bind initial_goal_objective Shared.trim_non_empty with
        | None -> metadata_fields
        | Some objective ->
            metadata_fields @ [ ("initialGoalObjective", Shared.String objective) ]
      in
      Ok
        {
          worker_id;
          prompt;
          metadata = Shared.Object metadata_fields;
        }

let plan_child_session_spawn ~prompt (worker : worker) ~active_tools =
  plan_child_session_spawn_from_input ~initial_goal_objective:prompt ~prompt
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
    match find_worker_for_parent ~parent_id:owner.id id workers with
    | Some worker -> Ok worker
    | None when find_worker id workers <> None ->
        Error ("worker is not owned by this session: " ^ id)
    | None -> Error ("unknown worker: " ^ id)

let replace_worker (updated : worker) workers =
  List.map
    (fun (worker : worker) ->
      if worker.id = updated.id && worker.parent_id = updated.parent_id then updated
      else worker)
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
  else if find_worker_for_parent ~parent_id:owner.id request.id workers <> None then
    Error ("worker already exists: " ^ String.trim request.id)
  else
    let definition_profile =
      {
        Capability_profile.name = request.name;
        enabled = true;
        model_id = request.model_id;
        thinking_level = request.thinking_level;
        sandbox_preset = request.sandbox_preset;
        approval_policy = request.approval_policy;
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
    ?model_id ?thinking_level ?sandbox_preset ?approval_policy ?tools
    ?(no_sandbox = false) ?(interrupt = false) ?(create_goal = false) () =
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
      let approval_policy =
        match approval_policy with
        | None | Some "inherit" -> Ok None
        | Some value -> (
            match Capability_profile.approval_of_string value with
            | Some policy -> Ok (Some policy)
            | None -> Error ("agent.approval_policy is invalid: " ^ value))
      in
      let* approval_policy = approval_policy in
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
             create_goal;
             system_prompt = "";
             model_id = opt_trim model_id Shared.trim_non_empty;
             thinking_level = opt_trim thinking_level Shared.trim_non_empty;
             sandbox_preset;
             approval_policy;
             tools;
             workspace_roots;
             no_sandbox;
           })
  | "send" -> (
      match (opt_trim id Shared.trim_non_empty, opt_trim prompt Shared.trim_non_empty) with
      | None, _ -> Error "agent_id is required"
      | Some _, None when not interrupt ->
          Error "agent_send.message is required unless interrupt is true"
      | Some id, prompt ->
          Ok
            (Send
               {
                 id;
                 prompt = Option.value prompt ~default:"";
                 interrupt;
               }))
  | "wait" -> (
      match opt_trim id Shared.trim_non_empty with
      | Some id -> Ok (Wait { id })
      | None -> Error "agent.id must not be empty")
  | "close" -> (
      match opt_trim id Shared.trim_non_empty with
      | Some id -> Ok (Close { id })
      | None -> Error "agent.id must not be empty")
  | _ -> Error "agent action must be spawn, send, wait, close, or list"

let tool_specs =
  [
    { Tool_gateway.name = "agent_spawn"; effect_kind = Tool_gateway.Spawn_agent };
    { Tool_gateway.name = "agent_send"; effect_kind = Tool_gateway.Spawn_agent };
    { Tool_gateway.name = "agent_wait"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "agent_list"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "agent_close"; effect_kind = Tool_gateway.Spawn_agent };
    { Tool_gateway.name = "agent_profiles"; effect_kind = Tool_gateway.Pure };
  ]
