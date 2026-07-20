module Usage = Taumel.Usage
module Shared = Taumel.Shared

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let test_token_state_fields () =
  assert_bool "token state present"
    (Usage.token_state_from_fields
       { token_state = ""; token = " tok "; token_error = "" }
    = Usage.Token_present);
  assert_bool "token state missing explicit"
    (Usage.token_state_from_fields
       { token_state = "missing"; token = "tok"; token_error = "" }
    = Usage.Token_missing);
  assert_bool "token state missing blank token"
    (Usage.token_state_from_fields
       { token_state = ""; token = " "; token_error = "" }
    = Usage.Token_missing);
  assert_bool "token state error default"
    (Usage.token_state_from_fields
       { token_state = "error"; token = ""; token_error = "" }
    = Usage.Token_error Usage.token_lookup_error_default);
  assert_bool "token state error custom"
    (Usage.token_state_from_fields
       { token_state = "error"; token = ""; token_error = "boom" }
    = Usage.Token_error "boom");
  assert_bool "kimi token state error default"
    (Usage.token_state_from_fields
       ~default_error:Usage.kimi_token_lookup_error_default
       { token_state = "error"; token = ""; token_error = "" }
    = Usage.Token_error Usage.kimi_token_lookup_error_default)

let test_fetch_state_fields () =
  assert_bool "fetch unavailable"
    (Usage.fetch_state_from_fields
       {
         fetch_state = "unavailable";
         http_status = "";
         error = "";
         payload = None;
       }
    = Usage.Fetch_unavailable);
  assert_bool "fetch http"
    (Usage.fetch_state_from_fields
       {
         fetch_state = "http_error";
         http_status = "429 Too Many Requests";
         error = "";
         payload = None;
       }
    = Usage.Fetch_http_error "429 Too Many Requests");
  assert_bool "fetch error default"
    (Usage.fetch_state_from_fields
       { fetch_state = "error"; http_status = ""; error = ""; payload = None }
    = Usage.Fetch_error "OpenAI usage fetch failed");
  assert_bool "fetch ok payload"
    (Usage.fetch_state_from_fields
       {
         fetch_state = "ok";
         http_status = "";
         error = "";
         payload = Some (Shared.Object []);
       }
    = Usage.Fetch_ok (Shared.Object []));
  assert_bool "fetch ok missing payload"
    (Usage.fetch_state_from_fields
       { fetch_state = "ok"; http_status = ""; error = ""; payload = None }
    = Usage.Fetch_error "OpenAI usage response did not include JSON payload");
  assert_bool "fetch not started"
    (Usage.fetch_state_from_fields
       { fetch_state = ""; http_status = ""; error = ""; payload = None }
    = Usage.Fetch_not_started)

let test_kimi_request_and_auth () =
  assert_equal "kimi provider key" "moonshot" Usage.kimi_host_auth.provider_key;
  assert_equal "kimi source" "moonshot" Usage.kimi_host_auth.source;
  let request = Usage.kimi_usage_request ~token:"secret" () in
  assert_equal "kimi url" "https://api.kimi.com/coding/v1/usages" request.url;
  assert_equal "kimi method" "GET" request.meth;
  assert_bool "kimi accept"
    (List.mem ("Accept", "application/json") request.headers);
  assert_bool "kimi bearer"
    (List.mem ("Authorization", "Bearer secret") request.headers);
  assert_bool "kimi no user-agent"
    (not (List.exists (fun (name, _) -> name = "User-Agent") request.headers))

let test_kimi_payload_normalization () =
  let payload =
    Shared.Object
      [
        ( "usage",
          Shared.Object
            [
              ("limit", Shared.String "100");
              ("remaining", Shared.String "74");
              ("resetTime", Shared.String "2026-02-11T17:32:50.757941Z");
            ] );
        ( "limits",
          Shared.Array
            [
              Shared.Object
                [
                  ( "window",
                    Shared.Object
                      [
                        ("duration", Shared.Number 300.);
                        ("timeUnit", Shared.String "TIME_UNIT_MINUTE");
                      ] );
                  ( "detail",
                    Shared.Object
                      [
                        ("limit", Shared.String "100");
                        ("remaining", Shared.String "85");
                        ("resetTime", Shared.String "2026-02-07T12:32:50Z");
                      ] );
                ];
              Shared.Object
                [
                  ("detail", Shared.Object [ ("broken", Shared.String "x") ]);
                ];
            ] );
        ( "totalQuota",
          Shared.Object
            [ ("limit", Shared.Number 500.); ("used", Shared.Number 200.) ] );
        ( "user",
          Shared.Object
            [
              ( "membership",
                Shared.Object [ ("level", Shared.String "LEVEL_ADVANCED") ] );
            ] );
        ( "boosterWallet",
          Shared.Object
            [
              ( "balance",
                Shared.Object
                  [
                    ("type", Shared.String "BOOSTER");
                    ("amount", Shared.String "20000000000");
                    ("amountLeft", Shared.String "10000000000");
                  ] );
              ("monthlyChargeLimitEnabled", Shared.Bool true);
              ( "monthlyChargeLimit",
                Shared.Object
                  [
                    ("currency", Shared.String "USD");
                    ("priceInCents", Shared.String "20000");
                  ] );
              ( "monthlyUsed",
                Shared.Object
                  [
                    ("currency", Shared.String "USD");
                    ("priceInCents", Shared.String "5000");
                  ] );
            ] );
      ]
  in
  let account =
    Usage.kimi_payload_to_account ~fetched_at_ms:1_770_458_400_000.
      ~api_key_present:true payload
  in
  assert_equal "kimi plan" "Advanced"
    (Option.value account.plan ~default:"");
  assert_bool "kimi credits"
    (match account.credits_balance with
    | Some value -> abs_float (value -. 100.0) < 0.001
    | None -> false);
  assert_equal "kimi currency" "USD"
    (Option.value account.credits_currency ~default:"");
  let labels = List.map (fun row -> row.Usage.label) account.rate_limits in
  assert_bool "has plan limit" (List.mem "Plan limit" labels);
  assert_bool "has 5h limit" (List.mem "5h Limit" labels);
  assert_bool "has total quota" (List.mem "Total quota" labels);
  assert_bool "has monthly booster cap" (List.mem "Monthly booster cap" labels);
  assert_bool "omits malformed limit"
    (not (List.exists (fun label -> String.starts_with ~prefix:"Limit #" label) labels));
  let total =
    List.find (fun row -> row.Usage.label = "Total quota") account.rate_limits
  in
  let plan =
    List.find (fun row -> row.Usage.label = "Plan limit") account.rate_limits
  in
  assert_bool "weekly plan burn rate"
    (Option.is_some plan.burn_rate_per_hour);
  assert_bool "total unknown duration" (total.duration_seconds = None);
  assert_bool "total percent"
    (match total.percent_left with Some 60 -> true | _ -> false);
  assert_bool "sorted unknown last"
    (let durations =
       List.map (fun row -> row.Usage.duration_seconds) account.rate_limits
     in
     let rec ordered = function
       | [] | [ _ ] -> true
       | None :: Some _ :: _ -> false
       | _ :: rest -> ordered rest
     in
     ordered durations)

let test_kimi_host_missing () =
  let result =
    Usage.kimi_host_result
      {
        api_key_present = false;
        account_label = None;
        account_id = None;
        fetched_at_ms = 0.;
        token_state = Usage.Token_missing;
        fetch_state = Usage.Fetch_not_started;
      }
  in
  assert_bool "kimi not configured" result.account.not_configured;
  assert_bool "kimi no error when missing" (result.account.error = None)

let test_partial_pair_details () =
  let openai =
    Usage.openai_host_result
      {
        api_key_present = true;
        account_label = Some "a@example.com";
        account_id = None;
        fetched_at_ms = 1_700_000_000_000.;
        token_state = Usage.Token_present;
        fetch_state =
          Usage.Fetch_ok
            (Shared.Object
               [
                 ("plan_type", Shared.String "pro");
                 ( "rate_limit",
                   Shared.Object
                     [
                       ( "primary_window",
                         Shared.Object
                           [
                             ("limit_window_seconds", Shared.Number 18000.);
                             ("used_percent", Shared.Number 10.);
                             ("reset_at", Shared.Number 1_700_010_000.);
                             ("reset_after_seconds", Shared.Number 9000.);
                           ] );
                     ] );
               ]);
      }
  in
  let kimi =
    Usage.kimi_host_result
      {
        api_key_present = true;
        account_label = None;
        account_id = None;
        fetched_at_ms = 1_700_000_000_000.;
        token_state = Usage.Token_present;
        fetch_state = Usage.Fetch_http_error "401";
      }
  in
  let details = Usage.result_details { openai; kimi } in
  match details with
  | Shared.Object fields ->
      assert_bool "has openai" (List.mem_assoc "openai" fields);
      assert_bool "has kimi" (List.mem_assoc "kimi" fields);
      (match List.assoc "kimi" fields with
      | Shared.Object kimi_fields ->
          assert_bool "kimi error present" (List.mem_assoc "error" kimi_fields)
      | _ -> fail "kimi details" "expected object")
  | _ -> fail "pair details" "expected object"

let () =
  test_token_state_fields ();
  test_fetch_state_fields ();
  test_kimi_request_and_auth ();
  test_kimi_payload_normalization ();
  test_kimi_host_missing ();
  test_partial_pair_details ()
