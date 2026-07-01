open Jsoo_bridge

type skill = { name : string; path : string; base_dir : string }

let js_require name =
  Unsafe.fun_call (Unsafe.js_expr "require") [| js_string name |]

let fs = lazy (js_require "node:fs")
let path_mod = lazy (js_require "node:path")
let os_mod = lazy (js_require "node:os")
let process_obj = lazy (Unsafe.js_expr "process")

let call_path name args = Unsafe.fun_call (Unsafe.get (Lazy.force path_mod) name) args
let exists path = Js.to_bool (Unsafe.coerce (Unsafe.fun_call (Unsafe.get (Lazy.force fs) "existsSync") [| js_string path |]))

let read_file path =
  try
    string_value
      (Unsafe.fun_call (Unsafe.get (Lazy.force fs) "readFileSync")
         [| js_string path; js_string "utf8" |])
  with _ -> None

let is_dir path =
  try
    let stat = Unsafe.fun_call (Unsafe.get (Lazy.force fs) "statSync") [| js_string path |] in
    Js.to_bool (Unsafe.coerce (Unsafe.meth_call stat "isDirectory" [||]))
  with _ -> false

let dirname path = Option.value (string_value (call_path "dirname" [| js_string path |])) ~default:""
let basename path = Option.value (string_value (call_path "basename" [| js_string path |])) ~default:path

let resolve_path base raw =
  let raw = String.trim raw in
  let raw =
    if String.length raw >= 2 && raw.[0] = '~' && raw.[1] = '/' then
      let home = string_value (Unsafe.meth_call (Lazy.force os_mod) "homedir" [||]) |> Option.value ~default:"" in
      home ^ String.sub raw 1 (String.length raw - 1)
    else raw
  in
  Option.value (string_value (call_path "resolve" [| js_string base; js_string raw |])) ~default:raw

let skill_file dir = Option.value (string_value (call_path "join" [| js_string dir; js_string "SKILL.md" |])) ~default:(dir ^ "/SKILL.md")

let trim_quotes value =
  let value = String.trim value in
  let len = String.length value in
  if len >= 2 then
    match (value.[0], value.[len - 1]) with
    | ('"', '"') | ('\'', '\'') -> String.sub value 1 (len - 2)
    | _ -> value
  else value

let frontmatter_name text =
  let lines = String.split_on_char '\n' text in
  match lines with
  | first :: rest when String.trim first = "---" ->
      let rec loop = function
        | [] -> None
        | line :: _ when String.trim line = "---" -> None
        | line :: rest -> (
            match String.index_opt line ':' with
            | Some index when String.trim (String.sub line 0 index) = "name" ->
                let value = String.sub line (index + 1) (String.length line - index - 1) |> trim_quotes in
                if value = "" then None else Some value
            | _ -> loop rest)
      in
      loop rest
  | _ -> None

let strip_frontmatter text =
  let lines = String.split_on_char '\n' text in
  match lines with
  | first :: rest when String.trim first = "---" ->
      let rec drop = function
        | [] -> text
        | line :: rest when String.trim line = "---" -> String.concat "\n" rest
        | _ :: rest -> drop rest
      in
      drop rest
  | _ -> text

let readdir path =
  try
    Unsafe.fun_call (Unsafe.get (Lazy.force fs) "readdirSync")
      [| js_string path; Unsafe.obj [| ("withFileTypes", js_bool true) |] |]
    |> array_items |> List.sort (fun a b -> compare (get_string a "name") (get_string b "name"))
  with _ -> []

let add_skill table skill = if Hashtbl.mem table skill.name then () else Hashtbl.add table skill.name skill

let rec discover_dir table dir =
  let file = skill_file dir in
  if exists file then
    let name = Option.bind (read_file file) frontmatter_name |> Option.value ~default:(basename dir) in
    add_skill table { name; path = file; base_dir = dir }
  else
    readdir dir
    |> List.iter (fun entry ->
           let name = get_string entry "name" in
           let full = Option.value (string_value (call_path "join" [| js_string dir; js_string name |])) ~default:(dir ^ "/" ^ name) in
           let directory = Js.to_bool (Unsafe.coerce (Unsafe.meth_call entry "isDirectory" [||])) in
           if directory then discover_dir table full)

let discover_path table path =
  if exists path then
    if is_dir path then discover_dir table path
    else if basename path = "SKILL.md" then
      let base_dir = dirname path in
      let name = Option.bind (read_file path) frontmatter_name |> Option.value ~default:(basename base_dir) in
      add_skill table { name; path; base_dir }

let json_file path =
  match read_file path with
  | None -> None
  | Some text -> (
      try Some (Unsafe.fun_call (Unsafe.get (Unsafe.js_expr "JSON") "parse") [| js_string text |])
      with _ -> None)

let settings_paths settings base =
  let arrays = get_string_array settings "skillPaths" @ get_string_array settings "skills" in
  List.map (resolve_path base) arrays

let argv_skill_paths cwd =
  let argv = Unsafe.get (Lazy.force process_obj) "argv" |> array_items |> List.filter_map string_value in
  let rec loop acc = function
    | [] -> List.rev acc
    | "--skill" :: value :: rest -> loop (resolve_path cwd value :: acc) rest
    | arg :: rest when String.starts_with ~prefix:"--skill=" arg ->
        loop (resolve_path cwd (String.sub arg 8 (String.length arg - 8)) :: acc) rest
    | _ :: rest -> loop acc rest
  in
  loop [] argv

let source_paths cwd =
  let home = string_value (Unsafe.meth_call (Lazy.force os_mod) "homedir" [||]) |> Option.value ~default:"" in
  let agent_dir = resolve_path home ".pi/agent" in
  let global_settings = resolve_path agent_dir "settings.json" in
  let project_settings = resolve_path cwd ".pi/settings.json" in
  [ resolve_path agent_dir "skills"; resolve_path cwd ".pi/skills" ]
  @ (json_file global_settings |> Option.map (fun json -> settings_paths json (dirname global_settings)) |> Option.value ~default:[])
  @ (json_file project_settings |> Option.map (fun json -> settings_paths json (dirname project_settings)) |> Option.value ~default:[])
  @ argv_skill_paths cwd

let warning message = Unsafe.obj [| ("message", js_string message) |]

let message content =
  Unsafe.obj
    [|
      ("role", js_string "custom");
      ("customType", js_string "taumel.skill");
      ("content", js_string content);
      ("display", js_bool true);
    |]

let resolve_mentions params =
  let prompt = get_string params "prompt" in
  let names = Taumel.Skill_resolver.mentions prompt in
  if names = [] then Unsafe.obj [| ("messages", Unsafe.inject (Js.array [||])); ("warnings", Unsafe.inject (Js.array [||])) |]
  else
    let cwd = match optional_string_field params "cwd" with Some cwd when cwd <> "" -> cwd | _ -> "." in
    let table = Hashtbl.create 32 in
    List.iter (discover_path table) (source_paths cwd);
    let messages = ref [] in
    let warnings = ref [] in
    List.iter
      (fun name ->
        match Hashtbl.find_opt table name with
        | None -> ()
        | Some skill -> (
            match read_file skill.path with
            | None -> warnings := warning ("Could not read skill: " ^ name) :: !warnings
            | Some text ->
                let body = strip_frontmatter text in
                let block = Taumel.Skill_resolver.skill_block ~name:skill.name ~location:skill.path ~base_dir:skill.base_dir ~body in
                messages := message block :: !messages))
      names;
    Unsafe.obj
      [|
        ("messages", !messages |> List.rev |> Array.of_list |> Js.array |> Unsafe.inject);
        ("warnings", !warnings |> List.rev |> Array.of_list |> Js.array |> Unsafe.inject);
      |]
