# Thread Tools

## Decision

Port.

## Classification

Port with redesign.

## Source Of Truth

Use Tau's `find_thread` and `read_thread` behavior as the user-facing reference.
The internal structure should be redesigned.

## Why Keep It

Thread search and reading help agents recover prior context, inspect earlier
sessions, and continue work across interruptions without relying on memory.

## Preserve

- `find_thread`.
- `read_thread`.
- Search current workspace before global sessions.
- Search by id, title, and content.
- Read by exact id or unique prefix.
- Optional goal-focused transcript extraction.
- Branch summaries and compaction summaries where available.
- Compact rendering of search/read results.

## Redesign

- Separate session catalog/search from transcript reading.
- Keep relevance scoring pure and testable.
- Keep Pi/SessionManager access at the adapter edge.
- Gate availability through `CapabilityProfile`.
- Keep renderer separate from execution.
- Avoid coupling to goal internals despite the `goal` parameter.

## Omit

- Generic Tau service-layer shape.
- Renderer-heavy module structure.
- Any dependency on memory.
- Any dependency on goal state.

## Acceptance

- Search can be tested with an in-memory catalog.
- Transcript extraction can be tested without Pi.
- Ambiguous thread ids produce a clear result.
- Capability profile can allow or deny both tools.
