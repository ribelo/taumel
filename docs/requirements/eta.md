---
kind: requirement
tags: [eta, async, architecture]
depends_on: ["[[docs/requirements/engineering-standards]]", "[[docs/requirements/exec-command]]"]
---
# Eta asynchronicity

## Intent

Eta is the async substrate of the OCaml core: one bridge owns JavaScript
interop and exposes Eta values, and internal modules compose Eta effects and
promises instead of touching JavaScript async APIs. TypeScript stays the
thinnest pi adapter; its orchestration logic belongs in the core and moves
there as modules are revised. The migration is gardener's-method: the target
shape is declared here, and the codebase is pruned toward it continuously,
module by module — never as a single rewrite. Every asynchronous child has an
explicit scope, and cancellation crosses host doors instead of abandoning live
promises, listeners, timers, or processes.

## Requirements

- The system shall reduce raw `Unsafe` usage only where doing so simplifies interop; the system shall not pursue total `Unsafe` elimination, and typed wrappers shall not add complexity beyond the safety they provide. ^eta-6b4o

- The system shall route every JavaScript promise, callback, and timer entering the OCaml core through shared jsoo-bridge adapters that expose Eta values; OCaml modules outside the bridge shall not call JavaScript promise, callback, or timer APIs directly. ^eta-5ihg
- The system shall provide bridge adapters that convert a JavaScript promise to an Eta awaitable, a JavaScript event registration to an Eta-consumable source, and a JavaScript timer to an Eta schedule. ^eta-sxp9
- The system shall convert exec-session waiting, notification, and output-drain coordination to `Eta.Promise` and `Eta.Effect`, preserving the waiter-release, notification-claim, consumption, and flush semantics required by the exec-command note. ^eta-ue32
- The exec-session Eta conversion shall be verified by deterministic tests covering waiter release exactly once, notification claim and restore, delta and status consumption, turn-end flush, and kill during wait. ^eta-4b69
- When a module outside the bridge is found to call JavaScript async APIs directly, the system shall convert that usage through the bridge adapters; conversion shall proceed continuously and per module rather than as a single rewrite. ^eta-ednd
- When a TypeScript-side orchestration module is revised, the system shall move its orchestration logic to the OCaml core on Eta and keep TypeScript as the thinnest pi adapter. ^eta-bd25
- The system shall provide a typed Node.js interop layer of `gen_js_api` bindings covering the Node APIs the core actually uses — fs, path, os, process, Buffer, and child_process — rather than binding whole API surfaces speculatively. ^eta-4u1e
- OCaml modules shall consume the typed Node layer for the APIs it covers and shall not call those APIs through raw `Unsafe`; `Unsafe` remains acceptable only for interop the layer does not cover, per **eta-6b4o**. ^eta-pw57
- Every fiber, promise, timer, event listener, and host process started by Taumel asynchronous activity shall belong to an explicit scope; when that scope exits, the system shall cancel and await its children, remove its listeners, and terminate its host operations before reporting scope completion. ^eta-feaq
- When Eta interruption cancels an awaited JavaScript promise whose host operation supports cancellation, the shared host door shall invoke that host cancellation and shall not merely detach the Eta waiter. ^eta-hu56
