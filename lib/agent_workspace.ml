(* Immutable workspace bindings and deterministic agent-worktree derivation. *)

type isolation =
  | None
  | Worktree

type workspace_binding =
  | Shared of { source_root : string }
  | Worktree of {
      source_origin : string;
      main_repository_root : string;
      main_repository_id : string;
    }

type derived_worktree = {
  isolation : isolation;
  source_workspace : string;
  main_repository_root : string;
  main_repository_id : string;
  project_name : string;
  owner_component : string;
  agent_id : string;
  worktree_path : string;
  branch : string;
}

type resolved_workspace =
  | Resolved_shared of { root : string }
  | Resolved_worktree of {
      source_origin : string;
      main_repository_root : string;
      main_repository_id : string;
      worktree_path : string;
      branch : string;
    }

let default_isolation = None

let isolation_to_string = function
  | None -> "none"
  | Worktree -> "worktree"

let isolation_of_string = function
  | "none" -> Ok None
  | "worktree" -> Ok Worktree
  | value -> Error ("invalid agent isolation: " ^ value)

let shared ~source_root =
  let source_root = String.trim source_root in
  Shared { source_root }

let worktree ~source_origin ~main_repository_root ~main_repository_id =
  Worktree
    {
      source_origin = String.trim source_origin;
      main_repository_root = String.trim main_repository_root;
      main_repository_id = String.trim main_repository_id;
    }

let isolation_of_binding = function
  | Shared _ -> None
  | Worktree _ -> Worktree

let source_workspace = function
  | Shared { source_root } -> source_root
  | Worktree { source_origin; _ } -> source_origin

let trim_trailing_slashes path =
  let length = String.length path in
  let rec loop index =
    if index <= 1 then index
    else if path.[index - 1] = '/' then loop (index - 1)
    else index
  in
  let end_index = loop length in
  if end_index = length then path else String.sub path 0 end_index

let basename path =
  let path = trim_trailing_slashes (String.trim path) in
  match String.rindex_opt path '/' with
  | None -> path
  | Some index when index = String.length path - 1 -> path
  | Some index ->
      String.sub path (index + 1) (String.length path - index - 1)

let project_name_of_repository_root root =
  let name = basename root in
  if name = "" || name = "/" then "repository" else name

let hex_of_bytes bytes =
  let length = String.length bytes in
  let buffer = Buffer.create (length * 2) in
  for index = 0 to length - 1 do
    Printf.bprintf buffer "%02x" (Char.code bytes.[index])
  done;
  Buffer.contents buffer

(* Digest.string is MD5; that is fine for a non-reversible filesystem component.
   Keep the public form short and path-safe. *)
let owner_component owner_session_id =
  let digest = Digest.string ("taumel-owner\000" ^ owner_session_id) in
  hex_of_bytes digest

let branch_component owner_session_id agent_id =
  let digest =
    Digest.string ("taumel-branch\000" ^ owner_session_id ^ "\000" ^ agent_id)
  in
  hex_of_bytes digest

let join_path parts =
  let parts =
    List.filter_map
      (fun part ->
        let part = String.trim part in
        if part = "" then None else Some (trim_trailing_slashes part))
      parts
  in
  match parts with
  | [] -> ""
  | first :: rest ->
      List.fold_left
        (fun acc part ->
          if acc = "/" then "/" ^ part
          else if String.length part > 0 && part.[0] = '/' then acc ^ part
          else acc ^ "/" ^ part)
        first rest

let derive ~agent_home ~owner_session_id ~agent_id binding =
  let owner_session_id = String.trim owner_session_id in
  let agent_id = String.trim agent_id in
  let agent_home = String.trim agent_home in
  if owner_session_id = "" then Error "owner session id is required"
  else if agent_id = "" then Error "agent id is required"
  else if agent_home = "" then Error "agent home is required"
  else
    match binding with
    | Shared { source_root } ->
        if source_root = "" then Error "source workspace is required"
        else
          Ok
            {
              isolation = None;
              source_workspace = source_root;
              main_repository_root = source_root;
              main_repository_id = "";
              project_name = project_name_of_repository_root source_root;
              owner_component = owner_component owner_session_id;
              agent_id;
              worktree_path = source_root;
              branch = "";
            }
    | Worktree
        { source_origin; main_repository_root; main_repository_id } ->
        if source_origin = "" then Error "source origin is required"
        else if main_repository_root = "" then
          Error "main repository root is required"
        else if main_repository_id = "" then
          Error "main repository identity is required"
        else
          let project_name =
            project_name_of_repository_root main_repository_root
          in
          let owner_component = owner_component owner_session_id in
          let worktree_path =
            join_path
              [
                agent_home;
                "taumel";
                "worktrees";
                project_name;
                owner_component;
                agent_id;
              ]
          in
          let branch =
            "taumel/agent/" ^ project_name ^ "/" ^ owner_component ^ "/"
            ^ agent_id ^ "/"
            ^ branch_component owner_session_id agent_id
          in
          Ok
            {
              isolation = Worktree;
              source_workspace = source_origin;
              main_repository_root;
              main_repository_id;
              project_name;
              owner_component;
              agent_id;
              worktree_path;
              branch;
            }

let effective_workspace binding =
  match binding with
  | Shared { source_root } when source_root <> "" -> Ok source_root
  | Shared _ -> Error "source workspace is required"
  | Worktree _ ->
      Error "worktree effective path requires derive with owner and agent id"

let effective_workspace_of_derived derived =
  match derived.isolation with
  | None -> derived.source_workspace
  | Worktree -> derived.worktree_path

let binding_to_json = function
  | Shared { source_root } ->
      Shared.Object
        [
          ("variant", Shared.String "shared");
          ("source_root", Shared.String source_root);
        ]
  | Worktree { source_origin; main_repository_root; main_repository_id } ->
      Shared.Object
        [
          ("variant", Shared.String "worktree");
          ("source_origin", Shared.String source_origin);
          ("main_repository_root", Shared.String main_repository_root);
          ("main_repository_id", Shared.String main_repository_id);
        ]

let binding_of_json = function
  | Shared.Object fields -> (
      let ( let* ) = Result.bind in
      match Shared.json_required_string "" fields "variant" with
      | Error _ as error -> error
      | Ok "shared" ->
          let* source_root =
            Shared.json_required_string "" fields "source_root"
          in
          if String.trim source_root = "" then
            Error "shared binding source_root is required"
          else Ok (shared ~source_root)
      | Ok "worktree" ->
          let* source_origin =
            Shared.json_required_string "" fields "source_origin"
          in
          let* main_repository_root =
            Shared.json_required_string "" fields "main_repository_root"
          in
          let* main_repository_id =
            Shared.json_required_string "" fields "main_repository_id"
          in
          if String.trim source_origin = "" then
            Error "worktree binding source_origin is required"
          else if String.trim main_repository_root = "" then
            Error "worktree binding main_repository_root is required"
          else if String.trim main_repository_id = "" then
            Error "worktree binding main_repository_id is required"
          else
            Ok
              (worktree ~source_origin ~main_repository_root
                 ~main_repository_id)
      | Ok value -> Error ("unknown workspace binding variant: " ^ value))
  | _ -> Error "workspace binding must be an object"

let resolved_root = function
  | Resolved_shared { root } -> root
  | Resolved_worktree { worktree_path; _ } -> worktree_path

let resolved_isolation = function
  | Resolved_shared _ -> None
  | Resolved_worktree _ -> Worktree
