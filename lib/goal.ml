type status =
  | Active
  | Paused
  | Blocked
  | Usage_limited
  | Time_limited
  | Complete

type t = {
  goal_id : string;
  thread_id : string;
  objective : string;
  status : status;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
  created_at : int;
  updated_at : int;
}

type store = t option

type token_usage = {
  input_tokens : int;
  cached_input_tokens : int;
  output_tokens : int;
}

type automation =
  | Automation_enabled
  | Automation_interrupted

type turn_clock = {
  turn_started_at_ms : int option;
  pause_depth : int;
  current_pause_started_at_ms : int option;
  paused_accumulated_ms : int;
}

type set_request = {
  objective : string option;
  status : status option;
  time_limit_seconds : int option option;
}

type continuation_facts = {
  goal : store;
  automation : automation;
  host_idle : bool;
  has_pending_messages : bool;
  retrying : bool;
  compacting : bool;
  latest_assistant_stop_reason : string option;
}

let status_to_string = function
  | Active -> "active"
  | Paused -> "paused"
  | Blocked -> "blocked"
  | Usage_limited -> "usage_limited"
  | Time_limited -> "time_limited"
  | Complete -> "complete"

let status_of_string = function
  | "active" -> Some Active
  | "paused" -> Some Paused
  | "blocked" -> Some Blocked
  | "usage_limited" -> Some Usage_limited
  | "time_limited" -> Some Time_limited
  | "complete" -> Some Complete
  | _ -> None

let terminal = function
  | Blocked | Usage_limited | Time_limited | Complete -> true
  | Active | Paused -> false

let unfinished = function
  | Complete -> false
  | Active | Paused | Blocked | Usage_limited | Time_limited -> true

let validate_objective objective =
  Shared.require_non_empty "goal objective" objective

let validate_time_limit = function
  | Some limit when limit <= 0 ->
      Error "goal time limits must be positive when provided"
  | _ -> Ok ()

let next_goal_id thread_id now =
  Printf.sprintf "%s:%d" thread_id now

let create ?time_limit_seconds ~thread_id ~now objective (store : store) =
  match validate_objective objective with
  | Error _ as error -> error
  | Ok objective -> (
      match validate_time_limit time_limit_seconds with
      | Error _ as error -> error
      | Ok () -> (
          match store with
          | Some goal when unfinished goal.status ->
              Error
                "cannot create a new goal because this thread has an unfinished \
                 goal; complete or clear the existing goal first"
          | None | Some _ ->
              Ok
                {
                  goal_id = next_goal_id thread_id now;
                  thread_id;
                  objective;
                  status = Active;
                  tokens_used = 0;
                  time_used_seconds = 0;
                  time_limit_seconds;
                  created_at = now;
                  updated_at = now;
                }))

let get store = store

let update_status ~now status (store : store) =
  match store with
  | None -> Error "cannot update goal because this thread has no goal"
  | Some goal when not (List.mem status [ Complete; Blocked ]) ->
      Error
        "update_goal can only mark the existing goal complete or blocked; pause, \
         resume, usage-limited, and time-limited status changes are controlled \
         by the user or system"
  | Some goal -> Ok { goal with status; updated_at = now }

let user_set_status ~now status (store : store) =
  match store with
  | None -> Error "cannot update goal because this thread has no goal"
  | Some goal -> Ok { goal with status; updated_at = now }

let update_time_limit ~now time_limit_seconds (store : store) =
  match store with
  | None -> Error "cannot update goal because this thread has no goal"
  | Some goal -> (
      match validate_time_limit time_limit_seconds with
      | Error _ as error -> error
      | Ok () -> Ok { goal with time_limit_seconds; updated_at = now })

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
      match request.time_limit_seconds with
      | Some value -> validate_time_limit value
      | None -> Ok ())
    |> (function
    | Error _ as error -> error
    | Ok () -> (
        match (objective, (store : store)) with
        | Some objective, None ->
            create
              ?time_limit_seconds:
                (Option.value request.time_limit_seconds ~default:None)
              ~thread_id ~now objective None
        | Some objective, Some goal ->
            Ok
              {
                goal with
                objective;
                status = Option.value request.status ~default:goal.status;
                time_limit_seconds =
                  (match request.time_limit_seconds with
                  | None -> goal.time_limit_seconds
                  | Some value -> value);
                updated_at = now;
              }
        | None, None -> Error "cannot update goal because this thread has no goal"
        | None, Some goal ->
            Ok
              {
                goal with
                status = Option.value request.status ~default:goal.status;
                time_limit_seconds =
                  (match request.time_limit_seconds with
                  | None -> goal.time_limit_seconds
                  | Some value -> value);
                updated_at = now;
              }))

let token_delta usage =
  max 0 (usage.input_tokens - usage.cached_input_tokens) + max 0 usage.output_tokens

let time_limit_reached (goal : t) time_used_seconds =
  match goal.time_limit_seconds with
  | Some limit when time_used_seconds >= limit -> true
  | _ -> false

let over_time_limit (goal : t) time_used_seconds =
  goal.status = Active && time_limit_reached goal time_used_seconds

let account_usage ~now ~time_delta_seconds usage (goal : t) =
  let tokens_used = goal.tokens_used + token_delta usage in
  let time_used_seconds = goal.time_used_seconds + max 0 time_delta_seconds in
  let status =
    if over_time_limit goal time_used_seconds then Time_limited else goal.status
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

let option_int_default value = Option.value value ~default:0

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
      let pi_input = first_json_int_field usage [ "input" ] in
      let pi_cache_read =
        first_json_int_field usage
          [ "cacheRead"; "cache_read"; "cache_read_input_tokens" ]
      in
      let pi_cache_write =
        first_json_int_field usage
          [ "cacheWrite"; "cache_write"; "cache_write_input_tokens" ]
      in
      let input_tokens =
        match
          first_json_int_field usage
            [ "input_tokens"; "inputTokens"; "prompt_tokens"; "promptTokens" ]
        with
        | Some _ as value -> value
        | None ->
            if
              pi_input = None && pi_cache_read = None && pi_cache_write = None
            then None
            else
              Some
                (option_int_default pi_input + option_int_default pi_cache_read
               + option_int_default pi_cache_write)
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
            | None -> pi_cache_read
            | Some details ->
                (match
                   first_json_int_field details [ "cached_tokens"; "cachedTokens" ]
                 with
                | Some _ as value -> value
                | None -> pi_cache_read))
      in
      let output_tokens =
        first_json_int_field usage
          [
            "output_tokens";
            "outputTokens";
            "completion_tokens";
            "completionTokens";
            "output";
          ]
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

let apply_pending_terminal_status ~now pending_terminal_status result =
  match (pending_terminal_status, result.goal) with
  | Some status, Some goal ->
      {
        result with
        goal = Some { goal with status; updated_at = now };
        changed = true;
      }
  | Some _, None -> { result with changed = true }
  | None, _ -> result

let account_turn_end ?pending_terminal_status ~session_id ~now
    ~active_time_seconds ~last_accounting_key ~branch (store : store) =
  let accounting_store =
    match (pending_terminal_status, store) with
    | Some _, Some goal -> Some { goal with status = Active }
    | _ -> store
  in
  let result =
    match (accounting_store, latest_assistant_usage branch) with
    | Some goal, Some (branch_length, usage) when goal.status = Active ->
        let accounting_key = account_turn_key ~session_id ~branch_length usage in
        if last_accounting_key = Some accounting_key then
          {
            goal = accounting_store;
            accounting_key = last_accounting_key;
            changed = false;
          }
        else
          let updated =
            account_usage ~now ~time_delta_seconds:active_time_seconds usage goal
          in
          {
            goal = Some updated;
            accounting_key = Some accounting_key;
            changed = true;
          }
    | _ ->
        {
          goal = accounting_store;
          accounting_key = last_accounting_key;
          changed = false;
        }
  in
  apply_pending_terminal_status ~now pending_terminal_status result

let empty_clock =
  {
    turn_started_at_ms = None;
    pause_depth = 0;
    current_pause_started_at_ms = None;
    paused_accumulated_ms = 0;
  }

let start_turn_clock ~now_ms _clock =
  { empty_clock with turn_started_at_ms = Some now_ms }

let pause_clock_start ~now_ms clock =
  if clock.pause_depth = 0 then
    {
      clock with
      pause_depth = 1;
      current_pause_started_at_ms = Some now_ms;
    }
  else { clock with pause_depth = clock.pause_depth + 1 }

let pause_clock_end ~now_ms clock =
  if clock.pause_depth <= 0 then clock
  else if clock.pause_depth > 1 then
    { clock with pause_depth = clock.pause_depth - 1 }
  else
    let elapsed =
      match clock.current_pause_started_at_ms with
      | None -> 0
      | Some started -> max 0 (now_ms - started)
    in
    {
      clock with
      pause_depth = 0;
      current_pause_started_at_ms = None;
      paused_accumulated_ms = clock.paused_accumulated_ms + elapsed;
    }

let finalize_open_pause ~now_ms clock =
  let rec loop clock =
    if clock.pause_depth <= 0 then clock else loop (pause_clock_end ~now_ms clock)
  in
  loop clock

let finish_turn_clock ~now_ms clock =
  match clock.turn_started_at_ms with
  | None -> (0, empty_clock)
  | Some started ->
      let clock = finalize_open_pause ~now_ms clock in
      let elapsed_ms = max 0 (now_ms - started - clock.paused_accumulated_ms) in
      (elapsed_ms / 1000, empty_clock)

let automation_to_string = function
  | Automation_enabled -> "enabled"
  | Automation_interrupted -> "interrupted"

let automation_of_string = function
  | "enabled" -> Some Automation_enabled
  | "interrupted" -> Some Automation_interrupted
  | _ -> None

let automation_requires_user_input = function
  | Automation_enabled -> false
  | Automation_interrupted -> true

let automation_to_json = function
  | Automation_enabled -> Shared.Null
  | Automation_interrupted ->
      Shared.Object
        [
          ("continuation", Shared.String "interrupted");
          ("requiresUserInput", Shared.Bool true);
        ]

let automation_of_json = function
  | Shared.Null -> Ok Automation_enabled
  | Shared.Object fields -> (
      match List.assoc_opt "continuation" fields with
      | Some (Shared.String value) -> (
          match automation_of_string value with
          | Some Automation_interrupted -> Ok Automation_interrupted
          | Some Automation_enabled -> Ok Automation_enabled
          | None -> Error ("unknown goal automation: " ^ value))
      | _ -> Error "goal automation continuation must be a string")
  | _ -> Error "goal automation must be an object or null"

let automation_codec =
  { Shared.encode = automation_to_json; decode = automation_of_json }

type command_plan = {
  goal : store;
  automation : automation option;
  message : string;
  followup : bool;
  changed : bool;
}

let format_duration seconds =
  let seconds = max 0 seconds in
  if seconds mod 3600 = 0 && seconds >= 3600 then
    Printf.sprintf "%dh" (seconds / 3600)
  else if seconds mod 60 = 0 && seconds >= 60 then
    Printf.sprintf "%dm" (seconds / 60)
  else Printf.sprintf "%ds" seconds

let goal_usage (goal : t) =
  match goal.time_limit_seconds with
  | None -> format_duration goal.time_used_seconds
  | Some limit ->
      Printf.sprintf "%s/%s" (format_duration goal.time_used_seconds)
        (format_duration limit)

let summary (store : store) =
  match store with
  | None -> "No active goal."
  | Some goal ->
      Printf.sprintf "Goal %s: %s (%s)" (status_to_string goal.status)
        goal.objective (goal_usage goal)

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

let command_plan ?automation ?(followup = false) ?(changed = false) goal =
  { goal; automation; message = summary goal; followup; changed }

let command_usage =
  "usage: /goal [show|status|pause|resume|complete|blocked|clear|<objective> \
   [--time-limit 30m]]"

let parse_duration value =
  let value = String.trim value in
  if value = "" then Error "time limit must not be empty"
  else
    let last = value.[String.length value - 1] in
    let number, multiplier =
      match last with
      | 's' -> (String.sub value 0 (String.length value - 1), 1)
      | 'm' -> (String.sub value 0 (String.length value - 1), 60)
      | 'h' -> (String.sub value 0 (String.length value - 1), 3600)
      | _ -> (value, 1)
    in
    try
      let parsed = int_of_string (String.trim number) in
      let seconds = parsed * multiplier in
      if seconds <= 0 then Error "time limit must be positive"
      else Ok seconds
    with Failure _ ->
      Error "time limit must be a duration like 90s, 30m, or 2h"

let parse_time_limit_args args =
  let words =
    args |> String.split_on_char ' ' |> List.map String.trim
    |> List.filter (fun word -> word <> "")
  in
  let rec loop objective_parts time_limit = function
    | [] -> Ok (String.concat " " (List.rev objective_parts), time_limit)
    | "--time-limit" :: value :: rest -> (
        match parse_duration value with
        | Error _ as error -> error
        | Ok seconds -> loop objective_parts (Some (Some seconds)) rest)
    | [ "--time-limit" ] ->
        Error "time limit must be a duration like 90s, 30m, or 2h"
    | "--no-time-limit" :: rest -> loop objective_parts (Some None) rest
    | flag :: rest when String.starts_with ~prefix:"--time-limit=" flag ->
        let value =
          String.sub flag 13 (String.length flag - 13)
        in
        (match parse_duration value with
        | Error _ as error -> error
        | Ok seconds -> loop objective_parts (Some (Some seconds)) rest)
    | flag :: rest when flag = "--no-time-limit" ->
        loop objective_parts time_limit rest
    | word :: rest -> loop (word :: objective_parts) time_limit rest
  in
  loop [] None words

let apply_command_create ~thread_id ~now args store =
  match parse_time_limit_args args with
  | Error _ as error -> error
  | Ok (objective, time_limit) ->
      let objective = String.trim objective in
      if objective = "" then Error command_usage
      else
        create
          ?time_limit_seconds:(Option.value time_limit ~default:None)
          ~thread_id ~now objective store
        |> Result.map (fun goal ->
               command_plan ~automation:Automation_enabled ~followup:true
                 ~changed:true (Some goal))

let apply_command_status ~now status store =
  update_status ~now status store
  |> Result.map (fun goal -> command_plan ~changed:true (Some goal))

let apply_command_pause ~now store =
  user_set_status ~now Paused store
  |> Result.map (fun goal ->
         command_plan ~automation:Automation_enabled ~changed:true (Some goal))

let apply_command_clear _store =
  Ok (command_plan ~automation:Automation_enabled ~changed:true None)

let apply_command_resume ~now args store =
  match parse_time_limit_args args with
  | Error _ as error -> error
  | Ok (extra, time_limit) ->
      if String.trim extra <> "" then Error command_usage
      else (
        let update_limit goal =
          match time_limit with
          | None -> Ok goal
          | Some value -> update_time_limit ~now value (Some goal)
        in
        match store with
        | None -> Error "cannot resume goal because this thread has no goal"
        | Some goal -> (
            match update_limit goal with
            | Error _ as error -> error
            | Ok goal ->
                if
                  goal.status = Time_limited
                  && time_limit_reached goal goal.time_used_seconds
                then
                  Error
                    "cannot resume goal because its time limit is already \
                     reached; use /goal resume --time-limit <duration> or \
                     /goal resume --no-time-limit"
                else
                  Ok
                    (command_plan ~automation:Automation_enabled ~followup:true
                       ~changed:true
                       (Some { goal with status = Active; updated_at = now }))))

let apply_command ~thread_id ~now args store =
  let command, rest = split_command args in
  match command with
  | "" | "show" | "status" -> Ok (command_plan store)
  | "complete" -> apply_command_status ~now Complete store
  | "blocked" -> apply_command_status ~now Blocked store
  | "pause" -> apply_command_pause ~now store
  | "resume" -> apply_command_resume ~now rest store
  | "clear" | "cancel" -> apply_command_clear store
  | "set" | "start" | "create" -> apply_command_create ~thread_id ~now rest store
  | _ -> apply_command_create ~thread_id ~now args store

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
      "Work toward this objective. Before declaring completion, audit concrete \
       evidence: files, command output, tests, and other current state. If the \
       goal is achieved and no required work remains, call update_goal with \
       status \"complete\". Otherwise continue with the next concrete action.";
    ]

let continuation_followup_prompt (goal : t) =
  String.concat "\n"
    [
      "Continue the active goal.";
      "";
      "Objective:";
      goal.objective;
      "";
      "Do not repeat completed work. Use the conversation history and concrete \
       evidence. Call update_goal with status \"complete\" only when the \
       objective is actually complete and no required work remains. Otherwise \
       continue with the next concrete action.";
    ]

let latest_stop_reason_blocks = function
  | Some "error" | Some "aborted" -> true
  | _ -> false

let should_continue (facts : continuation_facts) =
  match facts.goal with
  | Some goal ->
      goal.status = Active
      && facts.automation = Automation_enabled
      && facts.host_idle
      && not facts.has_pending_messages
      && not facts.retrying
      && not facts.compacting
      && not (latest_stop_reason_blocks facts.latest_assistant_stop_reason)
  | None -> false

let continuation_for_goal ~initial goal =
  {
    custom_type = "taumel.goal.continue";
    content =
      (if initial then initial_followup_prompt goal
       else continuation_followup_prompt goal);
    display = false;
    trigger_turn = true;
    deliver_as = "followUp";
  }

let plan_continuation ~initial (facts : continuation_facts) =
  match facts.goal with
  | Some goal when should_continue facts ->
      Send_continuation (continuation_for_goal ~initial goal)
  | _ -> No_continuation

type child_finalize = { child_status : string; child_reason : string option }

type child_continuation_plan =
  | Child_continue of continuation
  | Child_finalize of child_finalize

(* Default cap on automatic goal continuations for a spawned goal-mode child.
   The loop is also bounded by the child marking the goal complete/blocked; the
   cap only guarantees termination when the child never resolves the goal. *)
let child_continuation_default_max = 25

(* Per-step decision for the spawned goal-mode continuation loop. The loop runs
   sequentially in the TS host between awaited child turns, with host_idle and
   no pending parent messages by construction, so the only continue gate is the
   child goal state plus automation. Reuses should_continue and the shared
   continuation prompt so goal semantics stay identical to the main agent. *)
let plan_child_continuation ~goal ~automation ~iterations ~max_iterations
    ~latest_assistant_stop_reason =
  let facts =
    {
      goal;
      automation;
      host_idle = true;
      has_pending_messages = false;
      retrying = false;
      compacting = false;
      latest_assistant_stop_reason;
    }
  in
  match goal with
  | None -> Child_finalize { child_status = "completed"; child_reason = None }
  | Some g -> (
      match g.status with
      | Complete ->
          Child_finalize { child_status = "completed"; child_reason = None }
      | Blocked ->
          Child_finalize
            { child_status = "failed"; child_reason = Some "goal_blocked" }
      | _ ->
          if iterations >= max_iterations then
            Child_finalize
              {
                child_status = "failed";
                child_reason = Some "goal_continuation_limit";
              }
          else
            match latest_assistant_stop_reason with
            | Some "aborted" ->
                Child_finalize
                  { child_status = "cancelled"; child_reason = Some "aborted" }
            | Some "error" ->
                Child_finalize
                  { child_status = "failed"; child_reason = Some "error" }
            | _ ->
                if should_continue facts then
                  Child_continue (continuation_for_goal ~initial:false g)
                else
                  Child_finalize
                    {
                      child_status = "suspended";
                      child_reason = Some "goal_paused";
                    })

let escape_xml_text input =
  input |> String.split_on_char '&' |> String.concat "&amp;"
  |> String.split_on_char '<' |> String.concat "&lt;"
  |> String.split_on_char '>' |> String.concat "&gt;"

let continuation_prompt (goal : t) =
  let time_limit =
    goal.time_limit_seconds
    |> Option.map string_of_int |> Option.value ~default:"none"
  in
  Printf.sprintf
    "<goal>\n<objective>%s</objective>\n<status>%s</status>\n<tokens_used>%d</tokens_used>\n<time_used_seconds>%d</time_used_seconds>\n<time_limit_seconds>%s</time_limit_seconds>\n<automation>enabled</automation>\n</goal>"
    (escape_xml_text goal.objective) (status_to_string goal.status) goal.tokens_used
    goal.time_used_seconds time_limit

let time_limit_prompt (goal : t) =
  Printf.sprintf
    "<goal_time_limit objective=\"%s\" tokens_used=\"%d\" time_used_seconds=\"%d\" />"
    (escape_xml_text goal.objective) goal.tokens_used goal.time_used_seconds

let objective_updated_prompt = continuation_prompt

let option_int_to_json = function
  | None -> Shared.Null
  | Some value -> Shared.Number (float_of_int value)

let automation_details automation =
  Shared.Object
    [
      ("continuation", Shared.String (automation_to_string automation));
      ( "requiresUserInput",
        Shared.Bool (automation_requires_user_input automation) );
    ]

let to_json goal =
  Shared.Object
    [
      ("goalId", Shared.String goal.goal_id);
      ("threadId", Shared.String goal.thread_id);
      ("objective", Shared.String goal.objective);
      ("status", Shared.String (status_to_string goal.status));
      ("tokensUsed", Shared.Number (float_of_int goal.tokens_used));
      ("timeUsedSeconds", Shared.Number (float_of_int goal.time_used_seconds));
      ("timeLimitSeconds", option_int_to_json goal.time_limit_seconds);
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
      let reject_legacy name =
        match List.assoc_opt name fields with
        | None -> Ok ()
        | Some _ -> Error "incompatible saved Taumel goal entry"
      in
      let ( let* ) = Result.bind in
      let* () = reject_legacy "tokenBudget" in
      let* status_name = string_field "status" in
      let* status =
        match status_of_string status_name with
        | None -> Error ("unknown goal status: " ^ status_name)
        | Some value -> Ok value
      in
      let* goal_id = string_field "goalId" in
      let* thread_id = string_field "threadId" in
      let* objective = string_field "objective" in
      let* tokens_used = int_field "tokensUsed" in
      let* time_used_seconds = int_field "timeUsedSeconds" in
      let* time_limit_seconds = option_int_field "timeLimitSeconds" in
      let* created_at = int_field "createdAt" in
      let* updated_at = int_field "updatedAt" in
      Ok
        (Some
           {
             goal_id;
             thread_id;
             objective;
             status;
             tokens_used;
             time_used_seconds;
             time_limit_seconds;
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
