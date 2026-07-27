---
kind: requirement
tags: [plan, tasks, continuation, session]
depends_on: []
---
# Plan

## Intent

A plan is a per-session, ordered task list with a lifecycle that lets the agent
continue useful work across turns. A plan is defined by its tasks: what is to
be done, in what order, with optional further specification per task. What the
former goal model called an objective-only goal is now simply a plan with a
single task; a task's text is that task's objective. Plan state and the
continuation predicate live in the OCaml core; TypeScript is the smallest
possible Pi bridge. Pi owns retry and compaction. Interrupt does not pause the
plan lifecycle.

Rationale: every surveyed harness ships task tools disconnected from its
continuation machinery — cosmetic checklists nothing enforces. Coupling the
task list to the continuation loop is what makes tasks real: the loop pursues
unfinished tasks, and completion is gated on them. The earlier objective-centric
goal was unified into the plan because the two concepts overlapped — an
objective-only goal is a plan with one task — and the unification dissolved a
class of special cases (objective immutability, late-fill, birth-with-tasks).
Because the agent edits the very list the loop pursues, editability is a pure
mapping of lifecycle status: editable in draft, frozen elsewhere, and only the
user returns a running plan to draft. User-authored task text and cancellation
are reserved to the user in every status, so the contract the agent is policed
against cannot be renegotiated by the agent.

## Requirements

### Plan state

- The system shall store the plan in the session entry `taumel.plan` with `planId`, `sessionId`, `status`, `tasks`, `tokensUsed`, `timeUsedSeconds`, optional `timeLimitSeconds`, `createdAt`, and `updatedAt`. ^plan-st01
- The system shall provide the lifecycle statuses `draft`, `active`, `paused`, `blocked`, `time_limited`, and `complete`. ^plan-st02
- The system shall treat `tokensUsed` as telemetry that never controls lifecycle state. ^plan-st03
- The system shall set `timeLimitSeconds` only when the user explicitly requests a time limit. ^plan-st04
- Every newly created plan shall receive an identity unique within its owning session; timestamp resolution shall not permit identity reuse after clearing and recreating a plan. ^plan-st05
- Plan ownership shall use the exact owning Pi session identity and shall not substitute the working-directory or workspace path as identity. ^plan-st06

### Lifecycle transitions

- When the agent creates a task while no plan record exists, the system shall create the plan in the `draft` status. ^plan-lc01
- When the user submits plan text while no plan record exists, the system shall create the plan in the `active` status with that text as a user-authored task. ^plan-lc02
- The agent shall move a plan to `active` only from `draft`, via `update_plan`; activation commits the current task list and starts continuation. ^plan-lc03
- Only the user shall move a plan to `draft`, from any lifecycle status; the agent shall never transition a plan to `draft`. ^plan-lc04
- The agent shall move a plan to `blocked` or `complete` only from `active`, via `update_plan`. ^plan-lc05
- The system shall move a plan to `time_limited` only as specified under time-limit rules; neither the agent nor a command shall set that status directly. ^plan-lc06
- Only the user shall resume a plan from `paused`, `blocked`, `time_limited`, or `complete` to `active`, or move any plan to `draft`. ^plan-lc07
- Only the user shall clear a plan, and clearing shall be available from every lifecycle status. ^plan-lc08
- Only the user shall move a plan to `paused`, and only from `active`; pausing shall suspend continuation without making the plan editable, and the agent shall never transition a plan to `paused`. ^plan-lc09

### Editability mapping

- Editability shall be a pure derived mapping of lifecycle status, not stored state: the plan is editable while `draft` and frozen in every other status. ^plan-fz01
- While the plan is `active` or `draft`, the agent may change task statuses; while the plan is `draft`, the agent may additionally create tasks and edit task content and dependencies of agent-authored tasks. ^plan-fz02
- While the plan is frozen, the agent shall not create tasks, edit task content or dependencies, or change task statuses. ^plan-fz03
- The agent shall never edit the title or description of, or cancel, a user-authored task, in any lifecycle status; the agent may change a user-authored task's status only while the plan is `active`. ^plan-fz04
- The user may add tasks to the plan in any lifecycle status, and user-initiated task edits shall not be restricted by the editability mapping. ^plan-fz05
- Neither pausing nor automation interruption shall make the plan editable; editability shall derive from lifecycle status alone. ^plan-fz06

### Automation gate

- The system shall default continuation to enabled by the absence of `taumel.plan_automation` and persist that entry only when continuation is interrupted (`continuation = interrupted`, `requiresUserInput = true`). ^plan-au01
- While the plan status is `active` and automation continuation is enabled, the system shall treat continuation as effective. ^plan-au02
- The model shall not suspend plan continuation by ending a turn, declining to poll, starting or leaving a live exec session, or reporting progress in text; only the user-controlled interruption and lifecycle paths specified here may interrupt automation, and only `complete` or `blocked` may be model-directed terminal transitions. ^plan-au03

### Permission boundary

- While a plan is active, every model and tool turn shall use the session's independently current permission envelope, including explicit user changes made after the plan started. ^plan-pm02

### Tasks

- The system shall store plan tasks as an ordered list within the plan record; each task shall carry `taskId`, `title`, optional `description`, `status`, `depends_on`, and `origin`, and list order shall be preserved through persistence. ^plan-tk01
- The system shall provide the task statuses `pending`, `in_progress`, `completed`, and `cancelled`. ^plan-tk02
- Every task shall receive a `taskId` unique within the owning plan's lifetime that is never reused while that plan exists, including after cancellation; the model may supply an explicit `taskId` at creation, and the system shall generate one shaped `task-<nano-id>`, where nano-id is exactly four characters from `abcdefghjkmnpqrstuvwxyz23456789`, retrying collisions and failing creation clearly on namespace exhaustion rather than lengthening the identity, when none is supplied. ^plan-tk03
- A plan shall contain at least one task; every constructor shall reject, and persisted decoding shall reject, a plan with no tasks. ^plan-tk04
- Tasks shall belong to the owning session only; the system shall not expose a session's tasks to spawned child sessions, and a forked session shall receive its own independent copy of the task list under the fork's plan identity. ^plan-tk05
- Task creation and editing shall be model-autonomous within the editability mapping and shall not require an explicit user request. ^plan-tk06
- A task title shall be trimmed and shall reject a title that becomes empty; a task description shall be optional longer specification of the step. ^plan-tk07
- A task's `depends_on` shall reference only existing `taskId`s in the owning plan, and the system shall reject a write that would make a task reachable from itself through `depends_on` edges. ^plan-tk08
- The system shall reject setting a task to `in_progress` while any task it depends on is neither `completed` nor `cancelled`; the rejection shall name the blocking tasks with their `taskId`, `title`, and `status`, and shall suggest completing or cancelling them first. ^plan-tk09
- The system shall not limit the number of `in_progress` tasks; any count of tasks whose dependencies are satisfied may be in progress concurrently. ^plan-tk10
- The system shall accept task creation for one or many tasks in a single call and shall apply the call atomically; a `depends_on` entry within the call may reference any existing `taskId` or an explicit `taskId` supplied earlier in the same call. ^plan-tk11
- An explicitly supplied `taskId` shall be trimmed, non-empty, and unique within the owning plan; the system shall reject the entire creation call when any supplied identity is empty or duplicates an existing or same-call identity. ^plan-tk12
- A task's `origin` shall be `user` for tasks created through the `/plan` command or the user interface and `agent` for tasks created through the task tools. ^plan-tk13

### Tools

- When the model calls `get_plan`, the system shall return `plan`, `status`, `tokensUsed`, `timeUsedSeconds`, `timeLimitSeconds`, `tasks`, and `automation`. ^plan-gt01
- While the main agent's assigned tool surface includes the plan capability, `get_plan`, `create_task`, `update_task`, and `update_plan` shall remain exposed across every plan lifecycle state; invalid calls shall return the explicit state-specific errors rather than causing tool visibility changes. ^plan-gt02
- When the model calls `get_plan`, the system shall render exactly one ordinary tool-result block labeled `get_plan` and shall not additionally emit a plan summary or transient notification. ^plan-gt03
- The system shall describe `get_plan` to the model as `Get the current plan for this thread, including status, automation state, tasks, token telemetry, elapsed active time, and optional time limit.` ^plan-gt04
- The system shall present `get_plan` in the system tool catalog with the prompt snippet `Inspect the current plan, tasks, status, usage, and automation state.` ^plan-gt05
- The system shall describe `create_task` to the model as `Create one or more tasks for the current plan. Tasks are the living breakdown of the work: order, dependencies, and completion state drive continuation and gate plan completion. Creating a task while no plan exists creates a draft plan; activate it with update_plan to start continuation. Tasks may be created only while the plan is in draft.` ^plan-gt06
- The system shall describe `create_task.tasks[].id` to the model as `Optional explicit task identity, unique within this plan. Omit to auto-generate a task- identity.` ^plan-gt07
- The system shall describe `create_task.tasks[].title` to the model as `Short statement of the work. Trimmed; must not be empty.` ^plan-gt08
- The system shall describe `create_task.tasks[].description` to the model as `Optional longer specification of this step.` ^plan-gt09
- The system shall describe `create_task.tasks[].depends_on` to the model as `Task identities that must reach completed or cancelled before this task may enter in_progress. May reference identities supplied earlier in this call.` ^plan-gt10
- The system shall present `create_task` in the system tool catalog with the prompt snippet `Create one or more plan tasks while the plan is in draft.` ^plan-gt11
- The system shall describe `update_task` to the model as `Update one task's status, title, description, or dependencies. Content edits require a draft plan; status changes require an active or draft plan. Setting in_progress requires every depended task to be completed or cancelled. Mark a task completed only when its work is verifiably done; cancel tasks that are no longer needed. User-authored task text and cancellation are reserved to the user.` ^plan-gt12
- The system shall present `update_task` in the system tool catalog with the prompt snippet `Update one plan task's status or content within editability rules.` ^plan-gt13
- The system shall describe `update_plan` to the model as `Update the plan lifecycle: activate a draft plan to commit its task list and start continuation, or mark an active plan complete or genuinely blocked. Completion requires every task to be completed or cancelled first.` ^plan-gt14
- The system shall describe `update_plan.status` to the model as `Lifecycle status to set: active commits the task list and starts continuation; complete declares every required outcome satisfied; blocked marks a genuine impasse requiring user input or an external-state change.` ^plan-gt15
- The system shall present `update_plan` in the system tool catalog with the prompt snippet `Activate the plan, or mark it complete or genuinely blocked.` ^plan-gt16
- When the model calls `update_plan` with a status other than `active`, `complete`, or `blocked`, or targeting a time limit or automation state, the system shall reject it. ^plan-ut01
- When `update_plan` requests `active` from a status other than `draft`, or `complete` or `blocked` from a status other than `active`, the system shall reject it. ^plan-ut02
- If any task has status `pending` or `in_progress`, the system shall reject `update_plan` with status `complete` and return the unfinished tasks with their `taskId`, `title`, and `status`; tasks with status `cancelled` shall not block completion, and the gate shall not apply to `update_plan` with status `blocked`. ^plan-ut03
- When `update_plan` transitions a plan to `complete` or `blocked`, the system shall return the updated structured plan state and allow the current Pi turn to finish normally. ^plan-ut04
- A terminal `update_plan` call shall not generate or inject a separate user-facing outcome summary, terminate the current Pi turn, or request another continuation. ^plan-ut05
- A successful `update_plan` or task-tool call shall produce only its ordinary tool-result block; any subsequent assistant prose remains an independent assistant response, and the system shall add no plan summary or transient notification. ^plan-ut06
- Task tool calls that violate the editability mapping, task-origin rules, dependency rules, or identity rules shall be rejected with the explicit rule-specific error and shall leave plan state unchanged. ^plan-ut07

### Commands

- When the user runs `/plan <text>` while no plan record exists, the system shall create an active plan with the text as a user-authored task and then submit the text as a visible user message that starts the first plan turn. ^plan-cm01
- When the user runs `/plan <text>` while a plan record exists, the system shall append the text as a user-authored task in any lifecycle status and submit the text as a visible user message. ^plan-cm02
- When the user runs `/plan pause` for an active plan, the system shall set the status to `paused` and delete `taumel.plan_automation`; for an already paused plan it shall leave state unchanged and acknowledge `Plan already paused.`; for a draft, blocked, time-limited, or complete plan it shall reject the transition without erasing the reason continuation stopped and shall report that `/plan draft` enables editing. ^plan-cm03
- When the user runs `/plan resume` from `draft`, `paused`, `blocked`, `time_limited`, or `complete`, the system shall preserve plan identity, tasks, and accumulated telemetry, set the status to `active`, clear interrupted automation, may inject resume content, and honor `--time-limit` and `--no-time-limit`; for an already active plan with enabled automation it shall leave state unchanged, emit exactly one transient `Plan already active.` acknowledgement, and shall not send a continuation. ^plan-cm04
- If the user resumes from `time_limited` without changing or removing the limit, then the system shall reject the resume. ^plan-cm05
- When the user runs `/plan clear`, the system shall delete `taumel.plan` and `taumel.plan_automation`; when neither exists, the command shall still succeed idempotently with exactly one transient `No plan to clear.` acknowledgement. ^plan-cm06
- If `/plan <text>` has invalid syntax or an invalid time limit, the system shall report the command error before creating plan state or submitting any prompt. ^plan-cm07
- If Pi rejects or throws while submitting the initial user message for a newly created plan, then the system shall restore the exact plan and automation state that existed before the command and report the startup failure. ^plan-cm08
- When `/plan <text>` starts while Pi is busy or user messages are pending, the system shall submit the text through Pi's normal visible user-message path and preserve Pi's queue order without creating a Taumel-owned plan-start queue or prioritizing the text. ^plan-cm09
- When the user runs bare `/plan`, the system shall render exactly one non-persistent plan inspection titled `Plan`, shall not emit a transient notification, shall not add a transcript entry, and shall not submit content to the agent; the expanded inspection shall list the plan's tasks with status and origin. ^plan-cm10
- If a `/plan` command is invalid, the system shall emit exactly one transient warning and shall not create a transcript entry or submit content to the agent. ^plan-cm11
- When `/plan resume` is valid, the system shall emit its persisted visible `plan.continue` entry without an additional transient acknowledgement or plan summary. ^plan-cm12
- The slash-command interface shall not provide `complete` or `blocked`; only the agent-facing `update_plan` tool may request those lifecycle transitions, and the user may resume or clear an incorrect model-directed terminal state. ^plan-cm13
- The slash-command grammar shall expose only bare inspection, task-text submission, `pause`, `resume`, `draft`, and `clear`; it shall not provide the aliases `show`, `status`, `start`, `create`, `set`, or `cancel`. ^plan-cm14
- `pause`, `clear`, and valid `resume` forms shall be recognized as subcommands only when the complete input matches their grammar; otherwise their words shall remain part of the submitted task text and shall never be silently discarded as trailing subcommand text. ^plan-cm15
- Task-text submission and resume shall reject duplicate `--time-limit` flags and any combination of `--time-limit` with `--no-time-limit`; parsing shall not silently choose the last flag. ^plan-cm16
- When `/plan <text>` targets an existing plan, `--time-limit` shall replace the plan's time limit and `--no-time-limit` shall remove it; when `/plan <text>` creates a plan, `--time-limit` shall set the initial limit and `--no-time-limit` shall be rejected as redundant. While the plan is `time_limited`, task-text limit removal shall be rejected with guidance to use `/plan resume --no-time-limit`, so that a `time_limited` plan never loses its reached configured limit. ^plan-cm20
- Time-limit parsing shall reject values whose unit conversion cannot be represented exactly by the shared integer type and shall never accept wrapped, truncated, or non-finite durations. ^plan-cm17
- Time-limit parsing shall accept units `s`, `m`, or `h` only. ^plan-cm18
- When the user runs `/plan draft`, the system shall move the plan to `draft` from any lifecycle status, enabling agent and user editing of the task list; for an already draft plan it shall leave state unchanged and acknowledge `Plan already in draft.` ^plan-cm19

### Task manager modal

- When the user runs `/tasks`, the system shall open exactly one task-manager modal; the command shall not emit a transient notification, shall not add a transcript entry, and shall not submit content to the agent. ^plan-md01
- The modal shall list every task in plan order with its title, status, origin, and `depends_on` references. ^plan-md02
- The user shall be able to add a task with a required title and optional description, edit any task's title and description, advance a task's status, cancel a task, and delete a task from the list. ^plan-md03
- The modal shall require confirmation for cancelling or deleting a task and shall apply non-destructive actions immediately. ^plan-md04
- The modal shall display but shall not edit `depends_on` references. ^plan-md05
- Modal mutations shall apply through the same core task operations and validation as tool calls; user-initiated edits shall not be restricted by the editability mapping, and tasks created through the modal shall carry `origin` `user`. ^plan-md06
- The modal shall consume the shared typed plan presentation model. ^plan-md07
- The modal shall let the user move a selection cursor over the task list with the arrow keys and shall act on the selected task with single keys: `a` add, `e` edit, `s` advance status, `x` cancel, and `d` delete, closing on Esc or `q`; the modal shall display the available keys in a footer. ^plan-vn86
- The modal's advance action shall move a task forward through `pending`, `in_progress`, and `completed` only, and shall not offer status changes for `completed` or `cancelled` tasks. ^plan-yzfw
- The modal shall collect task titles and descriptions through Pi text-input prompts and shall reopen with refreshed plan state after each prompt flow. ^plan-kz4n
- When the user runs `/tasks` while no plan exists, the modal shall present an empty state inviting the user to add the first task, and adding that task shall create a draft plan containing it. ^plan-t0cc
- If a core operation rejects a modal mutation, then the modal shall surface the rejection reason and remain open. ^plan-fent

### Continuation

- The system shall decide continuation through one OCaml predicate reused by the command, event, and resume paths. ^plan-co01
- When the plan is `active`, automation is enabled, the host is idle, no messages are pending, no retry or compaction is in progress, and the latest assistant stop reason is neither `error` nor `aborted`, the system shall send the continuation. ^plan-co02
- The system shall deliver the continuation as a Pi follow-up message rather than a steering message. ^plan-co03
- The system shall express each automated continuation as one model-visible follow-up message and shall not add a second per-turn plan-context injection mechanism. ^plan-co04
- The continuation message shall include active status, token telemetry, active time used, and the explicit active-time limit when one exists. ^plan-co05
- The continuation message shall instruct the model to preserve the full plan, make one bounded useful increment when material work remains, verify completion against current authoritative evidence, call `update_plan complete` only when every required outcome is satisfied, and call `update_plan blocked` only at a genuine impasse requiring user input or an external-state change. ^plan-co06
- The continuation message shall not synthesize strategy, redefine success, introduce a budget the user did not request, or treat turn boundaries, difficulty, uncertainty, or incomplete work as completion or blockage. ^plan-co07
- The system shall not require or represent a model-counted consecutive-turn blocker threshold and shall not add cross-turn repetition tracking to decide whether `blocked` is valid. ^plan-co08
- While a plan is not `active`, the system shall not inject its tasks or status into unrelated normal user turns; draft plan state shall remain available through the footer, `/plan`, and `get_plan` until explicitly resumed or cleared. ^plan-co09
- The system shall show every automated plan continuation to the user as system-authored activity visually distinct from user-authored messages. ^plan-co10
- The compact continuation rendering shall be the single-line header `plan.continue` followed by a plan progress summary; the expanded rendering shall show the exact full continuation content sent to the agent. ^plan-co11
- Each delivered plan continuation shall persist as a system-authored transcript entry and shall retain the same compact and expanded rendering after session reload. ^plan-co12
- Each persisted continuation shall carry typed rendering metadata, including lifecycle status, automation state, tasks, and telemetry, separately from the exact opaque agent-facing continuation content; renderers shall not recover metadata by parsing the agent-facing text. ^plan-co13
- The continuation message shall include an untrusted JSON payload listing every task with status `pending` or `in_progress` together with its `taskId`, `title`, `status`, `depends_on`, and `origin`, marking each listed task as runnable or waiting-on-dependency, delimited so that the payload cannot be mistaken for system instructions. ^plan-co14
- When the user expands a plan continuation message, the system shall precede the exact agent-facing content with labeled fields for lifecycle status, task progress, automation state, and active time, followed by the plan's unfinished tasks rendered with the shared plan task-row grammar from typed rendering metadata, and shall delimit the exact agent-facing content visibly as the content sent to the agent. ^plan-afra
- The plan continuation header dot shall be green when the plan is complete, red when the plan is blocked, and yellow for every other lifecycle status. ^plan-6qss

### Interrupt

- When the user interrupts with Escape or Ctrl-C, the system shall account completed progress, keep the status `active`, persist automation as interrupted, and suppress continuation from that event. ^plan-in01
- When a normal model-directed user message arrives, the system shall clear interrupted automation silently without injecting plan text. ^plan-in02
- While automation is interrupted, the system shall preserve it across the pure local commands `/permissions`, `/network`, `/composer`, and `/usage`, and across `/resume`, clearing it only on `/plan resume`, `/plan clear`, or `/plan pause`. ^plan-in03
- When the user interrupts plan automation, the system shall not emit a transient notification; the dedicated plan footer line shall communicate the interrupted automation state. ^plan-in04

### Retry and compaction

- The system shall rely on Pi for retry and shall implement no provider or network retry classifier. ^plan-rc01
- While retrying or compacting, the system shall suppress continuation, and `agent_end.willRetry` or `compaction_end.willRetry` shall keep suppression until retry finishes. ^plan-rc02
- When a final unrecoverable turn error arrives, the system shall set the plan `blocked`. ^plan-rc03
- When only an extension `agent_end` with assistant stop reason `error` or `aborted` is available, the system shall suppress continuation without auto-blocking the plan. ^plan-rc04

### Accounting

- When an assistant turn completes while the plan is `active`, the system shall add that turn's uncached input plus output tokens to `tokensUsed` and its active seconds to `timeUsedSeconds`, exactly once per turn keyed by session, branch length, and usage. ^plan-ac01
- When the plan transitions to `complete` or `blocked` through `update_plan`, the system shall account the in-flight turn while the plan is still `active` before applying the terminal status, so the returned `tokensUsed` and `timeUsedSeconds` include that turn. ^plan-ac02
- The system shall report `tokensUsed` as the sum of every accounted turn's uncached input plus output tokens and `timeUsedSeconds` as the sum of every accounted turn's active seconds. ^plan-ac03

### Time limit

- The system shall enforce active-time limits, counting model generation, tool execution, and in-turn process time, and excluding idle time and bracketed approval waits. ^plan-tl01
- When `timeUsedSeconds` reaches `timeLimitSeconds`, the system shall set the status to `time_limited` after the current turn finishes, without interrupting a turn mid-flight. ^plan-tl02
- The system shall subtract wait time only for waits it brackets exactly (`confirmExecApproval`), using nested pause-depth accounting. ^plan-tl03
- Plan inspection, footer, and continuation rendering shall show actual active time used even when it exceeds the configured time limit and shall not clamp displayed usage to the limit. ^plan-tl04
- In-memory plan state shall make a `time_limited` plan without a configured and reached time limit unrepresentable; persisted state that violates this invariant shall be rejected rather than normalized into a contradictory plan. ^plan-tl05
- The system shall not provide token-count or cost budgets or limits; active time shall be the only plan budget. ^plan-tl06

### Persistence

- The system shall persist `taumel.plan` always and `taumel.plan_automation` only when interrupted, and when automation returns to enabled shall remove the entry or append a `null` tombstone that decodes to enabled. ^plan-ps01
- The system shall not read, migrate, or emit diagnostics for legacy `taumel.goal` and `taumel.goal_automation` session entries; a saved `taumel.plan` entry carrying legacy fields such as `tokenBudget` or `budget_limited` shall be rejected per plan-ps07. ^plan-ps02
- Persisted plan decoding shall reject negative token telemetry, active time, or timestamps, and shall reject non-positive configured time limits; it shall not silently clamp or repair invalid numeric state. ^plan-ps03
- Persisted plan decoding shall reject a plan whose `updatedAt` precedes its `createdAt`. ^plan-ps04
- When a Pi session is forked, the fork shall receive an independent plan copy with a new owning `sessionId` and `planId` while preserving tasks, lifecycle status, token telemetry, active time, time limit, and timestamps, and shall set automation to interrupted even if the parent had automation enabled; later mutations in either session shall not affect the other, and the fork requires explicit `/plan resume` before automated work continues. ^plan-ps05
- Persisted decoding shall reject unknown lifecycle-status or task-status values rather than map them to fallback display text or an approximate state. ^plan-ps06
- When persisted plan state is rejected, the system shall continue with no loaded plan and emit exactly one transient warning when UI is available; it shall not crash, silently repair state, or repeatedly notify. ^plan-ps07
- Persisted decoding shall reject tasks with duplicate identities, unknown `depends_on` references, dependency cycles, or a task list that is empty. ^plan-ps08

### Footer

- Footer, plan inspection, continuation, and plan-tool presentation shall consume one shared typed plan presentation model; individual surfaces may omit fields but shall not independently reinterpret lifecycle or automation state from strings. ^plan-ft00
- The system shall show plan status in the footer and show interrupted automation separately from status. ^plan-ft01
- While an active plan's automation is interrupted, the footer shall render `Plan active (interrupted)` rather than replacing the lifecycle status with an interrupted status. ^plan-ft02
- The footer shall use the canonical lifecycle labels `Plan active`, `Plan draft`, `Plan paused`, `Plan blocked`, `Plan time limited`, and `Plan complete` rather than alternate prose for those statuses. ^plan-ft03
- While a plan exists, the footer shall render a dedicated second line containing its canonical status, task progress as completed-or-cancelled over total tasks, automation interruption when present, and active time as elapsed time or elapsed/limit when a limit exists; plan information shall not compete for space on the primary footer line. ^plan-ft04
- While any plan record exists, including a draft, paused, blocked, limited, or complete plan, the dedicated plan footer line shall remain visible until the user clears the plan. ^plan-ft05
- The footer shall not show plan token telemetry; token telemetry shall remain available through expanded plan inspection, expanded continuation entries, and plan tool results. ^plan-ft06
- Plan presentation shall receive lifecycle status as a closed typed state and derive canonical text and optional reinforcing color through exhaustive typed cases; it shall not encode state into display text and later recover it with string matching, regular expressions, or other parsing. ^plan-ft07
- Plan presentation shall receive automation state as a separate closed type and shall not fold automation interruption into the lifecycle-status type. ^plan-ft08
- Compact plan presentation and the footer shall omit `planId` and `sessionId`; expanded inspection and tool details may show them for diagnostics. ^plan-ft09
