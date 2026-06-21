  type chunk = {
    change_context : string option;
    old_lines : string list;
    new_lines : string list;
    is_end_of_file : bool;
  }

  type hunk =
    | Add_file of {
        path : string;
        contents : string;
      }
    | Delete_file of string
    | Update_file of {
        path : string;
        move_to : string option;
        chunks : chunk list;
      }

  type t = hunk list

  type file_action =
    | Write_file of string
    | Delete_path of string

  module String_map = Shared.String_map

  let starts_with ~prefix value =
    let prefix_len = String.length prefix in
    String.length value >= prefix_len && String.sub value 0 prefix_len = prefix

  let drop_prefix prefix value =
    String.sub value (String.length prefix) (String.length value - String.length prefix)

  let find_substring_from value pattern start =
    let value_len = String.length value in
    let pattern_len = String.length pattern in
    let rec loop index =
      if index + pattern_len > value_len then None
      else if String.sub value index pattern_len = pattern then Some index
      else loop (index + 1)
    in
    if pattern_len = 0 then Some start else loop start

  let string_contains value pattern =
    Option.is_some (find_substring_from value pattern 0)

  let replace_all ~pattern ~replacement value =
    let pattern_len = String.length pattern in
    if pattern_len = 0 then value
    else
      let buffer = Buffer.create (String.length value) in
      let rec loop index =
        match find_substring_from value pattern index with
        | None ->
            Buffer.add_substring buffer value index (String.length value - index)
        | Some found ->
            Buffer.add_substring buffer value index (found - index);
            Buffer.add_string buffer replacement;
            loop (found + pattern_len)
      in
      loop 0;
      Buffer.contents buffer

  let normalize_line_endings value =
    value |> replace_all ~pattern:"\r\n" ~replacement:"\n"
    |> replace_all ~pattern:"\r" ~replacement:"\n"

  let split_lines text = String.split_on_char '\n' text

  let split_content_lines text =
    match List.rev (split_lines text) with "" :: rest -> List.rev rest | lines -> List.rev lines

  let ensure_final_newline lines =
    match List.rev lines with "" :: _ -> lines | _ -> lines @ [ "" ]

  let join_content_lines ~eol lines =
    let text = String.concat "\n" (ensure_final_newline lines) in
    if eol = "\r\n" then replace_all ~pattern:"\n" ~replacement:"\r\n" text
    else text

  let heredoc_delimiter line =
    match find_substring_from line "<<" 0 with
    | None -> None
    | Some index ->
        let rest =
          String.sub line (index + 2) (String.length line - index - 2)
          |> String.trim
        in
        if rest = "" then None
        else
          let delimiter =
            match rest.[0] with
            | '\'' | '"' as quote -> (
                match String.index_from_opt rest 1 quote with
                | Some end_index -> String.sub rest 1 (end_index - 1)
                | None -> "")
            | _ -> (
                match (String.index_opt rest ' ', String.index_opt rest '\t') with
                | None, None -> rest
                | Some index, None | None, Some index -> String.sub rest 0 index
                | Some left, Some right -> String.sub rest 0 (min left right))
          in
          if delimiter = "" then None else Some delimiter

  let strip_heredoc input =
    match (split_lines input, List.rev (split_lines input)) with
    | first :: _, last :: middle_rev -> (
        match heredoc_delimiter (String.trim first) with
        | Some delimiter when String.trim last = delimiter ->
            middle_rev |> List.rev |> List.tl |> String.concat "\n"
        | _ -> input)
    | _ -> input

  let normalize_patch_input input =
    input |> normalize_line_endings |> String.trim |> strip_heredoc

  let normalize_patch_path path =
    let path = String.trim path in
    if starts_with ~prefix:"a/" path || starts_with ~prefix:"b/" path then
      String.sub path 2 (String.length path - 2)
    else path

  let parse_chunk_header line =
    if line = "@@" then None
    else
      let value =
        match find_substring_from line "@@" 2 with
        | Some close ->
            String.sub line (close + 2) (String.length line - close - 2)
        | None -> String.sub line 2 (String.length line - 2)
      in
      match String.trim value with "" -> None | value -> Some value

  let parse_chunks lines start stop =
    let lines = Array.of_list lines in
    let stop = min stop (Array.length lines) in
    let rec outer acc index =
      if index >= stop then (List.rev acc, index)
      else
        let line = lines.(index) in
        if starts_with ~prefix:"***" line || starts_with ~prefix:"diff --git " line
        then (List.rev acc, index)
        else if not (starts_with ~prefix:"@@" line) then outer acc (index + 1)
        else
          let context = parse_chunk_header line in
          let rec inner old_lines new_lines eof index =
            if index >= stop then
              ( {
                  change_context = context;
                  old_lines = List.rev old_lines;
                  new_lines = List.rev new_lines;
                  is_end_of_file = eof;
                },
                index )
            else
              let line = lines.(index) in
              if line = "*** End of File" then
                inner old_lines new_lines true (index + 1)
              else if
                starts_with ~prefix:"@@" line || starts_with ~prefix:"***" line
                || starts_with ~prefix:"diff --git " line
              then
                ( {
                    change_context = context;
                    old_lines = List.rev old_lines;
                    new_lines = List.rev new_lines;
                    is_end_of_file = eof;
                  },
                  index )
              else if starts_with ~prefix:" " line then
                let text = drop_prefix " " line in
                inner (text :: old_lines) (text :: new_lines) eof (index + 1)
              else if starts_with ~prefix:"-" line then
                inner (drop_prefix "-" line :: old_lines) new_lines eof (index + 1)
              else if starts_with ~prefix:"+" line then
                inner old_lines (drop_prefix "+" line :: new_lines) eof (index + 1)
              else if line = "\\ No newline at end of file" then
                inner old_lines new_lines eof (index + 1)
              else inner old_lines new_lines eof (index + 1)
          in
          let chunk, next = inner [] [] false (index + 1) in
          outer (chunk :: acc) next
    in
    outer [] start

  let parse_add_content lines start stop =
    let lines = Array.of_list lines in
    let stop = min stop (Array.length lines) in
    let rec loop acc index =
      if index >= stop then (String.concat "\n" (List.rev acc), index)
      else
        let line = lines.(index) in
        if starts_with ~prefix:"***" line then
          (String.concat "\n" (List.rev acc), index)
        else if starts_with ~prefix:"+" line then
          loop (drop_prefix "+" line :: acc) (index + 1)
        else loop acc (index + 1)
    in
    let body, next = loop [] start in
    let contents = if body = "" then "" else body ^ "\n" in
    (contents, next)

  let trim_end value =
    let rec loop index =
      if index < 0 then ""
      else
        match value.[index] with
        | ' ' | '\t' -> loop (index - 1)
        | _ -> String.sub value 0 (index + 1)
    in
    loop (String.length value - 1)

  let normalize_loose value =
    value |> String.trim
    |> replace_all ~pattern:"‐" ~replacement:"-"
    |> replace_all ~pattern:"‑" ~replacement:"-"
    |> replace_all ~pattern:"‒" ~replacement:"-"
    |> replace_all ~pattern:"–" ~replacement:"-"
    |> replace_all ~pattern:"—" ~replacement:"-"
    |> replace_all ~pattern:"―" ~replacement:"-"
    |> replace_all ~pattern:"−" ~replacement:"-"
    |> replace_all ~pattern:"‘" ~replacement:"'"
    |> replace_all ~pattern:"’" ~replacement:"'"
    |> replace_all ~pattern:"‚" ~replacement:"'"
    |> replace_all ~pattern:"‛" ~replacement:"'"
    |> replace_all ~pattern:"“" ~replacement:"\""
    |> replace_all ~pattern:"”" ~replacement:"\""
    |> replace_all ~pattern:"„" ~replacement:"\""
    |> replace_all ~pattern:"‟" ~replacement:"\""
    |> replace_all ~pattern:"…" ~replacement:"..."
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:" " ~replacement:" "
    |> replace_all ~pattern:"　" ~replacement:" "

  let take n xs =
    let rec loop acc n xs =
      if n <= 0 then List.rev acc
      else match xs with [] -> List.rev acc | x :: rest -> loop (x :: acc) (n - 1) rest
    in
    loop [] n xs

  let drop n xs =
    let rec loop n xs =
      if n <= 0 then xs else match xs with [] -> [] | _ :: rest -> loop (n - 1) rest
    in
    loop n xs

  let replace_subsequence lines ~index ~old_length ~replacement =
    take index lines @ replacement @ drop (index + old_length) lines

  let find_subsequence ?(eof = false) ~from pattern lines =
    let pattern_len = List.length pattern in
    let lines_len = List.length lines in
    if pattern_len = 0 then Some from
    else if pattern_len > lines_len then None
    else
      let rec nth_tail n xs =
        if n <= 0 then xs
        else match xs with [] -> [] | _ :: rest -> nth_tail (n - 1) rest
      in
      let rec starts equal pattern lines =
        match (pattern, lines) with
        | [], _ -> true
        | p :: ps, l :: ls when equal l p -> starts equal ps ls
        | _ -> false
      in
      let search_start =
        if eof && lines_len >= pattern_len then lines_len - pattern_len else from
      in
      let max_start = lines_len - pattern_len in
      let rec loop equal index =
        if index > max_start then None
        else if starts equal pattern (nth_tail index lines) then Some index
        else loop equal (index + 1)
      in
      [
        (fun actual expected -> actual = expected);
        (fun actual expected -> trim_end actual = trim_end expected);
        (fun actual expected -> String.trim actual = String.trim expected);
        (fun actual expected -> normalize_loose actual = normalize_loose expected);
      ]
      |> List.find_map (fun equal -> loop equal search_start)

  let derive_updated_content original chunks =
    let eol = if string_contains original "\r\n" then "\r\n" else "\n" in
    let lines = original |> normalize_line_endings |> split_content_lines in
    let cursor = ref 0 in
    let apply_chunk lines chunk =
      (match chunk.change_context with
      | None -> Ok ()
      | Some context -> (
          match find_subsequence ~from:!cursor [ context ] lines with
          | None -> Error ("Failed to find context '" ^ context ^ "' in file")
          | Some index ->
              cursor := index + 1;
              Ok ()))
	      |> fun result ->
	      Result.bind result (fun () ->
             match chunk.old_lines with
             | [] ->
                 let next =
                   replace_subsequence lines ~index:!cursor ~old_length:0
                     ~replacement:chunk.new_lines
                 in
                 cursor := !cursor + List.length chunk.new_lines;
                 Ok next
             | old_lines ->
                 let pattern = ref old_lines in
                 let replacement = ref chunk.new_lines in
                 let found =
                   find_subsequence ~eof:chunk.is_end_of_file ~from:!cursor
                     !pattern lines
                 in
                 let found =
                   match (found, List.rev !pattern) with
                   | None, "" :: rest ->
                       pattern := List.rev rest;
                       (match List.rev !replacement with
                       | "" :: replacement_rest ->
                           replacement := List.rev replacement_rest
                       | _ -> ());
                       find_subsequence ~eof:chunk.is_end_of_file ~from:!cursor
                         !pattern lines
                   | _ -> found
                 in
                 match found with
                 | None ->
                     Error
                       ("Failed to find expected lines in file:\n"
                       ^ String.concat "\n" old_lines)
                 | Some index ->
                     let next =
                       replace_subsequence lines ~index
                         ~old_length:(List.length !pattern)
                         ~replacement:!replacement
                     in
                     cursor := index + List.length !pattern;
                     Ok next)
    in
    List.fold_left
      (fun result chunk ->
        match result with
        | Error _ as error -> error
        | Ok lines -> apply_chunk lines chunk)
      (Ok lines) chunks
    |> Result.map (join_content_lines ~eol)

  let parse_diff_header_path prefix line =
    line |> drop_prefix prefix |> String.split_on_char '\t' |> List.hd
    |> normalize_patch_path

  let parse_diff_git_paths line =
    let parts =
      line |> drop_prefix "diff --git " |> String.split_on_char ' '
      |> List.filter (( <> ) "")
    in
    match parts with
    | old_path :: new_path :: _ ->
        Some (normalize_patch_path old_path, normalize_patch_path new_path)
    | _ -> None

  let has_diff_headers lines =
    List.exists
      (fun line ->
        starts_with ~prefix:"diff --git " line || starts_with ~prefix:"--- " line
        || starts_with ~prefix:"rename from " line
        || starts_with ~prefix:"rename to " line)
      lines

  let parse_git_patch text =
    let lines = split_lines text in
    let length = List.length lines in
    let line index = List.nth lines index in
    let rec parse_file acc index =
      let rec skip_blank index =
        if index < length && String.trim (line index) = "" then skip_blank (index + 1)
        else index
      in
      let index = skip_blank index in
      if index >= length then
        match List.rev acc with [] -> Error "no hunks found" | hunks -> Ok hunks
      else
        let old_path = ref None in
        let new_path = ref None in
        let rename_from = ref None in
        let rename_to = ref None in
        let index =
          if starts_with ~prefix:"diff --git " (line index) then (
            match parse_diff_git_paths (line index) with
            | Some (old_p, new_p) ->
                old_path := Some old_p;
                new_path := Some new_p;
                index + 1
            | None -> index + 1)
          else index
        in
        let rec read_headers index =
          if index >= length then index
          else if starts_with ~prefix:"diff --git " (line index) then index
          else if starts_with ~prefix:"@@" (line index) then index
          else if starts_with ~prefix:"rename from " (line index) then (
            rename_from :=
              Some
                (line index |> drop_prefix "rename from " |> normalize_patch_path);
            read_headers (index + 1))
          else if starts_with ~prefix:"rename to " (line index) then (
            rename_to :=
              Some (line index |> drop_prefix "rename to " |> normalize_patch_path);
            read_headers (index + 1))
          else if starts_with ~prefix:"--- " (line index) then (
            old_path := Some (parse_diff_header_path "--- " (line index));
            if index + 1 < length && starts_with ~prefix:"+++ " (line (index + 1))
            then (
              new_path := Some (parse_diff_header_path "+++ " (line (index + 1)));
              index + 2)
            else index + 1)
          else read_headers (index + 1)
        in
        let chunk_start = read_headers index in
        let chunks, next = parse_chunks lines chunk_start length in
        let from_path =
          Option.value !rename_from
            ~default:(Option.value !old_path ~default:"/dev/null")
        in
        let to_path =
          Option.value !rename_to ~default:(Option.value !new_path ~default:from_path)
        in
        if from_path = "/dev/null" then
          if to_path = "/dev/null" then
            Error "invalid diff: both file paths are /dev/null"
          else
            match derive_updated_content "" chunks with
            | Error message -> Error message
            | Ok contents ->
                parse_file (Add_file { path = to_path; contents } :: acc) next
        else if to_path = "/dev/null" then
          parse_file (Delete_file from_path :: acc) next
        else if chunks = [] && from_path = to_path then
          Error ("no hunks found for " ^ from_path)
        else
          parse_file
            (Update_file
               {
                 path = from_path;
                 move_to = (if from_path = to_path then None else Some to_path);
                 chunks;
               }
            :: acc)
            next
    in
    parse_file [] 0

  let parse_wrapped_patch lines =
    let length = List.length lines in
    let line index = List.nth lines index in
    let stop =
      lines |> List.mapi (fun index value -> (index, value))
      |> List.find_map (fun (index, value) ->
             if value = "*** End Patch" then Some index else None)
      |> Option.value ~default:length
    in
    let rec parse_hunks acc index =
      if index >= stop then
        match List.rev acc with [] -> Error "no hunks found" | hunks -> Ok hunks
      else if String.trim (line index) = "" then parse_hunks acc (index + 1)
      else if starts_with ~prefix:"*** Add File: " (line index) then
        let path =
          line index |> drop_prefix "*** Add File: " |> normalize_patch_path
        in
        let contents, next = parse_add_content lines (index + 1) stop in
        parse_hunks (Add_file { path; contents } :: acc) next
      else if starts_with ~prefix:"*** Delete File: " (line index) then
        let path =
          line index |> drop_prefix "*** Delete File: " |> normalize_patch_path
        in
        parse_hunks (Delete_file path :: acc) (index + 1)
      else if starts_with ~prefix:"*** Update File: " (line index) then
        let path =
          line index |> drop_prefix "*** Update File: " |> normalize_patch_path
        in
        let index = index + 1 in
        let move_to, index =
          if index < stop && starts_with ~prefix:"*** Move to: " (line index) then
            ( Some (line index |> drop_prefix "*** Move to: " |> normalize_patch_path),
              index + 1 )
          else (None, index)
        in
        let chunks, next = parse_chunks lines index stop in
        if chunks = [] then Error ("no hunks found for " ^ path)
        else parse_hunks (Update_file { path; move_to; chunks } :: acc) next
      else Error ("invalid patch hunk header: " ^ line index)
    in
    parse_hunks [] 1

  let parse text =
    let text = normalize_patch_input text in
    if text = "" then Error "patchText is required"
    else
      let lines = split_lines text in
      match lines with
      | "*** Begin Patch" :: _ -> parse_wrapped_patch lines
      | _ when has_diff_headers lines -> parse_git_patch text
      | _ -> (
          let chunks, _ = parse_chunks lines 0 (List.length lines) in
          match chunks with
          | [] -> Error "Invalid patch format: expected git/unified diff"
          | chunks -> Ok [ Update_file { path = ""; move_to = None; chunks } ])

  let affected_actions hunks =
    let actions_for_hunk = function
      | Add_file { path; _ } -> [ Write_file path ]
      | Delete_file path -> [ Delete_path path ]
      | Update_file { path; move_to; _ } ->
          let destination = Option.value move_to ~default:path in
          if move_to = None then [ Write_file destination ]
          else [ Delete_path path; Write_file destination ]
    in
    List.concat_map actions_for_hunk hunks

  let affected_paths hunks =
    affected_actions hunks
    |> List.map (function Write_file path | Delete_path path -> path)

  let apply_to_map files hunks =
    let apply_hunk files = function
      | Add_file { path; contents } ->
          if String_map.mem path files then Error ("file already exists: " ^ path)
          else Ok (String_map.add path contents files)
      | Delete_file path ->
          if String_map.mem path files then Ok (String_map.remove path files)
          else Error ("file does not exist: " ^ path)
      | Update_file { path; move_to; chunks } -> (
          match String_map.find_opt path files with
          | None -> Error ("file does not exist: " ^ path)
          | Some original -> (
              let updated =
                if chunks = [] then Ok original else derive_updated_content original chunks
              in
              match updated with
              | Error message -> Error (path ^ ": " ^ message)
              | Ok contents ->
                  let files = String_map.remove path files in
                  Ok
                    (String_map.add
                       (Option.value move_to ~default:path)
                       contents files)))
    in
    List.fold_left
      (fun result hunk ->
        match result with Error _ as error -> error | Ok files -> apply_hunk files hunk)
      (Ok files) hunks
