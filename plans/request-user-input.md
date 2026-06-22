# Request User Input

## Decision

Port.

## Classification

Port with redesign.

## Source Of Truth

Use Codex `request_user_input` behavior as the reference. Tau's implementation
is useful as a Pi integration reference, but should not dictate the internal
module shape.

## Why Keep It

`request_user_input` is a coordination primitive. It gives agents a structured
way to ask the user for decisions, tradeoffs, and missing information without
turning every clarification into unstructured chat.

## Preserve

- Structured multiple-choice questions.
- Short headers.
- Stable question ids.
- Recommended option convention.
- Optional free-form/other answer.
- Cancellation.
- Optional auto-resolution timeout where useful.
- Render/history of the completed exchange.

## Redesign

- Keep the Pi-facing parameter schema in the TypeScript TypeBox contract.
- Keep domain validation pure in OCaml.
- Keep Pi UI interaction at the adapter edge.
- Control availability through `CapabilityProfile`.
- Keep renderer separate from tool execution.
- Avoid coupling to goal, Ralph-loop, sub-agents, or Autoresearch.

## Omit

- Tau-specific renderer sprawl.
- Any special-case dependency on goal/Ralph internals.
- Autoresearch-specific usage.

## Acceptance

- The tool can validate questions without Pi.
- A Pi adapter can present questions and return structured answers.
- Capability profile can allow or deny the tool.
- A cancelled request produces a clear cancelled result.
