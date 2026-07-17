open Jsoo_bridge

module Host = Agent_child_session_host

type lease = {
  owner_session_id : string;
  path : string;
  nonce : string;
  pid : int;
  process_start : string;
}

type lease_error = Lease_held | Lease_error of string

let active_leases : (string, lease) Hashtbl.t = Hashtbl.create 4

let process_object () = Unsafe.get Unsafe.global "process"

let current_pid () =
  Unsafe.get (process_object ()) "pid" |> float_value
  |> Option.map int_of_float |> Option.value ~default:0

let process_start_token pid =
  match Host.read_file (Printf.sprintf "/proc/%d/stat" pid) with
  | Error _ -> ""
  | Ok raw -> (
      match String.rindex_opt raw ')' with
      | None -> ""
      | Some index ->
          String.sub raw (index + 1) (String.length raw - index - 1)
          |> String.split_on_char ' '
          |> List.filter (fun value -> value <> "")
          |> fun fields -> List.nth_opt fields 19
          |> Option.value ~default:"")

let process_is_alive pid expected_start =
  if pid <= 0 then false
  else
    let actual_start = process_start_token pid in
    if expected_start <> "" && actual_start <> "" then
      actual_start = expected_start
    else
      let predicate =
        Unsafe.js_expr
          "((process, pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } })"
      in
      Js.to_bool
        (Unsafe.coerce
           (Unsafe.fun_call predicate
              [| inject (process_object ()); js_number (float_of_int pid) |]))

let owner_directory owner_session_id =
  Host.join [ Host.private_root (); Host.owner_component owner_session_id ]

let lease_path owner_session_id =
  Host.join
    [ owner_directory owner_session_id; ".ephemeral-cleanup.lease.json" ]

let encode lease =
  Taumel.Shared.encode_json
    (Taumel.Shared.Object
       [
         ("owner_session_id", Taumel.Shared.String lease.owner_session_id);
         ("nonce", Taumel.Shared.String lease.nonce);
         ("pid", Taumel.Shared.Number (float_of_int lease.pid));
         ("process_start", Taumel.Shared.String lease.process_start);
       ])

let read path =
  match Host.read_file path with
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
          let pid =
            match List.assoc_opt "pid" fields with
            | Some (Taumel.Shared.Number value) -> int_of_float value
            | _ -> 0
          in
          Ok
            {
              owner_session_id = string "owner_session_id";
              path;
              nonce = string "nonce";
              pid;
              process_start = string "process_start";
            }
      | Ok _ -> Error "ephemeral cleanup lease must be an object")

let publish lease =
  let temporary = lease.path ^ ".tmp-" ^ lease.nonce in
  match Host.write_file_durable temporary (encode lease) with
  | Error message -> Error message
  | Ok () -> (
      match Host.link_file temporary lease.path with
      | Ok () ->
          ignore (Host.unlink_file temporary);
          Ok ()
      | Error message ->
          ignore (Host.unlink_file temporary);
          Error message)

let acquire ~owner_session_id =
  match Hashtbl.find_opt active_leases owner_session_id with
  | Some lease -> Ok lease
  | None -> (
      match Host.mkdir_p (owner_directory owner_session_id) with
      | Error message -> Error (Lease_error message)
      | Ok () ->
          let owner_path = owner_directory owner_session_id in
          let owner_valid =
            Host.validate_exact_directory ~owner_session_id ~agent_id:""
              ~expected:owner_path owner_path
          in
          let path = lease_path owner_session_id in
          let rec loop attempts =
            let pid = current_pid () in
            let candidate =
              {
                owner_session_id;
                path;
                nonce = Host.fresh_nonce ();
                pid;
                process_start = process_start_token pid;
              }
            in
            match publish candidate with
            | Ok () ->
                Hashtbl.replace active_leases owner_session_id candidate;
                Ok candidate
            | Error _ when attempts < 3 -> (
                match read path with
                | Error _ when not (Host.path_exists path) -> loop (attempts + 1)
                | Error message -> Error (Lease_error message)
                | Ok current
                  when process_is_alive current.pid current.process_start ->
                    Error Lease_held
                | Ok _ ->
                    let quarantine = path ^ ".reclaim-" ^ Host.fresh_nonce () in
                    (match Host.rename path quarantine with
                    | Error _ -> loop (attempts + 1)
                    | Ok () ->
                        ignore (Host.unlink_file quarantine);
                        loop (attempts + 1)))
            | Error message -> Error (Lease_error message)
          in
          (match owner_valid with
          | Error message -> Error (Lease_error message)
          | Ok None -> Error (Lease_error "ephemeral cleanup owner is missing")
          | Ok (Some _) -> loop 0))

let release lease =
  let result =
    match read lease.path with
    | Error _ when not (Host.path_exists lease.path) -> Ok ()
    | Error message -> Error message
    | Ok current when current.nonce <> lease.nonce ->
        Error "ephemeral cleanup lease ownership changed"
    | Ok _ -> Host.unlink_file lease.path
  in
  Hashtbl.remove active_leases lease.owner_session_id;
  result

let release_owner owner_session_id =
  match Hashtbl.find_opt active_leases owner_session_id with
  | None -> Ok ()
  | Some lease -> release lease

let held_by_current_process owner_session_id =
  Hashtbl.mem active_leases owner_session_id

let lease_error_message = function
  | Lease_held -> "ephemeral cleanup lease is held by a live process"
  | Lease_error message -> "ephemeral cleanup lease failed: " ^ message

let register ~owner_session_id ~agent_id =
  match acquire ~owner_session_id with
  | Error error -> Error (lease_error_message error)
  | Ok _lease -> (
      match Host.cleanup_envelope ~owner_session_id ~agent_id with
      | Error _ as error -> error
      | Ok envelope_path ->
          let marker_path =
            Host.join [ envelope_path; "cleanup-marker.json" ]
          in
          if Host.path_exists envelope_path then
            match Host.read_envelope_marker marker_path with
            | Error _ as error -> error
            | Ok marker
              when marker.marker_owner_session_id = owner_session_id
                   && marker.marker_agent_id = agent_id
                   && marker.marker_scope = "ephemeral"
                   && marker.marker_phase = "prepared"
                   && marker.marker_cleanup_nonce <> "" ->
                Ok ()
            | Ok _ -> Error "ephemeral cleanup registration marker mismatch"
          else
            match Host.mkdir_p envelope_path with
            | Error _ as error -> error
            | Ok () ->
                Host.write_envelope_marker ~scope:"ephemeral" ~marker_path
                  ~owner_session_id ~agent_id
                  ~cleanup_nonce:(Host.fresh_nonce ()))

let deferred_candidates () =
  let root = Host.private_root () in
  Host.list_directory root
  |> List.concat_map (fun owner_name ->
         let owner_path = Host.join [ root; owner_name ] in
         if not (Host.is_directory owner_path) then []
         else
           Host.list_directory owner_path
           |> List.filter_map (fun name ->
                  if not (String.starts_with ~prefix:".cleanup-" name) then None
                  else
                    let envelope_path = Host.join [ owner_path; name ] in
                    let marker_path =
                      Host.join [ envelope_path; "cleanup-marker.json" ]
                    in
                    match Host.read_envelope_marker marker_path with
                    | Ok marker
                      when marker.marker_scope = "ephemeral"
                           && marker.marker_phase = "prepared" ->
                        Some (envelope_path, marker)
                    | _ -> None))

let validate_deferred_path envelope_path marker =
  let owner_session_id = marker.Host.marker_owner_session_id in
  let agent_id = marker.Host.marker_agent_id in
  match Host.cleanup_envelope ~owner_session_id ~agent_id with
  | Error _ as error -> error
  | Ok expected when expected <> envelope_path ->
      Error "deferred ephemeral cleanup envelope is not at its derived path"
  | Ok expected -> (
      match
        Host.validate_exact_directory ~owner_session_id ~agent_id
          ~expected envelope_path
      with
      | Error _ as error -> error
      | Ok None -> Error "deferred ephemeral cleanup envelope is missing"
      | Ok (Some _) -> Ok ())

let promote_deferred envelope_path marker =
  let owner_session_id = marker.Host.marker_owner_session_id in
  let agent_id = marker.Host.marker_agent_id in
  let cleanup_nonce = marker.Host.marker_cleanup_nonce in
  if cleanup_nonce = "" then Error "deferred ephemeral cleanup nonce is missing"
  else
    match Host.cleanup_envelope ~owner_session_id ~agent_id with
    | Error _ as error -> error
    | Ok expected when expected <> envelope_path ->
        Error "deferred ephemeral cleanup envelope is not at its derived path"
    | Ok _ -> (
      match Host.private_directory ~owner_session_id ~agent_id with
      | Error _ as error -> error
      | Ok live_path ->
          let payload_path = Host.join [ envelope_path; "session" ] in
          let live_exists = Host.path_exists live_path in
          let payload_exists = Host.path_exists payload_path in
          if live_exists && payload_exists then
            Error "deferred ephemeral cleanup has both live and staged sessions"
          else
            let stage_result =
              if payload_exists || not live_exists then Ok ()
              else
                match
                  Host.validate_exact_directory ~require_child_marker:true
                    ~owner_session_id ~agent_id ~expected:live_path live_path
                with
                | Error _ as error -> error
                | Ok None -> Ok ()
                | Ok (Some canonical_live) ->
                    Host.rename canonical_live payload_path
            in
            match stage_result with
            | Error _ as error -> error
            | Ok () ->
                let pending =
                  {
                    Taumel.Agents.cleanup_owner_session_id = owner_session_id;
                    cleanup_agent_id = agent_id;
                    cleanup_nonce;
                    cleanup_remaining_artifacts = [ "private_session" ];
                  }
                in
                (match
                   Host.append_cleanup_journal_record ~owner_session_id ~agent_id
                     ~cleanup_nonce
                 with
                | Error _ as error -> error
                | Ok () -> (
                    match Host.finalize_cleanup_pending pending with
                    | Error _ as error -> error
                    | Ok () ->
                        Host.remove_cleanup_journal_record ~owner_session_id
                          ~agent_id ~cleanup_nonce)))

let reconcile_deferred () =
  List.fold_left
    (fun result (envelope_path, marker) ->
      let current =
        match validate_deferred_path envelope_path marker with
        | Error _ as error -> error
        | Ok ()
          when held_by_current_process marker.Host.marker_owner_session_id ->
            Ok ()
        | Ok () -> (
          match acquire ~owner_session_id:marker.Host.marker_owner_session_id with
          | Error Lease_held -> Ok ()
          | Error error -> Error (lease_error_message error)
          | Ok lease ->
              let promoted = promote_deferred envelope_path marker in
              let released = release lease in
              (match (promoted, released) with
              | Error _ as error, _ -> error
              | Ok (), Error message -> Error message
              | Ok (), Ok () -> Ok ()))
      in
      match (result, current) with
      | Error _ as first, _ -> first
      | Ok (), current -> current)
    (Ok ()) (deferred_candidates ())
