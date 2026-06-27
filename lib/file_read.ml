(* Pure text formatting for the read tool: line slicing (offset/limit with
   negative-tail), per-line and total truncation, line-number prefixing,
   line-ending handling, NUL/binary detection, and a Pi-style continuation
   footer. All I/O lives in the bin/ wrapper; this module is pure and tested. *)

let max_lines = 2000
let max_bytes = 50 * 1024
let max_line_length = 2000
let binary_sniff_bytes = 8000

type rendered = {
  body : string;
  total_lines : int;
  start_line : int;
  shown_lines : int;
  truncated : bool;
}

type render =
  | Binary_content
  | Out_of_bounds of { offset : int; total : int }
  | Rendered of rendered

type line_ending = Lf | Crlf | Mixed

(* A NUL byte in the first [binary_sniff_bytes] is treated as "not UTF-8 text".
   This also catches images/most binaries (PNG/JPEG/GIF contain NUL). *)
let contains_nul content =
  let n = min (String.length content) binary_sniff_bytes in
  let rec loop i =
    if i >= n then false else if content.[i] = '\000' then true else loop (i + 1)
  in
  loop 0

let detect_line_ending content =
  let n = String.length content in
  let has_crlf = ref false and has_lf = ref false and has_lone_cr = ref false in
  let i = ref 0 in
  while !i < n do
    (if content.[!i] = '\r' then
       if !i + 1 < n && content.[!i + 1] = '\n' then (
         has_crlf := true;
         incr i)
       else has_lone_cr := true
     else if content.[!i] = '\n' then has_lf := true);
    incr i
  done;
  if !has_lone_cr || (!has_crlf && !has_lf) then Mixed
  else if !has_crlf then Crlf
  else Lf

let replace_substring content ~sub ~by =
  let sub_len = String.length sub in
  if sub_len = 0 then content
  else begin
    let n = String.length content in
    let buf = Buffer.create n in
    let i = ref 0 in
    while !i < n do
      if !i + sub_len <= n && String.sub content !i sub_len = sub then (
        Buffer.add_string buf by;
        i := !i + sub_len)
      else (
        Buffer.add_char buf content.[!i];
        incr i)
    done;
    Buffer.contents buf
  end

(* Lone carriage returns shown as literal \r so control bytes do not corrupt the
   rendered view (matches kimi's makeCarriageReturnsVisible). *)
let make_cr_visible line = replace_substring line ~sub:"\r" ~by:"\\r"

(* Split on \n, dropping a single trailing newline so a file ending in \n does
   not yield a spurious trailing empty line. *)
let split_lines content =
  if content = "" then [||]
  else
    let content =
      if content.[String.length content - 1] = '\n' then
        String.sub content 0 (String.length content - 1)
      else content
    in
    Array.of_list (String.split_on_char '\n' content)

let truncate_line line =
  if String.length line <= max_line_length then (line, false)
  else
    let marker = "..." in
    (String.sub line 0 (max_line_length - String.length marker) ^ marker, true)

let format ~content ~offset ~limit =
  if contains_nul content then Binary_content
  else begin
    let style = detect_line_ending content in
    let normalized =
      match style with
      | Crlf -> replace_substring content ~sub:"\r\n" ~by:"\n"
      | Lf | Mixed -> content
    in
    let lines = split_lines normalized in
    let lines =
      match style with Mixed -> Array.map make_cr_visible lines | Lf | Crlf -> lines
    in
    let total = Array.length lines in
    let raw_start =
      match offset with
      | None -> 0
      | Some o when o < 0 -> total + o
      | Some o -> o - 1
    in
    if total > 0 && raw_start >= total then
      Out_of_bounds { offset = (match offset with Some o -> o | None -> 1); total }
    else begin
      let start_index = max 0 raw_start in
      let end_index =
        match limit with
        | Some l when l >= 0 -> min total (start_index + l)
        | _ -> total
      in
      let buf = Buffer.create 4096 in
      let bytes = ref 0 in
      let shown = ref 0 in
      let line_truncations = ref 0 in
      let truncated_by_lines = ref false in
      let truncated_by_bytes = ref false in
      let i = ref start_index in
      let stop = ref false in
      while (not !stop) && !i < end_index do
        if !shown >= max_lines then (
          truncated_by_lines := true;
          stop := true)
        else begin
          let line, was_truncated = truncate_line lines.(!i) in
          if was_truncated then incr line_truncations;
          let rendered = string_of_int (!i + 1) ^ "\t" ^ line in
          let added = (if !shown = 0 then 0 else 1) + String.length rendered in
          if !shown > 0 && !bytes + added > max_bytes then (
            truncated_by_bytes := true;
            stop := true)
          else begin
            if !shown > 0 then Buffer.add_char buf '\n';
            Buffer.add_string buf rendered;
            bytes := !bytes + added;
            incr shown;
            incr i;
            if !bytes >= max_bytes && !i < end_index then (
              truncated_by_bytes := true;
              stop := true)
          end
        end
      done;
      let start_line = start_index + 1 in
      let shown_lines = !shown in
      let end_line = start_line + shown_lines - 1 in
      let next_offset = end_line + 1 in
      let continuation =
        if shown_lines = 0 then ""
        else if !truncated_by_lines then
          Printf.sprintf "[Showing lines %d-%d of %d. Use offset=%d to continue.]"
            start_line end_line total next_offset
        else if !truncated_by_bytes then
          Printf.sprintf
            "[Showing lines %d-%d of %d (50KB limit). Use offset=%d to continue.]"
            start_line end_line total next_offset
        else if end_line < total then
          Printf.sprintf "[%d more lines in file. Use offset=%d to continue.]"
            (total - end_line) next_offset
        else ""
      in
      let footer =
        if !line_truncations > 0 then
          let note =
            Printf.sprintf "[%d line%s truncated to %d chars]" !line_truncations
              (if !line_truncations = 1 then "" else "s")
              max_line_length
          in
          if continuation = "" then note else continuation ^ "\n" ^ note
        else continuation
      in
      let rendered_body = Buffer.contents buf in
      let body =
        if footer = "" then rendered_body
        else if rendered_body = "" then footer
        else rendered_body ^ "\n\n" ^ footer
      in
      let truncated =
        !truncated_by_lines || !truncated_by_bytes || !line_truncations > 0
      in
      Rendered { body; total_lines = total; start_line; shown_lines; truncated }
    end
  end
