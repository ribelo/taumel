# Exa

## Decision

Port later, not in the first implementation slice.

## Classification

Port with redesign, blocked on Eta HTTP support for js_of_ocaml.

## Source Of Truth

Use Tau's Exa tools as the user-facing reference for tool names and behavior.
Do not copy the implementation shape directly.

## Current Blocker

Eta currently has `eta-http` for native OCaml, but not for js_of_ocaml. Exa
should wait until Eta HTTP works in the JavaScript target.

## Why Keep It

Exa is useful as a high-quality search/crawl/code-context provider. It can be a
valuable Taumel network tool once the HTTP layer and capability model are ready.

## Preserve

- `web_search_exa`.
- `crawling_exa`.
- `get_code_context_exa`.
- API-key based configuration.
- Search/crawl/code-context behavior from Tau where still useful.
- Compact rendering of results.

## Redesign

- Implement through Eta HTTP once available for js_of_ocaml.
- Gate availability through `CapabilityProfile`.
- Respect sandbox/network policy.
- Keep provider HTTP client separate from tool schemas.
- Keep rendering separate from execution.
- Keep API-key lookup explicit and testable.

## Omit

- First implementation slice.
- Direct Node/fetch ad hoc implementation unless Eta HTTP is unavailable and a
  deliberate adapter fallback is approved.
- Any path that bypasses capability profile or sandbox network policy.

## Acceptance

- Eta HTTP supports js_of_ocaml or an approved temporary adapter exists.
- Exa tools are denied when the active capability profile does not allow them.
- Exa network calls respect Taumel's network policy.
- Missing API key produces a clear tool result.
