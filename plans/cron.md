---
kind: requirement
status: draft
tags: [cron, scheduling, session, goal]
depends_on: ["[[plans/goal]]"]
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
rather than a subagent (Pi does not surface subagent I/O, persist a subagent
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

- **cron-sc01** (ubiquitous): The system shall run cron entirely within an open Pi session, firing tasks only while that session is running.
- **cron-sc02** (ubiquitous): The system shall scope tasks to the session, persist them in the session entry `taumel.cron`, and reload them on resume.
- **cron-sc03** (ubiquitous): The system shall execute every fire on the main session agent so the work stays visible, interactive, and context-accumulating.

### Schedule

- **cron-sch01** (ubiquitous): The system shall accept a standard 5-field cron expression (minute, hour, day-of-month, month, day-of-week) evaluated in the host local timezone.
- **cron-sch02** (ubiquitous): The system shall support recurring tasks that fire until removed and one-shot tasks that fire once and then delete themselves.
- **cron-sch03** (ubiquitous): The system shall set each task's next due time to the exact next matching instant of its cron expression, applying no jitter.

### Task record

- **cron-rs01** (ubiquitous): The system shall represent each task as a record with `id` (8 lowercase hex), `cron`, `prompt`, `recurring`, `mode`, per-task `enabled`, `createdAt`, `nextDue`, optional `pendingSince`, and a derived `coalesced` count.
- **cron-rs02** (ubiquitous): The system shall hold at most one outstanding fire per task by representing pending state as the single optional `pendingSince` timestamp rather than a list.
- **cron-rs03** (ubiquitous): The system shall regenerate the delivered message from the task's `prompt` at delivery time and store no separate message body.

### Tick engine

- **cron-tk01** (ubiquitous): The system shall drive scheduling with one periodic poll in the TypeScript host, using an `unref`'d interval so the timer never keeps the process alive.
- **cron-tk02** (event-driven): When a poll observes the wall clock at or past an armed task's `nextDue`, the system shall mark the task pending by setting `pendingSince` to that due time and shall leave `nextDue` unchanged until delivery.

### Delivery and gating

- **cron-dl01** (ubiquitous): The system shall keep a pending fire out of Pi's message queue and hold it as task state until it is deliverable, so a pending fire never preempts a goal continuation through `hasPendingMessages`.
- **cron-dl02** (ubiquitous): The system shall decide deliverability with a pure predicate that is true when the task is pending, the host is idle, and no goal-automation loop is driving.
- **cron-dl03** (state-driven): While a goal-automation loop is driving, the system shall hold every pending fire and deliver none, letting the goal continuation proceed until the goal stops driving.
- **cron-dl04** (event-driven): When the predicate holds at an idle poll, the system shall deliver by waking a turn (`triggerTurn`); when it holds at `agent_end` after the goal continuation declines, the system shall deliver by steering.
- **cron-dl05** (ubiquitous): The system shall never drop a pending fire for being busy; a fire that comes due during a turn or goal is delivered once the host next becomes deliverable, however late.

### Coalescing

- **cron-cl01** (event-driven): When a pending task is delivered, the system shall deliver exactly one fire and report `coalesced` as the count of scheduled occurrences between `pendingSince` and the delivery time.
- **cron-cl02** (ubiquitous): The system shall surface `coalesced` to the model on the fire so it can treat a count above one as "only the latest state matters" rather than repeating the work.

### Delivery completion

- **cron-dv01** (event-driven): When a recurring task is delivered, the system shall clear `pendingSince` and set `nextDue` to the next occurrence after the delivery time.
- **cron-dv02** (event-driven): When a one-shot task is delivered, the system shall delete the task.

### Modes

- **cron-md01** (ubiquitous): The system shall give each task a mode that is `message` by default or `goal` when explicitly chosen, mirroring `agent_spawn`'s create-goal flag.
- **cron-md02** (event-driven): When a `message`-mode task is delivered, the system shall inject its prompt as a message into the main session.
- **cron-md03** (event-driven): When a `goal`-mode task is delivered and the main goal slot is free (no goal, or a complete goal), the system shall create the main-session goal from the task prompt and arm automation.
- **cron-md04** (state-driven): While the main goal slot holds a non-complete goal, the system shall keep a `goal`-mode fire pending and create no goal, which also prevents a recurring `goal`-mode task from starting a second goal while its prior goal still runs.

### Master switch and resume

- **cron-ms01** (ubiquitous): The system shall persist a per-session cron master switch in the session state.
- **cron-ms02** (state-driven): While the master switch is disabled, the system shall fire no tasks while keeping tasks stored and the clock advancing, so coalescing reflects the disabled gap when re-enabled.
- **cron-ms03** (event-driven): When a session starts with reason `resume`, `startup`, or `fork` and stored tasks exist, the system shall force the master switch off and notify the user that armed crons exist and `/cron enable` arms them.
- **cron-ms04** (event-driven): When a session starts with reason `reload`, the system shall preserve the persisted master-switch value.
- **cron-ms05** (event-driven): When a session starts with reason `new`, the system shall start with no tasks.

### Model tools

- **cron-tl01** (event-driven): When the model calls `cron_create` with a cron expression, a prompt, optional `recurring` (default true), and optional `goal` mode (default false), the system shall create the task and return its `id`, a human-readable schedule, `recurring`, `mode`, and `nextDue`.
- **cron-tl02** (event-driven): When the model calls `cron_list`, the system shall return the cron master switch state and each task's `id`, schedule, `mode`, per-task enabled flag, recurring flag, raw `nextDue`, and human-readable next-due time, and shall make disabled stored tasks explicit so the model tells the user to run `/cron enable` rather than treating tasks as gone.
- **cron-tl03** (event-driven): When the model calls `cron_delete` with an `id`, the system shall remove that task.
- **cron-tl04** (ubiquitous): The system shall instruct the model, on create, to tell the user the task `id` and that the user manages crons through `/cron`.

### User command

- **cron-cm01** (event-driven): When the user runs `/cron`, the system shall list tasks with their enabled state, schedule, mode, and human-readable next due time.
- **cron-cm02** (event-driven): When the user selects an action in `/cron`, the system shall let the user enable or disable the master switch, enable or disable a specific task, or cancel a specific task through the selection picker.
- **cron-cm03** (event-driven): When the user runs `/cron enable` or `/cron disable`, the system shall set the master switch accordingly; when the user runs `/cron enable ID` or `/cron disable ID`, the system shall set that task's enabled flag accordingly.
- **cron-cm04** (unwanted): If the user attempts to create a task through `/cron`, then the system shall decline, because task authorship belongs to the model.

### Architecture

- **cron-ar01** (ubiquitous): The system shall own cron-expression parsing, next-due computation, the deliverability predicate, coalescing, and task-state transitions in the OCaml core as pure functions.
- **cron-ar02** (ubiquitous): The system shall own the periodic poll, delivery via `pi.sendMessage`, goal creation through the existing goal path, session-entry persistence, and the `/cron` picker in the TypeScript host.
- **cron-ar03** (ubiquitous): The system shall keep cron pending state in its own task records, separate from agent-run and exec-completion records, gated by its own predicate that adds the no-goal-driving clause.
- **cron-ar04** (ubiquitous): The system shall place the cron-expression parser in its own source file so every file stays within the repository's size limit.
