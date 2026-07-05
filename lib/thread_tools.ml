include Thread_catalog

let trim_option = function
  | Some value -> Shared.trim_non_empty value
  | None -> None

let normalize_limit = function
  | Some value -> max 1 (min 50 value)
  | None -> 10

let prepare_query_request ?limit ?scope ?(include_tools = true) query =
  match Shared.trim_non_empty query with
  | None -> Error "query_threads requires query"
  | Some query ->
      let scope = Option.value scope ~default:"current_workspace" in
      if scope <> "current_workspace" && scope <> "all" then
        Error "query_threads scope must be current_workspace or all"
      else Ok { query; limit = normalize_limit limit; scope; include_tools }

let read_mode_of_string = function
  | None | Some "overview" -> Ok Overview
  | Some "window" -> Ok Window
  | Some "full" -> Ok Full
  | Some _ -> Error "read_thread mode must be overview, window, or full"

let read_mode_to_string = function
  | Overview -> "overview"
  | Window -> "window"
  | Full -> "full"

let prepare_read_request (input : read_request_input) =
  let thread_id =
    match trim_option input.thread_id with
    | Some _ as value -> value
    | None -> trim_option input.locator_thread_id
  in
  match (thread_id, read_mode_of_string input.mode) with
  | None, _ -> Error "read_thread requires threadID"
  | _, Error message -> Error message
  | Some thread_id, Ok mode ->
      let around = Option.value input.around ~default:3 |> max 0 |> min 10 in
      let locator =
        match trim_option input.locator_thread_id with
        | None -> None
        | Some locator_thread_id ->
            Some
              {
                locator_thread_id;
                locator_source_path = trim_option input.locator_source_path;
                locator_entry_id = trim_option input.locator_entry_id;
                locator_line = input.locator_line;
              }
      in
      let has_window_target =
        Option.is_some locator
        || Option.is_some (trim_option input.entry_id)
        || Option.is_some input.line
      in
      if mode = Window && not has_window_target then
        Error "read_thread window mode requires locator, entryID, or line"
      else if mode <> Full && Option.is_some (trim_option input.cursor) then
        Error "read_thread cursor is only valid with mode=full"
      else
        Ok
          {
            thread_id;
            locator;
            entry_id = trim_option input.entry_id;
            line = input.line;
            mode;
            around;
            cursor = trim_option input.cursor;
          }

let entry_is_toolish (entry : visible_entry) =
  match entry.kind with
  | "tool_call" | "tool_result" | "notification" -> true
  | _ -> false

let entry_matches ~include_tools query (entry : visible_entry) =
  (include_tools || not (entry_is_toolish entry)) && contains entry.text query

let thread_in_scope ~workspace scope (thread : thread) =
  scope = "all"
  ||
  match thread.workspace with
  | Some cwd -> cwd = workspace
  | None -> (
      match thread.source_path with
      | Some path when workspace <> "" -> starts_with path workspace
      | _ -> false)

let locator_of_entry (thread : thread) (entry : visible_entry) =
  {
    locator_thread_id = thread.id;
    locator_source_path = thread.source_path;
    locator_entry_id = entry.entry_id;
    locator_line = entry.line;
  }

let matching_line_fragment query text =
  let lines = String.split_on_char '\n' text in
  let indexed = List.mapi (fun index line -> (index, line)) lines in
  match List.find_opt (fun (_index, line) -> contains line query) indexed with
  | None -> snippet text
  | Some (index, _line) ->
      let start = max 0 (index - 2) in
      let stop = min (List.length lines - 1) (index + 2) in
      let selected =
        indexed
        |> List.filter_map (fun (line_index, line) ->
               if line_index >= start && line_index <= stop then Some line
               else None)
      in
      let prefix = if start > 0 then [ "… omitted" ] else [] in
      let suffix = if stop < List.length lines - 1 then [ "… omitted" ] else [] in
      bounded_text ~max_lines:5 ~max_bytes:1024
        (String.concat "\n" (prefix @ selected @ suffix))

let hit_snippet_of_entry query (entry : visible_entry) =
  match (entry.kind, entry.tool_name) with
  | "tool_call", Some tool_name ->
      if contains tool_name query then "tool call: " ^ tool_name
      else
        let lines = String.split_on_char '\n' entry.text in
        let args =
          match lines with
          | first :: rest when first = tool_name -> String.concat "\n" rest
          | _ -> entry.text
        in
        "tool call: " ^ tool_name ^ "\narguments:\n"
        ^ matching_line_fragment query args
  | _ -> snippet entry.text

let hit_of_entry (thread : thread) query (entry : visible_entry) =
  {
    hit_locator = locator_of_entry thread entry;
    hit_kind = entry.kind;
    hit_field = if entry_matches ~include_tools:true query entry then entry.kind else "metadata";
    hit_role = entry.role;
    hit_tool_name = entry.tool_name;
    hit_timestamp = entry.timestamp;
    hit_snippet = hit_snippet_of_entry query entry;
  }

let metadata_hits (thread : thread) query =
  let add field value hits =
    match value with
    | Some value when contains value query ->
        {
          hit_locator =
            {
              locator_thread_id = thread.id;
              locator_source_path = thread.source_path;
              locator_entry_id = None;
              locator_line = None;
            };
          hit_kind = "metadata";
          hit_field = field;
          hit_role = None;
          hit_tool_name = None;
          hit_timestamp = None;
          hit_snippet = snippet value;
        }
        :: hits
    | _ -> hits
  in
  []
  |> add "id" (Some thread.id)
  |> add "title" (Some thread.title)
  |> add "workspace" thread.workspace
  |> add "goal_summary" thread.goal_summary
  |> add "branch_summary" thread.branch_summary
  |> add "compaction_summary" thread.compaction_summary
  |> List.rev

let query_hits ~include_tools query (thread : thread) =
  let entry_hits =
    thread.entries
    |> List.filter (entry_matches ~include_tools query)
    |> List.map (hit_of_entry thread query)
  in
  metadata_hits thread query @ entry_hits

let score_thread ~workspace query hits (thread : thread) =
  let score = ref 0 in
  if thread.id = query then score := !score + 10_000;
  if starts_with thread.id query then score := !score + 4_000;
  if contains thread.title query then score := !score + 1_000;
  if List.exists (fun hit -> contains hit.hit_field "summary") hits then
    score := !score + 500;
  score := !score + (List.length hits * 50);
  (match thread.workspace with
  | Some cwd when cwd = workspace -> score := !score + 25
  | _ -> ());
  !score

let summarize ?(hits = []) (thread : thread) =
  {
    id = thread.id;
    title = thread.title;
    workspace = thread.workspace;
    message_count = List.length thread.messages;
    source_path = thread.source_path;
    goal_summary = thread.goal_summary;
    branch_summary = thread.branch_summary;
    compaction_summary = thread.compaction_summary;
    hits;
  }

let plan_query ~workspace (request : query_request) (catalog : catalog) =
  let ranked =
    catalog.threads
    |> List.filter (thread_in_scope ~workspace request.scope)
    |> List.filter_map (fun thread ->
           let hits = query_hits ~include_tools:request.include_tools request.query thread in
           if hits = [] then None
           else
             let top_hits = take 3 hits in
             Some (score_thread ~workspace request.query hits thread, thread, top_hits))
    |> List.sort (fun (left_score, (left : thread), _) (right_score, (right : thread), _) ->
           let by_score = compare right_score left_score in
           if by_score <> 0 then by_score else compare left.id right.id)
    |> take request.limit
  in
  let threads =
    List.map (fun (_, thread, hits) -> summarize ~hits thread) ranked
  in
  let text =
    match threads with
    | [] -> "No threads found matching the query."
    | threads ->
        threads
        |> List.mapi (fun index thread ->
               let hits =
                 thread.hits
                 |> List.map (fun hit ->
                        Printf.sprintf "- %s%s: %s" hit.hit_kind
                          (match hit.hit_tool_name with
                          | None -> ""
                          | Some tool -> "/" ^ tool)
                          hit.hit_snippet)
                 |> String.concat "\n"
               in
               Printf.sprintf "[%d] %s\nID: %s\nHits: %d%s%s" (index + 1)
                 thread.title thread.id (List.length thread.hits)
                 (match thread.workspace with
                 | None -> ""
                 | Some workspace -> "\nWorkspace: " ^ workspace)
                 (if hits = "" then "" else "\n" ^ hits))
        |> String.concat "\n\n"
  in
  { text; ok = true; query = request.query; scope = request.scope; threads; diagnostics = catalog.diagnostics }

let read ~id (catalog : catalog) =
  match List.filter (fun (thread : thread) -> thread.id = id) catalog.threads with
  | [ thread ] -> Found thread
  | _ :: _ -> Ambiguous [ id ]
  | [] -> (
      let matches =
        List.filter (fun (thread : thread) -> starts_with thread.id id) catalog.threads
      in
      match matches with
      | [] -> Not_found
      | [ thread ] -> Found thread
      | threads -> Ambiguous (List.map (fun (thread : thread) -> thread.id) threads))

let entry_label (entry : visible_entry) =
  let who =
    match (entry.role, entry.tool_name) with
    | Some role, Some tool -> role ^ "/" ^ tool
    | Some role, None -> role
    | None, Some tool -> entry.kind ^ "/" ^ tool
    | None, None -> entry.kind
  in
  match entry.timestamp with None -> who | Some timestamp -> timestamp ^ " " ^ who

let entry_line ?(target = false) (entry : visible_entry) =
  let prefix = if target then ">> " else "- " in
  prefix ^ entry_label entry ^ ": " ^ snippet entry.text

let overview_text (thread : thread) entries =
  let summaries =
    [
      Option.map (fun value -> "Goal: " ^ value) thread.goal_summary;
      Option.map (fun value -> "Branch: " ^ value) thread.branch_summary;
      Option.map (fun value -> "Compaction: " ^ value) thread.compaction_summary;
    ]
    |> List.filter_map Fun.id
  in
  let facts =
    [
      "Thread: " ^ thread.title;
      "ID: " ^ thread.id;
      (match thread.workspace with None -> "" | Some workspace -> "Workspace: " ^ workspace);
      (match thread.started_at with None -> "" | Some value -> "Started: " ^ value);
      (match thread.updated_at with None -> "" | Some value -> "Updated: " ^ value);
    ]
    |> List.filter (( <> ) "")
  in
  String.concat "\n"
    (facts @ summaries
    @ [ "Recent visible entries:" ]
    @ (if entries = [] then [ "(none)" ] else List.map entry_line entries))

let cursor_prefix = "thread-v1:"

let encode_cursor thread_id index =
  cursor_prefix ^ thread_id ^ ":" ^ string_of_int index

let decode_cursor cursor =
  if not (starts_with cursor cursor_prefix) then None
  else
    let rest =
      String.sub cursor (String.length cursor_prefix)
        (String.length cursor - String.length cursor_prefix)
    in
    match List.rev (String.split_on_char ':' rest) with
    | index :: id_parts -> (
        match int_of_string_opt index with
        | Some index -> Some (String.concat ":" (List.rev id_parts), index)
        | None -> None)
    | _ -> None

let find_entry_index request (thread : thread) =
  let locator = request.locator in
  let target_entry_id =
    match request.entry_id with
    | Some _ as value -> value
    | None -> Option.bind locator (fun locator -> locator.locator_entry_id)
  in
  let target_line =
    match request.line with
    | Some _ as value -> value
    | None -> Option.bind locator (fun locator -> locator.locator_line)
  in
  match target_entry_id with
  | Some entry_id -> (
      List.find_index
        (fun (entry : visible_entry) -> entry.entry_id = Some entry_id)
        thread.entries)
  | None -> (
      match target_line with
      | Some line ->
          List.find_index (fun (entry : visible_entry) -> entry.line = Some line) thread.entries
      | None -> None)

let plan_read ~id (request : read_request) (catalog : catalog) =
  match read ~id catalog with
  | Not_found ->
      {
        text = "Thread \"" ^ id ^ "\" not found.";
        ok = false;
        thread = None;
        entries = [];
        diagnostics = catalog.diagnostics;
        ambiguous = false;
        matches = [];
        mode = read_mode_to_string request.mode;
        cursor = None;
        truncation = [];
      }
  | Ambiguous ids ->
      {
        text = "Thread ID \"" ^ id ^ "\" is ambiguous:\n" ^ String.concat "\n" ids;
        ok = false;
        thread = None;
        entries = [];
        diagnostics = catalog.diagnostics;
        ambiguous = true;
        matches = ids;
        mode = read_mode_to_string request.mode;
        cursor = None;
        truncation = [];
      }
  | Found thread -> (
      let diagnostics = catalog.diagnostics @ thread.diagnostics in
      match request.mode with
      | Overview ->
          let entries =
            thread.entries |> List.rev |> take 10 |> List.rev
          in
          {
            text = overview_text thread entries;
            ok = true;
            thread = Some (summarize thread);
            entries;
            diagnostics;
            ambiguous = false;
            matches = [];
            mode = "overview";
            cursor = None;
            truncation = [];
          }
      | Window -> (
          match find_entry_index request thread with
          | None ->
              {
                text = "Thread entry locator was not found.";
                ok = false;
                thread = Some (summarize thread);
                entries = [];
                diagnostics;
                ambiguous = false;
                matches = [];
                mode = "window";
                cursor = None;
                truncation = [];
              }
          | Some index ->
              let start = max 0 (index - request.around) in
              let stop = min (List.length thread.entries - 1) (index + request.around) in
              let entries =
                thread.entries
                |> List.mapi (fun i entry -> (i, entry))
                |> List.filter_map (fun (i, entry) ->
                       if i >= start && i <= stop then Some entry else None)
              in
              let text =
                Printf.sprintf "Thread: %s\nID: %s\nWindow around entry %d:\n%s"
                  thread.title thread.id (index + 1)
                  (entries
                  |> List.mapi (fun offset entry ->
                         entry_line ~target:(start + offset = index) entry)
                  |> String.concat "\n")
              in
              {
                text;
                ok = true;
                thread = Some (summarize thread);
                entries;
                diagnostics;
                ambiguous = false;
                matches = [];
                mode = "window";
                cursor = None;
                truncation = [];
              })
      | Full ->
          let cursor_error =
            match request.cursor with
            | None -> None
            | Some cursor -> (
                match decode_cursor cursor with
                | Some (thread_id, _index) when thread_id = thread.id -> None
                | Some (thread_id, _index) ->
                    Some
                      ("read_thread cursor belongs to thread \"" ^ thread_id
                     ^ "\", not \"" ^ thread.id ^ "\".")
                | None -> Some "read_thread cursor is invalid.")
          in
          (match cursor_error with
          | Some message ->
              {
                text = message;
                ok = false;
                thread = Some (summarize thread);
                entries = [];
                diagnostics;
                ambiguous = false;
                matches = [];
                mode = "full";
                cursor = None;
                truncation = [];
              }
          | None ->
              let start =
                match request.cursor with
                | Some cursor -> (
                    match decode_cursor cursor with
                    | Some (_thread_id, index) -> max 0 index
                    | None -> 0)
                | None -> 0
              in
              let max_entries = 80 in
              let entries =
                thread.entries
                |> List.mapi (fun i entry -> (i, entry))
                |> List.filter_map (fun (i, entry) ->
                       if i >= start && i < start + max_entries then Some entry
                       else None)
              in
              let next_index = start + List.length entries in
              let has_more = next_index < List.length thread.entries in
              let cursor =
                if has_more then Some (encode_cursor thread.id next_index) else None
              in
              let text =
                Printf.sprintf
                  "Thread: %s\nID: %s\nTranscript entries %d-%d of %d:\n%s%s"
                  thread.title thread.id
                  (if entries = [] then 0 else start + 1)
                  next_index (List.length thread.entries)
                  (if entries = [] then "(none)"
                   else entries |> List.map entry_line |> String.concat "\n")
                  (match cursor with
                  | None -> ""
                  | Some cursor -> "\nMore entries available. Cursor: " ^ cursor)
              in
              {
                text;
                ok = true;
                thread = Some (summarize thread);
                entries;
                diagnostics;
                ambiguous = false;
                matches = [];
                mode = "full";
                cursor;
                truncation =
                  (if has_more then
                     [
                       ("truncated", "true");
                       ("nextCursor", Option.value cursor ~default:"");
                     ]
                   else [ ("truncated", "false") ]);
              }))

let current_source_json ~cwd ~session_id ~branch ~entries =
  Shared.Object
    [
      ("kind", Shared.String "current");
      ("cwd", Shared.String cwd);
      ("sessionId", Shared.String (if session_id = "" then "current" else session_id));
      ("branch", branch);
      ("entries", entries);
    ]

let unique_by_id threads =
  let catalog = unique_catalog (List.map (fun thread -> Ok thread) threads) in
  catalog.threads

let message_content (thread : thread) =
  [
    thread.goal_summary;
    thread.branch_summary;
    thread.compaction_summary;
  ]
  |> List.filter_map Fun.id
  |> fun summaries ->
  summaries
  @ List.map (fun message -> message.content) thread.messages
  |> String.concat "\n"

let find ~workspace ~query threads =
  let catalog = { threads; diagnostics = [] } in
  match prepare_query_request ~scope:"all" query with
  | Error _ -> []
  | Ok request ->
      plan_query ~workspace request catalog
      |> fun result ->
      result.threads
      |> List.filter_map (fun summary ->
             List.find_opt (fun (thread : thread) -> thread.id = summary.id) threads)

let transcript ?(goal_only = false) (thread : thread) =
  let summaries =
    [
      thread.goal_summary;
      (if goal_only then None else thread.branch_summary);
      (if goal_only then None else thread.compaction_summary);
    ]
    |> List.filter_map Fun.id
  in
  let messages =
    if goal_only then []
    else
      List.map
        (fun (message : message) -> Printf.sprintf "%s: %s" message.role message.content)
        thread.messages
  in
  String.concat "\n" (summaries @ messages)

let plan_find ~workspace ~query threads =
  let catalog = { threads; diagnostics = [] } in
  match prepare_query_request query with
  | Error message ->
      { text = message; ok = false; query; scope = "current_workspace"; threads = []; diagnostics = [] }
  | Ok request -> plan_query ~workspace request catalog

let plan_read_legacy ~id ~goal_only:_ threads =
  let catalog = { threads; diagnostics = [] } in
  let request =
    {
      thread_id = id;
      locator = None;
      entry_id = None;
      line = None;
      mode = Full;
      around = 3;
      cursor = None;
    }
  in
  plan_read ~id request catalog

let tool_specs =
  [
    { Tool_gateway.name = "query_threads"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "read_thread"; effect_kind = Tool_gateway.Pure };
  ]
