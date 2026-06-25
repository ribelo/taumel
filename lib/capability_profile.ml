module String_set = Shared.String_set

type sandbox_preset =
  | Read_only
  | Workspace_write
  | Danger_full_access

type approval_policy =
  | Never
  | On_request
  | On_failure
  | Untrusted

type allowlist =
  | None_allowed
  | Only of String_set.t
  | All

type t = {
  model_id : string;
  thinking_level : string;
  sandbox_preset : sandbox_preset;
  approval_policy : approval_policy;
  tools : allowlist;
  agents : allowlist;
  no_sandbox_allowed : bool;
}

type agent_definition = {
  name : string;
  enabled : bool;
  model_id : string option;
  thinking_level : string option;
  sandbox_preset : sandbox_preset option;
  approval_policy : approval_policy option;
  tools : allowlist option;
  agents : allowlist option;
  allow_no_sandbox : bool;
}

let default =
  {
    model_id = "inherit";
    thinking_level = "medium";
    sandbox_preset = Workspace_write;
    approval_policy = On_request;
    tools = All;
    agents = All;
    no_sandbox_allowed = false;
  }

let of_list values = Only (List.fold_left (fun set value -> String_set.add value set) String_set.empty values)

let allows allowlist name =
  match allowlist with
  | None_allowed -> false
  | All -> true
  | Only values -> String_set.mem name values

let allowlist_names = function
  | None_allowed -> Some []
  | All -> None
  | Only values -> Some (String_set.elements values)

let allowlist_intersection parent child =
  match (parent, child) with
  | None_allowed, _ | _, None_allowed -> None_allowed
  | All, policy | policy, All -> policy
  | Only left, Only right -> Only (String_set.inter left right)

let allow_tool (profile : t) name = allows profile.tools name
let allow_agent (profile : t) name = allows profile.agents name

let sandbox_rank = function
  | Read_only -> 0
  | Workspace_write -> 1
  | Danger_full_access -> 2

let stricter_sandbox left right =
  if sandbox_rank left <= sandbox_rank right then left else right

let approval_rank = function
  | Never -> 0
  | Untrusted -> 1
  | On_request -> 2
  | On_failure -> 3

let stricter_approval left right =
  if approval_rank left <= approval_rank right then left else right

let sandbox_to_string = function
  | Read_only -> "read-only"
  | Workspace_write -> "workspace-write"
  | Danger_full_access -> "danger-full-access"

let sandbox_of_string = function
  | "read-only" -> Some Read_only
  | "workspace-write" -> Some Workspace_write
  | "danger-full-access" | "full-access" -> Some Danger_full_access
  | _ -> None

let approval_to_string = function
  | Never -> "never"
  | On_request -> "on-request"
  | On_failure -> "on-failure"
  | Untrusted -> "untrusted"

let approval_of_string = function
  | "never" -> Some Never
  | "on-request" -> Some On_request
  | "on-failure" -> Some On_failure
  | "untrusted" -> Some Untrusted
  | _ -> None

let allowlist_to_json = function
  | None_allowed -> Shared.Object [ ("kind", Shared.String "none") ]
  | All -> Shared.Object [ ("kind", Shared.String "all") ]
  | Only values ->
      Shared.Object
        [
          ("kind", Shared.String "only");
          ( "names",
            Shared.Array
              (values |> String_set.elements |> List.map (fun value -> Shared.String value)) );
        ]

let allowlist_of_json = function
  | Shared.Object fields -> (
      match List.assoc_opt "kind" fields with
      | Some (Shared.String "none") -> Ok None_allowed
      | Some (Shared.String "all") -> Ok All
      | Some (Shared.String "only") -> (
          match List.assoc_opt "names" fields with
          | Some (Shared.Array values) ->
              let rec collect acc = function
                | [] -> Ok (Only (List.fold_left (fun set value -> String_set.add value set) String_set.empty acc))
                | Shared.String value :: rest -> collect (value :: acc) rest
                | _ -> Error "allowlist names must be strings"
              in
              collect [] values
          | _ -> Error "allowlist kind only requires names")
      | _ -> Error "unknown allowlist kind")
  | _ -> Error "allowlist must be an object"

let to_json (profile : t) =
  Shared.Object
    [
      ("modelId", Shared.String profile.model_id);
      ("thinkingLevel", Shared.String profile.thinking_level);
      ("sandboxPreset", Shared.String (sandbox_to_string profile.sandbox_preset));
      ("approvalPolicy", Shared.String (approval_to_string profile.approval_policy));
      ("tools", allowlist_to_json profile.tools);
      ("agents", allowlist_to_json profile.agents);
      ("noSandboxAllowed", Shared.Bool profile.no_sandbox_allowed);
    ]

let of_json = function
  | Shared.Object fields ->
      let string_field name =
        match List.assoc_opt name fields with
        | Some (Shared.String value) -> Ok value
        | _ -> Error (name ^ " must be a string")
      in
      let bool_field name =
        match List.assoc_opt name fields with
        | Some (Shared.Bool value) -> Ok value
        | Some Shared.Null | None -> Ok false
        | _ -> Error (name ^ " must be a boolean")
      in
      let ( let* ) = Result.bind in
      let* sandbox = string_field "sandboxPreset" in
      let* sandbox_preset =
        match sandbox_of_string sandbox with
        | None -> Error ("unknown sandbox preset: " ^ sandbox)
        | Some value -> Ok value
      in
      let* approval = string_field "approvalPolicy" in
      let* approval_policy =
        match approval_of_string approval with
        | None -> Error ("unknown approval policy: " ^ approval)
        | Some value -> Ok value
      in
      let* tools =
        match List.assoc_opt "tools" fields with
        | Some value -> allowlist_of_json value
        | None -> Ok All
      in
      let* agents =
        match List.assoc_opt "agents" fields with
        | Some value -> allowlist_of_json value
        | None -> Ok All
      in
      let* model_id = string_field "modelId" in
      let* thinking_level = string_field "thinkingLevel" in
      let* no_sandbox_allowed = bool_field "noSandboxAllowed" in
      Ok
        {
          model_id;
          thinking_level;
          sandbox_preset;
          approval_policy;
          tools;
          agents;
          no_sandbox_allowed;
        }
  | _ -> Error "capability profile must be an object"

let codec = { Shared.encode = to_json; decode = of_json }

let resolve ?model_id ?thinking_level ?sandbox_preset ?approval_policy ?tools
    ?agents ?no_sandbox_allowed (base : t) =
  {
    model_id = Option.value model_id ~default:base.model_id;
    thinking_level = Option.value thinking_level ~default:base.thinking_level;
    sandbox_preset = Option.value sandbox_preset ~default:base.sandbox_preset;
    approval_policy = Option.value approval_policy ~default:base.approval_policy;
    tools = Option.value tools ~default:base.tools;
    agents = Option.value agents ~default:base.agents;
    no_sandbox_allowed =
      Option.value no_sandbox_allowed ~default:base.no_sandbox_allowed;
  }

let child_profile (parent : t) (definition : agent_definition) =
  if not definition.enabled then Error ("agent " ^ definition.name ^ " is disabled")
  else if not (allow_agent parent definition.name) then
    Error ("agent " ^ definition.name ^ " is not allowed by the parent profile")
  else if definition.sandbox_preset = Some Danger_full_access then
    Error "danger-full-access is not allowed for subagents"
  else
    let inherited_sandbox =
      match parent.sandbox_preset with
      | Danger_full_access -> Workspace_write
      | Read_only | Workspace_write -> parent.sandbox_preset
    in
    let requested_sandbox =
      Option.value definition.sandbox_preset ~default:inherited_sandbox
    in
    Ok
      {
        model_id = Option.value definition.model_id ~default:parent.model_id;
        thinking_level =
          Option.value definition.thinking_level ~default:parent.thinking_level;
        sandbox_preset = stricter_sandbox parent.sandbox_preset requested_sandbox;
        approval_policy =
          stricter_approval parent.approval_policy
            (Option.value definition.approval_policy ~default:parent.approval_policy);
        tools = Option.value definition.tools ~default:parent.tools;
        agents =
          allowlist_intersection parent.agents
            (Option.value definition.agents ~default:parent.agents);
        no_sandbox_allowed = false;
      }
