(* Filesystem adapter for Agent_state_store. Owns atomic registry writes under
   the Taumel private agent owner directory. The in-memory backend is retained
   only for deterministic tests. *)

open Jsoo_bridge

module Store = Taumel.Agent_state_store

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string name |]

let fs = lazy (node_require "fs")
let path = lazy (node_require "path")
let crypto = lazy (node_require "crypto")

let join parts =
  Unsafe.meth_call (Lazy.force path) "join"
    (Array.of_list (List.map js_string parts))
  |> Js.to_string

let private_root () = Agent_child_session_host.private_root ()

let owner_component owner_session_id =
  Agent_child_session_host.owner_component owner_session_id

let registry_path ~owner_session_id =
  Store.owner_registry_path ~private_root:(private_root ())
    ~owner_component:(owner_component owner_session_id)

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

type file_presence = Missing | Regular_file | Invalid_file | Unavailable of string

let error_code error =
  js_exception_string_field error "code"

let file_presence target =
  try
    let stat =
      Unsafe.meth_call (Lazy.force fs) "lstatSync" [| js_string target |]
    in
    if Js.to_bool (Unsafe.meth_call stat "isFile" [||]) then Regular_file
    else Invalid_file
  with error -> (
    match error_code error with
    | Some "ENOENT" -> Missing
    | _ -> Unavailable (Printexc.to_string error))

let realpath target =
  try
    Ok
      (Unsafe.meth_call (Lazy.force fs) "realpathSync" [| js_string target |]
      |> Js.to_string)
  with error -> Error (Printexc.to_string error)

let read_file target =
  try
    Ok
      (Unsafe.meth_call (Lazy.force fs) "readFileSync"
         [| js_string target; js_string "utf8" |]
      |> Js.to_string)
  with error -> Error (Printexc.to_string error)

let write_file_durable target contents =
  let descriptor = ref None in
  let close () =
    match !descriptor with
    | None -> ()
    | Some fd ->
        descriptor := None;
        (try ignore (Unsafe.meth_call (Lazy.force fs) "closeSync" [| fd |])
         with _ -> ())
  in
  try
    let fd =
      Unsafe.meth_call (Lazy.force fs) "openSync"
        [| js_string target; js_string "w"; js_number 384. |]
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

let rename source destination =
  try
    ignore
      (Unsafe.meth_call (Lazy.force fs) "renameSync"
         [| js_string source; js_string destination |]);
    Ok ()
  with error -> Error (Printexc.to_string error)

let unlink target =
  try
    ignore (Unsafe.meth_call (Lazy.force fs) "unlinkSync" [| js_string target |]);
    Ok ()
  with _ -> Ok ()

let random_suffix () =
  try
    Unsafe.meth_call (Lazy.force crypto) "randomBytes" [| js_number 6. |]
    |> fun bytes ->
    Unsafe.meth_call bytes "toString" [| js_string "hex" |] |> Js.to_string
  with _ -> string_of_int (Random.bits ())

let ensure_owner_directory ~owner_session_id directory =
  match mkdir_p directory with
  | Error _ as error -> error
  | Ok () -> (
      match (realpath (private_root ()), realpath directory) with
      | Error _, _ | _, Error _ ->
          Error "agent registry directory cannot be resolved canonically"
      | Ok canonical_root, Ok canonical_directory ->
          let expected = join [ canonical_root; owner_component owner_session_id ] in
          if
            canonical_directory <> expected
            || not
                 (Taumel.Sandbox.path_within ~root:canonical_root
                    canonical_directory)
          then Error "agent registry directory escapes its derived owner path"
          else Ok ())

let write_atomic ~owner_session_id ~path:target ~contents =
  let directory =
    Unsafe.meth_call (Lazy.force path) "dirname" [| js_string target |]
    |> Js.to_string
  in
  match ensure_owner_directory ~owner_session_id directory with
  | Error _ as error -> error
  | Ok () ->
      let temp =
        join
          [
            directory;
            ".registry." ^ random_suffix () ^ ".tmp";
          ]
      in
      (match write_file_durable temp contents with
      | Error message ->
          ignore (unlink temp);
          Error message
      | Ok () -> (
          match rename temp target with
          | Error message ->
              ignore (unlink temp);
              Error message
          | Ok () ->
              (try
                 let dir_fd =
                   Unsafe.meth_call (Lazy.force fs) "openSync"
                     [| js_string directory; js_string "r" |]
                 in
                 (try
                    ignore
                      (Unsafe.meth_call (Lazy.force fs) "fsyncSync" [| dir_fd |])
                  with _ -> ());
                 ignore
                   (Unsafe.meth_call (Lazy.force fs) "closeSync" [| dir_fd |])
               with _ -> ());
              Ok ()))

let env_flag name =
  let process = Unsafe.get Unsafe.global "process" in
  let env =
    match object_field process "env" with Some env -> env | None -> Unsafe.obj [||]
  in
  match Option.bind (object_field env name) string_value with
  | Some value when String.trim value = "1" -> true
  | _ -> false

let clear_env_flag name =
  let process = Unsafe.get Unsafe.global "process" in
  match object_field process "env" with
  | None -> ()
  | Some env -> Unsafe.set env name (Unsafe.inject Js.undefined)

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
          let directory =
            Unsafe.meth_call (Lazy.force path) "dirname" [| js_string target |]
            |> Js.to_string
          in
          (match ensure_owner_directory ~owner_session_id directory with
          | Error _ as error -> error
          | Ok () -> (
              match read_file target with
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
