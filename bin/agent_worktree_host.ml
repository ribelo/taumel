open Jsoo_bridge

(* Trusted host adapter for agent-worktree provision, broker verification, and cleanup. *)

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

let trusted_git_env ?git_dir ?git_work_tree extra =
  let process_env = Unsafe.get (Unsafe.get Unsafe.global "process") "env" in
  let base =
    [
      ("PATH", Unsafe.get process_env "PATH");
      ("HOME", Unsafe.get process_env "HOME");
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
  let base =
    match git_dir with
    | Some value when value <> "" -> ("GIT_DIR", js_string value) :: base
    | _ -> base
  in
  let base =
    match git_work_tree with
    | Some value when value <> "" -> ("GIT_WORK_TREE", js_string value) :: base
    | _ -> base
  in
  Unsafe.obj (Array.of_list (base @ extra))

let run_git ~cwd ?git_dir ?git_work_tree args =
  let child_process = Lazy.force child_process_mod in
  try
    let stdout =
      Unsafe.meth_call child_process "execFileSync"
        [|
          js_string "git";
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
    Ok (String.trim (Js.to_string stdout))
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

let remove_path path =
  let fs = Lazy.force fs_mod in
  try
    ignore
      (Unsafe.meth_call fs "rmSync"
         [|
           js_string path;
           Unsafe.obj
             [| ("recursive", js_bool true); ("force", js_bool true) |];
         |]);
    Ok ()
  with error -> Error (Printexc.to_string error)

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
                  let main_repository_id =
                    match
                      run_git ~cwd:source_workspace
                        [ "rev-parse"; "--path-format=absolute"; "--git-dir" ]
                    with
                    | Ok git_dir -> git_dir ^ "\000" ^ head
                    | Error _ -> head
                  in
                  Ok
                    ( toplevel,
                      main_repository_root,
                      main_repository_id,
                      head ))))

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
  (* Index-versus-HEAD captures staged-only changes; worktree flags capture
     unstaged modifications/deletions; -o captures untracked non-ignored files. *)
  let* cached =
    run_git ~cwd:source_workspace
      [ "diff"; "--cached"; "--name-only"; "-z"; "HEAD" ]
  in
  let* worktree =
    run_git ~cwd:source_workspace
      [ "ls-files"; "-z"; "-m"; "-d"; "--exclude-standard" ]
  in
  let* untracked =
    run_git ~cwd:source_workspace
      [ "ls-files"; "-z"; "-o"; "--exclude-standard" ]
  in
  let paths =
    nul_paths cached @ nul_paths worktree @ nul_paths untracked
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
  let* entries = list_source_entries ~source_workspace in
  let* first = fingerprint_entries ~root:source_workspace entries in
  let* second = fingerprint_entries ~root:source_workspace entries in
  if first <> second then
    Error Taumel.Agent_worktree.workspace_unavailable_source_changed
  else Ok (entries, second)

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
  ignore (remove_path path)

let path_or_branch_exists ~main_repository_root ~worktree_path ~branch =
  let path_exists = path_exists worktree_path in
  let branch_exists =
    match
      run_git ~cwd:main_repository_root
        [ "show-ref"; "--verify"; "--quiet"; "refs/heads/" ^ branch ]
    with
    | Ok _ -> true
    | Error _ -> false
  in
  path_exists || branch_exists

let create_worktree ~source_workspace ~main_repository_root ~worktree_path ~branch
    ~head ~entries =
  mkdir_p (Filename.dirname worktree_path);
  match
    run_git ~cwd:main_repository_root
      [ "worktree"; "add"; "-b"; branch; worktree_path; head ]
  with
  | Error message -> Error message
  | Ok _ ->
      let files = entries in
      match Ok files with
      | Error message -> Error message
      | Ok files ->
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
          copy files

let create_baseline ~worktree_path =
  let child_process = Lazy.force child_process_mod in
  let run args =
    try
      ignore
        (Unsafe.meth_call child_process "execFileSync"
           [|
             js_string "git";
             js_array (List.map js_string args);
             Unsafe.obj
               [|
                 ("cwd", js_string worktree_path);
                 ("encoding", js_string "utf8");
                 ( "env",
                   trusted_git_env
                     [
                       ( "GIT_AUTHOR_NAME",
                         js_string Taumel.Agent_worktree.baseline_author_name );
                       ( "GIT_AUTHOR_EMAIL",
                         js_string Taumel.Agent_worktree.baseline_author_email );
                       ( "GIT_COMMITTER_NAME",
                         js_string Taumel.Agent_worktree.baseline_committer_name );
                       ( "GIT_COMMITTER_EMAIL",
                         js_string Taumel.Agent_worktree.baseline_committer_email );
                     ] );
                 ( "stdio",
                   js_array
                     [ js_string "ignore"; js_string "pipe"; js_string "pipe" ] );
               |];
           |]);
      Ok ()
    with error -> Error (Printexc.to_string error)
  in
  match run [ "add"; "-A" ] with
  | Error message -> Error message
  | Ok () -> (
      match
        run
          [
            "-c";
            "user.useConfigOnly=true";
            "commit";
            "--allow-empty";
            "-m";
            "pi agent baseline";
          ]
      with
      | Error message -> Error message
      | Ok () -> Ok ())

let rollback_provisional ~main_repository_root ~worktree_path ~branch =
  ignore (run_git ~cwd:main_repository_root [ "worktree"; "remove"; "--force"; worktree_path ]);
  ignore (remove_path worktree_path);
  ignore
    (run_git ~cwd:main_repository_root
       [ "branch"; "-D"; branch ])

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
        [ "status"; "--porcelain=v1"; "--untracked-files=normal" ]
    with
    | Error message -> Error message
    | Ok output when String.trim output <> "" ->
        Error "agent worktree has uncommitted changes"
    | Ok _ -> (
        match
          run_git ~cwd:worktree_path
            [ "submodule"; "status"; "--recursive" ]
        with
        | Error _ -> Ok ()
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

let provision ~owner_session_id ~agent_id ~source_workspace =
  let agent_home = pi_agent_dir () in
  match resolve_repository source_workspace with
  | Error _ as error -> error
  | Ok (_toplevel, main_repository_root, main_repository_id, head) -> (
      let binding =
        Taumel.Agent_workspace.worktree ~source_origin:source_workspace
          ~main_repository_root ~main_repository_id
      in
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
          let existing_marker =
            if path_exists marker_path then
              match read_marker marker_path with Ok marker -> Some marker | _ -> None
            else None
          in
          let marker_matches =
            match existing_marker with
            | None -> false
            | Some marker ->
                Taumel.Agent_worktree.marker_matches_resources marker
                  ~main_repository_root ~main_repository_id ~worktree_path
                  ~branch
          in
          if
            path_or_branch_exists ~main_repository_root ~worktree_path ~branch
            && not marker_matches
          then
            Error
              ( "workspace_unavailable",
                Taumel.Agent_worktree.workspace_unavailable_collision )
          else
            let auth =
              Taumel.Agent_worktree.authorize_mutation ~operation:Provision
                ~main_repository_root ~main_repository_id ~worktree_path ~branch
                ~trusted_adapter:true
            in
            match auth with
            | Denied message -> Error ("workspace_unavailable", message)
            | Authorized auth_effect -> (
                let sandbox_effect =
                  {
                    Taumel.Sandbox.operation = Taumel.Sandbox.Agent_worktree_provision;
                    main_repository_root = auth_effect.main_repository_root;
                    main_repository_id = auth_effect.main_repository_id;
                    worktree_path = auth_effect.worktree_path;
                    worktree_admin_path = auth_effect.worktree_admin_path;
                    branch = auth_effect.branch;
                    branch_ref = auth_effect.branch_ref;
                    object_store_path = auth_effect.object_store_path;
                  }
                in
                match
                  Taumel.Sandbox.authorize_agent_worktree_mutation
                    ~trusted_adapter:true sandbox_effect
                with
                | Taumel.Sandbox.Deny message ->
                    Error ("workspace_unavailable", message)
                | Taumel.Sandbox.Requires_approval message ->
                    Error ("workspace_unavailable", message)
                | Taumel.Sandbox.Allow ->
                (* Double-fingerprint the source before mutation; the second matching
                   fingerprint is the accepted source snapshot point (agent-ne9r/y6kl). *)
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
                          completed_steps = [ Marker_recorded ];
                          cleanup_incident_id = None;
                        }
                      in
                      ignore (write_marker marker ~agent_home);
                      match
                        create_worktree ~source_workspace ~main_repository_root
                          ~worktree_path ~branch ~head ~entries
                      with
                      | Error message ->
                          rollback_provisional ~main_repository_root ~worktree_path
                            ~branch;
                          clear_marker ~agent_home ~owner_session_id ~agent_id;
                          Error ("workspace_unavailable", message)
                      | Ok () ->
                          let marker =
                            {
                              marker with
                              completed_steps =
                                [
                                  Marker_recorded;
                                  Worktree_created;
                                  Source_reproduced;
                                ];
                            }
                          in
                          ignore (write_marker marker ~agent_home);
                          (match fingerprint_entries ~root:worktree_path entries with
                          | Error message ->
                              rollback_provisional ~main_repository_root
                                ~worktree_path ~branch;
                              clear_marker ~agent_home ~owner_session_id ~agent_id;
                              Error ("workspace_unavailable", message)
                          | Ok reproduced when reproduced <> accepted_fingerprint ->
                              rollback_provisional ~main_repository_root
                                ~worktree_path ~branch;
                              clear_marker ~agent_home ~owner_session_id ~agent_id;
                              Error
                                ( "workspace_unavailable",
                                  "reproduced worktree does not match accepted source snapshot" )
                          | Ok _ ->
                          match create_baseline ~worktree_path with
                          | Error message ->
                              rollback_provisional ~main_repository_root
                                ~worktree_path ~branch;
                              clear_marker ~agent_home ~owner_session_id ~agent_id;
                              Error ("workspace_unavailable", message)
                          | Ok () -> (
                              match worktree_is_clean ~worktree_path with
                              | Error message ->
                                  rollback_provisional ~main_repository_root
                                    ~worktree_path ~branch;
                                  clear_marker ~agent_home ~owner_session_id
                                    ~agent_id;
                                  Error ("workspace_unavailable", message)
                              | Ok () ->
                                  let marker =
                                    {
                                      marker with
                                      completed_steps =
                                        [
                                          Marker_recorded;
                                          Worktree_created;
                                          Source_reproduced;
                                          Baseline_created;
                                          Baseline_verified;
                                        ];
                                    }
                                  in
                                  ignore (write_marker marker ~agent_home);
                                  Ok (binding, derived, marker_path))))))

let accept_provisional ~owner_session_id ~agent_id =
  let agent_home = pi_agent_dir () in
  let owner_component = Taumel.Agent_workspace.owner_component owner_session_id in
  let path =
    Taumel.Agent_worktree.provisional_marker_path ~agent_home ~owner_component
      ~agent_id
  in
  match read_marker path with
  | Error _ when not (path_exists path) -> Ok ()
  | Error message -> Error ("workspace_unavailable: " ^ message)
  | Ok marker -> (
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
        clear_marker ~agent_home ~owner_session_id ~agent_id;
        if path_exists path then
          Error
            "workspace_unavailable: failed to clear provisional marker after acceptance"
        else Ok ()
      with error ->
        Error
          ("workspace_unavailable: acceptance marker update failed: "
         ^ Printexc.to_string error))

let rollback_failed_start ~owner_session_id ~agent_id ~main_repository_root
    ~worktree_path ~branch =
  let agent_home = pi_agent_dir () in
  (try rollback_provisional ~main_repository_root ~worktree_path ~branch
   with _ -> ());
  let still_present =
    path_exists worktree_path
    ||
    match
      run_git ~cwd:main_repository_root
        [ "show-ref"; "--verify"; "--quiet"; "refs/heads/" ^ branch ]
    with
    | Ok _ -> true
    | Error _ -> false
  in
  if still_present then (
    let incident =
      Taumel.Agent_worktree.opaque_cleanup_incident_id ~owner_session_id
        ~agent_id ~now:(int_of_float (Unix.gettimeofday ()))
    in
    let marker =
      {
        Taumel.Agent_worktree.owner_session_id;
        agent_id;
        main_repository_root;
        main_repository_id = "";
        worktree_path;
        branch;
        completed_steps = [];
        cleanup_incident_id = Some incident;
      }
    in
    ignore (write_marker marker ~agent_home);
    Error
      ( "cleanup_failed",
        "provisional worktree cleanup failed; incident " ^ incident ))
  else (
    clear_marker ~agent_home ~owner_session_id ~agent_id;
    Ok ())

let remove_worktree ~main_repository_root ~worktree_path ~main_repository_id
    ~branch =
  let auth =
    Taumel.Agent_worktree.authorize_mutation ~operation:Cleanup
      ~main_repository_root ~main_repository_id ~worktree_path ~branch
      ~trusted_adapter:true
  in
  match auth with
  | Denied message -> Error message
  | Authorized auth_effect -> (
      match
        Taumel.Sandbox.authorize_agent_worktree_mutation ~trusted_adapter:true
          {
            Taumel.Sandbox.operation = Taumel.Sandbox.Agent_worktree_cleanup;
            main_repository_root = auth_effect.main_repository_root;
            main_repository_id = auth_effect.main_repository_id;
            worktree_path = auth_effect.worktree_path;
            worktree_admin_path = auth_effect.worktree_admin_path;
            branch = auth_effect.branch;
            branch_ref = auth_effect.branch_ref;
            object_store_path = auth_effect.object_store_path;
          }
      with
      | Taumel.Sandbox.Deny message | Taumel.Sandbox.Requires_approval message ->
          Error message
      | Taumel.Sandbox.Allow -> (
          match
            run_git ~cwd:main_repository_root
              [ "worktree"; "remove"; worktree_path ]
          with
          | Ok _ -> Ok ()
          | Error message -> Error message))

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
  |> List.iter (fun path ->
         match read_marker path with
         | Error _ -> ignore (remove_path path)
         | Ok marker ->
             let matches =
               Taumel.Agent_worktree.marker_matches_resources marker
                 ~main_repository_root:marker.main_repository_root
                 ~main_repository_id:marker.main_repository_id
                 ~worktree_path:marker.worktree_path ~branch:marker.branch
             in
             let accepted =
               List.mem Taumel.Agent_worktree.Identity_accepted
                 marker.completed_steps
             in
             if accepted then
               (* Acceptance completed but marker clear failed: drop only the
                  marker so we never reclaim a durable accepted worktree. *)
               ignore (remove_path path)
             else if not matches then ()
             else (
               rollback_provisional
                 ~main_repository_root:marker.main_repository_root
                 ~worktree_path:marker.worktree_path ~branch:marker.branch;
               ignore (remove_path path)))

let preflight_broker_add ~worktree_path argv =
  let ( let* ) = Result.bind in
  let has_all = List.mem "--all" argv in
  let pathspecs =
    let rec after_sep = function
      | [] -> []
      | "--" :: rest -> rest
      | _ :: rest -> after_sep rest
    in
    after_sep argv
  in
  let* expanded =
    if has_all then
      run_git ~cwd:worktree_path
        [ "ls-files"; "-z"; "-c"; "-o"; "--exclude-standard" ]
      |> Result.map nul_paths
    else if pathspecs = [] then
      Error "brokered git add requires --all or pathspecs after --"
    else
      run_git ~cwd:worktree_path ("ls-files" :: "-z" :: "-c" :: "-o" :: "--exclude-standard" :: "--" :: pathspecs)
      |> Result.map nul_paths
  in
  let has_sub haystack needle =
    let h = String.length haystack in
    let n = String.length needle in
    let rec loop i = i + n <= h && (String.sub haystack i n = needle || loop (i + 1)) in
    n = 0 || loop 0
  in
  let rec check = function
    | [] -> Ok ()
    | relative :: rest ->
        if path_exists (Filename.concat (Filename.concat worktree_path relative) ".git")
        then Error ("brokered git add rejects nested repository: " ^ relative)
        else
          match run_git ~cwd:worktree_path [ "ls-files"; "-s"; "--"; relative ] with
          | Error message -> Error message
          | Ok output when String.length output >= 6 && String.sub output 0 6 = "160000" ->
              Error ("brokered git add rejects gitlink: " ^ relative)
          | Ok _ -> (
              match run_git ~cwd:worktree_path [ "check-attr"; "-a"; "--"; relative ] with
              | Error message -> Error message
              | Ok attrs ->
                  let lowered = String.lowercase_ascii attrs in
                  if
                    (has_sub lowered "filter:" && not (has_sub lowered "filter: unspecified"))
                    || (has_sub lowered "clean:" && not (has_sub lowered "clean: unspecified"))
                    || (has_sub lowered "process:" && not (has_sub lowered "process: unspecified"))
                  then Error ("brokered git add rejects executable filter: " ^ relative)
                  else check rest)
  in
  check expanded

let verify_broker_registration ~worktree_path ~main_repository_root ~branch =
  if not (is_directory worktree_path) then
    Error "agent worktree path is unavailable"
  else
    match run_git ~cwd:worktree_path [ "rev-parse"; "--show-toplevel" ] with
    | Error message -> Error message
    | Ok toplevel when toplevel <> worktree_path ->
        Error "agent worktree registration does not match the worktree path"
    | Ok _ -> (
        match
          run_git ~cwd:worktree_path
            [ "rev-parse"; "--path-format=absolute"; "--git-common-dir" ]
        with
        | Error message -> Error message
        | Ok common_dir ->
            let expected_root =
              if Filename.basename common_dir = ".git" then Filename.dirname common_dir
              else main_repository_root
            in
            if expected_root <> main_repository_root
               && common_dir <> main_repository_root ^ "/.git"
            then Error "agent worktree is not registered to the expected repository"
            else
              match run_git ~cwd:worktree_path [ "rev-parse"; "--abbrev-ref"; "HEAD" ] with
              | Error message -> Error message
              | Ok current when current <> branch ->
                  Error "agent worktree is not checked out on its dedicated branch"
              | Ok _ -> (
                  match
                    run_git ~cwd:worktree_path
                      [ "rev-parse"; "--path-format=absolute"; "--git-dir" ]
                  with
                  | Error message -> Error message
                  | Ok git_dir -> Ok git_dir))

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
              ~branch:derived.branch
          with
          | Error message -> Error message
          | Ok _git_dir ->
              Ok
                ( Taumel.Agent_workspace.effective_workspace_of_derived derived,
                  derived )))

let identity_metadata ~(identity : Taumel.Agents.identity) ?child_session_file () =
  let source = Taumel.Agents.identity_source_workspace identity in
  let isolation =
    Taumel.Agent_workspace.isolation_to_string
      (Taumel.Agents.identity_isolation identity)
  in
  let effective, derived =
    match effective_workspace_for_identity ~identity with
    | Ok (path, derived) -> (path, Some derived)
    | Error _ ->
        match identity.identity_workspace_binding with
        | Taumel.Agent_workspace.Shared { source_root } -> (source_root, None)
        | Taumel.Agent_workspace.Worktree _ -> ("", None)
  in
  let fields =
    [
      ("kind", Taumel.Shared.String "agent");
      ( "agentKind",
        Taumel.Shared.String
          (Taumel.Agents.agent_kind_to_string identity.identity_kind) );
      ("agentId", Taumel.Shared.String identity.identity_agent_id);
      ("modelId", Taumel.Shared.String identity.identity_model);
      ("thinkingLevel", Taumel.Shared.String identity.identity_thinking);
      ( "activeTools",
        Taumel.Shared.Array
          (List.map
             (fun value -> Taumel.Shared.String value)
             identity.identity_active_tools) );
      ( "capabilityProfile",
        Taumel.Capability_profile.to_json identity.identity_permission_ceiling );
      ( "networkMode",
        Taumel.Shared.String
          (if identity.identity_network_allowed then "enabled" else "disabled") );
      ("isolated_child", Taumel.Shared.Bool true);
      ("workspaceDirectory", Taumel.Shared.String effective);
      ("sourceWorkspace", Taumel.Shared.String source);
      ("isolation", Taumel.Shared.String isolation);
      ( "workspaceBinding",
        Taumel.Agent_workspace.binding_to_json identity.identity_workspace_binding );
    ]
  in
  let fields =
    match derived with
    | Some derived when derived.isolation = Taumel.Agent_workspace.Worktree ->
        fields
        @ [
            ("worktreePath", Taumel.Shared.String derived.worktree_path);
            ("worktreeBranch", Taumel.Shared.String derived.branch);
            ( "mainRepositoryRoot",
              Taumel.Shared.String derived.main_repository_root );
          ]
    | _ -> fields
  in
  let fields =
    match child_session_file with
    | Some value -> fields @ [ ("childSessionFile", Taumel.Shared.String value) ]
    | None -> fields
  in
  Taumel.Shared.Object fields
