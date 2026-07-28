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
module by module — never as a single rewrite.

## Requirements

- The system shall reduce raw `Unsafe` usage only where doing so simplifies interop; the system shall not pursue total `Unsafe` elimination, and typed wrappers shall not add complexity beyond the safety they provide. ^eta-6b4o

- The system shall route every JavaScript promise, callback, and timer entering the OCaml core through shared jsoo-bridge adapters that expose Eta values; OCaml modules outside the bridge shall not call JavaScript promise, callback, or timer APIs directly. ^eta-5ihg
- The system shall provide bridge adapters that convert a JavaScript promise to an Eta awaitable, a JavaScript event registration to an Eta-consumable source, and a JavaScript timer to an Eta schedule. ^eta-sxp9
- The system shall convert exec-session waiting, notification, and output-drain coordination to `Eta.Promise` and `Eta.Effect`, preserving the waiter-release, notification-claim, consumption, and flush semantics required by the exec-command note. ^eta-ue32
- The exec-session Eta conversion shall be verified by deterministic tests covering waiter release exactly once, notification claim and restore, delta and status consumption, turn-end flush, and kill during wait. ^eta-4b69
- When a module outside the bridge is found to call JavaScript async APIs directly, the system shall convert that usage through the bridge adapters; conversion shall proceed continuously and per module rather than as a single rewrite. ^eta-ednd
- When a TypeScript-side orchestration module is revised, the system shall move its orchestration logic to the OCaml core on Eta and keep TypeScript as the thinnest pi adapter. ^eta-bd25
