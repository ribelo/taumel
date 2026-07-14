---
kind: issue
status: done
requirements:
  - "[[plans/subagents#^agent-tc17|agent-tc17]]"
  - "[[plans/subagents#^agent-rs17|agent-rs17]]"
  - "[[plans/subagents#^agent-nt04|agent-nt04]]"
blocked_by:
  - "[[track-labeled-agent-activity]]"
---
# Deliver portable agent results

## Scope

Implement JSON-only model-facing results for every agent tool, the stable failed-call envelope and code mapping, exact status-specific `agent_wait` results and timeout race behavior, child-output recovery and defensive truncation, and attributed JSON completion notifications without automatic answer injection.

## Verification

- Every agent-tool success and failure fixture parses as JSON and matches its exact allowed fields and stable error code.
- Wait tests cover completed, suspended, failed, cancelled, lost, timed-out, empty, unavailable, repeated, pending-race, and truncated outputs with local offset timestamps.
- Notification tests prove exact JSON content, deduplication, wait observation, and absence of output, status, routing, or false user/assistant attribution.
