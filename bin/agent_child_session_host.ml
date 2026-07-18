open Jsoo_bridge

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string name |]

let crypto = lazy (node_require "crypto")
let fs = lazy (node_require "fs")
let path = lazy (node_require "path")

let join parts =
  Unsafe.meth_call (Lazy.force path) "join"
    (Array.of_list (List.map js_string parts))
  |> Js.to_string

let owner_component owner_session_id =
  let hash =
    Unsafe.meth_call (Lazy.force crypto) "createHash" [| js_string "sha256" |]
  in
  ignore (Unsafe.meth_call hash "update" [| js_string owner_session_id |]);
  Unsafe.meth_call hash "digest" [| js_string "hex" |] |> Js.to_string

let valid_agent_component agent_id =
  agent_id <> "" && agent_id <> "." && agent_id <> ".."
  && not (String.contains agent_id '/')
  && not (String.contains agent_id '\\')

let private_root () =
  join [ Agent_worktree_host.pi_agent_dir (); "taumel"; "agents"; "owners" ]

let private_directory ~owner_session_id ~agent_id =
  let owner_session_id = String.trim owner_session_id in
  let agent_id = String.trim agent_id in
  if owner_session_id = "" then Error "agent owner session id is required"
  else if not (valid_agent_component agent_id) then
    Error "agent id is not a valid private-session path component"
  else
    Ok
      (join
         [ private_root (); owner_component owner_session_id; agent_id ])

let cleanup_envelope ~owner_session_id ~agent_id =
  let owner_session_id = String.trim owner_session_id in
  let agent_id = String.trim agent_id in
  if owner_session_id = "" then Error "agent owner session id is required"
  else if not (valid_agent_component agent_id) then
    Error "agent id is not a valid private-session path component"
  else
    Ok
      (join
         [
           private_root ();
           owner_component owner_session_id;
           ".cleanup-" ^ agent_id;
         ])

let path_exists target =
  try
    ignore (Unsafe.meth_call (Lazy.force fs) "lstatSync" [| js_string target |]);
    true
  with _ -> false

let realpath target =
  try
    Ok
      (Unsafe.meth_call (Lazy.force fs) "realpathSync" [| js_string target |]
      |> Js.to_string)
  with error -> Error (Printexc.to_string error)

let is_directory target =
  try
    let stat =
      Unsafe.meth_call (Lazy.force fs) "lstatSync" [| js_string target |]
    in
    Js.to_bool (Unsafe.meth_call stat "isDirectory" [||])
  with _ -> false

let is_regular_file target =
  try
    let stat =
      Unsafe.meth_call (Lazy.force fs) "lstatSync" [| js_string target |]
    in
    Js.to_bool (Unsafe.meth_call stat "isFile" [||])
  with _ -> false

let list_directory target =
  try
    Unsafe.meth_call (Lazy.force fs) "readdirSync" [| js_string target |]
    |> array_value |> Option.value ~default:[||] |> Array.to_list
    |> List.filter_map string_value
  with _ -> []

let mkdir_p target =
  try
    ignore
      (Unsafe.meth_call (Lazy.force fs) "mkdirSync"
         [|
           js_string target;
           Unsafe.obj [| ("recursive", js_bool true) |];
         |]);
    Ok ()
  with error -> Error (Printexc.to_string error)

let write_file target contents =
  try
    ignore
      (Unsafe.meth_call (Lazy.force fs) "writeFileSync"
         [| js_string target; js_string contents; js_string "utf8" |]);
    Ok ()
  with error -> Error (Printexc.to_string error)

let write_file_durable_with_flag ~flag target contents =
  let descriptor = ref None in
  let close () =
    match !descriptor with
    | None -> ()
    | Some fd ->
        descriptor := None;
        (try
           ignore (Unsafe.meth_call (Lazy.force fs) "closeSync" [| fd |])
         with _ -> ())
  in
  try
    let fd =
      Unsafe.meth_call (Lazy.force fs) "openSync"
        [| js_string target; js_string flag; js_number 384. |]
    in
    descriptor := Some fd;
    ignore
      (Unsafe.meth_call (Lazy.force fs) "writeFileSync"
         [| fd; js_string contents; js_string "utf8" |]);
    ignore (Unsafe.meth_call (Lazy.force fs) "fsyncSync" [| fd |]);
    close ();
    Ok ()
  with error ->
    close ();
    Error (Printexc.to_string error)

let write_file_durable target contents =
  write_file_durable_with_flag ~flag:"w" target contents

let write_file_exclusive_durable target contents =
  write_file_durable_with_flag ~flag:"wx" target contents

let read_file target =
  try
    Ok
      (Unsafe.meth_call (Lazy.force fs) "readFileSync"
         [| js_string target; js_string "utf8" |]
      |> Js.to_string)
  with error -> Error (Printexc.to_string error)

let rename source destination =
  try
    ignore
      (Unsafe.meth_call (Lazy.force fs) "renameSync"
         [| js_string source; js_string destination |]);
    Ok ()
  with error -> Error (Printexc.to_string error)

let link_file source destination =
  try
    ignore
      (Unsafe.meth_call (Lazy.force fs) "linkSync"
         [| js_string source; js_string destination |]);
    Ok ()
  with error -> Error (Printexc.to_string error)

(* Recursive and single-entry cleanup deletion is descriptor-anchored in
   Agent_anchored_fs (ADR 0003): ancestor and component swaps cannot redirect
   deletion outside the pinned tree, and symlinks are never traversed. *)
let unlink_tree target = Agent_anchored_fs.unlink_tree target

let unlink_file target = Agent_anchored_fs.unlink_file target

let rmdir target = Agent_anchored_fs.rmdir target

let child_marker_counts ~owner_session_id ~agent_id raw =
  raw |> String.split_on_char '\n'
  |> List.fold_left
       (fun (marker_count, matching_count) line ->
         match Taumel.Shared.decode_json_string line with
         | Ok (Taumel.Shared.Object fields) -> (
             match
               ( List.assoc_opt "type" fields,
                 List.assoc_opt "customType" fields,
                 List.assoc_opt "data" fields )
             with
             | Some (Taumel.Shared.String "custom"),
               Some (Taumel.Shared.String "taumel.childSession"),
               Some (Taumel.Shared.Object data) ->
                 let string name =
                   match List.assoc_opt name data with
                   | Some (Taumel.Shared.String value) -> value
                   | _ -> ""
                 in
                 let matches =
                   string "agentId" = agent_id
                   && string "parentSessionId" = owner_session_id
                 in
                 (marker_count + 1, matching_count + if matches then 1 else 0)
             | _ -> (marker_count, matching_count))
         | _ -> (marker_count, matching_count))
       (0, 0)

let directory_has_marker ~owner_session_id ~agent_id directory =
  let names =
    try
      Unsafe.meth_call (Lazy.force fs) "readdirSync" [| js_string directory |]
      |> array_value |> Option.value ~default:[||] |> Array.to_list
      |> List.filter_map string_value
    with _ -> []
  in
  let marker_count, matching_count =
    List.fold_left
      (fun (marker_count, matching_count) name ->
        if not (String.ends_with ~suffix:".jsonl" name) then
          (marker_count, matching_count)
        else
          let candidate = join [ directory; name ] in
          if not (is_regular_file candidate) then
            (marker_count, matching_count)
          else
            try
              let raw =
                Unsafe.meth_call (Lazy.force fs) "readFileSync"
                  [| js_string candidate; js_string "utf8" |]
                |> Js.to_string
              in
              let file_markers, file_matches =
                child_marker_counts ~owner_session_id ~agent_id raw
              in
              (marker_count + file_markers, matching_count + file_matches)
            with _ -> (marker_count, matching_count))
      (0, 0) names
  in
  marker_count = 1 && matching_count = 1

let validate_exact_directory ?(require_child_marker = false) ~owner_session_id
    ~agent_id ~expected directory =
  if not (path_exists directory) then Ok None
  else if not (is_directory directory) then
    Error "private child-session target is not a directory"
  else
    match (realpath (private_root ()), realpath directory) with
    | Error _, _ | _, Error _ ->
        Error "private child-session target cannot be resolved canonically"
    | Ok canonical_root, Ok canonical_directory ->
        if canonical_directory <> expected then
          Error "private child-session target escapes its derived owner directory"
        else if
          not
            (Taumel.Sandbox.path_within ~root:canonical_root
               canonical_directory)
        then
          Error
            "private child-session target escapes Taumel's private agent directory"
        else if
          require_child_marker
          && not
               (directory_has_marker ~owner_session_id ~agent_id
                  canonical_directory)
        then
          Error "private child-session identity marker is missing or mismatched"
        else Ok (Some canonical_directory)

let authorized_private_session ~(identity : Taumel.Agents.identity) =
  let owner_session_id = identity.identity_owner_session_id in
  let agent_id = identity.identity_agent_id in
  match private_directory ~owner_session_id ~agent_id with
  | Error _ as error -> error
  | Ok live_path ->
      validate_exact_directory ~require_child_marker:true ~owner_session_id
        ~agent_id ~expected:live_path live_path

let fresh_nonce () =
  Unsafe.meth_call (Lazy.force crypto) "randomUUID" [||] |> Js.to_string

type staged_private_session =
  | No_private_session
  | Staged of {
      owner_session_id : string;
      agent_id : string;
      live_path : string;
      envelope_path : string;
      payload_path : string;
      marker_path : string;
      cleanup_nonce : string;
    }

type cleanup_marker = {
  marker_owner_session_id : string;
  marker_agent_id : string;
  marker_cleanup_nonce : string;
  marker_scope : string;
  marker_phase : string;
}

let write_envelope_marker ~scope ~marker_path ~owner_session_id ~agent_id
    ~cleanup_nonce =
  let body =
    Taumel.Shared.encode_json
      (Taumel.Shared.Object
         [
           ("version", Taumel.Shared.Number 1.);
           ("owner_session_id", Taumel.Shared.String owner_session_id);
           ("agent_id", Taumel.Shared.String agent_id);
           ("cleanup_nonce", Taumel.Shared.String cleanup_nonce);
           ("scope", Taumel.Shared.String scope);
           ("phase", Taumel.Shared.String "prepared");
         ])
  in
  write_file_durable marker_path body

let read_envelope_marker marker_path =
  match read_file marker_path with
  | Error _ as error -> error
  | Ok raw -> (
      match Taumel.Shared.decode_json_string raw with
      | Error _ as error -> error
      | Ok (Taumel.Shared.Object fields) ->
          let string name =
            match List.assoc_opt name fields with
            | Some (Taumel.Shared.String value) -> value
            | _ -> ""
          in
          Ok
            {
              marker_owner_session_id = string "owner_session_id";
              marker_agent_id = string "agent_id";
              marker_cleanup_nonce = string "cleanup_nonce";
              marker_scope = string "scope";
              marker_phase = string "phase";
            }
      | Ok _ -> Error "cleanup marker must be an object")

let remove_envelope_shell ~marker_path ~envelope_path =
  (match path_exists marker_path with
  | false -> Ok ()
  | true -> (
      match unlink_file marker_path with
      | Ok () -> Ok ()
      | Error message ->
          Error ("private child-session envelope marker removal failed: " ^ message)))
  |> function
  | Error _ as error -> error
  | Ok () ->
      if not (path_exists envelope_path) then Ok ()
      else
        match rmdir envelope_path with
        | Ok () -> Ok ()
        | Error message ->
            Error
              ("private child-session envelope removal failed: " ^ message)

let stage_authorized_private_session ?(ephemeral = false)
    ~(identity : Taumel.Agents.identity) authorized =
  let owner_session_id = identity.identity_owner_session_id in
  let agent_id = identity.identity_agent_id in
  match
    ( private_directory ~owner_session_id ~agent_id,
      cleanup_envelope ~owner_session_id ~agent_id )
  with
  | Error _ as error, _ | _, (Error _ as error) -> error
  | Ok live_path, Ok envelope_path -> (
      let payload_path = join [ envelope_path; "session" ] in
      let marker_path = join [ envelope_path; "cleanup-marker.json" ] in
      match authorized with
      | None ->
          if path_exists envelope_path || path_exists payload_path then
            match read_envelope_marker marker_path with
            | Error message -> Error message
            | Ok marker ->
                if
                  marker.marker_owner_session_id <> owner_session_id
                  || marker.marker_agent_id <> agent_id
                then Error "cleanup envelope marker mismatch"
                else
                  Ok
                    (Staged
                       {
                         owner_session_id;
                         agent_id;
                         live_path;
                         envelope_path;
                         payload_path;
                         marker_path;
                         cleanup_nonce = marker.marker_cleanup_nonce;
                       })
          else Ok No_private_session
      | Some current_path ->
          let staged cleanup_nonce =
            Staged
              {
                owner_session_id;
                agent_id;
                live_path;
                envelope_path;
                payload_path;
                marker_path;
                cleanup_nonce;
              }
          in
          let stage_live ~preserve_marker cleanup_nonce =
            match rename current_path payload_path with
            | Ok () -> Ok (staged cleanup_nonce)
            | Error message ->
                if not preserve_marker then ignore (unlink_tree envelope_path);
                Error ("private child-session staging failed: " ^ message)
          in
          let create_and_stage () =
            let cleanup_nonce = fresh_nonce () in
            match mkdir_p envelope_path with
            | Error message ->
                Error ("private child-session envelope create failed: " ^ message)
            | Ok () -> (
                match
                  write_envelope_marker
                    ~scope:(if ephemeral then "ephemeral" else "durable")
                    ~marker_path ~owner_session_id ~agent_id ~cleanup_nonce
                with
                | Error message ->
                    ignore (unlink_tree envelope_path);
                    Error
                      ("private child-session envelope marker write failed: "
                     ^ message)
                | Ok () -> stage_live ~preserve_marker:false cleanup_nonce)
          in
          if not (path_exists envelope_path) then create_and_stage ()
          else if path_exists payload_path then
            Error "private child-session cleanup envelope already exists"
          else
            match read_envelope_marker marker_path with
            | Error _ as error -> error
            | Ok marker
              when marker.marker_owner_session_id = owner_session_id
                   && marker.marker_agent_id = agent_id
                   && marker.marker_scope = "ephemeral"
                   && marker.marker_phase = "prepared"
                   && marker.marker_cleanup_nonce <> "" ->
                stage_live ~preserve_marker:true marker.marker_cleanup_nonce
            | Ok marker
              when marker.marker_owner_session_id <> owner_session_id
                   || marker.marker_agent_id <> agent_id ->
                Error "cleanup envelope marker mismatch"
            | Ok _ -> (
                (* A durable empty shell can remain after payload recovery if its
                   final shell removal was interrupted. Remove it before retry. *)
                match remove_envelope_shell ~marker_path ~envelope_path with
                | Error _ as error -> error
                | Ok () -> create_and_stage ()))

let try_recover_uncommitted_envelope ~owner_session_id ~agent_id ~live_path =
  match cleanup_envelope ~owner_session_id ~agent_id with
  | Error _ -> Ok None
  | Ok envelope_path ->
      let payload_path = join [ envelope_path; "session" ] in
      let marker_path = join [ envelope_path; "cleanup-marker.json" ] in
      if not (path_exists envelope_path) && not (path_exists payload_path) then
        Ok None
      else
        match read_envelope_marker marker_path with
        | Error _ -> Ok None
        | Ok marker ->
            if
              marker.marker_owner_session_id <> owner_session_id
              || marker.marker_agent_id <> agent_id
            then
              Ok None
            else if path_exists live_path then Ok None
            else if not (path_exists payload_path) then (
              match
                if
                  marker.marker_scope = "ephemeral"
                  && marker.marker_phase = "prepared"
                then Ok ()
                else remove_envelope_shell ~marker_path ~envelope_path
              with
              | Error message -> Error message
              | Ok () -> Ok None)
            else
              match rename payload_path live_path with
              | Error _ -> Ok None
              | Ok () -> (
                  match
                    if
                      marker.marker_scope = "ephemeral"
                      && marker.marker_phase = "prepared"
                    then Ok ()
                    else remove_envelope_shell ~marker_path ~envelope_path
                  with
                  | Error message -> Error message
                  | Ok () -> Ok (Some live_path))

let recover_uncommitted_envelope_for_identity
    ~(identity : Taumel.Agents.identity) =
  let owner_session_id = identity.identity_owner_session_id in
  let agent_id = identity.identity_agent_id in
  match private_directory ~owner_session_id ~agent_id with
  | Error _ as error -> error
  | Ok live_path -> (
      match
        try_recover_uncommitted_envelope ~owner_session_id ~agent_id ~live_path
      with
      | Error _ as error -> error
      | Ok None -> Ok None
      | Ok (Some recovered) ->
          validate_exact_directory ~require_child_marker:true ~owner_session_id
            ~agent_id ~expected:live_path recovered)

let unstage_private_session = function
  | No_private_session -> Ok ()
  | Staged { live_path; envelope_path; payload_path; marker_path; _ } ->
      let finish () =
        match read_envelope_marker marker_path with
        | Ok marker
          when marker.marker_scope = "ephemeral"
               && marker.marker_phase = "prepared" ->
            Ok ()
        | _ -> remove_envelope_shell ~marker_path ~envelope_path
      in
      if path_exists payload_path then
        if path_exists live_path then
          Error "private child-session live path already exists during unstage"
        else
          match rename payload_path live_path with
          | Error message ->
              Error ("private child-session unstage failed: " ^ message)
          | Ok () -> finish ()
      else finish ()

let finalize_private_session = function
  | No_private_session -> Ok ()
  | Staged
      {
        owner_session_id;
        agent_id;
        envelope_path;
        payload_path;
        marker_path;
        cleanup_nonce;
        _;
      } -> (
      match cleanup_envelope ~owner_session_id ~agent_id with
      | Error _ as error -> error
      | Ok expected_envelope -> (
          match
            ( realpath (private_root ()),
              if path_exists envelope_path then realpath envelope_path
              else Ok expected_envelope )
          with
          | Error message, _ | _, Error message ->
              Error
                ("private child-session finalization resolve failed: " ^ message)
          | Ok canonical_root, Ok canonical_envelope ->
              if canonical_envelope <> expected_envelope then
                Error
                  "private child-session finalization envelope escapes its derived location"
              else if
                not
                  (Taumel.Sandbox.path_within ~root:canonical_root
                     canonical_envelope)
              then
                Error
                  "private child-session finalization envelope escapes Taumel's private agent directory"
              else
                match read_envelope_marker marker_path with
                | Error message when path_exists marker_path -> Error message
                | Error _ when not (path_exists payload_path) ->
                    remove_envelope_shell ~marker_path ~envelope_path
                | Error message -> Error message
                | Ok marker ->
                    if
                      marker.marker_owner_session_id <> owner_session_id
                      || marker.marker_agent_id <> agent_id
                      || marker.marker_cleanup_nonce <> cleanup_nonce
                    then Error "private child-session finalization marker mismatch"
                    else if not (path_exists payload_path) then
                      remove_envelope_shell ~marker_path ~envelope_path
                    else
                      (* After tombstone commit, the envelope marker is authoritative.
                         Do not require the child marker inside payload: partial
                         recursive deletion may have removed it while content remains. *)
                      match
                        validate_exact_directory ~owner_session_id ~agent_id
                          ~expected:payload_path payload_path
                      with
                      | Error _ as error -> error
                      | Ok None -> remove_envelope_shell ~marker_path ~envelope_path
                      | Ok (Some canonical_payload) -> (
                          match unlink_tree canonical_payload with
                          | Error message ->
                              Error
                                ("private child-session finalization failed: "
                               ^ message)
                          | Ok () ->
                              remove_envelope_shell ~marker_path ~envelope_path)))

let stage_authorized_private_sessions
    (items : (Taumel.Agents.identity * string option) list) =
  let rec loop staged remaining =
    match remaining with
    | [] -> Ok (List.rev staged)
    | (identity, authorized) :: rest -> (
        match stage_authorized_private_session ~identity authorized with
        | Ok item -> loop (item :: staged) rest
        | Error message -> (
            match unstage_private_sessions (List.rev staged) with
            | Ok () -> Error message
            | Error unstage_message ->
                Error (message ^ "; unstage failed: " ^ unstage_message)))
  and unstage_private_sessions staged =
    List.fold_left
      (fun result item ->
        match result with
        | Error _ as error -> error
        | Ok () -> unstage_private_session item)
      (Ok ()) staged
  in
  loop [] items

let unstage_private_sessions staged =
  List.fold_left
    (fun result item ->
      match result with
      | Error _ as error -> error
      | Ok () -> unstage_private_session item)
    (Ok ()) (List.rev staged)

let finalize_private_sessions staged =
  let rec loop = function
    | [] -> Ok ()
    | item :: rest -> (
        match finalize_private_session item with
        | Ok () -> loop rest
        | Error _ as error -> error)
  in
  loop staged

let staged_cleanup_nonce = function
  | No_private_session -> None
  | Staged { cleanup_nonce; _ } -> Some cleanup_nonce

let staged_agent_id = function
  | No_private_session -> None
  | Staged { agent_id; _ } -> Some agent_id

let remove_private_session ~identity =
  match authorized_private_session ~identity with
  | Error _ as error -> error
  | Ok authorized -> (
      match stage_authorized_private_session ~identity authorized with
      | Error _ as error -> error
      | Ok staged -> (
          match finalize_private_session staged with
          | Ok () -> Ok ()
          | Error message ->
              ignore (unstage_private_session staged);
              Error message))

let finalize_cleanup_pending (pending : Taumel.Agents.cleanup_pending) =
  match
    cleanup_envelope ~owner_session_id:pending.cleanup_owner_session_id
      ~agent_id:pending.cleanup_agent_id
  with
  | Error _ as error -> error
  | Ok envelope_path ->
      let staged =
        if not (path_exists envelope_path) then No_private_session
        else
          Staged
            {
              owner_session_id = pending.cleanup_owner_session_id;
              agent_id = pending.cleanup_agent_id;
              live_path =
                (match
                   private_directory
                     ~owner_session_id:pending.cleanup_owner_session_id
                     ~agent_id:pending.cleanup_agent_id
                 with
                | Ok path -> path
                | Error _ -> "");
              envelope_path;
              payload_path = join [ envelope_path; "session" ];
              marker_path = join [ envelope_path; "cleanup-marker.json" ];
              cleanup_nonce = pending.cleanup_nonce;
            }
      in
      finalize_private_session staged

let restore_failure_detail ~primary ~unstage_error ~restore_error =
  [
    Some primary;
    Option.map (fun message -> "unstage failed: " ^ message) unstage_error;
    Option.map
      (fun message -> "identity restore persist failed: " ^ message)
      restore_error;
  ]
  |> List.filter_map Fun.id
  |> String.concat "; "

let cleanup_journal_path () =
  join [ private_root (); "cleanup-journal.jsonl" ]

let journal_record_line ~op ~owner_session_id ~agent_id ~cleanup_nonce =
  Taumel.Shared.encode_json
    (Taumel.Shared.Object
       [
         ("op", Taumel.Shared.String op);
         ("owner_session_id", Taumel.Shared.String owner_session_id);
         ("agent_id", Taumel.Shared.String agent_id);
         ("cleanup_nonce", Taumel.Shared.String cleanup_nonce);
       ])
  ^ "\n"

let append_cleanup_journal_lines lines =
  match lines with
  | [] -> Ok ()
  | _ -> (
      match mkdir_p (private_root ()) with
      | Error message ->
          Error ("cleanup journal root create failed: " ^ message)
      | Ok () -> (
          try
            ignore
              (Unsafe.meth_call (Lazy.force fs) "appendFileSync"
                 [|
                   js_string (cleanup_journal_path ());
                   js_string (String.concat "" lines);
                   js_string "utf8";
                 |]);
            Ok ()
          with error ->
            Error
              ("cleanup journal append failed: " ^ Printexc.to_string error)))

let append_cleanup_journal_op ~op ~owner_session_id ~agent_id ~cleanup_nonce =
  append_cleanup_journal_lines
    [ journal_record_line ~op ~owner_session_id ~agent_id ~cleanup_nonce ]

let append_cleanup_journal_record ~owner_session_id ~agent_id ~cleanup_nonce =
  append_cleanup_journal_op ~op:"pending" ~owner_session_id ~agent_id
    ~cleanup_nonce

let append_cleanup_journal_records
    (pending_items : Taumel.Agents.cleanup_pending list) =
  append_cleanup_journal_lines
    (List.map
       (fun (pending : Taumel.Agents.cleanup_pending) ->
         journal_record_line ~op:"pending"
           ~owner_session_id:pending.cleanup_owner_session_id
           ~agent_id:pending.cleanup_agent_id
           ~cleanup_nonce:pending.cleanup_nonce)
       pending_items)

let remove_cleanup_journal_record ~owner_session_id ~agent_id ~cleanup_nonce =
  (* Append-only completion record; never rewrite the journal. *)
  append_cleanup_journal_op ~op:"done" ~owner_session_id ~agent_id ~cleanup_nonce

let read_cleanup_journal () =
  if not (path_exists (cleanup_journal_path ())) then Ok []
  else
    match read_file (cleanup_journal_path ()) with
    | Error message -> Error ("cleanup journal read failed: " ^ message)
    | Ok raw ->
        let pending = Hashtbl.create 16 in
        let done_keys = Hashtbl.create 16 in
        let key owner agent nonce = owner ^ "\000" ^ agent ^ "\000" ^ nonce in
        raw |> String.split_on_char '\n'
        |> List.iter (fun line ->
               let line = String.trim line in
               if line <> "" then
                 match Taumel.Shared.decode_json_string line with
                 | Ok (Taumel.Shared.Object fields) ->
                     let string name =
                       match List.assoc_opt name fields with
                       | Some (Taumel.Shared.String value) -> value
                       | _ -> ""
                     in
                     let op = string "op" in
                     let owner = string "owner_session_id" in
                     let agent = string "agent_id" in
                     let nonce = string "cleanup_nonce" in
                     if owner = "" || agent = "" || nonce = "" then ()
                     else
                       let k = key owner agent nonce in
                       if op = "done" then Hashtbl.replace done_keys k true
                       else if op = "pending" || op = "" then
                         Hashtbl.replace pending k
                           {
                             Taumel.Agents.cleanup_owner_session_id = owner;
                             cleanup_agent_id = agent;
                             cleanup_nonce = nonce;
                             cleanup_remaining_artifacts = [ "private_session" ];
                           }
                 | _ -> ());
        let records =
          Hashtbl.fold
            (fun k pending acc ->
              if Hashtbl.mem done_keys k then acc else pending :: acc)
            pending []
        in
        Ok records

let reconcile_cleanup_journal () =
  (* Durable cleanups are journal-only. Explicit deferred ephemeral markers are
     promoted under their process lease before this journal reconciliation. *)
  match read_cleanup_journal () with
  | Error message -> Error message
  | Ok records ->
      List.iter
        (fun pending ->
          match finalize_cleanup_pending pending with
          | Ok () ->
              ignore
                (remove_cleanup_journal_record
                   ~owner_session_id:pending.cleanup_owner_session_id
                   ~agent_id:pending.cleanup_agent_id
                   ~cleanup_nonce:pending.cleanup_nonce)
          | Error _ -> ())
        records;
      Ok ()
