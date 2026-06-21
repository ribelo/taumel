module Goal = Taumel.Goal
module Ralph = Taumel.Ralph_loop
module Shared = Taumel.Shared
module Subagents = Taumel.Subagents
module Threads = Taumel.Thread_tools
module Input = Taumel.Request_user_input

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let expect_ok label = function
  | Ok value -> value
  | Error message -> fail label message

let expect_error label expected = function
  | Error message when message = expected -> ()
  | Error message -> fail label ("expected " ^ expected ^ ", got " ^ message)
  | Ok _ -> fail label "expected error"

let obj fields = Shared.Object fields
let str value = Shared.String value
let num value = Shared.Number value
let bool value = Shared.Bool value
let arr values = Shared.Array values

let test_goal_decoders () =
  let create =
    expect_ok "create goal params"
      (Goal.create_request_of_json
         (obj [ ("objective", str " ship "); ("token_budget", num 100.) ]))
  in
  assert_equal "goal objective parsed" "ship" create.objective;
  assert_bool "goal budget parsed" (create.token_budget = Some 100);
  expect_error "create goal missing objective" "create_goal.objective is required"
    (Goal.create_request_of_json (obj []));
  expect_error "create goal wrong budget"
    "create_goal.token_budget must be a number, got string"
    (Goal.create_request_of_json
       (obj [ ("objective", str "ship"); ("token_budget", str "100") ]));
  let update =
    expect_ok "update goal params"
      (Goal.update_request_of_json (obj [ ("status", str "complete") ]))
  in
  assert_bool "goal status parsed" (update.status = Goal.Complete);
  expect_error "update goal invalid status"
    "update_goal.status must be complete or blocked; other status changes are controlled by the user or system"
    (Goal.update_request_of_json (obj [ ("status", str "active") ]))

let test_thread_decoders () =
  let find =
    expect_ok "find thread params"
      (Threads.find_request_of_json (obj [ ("query", str " needle ") ]))
  in
  assert_equal "thread query trimmed" "needle" find.query;
  expect_error "find query wrong type"
    "find_thread.query must be a string, got number"
    (Threads.find_request_of_json (obj [ ("query", num 1.) ]));
  let read =
    expect_ok "read thread alias params"
      (Threads.read_request_of_json
         (obj [ ("thread_id", str " abc "); ("goal", str "yes") ]))
  in
  assert_equal "thread id parsed" "abc" read.thread_id;
  expect_error "read thread missing id" "read_thread requires threadID"
    (Threads.read_request_of_json (obj []))

let test_request_user_input_decoder () =
  let request =
    expect_ok "request input params"
      (Input.request_of_json
         (obj
            [
              ("autoResolutionMs", num 60000.);
              ( "questions",
                arr
                  [
                    obj
                      [
                        ("id", str "choice");
                        ("header", str "Pick");
                        ("question", str "Choose one");
                        ( "options",
                          arr
                            [
                              obj
                                [
                                  ("label", str "A");
                                  ("description", str "Alpha");
                                ];
                              obj
                                [
                                  ("label", str "B");
                                  ("description", str "Beta");
                                ];
                            ] );
                      ];
                  ] );
            ]))
  in
  assert_bool "request input parsed one question"
    (List.length request.questions = 1);
  expect_error "request input option wrong type"
    "request_user_input.questions[0].options[0].label must be a string, got number"
    (Input.request_of_json
       (obj
          [
            ( "questions",
              arr
                [
                  obj
                    [
                      ("id", str "choice");
                      ("header", str "Pick");
                      ("question", str "Choose one");
                      ( "options",
                        arr
                          [
                            obj
                              [
                                ("label", num 1.);
                                ("description", str "Alpha");
                              ];
                            obj
                              [
                                ("label", str "B");
                                ("description", str "Beta");
                              ];
                          ] );
                    ];
                ] );
          ]))

let test_agent_decoder () =
  let spawn =
    expect_ok "agent spawn params"
      (Subagents.request_of_json ~workspace_roots:[ "/repo" ] ~default_id:"worker-1"
         (obj
            [
              ("action", str "spawn");
              ("agent", str "worker");
              ("prompt", str "inspect");
              ("tools", arr [ str "exec_command" ]);
              ("no_sandbox", bool false);
            ]))
  in
  (match spawn with
  | Subagents.Spawn request ->
      assert_equal "agent default id" "worker-1" request.id;
      assert_equal "agent prompt" "inspect" request.prompt
  | _ -> fail "agent spawn params" "expected spawn");
  expect_error "agent tools wrong type"
    "agent.tools must be an array, got string"
    (Subagents.request_of_json ~workspace_roots:[ "/repo" ] ~default_id:"worker-1"
       (obj [ ("action", str "spawn"); ("tools", str "exec_command") ]));
  expect_error "agent send missing id" "agent.id is required"
    (Subagents.request_of_json ~workspace_roots:[ "/repo" ] ~default_id:"worker-1"
       (obj [ ("action", str "send"); ("prompt", str "hello") ]))

let test_ralph_decoder () =
  let task_id =
    expect_ok "ralph task id"
      (Ralph.child_tool_task_id_of_json ~tool:"ralph_continue"
         (obj [ ("id", str " task-1 ") ]))
  in
  assert_equal "ralph fallback id" "task-1" task_id;
  expect_error "ralph wrong task id type"
    "ralph_continue.task_id must be a string, got number"
    (Ralph.child_tool_task_id_of_json ~tool:"ralph_continue"
       (obj [ ("task_id", num 1.) ]))

let () =
  test_goal_decoders ();
  test_thread_decoders ();
  test_request_user_input_decoder ();
  test_agent_decoder ();
  test_ralph_decoder ()
