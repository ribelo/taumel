---
kind: requirement
tags: [tool-gateway, security, authorization]
depends_on: ["[[docs/requirements/capability-profile]]", "[[docs/requirements/sandbox]]"]
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

- The system shall classify every registered tool by one effect kind: `pure`, `execute`, `mutate`, `network`, `spawn_agent`, or `ask_user`. ^gateway-ek01
- The system shall keep a registry mapping each tool name to its effect-kind spec, and shall hold only name and effect kind in OCaml policy metadata. ^gateway-rg01
- The system shall keep Pi-facing tool descriptions and parameter schemas in TypeScript TypeBox contracts. ^gateway-rg02
- When a tool call names a tool absent from the registry, the system shall deny it as an unknown tool. ^gateway-au01
- When the active capability profile disallows the named tool, the system shall deny it as a denied tool. ^gateway-au02
- When an authorized tool's effect kind is `execute`, `mutate`, `network`, or `spawn_agent`, the system shall route the effect through the sandbox and deny the call when the sandbox rejects the effect. ^gateway-au03
- When an authorized tool's effect kind is `pure` or `ask_user`, the system shall skip the sandbox effect check. ^gateway-au04
- The system shall authorize a tool call through the gateway before any tool planner runs. ^gateway-au05
- The system shall expose only the tools the active profile allows, treating exposure as a hint rather than enforcement. ^gateway-ex01
- When a tool is exposed by Pi but disallowed by the profile, the system shall still deny the call at execution time. ^gateway-ex02
- The system shall keep a profile-assigned tool exposed even when the active sandbox policy will deny its effect; the attempted call shall reach gateway authorization and return the sandbox's model-visible denial instead of disappearing from the tool surface. ^gateway-ex03
- The system shall expose an agent's complete assigned tool surface without requiring the model to load, select, or rediscover tool schemas on demand. ^gateway-ex04
- Taumel shall not provide a `select_tools` tool, model-capability negotiation for progressive tool disclosure, or post-compaction restoration of a model-selected tool subset. ^gateway-ex05
- When deriving a child session, the system shall authorize that session's tool calls against the child capability profile. ^gateway-sa01
- When the TypeScript and OCaml tool-name sets drift, the system shall fail fast at startup. ^gateway-dr01

### Tool result delivery

- The system shall rely on Pi's agent-loop lifecycle for terminal tool-result pairing: every Pi-accepted tool call with a usable tool-call id is finalized by Pi as exactly one `toolResult` message with the same tool-call id. ^gateway-rs01
- Taumel-registered tools and hooks shall not bypass Pi's tool lifecycle, manually persist terminal tool-result messages, mutate tool-call ids, or create additional terminal results outside Pi's `execute`/hook return-or-throw path. ^gateway-rs02
- Taumel tool execution shall return one `AgentToolResult` or throw one error for Pi to convert into a terminal tool result. Gateway authorization failures, sandbox denials, approval denials/timeouts, aborts, and internal execution failures inside Taumel shall therefore be represented as a returned error result or thrown error for the originating Pi tool call. ^gateway-rs04
- If Pi surfaces an incoming tool call without a usable tool-call id, Taumel shall treat it as a protocol error outside the normal tool-result invariant and shall not persist it as a normal tool call. ^gateway-rs05
- Schema validation failures before Taumel `execute` runs are Pi-owned. Taumel may improve the registered parameter schemas and compatibility argument preparation, but shall not fork Pi's validation/result-delivery loop inside Taumel. ^gateway-rs07
- Renderer failures occur after tool-result delivery and shall not alter, replace, duplicate, or suppress the model-visible tool result. The UI shall degrade gracefully and report/log the renderer error separately. ^gateway-rs06
- Taumel shall not introduce paths that leave a Pi-accepted tool call without a matching terminal tool result, or that cause multiple terminal tool results for one tool-call id. ^gateway-rs03
- Taumel shall not introduce a generic model-only tool-result note channel or embed harness guidance in `<system>` or `<system-reminder>` blocks solely for a renderer to suppress from the user. ^gateway-rs08
- When a tool uses an explicit model-facing protocol envelope, its load-bearing outcome facts shall remain available to the user through structured details and an explicit renderer; the envelope shall not act as a hidden note side channel. ^gateway-rs09
- A future need for genuinely model-only tool-result metadata requires a public Pi projection API and a separate requirements decision; Taumel shall not emulate that API inside the extension. ^gateway-rs10

### Validation quality

- Taumel shall improve tool validation quality only through its registered TypeBox schemas, tool descriptions, and Pi-supported `prepareArguments` compatibility shims. It shall not fork or replace Pi's generic validation/result-delivery loop. ^gateway-vq01
- Taumel tool schemas shall intentionally reject unknown parameters with `additionalProperties: false`; unknown parameters indicate model/tool-contract drift and shall not be silently ignored. ^gateway-vq02
- Taumel shall not patch or fork Pi's generic validation formatter. Improvements to messages such as "root: must not have additional properties" belong upstream in Pi, not in Taumel. ^gateway-vq03
- Taumel shall avoid `prepareArguments` compatibility shims by default. Shims may be used only for a deliberate same-release API migration, and shall not preserve deprecated or legacy tool shapes. ^gateway-vq04

### Agent-loop ownership

- Taumel shall not track repeated tool calls across an agent turn, inject escalating repetition reminders, suppress an otherwise valid repeated call, or force-stop the turn because calls repeat. ^gateway-lp01
- Taumel tools shall remain safe and return clear current-state results when repeated, including polling tools for which identical calls may be meaningful; generic repetition policy remains Pi host behavior. ^gateway-lp02
