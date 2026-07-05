---
kind: requirement
status: draft
tags: [shared-infrastructure, persistence]
depends_on: ["[[plans/capability-profile]]", "[[plans/tool-gateway]]"]
---
# Shared infrastructure

## Intent

Shared infrastructure provides the low-level primitives several components need:
atomic writes, file locking, JSON helpers, settings discovery, model id parsing,
formatters, and small Pi adapter helpers. Each component owns its own typed
persisted state; shared persistence stays infrastructure only. Authorization
lives in the capability profile and tool gateway, never in active-tool mutation.

## Requirements

- **shared-pr01** (ubiquitous): The system shall provide atomic file writes, file locks, JSON encode/decode helpers, settings discovery, model id parsing, formatters, decoded-tool helpers, a message-injection helper, and session-reference helpers.
- **shared-st01** (ubiquitous): The system shall let each component own its typed persisted state and shall keep shared persistence limited to read, write, lock, and discovery, with no monolithic shared state object.
- **shared-cf01** (ubiquitous): The system shall store Taumel JSON configuration only under the `taumel` object in Pi config JSON, using global `~/.pi/agent/settings.json` for user-global settings and project `<cwd>/.pi/settings.json` for project-scoped settings.
- **shared-cf02** (ubiquitous): The system shall not read or write `~/.pi/agent/taumel/settings.json`.
- **shared-cf03** (ubiquitous): The system shall store composer UI enabled state only in global Pi config under `taumel.composer.enabled`.
- **shared-cf04** (ubiquitous): The system shall not read project Pi config for composer UI enabled state, and project composer settings shall have no effect.
- **shared-cf15** (event-driven): When the user runs `/taumel init`, the system shall create missing global composer default `taumel.composer.enabled = true`.
- **shared-cf05** (ubiquitous): When a Taumel setting has more than one source, the system shall resolve it in this precedence: session/runtime settings first, trusted project Pi config second, and global Pi config third.
- **shared-cf06** (ubiquitous): The system shall read project Pi config for Taumel settings only while the project is trusted, and shall not write project Pi config while the project is untrusted.
- **shared-cf07** (unwanted): If one known Taumel config item is malformed, then the system shall warn with the source scope/path and config key or item name, skip only that malformed item, and keep valid items from the same and other sources working.
- **shared-cf08** (ubiquitous): The system shall ignore unknown Taumel config keys, preserve them on writes, and emit no warning for their presence.
- **shared-cf09** (ubiquitous): Runtime Taumel config discovery shall not use `TAUMEL_SETTINGS_PATH` or any Taumel-specific environment variable as an additional config source.
- **shared-cf10** (event-driven): When the user runs `/taumel init`, the system shall initialize only missing global Taumel config defaults under `taumel.*` in `~/.pi/agent/settings.json`, preserve existing keys and malformed known values unchanged, and report the global config path and initialized keys.
- **shared-cf16** (event-driven): When `/taumel init` finds no missing global Taumel config defaults, the system shall leave the file unchanged and report that global Taumel config is already initialized.
- **shared-cf11** (ubiquitous): `/taumel init` shall be global-only and shall never create or edit project `.pi/settings.json`.
- **shared-cf12** (event-driven): When the user runs `/taumel` with no arguments, the system shall show compact Taumel status without writing config: global config path, initialization state, missing default groups if any, and active Taumel command/tool capability groups; it shall point to `/taumel init` when global defaults are missing.
- **shared-cf18** (event-driven): `/taumel` status shall include malformed known Taumel config diagnostics with source path/scope and config key or item name, without stack traces.
- **shared-cf13** (event-driven): When `/taumel init` needs a missing parent object such as `taumel` or `taumel.agents`, the system shall create that object; if an existing parent value is malformed, the system shall preserve it unchanged, warn with the path/key, and skip defaults underneath that parent.
- **shared-cf19** (event-driven): `/taumel init` shall still initialize missing defaults that do not sit underneath a malformed parent, so one malformed known config item blocks only its own subtree.
- **shared-cf17** (event-driven): When `/taumel init` runs and `~/.pi/agent/settings.json` is missing, the system shall create it atomically with only the missing Taumel global defaults.
- **shared-cf14** (ubiquitous): `/taumel init` shall not create optional behavioral settings with no safe universal default, such as `taumel.compaction.model`.
- **shared-au01** (ubiquitous): The system shall treat Pi active-tool helpers as exposure hints and enforce authorization through the capability profile and tool gateway.
- **shared-dp01** (ubiquitous): The system shall keep shared helpers free of knowledge of goal, Ralph, sandbox, memory, and backlog, and shall prefer explicit component dependencies over a global service graph.
- **shared-ts01** (ubiquitous): The system shall let a component persist state without importing unrelated component types.
- **shared-cmd01** (ubiquitous): The system shall register `/taumel` as a visible local command for Taumel status and initialization.
