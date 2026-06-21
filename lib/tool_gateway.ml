type effect_kind =
  | Pure
  | Execute
  | Mutate
  | Network
  | Spawn_agent
  | Ask_user

type spec = {
  name : string;
  description : string;
  effect_kind : effect_kind;
  strict : bool;
  parameters : Shared.json;
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
  | Execute | Mutate | Network | Spawn_agent -> true
  | Pure | Ask_user -> false

let effect_to_string = function
  | Pure -> "pure"
  | Execute -> "execute"
  | Mutate -> "mutate"
  | Network -> "network"
  | Spawn_agent -> "spawn_agent"
  | Ask_user -> "ask_user"

let string_list values = Shared.Array (List.map (fun value -> Shared.String value) values)

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

let add_optional name value fields =
  match value with None -> fields | Some value -> (name, value) :: fields

let string_schema ?description ?enum ?min_length ?max_length () =
  [ ("type", Shared.String "string") ]
  |> add_optional "description" (Option.map (fun value -> Shared.String value) description)
  |> add_optional "enum" (Option.map string_list enum)
  |> add_optional "minLength" (Option.map (fun value -> Shared.Number (float_of_int value)) min_length)
  |> add_optional "maxLength" (Option.map (fun value -> Shared.Number (float_of_int value)) max_length)
  |> List.rev |> fun fields -> Shared.Object fields

let number_schema ?description () =
  [ ("type", Shared.String "number") ]
  |> add_optional "description" (Option.map (fun value -> Shared.String value) description)
  |> List.rev |> fun fields -> Shared.Object fields

let boolean_schema ?description () =
  [ ("type", Shared.String "boolean") ]
  |> add_optional "description" (Option.map (fun value -> Shared.String value) description)
  |> List.rev |> fun fields -> Shared.Object fields

let array_schema ?description ?min_items ?max_items items =
  [ ("type", Shared.String "array"); ("items", items) ]
  |> add_optional "description" (Option.map (fun value -> Shared.String value) description)
  |> add_optional "minItems" (Option.map (fun value -> Shared.Number (float_of_int value)) min_items)
  |> add_optional "maxItems" (Option.map (fun value -> Shared.Number (float_of_int value)) max_items)
  |> List.rev |> fun fields -> Shared.Object fields

let object_schema ?(additional_properties = false) ?(required = []) properties =
  Shared.Object
    [
      ("type", Shared.String "object");
      ("additionalProperties", Shared.Bool additional_properties);
      ("required", string_list required);
      ("properties", Shared.Object properties);
    ]

let empty_parameters = object_schema ~additional_properties:false []
let loose_parameters = object_schema ~additional_properties:true []

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
