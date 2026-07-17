open Jsoo_bridge
open App_state

let make_component host tui theme footer_data unsub_branch unsub_footer =
  let render =
    Js.wrap_callback (fun width_js ->
        let width =
          match float_value (Unsafe.inject width_js) with
          | Some width -> int_of_float width
          | None -> 0
        in
        let lines =
          Model.render_lines
            ~colorize:(Footer_bridge.colorize host theme)
            ~width
            (Footer_bridge.snapshot_for_render host footer_data)
        in
        js_lines lines)
  in
  let dispose =
    Js.wrap_callback (fun () ->
        ignore (Unsafe.fun_call unsub_branch [||]);
        ignore (Unsafe.fun_call unsub_footer [||]))
  in
  let invalidate = Js.wrap_callback (fun () -> ()) in
  Unsafe.obj
    [|
      ("render", inject render);
      ("dispose", inject dispose);
      ("invalidate", inject invalidate);
    |]

let install host ctx =
  let factory =
    Js.wrap_callback (fun tui theme footer_data ->
        let request_render =
          Js.wrap_callback (fun () ->
              ignore (call1 host "requestRender" (inject tui)))
        in
        let unsub_branch =
          call2 host "onBranchChange" (inject footer_data) (inject request_render)
        in
        let unsub_footer =
          call2 host "eventsOn" (js_string footer_event) (inject request_render)
        in
        make_component host tui theme footer_data unsub_branch unsub_footer)
  in
  ignore (call2 host "setFooter" (inject ctx) (inject factory))

let start_refresh_loop host =
  let rt = Runtime.create () in
  runtime := Some rt;
  let loop =
    Effect.repeat (Schedule.spaced (Duration.seconds 5))
      (Footer_bridge.refresh_footer_hygiene host)
  in
  Runtime.run rt loop ~on_result:(fun _ -> ())

let ensure_refresh_loop host =
  match !runtime with Some _ -> () | None -> start_refresh_loop host

let refresh_git_now host =
  let rt = Runtime.create () in
  Runtime.run rt (Footer_bridge.refresh_footer_hygiene host) ~on_result:(fun _ -> ())

let ignore_stale scope run =
  try run () with error -> Session_sync.report_session_sync_error scope error

let register_handlers host =
  let update_handler install_footer =
    Js.wrap_callback (fun _event ctx ->
        if Session_sync.session_is_isolated_child ctx then ()
        else
          ignore_stale "footer session lifecycle" (fun () ->
            let previous_cwd = state.footer_cwd in
            match
              Session_sync.try_sync_session_from_host_with
                ~scope:"footer session sync" ~clear_retained_outputs:true host ctx
            with
            | Error _ -> ()
            | Ok snapshot ->
                let isolated_child =
                  Session_sync.persisted_session_snapshot_is_isolated_child snapshot
                in
                if not isolated_child then capture_loaded_footer_permissions ();
                capture_loaded_footer_goal ();
                if state.footer_cwd <> previous_cwd then (
                  state.git_delta <- Model.empty_git_delta;
                  state.git_repo <- false;
                  state.git_error <- false;
                  emit_changed host;
                  refresh_git_now host);
                if install_footer && not isolated_child then install host ctx;
                ensure_refresh_loop host;
                emit_changed host))
  in
  ignore (call2 host "on" (js_string "session_start") (inject (update_handler true)));
  ignore (call2 host "on" (js_string "session_resume") (inject (update_handler true)));
  ignore (call2 host "on" (js_string "session_switch") (inject (update_handler true)));
  ignore (call2 host "on" (js_string "model_select") (inject (update_handler false)));
  ignore
    (call2 host "on" (js_string "turn_start")
       (inject
          (Js.wrap_callback (fun _event ctx ->
               (* Isolated child turns must not touch the shared goal clock or
                  move the parent's footer. *)
               if Session_sync.session_is_isolated_child ctx then ()
               else (
                 Session_sync.start_goal_turn ();
                 ensure_refresh_loop host;
                 emit_changed host)))));
  ignore
    (call2 host "on" (js_string "turn_end")
	       (inject
	          (Js.wrap_callback (fun _event ctx ->
               if Session_sync.session_is_isolated_child ctx then ()
               else
	               ignore_stale "footer turn_end" (fun () ->
	                   match
	                     Session_sync.try_sync_session_from_host_with
	                       ~scope:"footer turn_end sync" host ctx
	                   with
		                   | Error _ -> ()
		                   | Ok _ ->
	                       capture_loaded_footer_permissions ();
	                       ignore
	                         (Session_sync.try_account_goal_turn_end
	                            ~scope:"footer goal accounting" ctx);
	                       capture_loaded_footer_goal ();
	                       ensure_refresh_loop host;
	                       emit_changed host)))));
  ignore
    (call2 host "on" (js_string "session_tree")
       (inject (Js.wrap_callback (fun _event _ctx -> emit_changed host))));
  ignore
    (call2 host "on" (js_string "session_fork")
       (inject (Js.wrap_callback (fun _event _ctx -> emit_changed host))));
  ignore
    (call2 host "eventsOn" (js_string "taumel:sandbox:changed")
       (inject
          (Js.wrap_callback (fun payload ->
               let mode = get_string payload "filesystemMode" in
               state.filesystem_mode <-
                 (if mode = "" then "workspace-write" else mode);
               active_network_mode :=
                 (match Taumel.Permissions.network_of_string (get_string payload "networkMode") with
                 | Some mode -> mode
                 | None -> !active_network_mode);
               if has_property payload "noSandbox" then
                 active_no_sandbox := get_bool payload "noSandbox";
               if not !active_isolated_child then capture_loaded_footer_permissions ();
               emit_changed host))))

let init host =
  active_host := Some host;
  register_handlers host

let refresh_state ctx =
  let host = active_host_or_empty () in
  ignore (Session_sync.try_refresh_session_state_from_host ~scope:"footer refresh" ctx);
  emit_changed host;
  core_ack ()

let update_thinking thinking ctx =
  (* thinking_level_select can originate from any in-process session, so
     the retained parent thinking moves only for a provable main-session
     context. Everything else — child sessions, missing or unreadable
     contexts — fails closed: a dropped parent update is repaired by the
     next parent event, while an applied child update is the cross-talk
     this guard exists to prevent. *)
  let main_session =
    try
      is_property_container (inject ctx)
      && not (Session_sync.session_is_isolated_child ctx)
    with _ -> false
  in
  if not main_session then core_ack ()
  else (
    state.thinking <- thinking;
    emit_changed (active_host_or_empty ());
    core_ack ())
