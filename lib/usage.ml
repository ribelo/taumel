type provider = Openai | Kimi

type rate_limit_window = {
  label : string;
  duration_seconds : int option;
  percent_left : int option;
  resets_at : int option;
  burn_rate_per_hour : float option;
  exhausts_at : int option;
  exhausts_in_seconds : int option;
  exhausts_before_reset : bool option;
  is_depleted : bool;
}

type account = {
  provider : provider;
  api_key_present : bool;
  account_label : string option;
  plan : string option;
  credits_balance : float option;
  credits_currency : string option;
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

type kimi_host_auth = {
  provider_key : string;
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
  fetched_at_ms : float;
  token_state : token_state;
  fetch_state : fetch_state;
}

type normalized_result = {
  account : account;
  live : bool;
  source : string;
  account_id : string option;
}

type dual_result = {
  openai : normalized_result;
  kimi : normalized_result;
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

let provider_to_string = function Openai -> "openai" | Kimi -> "kimi"

let openai_host_auth =
  {
    provider_key = "openai-codex";
    credential_key = "openai-codex";
    source = "openai-codex";
  }

let kimi_host_auth = { provider_key = "moonshot"; source = "moonshot" }

let openai_usage_url = "https://chatgpt.com/backend-api/wham/usage"
let kimi_usage_url = "https://api.kimi.com/coding/v1/usages"

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

let kimi_usage_request ~token () =
  {
    url = kimi_usage_url;
    meth = "GET";
    headers =
      [ ("Accept", "application/json"); ("Authorization", "Bearer " ^ token) ];
  }

let openai_usage_request_error status =
  let status = String.trim status in
  if status = "" then "OpenAI usage request failed"
  else "OpenAI usage request failed: " ^ status

let kimi_usage_request_error status =
  let status = String.trim status in
  if status = "" then "Kimi Code usage request failed"
  else "Kimi Code usage request failed: " ^ status

let token_lookup_error_default = "OpenAI usage token lookup failed"
let kimi_token_lookup_error_default = "Kimi Code usage token lookup failed"

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

let token_state_from_fields ?(default_error = token_lookup_error_default) fields
    =
  match fields.token_state with
  | "error" ->
      Token_error
        (Option.value (Shared.trim_non_empty fields.token_error)
           ~default:default_error)
  | "missing" -> Token_missing
  | _ when Shared.trim_non_empty fields.token = None -> Token_missing
  | _ -> Token_present

let token_value_of_lookup = function
  | Token_lookup_present token -> Some token
  | Token_lookup_missing | Token_lookup_error _ -> None

let fetch_state_from_fields ?(default_error = "OpenAI usage fetch failed")
    ?(missing_payload = "OpenAI usage response did not include JSON payload")
    fields =
  match fields.fetch_state with
  | "unavailable" -> Fetch_unavailable
  | "http_error" -> Fetch_http_error fields.http_status
  | "error" ->
      Fetch_error
        (Option.value (Shared.trim_non_empty fields.error) ~default:default_error)
  | "ok" -> (
      match fields.payload with
      | Some payload -> Fetch_ok payload
      | None -> Fetch_error missing_payload)
  | _ -> Fetch_not_started

let format_plan_type value =
  let value = String.trim value in
  if value = "" then None
  else
    Some
      (String.uppercase_ascii (String.sub value 0 1)
      ^ String.sub value 1 (String.length value - 1))

let format_membership_level value =
  let value = String.trim value in
  if value = "" then None
  else
    let stripped =
      if
        String.length value > 6
        && String.uppercase_ascii (String.sub value 0 6) = "LEVEL_"
      then String.sub value 6 (String.length value - 6)
      else value
    in
    match Shared.trim_non_empty stripped with
    | None -> None
    | Some body ->
        let words =
          body |> String.split_on_char '_'
          |> List.filter_map Shared.trim_non_empty
          |> List.map String.lowercase_ascii
          |> List.map (fun word ->
                 String.uppercase_ascii (String.sub word 0 1)
                 ^ String.sub word 1 (String.length word - 1))
        in
        if words = [] then None else Some (String.concat " " words)

let clamp_percent value = max 0 (min 100 value)

let percent_left_from_used_percent = function
  | None -> None
  | Some value when not (Float.is_finite value) -> None
  | Some value ->
      Some (clamp_percent (int_of_float (Float.round (100.0 -. value))))

let percent_left_from_used_and_limit ~used ~limit =
  match (used, limit) with
  | Some used, Some limit when Float.is_finite used && Float.is_finite limit && limit > 0.0
    ->
      let left = ((limit -. used) /. limit) *. 100.0 in
      Some (clamp_percent (int_of_float (Float.round left)))
  | _ -> None

let percent_left_from_remaining_and_limit ~remaining ~limit =
  match (remaining, limit) with
  | Some remaining, Some limit
    when Float.is_finite remaining && Float.is_finite limit && limit > 0.0 ->
      Some
        (clamp_percent
           (int_of_float (Float.round ((remaining /. limit) *. 100.0))))
  | _ -> None

let label_for_window_seconds = function
  | Some seconds when seconds > 0 ->
      let minutes = int_of_float (Float.ceil (float_of_int seconds /. 60.0)) in
      if minutes = 300 then "5h Limit"
      else if minutes = 10080 then "Weekly Limit"
      else if minutes = 43200 then "Monthly Limit"
      else string_of_int minutes ^ "m Limit"
  | _ -> "Limit"

let string_contains ~sub value =
  let sub_len = String.length sub in
  let value_len = String.length value in
  if sub_len = 0 then true
  else if sub_len > value_len then false
  else
    let rec loop index =
      if index + sub_len > value_len then false
      else if String.sub value index sub_len = sub then true
      else loop (index + 1)
    in
    loop 0

let label_for_kimi_window ~duration ~time_unit =
  match duration with
  | None -> None
  | Some duration when duration <= 0 -> None
  | Some duration ->
      let unit = String.uppercase_ascii (Option.value time_unit ~default:"") in
      let label =
        if string_contains ~sub:"MINUTE" unit then
          if duration >= 60 && duration mod 60 = 0 then
            string_of_int (duration / 60) ^ "h Limit"
          else string_of_int duration ^ "m Limit"
        else if string_contains ~sub:"HOUR" unit then
          string_of_int duration ^ "h Limit"
        else if string_contains ~sub:"DAY" unit then
          string_of_int duration ^ "d Limit"
        else string_of_int duration ^ "s Limit"
      in
      Some label

let duration_seconds_for_kimi_window ~duration ~time_unit =
  match duration with
  | None -> None
  | Some duration when duration <= 0 -> None
  | Some duration ->
      let unit = String.uppercase_ascii (Option.value time_unit ~default:"") in
      if string_contains ~sub:"MINUTE" unit then Some (duration * 60)
      else if string_contains ~sub:"HOUR" unit then Some (duration * 3600)
      else if string_contains ~sub:"DAY" unit then Some (duration * 86_400)
      else Some duration

let object_field name = function
  | Shared.Object fields -> List.assoc_opt name fields
  | _ -> None

let json_string_field name json =
  match object_field name json with
  | Some (Shared.String value) -> Some value
  | _ -> None

let first_json_string_field names json =
  names
  |> List.find_map (fun name ->
         Option.bind (json_string_field name json) Shared.trim_non_empty)

let openai_credential_from_json json =
  {
    account_id = first_json_string_field [ "accountId"; "account_id"; "id" ] json;
    account_label =
      first_json_string_field [ "accountLabel"; "account_label"; "email" ] json;
  }

let json_number_field name json =
  match object_field name json with
  | Some (Shared.Number value) when Float.is_finite value -> Some value
  | Some (Shared.String value) -> (
      match float_of_string_opt (String.trim value) with
      | Some value when Float.is_finite value -> Some value
      | _ -> None)
  | _ -> None

let json_bool_field name json =
  match object_field name json with
  | Some (Shared.Bool value) -> Some value
  | _ -> None

let json_int_field name json =
  json_number_field name json |> Option.map int_of_float

let json_object_field name json =
  match object_field name json with
  | Some (Shared.Object _ as value) -> Some value
  | _ -> None

let json_array_field name json =
  match object_field name json with
  | Some (Shared.Array values) -> Some values
  | _ -> None

let ends_with ~suffix value =
  let suffix_len = String.length suffix in
  let value_len = String.length value in
  value_len >= suffix_len
  && String.sub value (value_len - suffix_len) suffix_len = suffix

let parse_iso_timestamp raw =
  let normalized =
    if String.contains raw '.' && ends_with ~suffix:"Z" raw then
      match String.split_on_char '.' raw with
      | base :: frac_and_z :: _ ->
          let frac =
            if ends_with ~suffix:"Z" frac_and_z then
              String.sub frac_and_z 0 (String.length frac_and_z - 1)
            else frac_and_z
          in
          let ms =
            if String.length frac <= 3 then frac else String.sub frac 0 3
          in
          base ^ "." ^ ms ^ "Z"
      | _ -> raw
    else raw
  in
  match float_of_string_opt normalized with
  | Some seconds when Float.is_finite seconds && seconds > 1_000_000_000.0 ->
      Some (int_of_float seconds)
  | _ -> (
      try
        if String.length normalized < 19 then None
        else if normalized.[4] <> '-' || normalized.[7] <> '-' then None
        else if normalized.[10] <> 'T' && normalized.[10] <> ' ' then None
        else
          let year = int_of_string (String.sub normalized 0 4) in
          let month = int_of_string (String.sub normalized 5 2) in
          let day = int_of_string (String.sub normalized 8 2) in
          let hour = int_of_string (String.sub normalized 11 2) in
          let minute = int_of_string (String.sub normalized 14 2) in
          let second = int_of_string (String.sub normalized 17 2) in
          let is_leap y =
            (y mod 4 = 0 && y mod 100 <> 0) || y mod 400 = 0
          in
          let days_before_month =
            [| 0; 31; 59; 90; 120; 151; 181; 212; 243; 273; 304; 334 |]
          in
          if month < 1 || month > 12 then None
          else
            let leap_days =
              let y = year - 1 in
              (y / 4) - (y / 100) + (y / 400) - 477
            in
            let day_of_year =
              days_before_month.(month - 1)
              + day
              + if month > 2 && is_leap year then 1 else 0
            in
            let days = ((year - 1970) * 365) + leap_days + (day_of_year - 1) in
            Some ((days * 86_400) + (hour * 3600) + (minute * 60) + second)
      with _ -> None)

let resets_at_from_json json =
  match
    first_json_string_field
      [ "resetTime"; "reset_time"; "resetAt"; "reset_at" ]
      json
  with
  | Some value -> parse_iso_timestamp value
  | None ->
      Option.bind
        (List.find_map
           (fun name -> json_number_field name json)
           [ "resetTime"; "reset_time"; "resetAt"; "reset_at" ])
        (fun value ->
          if not (Float.is_finite value) then None
          else if value > 1_000_000_000_000.0 then
            Some (int_of_float (value /. 1000.0))
          else if value > 1_000_000_000.0 then Some (int_of_float value)
          else None)

let derive_burn ~fetched_at_ms ~percent_left ~duration_seconds ~resets_at
    ~reset_after_seconds =
  match (percent_left, duration_seconds) with
  | Some percent_left, Some seconds when seconds > 0 ->
      let elapsed_seconds =
        match reset_after_seconds with
        | Some remaining -> float_of_int (max 0 (seconds - remaining))
        | None -> (
            match resets_at with
            | Some reset ->
                (fetched_at_ms /. 1000.0) -. float_of_int (reset - seconds)
            | None -> 0.0)
      in
      let elapsed_hours = elapsed_seconds /. 3600.0 in
      if elapsed_hours > 0.01 then
        let burn = float_of_int (100 - percent_left) /. elapsed_hours in
        if Float.is_finite burn && burn >= 0.01 then
          let exhaust_hours = float_of_int percent_left /. burn in
          let exhausts_in_seconds = int_of_float (exhaust_hours *. 3600.0) in
          let exhausts_at =
            int_of_float
              ((fetched_at_ms /. 1000.0) +. float_of_int exhausts_in_seconds)
          in
          let before_reset =
            match reset_after_seconds with
            | Some remaining -> Some (exhausts_in_seconds < remaining)
            | None -> Option.map (fun reset -> exhausts_at < reset) resets_at
          in
          (Some burn, Some exhausts_at, Some exhausts_in_seconds, before_reset)
        else (None, None, None, None)
      else (None, None, None, None)
  | _ -> (None, None, None, None)

let map_window fetched_at_ms window =
  let seconds = json_int_field "limit_window_seconds" window in
  let label = label_for_window_seconds seconds in
  let resets_at = json_int_field "reset_at" window in
  let reset_after_seconds = json_int_field "reset_after_seconds" window in
  let percent_left =
    percent_left_from_used_percent (json_number_field "used_percent" window)
  in
  let burn_rate_per_hour, exhausts_at, exhausts_in_seconds, exhausts_before_reset
      =
    derive_burn ~fetched_at_ms ~percent_left ~duration_seconds:seconds ~resets_at
      ~reset_after_seconds
  in
  {
    label;
    duration_seconds = seconds;
    percent_left;
    resets_at;
    burn_rate_per_hour;
    exhausts_at;
    exhausts_in_seconds;
    exhausts_before_reset;
    is_depleted = percent_left = Some 0;
  }

let sort_windows windows =
  List.sort
    (fun a b ->
      match (a.duration_seconds, b.duration_seconds) with
      | None, None -> 0
      | None, Some _ -> 1
      | Some _, None -> -1
      | Some left, Some right -> compare left right)
    windows

let make_window ~label ?duration_seconds ?percent_left ?resets_at
    ~fetched_at_ms () =
  let burn_rate_per_hour, exhausts_at, exhausts_in_seconds, exhausts_before_reset
      =
    derive_burn ~fetched_at_ms ~percent_left ~duration_seconds ~resets_at
      ~reset_after_seconds:None
  in
  {
    label;
    duration_seconds;
    percent_left;
    resets_at;
    burn_rate_per_hour;
    exhausts_at;
    exhausts_in_seconds;
    exhausts_before_reset;
    is_depleted = percent_left = Some 0;
  }

let openai_payload_to_account ~fetched_at_ms ~api_key_present ?account_label
    ?error ?(not_configured = false) payload =
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
               | Some window -> Some (map_window fetched_at_ms window)
               | None -> None)
        |> sort_windows
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
    credits_currency = None;
    not_configured;
    error;
    rate_limits;
  }

let account_fallback ~provider ~api_key_present ?account_label ?error
    ?(not_configured = false) () =
  {
    provider;
    api_key_present;
    account_label;
    plan = None;
    credits_balance = None;
    credits_currency = None;
    not_configured;
    error;
    rate_limits = [];
  }

let fallback_account ~api_key_present ?account_label ?error
    ?(not_configured = false) () =
  account_fallback ~provider:Openai ~api_key_present ?account_label ?error
    ~not_configured ()

let kimi_quota_row ~fetched_at_ms ~default_label ?duration_seconds detail =
  let limit = json_number_field "limit" detail in
  let used = json_number_field "used" detail in
  let remaining = json_number_field "remaining" detail in
  let percent_left =
    match percent_left_from_remaining_and_limit ~remaining ~limit with
    | Some _ as value -> value
    | None -> percent_left_from_used_and_limit ~used ~limit
  in
  match percent_left with
  | None when limit = None && used = None && remaining = None -> None
  | percent_left ->
      let label =
        match first_json_string_field [ "name"; "title" ] detail with
        | Some value -> value
        | None -> default_label
      in
      let resets_at = resets_at_from_json detail in
      Some
        (make_window ~label ?duration_seconds ?percent_left ?resets_at
           ~fetched_at_ms ())

let kimi_limits_windows ~fetched_at_ms payload =
  match json_array_field "limits" payload with
  | None -> []
  | Some items ->
      items
      |> List.mapi (fun index item ->
             match item with
             | Shared.Object _ as row ->
                 let detail =
                   match json_object_field "detail" row with
                   | Some detail -> detail
                   | None -> row
                 in
                 let window =
                   match json_object_field "window" row with
                   | Some value -> value
                   | None -> Shared.Object []
                 in
                 let duration =
                   match json_int_field "duration" window with
                   | Some _ as value -> value
                   | None -> json_int_field "duration" row
                 in
                 let time_unit =
                   match json_string_field "timeUnit" window with
                   | Some _ as value -> value
                   | None -> json_string_field "timeUnit" row
                 in
                 let duration_seconds =
                   duration_seconds_for_kimi_window ~duration ~time_unit
                 in
                 let default_label =
                   match label_for_kimi_window ~duration ~time_unit with
                   | Some label -> label
                   | None ->
                       match first_json_string_field [ "name"; "title"; "scope" ] row with
                       | Some label -> label
                       | None -> "Limit #" ^ string_of_int (index + 1)
                 in
                 kimi_quota_row ~fetched_at_ms ~default_label ?duration_seconds
                   detail
             | _ -> None)
      |> List.filter_map Fun.id

let kimi_booster_metadata_and_window ~fetched_at_ms payload =
  match json_object_field "boosterWallet" payload with
  | None -> (None, None, None)
  | Some wallet -> (
      let balance = json_object_field "balance" wallet in
      let balance_type =
        Option.bind balance (fun balance -> json_string_field "type" balance)
      in
      match (balance, balance_type) with
      | Some balance, Some "BOOSTER" ->
          let amount_left = json_number_field "amountLeft" balance in
          let amount = json_number_field "amount" balance in
          let currency =
            match json_object_field "monthlyChargeLimit" wallet with
            | Some money ->
                Option.bind
                  (json_string_field "currency" money)
                  Shared.trim_non_empty
            | None ->
                Option.bind
                  (json_object_field "monthlyUsed" wallet)
                  (fun money ->
                    Option.bind
                      (json_string_field "currency" money)
                      Shared.trim_non_empty)
          in
          let valid_total =
            match amount with
            | Some value when Float.is_finite value && value > 0.0 -> true
            | _ -> false
          in
          let credits_balance =
            if not valid_total then None
            else
              match amount_left with
              | Some value when Float.is_finite value && value >= 0.0 ->
                  (* Kimi fixed-point: 1_000_000 units per cent. *)
                  let cents = value /. 1_000_000.0 in
                  let major = cents /. 100.0 in
                  if Float.is_finite major then Some major else None
              | _ -> Some 0.0
          in
          let credits_currency =
            match currency with
            | Some _ as value -> value
            | None when credits_balance <> None -> Some "USD"
            | None -> None
          in
          let monthly_window =
            if json_bool_field "monthlyChargeLimitEnabled" wallet = Some true
            then
              match json_object_field "monthlyChargeLimit" wallet with
              | None -> None
              | Some money -> (
                  match json_number_field "priceInCents" money with
                  | Some cap when Float.is_finite cap && cap > 0.0 ->
                      let used =
                        match json_object_field "monthlyUsed" wallet with
                        | Some used_money ->
                            json_number_field "priceInCents" used_money
                        | None -> None
                      in
                      let percent_left =
                        percent_left_from_used_and_limit ~used ~limit:(Some cap)
                      in
                      Some
                        (make_window ~label:"Monthly booster cap"
                           ?percent_left ~fetched_at_ms ())
                  | _ -> None)
            else None
          in
          (credits_balance, credits_currency, monthly_window)
      | _ -> (None, None, None))

let kimi_payload_to_account ~fetched_at_ms ~api_key_present ?error
    ?(not_configured = false) payload =
  let plan =
    match json_object_field "user" payload with
    | Some user -> (
        match json_object_field "membership" user with
        | Some membership ->
            Option.bind
              (json_string_field "level" membership)
              format_membership_level
        | None -> None)
    | None ->
        Option.bind
          (json_object_field "membership" payload)
          (fun membership ->
            Option.bind
              (json_string_field "level" membership)
              format_membership_level)
  in
  let plan_window =
    match json_object_field "usage" payload with
    | Some usage ->
        kimi_quota_row ~fetched_at_ms ~default_label:"Plan limit"
          ~duration_seconds:(7 * 86_400) usage
    | None -> None
  in
  let limit_windows = kimi_limits_windows ~fetched_at_ms payload in
  let total_window =
    match json_object_field "totalQuota" payload with
    | Some total ->
        kimi_quota_row ~fetched_at_ms ~default_label:"Total quota" total
    | None -> None
  in
  let credits_balance, credits_currency, booster_window =
    kimi_booster_metadata_and_window ~fetched_at_ms payload
  in
  let rate_limits =
    (match plan_window with None -> [] | Some row -> [ row ])
    @ limit_windows
    @ (match total_window with None -> [] | Some row -> [ row ])
    @ (match booster_window with None -> [] | Some row -> [ row ])
    |> sort_windows
  in
  {
    provider = Kimi;
    api_key_present;
    account_label = None;
    plan;
    credits_balance;
    credits_currency;
    not_configured;
    error;
    rate_limits;
  }

let openai_host_result result =
  let fallback ?error ?(not_configured = false) () =
    account_fallback ~provider:Openai ~api_key_present:result.api_key_present
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
        ( openai_payload_to_account ?account_label:result.account_label
            ~fetched_at_ms:result.fetched_at_ms
            ~api_key_present:result.api_key_present payload,
          true )
    | Token_present, Fetch_not_started ->
        (fallback ~error:"OpenAI usage fetch did not run" (), false)
  in
  {
    account;
    live;
    source = openai_host_auth.source;
    account_id = result.account_id;
  }

let kimi_host_result result =
  let fallback ?error ?(not_configured = false) () =
    account_fallback ~provider:Kimi ~api_key_present:result.api_key_present
      ?error ~not_configured ()
  in
  let account, live =
    match (result.token_state, result.fetch_state) with
    | Token_error error, _ -> (fallback ~error (), false)
    | Token_missing, _ -> (fallback ~not_configured:true (), false)
    | Token_present, Fetch_unavailable ->
        (fallback ~error:"fetch is unavailable in this host" (), false)
    | Token_present, Fetch_http_error status ->
        (fallback ~error:(kimi_usage_request_error status) (), true)
    | Token_present, Fetch_error error -> (fallback ~error (), true)
    | Token_present, Fetch_ok payload ->
        ( kimi_payload_to_account ~fetched_at_ms:result.fetched_at_ms
            ~api_key_present:result.api_key_present payload,
          true )
    | Token_present, Fetch_not_started ->
        (fallback ~error:"Kimi Code usage fetch did not run" (), false)
  in
  { account; live; source = kimi_host_auth.source; account_id = None }

let option_field name value encode =
  match value with None -> [] | Some value -> [ (name, encode value) ]

let rate_limit_json row =
  Shared.Object
    ([
       ("label", Shared.String row.label);
       ("isDepleted", Shared.Bool row.is_depleted);
     ]
    @ option_field "durationSeconds" row.duration_seconds (fun value ->
          Shared.Number (float_of_int value))
    @ option_field "percentLeft" row.percent_left (fun value ->
          Shared.Number (float_of_int value))
    @ option_field "resetsAt" row.resets_at (fun value ->
          Shared.Number (float_of_int value))
    @ option_field "burnRatePerHour" row.burn_rate_per_hour (fun value ->
          Shared.Number value)
    @ option_field "exhaustsAt" row.exhausts_at (fun value ->
          Shared.Number (float_of_int value))
    @ option_field "exhaustsInSeconds" row.exhausts_in_seconds (fun value ->
          Shared.Number (float_of_int value))
    @ option_field "exhaustsBeforeReset" row.exhausts_before_reset (fun value ->
          Shared.Bool value))

let account_details account =
  Shared.Object
    ([
       ("provider", Shared.String (provider_to_string account.provider));
       ("apiKeyPresent", Shared.Bool account.api_key_present);
       ("notConfigured", Shared.Bool account.not_configured);
       ( "rateLimitCount",
         Shared.Number (float_of_int (List.length account.rate_limits)) );
       ("rateLimits", Shared.Array (List.map rate_limit_json account.rate_limits));
     ]
    @ option_field "accountLabel" account.account_label (fun value ->
          Shared.String value)
    @ option_field "plan" account.plan (fun value -> Shared.String value)
    @ option_field "creditsBalance" account.credits_balance (fun value ->
          Shared.Number value)
    @ option_field "creditsCurrency" account.credits_currency (fun value ->
          Shared.String value)
    @ option_field "error" account.error (fun value -> Shared.String value))

let provider_result_details (result : normalized_result) =
  match account_details result.account with
  | Shared.Object fields ->
      Shared.Object
        (fields
        @ [ ("source", Shared.String result.source); ("live", Shared.Bool result.live) ]
        @
        match result.account_id with
        | None -> []
        | Some account_id -> [ ("accountId", Shared.String account_id) ])
  | other -> other

let result_details (result : dual_result) =
  Shared.Object
    [
      ("openai", provider_result_details result.openai);
      ("kimi", provider_result_details result.kimi);
    ]

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
      | Some value when Float.is_finite value ->
          [ Printf.sprintf "Burn: %.1f%%/h" value ]
      | _ -> [])
    @
    match
      ( row.is_depleted,
        Option.bind row.exhausts_at format_timestamp,
        row.exhausts_before_reset )
    with
    | true, _, _ -> [ "Limit Reached. Waiting for reset." ]
    | false, Some value, Some true -> [ "Depletes: " ^ value ]
    | false, Some value, Some false -> [ "Safe: " ^ value ]
    | false, _, _ when row.percent_left = Some 100 -> [ "Safe" ]
    | _ -> []
  in
  row.label ^ ": " ^ percent
  ^ if metadata = [] then "" else " (" ^ String.concat "; " metadata ^ ")"

let render_account account =
  let fields =
    [
      ("provider", provider_to_string account.provider);
      ("api_key", if account.api_key_present then "present" else "missing");
    ]
    @ (match account.account_label with
      | None -> []
      | Some value -> [ ("account", value) ])
    @ (match account.plan with None -> [] | Some value -> [ ("plan", value) ])
    @ (match (account.credits_balance, account.credits_currency) with
      | None, _ -> []
      | Some value, Some currency ->
          [ ("credits", Printf.sprintf "%s %.2f" currency value) ]
      | Some value, None -> [ ("credits", Printf.sprintf "%.2f" value) ])
    @ (if account.not_configured then [ ("status", "not configured") ] else [])
    @ (match account.error with None -> [] | Some value -> [ ("error", value) ])
  in
  let field_lines = List.map (fun (name, value) -> name ^ ": " ^ value) fields in
  String.concat "\n"
    (field_lines @ List.map render_rate_limit account.rate_limits)

let render_pair (result : dual_result) =
  String.concat "\n\n"
    [
      "OpenAI Codex Usage\n" ^ render_account result.openai.account;
      "Kimi Code Usage\n" ^ render_account result.kimi.account;
    ]

let render = render_account
