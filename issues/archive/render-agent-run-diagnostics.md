---
kind: issue
status: done
requirements:
  - "[[docs/requirements/subagents#^agent-ui07|agent-ui07]]"
  - "[[docs/requirements/subagents#^agent-rn15|agent-rn15]]"
blocked_by:
  - "[[track-labeled-agent-activity]]"
  - "[[deliver-portable-agent-results]]"
---
# Render agent-run diagnostics

## Scope

Implement the approved compact and expanded rendering for all agent tools and the `/agent-runs` identity rows, run rows, and Inspect view. Show routing only on user-facing surfaces, expose private session paths only in Inspect, and keep compact output bounded.

## Verification

- Renderer tests cover pending, successful, failed, timed-out, and multi-result slots for all seven agent tools in compact and expanded modes.
- Manager tests cover running activity phases, terminal and suspended rows, elapsed-age fallback, exact Inspect fields, and narrow layouts.
- Boundary tests prove model-facing output and ordinary rendering omit routing and private mapping data while Inspect shows the child-session path.
