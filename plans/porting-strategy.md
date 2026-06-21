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
- Request user input.
- Thread tools.
- Usage.
- Shared infrastructure.
- Exa later, after Eta HTTP supports js_of_ocaml.

## Omitted Scope

Do not create component plans or implementation work for omitted Tau systems.

The omitted systems are intentionally excluded from the rewrite even if Tau code
currently has shared utilities, schemas, services, or UI paths for them.

## Discipline

- Design the shared contracts up front.
- Keep each component's domain model independent.
- Put tool authorization through the tool gateway.
- Put execution and mutation through sandbox.
- Use capability profiles as authorization data.
- Keep Pi and JavaScript interop at adapter boundaries.
- Keep Eta_jsoo as the OCaml effect/runtime target.

## Task Order

1. Shared infrastructure contracts.
2. Capability profile.
3. Tool gateway.
4. Sandbox and `/permissions`.
5. Canonical tools: `exec_command`, `write_stdin`, `apply_patch`.
6. Sub-agents.
7. Goal.
8. Ralph-loop.
9. Request user input.
10. Thread tools.
11. Usage.
12. Footer integration updates.
13. Exa after Eta HTTP supports js_of_ocaml.

## Acceptance

- The porting plan describes the complete kept Taumel surface and a concrete
  implementation order.
- No implementation dependency on Tau is introduced.
- Omitted Tau systems do not leak back through shared abstractions.
