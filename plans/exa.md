# Exa

## Decision

Port Exa as Taumel-owned OCaml tools on the TypeBox bridge.

## Classification

Kept network tools with OCaml policy and Eta HTTP execution.

## Source Of Truth

Use Tau as the user-facing reference for the legacy tool names:

- `web_search_exa`.
- `crawling_exa`.
- `get_code_context_exa`.

Use current Exa docs for request fields and endpoints. Do not preserve
deprecated Exa fields or Tau's implementation shape.

## Responsibilities

- TypeScript owns Pi-facing TypeBox schemas, descriptions, and prompt snippets.
- OCaml owns gateway policy, sandbox/network authorization, approval planning,
  HTTP request execution through Eta, and result normalization.
- `EXA_API_KEY` is read by the OCaml bridge. Missing key returns a clear tool
  result; tools still register when the key is absent.
- Every Exa tool is registered as a `Network` effect and is re-authorized before
  execution.

## Core Tools

- `web_search_exa` -> `POST /search`.
- `crawling_exa` -> `POST /contents`.
- `get_code_context_exa` -> `POST /context`.

The exposed parameter surface intentionally omits deprecated fields such as
`context`, `livecrawl`, and `livecrawlTimeout`.

## Agent Tools

- `exa_agent_create_run` -> `POST /agent/runs`.
- `exa_agent_get_run` -> `GET /agent/runs/{id}`.
- `exa_agent_list_runs` -> `GET /agent/runs`.
- `exa_agent_cancel_run` -> `POST /agent/runs/{id}/cancel`.
- `exa_agent_list_events` -> `GET /agent/runs/{id}/events`.

`exa_agent_create_run` always requires explicit user approval before the HTTP
request is sent because Agent runs can be long-running and billable. Denial,
timeout, interruption, and unavailable UI use the same approval outcome taxonomy
as sandbox escalation.

## Omit

- Agent delete endpoint.
- Agent streaming/SSE from model tools.
- Deprecated Exa request fields.
- TS `fetch` or ad hoc provider clients.
- Any path that bypasses capability profile or sandbox network policy.

## Acceptance

- Exa tools are denied when the active capability profile does not allow them.
- Exa network calls respect Taumel's network policy.
- Missing API key produces a clear tool result.
- TypeScript and OCaml tool catalogs fail fast if Exa names drift.
- `exa_agent_create_run` prompts before sending a request even when network is
  enabled.
