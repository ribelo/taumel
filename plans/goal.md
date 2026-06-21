# Goal

## Decision

Port.

## Classification

Port with redesign.

## Source Of Truth

Use `/home/ribelo/projects/ribelo/codex/codex-rs/ext/goal` as the behavioral and
architectural source of truth.

Tau's `goal` module was an attempted TypeScript port of that design, but it
coupled goal state with Tau-specific automation, retry behavior, UI rendering,
Autoresearch, and Ralph-loop concerns. Taumel should not copy that coupling.

## Why Keep It

Thread goals are core interaction state: they define the current objective,
expose tool-visible progress, inject steering context, and account token/time
usage across turns.

## Preserve

- `get_goal`, `create_goal`, and `update_goal`.
- Thread-scoped active goal.
- Goal statuses and status transition rules.
- Token budget support.
- Usage/time accounting where Pi exposes enough information.
- Goal steering prompts for continuation, objective updates, and budget limits.
- Explicit tool result payloads suitable for model consumption.

## Redesign

- Model the goal as a pure OCaml state machine.
- Keep tool specs separate from tool execution.
- Keep accounting separate from persistence.
- Keep prompt rendering separate from state transitions.
- Keep Pi event wiring at the edge.
- Avoid dependence on Autoresearch.
- Avoid dependence on Ralph-loop internals.
- Do not share a domain engine with Ralph-loop.
- If Ralph-loop needs to affect a goal, it should call the public goal API.

## Omit

- Tau's Autoresearch coupling.
- Tau's broad service-layer shape.
- Any retry/continuation behavior that exists only to compensate for Tau's
  entanglement.
- Shared goal/loop status enums or lifecycle state machines.

## Acceptance

- Goal behavior matches the Codex design closely enough to use as the reference.
- Tau's `goal` code is not treated as the source of truth.
- The core model can be tested without Pi.
- Pi integration can be tested through a narrow adapter.
