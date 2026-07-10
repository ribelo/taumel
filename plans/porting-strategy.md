# Porting Strategy

## Decision

Do not divide Taumel into independent first, second, or third green slices.

## Strategy

Treat the kept surface area as one epic, implemented sequentially in dependency
order.

This means the planning target is the full kept Taumel architecture. We should
not choose tiny milestone scopes that distort the design, but we should still
establish a concrete task order.

## Kept Scope

- Footer.
- Sandbox.
- Tool gateway.
- Capability profile.
- Sub-agents.
- Goal.
- Ralph-loop.
- Thread tools.
- Usage.
- Shared infrastructure.
- Exa.

## Omitted Scope

Do not create component plans or implementation work for omitted Tau systems.

The omitted systems are intentionally excluded from the rewrite even if Tau code
currently has shared utilities, schemas, services, or UI paths for them.

Provider-request tracing, provider payload reconstruction, retry tracing, and
top-level model tool-schema snapshots are Pi host observability and are not
Taumel features. Taumel diagnostics may describe Taumel-owned decisions and
failures but shall not introduce a parallel provider wire log.

Operating-system notifications, terminal notification transport, and their user
preferences are Pi host or UI-integration behavior, not Taumel features. Taumel
shall emit semantically distinct transcript events for Taumel-owned activity and
shall not send a second external notification through an OS or terminal channel.

Model-driven progressive tool disclosure is omitted. Taumel exposes the complete
tool surface assigned by user visibility and agent-profile policy; it does not
add `select_tools`, model-specific schema-loading capabilities, or a second
model-owned tool-visibility state.

Cross-call repetition detection, escalating model reminders, and force-stopping
an agent turn are Pi agent-loop behavior. Taumel tools remain safe when repeated
but do not implement a partial loop guard covering only Taumel-owned calls.

Compaction-entry presentation is omitted. Taumel may select the model used by
Pi's compaction hooks, but Pi owns compaction summaries, transcript entries,
navigation, expansion state, and shortcuts for viewing them.

## Discipline

- Design the shared contracts up front.
- Keep each component's domain model independent.
- Put tool authorization through the tool gateway.
- Put execution and mutation through sandbox.
- Use capability profiles as authorization data.
- Keep Pi and JavaScript interop at adapter boundaries.
- Keep Eta_jsoo as the OCaml effect/runtime target.
- Specify only features that Taumel owns through Pi's extension boundaries.
- Rely on Pi for host behavior such as the agent loop, provider interaction,
  retry, compaction, user-message queue ordering, session lifecycle, and process
  exit semantics; do not add Taumel compatibility requirements that police or
  duplicate those behaviors.

## Task Order

1. Shared infrastructure contracts.
2. Capability profile.
3. Tool gateway.
4. Sandbox and `/permissions`.
5. Canonical tools: `exec_command`, `write_stdin`, `apply_patch`.
6. Sub-agents.
7. Goal.
8. Ralph-loop.
9. Thread tools.
10. Usage.
11. Footer integration updates.
12. Exa through Eta HTTP in the js_of_ocaml target.

## Acceptance

- The porting plan describes the complete kept Taumel surface and a concrete
  implementation order.
- No implementation dependency on Tau is introduced.
- Omitted Tau systems do not leak back through shared abstractions.
