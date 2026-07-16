(* Trusted agent-worktree lifecycle planning: paths, markers, and auth payloads. *)

type lifecycle_op =
  | Provision
  | Broker
  | Cleanup

type creation_step =
  | Marker_recorded
  | Worktree_created
  | Source_reproduced
  | Baseline_created
  | Baseline_verified
  | Identity_accepted

type provisional_marker = {
  owner_session_id : string;
  agent_id : string;
  main_repository_root : string;
  main_repository_id : string;
  worktree_path : string;
  branch : string;
  completed_steps : creation_step list;
  cleanup_incident_id : string option;
}

type mutation_effect = {
  operation : lifecycle_op;
  main_repository_root : string;
  main_repository_id : string;
  worktree_path : string;
  worktree_admin_path : string;
  branch : string;
  branch_ref : string;
  object_store_path : string;
}

type authorization =
  | Authorized of mutation_effect
  | Denied of string

let lifecycle_op_to_string = function
  | Provision -> "provision"
  | Broker -> "broker"
  | Cleanup -> "cleanup"

let lifecycle_op_of_string = function
  | "provision" -> Ok Provision
  | "broker" -> Ok Broker
  | "cleanup" -> Ok Cleanup
  | value -> Error ("invalid agent worktree operation: " ^ value)

let creation_step_to_string = function
  | Marker_recorded -> "marker_recorded"
  | Worktree_created -> "worktree_created"
  | Source_reproduced -> "source_reproduced"
  | Baseline_created -> "baseline_created"
  | Baseline_verified -> "baseline_verified"
  | Identity_accepted -> "identity_accepted"

let creation_step_of_string = function
  | "marker_recorded" -> Ok Marker_recorded
  | "worktree_created" -> Ok Worktree_created
  | "source_reproduced" -> Ok Source_reproduced
  | "baseline_created" -> Ok Baseline_created
  | "baseline_verified" -> Ok Baseline_verified
  | "identity_accepted" -> Ok Identity_accepted
  | value -> Error ("invalid creation step: " ^ value)

let baseline_author_name = "Pi Baseline"
let baseline_author_email = "pi-baseline@local"
let baseline_committer_name = baseline_author_name
let baseline_committer_email = baseline_author_email

let worktree_admin_path ~worktree_path =
  let trimmed = String.trim worktree_path in
  if trimmed = "" then "" else trimmed ^ "/.git"

let branch_ref branch = "refs/heads/" ^ branch

let object_store_path ~main_repository_root =
  let root = String.trim main_repository_root in
  if root = "" then "" else root ^ "/.git/objects"

let provisional_marker_path ~agent_home ~owner_component ~agent_id =
  Agent_workspace.join_path
    [
      agent_home;
      "taumel";
      "worktrees";
      ".provisional";
      owner_component;
      agent_id ^ ".json";
    ]

let make_mutation_effect ~operation ~main_repository_root ~main_repository_id
    ~worktree_path ~branch =
  {
    operation;
    main_repository_root = String.trim main_repository_root;
    main_repository_id = String.trim main_repository_id;
    worktree_path = String.trim worktree_path;
    worktree_admin_path = worktree_admin_path ~worktree_path;
    branch = String.trim branch;
    branch_ref = branch_ref (String.trim branch);
    object_store_path = object_store_path ~main_repository_root;
  }

let authorize_mutation ~operation ~main_repository_root ~main_repository_id
    ~worktree_path ~branch ~trusted_adapter =
  if not trusted_adapter then
    Denied
      "agent_worktree_mutation is only available to the trusted worktree adapter"
  else if String.trim main_repository_root = "" then
    Denied "main repository root is required"
  else if String.trim main_repository_id = "" then
    Denied "main repository identity is required"
  else if String.trim worktree_path = "" then
    Denied "worktree path is required"
  else if String.trim branch = "" then
    Denied "dedicated branch is required"
  else
    Authorized
      (make_mutation_effect ~operation ~main_repository_root
         ~main_repository_id ~worktree_path ~branch)

let marker_to_json marker =
  Shared.Object
    [
      ("owner_session_id", Shared.String marker.owner_session_id);
      ("agent_id", Shared.String marker.agent_id);
      ("main_repository_root", Shared.String marker.main_repository_root);
      ("main_repository_id", Shared.String marker.main_repository_id);
      ("worktree_path", Shared.String marker.worktree_path);
      ("branch", Shared.String marker.branch);
      ( "completed_steps",
        Shared.Array
          (List.map
             (fun step -> Shared.String (creation_step_to_string step))
             marker.completed_steps) );
      ( "cleanup_incident_id",
        match marker.cleanup_incident_id with
        | None -> Shared.Null
        | Some value -> Shared.String value );
    ]

let marker_of_json = function
  | Shared.Object fields ->
      let ( let* ) = Result.bind in
      let* owner_session_id =
        Shared.json_required_string "" fields "owner_session_id"
      in
      let* agent_id = Shared.json_required_string "" fields "agent_id" in
      let* main_repository_root =
        Shared.json_required_string "" fields "main_repository_root"
      in
      let* main_repository_id =
        Shared.json_required_string "" fields "main_repository_id"
      in
      let* worktree_path =
        Shared.json_required_string "" fields "worktree_path"
      in
      let* branch = Shared.json_required_string "" fields "branch" in
      let* completed_steps =
        match List.assoc_opt "completed_steps" fields with
        | Some (Shared.Array values) ->
            let rec loop acc = function
              | [] -> Ok (List.rev acc)
              | Shared.String value :: rest -> (
                  match creation_step_of_string value with
                  | Ok step -> loop (step :: acc) rest
                  | Error _ as error -> error)
              | _ :: _ -> Error "completed_steps entries must be strings"
            in
            loop [] values
        | Some _ -> Error "completed_steps must be an array"
        | None -> Error "completed_steps is required"
      in
      let* cleanup_incident_id =
        match List.assoc_opt "cleanup_incident_id" fields with
        | None | Some Shared.Null -> Ok None
        | Some (Shared.String value) -> Ok (Some value)
        | Some _ -> Error "cleanup_incident_id must be a string or null"
      in
      Ok
        {
          owner_session_id;
          agent_id;
          main_repository_root;
          main_repository_id;
          worktree_path;
          branch;
          completed_steps;
          cleanup_incident_id;
        }
  | _ -> Error "provisional marker must be an object"

let marker_matches_resources (marker : provisional_marker) ~main_repository_root
    ~main_repository_id ~worktree_path ~branch =
  marker.main_repository_root = main_repository_root
  && marker.main_repository_id = main_repository_id
  && marker.worktree_path = worktree_path
  && marker.branch = branch

let opaque_cleanup_incident_id ~owner_session_id ~agent_id ~now =
  let digest =
    Digest.string
      ("cleanup-incident\000" ^ owner_session_id ^ "\000" ^ agent_id ^ "\000"
     ^ string_of_int now)
  in
  let hex =
    let length = String.length digest in
    let buffer = Buffer.create (length * 2) in
    for index = 0 to length - 1 do
      Printf.bprintf buffer "%02x" (Char.code digest.[index])
    done;
    Buffer.contents buffer
  in
  String.sub hex 0 (min 16 (String.length hex))

let workspace_unavailable_not_git =
  "workspace_unavailable: isolated agent worktree cannot be created because the project is not a Git repository"

let workspace_unavailable_no_head =
  "workspace_unavailable: isolated agent worktree cannot be created because the repository has no HEAD commit"

let workspace_unavailable_collision =
  "workspace_unavailable: isolated agent worktree cannot be created because the intended worktree path or branch already exists"

let workspace_unavailable_source_changed =
  "workspace_unavailable: isolated agent worktree cannot be created because the source workspace changed during capture"

let delete_worktree_on_none_message =
  "delete_worktree is only valid for worktree-isolated identities"
