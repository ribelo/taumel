open Sandbox_types
open Sandbox_paths

let unique_strings values =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | value :: rest ->
        if value = "" || List.mem value seen then loop seen acc rest
        else loop (value :: seen) (value :: acc) rest
  in
  loop [] [] values

let system_ro_path_candidates =
  [ "/nix"; "/bin"; "/sbin"; "/etc"; "/run/current-system"; "/lib64"; "/usr"; "/lib" ]

let temp_root_candidates ~tmp_dir ~env_tmp_dir =
  unique_strings [ tmp_dir; "/tmp"; env_tmp_dir ]

let protected_workspace_listing_paths listing =
  if not (List.mem listing.metadata_dir protected_workspace_dir_names) then []
  else
    match listing.children with
    | None -> [ listing.path ]
    | Some children ->
        children
        |> List.filter (fun child ->
               not (listing.metadata_dir = ".git" && child = "hooks"))
        |> List.map (join_path listing.path)

let protected_workspace_children host =
  host.workspace_metadata_listings
  |> List.concat_map protected_workspace_listing_paths

let bind_pair flag path = [ flag; path; path ]

let strict_child_path ~root path =
  let root = normalize_path root in
  let path = normalize_path path in
  String.length path > String.length root
  && String.sub path 0 (String.length root) = root
  && path.[String.length root] = '/'

let plan_exec_invocation config host ~shell ~shell_args ~force_unsandboxed =
  if force_unsandboxed || config.no_sandbox then
    Ok { command = shell; args = shell_args; sandboxed = false }
  else if
    config.filesystem_mode = Danger_full_access
    && config.network_mode = Network_enabled
  then Ok { command = shell; args = shell_args; sandboxed = false }
  else if host.platform <> "linux" then
    Error
      "sandboxed execution is only supported on Linux; use /permissions to change sandbox mode"
  else
    let args =
      [
        "--new-session";
        "--die-with-parent";
        "--unshare-user";
        "--unshare-pid";
        "--unshare-ipc";
      ]
    in
    let args =
      match config.filesystem_mode with
      | Workspace_write ->
          args @ List.concat_map (bind_pair "--bind") host.temp_roots
      | Read_only | Danger_full_access -> args @ [ "--tmpfs"; "/tmp" ]
    in
    let args = args @ [ "--tmpfs"; "/run" ] in
    let args =
      args @ List.concat_map (bind_pair "--ro-bind") host.system_ro_paths
    in
    let args =
      if host.home_mount = "" then args
      else args @ bind_pair "--ro-bind" host.home_mount
    in
    let args =
      match config.filesystem_mode with
      | Workspace_write ->
          args
          @ List.concat_map (bind_pair "--bind") host.workspace_roots
          @ List.concat_map
              (bind_pair "--ro-bind")
              (protected_workspace_children host)
      | Read_only ->
          args
          @ (host.workspace_roots
            |> List.filter (fun root ->
                   host.home_mount = ""
                   || not (strict_child_path ~root:host.home_mount root))
            |> List.concat_map (bind_pair "--ro-bind"))
      | Danger_full_access -> args @ bind_pair "--bind" "/"
    in
    let args =
      match config.network_mode with
      | Network_enabled -> args
      | Network_disabled -> args @ [ "--unshare-net" ]
    in
    let args = args @ [ "--dev"; "/dev"; "--proc"; "/proc" ] in
    Ok { command = "bwrap"; args = args @ ("--" :: shell :: shell_args); sandboxed = true }

let exec_shell_args ~cmd = [ "-c"; cmd ]

let plan_exec_host_call config host (options : exec_host_options)
    ~force_unsandboxed =
  let shell_args = exec_shell_args ~cmd:options.cmd in
  plan_exec_invocation config host ~shell:options.shell ~shell_args
    ~force_unsandboxed
  |> Result.map (fun invocation ->
         {
           invocation;
           cwd = options.cwd;
           timeout_ms = options.timeout_ms;
           yield_time_ms = options.yield_time_ms;
           tty = options.tty;
           escalated = force_unsandboxed;
         })
