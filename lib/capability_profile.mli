module String_set = Shared.String_set

type sandbox_preset = Read_only | Workspace_write | Danger_full_access
type approval_policy = Never | On_request | On_failure | Untrusted
type allowlist = None_allowed | Only of String_set.t | All

type t = private {
  model_id : string;
  thinking_level : string;
  sandbox_preset : sandbox_preset;
  approval_policy : approval_policy;
  tools : allowlist;
  no_sandbox_allowed : bool;
}

val default : t
val of_list : string list -> allowlist
val allows : allowlist -> string -> bool
val allowlist_names : allowlist -> string list option
val allowlist_intersection : allowlist -> allowlist -> allowlist
val allow_tool : t -> string -> bool
val stricter_sandbox : sandbox_preset -> sandbox_preset -> sandbox_preset
val stricter_approval : approval_policy -> approval_policy -> approval_policy
val sandbox_to_string : sandbox_preset -> string
val sandbox_of_string : string -> sandbox_preset option
val persisted_sandbox_of_string : string -> sandbox_preset option
val approval_to_string : approval_policy -> string
val approval_of_string : string -> approval_policy option
val allowlist_to_json : allowlist -> Shared.json
val allowlist_of_json : Shared.json -> (allowlist, string) result
val to_json : t -> Shared.json
val of_json : Shared.json -> (t, string) result
val codec : t Shared.codec
val resolve : ?model_id:string -> ?thinking_level:string -> ?sandbox_preset:sandbox_preset -> ?approval_policy:approval_policy -> ?tools:allowlist -> ?no_sandbox_allowed:bool -> t -> t
