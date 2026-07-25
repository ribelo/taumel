type token_usage = {
  input_tokens : int;
  cached_input_tokens : int;
  output_tokens : int;
}

type turn_clock = {
  turn_started_at_ms : int option;
  pause_depth : int;
  current_pause_started_at_ms : int option;
  paused_accumulated_ms : int;
}

let token_delta usage =
  max 0 (usage.input_tokens - usage.cached_input_tokens)
  + max 0 usage.output_tokens

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
      | Some (Shared.Number value)
        when Float.is_finite value && value >= 0. && value = Float.round value
             && value <= 2_147_483_647. ->
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
            if pi_input = None && pi_cache_read = None && pi_cache_write = None then
              None
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
            | Some details -> (
                match
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
