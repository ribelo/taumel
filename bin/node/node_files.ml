(* OCaml-idiomatic file operations over the Node_fs bindings: Result-returning
   wrappers shared by every host module (eng-cb03). Error strings are
   Printexc-rendered JS exceptions, matching the previous local copies. *)

let path_exists target =
  try
    ignore (Node_fs.lstat_sync target);
    true
  with _ -> false

let realpath target =
  try Ok (Node_fs.realpath_sync target)
  with error -> Error (Printexc.to_string error)

let is_directory target =
  try Node_fs.is_directory (Node_fs.lstat_sync target) with _ -> false

let is_regular_file target =
  try Node_fs.is_file (Node_fs.lstat_sync target) with _ -> false

let list_directory target =
  try Node_fs.readdir_sync target with _ -> []

let mkdir_p target =
  try
    Node_fs.mkdir_sync ~recursive:true target;
    Ok ()
  with error -> Error (Printexc.to_string error)

let write_file target contents =
  try
    Node_fs.write_file_sync_string target contents;
    Ok ()
  with error -> Error (Printexc.to_string error)

let write_file_durable_with_flag ~flag target contents =
  let descriptor = ref None in
  let close () =
    match !descriptor with
    | None -> ()
    | Some fd ->
        descriptor := None;
        (try Node_fs.close_sync fd with _ -> ())
  in
  try
    let fd = Node_fs.open_sync_mode target flag 0o600 in
    descriptor := Some fd;
    Node_fs.write_file_sync_fd fd contents;
    Node_fs.fsync_sync fd;
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
  try Ok (Node_fs.read_file_sync_utf8 target)
  with error -> Error (Printexc.to_string error)

let rename source destination =
  try
    Node_fs.rename_sync source destination;
    Ok ()
  with error -> Error (Printexc.to_string error)

let link_file source destination =
  try
    Node_fs.link_sync source destination;
    Ok ()
  with error -> Error (Printexc.to_string error)

let unlink target =
  try
    Node_fs.unlink_sync target;
    Ok ()
  with _ -> Ok ()
