type effect_kind =
  | Pure
  | Execute
  | Mutate
  | Network
  | Ask_user

type spec = {
  name : string;
  effect_kind : effect_kind;
}

type error =
  | Unknown_tool of string
  | Denied_tool of string
  | Denied_effect of effect_kind * string

type registry = spec Shared.String_map.t

type call_context = {
  profile : Capability_profile.t;
  authorize_effect : effect_kind -> (unit, string) result;
}

let empty = Shared.String_map.empty
let register spec registry = Shared.String_map.add spec.name spec registry
let specs registry = registry |> Shared.String_map.bindings |> List.map snd

let effect_requires_sandbox = function
  | Execute | Mutate | Network -> true
  | Pure | Ask_user -> false

let effect_to_string = function
  | Pure -> "pure"
  | Execute -> "execute"
  | Mutate -> "mutate"
  | Network -> "network"
  | Ask_user -> "ask_user"

let text_result_json ?(details = Shared.Null) text =
  Shared.Object
    [
      ( "content",
        Shared.Array
          [
            Shared.Object
              [
                ("type", Shared.String "text");
                ("text", Shared.String text);
              ];
          ] );
      ("details", details);
    ]

let authorize registry context ~name =
  match Shared.String_map.find_opt name registry with
  | None -> Error (Unknown_tool name)
  | Some spec ->
      if not (Capability_profile.allow_tool context.profile name) then
        Error (Denied_tool name)
      else
        let effect_result =
          if effect_requires_sandbox spec.effect_kind then
            context.authorize_effect spec.effect_kind
          else Ok ()
        in
        (match effect_result with
        | Error message -> Error (Denied_effect (spec.effect_kind, message))
        | Ok () -> Ok ())

let exposeable_specs profile registry =
  specs registry
  |> List.filter (fun spec -> Capability_profile.allow_tool profile spec.name)
