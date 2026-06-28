---
kind: requirement
status: draft
tags: [goal, continuation, session]
depends_on: []
---
# Goal

## Intent

A goal is a per-session objective that lets the agent continue useful work across
turns. It tracks lifecycle status, active-time accounting, token telemetry, and
an automation gate that decides whether the next hidden continuation may run.
Goal state and the continuation predicate live in the OCaml core; TypeScript is
the smallest possible Pi bridge. Codex goal is the architectural reference, and
Pi owns retry and compaction. Taumel diverges from Codex on one point: interrupt
does not pause the goal lifecycle.

## Requirements

### Goal state

- **goal-gs01** (ubiquitous): The system shall store the goal in the session entry `taumel.goal` with `goalId`, `threadId`, `objective`, `status`, `tokensUsed`, `timeUsedSeconds`, optional `timeLimitSeconds`, `createdAt`, and `updatedAt`.
- **goal-gs02** (ubiquitous): The system shall provide the statuses `active`, `paused`, `blocked`, `usage_limited`, `time_limited`, and `complete`.
- **goal-gs03** (ubiquitous): The system shall treat `tokensUsed` as telemetry that never controls lifecycle state.
- **goal-gs04** (ubiquitous): The system shall set `timeLimitSeconds` only when the user explicitly requests a time limit.

### Automation gate

- **goal-au01** (ubiquitous): The system shall default continuation to enabled by the absence of `taumel.goal_automation` and persist that entry only when continuation is interrupted (`continuation = interrupted`, `requiresUserInput = true`).
- **goal-au02** (state-driven): While the goal status is `active` and automation continuation is enabled, the system shall treat continuation as effective.

### Tools

- **goal-gt01** (event-driven): When the model calls `get_goal`, the system shall return `goal`, `status`, `tokensUsed`, `timeUsedSeconds`, `timeLimitSeconds`, and `automation`.
- **goal-ct01** (event-driven): When `create_goal` runs while no goal exists or the existing goal is `complete`, the system shall create an active goal and reset automation to enabled by deleting `taumel.goal_automation`.
- **goal-ct02** (unwanted): If a non-complete goal exists, then the system shall reject `create_goal`.
- **goal-ut01** (event-driven): When the model calls `update_goal`, the system shall allow setting only `complete` or `blocked`.
- **goal-ut02** (unwanted): If `update_goal` targets `active`, `paused`, `usage_limited`, `time_limited`, a time limit, or automation state, then the system shall reject it.

### Commands

- **goal-cm01** (event-driven): When the user runs `/goal <objective>` while no non-complete goal exists, the system shall create a goal and parse `--time-limit` with units `s`, `m`, or `h` only.
- **goal-cm02** (event-driven): When the user runs `/goal resume` from `paused`, `blocked`, `usage_limited`, `time_limited`, or `active` with interrupted automation, the system shall set the status to `active`, clear interrupted automation, may inject resume content, and honor `--time-limit` and `--no-time-limit`.
- **goal-cm03** (unwanted): If the user resumes from `time_limited` without changing or removing the limit, then the system shall reject the resume.
- **goal-cm04** (event-driven): When the user runs `/goal pause`, the system shall set the status to `paused` and delete `taumel.goal_automation`.
- **goal-cm05** (event-driven): When the user runs `/goal clear`, the system shall delete `taumel.goal` and `taumel.goal_automation`.

### Continuation

- **goal-co01** (ubiquitous): The system shall decide continuation through one OCaml predicate reused by the command, event, and resume paths.
- **goal-co02** (event-driven): When the goal is `active`, automation is enabled, the host is idle, no messages are pending, no retry or compaction is in progress, and the latest assistant stop reason is neither `error` nor `aborted`, the system shall send the continuation.
- **goal-co03** (ubiquitous): The system shall deliver the continuation as a Pi follow-up message rather than a steering message.

### Interrupt

- **goal-in01** (event-driven): When the user interrupts with Escape or Ctrl-C, the system shall account completed progress, keep the status `active`, persist automation as interrupted, and suppress continuation from that event.
- **goal-in02** (event-driven): When a normal model-directed user message arrives, the system shall clear interrupted automation silently without injecting goal text.
- **goal-in03** (state-driven): While automation is interrupted, the system shall preserve it across the pure local commands `/permissions`, `/network`, `/composer`, and `/usage`, and across `/resume`, clearing it only on `/goal resume`, `/goal clear`, or `/goal pause`.

### Retry and compaction

- **goal-rc01** (ubiquitous): The system shall rely on Pi for retry and shall implement no provider or network retry classifier.
- **goal-rc02** (state-driven): While retrying or compacting, the system shall suppress continuation, and `agent_end.willRetry` or `compaction_end.willRetry` shall keep suppression until retry finishes.
- **goal-rc03** (event-driven): When a final unrecoverable turn error arrives, the system shall set the goal `blocked`; when a usage or quota error arrives, it shall set the goal `usage_limited`.
- **goal-rc04** (event-driven): When only an extension `agent_end` with assistant stop reason `error` or `aborted` is available, the system shall suppress continuation without auto-blocking the goal.

### Time limit

- **goal-tl01** (ubiquitous): The system shall enforce active-time limits, counting model generation, tool execution, and in-turn process time, and excluding idle time and bracketed approval waits.
- **goal-tl02** (event-driven): When `timeUsedSeconds` reaches `timeLimitSeconds`, the system shall set the status to `time_limited` after the current turn finishes, without interrupting a turn mid-flight.
- **goal-tl03** (ubiquitous): The system shall subtract wait time only for waits it brackets exactly (`confirmExecApproval`), using nested pause-depth accounting.

### Persistence

- **goal-ps01** (ubiquitous): The system shall persist `taumel.goal` always and `taumel.goal_automation` only when interrupted, and when automation returns to enabled shall remove the entry or append a `null` tombstone that decodes to enabled.
- **goal-ps02** (unwanted): If a saved goal entry carries legacy fields such as `tokenBudget` or `budget_limited`, then the system shall reject it, surface a non-fatal diagnostic when a UI is available, and decline to migrate.

### Footer

- **goal-ft01** (ubiquitous): The system shall show goal status in the footer and show interrupted automation separately from status.
