type message = {
  role : string;
  content : string;
}

type visible_entry = {
  entry_id : string option;
  line : int option;
  timestamp : string option;
  role : string option;
  kind : string;
  tool_name : string option;
  text : string;
}

type diagnostic = {
  source_path : string option;
  line : int option;
  message : string;
}

type thread = {
  id : string;
  title : string;
  workspace : string option;
  messages : message list;
  goal_summary : string option;
  branch_summary : string option;
  compaction_summary : string option;
  source_path : string option;
  started_at : string option;
  updated_at : string option;
  entries : visible_entry list;
  diagnostics : diagnostic list;
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

type catalog = {
  threads : thread list;
  diagnostics : diagnostic list;
}

type locator = {
  locator_thread_id : string;
  locator_source_path : string option;
  locator_entry_id : string option;
  locator_line : int option;
}

type hit = {
  hit_locator : locator;
  hit_kind : string;
  hit_field : string;
  hit_role : string option;
  hit_tool_name : string option;
  hit_timestamp : string option;
  hit_snippet : string;
}

type thread_summary = {
  id : string;
  title : string;
  workspace : string option;
  message_count : int;
  source_path : string option;
  goal_summary : string option;
  branch_summary : string option;
  compaction_summary : string option;
  hits : hit list;
}

type query_result = {
  text : string;
  ok : bool;
  query : string;
  scope : string;
  threads : thread_summary list;
  diagnostics : diagnostic list;
}

type read_mode =
  | Overview
  | Window
  | Full

type read_request_input = {
  thread_id : string option;
  locator_thread_id : string option;
  locator_source_path : string option;
  locator_entry_id : string option;
  locator_line : int option;
  entry_id : string option;
  line : int option;
  mode : string option;
  around : int option;
  cursor : string option;
}

type read_request = {
  thread_id : string;
  locator : locator option;
  entry_id : string option;
  line : int option;
  mode : read_mode;
  around : int;
  cursor : string option;
}

type read_tool_result = {
  text : string;
  ok : bool;
  thread : thread_summary option;
  entries : visible_entry list;
  diagnostics : diagnostic list;
  ambiguous : bool;
  matches : string list;
  mode : string;
  cursor : string option;
  truncation : (string * string) list;
}

type query_request = {
  query : string;
  limit : int;
  scope : string;
  include_tools : bool;
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
let default_catalog_scan_suffixes = [ ".jsonl"; ".json" ]

let catalog_scans ?override ~cwd ~home () =
  catalog_roots ?override ~cwd ~home ()
  |> List.concat_map (fun root ->
         List.map
           (fun suffix ->
             {
               root;
               max_depth = default_catalog_scan_max_depth;
               max_files = default_catalog_scan_max_files;
               suffix;
             })
           default_catalog_scan_suffixes)

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

let starts_with value prefix =
  let value_len = String.length value in
  let prefix_len = String.length prefix in
  prefix_len <= value_len && String.sub value 0 prefix_len = prefix

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

let drop_suffix suffix value =
  let suffix_len = String.length suffix in
  let value_len = String.length value in
  if value_len >= suffix_len
     && String.sub value (value_len - suffix_len) suffix_len = suffix
  then String.sub value 0 (value_len - suffix_len)
  else value

let thread_id_from_path path =
  path |> basename |> drop_suffix ".jsonl" |> drop_suffix ".json"

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

let int_field name json =
  match object_field name json with
  | Some (Shared.Number value) when Float.is_finite value -> Some (int_of_float value)
  | _ -> None

let array_field name json =
  match object_field name json with Some (Shared.Array values) -> values | _ -> []

let rec content_to_visible_text = function
  | Shared.String value -> value
  | Shared.Array values ->
      values
      |> List.filter_map (function
           | Shared.String value -> Some value
           | Shared.Object _ as json -> (
               match string_field "type" json with
               | Some ("thinking" | "reasoning") -> None
               | Some "text" -> string_field "text" json
               | _ -> string_field "text" json)
           | _ -> None)
      |> String.concat "\n"
  | Shared.Object _ as json -> (
      match string_field "type" json with
      | Some ("thinking" | "reasoning") -> ""
      | _ -> (match string_field "text" json with Some value -> value | None -> ""))
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
        content_to_visible_text
          (object_field "content" json
          |> fun value -> option_or_else value (object_field "text" json)
          |> Option.value ~default:Shared.Null)
  | _ -> content_to_visible_text json

let matches_summary_kind kind value =
  match kind with
  | `Branch -> contains value "branch"
  | `Compaction -> contains value "compaction" || contains value "compact"
  | `Goal -> contains value "goal"

let summary_from_entries entries kind =
  let rec loop = function
    | [] -> None
    | entry :: rest ->
        let custom_type =
          string_from_fields entry [ "customType"; "custom_type"; "type"; "kind" ]
        in
        let direct = summary_candidate_text entry in
        if direct <> ""
           && (matches_summary_kind kind custom_type
              || matches_summary_kind kind direct)
        then Some direct
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
          if text <> "" then Some text else loop rest
  in
  loop entries

let safe_prefix max_bytes value =
  if String.length value <= max_bytes then value
  else
    let rec boundary index =
      if index <= 0 then 0
      else
        let code = Char.code value.[index] in
        if code land 0b1100_0000 = 0b1000_0000 then boundary (index - 1)
        else index
    in
    String.sub value 0 (boundary max_bytes)

let take n values =
  let rec loop acc remaining = function
    | [] -> List.rev acc
    | _ when remaining <= 0 -> List.rev acc
    | value :: rest -> loop (value :: acc) (remaining - 1) rest
  in
  loop [] n values

let bounded_text ~max_lines ~max_bytes text =
  let lines = String.split_on_char '\n' text in
  let clipped_by_lines = List.length lines > max_lines in
  let text = lines |> take max_lines |> String.concat "\n" in
  let clipped_by_bytes = String.length text > max_bytes in
  let text = if clipped_by_bytes then safe_prefix max_bytes text else text in
  let omitted = clipped_by_lines || clipped_by_bytes in
  if omitted then
    if text = "" then "… omitted"
    else text ^ "\n… omitted"
  else text

let snippet text = bounded_text ~max_lines:5 ~max_bytes:1024 text

let make_entry ?entry_id ?line ?timestamp ?role ?tool_name kind text =
  {
    entry_id;
    line;
    timestamp;
    role;
    kind;
    tool_name;
    text = String.trim text;
  }

let compact_json json = Shared.encode_json json

let tool_arguments_text json =
  match
    object_field "arguments" json
    |> fun value -> option_or_else value (object_field "args" json)
  with
  | Some (Shared.String value) -> value
  | Some value -> compact_json value
  | None -> ""

let content_item_entries ?entry_id ?line ?timestamp ?role item =
  match item with
  | Shared.String value -> [ make_entry ?entry_id ?line ?timestamp ?role "message" value ]
  | Shared.Object _ as json -> (
      match string_field "type" json with
      | Some ("thinking" | "reasoning") -> []
      | Some "toolCall" ->
          let tool_name = string_from_fields json [ "name"; "toolName"; "tool_name" ] in
          let args = tool_arguments_text json in
          let text =
            if args = "" then tool_name else String.concat "\n" [ tool_name; args ]
          in
          [ make_entry ?entry_id ?line ?timestamp ?role ~tool_name "tool_call" text ]
      | Some "toolResult" ->
          let tool_name = string_from_fields json [ "name"; "toolName"; "tool_name" ] in
          let text = content_to_visible_text (Option.value (object_field "content" json) ~default:json) in
          [ make_entry ?entry_id ?line ?timestamp ?role ~tool_name "tool_result" text ]
      | Some "text" -> (
          match string_field "text" json with
          | Some value -> [ make_entry ?entry_id ?line ?timestamp ?role "message" value ]
          | None -> [])
      | _ -> (
          match string_field "text" json with
          | Some value -> [ make_entry ?entry_id ?line ?timestamp ?role "message" value ]
          | None -> []))
  | _ -> []

let message_entries ?entry_id ?line ?timestamp role message =
  let content =
    object_field "content" message
    |> fun value -> option_or_else value (object_field "text" message)
    |> fun value -> option_or_else value (object_field "message" message)
    |> fun value -> option_or_else value (object_field "body" message)
    |> Option.value ~default:Shared.Null
  in
  let tool_name = string_from_fields message [ "toolName"; "tool_name"; "name" ] in
  match role with
  | "toolResult" | "tool" ->
      [
        make_entry ?entry_id ?line ?timestamp ~role
          ?tool_name:(if tool_name = "" then None else Some tool_name)
          "tool_result"
          (content_to_visible_text content);
      ]
  | _ -> (
      match content with
      | Shared.Array values ->
          List.concat_map (content_item_entries ?entry_id ?line ?timestamp ~role) values
      | value -> content_item_entries ?entry_id ?line ?timestamp ~role value)

let event_entries ?line event =
  let entry_id =
    match string_from_fields event [ "id"; "entryId"; "entry_id" ] with
    | "" -> None
    | value -> Some value
  in
  let timestamp =
    match string_from_fields event [ "timestamp"; "createdAt"; "created_at" ] with
    | "" -> None
    | value -> Some value
  in
  match string_field "type" event with
  | Some "message" ->
      let message =
        match object_field "message" event with
        | Some (Shared.Object _ as message) -> message
        | _ -> event
      in
      let role = string_from_fields message [ "role"; "author"; "speaker" ] in
      if role = "" then [] else message_entries ?entry_id ?line ?timestamp role message
  | Some "custom_message" | Some "custom" -> (
      let custom_type =
        string_from_fields event [ "customType"; "custom_type"; "kind" ]
      in
      let content =
        string_from_fields event [ "content"; "text"; "message"; "body" ]
      in
      if content <> "" && custom_type = "notification" then
        [ make_entry ?entry_id ?line ?timestamp "notification" content ]
      else [])
  | _ -> []

let messages_from_entries entries =
  entries
  |> List.filter_map (fun entry ->
         match entry.role with
         | Some ("user" | "assistant" as role) when entry.kind = "message" ->
             Some { role; content = entry.text }
         | _ -> None)

let diagnostic ?source_path ?line message = { source_path; line; message }

let jsonl_thread_of_text ~path text : (thread, diagnostic list) result =
  let lines = String.split_on_char '\n' text in
  let session_id = ref None in
  let workspace = ref None in
  let started_at = ref None in
  let updated_at = ref None in
  let entries = ref [] in
  let json_entries = ref [] in
  let diagnostics = ref [] in
  lines
  |> List.iteri (fun index line_text ->
         let line_number = index + 1 in
         if String.trim line_text <> "" then
           match Shared.decode_json_string line_text with
           | Error message ->
               diagnostics :=
                 diagnostic ~source_path:path ~line:line_number
                   ("invalid JSONL entry: " ^ message)
                 :: !diagnostics
           | Ok (Shared.Object _ as json) ->
               json_entries := json :: !json_entries;
               (match string_field "type" json with
               | Some "session" ->
                   let id =
                     string_from_fields json
                       [ "id"; "threadId"; "thread_id"; "sessionId"; "session_id" ]
                   in
                   if id <> "" then session_id := Some id;
                   let cwd = string_from_fields json [ "cwd"; "workspace"; "workdir" ] in
                   if cwd <> "" then workspace := Some cwd;
                   let timestamp = string_from_fields json [ "timestamp"; "createdAt"; "created_at" ] in
                   if timestamp <> "" then started_at := Some timestamp
               | _ -> ());
               let event_timestamp =
                 string_from_fields json [ "timestamp"; "createdAt"; "created_at" ]
               in
               if event_timestamp <> "" then updated_at := Some event_timestamp;
               entries := event_entries ~line:line_number json @ !entries
           | Ok _ ->
               diagnostics :=
                 diagnostic ~source_path:path ~line:line_number
                   "invalid JSONL entry: expected object"
                 :: !diagnostics);
  let id = Option.value !session_id ~default:(thread_id_from_path path) in
  if id = "" then Error [ diagnostic ~source_path:path "thread source has no usable id" ]
  else
    let entries = List.rev !entries in
    let json_entries = List.rev !json_entries in
    let title = match !workspace with Some cwd -> basename cwd | None -> id in
    Ok
      {
        id;
        title;
        workspace = !workspace;
        messages = messages_from_entries entries;
        goal_summary = summary_from_entries json_entries `Goal;
        branch_summary = summary_from_entries json_entries `Branch;
        compaction_summary = summary_from_entries json_entries `Compaction;
        source_path = Some path;
        started_at = !started_at;
        updated_at = !updated_at;
        entries;
        diagnostics = List.rev !diagnostics;
      }

let legacy_thread_of_json ~path json : thread option =
  match json with
  | Shared.Object _ ->
      let id =
        match
          string_from_fields json
            [ "id"; "threadId"; "thread_id"; "sessionId"; "session_id" ]
        with
        | "" -> thread_id_from_path path
        | value -> value
      in
      if id = "" then None
      else
        let workspace = string_from_fields json [ "cwd"; "workspace"; "workdir" ] in
        let title =
          match string_from_fields json [ "title"; "name"; "preview" ] with
          | "" when workspace <> "" -> basename workspace
          | "" -> id
          | value -> value
        in
        let raw_messages =
          object_field "messages" json
          |> fun value -> option_or_else value (object_field "branch" json)
          |> fun value -> option_or_else value (object_field "entries" json)
          |> fun value -> option_or_else value (object_field "turns" json)
          |> Option.value ~default:Shared.Null
        in
        let summary_entries = array_field "entries" json @ array_field "branch" json in
        let entries =
          match raw_messages with
          | Shared.Array values ->
              values
              |> List.mapi (fun index value ->
                     let message =
                       match object_field "message" value with
                       | Some (Shared.Object _ as message) -> message
                       | _ -> value
                     in
                     let role = string_from_fields message [ "role"; "author"; "speaker" ] in
                     if role = "" then []
                     else message_entries ~line:(index + 1) role message)
              |> List.concat
          | _ -> []
        in
        Some
          {
            id;
            title;
            workspace = (if workspace = "" then None else Some workspace);
            messages = messages_from_entries entries;
            goal_summary =
              (string_field "goalSummary" json
              |> fun value -> option_or_else value (string_field "goal_summary" json)
              |> fun value -> option_or_else value (summary_from_entries summary_entries `Goal));
            branch_summary =
              (string_field "branchSummary" json
              |> fun value -> option_or_else value (string_field "branch_summary" json)
              |> fun value -> option_or_else value (summary_from_entries summary_entries `Branch));
            compaction_summary =
              (string_field "compactionSummary" json
              |> fun value -> option_or_else value (string_field "compaction_summary" json)
              |> fun value -> option_or_else value (string_field "compactSummary" json)
              |> fun value -> option_or_else value (summary_from_entries summary_entries `Compaction));
            source_path = Some path;
            started_at = string_field "timestamp" json;
            updated_at = string_field "updatedAt" json;
            entries;
            diagnostics = [];
          }
  | _ -> None

let thread_of_source_json json : (thread, diagnostic list) result =
  match string_field "kind" json with
  | Some "diagnostic" ->
      let path = string_from_fields json [ "path"; "file" ] in
      let message = string_from_fields json [ "error"; "message" ] in
      Error
        [
          diagnostic
            ?source_path:(if path = "" then None else Some path)
            (if message = "" then "thread source is unreadable" else message);
        ]
  | Some "sessionFile" ->
      let path = string_from_fields json [ "path"; "file" ] in
      let text = string_from_fields json [ "text"; "contents"; "content" ] in
      if path = "" then Error [ diagnostic "thread source is missing path" ]
      else if text = "" then
        Error [ diagnostic ~source_path:path "thread source is empty or unreadable" ]
      else if Filename.check_suffix path ".jsonl" then jsonl_thread_of_text ~path text
      else (
        match Shared.decode_json_string text with
        | Ok json -> (
            match legacy_thread_of_json ~path json with
            | Some thread -> Ok thread
            | None -> Error [ diagnostic ~source_path:path "thread source has no usable id" ])
        | Error message -> Error [ diagnostic ~source_path:path message ])
  | _ -> (
      match legacy_thread_of_json ~path:"" json with
      | Some thread -> Ok thread
      | None -> Error [ diagnostic "thread source has no usable id" ])

let unique_catalog (parsed : (thread, diagnostic list) result list) : catalog =
  let by_id : (string, thread) Hashtbl.t = Hashtbl.create 16 in
  let diagnostics = ref [] in
  let add_thread (thread : thread) =
    match Hashtbl.find_opt by_id thread.id with
    | None -> Hashtbl.add by_id thread.id thread
    | Some existing when existing.source_path = thread.source_path -> ()
    | Some _ ->
        diagnostics :=
          diagnostic ?source_path:thread.source_path
            ("duplicate threadID from distinct sources: " ^ thread.id)
          :: !diagnostics
  in
  List.iter
    (function
      | Ok (thread : thread) ->
          diagnostics := thread.diagnostics @ !diagnostics;
          add_thread thread
      | Error source_diagnostics ->
          diagnostics := source_diagnostics @ !diagnostics)
    parsed;
  let catalog_threads : thread list =
    Hashtbl.to_seq_values by_id |> List.of_seq
    |> List.sort (fun (left : thread) (right : thread) -> compare left.id right.id)
  in
  ({ threads = catalog_threads; diagnostics = List.rev !diagnostics } : catalog)

let catalog_of_sources sources =
  sources |> List.map thread_of_source_json |> unique_catalog
