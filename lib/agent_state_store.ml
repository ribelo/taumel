(* Deep module owning durable agent-registry persistence policy.
   One current registry per persistent owner lives in Taumel-owned storage;
   the parent session carries only a bounded presence marker. *)

open Agents

let storage_schema_version = 1
let parent_snapshot_custom_type = "taumel.agents.v4"
let presence_marker_custom_type = "taumel.agents.presence"
let registry_file_name = "registry.json"

type presence_marker = {
  storage_schema_version : int;
  owner_session_id : string;
}

type loaded = {
  state : session_state;
  materialize_current : bool;
  ensure_marker : bool;
}

type load_result =
  | Empty
  | Loaded of loaded
  | Fail_closed of string

type registry_backend = {
  read_registry : owner_session_id:string -> (string option, string) result;
  write_registry : owner_session_id:string -> contents:string -> (unit, string) result;
}

type memory_backend = {
  mutable entries : (string * string) list;
  mutable write_count : int;
}

let encode_presence_marker (marker : presence_marker) =
  Shared.Object
    [
      ("storage_schema_version", Shared.Number (float_of_int marker.storage_schema_version));
      ("owner_session_id", Shared.String marker.owner_session_id);
    ]

let decode_presence_marker = function
  | Shared.Object fields ->
      let ( let* ) = Result.bind in
      let* () =
        Shared.json_exact_fields ""
          [ "storage_schema_version"; "owner_session_id" ]
          fields
      in
      let* marker_schema_version =
        Shared.json_required_int "" fields "storage_schema_version"
      in
      let* owner_session_id =
        Shared.json_required_string "" fields "owner_session_id"
      in
      if marker_schema_version <> storage_schema_version then
        Error
          ("unsupported agent presence marker schema version: "
         ^ string_of_int marker_schema_version)
      else if String.trim owner_session_id = "" then
        Error "agent presence marker owner_session_id is required"
      else
        Ok
          {
            storage_schema_version = marker_schema_version;
            owner_session_id;
          }
  | _ -> Error "agent presence marker must be an object"

let presence_marker ~owner_session_id =
  { storage_schema_version; owner_session_id }

let presence_marker_owner = function
  | Shared.Object fields -> (
      match List.assoc_opt "owner_session_id" fields with
      | Some (Shared.String owner) when String.trim owner <> "" -> Some owner
      | _ -> None)
  | _ -> None

let owner_registry_path ~private_root ~owner_component =
  Agent_workspace.join_path [ private_root; owner_component; registry_file_name ]

let encode_registry_envelope ~owner_session_id state =
  Shared.Object
    [
      ("storage_schema_version", Shared.Number (float_of_int storage_schema_version));
      ("owner_session_id", Shared.String owner_session_id);
      ("registry", Agents_codec.encode state);
    ]

let decode_registry_envelope ~owner_session_id = function
  | Shared.Object fields ->
      let ( let* ) = Result.bind in
      let* () =
        Shared.json_exact_fields ""
          [ "storage_schema_version"; "owner_session_id"; "registry" ]
          fields
      in
      let* envelope_schema =
        Shared.json_required_int "" fields "storage_schema_version"
      in
      let* envelope_owner =
        Shared.json_required_string "" fields "owner_session_id"
      in
      let* () =
        if envelope_schema <> storage_schema_version then
          Error
            ("unsupported agent registry storage schema version: "
           ^ string_of_int envelope_schema)
        else if envelope_owner <> owner_session_id then
          Error "agent registry is owned by another session"
        else Ok ()
      in
      (match List.assoc_opt "registry" fields with
      | None -> Error "agent registry envelope is missing registry"
      | Some registry_json -> (
          match Agents_codec.decode registry_json with
          | Error message -> Error message
          | Ok state ->
              if
                List.for_all
                  (fun identity ->
                    identity.identity_owner_session_id = owner_session_id)
                  state.identities
                && List.for_all
                     (fun pending ->
                       pending.cleanup_owner_session_id = owner_session_id)
                     state.cleanup_pending
              then Ok state
              else Error "agent registry is owned by another session"))
  | _ -> Error "agent registry envelope must be an object"

(* Reconstruct the deterministic issued-handle sequence used before issued_ids
   were persisted: for each kind, cursor 0..count-1 at
   (stable_hash(owner:prefix) + cursor * 65537) mod namespace. *)
let reconstruct_issued_ids ~owner_session_id ~generic ~finder ~oracle retained_ids =
  let issued_for kind count =
    let prefix = kind_prefix kind in
    let offset =
      stable_hash (owner_session_id ^ ":" ^ prefix) mod nano_id_namespace_size
    in
    let step = 65537 in
    let rec loop cursor acc =
      if cursor >= count then List.rev acc
      else
        let index = (offset + (cursor * step)) mod nano_id_namespace_size in
        let candidate = prefix ^ "-" ^ nano_id index in
        loop (cursor + 1) (candidate :: acc)
    in
    loop 0 []
  in
  if generic < 0 || finder < 0 || oracle < 0 then
    Error "issued_identity_counts must be non-negative"
  else if
    generic > nano_id_namespace_size || finder > nano_id_namespace_size
    || oracle > nano_id_namespace_size
  then Error "issued_identity_counts exceed handle namespace"
  else
    let issued_ids =
      issued_for Generic generic @ issued_for Finder finder
      @ issued_for Oracle oracle
    in
    if List.for_all (fun id -> List.mem id issued_ids) retained_ids then
      Ok issued_ids
    else
      Error "retained agent handle is absent from reconstructed issued set"

let retained_identity_ids = function
  | Shared.Array values ->
      values
      |> List.filter_map (function
           | Shared.Object fields -> (
               match List.assoc_opt "agent_id" fields with
               | Some (Shared.String value) -> Some value
               | _ -> None)
           | _ -> None)
  | _ -> []

let rewrite_v4_issued_ids ~owner_session_id identities count_fields =
  let ( let* ) = Result.bind in
  let* generic =
    Shared.json_required_int "issued_identity_counts" count_fields "agent"
  in
  let* finder =
    Shared.json_required_int "issued_identity_counts" count_fields "finder"
  in
  let* oracle =
    Shared.json_required_int "issued_identity_counts" count_fields "oracle"
  in
  let retained = retained_identity_ids identities in
  let* issued_ids =
    reconstruct_issued_ids ~owner_session_id ~generic ~finder ~oracle retained
  in
  Ok
    (Shared.Object
       [
         ("agent", Shared.Number (float_of_int generic));
         ("finder", Shared.Number (float_of_int finder));
         ("oracle", Shared.Number (float_of_int oracle));
         ( "issued_ids",
           Shared.Array (List.map (fun value -> Shared.String value) issued_ids)
         );
       ])

let decode_parent_snapshot_without_issued_ids ~owner_session_id ~expected_fields
    ~cleanup_pending fields =
  let ( let* ) = Result.bind in
  let* () = Shared.json_exact_fields "" expected_fields fields in
  let identities =
    match List.assoc_opt "identities" fields with
    | Some value -> value
    | None -> Shared.Array []
  in
  let runs =
    match List.assoc_opt "runs" fields with
    | Some value -> value
    | None -> Shared.Array []
  in
  let* issued_identity_counts =
    match List.assoc_opt "issued_identity_counts" fields with
    | Some (Shared.Object count_fields) ->
        let* () =
          Shared.json_exact_fields "issued_identity_counts"
            [ "agent"; "finder"; "oracle" ] count_fields
        in
        rewrite_v4_issued_ids ~owner_session_id identities count_fields
    | Some _ -> Error "issued_identity_counts must be an object"
    | None -> Error "issued_identity_counts is required"
  in
  Agents_codec.decode
    (Shared.Object
       [
         ("version", Shared.Number (float_of_int schema_version));
         ("issued_identity_counts", issued_identity_counts);
         ("identities", identities);
         ("runs", runs);
         ("cleanup_pending", cleanup_pending);
       ])

let decode_v4_parent_snapshot ~owner_session_id fields =
  decode_parent_snapshot_without_issued_ids ~owner_session_id
    ~expected_fields:
      [ "version"; "issued_identity_counts"; "identities"; "runs" ]
    ~cleanup_pending:(Shared.Array []) fields

let decode_v5_parent_snapshot ~owner_session_id fields =
  match List.assoc_opt "cleanup_pending" fields with
  | None -> Error "cleanup_pending is required"
  | Some cleanup_pending ->
      decode_parent_snapshot_without_issued_ids ~owner_session_id
        ~expected_fields:
          [
            "version";
            "issued_identity_counts";
            "identities";
            "runs";
            "cleanup_pending";
          ]
        ~cleanup_pending fields

let decode_parent_snapshot_for_bootstrap ~owner_session_id = function
  | Shared.Object fields -> (
      match Shared.json_required_int "" fields "version" with
      | Error _ as error -> error
      | Ok version when version = schema_version -> Agents_codec.decode (Shared.Object fields)
      | Ok 4 -> decode_v4_parent_snapshot ~owner_session_id fields
      | Ok 5 -> decode_v5_parent_snapshot ~owner_session_id fields
      | Ok version ->
          Error
            ("unsupported parent agent-registry snapshot version: "
           ^ string_of_int version))
  | _ -> Error "parent agent-registry snapshot must be an object"

let same_owner ~owner_session_id (state : session_state) =
  List.for_all
    (fun identity -> identity.identity_owner_session_id = owner_session_id)
    state.identities
  && List.for_all
       (fun pending -> pending.cleanup_owner_session_id = owner_session_id)
       state.cleanup_pending

let ensure_same_owner ~owner_session_id state =
  if same_owner ~owner_session_id state then Ok state
  else Error "agent registry is owned by another session"

let parent_snapshot_owner = function
  | Shared.Object fields ->
      let owners_from_array owner_field = function
        | Shared.Array values ->
            List.filter_map
              (function
                | Shared.Object item -> (
                    match List.assoc_opt owner_field item with
                    | Some (Shared.String owner) when String.trim owner <> "" ->
                        Some owner
                    | _ -> None)
                | _ -> None)
              values
        | _ -> []
      in
      let identity_owners =
        match List.assoc_opt "identities" fields with
        | Some identities -> owners_from_array "owner_session_id" identities
        | None -> []
      in
      let cleanup_owners =
        match List.assoc_opt "cleanup_pending" fields with
        | Some pending -> owners_from_array "owner_session_id" pending
        | None -> []
      in
      (match List.sort_uniq String.compare (identity_owners @ cleanup_owners) with
      | [ owner ] -> Some owner
      | _ -> None)
  | _ -> None

let select_bootstrap_snapshot ~owner_session_id snapshots =
  let rec loop = function
    | [] -> Ok None
    | json :: rest
      when parent_snapshot_owner json = Some owner_session_id -> (
        match decode_parent_snapshot_for_bootstrap ~owner_session_id json with
        | Error message -> Error message
        | Ok state -> (
            match ensure_same_owner ~owner_session_id state with
            | Error _ -> loop rest
            | Ok state -> Ok (Some state)))
    | json :: rest -> (
        match parent_snapshot_owner json with
        | Some _foreign_owner -> loop rest
        | None -> (
            match decode_parent_snapshot_for_bootstrap ~owner_session_id json with
            | Error message -> Error message
            | Ok state -> (
                match ensure_same_owner ~owner_session_id state with
                | Error _ -> loop rest
                | Ok state -> Ok (Some state))))
  in
  loop (List.rev snapshots)

let decode_sidecar ~owner_session_id raw =
  match Shared.decode_json_string raw with
  | Error message -> Error ("agent registry is malformed: " ^ message)
  | Ok json -> (
      match decode_registry_envelope ~owner_session_id json with
      | Error message -> Error ("agent registry is malformed: " ^ message)
      | Ok state -> Ok state)

let resolve_without_marker ~allow_parent_snapshots ~owner_session_id ~sidecar_raw
    ~parent_snapshots =
  match sidecar_raw with
  | Some raw -> (
      match decode_sidecar ~owner_session_id raw with
      | Error message -> Fail_closed message
      | Ok state ->
          Loaded
            { state; materialize_current = false; ensure_marker = true })
  | None when not allow_parent_snapshots -> Empty
  | None -> (
      match select_bootstrap_snapshot ~owner_session_id parent_snapshots with
      | Error message -> Fail_closed message
      | Ok None -> Empty
      | Ok (Some state) ->
          Loaded
            { state; materialize_current = true; ensure_marker = true })

let resolve_load ~allow_parent_snapshots ~owner_session_id ~marker
    ~sidecar_raw ~parent_snapshots =
  match marker with
  | None ->
      resolve_without_marker ~allow_parent_snapshots ~owner_session_id
        ~sidecar_raw ~parent_snapshots
  | Some marker_json -> (
      match presence_marker_owner marker_json with
      | Some marker_owner when marker_owner <> owner_session_id ->
          (* Foreign markers copied by a fork are inert regardless of their
             storage schema version (agent-ps11). *)
          resolve_without_marker ~allow_parent_snapshots:false ~owner_session_id
            ~sidecar_raw ~parent_snapshots
      | _ -> (
          match decode_presence_marker marker_json with
          | Error message -> Fail_closed message
          | Ok marker
            when marker.storage_schema_version <> storage_schema_version ->
              Fail_closed
                ("unsupported agent presence marker schema version: "
               ^ string_of_int marker.storage_schema_version)
          | Ok _ -> (
              match sidecar_raw with
              | None ->
                  Fail_closed
                    "agent registry presence marker exists without current registry"
              | Some raw -> (
                  match decode_sidecar ~owner_session_id raw with
                  | Error message -> Fail_closed message
                  | Ok state ->
                      Loaded
                        {
                          state;
                          materialize_current = false;
                          ensure_marker = false;
                        }))))

let registry_contents ~owner_session_id state =
  Shared.encode_json (encode_registry_envelope ~owner_session_id state)

let durable_run_projection run =
  {
    run with
    run_final_output = None;
    run_partial_output = None;
    run_turn_count = 0;
    run_last_activity_at = None;
    run_activity_state = Starting;
    run_active_tool_count = 0;
  }

let durable_projection state =
  { state with runs = List.map durable_run_projection state.runs }

let durable_change ~previous ~next =
  durable_projection previous <> durable_projection next

let memory_backend () : memory_backend * registry_backend =
  let memory = { entries = []; write_count = 0 } in
  let backend =
    {
      read_registry =
        (fun ~owner_session_id ->
          Ok (List.assoc_opt owner_session_id memory.entries));
      write_registry =
        (fun ~owner_session_id ~contents ->
          memory.write_count <- memory.write_count + 1;
          memory.entries <-
            (owner_session_id, contents)
            :: List.remove_assoc owner_session_id memory.entries;
          Ok ());
    }
  in
  (memory, backend)

let write_current_registry backend ~owner_session_id state =
  backend.write_registry ~owner_session_id
    ~contents:(registry_contents ~owner_session_id state)

let read_current_registry backend ~owner_session_id =
  backend.read_registry ~owner_session_id
