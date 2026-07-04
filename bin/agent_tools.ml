open Jsoo_bridge
open App_state
open Runtime_access
open Agent_render
open Agent_notifications

let finish_action = Agent_notifications.finish_action
let record_dispatch_completion = Agent_notifications.record_dispatch_completion
let record_background_notification = Agent_notifications.record_background_notification
let record_child_session_start = Agent_notifications.record_child_session_start
let record_active_tools_snapshot = Agent_notifications.record_active_tools_snapshot
let plan_bridge_update = Agent_notifications.plan_bridge_update

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
      let initial_goal_objective =
        if optional_string_field details "runInitialSubmissionKind" = Some "objective"
        then Taumel.Shared.trim_non_empty (get_string prepared "prompt")
        else None
      in
      match
        Taumel.Subagents.plan_child_session_spawn_from_input
          ?initial_goal_objective ~prompt:(get_string prepared "prompt") input
      with
      | Error message -> error_obj message
      | Ok plan ->
          ok_obj
            [
              ("workerId", js_string plan.worker_id);
              ("prompt", js_string plan.prompt);
              ("metadata", json_to_js plan.metadata);
            ])

let find_worker_for_parent ~parent_id id =
  Taumel.Subagents.find_worker_for_parent ~parent_id id !workers

let ensure_worker_for_send (owner : Taumel.Subagents.owner) agent_id =
  match Taumel.Subagents.find_worker_for_parent ~parent_id:owner.id agent_id !workers with
  | Some _ -> Ok ()
  | None -> (
      match Taumel.Agent_runs.find_identity !agent_state agent_id with
      | None -> Error ("unknown agent: " ^ agent_id)
      | Some identity -> (
          match Taumel.Agent_runs.worker_of_identity_snapshot ~owner identity with
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
            match
              Option.bind
                (Option.bind (optional_string_field data "parentSessionId")
                   Taumel.Shared.trim_non_empty)
                (fun parent_id -> find_worker_for_parent ~parent_id worker_id)
            with
            | Some worker -> worker.depth
            | None -> 1
        in
        { id = worker_id; is_subagent = true; depth }
  | _ -> root_owner ()

let pending_agent_notifications ctx =
  Session_sync.sync_persisted_session ctx;
  let owner = current_owner ctx in
  let pending =
    List.filter
      (fun (run : Taumel.Agent_runs.agent_run) ->
        notifiable_terminal_run run
        && Taumel.Agent_runs.run_owned_by_parent !agent_state
             ~parent_session_id:owner.id run)
      !agent_state.runs
  in
  let notification (run : Taumel.Agent_runs.agent_run) =
    let content =
      agent_completion_message run run.run_status ?reason:run.run_reason
        ?final_output:run.run_final_output ()
    in
    Unsafe.obj
      [|
        ("run_id", js_string run.run_id);
        ("customType", js_string "taumel.notification");
        ("content", js_string content);
        ("display", js_bool true);
      |]
  in
  ok_obj [ ("notifications", js_array (List.map notification pending)) ]

let request_from_params (owner : Taumel.Subagents.owner) name params =
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
        Taumel.Agent_runs.default_agent_id ~scope:owner.id !agent_state
          (Option.value requested_profile ~default:"agent")
      in
      Taumel.Subagents.request_of_values ~workspace_roots ~default_id
        ~action:"spawn"
        ?agent:requested_profile
        ?prompt:(non_empty (optional_string_field params "message"))
        ~create_goal:(get_bool params "create_goal")
        ()
  | "agent_send" ->
      let default_id = Taumel.Subagents.default_worker_id !workers in
      Taumel.Subagents.request_of_values ~workspace_roots ~default_id
        ~action:"send"
        ?id:(non_empty (optional_string_field params "agent_id"))
        ?prompt:(non_empty (optional_string_field params "message"))
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

let prepare name params ctx =
  Session_sync.sync_persisted_session ctx;
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
                    (fun (delivery : Taumel.Agent_runs.submission_delivery) ->
                      (Some delivery.delivery_state, Some delivery))
                    (Taumel.Agent_runs.record_spawn !agent_state ~now
                       ~parent_session_id:owner.id ~agent_id:spawn.id
                       ~profile_name:spawn.name ?profile_snapshot
                       ?sandbox_snapshot ~system_prompt
                       ~create_goal:spawn.create_goal spawn.prompt)
              | Taumel.Subagents.Send send ->
                  Result.map
                    (fun (delivery : Taumel.Agent_runs.submission_delivery) ->
                      (Some delivery.delivery_state, Some delivery))
                    (Taumel.Agent_runs.record_send !agent_state ~now
                       ~agent_id:send.id ~interrupt:send.interrupt send.prompt)
              | Taumel.Subagents.Close close ->
                  Result.map
                    (fun state -> (Some state, None))
                    (Taumel.Agent_runs.record_close !agent_state ~now
                       ~agent_id:close.id)
              | Taumel.Subagents.Close_all ->
                  let next, changed =
                    Taumel.Agent_runs.record_close_all !agent_state ~now
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
      match if name = "agent_profiles" then Ok Taumel.Subagents.List else request_from_params owner name params with
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
              match Taumel.Agent_profiles.find_profile_spec catalog request.name with
              | None -> error_obj ("unknown agent profile: " ^ request.name)
              | Some spec
                when Taumel.Agent_runs.agent_id_used !agent_state request.id ->
                  error_obj
                    ("agent id was already used in this session: " ^ request.id)
      | Some spec ->
          run_request
            (Taumel.Subagents.Spawn
               (Taumel.Agent_profiles.spawn_request_with_profile spec request))))
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

let child_session_updates_details updates =
  Unsafe.obj
    [| ("childSessionUpdates", js_array updates) |]

let profiles_summary () =
  (!agent_catalog).catalog_profiles
  |> List.map (fun (profile : Taumel.Agent_profiles.profile_spec) ->
         let status =
           if profile_visibility_enabled profile then "enabled" else "disabled"
         in
         profile.spec_name ^ " [" ^ status ^ "] - " ^ profile.spec_description)
  |> String.concat "\n"

let profiles_details () =
  Unsafe.obj
    [|
      ( "profiles",
        js_array (List.map js_profile_spec (!agent_catalog).catalog_profiles) );
    |]

let agent_menu_options () =
  (!agent_catalog).catalog_profiles
  |> List.map (fun (profile : Taumel.Agent_profiles.profile_spec) ->
         let enabled = profile_visibility_enabled profile in
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
         Taumel.Agent_runs.set_profile_enabled ~catalog:!agent_catalog !agent_state
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
  !agent_state.Taumel.Agent_runs.identities
  |> List.filter (fun (identity : Taumel.Agent_runs.agent_identity) ->
         identity.identity_parent_session_id = owner_id)

let agent_run_identities ?(include_closed = false) owner_id =
  owned_identities owner_id
  |> List.filter (fun identity ->
         include_closed || Taumel.Agent_runs.identity_open identity)

let agent_runs_summary ?(include_closed = false) owner_id =
  match agent_run_identities ~include_closed owner_id with
  | [] -> "No agents."
  | identities ->
      let now = now_seconds () in
      String.concat "\n"
        (List.map (agent_identity_summary ~now !agent_state) identities)

let latest_run_status state identity =
  Option.map
    (fun (run : Taumel.Agent_runs.agent_run) ->
      Taumel.Agent_runs.run_status_to_string run.run_status)
    (Taumel.Agent_runs.latest_run state identity.Taumel.Agent_runs.identity_agent_id)

let agent_run_menu_options owner_id =
  let state = !agent_state in
  owned_identities owner_id
  |> List.filter Taumel.Agent_runs.identity_open
  |> List.concat_map (fun (identity : Taumel.Agent_runs.agent_identity) ->
         let agent_id = identity.identity_agent_id in
         let profile = identity.identity_profile_name in
         let latest = Taumel.Agent_runs.latest_run state agent_id in
         let latest_status =
           latest_run_status state identity |> Option.value ~default:"no runs"
         in
         let description =
           "profile=" ^ profile ^ " latest=" ^ latest_status
         in
         let stop =
           match latest with
           | Some run when Taumel.Agent_runs.active_run_status run.run_status ->
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
        (fun identity -> not (Taumel.Agent_runs.identity_open identity))
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
        |> List.filter Taumel.Agent_runs.identity_open
        |> List.map (fun (identity : Taumel.Agent_runs.agent_identity) ->
               identity.identity_agent_id)
      in
      let closing_count = List.length closing_ids in
      let state, state_changed =
        Taumel.Agent_runs.record_close_all !agent_state ~now:(now_seconds ())
          ~parent_session_id:owner.id
      in
      if state_changed then (
        agent_state := state;
        Session_sync.save_agent_state ctx);
      workers :=
        List.map
          (fun (worker : Taumel.Subagents.worker) ->
            if worker.parent_id = Some owner.id && List.mem worker.id closing_ids then
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
      match Taumel.Agent_runs.find_identity !agent_state id with
      | Some identity when identity.identity_parent_session_id <> owner.id ->
          error_obj ("agent is not owned by this session: " ^ id)
      | _ -> (
      match
        Taumel.Agent_runs.record_close !agent_state ~now:(now_seconds ())
          ~agent_id:id
      with
      | Error message -> error_obj message
      | Ok state ->
          agent_state := state;
          Session_sync.save_agent_state ctx;
          (match
             Taumel.Subagents.find_worker_for_parent ~parent_id:owner.id id
               !workers
           with
          | Some worker ->
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
        |> List.filter (fun (run : Taumel.Agent_runs.agent_run) ->
               Taumel.Agent_runs.active_run_status run.run_status
               && Taumel.Agent_runs.run_owned_by_parent !agent_state
                    ~parent_session_id:owner.id run)
        |> List.map (fun (run : Taumel.Agent_runs.agent_run) -> run.run_agent_id)
        |> List.sort_uniq String.compare
      in
      let state, changed =
        Taumel.Agent_runs.record_stop_all !agent_state ~now:(now_seconds ())
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
        match Taumel.Agent_runs.find_run !agent_state target with
        | Some run
          when Taumel.Agent_runs.run_owned_by_parent !agent_state
                 ~parent_session_id:owner.id run ->
            Result.map
              (fun value ->
                ( value,
                  if Taumel.Agent_runs.active_run_status run.run_status then
                    [ run.run_agent_id ]
                  else [] ))
              (Taumel.Agent_runs.record_stop_run !agent_state
                 ~now:(now_seconds ()) ~run_id:target)
        | Some run ->
            Error ("run is not owned by this session: " ^ run.run_id)
        | None -> (
            match Taumel.Agent_runs.find_identity !agent_state target with
            | Some identity when identity.identity_parent_session_id <> owner.id ->
                Error ("agent is not owned by this session: " ^ target)
            | _ ->
                let stop_ids =
                  match Taumel.Agent_runs.active_run !agent_state target with
                  | Some _ -> [ target ]
                  | None -> []
                in
                Result.map
                  (fun value -> (value, stop_ids))
                  (Taumel.Agent_runs.record_stop_agent !agent_state
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
        Taumel.Agent_runs.output_run_for_target !agent_state
          ~parent_session_id:owner.id rest
      with
      | Error message -> error_obj message
      | Ok run ->
          let output =
            match run.run_final_output with
            | Some output when String.trim output <> "" -> output
            | _ ->
                Printf.sprintf "No final output for %s [%s]." run.run_id
                  (Taumel.Agent_runs.run_status_to_string run.run_status)
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
  | Some "inherit" -> Ok Taumel.Agent_profiles.Inherit_string
  | Some value -> Ok (Taumel.Agent_profiles.Concrete_string value)

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
        Taumel.Agent_profiles.override_name = String.trim name;
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
        match Taumel.Agent_profiles.parse_markdown_profile ~path text with
        | Ok profile -> (profile :: profiles, errors)
        | Error message -> (profiles, message :: errors))
      ([], []) profile_files
  in
  let catalog =
    Taumel.Agent_profiles.build_profile_catalog ~builtin_overrides ~live_tools
      (List.rev parsed)
  in
  let errors =
    override_parse_errors @ List.rev parse_errors @ catalog.catalog_errors
  in
  let catalog = { catalog with Taumel.Agent_profiles.catalog_errors = errors } in
  agent_catalog := catalog;
  ok_obj
    [
      ("valid", js_bool (errors = []));
      ("errors", js_array (List.map js_string errors));
      ("profileCount", js_number (float_of_int (List.length catalog.catalog_profiles)));
    ]
