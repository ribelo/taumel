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

let custom_entry_data ctx custom_type =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getEntries" with
  | None -> None
  | Some _ -> (
      match array_value (call0 session_manager "getEntries") with
      | None -> None
      | Some entries ->
          let rec find index =
            if index < 0 then None
            else
              let entry = entries.(index) in
              if
                get_string entry "type" = "custom"
                && get_string entry "customType" = custom_type
              then Some (Unsafe.get entry "data")
              else find (index - 1)
          in
          find (Array.length entries - 1))

let child_session_metadata_of_data = function
  | None -> Ok None
  | Some data -> (
      match json_from_js data with
      | Error message -> Error ("invalid child session metadata: " ^ message)
      | Ok json ->
          Result.map Option.some
            (Taumel.Child_session.decode_persisted_metadata json))

let child_session_metadata ctx =
  child_session_metadata_of_data (custom_entry_data ctx "taumel.childSession")

let append_custom_entry ctx custom_type json =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "appendCustomEntry" with
  | Some _ ->
    ignore
      (call2 session_manager "appendCustomEntry" (js_string custom_type)
         (json_to_js json))
  | _ -> ()
