# Goal PRD

## What It Is

Taumel goals are per-session objectives that let the agent continue useful work
across turns. A goal tracks lifecycle status, active work time, token telemetry,
and the automation gate that decides whether Taumel may inject the next hidden
goal continuation.

The reference implementation is Codex goal:

`/home/ribelo/projects/ribelo/codex/codex-rs/ext/goal`

Raw Pi owns model retry, compaction recovery, turn execution, and UI event
delivery. Taumel must consume those host signals; it must not duplicate Pi retry
policy.

## Goals

- Keep goal state and continuation policy in the OCaml core.
- Keep TypeScript as the smallest possible Pi bridge.
- Match Codex goal behavior where it fits Taumel.
- Intentionally diverge from Codex interrupt handling: interrupt does not pause
  the goal lifecycle.
- Replace token budgets with optional active-time limits.
- Expose enough state to the model and UI to avoid hidden continuation loops.

## Non-Goals

- No token budget enforcement.
- No Taumel-owned provider retry classifier.
- No migration for old persisted goal schemas.
- No compatibility with legacy Taumel goal fields.
- No shared lifecycle engine with Ralph, Exa, or other loops.

## Source Of Truth

Codex is the architectural reference for:

- `get_goal`, `create_goal`, `update_goal`
- active thread goal state
- turn accounting hooks
- goal continuation from idle state
- blocking on terminal unrecoverable turn errors
- model-visible tool result shape

Raw Pi is the host reference for:

- retry attempts and retry exhaustion
- context-overflow compaction and compact-and-retry
- abort/interruption event delivery
- pending message and idle detection
- session event stream shape

Tau is not a source of truth. Tau is only useful as historical evidence for
edge cases.

## Data Model

### Goal

Stored in the session file as `taumel.goal`.

```ts
interface Goal {
  goalId: string;
  threadId: string;
  objective: string;
  status: GoalStatus;
  tokensUsed: number;
  timeUsedSeconds: number;
  timeLimitSeconds?: number;
  createdAt: number;
  updatedAt: number;
}
```

Statuses:

```text
active
paused
blocked
usage_limited
time_limited
complete
```

`tokensUsed` is telemetry only. It must not control lifecycle state.

`timeLimitSeconds` is optional. The model may set it only when the user
explicitly asks for a time limit.

### Goal Automation

Stored in the session file only when non-default, as `taumel.goal_automation`.

Default by absence:

```text
continuation = enabled
```

Persisted interrupted state:

```ts
interface GoalAutomation {
  continuation: "interrupted";
  requiresUserInput: true;
}
```

Automation is separate from goal lifecycle status. Effective continuation
requires both:

```text
goal.status == active
automation.continuation == enabled
```

## Commands And Tools

### `get_goal`

Returns the current goal and automation state.

Required fields:

- `goal`
- `status`
- `tokensUsed`
- `timeUsedSeconds`
- `timeLimitSeconds`
- `automation`

Removed fields:

- `tokenBudget`
- `remainingTokens`
- `completionBudgetReport`

### `create_goal`

Allowed only when no goal exists or the existing goal is `complete`.

Rejected when any non-complete goal exists:

```text
active
paused
blocked
usage_limited
time_limited
```

Input:

```ts
interface CreateGoalParams {
  objective: string;
  time_limit_seconds?: number;
}
```

Tool contract:

```text
Set time_limit_seconds only when the user explicitly requests a time limit.
Do not invent or extend a time limit yourself.
```

On success:

- create active goal
- reset automation to enabled by deleting `taumel.goal_automation`

### `update_goal`

Model-callable `update_goal` may set only:

- `complete`
- `blocked`

It must not set:

- `active`
- `paused`
- `usage_limited`
- `time_limited`
- time limits
- automation state

### `/goal <objective>`

Creates a new goal only when no non-complete goal exists.

Supported user syntax:

```text
/goal Fix flaky tests --time-limit 30m
/goal Refactor bridge --time-limit 2h
/goal Ship cleanup --time-limit 90s
```

No natural-language duration parsing. Supported units: `s`, `m`, `h`.

### `/goal resume`

Allowed from:

- `paused`
- `blocked`
- `usage_limited`
- `time_limited`
- `active` with interrupted automation

Effects:

- set status to `active` when resuming from a stopped status
- clear interrupted automation
- may inject explicit goal resume/goal content immediately

Time-limit override syntax:

```text
/goal resume --time-limit 30m
/goal resume --no-time-limit
```

Resuming from `time_limited` is valid only after the time limit is changed or
removed so the goal is no longer already over limit.

### `/goal pause`

Sets status to `paused`.

Also deletes `taumel.goal_automation`, because explicit pause is the stronger
control state.

### `/goal clear`

Deletes:

- `taumel.goal`
- `taumel.goal_automation`

## Continuation Policy

The continuation predicate belongs in OCaml core. TypeScript supplies parsed
host facts and sends the continuation only when OCaml returns `Send`.

```ocaml
type continuation_facts = {
  goal : Goal.t option;
  automation : Goal_automation.t;
  host_idle : bool;
  has_pending_messages : bool;
  retrying : bool;
  compacting : bool;
  latest_assistant_stop_reason : string option;
}
```

Continuation is allowed only when:

```text
goal.status == active
automation.continuation == enabled
host_idle == true
has_pending_messages == false
retrying == false
compacting == false
latest_assistant_stop_reason not in ["error", "aborted"]
```

The predicate must be implemented once and reused by command, event, and resume
paths.

### Continuation Delivery

When the predicate returns `Send`, the continuation is delivered as a Pi
**follow-up** message, not a steering message. This is a deliberate choice and
the inverse of background agent-completion notifications (which use steering):

- Goal continuation is reactive to the turn *ending* (`agent_end`): the agent
  finished its current turn, and continuation is the driver that starts the
  *next* turn. A follow-up is delivered at end of turn and triggers that next
  turn, which is exactly the turn-by-turn advance the goal loop needs.
- A steering message would inject the continuation prompt *mid-turn*, into a
  turn that is still running. That is wrong for goal continuation: there is no
  in-progress turn to steer into at the moment continuation fires, and steering
  goal-nudge text into live work is not the intended semantics.

So: goal continuation = follow-up (advance to the next turn once the current
one ends); background agent-completion notification = steering (interleave a
finished child's result between the parent's tool calls). The two are
intentionally different and must not be unified.

## Interrupt Policy

Taumel intentionally diverges from Codex here.

Codex TUI pauses an active goal on interrupt. Taumel does not pause the goal.

On Escape/Ctrl-C interrupt:

- account any completed progress
- keep `goal.status = active`
- persist `taumel.goal_automation` as interrupted
- suppress continuation from that event
- require a model-directed user message or `/goal resume` before continuation
  can run again

Any normal user message that enters the conversation/model flow clears
interrupted automation silently. It does not inject goal text immediately.

Pure local commands do not clear interrupted automation:

- `/permission`
- `/network`
- `/composer`
- `/usage`

Exceptions:

- `/goal resume` clears automation and may inject goal content
- `/goal clear` deletes automation because it deletes the goal
- `/goal pause` deletes automation because pause takes precedence

Interrupted automation survives `/resume`.

## Retry And Compaction Policy

Pi owns retry. Taumel must not implement a provider/network retry classifier.

If Taumel can subscribe to Pi session-level events, it should use:

- `auto_retry_start`
- `auto_retry_end`
- `agent_end.willRetry`
- `compaction_start`
- `compaction_end.willRetry`

These events are gates only. They must not schedule Taumel retries.

Rules:

- while retrying, suppress goal continuation
- while compacting, suppress goal continuation
- `agent_end.willRetry == true` suppresses continuation
- `compaction_end.willRetry == true` keeps suppression until retry finishes
- `auto_retry_end { success: false }` clears retry gate but does not by itself
  mark the goal blocked
- plain Pi extension `agent_end` with assistant `stopReason = "error"` is not
  enough to auto-block, because extension events do not carry `willRetry`

If Taumel receives a true final lifecycle error equivalent to Codex
`on_turn_error`, then:

- usage/account quota error -> `usage_limited`
- final unrecoverable turn error -> `blocked`

Otherwise the model must call `update_goal blocked` after repeated blockage.

## Time Limit Policy

Taumel enforces active-time limits, not wall-clock deadlines.

Counts toward `timeUsedSeconds`:

- model generation time
- tool execution time
- shell/test/process time within the agent turn

Does not count:

- idle time between turns
- approval waits, if bracketed exactly

Implementation requirement:

- turn start records wall-clock start
- turn end records wall-clock end
- explicit wait brackets accumulate paused milliseconds
- accounting subtracts accumulated paused milliseconds
- if `timeUsedSeconds >= timeLimitSeconds`, set status to `time_limited`
  after the current turn finishes

Do not interrupt a turn mid-flight solely because the time limit was reached.

### Wait-Time Bracketing

Subtract wait time only for waits Taumel owns and can bracket exactly:

- `confirmExecApproval(...)`

Runtime clock shape:

```ocaml
type goal_turn_clock = {
  turn_started_at_ms : int option;
  pause_depth : int;
  current_pause_started_at_ms : int option;
  paused_accumulated_ms : int;
}
```

Rules:

- first pause start at depth `0 -> 1` records pause start
- nested pause start increments depth only
- pause end decrements depth
- final depth `1 -> 0` accumulates elapsed paused time
- turn end finalizes any open pause before accounting
- approval timeout time is subtracted
- approval denial and timeout remain distinct model-visible outcomes

## Persistence

Session file entries:

- `taumel.goal`
- `taumel.goal_automation` only when interrupted

When automation returns to enabled, Taumel should remove the automation entry. If
the Pi custom-entry API only supports append and not delete, append a `null`
tombstone that decodes to the default enabled state.

No migration.

If an old saved goal entry has legacy fields such as `tokenBudget` or
`budget_limited`, the new decoder may reject it. Taumel should not resurrect
the old goal. It should surface a visible non-fatal diagnostic when possible:

```text
Ignoring incompatible saved Taumel goal entry.
```

If no UI surface is available, log only.

## UI And Footer

Footer examples:

```text
Pursuing goal
Pursuing goal (12m/30m)
Goal paused (/goal resume)
Goal blocked (/goal resume)
Goal hit usage limits (/goal resume)
Goal time limit reached (30m/30m, /goal resume --time-limit ...)
```

Interrupted automation should be visible separately from status, for example:

```text
Goal interrupted; send a message or /goal resume
```

## Acceptance Criteria

- No file exceeds 1000 LOC.
- `plans/goal.md` matches implemented behavior.
- Token budget fields are removed from tool contracts, persistence, prompts,
  and footer output.
- `budget_limited` is removed and replaced by `time_limited`.
- `tokensUsed` remains telemetry only.
- `timeLimitSeconds` is optional and enforced only at turn-end accounting.
- Approval waits are subtracted only through exact pause brackets.
- Interrupt persists `taumel.goal_automation` without changing active goal
  status.
- Normal model-directed user messages clear interrupted automation without
  injecting goal text immediately.
- `/goal resume` clears interrupted automation and may inject goal content.
- `/goal clear` deletes both goal and automation entries.
- Continuation goes through one OCaml predicate.
- Taumel does not implement provider/network retry classification.
- Pi retry and compaction signals gate continuation when available.
- Extension-only fallback suppresses continuation on assistant
  `stopReason = error | aborted`.
- Old persisted goal schema is not migrated.

## Open Questions

None from the current design pass.
