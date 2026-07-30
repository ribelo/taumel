type t = { added : int; removed : int }

let empty = { added = 0; removed = 0 }

let added t = t.added

let removed t = t.removed

let checked_sum left right =
  if right < 0 || left > max_int - right then Error "Git line count overflow"
  else Ok (left + right)

let add left right =
  let ( let* ) = Result.bind in
  let* added = checked_sum left.added right.added in
  let* removed = checked_sum left.removed right.removed in
  Ok { added; removed }

let count value =
  match int_of_string_opt value with
  | Some value when value >= 0 -> Ok value
  | _ -> Error "invalid Git numstat count"

let parse_numstat_line line =
  match String.split_on_char '\t' line with
  | "-" :: "-" :: _ -> Ok empty
  | added :: removed :: _ ->
      let ( let* ) = Result.bind in
      let* added = count added in
      let* removed = count removed in
      Ok { added; removed }
  | _ -> Error "invalid Git numstat line"

let parse_numstat output =
  output |> String.split_on_char '\n'
  |> List.filter (fun line -> line <> "")
  |> List.fold_left
       (fun result line ->
         let ( let* ) = Result.bind in
         let* total = result in
         let* delta = parse_numstat_line line in
         add total delta)
       (Ok empty)

let is_hex value =
  value <> ""
  && String.for_all
       (function '0' .. '9' | 'a' .. 'f' | 'A' .. 'F' -> true | _ -> false)
       value

let record_hash value =
  if String.starts_with ~prefix:"\n" value then
    String.sub value 1 (String.length value - 1)
  else value

let exact_baseline_message value =
  let length = String.length value in
  length > 0
  && value.[length - 1] = '\n'
  && String.sub value 0 (length - 1) = "pi agent baseline"

let rec baseline_commit_fields = function
  | hash :: author_name :: author_email :: committer_name :: committer_email
    :: message :: rest ->
      let hash = record_hash hash in
      if
        is_hex hash
        && author_name = Agent_worktree.baseline_author_name
        && author_email = Agent_worktree.baseline_author_email
        && committer_name = Agent_worktree.baseline_committer_name
        && committer_email = Agent_worktree.baseline_committer_email
        && exact_baseline_message message
      then Some hash
      else baseline_commit_fields rest
  | _ -> None

let baseline_commit output =
  output |> String.split_on_char '\x00' |> baseline_commit_fields
