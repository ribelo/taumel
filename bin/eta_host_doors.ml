(** Shared JS ↔ Eta host doors. The jsoo bridge is the only owner of these
    adapters; other modules compose the returned Eta values. *)

module Js = Js_of_ocaml.Js
module Unsafe = Js_of_ocaml.Js.Unsafe
module Effect = Eta.Effect
module Exit = Eta.Exit
module Runtime = Eta_jsoo.Runtime

let inject = Unsafe.inject

let js_string value = inject (Js.string value)

let js_bool value = inject (Js.bool value)

let is_js_function =
  let predicate = Unsafe.js_expr "((value) => typeof value === 'function')" in
  fun value ->
    Js.to_bool (Unsafe.coerce (Unsafe.fun_call predicate [| value |]))

let is_js_string =
  let predicate = Unsafe.js_expr "((value) => typeof value === 'string')" in
  fun value ->
    Js.to_bool (Unsafe.coerce (Unsafe.fun_call predicate [| value |]))

let is_nullish =
  let predicate =
    Unsafe.js_expr "((value) => value === null || value === undefined)"
  in
  fun value ->
    Js.to_bool (Unsafe.coerce (Unsafe.fun_call predicate [| value |]))

let string_value value =
  if is_js_string value then Some (Js.to_string (Unsafe.coerce value)) else None

let js_error_to_string error =
  match string_value error with
  | Some value -> value
  | None -> (
      match
        if is_nullish error then None
        else
          let message = Unsafe.get error "message" in
          string_value message
      with
      | Some message -> message
      | None -> "JavaScript promise rejected")

let await_js_result ?on_cancel promise =
  let await () = Eta_js.from_js_promise ~on_reject:js_error_to_string promise in
  match on_cancel with
  | None -> await ()
  | Some cancel ->
      Effect.on_interrupt
        (fun _interrupt_id ->
          let open Eta.Syntax in
          let* () = Effect.sync cancel in
          await () |> Effect.to_result |> Effect.discard)
        (await ())

let cause_message : type err. err Eta.Cause.t -> string =
 fun cause ->
  Format.asprintf "%a"
    (Eta.Cause.pp (fun fmt _ -> Format.pp_print_string fmt "async failure"))
    cause

let js_error message =
  Unsafe.new_obj (Unsafe.get Unsafe.global "Error") [| js_string message |]

let run_effect_as_js_promise ~on_failure (eff : (Unsafe.any, 'err) Effect.t) =
  let promise_ctor = Unsafe.get Unsafe.global "Promise" in
  let executor =
    Js.wrap_callback (fun resolve reject ->
        let rt = Runtime.create () in
        Runtime.run rt eff ~on_result:(function
          | Exit.Ok value -> ignore (Unsafe.fun_call resolve [| inject value |])
          | Exit.Error cause -> on_failure resolve reject cause))
  in
  Unsafe.new_obj promise_ctor [| inject executor |]

(** Resolve-semantics reverse door: Eta failures become resolved bridge error
    objects. Used by Exa/usage paths. *)
let js_promise_of_effect ~error_value (eff : (Unsafe.any, 'err) Effect.t) =
  run_effect_as_js_promise eff ~on_failure:(fun resolve _reject cause ->
      ignore (Unsafe.fun_call resolve [| inject (error_value cause) |]))

(** Rejecting reverse door: Eta failures reject the host promise. *)
let js_promise_of_effect_rejecting ?(error_message = cause_message)
    (eff : (Unsafe.any, 'err) Effect.t) =
  run_effect_as_js_promise eff ~on_failure:(fun _resolve reject cause ->
      ignore
        (Unsafe.fun_call reject [| inject (js_error (error_message cause)) |]))

let signal_aborted signal =
  (not (is_nullish signal))
  &&
  let aborted = Unsafe.get signal "aborted" in
  Js.to_bool (Unsafe.coerce aborted)

(** Await an AbortSignal. Prechecks [signal.aborted], registers a once-only
    abort listener, and returns listener removal as the [Effect.async] canceler.
    A nullish signal never resolves on its own (interruptible park). *)
let await_abort_signal signal =
  Effect.async ~register:(fun resume ->
      if is_nullish signal then None
      else if signal_aborted signal then (
        resume (Exit.Ok ());
        None)
      else if not (is_js_function (Unsafe.get signal "addEventListener")) then
        invalid_arg "Eta host door await_abort_signal: expected AbortSignal"
      else
        let wrapped = Js.wrap_callback (fun _event -> resume (Exit.Ok ())) in
        let options = Unsafe.obj [| ("once", js_bool true) |] in
        ignore
          (Unsafe.meth_call signal "addEventListener"
             [| js_string "abort"; inject wrapped; inject options |]);
        Some
          (Effect.sync (fun () ->
               ignore
                 (Unsafe.meth_call signal "removeEventListener"
                    [| js_string "abort"; inject wrapped |]))))
