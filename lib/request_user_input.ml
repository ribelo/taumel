type option_item = {
  label : string;
  description : string;
}

type question = {
  id : string;
  header : string;
  question : string;
  options : option_item list;
}

type request = {
  questions : question list;
  auto_resolution_ms : int option;
}

type answer = {
  id : string;
  value : string;
}

type result =
  | Answered of answer list
  | Cancelled of answer list
  | Auto_resolved of answer list

type ui_outcome = {
  id : string;
  answer : string option;
  default_answer : string;
  timed_out : bool;
  cancelled : bool;
}

type ui_prompt = {
  id : string;
  prompt : string;
  placeholder : string;
  default_answer : string;
}

type ui_plan =
  | Ui_unavailable
  | Ui_ask of {
      prompts : ui_prompt list;
      deadline_ms : int option;
    }

let prompt_text question =
  if question.header = "" then question.question
  else question.header ^ ": " ^ question.question

let option_text option =
  if option.description = "" then option.label
  else option.label ^ " - " ^ option.description

let default_answer question =
  match question.options with
  | option :: _ -> option.label
  | [] -> ""

let prompt_placeholder question =
  question.options |> List.map option_text |> String.concat " | "

let ui_prompt (question : question) =
  {
    id = question.id;
    prompt = prompt_text question;
    placeholder = prompt_placeholder question;
    default_answer = default_answer question;
  }

let plan_ui ~ui_available ~now_ms request =
  if not ui_available then Ui_unavailable
  else
    let deadline_ms =
      Option.map (fun auto_resolution_ms -> now_ms + auto_resolution_ms)
        request.auto_resolution_ms
    in
    Ui_ask { prompts = List.map ui_prompt request.questions; deadline_ms }

let unavailable_text = "request_user_input is unavailable without a UI."

let unavailable_details =
  Shared.Object [ ("ok", Shared.Bool false); ("cancelled", Shared.Bool true) ]

let answers_json answers =
  Shared.Object
    (List.map
       (fun (answer : answer) ->
         (answer.id, Shared.Object [ ("answer", Shared.String answer.value) ]))
       answers)

let payload_json = function
  | Answered answers -> Shared.Object [ ("answers", answers_json answers) ]
  | Auto_resolved answers ->
      Shared.Object
        [ ("answers", answers_json answers); ("autoResolved", Shared.Bool true) ]
  | Cancelled answers -> Shared.Object [ ("answers", answers_json answers) ]

let result_text = function
  | Cancelled _ -> "request_user_input was cancelled."
  | result -> Shared.encode_json (payload_json result)

let result_details = function
  | Answered answers ->
      Shared.Object [ ("ok", Shared.Bool true); ("answers", answers_json answers) ]
  | Auto_resolved answers ->
      Shared.Object
        [
          ("ok", Shared.Bool true);
          ("answers", answers_json answers);
          ("autoResolved", Shared.Bool true);
        ]
  | Cancelled answers ->
      Shared.Object
        [
          ("ok", Shared.Bool false);
          ("cancelled", Shared.Bool true);
          ("answers", answers_json answers);
        ]

let result_of_ui_outcomes outcomes =
  let rec collect (answers : answer list) auto_resolved = function
    | [] ->
        if auto_resolved then Auto_resolved (List.rev answers)
        else Answered (List.rev answers)
    | outcome :: rest ->
        if outcome.cancelled then Cancelled (List.rev answers)
        else if outcome.timed_out then
          collect
            ({ id = outcome.id; value = outcome.default_answer } :: answers)
            true rest
        else
          match outcome.answer with
          | None -> Cancelled (List.rev answers)
          | Some value ->
              collect ({ id = outcome.id; value } :: answers) auto_resolved
                rest
  in
  collect [] false outcomes

let result_of_status status answers =
  match status with
  | "cancelled" -> Cancelled answers
  | "auto_resolved" -> Auto_resolved answers
  | _ -> Answered answers

let validate_option (option : option_item) =
  match Shared.require_non_empty "option label" option.label with
  | Error _ as error -> error
  | Ok _ -> (
      match Shared.require_non_empty "option description" option.description with
      | Error _ as error -> error
      | Ok _ -> Ok ())

let validate_question (question : question) =
  match Shared.require_non_empty "question id" question.id with
  | Error _ as error -> error
  | Ok _ -> (
      match Shared.require_non_empty "question header" question.header with
      | Error _ as error -> error
      | Ok header ->
          if String.length header > 12 then
            Error "question header must be 12 characters or fewer"
          else
            match Shared.require_non_empty "question text" question.question with
            | Error _ as error -> error
            | Ok _ ->
                let count = List.length question.options in
                if count < 2 || count > 3 then
                  Error "each question must provide 2 or 3 options"
                else
                  List.fold_left
                    (fun result option ->
                      match result with
                      | Error _ as error -> error
                      | Ok () -> validate_option option)
                    (Ok ()) question.options)

let validate (request : request) =
  let question_count = List.length request.questions in
  if question_count < 1 || question_count > 3 then
    Error "request_user_input requires 1 to 3 questions"
  else
    (match request.auto_resolution_ms with
    | Some ms when ms < 60000 || ms > 240000 ->
        Error "autoResolutionMs must be between 60000 and 240000"
    | _ ->
        List.fold_left
          (fun result question ->
            match result with
            | Error _ as error -> error
            | Ok () -> validate_question question)
          (Ok ()) request.questions)

let option_item_of_fields path fields =
  let ( let* ) = Result.bind in
  let* label = Shared.json_required_string path fields "label" in
  let* description = Shared.json_required_string path fields "description" in
  Ok { label; description }

let question_of_fields index fields =
  let path = Printf.sprintf "request_user_input.questions[%d]" index in
  let ( let* ) = Result.bind in
  let* id = Shared.json_required_string path fields "id" in
  let* header = Shared.json_required_string path fields "header" in
  let* question = Shared.json_required_string path fields "question" in
  let* option_fields = Shared.json_required_object_list path fields "options" in
  let rec loop acc option_index = function
    | [] -> Ok (List.rev acc)
    | fields :: rest -> (
        match
          option_item_of_fields
            (Printf.sprintf "%s.options[%d]" path option_index)
            fields
        with
        | Ok option -> loop (option :: acc) (option_index + 1) rest
        | Error _ as error -> error)
  in
  let* options = loop [] 0 option_fields in
  Ok { id; header; question; options }

let request_of_json json =
  let tool = "request_user_input" in
  let ( let* ) = Result.bind in
  let* fields = Shared.json_object_fields tool json in
  let* question_fields = Shared.json_required_object_list tool fields "questions" in
  let rec loop acc index = function
    | [] -> Ok (List.rev acc)
    | fields :: rest -> (
        match question_of_fields index fields with
        | Ok question -> loop (question :: acc) (index + 1) rest
        | Error _ as error -> error)
  in
  let* questions = loop [] 0 question_fields in
  let* auto_resolution_ms =
    let* camel = Shared.json_optional_number tool fields "autoResolutionMs" in
    match camel with
    | Some _ as value -> Ok value
    | None -> Shared.json_optional_number tool fields "auto_resolution_ms"
  in
  let request =
    { questions; auto_resolution_ms = Option.map int_of_float auto_resolution_ms }
  in
  match validate request with
  | Ok () -> Ok request
  | Error _ as error -> error

let option_parameters =
  Tool_gateway.object_schema
    ~required:[ "label"; "description" ]
    [
      ("label", Tool_gateway.string_schema ());
      ("description", Tool_gateway.string_schema ());
    ]

let question_parameters =
  Tool_gateway.object_schema
    ~required:[ "id"; "header"; "question"; "options" ]
    [
      ("id", Tool_gateway.string_schema ());
      ("header", Tool_gateway.string_schema ~max_length:12 ());
      ("question", Tool_gateway.string_schema ());
      ( "options",
        Tool_gateway.array_schema ~min_items:2 ~max_items:3 option_parameters );
    ]

let parameters =
  Tool_gateway.object_schema ~required:[ "questions" ]
    [
      ( "questions",
        Tool_gateway.array_schema ~min_items:1 ~max_items:3 question_parameters );
      ("autoResolutionMs", Tool_gateway.number_schema ());
    ]

let tool_spec =
  {
    Tool_gateway.name = "request_user_input";
    description =
      "Ask the user one to three structured questions and return structured answers.";
    effect_kind = Tool_gateway.Ask_user;
    strict = false;
    parameters;
  }
