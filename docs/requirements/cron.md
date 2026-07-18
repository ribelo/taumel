---
kind: requirement
tags: [cron, scheduling, session, goal]
depends_on: ["[[docs/requirements/goal]]"]
traces_to: ["kimi-code (packages/agent-core/src/tools/cron + agent/cron/manager.ts)"]
---
# Cron

## Intent

Cron lets the model schedule prompts to run later, on a recurring or one-shot
schedule, within the current Pi session. A fire injects the scheduled prompt
into the main session agent — either as a plain message or as a goal — so the
work is visible, interactive, and accumulates context across fires. The OCaml
core owns the schedule math, the task state machine, coalescing, and the
deliverability predicate as pure functions; TypeScript owns the periodic poll,
delivery via `pi.sendMessage`, goal creation, session-entry persistence, and the
`/cron` picker.

kimi-code is the architectural reference, with three deliberate divergences for
Taumel's single-user, local, Pi-hosted model: cron runs on the **main agent**
session, or let the user talk to one, so interactive and context-accumulating
crons require the main session); jitter is **dropped** (there is no shared fleet
to de-synchronize); and the 7-day stale auto-expiry is **dropped** in favor of a
session-boundary safety gate (resume lands with cron disabled). The session is
the cron's lifetime: closing the window is the off switch.

Pending work follows Taumel's established pattern — durable records carrying
flags, a "pending" predicate that filters them, and a flag flip to mark delivery
— so there is no message queue. A cron fire waits as a single `pendingSince`
field on its task record and is selected for delivery only when its predicate
holds.

## Requirements

### Scope and lifetime

- The system shall run cron entirely within an open Pi session, firing tasks only while that session is running. ^cron-sc01
- The system shall scope tasks to the session, persist them in the session entry `taumel.cron`, and reload them on resume. ^cron-sc02
- When decoding persisted cron state, the system shall accept only schema version `1` and tasks with unique eight-character lowercase hexadecimal ids, valid cron expressions, non-empty prompts, representable non-negative integral creation times, next-due times that are later than creation and match the task's schedule at a minute boundary, and pending timestamps equal to their task's next due time. ^cron-60bw
- The system shall execute every fire on the main session agent so the work stays visible, interactive, and context-accumulating. ^cron-sc03

### Schedule

- The system shall accept a standard 5-field cron expression (minute, hour, day-of-month, month, day-of-week) evaluated in the host local timezone. ^cron-vbgy
- The system shall support recurring tasks that fire until removed and one-shot tasks that fire once and then delete themselves. ^cron-ltoz
- The system shall set each task's next due time to the exact next matching instant of its cron expression, applying no jitter. ^cron-be7y

### Task record

- The system shall represent each task as a record with `id` (8 lowercase hex), `cron`, `prompt`, `recurring`, `mode`, per-task `enabled`, `createdAt`, `nextDue`, optional `pendingSince`, and a derived `coalesced` count. ^cron-rs01
- The system shall hold at most one outstanding fire per task by representing pending state as the single optional `pendingSince` timestamp rather than a list. ^cron-rs02
- The system shall regenerate the delivered message from the task's `prompt` at delivery time and store no separate message body. ^cron-rs03

### Tick engine

- The system shall drive scheduling with one periodic poll in the TypeScript host, using an `unref`'d interval so the timer never keeps the process alive. ^cron-tk01
- When a poll observes the wall clock at or past an armed task's `nextDue`, the system shall mark the task pending by setting `pendingSince` to that due time and shall leave `nextDue` unchanged until delivery. ^cron-tk02

### Delivery and gating

- The system shall keep a pending fire out of Pi's message queue and hold it as task state until it is deliverable, so a pending fire never preempts a goal continuation through `hasPendingMessages`. ^cron-dl01
- The system shall decide deliverability with a pure predicate that is true when the task is pending, the host is idle, and no goal-automation loop is driving. ^cron-dl02
- While a goal-automation loop is driving, the system shall hold every pending fire and deliver none, letting the goal continuation proceed until the goal stops driving. ^cron-dl03
- When the predicate holds at an idle poll, the system shall deliver by waking a turn (`triggerTurn`); when it holds at `agent_end` after the goal continuation declines, the system shall deliver by steering. ^cron-dl04
- The system shall never drop a pending fire for being busy; a fire that comes due during a turn or goal is delivered once the host next becomes deliverable, however late. ^cron-dl05
- The system shall persist and display every delivered cron fire as a distinct system-originated transcript message rather than presenting it as a user-authored message or hiding it from the transcript. ^cron-dl06
- When a live or replayed transcript contains a cron fire, the system shall preserve its cron provenance and render it through the same cron-fire message type. ^cron-dl07
- A delivered cron-fire message shall carry structured task id, raw cron expression, human-readable schedule, coalesced occurrence count, and full scheduled prompt metadata sufficient for rendering and replay. ^cron-dl08
- The model-visible cron-fire content shall include the scheduled prompt and shall state the coalesced occurrence count when it is greater than one; rendering metadata shall not be the model's only source of those facts. ^cron-dl09

### Coalescing

- When a pending task is delivered, the system shall deliver exactly one fire and report `coalesced` as the count of scheduled occurrences between `pendingSince` and the delivery time. ^cron-cl01
- The system shall surface `coalesced` to the model on the fire so it can treat a count above one as "only the latest state matters" rather than repeating the work. ^cron-cl02

### Delivery completion

- When a recurring task is delivered, the system shall clear `pendingSince` and set `nextDue` to the next occurrence after the delivery time. ^cron-dv01
- When a one-shot task is delivered, the system shall delete the task. ^cron-dv02

### Modes

- When a `message`-mode task is delivered, the system shall inject its prompt as a message into the main session. ^cron-md02
- When a `goal`-mode task is delivered and the main goal slot is free (no goal, or a complete goal), the system shall create the main-session goal from the task prompt and arm automation. ^cron-md03
- While the main goal slot holds a non-complete goal, the system shall keep a `goal`-mode fire pending and create no goal, which also prevents a recurring `goal`-mode task from starting a second goal while its prior goal still runs. ^cron-md04

### Master switch and resume

- The system shall persist a per-session cron master switch in the session state. ^cron-ms01
- While the master switch is disabled, the system shall fire no tasks while keeping tasks stored and the clock advancing, so coalescing reflects the disabled gap when re-enabled. ^cron-ms02
- When a session starts with reason `resume`, `startup`, or `fork` and stored tasks exist, the system shall leave the stored task records and per-task enabled flags unchanged, force only the session cron master switch off by default, and notify the user that stored crons exist in the session and `/cron enable` arms them. ^cron-ms03
- When a session starts with reason `reload`, the system shall preserve the persisted master-switch value. ^cron-ms04
- When a session starts with reason `new`, the system shall start with no tasks. ^cron-ms05

### Model tools

- When the model calls `cron_create` with a cron expression, a prompt, optional `recurring` (default true), and optional `goal` mode (default false), the system shall create the task and return its `id`, a human-readable schedule, `recurring`, `mode`, and `nextDue`. ^cron-tl01
- When the model calls `cron_list`, the system shall return the cron master switch state and each task's `id`, schedule, `mode`, per-task enabled flag, recurring flag, raw `nextDue`, and human-readable next-due time, and shall make disabled stored tasks explicit so the model tells the user to run `/cron enable` rather than treating tasks as gone. ^cron-tl02
- When the model calls `cron_delete` with an `id`, the system shall remove that task. ^cron-tl03
- The system shall instruct the model, on create, to tell the user the task `id` and that the user manages crons through `/cron`. ^cron-tl04
- The system shall describe `cron_create` to the model as `Schedule a prompt in this Pi session with a standard 5-field cron expression evaluated in the host’s local timezone. Tasks run only while the session is open.` ^cron-tl05
- The system shall describe `cron_create.cron` to the model as `Standard 5-field cron expression: minute, hour, day of month, month, and day of week. Evaluated in the host’s local timezone.` ^cron-tl06
- The system shall describe `cron_create.prompt` to the model as `Prompt delivered to the main session when the task fires. With goal = true, it becomes the goal objective.` ^cron-tl07
- The system shall describe `cron_create.recurring` to the model as `Whether the task repeats. Defaults to true; false fires once and deletes the task after delivery.` ^cron-tl08
- The system shall describe `cron_create.goal` to the model as `Whether to deliver the prompt as a goal instead of a message. Defaults to false; a goal-mode fire waits while the session’s goal slot is occupied.` ^cron-tl09
- The system shall present `cron_create` in the system tool catalog with the prompt snippet `Create a recurring or one-shot cron task. Tell the user the returned task id and that /cron manages crons.` ^cron-tl10
- The system shall describe `cron_list` to the model as `List this Pi session’s cron tasks and scheduling state.` and present it in the system tool catalog with the prompt snippet `List cron tasks.` ^cron-tl11
- The system shall describe `cron_delete` to the model as `Delete a scheduled cron task by ID.` ^cron-tl12
- The system shall describe `cron_delete.id` to the model as `Eight-character lowercase hexadecimal task ID returned by cron_create or cron_list.` ^cron-tl13
- The system shall present `cron_delete` in the system tool catalog with the prompt snippet `Delete a cron task.` ^cron-tl14

### User command

- When the user runs `/cron`, the system shall list tasks with their enabled state, schedule, mode, and human-readable next due time. ^cron-cm01
- When the user selects an action in `/cron`, the system shall let the user enable or disable the master switch, enable or disable a specific task, or cancel a specific task through the selection picker. ^cron-cm02
- When the user runs `/cron enable` or `/cron disable`, the system shall set the master switch accordingly; when the user runs `/cron enable ID` or `/cron disable ID`, the system shall set that task's enabled flag accordingly. ^cron-cm03
- If the user attempts to create a task through `/cron`, then the system shall decline, because task authorship belongs to the model. ^cron-cm04
- The `/cron` list view shall use Pi's `SelectList` and standard select-list theme for master-row and task navigation, rendering, truncation, scrolling, selection, and list keybindings. ^cron-cm05
- The master-switch item shall identify the master switch and summarize its state. Each task item shall use the task id as its label and summarize its enabled state, schedule, mode, recurrence, and human-readable next due time in its description. ^cron-cm06
- Pressing enter on a task in the list view shall open that task's details. The command workflow shall provide task shortcuts, mutation status, confirmation, prompt and schedule editing, and the details and confirmation views. ^cron-cm07

### Architecture

- The system shall own cron-expression parsing, next-due computation, the deliverability predicate, coalescing, and task-state transitions in the OCaml core as pure functions. ^cron-ar01
- The system shall own the periodic poll, delivery via `pi.sendMessage`, goal creation through the existing goal path, session-entry persistence, and the `/cron` picker in the TypeScript host. ^cron-ar02
- The system shall keep cron pending state in its own task records, separate from agent-run and exec-completion records, gated by its own predicate that adds the no-goal-driving clause. ^cron-ar03
- The system shall place the cron-expression parser in its own source file so every file stays within the repository's size limit. ^cron-ar04
