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
      ( "workspaceDirectory",
        match worker.sandbox.workspace_roots with
        | root :: _ -> js_string root
        | [] -> Unsafe.inject Js.null );
      ("allowedTools", allowed_tools);
      ( "activeToolsSnapshot",
        match worker.active_tools_snapshot with
        | None -> Unsafe.inject Js.null
        | Some tools -> js_array (List.map js_string tools) );
    |]

let summary (worker : Taumel.Subagents.worker) =
  Taumel.Subagents.summary worker

let xml_attr value =
  let buffer = Buffer.create (String.length value) in
  String.iter
    (function
      | '&' -> Buffer.add_string buffer "&amp;"
      | '"' -> Buffer.add_string buffer "&quot;"
      | '<' -> Buffer.add_string buffer "&lt;"
      | '>' -> Buffer.add_string buffer "&gt;"
      | c -> Buffer.add_char buffer c)
    value;
  Buffer.contents buffer

let xml_agent_line ?(lifecycle = "open") ?sandbox ?workspace agent_id profile =
  let sandbox =
    match sandbox with
    | None -> ""
    | Some value -> Printf.sprintf " sandbox=\"%s\"" (xml_attr value)
  in
  let workspace =
    match workspace with
    | None -> ""
    | Some value -> Printf.sprintf " workspace=\"%s\"" (xml_attr value)
  in
  Printf.sprintf "  <agent id=\"%s\" profile=\"%s\" lifecycle=\"%s\"%s%s />"
    (xml_attr agent_id) (xml_attr profile) (xml_attr lifecycle) sandbox workspace

let xml_run_line ?elapsed ?reason run_id status =
  let elapsed =
    match elapsed with
    | None -> ""
    | Some value -> Printf.sprintf " elapsed_seconds=\"%d\"" value
  in
  let reason =
    match reason with
    | None -> ""
    | Some value -> Printf.sprintf " reason=\"%s\"" (xml_attr value)
  in
  Printf.sprintf "  <run id=\"%s\" status=\"%s\"%s%s />" (xml_attr run_id)
    (xml_attr status) elapsed reason

let js_child_session_update ?reason action key =
  let fields = [ ("action", js_string action); ("key", js_string key) ] in
  let fields =
    match reason with
    | None -> fields
    | Some reason -> fields @ [ ("reason", js_string reason) ]
  in
  Unsafe.obj (Array.of_list fields)

let result ?run_id ?submission_id ?delivery_kind ?previous_status
    ?dispatch_deliver_as ?(child_session_updates = [])
    ?(action = "tool_result") ?(message = "") ?(prompt = "")
    (worker : Taumel.Subagents.worker) =
  let no_active_run = delivery_kind = Some "no_active_run" in
  let run_id =
    match run_id with
    | Some value -> value
    | None when no_active_run -> ""
    | None -> worker.id ^ "-run-1"
  in
  let run =
    match Taumel.Shared.trim_non_empty run_id with
    | None -> None
    | Some id -> Taumel.Agent_runs.find_run !agent_state id
  in
  let run_status =
    if no_active_run then "no_active_run"
    else
      match run with
      | Some run -> Taumel.Agent_runs.run_status_to_string run.run_status
      | None -> Taumel.Subagents.lifecycle_to_string worker.lifecycle
  in
  let run_initial_submission_kind =
    Option.map
      (fun (run : Taumel.Agent_runs.agent_run) ->
        run.run_initial_submission_kind)
      run
  in
  let text =
    match action with
    | "agent_spawn" ->
        String.concat "\n"
          [
            "<taumel_agent_spawn>";
            xml_agent_line ~sandbox:(Taumel.Sandbox.filesystem_mode_to_string
                worker.sandbox.filesystem_mode) worker.id worker.definition_name;
            xml_run_line run_id run_status;
            "</taumel_agent_spawn>";
          ]
    | "agent_send" ->
        if no_active_run then
          String.concat "\n"
            [
              "<taumel_agent_send>";
              xml_agent_line worker.id worker.definition_name;
              "  <summary status=\"no_active_run\" />";
              "</taumel_agent_send>";
            ]
        else
          let submission =
            match submission_id with
            | None | Some "" -> []
            | Some id ->
                [
                  Printf.sprintf
                    "  <submission id=\"%s\" kind=\"%s\" />"
                    (xml_attr id)
                    (xml_attr (Option.value delivery_kind ~default:"sent"));
                ]
          in
          String.concat "\n"
            ([
               "<taumel_agent_send>";
               xml_agent_line worker.id worker.definition_name;
               xml_run_line run_id run_status;
             ]
            @ submission
            @ [ "</taumel_agent_send>" ])
    | _ -> if message = "" then summary worker else message
  in
  let detail_fields =
    [
      ("worker", inject (js_worker worker));
      ("agent_id", js_string worker.id);
      ("profile", js_string worker.definition_name);
      ("status", js_string run_status);
      ("ok", js_bool true);
    ]
  in
  let detail_fields =
    match Taumel.Shared.trim_non_empty run_id with
    | None -> detail_fields
    | Some value -> detail_fields @ [ ("run_id", js_string value) ]
  in
  let detail_fields =
    match submission_id with
    | None | Some "" -> detail_fields
    | Some value -> detail_fields @ [ ("submission_id", js_string value) ]
  in
  let detail_fields =
    match run_initial_submission_kind with
    | None -> detail_fields
    | Some value -> detail_fields @ [ ("runInitialSubmissionKind", js_string value) ]
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
  let detail_fields =
    match child_session_updates with
    | [] -> detail_fields
    | updates -> detail_fields @ [ ("childSessionUpdates", js_array updates) ]
  in
  let fields =
    [
      ("action", js_string action);
      ("text", js_string text);
      ("workerId", js_string worker.id);
      ("agent_id", js_string worker.id);
      ("profile", js_string worker.definition_name);
      ("status", js_string run_status);
      ("prompt", js_string prompt);
      ("details", inject (Unsafe.obj (Array.of_list detail_fields)));
    ]
  in
  let fields =
    match Taumel.Shared.trim_non_empty run_id with
    | None -> fields
    | Some value -> fields @ [ ("run_id", js_string value) ]
  in
  let fields =
    match dispatch_deliver_as with
    | None -> fields
    | Some value -> ("dispatchDeliverAs", js_string value) :: fields
  in
  ok_obj fields

let delivery_run_status = Option.map Taumel.Agent_runs.run_status_to_string

let delivery_child_session_updates worker_id
    (delivery : Taumel.Agent_runs.submission_delivery) =
  match (delivery.delivery_kind, delivery.delivery_previous_status) with
  | ("interrupted" | "suspended"), Some _ ->
      [
        js_child_session_update ~reason:"interrupted_by_parent"
          "stop_child_session" worker_id;
      ]
  | _ -> []

let render_plan ?delivery plan =
  match plan.Taumel.Subagents.worker with
  | Some worker ->
      (match delivery with
      | None ->
          let run_id =
            Option.map
              (fun (run : Taumel.Agent_runs.agent_run) -> run.run_id)
              (Taumel.Agent_runs.latest_run !agent_state worker.id)
          in
          result ?run_id ~action:plan.action ~prompt:plan.prompt
            ~message:plan.message worker
      | Some (delivery : Taumel.Agent_runs.submission_delivery) ->
          let dispatch_deliver_as =
            Taumel.Agent_runs.dispatch_deliver_as_for_delivery_kind
              delivery.delivery_kind
          in
          let child_session_updates =
            delivery_child_session_updates worker.id delivery
          in
          result ~run_id:delivery.Taumel.Agent_runs.delivery_run_id
            ~submission_id:delivery.delivery_submission_id
            ~delivery_kind:delivery.delivery_kind
            ?previous_status:(delivery_run_status delivery.delivery_previous_status)
            ~dispatch_deliver_as ~child_session_updates ~action:plan.action
            ~prompt:plan.prompt ~message:plan.message worker)
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

let run_elapsed_seconds ~now (run : Taumel.Agent_runs.agent_run) =
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

let compact_text max_length value =
  let normalized =
    value |> String.map (function '\n' | '\r' | '\t' -> ' ' | char -> char)
    |> String.trim
  in
  if String.length normalized <= max_length then normalized
  else String.sub normalized 0 (max_length - 3) ^ "..."

let terminal_result_summary (run : Taumel.Agent_runs.agent_run) =
  if Taumel.Agent_runs.active_run_status run.run_status then None
  else
    match run.run_final_output with
    | Some output when String.trim output <> "" ->
        Some ("final=" ^ compact_text 240 output)
    | _ -> (
        match run.run_reason with
        | Some reason when String.trim reason <> "" ->
            Some ("error=" ^ compact_text 240 reason)
        | _ -> None)

let js_submission (submission : Taumel.Agent_runs.submission) =
  Unsafe.obj
    [|
      ("submission_id", js_string submission.submission_id);
      ("kind", js_string submission.submission_kind);
      ("createdAt", js_number (float_of_int submission.submission_created_at));
    |]

let js_run ~now (run : Taumel.Agent_runs.agent_run) =
  Unsafe.obj
    [|
      ("run_id", js_string run.run_id);
      ("agent_id", js_string run.run_agent_id);
      ("initialSubmissionKind", js_string run.run_initial_submission_kind);
      ( "submissions",
        js_array (List.map js_submission run.run_submissions) );
      ("status", js_string (Taumel.Agent_runs.run_status_to_string run.run_status));
      ("reason", js_option_string run.run_reason);
      ("finalOutput", js_option_string run.run_final_output);
      ("outputAvailable", js_bool run.run_output_available);
      ("consumed", js_bool run.run_consumed);
      ("backgroundNotified", js_bool run.run_background_notified);
      ("createdAt", js_number (float_of_int run.run_created_at));
      ("startedAt", js_option_int run.run_started_at);
      ("completedAt", js_option_int run.run_completed_at);
      ("elapsedSeconds", js_number (float_of_int (run_elapsed_seconds ~now run)));
    |]

let bounded_run_reason = function
  | None -> None
  | Some
      ( "interrupted_by_parent" | "closed_by_parent" | "stopped_by_parent"
      | "goal_blocked" | "goal_continuation_limit"
      | "replacement_dispatch_failed" | "working_directory_unavailable"
      | "model_unavailable" | "tool_surface_unavailable"
      | "identity_snapshot_incomplete" | "process_resumed_without_live_worker"
      | "timed_out" ) as reason ->
      reason
  | Some _ -> Some "execution_failed"

let js_list_run ~now (run : Taumel.Agent_runs.agent_run) =
  Unsafe.obj
    [|
      ("run_id", js_string run.run_id);
      ("agent_id", js_string run.run_agent_id);
      ("initialSubmissionKind", js_string run.run_initial_submission_kind);
      ("status", js_string (Taumel.Agent_runs.run_status_to_string run.run_status));
      ("reason", js_option_string (bounded_run_reason run.run_reason));
      ("consumed", js_bool run.run_consumed);
      ("backgroundNotified", js_bool run.run_background_notified);
      ("createdAt", js_number (float_of_int run.run_created_at));
      ("startedAt", js_option_int run.run_started_at);
      ("completedAt", js_option_int run.run_completed_at);
      ("elapsedSeconds", js_number (float_of_int (run_elapsed_seconds ~now run)));
    |]

let js_agent_identity ~now state (identity : Taumel.Agent_runs.agent_identity) =
  let latest = Taumel.Agent_runs.latest_run state identity.identity_agent_id in
  let workspace =
    match identity.identity_sandbox_snapshot with
    | Some { workspace_roots = root :: _; _ } -> Some root
    | _ -> None
  in
  Unsafe.obj
    [|
      ("agent_id", js_string identity.identity_agent_id);
      ("profile", js_string identity.identity_profile_name);
      ( "lifecycle",
        js_string
          (if Taumel.Agent_runs.identity_open identity then "open" else "closed") );
      ("child_session_id", js_option_string identity.identity_child_session_id);
      ("workspace_binding", js_option_string workspace);
      ("createdAt", js_number (float_of_int identity.identity_created_at));
      ("closedAt", js_option_int identity.identity_closed_at);
      ( "run_id",
        js_option_string
          (Option.map (fun (run : Taumel.Agent_runs.agent_run) -> run.run_id) latest)
      );
      ( "run_state",
        js_option_string
          (Option.map
             (fun (run : Taumel.Agent_runs.agent_run) ->
               Taumel.Agent_runs.run_status_to_string run.run_status)
             latest) );
      ( "latestRun",
        match latest with
        | None -> inject Js.null
        | Some run -> inject (js_list_run ~now run) );
    |]

let agent_identity_summary ~now state identity =
  let lifecycle =
    if Taumel.Agent_runs.identity_open identity then "open" else "closed"
  in
  let run =
    match Taumel.Agent_runs.latest_run state identity.identity_agent_id with
    | None -> "no runs"
    | Some run ->
        let fields =
          [
            run.run_id;
            "[" ^ Taumel.Agent_runs.run_status_to_string run.run_status ^ "]";
            "elapsed=" ^ string_of_int (run_elapsed_seconds ~now run) ^ "s";
          ]
        in
        let fields =
          match terminal_result_summary run with
          | None -> fields
          | Some result -> fields @ [ result ]
        in
        String.concat " " fields
  in
  let workspace =
    match identity.identity_sandbox_snapshot with
    | Some { workspace_roots = root :: _; _ } -> root
    | _ -> "unavailable"
  in
  Printf.sprintf "%s [%s] profile=%s workspace=%s latest=%s"
    identity.identity_agent_id lifecycle identity.identity_profile_name workspace run

let agent_identity_xml ~now state identity =
  let lifecycle =
    if Taumel.Agent_runs.identity_open identity then "open" else "closed"
  in
  let latest =
    match Taumel.Agent_runs.latest_run state identity.identity_agent_id with
    | None -> []
    | Some run ->
        [
          xml_run_line
            ~elapsed:(run_elapsed_seconds ~now run)
            ?reason:(bounded_run_reason run.run_reason)
            run.run_id (Taumel.Agent_runs.run_status_to_string run.run_status);
        ]
  in
  let workspace =
    match identity.identity_sandbox_snapshot with
    | Some { workspace_roots = root :: _; _ } -> Some root
    | _ -> None
  in
  String.concat "\n"
    ([ xml_agent_line ~lifecycle ?workspace identity.identity_agent_id
         identity.identity_profile_name ]
    @ latest)

let render_agent_list ~owner_id ~include_closed =
  let state = !agent_state in
  let now = now_seconds () in
  let identities =
    state.identities
    |> List.filter (fun (identity : Taumel.Agent_runs.agent_identity) ->
           identity.identity_parent_session_id = owner_id
           && (include_closed || Taumel.Agent_runs.identity_open identity))
  in
  let _human_text =
    match identities with
    | [] -> "No agents."
    | identities ->
        String.concat "\n"
          (List.map (agent_identity_summary ~now state) identities)
  in
  let text =
    match identities with
    | [] -> "<taumel_agent_list>\n  <summary count=\"0\" />\n</taumel_agent_list>"
    | identities ->
        String.concat "\n"
          (["<taumel_agent_list>"]
          @ List.map (agent_identity_xml ~now state) identities
          @ ["</taumel_agent_list>"])
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

let js_wait_item (item : Taumel.Agent_runs.wait_item) =
  Unsafe.obj
    [|
      ("agent_id", js_string item.wait_agent_id);
      ("run_id", js_option_string item.wait_run_id);
      ("status", js_string item.wait_status);
      ("finalOutput", js_option_string item.wait_final_output);
      ("error", js_option_string item.wait_error);
      ("outputAvailable", js_bool item.wait_output_available);
      ("consumed", js_bool item.wait_consumed);
      ("backgroundNotified", js_bool item.wait_background_notified);
    |]

let js_wait_poll_params run_ids =
  match run_ids with
  | [] -> inject Js.null
  | run_ids ->
      inject
        (Unsafe.obj
           [| ("run_ids", js_array (List.map js_string run_ids)) |])

let parse_wait_selector params =
  let run_ids = optional_string_array params "run_ids" in
  let agent_ids = optional_string_array params "agent_ids" in
  match (run_ids, agent_ids) with
  | Some _, Some _ -> Error "agent_wait accepts exactly one selector kind"
  | Some [] , _ -> Error "agent_wait.run_ids must not be empty"
  | _, Some [] -> Error "agent_wait.agent_ids must not be empty"
  | Some run_ids, None -> Ok (Taumel.Agent_runs.Wait_run_ids run_ids)
  | None, Some agent_ids -> Ok (Taumel.Agent_runs.Wait_agent_ids agent_ids)
  | None, None -> Ok Taumel.Agent_runs.Wait_all_active

let restore_retained_agent_outputs owner_id =
  let state = !agent_state in
  let output_for run_id =
    List.find_map
      (fun retained ->
        if
          retained.retained_owner_id = owner_id
          && retained.retained_run_id = run_id
        then Some retained.retained_final_output
        else None)
      !retained_agent_outputs
  in
  let changed = ref false in
  let runs =
    List.map
      (fun (run : Taumel.Agent_runs.agent_run) ->
        if
          Option.is_none run.run_final_output
          && Taumel.Agent_runs.run_owned_by_parent state
               ~parent_session_id:owner_id run
        then
          match output_for run.run_id with
          | None -> run
          | Some output ->
              changed := true;
              {
                run with
                Taumel.Agent_runs.run_final_output = Some output;
                run_output_available = true;
              }
        else run)
      state.runs
  in
  if !changed then agent_state := { state with runs }

let clear_retained_agent_outputs owner_id run_ids =
  match run_ids with
  | [] -> ()
  | run_ids ->
      retained_agent_outputs :=
        List.filter
          (fun retained ->
            retained.retained_owner_id <> owner_id
            || not (List.mem retained.retained_run_id run_ids))
          !retained_agent_outputs

let wait_item_xml (item : Taumel.Agent_runs.wait_item) =
  let run_id =
    match item.wait_run_id with
    | None -> ""
    | Some value -> Printf.sprintf " run_id=\"%s\"" (xml_attr value)
  in
  let agent_id =
    if item.wait_agent_id = "" then ""
    else Printf.sprintf " agent_id=\"%s\"" (xml_attr item.wait_agent_id)
  in
  let output_available =
    if item.wait_output_available then ""
    else " output_available=\"false\""
  in
  let open_tag =
    Printf.sprintf "  <run%s%s status=\"%s\"%s>" agent_id run_id
      (xml_attr item.wait_status) output_available
  in
  let close_tag = "  </run>" in
  match (item.wait_final_output, item.wait_error) with
  | Some output, _ ->
      String.concat "\n"
        [ open_tag; "    <final_output>"; output; "    </final_output>"; close_tag ]
  | None, Some error ->
      String.concat "\n"
        [ open_tag; "    <error>"; error; "    </error>"; close_tag ]
  | None, None -> String.concat "\n" [ open_tag; close_tag ]

let wait_result_xml result =
  match result.Taumel.Agent_runs.wait_items with
  | [] -> "<taumel_agent_wait>\n  <summary status=\"no_active_runs\" />\n</taumel_agent_wait>"
  | items ->
      String.concat "\n"
        (["<taumel_agent_wait>"]
        @ List.map wait_item_xml items
        @ ["</taumel_agent_wait>"])

let render_agent_wait params owner_id ctx =
  match parse_wait_selector params with
  | Error message -> error_obj message
  | Ok selector ->
      restore_retained_agent_outputs owner_id;
      let result =
        Taumel.Agent_runs.wait_for_selector !agent_state ~parent_session_id:owner_id
          selector
      in
      let consumed_outputs =
        List.filter_map
          (fun (item : Taumel.Agent_runs.wait_item) ->
            match (item.wait_run_id, item.wait_final_output) with
            | Some run_id, Some _ when item.wait_consumed -> Some run_id
            | _ -> None)
          result.wait_items
      in
      clear_retained_agent_outputs owner_id consumed_outputs;
      if result.wait_state <> !agent_state then (
        agent_state := result.wait_state;
        Session_sync.save_agent_state ctx);
      ok_obj
        [
          ("action", js_string "tool_result");
          ("text", js_string (wait_result_xml result));
          ( "details",
            inject
              (Unsafe.obj
                 [|
                   ("ok", js_bool true);
                   ( "runs",
                     js_array (List.map js_wait_item result.wait_items) );
                   ( "hasActiveRuns",
                     js_bool (result.wait_active_run_ids <> []) );
                   ( "pollParams",
                     js_wait_poll_params result.wait_active_run_ids );
                   ( "status",
                     js_string
                       (if result.wait_items = [] then "no_active_runs"
                        else "ok") );
                 |]) );
        ]

let profile_visibility_enabled (profile : Taumel.Agent_profiles.profile_spec) =
  Taumel.Visibility.is_enabled !visibility_state Taumel.Visibility.Agents
    profile.spec_name

let js_profile_spec (profile : Taumel.Agent_profiles.profile_spec) =
  let enabled =
    profile_visibility_enabled profile
  in
  Unsafe.obj
    [|
      ("name", js_string profile.spec_name);
      ("description", js_string profile.spec_description);
      ("enabled", js_bool enabled);
      ( "disabledReason",
        if enabled then inject Js.null
        else js_string "disabled for this session" );
      ( "sandbox",
        js_string
          (Taumel.Agent_profiles.sandbox_setting_to_summary
             profile.spec_sandbox) );
      ( "tools",
        js_string
          (Taumel.Agent_profiles.tools_setting_to_summary profile.spec_tools) );
    |]

let profile_summary (profile : Taumel.Agent_profiles.profile_spec) =
  let enabled = profile_visibility_enabled profile in
  let disabled =
    if enabled then "" else "; disabledReason=disabled for this session"
  in
  Printf.sprintf "%s [enabled=%s] - %s%s; sandbox=%s; tools=%s"
    profile.spec_name
    (if enabled then "true" else "false")
    profile.spec_description disabled
    (Taumel.Agent_profiles.sandbox_setting_to_summary profile.spec_sandbox)
    (Taumel.Agent_profiles.tools_setting_to_summary profile.spec_tools)

let profile_tool_xml = function
  | Taumel.Agent_profiles.Inherit_tools -> [ "    <tool name=\"inherit\" />" ]
  | Taumel.Agent_profiles.Concrete_tools tools ->
      List.map
        (fun tool -> Printf.sprintf "    <tool name=\"%s\" />" (xml_attr tool))
        tools

let profile_xml (profile : Taumel.Agent_profiles.profile_spec) =
  let enabled = profile_visibility_enabled profile in
  let disabled_reason =
    if enabled then ""
    else " disabled_reason=\"disabled for this session\""
  in
  String.concat "\n"
    ([
       Printf.sprintf
         "  <profile name=\"%s\" enabled=\"%s\" sandbox=\"%s\"%s>"
         (xml_attr profile.spec_name)
         (if enabled then "true" else "false")
         (xml_attr
            (Taumel.Agent_profiles.sandbox_setting_to_summary profile.spec_sandbox))
         disabled_reason;
       "    <description>" ^ profile.spec_description ^ "</description>";
     ]
    @ profile_tool_xml profile.spec_tools
    @ [ "  </profile>" ])

let render_profiles () =
  let catalog = !agent_catalog in
  let visible_profiles =
    catalog.catalog_profiles
    |> List.filter (fun (profile : Taumel.Agent_profiles.profile_spec) ->
           Taumel.Visibility.is_enabled !visibility_state
             Taumel.Visibility.Agents profile.spec_name)
  in
  let _profile_text =
    match visible_profiles with
    | [] -> "No agent profiles."
    | profiles -> String.concat "\n" (List.map profile_summary profiles)
  in
  let text =
    match catalog.catalog_errors with
    | [] ->
        String.concat "\n"
          (["<taumel_agent_profiles>"]
          @ List.map profile_xml visible_profiles
          @ ["</taumel_agent_profiles>"])
    | errors ->
        String.concat "\n"
          (["<taumel_agent_profiles>"]
          @ List.map profile_xml visible_profiles
          @ [
              "  <error>";
              String.concat "\n" errors;
              "  </error>";
              "</taumel_agent_profiles>";
            ])
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
               ( "profiles",
                 js_array
                   (List.map js_profile_spec visible_profiles) );
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
    String.concat "\n"
      ([
         Printf.sprintf "<taumel_agent_close count=\"%d\">" count;
       ]
      @ List.map
          (fun id ->
            Printf.sprintf "  <agent id=\"%s\" lifecycle=\"closed\" />"
              (xml_attr id))
          ids
      @ [ "</taumel_agent_close>" ])
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
  state.Taumel.Agent_runs.identities
  |> List.filter (fun (identity : Taumel.Agent_runs.agent_identity) ->
         identity.identity_parent_session_id = owner_id
         && Taumel.Agent_runs.identity_open identity)
  |> List.map (fun (identity : Taumel.Agent_runs.agent_identity) ->
         identity.identity_agent_id)

let validate_close_ids owner_id ids =
  let rec loop = function
    | [] -> Ok ()
    | id :: rest -> (
        match Taumel.Agent_runs.find_identity !agent_state id with
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
        match Taumel.Agent_runs.record_close state ~now ~agent_id:id with
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
    match (close_all, optional_string_array params "agent_ids") with
    | true, Some _ -> Error "agent_close accepts exactly one selector kind"
    | true, None -> Ok (owned_open_agent_ids owner.id !agent_state)
    | false, _ -> requested_close_ids params
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
                Taumel.Agent_runs.record_close_all !agent_state ~now
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
