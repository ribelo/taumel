open Jsoo_bridge

let session_id_from_ctx ctx =
  match optional_string_field ctx "taumelSessionId" with
  | Some value when String.trim value <> "" -> String.trim value
  | _ ->
      let session_manager = Unsafe.get ctx "sessionManager" in
      (match function_field session_manager "getSessionId" with
      | Some _ -> (
        match
          string_value
            (Unsafe.meth_call session_manager "getSessionId" [||])
        with
        | Some value when String.trim value <> "" -> String.trim value
        | _ -> "current")
      | _ -> "current")

let branch_entries_array_opt ctx =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getBranch" with
  | None -> None
  | Some _ -> array_value (call0 session_manager "getBranch")

let branch_entries_opt ctx = Option.map Array.to_list (branch_entries_array_opt ctx)

let branch_entries ctx = Option.value (branch_entries_opt ctx) ~default:[]

let branch_json_entries ctx =
  List.map
    (fun entry ->
      match json_from_js entry with
      | Ok json -> json
      | Error _ -> Taumel.Shared.Object [])
    (branch_entries ctx)

let custom_entry_data ctx custom_type =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getEntries" with
  | None -> None
  | Some _ -> (
      match array_value (call0 session_manager "getEntries") with
      | None -> None
      | Some entries ->
      let entries = Array.to_list entries |> List.rev in
      let rec find = function
        | [] -> None
        | entry :: rest ->
            if
              get_string entry "type" = "custom"
              && get_string entry "customType" = custom_type
            then Some (Unsafe.get entry "data")
            else find rest
      in
      find entries)

let append_custom_entry ctx custom_type json =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "appendCustomEntry" with
  | Some _ ->
    ignore
      (call2 session_manager "appendCustomEntry" (js_string custom_type)
         (json_to_js json))
  | _ -> ()
