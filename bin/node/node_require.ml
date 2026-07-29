(** Canonical Node module loader. Prefers [process.getBuiltinModule] when the
    host provides it (bun / newer node) and it resolves the module; otherwise
    falls back to lexical/global [require] so third-party packages like
    [node-pty] still load. *)

external js_expr : string -> Ojs.t = "caml_js_expr"

let is_nullish value =
  Ojs.is_null value || Ojs.type_of value = "undefined"

let call_require name =
  (* Prefer the lexical CommonJS [require] binding (node/jsoo bundle scope),
     then [globalThis.require]. Matching the historical jsoo_bridge /
     exec_process loaders keeps third-party packages resolvable. *)
  let req =
    js_expr
      "(typeof require === 'function' ? require : (typeof globalThis !== \
       'undefined' && typeof globalThis.require === 'function' ? \
       globalThis.require : null))"
  in
  if is_nullish req || Ojs.type_of req <> "function" then
    invalid_arg ("Node_require.require: require is unavailable for " ^ name)
  else Ojs.apply req [| Ojs.string_to_js name |]

let require name =
  let process = Ojs.get_prop_ascii Ojs.global "process" in
  let get_builtin = Ojs.get_prop_ascii process "getBuiltinModule" in
  if Ojs.type_of get_builtin = "function" then
    let loaded = Ojs.apply get_builtin [| Ojs.string_to_js name |] in
    if is_nullish loaded then call_require name else loaded
  else call_require name
