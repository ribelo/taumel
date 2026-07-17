open Jsoo_bridge
open App_state
open Runtime_access

let custom_type = "taumel.environment_context"
let delivered_session_id : string option ref = ref None
let delivered_snapshot : Taumel.Environment_context.snapshot option ref = ref None

let shell_from_facts facts =
  match Tool_contracts.EnvironmentContextFacts.get_shell facts with
  | shell when String.trim shell <> "" -> String.trim shell
  | _ -> (
      match env_string "SHELL" with
      | shell when String.trim shell <> "" -> String.trim shell
      | _ -> "bash")

let reset_on_session_change session_id =
  if !delivered_session_id <> Some session_id then (
    delivered_session_id := Some session_id;
    delivered_snapshot := None)

let plan_context ctx facts =
  let facts =
    decode_ojs_contract Tool_contracts.EnvironmentContextFacts.t_of_js (ojs_of_js facts)
  in
  Session_sync.require_session_from_host ~scope:"environment context" ctx;
  let session_id = Session_store.session_id_from_ctx ctx in
  reset_on_session_change session_id;
  let snapshot =
    Taumel.Environment_context.snapshot ~cwd:state.cwd
      ~shell:(shell_from_facts facts) (active_sandbox ())
  in
  let context =
    match !delivered_snapshot with
    | None -> Some (Taumel.Environment_context.full snapshot)
    | Some previous -> Taumel.Environment_context.diff previous snapshot
  in
  delivered_snapshot := Some snapshot;
  match context with
  | None ->
      Boundary_contracts.EnvironmentContextNone.create ()
      |> Tool_contracts.EnvironmentContextNone.t_to_js |> inject
  | Some context ->
      Boundary_contracts.EnvironmentContextInject.create
        ~customType:custom_type
        ~content:(Taumel.Environment_context.serialize context) ~display:false ()
      |> Tool_contracts.EnvironmentContextInject.t_to_js |> inject
