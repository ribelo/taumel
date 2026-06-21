# Shared Infrastructure

## Decision

Port/rebuild shared primitives, not Tau's shared state architecture.

## Classification

Port with redesign.

## Source Of Truth

Use Tau's shared utilities as references for useful primitives, but not as an
architecture to copy.

## Why Keep It

Several kept components need the same low-level capabilities: atomic writes,
file locking, JSON helpers, settings discovery, model id parsing, formatting,
and small Pi adapter helpers.

## Preserve

- Atomic file writes.
- File locks where needed.
- JSON decode/encode helpers.
- Settings discovery.
- Model id parsing.
- Small formatters.
- Decoded-tool helper concept.
- Message injection helper where still needed.
- Session references and session-state helpers where Ralph-loop and thread tools
  need them.

## Redesign

- No monolithic `TauPersistedState`.
- Each component owns its own typed persisted state.
- Shared persistence is only infrastructure: read/write/lock/discovery.
- Pi active-tool helpers are exposure hints, not authorization.
- Keep shared modules small and boring.
- Prefer explicit component dependencies over a global service graph.

## Omit

- Tau compatibility migrations.
- Giant shared state object for unrelated features.
- Tool activation as an authorization boundary.
- Broad Tau service-layer wiring.

## Acceptance

- A component can persist state without importing unrelated component types.
- Shared helpers have no knowledge of goal, Ralph, sandbox, memory, or backlog.
- Authorization is enforced by capability profile/tool gateway, not by active
  tool mutation.
