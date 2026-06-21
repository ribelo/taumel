open Jsoo_bridge
open App_state

let account () =
  Taumel.Usage.fallback_account ~api_key_present:(env_string "OPENAI_API_KEY" <> "") ()

let openai_host_auth () =
  let auth = Taumel.Usage.openai_host_auth in
  Unsafe.obj
    [|
      ("providerKey", js_string auth.provider_key);
      ("credentialKey", js_string auth.credential_key);
      ("source", js_string auth.source);
    |]

let optional_js_field obj name =
  optional_field obj name

let openai_host_params params =
  let lookup =
    Taumel.Usage.token_lookup_from_host
      ~error:(get_string params "tokenError")
      (get_string params "token")
  in
  let token_fields =
    match lookup with
    | Taumel.Usage.Token_lookup_present token ->
        [ ("tokenState", js_string "present"); ("token", js_string token) ]
    | Taumel.Usage.Token_lookup_missing -> [ ("tokenState", js_string "missing") ]
    | Taumel.Usage.Token_lookup_error message ->
        [
          ("tokenState", js_string "error");
          ( "tokenError",
            js_string
              (Option.value (Taumel.Shared.trim_non_empty message)
                 ~default:Taumel.Usage.token_lookup_error_default) );
        ]
  in
  let credential_fields =
    match optional_js_field params "credential" with
    | None -> []
    | Some credential -> [ ("credential", inject credential) ]
  in
  ok_obj
    [
      ( "params",
        Unsafe.obj
          (Array.of_list
             ([ ("apiKeyPresent", js_bool (get_bool params "apiKeyPresent")) ]
             @ credential_fields @ token_fields)) );
    ]

let optional_bool params name default =
  if has_property params name then get_bool params name else default

let fetched_at_ms params =
  match float_field params "fetchedAt" with
  | Some value when value >= 0.0 -> int_of_float value
  | _ -> now_seconds () * 1000

let payload params =
  match object_field params "payload" with
  | None -> None
  | Some payload -> (
      match json_from_js payload with
      | Ok Taumel.Shared.Null | Error _ -> None
      | Ok json -> Some json)

let http_status params =
  if has_property params "statusCode" then
    match int_field params "statusCode" with
    | Some code ->
        let text = get_string params "statusText" in
        String.trim
          (string_of_int code ^ if String.trim text = "" then "" else " " ^ text)
    | None -> get_string params "status"
  else get_string params "status"

let parse_json body =
  try
    let json_ctor = Unsafe.get Unsafe.global "JSON" in
    let parse = Unsafe.get json_ctor "parse" in
    match json_from_js (Unsafe.fun_call parse [| js_string body |]) with
    | Ok json -> Ok json
    | Error message ->
        Error ("OpenAI usage response JSON parse failed: " ^ message)
  with exn ->
    Error
      ("OpenAI usage response JSON parse failed: " ^ Printexc.to_string exn)

let json_from_js_value value =
  match string_value value with
  | Some text -> (
      match parse_json text with
      | Ok json -> Some json
      | Error _ -> None)
  | None -> (
      match json_from_js value with
      | Ok Taumel.Shared.Null | Error _ -> None
      | Ok json -> Some json)

let credential params =
  if not (has_property params "credential") then None
  else
    json_from_js_value (Unsafe.get params "credential")
    |> Option.map Taumel.Usage.openai_credential_from_json

let account_fields params =
  let credential = credential params in
  let explicit_account_label =
    Option.bind (optional_string_field params "accountLabel") Taumel.Shared.trim_non_empty
  in
  let explicit_account_id =
    Option.bind (optional_string_field params "accountId") Taumel.Shared.trim_non_empty
  in
  let account_label =
    match explicit_account_label with
    | Some _ as value -> value
    | None -> Option.bind credential (fun credential -> credential.account_label)
  in
  let account_id =
    match explicit_account_id with
    | Some _ as value -> value
    | None -> Option.bind credential (fun credential -> credential.account_id)
  in
  (account_label, account_id)

let result_account params =
  let api_key_present = optional_bool params "apiKeyPresent" (env_string "OPENAI_API_KEY" <> "") in
  let not_configured = optional_bool params "notConfigured" false in
  let fetched_at = fetched_at_ms params in
  let account_label, _account_id = account_fields params in
  let error = Option.bind (optional_string_field params "error") Taumel.Shared.trim_non_empty in
  let payload = payload params in
  match payload with
  | Some payload ->
      Taumel.Usage.openai_payload_to_account ?account_label ?error ~not_configured
        ~fetched_at_ms:fetched_at ~api_key_present payload
  | None ->
      Taumel.Usage.fallback_account ~api_key_present ?account_label ?error ~not_configured ()

let token_state params =
  Taumel.Usage.token_state_from_fields
    {
      token_state = get_string params "tokenState";
      token = get_string params "token";
      token_error = get_string params "tokenError";
    }

let result_from_fetch_state params fetch_state =
  let api_key_present = optional_bool params "apiKeyPresent" (env_string "OPENAI_API_KEY" <> "") in
  let account_label, account_id = account_fields params in
  Taumel.Usage.openai_host_result
    {
      api_key_present;
      account_label;
      account_id;
      fetched_at_ms = fetched_at_ms params;
      token_state = token_state params;
      fetch_state;
    }

let host_result params =
  let fetch_state =
    Taumel.Usage.fetch_state_from_fields
      {
        fetch_state = get_string params "fetchState";
        http_status = http_status params;
        error = get_string params "error";
        payload = payload params;
      }
  in
  result_from_fetch_state params fetch_state

let normalized_tool_result result =
  ok_obj
    [
      ("action", js_string "tool_result");
      ("text", js_string (Taumel.Usage.render result.Taumel.Usage.account));
      ("details", json_to_js (Taumel.Usage.result_details result));
    ]

let execute_openai_effect params =
  let token = String.trim (get_string params "token") in
  match token_state params with
  | Taumel.Usage.Token_error _ | Taumel.Usage.Token_missing ->
      Effect.pure
        (inject
           (normalized_tool_result
              (result_from_fetch_state params Taumel.Usage.Fetch_not_started)))
  | Taumel.Usage.Token_present ->
      let _account_label, account_id = account_fields params in
      let request = Taumel.Usage.openai_usage_request ?account_id ~token () in
      let http_request =
        Eta_http.Request.make ~headers:request.headers request.meth request.url
      in
      let client = Eta_http_js.Client.make ~max_response_body_bytes:(1024 * 1024) () in
      Eta_http.Client.request client http_request
      |> Effect.result
      |> Effect.bind (function
           | Error error ->
               Effect.pure
                 (inject
                    (normalized_tool_result
                       (result_from_fetch_state params
                          (Taumel.Usage.Fetch_error
                             (Eta_http.Error.to_string error)))))
           | Ok response ->
               if
                 response.Eta_http.Response.status < 200
                 || response.Eta_http.Response.status >= 300
               then
                 Eta_http.Body.Stream.discard response.Eta_http.Response.body
                 |> Effect.ignore_errors
                 |> Effect.map (fun () ->
                        inject
                          (normalized_tool_result
                             (result_from_fetch_state params
                                (Taumel.Usage.Fetch_http_error
                                   (string_of_int
                                      response.Eta_http.Response.status)))))
               else
                 Eta_http.Body.Stream.read_all response.Eta_http.Response.body
                 |> Effect.result
                 |> Effect.map (function
                      | Error error ->
                          inject
                            (normalized_tool_result
                               (result_from_fetch_state params
                                  (Taumel.Usage.Fetch_error
                                     (Eta_http.Error.to_string error))))
                      | Ok body -> (
                          match parse_json (Bytes.to_string body) with
                          | Error message ->
                              inject
                                (normalized_tool_result
                                   (result_from_fetch_state params
                                      (Taumel.Usage.Fetch_error message)))
                          | Ok payload ->
                              inject
                                (normalized_tool_result
                                   (result_from_fetch_state params
                                      (Taumel.Usage.Fetch_ok payload))))))

let execute_openai params _ctx =
  js_promise_of_effect (execute_openai_effect params)

let handle_command () =
  ok_obj
    [
      ("action", js_string "openai_usage_fetch");
      ("apiKeyPresent", js_bool (env_string "OPENAI_API_KEY" <> ""));
    ]
