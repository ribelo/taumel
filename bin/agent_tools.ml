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
      ("agentSystemPrompt", js_string worker.system_prompt);
      ("profile", json_to_js (Taumel.Capability_profile.to_json worker.profile));
      ( "sandbox",
        js_string
          (Taumel.Sandbox.filesystem_mode_to_string worker.sandbox.filesystem_mode) );
      ("noSandbox", js_bool worker.sandbox.no_sandbox);
      ("subagent", js_bool worker.sandbox.subagent);
      ("allowedTools", allowed_tools);
      ( "activeToolsSnapshot",
        match worker.active_tools_snapshot with
        | None -> Unsafe.inject Js.null
        | Some tools -> js_array (List.map js_string tools) );
    |]

let summary (worker : Taumel.Subagents.worker) =
  Taumel.Subagents.summary worker

let result ?run_id ?submission_id ?delivery_kind ?previous_status
    ?(action = "tool_result") ?(message = "") ?(prompt = "")
    (worker : Taumel.Subagents.worker) =
  let text = if message = "" then summary worker else message in
  let run_id = Option.value run_id ~default:(worker.id ^ "-run-1") in
  let detail_fields =
    [
      ("worker", inject (js_worker worker));
      ("agent_id", js_string worker.id);
      ("run_id", js_string run_id);
      ("profile", js_string worker.definition_name);
      ("status", js_string (Taumel.Subagents.lifecycle_to_string worker.lifecycle));
      ("ok", js_bool true);
    ]
  in
  let detail_fields =
    match submission_id with
    | None -> detail_fields
    | Some value -> detail_fields @ [ ("submission_id", js_string value) ]
  in
  let detail_fields =
    match delivery_kind with
    | None -> detail_fields
    | Some value -> detail_fields @ [ ("deliveryKind", js_string value) ]
  in
  let detail_fields =
    match previous_status with
    | None -> detail_fields
    | Some value -> detail_fields @ [ ("previousRunStatus", js_string value) ]
  in
  ok_obj
    [
      ("action", js_string action);
      ("text", js_string text);
      ("workerId", js_string worker.id);
      ("agent_id", js_string worker.id);
      ("run_id", js_string run_id);
      ("profile", js_string worker.definition_name);
      ("status", js_string (Taumel.Subagents.lifecycle_to_string worker.lifecycle));
      ("prompt", js_string prompt);
      ("details", inject (Unsafe.obj (Array.of_list detail_fields)));
    ]

let optional_worker_tool_names worker =
  Option.map
    (fun value -> array_items value |> List.filter_map string_value)
    (optional_field worker "allowedTools")

let plan_active_tools worker facts =
  match optional_string_array worker "activeToolsSnapshot" with
  | Some tools -> Some tools
  | None ->
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
                  profile_name = get_string worker "definitionName";
                  depth;
                  filesystem_mode;
                  no_sandbox = get_bool worker "noSandbox";
                  subagent = get_bool worker "subagent";
                  profile;
                  system_prompt = get_string worker "agentSystemPrompt";
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

let completion_status completion =
  match optional_string_field completion "status" with
  | Some "failed" -> Taumel.Subagents.Run_failed
  | Some "cancelled" | Some "aborted" -> Taumel.Subagents.Run_cancelled
  | Some "timed_out" -> Taumel.Subagents.Run_timed_out
  | _ -> Taumel.Subagents.Run_completed

let agent_completion_message run status ?reason ?final_output () =
  let profile =
    match Taumel.Subagents.find_identity !agent_state run.Taumel.Subagents.run_agent_id with
    | Some identity -> identity.identity_profile_name
    | None -> "unknown"
  in
  let status = Taumel.Subagents.run_status_to_string status in
  let header =
    Printf.sprintf "Agent %s %s (%s, profile=%s)" run.run_agent_id status
      run.run_id profile
  in
  match final_output, reason with
  | Some output, _ -> header ^ "\n\n" ^ output
  | None, Some reason -> header ^ "\n\n" ^ reason
  | None, None -> header

let record_dispatch_completion params ctx =
  let prepared = Unsafe.get params "prepared" in
  let completion = Unsafe.get params "completion" in
  match Taumel.Shared.trim_non_empty (get_string prepared "run_id") with
  | None -> ok_obj [ ("ok", js_bool true) ]
  | Some run_id ->
      let status = completion_status completion in
      let reason =
        Option.bind (optional_string_field completion "reason")
          Taumel.Shared.trim_non_empty
      in
      let final_output =
        Option.bind (optional_string_field completion "finalOutput")
          Taumel.Shared.trim_non_empty
      in
      (match Taumel.Subagents.find_run !agent_state run_id with
      | Some run when not (Taumel.Subagents.active_run_status run.run_status) ->
          ok_obj [ ("ok", js_bool true); ("notify", js_bool false) ]
      | Some run when run.run_consumed ->
          ok_obj [ ("ok", js_bool true); ("notify", js_bool false) ]
      | _ -> (
          let previous_run = Taumel.Subagents.find_run !agent_state run_id in
          match
            Taumel.Subagents.record_run_completion !agent_state
              ~now:(now_seconds ()) ~run_id ~status ?reason ?final_output ()
          with
          | Error message -> error_obj message
          | Ok state ->
              agent_state := state;
              Session_sync.save_agent_state ctx;
              let fields = [ ("ok", js_bool true) ] in
              let fields =
                match previous_run with
                | None -> ("notify", js_bool false) :: fields
                | Some run ->
                    [
                      ("notify", js_bool true);
                      ("customType", js_string "taumel.agent.completion");
                      ( "content",
                        js_string
                          (agent_completion_message run status ?reason
                             ?final_output ()) );
                      ("display", js_bool true);
                      ("triggerTurn", js_bool true);
                      ("deliverAs", js_string "followUp");
                    ]
                    @ fields
              in
              ok_obj fields))

let record_child_session_start params ctx =
  let prepared = Unsafe.get params "prepared" in
  let bridge = Unsafe.get params "bridge" in
  let agent_id = get_string prepared "workerId" in
  let child_session_id =
    Option.bind (optional_string_field bridge "sessionId")
      Taumel.Shared.trim_non_empty
  in
  let active_tools = optional_string_array bridge "activeTools" in
  match
    Taumel.Subagents.record_child_session_start !agent_state ~agent_id
      ?child_session_id ?active_tools ()
  with
  | Error message -> error_obj message
  | Ok state ->
      agent_state := state;
      Session_sync.save_agent_state ctx;
      ok_obj [ ("ok", js_bool true) ]

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

let ensure_worker_for_send owner agent_id =
  match Taumel.Subagents.find_worker agent_id !workers with
  | Some _ -> Ok ()
  | None -> (
      match Taumel.Subagents.find_identity !agent_state agent_id with
      | None -> Error ("unknown agent: " ^ agent_id)
      | Some identity -> (
          match Taumel.Subagents.worker_of_identity_snapshot ~owner identity with
          | Error _ as error -> error
          | Ok worker ->
              workers := worker :: !workers;
              Ok ()))

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

let request_from_params name params =
  let workspace_roots = if state.cwd = "" then [] else [ state.cwd ] in
  let non_empty value = Option.bind value Taumel.Shared.trim_non_empty in
  let single_agent_id () =
    match optional_string_array params "agent_ids" with
    | Some [ id ] -> non_empty (Some id)
    | _ -> None
  in
  match name with
  | "agent_spawn" ->
      let requested_profile = non_empty (optional_string_field params "profile") in
      let default_id =
        Taumel.Subagents.default_agent_id !agent_state
          (Option.value requested_profile ~default:"agent")
      in
      Taumel.Subagents.request_of_values ~workspace_roots ~default_id
        ~action:"spawn"
        ?id:(non_empty (optional_string_field params "agent_id"))
        ?agent:requested_profile
        ?prompt:(non_empty (optional_string_field params "objective"))
        ?description:(non_empty (optional_string_field params "description"))
        ()
  | "agent_send" ->
      let default_id = Taumel.Subagents.default_worker_id !workers in
      Taumel.Subagents.request_of_values ~workspace_roots ~default_id
        ~action:"send"
        ?id:(non_empty (optional_string_field params "agent_id"))
        ?prompt:(non_empty (optional_string_field params "objective"))
        ~interrupt:(get_bool params "interrupt")
        ()
  | "agent_wait" ->
      let default_id = Taumel.Subagents.default_worker_id !workers in
      (match single_agent_id () with
      | Some id ->
          Taumel.Subagents.request_of_values ~workspace_roots ~default_id
            ~action:"wait" ~id ()
      | None -> Ok Taumel.Subagents.Wait_all)
  | "agent_close" ->
      let default_id = Taumel.Subagents.default_worker_id !workers in
      if get_bool params "all" then Ok Taumel.Subagents.Close_all
      else
        Taumel.Subagents.request_of_values ~workspace_roots ~default_id
          ~action:"close" ?id:(single_agent_id ()) ()
  | "agent_list" ->
      let default_id = Taumel.Subagents.default_worker_id !workers in
      Taumel.Subagents.request_of_values ~workspace_roots ~default_id
        ~action:"list" ()
  | _ -> Error ("tool executor is not connected yet: " ^ name)

let delivery_run_status = Option.map Taumel.Subagents.run_status_to_string

let render_plan ?delivery plan =
  match plan.Taumel.Subagents.worker with
  | Some worker ->
      (match delivery with
      | None ->
          let run_id =
            Option.map
              (fun (run : Taumel.Subagents.agent_run) -> run.run_id)
              (Taumel.Subagents.latest_run !agent_state worker.id)
          in
          result ?run_id ~action:plan.action ~prompt:plan.prompt
            ~message:plan.message worker
      | Some delivery ->
          result ~run_id:delivery.Taumel.Subagents.delivery_run_id
            ~submission_id:delivery.delivery_submission_id
            ~delivery_kind:delivery.delivery_kind
            ?previous_status:(delivery_run_status delivery.delivery_previous_status)
            ~action:plan.action ~prompt:plan.prompt ~message:plan.message worker)
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

let js_option_string = function
  | None -> inject Js.null
  | Some value -> js_string value

let js_option_int = function
  | None -> inject Js.null
  | Some value -> js_number (float_of_int value)

let run_elapsed_seconds ~now (run : Taumel.Subagents.agent_run) =
  let started =
    match run.run_started_at with
    | Some value -> value
    | None -> run.run_created_at
  in
  let ended =
    match run.run_completed_at with
    | Some value -> value
    | None -> now
  in
  max 0 (ended - started)

let js_run ~now (run : Taumel.Subagents.agent_run) =
  Unsafe.obj
    [|
      ("run_id", js_string run.run_id);
      ("agent_id", js_string run.run_agent_id);
      ("objective", js_string run.run_objective);
      ("description", js_option_string run.run_description);
      ("status", js_string (Taumel.Subagents.run_status_to_string run.run_status));
      ("reason", js_option_string run.run_reason);
      ("finalOutput", js_option_string run.run_final_output);
      ("consumed", js_bool run.run_consumed);
      ("createdAt", js_number (float_of_int run.run_created_at));
      ("startedAt", js_option_int run.run_started_at);
      ("completedAt", js_option_int run.run_completed_at);
      ("elapsedSeconds", js_number (float_of_int (run_elapsed_seconds ~now run)));
    |]

let js_agent_identity ~now state (identity : Taumel.Subagents.agent_identity) =
  let latest = Taumel.Subagents.latest_run state identity.identity_agent_id in
  Unsafe.obj
    [|
      ("agent_id", js_string identity.identity_agent_id);
      ("profile", js_string identity.identity_profile_name);
      ( "lifecycle",
        js_string
          (if Taumel.Subagents.identity_open identity then "open" else "closed") );
      ("child_session_id", js_option_string identity.identity_child_session_id);
      ("createdAt", js_number (float_of_int identity.identity_created_at));
      ("closedAt", js_option_int identity.identity_closed_at);
      ( "run_id",
        js_option_string
          (Option.map (fun (run : Taumel.Subagents.agent_run) -> run.run_id) latest)
      );
      ( "run_state",
        js_option_string
          (Option.map
             (fun (run : Taumel.Subagents.agent_run) ->
               Taumel.Subagents.run_status_to_string run.run_status)
             latest) );
      ( "latestRun",
        match latest with
        | None -> inject Js.null
        | Some run -> inject (js_run ~now run) );
    |]

let agent_identity_summary state identity =
  let lifecycle =
    if Taumel.Subagents.identity_open identity then "open" else "closed"
  in
  let run =
    match Taumel.Subagents.latest_run state identity.identity_agent_id with
    | None -> "no runs"
    | Some run ->
        run.run_id ^ " [" ^ Taumel.Subagents.run_status_to_string run.run_status ^ "]"
  in
  Printf.sprintf "%s [%s] profile=%s latest=%s" identity.identity_agent_id
    lifecycle identity.identity_profile_name run

let render_agent_list ~owner_id ~include_closed =
  let state = !agent_state in
  let now = now_seconds () in
  let identities =
    state.identities
    |> List.filter (fun (identity : Taumel.Subagents.agent_identity) ->
           identity.identity_parent_session_id = owner_id
           && (include_closed || Taumel.Subagents.identity_open identity))
  in
  let text =
    match identities with
    | [] -> "No agents."
    | identities ->
        String.concat "\n" (List.map (agent_identity_summary state) identities)
  in
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string text);
      ( "details",
        inject
          (Unsafe.obj
             [|
               ("ok", js_bool true);
               ( "agents",
                 js_array (List.map (js_agent_identity ~now state) identities) );
             |]) );
    ]

let js_wait_item (item : Taumel.Subagents.wait_item) =
  Unsafe.obj
    [|
      ("agent_id", js_string item.wait_agent_id);
      ("run_id", js_option_string item.wait_run_id);
      ("status", js_string item.wait_status);
      ("finalOutput", js_option_string item.wait_final_output);
      ("error", js_option_string item.wait_error);
      ("consumed", js_bool item.wait_consumed);
    |]

let parse_wait_selector params =
  let run_ids = optional_string_array params "run_ids" in
  let agent_ids = optional_string_array params "agent_ids" in
  match (run_ids, agent_ids) with
  | Some _, Some _ -> Error "agent_wait accepts exactly one selector kind"
  | Some [] , _ -> Error "agent_wait.run_ids must not be empty"
  | _, Some [] -> Error "agent_wait.agent_ids must not be empty"
  | Some run_ids, None -> Ok (Taumel.Subagents.Wait_run_ids run_ids)
  | None, Some agent_ids -> Ok (Taumel.Subagents.Wait_agent_ids agent_ids)
  | None, None -> Ok Taumel.Subagents.Wait_all_active

let render_agent_wait params owner_id ctx =
  match parse_wait_selector params with
  | Error message -> error_obj message
  | Ok selector ->
      let result =
        Taumel.Subagents.wait_for_selector !agent_state ~parent_session_id:owner_id
          selector
      in
      if result.wait_state <> !agent_state then (
        agent_state := result.wait_state;
        Session_sync.save_agent_state ctx);
      ok_obj
        [
          ("action", js_string "tool_result");
          ("text", js_string result.wait_message);
          ( "details",
            inject
              (Unsafe.obj
                 [|
                   ("ok", js_bool true);
                   ( "runs",
                     js_array (List.map js_wait_item result.wait_items) );
                   ("status", js_string (if result.wait_items = [] then "no_active_runs" else "ok"));
                 |]) );
        ]

let js_profile_spec state (profile : Taumel.Subagents.profile_spec) =
  let enabled =
    Taumel.Subagents.profile_enabled state profile.spec_name
  in
  Unsafe.obj
    [|
      ("name", js_string profile.spec_name);
      ("description", js_string profile.spec_description);
      ("enabled", js_bool enabled);
      ( "disabledReason",
        if enabled then inject Js.null
        else js_string "disabled for this session" );
      ("sandbox", js_string (Taumel.Subagents.sandbox_setting_to_summary profile.spec_sandbox));
      ("tools", js_string (Taumel.Subagents.tools_setting_to_summary profile.spec_tools));
    |]

let render_profiles () =
  let state = !agent_state in
  let catalog = !agent_catalog in
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string "Available agent profiles: smart, deep, rush, finder, librarian, oracle, painter, review");
      ( "details",
        inject
          (Unsafe.obj
             [|
               ("ok", js_bool true);
               ( "profiles",
                 js_array
                   (List.map (js_profile_spec state)
                      catalog.catalog_profiles) );
               ("errors", js_array (List.map js_string catalog.catalog_errors));
             |]) );
    ]

let js_delete_child_session_update id =
  Unsafe.obj
    [|
      ("action", js_string "delete_child_session");
      ("key", js_string id);
      ("reason", js_string "closed_by_parent");
    |]

let close_tool_result ids =
  let count = List.length ids in
  let text =
    Printf.sprintf "Closed %d agent%s." count
      (if count = 1 then "" else "s")
  in
  ok_obj
    [
      ("action", js_string "agent_close");
      ("text", js_string text);
      ( "details",
        inject
          (Unsafe.obj
             [|
               ("ok", js_bool true);
               ("agent_ids", js_array (List.map js_string ids));
               ("closedCount", js_number (float_of_int count));
               ( "childSessionUpdates",
                 js_array (List.map js_delete_child_session_update ids) );
             |]) );
    ]

let requested_close_ids params =
  match optional_string_array params "agent_ids" with
  | None -> Error "agent_close.agent_ids is required unless all is true"
  | Some ids ->
      let ids =
        ids
        |> List.filter_map Taumel.Shared.trim_non_empty
        |> List.sort_uniq String.compare
      in
      if ids = [] then Error "agent_close.agent_ids must not be empty"
      else Ok ids

let owned_open_agent_ids owner_id state =
  state.Taumel.Subagents.identities
  |> List.filter (fun (identity : Taumel.Subagents.agent_identity) ->
         identity.identity_parent_session_id = owner_id
         && Taumel.Subagents.identity_open identity)
  |> List.map (fun (identity : Taumel.Subagents.agent_identity) ->
         identity.identity_agent_id)

let validate_close_ids owner_id ids =
  let rec loop = function
    | [] -> Ok ()
    | id :: rest -> (
        match Taumel.Subagents.find_identity !agent_state id with
        | None -> Error ("unknown agent: " ^ id)
        | Some identity when identity.identity_parent_session_id <> owner_id ->
            Error ("agent is not owned by this session: " ^ id)
        | Some _ -> loop rest)
  in
  loop ids

let close_ids_in_state state ~now ids =
  let rec loop state = function
    | [] -> Ok state
    | id :: rest -> (
        match Taumel.Subagents.record_close state ~now ~agent_id:id with
        | Error _ as error -> error
        | Ok state -> loop state rest)
  in
  loop state ids

let close_live_workers owner_id ids =
  workers :=
    List.map
      (fun (worker : Taumel.Subagents.worker) ->
        if worker.parent_id = Some owner_id && List.mem worker.id ids then
          Taumel.Subagents.close worker
        else worker)
      !workers

let render_agent_close params (owner : Taumel.Subagents.owner) ctx now =
  let close_all = get_bool params "all" in
  let ids_result =
    if close_all then Ok (owned_open_agent_ids owner.id !agent_state)
    else requested_close_ids params
  in
  match ids_result with
  | Error message -> error_obj message
  | Ok ids -> (
      match validate_close_ids owner.id ids with
      | Error message -> error_obj message
      | Ok () -> (
          let state_result =
            if close_all then
              let state, _changed =
                Taumel.Subagents.record_close_all !agent_state ~now
                  ~parent_session_id:owner.id
              in
              Ok state
            else close_ids_in_state !agent_state ~now ids
          in
          match state_result with
          | Error message -> error_obj message
          | Ok state ->
              agent_state := state;
              Session_sync.save_agent_state ctx;
              close_live_workers owner.id ids;
              close_tool_result ids))

let prepare name params ctx =
  with_gateway_authorized name (fun _ ->
      let owner = current_owner ctx in
      let now = now_seconds () in
      let run_request request =
        match
          Taumel.Subagents.apply_request ~parent_profile:(active_profile ())
            ~owner !workers request
        with
        | Error message -> error_obj message
        | Ok plan ->
            let state_update =
              match request with
              | Taumel.Subagents.Spawn spawn ->
                  let profile_snapshot =
                    Option.map
                      (fun (worker : Taumel.Subagents.worker) -> worker.profile)
                      plan.worker
                  in
                  let sandbox_snapshot =
                    Option.map
                      (fun (worker : Taumel.Subagents.worker) -> worker.sandbox)
                      plan.worker
                  in
                  let system_prompt =
                    match plan.worker with
                    | None -> ""
                    | Some worker -> worker.system_prompt
                  in
                  Result.map
                    (fun (delivery : Taumel.Subagents.submission_delivery) ->
                      (Some delivery.delivery_state, Some delivery))
                    (Taumel.Subagents.record_spawn !agent_state ~now
                       ~parent_session_id:owner.id ~agent_id:spawn.id
                       ~profile_name:spawn.name ?profile_snapshot
                       ?sandbox_snapshot ~system_prompt
                       ?description:spawn.description spawn.prompt)
              | Taumel.Subagents.Send send ->
                  Result.map
                    (fun (delivery : Taumel.Subagents.submission_delivery) ->
                      (Some delivery.delivery_state, Some delivery))
                    (Taumel.Subagents.record_send !agent_state ~now
                       ~agent_id:send.id ~interrupt:send.interrupt send.prompt)
              | Taumel.Subagents.Close close ->
                  Result.map
                    (fun state -> (Some state, None))
                    (Taumel.Subagents.record_close !agent_state ~now
                       ~agent_id:close.id)
              | Taumel.Subagents.Close_all ->
                  let next, changed =
                    Taumel.Subagents.record_close_all !agent_state ~now
                      ~parent_session_id:owner.id
                  in
                  Ok ((if changed then Some next else None), None)
              | Taumel.Subagents.Wait _ | Taumel.Subagents.Wait_all
              | Taumel.Subagents.List ->
                  Ok (None, None)
            in
            (match state_update with
            | Error message -> error_obj message
            | Ok (next_state, delivery) ->
                if plan.changed then workers := plan.workers;
                (match next_state with
                | None -> ()
                | Some state ->
                    agent_state := state;
                    Session_sync.save_agent_state ctx);
                render_plan ?delivery plan)
      in
      if name = "agent_wait" then render_agent_wait params owner.id ctx
      else if name = "agent_close" then render_agent_close params owner ctx now
      else
      match if name = "agent_profiles" then Ok Taumel.Subagents.List else request_from_params name params with
      | Error message -> error_obj message
      | Ok Taumel.Subagents.List when name = "agent_profiles" -> render_profiles ()
      | Ok Taumel.Subagents.List when name = "agent_list" ->
          render_agent_list ~owner_id:owner.id
            ~include_closed:(get_bool params "include_closed")
      | Ok (Taumel.Subagents.Spawn request) -> (
          let catalog = !agent_catalog in
          match catalog.catalog_errors with
          | error :: _ -> error_obj ("agent profile catalog is invalid: " ^ error)
          | [] -> (
              match Taumel.Subagents.find_profile_spec catalog request.name with
              | None -> error_obj ("unknown agent profile: " ^ request.name)
              | Some spec
                when not
                       (Taumel.Subagents.profile_enabled !agent_state
                          request.name) ->
                  error_obj
                    ("agent profile is disabled for this session: "
                   ^ request.name ^ "; enable it with /agents enable "
                   ^ request.name)
              | Some spec
                when Taumel.Subagents.agent_id_used !agent_state request.id ->
                  error_obj
                    ("agent id was already used in this session: " ^ request.id)
      | Some spec ->
          run_request
            (Taumel.Subagents.Spawn
               (Taumel.Subagents.spawn_request_with_profile spec request))))
      | Ok (Taumel.Subagents.Send send as request) -> (
          match ensure_worker_for_send owner send.id with
          | Error message -> error_obj message
          | Ok () -> run_request request)
      | Ok request -> run_request request)

let command_result ?details message =
  let fields =
    [
      ("action", js_string "command_result");
      ("message", js_string message);
    ]
  in
  let fields =
    match details with
    | None -> fields
    | Some details -> fields @ [ ("details", inject details) ]
  in
  ok_obj fields

let js_agent_menu_option ~label ~value ~description ~selected =
  Unsafe.obj
    [|
      ("label", js_string label);
      ("value", js_string value);
      ("description", js_string description);
      ("selected", js_bool selected);
    |]

let js_child_session_update ?reason action key =
  let fields = [ ("action", js_string action); ("key", js_string key) ] in
  let fields =
    match reason with
    | None -> fields
    | Some reason -> fields @ [ ("reason", js_string reason) ]
  in
  Unsafe.obj (Array.of_list fields)

let child_session_updates_details updates =
  Unsafe.obj
    [| ("childSessionUpdates", js_array updates) |]

let profiles_summary () =
  (!agent_catalog).catalog_profiles
  |> List.map (fun (profile : Taumel.Subagents.profile_spec) ->
         let status =
           if Taumel.Subagents.profile_enabled !agent_state profile.spec_name then
             "enabled"
           else "disabled"
         in
         profile.spec_name ^ " [" ^ status ^ "] - " ^ profile.spec_description)
  |> String.concat "\n"

let profiles_details () =
  Unsafe.obj
    [|
      ( "profiles",
        js_array
          (List.map (js_profile_spec !agent_state)
             (!agent_catalog).catalog_profiles) );
    |]

let agent_menu_options () =
  (!agent_catalog).catalog_profiles
  |> List.map (fun (profile : Taumel.Subagents.profile_spec) ->
         let enabled =
           Taumel.Subagents.profile_enabled !agent_state profile.spec_name
         in
         let verb = if enabled then "Disable" else "Enable" in
         let command = if enabled then "disable " else "enable " in
         js_agent_menu_option
           ~label:(verb ^ " " ^ profile.spec_name ^ " - " ^ profile.spec_description)
           ~value:(command ^ profile.spec_name)
           ~description:profile.spec_description ~selected:enabled)

let agents_prompt_result () =
  ok_obj
    [
      ("action", js_string "agents_prompt");
      ("title", js_string "Taumel agent profiles");
      ("message", js_string (profiles_summary ()));
      ("options", js_array (List.map inject (agent_menu_options ())));
    ]

let handle_agents_command args ctx =
  let command, rest = Command_util.split_command args in
  match command with
  | "" -> agents_prompt_result ()
  | "list" -> command_result ~details:(profiles_details ()) (profiles_summary ())
  | "enable" | "disable" ->
      let profile = String.trim rest in
      let enabled = command = "enable" in
      (match
         Taumel.Subagents.set_profile_enabled ~catalog:!agent_catalog !agent_state
           profile enabled
       with
      | Error message -> error_obj message
      | Ok next ->
          agent_state := next;
          Session_sync.save_agent_state ctx;
          command_result ~details:(profiles_details ())
            (Printf.sprintf "Agent profile %s %s." profile
               (if enabled then "enabled" else "disabled")))
  | _ ->
      error_obj
        "usage: /agents [list|enable <profile>|disable <profile>]"

let finish_agents_prompt prompt selection ctx =
  match get_string selection "status" with
  | "cancelled" ->
      command_result ~details:(Unsafe.obj [| ("cancelled", js_bool true) |])
        "Agent profiles unchanged."
  | "unavailable" ->
      command_result ~details:(Unsafe.obj [| ("unavailable", js_bool true) |])
        (get_string prompt "message")
  | _ -> (
      let options = get_object_array prompt "options" in
      let selected = get_string selection "selected" in
      match
        List.find_map
          (fun option ->
            if get_string option "label" = selected then Some (get_string option "value")
            else None)
          options
      with
      | None -> error_obj "Invalid agent profile selection."
      | Some value -> handle_agents_command value ctx)

let plan_agents_prompt prompt facts =
  if not (get_bool facts "uiAvailable") then
    ok_obj
      [
        ("action", js_string "result");
        ( "result",
          finish_agents_prompt prompt
            (Unsafe.obj [| ("status", js_string "unavailable") |])
            (Unsafe.obj [||]) );
      ]
  else
    let labels =
      get_object_array prompt "options" |> List.map (fun option -> get_string option "label")
    in
    ok_obj
      [
        ("action", js_string "select");
        ("title", js_string (get_string prompt "title"));
        ("labels", js_array (List.map js_string labels));
      ]

let worker_list_summary workers =
  match workers with
  | [] -> "No agents."
  | workers -> String.concat "\n" (List.map summary workers)

let owned_identities owner_id =
  !agent_state.Taumel.Subagents.identities
  |> List.filter (fun (identity : Taumel.Subagents.agent_identity) ->
         identity.identity_parent_session_id = owner_id)

let agent_run_identities ?(include_closed = false) owner_id =
  owned_identities owner_id
  |> List.filter (fun identity ->
         include_closed || Taumel.Subagents.identity_open identity)

let agent_runs_summary ?(include_closed = false) owner_id =
  match agent_run_identities ~include_closed owner_id with
  | [] -> "No agents."
  | identities ->
      String.concat "\n"
        (List.map (agent_identity_summary !agent_state) identities)

let latest_run_status state identity =
  Option.map
    (fun (run : Taumel.Subagents.agent_run) ->
      Taumel.Subagents.run_status_to_string run.run_status)
    (Taumel.Subagents.latest_run state identity.Taumel.Subagents.identity_agent_id)

let agent_run_menu_options owner_id =
  let state = !agent_state in
  owned_identities owner_id
  |> List.filter Taumel.Subagents.identity_open
  |> List.concat_map (fun (identity : Taumel.Subagents.agent_identity) ->
         let agent_id = identity.identity_agent_id in
         let profile = identity.identity_profile_name in
         let latest = Taumel.Subagents.latest_run state agent_id in
         let latest_status =
           latest_run_status state identity |> Option.value ~default:"no runs"
         in
         let description =
           "profile=" ^ profile ^ " latest=" ^ latest_status
         in
         let stop =
           match latest with
           | Some run when Taumel.Subagents.active_run_status run.run_status ->
               [
                 js_agent_menu_option
                   ~label:("Stop " ^ agent_id ^ " - " ^ description)
                   ~value:("stop " ^ agent_id) ~description ~selected:false;
               ]
           | _ -> []
         in
         let output =
           match latest with
           | Some _ ->
               [
                 js_agent_menu_option
                   ~label:("Output " ^ agent_id ^ " - " ^ description)
                   ~value:("output " ^ agent_id) ~description ~selected:false;
               ]
           | None -> []
         in
         let close =
           [
             js_agent_menu_option
               ~label:("Close " ^ agent_id ^ " - " ^ description)
               ~value:("close " ^ agent_id) ~description ~selected:false;
           ]
         in
         stop @ output @ close)

let agent_runs_prompt_result owner_id =
  let closed_history =
    if
      List.exists
        (fun identity -> not (Taumel.Subagents.identity_open identity))
        (owned_identities owner_id)
    then
      [
        js_agent_menu_option ~label:"Show closed history" ~value:"list all"
          ~description:"Include closed agent identities." ~selected:false;
      ]
    else []
  in
  ok_obj
    [
      ("action", js_string "agent_runs_prompt");
      ("title", js_string "Taumel agent runs");
      ("message", js_string (agent_runs_summary owner_id));
      ( "options",
        js_array
          (List.map inject (agent_run_menu_options owner_id @ closed_history)) );
    ]

let handle_agent_runs_command args ctx =
  let command, rest = Command_util.split_command args in
  let owner = current_owner ctx in
  match command with
  | "" -> agent_runs_prompt_result owner.id
  | "list" ->
      command_result
        (agent_runs_summary
           ~include_closed:(String.trim rest = "all" || String.trim rest = "closed")
           owner.id)
  | "close" when String.trim rest = "all" ->
      let closing_ids =
        owned_identities owner.id
        |> List.filter Taumel.Subagents.identity_open
        |> List.map (fun (identity : Taumel.Subagents.agent_identity) ->
               identity.identity_agent_id)
      in
      let closing_count = List.length closing_ids in
      let state, state_changed =
        Taumel.Subagents.record_close_all !agent_state ~now:(now_seconds ())
          ~parent_session_id:owner.id
      in
      if state_changed then (
        agent_state := state;
        Session_sync.save_agent_state ctx);
      workers :=
        List.map
          (fun (worker : Taumel.Subagents.worker) ->
            if List.mem worker.id closing_ids then
              Taumel.Subagents.close worker
            else worker)
          !workers;
      command_result
        ~details:
          (child_session_updates_details
             (List.map
                (js_child_session_update ~reason:"closed_by_parent"
                   "delete_child_session")
                closing_ids))
        (Printf.sprintf "Closed %d agent%s." closing_count
           (if closing_count = 1 then "" else "s"))
  | "close" -> (
      let id = String.trim rest in
      match Taumel.Subagents.find_identity !agent_state id with
      | Some identity when identity.identity_parent_session_id <> owner.id ->
          error_obj ("agent is not owned by this session: " ^ id)
      | _ -> (
      match
        Taumel.Subagents.record_close !agent_state ~now:(now_seconds ())
          ~agent_id:id
      with
      | Error message -> error_obj message
      | Ok state ->
          agent_state := state;
          Session_sync.save_agent_state ctx;
          (match Taumel.Subagents.find_worker id !workers with
          | Some worker when worker.parent_id = Some owner.id ->
              workers :=
                Taumel.Subagents.replace_worker (Taumel.Subagents.close worker)
                  !workers
          | _ -> ());
          command_result
            ~details:
              (child_session_updates_details
                 [
                   js_child_session_update ~reason:"closed_by_parent"
                     "delete_child_session" id;
                 ])
            ("Closed " ^ id ^ ".")
      ))
  | "stop" when String.trim rest = "all" ->
      let stop_ids =
        !agent_state.runs
        |> List.filter (fun (run : Taumel.Subagents.agent_run) ->
               Taumel.Subagents.active_run_status run.run_status
               && Taumel.Subagents.run_owned_by_parent !agent_state
                    ~parent_session_id:owner.id run)
        |> List.map (fun (run : Taumel.Subagents.agent_run) -> run.run_agent_id)
        |> List.sort_uniq String.compare
      in
      let state, changed =
        Taumel.Subagents.record_stop_all !agent_state ~now:(now_seconds ())
          ~parent_session_id:owner.id
      in
      if changed then (
        agent_state := state;
        Session_sync.save_agent_state ctx);
      command_result
        ~details:
          (child_session_updates_details
             (if changed then
                List.map
                  (js_child_session_update ~reason:"stopped_by_parent"
                     "stop_child_session")
                  stop_ids
              else []))
        (if changed then "Stopped active agent runs."
         else "No active agent runs to stop.")
  | "stop" -> (
      let target = String.trim rest in
      let state_result =
        match Taumel.Subagents.find_run !agent_state target with
        | Some run
          when Taumel.Subagents.run_owned_by_parent !agent_state
                 ~parent_session_id:owner.id run ->
            Result.map
              (fun value ->
                ( value,
                  if Taumel.Subagents.active_run_status run.run_status then
                    [ run.run_agent_id ]
                  else [] ))
              (Taumel.Subagents.record_stop_run !agent_state
                 ~now:(now_seconds ()) ~run_id:target)
        | Some run ->
            Error ("run is not owned by this session: " ^ run.run_id)
        | None -> (
            match Taumel.Subagents.find_identity !agent_state target with
            | Some identity when identity.identity_parent_session_id <> owner.id ->
                Error ("agent is not owned by this session: " ^ target)
            | _ ->
                let stop_ids =
                  match Taumel.Subagents.active_run !agent_state target with
                  | Some _ -> [ target ]
                  | None -> []
                in
                Result.map
                  (fun value -> (value, stop_ids))
                  (Taumel.Subagents.record_stop_agent !agent_state
                     ~now:(now_seconds ()) ~agent_id:target))
      in
      match state_result with
      | Error message -> error_obj message
      | Ok ((state, changed), stop_ids) ->
          if changed then (
            agent_state := state;
            Session_sync.save_agent_state ctx);
          command_result
            ~details:
              (child_session_updates_details
                 (if changed then
                    List.map
                      (js_child_session_update ~reason:"stopped_by_parent"
                         "stop_child_session")
                      stop_ids
                  else []))
            (if changed then "Stopped " ^ target ^ "."
             else "No active run for " ^ target ^ "."))
  | "output" -> (
      match
        Taumel.Subagents.output_run_for_target !agent_state
          ~parent_session_id:owner.id rest
      with
      | Error message -> error_obj message
      | Ok run ->
          let output =
            match run.run_final_output with
            | Some output when String.trim output <> "" -> output
            | _ ->
                Printf.sprintf "No final output for %s [%s]." run.run_id
                  (Taumel.Subagents.run_status_to_string run.run_status)
          in
          command_result
            ~details:(Unsafe.obj [| ("run", inject (js_run ~now:(now_seconds ()) run)) |])
            output)
  | _ ->
      error_obj
        "usage: /agent-runs [list|close <agent-id|all>|stop <agent-id|run-id|all>|output <agent-id|run-id>]"

let finish_agent_runs_prompt prompt selection ctx =
  match get_string selection "status" with
  | "cancelled" ->
      command_result ~details:(Unsafe.obj [| ("cancelled", js_bool true) |])
        "Agent runs unchanged."
  | "unavailable" ->
      command_result ~details:(Unsafe.obj [| ("unavailable", js_bool true) |])
        (get_string prompt "message")
  | _ -> (
      let options = get_object_array prompt "options" in
      let selected = get_string selection "selected" in
      match
        List.find_map
          (fun option ->
            if get_string option "label" = selected then Some (get_string option "value")
            else None)
          options
      with
      | None -> error_obj "Invalid agent run selection."
      | Some value -> handle_agent_runs_command value ctx)

let plan_agent_runs_prompt prompt facts =
  let labels =
    get_object_array prompt "options" |> List.map (fun option -> get_string option "label")
  in
  if (not (get_bool facts "uiAvailable")) || labels = [] then
    ok_obj
      [
        ("action", js_string "result");
        ( "result",
          finish_agent_runs_prompt prompt
            (Unsafe.obj [| ("status", js_string "unavailable") |])
            (Unsafe.obj [||]) );
      ]
  else
    ok_obj
      [
        ("action", js_string "select");
        ("title", js_string (get_string prompt "title"));
        ("labels", js_array (List.map js_string labels));
      ]

let parse_override_inherit_string path value =
  match Taumel.Shared.trim_non_empty value with
  | None -> Error (path ^ " is required")
  | Some "inherit" -> Ok Taumel.Subagents.Inherit_string
  | Some value -> Ok (Taumel.Subagents.Concrete_string value)

let parse_override_field path obj name =
  parse_override_inherit_string (path ^ "." ^ name) (get_string obj name)

let parse_builtin_override name override =
  let path = "taumel.agents.builtins." ^ name in
  if not (is_js_object override) then Error (path ^ " must be an object")
  else
    let ( let* ) = Result.bind in
    let* provider = parse_override_field path override "provider" in
    let* model_ = parse_override_field path override "model" in
    let* thinking = parse_override_field path override "thinking" in
    Ok
      {
        Taumel.Subagents.override_name = String.trim name;
        override_provider = provider;
        override_model = model_;
        override_thinking = thinking;
      }

let parse_builtin_overrides facts =
  match optional_field facts "builtinOverrides" with
  | None -> ([], [])
  | Some builtins when not (is_js_object builtins) ->
      ([], [ "taumel.agents.builtins must be an object" ])
  | Some builtins ->
      object_keys builtins
      |> List.fold_left
           (fun (overrides, errors) name ->
             let override = Unsafe.get builtins name in
             match parse_builtin_override name override with
             | Ok override -> (override :: overrides, errors)
             | Error message -> (overrides, message :: errors))
           ([], [])
      |> fun (overrides, errors) -> (List.rev overrides, List.rev errors)

let refresh_profile_catalog facts =
  let live_tools = get_string_array facts "liveTools" in
  let profile_files = get_object_array facts "profiles" in
  let builtin_overrides, override_parse_errors = parse_builtin_overrides facts in
  let parsed, parse_errors =
    List.fold_left
      (fun (profiles, errors) file ->
        let path = get_string file "path" in
        let text = get_string file "text" in
        match Taumel.Subagents.parse_markdown_profile ~path text with
        | Ok profile -> (profile :: profiles, errors)
        | Error message -> (profiles, message :: errors))
      ([], []) profile_files
  in
  let catalog =
    Taumel.Subagents.build_profile_catalog ~builtin_overrides ~live_tools
      (List.rev parsed)
  in
  let errors =
    override_parse_errors @ List.rev parse_errors @ catalog.catalog_errors
  in
  let catalog = { catalog with Taumel.Subagents.catalog_errors = errors } in
  agent_catalog := catalog;
  ok_obj
    [
      ("valid", js_bool (errors = []));
      ("errors", js_array (List.map js_string errors));
      ("profileCount", js_number (float_of_int (List.length catalog.catalog_profiles)));
    ]
