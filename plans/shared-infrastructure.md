---
kind: requirement
status: draft
tags: [shared-infrastructure, persistence]
depends_on: ["[[plans/capability-profile]]", "[[plans/tool-gateway]]"]
---
# Shared infrastructure

## Intent

Shared infrastructure provides the low-level primitives several components need:
atomic writes, file locking, JSON helpers, settings discovery, model id parsing,
formatters, and small Pi adapter helpers. Each component owns its own typed
persisted state; shared persistence stays infrastructure only. Authorization
lives in the capability profile and tool gateway, never in active-tool mutation.

## Requirements

- **shared-pr01** (ubiquitous): The system shall provide atomic file writes, file locks, JSON encode/decode helpers, settings discovery, model id parsing, formatters, decoded-tool helpers, a message-injection helper, and session-reference helpers.
- **shared-st01** (ubiquitous): The system shall let each component own its typed persisted state and shall keep shared persistence limited to read, write, lock, and discovery, with no monolithic shared state object.
- **shared-au01** (ubiquitous): The system shall treat Pi active-tool helpers as exposure hints and enforce authorization through the capability profile and tool gateway.
- **shared-dp01** (ubiquitous): The system shall keep shared helpers free of knowledge of goal, Ralph, sandbox, memory, and backlog, and shall prefer explicit component dependencies over a global service graph.
- **shared-ts01** (ubiquitous): The system shall let a component persist state without importing unrelated component types.
