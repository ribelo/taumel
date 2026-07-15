---
kind: requirement
tags: [shared-infrastructure, persistence]
depends_on: ["[[docs/requirements/capability-profile]]", "[[docs/requirements/tool-gateway]]"]
---
# Shared infrastructure

## Intent

Shared infrastructure provides the low-level primitives several components need:
atomic writes, file locking, JSON helpers, settings discovery, model id parsing,
formatters, and small Pi adapter helpers. Each component owns its own typed
persisted state; shared persistence stays infrastructure only. Authorization
lives in the capability profile and tool gateway, never in active-tool mutation.

## Requirements

- The system shall provide atomic file writes, file locks, JSON encode/decode helpers, settings discovery, model id parsing, formatters, decoded-tool helpers, a message-injection helper, and session-reference helpers. ^shared-pr01
- The system shall let each component own its typed persisted state and shall keep shared persistence limited to read, write, lock, and discovery, with no monolithic shared state object. ^shared-st01
- The system shall keep one loaded-session state for Pi's currently active main session and shall not maintain a general in-memory map of component state for every visited session. ^shared-st02
- When a synchronous Taumel call begins with a live Pi context, the system shall load or validate the component state for that context's session before reading or mutating session-scoped state. ^shared-st03
- If a callback carries a stale or replaced Pi context, then the system shall fail closed without reading, mutating, persisting, or delivering through the loaded-session state. ^shared-st04
- The system shall give every asynchronous resource that can outlive its initiating call an explicit parent-session owner and shall authorize later observation, control, persistence, and notification delivery against that owner. ^shared-st05
- A live owned child resource shall carry the owner permission state required to authorize its side effects while its parent session is not loaded; this resource-local state shall not become a general cache of unloaded component state. ^shared-st07
- If a callback belongs to an unloaded parent session, then the system shall not authorize it from the currently loaded session's permissions, profile, workspace, or visibility state. ^shared-st08
- When an owner session becomes loaded again, the system shall reconcile its persisted and current permission envelope into its live owned child resources before accepting further parent control or delivering owner-scoped events through that session. ^shared-st09
- If an owned asynchronous resource requires interactive approval while its owner session is not loaded, then the system shall treat approval as unavailable rather than route the interaction through the currently loaded session. ^shared-st10
- The system shall store Taumel JSON configuration only under the `taumel` object in Pi config JSON, using global `~/.pi/agent/settings.json` for user-global settings and project `<cwd>/.pi/settings.json` for project-scoped settings. ^shared-cf01
- The system shall not read or write `~/.pi/agent/taumel/settings.json`. ^shared-cf02
- The system shall store composer UI enabled state only in global Pi config under `taumel.composer.enabled`. ^shared-cf03
- The system shall not read project Pi config for composer UI enabled state, and project composer settings shall have no effect. ^shared-cf04
- When the user runs `/taumel init`, the system shall create missing global composer default `taumel.composer.enabled = true`. ^shared-cf15
- When a Taumel setting has more than one source, the system shall resolve it in this precedence: session/runtime settings first, trusted project Pi config second, and global Pi config third. ^shared-cf05
- The system shall read project Pi config for Taumel settings only while the project is trusted, and shall not write project Pi config while the project is untrusted. ^shared-cf06
- If one known Taumel config item is malformed, then the system shall warn with the source scope/path and config key or item name, skip only that malformed item, and keep valid items from the same and other sources working. ^shared-cf07
- The system shall ignore unknown Taumel config keys, preserve them on writes, and emit no warning for their presence. ^shared-cf08
- Runtime Taumel config discovery shall not use `TAUMEL_SETTINGS_PATH` or any Taumel-specific environment variable as an additional config source. ^shared-cf09
- When the user runs `/taumel init`, the system shall initialize only missing global Taumel config defaults under `taumel.*` in `~/.pi/agent/settings.json`, preserve existing keys and malformed known values unchanged, and report the global config path and initialized keys. ^shared-cf10
- When `/taumel init` finds no missing global Taumel config defaults, the system shall leave the file unchanged and report that global Taumel config is already initialized. ^shared-cf16
- `/taumel init` shall be global-only and shall never create or edit project `.pi/settings.json`. ^shared-cf11
- When the user runs `/taumel` with no arguments, the system shall show compact Taumel status without writing config: global config path, initialization state, missing default groups if any, and active Taumel command/tool capability groups; it shall point to `/taumel init` when global defaults are missing. ^shared-cf12
- `/taumel` status shall include malformed known Taumel config diagnostics with source path/scope and config key or item name, without stack traces. ^shared-cf18
- `/taumel init` shall still initialize missing defaults that do not sit underneath a malformed parent, so one malformed known config item blocks only its own subtree. ^shared-cf19
- When `/taumel init` runs and `~/.pi/agent/settings.json` is missing, the system shall create it atomically with only the missing Taumel global defaults. ^shared-cf17
- `/taumel init` shall not create optional behavioral settings with no safe universal default, such as `taumel.compaction.model`. ^shared-cf14
- The system shall treat Pi active-tool helpers as exposure hints and enforce authorization through the capability profile and tool gateway. ^shared-au01
- The system shall keep shared helpers free of knowledge of goal, Ralph, sandbox, memory, and backlog, and shall prefer explicit component dependencies over a global service graph. ^shared-dp01
- The system shall let a component persist state without importing unrelated component types. ^shared-ts01
- Every OCaml-to-TypeScript bridge response shall use a TypeBox transport schema that generates its OCaml builder through `ts2ocaml` and `gen_js_api` and its TypeScript static type and runtime decoder; production TypeScript shall not consume bridge responses as generic records or inspect them with `isRecord`. ^shared-ts02
- Raw Pi host values may enter only through small typed adapter functions; after adaptation, production TypeScript shall not pass `unknown`, `Record<string, unknown>`, or ad-hoc object-shape checks into application logic. ^shared-ts03
- The system shall register `/taumel` as a visible local command for Taumel status and initialization. ^shared-2hck
