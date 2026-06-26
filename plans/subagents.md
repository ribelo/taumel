# Agent PRD

## What It Is

Taumel agents are durable child sessions owned by a parent session. A parent can
spawn an agent with a typed profile, send additional messages to the same
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
- Use XML-style model markup for agent run results and completion
  notifications, while keeping human rendering minimal and separate from the
  model-facing protocol.
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

Goal tools are separate from agent tools. A spawned objective run receives a
host-created child goal before the first child turn starts. The child does not
receive `create_goal`, because the parent already supplied the objective, but
every subagent session does receive `update_goal` so it can mark its goal
`complete` or `blocked`. Without `update_goal`, a goal-mode child could
continue forever.

`update_goal` behaves like the normal goal tool in every subagent turn. If no
child goal is active, it returns the normal no-active-goal tool result; Taumel
does not special-case this into a subagent error.

Subagent tool and system-prompt surfaces are stable for the lifetime of the
child session. Taumel must not attach or detach tools per run just to reflect
whether the current run started from `agent_spawn` or `agent_send`; that would
break provider token caching. Any future per-run tool or prompt change needs a
strong explicit reason and a PRD update.

### `agent_spawn`

Creates a durable agent identity and starts one run. It never waits.
`agent_spawn` takes a single `message` payload and a `create_goal` flag that
selects between a plain message run and a goal-mode run.

Inputs:

- `profile`: required profile name.
- `message`: required full task/message text delivered to the child.
- `create_goal`: optional boolean, default `false`.

No `provider`, `model`, `thinking`, `tools`, or `sandbox` fields are accepted.
Those belong to the profile.

Mode selection:

- `create_goal = false` (default): the child receives `message` as a normal
  prompt and runs a single non-goal turn, exactly like an `agent_send` message
  to an idle agent. The run has no child goal, no continuation loop, and no
  too-brief expansion. Its initial submission kind is `message`.
- `create_goal = true`: the child receives `message` as an automatically created
  child goal and pursues it with main-agent goal-mode mechanics, including the
  child goal continuation loop described under "Child Goal Continuation". Its
  initial submission kind is `objective`.

The default is `false` because most spawns are "do this specific thing and
report back", which is a one-shot message run. Goal mode is the heavier path
(child goal + continuation loop) and is opt-in.

Output includes:

- `agent_id`
- `run_id`
- `profile`
- `status = running`

### `agent_send`

Sends a normal message to an existing, non-closed agent. Unlike `agent_spawn`,
`agent_send` does not automatically create a child goal.

Inputs:

- `agent_id`: required.
- `message`: optional normal message to deliver. Required unless
  `interrupt = true`.
- `interrupt`: optional boolean.

The agent keeps its original profile. `profile`, `provider`, `model`,
`thinking`, `tools`, and `sandbox` are not accepted.

Default behavior follows Tau/Kimi style: if the agent has an active run,
`agent_send` steers the message into that active child session through Pi's
steering mechanism. It does not fail just because the child is busy, and it does
not create a second active run for the same agent. There is no queue-next-run
mode in this PRD.

With `interrupt = true`, a present `message` means priority steering. Taumel may
interrupt the current child SDK turn so the parent message can be delivered
promptly, but it does not cancel the parent-visible run, does not create a
replacement run, does not drop/recreate the child session, and does not leave
the child goal automation paused/interrupted. The message is still a normal
message to the same durable child session. If the active run is a spawned goal
run, the existing child goal remains the source of truth. The underlying goal
component may transiently observe the interrupted child turn, but the sent
message is the recovery/resume path and the goal component must continue
normally afterward when the goal is still active.

With `interrupt = true` and no `message`, Taumel sends an interrupt-only event.
It interrupts the current child SDK turn, leaves the child goal automation in
the existing interrupted/paused state, and marks the parent-visible run
`suspended` with reason `interrupted_by_parent`. No replacement run is created,
the child session is not dropped, and the agent identity remains open. This is
the model-facing non-closing stop/pause operation. A later `agent_send` with a
message to that agent resumes the same suspended run through the existing child
session and goal component, rather than creating a replacement run.

With `interrupt = true`, no `message`, and no active or suspended run, there is
nothing to interrupt; Taumel returns a normal no-active-run result and does not
create a run.

If the agent identity is open and has no active run, `agent_send` is allowed
regardless of the previous terminal run state (`completed`, `failed`,
`cancelled`, `timed_out`, or `lost`). It creates a new `run_id`; it never
restarts or rewrites the previous run. If a lost child runtime must be recreated
behind the same `agent_id`, that is still a new run, not a resumed old run.
The new run is a normal child prompt turn, not a child goal.

If the agent identity has a suspended run, `agent_send` with a message resumes
that run instead of creating a new one.

Output includes:

- `agent_id`
- `run_id`
- `submission_id`
- delivery kind: `steered` for active runs, `interrupted` for priority-steered
  active runs, `suspended` for interrupt-only stops, `resumed` for suspended
  runs, `started` for new runs
- resulting run/status summary

### `agent_wait`

Waits for active work or reads exact run results. Waiting is unlimited by
default.

Inputs:

- `run_ids`: optional exact run ids.
- `agent_ids`: optional agents whose active or fresh deliverable runs should be
  waited on.
- `timeout_seconds`: optional wait-call timeout.

Selector rules:

- Exactly one selector kind may be provided.
- Omitted selector means all deliverable runs owned by this session: active
  runs plus terminal runs whose result has not been consumed by `agent_wait` and
  has not been delivered through background notification.
- `run_ids` waits for exactly those runs, including already-terminal and
  already-delivered runs. This is the explicit historical readback path.
- `agent_ids` waits for each selected agent's active run or fresh undelivered
  terminal run. It does not reread consumed/background-notified history.
- Suspended runs are not active work and do not block `agent_wait`. Exact
  `run_ids` or selected `agent_ids` report them immediately as `suspended`.
- Agents with no active or deliverable run are reported as `no_active_run` or
  `no_deliverable_run`.
- If the selector resolves to no active or deliverable runs, `agent_wait`
  returns a successful status result such as `no_active_runs`; it is not a tool
  error.
- Exact `run_ids` waits partially succeed. Owned runs return their status and
  output/error when available; missing run ids return `not_found`; not-owned run
  ids return `not_owned` without agent id, profile, final output, error text, or
  any other cross-session metadata.
- A malformed selector is a tool error. Examples: multiple selector kinds,
  empty selector arrays, or invalid ids.
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

For completed/failed terminal runs, `agent_wait` returns XML-style model markup
around the child final handoff. The markup is a prompt protocol for the model,
not a strict XML document that must round-trip through an XML parser. Controlled
metadata such as ids, profile names, status, and elapsed time may be attributes.
Freeform child output is inserted as raw block text inside elements; Taumel does
not escape code snippets or other child text merely to make the markup
schema-valid.

If exact `run_ids` readback finds a known terminal run but the final output is
not available through Pi/worker transcript history or current process memory,
`agent_wait` returns a normal structured result for that run with
`output_available = false` and no `<final_output>`/`<error>` block. This is not
a tool error and does not change the run status.

`agent_wait` consumption affects only automatic delivery. If a fresh terminal
run is returned by default wait, `agent_ids` wait, or explicit `run_ids` wait,
Taumel marks it consumed and suppresses background completion for that run.
Explicit `run_ids` may reread already-consumed or background-notified terminal
runs later without changing their delivery state.

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
- bounded status/reason codes, never child output, summaries, or raw error text

### `agent_close`

Permanently closes agent identities.

Inputs:

- `agent_ids`: one or more ids, or `all`.

If an agent has an active run, that run is cancelled with reason
`closed_by_parent`. The agent identity becomes closed and cannot be resumed.
Historical run output remains inspectable through listing/status surfaces.

`agent_close` is the only model-facing permanent close primitive in this PRD.
It is not a pause. `agent_send` with `interrupt = true` and no `message` is the
model-facing non-closing stop/pause primitive.

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
- canonical tool names exposed by that profile

The `agent_profiles` tool has stable schema and stable description. `/agents`
toggles do not mutate the model tool schema or the system prompt. If the model
calls `agent_spawn` for a disabled profile, the spawn fails with a clear
model-visible error that says the profile is disabled for this session and the
user can enable it with `/agents enable <profile>`.

Disabled profiles are included in `agent_profiles` output with
`enabled = false`; they are not hidden.

Following Kimi, `agent_profiles` exposes each profile's canonical tool names to
the parent model. This helps the parent choose an appropriate profile and keeps
the capability surface explicit. Tool names are emitted as structured profile
metadata, not as natural-language prose.

Tool names are repeated child elements, not a comma-delimited attribute:

```xml
<taumel_agent_profiles>
  <profile name="finder" enabled="true" sandbox="read-only">
    <description>Fast read-only codebase exploration.</description>
    <tool name="exec_command" />
    <tool name="find_thread" />
    <tool name="read_thread" />
  </profile>
</taumel_agent_profiles>
```

This tool does not report existing agent identities, active runs, or run output;
use `agent_list` and `agent_wait` for those.

## Model Markup And Human Rendering

Model-visible subagent tool outputs use XML-style prompt markup, not ad hoc
plain key/value text. This applies to `agent_spawn`, `agent_send`,
`agent_wait`, `agent_list`, `agent_close`, `agent_profiles`, and background
completion notifications. The goal is stable structure for the parent model,
not strict XML validity.

Example:

```xml
<taumel_agent_spawn>
  <agent id="smart-ucfq" profile="smart" lifecycle="open" sandbox="workspace-write" />
  <run id="smart-ucfq-run-1" status="running" />
</taumel_agent_spawn>

<taumel_agent_wait>
  <run agent_id="smart-ucfq" run_id="smart-ucfq-run-5" profile="smart" status="completed" elapsed_seconds="3">
    <final_output>
Hi - fifth test.
    </final_output>
  </run>
</taumel_agent_wait>
```

Rules:

- Controlled metadata may be attributes.
- Freeform child output or error text goes inside block elements as raw text.
- Freeform descriptions, objectives, messages, and summaries are elements, not
  attributes.
- Do not escape child output just to make strict XML valid.
- The stored run `final output` remains plain child text. XML-style markup is
  a delivery envelope, not the persisted value.
- Structured model output uses XML-style tags even when a tool only returns
  acknowledgements or catalog data. Do not introduce JSON or key/value text for
  subagent model outputs unless the PRD is changed explicitly.
- Important semantic data must be present in model-visible content and
  structured details. It must not exist only in human UI rendering.

Root tag names map directly to the tool/custom-message surface:

```text
agent_spawn      -> <taumel_agent_spawn>
agent_send       -> <taumel_agent_send>
agent_wait       -> <taumel_agent_wait>
agent_list       -> <taumel_agent_list>
agent_close      -> <taumel_agent_close>
agent_profiles   -> <taumel_agent_profiles>
notification     -> <taumel_notification kind="...">
```

Canonical child elements:

```text
<agent ... />
<run ...>...</run>
<submission ... />
<profile ... />
<tool ... />
<final_output>...</final_output>
<error>...</error>
<summary>...</summary>
<message>...</message>
```

This is a vocabulary, not a parser-enforced schema. Tools may omit irrelevant
elements, repeat list elements, or add narrow attributes when needed, but they
should not invent alternate names for the same concepts.

Structured `details` mirrors the same domain concepts as the model markup:
`agent`, `run`, `submission`, `profile`, `tool`, `finalOutput`, `error`,
`summary`, and `message`. Renderer-only names should be avoided unless they
describe UI state that has no model-facing meaning.

Human rendering is separate from model markup. Tool renderers and notification
renderers parse structured details/model content into a minimal UI; they do not
show raw XML-style markup by default.

Subagent tool rendering uses one shared agent-event grammar based on run state,
not on individual tool names. `agent_spawn`, `agent_send`, `agent_wait`,
`agent_list`, and background completion notifications all map their details to
one or more agent events:

```text
agent id, run id, profile, status, lifecycle, submission kind/id, final
output/error, sandbox, elapsed time, delivery kind
```

Compact rendering stays one line unless a short error reason is needed:

```text
agent_spawn smart-ucfq - smart - running
agent_send smart-ucfq - steered - smart-ucfq-run-2
agent_wait 1 completed
agent_list 3 open
agent_close 2 closed
```

Compact `agent_wait` shows counts/status only. It does not show final child
output previews. Expanded rendering is still minimal: a few structured metadata
lines plus final output or error text. It does not show raw child transcripts,
child tool logs, hidden prompts, or the XML-style model envelope.

`agent_list` is an inventory/status surface. It must not include full terminal
final output or error text in model-visible content, details, compact UI, or
expanded UI. Including full output would multiply token usage by the number of
agents. `agent_list` may include only bounded compact terminal summaries. Full
terminal output is available through `agent_wait` with explicit `run_ids` or
human `/agent-runs output`.

`agent_profiles` is not an agent-event renderer. It uses a separate catalog
renderer:

- compact: profile counts and enabled/disabled counts
- expanded: profile name, enabled/disabled state, disabled reason, sandbox,
  canonical tool names, and short description

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
persists only the run metadata needed for resume and menus. It does not persist
final child output, raw child transcripts, or child tool logs. Active runs
become `lost` on resume unless a live worker is attached. Durable hidden
child-session files are out of scope for this PRD.

Agent ids are generated by Taumel, not provided by the model. When
`agent_spawn` creates an identity, Taumel generates `<profile>-<shortid>`, for
example `finder-k7p2`. The short id uses a small lowercase unambiguous alphabet,
is 4-6 characters long, and retries on collision.

Agent ids are not reusable within a session. If an id was ever used by an open
or closed identity, Taumel does not generate it again.

Multiple open agents may use the same profile at the same time. `agent_id`, not
profile name, is the unique identity boundary.

### Run

One contiguous child execution episode for an agent. A run starts either from an
`agent_spawn` payload or from an `agent_send` message when the agent is idle. An
`agent_spawn` run is goal-mode when `create_goal = true` (the `message` becomes a
child goal) and a plain message run when `create_goal = false`. An idle
`agent_send` always starts a plain message run. Active runs may receive
additional `agent_send` messages through steering or priority interruption while
they remain active. Suspended runs remain non-terminal and can be resumed by a
later `agent_send` message.

Fields:

- `run_id`
- `agent_id`
- initial submission kind
- submission ids and kinds sent to the run
- status
- reason code, when terminal failure/cancellation has a reason
- parent delivery state
- created/started/completed timestamps

Persisted run metadata must not store raw text: no objective/message payloads,
descriptions, final output, child transcript text, tool logs, freeform error
text, freeform reason text, summaries, labels, prompts, or system prompts. Raw
text lives in Pi-owned transcript/tool-result/session history, not in
`taumel.agents`.

Each `agent_spawn` and `agent_send` creates a `submission_id`. A submission is a
payload delivered to an agent. An `agent_spawn` submission with `create_goal =
true` is an objective and creates a child goal; with `create_goal = false` it is
a normal message. `agent_send` submissions are normal messages. If the agent
has an active run, the `agent_send` submission belongs to that active run and is
delivered by steering. If the agent is idle, the `agent_send` submission starts
a new non-goal message run. Submissions are trace/UI markers; the terminal
result belongs to the run.

Child goal mode for goal-mode spawns (`create_goal = true`) must use Taumel's
existing goal component, the same component used by the main agent. The agent
subsystem does not reimplement goal completion auditing, retry behavior, or the
continuation prompt wording. The child session is wrapped so the existing goal
component owns the continue/stop decision and the continuation prompt text. The
objective is stored as child goal state/prompt data, not echoed back in the
parent-facing `agent_spawn` tool result. `agent_send` is intentionally not
goal-based; it is ordinary communication with an existing durable agent.

For goal-mode spawns, Taumel creates the child goal internally before
dispatching the objective. It must not rely on the child model calling
`create_goal`, and the automatic goal setup should not appear as a visible child
tool call.

The child uses `update_goal` to update goal state, not as a host-side
interruption mechanism. If the child marks the goal `complete` or `blocked`,
Taumel does not stop the child turn immediately; it waits for the child to
finish normally and uses the final assistant handoff as run output.

#### Child Goal Continuation

Goal-mode spawn runs are driven by a sequential continuation loop, not a single
child turn. The loop is orchestrated in the TypeScript host (which already
awaits each child SDK turn) while OCaml makes the per-step continue/stop
decision. The loop must not be event-driven off a fire-and-forget turn-end
callback, because that is the failure mode that left runs stuck `active`.

The loop, running in the background after `agent_spawn` returns:

1. Send the objective as the first child prompt and await the turn.
2. Read the child session's `taumel.goal` and `taumel.goal_automation` entries.
3. Ask OCaml `planChildGoalContinuation` (a dedicated entrypoint that decodes
   the supplied child goal entries and reuses `Goal.plan_continuation` /
   `should_continue`). It returns either a continuation prompt to send, or a
   finalize decision with the terminal run status.
4. On a continuation decision, send the returned continuation prompt into the
   same child session, await the turn, increment the continuation counter, and
   go to step 2.
5. On a finalize decision, record the parent-visible terminal run from the
   returned status, apply too-brief expansion when applicable, then deliver or
   notify.

The continue/stop decision and the continuation prompt wording stay in OCaml so
there is one source of truth shared with the main agent. The TypeScript host
only reads the two child goal entries, passes them down, and acts on the
returned plan.

Delivery of each continuation prompt into the child session follows the main
agent's rule (see goal.md "Continuation Delivery"): it is sent as a **follow-up**
to the child, advancing the child to its next turn. This is distinct from how
the parent is told about the child's *final* result: that terminal handoff is
delivered to the parent as a **steering** notification (see "Completion
Delivery"). The child-internal continuation (follow-up) and the parent-facing
completion (steering) are intentionally different mechanisms.

Finalize mapping:

- goal `complete` -> run `completed` (after too-brief handling)
- goal `blocked` -> run `failed` with reason `goal_blocked`
- continuation cap reached while still active -> run `failed` with reason
  `goal_continuation_limit`

Termination guard: `planChildGoalContinuation` owns a continuation cap. A
goal-mode child that never reaches `complete`/`blocked` within the cap is
finalized as `failed` with reason `goal_continuation_limit`. There is no
unbounded background loop and no silently dropped completion: every goal-mode
run reaches a terminal (or suspended) state.

Scope note: child goal *budget* accounting (token/time limit enforcement via
turn-end accounting) is deferred in this iteration. The continuation mechanism
itself is fully implemented; termination is guaranteed by goal status or the
continuation cap rather than by token/time limits. Wiring child usage
accounting is a tracked follow-up, not part of this change.

If the goal is `complete`, the spawned run is recorded as `completed` after
final-output handling. If the goal is `blocked`, the parent-visible run is
recorded as `failed` with reason `goal_blocked`; `blocked` remains a goal
status, not a separate run status.

For goal-mode spawn runs, the goal component state is the source of truth for
parent-visible run completion. The agent subsystem observes child turn
completion plus the child goal state; it must not infer completion from
assistant prose alone.

For plain message runs (idle `agent_send`, or `agent_spawn` with `create_goal =
false`), there is no child goal-state gate and no continuation loop. The run
terminal state comes from the single child prompt/follow-up turn result:
successful turn ends as `completed`; child error/cancel/timeout maps to the
corresponding terminal run status.

The run `final output` is the child's final assistant handoff text, not a
separate host-generated summary of the whole child transcript. Child profiles
must tell the child that the parent sees only the final handoff.

For successful goal-mode spawn runs only (`create_goal = true`), Taumel follows
Kimi's too-brief handoff rule before recording the run as `completed`: if the
child's last assistant text is shorter than 200 trimmed characters, Taumel sends
one follow-up prompt to the same child session:

```text
Your previous response was too brief. Please provide a more comprehensive summary that includes:

1. Specific technical details and implementations
2. Detailed findings and analysis
3. All important information that the parent agent should know
```

After that one continuation, the new last assistant text becomes the canonical
final output. Taumel does not run a separate summarizer over the child session.
Plain message runs (idle `agent_send`, or `agent_spawn` with `create_goal =
false`) do not get the too-brief expansion; short answers to normal messages are
valid. Failed, cancelled, timed-out, lost,
and closed runs do not get the too-brief expansion; their terminal reason/error
is recorded directly. Suspended runs are not terminal and do not have final
output yet.

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

`suspended` means a running child was interrupted without a replacement message.
The child goal automation is intentionally interrupted/paused, the run has no
final output, and the agent identity remains open. A later `agent_send` message
to the same agent resumes the suspended run through the existing child session
and goal component.

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
- delivery state such as consumed/background-notified flags

`/resume` restores profile toggles and known agent/run state from this entry.
Runs that were active when the previous process exited are restored as `lost`
unless a live worker is actually attached.
Other Taumel session entries, such as permissions, network, and goal state, do
not own agent data.

`taumel.agents` must not store raw text. That includes objective/message
payloads, descriptions, final child output, raw child transcripts, child tool
logs, freeform error text, freeform reason text, summaries, labels, prompts, and
system prompts. It stores metadata only: controlled ids, enum values, booleans,
small integers/counters, timestamps, delivery flags, lifecycle/status values,
profile names, and other non-freeform state needed for status inspection.
Parent-visible final output is delivered through the normal parent
transcript/tool-result/notification path owned by Pi.

After `/resume`, Pi is responsible for restoring the parent conversation
transcript, including prior agent tool calls/results that are part of that
transcript. Taumel does not track parent tool history, re-execute old tool
calls, or synthesize additional tool results from `taumel.agents` during
resume. To inspect current restored agent state, the parent can call
`agent_list` or exact `agent_wait run_ids`. If the parent session contains a
valid `taumel.agents` entry, `agent_list` must show the restored open/closed
identities and latest run states; it must not return an empty list merely
because child worker sessions were process-local and are gone. Runs persisted
as `queued`, `running`, or `suspended` without a live worker become `lost` with
reason `process_resumed_without_live_worker`.

If Taumel crashes before a state transition is persisted, `/resume` can only
restore the last saved `taumel.agents` entry. For example, a child may have
completed in reality, but if the terminal run state was not saved before
process exit, the restored run is still treated as lost rather than completed.

Large child data and raw text are not embedded in `taumel.agents`. Final
outputs, child transcripts, prompts, and tool logs are Pi/worker-owned data in
this implementation and are not persisted by Taumel's agent state. The
`taumel.agents` entry stays a small metadata index for resume, menus, and
model-facing status tools.

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
- `update_goal` is always added to the child tool surface even if the profile
  tool list does not mention it. `create_goal` is not added to child sessions.
- The child tool surface is stable for the child session lifetime. Taumel does
  not attach or detach tools per run, so token caching is not invalidated by
  switching between spawned objective runs and normal send-message runs.

## Sandbox And Approval

Sandbox is the execution authority.

- Child sandbox cannot be more powerful than the parent/session sandbox.
- `no_sandbox` is never allowed for subagents.
- `sandbox: inherit` means inherit the parent sandbox, clamped to the strongest
  sandbox that is valid for subagents.
- `danger-full-access` is not valid for subagent profile declarations. A profile
  that declares it is a validation error.
- If a profile inherits from a `danger-full-access` parent/session, the child
  sandbox is clamped to `workspace-write`.
- `workspace-write` stays `workspace-write`.
- `read-only` stays `read-only`.
- Child tool execution uses the child session sandbox.
- If a child tool needs escalation, the approval prompt is shown to the user for
  that child action.
- Approval UI/result text must identify the requesting agent/profile.

## Completion Delivery

`agent_spawn` and `agent_send` return immediately.

When a background run completes, Taumel does not eagerly push the result to Pi
on a timer. Instead Taumel owns a small in-process **notification queue** of
pending deliverable completions (backed by run state: terminal, not consumed,
not delivered). The result is delivered to the parent exactly once, by whichever
of two readers reaches it first, both pulling from that single Taumel queue:

1. **`agent_wait` (pull).** `agent_wait` runs as a tool *inside* a parent turn,
   so it executes before that turn's `turn_end`. If the awaited run is already
   terminal (or becomes terminal while the wait blocks), `agent_wait` consumes
   it from the queue and returns the output directly. This is the parent's
   first-claim path during an active turn.
2. **`turn_end` flush (push).** Taumel subscribes to the parent's `turn_end`
   event. On `turn_end` it flushes every still-pending, unconsumed completion
   for that parent session by sending each as a Pi **steering** message
   (`deliverAs: "steer"`), then marks it delivered. Pi drains steering right
   after `turn_end` and injects it at the *start of the next turn, before the
   next assistant response*. The parent therefore sees the completion in its
   context before it could call `agent_wait` again.

Why this removes the earlier confusion: a steered notification flushed at
`turn_end` is injected *before* the next assistant response, so by the time the
parent could call `agent_wait` for that run, it has already received the result
in-band. `agent_wait` reporting that run as already delivered is then correct
and non-confusing, not an empty result that lost the answer.

The delivery must not use a Pi **follow-up** message. A follow-up is only
drained when the agent loop would otherwise stop (effectively end of prompt),
which is exactly the deferred, out-of-band delivery this design avoids. Steering
is drained at every turn boundary; follow-up is not.

### Idle Delivery

`turn_end` only fires while the parent has a running loop. When the parent is
**idle** (no loop running), there is no `turn_end` and no `agent_wait` can run
(the model is not executing), so the queued completion would otherwise sit
undelivered. In that case Taumel flushes the queue with a `triggerTurn`
delivery, which starts a fresh parent turn to surface the completion. This also
covers completions that were still pending when a loop ended. The idle path is
`triggerTurn` (wake and deliver promptly) rather than `nextTurn`/silent-append
(which could defer indefinitely if the human never prompts again); guaranteed
prompt delivery is preferred over deferral. Because no `agent_wait` competes
while idle, the idle push is unconditional.

Repeated flush attempts are idempotent: the run's consumed/delivered flag is the
single source of truth, so the first reader to deliver marks it and every other
path skips it. Exactly one delivery, never twice, never an empty wait for a
result that exists.

Completion delivery happens only for terminal runs whose result was not already
returned to the parent by `agent_wait`.

Suspended runs do not produce background completion notifications. Suspension is
non-terminal and has no final child output; the `agent_send` interrupt-only tool
result is the delivery surface for the pause event.

The delivered message is a `taumel.notification` custom message, not a
tool-specific `taumel.agent.completion` message. Its model-visible `content` is
XML-style markup and its structured `details` carry the renderer/diagnostic
payload.

Example model-visible content:

```xml
<taumel_notification kind="agent_completion" severity="info">
  <agent id="smart-ucfq" profile="smart" />
  <run id="smart-ucfq-run-5" status="completed" elapsed_seconds="3" />
  <final_output>
Hi - fifth test.
  </final_output>
</taumel_notification>
```

The notification details contain:

- `agent_id`
- `run_id`
- submission ids and kinds included in the run
- profile
- status
- final output or error
- resume/close hint when useful

The message contains final output only, not raw child transcript/tool logs.
Full submission bodies/history are not included by default; they belong in the
human `/agent-runs` detail/log UI.
Delivery uses Pi steering during an active parent turn (flushed at `turn_end`,
injected before the next assistant response) and a `triggerTurn` push when the
parent is idle. The notification is never sent as a follow-up. Taumel drives
delivery from the parent's `turn_end` event and from the idle path; it does not
use its own timer/scheduler and does not inspect whether the parent is inside a
specific tool call.

Child completion delivery is visible to the user in the UI. Taumel must not hide
the completion event from the human transcript. The model-facing content remains
limited to final output and run metadata unless the user explicitly opens raw
child logs through a human UI action.

Run metadata records whether a terminal result was consumed by `agent_wait` or
delivered through a background flush. A run must not be delivered to the parent
twice. Taumel marks a run as delivered only after the Pi send succeeds. If a
send fails, the terminal run remains pending in the queue so a later `turn_end`
flush, idle flush, or `agent_wait` can still surface it.

There is exactly one delivery per terminal child result, pulled from the single
Taumel notification queue:

- if `agent_wait` consumes the terminal result first, it is returned to the
  model and marked consumed, and no background flush re-delivers it;
- otherwise the next `turn_end` flush (active loop) or `triggerTurn` flush
  (idle) sends `taumel.notification` and marks the run delivered;
- default `agent_wait` does not re-deliver an already-delivered terminal run;
- explicit diagnostic reads such as `agent_wait` with `run_ids` and human
  `/agent-runs output` may show historical terminal output only when that
  output is still available through Pi/worker transcript history or current
  process memory; Taumel does not retrieve it from `taumel.agents`;
- `agent_list` may show only current status and bounded terminal summaries, not
  full historical output.

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
- Spawn accepts only `profile`, `message`, and `create_goal`; Taumel generates
  `agent_id`.
- `create_goal` defaults to `false`; a default spawn runs a single non-goal
  child turn that completes from the turn result, with no child goal,
  continuation loop, or too-brief expansion.
- `create_goal = true` creates a child goal from `message` and the child pursues
  it with main-agent goal-mode semantics.
- Goal-mode spawns use the existing Taumel goal component for the per-step
  continue/stop decision and continuation prompt wording; the loop is
  orchestrated by the TS host via a dedicated `planChildGoalContinuation`
  entrypoint, not reimplemented goal logic.
- Goal-mode spawn run completion is derived from child turn completion plus
  child goal component state, not from assistant prose alone.
- The goal-mode continuation loop sends successive continuation prompts into the
  same child session until the goal is `complete`/`blocked` or the continuation
  cap is reached; it never leaves the run stuck `active` and never silently
  drops a captured completion.
- A goal-mode run that hits the continuation cap while still active is finalized
  as `failed` with reason `goal_continuation_limit`.
- Plain message run completion (idle `agent_send`, or spawn with `create_goal =
  false`) is derived from the single child prompt/follow-up turn result, not
  from goal component state.
- Goal-mode spawn child goals are created internally before the first child
  turn, not by a visible child `create_goal` call.
- Child `update_goal complete` or `blocked` does not interrupt the child turn;
  Taumel still waits for the final assistant handoff.
- Subagent sessions always receive `update_goal` and never receive
  `create_goal`.
- Subagent `update_goal` behaves like the normal goal tool; when no child goal
  is active it returns the normal no-active-goal result.
- A spawned child goal marked `blocked` records the parent-visible run as
  `failed` with reason `goal_blocked`.
- Subagent tool and system-prompt surfaces remain stable for the child session
  lifetime; Taumel does not attach/detach tools per run.
- `agent_send` accepts `message` as optional only when `interrupt=true`; without
  a message and without `interrupt=true`, the call is invalid.
- `agent_send` with a message delivers a normal message to an existing child and
  does not create a child goal by default.
- `agent_send` requires `agent_id`; profile names are not accepted as send
  selectors.
- `agent_send` to an active run steers into that run; there is no queue-next-run
  mode.
- `agent_send interrupt=true` with a message priority-steers the message. It may
  interrupt the current child SDK turn, but it does not cancel the
  parent-visible run, create a replacement run, drop/recreate the child session,
  or leave child goal automation paused/interrupted after the sent message
  resumes the child.
- `agent_send interrupt=true` without a message interrupts the current child SDK
  turn, leaves child goal automation interrupted/paused, marks the run
  `suspended` with reason `interrupted_by_parent`, and does not create a
  replacement run or close the agent.
- A later `agent_send` message to a suspended agent resumes the same run through
  the existing child session and goal component.
- `agent_send interrupt=true` without a message and without an active/suspended
  run returns a normal no-active-run result.
- `agent_send` to an idle agent starts a normal non-goal prompt run.
- `agent_close` is the only model-facing permanent close primitive.
- `/agents` opens a Tau-style profile toggle menu.
- `/agents enable|disable <profile>` can enable/disable profiles for
  non-interactive use.
- Profile toggles apply immediately in the menu and persist immediately to the
  session file.
- Agent profile toggles and agent/run metadata are persisted under the dedicated
  `taumel.agents` session entry.
- `taumel.agents` stores metadata only and no raw text: no objective/message
  payloads, descriptions, final child output, transcripts, tool logs, freeform
  errors/reasons, summaries, labels, prompts, or system prompts.
- `/agent-runs` is a separate menu for running/completed agent identities and
  run control.
- `/resume` restores session profile toggles.
- Per-session toggles do not change model tool schemas, tool descriptions, or
  the system prompt.
- `agent_profiles` returns the current enabled/disabled profile catalog.
- `agent_list` returns existing agent identity/run state and does not include
  profile toggle state.
- `agent_profiles` includes disabled profiles instead of hiding them.
- Model-facing subagent tool outputs and completion notifications use
  XML-style prompt markup; raw child output is plain block text inside that
  markup.
- Human compact renderers for subagent tools are one-line, minimal summaries;
  expanded renderers show structured metadata plus final output/error, not raw
  XML-style markup.
- Successful spawned objective/goal runs shorter than 200 trimmed characters
  receive one Kimi-style continuation prompt before Taumel records the run as
  completed. Normal `agent_send` message runs and non-success terminal runs do
  not.
- Background completion uses the generic `taumel.notification` custom message
  type.
- Spawning a disabled profile fails with a clear model-visible error.
- Disabling a profile only blocks future spawns; existing agents using that
  profile remain sendable until stopped or closed.
- Waiting with no timeout can wait indefinitely.
- Default `agent_wait` selects active runs plus fresh undelivered terminal runs
  owned by the parent session.
- `agent_wait` with exact `run_ids` can reread historical terminal output only
  when that output is available through Pi/worker transcript history or current
  process memory; it is not read from `taumel.agents`.
- `agent_wait` with exact `run_ids` returns a normal `output_available=false`
  result when terminal output is known to be unavailable.
- `agent_wait` with `agent_ids` is a delivery selector, not a historical
  readback selector.
- `agent_wait` reports suspended runs immediately and does not block on them.
- `agent_wait` returns normal successful no-active/no-deliverable results when
  there is nothing to wait for.
- `agent_wait` redacts not-owned run ids and can partially succeed for mixed
  `run_ids` selectors.
- Interrupting a wait does not cancel child work.
- Resuming a session marks previously active but unattached child runs as
  `lost` and keeps their agent identities resumable.
- Completed child work automatically notifies the parent session.
- Suspended runs do not produce background completion notifications.
- Runs returned through `agent_wait` are marked consumed and do not later produce
  duplicate background completion messages.
- Background completion is delivered from a single Taumel-owned notification
  queue, pulled by whichever reader reaches it first: `agent_wait` (consume
  during an active turn) or a `turn_end` flush (steering) / idle `triggerTurn`
  flush. It is delivered exactly once and is never sent as a follow-up that
  waits for end of turn.
- A completion flushed at `turn_end` is delivered via steering and injected
  before the next assistant response, so `agent_wait` never returns an empty
  result for a run whose answer the parent has not already received.
- When the parent is idle, a completing run is flushed via `triggerTurn` rather
  than deferred to the next user prompt.
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
