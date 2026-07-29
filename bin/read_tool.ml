open Jsoo_bridge

let resolve_path cwd path =
  if (not (Filename.is_relative path)) || cwd = "" then path
  else Node_path.resolve [ cwd; path ]

let error_result message =
  text_tool_result message
    (Unsafe.obj [| ("ok", js_bool false); ("error", js_string message) |])

let is_symbolic_link path =
  try Node_fs.is_symbolic_link (Node_fs.lstat_sync path) with _ -> false

(* read_file: resolve the path against the session cwd, stat it (reject missing
   / directories), read it as UTF-8, and hand the content to the pure formatter.
   NUL/binary content and out-of-range offsets become actionable errors. *)
let read_file raw_facts =
  let facts = decode_ojs_contract Tool_contracts.ReadFileFacts.t_of_js (ojs_of_js raw_facts) in
  let path = Tool_contracts.ReadFileFacts.get_path facts in
  let cwd = Tool_contracts.ReadFileFacts.get_defaultCwd facts in
  let offset = Tool_contracts.ReadFileFacts.get_offset facts |> Option.map int_of_float in
  let limit = Tool_contracts.ReadFileFacts.get_limit facts |> Option.map int_of_float in
  if String.trim path = "" then error_result "read requires a non-empty path"
  else
    let resolved = resolve_path cwd path in
    let stat = try Some (Node_fs.stat_sync resolved) with _ -> None in
    match stat with
    | None ->
        if is_symbolic_link resolved then
          error_result
            (Printf.sprintf
               "\"%s\" is a symbolic link whose target does not exist or cannot \
                be accessed."
               path)
        else error_result (Printf.sprintf "\"%s\" does not exist." path)
    | Some stat ->
        if Node_fs.is_directory stat then
          error_result
            (Printf.sprintf
               "\"%s\" is not a file. Use exec_command (e.g. `ls`) to inspect a \
                directory."
               path)
        else
          let content =
            try Some (Node_fs.read_file_sync_utf8 resolved) with _ -> None
          in
          (match content with
          | None -> error_result (Printf.sprintf "Could not read \"%s\" as text." path)
          | Some content -> (
              match Taumel.File_read.format ~content ~offset ~limit with
              | Taumel.File_read.Binary_content ->
                  error_result
                    (Printf.sprintf
                       "\"%s\" is not readable as UTF-8 text. If it is an image \
                        or other binary file, inspect it with exec_command (e.g. \
                        `file`, `xxd`)."
                       path)
              | Taumel.File_read.Out_of_bounds { offset; total } ->
                  error_result
                    (Printf.sprintf
                       "Offset %d is beyond end of file (%d lines total)." offset
                       total)
              | Taumel.File_read.Rendered r ->
                  let text =
                    if r.body = "" then Printf.sprintf "(\"%s\" is empty)" path
                    else r.body
                  in
                  let details =
                    Unsafe.obj
                      [|
                        ("ok", js_bool true);
                        ("path", js_string path);
                        ("fullPath", js_string resolved);
                        ("totalLines", js_number (float_of_int r.total_lines));
                        ("startLine", js_number (float_of_int r.start_line));
                        ("shownLines", js_number (float_of_int r.shown_lines));
                        ("truncated", js_bool r.truncated);
                      |]
                  in
                  text_tool_result text details))
