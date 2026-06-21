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
    = Usage.Token_error "boom")

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

let () =
  test_token_state_fields ();
  test_fetch_state_fields ()
