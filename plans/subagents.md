# Sub-Agents

## Decision

Port.

## Classification

Port with redesign.

## Source Of Truth

Use Tau's user-facing sub-agent workflow as the reference, but redesign the
architecture around Taumel's sandbox gateway.

Codex agent execution behavior is also relevant where Tau was trying to match
Codex-style execution controls.

## Why Keep It

Sub-agents are needed as an integrated Taumel mechanism. They must compose with
the sandbox, tool allowlists, approval flow, and orchestration rules. Installing
unrelated third-party sandbox and sub-agent plugins is not enough if spawned
agents can bypass the sandbox.

## Preserve

- `agent` tool concept.
- Spawn, send, wait, close, and list actions where still useful.
- Non-blocking background worker behavior.
- Agent definitions.
- Agent enable/disable controls where needed.
- Tool allowlists.
- Nested agent limits.
- Parent/child ownership rules.
- Worker status reporting.
- Integration with sandbox and approval flow.
- Configuration-aware sandbox inheritance from Tau.
- Tau's child sandbox config rule:
  - child requested preset is clamped to the parent preset;
  - no requested preset inherits the parent preset;
  - bundled/default agents request `workspace-write`, not `full-access`;
  - if the parent is a subagent, the child must be `subagent=true`;
  - if the parent is not a subagent, the child defaults to `subagent=true`
    unless explicitly configured otherwise;
  - child approval timeout may be configured;
  - escalation behavior follows the effective child config and approval broker.

## Redesign

- Route all worker command execution and file mutation through the sandbox
  gateway.
- Make worker sandbox inheritance and privilege clamping explicit and testable.
- Compute the worker's base sandbox preset as the stricter of parent and
  requested config.
- Let child escalation behavior follow the effective worker sandbox config and
  approval broker, rather than a hard-coded global rule.
- Keep agent lifecycle separate from tool rendering.
- Keep agent definition parsing separate from runtime execution.
- Keep approval brokerage separate from worker lifecycle.
- Fold Tau's agents-menu capability into sub-agents and capability profile
  instead of preserving a standalone agents-menu component.
- Avoid coupling sub-agents to Autoresearch.
- Avoid coupling sub-agents to Ralph-loop internals.

## Omit

- Autoresearch-specific worker behavior.
- Backlog worker tools unless backlog is separately brought back into scope.
- Any path where worker sessions get unsandboxed tools by default.
- Any path where worker sessions can enable `--no-sandbox`.
- Plugin-composition assumptions where the parent and child agents use unrelated
  policy systems.
- Tau's standalone agents-menu domain shape.

## Acceptance

- A spawned worker cannot execute shell commands outside the sandbox policy.
- A spawned worker cannot mutate files outside the sandbox policy.
- Worker base sandbox privileges are never broader than the parent.
- Child agent definitions may request stricter policy, but cannot request weaker
  policy than the parent.
- Child escalation behavior is configuration-driven and routed through the
  sandbox approval flow.
- Child sessions cannot enable `--no-sandbox`.
- Agent tool allowlists cannot reintroduce unsandboxed mutation or execution
  paths.
- The core agent lifecycle can be tested without Pi.
