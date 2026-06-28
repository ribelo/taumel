---
kind: requirement
status: draft
tags: [tool-gateway, security, authorization]
depends_on: ["[[plans/capability-profile]]", "[[plans/sandbox]]"]
---
# Tool gateway

## Intent

The tool gateway is the single authorization point for every tool call. It holds
policy metadata (tool name and effect kind) in OCaml while Pi-facing
descriptions and parameter schemas stay in TypeScript contracts. The gateway
authorizes a call against the capability profile and routes sandbox-bearing
effects through the sandbox before any tool planner runs. Pi active-tool
exposure is a hint, never the enforcement boundary.

## Requirements

- **gateway-ek01** (ubiquitous): The system shall classify every registered tool by one effect kind: `pure`, `execute`, `mutate`, `network`, `spawn_agent`, or `ask_user`.
- **gateway-rg01** (ubiquitous): The system shall keep a registry mapping each tool name to its effect-kind spec, and shall hold only name and effect kind in OCaml policy metadata.
- **gateway-rg02** (ubiquitous): The system shall keep Pi-facing tool descriptions and parameter schemas in TypeScript TypeBox contracts.
- **gateway-au01** (event-driven): When a tool call names a tool absent from the registry, the system shall deny it as an unknown tool.
- **gateway-au02** (event-driven): When the active capability profile disallows the named tool, the system shall deny it as a denied tool.
- **gateway-au03** (event-driven): When an authorized tool's effect kind is `execute`, `mutate`, `network`, or `spawn_agent`, the system shall route the effect through the sandbox and deny the call when the sandbox rejects the effect.
- **gateway-au04** (event-driven): When an authorized tool's effect kind is `pure` or `ask_user`, the system shall skip the sandbox effect check.
- **gateway-au05** (ubiquitous): The system shall authorize a tool call through the gateway before any tool planner runs.
- **gateway-ex01** (ubiquitous): The system shall expose only the tools the active profile allows, treating exposure as a hint rather than enforcement.
- **gateway-ex02** (event-driven): When a tool is exposed by Pi but disallowed by the profile, the system shall still deny the call at execution time.
- **gateway-sa01** (event-driven): When deriving a child session, the system shall authorize that session's tool calls against the child capability profile.
- **gateway-dr01** (event-driven): When the TypeScript and OCaml tool-name sets drift, the system shall fail fast at startup.
