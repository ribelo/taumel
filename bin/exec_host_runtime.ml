open Jsoo_bridge

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string name |]

let fs = lazy (node_require "fs")
let os = lazy (node_require "os")
let path = lazy (node_require "path")

let exists candidate =
  candidate <> ""
  &&
  try Js.to_bool (Unsafe.meth_call (Lazy.force fs) "existsSync" [| js_string candidate |])
  with _ -> false

let canonical candidate =
  if not (exists candidate) then None
  else
    try
      Some
        (Js.to_string
           (Unsafe.meth_call (Lazy.force fs) "realpathSync"
              [| js_string candidate |]))
    with _ -> None

let executable candidate =
  match canonical candidate with
  | None -> None
  | Some resolved -> (
      try
        let constants = Unsafe.get (Lazy.force fs) "constants" in
        ignore
          (Unsafe.meth_call (Lazy.force fs) "accessSync"
             [| js_string resolved; Unsafe.get constants "X_OK" |]);
        Some resolved
      with _ -> None)

let path_candidates name =
  let env = Unsafe.get (Unsafe.get Unsafe.global "process") "env" in
  let value = Option.value (string_value (Unsafe.get env "PATH")) ~default:"" in
  let delimiter =
    Option.value
      (string_value (Unsafe.get (Lazy.force path) "delimiter"))
      ~default:":"
  in
  if delimiter = "" then []
  else
    value |> String.split_on_char delimiter.[0]
    |> List.filter_map (fun directory ->
           if directory = "" then None
           else
             Some
               (Js.to_string
                  (Unsafe.meth_call (Lazy.force path) "join"
                     [| js_string directory; js_string name |])))

let resolve_shell () =
  let rec first = function
    | [] -> Error "bash or sh executable is unavailable"
    | candidate :: rest -> (
        match executable candidate with Some value -> Ok value | None -> first rest)
  in
  first ([ "/bin/bash" ] @ path_candidates "bash" @ path_candidates "sh")

let unique values = List.sort_uniq String.compare values

let existing_real_paths values = values |> List.filter_map canonical |> unique
let existing_paths values = values |> List.filter exists |> unique

let metadata_listing root metadata_dir =
  let metadata_path =
    Js.to_string
      (Unsafe.meth_call (Lazy.force path) "join"
         [| js_string root; js_string metadata_dir |])
  in
  if not (exists metadata_path) then None
  else
    let children =
      try
        Unsafe.meth_call (Lazy.force fs) "readdirSync" [| js_string metadata_path |]
        |> array_value
        |> Option.map (fun entries ->
               entries |> Array.to_list |> List.filter_map string_value)
      with _ -> None
    in
    Some Taumel.Sandbox.{ metadata_dir; path = metadata_path; children }

let facts ~workspace_roots ~authorization_cwd =
  match resolve_shell () with
  | Error _ as error -> error
  | Ok shell ->
      let process = Unsafe.get Unsafe.global "process" in
      let env = Unsafe.get process "env" in
      let tmp_dir =
        Option.value
          (string_value (Unsafe.meth_call (Lazy.force os) "tmpdir" [||]))
          ~default:"/tmp"
      in
      let env_tmp_dir =
        Option.value (string_value (Unsafe.get env "TMPDIR")) ~default:""
      in
      let home =
        Option.value
          (string_value (Unsafe.meth_call (Lazy.force os) "homedir" [||]))
          ~default:""
      in
      let home = Option.value (canonical home) ~default:home in
      let home_parent =
        if home = "" then ""
        else
          Js.to_string
            (Unsafe.meth_call (Lazy.force path) "dirname" [| js_string home |])
      in
      let home_mount =
        if home_parent <> "" && home_parent <> "/" && exists home_parent then
          home_parent
        else home
      in
      let workspace_metadata_listings =
        workspace_roots
        |> List.concat_map (fun root ->
               Taumel.Sandbox.protected_workspace_dir_names
               |> List.filter_map (metadata_listing root))
      in
      let host =
        {
          Taumel.Sandbox.platform =
            Option.value (string_value (Unsafe.get process "platform"))
              ~default:"";
          temp_roots =
            Taumel.Sandbox.temp_root_candidates ~tmp_dir ~env_tmp_dir
            |> existing_real_paths;
          system_ro_paths =
            Taumel.Sandbox.system_ro_path_candidates |> existing_paths;
          home_mount;
          workspace_roots;
          authorization_cwd;
          workspace_metadata_listings;
        }
      in
      Ok (host, shell)
