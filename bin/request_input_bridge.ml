open Jsoo_bridge
open App_state

let js_input_option (option : Taumel.Request_user_input.option_item) =
  Unsafe.obj
    [|
      ("label", js_string option.label);
      ("description", js_string option.description);
    |]

let js_input_question (question : Taumel.Request_user_input.question) =
  Unsafe.obj
    [|
      ("id", js_string question.id);
      ("header", js_string question.header);
      ("question", js_string question.question);
      ("prompt", js_string (Taumel.Request_user_input.prompt_text question));
      ( "choices",
        js_array
          (question.options
          |> List.map Taumel.Request_user_input.option_text
          |> List.map js_string) );
      ( "defaultAnswer",
        js_string (Taumel.Request_user_input.default_answer question) );
      ("options", js_array (List.map js_input_option question.options));
    |]

let prepare params =
  with_gateway_authorized "request_user_input" (fun _ ->
      match
        Result.bind (json_from_js params) Taumel.Request_user_input.request_of_json
      with
      | Error message -> error_obj message
      | Ok request ->
          ok_obj
            [
              ("action", js_string "request_user_input");
              ("questions", js_array (List.map js_input_question request.questions));
              ( "autoResolutionMs",
                match request.auto_resolution_ms with
                | None -> Unsafe.inject Js.null
                | Some ms -> js_number (float_of_int ms) );
            ])

let input_option_from_js obj =
  {
    Taumel.Request_user_input.label = get_string obj "label";
    description = get_string obj "description";
  }

let input_question_from_js obj =
  {
    Taumel.Request_user_input.id = get_string obj "id";
    header = get_string obj "header";
    question = get_string obj "question";
    options = get_object_array obj "options" |> List.map input_option_from_js;
  }

let optional_js_int obj name =
  Option.bind (optional_field obj name) (fun _ -> int_field obj name)

let request_from_prepared prepared =
  {
    Taumel.Request_user_input.questions =
      get_object_array prepared "questions" |> List.map input_question_from_js;
    auto_resolution_ms = optional_js_int prepared "autoResolutionMs";
  }

let js_input_ui_prompt (prompt : Taumel.Request_user_input.ui_prompt) =
  Unsafe.obj
    [|
      ("id", js_string prompt.id);
      ("prompt", js_string prompt.prompt);
      ("placeholder", js_string prompt.placeholder);
      ("defaultAnswer", js_string prompt.default_answer);
    |]

let plan params =
  let prepared = Unsafe.get params "prepared" in
  let request = request_from_prepared prepared in
  match
    Taumel.Request_user_input.plan_ui
      ~ui_available:(get_bool params "uiAvailable")
      ~now_ms:(int_field_default params "nowMs" 0) request
  with
  | Ui_unavailable ->
      ok_obj
        [
          ("action", js_string "result");
          ( "result",
            text_result_with_details
              Taumel.Request_user_input.unavailable_text
              Taumel.Request_user_input.unavailable_details );
        ]
  | Ui_ask { prompts; deadline_ms } ->
      ok_obj
        [
          ("action", js_string "ask");
          ("prompts", js_array (List.map js_input_ui_prompt prompts));
          ( "deadlineMs",
            match deadline_ms with
            | None -> Unsafe.inject Js.null
            | Some ms -> js_number (float_of_int ms) );
        ]

let answer_from_js obj =
  {
    Taumel.Request_user_input.id = get_string obj "id";
    value = get_string obj "answer";
  }

let optional_js_string obj name =
  Option.map (fun _ -> get_string obj name) (optional_field obj name)

let outcome_from_js obj =
  {
    Taumel.Request_user_input.id = get_string obj "id";
    answer = optional_js_string obj "answer";
    default_answer = get_string obj "defaultAnswer";
    timed_out = get_bool obj "timedOut";
    cancelled = get_bool obj "cancelled";
  }

let finish params =
  let result =
    if has_property params "outcomes" then
      get_object_array params "outcomes"
      |> List.map outcome_from_js
      |> Taumel.Request_user_input.result_of_ui_outcomes
    else
      let answers =
        get_object_array params "answers" |> List.map answer_from_js
      in
      Taumel.Request_user_input.result_of_status
        (get_string params "status") answers
  in
  text_result_with_details
    (Taumel.Request_user_input.result_text result)
    (Taumel.Request_user_input.result_details result)
