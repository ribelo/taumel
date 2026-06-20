module Js = Js_of_ocaml.Js
module Unsafe = Js_of_ocaml.Js.Unsafe
module Effect = Eta.Effect
module Duration = Eta.Duration
module Schedule = Eta.Schedule
module Runtime = Eta_jsoo.Runtime
module Model = Taumel.Footer_model

type state = {
  mutable cwd : string;
  mutable filesystem_mode : string;
  mutable git_delta : Model.git_delta;
  mutable provider : string;
  mutable model : string;
  mutable thinking : string;
  mutable total_cost : float;
  mutable context_percent : float;
  mutable context_window : float;
}

let state =
  {
    cwd = "";
    filesystem_mode = "workspace-write";
    git_delta = Model.empty_git_delta;
    provider = "";
    model = "no-model";
    thinking = "off";
    total_cost = 0.0;
    context_percent = -1.0;
    context_window = -1.0;
  }

let runtime : unit Runtime.t option ref = ref None
let footer_event = "taumel:footer:changed"

let inject = Unsafe.inject
let js_string value = inject (Js.string value)
let js_number value = inject (Js.number_of_float value)

let call0 obj name = Unsafe.fun_call (Unsafe.get obj name) [||]
let call1 obj name a = Unsafe.fun_call (Unsafe.get obj name) [| a |]
let call2 obj name a b = Unsafe.fun_call (Unsafe.get obj name) [| a; b |]
let call3 obj name a b c = Unsafe.fun_call (Unsafe.get obj name) [| a; b; c |]

let get_string obj name =
  try Js.to_string (Unsafe.coerce (Unsafe.get obj name)) with _ -> ""

let get_float obj name =
  try Js.to_float (Unsafe.coerce (Unsafe.get obj name)) with _ -> -1.0

let get_int obj name = int_of_float (get_float obj name)

let emit_changed host =
  ignore (call2 host "emit" (js_string footer_event) (Unsafe.inject Js.null))

let update_session_state host ctx =
  let previous_cwd = state.cwd in
  let snapshot = call1 host "sessionSnapshot" (inject ctx) in
  state.cwd <- get_string snapshot "cwd";
  state.provider <- get_string snapshot "provider";
  state.model <- get_string snapshot "model";
  state.thinking <- get_string snapshot "thinking";
  state.total_cost <- get_float snapshot "totalCost";
  state.context_percent <- get_float snapshot "contextPercent";
  state.context_window <- get_float snapshot "contextWindow";
  if previous_cwd <> "" && previous_cwd <> state.cwd then
    state.git_delta <- Model.empty_git_delta

let js_array_of_strings values =
  values |> List.map Js.string |> Array.of_list |> Js.array |> inject

let js_options ~cwd ~timeout =
  Unsafe.obj
    [|
      ("cwd", js_string cwd);
      ("timeout", js_number (float_of_int timeout));
    |]

let js_error_to_string error =
  try Js.to_string (Unsafe.coerce error) with _ -> "JavaScript promise rejected"

let await_js_result promise =
  let eta_promise, resolver = Eta_jsoo.Private.create_promise () in
  let resolve_ok =
    Js.wrap_callback (fun value ->
        Eta_jsoo.Private.resolve resolver (Ok value))
  in
  let resolve_error =
    Js.wrap_callback (fun error ->
        Eta_jsoo.Private.resolve resolver (Error (js_error_to_string error)))
  in
  ignore
    (Unsafe.meth_call promise "then"
       [| inject resolve_ok; inject resolve_error |]);
  Eta_jsoo.Private.await eta_promise

let run_numstat host cwd args =
  try
    let promise =
      call3 host "exec" (js_string "git") (js_array_of_strings args)
        (js_options ~cwd ~timeout:15000)
    in
    match await_js_result promise with
    | Error _ -> Model.empty_git_delta
    | Ok result ->
        if get_int result "code" <> 0 then Model.empty_git_delta
        else Model.parse_git_numstat (get_string result "stdout")
  with _ -> Model.empty_git_delta

let collect_git_line_delta host cwd =
  let unstaged =
    run_numstat host cwd [ "diff"; "--numstat"; "--no-ext-diff" ]
  in
  let staged =
    run_numstat host cwd [ "diff"; "--cached"; "--numstat"; "--no-ext-diff" ]
  in
  {
    Model.added = unstaged.added + staged.added;
    removed = unstaged.removed + staged.removed;
  }

let refresh_footer_hygiene host =
  Effect.sync (fun () ->
      if state.cwd = "" then ()
      else
        let cwd = state.cwd in
        let next = collect_git_line_delta host cwd in
        if state.cwd = cwd && next <> state.git_delta then (
          state.git_delta <- next;
          emit_changed host))

let colorize host theme color value =
  try
    Js.to_string
      (Unsafe.coerce
         (call3 host "themeFg" (inject theme) (js_string color) (js_string value)))
  with _ -> value

let snapshot_for_render host footer_data =
  let branch =
    try
      Js.to_string
        (Unsafe.coerce (call1 host "getGitBranch" (inject footer_data)))
    with _ -> ""
  in
  {
    Model.cwd = state.cwd;
    branch;
    filesystem_mode = state.filesystem_mode;
    git_delta = state.git_delta;
    provider = state.provider;
    model = state.model;
    thinking = state.thinking;
    total_cost = state.total_cost;
    context_percent = state.context_percent;
    context_window = state.context_window;
  }

let js_lines lines =
  lines |> List.map Js.string |> Array.of_list |> Js.array

let make_component host tui theme footer_data unsub_branch unsub_footer =
  let render =
    Js.wrap_callback (fun width_js ->
        let width = int_of_float (Js.to_float width_js) in
        let line =
          Model.render_line
            ~colorize:(colorize host theme)
            ~width
            (snapshot_for_render host footer_data)
        in
        js_lines [ line ])
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

let install_footer host ctx =
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

let register_handlers host =
  let update_handler install =
    Js.wrap_callback (fun _event ctx ->
        update_session_state host ctx;
        if install then install_footer host ctx;
        emit_changed host)
  in
  ignore (call2 host "on" (js_string "session_start") (inject (update_handler true)));
  ignore (call2 host "on" (js_string "session_switch") (inject (update_handler false)));
  ignore (call2 host "on" (js_string "model_select") (inject (update_handler false)));
  ignore
    (call2 host "on" (js_string "turn_end")
       (inject
          (Js.wrap_callback (fun _event ctx ->
               update_session_state host ctx;
               emit_changed host))));
  ignore
    (call2 host "on" (js_string "session_tree")
       (inject (Js.wrap_callback (fun _event _ctx -> emit_changed host))));
  ignore
    (call2 host "on" (js_string "session_fork")
       (inject (Js.wrap_callback (fun _event _ctx -> emit_changed host))));
  ignore
    (call2 host "eventsOn" (js_string "tau:sandbox:changed")
       (inject
          (Js.wrap_callback (fun payload ->
               let mode = get_string payload "filesystemMode" in
               state.filesystem_mode <-
                 (if mode = "" then "workspace-write" else mode);
               emit_changed host))))

let start_refresh_loop host =
  let rt = Runtime.create () in
  runtime := Some rt;
  let loop =
    Effect.repeat (Schedule.spaced (Duration.seconds 5))
      (refresh_footer_hygiene host)
  in
  Runtime.run rt loop ~on_result:(fun _ -> ())

let init host =
  register_handlers host;
  start_refresh_loop host

let () =
  let exported =
    Unsafe.obj [| ("init", inject (Js.wrap_callback init)) |]
  in
  Unsafe.set Unsafe.global "taumelFooter" exported
