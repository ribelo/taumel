type creation_step = Marker_recorded | Worktree_creation_started | Worktree_created | Source_reproduced | Baseline_created | Baseline_verified | Identity_accepted
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
val creation_step_to_string : creation_step -> string
val creation_step_of_string : string -> (creation_step, string) result
val valid_creation_steps : creation_step list -> bool
val ready_for_acceptance : creation_step list -> bool
val baseline_author_name : string
val baseline_author_email : string
val baseline_committer_name : string
val baseline_committer_email : string
val provisional_marker_path : agent_home:string -> owner_component:string -> agent_id:string -> string
val marker_to_json : provisional_marker -> Shared.json
val marker_of_json : Shared.json -> (provisional_marker, string) result
val marker_matches_resources : provisional_marker -> main_repository_root:string -> main_repository_id:string -> worktree_path:string -> branch:string -> bool
val opaque_cleanup_incident_id : owner_session_id:string -> agent_id:string -> now:int -> string
val workspace_unavailable_not_git : string
val workspace_unavailable_no_head : string
val workspace_unavailable_collision : string
val workspace_unavailable_source_changed : string
val delete_worktree_on_none_message : string
