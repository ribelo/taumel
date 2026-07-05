---
kind: requirement
status: draft
tags: [subagents, agents, orchestration]
depends_on: ["[[plans/capability-profile]]", "[[plans/sandbox]]", "[[plans/goal]]", "[[plans/tool-gateway]]"]
---
# Subagents

## Intent

Taumel agents are durable child sessions owned by a parent. A parent spawns an
agent with a typed profile, sends further messages, waits for runs, inspects
status, and closes the agent. Nesting depth is exactly one, so child sessions
never receive agent tools. OCaml owns the typed state machine, profile
resolution, and run metadata; TypeScript owns the unavoidable Pi SDK calls.
Model-visible outputs may use XML-style markup; human rendering stays minimal,
readable, and separate from that markup.

## Requirements

### Depth and tool surface

- **sub-dp01** (ubiquitous): The system shall keep nesting depth exactly one, registering no agent tools in subagent sessions and removing them from child active tools.
- **sub-ts01** (ubiquitous): The system shall provide the model tools `agent_spawn`, `agent_send`, `agent_wait`, `agent_list`, `agent_close`, and `agent_profiles`, and shall not provide a legacy `agent` multiplexer.
- **sub-ts02** (ubiquitous): The system shall keep subagent tool and system-prompt surfaces stable for the child session lifetime, attaching or detaching no tools per run, so provider prompt caching holds.
- **sub-ts03** (ubiquitous): The system shall give every subagent session `update_goal` and never `create_goal`.

### agent_spawn

- **sub-sp01** (event-driven): When `agent_spawn` runs, the system shall create a durable agent identity and start one run without waiting, accepting only `profile`, `message`, and `create_goal` (default `false`).
- **sub-sp02** (event-driven): When `create_goal` is `false`, the system shall deliver `message` as a normal prompt and run a single non-goal turn with submission kind `message`.
- **sub-sp03** (event-driven): When `create_goal` is `true`, the system shall create a child goal from `message` and pursue it with goal-mode mechanics, with submission kind `objective`.
- **sub-sp04** (ubiquitous): The system shall output `agent_id`, `run_id`, `profile`, and `status = running` from a spawn.
- **sub-sp05** (ubiquitous): If a profile is disabled for the session, then normal model-facing discovery shall not present it as spawnable; direct stale/manual spawn attempts are outside the visibility UX contract.

### agent_send

- **sub-sd01** (ubiquitous): The system shall require `agent_id`, accept optional `message` and `interrupt`, require `message` unless `interrupt = true`, and reject `profile`, `provider`, `model`, `thinking`, `tools`, and `sandbox`.
- **sub-sd02** (event-driven): When the agent has an active run, the system shall steer the message into that run without creating a second run.
- **sub-sd03** (event-driven): When `interrupt = true` with a message, the system shall priority-steer it, possibly interrupting the child turn, without cancelling the run, creating a replacement, dropping the child session, or leaving goal automation paused after the message resumes the child.
- **sub-sd04** (event-driven): When `interrupt = true` without a message, the system shall interrupt the child turn, leave goal automation interrupted, and mark the run `suspended` with reason `interrupted_by_parent`, creating no replacement run and closing nothing.
- **sub-sd05** (event-driven): When `interrupt = true` with no message and no active or suspended run, the system shall return a normal no-active-run result.
- **sub-sd06** (event-driven): When the agent is open with no active run, the system shall start a new non-goal message run with a new `run_id` regardless of the prior terminal state.
- **sub-sd07** (event-driven): When the agent has a suspended run, an `agent_send` message shall resume that run through the existing child session and goal component rather than create a new run.
- **sub-sd08** (ubiquitous): The system shall output `agent_id`, `run_id`, `submission_id`, a delivery kind (`steered`, `interrupted`, `suspended`, `resumed`, or `started`), and a run/status summary.

### agent_wait

- **sub-wt01** (ubiquitous): The system shall accept at most one selector kind (`run_ids` or `agent_ids`) plus optional `timeout_seconds`, and shall treat multiple kinds, empty arrays, or invalid ids as tool errors.
- **sub-wt02** (event-driven): When no selector is given, the system shall wait on all waitable runs owned by the session, meaning active runs plus unconsumed terminal runs, including runs that have already sent completion-availability notifications.
- **sub-wt03** (event-driven): When `run_ids` is given, the system shall address exactly those runs, reporting missing ids as `not_found`, not-owned ids as `not_owned` without cross-session metadata, unconsumed terminal runs with their terminal response, and consumed terminal runs as status-only `already_consumed`.
- **sub-wt04** (event-driven): When `agent_ids` is given, the system shall wait on each agent's active run or unconsumed terminal run, including a terminal run that has already sent a completion-availability notification, and skip consumed history.
- **sub-wt05** (ubiquitous): The system shall report suspended runs immediately and never block on them.
- **sub-wt06** (event-driven): When the selector resolves to nothing, the system shall return a successful no-active or no-waitable status rather than a tool error.
- **sub-wt07** (ubiquitous): The system shall wait by run, treat `timeout_seconds` omitted as indefinite, `0` as poll-once, and positive as bounded, and affect only the wait call.
- **sub-wt08** (event-driven): When the user interrupts a pending wait, the system shall interrupt only the wait and let child runs continue.
- **sub-wt09** (ubiquitous): The system shall return final child answers and run metadata only, as XML-style markup for terminal runs, excluding raw transcript, tool logs, and hidden reasoning.
- **sub-wt10** (event-driven): When terminal output is unavailable through Pi/worker history or process memory, the system shall return `output_available = false` with no `final_output` or `error` block, not a tool error.
- **sub-wt11** (ubiquitous): The system shall mark a terminal run consumed when its terminal response body is returned and suppress any future completion-availability notification, while making every later model-facing read of that run status-only.
- **sub-wt12** (event-driven): When `agent_wait` returns a terminal run response to the parent, including final output, final error, cancellation, timeout, lost state, or `output_available = false`, the system shall mark that run consumed and suppress future completion-availability notifications for that run.
- **sub-wt13** (unwanted): If `agent_wait` returns only a bounded-wait timeout, no-active/no-waitable status, running status, or another status-only response without terminal output or terminal failure information, then the system shall not mark the selected run consumed and shall not suppress a later completion-availability notification.
- **sub-wt14** (unwanted): If a selected run is terminal and its final output, final error, or `output_available = false` terminal record is available to the completion-read path, then `agent_wait` shall not return `no_waitable_run` for that run.

### agent_list and agent_close

- **sub-ls01** (event-driven): When `agent_list` runs, the system shall list agents owned by the session with their latest run state, showing open identities by default and closed ones when `include_closed = true`.
- **sub-ls02** (ubiquitous): The system shall output `agent_id`, profile, lifecycle, active/latest `run_id`, run state, elapsed time, and bounded status/reason codes, never child output or full error text.
- **sub-cl01** (event-driven): When `agent_close` runs with ids or `all`, the system shall cancel each active run with reason `closed_by_parent`, close the identity permanently, and keep historical run output inspectable.
- **sub-cl02** (ubiquitous): The system shall treat `agent_close` as the only model-facing permanent close primitive and interrupt-only `agent_send` as the non-closing pause.

### agent_profiles

- **sub-pf01** (event-driven): When `agent_profiles` runs, the system shall return the model-facing available profile catalog with sandbox summary and canonical tool names, omitting profiles disabled by current session visibility; user-facing `/agents` lists may still show disabled profiles.
- **sub-pf02** (ubiquitous): The system shall keep the `agent_profiles` schema and description stable, so `/agents` toggles mutate neither the model schema nor the system prompt.

### Goal-mode continuation

- **sub-gc01** (ubiquitous): The system shall drive goal-mode runs with a sequential continuation loop orchestrated in the TypeScript host while OCaml makes the per-step continue/stop decision through `planChildGoalContinuation`, reusing `Goal.plan_continuation`/`should_continue`.
- **sub-gc02** (event-driven): When a goal-mode step completes, the system shall read the child's `taumel.goal` and `taumel.goal_automation`, request a continuation prompt or finalize decision from OCaml, send a continuation as a follow-up into the same child session, and repeat.
- **sub-gc03** (event-driven): When finalizing a goal-mode run, the system shall map goal `complete` to run `completed` after too-brief handling, goal `blocked` to `failed` with reason `goal_blocked`, and the continuation cap to `failed` with reason `goal_continuation_limit`.
- **sub-gc04** (ubiquitous): The system shall create goal-mode child goals internally before the first child turn, without a visible child `create_goal` call.
- **sub-gc05** (event-driven): When a child marks its goal `complete` or `blocked`, the system shall not interrupt the turn and shall wait for the final assistant handoff as run output.
- **sub-gc06** (ubiquitous): The system shall derive goal-mode run completion from child turn completion plus child goal state, and plain-message run completion from the single turn result, not from assistant prose.
- **sub-gc07** (event-driven): When a successful goal-mode run's last assistant text is under 200 trimmed characters, the system shall send one too-brief continuation and take the new last text as final output; plain-message and non-success runs skip this.
- **sub-gc08** (ubiquitous): The system shall take a run's final output from the child's final assistant handoff rather than a host-generated summary.

### Data model

- **sub-dm01** (ubiquitous): The system shall keep an agent identity durable until closed, with `agent_id`, parent session, profile, attached live child session, and created/closed timestamps, reusing one Pi child session across runs.
- **sub-dm02** (ubiquitous): The system shall snapshot provider, model, thinking, tools, sandbox, and prompt at spawn time, so later config changes affect only future spawns.
- **sub-dm03** (ubiquitous): The system shall generate `agent_id` as `<profile>-<shortid>` (4–6 lowercase unambiguous characters, retrying on collision), never reuse it within a session, never accept it from the model, and allow multiple open agents per profile.
- **sub-dm04** (ubiquitous): The system shall give a run `run_id`, `agent_id`, initial submission kind, submission ids and kinds, status, reason code, parent terminal-consumption state, completion-notification state, and timestamps, with statuses `queued`, `running`, `suspended`, `completed`, `failed`, `cancelled`, `timed_out`, and `lost`.
- **sub-dm07** (ubiquitous): The system shall represent parent terminal-consumption state as a closed enum with exactly `pending` and `consumed_by_agent_wait`; status-only waits, bounded wait timeouts, non-terminal run updates, and completion notifications shall not change this state.
- **sub-dm08** (unwanted): If a run's parent terminal-consumption state is `consumed_by_agent_wait`, then the system shall reject or make impossible any later transition that would consume the same terminal run again or return its final output/error body again.
- **sub-dm09** (ubiquitous): The system shall represent completion-notification state as a closed enum with exactly `pending` and `sent`; failed notification sends leave the state `pending`, and successful sends transition it to `sent`.
- **sub-dm05** (ubiquitous): The system shall create a `submission_id` per spawn and send, attaching an active-run send to that run by steering and starting a new non-goal run for an idle send.
- **sub-dm06** (event-driven): When a Pi child session is lost after exit or resume, the system shall not auto-recreate it during `/resume`; a later `agent_send` shall create a new child runtime behind the same `agent_id` as a new run.

### Profiles

- **sub-pr01** (ubiquitous): The system shall define agent profiles as Markdown with YAML frontmatter and the body as the system prompt, shipping built-ins `smart`, `deep`, `rush`, `finder`, `librarian`, `oracle`, `painter`, and `review`, with no `plan` profile.
- **sub-pr02** (ubiquitous): The system shall require frontmatter `name`, `description`, `provider`, `model`, `thinking`, `sandbox`, and `tools`, allow `inherit`, and treat omission, Tau keys (`models`, `spawns`, `approval_timeout`), and built-in prompt text that tells a child to spawn agents as errors.
- **sub-pr03** (ubiquitous): The system shall treat `provider` and `model` as an atomic pair (both `inherit` or both concrete), keep `thinking` independently inheritable, restrict `sandbox` to `inherit`, `read-only`, or `workspace-write`, and accept an optional `approval` field restricted to `inherit`, `never`, `on-request`, `on-failure`, or `untrusted` and defaulting to `inherit`.
- **sub-pr04** (ubiquitous): The system shall load user profiles from `~/.pi/agent/taumel/agents/*.md`, reserve built-in names, reject a user profile using a built-in name, and exclude project-local profiles.
- **sub-pr05** (ubiquitous): The system shall override built-in profile model routing only from Pi config JSON (global and trusted project) under direct `taumel.agents.<profile>` entries for built-in profile names, with complete inherit-or-concrete `provider`/`model`/`thinking` entries.
- **sub-pr10** (ubiquitous): The system shall resolve built-in profile routing by whole profile entry according to the shared Taumel config precedence, so a valid higher-precedence entry for a built-in profile replaces a lower-precedence entry for that profile rather than merging fields.
- **sub-pr07** (ubiquitous): The system shall not apply Pi config routing overrides to user profile markdown files; user profile routing shall come from the profile frontmatter.
- **sub-pr08** (ubiquitous): The system shall ignore unknown keys under `taumel.agents` that are neither `disabled` nor built-in profile names, preserving them on writes and emitting no warning for their presence.
- **sub-pr09** (unwanted): If a built-in profile routing entry in Pi config is malformed, then the system shall warn and skip only that profile's malformed override while keeping valid routing entries from the same and other config scopes.
- **sub-pr06** (event-driven): When the user runs `/taumel init` and global Pi config is missing built-in profile routing entries, the system shall create complete `provider = inherit`, `model = inherit`, and `thinking = inherit` entries for every missing built-in profile only in global Pi config.
- **sub-pr11** (ubiquitous): The system shall not materialize built-in profile routing entries during extension startup, session start, model-facing agent tool calls, or any other background path.

### Tool visibility and validation

- **sub-tv01** (ubiquitous): The system shall treat profile `tools` as authoritative, inheriting parent active tools minus agent tools for `inherit`, exposing exactly the listed names for an explicit list, and never intersecting with the parent active tool list.
- **sub-tv02** (ubiquitous): The system shall never expose an agent tool to a child, even with an explicit tool list.
- **sub-tv03** (ubiquitous): The system shall always add `update_goal` to the child tool surface and never add `create_goal`.
- **sub-tv04** (event-driven): When validating profiles, the system shall check every tool name against the live Pi tool registry and require canonical names.

### Session toggles and persistence

- **sub-tg01** (ubiquitous): The system shall treat profile toggles as session-effective visibility state in `taumel.agents`, initialized from trusted project defaults only when no session state exists.
- **sub-tg02** (event-driven): When a profile is disabled for the session, the user-facing `/agents` manager shall show it as disabled, while model-facing profile discovery shall avoid presenting it as an available choice.
- **sub-tg03** (ubiquitous): The system shall start a new session with all startup-valid profiles enabled unless trusted project defaults disable them, and shall restore session toggles on `/resume`.
- **sub-ps01** (ubiquitous): The system shall store profile toggles, durable identities, run metadata, and delivery flags in `taumel.agents`, storing metadata only and no raw text.
- **sub-ps02** (event-driven): When a session resumes, the system shall restore identities and run state and mark runs persisted as `queued`, `running`, or `suspended` without a live worker as `lost` with reason `process_resumed_without_live_worker`, without auto-restarting them.
- **sub-ps03** (ubiquitous): The system shall keep final output, transcripts, prompts, and tool logs Pi/worker-owned rather than in `taumel.agents`, and show final output as the default displayed output for completed runs.

### Child session creation

- **sub-cs01** (ubiquitous): The system shall create child sessions as Tau-style worker `AgentSession` instances through the Pi SDK `createAgentSession` with their own in-memory manager, not `newSession()`, and shall not navigate the user's main session.
- **sub-cs02** (ubiquitous): The system shall let TypeScript own Pi SDK create, steer, abort, and dispose calls and OCaml own the typed state machine, profile resolution, run/submission metadata, and next-action decisions.

### Markup and rendering

- **sub-mk01** (ubiquitous): The system shall emit model-visible subagent outputs as XML-style markup with controlled metadata as attributes and freeform child text as raw, unescaped block elements, keeping the stored final output plain; completion-availability notifications shall use plain text.
- **sub-mk02** (ubiquitous): The system shall mirror the same domain concepts in structured details and keep important semantic data in model-visible content and details rather than only in UI.
- **sub-mk03** (ubiquitous): When a subagent completion-availability notification includes a read instruction, that instruction shall be plain text rather than XML or JSON.
- **sub-rn01** (ubiquitous): The system shall render subagent tools with one shared agent-event grammar keyed on run state, one line compact and minimal structured metadata plus final output or error expanded, never raw transcript or the XML envelope.
- **sub-rn02** (ubiquitous): The system shall keep `agent_list` free of full terminal output, allowing only bounded summaries, with unconsumed terminal output available through `agent_wait run_ids` and historical user-facing output available through `/agent-runs output`.
- **sub-rn03** (ubiquitous): The system shall render `agent_profiles` with a separate catalog renderer (counts compact; name, enabled state, sandbox, tools, and description expanded).
- **sub-rn04** (ubiquitous): The system shall render `agent_spawn` expanded output as human-readable profile/id/status fields plus the full message or objective that the parent sent, not as raw XML.
- **sub-rn05** (ubiquitous): The system shall render `agent_wait` expanded output as grouped child responses with tiny run headers, not as raw XML, and shall show omitted timeouts as `until completion`, positive timeouts as `up to Ns`, and zero timeouts as `poll now`.

### Commands

- **sub-cm01** (event-driven): When the user runs `/agents` in TUI mode, the system shall open a cron-style profile manager that toggles the current session immediately and can save current disabled profiles to trusted project config with `Ctrl+S`.
- **sub-cm02** (event-driven): When the user runs `/agent-runs`, the system shall provide inspect, stop, close, and output controls for identities and runs, where stop interrupts and keeps runs resumable and close permanently closes.
- **sub-cm03** (ubiquitous): The system shall let disabling a profile block only new spawns, keeping existing agents on that profile sendable until stopped or closed and preserving their immutable profile.
- **sub-cm04** (event-driven): The command forms `/agents list`, `/agents enable <profile>`, `/agents disable <profile>`, and `/agents save` shall work in TUI and non-TUI modes; `/agents` with no args shall list state in non-TUI modes.

### Sandbox and approval

- **sub-sa01** (ubiquitous): The system shall never allow `no_sandbox` for subagents, clamp a child sandbox preset to at most the parent's and a child approval policy to at least the parent's strictness, reject `danger-full-access` declarations, and clamp an inherited `danger-full-access` to `workspace-write`.
- **sub-sa02** (event-driven): When a child tool needs escalation, the system shall show the approval prompt to the user identifying the requesting agent or profile and run child tools under the child session sandbox.

### Completion availability

- **sub-cd01** (ubiquitous): The system shall own a single in-process notification queue of pending completion-availability notifications backed by run state (terminal, not consumed by a terminal `agent_wait` response, and not already notification-sent).
- **sub-cd02** (event-driven): When `agent_wait` returns a terminal run response first, the system shall mark it consumed and suppress background notification. Otherwise, each terminal run that has not been consumed and not notification-sent shall flush at the parent's `turn_end` as a steering `notification` custom message for `agent_completion`, and via `triggerTurn` when the parent is idle, never as a follow-up.
- **sub-cd03** (ubiquitous): The system shall mark a completion notification sent only after the Pi send succeeds, leave failed sends pending for a later flush, and never resend a successfully sent notification even while its terminal response remains unconsumed.
- **sub-cd04** (ubiquitous): The system shall exclude suspended runs from background completion notifications, keep completion events visible in the UI, and keep final output/error out of the notification body.
- **sub-cd05** (ubiquitous): An `agent_completion` notification shall be plain text and opaque: it shall not include the subagent's final output, error body, final run status, reason code, or error class. It shall include only locator metadata (`run_id`, `agent_id`, and profile when available) and a visible instruction equivalent to: `Agent run RUN_ID for AGENT_ID (PROFILE) has finished. To read and consume the result, call agent_wait with run_ids=[RUN_ID], timeout_seconds=0.`
- **sub-cd06** (ubiquitous): The system shall use one shared terminal-run source for `agent_wait` and `agent_completion`, so the notification path cannot claim a run is ready while `agent_wait` cannot read it.
- **sub-cd07** (event-driven): When `agent_wait` returns a terminal run response, the system shall transition parent terminal-consumption state from `pending` to `consumed_by_agent_wait`.
- **sub-cd08** (event-driven): When an `agent_completion` notification send succeeds, the system shall transition only the completion-notification state; it shall leave parent terminal-consumption state as `pending`.
- **sub-cd09** (ubiquitous): While the parent session remains live, every terminal run whose response is unconsumed shall remain readable through `agent_wait` until consumed or the parent shuts down.
- **sub-cd10** (unwanted): An `agent_completion` notification shall never instruct the model to use `agent_ids`, because completion availability is scoped to one `run_id` and `agent_ids` may resolve to a later active or terminal run.
- **sub-cd11** (ubiquitous): The read instruction in an `agent_completion` notification shall be a poll-once read with `timeout_seconds = 0`; it shall not omit `timeout_seconds` or use a positive timeout.
- **sub-cd12** (ubiquitous): The read instruction shall appear in the visible `notification` content itself; structured details may mirror it for rendering and tests, but hidden details shall not be the only source of the read instruction.

### Startup validation

- **sub-vd01** (event-driven): When a session starts, the system shall validate profile shape, duplicates, built-in-name collisions, required fields, inherit-or-concrete values, tool names against `pi.getAllTools()`, and built-in override targets before registering or enabling model-facing agent tools.
- **sub-vd02** (unwanted): If any startup check fails, then the system shall make the six agent tools not model-callable (not registering absent ones, or removing previously registered ones from the active tool list), keep `/agents` and `/agent-runs` available, show a startup diagnostic, and keep the rest of Taumel running.
- **sub-vd03** (ubiquitous): The system shall evaluate agent availability per session on start, resume, new, and fork and apply it through the session active-tool list, since Pi exposes `registerTool` but no `unregisterTool`.
