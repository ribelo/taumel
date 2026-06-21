module Command = Taumel.Command_plan
module Child = Taumel.Child_session
module Shared = Taumel.Shared

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let json_string name = function
  | Shared.Object fields -> (
      match List.assoc_opt name fields with
      | Some (Shared.String value) -> value
      | _ -> fail name "expected string field")
  | _ -> fail name "expected object"

let json_number name = function
  | Shared.Object fields -> (
      match List.assoc_opt name fields with
      | Some (Shared.Number value) -> int_of_float value
      | _ -> fail name "expected number field")
  | _ -> fail name "expected object"

let test_execution_plan () =
  (match
     Command.plan_execution ~controller_session_id:"controller"
       ~ralph_start_denial:None "goal" "show"
   with
  | Ok Command.Command_direct -> ()
  | Ok _ -> fail "command direct" "expected direct"
  | Error message -> fail "command direct" message);
  (match
     Command.plan_execution ~controller_session_id:"controller"
       ~ralph_start_denial:(Some "agent denied") "ralph" "start do it"
   with
  | Error "agent denied" -> ()
  | Error message -> fail "command denied" ("unexpected error: " ^ message)
  | Ok _ -> fail "command denied" "expected error");
  let plan =
    match
      Command.plan_execution ~controller_session_id:"controller"
        ~ralph_start_denial:None "ralph"
        "start --max 2 --reflect 1 ship it"
    with
    | Ok (Command.Command_child_session plan) -> plan
    | Ok Command.Command_direct -> fail "command child" "expected child session"
    | Error message -> fail "command child" message
  in
  assert_equal "command child active tools" "ralph_child" plan.active_tools_mode;
  assert_equal "command child context key" "taumelRalphChildSessionId"
    plan.child_session_context_key;
  assert_equal "command child controller override" "controller"
    (List.assoc "taumelRalphControllerSessionId" plan.context_overrides);
  assert_equal "command child kind" "ralph" (json_string "kind" plan.metadata);
  assert_equal "command child objective" "ship it"
    (json_string "objective" plan.metadata);
  assert_equal "command child controller" "controller"
    (json_string "controllerSessionId" plan.metadata);
  assert_equal "command child max" "2"
    (string_of_int (json_number "maxIterations" plan.metadata));
  assert_equal "command child reflection" "1"
    (string_of_int (json_number "reflectionEvery" plan.metadata))

let bridge_ready =
  Some
    {
      Child.session_id = Some "child-session";
      session_file = None;
      cancelled = false;
      error = None;
      active_tools = None;
      active_tools_applied = false;
      model_id = None;
      model_applied = false;
      thinking_level = None;
      thinking_applied = false;
    }

let test_child_dispatch_plan () =
  let details = { Command.task_id = "task-1"; child_prompt = "continue" } in
  (match
     Command.plan_child_dispatch
       { object_like = false; ok = true; details }
       bridge_ready
   with
  | Command.Command_return -> ()
  | Command.Command_child_dispatch _ ->
      fail "dispatch non-object" "expected return");
  (match
     Command.plan_child_dispatch
       { object_like = true; ok = false; details }
       bridge_ready
   with
  | Command.Command_return -> ()
  | Command.Command_child_dispatch _ ->
      fail "dispatch failed result" "expected return");
  (match
     Command.plan_child_dispatch
       { object_like = true; ok = true; details }
       bridge_ready
   with
  | Command.Command_child_dispatch plan ->
      assert_equal "dispatch bridge update action" "store_child_session"
        plan.bridge_update_action;
      assert_equal "dispatch bridge update key" "ralph:task-1"
        plan.bridge_update_key;
      assert_equal "dispatch prompt" "continue" plan.prompt
  | Command.Command_return -> fail "dispatch ready" "expected dispatch");
  let cancelled =
    Option.map (fun bridge -> { bridge with Child.cancelled = true }) bridge_ready
  in
  (match
     Command.plan_child_dispatch
       { object_like = true; ok = true; details }
       cancelled
   with
  | Command.Command_return -> ()
  | Command.Command_child_dispatch _ ->
      fail "dispatch cancelled" "expected return")

let () =
  test_execution_plan ();
  test_child_dispatch_plan ()
