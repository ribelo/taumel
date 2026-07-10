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
- **goal-au03** (ubiquitous): The model shall not suspend goal continuation by ending a turn, declining to poll, starting or leaving a live exec session, or reporting progress in text; only the user-controlled interruption and lifecycle paths specified here may interrupt automation, and only `complete` or `blocked` may be model-directed terminal transitions.

### Permission boundary

- **goal-pm01** (ubiquitous): Goal lifecycle and automation state shall not change, save, restore, or override the session's sandbox preset, approval policy, network mode, `no-sandbox` state, tool surface, or agent allowlist.
- **goal-pm02** (state-driven): While a goal is active, every model and tool turn shall use the session's independently current permission envelope, including explicit user changes made after the goal started.

### Tools

- **goal-gt01** (event-driven): When the model calls `get_goal`, the system shall return `goal`, `status`, `tokensUsed`, `timeUsedSeconds`, `timeLimitSeconds`, and `automation`.
- **goal-gt02** (state-driven): While the main agent's assigned tool surface includes the goal capability, `get_goal`, `create_goal`, and `update_goal` shall remain exposed across every goal lifecycle state; invalid calls shall return the explicit state-specific errors rather than causing tool visibility changes.
- **goal-ct01** (event-driven): When `create_goal` runs while no goal exists or the existing goal is `complete`, the system shall create an active goal and reset automation to enabled by deleting `taumel.goal_automation`.
- **goal-ct02** (unwanted): If a non-complete goal exists, then the system shall reject `create_goal`.
- **goal-ut01** (event-driven): When the model calls `update_goal`, the system shall allow setting only `complete` or `blocked`.
- **goal-ut02** (unwanted): If `update_goal` targets `active`, `paused`, `usage_limited`, `time_limited`, a time limit, or automation state, then the system shall reject it.
- **goal-ut03** (event-driven): When `update_goal` transitions a goal to `complete` or `blocked`, the system shall return the updated structured goal state and allow the current Pi turn to finish normally.
- **goal-ut04** (unwanted): A terminal `update_goal` call shall not generate or inject a separate user-facing outcome summary, terminate the current Pi turn, or request another hidden continuation.

### Commands

- **goal-cm01** (event-driven): When the user runs `/goal <objective>` while no non-complete goal exists, the system shall create a goal and parse `--time-limit` with units `s`, `m`, or `h` only.
- **goal-cm02** (event-driven): When the user runs `/goal resume` from `paused`, `blocked`, `usage_limited`, `time_limited`, or `active` with interrupted automation, the system shall set the status to `active`, clear interrupted automation, may inject resume content, and honor `--time-limit` and `--no-time-limit`.
- **goal-cm03** (unwanted): If the user resumes from `time_limited` without changing or removing the limit, then the system shall reject the resume.
- **goal-cm04** (event-driven): When the user runs `/goal pause`, the system shall set the status to `paused` and delete `taumel.goal_automation`.
- **goal-cm05** (event-driven): When the user runs `/goal clear`, the system shall delete `taumel.goal` and `taumel.goal_automation`.
- **goal-cm06** (event-driven): When `/goal <objective>` is valid, the system shall create the active goal and then submit the objective as a visible user message that starts the first goal turn.
- **goal-cm07** (unwanted): If `/goal <objective>` has invalid syntax, an invalid time limit, an empty objective, or conflicts with an existing non-complete goal, then the system shall report the command error before creating goal state or submitting any prompt.
- **goal-cm08** (unwanted): If Pi rejects or throws while submitting the initial user message for a newly created goal, then the system shall restore the exact goal and automation state that existed before the command and report the startup failure.
- **goal-cm09** (event-driven): When `/goal <objective>` starts while Pi is busy or user messages are pending, the system shall submit the objective through Pi's normal visible user-message path and preserve Pi's queue order without creating a Taumel-owned goal-start queue or prioritizing the objective.

### Continuation

- **goal-co01** (ubiquitous): The system shall decide continuation through one OCaml predicate reused by the command, event, and resume paths.
- **goal-co02** (event-driven): When the goal is `active`, automation is enabled, the host is idle, no messages are pending, no retry or compaction is in progress, and the latest assistant stop reason is neither `error` nor `aborted`, the system shall send the continuation.
- **goal-co03** (ubiquitous): The system shall deliver the continuation as a Pi follow-up message rather than a steering message.
- **goal-co04** (ubiquitous): The system shall express each automated continuation as one model-visible follow-up message and shall not add a second per-turn goal-context injection mechanism.
- **goal-co05** (ubiquitous): The continuation message shall include the XML-escaped objective marked as untrusted user-provided task data, active status, token telemetry, active time used, and the explicit active-time limit when one exists.
- **goal-co06** (ubiquitous): The continuation message shall instruct the model to preserve the full objective, make one bounded useful increment when material work remains, verify completion against current authoritative evidence, call `update_goal complete` only when every required outcome is satisfied, and call `update_goal blocked` only at a genuine impasse requiring user input or an external-state change.
- **goal-co07** (unwanted): The continuation message shall not synthesize strategy, redefine success, introduce a budget the user did not request, or treat turn boundaries, difficulty, uncertainty, or incomplete work as completion or blockage.
- **goal-co08** (unwanted): The system shall not require or represent a model-counted consecutive-turn blocker threshold and shall not add cross-turn repetition tracking to decide whether `blocked` is valid.
- **goal-co09** (unwanted): While a goal is `paused`, `blocked`, `usage_limited`, or `time_limited`, the system shall not inject its objective or status into unrelated normal user turns; inactive goal state shall remain available through the footer, `/goal`, and `get_goal` until explicitly resumed or cleared.

### Interrupt

- **goal-in01** (event-driven): When the user interrupts with Escape or Ctrl-C, the system shall account completed progress, keep the status `active`, persist automation as interrupted, and suppress continuation from that event.
- **goal-in02** (event-driven): When a normal model-directed user message arrives, the system shall clear interrupted automation silently without injecting goal text.
- **goal-in03** (state-driven): While automation is interrupted, the system shall preserve it across the pure local commands `/permissions`, `/network`, `/composer`, and `/usage`, and across `/resume`, clearing it only on `/goal resume`, `/goal clear`, or `/goal pause`.

### Retry and compaction

- **goal-rc01** (ubiquitous): The system shall rely on Pi for retry and shall implement no provider or network retry classifier.
- **goal-rc02** (state-driven): While retrying or compacting, the system shall suppress continuation, and `agent_end.willRetry` or `compaction_end.willRetry` shall keep suppression until retry finishes.
- **goal-rc03** (event-driven): When a final unrecoverable turn error arrives, the system shall set the goal `blocked`; when a usage or quota error arrives, it shall set the goal `usage_limited`.
- **goal-rc04** (event-driven): When only an extension `agent_end` with assistant stop reason `error` or `aborted` is available, the system shall suppress continuation without auto-blocking the goal.

### Accounting

- **goal-ac01** (event-driven): When an assistant turn completes while the goal is `active`, the system shall add that turn's uncached input plus output tokens to `tokensUsed` and its active seconds to `timeUsedSeconds`, exactly once per turn keyed by session, branch length, and usage.
- **goal-ac02** (event-driven): When the goal transitions to `complete` or `blocked` through `update_goal` or `/goal`, the system shall account the in-flight turn while the goal is still `active` before applying the terminal status, so the returned `tokensUsed` and `timeUsedSeconds` include that turn.
- **goal-ac03** (ubiquitous): The system shall report `tokensUsed` as the sum of every accounted turn's uncached input plus output tokens and `timeUsedSeconds` as the sum of every accounted turn's active seconds.

### Time limit

- **goal-tl01** (ubiquitous): The system shall enforce active-time limits, counting model generation, tool execution, and in-turn process time, and excluding idle time and bracketed approval waits.
- **goal-tl02** (event-driven): When `timeUsedSeconds` reaches `timeLimitSeconds`, the system shall set the status to `time_limited` after the current turn finishes, without interrupting a turn mid-flight.
- **goal-tl03** (ubiquitous): The system shall subtract wait time only for waits it brackets exactly (`confirmExecApproval`), using nested pause-depth accounting.

### Persistence

- **goal-ps01** (ubiquitous): The system shall persist `taumel.goal` always and `taumel.goal_automation` only when interrupted, and when automation returns to enabled shall remove the entry or append a `null` tombstone that decodes to enabled.
- **goal-ps02** (unwanted): If a saved goal entry carries legacy fields such as `tokenBudget` or `budget_limited`, then the system shall reject it, surface a non-fatal diagnostic when a UI is available, and decline to migrate.

### Footer

- **goal-ft01** (ubiquitous): The system shall show goal status in the footer and show interrupted automation separately from status.
