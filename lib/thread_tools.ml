type message = {
  role : string;
  content : string;
}

type thread = {
  id : string;
  title : string;
  workspace : string option;
  messages : message list;
  goal_summary : string option;
  branch_summary : string option;
  compaction_summary : string option;
}

type read_result =
  | Found of thread
  | Not_found
  | Ambiguous of string list

type catalog_scan = {
  root : string;
  max_depth : int;
  max_files : int;
  suffix : string;
}

let join_path root suffix =
  let root =
    let rec trim_end index =
      if index <= 0 then ""
      else if root.[index - 1] = '/' then trim_end (index - 1)
      else String.sub root 0 index
    in
    trim_end (String.length root)
  in
  if root = "" then suffix else root ^ "/" ^ suffix

let catalog_roots ?override ~cwd ~home () =
  let push root roots =
    let root = String.trim root in
    if root = "" || List.mem root roots then roots else roots @ [ root ]
  in
  let roots =
    match override with
    | Some root -> push root []
    | None -> []
  in
  let roots =
    if String.trim cwd = "" then roots
    else
      roots
      |> push (join_path cwd ".pi/sessions")
      |> push (join_path cwd ".pi/agent/sessions")
  in
  if String.trim home = "" then roots
  else
    roots
    |> push (join_path home ".pi/agent/sessions")
    |> push (join_path home ".pi/sessions")

let default_catalog_scan_max_depth = 4
let default_catalog_scan_max_files = 200
let default_catalog_scan_suffix = ".json"

let catalog_scans ?override ~cwd ~home () =
  catalog_roots ?override ~cwd ~home ()
  |> List.map (fun root ->
         {
           root;
           max_depth = default_catalog_scan_max_depth;
           max_files = default_catalog_scan_max_files;
           suffix = default_catalog_scan_suffix;
         })

let contains haystack needle =
  let haystack = String.lowercase_ascii haystack in
  let needle = String.lowercase_ascii needle in
  let haystack_len = String.length haystack in
  let needle_len = String.length needle in
  let rec loop index =
    if needle_len = 0 then true
    else if index + needle_len > haystack_len then false
    else if String.sub haystack index needle_len = needle then true
    else loop (index + 1)
  in
  loop 0

let basename path =
  let trimmed =
    let rec trim_end index =
      if index <= 0 then ""
      else if path.[index - 1] = '/' then trim_end (index - 1)
      else String.sub path 0 index
    in
    trim_end (String.length path)
  in
  match List.rev (String.split_on_char '/' trimmed) with
  | name :: _ when name <> "" -> name
  | _ -> if trimmed = "" then "current" else trimmed

let drop_json_suffix value =
  let suffix = ".json" in
  let suffix_len = String.length suffix in
  let value_len = String.length value in
  if value_len >= suffix_len
     && String.sub value (value_len - suffix_len) suffix_len = suffix
  then String.sub value 0 (value_len - suffix_len)
  else value

let object_field name = function
  | Shared.Object fields -> List.assoc_opt name fields
  | _ -> None

let option_or_else left right =
  match left with Some _ -> left | None -> right

let string_field name json =
  match object_field name json with Some (Shared.String value) -> Some value | _ -> None

let string_from_fields json names =
  List.find_map
    (fun name ->
      match string_field name json with
      | Some value when value <> "" -> Some value
      | _ -> None)
    names
  |> Option.value ~default:""

let array_field name json =
  match object_field name json with Some (Shared.Array values) -> values | _ -> []

let rec content_to_text = function
  | Shared.String value -> value
  | Shared.Array values ->
      values
      |> List.filter_map (function
           | Shared.String value -> Some value
           | Shared.Object _ as json -> (
               match string_field "text" json with
               | Some value -> Some value
               | None -> None)
           | _ -> None)
      |> String.concat "\n"
  | Shared.Object _ as json -> (
      match string_field "text" json with Some value -> value | None -> "")
  | Shared.Null | Bool _ | Number _ -> ""

let summary_candidate_text json =
  match json with
  | Shared.String value -> value
  | Shared.Object _ ->
      let direct =
        string_from_fields json
          [
            "summary";
            "text";
            "content";
            "message";
            "body";
            "branchSummary";
            "branch_summary";
            "compactionSummary";
            "compaction_summary";
            "compactSummary";
            "goalSummary";
            "goal_summary";
          ]
      in
      if direct <> "" then direct
      else
        content_to_text
          (Option.value
             (object_field "content" json
             |> fun value -> option_or_else value (object_field "text" json)
             |> fun value -> option_or_else value (object_field "message" json))
             ~default:Shared.Null)
  | _ -> content_to_text json

let matches_summary_kind kind value =
  match kind with
  | `Branch -> contains value "branch"
  | `Compaction -> contains value "compaction" || contains value "compact"
  | `Goal -> contains value "goal"

let summary_from_entries entries kind =
  let rec loop = function
    | [] -> ""
    | entry :: rest ->
        let custom_type =
          string_from_fields entry [ "customType"; "custom_type"; "type"; "kind" ]
        in
        let direct = summary_candidate_text entry in
        if direct <> ""
           && (matches_summary_kind kind custom_type
              || matches_summary_kind kind direct)
        then direct
        else if not (matches_summary_kind kind custom_type) then loop rest
        else
          let data =
            object_field "data" entry
            |> fun value -> option_or_else value (object_field "value" entry)
            |> fun value -> option_or_else value (object_field "payload" entry)
            |> fun value -> option_or_else value (object_field "summary" entry)
            |> Option.value ~default:Shared.Null
          in
          let text = summary_candidate_text data in
          if text <> "" then text else loop rest
  in
  loop entries

let message_json entry =
  match object_field "message" entry with Some (Shared.Object _ as message) -> message | _ -> entry

let messages_from_json json =
  let values = match json with Shared.Array values -> values | _ -> [] in
  values
  |> List.filter_map (fun entry ->
         let message = message_json entry in
         let role = string_from_fields message [ "role"; "author"; "speaker" ] in
         let content =
           object_field "content" message
           |> fun value -> option_or_else value (object_field "text" message)
           |> fun value -> option_or_else value (object_field "message" message)
           |> fun value -> option_or_else value (object_field "body" message)
           |> Option.value ~default:Shared.Null
           |> content_to_text
         in
         if role = "" && content = "" then None else Some { role; content })

let normalized_thread_of_json json =
  let id = string_from_fields json [ "id"; "threadId"; "thread_id"; "sessionId"; "session_id" ] in
  if id = "" then None
  else
    let workspace = string_from_fields json [ "workspace"; "cwd"; "workdir" ] in
    let title =
      match string_from_fields json [ "title"; "name"; "preview" ] with
      | "" when workspace <> "" -> basename workspace
      | "" -> id
      | value -> value
    in
    Some
      {
        id;
        title;
        workspace = (if workspace = "" then None else Some workspace);
        messages = messages_from_json (Option.value (object_field "messages" json) ~default:Shared.Null);
        goal_summary =
          (string_field "goalSummary" json
          |> fun value -> option_or_else value (string_field "goal_summary" json));
        branch_summary =
          (string_field "branchSummary" json
          |> fun value -> option_or_else value (string_field "branch_summary" json));
        compaction_summary =
          (string_field "compactionSummary" json
          |> fun value -> option_or_else value (string_field "compaction_summary" json)
          |> fun value -> option_or_else value (string_field "compactSummary" json));
      }

let thread_of_session_json ~path json =
  match json with
  | Shared.Object _ ->
      let entries = array_field "entries" json in
      let branch = array_field "branch" json in
      let messages =
        let from_messages =
          messages_from_json
            (Option.value (object_field "messages" json) ~default:Shared.Null)
        in
        if from_messages <> [] then from_messages
        else
          let from_branch =
            messages_from_json
              (Option.value (object_field "branch" json) ~default:Shared.Null)
          in
          if from_branch <> [] then from_branch
          else
            let from_entries =
              messages_from_json
                (Option.value (object_field "entries" json) ~default:Shared.Null)
            in
            if from_entries <> [] then from_entries
            else
              messages_from_json
                (Option.value (object_field "turns" json) ~default:Shared.Null)
      in
      let id =
        match
          string_from_fields json
            [ "id"; "threadId"; "thread_id"; "sessionId"; "session_id" ]
        with
        | "" -> path |> basename |> drop_json_suffix
        | value -> value
      in
      let workspace = string_from_fields json [ "cwd"; "workspace"; "workdir" ] in
      let title =
        match string_from_fields json [ "title"; "name"; "preview" ] with
        | "" when workspace <> "" -> basename workspace
        | "" -> id
        | value -> value
      in
      Some
        {
          id;
          title;
          workspace = (if workspace = "" then None else Some workspace);
          messages;
          goal_summary =
            (match
               string_field "goalSummary" json
               |> fun value -> option_or_else value (string_field "goal_summary" json)
             with
            | Some _ as value -> value
            | None -> (
                match summary_from_entries entries `Goal with
                | "" -> (
                    match summary_from_entries branch `Goal with "" -> None | value -> Some value)
                | value -> Some value));
          branch_summary =
            (match
               string_field "branchSummary" json
               |> fun value -> option_or_else value (string_field "branch_summary" json)
             with
            | Some _ as value -> value
            | None -> (
                match summary_from_entries entries `Branch with
                | "" -> (
                    match summary_from_entries branch `Branch with "" -> None | value -> Some value)
                | value -> Some value));
          compaction_summary =
            (match
               string_field "compactionSummary" json
               |> fun value -> option_or_else value (string_field "compaction_summary" json)
               |> fun value -> option_or_else value (string_field "compactSummary" json)
             with
            | Some _ as value -> value
            | None -> (
                match summary_from_entries entries `Compaction with
                | "" -> (
                    match summary_from_entries branch `Compaction with
                    | "" -> None
                    | value -> Some value)
                | value -> Some value));
        }
  | _ -> None

let current_thread_of_source json =
  let cwd = string_from_fields json [ "cwd"; "workspace"; "workdir" ] in
  let id =
    match string_from_fields json [ "sessionId"; "session_id"; "id" ] with
    | "" -> "current"
    | value -> value
  in
  let branch = array_field "branch" json in
  let entries = array_field "entries" json in
  {
    id;
    title = (match string_field "title" json with Some value -> value | None -> basename cwd);
    workspace = (if cwd = "" then None else Some cwd);
    messages =
      messages_from_json
        (Option.value (object_field "branch" json) ~default:Shared.Null);
    goal_summary =
      (match summary_from_entries entries `Goal with
      | "" -> (match summary_from_entries branch `Goal with "" -> None | value -> Some value)
      | value -> Some value);
    branch_summary =
      (match summary_from_entries entries `Branch with
      | "" -> (match summary_from_entries branch `Branch with "" -> None | value -> Some value)
      | value -> Some value);
    compaction_summary =
      (match summary_from_entries entries `Compaction with
      | "" -> (
          match summary_from_entries branch `Compaction with "" -> None | value -> Some value)
      | value -> Some value);
  }

let current_source_json ~cwd ~session_id ~branch ~entries =
  Shared.Object
    [
      ("kind", Shared.String "current");
      ("cwd", Shared.String cwd);
      ("sessionId", Shared.String (if session_id = "" then "current" else session_id));
      ("branch", branch);
      ("entries", entries);
    ]

let thread_of_source_json json =
  match string_field "kind" json with
  | Some "current" -> Some (current_thread_of_source json)
  | Some "sessionFile" ->
      let path = string_from_fields json [ "path"; "file" ] in
      let data = Option.value (object_field "data" json) ~default:Shared.Null in
      thread_of_session_json ~path data
  | _ -> (
      match normalized_thread_of_json json with
      | Some _ as value -> value
      | None -> thread_of_session_json ~path:"" json)

let unique_by_id threads =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | thread :: rest ->
        if List.mem thread.id seen then loop seen acc rest
        else loop (thread.id :: seen) (thread :: acc) rest
  in
  loop [] [] threads

let message_content thread =
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

let score ~workspace query thread =
  let score = ref 0 in
  if thread.id = query then score := !score + 1000;
  if String.length thread.id >= String.length query
     && String.sub thread.id 0 (String.length query) = query
  then score := !score + 400;
  if contains thread.title query then score := !score + 100;
  if contains (message_content thread) query then score := !score + 30;
  if thread.workspace = Some workspace then score := !score + 10;
  !score

let find ~workspace ~query catalog =
  catalog
  |> List.filter_map (fun thread ->
         let score = score ~workspace query thread in
         if score <= 0 then None else Some (score, thread))
  |> List.sort (fun (left_score, left) (right_score, right) ->
         let by_score = compare right_score left_score in
         if by_score <> 0 then by_score
         else
           match (left.workspace = Some workspace, right.workspace = Some workspace) with
           | true, false -> -1
           | false, true -> 1
           | _ -> compare left.id right.id)
  |> List.map snd

let read ~id catalog =
  match List.filter (fun thread -> thread.id = id) catalog with
  | [ thread ] -> Found thread
  | _ :: _ -> Ambiguous [ id ]
  | [] -> (
      let matches =
        List.filter
          (fun thread ->
            String.length thread.id >= String.length id
            && String.sub thread.id 0 (String.length id) = id)
          catalog
      in
      match matches with
      | [] -> Not_found
      | [ thread ] -> Found thread
      | threads -> Ambiguous (List.map (fun thread -> thread.id) threads))

type thread_summary = {
  id : string;
  title : string;
  workspace : string option;
  message_count : int;
}

type tool_result = {
  text : string;
  ok : bool;
  threads : thread_summary list;
  thread : thread_summary option;
  ambiguous : bool;
  matches : string list;
}

type find_request = { query : string }

type read_request_input = {
  thread_id : string option;
  thread_id_snake : string option;
  id : string option;
  goal : string;
}

type read_request = {
  thread_id : string;
  goal : string;
}

let trim_option = function
  | Some value -> Shared.trim_non_empty value
  | None -> None

let prepare_find_request query =
  match Shared.trim_non_empty query with
  | None -> Error "find_thread requires query"
  | Some query -> Ok { query }

let prepare_read_request (input : read_request_input) =
  let thread_id =
    match trim_option input.thread_id with
    | Some _ as value -> value
    | None -> (
        match trim_option input.thread_id_snake with
        | Some _ as value -> value
        | None -> trim_option input.id)
  in
  match thread_id with
  | None -> Error "read_thread requires threadID"
  | Some thread_id -> Ok { thread_id; goal = input.goal }

let find_request_of_json json =
  let tool = "find_thread" in
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields tool json in
  let* query = Shared.json_required_string tool fields "query" in
  prepare_find_request query

let read_request_of_json json =
  let tool = "read_thread" in
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields tool json in
  let* thread_id = Shared.json_optional_string tool fields "threadID" in
  let* thread_id_snake = Shared.json_optional_string tool fields "thread_id" in
  let* id = Shared.json_optional_string tool fields "id" in
  let* goal = Shared.json_string_default tool fields "goal" "" in
  prepare_read_request { thread_id; thread_id_snake; id; goal }

let summarize (thread : thread) =
  {
    id = thread.id;
    title = thread.title;
    workspace = thread.workspace;
    message_count = List.length thread.messages;
  }

let empty_result ?(ok = true) ?(threads = []) ?thread ?(ambiguous = false)
    ?(matches = []) text =
  { text; ok; threads; thread; ambiguous; matches }

let find_line index (thread : thread) =
  Printf.sprintf "[%d] %s\nID: %s\nMessages: %d" (index + 1) thread.title
    thread.id (List.length thread.messages)

let plan_find ~workspace ~query catalog =
  let threads = find ~workspace ~query catalog in
  let text =
    match threads with
    | [] -> "No threads found matching the query."
    | threads -> String.concat "\n\n" (List.mapi find_line threads)
  in
  empty_result ~threads:(List.map summarize threads) text

let transcript ?(goal_only = false) thread =
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
        (fun message -> Printf.sprintf "%s: %s" message.role message.content)
        thread.messages
  in
  String.concat "\n" (summaries @ messages)

let plan_read ~id ~goal_only catalog =
  match read ~id catalog with
  | Not_found -> empty_result ~ok:false ("Thread \"" ^ id ^ "\" not found.")
  | Ambiguous ids ->
      empty_result ~ok:false ~ambiguous:true ~matches:ids
        ("Thread ID \"" ^ id ^ "\" is ambiguous:\n" ^ String.concat "\n" ids)
  | Found thread ->
      empty_result ~thread:(summarize thread) (transcript ~goal_only thread)

let find_parameters =
  Tool_gateway.object_schema ~required:[ "query" ]
    [
      ("query", Tool_gateway.string_schema ~min_length:1 ~max_length:500 ());
    ]

let read_parameters =
  Tool_gateway.object_schema ~required:[ "threadID" ]
    [
      ("threadID", Tool_gateway.string_schema ~min_length:1 ());
      ("goal", Tool_gateway.string_schema ~max_length:500 ());
    ]

let tool_specs =
  [
    {
      Tool_gateway.name = "find_thread";
      description = "Search thread ids, titles, and transcript content.";
      effect_kind = Tool_gateway.Pure;
      strict = false;
      parameters = find_parameters;
    };
    {
      Tool_gateway.name = "read_thread";
      description = "Read a thread by exact id or unique id prefix.";
      effect_kind = Tool_gateway.Pure;
      strict = false;
      parameters = read_parameters;
    };
  ]
