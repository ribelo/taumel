let split_path path =
  path |> String.split_on_char '/'
  |> List.filter (fun part -> part <> "" && part <> ".")

let normalize_path path =
  let absolute = String.length path > 0 && path.[0] = '/' in
  let rec loop acc = function
    | [] -> List.rev acc
    | ".." :: rest -> (
        match acc with
        | [] -> loop acc rest
        | _ :: acc -> loop acc rest)
    | part :: rest -> loop (part :: acc) rest
  in
  let parts = loop [] (split_path path) in
  (if absolute then "/" else "") ^ String.concat "/" parts

let path_within ~root path =
  let root = normalize_path root in
  let path = normalize_path path in
  path = root
  || (String.length path > String.length root
     && String.sub path 0 (String.length root) = root
     && path.[String.length root] = '/')

let protected_workspace_dir_names = [ ".git"; ".hg"; ".svn" ]

let join_path parent child =
  if parent = "" then child
  else if String.ends_with ~suffix:"/" parent then parent ^ child
  else parent ^ "/" ^ child

let is_absolute_path path = String.length path > 0 && path.[0] = '/'

let path_starts_with_dir ~dir path =
  let dir = normalize_path dir in
  let path = normalize_path path in
  path = dir
  || (String.length path > String.length dir
     && String.sub path 0 (String.length dir) = dir
     && path.[String.length dir] = '/')
