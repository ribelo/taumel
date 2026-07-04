module Exa = Taumel.Exa
module Shared = Taumel.Shared
module Tool_catalog = Taumel.Tool_catalog
module Tool_gateway = Taumel.Tool_gateway

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let contains_substring haystack needle =
  let haystack_len = String.length haystack in
  let needle_len = String.length needle in
  let rec loop index =
    if needle_len = 0 then true
    else if index + needle_len > haystack_len then false
    else if String.sub haystack index needle_len = needle then true
    else loop (index + 1)
  in
  loop 0

let field name = function
  | Shared.Object fields -> List.assoc_opt name fields
  | _ -> None

let content_text = function
  | Shared.Object fields -> (
      match List.assoc_opt "content" fields with
      | Some (Shared.Array [ Shared.Object item ]) -> (
          match List.assoc_opt "text" item with
          | Some (Shared.String text) -> text
          | _ -> "")
      | _ -> "")
  | _ -> ""

let details = function
  | Shared.Object fields -> (
      match List.assoc_opt "details" fields with
      | Some value -> value
      | None -> Shared.Null)
  | _ -> Shared.Null

let test_catalog () =
  List.iter
    (fun name ->
      assert_bool ("catalog has " ^ name) (Tool_catalog.has_tool name);
      assert_bool ("exa has " ^ name)
        (List.exists (fun spec -> spec.Tool_gateway.name = name) Exa.tool_specs))
    (Exa.core_tool_names @ Exa.agent_tool_names);
  assert_bool "delete run not exposed"
    (not (Tool_catalog.has_tool "exa_agent_delete_run"));
  List.iter
    (fun spec ->
      assert_bool ("network effect " ^ spec.Tool_gateway.name)
        (spec.Tool_gateway.effect_kind = Tool_gateway.Network))
    Exa.tool_specs

let test_missing_key_result () =
  let result = Exa.missing_api_key_result "web_search_exa" in
  assert_bool "missing key text"
    (String.contains (content_text result) 'E');
  match field "ok" (details result) with
  | Some (Shared.Bool false) -> ()
  | _ -> fail "missing key details" "expected ok=false"

let test_success_rendering () =
  let body =
    {|{"results":[{"title":"Example","url":"https://example.com","summary":"Useful result."}],"requestId":"req"}|}
  in
  let result = Exa.http_result ~tool_name:"web_search_exa" ~status:200 ~body in
  let text = content_text result in
  assert_bool "search title rendered" (String.contains text 'E');
  assert_bool "search url rendered" (String.contains text ':');
  match field "ok" (details result) with
  | Some (Shared.Bool true) -> ()
  | _ -> fail "search details" "expected ok=true"

let test_crawling_preserves_full_text () =
  let prefix = String.make 760 'a' in
  let marker = "TAIL_MARKER" in
  let full_text = prefix ^ "\n" ^ marker ^ "\nlet action = ()" in
  let body =
    Printf.sprintf
      {|{"results":[{"title":"Main.ml","url":"https://raw.githubusercontent.com/example/Main.ml","text":%S}],"requestId":"req"}|}
      full_text
  in
  let result = Exa.http_result ~tool_name:"crawling_exa" ~status:200 ~body in
  let text = content_text result in
  assert_bool "crawl text includes tail marker"
    (contains_substring text marker);
  assert_bool "crawl text preserves code tail"
    (contains_substring text "let action = ()")

let test_search_preserves_requested_text () =
  let prefix = String.make 760 'b' in
  let marker = "SEARCH_TAIL_MARKER" in
  let full_text = prefix ^ "\n" ^ marker ^ "\nmodule Action = struct end" in
  let body =
    Printf.sprintf
      {|{"results":[{"title":"Main.ml","url":"https://raw.githubusercontent.com/example/Main.ml","summary":"Short summary","highlights":["Important highlight"],"text":%S}],"requestId":"req"}|}
      full_text
  in
  let result = Exa.http_result ~tool_name:"web_search_exa" ~status:200 ~body in
  let text = content_text result in
  assert_bool "search summary visible" (contains_substring text "Short summary");
  assert_bool "search highlight visible" (contains_substring text "Important highlight");
  assert_bool "search text includes tail marker"
    (contains_substring text marker);
  assert_bool "search text preserves code tail"
    (contains_substring text "module Action = struct end")

let test_agent_run_structured_output_visible () =
  let body =
    {|{"id":"run_1","status":"completed","output":{"answer":"forty-two","citations":["u1"]}}|}
  in
  let result = Exa.http_result ~tool_name:"exa_agent_get_run" ~status:200 ~body in
  let text = content_text result in
  assert_bool "structured output key visible" (contains_substring text "answer");
  assert_bool "structured output value visible" (contains_substring text "forty-two")

let test_agent_lists_expose_payload () =
  let runs_body =
    {|{"data":[{"id":"run_1","status":"completed"}],"nextCursor":"cursor_2"}|}
  in
  let runs = Exa.http_result ~tool_name:"exa_agent_list_runs" ~status:200 ~body:runs_body in
  let runs_text = content_text runs in
  assert_bool "list runs exposes id" (contains_substring runs_text "run_1");
  assert_bool "list runs exposes status" (contains_substring runs_text "completed");
  assert_bool "list runs exposes cursor" (contains_substring runs_text "cursor_2");
  let events_body =
    {|{"data":[{"id":"evt_1","type":"agent_end","message":"done"}]}|}
  in
  let events = Exa.http_result ~tool_name:"exa_agent_list_events" ~status:200 ~body:events_body in
  let events_text = content_text events in
  assert_bool "list events exposes id" (contains_substring events_text "evt_1");
  assert_bool "list events exposes type" (contains_substring events_text "agent_end")

let test_agent_prompt () =
  let prompt = Exa.approval_prompt ~query:"research expensive thing" in
  assert_equal "prompt title" "Approve Exa Agent run" prompt.title;
  assert_bool "prompt explains billing" (String.contains prompt.prompt 'b');
  assert_bool "prompt timeout" (prompt.timeout_ms > 0)

let () =
  test_catalog ();
  test_missing_key_result ();
  test_success_rendering ();
  test_crawling_preserves_full_text ();
  test_search_preserves_requested_text ();
  test_agent_run_structured_output_visible ();
  test_agent_lists_expose_payload ();
  test_agent_prompt ()
