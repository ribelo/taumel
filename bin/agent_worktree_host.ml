open Jsoo_bridge
let node_require name =
  let process = Unsafe.get Unsafe.global "process" in
  match function_field process "getBuiltinModule" with
  | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string name |]
  | None ->
      let require = Unsafe.get Unsafe.global "require" in
      Unsafe.fun_call require [| js_string name |]
let fs_mod = lazy (node_require "fs")
let path_mod = lazy (node_require "path")
let child_process_mod = lazy (node_require "child_process")
let crypto_mod = lazy (node_require "crypto")
let os_mod = lazy (node_require "os")
let pi_agent_dir () =
  let home =
    try Js.to_string (Unsafe.meth_call (Lazy.force os_mod) "homedir" [||])
    with _ -> ""
  in
  let process = Unsafe.get Unsafe.global "process" in
  let env = Unsafe.get process "env" in
  match string_value (Unsafe.get env "PI_CODING_AGENT_DIR") with
  | Some value when String.trim value <> "" ->
      let value = String.trim value in
      if String.length value >= 2 && String.sub value 0 2 = "~/" then
        home ^ String.sub value 1 (String.length value - 1)
      else value
  | _ -> home ^ "/.pi/agent"
let trusted_git_env = Trusted_git.restricted_environment
let trusted_git_executable = Trusted_git.executable
let require_trusted_git = Trusted_git.require_executable
let run_git ?(trim = true) ~cwd ?git_dir ?git_work_tree args =
  let child_process = Lazy.force child_process_mod in
  try
    let stdout =
      Unsafe.meth_call child_process "execFileSync"
        [|
          js_string (require_trusted_git ());
          js_array (List.map js_string args);
          Unsafe.obj
            [|
              ("cwd", js_string cwd);
              ("encoding", js_string "utf8");
              ("env", trusted_git_env ?git_dir ?git_work_tree []);
              ("stdio", js_array [ js_string "ignore"; js_string "pipe"; js_string "pipe" ]);
            |];
        |]
    in
    let text = Js.to_string stdout in
    Ok (if trim then String.trim text else text)
  with error ->
    let message =
      try
        let err = Obj.magic error in
        match string_value (Unsafe.get err "stderr") with
        | Some stderr when String.trim stderr <> "" -> String.trim stderr
        | _ ->
            (match string_value (Unsafe.get err "message") with
            | Some message -> message
            | None -> Printexc.to_string error)
      with _ -> Printexc.to_string error
    in
    Error message
let path_exists path =
  let fs = Lazy.force fs_mod in
  try Js.to_bool (Unsafe.meth_call fs "existsSync" [| js_string path |])
  with _ -> false
let is_directory path =
  let fs = Lazy.force fs_mod in
  try
    let stats = Unsafe.meth_call fs "statSync" [| js_string path |] in
    Js.to_bool (Unsafe.meth_call stats "isDirectory" [||])
  with _ -> false
let mkdir_p path =
  let fs = Lazy.force fs_mod in
  ignore
    (Unsafe.meth_call fs "mkdirSync"
       [|
         js_string path;
         Unsafe.obj [| ("recursive", js_bool true) |];
       |])
let write_file path contents =
  let fs = Lazy.force fs_mod in
  ignore
    (Unsafe.meth_call fs "writeFileSync"
       [| js_string path; js_string contents; js_string "utf8" |])
let read_file path =
  let fs = Lazy.force fs_mod in
  try
    Ok
      (Js.to_string
         (Unsafe.meth_call fs "readFileSync"
            [| js_string path; js_string "utf8" |]))
  with error -> Error (Printexc.to_string error)
let repository_identity = Agent_worktree_verification.repository_identity
(* Worktree removal is descriptor-anchored like private-session cleanup
   (ADR 0003): ancestor or component swaps cannot redirect deletion. *)
let remove_path path = Agent_anchored_fs.unlink_tree path
let resolve_repository source_workspace =
  match run_git ~cwd:source_workspace [ "rev-parse"; "--is-inside-work-tree" ] with
  | Error _ ->
      Error
        ( "workspace_unavailable",
          Taumel.Agent_worktree.workspace_unavailable_not_git )
  | Ok value when String.trim value <> "true" ->
      Error
        ( "workspace_unavailable",
          Taumel.Agent_worktree.workspace_unavailable_not_git )
  | Ok _ -> (
      match run_git ~cwd:source_workspace [ "rev-parse"; "--show-toplevel" ] with
      | Error message -> Error ("workspace_unavailable", message)
      | Ok toplevel -> (
          match run_git ~cwd:source_workspace [ "rev-parse"; "--verify"; "HEAD" ] with
          | Error _ ->
              Error
                ( "workspace_unavailable",
                  Taumel.Agent_worktree.workspace_unavailable_no_head )
          | Ok head -> (
              match
                run_git ~cwd:source_workspace
                  [ "rev-parse"; "--path-format=absolute"; "--git-common-dir" ]
              with
              | Error message -> Error ("workspace_unavailable", message)
              | Ok common_dir ->
                  let main_repository_root =
                    if Filename.basename common_dir = ".git" then
                      Filename.dirname common_dir
                    else toplevel
                  in
                  (match repository_identity common_dir with
                  | Error message -> Error ("workspace_unavailable", message)
                  | Ok main_repository_id ->
                      Ok
                        ( toplevel, main_repository_root, main_repository_id,
                          head )))))
let sha256_hex value =
  let crypto = Lazy.force crypto_mod in
  let hash = Unsafe.fun_call (Unsafe.get crypto "createHash") [| js_string "sha256" |] in
  ignore (Unsafe.meth_call hash "update" [| js_string value |]);
  Js.to_string (Unsafe.meth_call hash "digest" [| js_string "hex" |])
let file_entry_fingerprint ~root relative =
  let fs = Lazy.force fs_mod in
  let path = Filename.concat root relative in
  let crypto = Lazy.force crypto_mod in
  try
    if not (path_exists path) then Ok ("deleted\000" ^ relative)
    else
      let lstat = Unsafe.meth_call fs "lstatSync" [| js_string path |] in
      if Js.to_bool (Unsafe.meth_call lstat "isSymbolicLink" [||]) then
        let target =
          Js.to_string (Unsafe.meth_call fs "readlinkSync" [| js_string path |])
        in
        Ok ("symlink\000" ^ relative ^ "\000" ^ target)
      else if Js.to_bool (Unsafe.meth_call lstat "isDirectory" [||]) then
        Error ("unsupported directory entry in source snapshot: " ^ relative)
      else if Js.to_bool (Unsafe.meth_call lstat "isFile" [||]) then
        let mode =
          match float_value (Unsafe.get lstat "mode") with
          | Some value -> int_of_float value land 0o777
          | None -> 0o644
        in
        let buf = Unsafe.meth_call fs "readFileSync" [| js_string path |] in
        let hash =
          Unsafe.fun_call (Unsafe.get crypto "createHash") [| js_string "sha256" |]
        in
        ignore (Unsafe.meth_call hash "update" [| buf |]);
        let digest =
          Js.to_string (Unsafe.meth_call hash "digest" [| js_string "hex" |])
        in
        Ok ("file\000" ^ relative ^ "\000" ^ string_of_int mode ^ "\000" ^ digest)
      else Error ("unsupported source entry type: " ^ relative)
  with error -> Error (relative ^ ": " ^ Printexc.to_string error)
let nul_paths listing =
  String.split_on_char '\x00' listing |> List.filter (fun value -> value <> "")
let list_source_entries ~source_workspace =
  let ( let* ) = Result.bind in
  let* head_paths =
    run_git ~trim:false ~cwd:source_workspace
      [ "ls-tree"; "-r"; "--name-only"; "-z"; "HEAD" ]
  in
  let* index_paths =
    run_git ~trim:false ~cwd:source_workspace [ "ls-files"; "-z" ]
  in
  let* untracked =
    run_git ~trim:false ~cwd:source_workspace
      [ "ls-files"; "-z"; "-o"; "--exclude-standard" ]
  in
  let paths =
    nul_paths head_paths @ nul_paths index_paths @ nul_paths untracked
    |> List.sort_uniq String.compare
  in
  Ok paths
let fingerprint_entries ~root entries =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | relative :: rest -> (
        match file_entry_fingerprint ~root relative with
        | Error _ as error -> error
        | Ok entry -> loop (entry :: acc) rest)
  in
  let ( let* ) = Result.bind in
  let* entry_lines = loop [] entries in
  let* head = run_git ~cwd:root [ "rev-parse"; "HEAD" ] in
  Ok (sha256_hex (head ^ "\n" ^ String.concat "\n" entry_lines))
let capture_source_manifest ~source_workspace =
  let ( let* ) = Result.bind in
  let* first_entries = list_source_entries ~source_workspace in
  let* first = fingerprint_entries ~root:source_workspace first_entries in
  let* second_entries = list_source_entries ~source_workspace in
  let* second = fingerprint_entries ~root:source_workspace second_entries in
  if first_entries <> second_entries || first <> second then
    Error Taumel.Agent_worktree.workspace_unavailable_source_changed
  else Ok (second_entries, second)
let source_fingerprint ~source_workspace =
  let ( let* ) = Result.bind in
  let* entries = list_source_entries ~source_workspace in
  fingerprint_entries ~root:source_workspace entries
let write_marker marker ~agent_home =
  let owner_component =
    Taumel.Agent_workspace.owner_component marker.Taumel.Agent_worktree.owner_session_id
  in
  let path =
    Taumel.Agent_worktree.provisional_marker_path ~agent_home ~owner_component
      ~agent_id:marker.agent_id
  in
  mkdir_p (Filename.dirname path);
  write_file path
    (Taumel.Shared.encode_json (Taumel.Agent_worktree.marker_to_json marker));
  path
let read_marker path =
  match read_file path with
  | Error message -> Error message
  | Ok contents -> (
      match Taumel.Shared.decode_json_string contents with
      | Error message -> Error message
      | Ok json -> Taumel.Agent_worktree.marker_of_json json)
let clear_marker ~agent_home ~owner_session_id ~agent_id =
  let owner_component = Taumel.Agent_workspace.owner_component owner_session_id in
  let path =
    Taumel.Agent_worktree.provisional_marker_path ~agent_home ~owner_component
      ~agent_id
  in
  match remove_path path with
  | Error message -> Error message
  | Ok () when path_exists path -> Error "provisional marker remains after removal"
  | Ok () -> Ok ()
let path_or_branch_exists ~main_repository_root ~worktree_path ~branch =
  let path_exists = path_exists worktree_path in
  match
    run_git ~cwd:main_repository_root
      [ "for-each-ref"; "--format=%(refname)"; "refs/heads/" ^ branch ]
  with
  | Error message -> Error message
  | Ok output -> Ok (path_exists || String.trim output <> "")
let create_worktree ~main_repository_root ~worktree_path ~branch ~head =
  mkdir_p (Filename.dirname worktree_path);
  run_git ~cwd:main_repository_root
    [ "worktree"; "add"; "-b"; branch; worktree_path; head ]
  |> Result.map (fun _ -> ())

let reproduce_source_entries ~source_workspace ~worktree_path ~entries =
  let fs = Lazy.force fs_mod in
  let rec copy = function
  | [] -> Ok ()
  | relative :: rest ->
      let source = Filename.concat source_workspace relative in
      let target = Filename.concat worktree_path relative in
      if not (path_exists source) then (
        ignore (remove_path target);
        copy rest)
      else (
        mkdir_p (Filename.dirname target);
        try
          let lstat =
            Unsafe.meth_call fs "lstatSync" [| js_string source |]
          in
          if Js.to_bool (Unsafe.meth_call lstat "isSymbolicLink" [||]) then (
            let link =
              Js.to_string
                (Unsafe.meth_call fs "readlinkSync" [| js_string source |])
            in
            ignore (remove_path target);
            ignore
              (Unsafe.meth_call fs "symlinkSync"
                 [| js_string link; js_string target |]);
            copy rest)
          else if Js.to_bool (Unsafe.meth_call lstat "isDirectory" [||]) then
            Error ("unsupported directory entry in source snapshot: " ^ relative)
          else if Js.to_bool (Unsafe.meth_call lstat "isFile" [||]) then (
            ignore
              (Unsafe.meth_call fs "copyFileSync"
                 [| js_string source; js_string target |]);
            let mode =
              match float_value (Unsafe.get lstat "mode") with
              | Some value -> int_of_float value land 0o777
              | None -> 0o644
            in
            ignore
              (Unsafe.meth_call fs "chmodSync"
                 [| js_string target; js_number (float_of_int mode) |]);
            copy rest)
          else Error ("unsupported source entry type: " ^ relative)
        with error -> Error (relative ^ ": " ^ Printexc.to_string error))
  in
  copy entries
let attr_values_for ~worktree_path ~attr relative =
  match
    run_git ~trim:false ~cwd:worktree_path
      [ "check-attr"; "-z"; attr; "--"; relative ]
  with
  | Error message -> Error message
  | Ok output ->
      let parts =
        match output with
        | "" -> []
        | text when text.[String.length text - 1] = '\x00' ->
            nul_paths text
        | text -> nul_paths (text ^ "\x00")
      in
      let rec values acc = function
        | [] -> Ok (List.rev acc)
        | path :: name :: value :: rest ->
            if path = relative && name = attr then values (value :: acc) rest
            else
              Error
                ("malformed check-attr record for " ^ relative ^ "/" ^ attr)
        | _ ->
            Error ("truncated check-attr output for " ^ relative ^ "/" ^ attr)
      in
      match values [] parts with
      | Error _ as error -> error
      | Ok [] ->
          Error ("missing check-attr record for " ^ relative ^ "/" ^ attr)
      | Ok vals -> Ok vals
let path_has_executable_filter ~worktree_path relative =
  match attr_values_for ~worktree_path ~attr:"filter" relative with
  | Error _ as error -> error
  | Ok filters when List.exists (( <> ) "unspecified") filters ->
      Error ("brokered git add rejects executable filter: " ^ relative)
  | Ok _ -> Ok ()
let expand_broker_add_paths ~worktree_path argv =
  let has_all = List.mem "--all" argv in
  let rec after_sep = function [] -> [] | "--" :: r -> r | _ :: r -> after_sep r in
  let pathspecs = after_sep argv in
  if (not has_all) && pathspecs = [] then
    Error "brokered git add requires --all or pathspecs after --"
  else
    let args = [ "ls-files"; "-z"; "-c"; "-o"; "--exclude-standard" ] @ (if pathspecs = [] then [] else "--" :: pathspecs) in
    run_git ~trim:false ~cwd:worktree_path args |> Result.map nul_paths
let preflight_broker_add ~worktree_path argv =
  let ( let* ) = Result.bind in
  let* expanded = expand_broker_add_paths ~worktree_path argv in
  let rec check = function
    | [] -> Ok ()
    | relative :: rest ->
        if
          path_exists
            (Filename.concat (Filename.concat worktree_path relative) ".git")
        then Error ("brokered git add rejects nested repository: " ^ relative)
        else
          match run_git ~cwd:worktree_path [ "ls-files"; "-s"; "--"; relative ] with
          | Error message -> Error message
          | Ok output
            when String.length output >= 6 && String.sub output 0 6 = "160000" ->
              Error ("brokered git add rejects gitlink: " ^ relative)
          | Ok _ -> (
              match path_has_executable_filter ~worktree_path relative with
              | Error _ as error -> error
              | Ok () -> check rest)
  in
  check expanded
let with_temp_index ~worktree_path f =
  let ( let* ) = Result.bind in
  let* index_path = run_git ~cwd:worktree_path [ "rev-parse"; "--git-path"; "index" ] in
  let* temp_index = run_git ~cwd:worktree_path [ "rev-parse"; "--git-path"; "taumel-temp-index" ] in
  let fs = Lazy.force fs_mod in
  (try
     if path_exists index_path then
       ignore (Unsafe.meth_call fs "copyFileSync" [| js_string index_path; js_string temp_index |])
     else ignore (remove_path temp_index);
     Ok ()
   with error -> Error (Printexc.to_string error))
  |> function
  | Error _ as error -> error
  | Ok () -> (
      match f ~temp_index with
      | Ok () -> (
          try
            ignore (Unsafe.meth_call fs "renameSync" [| js_string temp_index; js_string index_path |]);
            Ok ()
          with error -> ignore (remove_path temp_index); Error (Printexc.to_string error))
      | Error _ as error -> ignore (remove_path temp_index); error)
let perform_secure_broker_add ?(preflight = true) ~worktree_path argv =
  let ( let* ) = Result.bind in
  let* () = if preflight then preflight_broker_add ~worktree_path argv else Ok () in
  let* paths = expand_broker_add_paths ~worktree_path argv in
  with_temp_index ~worktree_path (fun ~temp_index ->
  let run_index args =
    let child_process = Lazy.force child_process_mod in
    try
      let stdout =
        Unsafe.meth_call child_process "execFileSync"
          [|
            js_string (require_trusted_git ());
            js_array (List.map js_string args);
            Unsafe.obj
              [|
                ("cwd", js_string worktree_path);
                ("encoding", js_string "utf8");
                ("env", trusted_git_env [ ("GIT_INDEX_FILE", js_string temp_index) ]);
                ("stdio", js_array [ js_string "ignore"; js_string "pipe"; js_string "pipe" ]);
              |];
          |]
      in
      Ok (String.trim (Js.to_string stdout))
    with error -> Error (Printexc.to_string error)
  in
  let stage_path relative =
    let full = Filename.concat worktree_path relative in
    let fs = Lazy.force fs_mod in
    if not (path_exists full) then
      run_index [ "update-index"; "--force-remove"; "--"; relative ] |> Result.map ignore
    else
      try
        let st = Unsafe.meth_call fs "lstatSync" [| js_string full |] in
        if Js.to_bool (Unsafe.meth_call st "isSymbolicLink" [||]) then (
          let target = Js.to_string (Unsafe.meth_call fs "readlinkSync" [| js_string full |]) in
          let tmp =
            match run_git ~cwd:worktree_path [ "rev-parse"; "--git-path"; "taumel-link-bytes" ] with
            | Ok path -> path
            | Error _ -> Filename.concat (Filename.get_temp_dir_name ()) "taumel-link-bytes"
          in
          write_file tmp target;
          let hashed = run_git ~cwd:worktree_path [ "hash-object"; "-w"; "--no-filters"; tmp ] in
          ignore (remove_path tmp);
          match hashed with
          | Error message -> Error message
          | Ok blob ->
              run_index [ "update-index"; "--add"; "--cacheinfo"; "120000," ^ blob ^ "," ^ relative ]
              |> Result.map ignore)
        else
          let mode =
            match float_value (Unsafe.get st "mode") with
            | Some m when int_of_float m land 0o111 <> 0 -> "100755"
            | _ -> "100644"
          in
          match run_git ~cwd:worktree_path [ "hash-object"; "-w"; "--no-filters"; full ] with
          | Error message -> Error message
          | Ok blob ->
              run_index [ "update-index"; "--add"; "--cacheinfo"; mode ^ "," ^ blob ^ "," ^ relative ]
              |> Result.map ignore
      with error -> Error (relative ^ ": " ^ Printexc.to_string error)
  in
  let rec stage_all = function
    | [] -> Ok ()
    | relative :: rest -> (match stage_path relative with Error _ as e -> e | Ok () -> stage_all rest)
  in
  stage_all paths)
let registration_present ~main_repository_root ~worktree_path =
  match
    run_git ~cwd:main_repository_root [ "worktree"; "list"; "--porcelain" ]
  with
  | Error message -> Error message
  | Ok listing ->
      let needle = "worktree " ^ worktree_path in
      let rec contains haystack =
        let h = String.length haystack in
        let n = String.length needle in
        let rec loop i =
          i + n <= h && (String.sub haystack i n = needle || loop (i + 1))
        in
        n = 0 || loop 0
      in
      Ok (List.exists contains (String.split_on_char '\n' listing))
let create_baseline ~worktree_path =
  let ( let* ) = Result.bind in
  let* dirty =
    run_git ~trim:false ~cwd:worktree_path
      [ "ls-files"; "-z"; "-m"; "-d"; "-o"; "--exclude-standard" ]
    |> Result.map nul_paths
  in
  let* () =
    if dirty = [] then Ok ()
    else perform_secure_broker_add ~preflight:false ~worktree_path ("add" :: "--" :: dirty)
  in
  let child_process = Lazy.force child_process_mod in
  try
    ignore
      (Unsafe.meth_call child_process "execFileSync"
         [|
           js_string (require_trusted_git ());
           js_array (List.map js_string [ "-c"; "core.hooksPath=/dev/null"; "commit"; "--allow-empty"; "-m"; "pi agent baseline" ]);
           Unsafe.obj
             [|
               ("cwd", js_string worktree_path);
               ("encoding", js_string "utf8");
               ("env", trusted_git_env [
                    ("GIT_AUTHOR_NAME", js_string Taumel.Agent_worktree.baseline_author_name);
                    ("GIT_AUTHOR_EMAIL", js_string Taumel.Agent_worktree.baseline_author_email);
                    ("GIT_COMMITTER_NAME", js_string Taumel.Agent_worktree.baseline_committer_name);
                    ("GIT_COMMITTER_EMAIL", js_string Taumel.Agent_worktree.baseline_committer_email)]);
               ("stdio", js_array [ js_string "ignore"; js_string "pipe"; js_string "pipe" ]);
             |];
         |]);
    Ok ()
  with error -> Error (Printexc.to_string error)
let validate_lifecycle_resources ~main_repository_root ~main_repository_id
    ~worktree_path ~branch =
  if String.trim main_repository_root = "" then Error "main repository root is required"
  else if String.trim main_repository_id = "" then Error "main repository identity is required"
  else if String.trim worktree_path = "" then Error "worktree path is required"
  else if String.trim branch = "" then Error "dedicated branch is required"
  else Ok ()

let authorize_cleanup = validate_lifecycle_resources
let verify_broker_registration ~worktree_path ~main_repository_root
    ~main_repository_id ~branch =
  Agent_worktree_verification.verify_registration ~is_directory
    ~run_git:(fun ~cwd args -> run_git ~cwd args)
    ~repository_identity ~worktree_path ~main_repository_root
    ~main_repository_id ~branch
let rollback_provisional ~agent_home ~owner_session_id ~agent_id
    ~main_repository_root ~main_repository_id ~worktree_path ~branch =
  match
    authorize_cleanup ~main_repository_root ~main_repository_id ~worktree_path
      ~branch
  with
  | Error _ as error -> error
  | Ok () -> (
      let owner_component = Taumel.Agent_workspace.owner_component owner_session_id in
      let marker_path =
        Taumel.Agent_worktree.provisional_marker_path ~agent_home ~owner_component
          ~agent_id
      in
      match read_marker marker_path with
      | Error message -> Error ("provisional marker is unavailable: " ^ message)
      | Ok marker
        when not
               (Taumel.Agent_worktree.valid_creation_steps marker.completed_steps
               && Taumel.Agent_worktree.marker_matches_resources marker
                    ~main_repository_root ~main_repository_id ~worktree_path ~branch
               && marker.owner_session_id = owner_session_id
               && marker.agent_id = agent_id) ->
          Error "provisional marker does not match the cleanup resources"
      | Ok marker
        when List.mem Taumel.Agent_worktree.Identity_accepted
               marker.completed_steps ->
          Error "accepted agent worktrees require normal close cleanup"
      | Ok marker
        when not
               (List.mem Taumel.Agent_worktree.Worktree_creation_started
                  marker.completed_steps) ->
          (match path_or_branch_exists ~main_repository_root ~worktree_path ~branch with
          | Error message -> Error message
          | Ok true -> Error "unverified provisional resources collide with the marker"
          | Ok false -> (
              match registration_present ~main_repository_root ~worktree_path with
              | Ok false -> Ok ()
              | Ok true -> Error "unverified provisional registration remains"
              | Error message -> Error message))
      | Ok _ when not (path_exists worktree_path) ->
          (match path_or_branch_exists ~main_repository_root ~worktree_path ~branch with
          | Error message -> Error message
          | Ok true -> Error "provisional branch remains without its managed worktree"
          | Ok false -> (
              match registration_present ~main_repository_root ~worktree_path with
              | Ok false -> Ok ()
              | Ok true -> Error "provisional registration remains without its worktree"
              | Error message -> Error message))
      | Ok _ ->
      match
        verify_broker_registration ~worktree_path ~main_repository_root
          ~main_repository_id ~branch
      with
      | Error message -> Error message
      | Ok _ ->
      ignore
        (run_git ~cwd:main_repository_root
           [ "worktree"; "remove"; "--force"; worktree_path ]);
      ignore (remove_path worktree_path);
      ignore (run_git ~cwd:main_repository_root [ "branch"; "-D"; branch ]);
      (match path_or_branch_exists ~main_repository_root ~worktree_path ~branch with
      | Error message -> Error message
      | Ok true -> Error "provisional worktree path or branch remains after rollback"
      | Ok false ->
          match registration_present ~main_repository_root ~worktree_path with
          | Ok false -> Ok ()
          | Ok true -> Error "provisional worktree registration remains after rollback"
          | Error message -> Error message))
let unfinished_operation ~worktree_path =
  let git_dir =
    match run_git ~cwd:worktree_path [ "rev-parse"; "--git-dir" ] with
    | Ok value -> value
    | Error _ -> worktree_path ^ "/.git"
  in
  let markers =
    [
      "MERGE_HEAD";
      "CHERRY_PICK_HEAD";
      "REVERT_HEAD";
      "BISECT_LOG";
      "rebase-merge";
      "rebase-apply";
    ]
  in
  List.exists
    (fun name -> path_exists (Filename.concat git_dir name))
    markers
let worktree_is_clean ~worktree_path =
  if unfinished_operation ~worktree_path then
    Error "agent worktree has an unfinished repository operation"
  else
    match
      run_git ~cwd:worktree_path
        [
          "status";
          "--porcelain=v1";
          "--untracked-files=normal";
          "--ignore-submodules=none";
        ]
    with
    | Error message -> Error message
    | Ok output when String.trim output <> "" ->
        Error "agent worktree has uncommitted changes"
    | Ok _ -> (
        match
          run_git ~cwd:worktree_path
            [ "submodule"; "status"; "--recursive" ]
        with
        | Error message ->
            Error ("failed to inspect agent worktree submodules: " ^ message)
        | Ok submodule_status ->
            let dirty =
              submodule_status |> String.split_on_char '\n'
              |> List.exists (fun line ->
                     let line = String.trim line in
                     line <> ""
                     && (line.[0] = '-' || line.[0] = '+' || line.[0] = 'U'))
            in
            if dirty then
              Error "agent worktree has dirty or uninitialized submodules"
            else Ok ())
let provision ~expected_binding ~owner_session_id ~agent_id ~source_workspace =
  let agent_home = pi_agent_dir () in
  match resolve_repository source_workspace with
  | Error _ as error -> error
  | Ok (_toplevel, main_repository_root, main_repository_id, head) -> (
      let binding =
        Taumel.Agent_workspace.worktree ~source_origin:source_workspace
          ~main_repository_root ~main_repository_id
      in
      if expected_binding <> binding then
        Error
          ( "workspace_unavailable",
            "source repository changed after agent action preparation" )
      else
              match
        Taumel.Agent_workspace.derive ~agent_home ~owner_session_id ~agent_id
          binding
      with
      | Error message -> Error ("workspace_unavailable", message)
      | Ok derived ->
          let worktree_path = derived.worktree_path in
          let branch = derived.branch in
          let marker_path =
            Taumel.Agent_worktree.provisional_marker_path ~agent_home
              ~owner_component:derived.owner_component ~agent_id
          in
          let collision =
            if path_exists marker_path then Ok true
            else
              path_or_branch_exists ~main_repository_root ~worktree_path ~branch
          in
          match collision with
          | Error message -> Error ("workspace_unavailable", message)
          | Ok true ->
            Error
              ( "workspace_unavailable",
                Taumel.Agent_worktree.workspace_unavailable_collision )
          | Ok false ->
            match
              validate_lifecycle_resources ~main_repository_root
                ~main_repository_id ~worktree_path ~branch
            with
            | Error message -> Error ("workspace_unavailable", message)
            | Ok () ->
                (match capture_source_manifest ~source_workspace with
                | Error message -> Error ("workspace_unavailable", message)
                | Ok (entries, accepted_fingerprint) ->
                      let marker =
                        {
                          Taumel.Agent_worktree.owner_session_id;
                          agent_id;
                          main_repository_root;
                          main_repository_id;
                          worktree_path;
                          branch;
                          completed_steps =
                            [ Marker_recorded; Worktree_creation_started ];
                          cleanup_incident_id = None;
                        }
                      in
                      ignore (write_marker marker ~agent_home);
                      let fail_with_rollback message =
                        let cleanup =
                          match
                            rollback_provisional ~agent_home ~owner_session_id
                              ~agent_id ~main_repository_root ~main_repository_id
                              ~worktree_path ~branch
                          with
                          | Error _ as error -> error
                          | Ok () ->
                              clear_marker ~agent_home ~owner_session_id ~agent_id
                        in
                        match cleanup with
                        | Ok () -> Error ("workspace_unavailable", message)
                        | Error _ ->
                            let incident =
                              Taumel.Agent_worktree.opaque_cleanup_incident_id
                                ~owner_session_id ~agent_id
                                ~now:(int_of_float (Unix.gettimeofday ()))
                            in
                            let retained_marker =
                              match read_marker marker_path with
                              | Ok current ->
                                  { current with cleanup_incident_id = Some incident }
                              | Error _ ->
                                  { marker with cleanup_incident_id = Some incident }
                            in
                            (try ignore (write_marker retained_marker ~agent_home)
                             with _ -> ());
                            Error
                              ( "workspace_unavailable",
                                "provisional worktree cleanup failed; incident "
                                ^ incident )
                      in
                      (try
                       match
                         Agent_worktree_verification.verify_repository_identity
                           ~run_git:(fun ~cwd args -> run_git ~cwd args)
                           ~main_repository_root ~main_repository_id
                       with
                       | Error message -> fail_with_rollback message
                       | Ok () -> match
                        create_worktree ~main_repository_root ~worktree_path
                          ~branch ~head
                      with
                      | Error message -> fail_with_rollback message
                      | Ok () ->
                          let marker =
                            {
                              marker with
                              completed_steps =
                                [ Marker_recorded; Worktree_creation_started;
                                  Worktree_created ];
                            }
                          in
                          ignore (write_marker marker ~agent_home);
                          begin match
                            reproduce_source_entries ~source_workspace
                              ~worktree_path ~entries
                          with
                          | Error message -> fail_with_rollback message
                          | Ok () ->
                          let marker =
                            {
                              marker with
                              completed_steps =
                                [ Marker_recorded; Worktree_creation_started;
                                  Worktree_created; Source_reproduced ];
                            }
                          in
                          ignore (write_marker marker ~agent_home);
                          (match fingerprint_entries ~root:worktree_path entries with
                          | Error message -> fail_with_rollback message
                          | Ok reproduced when reproduced <> accepted_fingerprint ->
                              fail_with_rollback
                                "reproduced worktree does not match accepted source snapshot"
                          | Ok _ ->
                          match create_baseline ~worktree_path with
                          | Error message -> fail_with_rollback message
                          | Ok () -> (
                              match worktree_is_clean ~worktree_path with
                              | Error message -> fail_with_rollback message
                              | Ok () ->
                                  let marker =
                                    {
                                      marker with
                                      completed_steps =
                                        [
                                          Marker_recorded;
                                          Worktree_creation_started;
                                          Worktree_created;
                                          Source_reproduced;
                                          Baseline_created;
                                          Baseline_verified;
                                        ];
                                    }
                                  in
                                  ignore (write_marker marker ~agent_home);
                                  Ok (binding, derived, marker_path)))
                          end
                       with _ ->
                         fail_with_rollback "agent worktree provisioning failed")))
let accept_provisional ~owner_session_id ~agent_id ~binding =
  let agent_home = pi_agent_dir () in
  let owner_component = Taumel.Agent_workspace.owner_component owner_session_id in
  let path =
    Taumel.Agent_worktree.provisional_marker_path ~agent_home ~owner_component
      ~agent_id
  in
  match read_marker path with
  | Error _ when not (path_exists path) ->
      Error
        "workspace_unavailable: provisional marker missing before acceptance"
  | Error message -> Error ("workspace_unavailable: " ^ message)
  | Ok marker
    when not
           (Taumel.Agent_worktree.ready_for_acceptance marker.completed_steps) ->
      Error "workspace_unavailable: provisional worktree is not verified for acceptance"
  | Ok marker -> (
      match
        Taumel.Agent_workspace.derive ~agent_home ~owner_session_id ~agent_id binding
      with
      | Error message -> Error ("workspace_unavailable: " ^ message)
      | Ok derived
        when marker.owner_session_id <> owner_session_id
             || marker.agent_id <> agent_id
             || derived.main_repository_root <> marker.main_repository_root
             || derived.main_repository_id <> marker.main_repository_id
             || derived.worktree_path <> marker.worktree_path
             || derived.branch <> marker.branch ->
          Error "workspace_unavailable: provisional resources do not match the identity"
      | Ok _ -> (
      match
        verify_broker_registration ~worktree_path:marker.worktree_path
          ~main_repository_root:marker.main_repository_root ~branch:marker.branch
          ~main_repository_id:marker.main_repository_id
      with
      | Error message -> Error ("workspace_unavailable: " ^ message)
      | Ok _ ->
      try
        let marker =
          {
            marker with
            completed_steps =
              if
                List.mem Taumel.Agent_worktree.Identity_accepted
                  marker.completed_steps
              then marker.completed_steps
              else marker.completed_steps @ [ Identity_accepted ];
          }
        in
        ignore (write_marker marker ~agent_home);
        ignore (clear_marker ~agent_home ~owner_session_id ~agent_id);
        Ok ()
      with error ->
        Error
          ("workspace_unavailable: acceptance marker update failed: "
         ^ Printexc.to_string error)))
let rollback_failed_start ~owner_session_id ~agent_id ~main_repository_root
    ~main_repository_id ~worktree_path ~branch =
  let agent_home = pi_agent_dir () in
  let cleanup =
    try
      match
        rollback_provisional ~agent_home ~owner_session_id ~agent_id
          ~main_repository_root ~main_repository_id ~worktree_path ~branch
      with
      | Error _ as error -> error
      | Ok () -> clear_marker ~agent_home ~owner_session_id ~agent_id
    with error -> Error (Printexc.to_string error)
  in
  match cleanup with
  | Ok () -> Ok ()
  | Error _ ->
      let incident =
        Taumel.Agent_worktree.opaque_cleanup_incident_id ~owner_session_id
          ~agent_id ~now:(int_of_float (Unix.gettimeofday ()))
      in
      let owner_component = Taumel.Agent_workspace.owner_component owner_session_id in
      let marker_path =
        Taumel.Agent_worktree.provisional_marker_path ~agent_home ~owner_component
          ~agent_id
      in
      let marker =
        match read_marker marker_path with
        | Ok marker -> { marker with cleanup_incident_id = Some incident }
        | Error _ ->
            {
              Taumel.Agent_worktree.owner_session_id;
              agent_id;
              main_repository_root;
              main_repository_id;
              worktree_path;
              branch;
              completed_steps = [];
              cleanup_incident_id = Some incident;
            }
      in
      (try ignore (write_marker marker ~agent_home) with _ -> ());
      Error
        ( "cleanup_failed",
          "provisional worktree cleanup failed; incident " ^ incident )
let remove_worktree ~main_repository_root ~worktree_path ~main_repository_id
    ~branch =
  match
    authorize_cleanup ~main_repository_root ~main_repository_id ~worktree_path
      ~branch
  with
  | Error _ as error -> error
  | Ok () -> (
          match
            run_git ~cwd:main_repository_root
              [ "worktree"; "remove"; worktree_path ]
          with
          | Ok _ -> Ok ()
          | Error message -> Error message)
let list_provisional_marker_files ~agent_home =
  let root =
    Taumel.Agent_workspace.join_path
      [ agent_home; "taumel"; "worktrees"; ".provisional" ]
  in
  if not (path_exists root) then []
  else
    let fs = Lazy.force fs_mod in
    try
      let owners =
        Js.to_array
          (Unsafe.meth_call fs "readdirSync" [| js_string root |])
        |> Array.to_list
        |> List.filter_map string_value
      in
      List.concat_map
        (fun owner ->
          let owner_dir = Filename.concat root owner in
          if not (is_directory owner_dir) then []
          else
            try
              Js.to_array
                (Unsafe.meth_call fs "readdirSync" [| js_string owner_dir |])
              |> Array.to_list
              |> List.filter_map (fun name_js ->
                     match string_value name_js with
                     | Some name when Filename.check_suffix name ".json" ->
                         Some (Filename.concat owner_dir name)
                     | _ -> None)
            with _ -> [])
        owners
    with _ -> []
let reconcile_provisional_markers () =
  let agent_home = pi_agent_dir () in
  list_provisional_marker_files ~agent_home
  |> List.iter (fun marker_path ->
         match read_marker marker_path with
         | Error _ -> ignore (remove_path marker_path)
         | Ok marker ->
             if
               List.mem Taumel.Agent_worktree.Identity_accepted
                 marker.completed_steps
             then ignore (remove_path marker_path)
             else
               (* Unaccepted markers are deliberately retained. Automatic recovery
                  cannot reconstruct a stable source snapshot after process loss;
                  explicit rollback owns verified resource cleanup, while retained
                  markers keep conflicting creation fail-closed. *)
               ())
let effective_workspace_for_identity ~(identity : Taumel.Agents.identity) =
  let agent_home = pi_agent_dir () in
  match
    Taumel.Agent_workspace.derive ~agent_home
      ~owner_session_id:identity.identity_owner_session_id
      ~agent_id:identity.identity_agent_id identity.identity_workspace_binding
  with
  | Error message -> Error message
  | Ok derived -> (
      match derived.isolation with
      | Taumel.Agent_workspace.None ->
          Ok
            ( Taumel.Agent_workspace.effective_workspace_of_derived derived,
              derived )
      | Taumel.Agent_workspace.Worktree -> (
          match
            verify_broker_registration ~worktree_path:derived.worktree_path
              ~main_repository_root:derived.main_repository_root
              ~main_repository_id:derived.main_repository_id ~branch:derived.branch
          with
          | Error message -> Error message
          | Ok _git_dir ->
              Ok
                ( Taumel.Agent_workspace.effective_workspace_of_derived derived,
                  derived )))
