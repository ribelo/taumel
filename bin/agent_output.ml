open Jsoo_bridge

let max_lines = 2000
let max_bytes = 50 * 1024

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string name |]

let owner_token value =
  let crypto = node_require "crypto" in
  let hash = Unsafe.fun_call (Unsafe.get crypto "createHash") [| js_string "sha256" |] in
  ignore (Unsafe.meth_call hash "update" [| js_string value |]);
  Js.to_string (Unsafe.meth_call hash "digest" [| js_string "hex" |])

let rec take acc count = function
  | [] -> List.rev acc
  | _ when count <= 0 -> List.rev acc
  | line :: rest -> take (line :: acc) (count - 1) rest

let write_full_output ~agent_dir ?owner_session_id ?agent_id ?run_id text =
  try
    let fs = node_require "fs" in
    let path = node_require "path" in
    let directory =
      Js.to_string
        (Unsafe.meth_call path "join"
           [|
             js_string agent_dir;
             js_string "taumel";
             js_string "agents";
             js_string "owners";
             js_string (Option.fold ~none:"unowned" ~some:owner_token owner_session_id);
             js_string (Option.value agent_id ~default:"unowned");
             js_string "outputs";
           |])
    in
    ignore
      (Unsafe.meth_call fs "mkdirSync"
         [| js_string directory; inject (Unsafe.obj [| ("recursive", js_bool true) |]) |]);
    let filename =
      Option.value run_id
        ~default:(string_of_int (int_of_float (Unix.gettimeofday () *. 1000.)))
      ^ ".txt"
    in
    let full_path =
      Js.to_string
        (Unsafe.meth_call path "join" [| js_string directory; js_string filename |])
    in
    ignore
      (Unsafe.meth_call fs "writeFileSync"
         [| js_string full_path; js_string text; js_string "utf8" |]);
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
