# Tool Gateway

## Decision

Port/rebuild as a core Taumel module.

## Classification

New architecture replacing scattered Tau tool registration and authorization.

## Source Of Truth

Use Tau as the cautionary reference: tool registration, active-tool mutation,
profile resolution, sandbox routing, and per-feature validation were spread
across many modules. Taumel should centralize the enforcement boundary.

## Why Keep It

Adding sandboxed tools is not enough if other tools can bypass policy. Taumel
needs one place where tool registration and tool execution authorization pass
through `CapabilityProfile` and sandbox policy.

## Responsibilities

- Provide policy-owned tool names/effects to the TypeScript registration layer.
- Enforce `CapabilityProfile` before execution.
- Route execution and mutation tools through sandbox.
- Normalize tool errors and results.
- Keep Pi active tools as exposure hints only.
- Provide a single audit point for whether a tool can run.
- Support sub-agent child profiles.

## Redesign

- Pi-facing tool descriptions and parameter schemas live in TypeScript TypeBox
  contracts.
- OCaml keeps only policy metadata: tool name and effect kind.
- The gateway checks authorization before any tool planner runs.
- The gateway can expose/hide tool names in Pi, but exposure is not enforcement.
- Feature modules provide policy registrations; they do not directly become the
  only security boundary.
- The sandbox owns process/filesystem policy, but the gateway owns tool-call
  authorization.

## Omit

- Per-feature ad hoc authorization checks as the only enforcement layer.
- Treating `pi.setActiveTools` as security.
- Direct registration of execution/mutation tools that bypass the gateway.

## Acceptance

- A disallowed tool call is denied even if Pi exposes that tool.
- Sub-agent tool calls are authorized against the child capability profile.
- Execution/mutation tools cannot run without sandbox routing.
- All kept tools have an obvious gateway registration path.
- TypeScript and OCaml tool catalogs fail fast if their tool-name sets drift.
