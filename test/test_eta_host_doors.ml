(** Unit tests for bin/eta_host_doors.ml — JS ↔ Eta ingress/egress adapters. *)

module Js = Js_of_ocaml.Js
module Unsafe = Js_of_ocaml.Js.Unsafe
module Effect = Eta.Effect
module Exit = Eta.Exit
module Runtime = Eta_jsoo.Runtime

let log message =
  ignore
    (Unsafe.fun_call
       (Unsafe.js_expr "console.log")
       [| Unsafe.inject (Js.string message) |])

let set_exit_code code =
  let process = Unsafe.get Unsafe.global "process" in
  Unsafe.set process "exitCode" code

let suite_completed = ref false

let fail_test message = failwith message

let () =
  let process = Unsafe.get Unsafe.global "process" in
  ignore
    (Unsafe.meth_call process "on"
       [|
         Unsafe.inject (Js.string "beforeExit");
         Unsafe.inject
           (Js.wrap_callback (fun _code ->
                if not !suite_completed then (
                  set_exit_code 1;
                  log "test_eta_host_doors failed: suite did not complete")));
       |])

let finish done_ f value =
  try
    f value;
    done_ ()
  with exn ->
    set_exit_code 1;
    log ("test_eta_host_doors failed: " ^ Printexc.to_string exn)

let run eff ~on_result =
  let runtime = Runtime.create () in
  Runtime.run runtime eff ~on_result

let js_promise_resolve value =
  let promise_ctor = Unsafe.get Unsafe.global "Promise" in
  Unsafe.fun_call (Unsafe.get promise_ctor "resolve") [| Unsafe.inject value |]

let js_promise_reject reason =
  let promise_ctor = Unsafe.get Unsafe.global "Promise" in
  Unsafe.fun_call (Unsafe.get promise_ctor "reject") [| Unsafe.inject reason |]

let js_pending_promise () =
  let promise_ctor = Unsafe.get Unsafe.global "Promise" in
  let resolver = ref None in
  let executor =
    Js.wrap_callback (fun resolve _reject -> resolver := Some resolve)
  in
  let promise = Unsafe.new_obj promise_ctor [| Unsafe.inject executor |] in
  ( promise,
    fun value ->
      match !resolver with
      | Some resolve ->
          ignore (Unsafe.fun_call resolve [| Unsafe.inject value |])
      | None -> fail_test "pending promise resolver is unavailable" )

let new_abort_controller () =
  Unsafe.new_obj (Unsafe.get Unsafe.global "AbortController") [||]

let js_to_string value = Js.to_string (Unsafe.coerce value)

let test_from_js_promise_resolve done_ =
  let promise = js_promise_resolve (Js.string "ok") in
  run
    (Eta_host_doors.await_js_result (Unsafe.inject promise))
    ~on_result:
      (finish done_ (function
        | Exit.Ok value ->
            if js_to_string value <> "ok" then
              fail_test ("unexpected resolve value: " ^ js_to_string value)
        | Exit.Error _ -> fail_test "expected Ok from resolved promise"))

let test_from_js_promise_reject done_ =
  let promise = js_promise_reject (Js.string "boom") in
  run
    (Eta_host_doors.await_js_result (Unsafe.inject promise))
    ~on_result:
      (finish done_ (function
        | Exit.Error (Eta.Cause.Fail "boom") -> ()
        | Exit.Error _ -> fail_test "expected Fail boom"
        | Exit.Ok _ -> fail_test "expected typed rejection"))

let test_from_js_promise_cancels_host done_ =
  let cancelled = ref 0 in
  let settled = ref false in
  let promise, resolve = js_pending_promise () in
  let cancel () =
    incr cancelled;
    let callback =
      Js.wrap_callback (fun () ->
          settled := true;
          resolve (Js.string "cancelled"))
    in
    ignore
      (Unsafe.fun_call
         (Unsafe.get Unsafe.global "setTimeout")
         [| Unsafe.inject callback; Unsafe.inject (Js.number_of_float 5.) |])
  in
  let program =
    Effect.timeout_as (Eta.Duration.ms 5) ~on_timeout:`Timeout
      (Eta_host_doors.await_js_result ~on_cancel:cancel (Unsafe.inject promise)
      |> Effect.map_error (fun message -> `Promise message)
      |> Effect.map (fun _ -> `Resolved))
  in
  run program
    ~on_result:
      (finish done_ (function
        | Exit.Error (Eta.Cause.Fail `Timeout) ->
            if !cancelled <> 1 then
              fail_test
                (Printf.sprintf "expected one host cancellation, got %d"
                   !cancelled);
            if not !settled then
              fail_test
                "Eta interruption returned before the host promise settled"
        | Exit.Ok `Resolved -> fail_test "pending promise resolved unexpectedly"
        | Exit.Error _ -> fail_test "expected timeout"))

let test_abort_signal_already_aborted done_ =
  let controller = new_abort_controller () in
  ignore (Unsafe.meth_call controller "abort" [||]);
  let signal = Unsafe.get controller "signal" in
  run
    (Eta_host_doors.await_abort_signal signal)
    ~on_result:
      (finish done_ (function
        | Exit.Ok () -> ()
        | Exit.Error _ -> fail_test "already-aborted signal should succeed"))

let test_abort_signal_fires done_ =
  let controller = new_abort_controller () in
  let signal = Unsafe.get controller "signal" in
  run
    (Eta_host_doors.await_abort_signal signal)
    ~on_result:
      (finish done_ (function
        | Exit.Ok () -> ()
        | Exit.Error _ -> fail_test "abort listener should succeed"));
  ignore (Unsafe.meth_call controller "abort" [||])

let test_abort_signal_canceler_removes_listener done_ =
  let controller = new_abort_controller () in
  let signal = Unsafe.get controller "signal" in
  let removed = ref 0 in
  let original_remove = Unsafe.get signal "removeEventListener" in
  let bound_remove =
    Unsafe.fun_call
      (Unsafe.get original_remove "bind")
      [| Unsafe.inject signal |]
  in
  Unsafe.set signal "removeEventListener"
    (Js.wrap_callback (fun typ listener ->
         incr removed;
         ignore (Unsafe.fun_call bound_remove [| typ; listener |])));
  (* timeout_as interrupts the parked abort waiter; canceler must detach. *)
  let program =
    Effect.timeout_as (Eta.Duration.ms 5) ~on_timeout:`Timeout
      (Eta_host_doors.await_abort_signal signal |> Effect.map (fun () -> `Abort))
  in
  run program
    ~on_result:
      (finish done_ (function
        | Exit.Error (Eta.Cause.Fail `Timeout) ->
            if !removed < 1 then
              fail_test "abort listener was not removed by canceler"
        | Exit.Ok `Abort -> fail_test "timeout should win before abort"
        | Exit.Ok _ -> fail_test "unexpected Ok"
        | Exit.Error cause ->
            fail_test
              (Format.asprintf "timeout_as failed: %a"
                 (Eta.Cause.pp (fun fmt _ -> Format.pp_print_string fmt "err"))
                 cause)))

let test_child_process_cancellation_awaits_exit done_ =
  let node = List.hd (Node_process.argv ()) in
  let marker =
    Filename.concat (Node_os.tmpdir ())
      (Printf.sprintf "taumel-eta-child-%d.pid" (Node_process.pid ()))
  in
  let script =
    Printf.sprintf
      "require('fs').writeFileSync(%S, String(process.pid)); setInterval(() => \
       {}, 1000)"
      marker
  in
  let program =
    Node_child_process_eta.exec_file ~file:node ~args:[ "-e"; script ]
      ~cwd:(Node_os.tmpdir ()) ~env:(Node_process.env ())
    |> Effect.map (fun _ -> `Completed)
    |> Effect.timeout_as (Eta.Duration.ms 100) ~on_timeout:`Timeout
  in
  run program
    ~on_result:
      (finish done_ (function
        | Exit.Error (Eta.Cause.Fail `Timeout) ->
            if not (Node_fs.exists_sync marker) then
              fail_test "child process did not start before timeout";
            let pid =
              Node_fs.read_file_sync_utf8 marker |> String.trim |> int_of_string
            in
            Node_fs.unlink_sync marker;
            if Node_process.probe pid then
              fail_test "Eta cancellation returned before child process exit"
        | Exit.Ok `Completed ->
            fail_test "long-lived child exited before timeout"
        | Exit.Error _ -> fail_test "expected child-process timeout"))

let test_rejecting_reverse_door done_ =
  let eff = Effect.fail () in
  let promise =
    Eta_host_doors.js_promise_of_effect_rejecting
      (eff |> Effect.map (fun () -> Unsafe.inject Js.null))
  in
  let on_fulfilled =
    Js.wrap_callback (fun _value ->
        set_exit_code 1;
        log "rejecting reverse door resolved unexpectedly";
        done_ ())
  in
  let on_rejected = Js.wrap_callback (fun _reason -> done_ ()) in
  ignore
    (Unsafe.meth_call promise "then"
       [| Unsafe.inject on_fulfilled; Unsafe.inject on_rejected |])

let test_resolve_reverse_door_keeps_resolve_semantics done_ =
  let eff = Effect.fail () in
  let promise =
    Eta_host_doors.js_promise_of_effect
      ~error_value:(fun _cause -> Unsafe.inject (Js.string "resolved-error"))
      (eff |> Effect.map (fun () -> Unsafe.inject Js.null))
  in
  let on_fulfilled =
    Js.wrap_callback (fun value ->
        if js_to_string value = "resolved-error" then done_ ()
        else (
          set_exit_code 1;
          log "resolve reverse door returned unexpected value";
          done_ ()))
  in
  let on_rejected =
    Js.wrap_callback (fun _reason ->
        set_exit_code 1;
        log "resolve reverse door rejected unexpectedly";
        done_ ())
  in
  ignore
    (Unsafe.meth_call promise "then"
       [| Unsafe.inject on_fulfilled; Unsafe.inject on_rejected |])

let tests =
  [
    ("from_js_promise resolve", test_from_js_promise_resolve);
    ("from_js_promise reject", test_from_js_promise_reject);
    ("from_js_promise cancels host", test_from_js_promise_cancels_host);
    ("abort signal already aborted", test_abort_signal_already_aborted);
    ("abort signal fires", test_abort_signal_fires);
    ( "abort signal canceler removes listener",
      test_abort_signal_canceler_removes_listener );
    ( "child process cancellation awaits exit",
      test_child_process_cancellation_awaits_exit );
    ("rejecting reverse door rejects", test_rejecting_reverse_door);
    ( "resolve reverse door resolves errors",
      test_resolve_reverse_door_keeps_resolve_semantics );
  ]

let rec run_tests = function
  | [] ->
      suite_completed := true;
      log "test_eta_host_doors ok"
  | (name, test) :: rest ->
      test (fun () ->
          log ("ok: " ^ name);
          run_tests rest)

let () =
  try run_tests tests
  with exn ->
    set_exit_code 1;
    log ("test_eta_host_doors failed: " ^ Printexc.to_string exn)
