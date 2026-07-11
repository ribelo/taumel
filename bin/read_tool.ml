open Jsoo_bridge

let js_require name =
  Unsafe.fun_call (Unsafe.js_expr "require") [| js_string name |]

let resolve_path cwd path =
  if (not (Filename.is_relative path)) || cwd = "" then path
  else
    let node_path = js_require "node:path" in
    match
      string_value
        (Unsafe.fun_call (Unsafe.get node_path "resolve")
           [| js_string cwd; js_string path |])
    with
    | Some resolved -> resolved
    | None -> path

let error_result message =
  text_tool_result message
    (Unsafe.obj [| ("ok", js_bool false); ("error", js_string message) |])

(* read_file: resolve the path against the session cwd, stat it (reject missing
   / directories), read it as UTF-8, and hand the content to the pure formatter.
   NUL/binary content and out-of-range offsets become actionable errors. *)
let read_file raw_facts =
  let facts = Tool_contracts.ReadFileFacts.t_of_js (ojs_of_js raw_facts) in
  let path = Tool_contracts.ReadFileFacts.get_path facts in
  let cwd = Tool_contracts.ReadFileFacts.get_defaultCwd facts in
  let offset = Tool_contracts.ReadFileFacts.get_offset facts |> Option.map int_of_float in
  let limit = Tool_contracts.ReadFileFacts.get_limit facts |> Option.map int_of_float in
  if String.trim path = "" then error_result "read requires a non-empty path"
  else
    let resolved = resolve_path cwd path in
    let fs = js_require "node:fs" in
    let stat =
      try Some (Unsafe.fun_call (Unsafe.get fs "statSync") [| js_string resolved |])
      with _ -> None
    in
    match stat with
    | None -> error_result (Printf.sprintf "\"%s\" does not exist." path)
    | Some stat ->
        let is_dir =
          Js.to_bool (Unsafe.coerce (Unsafe.meth_call stat "isDirectory" [||]))
        in
        if is_dir then
          error_result
            (Printf.sprintf
               "\"%s\" is not a file. Use exec_command (e.g. `ls`) to inspect a \
                directory."
               path)
        else
          let content =
            try
              string_value
                (Unsafe.fun_call (Unsafe.get fs "readFileSync")
                   [| js_string resolved; js_string "utf8" |])
            with _ -> None
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
