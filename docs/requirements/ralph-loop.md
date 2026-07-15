---
kind: requirement
tags: [ralph-loop, automation]
depends_on: ["[[docs/requirements/capability-profile]]", "[[docs/requirements/sandbox]]", "[[docs/requirements/goal]]"]
---
# Ralph loop

## Intent

The Ralph loop is an autonomous iteration workflow: start a task, dispatch
iteration prompts, track iteration state, pause/resume/finish, and control the
child session lifecycle. It uses a Ralph-specific loop engine with Ralph-only
persisted state. Autoresearch stays out of scope. Ralph shares only generic
infrastructure with goal and reaches goal only through goal's public API.

## Requirements

- When the user runs `/ralph`, the system shall provide a start, resume, pause, stop/finish, archive/cleanup, and list workflow. ^ralph-wf01
- When a child session runs `ralph_continue` or `ralph_finish`, the system shall accept it only from the owned child session. ^ralph-ct01
- The system shall describe `ralph_continue` to the model as `Advance Ralph session by one iteration.` and present it in the system tool catalog with the prompt snippet `Advance Ralph session to the next iteration.` ^ralph-tl01
- The system shall describe `ralph_finish` to the model as `Finish Ralph session.` and present it in the system tool catalog with the prompt snippet `Finish Ralph session.` ^ralph-tl02
- The system shall describe the shared `ralph_continue.task_id` and `ralph_finish.task_id` parameter to the model as `Ralph task ID from the Ralph session prompt.` ^ralph-tl03
- When a controller command runs, the system shall accept it only from the controller session. ^ralph-cm01
- The system shall keep persisted state Ralph-only and keep prompt construction, state transitions, and child-session dispatch as separate concerns. ^ralph-st01
- The system shall track iteration count, max-iteration controls, reflection checkpoints, and user-facing metrics. ^ralph-it01
- The system shall resolve tools, agents, model, thinking, and sandbox through the capability profile and route all execution and mutation through the sandbox. ^ralph-cp01
- The system shall share no domain engine with goal, share only generic infrastructure, and affect a goal only through goal's public API. ^ralph-gl01
- The system shall omit Autoresearch loop state, phase snapshots, benchmark metadata, pending-run recovery, and Tau loop-file migration. ^ralph-om01
- The system shall make the core loop model testable without Pi and keep Pi integration behind a narrow adapter. ^ralph-ts01
