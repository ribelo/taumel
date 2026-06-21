open Jsoo_bridge
open App_state

let js_worker (worker : Taumel.Subagents.worker) =
  let allowed_tools =
    match Taumel.Capability_profile.allowlist_names worker.profile.tools with
    | None -> Unsafe.inject Js.null
    | Some tools -> js_array (List.map js_string tools)
  in
  Unsafe.obj
    [|
      ("id", js_string worker.id);
      ( "parentId",
        match worker.parent_id with
        | None -> Unsafe.inject Js.null
        | Some parent -> js_string parent );
      ("definitionName", js_string worker.definition_name);
      ("depth", js_number (float_of_int worker.depth));
      ("lifecycle", js_string (Taumel.Subagents.lifecycle_to_string worker.lifecycle));
      ("modelId", js_string worker.profile.model_id);
      ("thinkingLevel", js_string worker.profile.thinking_level);
      ("profile", json_to_js (Taumel.Capability_profile.to_json worker.profile));
      ( "sandbox",
        js_string
          (Taumel.Sandbox.filesystem_mode_to_string worker.sandbox.filesystem_mode) );
      ("noSandbox", js_bool worker.sandbox.no_sandbox);
      ("subagent", js_bool worker.sandbox.subagent);
      ("allowedTools", allowed_tools);
    |]

let summary (worker : Taumel.Subagents.worker) =
  Taumel.Subagents.summary worker

let result ?(action = "tool_result") ?(message = "") ?(prompt = "")
    (worker : Taumel.Subagents.worker) =
  let text = if message = "" then summary worker else message in
  ok_obj
    [
      ("action", js_string action);
      ("text", js_string text);
      ("workerId", js_string worker.id);
      ("prompt", js_string prompt);
      ( "details",
        inject
          (Unsafe.obj
             [|
               ("worker", inject (js_worker worker));
               ("ok", js_bool true);
             |]) );
    ]

let optional_worker_tool_names worker =
  Option.map
    (fun value -> array_items value |> List.filter_map string_value)
    (optional_field worker "allowedTools")

let plan_active_tools worker facts =
  Taumel.Tool_catalog.plan_agent_child_active_tools
    ~worker_tools:(optional_worker_tool_names worker)
    ~current_active_tools_available:(get_bool facts "currentActiveToolsAvailable")
    ~current_active_tools:(get_string_array facts "currentActiveTools")

let worker_spawn_input worker active_tools =
  match json_from_js (Unsafe.get worker "profile") with
  | Error message -> Error message
  | Ok profile_json -> (
      match Taumel.Capability_profile.of_json profile_json with
      | Error message -> Error message
      | Ok profile -> (
          match
            Taumel.Sandbox.filesystem_mode_of_string (get_string worker "sandbox")
          with
          | None -> Error "agent worker has invalid sandbox mode"
          | Some filesystem_mode ->
              (match int_field worker "depth" with
              | None -> Error "agent worker has invalid depth"
              | Some depth ->
              Ok
                {
                  Taumel.Subagents.worker_id = get_string worker "id";
                  depth;
                  filesystem_mode;
                  no_sandbox = get_bool worker "noSandbox";
                  subagent = get_bool worker "subagent";
                  profile;
                  active_tools;
                }))
          )

let plan_spawn facts =
  let prepared = Unsafe.get facts "prepared" in
  let details = Unsafe.get prepared "details" in
  let worker = Unsafe.get details "worker" in
  let active_tools = plan_active_tools worker facts in
  match worker_spawn_input worker active_tools with
  | Error message -> error_obj message
  | Ok input -> (
      match
        Taumel.Subagents.plan_child_session_spawn_from_input
          ~prompt:(get_string prepared "prompt") input
      with
      | Error message -> error_obj message
      | Ok plan ->
          ok_obj
            [
              ("workerId", js_string plan.worker_id);
              ("prompt", js_string plan.prompt);
              ("metadata", json_to_js plan.metadata);
            ])

let finish_action params =
  let prepared = Unsafe.get params "prepared" in
  let action = get_string prepared "action" in
  let dispatch_extra = Unsafe.obj [| ("dispatch", Unsafe.get params "dispatch") |] in
  let extra =
    match action with
    | "agent_spawn" ->
        let bridge_details =
          Child_session_bridge.child_bridge_details (Unsafe.get params "bridge")
        in
        merge_js_details bridge_details dispatch_extra
    | "agent_send" -> dispatch_extra
    | _ -> Unsafe.obj [||]
  in
  prepared_tool_result_with_extra prepared extra

let plan_bridge_update params =
  let prepared = Unsafe.get params "prepared" in
  let action = get_string prepared "action" in
  let bridge =
    match
      Child_session_bridge.child_session_bridge_from_js
        (Unsafe.get params "bridge")
    with
    | None -> None
    | Some bridge ->
        Some
          {
            Taumel.Subagents.session_id = bridge.session_id;
            cancelled = bridge.cancelled;
            error = bridge.error;
          }
  in
  match
    Taumel.Subagents.plan_child_session_bridge_update ~action
      ~prepared_worker_id:(get_string prepared "workerId")
      ~worker_id:(optional_string_field params "workerId") ~bridge
  with
  | No_bridge_update -> ok_obj [ ("action", js_string "none") ]
  | Store_child_session key ->
      ok_obj [ ("action", js_string "store_child_session"); ("key", js_string key) ]
  | Delete_child_session key ->
      ok_obj
        [ ("action", js_string "delete_child_session"); ("key", js_string key) ]

let find_worker id =
  Taumel.Subagents.find_worker id !workers

let current_owner ctx =
  let root_owner () =
    ({
      id = Session_store.session_id_from_ctx ctx;
      is_subagent = !active_subagent;
      depth = (if !active_subagent then 1 else 0);
    } : Taumel.Subagents.owner)
  in
  match Session_store.custom_entry_data ctx "taumel.childSession" with
  | Some data when get_string data "kind" = "agent" ->
      let worker_id = String.trim (get_string data "workerId") in
      if worker_id = "" then root_owner ()
      else
        let metadata_depth = int_field data "depth" in
        let depth =
          match metadata_depth with
          | Some depth when depth > 0 -> depth
          | _ ->
            match find_worker worker_id with
            | Some worker -> worker.depth
            | None -> 1
        in
        { id = worker_id; is_subagent = true; depth }
  | _ -> root_owner ()

let request_from_params params =
  Result.bind (json_from_js params)
    (Taumel.Subagents.request_of_json
       ~workspace_roots:(if state.cwd = "" then [] else [ state.cwd ])
       ~default_id:(Taumel.Subagents.default_worker_id !workers))

let render_plan plan =
  match plan.Taumel.Subagents.worker with
  | Some worker ->
      result ~action:plan.action ~prompt:plan.prompt ~message:plan.message worker
  | None ->
      ok_obj
        [
          ("action", js_string "tool_result");
          ("text", js_string plan.message);
          ( "details",
            inject
              (Unsafe.obj
                 [|
                   ("ok", js_bool true);
                   ("workers", js_array (List.map js_worker plan.listed_workers));
                 |]) );
        ]

let prepare params ctx =
  with_gateway_authorized "agent" (fun _ ->
      let owner = current_owner ctx in
      match request_from_params params with
      | Error message -> error_obj message
      | Ok request -> (
          match
            Taumel.Subagents.apply_request ~parent_profile:(active_profile ())
              ~owner !workers request
          with
          | Error message -> error_obj message
          | Ok plan ->
              if plan.changed then workers := plan.workers;
              render_plan plan))
