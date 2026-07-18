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

let session_file_from_ctx ctx =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getSessionFile" with
  | None -> None
  | Some _ -> (
      match
        string_value (Unsafe.meth_call session_manager "getSessionFile" [||])
      with
      | Some value when String.trim value <> "" -> Some (String.trim value)
      | _ -> None)

let owner_is_persistent ctx = Option.is_some (session_file_from_ctx ctx)

let session_has_parent ctx =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getHeader" with
  | None -> false
  | Some _ -> (
      let header = call0 session_manager "getHeader" in
      match optional_string_field header "parentSession" with
      | Some parent -> String.trim parent <> ""
      | None -> false)

let branch_entries_array_opt ctx =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getBranch" with
  | None -> None
  | Some _ -> array_value (call0 session_manager "getBranch")

(* Chronological order: oldest first, newest last. *)
let custom_entries_data ctx custom_type =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "getEntries" with
  | None -> []
  | Some _ -> (
      match array_value (call0 session_manager "getEntries") with
      | None -> []
      | Some entries ->
          let rec collect index acc =
            if index >= Array.length entries then List.rev acc
            else
              let entry = entries.(index) in
              if
                get_string entry "type" = "custom"
                && get_string entry "customType" = custom_type
              then collect (index + 1) (Unsafe.get entry "data" :: acc)
              else collect (index + 1) acc
          in
          collect 0 [])

let custom_entry_data ctx custom_type =
  match List.rev (custom_entries_data ctx custom_type) with
  | latest :: _ -> Some latest
  | [] -> None

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

let try_append_custom_entry ctx custom_type json =
  let session_manager = Unsafe.get ctx "sessionManager" in
  match function_field session_manager "appendCustomEntry" with
  | Some _ ->
      ignore
        (call2 session_manager "appendCustomEntry" (js_string custom_type)
           (json_to_js json));
      Ok ()
  | None -> Error "session manager cannot append custom entries"

let append_custom_entry ctx custom_type json =
  ignore (try_append_custom_entry ctx custom_type json)

let require_append_custom_entry ctx custom_type json =
  match try_append_custom_entry ctx custom_type json with
  | Ok () -> ()
  | Error message -> failwith message
