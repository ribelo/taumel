module Threads = Taumel.Thread_tools
module Shared = Taumel.Shared
open Shared

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let assert_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let contains haystack needle =
  let haystack = String.lowercase_ascii haystack in
  let needle = String.lowercase_ascii needle in
  let rec loop index =
    if needle = "" then true
    else if index + String.length needle > String.length haystack then false
    else if String.sub haystack index (String.length needle) = needle then true
    else loop (index + 1)
  in
  loop 0

let json_line fields = Shared.encode_json (Shared.Object fields)

let text_part text =
  Shared.Object [ ("type", String "text"); ("text", String text) ]

let message_line ~id ~role ?tool text =
  let message_fields =
    [
      ("role", Shared.String role);
      ("content", Shared.Array [ text_part text ]);
    ]
    @
    match tool with
    | None -> []
    | Some tool -> [ ("toolName", Shared.String tool) ]
  in
  json_line
    [
      ("type", String "message");
      ("id", String id);
      ("timestamp", String ("2026-07-05T00:00:" ^ id ^ "Z"));
      ("message", Object message_fields);
    ]

let hidden_line =
  json_line
    [
      ("type", String "message");
      ("id", String "hidden");
      ("message",
       Object
         [
           ("role", String "assistant");
           ( "content",
             Array
               [
                 Object
                   [
                     ("type", String "thinking");
                     ("thinking", String "secret-needle");
                     ("encrypted_content", String "secret-needle");
                   ];
               ] );
         ]);
    ]

let session_text =
  String.concat "\n"
    ([
       json_line
         [
           ("type", String "session");
           ("id", String "thread-1");
           ("timestamp", String "2026-07-05T00:00:00Z");
           ("cwd", String "/repo");
         ];
       message_line ~id:"01" ~role:"user" "please inspect renderer";
       message_line ~id:"02" ~role:"assistant" "running search";
       message_line ~id:"03" ~role:"toolResult" ~tool:"exec_command"
         "renderer needle appears inside bounded tool output";
       hidden_line;
       "not-json";
     ]
    @ List.init 85 (fun index ->
          message_line ~id:(Printf.sprintf "m%02d" index) ~role:"assistant"
            (Printf.sprintf "visible transcript line %02d" index)))

let source =
  Shared.Object
    [
      ("kind", String "sessionFile");
      ("path", String "/repo/.pi/agent/sessions/thread-1.jsonl");
      ("text", String session_text);
    ]

let catalog = Threads.catalog_of_sources [ source ]

let query query =
  match Threads.prepare_query_request query with
  | Error message -> fail "query prepare" message
  | Ok request -> Threads.plan_query ~workspace:"/repo" request catalog

let read_request ?mode ?locator ?entry_id ?line ?cursor thread_id =
  let locator_thread_id, locator_entry_id, locator_line =
    match locator with
    | None -> (None, None, None)
    | Some (locator : Threads.locator) ->
        ( Some locator.Threads.locator_thread_id,
          locator.locator_entry_id,
          locator.locator_line )
  in
  match
    Threads.prepare_read_request
      {
        thread_id = Some thread_id;
        locator_thread_id;
        locator_source_path = None;
        locator_entry_id;
        locator_line;
        entry_id;
        line;
        mode;
        around = None;
        cursor;
      }
  with
  | Error message -> fail "read prepare" message
  | Ok request -> request

let test_query_jsonl_tool_hits () =
  let result = query "needle" in
  assert_bool "query ok" result.ok;
  assert_int "one thread" 1 (List.length result.threads);
  let thread = List.hd result.threads in
  assert_equal "thread id" "thread-1" thread.id;
  assert_bool "hit snippets include query"
    (List.exists
       (fun hit -> contains hit.Threads.hit_snippet "needle")
       thread.hits);
  assert_bool "invalid line diagnostic recorded"
    (List.exists
       (fun (diagnostic : Threads.diagnostic) ->
         diagnostic.Threads.line = Some 6
         && contains diagnostic.message "invalid jsonl")
       result.diagnostics)

let test_hidden_reasoning_not_searched () =
  let result = query "secret-needle" in
  assert_int "hidden query returns no threads" 0 (List.length result.threads)

let test_read_modes () =
  let query_result = query "needle" in
  let locator =
    match (List.hd query_result.threads).hits with
    | hit :: _ -> hit.Threads.hit_locator
    | [] -> fail "locator" "expected hit locator"
  in
  let overview_request = read_request "thread-1" in
  let overview =
    Threads.plan_read ~id:overview_request.thread_id overview_request catalog
  in
  assert_bool "overview ok" overview.ok;
  assert_equal "overview mode" "overview" overview.mode;
  assert_bool "overview bounded" (List.length overview.entries <= 10);
  assert_bool "overview text not raw json" (not (contains overview.text "\"type\""));
  let window_request = read_request ~mode:"window" ~locator "thread-1" in
  let window = Threads.plan_read ~id:window_request.thread_id window_request catalog in
  assert_bool "window ok" window.ok;
  assert_bool "window marks target" (contains window.text ">> ");
  let full_request = read_request ~mode:"full" "thread-1" in
  let full = Threads.plan_read ~id:full_request.thread_id full_request catalog in
  assert_bool "full ok" full.ok;
  assert_bool "full paginates" (Option.is_some full.cursor);
  assert_bool "full text not raw json" (not (contains full.text "\"message\""))

let test_request_preparation () =
  (match Threads.prepare_query_request "  needle  " with
  | Ok request -> assert_equal "query request query" "needle" request.query
  | Error message -> fail "query request" message);
  (match Threads.prepare_query_request "  " with
  | Error "query_threads requires query" -> ()
  | Error message -> fail "query request empty" ("unexpected error: " ^ message)
  | Ok _ -> fail "query request empty" "expected error");
  (match
     Threads.prepare_read_request
       {
         thread_id = None;
         locator_thread_id = None;
         locator_source_path = None;
         locator_entry_id = None;
         locator_line = None;
         entry_id = None;
         line = None;
         mode = None;
         around = None;
         cursor = None;
       }
   with
  | Error "read_thread requires threadID" -> ()
  | Error message -> fail "read request empty" ("unexpected error: " ^ message)
  | Ok _ -> fail "read request empty" "expected error")

let () =
  test_query_jsonl_tool_hits ();
  test_hidden_reasoning_not_searched ();
  test_read_modes ();
  test_request_preparation ()
