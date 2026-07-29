(* Filesystem adapter for Agent_state_store. Owns atomic registry writes under
   the Taumel private agent owner directory. The in-memory backend is retained
   only for deterministic tests. *)

open Jsoo_bridge

module Store = Taumel.Agent_state_store

let crypto = lazy (node_require "crypto")


let private_root () = Agent_child_session_host.private_root ()

let owner_component owner_session_id =
  Agent_child_session_host.owner_component owner_session_id

let registry_path ~owner_session_id =
  Store.owner_registry_path ~private_root:(private_root ())
    ~owner_component:(owner_component owner_session_id)


type file_presence = Missing | Regular_file | Invalid_file | Unavailable of string

let error_code error =
  js_exception_string_field error "code"

let file_presence target =
  try
    let stat = Node_fs.lstat_sync target in
    if Node_fs.is_file stat then Regular_file else Invalid_file
  with error -> (
    match error_code error with
    | Some "ENOENT" -> Missing
    | _ -> Unavailable (Printexc.to_string error))






let random_suffix () =
  try
    Unsafe.meth_call (Lazy.force crypto) "randomBytes" [| js_number 6. |]
    |> fun bytes ->
    Unsafe.meth_call bytes "toString" [| js_string "hex" |] |> Js.to_string
  with _ -> string_of_int (Random.bits ())

let ensure_owner_directory ~owner_session_id directory =
  match Node_files.mkdir_p directory with
  | Error _ as error -> error
  | Ok () -> (
      match (Node_files.realpath (private_root ()), Node_files.realpath directory) with
      | Error _, _ | _, Error _ ->
          Error "agent registry directory cannot be resolved canonically"
      | Ok canonical_root, Ok canonical_directory ->
          let expected = Node_path.join [ canonical_root; owner_component owner_session_id ] in
          if
            canonical_directory <> expected
            || not
                 (Taumel.Sandbox.path_within ~root:canonical_root
                    canonical_directory)
          then Error "agent registry directory escapes its derived owner path"
          else Ok ())

let write_atomic ~owner_session_id ~path:target ~contents =
  let directory = Node_path.dirname target in
  match ensure_owner_directory ~owner_session_id directory with
  | Error _ as error -> error
  | Ok () ->
      let temp =
        Node_path.join
          [
            directory;
            ".registry." ^ random_suffix () ^ ".tmp";
          ]
      in
      (match Node_files.write_file_durable temp contents with
      | Error message ->
          ignore (Node_files.unlink temp);
          Error message
      | Ok () -> (
          match Node_files.rename temp target with
          | Error message ->
              ignore (Node_files.unlink temp);
              Error message
          | Ok () ->
              (try
                 let dir_fd = Node_fs.open_sync directory "r" in
                 (try Node_fs.fsync_sync dir_fd with _ -> ());
                 Node_fs.close_sync dir_fd
               with _ -> ());
              Ok ()))

let env_flag name =
  match Node_process.env_get name with
  | Some value when String.trim value = "1" -> true
  | _ -> false

let clear_env_flag name = Node_process.env_delete name

let filesystem_backend : Store.registry_backend =
  {
    read_registry =
      (fun ~owner_session_id ->
        let target = registry_path ~owner_session_id in
        match file_presence target with
        | Missing -> Ok None
        | Invalid_file -> Error "agent registry is not a regular file"
        | Unavailable message -> Error ("agent registry cannot be inspected: " ^ message)
        | Regular_file ->
          let directory = Node_path.dirname target in
          (match ensure_owner_directory ~owner_session_id directory with
          | Error _ as error -> error
          | Ok () -> (
              match Node_files.read_file target with
              | Ok contents -> Ok (Some contents)
              | Error message -> Error message)));
    write_registry =
      (fun ~owner_session_id ~contents ->
        if env_flag "TAUMEL_FAIL_NEXT_AGENT_REGISTRY_WRITE" then (
          clear_env_flag "TAUMEL_FAIL_NEXT_AGENT_REGISTRY_WRITE";
          Error "forced agent persistence failure")
        else
          write_atomic ~owner_session_id ~path:(registry_path ~owner_session_id)
            ~contents);
  }

let active_backend : Store.registry_backend ref = ref filesystem_backend
let memory_probe : Store.memory_backend option ref = ref None

let use_filesystem_backend () =
  active_backend := filesystem_backend;
  memory_probe := None

let use_memory_backend () =
  let memory, backend = Store.memory_backend () in
  active_backend := backend;
  memory_probe := Some memory;
  memory

let backend () = !active_backend

let read_registry ~owner_session_id =
  (!active_backend).read_registry ~owner_session_id

let write_registry ~owner_session_id state =
  Store.write_current_registry !active_backend ~owner_session_id state

let memory_write_count () =
  match !memory_probe with
  | Some memory -> memory.write_count
  | None -> -1
