open Jsoo_bridge

let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None -> Unsafe.fun_call (Unsafe.get Unsafe.global "require") [| js_string name |]

let fs_mod = lazy (node_require "fs")
let child_process_mod = lazy (node_require "child_process")
let os_mod = lazy (node_require "os")

let canonical_executable path =
  if Filename.is_relative path then None
  else
    let fs = Lazy.force fs_mod in
    try
      let canonical =
        Js.to_string (Unsafe.meth_call fs "realpathSync" [| js_string path |])
      in
      let stats = Unsafe.meth_call fs "statSync" [| js_string canonical |] in
      let x_ok = Unsafe.get (Unsafe.get fs "constants") "X_OK" in
      ignore (Unsafe.meth_call fs "accessSync" [| js_string canonical; x_ok |]);
      if Js.to_bool (Unsafe.meth_call stats "isFile" [||]) then Some canonical
      else None
    with _ -> None

let executable_result =
  lazy
    (let process_env = Unsafe.get (Unsafe.get Unsafe.global "process") "env" in
     let configured =
       match string_value (Unsafe.get process_env "TAUMEL_TRUSTED_GIT") with
       | Some value when String.trim value <> "" -> [ String.trim value ]
       | _ -> []
     in
     let username =
       try
         let info = Unsafe.meth_call (Lazy.force os_mod) "userInfo" [||] in
         Option.value (string_value (Unsafe.get info "username")) ~default:""
       with _ -> ""
     in
     let candidates =
       configured
       @ [
           "/usr/bin/git";
           "/bin/git";
           "/usr/local/bin/git";
           "/opt/homebrew/bin/git";
           "/run/current-system/sw/bin/git";
           "/nix/var/nix/profiles/default/bin/git";
         ]
       @ if username = "" then []
         else [ "/etc/profiles/per-user/" ^ username ^ "/bin/git" ]
     in
     let rec resolve = function
       | [] -> Error "trusted Git executable is unavailable"
       | candidate :: rest -> (
           match canonical_executable candidate with
           | Some path -> Ok path
           | None -> resolve rest)
     in
     resolve candidates)

let executable () = Lazy.force executable_result
let require_executable () =
  match executable () with Ok path -> path | Error message -> failwith message

let exec_path_result =
  lazy
    (match executable () with
    | Error _ as error -> error
    | Ok git ->
        let child_process = Lazy.force child_process_mod in
        try
          let output =
            Unsafe.meth_call child_process "execFileSync"
              [|
                js_string git;
                js_array [ js_string "--exec-path" ];
                Unsafe.obj
                  [|
                    ("encoding", js_string "utf8");
                    ("env", Unsafe.obj [| ("PATH", js_string (Filename.dirname git)) |]);
                    ("stdio", js_array [ js_string "ignore"; js_string "pipe"; js_string "pipe" ]);
                  |];
              |]
          in
          let path = String.trim (Js.to_string output) in
          let fs = Lazy.force fs_mod in
          let canonical =
            Js.to_string (Unsafe.meth_call fs "realpathSync" [| js_string path |])
          in
          let stats = Unsafe.meth_call fs "statSync" [| js_string canonical |] in
          if Js.to_bool (Unsafe.meth_call stats "isDirectory" [||]) then Ok canonical
          else Error "trusted Git exec path is unavailable"
        with _ -> Error "trusted Git exec path is unavailable")

let exec_path () = Lazy.force exec_path_result
let require_exec_path () =
  match exec_path () with Ok path -> path | Error message -> failwith message

let process_env () = Unsafe.get (Unsafe.get Unsafe.global "process") "env"

let restricted_environment ?git_dir ?git_work_tree extra =
  let git = require_executable () in
  let env = process_env () in
  let fields =
    [
      ("PATH", js_string (Filename.dirname git));
      ("HOME", Unsafe.get env "HOME");
      ("GIT_EXEC_PATH", js_string (require_exec_path ()));
      ("GIT_CONFIG_NOSYSTEM", js_string "1");
      ("GIT_CONFIG_GLOBAL", js_string "/dev/null");
      ("GIT_CONFIG_SYSTEM", js_string "/dev/null");
      ("GIT_TERMINAL_PROMPT", js_string "0");
      ("GIT_OPTIONAL_LOCKS", js_string "0");
      ("GIT_PAGER", js_string "cat");
      ("GIT_EDITOR", js_string "true");
      ("GIT_ASKPASS", js_string "true");
      ("GCM_INTERACTIVE", js_string "never");
      ("LC_ALL", js_string "C");
      ("GIT_CONFIG_COUNT", js_string "8");
      ("GIT_CONFIG_KEY_0", js_string "core.hooksPath");
      ("GIT_CONFIG_VALUE_0", js_string "/dev/null");
      ("GIT_CONFIG_KEY_1", js_string "alias.x");
      ("GIT_CONFIG_VALUE_1", js_string "");
      ("GIT_CONFIG_KEY_2", js_string "core.useBuiltinFSMonitor");
      ("GIT_CONFIG_VALUE_2", js_string "false");
      ("GIT_CONFIG_KEY_3", js_string "advice.detachedHead");
      ("GIT_CONFIG_VALUE_3", js_string "false");
      ("GIT_CONFIG_KEY_4", js_string "commit.gpgsign");
      ("GIT_CONFIG_VALUE_4", js_string "false");
      ("GIT_CONFIG_KEY_5", js_string "core.editor");
      ("GIT_CONFIG_VALUE_5", js_string "true");
      ("GIT_CONFIG_KEY_6", js_string "protocol.file.allow");
      ("GIT_CONFIG_VALUE_6", js_string "always");
      ("GIT_CONFIG_KEY_7", js_string "submodule.recurse");
      ("GIT_CONFIG_VALUE_7", js_string "false");
    ]
  in
  let fields =
    match git_dir with Some value when value <> "" -> ("GIT_DIR", js_string value) :: fields | _ -> fields
  in
  let fields =
    match git_work_tree with Some value when value <> "" -> ("GIT_WORK_TREE", js_string value) :: fields | _ -> fields
  in
  Unsafe.obj (Array.of_list (fields @ extra))

type commit_identity = { name : string; email : string }

let identity_lookup_env () =
  let env = process_env () in
  let inherited =
    [ "HOME"; "XDG_CONFIG_HOME"; "LANG"; "LC_ALL" ]
    |> List.filter_map (fun name ->
           match string_value (Unsafe.get env name) with
           | Some value -> Some (name, js_string value)
           | None -> None)
  in
  Unsafe.obj
    (Array.of_list
       (("PATH", js_string (Filename.dirname (require_executable ()))) :: inherited))

let usable_identity_value value =
  let value = String.trim value in
  let rec safe index =
    index >= String.length value
    ||
    match value.[index] with
    | '\x00' .. '\x1f' | '\x7f' -> false
    | _ -> safe (index + 1)
  in
  if value <> "" && String.length value <= 1024 && safe 0 then Some value else None

let configured_identity_value ~worktree_path key =
  try
    let output =
      Unsafe.meth_call (Lazy.force child_process_mod) "execFileSync"
        [|
          js_string (require_executable ());
          js_array (List.map js_string [ "config"; "--get"; key ]);
          Unsafe.obj
            [|
              ("cwd", js_string worktree_path);
              ("encoding", js_string "utf8");
              ("env", identity_lookup_env ());
              ("stdio", js_array [ js_string "ignore"; js_string "pipe"; js_string "pipe" ]);
            |];
        |]
    in
    usable_identity_value (Js.to_string output)
  with _ -> None

let resolve_commit_identity ~worktree_path =
  match
    ( configured_identity_value ~worktree_path "user.name",
      configured_identity_value ~worktree_path "user.email" )
  with
  | Some name, Some email -> Some { name; email }
  | _ -> None

let broker_environment ~git_dir ~git_work_tree ~commit =
  let git = require_executable () in
  let identity = if commit then resolve_commit_identity ~worktree_path:git_work_tree else None in
  let config_count = if identity = None then "9" else "11" in
  let env = process_env () in
  let fields =
    ref
      [
        ("PATH", js_string (Filename.dirname git));
        ("HOME", Unsafe.get env "HOME");
        ("GIT_EXEC_PATH", js_string (require_exec_path ()));
        ("LC_ALL", js_string "C");
        ("NO_COLOR", js_string "1");
        ("TERM", js_string "dumb");
        ("GIT_CONFIG_NOSYSTEM", js_string "1");
        ("GIT_CONFIG_GLOBAL", js_string "/dev/null");
        ("GIT_CONFIG_SYSTEM", js_string "/dev/null");
        ("GIT_OPTIONAL_LOCKS", js_string "0");
        ("GIT_TERMINAL_PROMPT", js_string "0");
        ("GIT_PAGER", js_string "cat");
        ("GIT_EDITOR", js_string "true");
        ("GIT_ASKPASS", js_string "true");
        ("GIT_DIR", js_string git_dir);
        ("GIT_WORK_TREE", js_string git_work_tree);
        ("GIT_CONFIG_COUNT", js_string config_count);
        ("GIT_CONFIG_KEY_0", js_string "core.hooksPath"); ("GIT_CONFIG_VALUE_0", js_string "/dev/null");
        ("GIT_CONFIG_KEY_1", js_string "commit.gpgsign"); ("GIT_CONFIG_VALUE_1", js_string "false");
        ("GIT_CONFIG_KEY_2", js_string "submodule.recurse"); ("GIT_CONFIG_VALUE_2", js_string "false");
        ("GIT_CONFIG_KEY_3", js_string "core.useBuiltinFSMonitor"); ("GIT_CONFIG_VALUE_3", js_string "false");
        ("GIT_CONFIG_KEY_4", js_string "diff.external"); ("GIT_CONFIG_VALUE_4", js_string "true");
        ("GIT_CONFIG_KEY_5", js_string "core.attributesFile"); ("GIT_CONFIG_VALUE_5", js_string "/dev/null");
        ("GIT_CONFIG_KEY_6", js_string "filter.unset.clean"); ("GIT_CONFIG_VALUE_6", js_string "");
        ("GIT_CONFIG_KEY_7", js_string "filter.unset.process"); ("GIT_CONFIG_VALUE_7", js_string "");
        ("GIT_CONFIG_KEY_8", js_string "user.useConfigOnly"); ("GIT_CONFIG_VALUE_8", js_string "true");
      ]
  in
  (match identity with
  | None -> ()
  | Some identity ->
      fields :=
        ("GIT_CONFIG_KEY_9", js_string "user.name")
        :: ("GIT_CONFIG_VALUE_9", js_string identity.name)
        :: ("GIT_CONFIG_KEY_10", js_string "user.email")
        :: ("GIT_CONFIG_VALUE_10", js_string identity.email)
        :: !fields);
  Unsafe.obj (Array.of_list !fields)
