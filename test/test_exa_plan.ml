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

let test_agent_prompt () =
  let prompt = Exa.approval_prompt ~query:"research expensive thing" in
  assert_equal "prompt title" "Approve Exa Agent run" prompt.title;
  assert_bool "prompt explains billing" (String.contains prompt.prompt 'b');
  assert_bool "prompt timeout" (prompt.timeout_ms > 0)

let () =
  test_catalog ();
  test_missing_key_result ();
  test_success_rendering ();
  test_agent_prompt ()
