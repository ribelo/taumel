# Ralph Loop

## Decision

Port.

## Classification

Port with redesign.

## Source Of Truth

Use Tau's Ralph behavior as a reference for the user-facing workflow, but do not
port the shared Tau `LoopEngine` as-is.

Tau's loop engine merged Ralph and Autoresearch into one persisted loop model.
Autoresearch is out of scope for Taumel because it is handled by an external
plugin, so the shared loop abstraction should not be preserved.

## Why Keep It

Ralph-loop is in scope as an autonomous iteration workflow: start a task,
dispatch iteration prompts, track iteration state, pause/resume/finish, and
control the child session lifecycle.

## Preserve

- `/ralph`.
- Start/resume/pause/stop/finish/archive/list-style workflow where still useful.
- Child-session protocol tools such as `ralph_continue` and `ralph_finish`.
- Ralph task identity and task file workflow.
- Start, resume, pause, stop/finish, archive/cleanup commands where still useful.
- Iteration count and max iteration controls.
- Reflection checkpoints.
- Controller/child session ownership.
- Capability/tool contract behavior if still needed for safe child sessions.
- Active tools/agents contract during a loop.
- Metrics useful to the user.

## Redesign

- Build a Ralph-specific loop engine instead of a generic Ralph/Autoresearch
  loop engine.
- Keep persisted state Ralph-only.
- Keep prompt construction separate from state transitions.
- Keep child-session dispatch separate from the core loop model.
- Keep controller commands valid only from the controller session.
- Keep child tools valid only from the owned child session.
- Use `CapabilityProfile` for tools, agents, model, thinking, sandbox, and
  permissions.
- Route all execution and mutation through sandbox.
- Do not share a domain engine with goal.
- Share only generic infrastructure with goal: session refs, clocks, JSON
  persistence helpers, prompt/template helpers, Pi adapter helpers, and Eta
  scheduling wrappers.
- If Ralph-loop needs to affect a goal, call the public goal API rather than
  importing goal internals.

## Omit

- Autoresearch loop state, phase snapshots, benchmark metadata, and pending-run
  recovery.
- Generic loop variants that exist only because Tau combined unrelated systems.
- Backward-compatible migration for Tau Autoresearch loop files.
- Shared goal/loop status enums or lifecycle state machines.

## Acceptance

- Ralph-loop can operate without Autoresearch code.
- The core loop model can be tested without Pi.
- Pi integration can be tested through a narrow adapter.
- Goal integration, if any, is explicit and not required for the Ralph core.
