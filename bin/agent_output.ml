let max_lines = 2000
let max_bytes = 50 * 1024

let owner_token value = Node_crypto.sha256_hex value

let rec take acc count = function
  | [] -> List.rev acc
  | _ when count <= 0 -> List.rev acc
  | line :: rest -> take (line :: acc) (count - 1) rest

let write_full_output ~agent_dir ?owner_session_id ?agent_id ?run_id text =
  try
    let directory =
      Node_path.join
        [
          agent_dir;
          "taumel";
          "agents";
          "owners";
          Option.fold ~none:"unowned" ~some:owner_token owner_session_id;
          Option.value agent_id ~default:"unowned";
          "outputs";
        ]
    in
    Node_fs.mkdir_sync ~recursive:true directory;
    let filename =
      Option.value run_id
        ~default:(string_of_int (int_of_float (Unix.gettimeofday () *. 1000.)))
      ^ ".txt"
    in
    let full_path = Node_path.join [ directory; filename ] in
    Node_fs.write_file_sync_string full_path text;
    Some full_path
  with _ -> None

let truncate ~agent_dir ?owner_session_id ?agent_id ?run_id text =
  let lines = String.split_on_char '\n' text in
  if List.length lines <= max_lines && String.length text <= max_bytes then
    (text, false, None)
  else
    let candidate = String.concat "\n" (take [] max_lines lines) in
    let clipped =
      if String.length candidate <= max_bytes then candidate
      else String.sub candidate 0 max_bytes
    in
    let path =
      write_full_output ~agent_dir ?owner_session_id ?agent_id ?run_id text
    in
    let notice =
      match path with
      | Some path -> "\n\n[Output truncated. Full output: " ^ path ^ "]"
      | None -> "\n\n[Output truncated.]"
    in
    (clipped ^ notice, true, path)
