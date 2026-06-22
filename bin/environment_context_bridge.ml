open Jsoo_bridge
open App_state

let custom_type = "taumel.environment_context"
let delivered_session_id : string option ref = ref None
let delivered_snapshot : Taumel.Environment_context.snapshot option ref = ref None

let shell_from_facts facts =
  match optional_string_field facts "shell" with
  | Some shell when String.trim shell <> "" -> String.trim shell
  | _ -> (
      match env_string "SHELL" with
      | shell when String.trim shell <> "" -> String.trim shell
      | _ -> "bash")

let reset_on_session_change session_id =
  if !delivered_session_id <> Some session_id then (
    delivered_session_id := Some session_id;
    delivered_snapshot := None)

let plan_context ctx facts =
  Session_sync.sync_session_from_host ~scope:"environment context" ctx;
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
  | None -> ok_obj [ ("action", js_string "none") ]
  | Some context ->
      ok_obj
        [
          ("action", js_string "inject");
          ("customType", js_string custom_type);
          ("content", js_string (Taumel.Environment_context.serialize context));
          ("display", js_bool false);
        ]
