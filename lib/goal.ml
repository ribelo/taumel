type status =
  | Active
  | Paused
  | Blocked
  | Usage_limited
  | Budget_limited
  | Complete

type t = {
  goal_id : string;
  thread_id : string;
  objective : string;
  status : status;
  token_budget : int option;
  tokens_used : int;
  time_used_seconds : int;
  created_at : int;
  updated_at : int;
}

type store = t option

type token_usage = {
  input_tokens : int;
  cached_input_tokens : int;
  output_tokens : int;
}

type set_request = {
  objective : string option;
  status : status option;
  token_budget : int option option;
}

let status_to_string = function
  | Active -> "active"
  | Paused -> "paused"
  | Blocked -> "blocked"
  | Usage_limited -> "usage_limited"
  | Budget_limited -> "budget_limited"
  | Complete -> "complete"

let status_of_string = function
  | "active" -> Some Active
  | "paused" -> Some Paused
  | "blocked" -> Some Blocked
  | "usage_limited" -> Some Usage_limited
  | "budget_limited" -> Some Budget_limited
  | "complete" -> Some Complete
  | _ -> None

let terminal = function
  | Blocked | Usage_limited | Budget_limited | Complete -> true
  | Active | Paused -> false

let unfinished = function
  | Complete -> false
  | Active | Paused | Blocked | Usage_limited | Budget_limited -> true

let validate_objective objective =
  Shared.require_non_empty "goal objective" objective

let validate_budget = function
  | Some budget when budget <= 0 -> Error "goal budgets must be positive when provided"
  | _ -> Ok ()

let next_goal_id thread_id now =
  Printf.sprintf "%s:%d" thread_id now

let create ?token_budget ~thread_id ~now objective (store : store) =
  match validate_objective objective with
  | Error _ as error -> error
  | Ok objective -> (
      match validate_budget token_budget with
      | Error _ as error -> error
      | Ok () -> (
          match store with
          | Some goal when unfinished goal.status ->
              Error
                "cannot create a new goal because this thread has an unfinished goal; complete the existing goal first"
          | None | Some _ ->
              Ok
                {
                  goal_id = next_goal_id thread_id now;
                  thread_id;
                  objective;
                  status = Active;
                  token_budget;
                  tokens_used = 0;
                  time_used_seconds = 0;
                  created_at = now;
                  updated_at = now;
                }))

let get store = store

let update_status ~now status (store : store) =
  match store with
  | None -> Error "cannot update goal because this thread has no goal"
  | Some goal when not (List.mem status [ Complete; Blocked ]) ->
      Error
        "update_goal can only mark the existing goal complete or blocked; pause, resume, budget-limited, and usage-limited status changes are controlled by the user or system"
  | Some goal -> Ok { goal with status; updated_at = now }

let set ~thread_id ~now (request : set_request) store =
  let objective = Option.map String.trim request.objective in
  let validation =
    match objective with
    | Some objective -> (
        match validate_objective objective with
        | Error _ as error -> error
        | Ok _ -> Ok ())
    | None -> Ok ()
  in
  match validation with
  | Error _ as error -> error
  | Ok () -> (
      match request.token_budget with
      | Some value -> validate_budget value
      | None -> Ok ())
    |> (function
    | Error _ as error -> error
    | Ok () -> (
        match (objective, (store : store)) with
        | Some objective, None ->
            create ?token_budget:(Option.value request.token_budget ~default:None)
              ~thread_id ~now objective None
        | Some objective, Some goal ->
            Ok
              {
                goal with
                objective;
                status = Option.value request.status ~default:goal.status;
                token_budget =
                  (match request.token_budget with
                  | None -> goal.token_budget
                  | Some value -> value);
                updated_at = now;
              }
        | None, None -> Error "cannot update goal because this thread has no goal"
        | None, Some goal ->
            Ok
              {
                goal with
                status = Option.value request.status ~default:goal.status;
                token_budget =
                  (match request.token_budget with
                  | None -> goal.token_budget
                  | Some value -> value);
                updated_at = now;
              }))

let token_delta usage =
  max 0 (usage.input_tokens - usage.cached_input_tokens) + max 0 usage.output_tokens

let account_usage ~now ~time_delta_seconds usage (goal : t) =
  let tokens_used = goal.tokens_used + token_delta usage in
  let time_used_seconds = goal.time_used_seconds + max 0 time_delta_seconds in
  let status =
    match goal.token_budget with
    | Some budget when tokens_used >= budget && goal.status = Active -> Budget_limited
    | _ -> goal.status
  in
  { goal with tokens_used; time_used_seconds; status; updated_at = now }

type turn_accounting_result = {
  goal : store;
  accounting_key : string option;
  changed : bool;
}

let json_object_field name = function
  | Shared.Object fields -> (
      match List.assoc_opt name fields with
      | Some (Shared.Object _ as value) -> Some value
      | _ -> None)
  | _ -> None

let json_string_field name = function
  | Shared.Object fields -> (
      match List.assoc_opt name fields with
      | Some (Shared.String value) -> Some value
      | _ -> None)
  | _ -> None

let json_non_negative_int_field name = function
  | Shared.Object fields -> (
      match List.assoc_opt name fields with
      | Some (Shared.Number value) when Float.is_finite value && value >= 0. ->
          Some (int_of_float value)
      | _ -> None)
  | _ -> None

let first_json_int_field json names =
  List.find_map (fun name -> json_non_negative_int_field name json) names

let first_json_object_field json names =
  List.find_map (fun name -> json_object_field name json) names

let rec token_usage_of_json usage =
  match
    List.find_map
      (fun name ->
        match json_object_field name usage with
        | Some nested -> token_usage_of_json nested
        | None -> None)
      [ "total_token_usage"; "totalTokenUsage"; "tokenUsage"; "usage" ]
  with
  | Some _ as parsed -> parsed
  | None ->
      let input_tokens =
        first_json_int_field usage
          [ "input_tokens"; "inputTokens"; "prompt_tokens"; "promptTokens" ]
      in
      let cached_input_tokens =
        match
          first_json_int_field usage [ "cached_input_tokens"; "cachedInputTokens" ]
        with
        | Some _ as value -> value
        | None -> (
            match
              first_json_object_field usage
                [
                  "input_tokens_details";
                  "inputTokensDetails";
                  "prompt_tokens_details";
                  "promptTokensDetails";
                ]
            with
            | None -> None
            | Some details ->
                first_json_int_field details [ "cached_tokens"; "cachedTokens" ])
      in
      let output_tokens =
        first_json_int_field usage
          [ "output_tokens"; "outputTokens"; "completion_tokens"; "completionTokens" ]
      in
      if input_tokens = None && cached_input_tokens = None && output_tokens = None then
        None
      else
        Some
          {
            input_tokens = Option.value input_tokens ~default:0;
            cached_input_tokens = Option.value cached_input_tokens ~default:0;
            output_tokens = Option.value output_tokens ~default:0;
          }

let message_usage entry =
  let message =
    match json_object_field "message" entry with
    | Some value -> value
    | None -> entry
  in
  if json_string_field "role" message <> Some "assistant" then None
  else
    match json_object_field "usage" message with
    | Some usage -> token_usage_of_json usage
    | None -> (
        match json_object_field "usage" entry with
        | Some usage -> token_usage_of_json usage
        | None -> None)

let latest_assistant_usage branch =
  List.find_map message_usage (List.rev branch)
  |> Option.map (fun usage -> (List.length branch, usage))

let account_turn_key ~session_id ~branch_length usage =
  Printf.sprintf "%s:%d:%d:%d:%d" session_id branch_length usage.input_tokens
    usage.cached_input_tokens usage.output_tokens

let account_turn_end ~session_id ~now ~last_accounting_key ~branch (store : store) =
  match (store, latest_assistant_usage branch) with
  | Some goal, Some (branch_length, usage)
    when goal.status = Active || goal.status = Budget_limited ->
      let accounting_key = account_turn_key ~session_id ~branch_length usage in
      if last_accounting_key = Some accounting_key then
        { goal = store; accounting_key = last_accounting_key; changed = false }
      else
        let time_delta_seconds = max 0 (now - goal.updated_at) in
        let updated = account_usage ~now ~time_delta_seconds usage goal in
        { goal = Some updated; accounting_key = Some accounting_key; changed = true }
  | _ -> { goal = store; accounting_key = last_accounting_key; changed = false }

let remaining_tokens (goal : t) =
  Option.map (fun budget -> max 0 (budget - goal.tokens_used)) goal.token_budget

let completion_budget_report (goal : t) =
  if goal.status <> Complete then None
  else if goal.token_budget = None && goal.time_used_seconds <= 0 then None
  else
    Some
      "Goal achieved. Report final usage from this tool result's structured goal fields."

type command_plan = {
  goal : store;
  message : string;
  followup : bool;
  completion_report : string option;
  changed : bool;
}

let summary (store : store) =
  match store with
  | None -> "No active goal."
  | Some goal ->
      Printf.sprintf "Goal %s: %s" (status_to_string goal.status)
        goal.objective

let split_command input =
  let input = String.trim input in
  if input = "" then ("", "")
  else
    match String.index_opt input ' ' with
    | None -> (input, "")
    | Some index ->
        let command = String.sub input 0 index |> String.trim in
        let rest =
          String.sub input (index + 1) (String.length input - index - 1)
          |> String.trim
        in
        (command, rest)

let command_plan ?completion_report ?(followup = false) ?(changed = false) goal =
  {
    goal;
    message = summary goal;
    followup;
    completion_report;
    changed;
  }

let command_usage = "usage: /goal [show|status|complete|blocked|<objective>]"

let apply_command_set ~thread_id ~now objective store =
  let objective = String.trim objective in
  if objective = "" then Error command_usage
  else
    let request =
      { objective = Some objective; status = Some Active; token_budget = None }
    in
    set ~thread_id ~now request store
    |> Result.map (fun goal -> command_plan ~followup:true ~changed:true (Some goal))

let apply_command_status ~now status store =
  update_status ~now status store
  |> Result.map (fun goal ->
         command_plan ?completion_report:(completion_budget_report goal)
           ~changed:true (Some goal))

let apply_command ~thread_id ~now args store =
  let command, rest = split_command args in
  match command with
  | "" | "show" | "status" -> Ok (command_plan store)
  | "complete" -> apply_command_status ~now Complete store
  | "blocked" -> apply_command_status ~now Blocked store
  | "set" | "start" | "create" -> apply_command_set ~thread_id ~now rest store
  | _ -> apply_command_set ~thread_id ~now args store

type continuation = {
  custom_type : string;
  content : string;
  display : bool;
  trigger_turn : bool;
  deliver_as : string;
}

type continuation_plan =
  | No_continuation
  | Send_continuation of continuation

let initial_followup_prompt (goal : t) =
  String.concat "\n"
    [
      "Active goal started.";
      "";
      "Objective:";
      goal.objective;
      "";
      "Work toward this objective. Before declaring completion, audit concrete evidence: files, command output, tests, and other current state. If the goal is achieved and no required work remains, call update_goal with status \"complete\". Otherwise continue with the next concrete action.";
    ]

let continuation_followup_prompt (goal : t) =
  String.concat "\n"
    [
      "Continue the active goal.";
      "";
      "Objective:";
      goal.objective;
      "";
      "Do not repeat completed work. Use the conversation history and concrete evidence. Call update_goal with status \"complete\" only when the objective is actually complete and no required work remains. Otherwise continue with the next concrete action.";
    ]

let plan_continuation ~initial (store : store) =
  match store with
  | Some goal when goal.status = Active ->
      Send_continuation
        {
          custom_type = "taumel.goal.continue";
          content =
            (if initial then initial_followup_prompt goal
             else continuation_followup_prompt goal);
          display = false;
          trigger_turn = true;
          deliver_as = "followUp";
        }
  | _ -> No_continuation

let escape_xml_text input =
  input |> String.split_on_char '&' |> String.concat "&amp;"
  |> String.split_on_char '<' |> String.concat "&lt;"
  |> String.split_on_char '>' |> String.concat "&gt;"

let continuation_prompt (goal : t) =
  let token_budget =
    goal.token_budget |> Option.map string_of_int |> Option.value ~default:"none"
  in
  let remaining =
    remaining_tokens goal |> Option.map string_of_int |> Option.value ~default:"unbounded"
  in
  Printf.sprintf
    "<goal>\n<objective>%s</objective>\n<status>%s</status>\n<tokens_used>%d</tokens_used>\n<token_budget>%s</token_budget>\n<remaining_tokens>%s</remaining_tokens>\n</goal>"
    (escape_xml_text goal.objective) (status_to_string goal.status) goal.tokens_used
    token_budget remaining

let budget_limit_prompt (goal : t) =
  Printf.sprintf
    "<goal_budget_limit objective=\"%s\" tokens_used=\"%d\" time_used_seconds=\"%d\" />"
    (escape_xml_text goal.objective) goal.tokens_used goal.time_used_seconds

let objective_updated_prompt = continuation_prompt

let option_int_to_json = function
  | None -> Shared.Null
  | Some value -> Shared.Number (float_of_int value)

let to_json goal =
  Shared.Object
    [
      ("goalId", Shared.String goal.goal_id);
      ("threadId", Shared.String goal.thread_id);
      ("objective", Shared.String goal.objective);
      ("status", Shared.String (status_to_string goal.status));
      ("tokenBudget", option_int_to_json goal.token_budget);
      ("tokensUsed", Shared.Number (float_of_int goal.tokens_used));
      ("timeUsedSeconds", Shared.Number (float_of_int goal.time_used_seconds));
      ("createdAt", Shared.Number (float_of_int goal.created_at));
      ("updatedAt", Shared.Number (float_of_int goal.updated_at));
    ]

let of_json = function
  | Shared.Null -> Ok None
  | Shared.Object fields ->
      let string_field name =
        match List.assoc_opt name fields with
        | Some (Shared.String value) -> Ok value
        | _ -> Error (name ^ " must be a string")
      in
      let int_field name =
        match List.assoc_opt name fields with
        | Some (Shared.Number value) when Float.is_finite value ->
            Ok (int_of_float value)
        | _ -> Error (name ^ " must be a number")
      in
      let option_int_field name =
        match List.assoc_opt name fields with
        | None | Some Shared.Null -> Ok None
        | Some (Shared.Number value) when Float.is_finite value ->
            Ok (Some (int_of_float value))
        | _ -> Error (name ^ " must be null or a number")
      in
      let ( let* ) = Result.bind in
      let* status_name = string_field "status" in
      let* status =
        match status_of_string status_name with
        | None -> Error ("unknown goal status: " ^ status_name)
        | Some value -> Ok value
      in
      let* goal_id = string_field "goalId" in
      let* thread_id = string_field "threadId" in
      let* objective = string_field "objective" in
      let* token_budget = option_int_field "tokenBudget" in
      let* tokens_used = int_field "tokensUsed" in
      let* time_used_seconds = int_field "timeUsedSeconds" in
      let* created_at = int_field "createdAt" in
      let* updated_at = int_field "updatedAt" in
      Ok
        (Some
           {
             goal_id;
             thread_id;
             objective;
             status;
             token_budget;
             tokens_used;
             time_used_seconds;
             created_at;
             updated_at;
           })
  | _ -> Error "goal state must be an object or null"

let codec =
  {
    Shared.encode = (function None -> Shared.Null | Some goal -> to_json goal);
    decode = of_json;
  }

let tool_specs =
  [
    { Tool_gateway.name = "get_goal"; effect_kind = Tool_gateway.Pure };
    { Tool_gateway.name = "create_goal"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "update_goal"; effect_kind = Tool_gateway.Mutate };
  ]
