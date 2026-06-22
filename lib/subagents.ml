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
}

type id_request = { id : string }

type request =
  | Spawn of spawn_tool_request
  | Send of prompt_request
  | Wait of id_request
  | Close of id_request
  | List

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
  depth : int;
  filesystem_mode : Sandbox.filesystem_mode;
  no_sandbox : bool;
  subagent : bool;
  profile : Capability_profile.t;
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
                ("depth", Shared.Number (float_of_int input.depth));
                ( "sandbox",
                  Shared.String (Sandbox.filesystem_mode_to_string input.filesystem_mode)
                );
                ("noSandbox", Shared.Bool input.no_sandbox);
                ("subagent", Shared.Bool input.subagent);
                ("capabilityProfile", Capability_profile.to_json input.profile);
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
      depth = worker.depth;
      filesystem_mode = worker.sandbox.filesystem_mode;
      no_sandbox = worker.sandbox.no_sandbox;
      subagent = worker.sandbox.subagent;
      profile = worker.profile;
      active_tools;
    }

let child_session_created = function
  | Some (bridge : child_session_bridge_facts) ->
      (not bridge.cancelled) && bridge.error = None && bridge.session_id <> None
  | None -> false

let plan_child_session_bridge_update ~action ~prepared_worker_id ~worker_id ~bridge =
  match action with
  | "agent_spawn" -> (
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
    let definition = create_definition ~max_depth:3 definition_profile in
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
  | Close request -> (
      match find_owned_worker owner workers request.id with
      | Error _ as error -> error
      | Ok worker ->
          let updated = close worker in
          Ok
            (plan ~worker:updated ~changed:true (replace_worker updated workers)
               "agent_close" ("Closed " ^ summary updated)))
  | List ->
      let owned = list_owned ~parent_id:owner.id workers in
      let message =
        match owned with
        | [] -> "No workers."
        | workers -> String.concat "\n" (List.map summary workers)
      in
      Ok (plan ~listed_workers:owned workers "tool_result" message)

let request_of_values ~workspace_roots ~default_id ?action ?id ?agent ?prompt
    ?model_id ?thinking_level ?sandbox_preset ?tools ?(no_sandbox = false) () =
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
             model_id = opt_trim model_id Shared.trim_non_empty;
             thinking_level = opt_trim thinking_level Shared.trim_non_empty;
             sandbox_preset;
             tools;
             workspace_roots;
             no_sandbox;
           })
  | "send" -> (
      match opt_trim id Shared.trim_non_empty with
      | Some id -> Ok (Send { id; prompt = Option.value prompt ~default:"" })
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

let tool_spec =
  { Tool_gateway.name = "agent"; effect_kind = Tool_gateway.Spawn_agent }
