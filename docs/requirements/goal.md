---
kind: requirement
tags: [goal, continuation, session]
depends_on: []
---
# Goal

## Intent

A goal is a per-session objective that lets the agent continue useful work across
turns. It tracks lifecycle status, active-time accounting, token telemetry, and
an automation gate that decides whether the next visible system-authored continuation may run.
Goal state and the continuation predicate live in the OCaml core; TypeScript is
the smallest possible Pi bridge. Codex goal is the architectural reference, and
Pi owns retry and compaction. Taumel diverges from Codex on one point: interrupt
does not pause the goal lifecycle.

## Requirements

### Goal state

- The system shall store the goal in the session entry `taumel.goal` with `goalId`, `sessionId`, `objective`, `status`, `tokensUsed`, `timeUsedSeconds`, optional `timeLimitSeconds`, `createdAt`, and `updatedAt`. ^goal-gs01
- The system shall provide the statuses `active`, `paused`, `blocked`, `usage_limited`, `time_limited`, and `complete`. ^goal-gs02
- The system shall treat `tokensUsed` as telemetry that never controls lifecycle state. ^goal-gs03
- The system shall set `timeLimitSeconds` only when the user explicitly requests a time limit. ^goal-gs04
- Every newly created goal shall receive an identity unique within its owning session; timestamp resolution shall not permit identity reuse after clearing and recreating a goal. ^goal-gs05
- Goal ownership shall use the exact owning Pi session identity and shall not substitute the working-directory or workspace path as identity. ^goal-gs06
- A goal objective shall be immutable after creation; creation shall trim surrounding whitespace, reject an objective that becomes empty, and preserve internal objective text without normalization. Changing objective requires the user to clear and create a new goal. ^goal-gs07

### Automation gate

- The system shall default continuation to enabled by the absence of `taumel.goal_automation` and persist that entry only when continuation is interrupted (`continuation = interrupted`, `requiresUserInput = true`). ^goal-au01
- While the goal status is `active` and automation continuation is enabled, the system shall treat continuation as effective. ^goal-au02
- The model shall not suspend goal continuation by ending a turn, declining to poll, starting or leaving a live exec session, or reporting progress in text; only the user-controlled interruption and lifecycle paths specified here may interrupt automation, and only `complete` or `blocked` may be model-directed terminal transitions. ^goal-au03

### Permission boundary

- While a goal is active, every model and tool turn shall use the session's independently current permission envelope, including explicit user changes made after the goal started. ^goal-pm02

### Tools

- When the model calls `get_goal`, the system shall return `goal`, `status`, `tokensUsed`, `timeUsedSeconds`, `timeLimitSeconds`, and `automation`. ^goal-gt01
- While the main agent's assigned tool surface includes the goal capability, `get_goal`, `create_goal`, and `update_goal` shall remain exposed across every goal lifecycle state; invalid calls shall return the explicit state-specific errors rather than causing tool visibility changes. ^goal-gt02
- When the model calls `get_goal`, the system shall render exactly one ordinary tool-result block labeled `get_goal` and shall not additionally emit a goal summary or transient notification. ^goal-gt03
- The system shall describe `get_goal` to the model as `Get the current goal for this thread, including status, automation state, token telemetry, elapsed active time, and optional time limit.` ^goal-gt04
- The system shall present `get_goal` in the system tool catalog with the prompt snippet `Inspect the current goal, status, usage, and automation state.` ^goal-gt05
- The system shall describe `create_goal` to the model as `Create a goal only when explicitly requested by the user or system/developer instructions. Set time_limit_seconds only when the user explicitly requests a time limit; do not invent or extend a time limit yourself.` ^goal-gt06
- The system shall describe `create_goal.objective` to the model as `The objective to pursue across turns. Preserve the user’s full requested outcome, scope, constraints, and completion criteria.` ^goal-gt07
- The system shall describe `create_goal.time_limit_seconds` to the model as `User-requested active-time limit in seconds. Minimum 1. Omit unless the user explicitly requested it.` ^goal-gt08
- The system shall present `create_goal` in the system tool catalog with the prompt snippet `Create an explicitly requested goal for continued work across turns.` ^goal-gt09
- The system shall describe `update_goal` to the model as `Update the existing goal only to mark it complete or genuinely blocked.` ^goal-gt10
- The system shall describe `update_goal.status` to the model as `Terminal status to set. Use complete only when every required outcome is satisfied; use blocked only at a genuine impasse requiring user input or an external-state change.` ^goal-gt11
- The system shall present `update_goal` in the system tool catalog with the prompt snippet `Mark the active goal complete or genuinely blocked.` ^goal-gt12
- When `create_goal` runs while no goal exists, the system shall create an active goal and reset automation to enabled by deleting `taumel.goal_automation`. ^goal-ct01
- If any goal record exists, including a complete goal, then the system shall reject `create_goal`; an agent shall not free its own goal slot by calling `update_goal complete` followed by `create_goal`. ^goal-ct02
- When the model calls `update_goal`, the system shall allow setting only `complete` or `blocked`. ^goal-ut01
- If `update_goal` targets `active`, `paused`, `usage_limited`, `time_limited`, a time limit, or automation state, then the system shall reject it. ^goal-ut02
- When `update_goal` transitions a goal to `complete` or `blocked`, the system shall return the updated structured goal state and allow the current Pi turn to finish normally. ^goal-ut03
- A terminal `update_goal` call shall not generate or inject a separate user-facing outcome summary, terminate the current Pi turn, or request another continuation. ^goal-ut04
- `update_goal` shall permit `complete` or `blocked` only while the existing goal is active; it shall reject attempts to rewrite paused, limited, blocked, or complete state, which the user must explicitly resume first. ^goal-ut05
- A successful `update_goal` shall produce only its ordinary tool-result block; any subsequent assistant prose remains an independent assistant response, and the system shall add no goal summary or transient notification. ^goal-ut06

### Commands

- When the user runs `/goal <objective>` while no goal record exists, the system shall create a goal and parse `--time-limit` with units `s`, `m`, or `h` only. ^goal-cm01
- When the user runs `/goal resume` from `paused`, `blocked`, `usage_limited`, `time_limited`, `complete`, or `active` with interrupted automation, the system shall preserve goal identity, objective, and accumulated telemetry, set the status to `active`, clear interrupted automation, may inject resume content, and honor `--time-limit` and `--no-time-limit`. ^goal-cm02
- If the user resumes from `time_limited` without changing or removing the limit, then the system shall reject the resume. ^goal-cm03
- When the user runs `/goal pause` for an active goal, the system shall set the status to `paused` and delete `taumel.goal_automation`; for an already paused goal it shall leave state unchanged and acknowledge `Goal already paused.`; for a blocked, usage-limited, time-limited, or complete goal it shall reject the transition without erasing the reason continuation stopped. ^goal-cm04
- When the user runs `/goal clear`, the system shall delete `taumel.goal` and `taumel.goal_automation`; when neither exists, the command shall still succeed idempotently with exactly one transient `No goal to clear.` acknowledgement. ^goal-cm05
- When `/goal <objective>` is valid, the system shall create the active goal and then submit the objective as a visible user message that starts the first goal turn. ^goal-cm06
- If `/goal <objective>` has invalid syntax, an invalid time limit, an empty objective, or conflicts with any existing goal record including a complete goal, then the system shall report the command error before creating goal state or submitting any prompt; replacing a goal requires an explicit `/goal clear` first. ^goal-cm07
- If Pi rejects or throws while submitting the initial user message for a newly created goal, then the system shall restore the exact goal and automation state that existed before the command and report the startup failure. ^goal-cm08
- When `/goal <objective>` starts while Pi is busy or user messages are pending, the system shall submit the objective through Pi's normal visible user-message path and preserve Pi's queue order without creating a Taumel-owned goal-start queue or prioritizing the objective. ^goal-cm09
- When the user runs bare `/goal`, the system shall render exactly one non-persistent goal inspection titled `Goal`, shall not emit a transient notification, shall not add a transcript entry, and shall not submit content to the agent. ^goal-cm10
- When the user runs `/goal clear`, the system shall emit exactly one transient goal acknowledgement and shall not create a transcript message or submit content to the agent. ^goal-cm11
- When `/goal <objective>` successfully starts a goal, the system shall not emit a goal summary or transient notification in addition to the visible goal objective submission. ^goal-cm12
- Goal inspection shall render compact as `Goal` followed by status, objective, and active time, and expanded shall show objective, lifecycle status, automation state, tokens used, active time, and the time limit when present; when no goal exists, compact inspection shall render `Goal · none`. ^goal-cm13
- A successful `/goal pause` command shall emit exactly one transient goal acknowledgement and shall not create a transcript message or submit content to the agent. ^goal-cm14
- A successful `/goal resume` shall emit its persisted visible `Goal continuation` entry without an additional transient acknowledgement or goal summary. ^goal-cm15
- If a `/goal` command is invalid, the system shall emit exactly one transient warning and shall not create a transcript entry or submit content to the agent. ^goal-cm16
- When `/goal resume` targets an already active goal with enabled automation, the system shall leave state unchanged, emit exactly one transient `Goal already active.` acknowledgement, and shall not send a continuation. ^goal-cm17
- The slash-command interface shall not provide `complete` or `blocked`; only the agent-facing `update_goal` tool may request those lifecycle transitions, and the user may resume or clear an incorrect model-directed terminal state. ^goal-cm18
- The slash-command grammar shall expose only bare inspection, objective creation, `pause`, `resume`, and `clear`; it shall not provide the aliases `show`, `status`, `start`, `create`, `set`, or `cancel`. ^goal-cm19
- `pause`, `clear`, and valid `resume` forms shall be recognized as subcommands only when the complete input matches their grammar; otherwise their words shall remain part of the objective and shall never be silently discarded as trailing subcommand text. ^goal-cm20
- Objective creation and resume shall reject duplicate `--time-limit` flags and any combination of `--time-limit` with `--no-time-limit`; parsing shall not silently choose the last flag. ^goal-cm21
- Time-limit parsing shall reject values whose unit conversion cannot be represented exactly by the shared integer type and shall never accept wrapped, truncated, or non-finite durations. ^goal-cm22

### Continuation

- The system shall decide continuation through one OCaml predicate reused by the command, event, and resume paths. ^goal-co01
- When the goal is `active`, automation is enabled, the host is idle, no messages are pending, no retry or compaction is in progress, and the latest assistant stop reason is neither `error` nor `aborted`, the system shall send the continuation. ^goal-co02
- The system shall deliver the continuation as a Pi follow-up message rather than a steering message. ^goal-co03
- The system shall express each automated continuation as one model-visible follow-up message and shall not add a second per-turn goal-context injection mechanism. ^goal-co04
- The continuation message shall include the XML-escaped objective marked as untrusted user-provided task data, active status, token telemetry, active time used, and the explicit active-time limit when one exists. ^goal-co05
- The continuation message shall instruct the model to preserve the full objective, make one bounded useful increment when material work remains, verify completion against current authoritative evidence, call `update_goal complete` only when every required outcome is satisfied, and call `update_goal blocked` only at a genuine impasse requiring user input or an external-state change. ^goal-co06
- The continuation message shall not synthesize strategy, redefine success, introduce a budget the user did not request, or treat turn boundaries, difficulty, uncertainty, or incomplete work as completion or blockage. ^goal-co07
- The system shall not require or represent a model-counted consecutive-turn blocker threshold and shall not add cross-turn repetition tracking to decide whether `blocked` is valid. ^goal-co08
- While a goal is `paused`, `blocked`, `usage_limited`, or `time_limited`, the system shall not inject its objective or status into unrelated normal user turns; inactive goal state shall remain available through the footer, `/goal`, and `get_goal` until explicitly resumed or cleared. ^goal-co09
- The system shall show every automated goal continuation to the user as system-authored activity visually distinct from user-authored messages. ^goal-co10
- The compact continuation rendering shall be the single-line label `Goal continuation` followed by the goal objective; the expanded rendering shall show the exact full continuation content sent to the agent. ^goal-co11
- Each delivered goal continuation shall persist as a system-authored transcript entry and shall retain the same compact and expanded rendering after session reload. ^goal-co12
- Each persisted continuation shall carry typed rendering metadata, including objective, lifecycle status, automation state, and telemetry, separately from the exact opaque agent-facing continuation content; renderers shall not recover metadata by parsing the agent-facing text. ^goal-co13

### Interrupt

- When the user interrupts with Escape or Ctrl-C, the system shall account completed progress, keep the status `active`, persist automation as interrupted, and suppress continuation from that event. ^goal-in01
- When a normal model-directed user message arrives, the system shall clear interrupted automation silently without injecting goal text. ^goal-in02
- While automation is interrupted, the system shall preserve it across the pure local commands `/permissions`, `/network`, `/composer`, and `/usage`, and across `/resume`, clearing it only on `/goal resume`, `/goal clear`, or `/goal pause`. ^goal-in03
- When the user interrupts goal automation, the system shall not emit a transient notification; the dedicated goal footer line shall communicate the interrupted automation state. ^goal-in04

### Retry and compaction

- The system shall rely on Pi for retry and shall implement no provider or network retry classifier. ^goal-rc01
- While retrying or compacting, the system shall suppress continuation, and `agent_end.willRetry` or `compaction_end.willRetry` shall keep suppression until retry finishes. ^goal-rc02
- When a final unrecoverable turn error arrives, the system shall set the goal `blocked`; when a usage or quota error arrives, it shall set the goal `usage_limited`. ^goal-rc03
- When only an extension `agent_end` with assistant stop reason `error` or `aborted` is available, the system shall suppress continuation without auto-blocking the goal. ^goal-rc04

### Accounting

- When an assistant turn completes while the goal is `active`, the system shall add that turn's uncached input plus output tokens to `tokensUsed` and its active seconds to `timeUsedSeconds`, exactly once per turn keyed by session, branch length, and usage. ^goal-ac01
- When the goal transitions to `complete` or `blocked` through `update_goal`, the system shall account the in-flight turn while the goal is still `active` before applying the terminal status, so the returned `tokensUsed` and `timeUsedSeconds` include that turn. ^goal-ac02
- The system shall report `tokensUsed` as the sum of every accounted turn's uncached input plus output tokens and `timeUsedSeconds` as the sum of every accounted turn's active seconds. ^goal-ac03

### Time limit

- The system shall enforce active-time limits, counting model generation, tool execution, and in-turn process time, and excluding idle time and bracketed approval waits. ^goal-tl01
- When `timeUsedSeconds` reaches `timeLimitSeconds`, the system shall set the status to `time_limited` after the current turn finishes, without interrupting a turn mid-flight. ^goal-tl02
- The system shall subtract wait time only for waits it brackets exactly (`confirmExecApproval`), using nested pause-depth accounting. ^goal-tl03
- Goal inspection, footer, and continuation rendering shall show actual active time used even when it exceeds the configured time limit and shall not clamp displayed usage to the limit. ^goal-tl04
- In-memory goal state shall make a `time_limited` goal without a configured and reached time limit unrepresentable; persisted state that violates this invariant shall be rejected rather than normalized into a contradictory goal. ^goal-tl05

### Persistence

- The system shall persist `taumel.goal` always and `taumel.goal_automation` only when interrupted, and when automation returns to enabled shall remove the entry or append a `null` tombstone that decodes to enabled. ^goal-ps01
- If a saved goal entry carries legacy fields such as `tokenBudget` or `budget_limited`, then the system shall reject it, surface a non-fatal diagnostic when a UI is available, and decline to migrate. ^goal-ps02
- Persisted goal decoding shall reject negative token telemetry, active time, or timestamps, and shall reject non-positive configured time limits; it shall not silently clamp or repair invalid numeric state. ^goal-ps03
- Persisted goal decoding shall reject a goal whose `updatedAt` precedes its `createdAt`. ^goal-ps04
- When a Pi session is forked, the fork shall receive an independent goal copy with a new owning `sessionId` and `goalId` while preserving objective, lifecycle status, token telemetry, active time, time limit, and timestamps, and shall set automation to interrupted even if the parent had automation enabled; later mutations in either session shall not affect the other, and the fork requires explicit `/goal resume` before automated work continues. ^goal-ps05
- Persisted decoding shall reject unknown lifecycle-status values rather than map them to fallback display text or an approximate state. ^goal-ps06
- When persisted goal state is rejected, the system shall continue with no loaded goal and emit exactly one transient warning when UI is available; it shall not crash, silently repair state, or repeatedly notify. ^goal-ps07

### Footer

- Footer, goal inspection, continuation, and goal-tool presentation shall consume one shared typed goal presentation model; individual surfaces may omit fields but shall not independently reinterpret lifecycle or automation state from strings. ^goal-ft00
- The system shall show goal status in the footer and show interrupted automation separately from status. ^goal-ft01
- While an active goal's automation is interrupted, the footer shall render `Goal active (interrupted)` rather than replacing the lifecycle status with an interrupted status. ^goal-ft02
- The footer shall use the canonical lifecycle labels `Goal active`, `Goal paused`, `Goal blocked`, `Goal usage limited`, `Goal time limited`, and `Goal complete` rather than alternate prose for those statuses. ^goal-ft03
- While a goal exists, the footer shall render a dedicated second line containing its canonical status, objective, automation interruption when present, and active time as elapsed time or elapsed/limit when a limit exists; goal information shall not compete for space on the primary footer line. ^goal-ft04
- When the goal footer line must be shortened, the system shall truncate the objective before omitting lifecycle status, automation interruption, or explicit time-limit usage. ^goal-ft05
- While any goal record exists, including a paused, blocked, limited, or complete goal, the dedicated goal footer line shall remain visible until the user clears the goal. ^goal-ft06
- The footer shall not show goal token telemetry; token telemetry shall remain available through expanded goal inspection, expanded continuation entries, and goal tool results. ^goal-ft07
- Goal presentation shall receive lifecycle status as a closed typed state and derive canonical text and optional reinforcing color through exhaustive typed cases; it shall not encode state into display text and later recover it with string matching, regular expressions, or other parsing. ^goal-ft08
- Goal presentation shall receive automation state as a separate closed type and shall not fold automation interruption into the lifecycle-status type. ^goal-ft09
- Compact goal presentation and the footer shall omit `goalId` and `sessionId`; expanded inspection and tool details may show them for diagnostics. ^goal-ft10
