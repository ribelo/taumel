---
kind: requirement
status: draft
tags: [exa, network, tools]
depends_on: ["[[plans/tool-gateway]]", "[[plans/sandbox]]"]
---
# Exa

## Intent

Exa search and agent endpoints are Taumel-owned tools on the TypeBox bridge.
TypeScript owns Pi-facing schemas, descriptions, and prompt snippets; OCaml owns
gateway policy, network authorization, approval planning, HTTP execution through
Eta, and result normalization. Every Exa tool is a `network` effect and is
re-authorized before execution.

## Requirements

- **exa-tl01** (ubiquitous): The system shall provide the core tools `web_search_exa` (`POST /search`), `crawling_exa` (`POST /contents`), and `get_code_context_exa` (`POST /context`).
- **exa-tl02** (ubiquitous): The system shall provide the agent tools `exa_agent_create_run` (`POST /agent/runs`), `exa_agent_get_run` (`GET /agent/runs/{id}`), `exa_agent_list_runs` (`GET /agent/runs`), `exa_agent_cancel_run` (`POST /agent/runs/{id}/cancel`), and `exa_agent_list_events` (`GET /agent/runs/{id}/events`).
- **exa-ar01** (ubiquitous): The system shall keep Pi-facing schemas, descriptions, and prompt snippets in TypeScript and keep gateway policy, network authorization, approval planning, Eta HTTP execution, and result normalization in OCaml.
- **exa-ef01** (ubiquitous): The system shall register every Exa tool as a `network` effect and re-authorize it before execution.
- **exa-ak01** (event-driven): When `EXA_API_KEY` is absent, the system shall return a clear tool result and shall still register the tools.
- **exa-ap01** (event-driven): When the model invokes `exa_agent_create_run`, the system shall require explicit user approval before sending the request, even when network is enabled.
- **exa-ap02** (event-driven): When an Exa approval is denied, times out, is interrupted, or has no UI, the system shall use the sandbox escalation approval-outcome taxonomy.
- **exa-dn01** (event-driven): When the active capability profile disallows an Exa tool, the system shall deny the call.
- **exa-rn01** (ubiquitous): Exa result normalization shall keep model-visible content useful without relying on hidden `details`; data the model needs to continue must be present in the tool result text.
- **exa-rn02** (ubiquitous): When `web_search_exa` receives `summary`, `highlights`, or `text` fields, the model-visible tool result shall include all requested fields without Taumel-side truncation or newline compaction.
- **exa-rn03** (ubiquitous): When `crawling_exa` receives a result `text` field, the model-visible tool result shall preserve that text without Taumel-side truncation or newline compaction; Exa's requested/returned character limit is the only content limit.
- **exa-rn04** (ubiquitous): When `exa_agent_get_run` or `exa_agent_create_run` receives structured `output` without `output.text`, the model-visible tool result shall include the structured output JSON.
- **exa-rn05** (ubiquitous): When `exa_agent_list_runs` or `exa_agent_list_events` returns data, the model-visible tool result shall include the returned payload so run ids, event ids, statuses, cursors, and event data are visible to the model.
- **exa-om01** (ubiquitous): The system shall omit deprecated request fields (`context`, `livecrawl`, `livecrawlTimeout`), the agent delete endpoint, agent streaming, and ad hoc TypeScript HTTP clients.
- **exa-dr01** (event-driven): When the TypeScript and OCaml Exa tool-name sets drift, the system shall fail fast at startup.
