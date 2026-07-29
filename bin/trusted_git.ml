open Jsoo_bridge

let canonical_executable path =
  if Filename.is_relative path then None
  else
    try
      let canonical = Node_fs.realpath_sync path in
      let stats = Node_fs.stat_sync canonical in
      Node_fs.access_sync canonical (Node_fs.x_ok ());
      if Node_fs.is_file stats then Some canonical else None
    with _ -> None

let executable_result =
  lazy
    (let configured =
       match Node_process.env_get "TAUMEL_TRUSTED_GIT" with
       | Some value when String.trim value <> "" -> [ String.trim value ]
       | _ -> []
     in
     let username = Option.value (Node_os.user_info_username ()) ~default:"" in
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
       @
       if username = "" then []
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
    | Ok git -> (
        try
          let options =
            Node_child_process.utf8_options
              ~env:
                (Node_object.of_fields
                   [ Node_object.string_field "PATH" (Filename.dirname git) ])
              ()
          in
          let path =
            String.trim
              (Node_child_process.exec_file_sync ~file:git
                 ~args:[ "--exec-path" ] ~options)
          in
          let canonical = Node_fs.realpath_sync path in
          let stats = Node_fs.stat_sync canonical in
          if Node_fs.is_directory stats then Ok canonical
          else Error "trusted Git exec path is unavailable"
        with _ -> Error "trusted Git exec path is unavailable"))

let exec_path () = Lazy.force exec_path_result

let require_exec_path () =
  match exec_path () with Ok path -> path | Error message -> failwith message

let process_env () = Node_process.env ()

let restricted_environment ?git_dir ?git_work_tree extra =
  let git = require_executable () in
  let env = process_env () in
  let fields =
    [
      Node_object.string_field "PATH" (Filename.dirname git);
      Node_object.copy_field env "HOME";
      Node_object.string_field "GIT_EXEC_PATH" (require_exec_path ());
      Node_object.string_field "GIT_CONFIG_NOSYSTEM" "1";
      Node_object.string_field "GIT_CONFIG_GLOBAL" "/dev/null";
      Node_object.string_field "GIT_CONFIG_SYSTEM" "/dev/null";
      Node_object.string_field "GIT_TERMINAL_PROMPT" "0";
      Node_object.string_field "GIT_OPTIONAL_LOCKS" "0";
      Node_object.string_field "GIT_PAGER" "cat";
      Node_object.string_field "GIT_EDITOR" "true";
      Node_object.string_field "GIT_ASKPASS" "true";
      Node_object.string_field "GCM_INTERACTIVE" "never";
      Node_object.string_field "LC_ALL" "C";
      Node_object.string_field "GIT_CONFIG_COUNT" "8";
      Node_object.string_field "GIT_CONFIG_KEY_0" "core.hooksPath";
      Node_object.string_field "GIT_CONFIG_VALUE_0" "/dev/null";
      Node_object.string_field "GIT_CONFIG_KEY_1" "alias.x";
      Node_object.string_field "GIT_CONFIG_VALUE_1" "";
      Node_object.string_field "GIT_CONFIG_KEY_2" "core.useBuiltinFSMonitor";
      Node_object.string_field "GIT_CONFIG_VALUE_2" "false";
      Node_object.string_field "GIT_CONFIG_KEY_3" "advice.detachedHead";
      Node_object.string_field "GIT_CONFIG_VALUE_3" "false";
      Node_object.string_field "GIT_CONFIG_KEY_4" "commit.gpgsign";
      Node_object.string_field "GIT_CONFIG_VALUE_4" "false";
      Node_object.string_field "GIT_CONFIG_KEY_5" "core.editor";
      Node_object.string_field "GIT_CONFIG_VALUE_5" "true";
      Node_object.string_field "GIT_CONFIG_KEY_6" "protocol.file.allow";
      Node_object.string_field "GIT_CONFIG_VALUE_6" "always";
      Node_object.string_field "GIT_CONFIG_KEY_7" "submodule.recurse";
      Node_object.string_field "GIT_CONFIG_VALUE_7" "false";
    ]
  in
  let fields =
    match git_dir with
    | Some value when value <> "" ->
        Node_object.string_field "GIT_DIR" value :: fields
    | _ -> fields
  in
  let fields =
    match git_work_tree with
    | Some value when value <> "" ->
        Node_object.string_field "GIT_WORK_TREE" value :: fields
    | _ -> fields
  in
  js_of_ojs
    (Node_object.of_fields
       (fields @ List.map (fun (n, v) -> (n, ojs_of_js v)) extra))

type commit_identity = { name : string; email : string }

let identity_lookup_env () =
  let inherited =
    [ "HOME"; "XDG_CONFIG_HOME"; "LANG"; "LC_ALL" ]
    |> List.filter_map (fun name ->
        match Node_process.env_get name with
        | Some value -> Some (Node_object.string_field name value)
        | None -> None)
  in
  Node_object.of_fields
    (Node_object.string_field "PATH" (Filename.dirname (require_executable ()))
    :: inherited)

let usable_identity_value value =
  let value = String.trim value in
  let rec safe index =
    index >= String.length value
    ||
    match value.[index] with
    | '\x00' .. '\x1f' | '\x7f' -> false
    | _ -> safe (index + 1)
  in
  if value <> "" && String.length value <= 1024 && safe 0 then Some value
  else None

let configured_identity_value ~worktree_path key =
  try
    let options =
      Node_child_process.utf8_options ~cwd:worktree_path
        ~env:(identity_lookup_env ()) ()
    in
    let output =
      Node_child_process.exec_file_sync ~file:(require_executable ())
        ~args:[ "config"; "--get"; key ] ~options
    in
    usable_identity_value output
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
  let identity =
    if commit then resolve_commit_identity ~worktree_path:git_work_tree
    else None
  in
  let config_count = if identity = None then "9" else "11" in
  let env = process_env () in
  let fields =
    ref
      [
        Node_object.string_field "PATH" (Filename.dirname git);
        Node_object.copy_field env "HOME";
        Node_object.string_field "GIT_EXEC_PATH" (require_exec_path ());
        Node_object.string_field "LC_ALL" "C";
        Node_object.string_field "NO_COLOR" "1";
        Node_object.string_field "TERM" "dumb";
        Node_object.string_field "GIT_CONFIG_NOSYSTEM" "1";
        Node_object.string_field "GIT_CONFIG_GLOBAL" "/dev/null";
        Node_object.string_field "GIT_CONFIG_SYSTEM" "/dev/null";
        Node_object.string_field "GIT_OPTIONAL_LOCKS" "0";
        Node_object.string_field "GIT_TERMINAL_PROMPT" "0";
        Node_object.string_field "GIT_PAGER" "cat";
        Node_object.string_field "GIT_EDITOR" "true";
        Node_object.string_field "GIT_ASKPASS" "true";
        Node_object.string_field "GIT_DIR" git_dir;
        Node_object.string_field "GIT_WORK_TREE" git_work_tree;
        Node_object.string_field "GIT_CONFIG_COUNT" config_count;
        Node_object.string_field "GIT_CONFIG_KEY_0" "core.hooksPath";
        Node_object.string_field "GIT_CONFIG_VALUE_0" "/dev/null";
        Node_object.string_field "GIT_CONFIG_KEY_1" "commit.gpgsign";
        Node_object.string_field "GIT_CONFIG_VALUE_1" "false";
        Node_object.string_field "GIT_CONFIG_KEY_2" "submodule.recurse";
        Node_object.string_field "GIT_CONFIG_VALUE_2" "false";
        Node_object.string_field "GIT_CONFIG_KEY_3" "core.useBuiltinFSMonitor";
        Node_object.string_field "GIT_CONFIG_VALUE_3" "false";
        Node_object.string_field "GIT_CONFIG_KEY_4" "diff.external";
        Node_object.string_field "GIT_CONFIG_VALUE_4" "true";
        Node_object.string_field "GIT_CONFIG_KEY_5" "core.attributesFile";
        Node_object.string_field "GIT_CONFIG_VALUE_5" "/dev/null";
        Node_object.string_field "GIT_CONFIG_KEY_6" "filter.unset.clean";
        Node_object.string_field "GIT_CONFIG_VALUE_6" "";
        Node_object.string_field "GIT_CONFIG_KEY_7" "filter.unset.process";
        Node_object.string_field "GIT_CONFIG_VALUE_7" "";
        Node_object.string_field "GIT_CONFIG_KEY_8" "user.useConfigOnly";
        Node_object.string_field "GIT_CONFIG_VALUE_8" "true";
      ]
  in
  (match identity with
  | None -> ()
  | Some identity ->
      fields :=
        Node_object.string_field "GIT_CONFIG_KEY_9" "user.name"
        :: Node_object.string_field "GIT_CONFIG_VALUE_9" identity.name
        :: Node_object.string_field "GIT_CONFIG_KEY_10" "user.email"
        :: Node_object.string_field "GIT_CONFIG_VALUE_10" identity.email
        :: !fields);
  js_of_ojs (Node_object.of_fields !fields)
