open Jsoo_bridge

type t = {
  session_id : int;
  pending : Buffer.t;
  mutable pending_start_line : int;
  mutable chunk_bytes : int;
  mutable chunk_lines : int;
  mutable chunk_ends_with_newline : bool;
  mutable chunk_trimmed : bool;
  mutable total_output_bytes : int;
  mutable output_limit_exceeded : bool;
  mutable temp_path : string option;
  mutable temp_fd : Unsafe.any option;
}

type truncation = {
  trunc_truncated : bool;
  trunc_truncated_by : string;
  trunc_total_lines : int;
  trunc_total_bytes : int;
  trunc_output_lines : int;
  trunc_output_bytes : int;
  trunc_max_lines : int;
  trunc_max_bytes : int;
  trunc_last_line_partial : bool;
  trunc_first_line_exceeds_limit : bool;
  trunc_full_output_path : string option;
}

let create session_id =
  {
    session_id;
    pending = Buffer.create 256;
    pending_start_line = 1;
    chunk_bytes = 0;
    chunk_lines = 0;
    chunk_ends_with_newline = false;
    chunk_trimmed = false;
    total_output_bytes = 0;
    output_limit_exceeded = false;
    temp_path = None;
    temp_fd = None;
  }

let max_display_lines = 2000

let max_display_bytes = 50 * 1024

let default_max_output_tokens = 10_000

let approximate_bytes_per_token = 4

let total_output_limit_bytes = 16 * 1024 * 1024

let pending_cap = total_output_limit_bytes

let count_newlines s =
  let n = ref 0 in
  String.iter (fun c -> if c = '\n' then incr n) s;
  !n

let line_count text =
  if text = "" then 0
  else
    count_newlines text + if text.[String.length text - 1] = '\n' then 0 else 1

let split_display_lines text =
  if text = "" then []
  else
    match List.rev (String.split_on_char '\n' text) with
    | "" :: rest -> List.rev rest
    | rest -> List.rev rest

let safe_suffix max_bytes text =
  let len = String.length text in
  if len <= max_bytes then text
  else
    let raw_start = len - max_bytes in
    let rec boundary index =
      if index >= len then len
      else
        let code = Char.code text.[index] in
        if code land 0b1100_0000 = 0b1000_0000 then boundary (index + 1)
        else index
    in
    let start = boundary raw_start in
    String.sub text start (len - start)

let safe_prefix max_bytes text =
  let len = String.length text in
  if len <= max_bytes then text
  else
    let rec boundary index =
      if index <= 0 then 0
      else
        let code = Char.code text.[index] in
        if code land 0b1100_0000 = 0b1000_0000 then boundary (index - 1)
        else index
    in
    let stop = boundary max_bytes in
    String.sub text 0 stop

let truncation_reason ~by_lines ~by_bytes =
  match (by_lines, by_bytes) with
  | false, false -> "none"
  | true, false -> "lines"
  | false, true -> "bytes"
  | true, true -> "lines,bytes"

let math_random = Node_globals.random

let os_tmpdir = Node_os.tmpdir

let path_join a b = Node_path.join [ a; b ]

let ensure_temp_file (output : t) =
  match output.temp_fd with
  | Some _ -> ()
  | None -> (
      try
        let name =
          Printf.sprintf "taumel-exec-%d-%d.log" output.session_id
            (int_of_float (math_random () *. 1.0e9))
        in
        let path = path_join (os_tmpdir ()) name in
        let fd = js_of_ojs (Node_fs.open_sync path "a") in
        output.temp_path <- Some path;
        output.temp_fd <- Some fd
      with _ -> ())

let write_temp (output : t) text =
  match output.temp_fd with
  | None -> ()
  | Some fd -> (
      try ignore (Node_fs.write_sync (ojs_of_js fd) text) with _ -> ())

let add (output : t) text =
  if text = "" || output.output_limit_exceeded then false
  else begin
    let remaining =
      max 0 (total_output_limit_bytes - output.total_output_bytes)
    in
    let accepted = safe_prefix remaining text in
    let crossed = String.length accepted < String.length text in
    output.total_output_bytes <-
      output.total_output_bytes + String.length accepted;
    if crossed then output.output_limit_exceeded <- true;
    if accepted <> "" then begin
      ensure_temp_file output;
      write_temp output accepted;
      output.chunk_bytes <- output.chunk_bytes + String.length accepted;
      output.chunk_lines <- output.chunk_lines + count_newlines accepted;
      output.chunk_ends_with_newline <-
        accepted.[String.length accepted - 1] = '\n';
      Buffer.add_string output.pending accepted;
      if Buffer.length output.pending > pending_cap then begin
        let s = Buffer.contents output.pending in
        let drop_bytes = String.length s - pending_cap in
        let dropped = String.sub s 0 drop_bytes in
        let keep = String.sub s drop_bytes pending_cap in
        Buffer.clear output.pending;
        Buffer.add_string output.pending keep;
        output.pending_start_line <-
          output.pending_start_line + count_newlines dropped;
        output.chunk_trimmed <- true
      end
    end;
    crossed
  end

let close (output : t) =
  (match output.temp_fd with
  | None -> ()
  | Some fd -> ( try Node_fs.close_sync (ojs_of_js fd) with _ -> ()));
  output.temp_fd <- None

let make_truncation ?full_output_path ?(last_line_partial = false)
    ?(first_line_exceeds_limit = false) ?(max_lines = max_display_lines)
    ?(max_bytes = max_display_bytes) ~truncated ~truncated_by ~total_lines
    ~total_bytes ~output_lines ~output_bytes () =
  {
    trunc_truncated = truncated;
    trunc_truncated_by = truncated_by;
    trunc_total_lines = total_lines;
    trunc_total_bytes = total_bytes;
    trunc_output_lines = output_lines;
    trunc_output_bytes = output_bytes;
    trunc_max_lines = max_lines;
    trunc_max_bytes = max_bytes;
    trunc_last_line_partial = last_line_partial;
    trunc_first_line_exceeds_limit = first_line_exceeds_limit;
    trunc_full_output_path = full_output_path;
  }

let truncation_footer ?(last_line_partial = false) ~start_line ~end_line
    ~total_lines ~shown_bytes ~line_bytes ~reason full_output_path =
  match full_output_path with
  | None -> ""
  | Some path when last_line_partial ->
      Printf.sprintf
        "[Showing last %d bytes of line %d (line is %d bytes). Full output: %s]"
        shown_bytes end_line line_bytes path
  | Some path ->
      Printf.sprintf
        "[Showing lines %d-%d of %d (limited by %s; max %d lines / %d bytes). \
         Full output: %s]"
        start_line end_line total_lines reason max_display_lines
        max_display_bytes path

let display (output : t) =
  let raw = Buffer.contents output.pending in
  let total_lines =
    output.chunk_lines
    +
    if output.chunk_bytes > 0 && not output.chunk_ends_with_newline then 1
    else 0
  in
  let total_bytes = output.chunk_bytes in
  let truncated =
    output.chunk_trimmed
    || total_bytes > max_display_bytes
    || total_lines > max_display_lines
  in
  if not truncated then
    let truncation =
      make_truncation ~truncated:false ~truncated_by:"none" ~total_lines
        ~total_bytes ~output_lines:(line_count raw)
        ~output_bytes:(String.length raw) ()
    in
    (raw, truncation)
  else
    let full_output_path = output.temp_path in
    let by_lines = total_lines > max_display_lines in
    let by_bytes = output.chunk_trimmed || total_bytes > max_display_bytes in
    let reason = truncation_reason ~by_lines ~by_bytes in
    let indexed =
      raw |> split_display_lines
      |> List.mapi (fun index line -> (output.pending_start_line + index, line))
    in
    let rec take_tail selected selected_bytes selected_count = function
      | [] -> (`Lines selected, selected_bytes, selected_count)
      | (line_no, line) :: rest ->
          if selected_count >= max_display_lines then
            (`Lines selected, selected_bytes, selected_count)
          else
            let separator = if selected_count = 0 then 0 else 1 in
            let line_bytes = String.length line + separator in
            if selected_bytes + line_bytes <= max_display_bytes then
              take_tail
                ((line_no, line) :: selected)
                (selected_bytes + line_bytes)
                (selected_count + 1) rest
            else if selected_count = 0 then
              (`Partial_line (line_no, line), selected_bytes, selected_count)
            else (`Lines selected, selected_bytes, selected_count)
    in
    let selection, selected_bytes, selected_count =
      take_tail [] 0 0 (List.rev indexed)
    in
    match selection with
    | `Partial_line (line_no, line) ->
        let shown = safe_suffix max_display_bytes line in
        let shown_bytes = String.length shown in
        let footer =
          truncation_footer ~last_line_partial:true ~start_line:line_no
            ~end_line:line_no ~total_lines ~shown_bytes
            ~line_bytes:
              (if total_lines = 1 then max (String.length line) total_bytes
               else String.length line)
            ~reason full_output_path
        in
        let output =
          if footer = "" then shown
          else if shown = "" then footer
          else shown ^ "\n\n" ^ footer
        in
        let truncation =
          make_truncation ?full_output_path ~last_line_partial:true
            ~first_line_exceeds_limit:true ~truncated:true ~truncated_by:reason
            ~total_lines ~total_bytes ~output_lines:1 ~output_bytes:shown_bytes
            ()
        in
        (output, truncation)
    | `Lines selected ->
        let payload = selected |> List.map snd |> String.concat "\n" in
        let start_line, end_line =
          match selected with
          | [] -> (0, 0)
          | (first, _) :: rest ->
              let last =
                match List.rev rest with
                | (line_no, _) :: _ -> line_no
                | [] -> first
              in
              (first, last)
        in
        let footer =
          truncation_footer ~start_line ~end_line ~total_lines
            ~shown_bytes:selected_bytes ~line_bytes:selected_bytes ~reason
            full_output_path
        in
        let output =
          if footer = "" then payload
          else if payload = "" then footer
          else payload ^ "\n\n" ^ footer
        in
        let truncation =
          make_truncation ?full_output_path ~truncated:true ~truncated_by:reason
            ~total_lines ~total_bytes ~output_lines:selected_count
            ~output_bytes:selected_bytes ()
        in
        (output, truncation)

let display_text source =
  let total_bytes = String.length source in
  let total_lines = line_count source in
  if total_bytes = 0 then ""
  else if total_bytes <= max_display_bytes && total_lines <= max_display_lines
  then source
  else
    let lines = split_display_lines source in
    let rec take_tail selected selected_bytes selected_count = function
      | [] -> List.rev selected
      | line :: rest ->
          if selected_count >= max_display_lines then List.rev selected
          else
            let separator = if selected_count = 0 then 0 else 1 in
            let line_bytes = String.length line + separator in
            if selected_bytes + line_bytes <= max_display_bytes then
              take_tail (line :: selected)
                (selected_bytes + line_bytes)
                (selected_count + 1) rest
            else if selected_count = 0 then
              [ safe_suffix max_display_bytes line ]
            else List.rev selected
    in
    let selected = take_tail [] 0 0 (List.rev lines) in
    let payload = String.concat "\n" selected in
    let footer =
      Printf.sprintf
        "\n\n[Showing last %d of %d lines (limited by max %d lines / %d bytes)]"
        (List.length selected) total_lines max_display_lines max_display_bytes
    in
    if payload = "" then String.trim footer else payload ^ footer

let collectable_display output =
  let source =
    match output.temp_path with
    | Some path -> (
        try Node_fs.read_file_sync_utf8 path
        with _ -> Buffer.contents output.pending)
    | None -> Buffer.contents output.pending
  in
  if source = "" then None else Some (display_text source)

let codex_display output max_output_tokens =
  let source = Buffer.contents output.pending in
  let total_bytes = String.length source in
  let total_lines = line_count source in
  let budget = max 0 max_output_tokens * approximate_bytes_per_token in
  if total_bytes <= budget then
    ( source,
      make_truncation ?full_output_path:output.temp_path ~truncated:false
        ~truncated_by:"none" ~total_lines ~total_bytes ~output_lines:total_lines
        ~output_bytes:total_bytes ~max_lines:max_int ~max_bytes:budget () )
  else
    let left_budget = budget / 2 in
    let right_budget = budget - left_budget in
    let left = safe_prefix left_budget source in
    let right = safe_suffix right_budget source in
    let removed_bytes =
      max 0 (total_bytes - String.length left - String.length right)
    in
    let removed_tokens =
      (removed_bytes + approximate_bytes_per_token - 1)
      / approximate_bytes_per_token
    in
    let marker = Printf.sprintf "…%d tokens truncated…" removed_tokens in
    let path_notice =
      match output.temp_path with
      | None -> ""
      | Some path -> "\n\n[Output truncated. Full output: " ^ path ^ "]"
    in
    let rendered = left ^ marker ^ right ^ path_notice in
    ( rendered,
      make_truncation ?full_output_path:output.temp_path ~truncated:true
        ~truncated_by:"tokens" ~total_lines ~total_bytes
        ~output_lines:(line_count rendered)
        ~output_bytes:(String.length rendered) ~max_lines:max_int
        ~max_bytes:budget () )

let reset_chunk output =
  Buffer.clear output.pending;
  output.pending_start_line <- 1;
  output.chunk_bytes <- 0;
  output.chunk_lines <- 0;
  output.chunk_ends_with_newline <- false;
  output.chunk_trimmed <- false
