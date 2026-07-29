open Jsoo_bridge

(* Descriptor-anchored recursive and single-entry deletion (ADR 0003).
   Traversal walks from the filesystem root with O_NOFOLLOW|O_DIRECTORY opens
   and addresses every entry through /proc/self/fd/<fd>/<name>, so a
   concurrent ancestor or component swap cannot redirect deletion outside the
   pinned tree: symlink components fail closed and swapped real directories
   keep deletion inside attacker-writable trees. The target's parent is
   canonicalized first so legitimate symlinks above the target keep working.
   Requires Linux with procfs; any other platform fails closed. *)

let descriptor_directory_flags =
  lazy (Node_fs.o_rdonly () lor Node_fs.o_directory () lor Node_fs.o_nofollow ())

let descriptor_paths_supported =
  lazy
    (match Node_process.platform () with
    | "linux" -> (
        try
          let fd =
            Node_fs.open_sync_flags "/proc/self/fd"
              (Lazy.force descriptor_directory_flags)
          in
          Node_fs.close_sync fd;
          true
        with _ -> false)
    | _ -> false)

let unsupported_error =
  Error
    "descriptor-anchored deletion requires Linux with procfs (/proc/self/fd)"

let open_pinned_directory target =
  Node_fs.open_sync_flags target (Lazy.force descriptor_directory_flags)
  |> Ojs.int_of_js

let close_fd fd = Node_fs.close_sync (Ojs.int_to_js fd)

let with_open_fd fd f =
  match try Ok (f fd) with error -> Error error with
  | Ok result ->
      close_fd fd;
      result
  | Error error ->
      close_fd fd;
      raise error

let with_pinned_directory target f =
  with_open_fd (open_pinned_directory target) f

let procfs_entry_path fd name = Printf.sprintf "/proc/self/fd/%d/%s" fd name

let path_dirname target = Node_path.dirname target

let path_basename target = Node_path.basename target

let path_components target =
  String.split_on_char '/' target |> List.filter (fun part -> part <> "")

let realpath target = Node_fs.realpath_sync target

let entry_is_directory path = Node_fs.is_directory (Node_fs.lstat_sync path)

let unlink_entry_path path = Node_fs.unlink_sync path

let rmdir_entry_path path = Node_fs.rmdir_sync path

(* Walk from the filesystem root to the canonical form of [directory],
   opening every component with O_NOFOLLOW|O_DIRECTORY so no ancestor can be
   a symlink. The directory is canonicalized first to tolerate legitimate
   symlinks above it; a swap racing that canonicalization fails closed. *)
let with_root_walked_directory directory f =
  let canonical = realpath directory in
  let root_fd = open_pinned_directory "/" in
  let rec descend fd components =
    match components with
    | [] -> fd
    | component :: rest ->
        let child =
          try open_pinned_directory (procfs_entry_path fd component)
          with error ->
            close_fd fd;
            raise error
        in
        close_fd fd;
        descend child rest
  in
  let final_fd =
    match path_components canonical with
    | [] -> root_fd
    | components -> descend root_fd components
  in
  with_open_fd final_fd f

let is_enoent error = js_exception_string_field error "code" = Some "ENOENT"

let rec unlink_tree_entries fd =
  let entries =
    try Node_fs.readdir_sync (Printf.sprintf "/proc/self/fd/%d" fd)
    with _ -> []
  in
  List.iter
    (fun name ->
      let path = procfs_entry_path fd name in
      try
        if entry_is_directory path then begin
          with_pinned_directory path unlink_tree_entries;
          rmdir_entry_path path
        end
        else unlink_entry_path path
      with error ->
        (* A concurrently vanished entry already satisfies the deletion
           plan; keep traversing the remaining entries. *)
        if not (is_enoent error) then raise error)
    entries

let delete_root_entry parent_fd name =
  let root_path = procfs_entry_path parent_fd name in
  if entry_is_directory root_path then begin
    with_pinned_directory root_path unlink_tree_entries;
    rmdir_entry_path root_path
  end
  else unlink_entry_path root_path

let unlink_tree target =
  if not (Lazy.force descriptor_paths_supported) then unsupported_error
  else
    try
      with_root_walked_directory (path_dirname target) (fun parent_fd ->
          delete_root_entry parent_fd (path_basename target));
      Ok ()
    with error ->
      if is_enoent error then Ok () else Error (Printexc.to_string error)

let unlink_file target =
  if not (Lazy.force descriptor_paths_supported) then unsupported_error
  else
    try
      with_root_walked_directory (path_dirname target) (fun parent_fd ->
          unlink_entry_path (procfs_entry_path parent_fd (path_basename target)));
      Ok ()
    with error ->
      if is_enoent error then Ok () else Error (Printexc.to_string error)

let rmdir target =
  if not (Lazy.force descriptor_paths_supported) then unsupported_error
  else
    try
      with_root_walked_directory (path_dirname target) (fun parent_fd ->
          rmdir_entry_path (procfs_entry_path parent_fd (path_basename target)));
      Ok ()
    with error ->
      if is_enoent error then Ok () else Error (Printexc.to_string error)
