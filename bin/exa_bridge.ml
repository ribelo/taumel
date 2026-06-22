open Jsoo_bridge
open App_state

let base_url = "https://api.exa.ai"

let prepared_result_from_json json =
  let result = json_to_js json in
  let details =
    if has_property result "details" then Unsafe.get result "details"
    else Unsafe.inject Js.null
  in
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string (js_content_to_text (Unsafe.get result "content")));
      ("details", inject details);
    ]

let stringify_json value =
  let json_ctor = Unsafe.get Unsafe.global "JSON" in
  match string_value (Unsafe.fun_call (Unsafe.get json_ctor "stringify") [| value |]) with
  | Some value -> Ok value
  | None -> Error "Exa request body must be JSON-serializable"

let url_encode value =
  Js.to_string
    (Unsafe.coerce
       (Unsafe.fun_call (Unsafe.get Unsafe.global "encodeURIComponent")
          [| js_string value |]))

let query_string params =
  params
  |> List.filter (fun (_, value) -> value <> "")
  |> List.map (fun (name, value) -> url_encode name ^ "=" ^ url_encode value)
  |> String.concat "&"

let path_with_query path params =
  match query_string params with "" -> path | query -> path ^ "?" ^ query

let optional_int_query name value =
  Option.map
    (fun value -> (name, string_of_int (int_of_float value)))
    value

let optional_string_query name value = Option.map (fun value -> (name, value)) value

let exa_api_key () = String.trim (env_string Taumel.Exa.api_key_env)
let api_key_present () = exa_api_key () <> ""

let prepared_fetch ?body_json ?last_event_id ~tool_name ~method_ ~path () =
  ok_obj
    ([
       ("action", js_string "exa_fetch");
       ("toolName", js_string tool_name);
       ("method", js_string method_);
       ("path", js_string path);
       ("apiKeyPresent", js_bool (api_key_present ()));
     ]
    @ (match body_json with
      | None -> []
      | Some body_json -> [ ("bodyJson", js_string body_json) ])
    @
    match last_event_id with
    | None -> []
    | Some value -> [ ("lastEventId", js_string value) ])

let prepared_missing_key tool_name =
  prepared_result_from_json (Taumel.Exa.missing_api_key_result tool_name)

let prepare_body_tool tool_name params path =
  with_gateway_authorized tool_name (fun _sandbox ->
      if not (api_key_present ()) then prepared_missing_key tool_name
      else
        match stringify_json params with
        | Error message -> error_obj message
        | Ok body_json ->
            prepared_fetch ~tool_name ~method_:"POST" ~path ~body_json ())

let prepare_web_search params =
  prepare_body_tool "web_search_exa" params "/search"

let prepare_crawling params =
  prepare_body_tool "crawling_exa" params "/contents"

let prepare_code_context params =
  prepare_body_tool "get_code_context_exa" params "/context"

let prepare_agent_create_run params =
  with_gateway_authorized Taumel.Exa.create_run_tool_name (fun _sandbox ->
      if not (api_key_present ()) then prepared_missing_key Taumel.Exa.create_run_tool_name
      else
        let typed =
          Tool_contracts.ExaAgentCreateRunParams.t_of_js (ojs_of_js params)
        in
        match stringify_json params with
        | Error message -> error_obj message
        | Ok body_json ->
            let prompt =
              Taumel.Exa.approval_prompt
                ~query:(Tool_contracts.ExaAgentCreateRunParams.get_query typed)
            in
            ok_obj
              [
                ("action", js_string "exa_agent_create_run_approval");
                ("toolName", js_string Taumel.Exa.create_run_tool_name);
                ("method", js_string "POST");
                ("path", js_string "/agent/runs");
                ("bodyJson", js_string body_json);
                ("apiKeyPresent", js_bool true);
                ("approvalTitle", js_string prompt.title);
                ("approvalPrompt", js_string prompt.prompt);
                ("approvalTimeoutMs", js_number (float_of_int prompt.timeout_ms));
              ])

let prepare_agent_get_run params =
  with_gateway_authorized "exa_agent_get_run" (fun _sandbox ->
      if not (api_key_present ()) then prepared_missing_key "exa_agent_get_run"
      else
        let typed = Tool_contracts.ExaAgentRunIdParams.t_of_js (ojs_of_js params) in
        prepared_fetch ~tool_name:"exa_agent_get_run" ~method_:"GET"
          ~path:("/agent/runs/" ^ url_encode (Tool_contracts.ExaAgentRunIdParams.get_id typed))
          ())

let prepare_agent_list_runs params =
  with_gateway_authorized "exa_agent_list_runs" (fun _sandbox ->
      if not (api_key_present ()) then prepared_missing_key "exa_agent_list_runs"
      else
        let typed =
          Tool_contracts.ExaAgentListRunsParams.t_of_js (ojs_of_js params)
        in
        let query =
          [
            optional_int_query "limit"
              (Tool_contracts.ExaAgentListRunsParams.get_limit typed);
            optional_string_query "cursor"
              (Tool_contracts.ExaAgentListRunsParams.get_cursor typed);
          ]
          |> List.filter_map Fun.id
        in
        prepared_fetch ~tool_name:"exa_agent_list_runs" ~method_:"GET"
          ~path:(path_with_query "/agent/runs" query) ())

let prepare_agent_cancel_run params =
  with_gateway_authorized "exa_agent_cancel_run" (fun _sandbox ->
      if not (api_key_present ()) then prepared_missing_key "exa_agent_cancel_run"
      else
        let typed = Tool_contracts.ExaAgentRunIdParams.t_of_js (ojs_of_js params) in
        prepared_fetch ~tool_name:"exa_agent_cancel_run" ~method_:"POST"
          ~path:
            ("/agent/runs/"
            ^ url_encode (Tool_contracts.ExaAgentRunIdParams.get_id typed)
            ^ "/cancel")
          ())

let prepare_agent_list_events params =
  with_gateway_authorized "exa_agent_list_events" (fun _sandbox ->
      if not (api_key_present ()) then prepared_missing_key "exa_agent_list_events"
      else
        let typed =
          Tool_contracts.ExaAgentListEventsParams.t_of_js (ojs_of_js params)
        in
        let query =
          [
            optional_int_query "limit"
              (Tool_contracts.ExaAgentListEventsParams.get_limit typed);
            optional_string_query "cursor"
              (Tool_contracts.ExaAgentListEventsParams.get_cursor typed);
          ]
          |> List.filter_map Fun.id
        in
        prepared_fetch ~tool_name:"exa_agent_list_events" ~method_:"GET"
          ~path:
            (path_with_query
               ("/agent/runs/"
               ^ url_encode (Tool_contracts.ExaAgentListEventsParams.get_id typed)
               ^ "/events")
               query)
          ?last_event_id:(Tool_contracts.ExaAgentListEventsParams.get_lastEventId typed)
          ())

let headers ~api_key ~has_body ~last_event_id =
  let fields =
    [
      ("x-api-key", api_key);
      ("accept", "application/json");
    ]
    @ (if has_body then [ ("content-type", "application/json") ] else [])
    @
    match Taumel.Shared.trim_non_empty last_event_id with
    | None -> []
    | Some value -> [ ("last-event-id", value) ]
  in
  Eta_http.Core.Header.unsafe_of_list fields

let http_body body_json =
  match Taumel.Shared.trim_non_empty body_json with
  | None -> Eta_http.Request.Empty
  | Some body -> Eta_http.Request.Fixed [ Bytes.of_string body ]

let execute_effect prepared =
  let tool_name = get_string prepared "toolName" in
  match gateway_authorized tool_name with
  | Error error -> Effect.pure (inject (gateway_error_obj error))
  | Ok _sandbox ->
      let api_key = exa_api_key () in
      if api_key = "" then
        Effect.pure (inject (prepared_missing_key tool_name))
      else
        let body_json = get_string prepared "bodyJson" in
        let body = http_body body_json in
        let request =
          Eta_http.Request.make
            ~headers:
              (headers ~api_key
                 ~has_body:(body_json <> "")
                 ~last_event_id:(get_string prepared "lastEventId"))
            ~body (get_string prepared "method")
            (base_url ^ get_string prepared "path")
        in
        let client =
          Eta_http_js.Client.make ~max_response_body_bytes:(4 * 1024 * 1024) ()
        in
        Eta_http.Client.request client request
        |> Effect.result
        |> Effect.bind (function
             | Error error ->
                 Effect.pure
                   (inject
                      (prepared_result_from_json
                         (Taumel.Exa.transport_error_result ~tool_name
                            (Eta_http.Error.to_string error))))
             | Ok response ->
                 Eta_http.Body.Stream.read_all response.Eta_http.Response.body
                 |> Effect.result
                 |> Effect.map (function
                      | Error error ->
                          inject
                            (prepared_result_from_json
                               (Taumel.Exa.transport_error_result ~tool_name
                                  (Eta_http.Error.to_string error)))
                      | Ok body ->
                          inject
                            (prepared_result_from_json
                               (Taumel.Exa.http_result ~tool_name
                                  ~status:response.Eta_http.Response.status
                                  ~body:(Bytes.to_string body)))))

let execute prepared _ctx = js_promise_of_effect (execute_effect prepared)
