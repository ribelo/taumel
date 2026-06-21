# Capability Profile

## Decision

Port the idea, but replace Tau's `ExecutionProfile` shape.

## Classification

Port with redesign.

## Source Of Truth

Use Tau as the cautionary reference: the profile idea was useful, but complexity
exploded because capability policy leaked into live Pi tool activation and tool
registration details.

## Why Keep It

Taumel needs a coherent way to describe what a session or sub-agent is allowed
to do. Model selection alone is not enough. The same resolved policy should
cover model, thinking level, sandbox ceiling, approval behavior, allowed tools,
and allowed sub-agents.

## Preserve

- Model id.
- Thinking level.
- Execution/tool policy idea.
- Agent definition inheritance.
- `inherit` semantics for model/thinking where useful.
- Tool allowlists.
- Spawn/sub-agent allowlists.
- Agent enable/disable controls where useful.

## Redesign

- Rename the concept to `CapabilityProfile`.
- Treat the profile as authorization data, not Pi registration state.
- Make the central Taumel tool gateway enforce the active capability profile.
- Treat Pi active tools/register/unregister as exposure hints only.
- Deny disallowed tool calls at execution time even if Pi exposes the tool.
- Derive child profiles from parent profile plus agent definition plus sandbox
  clamp.
- Treat UI controls for active tools/agents as profile edits or profile
  overrides, not as separate authority.
- Keep profile resolution pure and testable.
- Keep Pi model/thinking application at the adapter edge.

## Omit

- Tau's `ExecutionProfile` service shape.
- Any design where Pi active-tool mutation is the security boundary.
- Generic live register/unregister churn as normal profile operation.
- Tau's standalone agents-menu state model.
- Autoresearch-specific execution profile behavior.

## Acceptance

- A profile can be resolved without Pi.
- A tool call can be authorized or denied from profile data alone.
- A child agent cannot gain capabilities outside the resolved child profile.
- The tool gateway is the enforcement point for profile-based tool access.
- Pi active-tool state can be wrong without violating Taumel's authorization
  model.
