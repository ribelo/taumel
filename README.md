# Taumel

Taumel is a Pi extension suite for controlled command execution, durable child
agents, goals, scheduled work, thread inspection, and external research tools.
It runs inside Pi and leaves provider interaction, the agent loop, retry,
compaction, and session lifecycle to the Pi host.

Taumel keeps policy and domain behavior in OCaml compiled with `js_of_ocaml`.
TypeScript defines the Pi extension boundary, validates tool contracts, renders
results, and performs host-side effects planned by the OCaml core.

## Why Taumel exists

Taumel adds capabilities that Pi does not own while preserving a strict host
boundary:

- Pi owns model calls, conversations, retries, compaction, and application UI.
- Taumel owns its tools, authorization policy, persisted component state, and
  asynchronous resources.
- OCaml decides policy and produces typed action plans; TypeScript adapts those
  plans to Pi APIs.

This split keeps policy testable without replacing or patching Pi's agent loop.

## Capabilities

| Area | What Taumel provides |
| --- | --- |
| Commands | PTY execution, stdin polling, sandbox policy, approvals, and path authorization |
| Agents | Durable generic agents plus read-only Finder and Oracle specialists |
| Automation | Goals, continuations, cron tasks, and Ralph loops |
| Inspection | Persisted thread search/read, system-prompt inspection, and OpenAI usage |
| Research | Exa search, crawling, code context, and asynchronous Exa Agent runs |
| Pi controls | Tool and skill visibility, composer settings, permissions, and compaction-model selection |
| Rendering | Compact and expanded TUI renderers for every Taumel tool and custom message |

## Requirements

- Pi with `@earendil-works/pi-coding-agent` compatible with `^0.79.9`
- Node.js and npm
- Nix with flakes enabled
- An Eta checkout at `../ocaml/Eta`, relative to this repository, or at
  `TAUMEL_ETA_PATH`

The Nix environment creates a shared OPAM switch under `~/.cache/opam`. The
default switch is OCaml `5.4.1`.

## Quick start

```bash
git clone https://github.com/ribelo/taumel.git
cd taumel
npm ci

# Point this at Eta when it is not checked out at ../ocaml/Eta.
export TAUMEL_ETA_PATH=/absolute/path/to/Eta

npm run ocaml:init
npm run build:ocaml

mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/taumel
```

Restart Pi after the first installation. The built extension entry point is
`dist/extension.js`; the compiled OCaml artifact is `dist/taumel.cjs`.

Inside Pi, initialize Taumel's global defaults and inspect the installation:

```text
/taumel init
/taumel
```

## Usage

Taumel exposes model-callable tools automatically after Pi loads the extension.
Use slash commands for local inspection and configuration.

| Command | Purpose |
| --- | --- |
| `/taumel` | Show status and configuration diagnostics |
| `/taumel init` | Add missing global Taumel defaults |
| `/permissions` | Configure sandbox, approval, and agent/tool access |
| `/network` | Enable or disable sandbox network access |
| `/composer` | Configure the Taumel composer UI |
| `/goal` | Inspect or update the current thread goal |
| `/cron` | List and manage scheduled tasks |
| `/agent-runs` | Inspect, stop, or close child agents and runs |
| `/tools` | Inspect and configure Taumel tool visibility |
| `/skills` | Inspect and configure skill visibility |
| `/execpolicy` | Inspect command-policy decisions |
| `/compaction-model` | Select the model used for compaction |
| `/system-prompt` | Inspect Pi's effective system prompt |
| `/usage` | Inspect OpenAI Codex account usage |
| `/ralph` | Manage Ralph tasks |

Model-facing agent workflow:

```text
agent_spawn({ message: "Inspect the failing build", description: "Inspect failing build", tier: "medium" })
agent_wait({ run_ids: ["agent-ab12-run-1"], timeout_seconds: 30 })
agent_send({ agent_id: "agent-ab12", message: "Check the parser next", description: "Check parser next" })
agent_close({ agent_id: "agent-ab12" })
```

Agent IDs and run IDs come from tool results; the values above are examples.
Finder and Oracle use the same durable identity and run lifecycle as generic
agents, but apply fixed specialist instructions and read-only authority.

## Configuration

Taumel stores configuration under the `taumel` object in Pi JSON settings:

| Scope | Path | Use |
| --- | --- | --- |
| Global | `~/.pi/agent/settings.json` | User defaults and composer state |
| Project | `<project>/.pi/settings.json` | Trusted-project overrides |

`/taumel init` adds only missing global defaults and preserves unrelated Pi
settings and unknown Taumel keys.

```json
{
  "taumel": {
    "composer": {
      "enabled": true
    },
    "tools": {
      "disabled": []
    },
    "skills": {
      "disabled": []
    }
  }
}
```

Configuration precedence is:

1. Session/runtime state
2. Trusted project settings
3. Global settings

Taumel reads project settings only for trusted projects. Runtime configuration
does not use a separate Taumel settings file or environment-variable override.

### Build-time environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TAUMEL_ETA_PATH` | `../ocaml/Eta` | Eta checkout used for local OPAM pins |
| `TAUMEL_OPAM_SWITCH` | `5.4.1` | Shared OPAM switch name |
| `OPAMROOT` | `~/.cache/opam` | Shared OPAM root |
| `TAUMEL_ETA_PACKAGES` | `eta eta_http eta_jsoo eta_http_js` | Eta packages pinned during initialization |

These variables affect development setup, not runtime configuration.

## Data and storage

Taumel keeps session-scoped state in Pi session entries. This includes goals,
cron state, visibility state, and durable agent metadata.

Child agents use private Pi child sessions. Parent and child conversations stay
independent; only explicit parent messages and returned child responses cross
the boundary.

Configuration remains in Pi's global and project settings files. Taumel does not
maintain a separate global database.

## Safety and limits

- Command and mutation tools can execute processes and modify files. Review
  `/permissions`, `/network`, and `/execpolicy` before enabling broad access.
- Project configuration is ignored until Pi trusts the project.
- Child agents do not inherit the parent's transcript. Include all required
  context in the message sent to the child.
- Agent nesting depth is one. Child agents cannot create or control other child
  agents.
- Finder and Oracle are fixed built-ins. User-authored specialist definitions
  and prompt overrides are not supported.
- `npm run ocaml:init` pins Eta packages from the configured local checkout. A
  missing or incompatible Eta checkout stops initialization.
- Pi cannot load Taumel without `dist/extension.js` and `dist/taumel.cjs`.
  Rebuild after changing TypeScript, embedded Markdown resources, or OCaml code.

## Design choices

| Choice | Reason | Rejected alternative |
| --- | --- | --- |
| Pi extension instead of a Pi fork | Keep host lifecycle and provider behavior upstream-owned | Reimplement or patch Pi's agent loop |
| OCaml policy core with a TypeScript adapter | Keep policy deterministic while using Pi's TypeScript API | Put policy and host effects in one untyped layer |
| Typed bridge contracts | Detect OCaml/TypeScript drift at build and decode boundaries | Pass generic records across the bridge |
| Pi session entries for state | Preserve state with the conversation that owns it | Maintain a competing global session database |
| Durable asynchronous agents | Support waiting, continuation, and explicit closure | Treat every delegated task as a disposable process |

See [`CONTEXT.md`](CONTEXT.md) for the domain vocabulary and `docs/requirements/` for the
behavioral requirement sets.

## Development

Install dependencies and initialize the OCaml environment once:

```bash
npm ci
npm run ocaml:init
```

Use the repository scripts as the authoritative development interface:

| Check | Command |
| --- | --- |
| Full quality gate | `npm run gate` |
| TypeScript typecheck | `npm run typecheck` |
| Typed-boundary check | `npm run check:typed-boundaries` |
| Build OCaml artifact | `npm run build:ocaml` |
| OCaml tests | `npm run test:ocaml` |
| Tool-renderer smoke test | `npm run smoke:tool-renderers` |
| Agent lifecycle smoke test | `npm run smoke:agent-lifecycle` |

The repository has no separate lint or format script. `npm run gate` is the
required pre-commit verification and runs type checking, bridge checks, the
OCaml build/tests, and all smoke suites.

## Troubleshooting

### `Eta checkout not found`

Set an absolute path and rerun initialization:

```bash
export TAUMEL_ETA_PATH=/absolute/path/to/Eta
npm run ocaml:init
```

### Pi cannot load the built extension

Build the extension and OCaml artifact, then restart or reload Pi:

```bash
npm run build
```

### Taumel commands are missing

Verify the extension link and inspect status after restarting Pi:

```bash
readlink -f ~/.pi/agent/extensions/taumel
```

```text
/taumel
```

### Configuration is malformed

Run `/taumel` to see the source path and invalid key. Correct the reported JSON
value; `/taumel init` preserves malformed known values rather than overwriting
them.

### A child agent cannot see parent context

Send the missing context explicitly with `agent_send`. Parent and child
transcripts are intentionally isolated.

## License

MIT
