module Threads = Taumel.Thread_tools

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let assert_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let thread ?workspace ?goal_summary id title messages =
  {
    Threads.id;
    title;
    workspace;
    messages;
    goal_summary;
    branch_summary = None;
    compaction_summary = None;
  }

let msg role content = { Threads.role; content }

let catalog =
  [
    thread ~workspace:"/repo" ~goal_summary:"Goal: ship thread search" "abc-1"
      "Thread Search" [ msg "user" "find the session"; msg "assistant" "done" ];
    thread ~workspace:"/other" "abc-2" "Other Work" [ msg "user" "unrelated" ];
    thread ~workspace:"/repo" "xyz-1" "Debug Notes" [ msg "user" "fix bug" ];
  ]

let test_find_plan () =
  let result = Threads.plan_find ~workspace:"/elsewhere" ~query:"thread" catalog in
  assert_bool "find result ok" result.ok;
  assert_equal "find result text"
    "[1] Thread Search\nID: abc-1\nMessages: 2" result.text;
  assert_int "find result count" 1 (List.length result.threads);
  let summary = List.hd result.threads in
  assert_equal "find summary id" "abc-1" summary.id;
  assert_equal "find summary title" "Thread Search" summary.title;
  assert_int "find summary message count" 2 summary.message_count;
  let none = Threads.plan_find ~workspace:"/elsewhere" ~query:"missing" catalog in
  assert_bool "empty find is ok" none.ok;
  assert_equal "empty find text" "No threads found matching the query." none.text;
  assert_int "empty find threads" 0 (List.length none.threads)

let test_read_plan () =
  let found = Threads.plan_read ~id:"xyz" ~goal_only:false catalog in
  assert_bool "read found ok" found.ok;
  assert_equal "read found text" "user: fix bug" found.text;
  (match found.thread with
  | Some summary -> assert_equal "read found summary" "xyz-1" summary.id
  | None -> fail "read found thread" "expected summary");
  let goal = Threads.plan_read ~id:"abc-1" ~goal_only:true catalog in
  assert_bool "read goal ok" goal.ok;
  assert_equal "read goal text" "Goal: ship thread search" goal.text;
  let missing = Threads.plan_read ~id:"nope" ~goal_only:false catalog in
  assert_bool "read missing not ok" (not missing.ok);
  assert_equal "read missing text" "Thread \"nope\" not found." missing.text;
  let ambiguous = Threads.plan_read ~id:"abc" ~goal_only:false catalog in
  assert_bool "read ambiguous not ok" (not ambiguous.ok);
  assert_bool "read ambiguous flag" ambiguous.ambiguous;
  assert_equal "read ambiguous text"
    "Thread ID \"abc\" is ambiguous:\nabc-1\nabc-2" ambiguous.text;
  assert_int "read ambiguous matches" 2 (List.length ambiguous.matches)

let test_request_preparation () =
  (match Threads.prepare_find_request "  needle  " with
  | Ok request -> assert_equal "find request query" "needle" request.query
  | Error message -> fail "find request" message);
  (match Threads.prepare_find_request "  " with
  | Error "find_thread requires query" -> ()
  | Error message -> fail "find request empty" ("unexpected error: " ^ message)
  | Ok _ -> fail "find request empty" "expected error");
  let read =
    match
      Threads.prepare_read_request
        {
          thread_id = None;
          thread_id_snake = Some " prefix ";
          id = Some "fallback";
          goal = " goals ";
        }
    with
    | Ok request -> request
    | Error message -> fail "read request" message
  in
  assert_equal "read request id" "prefix" read.thread_id;
  assert_equal "read request goal" " goals " read.goal;
  (match
     Threads.prepare_read_request
       { thread_id = None; thread_id_snake = None; id = None; goal = "" }
   with
  | Error "read_thread requires threadID" -> ()
  | Error message -> fail "read request empty" ("unexpected error: " ^ message)
  | Ok _ -> fail "read request empty" "expected error")

let () =
  test_find_plan ();
  test_read_plan ();
  test_request_preparation ()
