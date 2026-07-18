open Jsoo_bridge
open App_state
open Runtime_access

let prepare_query params =
  with_gateway_authorized "query_threads" (fun _ ->
      let params =
        decode_ojs_contract Tool_contracts.QueryThreadsParams.t_of_js
          (ojs_of_js params)
      in
      let scope =
        match Boundary_contracts.QueryThreadsParams.get_scope params with
        | None -> None
        | Some `V_current_workspace -> Some "current_workspace"
        | Some `V_all -> Some "all"
      in
      match
        Taumel.Thread_tools.prepare_query_request
          ?limit:(Option.map int_of_float (Tool_contracts.QueryThreadsParams.get_limit params))
          ?scope
          ~include_tools:(Option.value (Tool_contracts.QueryThreadsParams.get_includeTools params) ~default:true)
          (Tool_contracts.QueryThreadsParams.get_query params)
      with
      | Error message -> error_obj message
      | Ok request ->
          Boundary_contracts.PreparedThreadQuery.create ~query:request.query
            ~limit:(float_of_int request.limit)
      ~scope:(Boundary_contracts.PreparedThreadQuery.scope_to_contract
                (match request.scope with
                | "all" -> `V_all
                | "current_workspace" -> `V_current_workspace
                | value -> invalid_arg ("invalid query_threads scope: " ^ value)))
            ~includeTools:request.include_tools ()
          |> Tool_contracts.PreparedThreadQuery.t_to_js |> inject)

let read_input_from_params params : Taumel.Thread_tools.read_request_input =
  let raw_params = params in
  let params =
    decode_ojs_contract Tool_contracts.ReadThreadParams.t_of_js (ojs_of_js params)
  in
  let locator =
    match optional_field raw_params "locator" with
    | None -> None
    | Some value ->
        Some
          (decode_ojs_contract Tool_contracts.ThreadLocator.t_of_js
             (ojs_of_js value))
  in
  let mode =
    match Boundary_contracts.ReadThreadParams.get_mode params with
    | None -> None
    | Some `V_overview -> Some "overview"
    | Some `V_window -> Some "window"
    | Some `V_full -> Some "full"
  in
  {
    thread_id = Tool_contracts.ReadThreadParams.get_threadID params;
    locator_thread_id = Option.map Tool_contracts.ThreadLocator.get_threadID locator;
    locator_source_path =
      Option.bind locator Tool_contracts.ThreadLocator.get_sourcePath;
    locator_entry_id =
      Option.bind locator Tool_contracts.ThreadLocator.get_entryID;
    locator_line = Option.bind locator (fun value -> Option.map int_of_float (Tool_contracts.ThreadLocator.get_line value));
    entry_id = Tool_contracts.ReadThreadParams.get_entryID params;
    line = Option.map int_of_float (Tool_contracts.ReadThreadParams.get_line params);
    mode;
    around = Option.map int_of_float (Tool_contracts.ReadThreadParams.get_around params);
    cursor = Tool_contracts.ReadThreadParams.get_cursor params;
  }

let prepare_read params =
  with_gateway_authorized "read_thread" (fun _ ->
      match Taumel.Thread_tools.prepare_read_request (read_input_from_params params) with
      | Error message -> error_obj message
      | Ok request ->
          let locator =
            match request.locator with
            | None -> None
            | Some locator ->
                Some
                  (Tool_contracts.PreparedThreadLocator.create
                     ~threadID:locator.locator_thread_id
                     ?sourcePath:locator.locator_source_path
                     ?entryID:locator.locator_entry_id
                     ?line:(Option.map float_of_int locator.locator_line) ())
          in
          Boundary_contracts.PreparedThreadRead.create
            ~threadID:request.thread_id
            ~mode:(Boundary_contracts.PreparedThreadRead.mode_to_contract
                     (match request.mode with
                     | Taumel.Thread_tools.Overview -> `V_overview
                     | Taumel.Thread_tools.Window -> `V_window
                     | Taumel.Thread_tools.Full -> `V_full))
            ~around:(float_of_int request.around)
            ?entryID:request.entry_id ?line:(Option.map float_of_int request.line)
            ?cursor:request.cursor ?locator ()
          |> Tool_contracts.PreparedThreadRead.t_to_js |> inject)

let js_catalog_scan (scan : Taumel.Thread_tools.catalog_scan) =
  Tool_contracts.ThreadCatalogScan.create ~root:scan.root
    ~maxDepth:(float_of_int scan.max_depth) ~maxFiles:(float_of_int scan.max_files)
    ~suffix:scan.suffix ()

let plan_catalog_scans facts =
  let facts = decode_ojs_contract Tool_contracts.ThreadCatalogFacts.t_of_js (ojs_of_js facts) in
  let override =
    Option.bind (Tool_contracts.ThreadCatalogFacts.get_override facts)
      Taumel.Shared.trim_non_empty
  in
  let scans =
    Taumel.Thread_tools.catalog_scans ?override
      ~cwd:(Tool_contracts.ThreadCatalogFacts.get_cwd facts)
      ~home:(Tool_contracts.ThreadCatalogFacts.get_home facts) ()
    |> List.map js_catalog_scan
  in
  let result = Tool_contracts.ThreadCatalogScansResult.create ~scans () in
  Tool_contracts.ThreadCatalogScansResult.t_to_js result |> inject

let catalog_from_js catalog =
  array_items catalog
  |> List.map (fun item ->
         match json_from_js item with
         | Ok json -> json
         | Error message ->
             Taumel.Shared.Object
               [
                 ("kind", Taumel.Shared.String "diagnostic");
                 ("message", Taumel.Shared.String ("invalid thread source payload: " ^ message));
               ])
  |> Taumel.Thread_tools.catalog_of_sources

let js_option_string = function
  | None -> inject Js_of_ocaml.Js.null
  | Some value -> js_string value

let js_option_int = function
  | None -> inject Js_of_ocaml.Js.null
  | Some value -> js_number (float_of_int value)

let js_locator (locator : Taumel.Thread_tools.locator) =
  Unsafe.obj
    [|
      ("threadID", js_string locator.locator_thread_id);
      ("sourcePath", js_option_string locator.locator_source_path);
      ("entryID", js_option_string locator.locator_entry_id);
      ("line", js_option_int locator.locator_line);
    |]

let js_hit (hit : Taumel.Thread_tools.hit) =
  Unsafe.obj
    [|
      ("locator", inject (js_locator hit.hit_locator));
      ("kind", js_string hit.hit_kind);
      ("field", js_string hit.hit_field);
      ("role", js_option_string hit.hit_role);
      ("toolName", js_option_string hit.hit_tool_name);
      ("timestamp", js_option_string hit.hit_timestamp);
      ("snippet", js_string hit.hit_snippet);
    |]

let js_summary (summary : Taumel.Thread_tools.thread_summary) =
  Unsafe.obj
    [|
      ("id", js_string summary.id);
      ("title", js_string summary.title);
      ("workspace", js_option_string summary.workspace);
      ("messageCount", js_number (float_of_int summary.message_count));
      ("sourcePath", js_option_string summary.source_path);
      ("goalSummary", js_option_string summary.goal_summary);
      ("branchSummary", js_option_string summary.branch_summary);
      ("compactionSummary", js_option_string summary.compaction_summary);
      ("hits", js_array (List.map js_hit summary.hits));
    |]

let js_entry (entry : Taumel.Thread_tools.visible_entry) =
  Unsafe.obj
    [|
      ("entryID", js_option_string entry.entry_id);
      ("line", js_option_int entry.line);
      ("timestamp", js_option_string entry.timestamp);
      ("role", js_option_string entry.role);
      ("kind", js_string entry.kind);
      ("toolName", js_option_string entry.tool_name);
      ("text", js_string entry.text);
    |]

let js_diagnostic (diagnostic : Taumel.Thread_tools.diagnostic) =
  Unsafe.obj
    [|
      ("sourcePath", js_option_string diagnostic.source_path);
      ("line", js_option_int diagnostic.line);
      ("message", js_string diagnostic.message);
    |]

let js_truncation fields =
  Unsafe.obj
    (fields
    |> List.map (fun (name, value) -> (name, js_string value))
    |> Array.of_list)

let run_query params catalog =
  let params =
    decode_ojs_contract Tool_contracts.PreparedThreadQuery.t_of_js (ojs_of_js params)
  in
  let scope =
    match Boundary_contracts.PreparedThreadQuery.get_scope params with
    | `V_current_workspace -> "current_workspace"
    | `V_all -> "all"
  in
  match
    Taumel.Thread_tools.prepare_query_request
      ~limit:(int_of_float (Tool_contracts.PreparedThreadQuery.get_limit params))
      ~scope ~include_tools:(Tool_contracts.PreparedThreadQuery.get_includeTools params)
      (Tool_contracts.PreparedThreadQuery.get_query params)
  with
  | Error message -> error_obj message
  | Ok request ->
      let plan =
        Taumel.Thread_tools.plan_query ~workspace:state.cwd request
          (catalog_from_js catalog)
      in
      let details =
        Unsafe.obj
          [|
            ("ok", js_bool plan.ok);
            ("query", js_string plan.query);
            ("scope", js_string plan.scope);
            ("threads", js_array (List.map js_summary plan.threads));
            ("diagnostics", js_array (List.map js_diagnostic plan.diagnostics));
          |]
      in
      Boundary_contracts.BridgeToolResult.create ~text:plan.text
        ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details)) ()
      |> Tool_contracts.BridgeToolResult.t_to_js |> inject

let run_read params catalog =
  let params =
    decode_ojs_contract Tool_contracts.PreparedThreadRead.t_of_js (ojs_of_js params)
  in
  let locator = Tool_contracts.PreparedThreadRead.get_locator params in
  let input : Taumel.Thread_tools.read_request_input =
    {
      thread_id = Some (Tool_contracts.PreparedThreadRead.get_threadID params);
      locator_thread_id =
        Option.map Tool_contracts.PreparedThreadLocator.get_threadID locator;
      locator_source_path =
        Option.bind locator Tool_contracts.PreparedThreadLocator.get_sourcePath;
      locator_entry_id =
        Option.bind locator Tool_contracts.PreparedThreadLocator.get_entryID;
      locator_line =
        Option.bind locator (fun value ->
            Option.map int_of_float
              (Tool_contracts.PreparedThreadLocator.get_line value));
      entry_id = Tool_contracts.PreparedThreadRead.get_entryID params;
      line = Option.map int_of_float (Tool_contracts.PreparedThreadRead.get_line params);
      mode =
        Some
          (match Boundary_contracts.PreparedThreadRead.get_mode params with
          | `V_overview -> "overview" | `V_window -> "window" | `V_full -> "full");
      around = Some (int_of_float (Tool_contracts.PreparedThreadRead.get_around params));
      cursor = Tool_contracts.PreparedThreadRead.get_cursor params;
    }
  in
  match Taumel.Thread_tools.prepare_read_request input with
  | Error message -> error_obj message
  | Ok request ->
      let plan =
        Taumel.Thread_tools.plan_read ~id:request.thread_id request
          (catalog_from_js catalog)
      in
      let details =
        Unsafe.obj
          [|
            ("ok", js_bool plan.ok);
            ( "thread",
              match plan.thread with
              | None -> inject Js_of_ocaml.Js.null
              | Some summary -> inject (js_summary summary) );
            ("entries", js_array (List.map js_entry plan.entries));
            ("diagnostics", js_array (List.map js_diagnostic plan.diagnostics));
            ("ambiguous", js_bool plan.ambiguous);
            ("matches", js_array (List.map js_string plan.matches));
            ("mode", js_string plan.mode);
            ("cursor", js_option_string plan.cursor);
            ("truncation", inject (js_truncation plan.truncation));
          |]
      in
      Boundary_contracts.BridgeToolResult.create ~text:plan.text
        ~details:(Ts2ocaml.unknown_of_js (ojs_of_js details)) ()
      |> Tool_contracts.BridgeToolResult.t_to_js |> inject

let run raw_facts =
  let facts = decode_ojs_contract Tool_contracts.ThreadToolFacts.t_of_js (ojs_of_js raw_facts) in
  let name = Boundary_contracts.ThreadToolFacts.get_name facts in
  let params = Tool_contracts.ThreadToolFacts.get_params facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  let catalog = Tool_contracts.ThreadToolFacts.get_catalog facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  let ctx = Tool_contracts.ThreadToolFacts.get_ctx facts |> Ts2ocaml.unknown_to_js |> js_of_ojs in
  Session_sync.require_session_from_host ~scope:"thread tool run" ctx;
  let result =
    match name with
    | `V_query_threads -> run_query params catalog
    | `V_read_thread -> run_read params catalog
  in
  if get_bool result "ok" then
    prepared_tool_result_with_extra result (Unsafe.obj [||])
  else text_tool_result (get_string result "error") result
