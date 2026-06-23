# Agent PRD

## What It Is

Taumel agents are durable child sessions owned by a parent session. A parent can
spawn an agent with a typed profile, send additional objectives to the same
agent, wait for active runs, inspect status, and close the agent permanently.

The design follows Kimi's subagent UX where it fits Taumel, Tau's sandbox and
approval model, and Taumel's current requirement that TypeScript stays a small
Pi bridge while OCaml owns planning/state. One intentional divergence from Tau:
Taumel depth is exactly one, so child sessions never receive agent tools.

## Goals

- Replace the overloaded legacy `agent` tool. No backwards compatibility.
- Make agent execution asynchronous by default.
- Keep child transcript/tool logs out of the parent model context by default.
- Let child tools run under the child session sandbox and approval flow.
- Let child sessions request escalation from the user, not from the parent
  agent.
- Support explicit profile-defined provider/model/thinking/tools/sandbox.
- Fail profile and tool-surface problems at startup, not during a later agent
  run.
- Keep nesting depth exactly one.
- Keep model-visible tool schemas and system prompt text stable across
  per-session agent toggles so provider prompt caching is not invalidated by
  `/agents`.

## Non-Goals

- No agent swarms/farms in this implementation.
- No project-local Markdown agent profiles initially.
- No runtime fallback for missing profile fields.
- No per-call model/tool/sandbox overrides.
- No subagent ability to spawn subagents.
- No parent-tool allowlist intersection for child profile tools.
- No raw child transcript injection into parent context by default.

## References

- Kimi:
  - `/home/ribelo/projects/github/kimi-code/packages/agent-core/src/tools/builtin/collaboration/agent.ts`
  - `/home/ribelo/projects/github/kimi-code/packages/agent-core/src/session/subagent-host.ts`
  - `/home/ribelo/projects/github/kimi-code/packages/agent-core/src/profile`
- Tau:
  - `/home/ribelo/projects/ribelo/tau/extensions/tau/src/agent/tool.ts`
  - `/home/ribelo/projects/ribelo/tau/extensions/tau/src/agent/tool-allowlist.ts`
  - `/home/ribelo/projects/ribelo/tau/extensions/tau/src/agent/worker/lifecycle.ts`
  - `/home/ribelo/projects/ribelo/tau/extensions/tau/src/agent/approval-broker.ts`
  - `/home/ribelo/projects/ribelo/tau/extensions/tau/src/sandbox`
- Codex:
  - `/home/ribelo/projects/github/codex/core/src/tools/handlers/task.rs`

## Tool Surface

The legacy single `agent` action multiplexer is removed.

New model tools:

- `agent_spawn`
- `agent_send`
- `agent_wait`
- `agent_list`
- `agent_close`
- `agent_profiles`

No agent tools are registered in subagent sessions.

This is stronger than Tau's current worker implementation. Tau can include the
agent tool in worker custom tools and rely on depth/spawn policy. Taumel makes
nesting impossible by construction: child session tool registration and
active-tool rewriting both remove the agent tools.

### `agent_spawn`

Creates a durable agent identity and starts one run. It never waits.

Inputs:

- `profile`: required profile name.
- `objective`: required full task objective.
- `description`: optional short UI label.
- `agent_id`: optional requested stable id.

No `provider`, `model`, `thinking`, `tools`, or `sandbox` fields are accepted.
Those belong to the profile.

Output includes:

- `agent_id`
- `run_id`
- `profile`
- `status = running`

### `agent_send`

Sends an objective/message to an existing, non-closed agent.

Inputs:

- `agent_id`: required.
- `objective`: required.
- `interrupt`: optional boolean.

The agent keeps its original profile. `profile`, `provider`, `model`,
`thinking`, `tools`, and `sandbox` are not accepted.

Default behavior follows Tau/Kimi style: if the agent has an active run,
`agent_send` steers the message into that active child session through Pi's
steering mechanism. It does not fail just because the child is busy, and it does
not create a second active run for the same agent.

With `interrupt = true`, Taumel cancels the active run with reason
`interrupted_by_parent` and starts a new run for the sent objective.
The interrupted run remains in history with its Pi-backed transcript/log
preserved by the child session machinery; Taumel records the terminal status and
references, not a copied transcript.

If the agent identity is open and has no active run, `agent_send` is allowed
regardless of the previous terminal run state (`completed`, `failed`,
`cancelled`, `timed_out`, or `lost`). It creates a new `run_id`; it never
restarts or rewrites the previous run. If a lost child runtime must be recreated
behind the same `agent_id`, that is still a new run, not a resumed old run.

Output includes:

- `agent_id`
- `run_id`
- `submission_id`
- delivery kind: `steered` for active runs, `started` for new runs
- previous run status when interrupted
- `status = running`

### `agent_wait`

Waits for active work. Waiting is unlimited by default.

Inputs:

- `run_ids`: optional exact run ids.
- `agent_ids`: optional agents whose active runs should be waited on.
- `timeout_seconds`: optional wait-call timeout.

Selector rules:

- Exactly one selector kind may be provided.
- Omitted selector means all active runs owned by this session.
- `run_ids` waits for exactly those runs, including already-terminal runs.
- `agent_ids` waits for the currently active run on each agent.
- Agents with no active run are reported as `no_active_run`.
- If the selector resolves to no active runs, `agent_wait` returns a successful
  status result such as `no_active_runs`; it is not a tool error.
- Waiting is run-based, not submission-based. `submission_id` is a trace/UI
  marker; it is not accepted as an `agent_wait` selector.

Omitted `timeout_seconds` means wait indefinitely. `timeout_seconds = 0` means
poll once without blocking. Positive values wait up to that many seconds.

`timeout_seconds` and user interruption affect only the wait call. They do not
stop child runs.

If the user presses Escape while `agent_wait` is pending, Taumel interrupts only
the wait call and returns an interrupted wait result. Child runs continue in the
background and still produce completion notifications later.

Model-facing output contains final child answers and run metadata only. It does
not include raw child transcript, child tool logs, or hidden reasoning.

### `agent_list`

Lists agents owned by the current session and their latest run state.

This is the model-facing run/identity inspection tool. It does not report
profile availability or enabled/disabled profile state; use `agent_profiles`
for that.

Inputs:

- `include_closed`: optional boolean, default `false`.

Default output includes only open agent identities. With
`include_closed = true`, closed identities are included for audit/history.

Output includes:

- `agent_id`
- profile
- lifecycle
- active/latest `run_id`
- run state
- elapsed time
- compact final summary/error when terminal

### `agent_close`

Permanently closes agent identities.

Inputs:

- `agent_ids`: one or more ids, or `all`.

If an agent has an active run, that run is cancelled with reason
`closed_by_parent`. The agent identity becomes closed and cannot be resumed.
Historical run output remains inspectable through listing/status surfaces.

`all` means every open agent identity owned by the current session, including
agents whose latest run is already terminal.

### `agent_profiles`

Returns the currently valid profile catalog and per-session enabled state. This
is the model-callable availability surface.

Output includes:

- profile name
- description
- enabled/disabled state for this parent session
- disabled reason, when disabled
- sandbox summary
- tool summary

The `agent_profiles` tool has stable schema and stable description. `/agents`
toggles do not mutate the model tool schema or the system prompt. If the model
calls `agent_spawn` for a disabled profile, the spawn fails with a clear
model-visible error that says the profile is disabled for this session and the
user can enable it with `/agents enable <profile>`.

Disabled profiles are included in `agent_profiles` output with
`enabled = false`; they are not hidden.

This tool does not report existing agent identities, active runs, or run output;
use `agent_list` and `agent_wait` for those.

## User Commands

Human control is split into two slash command namespaces:

- `/agents`
- `/agents list`
- `/agents enable <profile>`
- `/agents disable <profile>`
- `/agent-runs`
- `/agent-runs stop <agent-id|run-id|all>`
- `/agent-runs close <agent-id|all>`
- `/agent-runs output <agent-id|run-id>`

The primary UX is `/agents` without arguments. It opens a Tau-style interactive
menu when a UI is available. The menu supports searching profiles, seeing each
profile description, and toggling profiles on/off for the current session.
Toggles apply immediately and persist immediately to the session file; there is
no staged dirty state or separate save step. The command forms are secondary
fallbacks for non-interactive use and scripting.
The menu includes all startup-valid profiles, built-in and user-defined. Profile
origin may be displayed, but toggling behavior is the same for both.

`/agent-runs` is the separate menu for existing agent identities and runs. It
supports inspecting running/completed agents, stopping active runs, closing
agent identities, and opening final output. Its command forms are secondary
fallbacks for non-interactive use and scripting. It shows open identities by
default and has an explicit filter/toggle for closed history. Raw transcript/log
access is a separate human-explicit action; exact UI details are deferred.

`enable` and `disable` affect the current parent session only and are persisted
in the session file. `stop` interrupts active runs and keeps agents resumable.
`close` permanently closes identities.

Disabling a profile prevents new `agent_spawn` calls for that profile. It does
not block `agent_send` to an existing agent, and it does not cancel or close
already-running agents that were spawned before the profile was disabled.
Existing agent identities keep their immutable profile and child session context
until closed, even if their profile is later disabled for new spawns.

## Data Model

### Agent Identity

Durable until explicitly closed.

Fields:

- `agent_id`
- parent session id/file
- profile name
- live child session id, when attached
- created timestamp
- closed timestamp, when closed

Each open agent identity owns one Pi child session. That child session is reused
across runs and `agent_send` calls so the agent keeps local context while it is
alive. Taumel does not create a fresh child session per run.

Child sessions are Tau-style worker sessions created through Pi's SDK
(`createAgentSession`) with their own `AgentSession` and an in-memory session
manager, matching Tau. They are not created with
`ExtensionCommandContext.newSession()`, because that API replaces the visible
parent session and returns a replacement command context. Agent workers must not
navigate the user's main session as a side effect of spawning or sending to a
child.

The TypeScript side owns the unavoidable Pi SDK calls for creating, steering,
aborting, and disposing worker `AgentSession` instances. OCaml owns the typed
agent state machine, profile resolution/snapshot planning, run/submission
metadata, and decisions about what action should happen next.

Provider, model, thinking, tools, sandbox, and prompt are resolved at
`agent_spawn` time and snapshotted into the agent identity. Later profile or
config changes affect only future spawns, not existing open agents.

If the Pi child session is lost after process exit/resume, Taumel does not
auto-recreate it during `/resume`. A later `agent_send` may create a new child
runtime behind the same open `agent_id`, recorded as a new run.

Because child sessions are in-memory in this implementation, `taumel.agents`
persists run metadata and final output references/values needed for resume and
menus, but it does not promise durable raw child transcripts across process
exit. Active runs become `lost` on resume unless a live worker is attached.
Durable hidden child-session files are out of scope for this PRD.

Agent ids are not reusable within a session. If an id was ever used by an open
or closed identity, `agent_spawn` with that requested `agent_id` fails.

When `agent_spawn` omits `agent_id`, Taumel generates one as
`<profile>-<shortid>`, for example `finder-k7p2`. The short id uses a small
lowercase unambiguous alphabet, is 4-6 characters long, and retries on
collision. Generated ids also follow the no-reuse rule.

User-provided `agent_id` values are allowed but strictly parsed: lowercase
letters, digits, and hyphen only; must start with a letter; bounded length; no
reuse within the session.

Multiple open agents may use the same profile at the same time. `agent_id`, not
profile name, is the unique identity boundary.

### Run

One contiguous child execution episode for an agent. A run starts from an
initial objective and may receive additional submissions through steering while
it remains active.

Fields:

- `run_id`
- `agent_id`
- objective
- submissions sent to the run
- description
- status
- reason, when terminal failure/cancellation has a reason
- final output, when available
- parent delivery state
- created/started/completed timestamps

Each `agent_spawn` and `agent_send` creates a `submission_id`. A submission is a
message/objective delivered to an agent. If the agent has an active run, the
submission belongs to that active run and is delivered by steering. If the agent
is idle, the submission starts a new run. Submissions are trace/UI markers; the
terminal result belongs to the run.

Run statuses:

```text
queued
running
suspended
completed
failed
cancelled
timed_out
lost
```

`completed` means the latest assigned task finished. It does not mean the agent
identity is dead. The same `agent_id` can receive another run via `agent_send`
until it is closed.

On `/resume`, any run that was persisted as `queued`, `running`, or `suspended`
but has no live worker in the current process becomes `lost`. The agent identity
remains resumable unless it was closed. Taumel does not auto-restart lost runs.

## Profile Files

Agent profiles are Markdown files with YAML frontmatter. The Markdown body is
the agent system prompt.

Built-in profiles ship with Taumel. They match Tau's built-in agent set:

- `smart`
- `deep`
- `rush`
- `finder`
- `librarian`
- `oracle`
- `painter`
- `review`

There is no `plan` agent.

The built-ins use Tau's agent names and roles, but their Taumel prompts and tool
lists must be edited to match Taumel's depth-one design. Any Tau prompt text
that tells a child to spawn/delegate to other agents must be removed from the
Taumel built-ins, and no built-in child profile may include agent tools.

User profiles live under:

```text
~/.pi/agent/taumel/agents/*.md
```

Project-local profiles are not part of the first implementation.

Example:

```markdown
---
name: finder
description: Fast read-only codebase exploration
provider: openrouter
model: deepseek/deepseek-v4-flash
thinking: low
sandbox: read-only
tools:
  - exec_command
  - find_thread
  - read_thread
---

You are a read-only codebase search agent...
```

Required frontmatter fields:

- `name`
- `description`
- `provider`
- `model`
- `thinking`
- `sandbox`
- `tools`

Explicit inheritance is allowed where agreed:

```yaml
provider: inherit
model: inherit
thinking: inherit
sandbox: inherit
tools: inherit
```

No field may be omitted. Omission is a profile error.

This is not Tau's frontmatter format. Taumel does not accept `models`,
`spawns`, or `approval_timeout` in profile Markdown. Those keys are startup
validation errors. Provider, model, thinking, sandbox, and tools must be
single explicit fields so there is one resolved profile shape.

Field rules:

- `provider`: `inherit` or concrete provider id.
- `model`: `inherit` or concrete model id for the selected provider.
- `thinking`: `inherit` or concrete Pi thinking level.
- `sandbox`: `inherit`, `read-only`, or `workspace-write`.
  `danger-full-access` is not a valid subagent profile value.
- `tools`: `inherit` or a non-empty array of tool names.

`provider` and `model` are an atomic routing pair. They must either both be
`inherit` or both be concrete strings. `provider: inherit` with a concrete
`model`, or a concrete `provider` with `model: inherit`, is a startup validation
error. `thinking` remains independently inheritable.

Built-in profile names are reserved for Markdown files. A user Markdown profile
with a built-in name is an error.

Built-in profile model routing may be overridden only from config JSON, not from
Markdown files.

## Config Overrides

Pi config JSON may override built-in profile model routing without replacing
the profile prompt, tools, or sandbox definition.

Override sources:

- global Pi config
- project Pi config, when trusted by Pi

Schema:

```json
{
  "taumel": {
    "agents": {
      "builtins": {
        "smart": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "deep": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "rush": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "finder": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "librarian": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "oracle": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "painter": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        },
        "review": {
          "provider": "inherit",
          "model": "inherit",
          "thinking": "inherit"
        }
      }
    }
  }
}
```

Rules:

- Taumel creates the config section automatically on first run when missing.
- Every built-in profile is listed in the generated config.
- Generated values are all explicit `inherit`.
- The generated config must make the contract obvious enough to edit by hand.
- Override entries must be complete: `provider`, `model`, and `thinking`
  together.
- Each value may be `inherit` or a concrete string.
- `provider` and `model` follow the same atomic pair rule as profile
  frontmatter: both `inherit` or both concrete.
- Unknown built-in profile names are startup errors for the agent subsystem.
- User Markdown profiles cannot override built-ins by name.

## Session Profile Toggles And Prompt Caching

Per-session agent toggles are session state, not prompt state.

- The registered model tools do not change when a profile is enabled or
  disabled.
- Tool descriptions do not embed the enabled-profile list.
- The system prompt does not embed the enabled-profile list.
- `agent_profiles` is the source of truth for model-visible availability.
- `agent_list` is the source of truth for model-visible agent identity/run
  state.
- Disabled profiles remain visible in `agent_profiles`.
- `agent_spawn` checks the session toggle state at execution time and fails
  loudly for disabled profiles.
- Toggle state is stored in the parent session file so `/resume` restores it.
- Toggle state is stored in a dedicated Taumel session entry, `taumel.agents`,
  separate from permissions, network, and goal state.
- A new session with no stored toggle state starts with all startup-valid
  profiles enabled.

## Session Persistence

Agent state is stored in a dedicated parent-session custom entry:

```text
taumel.agents
```

The entry owns:

- profile enabled/disabled state for the session
- durable agent identities
- run metadata
- terminal output references

`/resume` restores profile toggles and known agent/run state from this entry.
Runs that were active when the previous process exited are restored as `lost`
unless a live worker is actually attached.
Other Taumel session entries, such as permissions, network, and goal state, do
not own agent data.

Large child data is not embedded directly in `taumel.agents`. Final outputs are
stored separately or by reference from run metadata. Raw child transcripts and
tool logs are Pi/worker-owned live data in this implementation and are not
promised to survive process exit. The `taumel.agents` entry stays a small index
for resume, menus, and model-facing status tools.

Final output is the default displayed output for completed runs. Raw transcript
or tool-log access is available only through an explicit human UI action, not as
default `/agent-runs output` content and not through the model-facing tools in
this PRD.

## Tool Visibility And Validation

Profile `tools` is authoritative for the child tool surface.

- `tools: inherit` explicitly inherits parent active tools, after removing all
  agent tools because depth is one.
- `tools: [...]` exposes exactly those tool names to the child.
- Even explicit `tools: [...]` cannot expose `agent_spawn`, `agent_send`,
  `agent_wait`, `agent_list`, `agent_close`, or `agent_profiles` to a child
  session.
- Tools are not intersected with the parent active tool list.
- Tool names are validated against the live Pi tool registry at startup.
- Profile tool names must be canonical Taumel/Pi tool names. Taumel does not
  accept Tau aliases or rewrite profile tools for compatibility. For example,
  `bash`, `read`, `backlog`, and legacy `agent` are valid only if those exact
  names exist in Pi's live tool registry; otherwise the agent subsystem is
  disabled at startup.
- Any missing tool in any profile disables the whole agent subsystem.
- Duplicate profile names or invalid profile frontmatter also disable the whole
  agent subsystem.
- Taumel should surface a visible startup diagnostic and avoid registering agent
  tools while the subsystem is invalid.

## Sandbox And Approval

Sandbox is the execution authority.

- Child sandbox cannot be more powerful than the parent/session sandbox.
- `no_sandbox` is never allowed for subagents.
- `sandbox: inherit` means inherit the parent sandbox only if that sandbox is
  valid for subagents.
- `danger-full-access` is not valid for subagents. A profile that declares it,
  or a subagent that would inherit it from a full-access parent/session, is a
  validation error.
- `workspace-write` stays `workspace-write`.
- `read-only` stays `read-only`.
- Child tool execution uses the child session sandbox.
- If a child tool needs escalation, the approval prompt is shown to the user for
  that child action.
- Approval UI/result text must identify the requesting agent/profile.

## Completion Delivery

`agent_spawn` and `agent_send` return immediately.

When a background run completes, Taumel delivers the completion through Pi's
existing steering/follow-up message mechanism, matching Tau/Kimi style instead
of inventing a separate queue.

Completion delivery happens only for terminal runs whose result was not already
returned to the parent by `agent_wait`.

The delivered message contains:

- `agent_id`
- `run_id`
- submission ids and short labels for submissions included in the run
- profile
- status
- final output or error
- resume/close hint when useful

The message contains final output only, not raw child transcript/tool logs.
Full submission bodies/history are not included by default; they belong in the
human `/agent-runs` detail/log UI.
When the parent session has an active turn, delivery uses Pi steering. When the
parent session is idle, delivery may trigger a follow-up turn through the same Pi
message machinery. Taumel does not inspect whether the parent is inside a tool
call and does not defer delivery with its own scheduler; when a background run
finishes, Taumel immediately hands the completion to Pi's existing delivery
mechanism.

Child completion delivery is visible to the user in the UI. Taumel must not hide
the completion event from the human transcript. The model-facing content remains
limited to final output and run metadata unless the user explicitly opens raw
child logs through a human UI action.

Run metadata records whether a terminal result was consumed by `agent_wait` or
delivered through background completion. A run must not notify the parent twice.

## Startup Failure Policy

Agent subsystem startup validation checks:

- profile frontmatter shape
- duplicate profile names
- user Markdown profile using a built-in name
- required fields present
- valid `inherit` or concrete values
- every tool name exists in the live Pi tool registry
- every referenced built-in override targets an existing built-in profile

Validation runs before model-facing agent tool registration on every session
startup. Pi does not expose a separate "tool registry ready" hook. During
extension loading, registration methods are valid but action methods such as
`getAllTools()` are not bound yet. After Pi binds the extension runtime,
session hooks such as `session_start` can call `getAllTools()`.

Taumel therefore registers human diagnostics commands during extension load,
then on `session_start` validates profiles against `pi.getAllTools()` and only
then registers/enables model-facing agent tools. The validation result gates
whether agent tools are available.

The `session_start` handler must complete validation and any model-tool
registration before returning. Pi snapshots active tools when a prompt turn
starts, after `session_start` has completed, so agent tools registered during
`session_start` are available for the first turn of that session.

Pi exposes `registerTool()` but no `unregisterTool()`. If agent tools were never
registered in the current extension runtime, invalid validation means Taumel does
not register them. If agent tools were already registered from an earlier valid
session, invalid validation removes them from the active tool list with
`setActiveTools()` and marks the subsystem unavailable. They may still exist in
Pi's all-tools registry, but they must not be active/model-callable for that
session.

Tool definition registration is process/runtime state. Active tool membership is
session state. Taumel agent availability must therefore be evaluated per session
on `session_start`/resume/new/fork, and the result applied by changing the
session active tool list. The registered definitions may be shared across
sessions, but whether they are model-callable is session-specific.

If any check fails:

- do not make `agent_spawn`, `agent_send`, `agent_wait`, `agent_list`,
  `agent_close`, or `agent_profiles` active/model-callable;
- if those model-facing tools were not previously registered in the extension
  runtime, do not register them;
- if they were previously registered, remove them from the active tool list;
- keep `/agents` registered as a human diagnostics command;
- keep `/agent-runs` registered for persisted run history and diagnostics;
- show a visible startup diagnostic with file/path/field/tool details;
- keep the rest of Taumel running.

## Acceptance

- The legacy `agent` tool is absent.
- Subagent sessions cannot see or invoke agent tools.
- Built-in profiles are `smart`, `deep`, `rush`, `finder`, `librarian`,
  `oracle`, `painter`, and `review`; no `plan` profile exists.
- Spawning requires an explicit valid profile.
- Spawn returns `agent_id` and `run_id` without waiting.
- `/agents` opens a Tau-style profile toggle menu.
- `/agents enable|disable <profile>` can enable/disable profiles for
  non-interactive use.
- Profile toggles apply immediately in the menu and persist immediately to the
  session file.
- Agent profile toggles and agent/run metadata are persisted under the dedicated
  `taumel.agents` session entry.
- `/agent-runs` is a separate menu for running/completed agent identities and
  run control.
- `/resume` restores session profile toggles.
- Per-session toggles do not change model tool schemas, tool descriptions, or
  the system prompt.
- `agent_profiles` returns the current enabled/disabled profile catalog.
- `agent_list` returns existing agent identity/run state and does not include
  profile toggle state.
- `agent_profiles` includes disabled profiles instead of hiding them.
- Spawning a disabled profile fails with a clear model-visible error.
- Disabling a profile only blocks future spawns; existing agents using that
  profile remain sendable until stopped or closed.
- Waiting with no timeout can wait indefinitely.
- Interrupting a wait does not cancel child work.
- Resuming a session marks previously active but unattached child runs as
  `lost` and keeps their agent identities resumable.
- Completed child work automatically notifies the parent session.
- Runs returned through `agent_wait` are marked consumed and do not later produce
  duplicate background completion messages.
- Background completion delivery uses Pi's existing steering/follow-up message
  mechanism.
- Child completion events are visible to the user in the UI.
- Final child output is available to the parent without raw transcript leakage.
- Raw child transcript/log access is a separate human-explicit action and is not
  exposed through the model-facing tools in this PRD.
- A completed agent can receive another run until it is closed.
- `agent_close` permanently prevents future runs for that identity.
- Invalid profile configuration disables all model-facing agent tools at
  startup; because Pi has no unregister API, this means inactive/not
  model-callable rather than necessarily absent from `getAllTools()`.
- When profile startup validation fails, `/agents` remains available to show
  diagnostics.
- When profile startup validation fails, `/agent-runs` remains available for
  persisted history and diagnostics, but controls that require valid profiles are
  disabled.
- Child sandboxing and approval behavior follow Tau-style child session policy.
