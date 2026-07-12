type provider = Openai

type rate_limit_window = {
  label : string;
  duration_seconds : int option;
  percent_left : int option;
  resets_at : int option;
  burn_rate_per_hour : float option;
  exhausts_at : int option;
  exhausts_before_reset : bool option;
  is_depleted : bool;
}

type account = {
  provider : provider;
  api_key_present : bool;
  account_label : string option;
  plan : string option;
  credits_balance : float option;
  not_configured : bool;
  error : string option;
  rate_limits : rate_limit_window list;
}

type http_request = {
  url : string;
  meth : string;
  headers : (string * string) list;
}

type openai_credential = {
  account_id : string option;
  account_label : string option;
}

type openai_host_auth = {
  provider_key : string;
  credential_key : string;
  source : string;
}

type token_state =
  | Token_present
  | Token_missing
  | Token_error of string

type token_lookup =
  | Token_lookup_present of string
  | Token_lookup_missing
  | Token_lookup_error of string

type fetch_state =
  | Fetch_not_started
  | Fetch_unavailable
  | Fetch_http_error of string
  | Fetch_error of string
  | Fetch_ok of Shared.json

type host_result = {
  api_key_present : bool;
  account_label : string option;
  account_id : string option;
  fetched_at_ms : int;
  token_state : token_state;
  fetch_state : fetch_state;
}

type normalized_result = {
  account : account;
  live : bool;
  source : string;
  account_id : string option;
}

type token_state_fields = {
  token_state : string;
  token : string;
  token_error : string;
}

type fetch_state_fields = {
  fetch_state : string;
  http_status : string;
  error : string;
  payload : Shared.json option;
}

let provider_to_string Openai = "openai"

let openai_host_auth =
  {
    provider_key = "openai-codex";
    credential_key = "openai-codex";
    source = "openai-codex";
  }

let openai_usage_url = "https://chatgpt.com/backend-api/wham/usage"

let openai_usage_request ?account_id ~token () =
  let headers =
    [
      ("Accept", "application/json");
      ("Authorization", "Bearer " ^ token);
      ("User-Agent", "pi");
    ]
    @
    match Option.bind account_id Shared.trim_non_empty with
    | None -> []
    | Some account_id -> [ ("ChatGPT-Account-Id", account_id) ]
  in
  { url = openai_usage_url; meth = "GET"; headers }

let openai_usage_request_error status =
  let status = String.trim status in
  if status = "" then "OpenAI usage request failed"
  else "OpenAI usage request failed: " ^ status

let token_lookup_error_default = "OpenAI usage token lookup failed"

let token_lookup_from_host ?error token =
  match Option.bind error Shared.trim_non_empty with
  | Some error -> Token_lookup_error error
  | None -> (
      match Shared.trim_non_empty token with
      | Some token -> Token_lookup_present token
      | None -> Token_lookup_missing)

let token_state_of_lookup = function
  | Token_lookup_present _ -> Token_present
  | Token_lookup_missing -> Token_missing
  | Token_lookup_error message ->
      Token_error
        (Option.value (Shared.trim_non_empty message)
           ~default:token_lookup_error_default)

let token_state_from_fields fields =
  match fields.token_state with
  | "error" ->
      Token_error
        (Option.value (Shared.trim_non_empty fields.token_error)
           ~default:token_lookup_error_default)
  | "missing" -> Token_missing
  | _ when Shared.trim_non_empty fields.token = None -> Token_missing
  | _ -> Token_present

let token_value_of_lookup = function
  | Token_lookup_present token -> Some token
  | Token_lookup_missing | Token_lookup_error _ -> None

let fetch_state_from_fields fields =
  match fields.fetch_state with
  | "unavailable" -> Fetch_unavailable
  | "http_error" -> Fetch_http_error fields.http_status
  | "error" ->
      Fetch_error
        (Option.value (Shared.trim_non_empty fields.error)
           ~default:"OpenAI usage fetch failed")
  | "ok" -> (
      match fields.payload with
      | Some payload -> Fetch_ok payload
      | None -> Fetch_error "OpenAI usage response did not include JSON payload")
  | _ -> Fetch_not_started

let format_plan_type value =
  let value = String.trim value in
  if value = "" then None
  else
    Some
      (String.uppercase_ascii (String.sub value 0 1)
      ^ String.sub value 1 (String.length value - 1))

let clamp_percent value = max 0 (min 100 value)

let percent_left_from_used_percent = function
  | None -> None
  | Some value when not (Float.is_finite value) -> None
  | Some value -> Some (clamp_percent (int_of_float (Float.round (100.0 -. value))))

let label_for_window_seconds = function
  | Some seconds when seconds > 0 ->
      let minutes = int_of_float (Float.ceil (float_of_int seconds /. 60.0)) in
      if minutes = 300 then "5h Limit"
      else if minutes = 10080 then "Weekly Limit"
      else if minutes = 43200 then "Monthly Limit"
      else string_of_int minutes ^ "m Limit"
  | _ -> "Limit"

let object_field name = function
  | Shared.Object fields -> List.assoc_opt name fields
  | _ -> None

let json_string_field name json =
  match object_field name json with Some (Shared.String value) -> Some value | _ -> None

let first_json_string_field names json =
  names
  |> List.find_map (fun name -> Option.bind (json_string_field name json) Shared.trim_non_empty)

let openai_credential_from_json json =
  {
    account_id = first_json_string_field [ "accountId"; "account_id"; "id" ] json;
    account_label =
      first_json_string_field [ "accountLabel"; "account_label"; "email" ] json;
  }

let json_number_field name json =
  match object_field name json with
  | Some (Shared.Number value) when Float.is_finite value -> Some value
  | _ -> None

let json_bool_field name json =
  match object_field name json with
  | Some (Shared.Bool value) -> Some value
  | _ -> None

let json_int_field name json =
  json_number_field name json |> Option.map int_of_float

let json_object_field name json =
  match object_field name json with Some (Shared.Object _ as value) -> Some value | _ -> None

let map_window fetched_at_ms previous_state key_prefix window =
  let seconds = json_int_field "limit_window_seconds" window in
  let label = label_for_window_seconds seconds in
  let resets_at = json_int_field "reset_at" window in
  let percent_left = percent_left_from_used_percent (json_number_field "used_percent" window) in
  let burn_rate_per_hour, exhausts_at, exhausts_before_reset =
    match (percent_left, resets_at, seconds) with
    | Some percent_left, Some resets_at, Some seconds when seconds > 0 ->
        let window_start_ms = (resets_at * 1000) - (seconds * 1000) in
        let elapsed_ms = fetched_at_ms - window_start_ms in
        let elapsed_hours = float_of_int elapsed_ms /. (1000.0 *. 60.0 *. 60.0) in
        if elapsed_hours > 0.01 then
          let burn = float_of_int (100 - percent_left) /. elapsed_hours in
          if Float.is_finite burn && burn >= 0.01 then
            let exhaust_hours = float_of_int percent_left /. burn in
            let exhausts_at =
              int_of_float
                ((float_of_int fetched_at_ms +. (exhaust_hours *. 60.0 *. 60.0 *. 1000.0))
                /. 1000.0)
            in
            (Some burn, Some exhausts_at, Some (exhausts_at < resets_at))
          else (None, None, None)
        else (None, None, None)
    | _ -> (None, None, None)
  in
  let burn_rate_per_hour, exhausts_at, exhausts_before_reset =
    match burn_rate_per_hour with
    | Some value when value >= 0.01 ->
        (burn_rate_per_hour, exhausts_at, exhausts_before_reset)
    | _ -> (
        match (percent_left, previous_state) with
        | Some current_percent_left, Some (previous_fetched_at_ms, previous_values) -> (
        match List.assoc_opt (key_prefix ^ label) previous_values with
        | Some previous_percent_left ->
            let elapsed_ms = fetched_at_ms - previous_fetched_at_ms in
            let elapsed_hours = float_of_int elapsed_ms /. (1000.0 *. 60.0 *. 60.0) in
            let used_percent = previous_percent_left - current_percent_left in
            if elapsed_hours > 0.01 && used_percent > 0 then
              let burn = float_of_int used_percent /. elapsed_hours in
              if Float.is_finite burn && burn >= 0.01 then
                let exhaust_hours = float_of_int current_percent_left /. burn in
                let exhausts_at =
                  int_of_float
                    ((float_of_int fetched_at_ms +. (exhaust_hours *. 60.0 *. 60.0 *. 1000.0))
                    /. 1000.0)
                in
                (Some burn, Some exhausts_at, Option.map (fun reset -> exhausts_at < reset) resets_at)
              else (burn_rate_per_hour, exhausts_at, exhausts_before_reset)
            else (burn_rate_per_hour, exhausts_at, exhausts_before_reset)
        | None -> (burn_rate_per_hour, exhausts_at, exhausts_before_reset))
        | _ -> (burn_rate_per_hour, exhausts_at, exhausts_before_reset))
  in
  {
    label;
    duration_seconds = seconds;
    percent_left;
    resets_at;
    burn_rate_per_hour;
    exhausts_at;
    exhausts_before_reset;
    is_depleted = percent_left = Some 0;
  }

let openai_payload_to_account ?previous_state ~fetched_at_ms ~api_key_present
    ?account_label ?error ?(not_configured = false) payload =
  let plan =
    match json_string_field "plan_type" payload with
    | Some value -> format_plan_type value
    | None -> None
  in
  let rate_limits =
    match json_object_field "rate_limit" payload with
    | None -> []
    | Some rate_limit ->
        [ "primary_window"; "secondary_window" ]
        |> List.filter_map (fun name ->
               match json_object_field name rate_limit with
               | Some window -> Some (map_window fetched_at_ms previous_state "openai:" window)
               | None -> None)
  in
  let credits_balance =
    match json_object_field "credits" payload with
    | Some credits
      when json_bool_field "has_credits" credits = Some true
           && json_bool_field "unlimited" credits <> Some true ->
        Option.bind (json_string_field "balance" credits) float_of_string_opt
    | _ -> None
  in
  {
    provider = Openai;
    api_key_present;
    account_label;
    plan;
    credits_balance;
    not_configured;
    error;
    rate_limits;
  }

let fallback_account ~api_key_present ?account_label ?error ?(not_configured = false) () =
  {
    provider = Openai;
    api_key_present;
    account_label;
    plan = None;
    credits_balance = None;
    not_configured;
    error;
    rate_limits = [];
  }

let openai_host_result ?previous_state result =
  let fallback ?error ?(not_configured = false) () =
    fallback_account ~api_key_present:result.api_key_present
      ?account_label:result.account_label ?error ~not_configured ()
  in
  let account, live =
    match (result.token_state, result.fetch_state) with
    | Token_error error, _ -> (fallback ~error (), false)
    | Token_missing, _ -> (fallback ~not_configured:true (), false)
    | Token_present, Fetch_unavailable ->
        (fallback ~error:"fetch is unavailable in this host" (), false)
    | Token_present, Fetch_http_error status ->
        (fallback ~error:(openai_usage_request_error status) (), true)
    | Token_present, Fetch_error error -> (fallback ~error (), true)
    | Token_present, Fetch_ok payload ->
        ( openai_payload_to_account ?previous_state
            ?account_label:result.account_label ~fetched_at_ms:result.fetched_at_ms
            ~api_key_present:result.api_key_present payload,
          true )
    | Token_present, Fetch_not_started ->
        (fallback ~error:"OpenAI usage fetch did not run" (), false)
  in
  { account; live; source = openai_host_auth.source; account_id = result.account_id }

let result_details result =
  let account = result.account in
  let option_field name value encode =
    match value with None -> [] | Some value -> [ (name, encode value) ]
  in
  let rate_limit_json row =
    Shared.Object
      ([ ("label", Shared.String row.label); ("isDepleted", Shared.Bool row.is_depleted) ]
      @ option_field "durationSeconds" row.duration_seconds (fun value -> Shared.Number (float_of_int value))
      @ option_field "percentLeft" row.percent_left (fun value -> Shared.Number (float_of_int value))
      @ option_field "resetsAt" row.resets_at (fun value -> Shared.Number (float_of_int value))
      @ option_field "burnRatePerHour" row.burn_rate_per_hour (fun value -> Shared.Number value)
      @ option_field "exhaustsAt" row.exhausts_at (fun value -> Shared.Number (float_of_int value))
      @ option_field "exhaustsBeforeReset" row.exhausts_before_reset (fun value -> Shared.Bool value))
  in
  Shared.Object
    ([
       ("provider", Shared.String (provider_to_string account.provider));
       ("source", Shared.String result.source);
       ("live", Shared.Bool result.live);
       ("apiKeyPresent", Shared.Bool account.api_key_present);
       ("notConfigured", Shared.Bool account.not_configured);
       ("rateLimitCount", Shared.Number (float_of_int (List.length account.rate_limits)));
       ("rateLimits", Shared.Array (List.map rate_limit_json account.rate_limits));
     ]
    @ option_field "accountLabel" account.account_label (fun value -> Shared.String value)
    @ option_field "plan" account.plan (fun value -> Shared.String value)
    @ option_field "creditsBalance" account.credits_balance (fun value -> Shared.Number value)
    @ option_field "error" account.error (fun value -> Shared.String value)
    @
    match result.account_id with
    | None -> []
    | Some account_id -> [ ("accountId", Shared.String account_id) ])

let format_timestamp seconds =
  if seconds <= 0 then None else Some (string_of_int seconds)

let render_rate_limit row =
  let percent =
    match row.percent_left with
    | Some value -> string_of_int value ^ "% Left"
    | None -> "?% Left"
  in
  let metadata =
    []
    @ (match Option.bind row.resets_at format_timestamp with
      | None -> []
      | Some value -> [ "Reset: " ^ value ])
    @ (match row.burn_rate_per_hour with
      | Some value when Float.is_finite value -> [ Printf.sprintf "Burn: %.1f%%/h" value ]
      | _ -> [])
    @
    match (row.is_depleted, Option.bind row.exhausts_at format_timestamp, row.exhausts_before_reset) with
    | true, _, _ -> [ "Limit Reached. Waiting for reset." ]
    | false, Some value, Some true -> [ "Depletes: " ^ value ]
    | false, Some value, Some false -> [ "Safe: " ^ value ]
    | false, _, _ when row.percent_left = Some 100 -> [ "Safe" ]
    | _ -> []
  in
  row.label ^ ": " ^ percent ^ if metadata = [] then "" else " (" ^ String.concat "; " metadata ^ ")"

let render account =
  let fields =
    [
      ("provider", provider_to_string account.provider);
      ("api_key", if account.api_key_present then "present" else "missing");
    ]
    @ (match account.account_label with None -> [] | Some value -> [ ("account", value) ])
    @ (match account.plan with None -> [] | Some value -> [ ("plan", value) ])
    @ (match account.credits_balance with None -> [] | Some value -> [ ("credits", Printf.sprintf "%.2f" value) ])
    @ (if account.not_configured then [ ("status", "not configured") ] else [])
    @ (match account.error with None -> [] | Some value -> [ ("error", value) ])
  in
  let field_lines = List.map (fun (name, value) -> name ^ ": " ^ value) fields in
  String.concat "\n" (field_lines @ List.map render_rate_limit account.rate_limits)
