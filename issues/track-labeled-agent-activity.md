---
kind: issue
status: ready-for-agent
requirements:
  - "[[plans/subagents#^agent-tc01|agent-tc01]]"
  - "[[plans/subagents#^agent-id20|agent-id20]]"
  - "[[plans/subagents#^agent-ps18|agent-ps18]]"
  - "[[plans/subagents#^agent-ls02|agent-ls02]]"
blocked_by: []
---
# Track labeled agent activity

## Scope

Implement the approved description-bearing start and send contracts, specialist inputs and instructions, persisted task labels, per-run turn and activity metadata, Pi-event phase transitions, settled-session reconciliation, and exact `agent_list` projection. Keep descriptions out of child instructions and model/thinking out of model-facing list data.

## Verification

- Contract tests require valid descriptions and reject invalid field combinations for generic, Finder, Oracle, and send calls.
- Lifecycle and persistence tests cover task labels, per-run turn resets, activity transitions, stale-dispatch isolation, and settled child-session reconciliation.
- `agent_list` tests assert its exact bare-array JSON shape, timestamp format, activity recommendations, and routing-data exclusions.
