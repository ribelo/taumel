open Jsoo_bridge
open App_state
open Runtime_access

let prepare_find params =
  with_gateway_authorized "find_thread" (fun _ ->
      let params = Tool_contracts.FindThreadParams.t_of_js (ojs_of_js params) in
      match
        Taumel.Thread_tools.prepare_find_request
          (Tool_contracts.FindThreadParams.get_query params)
      with
      | Error message -> error_obj message
      | Ok request ->
          ok_obj
            [
              ("action", js_string "find_thread");
              ("query", js_string request.query);
            ])

let prepare_read params =
  with_gateway_authorized "read_thread" (fun _ ->
      let params = Tool_contracts.ReadThreadParams.t_of_js (ojs_of_js params) in
      match
        Taumel.Thread_tools.prepare_read_request
          {
            thread_id = Some (Tool_contracts.ReadThreadParams.get_threadID params);
            thread_id_snake = None;
            id = None;
            goal =
              Option.value (Tool_contracts.ReadThreadParams.get_goal params)
                ~default:"";
          }
      with
      | Error message -> error_obj message
      | Ok request ->
          ok_obj
            [
              ("action", js_string "read_thread");
              ("threadID", js_string request.thread_id);
              ("goal", js_string request.goal);
            ])

let js_catalog_scan (scan : Taumel.Thread_tools.catalog_scan) =
  Unsafe.obj
    [|
      ("root", js_string scan.root);
      ("maxDepth", js_number (float_of_int scan.max_depth));
      ("maxFiles", js_number (float_of_int scan.max_files));
      ("suffix", js_string scan.suffix);
    |]

let plan_catalog_scans facts =
  let override =
    Option.bind (optional_string_field facts "override") Taumel.Shared.trim_non_empty
  in
  Taumel.Thread_tools.catalog_scans ?override
    ~cwd:(get_string facts "cwd")
    ~home:(get_string facts "home") ()
  |> List.map js_catalog_scan |> js_array

let json_field_or_empty_array obj name =
  if not (has_property obj name) then Taumel.Shared.Array []
  else match json_from_js (Unsafe.get obj name) with Ok json -> json | Error _ -> Array []

let current_source facts =
  Taumel.Thread_tools.current_source_json
    ~cwd:(get_string facts "cwd")
    ~session_id:(get_string facts "sessionId")
    ~branch:(json_field_or_empty_array facts "branch")
    ~entries:(json_field_or_empty_array facts "entries")
  |> json_to_js

let message_from_js obj =
  {
    Taumel.Thread_tools.role = get_string obj "role";
    content = get_string obj "content";
  }

let thread_from_js obj =
  let workspace =
    match optional_string_field obj "workspace" with
    | Some value when value <> "" -> Some value
    | _ -> None
  in
  {
    Taumel.Thread_tools.id = get_string obj "id";
    title = get_string obj "title";
    workspace;
    messages = get_object_array obj "messages" |> List.map message_from_js;
    goal_summary = optional_string_field obj "goalSummary";
    branch_summary = optional_string_field obj "branchSummary";
    compaction_summary = optional_string_field obj "compactionSummary";
  }

let js_summary (summary : Taumel.Thread_tools.thread_summary) =
  Unsafe.obj
    [|
      ("id", js_string summary.id);
      ("title", js_string summary.title);
      ( "workspace",
        match summary.workspace with
        | None -> Unsafe.inject Js.null
        | Some workspace -> js_string workspace );
      ("messageCount", js_number (float_of_int summary.message_count));
    |]

let catalog_from_js catalog =
  array_items catalog
  |> List.filter_map (fun item ->
         match json_from_js item with
         | Ok json -> Taumel.Thread_tools.thread_of_source_json json
         | Error _ -> None)
  |> Taumel.Thread_tools.unique_by_id

let run_find params catalog =
  let params = Tool_contracts.FindThreadParams.t_of_js (ojs_of_js params) in
  match
    Taumel.Thread_tools.prepare_find_request
      (Tool_contracts.FindThreadParams.get_query params)
  with
  | Error message -> error_obj message
  | Ok request ->
  let plan =
    Taumel.Thread_tools.plan_find ~workspace:state.cwd ~query:request.query
      (catalog_from_js catalog)
  in
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string plan.text);
      ( "details",
        inject
          (Unsafe.obj
             [|
               ("threads", js_array (List.map js_summary plan.threads));
             |]) );
    ]

let run_read params catalog =
  let params = Tool_contracts.ReadThreadParams.t_of_js (ojs_of_js params) in
  match
    Taumel.Thread_tools.prepare_read_request
      {
        thread_id = Some (Tool_contracts.ReadThreadParams.get_threadID params);
        thread_id_snake = None;
        id = None;
        goal =
          Option.value (Tool_contracts.ReadThreadParams.get_goal params)
            ~default:"";
      }
  with
  | Error message -> error_obj message
  | Ok request ->
  let plan =
    Taumel.Thread_tools.plan_read ~id:request.thread_id
      ~goal_only:(String.trim request.goal <> "")
      (catalog_from_js catalog)
  in
  let detail_fields =
    [
      ("ok", js_bool plan.ok);
      ("ambiguous", js_bool plan.ambiguous);
      ("matches", js_array (List.map js_string plan.matches));
      ( "thread",
        match plan.thread with
        | None -> Unsafe.inject Js.null
        | Some summary -> inject (js_summary summary) );
    ]
  in
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string plan.text);
      ("details", inject (Unsafe.obj (Array.of_list detail_fields)));
    ]

let run name params catalog ctx =
  Session_sync.sync_session_from_host ~scope:"thread tool run" ctx;
  let result =
    match name with
    | "find_thread" -> run_find params catalog
    | "read_thread" -> run_read params catalog
    | other -> error_obj ("not a thread tool: " ^ other)
  in
  if get_bool result "ok" then
    prepared_tool_result_with_extra result (Unsafe.obj [||])
  else text_tool_result (get_string result "error") result
