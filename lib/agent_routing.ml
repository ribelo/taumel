(* Resolve taumel.agents.* routing entries from Taumel config JSON. *)

let default_routing ~kind ~effort ~parent_model =
  let effort =
    match kind with
    | Agents.Generic -> Some (Option.value effort ~default:Agents.Medium)
    | Agents.Finder | Agents.Oracle -> None
  in
  let thinking = Agents.default_thinking_for_kind ~effort kind in
  (Option.value parent_model ~default:"inherit", thinking, effort)

type entry = {
  model : string;
  thinking : string;
}

type catalog = {
  generic_low : entry option;
  generic_medium : entry option;
  generic_high : entry option;
  finder : entry option;
  oracle : entry option;
  diagnostics : string list;
}

let empty =
  {
    generic_low = None;
    generic_medium = None;
    generic_high = None;
    finder = None;
    oracle = None;
    diagnostics = [];
  }

let thinking_levels =
  [ "off"; "minimal"; "low"; "medium"; "high"; "xhigh"; "max" ]

let valid_thinking value = List.mem value thinking_levels

let valid_model_id value =
  match String.index_opt value '/' with
  | Some separator ->
      separator > 0 && separator < String.length value - 1
  | None -> false

let parse_entry path = function
  | Shared.Object fields -> (
      let ( let* ) = Result.bind in
      let* model = Shared.json_required_string path fields "model" in
      let* thinking = Shared.json_required_string path fields "thinking" in
      let model = String.trim model in
      let thinking = String.trim thinking in
      if model = "" then Error (path ^ ".model must not be empty")
      else if model <> "inherit" && not (valid_model_id model) then
        Error (path ^ ".model must be \"inherit\" or provider/model")
      else if not (valid_thinking thinking) then
        Error (path ^ ".thinking is not a supported Pi thinking level")
      else Ok { model; thinking })
  | _ -> Error (path ^ " must be an object with model and thinking")

let parse_optional path fields name catalog_set =
  match List.assoc_opt name fields with
  | None | Some Shared.Null -> catalog_set None
  | Some value -> (
      match parse_entry path value with
      | Ok entry -> catalog_set (Some entry)
      | Error message -> Error message)

let parse_agents_object path = function
  | Shared.Object fields ->
      let ( let* ) = Result.bind in
      let* generic =
        match List.assoc_opt "generic" fields with
        | None | Some Shared.Null -> Ok (None, None, None, [])
        | Some (Shared.Object generic_fields) ->
            let diagnostics = ref [] in
            let parse_slot slot =
              match List.assoc_opt slot generic_fields with
              | None | Some Shared.Null -> None
              | Some value -> (
                  match parse_entry (path ^ ".generic." ^ slot) value with
                  | Ok entry -> Some entry
                  | Error message ->
                      diagnostics := message :: !diagnostics;
                      None)
            in
            Ok
              ( parse_slot "low",
                parse_slot "medium",
                parse_slot "high",
                List.rev !diagnostics )
        | Some _ -> Error (path ^ ".generic must be an object")
      in
      let low, medium, high, generic_diags = generic in
      let diagnostics = ref generic_diags in
      let parse_specialist name =
        match List.assoc_opt name fields with
        | None | Some Shared.Null -> None
        | Some value -> (
            match parse_entry (path ^ "." ^ name) value with
            | Ok entry -> Some entry
            | Error message ->
                diagnostics := !diagnostics @ [ message ];
                None)
      in
      let finder = parse_specialist "finder" in
      let oracle = parse_specialist "oracle" in
      let diagnostics = !diagnostics in
      Ok
        {
          generic_low = low;
          generic_medium = medium;
          generic_high = high;
          finder;
          oracle;
          diagnostics;
        }
  | Shared.Null -> Ok empty
  | _ -> Error (path ^ " must be an object")

let of_taumel_json = function
  | Shared.Object fields -> (
      match List.assoc_opt "agents" fields with
      | None | Some Shared.Null -> Ok empty
      | Some value -> parse_agents_object "taumel.agents" value)
  | _ -> Ok empty

(* Whole-entry precedence: later catalogs override earlier ones completely per key. *)
let merge ~base ~override =
  {
    generic_low =
      (match override.generic_low with Some _ as value -> value | None -> base.generic_low);
    generic_medium =
      (match override.generic_medium with
      | Some _ as value -> value
      | None -> base.generic_medium);
    generic_high =
      (match override.generic_high with Some _ as value -> value | None -> base.generic_high);
    finder = (match override.finder with Some _ as value -> value | None -> base.finder);
    oracle = (match override.oracle with Some _ as value -> value | None -> base.oracle);
    diagnostics = base.diagnostics @ override.diagnostics;
  }

let entry_for catalog ~(kind : Agents.agent_kind) ~(effort : Agents.effort option) =
  match kind with
  | Agents.Finder -> catalog.finder
  | Agents.Oracle -> catalog.oracle
  | Agents.Generic -> (
      match effort with
      | Some Agents.Low -> catalog.generic_low
      | Some Agents.High -> catalog.generic_high
      | Some Agents.Medium | None -> catalog.generic_medium)
