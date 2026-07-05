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

### Tool result delivery

- **gateway-rs01** (ubiquitous): The system shall rely on Pi's agent-loop lifecycle for terminal tool-result pairing: every Pi-accepted tool call with a usable tool-call id is finalized by Pi as exactly one `toolResult` message with the same tool-call id.
- **gateway-rs02** (event-driven): Taumel-registered tools and hooks shall not bypass Pi's tool lifecycle, manually persist terminal tool-result messages, mutate tool-call ids, or create additional terminal results outside Pi's `execute`/hook return-or-throw path.
- **gateway-rs04** (ubiquitous): Taumel tool execution shall return one `AgentToolResult` or throw one error for Pi to convert into a terminal tool result. Gateway authorization failures, sandbox denials, approval denials/timeouts, aborts, and internal execution failures inside Taumel shall therefore be represented as a returned error result or thrown error for the originating Pi tool call.
- **gateway-rs05** (unwanted): If Pi surfaces an incoming tool call without a usable tool-call id, Taumel shall treat it as a protocol error outside the normal tool-result invariant and shall not persist it as a normal tool call.
- **gateway-rs07** (ubiquitous): Schema validation failures before Taumel `execute` runs are Pi-owned. Taumel may improve the registered parameter schemas and compatibility argument preparation, but shall not fork Pi's validation/result-delivery loop inside Taumel.
- **gateway-rs06** (event-driven): Renderer failures occur after tool-result delivery and shall not alter, replace, duplicate, or suppress the model-visible tool result. The UI shall degrade gracefully and report/log the renderer error separately.
- **gateway-rs03** (unwanted): Taumel shall not introduce paths that leave a Pi-accepted tool call without a matching terminal tool result, or that cause multiple terminal tool results for one tool-call id.

### Validation quality

- **gateway-vq01** (ubiquitous): Taumel shall improve tool validation quality only through its registered TypeBox schemas, tool descriptions, and Pi-supported `prepareArguments` compatibility shims. It shall not fork or replace Pi's generic validation/result-delivery loop.
- **gateway-vq02** (ubiquitous): Taumel tool schemas shall intentionally reject unknown parameters with `additionalProperties: false`; unknown parameters indicate model/tool-contract drift and shall not be silently ignored.
- **gateway-vq03** (out-of-scope): Taumel shall not patch or fork Pi's generic validation formatter. Improvements to messages such as "root: must not have additional properties" belong upstream in Pi, not in Taumel.
- **gateway-vq04** (ubiquitous): Taumel shall avoid `prepareArguments` compatibility shims by default. Shims may be used only for a deliberate same-release API migration, and shall not preserve deprecated or legacy tool shapes.
