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
       json_line
         [
           ("type", String "session_info");
           ("id", String "named");
           ("name", String "Renderer investigation");
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
  let locator_thread_id, locator_source_path, locator_entry_id, locator_line =
    match locator with
    | None -> (None, None, None, None)
    | Some (locator : Threads.locator) ->
        ( Some locator.Threads.locator_thread_id,
          locator.locator_source_path,
          locator.locator_entry_id,
          locator.locator_line )
  in
  match
    Threads.prepare_read_request
      {
        thread_id = Some thread_id;
        locator_thread_id;
        locator_source_path;
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
         diagnostic.Threads.line = Some 7
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
  assert_bool "query text exposes exact locator"
    (contains query_result.text
       "Locator: {\"threadID\":\"thread-1\",\"sourcePath\":\"/repo/.pi/agent/sessions/thread-1.jsonl\",\"entryID\":\"03\",\"line\":5.0}");
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
  assert_bool "locator preserves source path"
    (window_request.locator
    = Some
        {
          Threads.locator_thread_id = "thread-1";
          locator_source_path = Some "/repo/.pi/agent/sessions/thread-1.jsonl";
          locator_entry_id = Some "03";
          locator_line = Some 5;
        });
  let full_request = read_request ~mode:"full" "thread-1" in
  let full = Threads.plan_read ~id:full_request.thread_id full_request catalog in
  assert_bool "full ok" full.ok;
  assert_bool "full paginates" (Option.is_some full.cursor);
  let cursor = Option.get full.cursor in
  assert_bool "cursor is opaque" (not (contains cursor "thread-1"));
  assert_bool "cursor hides index" (not (contains cursor ":80"));
  let next_request = read_request ~mode:"full" ~cursor "thread-1" in
  let next = Threads.plan_read ~id:next_request.thread_id next_request catalog in
  assert_bool "cursor page ok" next.ok;
  assert_bool "cursor page reaches tail" (contains next.text "visible transcript line 84");
  assert_bool "full text not raw json" (not (contains full.text "\"message\""))

let test_session_name_is_title () =
  let result = query "renderer investigation" in
  assert_int "named thread found" 1 (List.length result.threads);
  let thread = List.hd result.threads in
  assert_equal "session name title" "Renderer investigation" thread.title;
  let locator = (List.hd thread.hits).Threads.hit_locator in
  let request = read_request ~mode:"window" ~locator "thread-1" in
  let window = Threads.plan_read ~id:request.thread_id request catalog in
  assert_bool "metadata hit locator opens a window" window.ok

let test_request_preparation () =
  (match Threads.prepare_query_request "  needle  " with
  | Ok request -> assert_equal "query request query" "needle" request.query
  | Error message -> fail "query request" message);
  (match Threads.prepare_query_request "  " with
  | Error "query_threads requires query" -> ()
  | Error message -> fail "query request empty" ("unexpected error: " ^ message)
  | Ok _ -> fail "query request empty" "expected error");
  (match Threads.prepare_query_request ~limit:0 "needle" with
  | Error _ -> ()
  | Ok _ -> fail "query limit" "expected error");
  (match Threads.prepare_query_request (String.make 501 'q') with
  | Error "query_threads query must be at most 500 characters" -> ()
  | Error message -> fail "query length" message
  | Ok _ -> fail "query length" "expected error");
  (match
     Threads.prepare_read_request
       {
         thread_id = Some "thread-1";
         locator_thread_id = None;
         locator_source_path = None;
         locator_entry_id = None;
         locator_line = None;
         entry_id = None;
         line = None;
         mode = Some "window";
         around = None;
         cursor = Some (Threads.encode_cursor "thread-1" 10);
       }
   with
  | Error "read_thread window mode requires locator, entryID, or line" -> ()
  | Error message -> fail "window cursor request" ("unexpected error: " ^ message)
  | Ok _ -> fail "window cursor request" "expected error");
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
  | Ok _ -> fail "read request empty" "expected error");
  (match
     Threads.prepare_read_request
       {
         thread_id = Some "thread-1"; locator_thread_id = None;
         locator_source_path = None; locator_entry_id = None; locator_line = None;
         entry_id = None; line = Some 0; mode = Some "overview";
         around = Some 11; cursor = None;
       }
   with
  | Error _ -> ()
  | Ok _ -> fail "read bounds" "expected error");
  (match
     Threads.prepare_read_request
       {
         thread_id = Some "thread-1"; locator_thread_id = Some "thread-2";
         locator_source_path = None; locator_entry_id = Some "entry";
         locator_line = None; entry_id = None; line = None;
         mode = Some "window"; around = None; cursor = None;
       }
   with
  | Error "read_thread threadID must match locator.threadID" -> ()
  | Error message -> fail "read identity" message
  | Ok _ -> fail "read identity" "expected error")

let test_cursor_validation () =
  let invalid_request = read_request ~mode:"full" ~cursor:"not-a-cursor" "thread-1" in
  let invalid = Threads.plan_read ~id:invalid_request.thread_id invalid_request catalog in
  assert_bool "invalid cursor fails" (not invalid.ok);
  assert_bool "invalid cursor explains failure" (contains invalid.text "cursor is invalid");
  let wrong_request =
    read_request ~mode:"full" ~cursor:(Threads.encode_cursor "other-thread" 5) "thread-1"
  in
  let wrong = Threads.plan_read ~id:wrong_request.thread_id wrong_request catalog in
  assert_bool "wrong-thread cursor fails" (not wrong.ok);
  assert_bool "wrong-thread cursor explains failure" (contains wrong.text "other-thread");
  let negative_request =
    read_request ~mode:"full" ~cursor:(Threads.encode_cursor "thread-1" (-1)) "thread-1"
  in
  let negative = Threads.plan_read ~id:negative_request.thread_id negative_request catalog in
  assert_bool "negative cursor fails" (not negative.ok);
  assert_bool "negative cursor invalid" (contains negative.text "cursor is invalid");
  let out_of_range_request =
    read_request ~mode:"full" ~cursor:(Threads.encode_cursor "thread-1" 9999) "thread-1"
  in
  let out_of_range =
    Threads.plan_read ~id:out_of_range_request.thread_id out_of_range_request catalog
  in
  assert_bool "out-of-range cursor fails" (not out_of_range.ok);
  assert_bool "out-of-range cursor explains failure"
    (contains out_of_range.text "out of range")

let () =
  test_query_jsonl_tool_hits ();
  test_hidden_reasoning_not_searched ();
  test_read_modes ();
  test_session_name_is_title ();
  test_request_preparation ();
  test_cursor_validation ()
