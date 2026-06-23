open Jsoo_bridge

let js_child_session_custom_entry (entry : Taumel.Child_session.custom_entry) =
  Unsafe.obj
    [|
      ("customType", js_string entry.custom_type);
      ("data", json_to_js entry.data);
    |]

let child_session_metadata_from_js metadata =
  match json_from_js metadata with
  | Ok metadata -> metadata
  | Error _ -> Taumel.Shared.Object []

let child_session_parent_from_js parent =
  ( optional_string_field parent "parentSessionId",
    optional_string_field parent "parentSessionFile" )

let child_session_bridge_from_js facts =
  if not (get_bool facts "available") then None
  else
    Some
      {
        Taumel.Child_session.session_id =
          Option.bind (optional_string_field facts "sessionId")
            Taumel.Shared.trim_non_empty;
        session_file =
          Option.bind (optional_string_field facts "sessionFile")
            Taumel.Shared.trim_non_empty;
        cancelled = get_bool facts "cancelled";
        error =
          (match
             Option.bind (optional_string_field facts "error")
               Taumel.Shared.trim_non_empty
           with
          | Some error -> Some error
          | None when get_bool facts "missingSessionIdentifier" ->
              Some Taumel.Child_session.missing_session_identifier_error
          | None -> None);
        active_tools = optional_string_array facts "activeTools";
        active_tools_applied = get_bool facts "activeToolsApplied";
        model_id =
          Option.bind (optional_string_field facts "modelId")
            Taumel.Shared.trim_non_empty;
        model_applied = get_bool facts "modelApplied";
        thinking_level =
          Option.bind (optional_string_field facts "thinkingLevel")
            Taumel.Shared.trim_non_empty;
        thinking_applied = get_bool facts "thinkingApplied";
      }

let child_bridge_details facts =
  json_to_js
    (Taumel.Child_session.bridge_details
       (child_session_bridge_from_js facts))

let js_child_dispatch_plan (plan : Taumel.Child_session.dispatch_plan) =
  Unsafe.obj
    [|
      ("send", js_bool plan.send);
      ("prompt", js_string plan.prompt);
      ("deliverAs", js_string plan.deliver_as);
      ("result", json_to_js plan.result);
    |]

let plan_child_dispatch facts =
  let bridge = child_session_bridge_from_js facts in
  let empty_reason =
    Option.value
      (Option.bind (optional_string_field facts "emptyReason")
         Taumel.Shared.trim_non_empty)
      ~default:"empty prompt"
  in
  let deliver_as =
    Option.bind (optional_string_field facts "deliverAs")
      Taumel.Shared.trim_non_empty
  in
  Taumel.Child_session.dispatch_plan ?bridge ~empty_reason
    ?deliver_as ~prompt:(get_string facts "prompt")
    ~send_available:(get_bool facts "sendAvailable")
    ()
  |> js_child_dispatch_plan

let plan_child_session_start metadata parent =
  let metadata = child_session_metadata_from_js metadata in
  let parent_session_id, parent_session_file = child_session_parent_from_js parent in
  let plan =
    Taumel.Child_session.start_plan ~metadata ~parent_session_id
      ~parent_session_file
  in
  Unsafe.obj
    [|
      ( "parentSession",
        match plan.parent_session with
        | None -> Unsafe.inject Js.null
        | Some value -> js_string value );
      ( "modelId",
        match plan.model_id with
        | None -> Unsafe.inject Js.null
        | Some value -> js_string value );
      ( "thinkingLevel",
        match plan.thinking_level with
        | None -> Unsafe.inject Js.null
        | Some value -> js_string value );
      ( "activeTools",
        match plan.active_tools with
        | None -> Unsafe.inject Js.null
        | Some tools -> js_array (List.map js_string tools) );
      ( "setupEntries",
        js_array (List.map js_child_session_custom_entry plan.setup_entries) );
    |]
