open Jsoo_bridge

let fs =
  lazy
    (let process = Unsafe.get Unsafe.global "process" in
     match function_field process "getBuiltinModule" with
     | Some get_builtin -> Unsafe.fun_call get_builtin [| js_string "node:fs" |]
     | None ->
         Unsafe.fun_call (Unsafe.get Unsafe.global "require")
           [| js_string "node:fs" |])

let repository_identity path =
  try
    let real =
      Js.to_string (Unsafe.meth_call (Lazy.force fs) "realpathSync" [| js_string path |])
    in
    let stat =
      Unsafe.meth_call (Lazy.force fs) "statSync"
        [| js_string real; Unsafe.obj [| ("bigint", js_bool true) |] |]
    in
    let field name =
      Js.to_string (Unsafe.meth_call (Unsafe.get stat name) "toString" [||])
    in
    Ok (real ^ "\000" ^ field "dev" ^ ":" ^ field "ino")
  with error -> Error (Printexc.to_string error)

let verify_repository_identity ~run_git ~main_repository_root
    ~main_repository_id =
  match
    run_git ~cwd:main_repository_root
      [ "rev-parse"; "--path-format=absolute"; "--git-common-dir" ]
  with
  | Error message -> Error message
  | Ok common_dir -> (
      match repository_identity common_dir with
      | Ok actual when actual = main_repository_id -> Ok ()
      | Ok _ -> Error "main repository identity changed"
      | Error message -> Error message)

let verify_registration ~is_directory ~run_git ~repository_identity
    ~worktree_path ~main_repository_root ~main_repository_id ~branch =
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
            (match repository_identity common_dir with
            | Error message -> Error message
            | Ok actual_id when actual_id <> main_repository_id ->
                Error "agent worktree repository identity changed"
            | Ok _ ->
              match
                run_git ~cwd:worktree_path
                  [ "rev-parse"; "--abbrev-ref"; "HEAD" ]
              with
              | Error message -> Error message
              | Ok current when current <> branch ->
                  Error
                    "agent worktree is not checked out on its dedicated branch"
              | Ok _ ->
                  run_git ~cwd:worktree_path
                    [ "rev-parse"; "--path-format=absolute"; "--git-dir" ]))
