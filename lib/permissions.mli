type state = private { profile : Capability_profile.t; sandbox : Sandbox.config }
type update =
  | Set_sandbox of Capability_profile.sandbox_preset
  | Set_approval of Capability_profile.approval_policy
  | Set_network of Sandbox.network_mode
  | Set_no_sandbox of bool
  | Allow_tools of string list
  | Deny_all_tools
type menu_option = { label : string; value : string; description : string; selected : bool }
type prompt_plan = Prompt_unavailable | Prompt_select of { title : string; labels : string list }
type persisted = Missing | Invalid | Persisted of state
type active = {
  profile : Capability_profile.t;
  network_mode : Sandbox.network_mode;
  no_sandbox : bool;
  isolated_child : bool;
  filesystem_mode : string;
}

val default_prompt_title : string
val network_prompt_title : string
val menu_selected_value : menu_option list -> string -> string option
val prompt_selection_plan : ui_available:bool -> title:string -> menu_option list -> prompt_plan
val create : ?workspace_roots:string list -> ?network_mode:Sandbox.network_mode -> ?no_sandbox:bool -> ?isolated_child:bool -> Capability_profile.t -> (state, string) result
val resolve_active : host_sandbox_preset:Capability_profile.sandbox_preset option -> host_network_mode:Sandbox.network_mode option -> host_no_sandbox:bool option -> session_isolated_child:bool -> persisted -> active
val apply_update : state -> update -> (state, string) result
val network_to_string : Sandbox.network_mode -> string
val network_of_string : string -> Sandbox.network_mode option
val persisted_network_of_string : string -> Sandbox.network_mode option
val summary : state -> string
val sandbox_menu_options : state -> menu_option list
val approval_menu_options : state -> menu_option list
val network_menu_options : state -> menu_option list
val permissions_menu_options : state -> menu_option list
val codec : state Shared.codec
val parse : string -> (update option, string) result
val parse_permissions : string -> (update option, string) result
val parse_network : string -> (update option, string) result
