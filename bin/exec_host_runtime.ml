open Jsoo_bridge

let exists candidate =
  candidate <> ""
  &&
  try Node_fs.exists_sync candidate with _ -> false

let canonical candidate =
  if not (exists candidate) then None
  else try Some (Node_fs.realpath_sync candidate) with _ -> None

let executable candidate =
  match canonical candidate with
  | None -> None
  | Some resolved -> (
      try
        Node_fs.access_sync resolved (Node_fs.x_ok ());
        Some resolved
      with _ -> None)

let path_candidates name =
  let value = Option.value (Node_process.env_get "PATH") ~default:"" in
  let delimiter =
    match Node_path.delimiter () with "" -> ":" | value -> value
  in
  if delimiter = "" then []
  else
    value |> String.split_on_char delimiter.[0]
    |> List.filter_map (fun directory ->
           if directory = "" then None
           else Some (Node_path.join [ directory; name ]))

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
  let metadata_path = Node_path.join [ root; metadata_dir ] in
  if not (exists metadata_path) then None
  else
    let children =
      try Some (Node_fs.readdir_sync metadata_path) with _ -> None
    in
    Some Taumel.Sandbox.{ metadata_dir; path = metadata_path; children }

let facts ~workspace_roots ~authorization_cwd =
  match resolve_shell () with
  | Error _ as error -> error
  | Ok shell ->
      let tmp_dir = Node_os.tmpdir () in
      let env_tmp_dir = Option.value (Node_process.env_get "TMPDIR") ~default:"" in
      let home =
        let home = try Node_os.homedir () with _ -> "" in
        Option.value (canonical home) ~default:home
      in
      let home_parent =
        if home = "" then "" else Node_path.dirname home
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
          Taumel.Sandbox.platform = Node_process.platform ();
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
