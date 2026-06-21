module Input = Taumel.Request_user_input

let fail label message = failwith (Printf.sprintf "%s: %s" label message)

let assert_bool label condition =
  if not condition then fail label "expected condition to hold"

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let answers = [ { Input.id = "choice"; value = "A" } ]

let test_result_of_status () =
  assert_bool "answered default"
    (Input.result_of_status "" answers = Input.Answered answers);
  assert_bool "cancelled status"
    (Input.result_of_status "cancelled" answers = Input.Cancelled answers);
  assert_bool "auto status"
    (Input.result_of_status "auto_resolved" answers = Input.Auto_resolved answers);
  assert_equal "cancelled text" "request_user_input was cancelled."
    (Input.result_text (Input.result_of_status "cancelled" answers))

let () = test_result_of_status ()
