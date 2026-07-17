---
kind: requirement
---
# Agent presentation

## Intent

Keep routine agent activity legible in Pi's compact timeline while preserving a
human-readable expanded view and a separate model-facing tool contract.

## Requirements

- When `agent_spawn` accepts a new run, the compact agent presentation shall show the tool name, agent handle, selected tier, and agent task description in that order. ^agentui-weo6
- When Finder accepts a new run, the compact agent presentation shall show the agent handle and agent task description. ^agentui-s0qm
- When an agent completion notification is displayed compactly, the agent presentation shall show the agent handle and agent task description. ^agentui-i40y
- When an agent completion notification is displayed compactly, the agent presentation shall omit the agent kind and a readiness label. ^agentui-ald0
- When an agent completion notification is displayed compactly, the agent presentation shall omit the agent run ID. ^agentui-4lce
- When an agent completion notification is expanded, the agent presentation shall show the agent run ID as a labeled field. ^agentui-go7t
- When an agent completion notification is expanded, the agent presentation shall show labeled Agent, Run ID, Description, and Status fields. ^agentui-3txs
- When `agent_send` accepts a message, the compact agent presentation shall show the agent handle and agent task description without a running-status label. ^agentui-u65i
- When an agent completion notification is expanded, the agent presentation shall display human-readable labeled fields rather than its protocol serialization. ^agentui-pz83
- When an agent completion notification is expanded, the agent presentation shall omit the agent response. ^agentui-e5yj
- When `agent_wait` is displayed compactly, the agent presentation shall show the ready-run and pending-run counts. ^agentui-hdst
- When an agent completion notification reports a completed run, the agent presentation shall display a success-colored status dot. ^agentui-f545
- If an agent completion notification reports a failed run, then the agent presentation shall display an error-colored status dot. ^agentui-8elv
- If an agent completion notification reports a lost run, then the agent presentation shall display an error-colored status dot. ^agentui-svxd
- When an agent completion notification reports a cancelled run, the agent presentation shall display a muted status dot. ^agentui-vr2p
- When an agent instruction or response is displayed in an expanded agent presentation, the agent presentation shall wrap the complete text to the available viewport width. ^agentui-kjx2
- The model-facing agent tool contract shall omit resolved model and thinking-level diagnostics. ^agentui-oqzy
