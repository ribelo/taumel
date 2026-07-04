let core_tool_names =
  [ "web_search_exa"; "crawling_exa"; "get_code_context_exa" ]

let agent_tool_names =
  [
    "exa_agent_create_run";
    "exa_agent_get_run";
    "exa_agent_list_runs";
    "exa_agent_cancel_run";
    "exa_agent_list_events";
  ]

let tool_specs =
  List.map
    (fun name -> { Tool_gateway.name; effect_kind = Tool_gateway.Network })
    (core_tool_names @ agent_tool_names)

let create_run_tool_name = "exa_agent_create_run"
let api_key_env = "EXA_API_KEY"

let json_field name = function
  | Shared.Object fields -> List.assoc_opt name fields
  | _ -> None

let json_string name json =
  match json_field name json with Some (Shared.String value) -> Some value | _ -> None

let json_array name json =
  match json_field name json with Some (Shared.Array values) -> values | _ -> []

let truncate max value =
  if String.length value <= max then value
  else String.sub value 0 (max - 3) ^ "..."

let result_title index item =
  let title = Option.value (json_string "title" item) ~default:"Untitled" in
  let url = Option.value (json_string "url" item) ~default:"" in
  let header = Printf.sprintf "%d. %s" (index + 1) title in
  if url = "" then header else header ^ "\n   " ^ url

let json_strings name item =
  json_array name item
  |> List.filter_map (function Shared.String value -> Some value | _ -> None)

let non_empty_block label value =
  if String.trim value = "" then None else Some (label ^ ":\n" ^ value)

let result_blocks item =
  let summary = Option.bind (json_string "summary" item) (non_empty_block "Summary") in
  let highlights =
    match json_strings "highlights" item with
    | [] -> None
    | values -> Some ("Highlights:\n" ^ String.concat "\n\n" values)
  in
  let text = Option.bind (json_string "text" item) (non_empty_block "Text") in
  [ summary; highlights; text ] |> List.filter_map Fun.id

let render_result_item index item =
  let title = result_title index item in
  match result_blocks item with
  | [] -> title
  | blocks -> title ^ "\n\n" ^ String.concat "\n\n" blocks

let render_results empty payload =
  match json_array "results" payload with
  | [] -> empty
  | results -> results |> List.mapi render_result_item |> String.concat "\n\n"

let render_code_context payload =
  match json_string "response" payload with
  | Some response -> response
  | None -> Shared.encode_json payload

let render_agent_run payload =
  let id = Option.value (json_string "id" payload) ~default:"unknown" in
  let status = Option.value (json_string "status" payload) ~default:"unknown" in
  let output = json_field "output" payload in
  let output_text =
    match output with
    | Some output -> json_string "text" output
    | None -> None
  in
  match output_text with
  | Some text when String.trim text <> "" ->
      Printf.sprintf "Exa Agent run %s is %s.\n\n%s" id status text
  | _ -> (
      match output with
      | Some output ->
          Printf.sprintf "Exa Agent run %s is %s.\n\nOutput:\n%s" id status
            (Shared.encode_json output)
      | None -> Printf.sprintf "Exa Agent run %s is %s." id status)

let render_list noun payload =
  let data = json_array "data" payload in
  let count = List.length data in
  let summary =
    Printf.sprintf "Exa returned %d %s%s." count noun
      (if count = 1 then "" else "s")
  in
  match data with [] -> summary | _ -> summary ^ "\n\n" ^ Shared.encode_json payload

let render_success tool_name payload =
  match tool_name with
  | "web_search_exa" -> render_results "No Exa search results found." payload
  | "crawling_exa" -> render_results "No Exa contents returned." payload
  | "get_code_context_exa" -> render_code_context payload
  | "exa_agent_create_run" | "exa_agent_get_run" | "exa_agent_cancel_run" ->
      render_agent_run payload
  | "exa_agent_list_runs" -> render_list "run" payload
  | "exa_agent_list_events" -> render_list "event" payload
  | _ -> Shared.encode_json payload

let details ~tool_name ~ok ?status payload =
  Shared.Object
    ([
       ("ok", Shared.Bool ok);
       ("tool", Shared.String tool_name);
     ]
    @ (match status with
      | None -> []
      | Some status -> [ ("status", Shared.Number (float_of_int status)) ])
    @ [ ("response", payload) ])

let missing_api_key_result tool_name =
  Tool_gateway.text_result_json
    ~details:
      (Shared.Object
         [
           ("ok", Shared.Bool false);
           ("tool", Shared.String tool_name);
           ("error", Shared.String (api_key_env ^ " is not set"));
         ])
    (api_key_env ^ " is not set. Configure it before using Exa tools.")

let http_result ~tool_name ~status ~body =
  let payload =
    match Shared.decode_json_string body with
    | Ok json -> json
    | Error _ -> Shared.String body
  in
  let ok = status >= 200 && status < 300 in
  let text =
    if ok then render_success tool_name payload
    else
      Printf.sprintf "Exa request failed with HTTP %d.%s" status
        (if body = "" then "" else "\n\n" ^ truncate 2000 body)
  in
  Tool_gateway.text_result_json
    ~details:(details ~tool_name ~ok ~status payload)
    text

let transport_error_result ~tool_name message =
  Tool_gateway.text_result_json
    ~details:
      (Shared.Object
         [
           ("ok", Shared.Bool false);
           ("tool", Shared.String tool_name);
           ("error", Shared.String message);
         ])
    ("Exa request failed: " ^ message)

let approval_prompt ~query =
  {
    Sandbox.title = "Approve Exa Agent run";
    prompt =
      "Create an Exa Agent run? This can be long-running and billable.\n\n"
      ^ truncate 1200 query;
    timeout_ms = 30000;
  }
