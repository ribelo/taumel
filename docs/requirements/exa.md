---
kind: requirement
tags: [exa, network, tools]
depends_on: ["[[docs/requirements/tool-gateway]]", "[[docs/requirements/sandbox]]"]
---
# Exa

## Intent

Exa search and agent endpoints are Taumel-owned tools on the TypeBox bridge.
TypeScript owns Pi-facing schemas, descriptions, and prompt snippets; OCaml owns
gateway policy, network authorization, approval planning, HTTP execution through
Eta, and result normalization. Every Exa tool is a `network` effect and is
re-authorized before execution.

## Requirements

- The system shall provide the core tools `web_search_exa` (`POST /search`), `crawling_exa` (`POST /contents`), and `get_code_context_exa` (`POST /context`). ^exa-tl01
- The system shall provide the agent tools `exa_agent_create_run` (`POST /agent/runs`), `exa_agent_get_run` (`GET /agent/runs/{id}`), `exa_agent_list_runs` (`GET /agent/runs`), `exa_agent_cancel_run` (`POST /agent/runs/{id}/cancel`), and `exa_agent_list_events` (`GET /agent/runs/{id}/events`). ^exa-tl02
- The system shall retain the model-facing `web_search_exa` description `Search Exa's web index and optionally extract highlights, summaries, or text from the results.`, the catalog snippet `Search Exa's web index for current web, paper, company, people, and news results.`, and the existing guidance to keep result counts small, prefer highlights or summaries before full text, and use `crawling_exa` for known URLs or document IDs. ^exa-tl03
- The system shall describe `web_search_exa.query` as `Search query or question. Be specific about the desired facts, entities, sources, or time range. Maximum 2,000 characters.`, `type` as `Search mode controlling latency and depth. Omit to let Exa choose.`, and `numResults` as `Number of results to return. Defaults to 10; accepts 1–100, with lower limits for some search modes.` ^exa-tl04
- The system shall describe `web_search_exa.includeDomains` as `Domains allowed in results; when set, results come only from these domains.`, `excludeDomains` as `Domains excluded from results.`, `startPublishedDate` as `Return pages published after this ISO 8601 timestamp.`, `endPublishedDate` as `Return pages published before this ISO 8601 timestamp.`, `moderation` as `Whether to filter unsafe content. Defaults to false.`, `category` as `Optional Exa result-category filter.`, `userLocation` as `Two-letter country code for location-aware search.`, and `compliance` as `Compliance mode; currently only hipaa.` ^exa-tl05
- The system shall describe `web_search_exa.contents` as `Content extraction to include with each search result.`, `additionalQueries` as `Additional query variants for deep search. Accepts 1–10.`, and `systemPrompt` as `Additional instructions controlling deep-search behavior.` ^exa-tl06
- The system shall describe the shared Exa content option `text` as `Whether to return page text. Use an options object to limit returned characters.`, `text.maxCharacters` as `Maximum page-text characters to return.`, `highlights` as `Whether to return relevant page excerpts. Use an options object to control excerpt selection.`, `highlights.query` as `Query used to select relevant highlights; defaults to the surrounding search query when available.`, and `highlights.maxCharacters` as `Maximum total highlight characters to return.` ^exa-tl07
- The system shall describe the shared Exa content option `summary` as `Request a generated summary for each result.`, `summary.query` as `Question or focus for the generated summary.`, `maxAgeHours` as `Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching.`, `subpages` as `Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100.`, and `subpageTarget` as `Keyword or keywords used to prioritize which subpages to crawl.` ^exa-tl08
- The system shall retain the existing `crawling_exa` description, catalog snippet, and guidance; describe `ids` as `Exa document IDs to fetch. Accepts 1–100.`, `urls` as `Page URLs to fetch. Accepts 1–100.`, and `compliance` as `Compliance mode; currently only hipaa.`; and reuse the approved shared content-option descriptions for its remaining parameters. ^exa-tl09
- The system shall retain the existing `get_code_context_exa` description and catalog snippet, describe `query` as `Code or API question to research. Include relevant language, framework, library, symbols, and desired examples. Maximum 2,000 characters.`, and describe `tokensNum` as `Approximate output-token budget, or dynamic to let Exa choose. Accepts 50–100,000.` ^exa-tl10
- The system shall retain the existing `exa_agent_create_run` description, catalog snippet, and selective-use guidance; describe `query` as `Research or extraction task for the Exa Agent. State the desired outcome, scope, source expectations, and completion criteria.`, `systemPrompt` as `Optional additional instructions governing the research run.`, `input` as `Optional structured JSON input for the run.`, `outputSchema` as `Optional JSON Schema constraining the run's structured output.`, `effort` as `Research effort tier. Prefer low or medium unless deep research is explicitly needed.`, `previousRunId` as `Optional prior Exa Agent run ID to continue or refine.`, and `metadata` as `Optional JSON metadata to attach to the run.` ^exa-tl11
- The system shall retain the existing descriptions and catalog snippets for `exa_agent_get_run`, `exa_agent_list_runs`, `exa_agent_cancel_run`, and `exa_agent_list_events`; describe the shared get/cancel `id` as `Exa Agent run ID returned by exa_agent_create_run or exa_agent_list_runs.`, list-runs `limit` as `Maximum runs to return. Accepts 1–100.`, list-runs `cursor` as `Opaque cursor returned by a previous run-list response.`, list-events `id` as `Exa Agent run ID whose events to list.`, list-events `limit` as `Maximum events to return. Accepts 1–100.`, list-events `cursor` as `Opaque cursor returned by a previous event-list response.`, and `lastEventId` as `Return events after this event ID for incremental reading.` ^exa-tl12
- The system shall not expose fields marked deprecated by the current Exa API contract; known removals include `web_search_exa.startCrawlDate`, `web_search_exa.endCrawlDate`, `highlights.numSentences`, `highlights.highlightsPerUrl`, and `exa_agent_create_run.budget`, and the highlights options shall expose optional positive-integer `maxCharacters` instead of the two deprecated highlight controls. ^exa-tl13
- The system shall keep Pi-facing schemas, descriptions, and prompt snippets in TypeScript and keep gateway policy, network authorization, approval planning, Eta HTTP execution, and result normalization in OCaml. ^exa-ar01
- The system shall register every Exa tool as a `network` effect and re-authorize it before execution. ^exa-ef01
- When `EXA_API_KEY` is absent, the system shall return a clear tool result and shall still register the tools. ^exa-ak01
- When the model invokes `exa_agent_create_run`, the system shall require explicit user approval before sending the request, even when network is enabled. ^exa-ap01
- When an Exa approval is denied, times out, is interrupted, or has no UI, the system shall use the sandbox escalation approval-outcome taxonomy. ^exa-ap02
- When the active capability profile disallows an Exa tool, the system shall deny the call. ^exa-dn01
- Exa result normalization shall keep model-visible content useful without relying on hidden `details`; data the model needs to continue must be present in the tool result text. ^exa-rn01
- When `web_search_exa` receives `summary`, `highlights`, or `text` fields, the model-visible tool result shall include all requested fields without Taumel-side truncation or newline compaction. ^exa-rn02
- When `crawling_exa` receives a result `text` field, the model-visible tool result shall preserve that text without Taumel-side truncation or newline compaction; Exa's requested/returned character limit is the only content limit. ^exa-rn03
- When `exa_agent_get_run` or `exa_agent_create_run` receives structured `output` without `output.text`, the model-visible tool result shall include the structured output JSON. ^exa-rn04
- When `exa_agent_list_runs` or `exa_agent_list_events` returns data, the model-visible tool result shall include the returned payload so run ids, event ids, statuses, cursors, and event data are visible to the model. ^exa-rn05
- The system shall omit the request fields `context`, `livecrawl`, `livecrawlTimeout`, and `budget`, the agent delete endpoint, agent streaming, and ad hoc TypeScript HTTP clients. ^exa-om01
- When the TypeScript and OCaml Exa tool-name sets drift, the system shall fail fast at startup. ^exa-dr01

## Open questions

None.

## References

- [Exa Public API OpenAPI specification](https://exa.ai/docs/exa-spec.yaml)
- [Exa Context endpoint reference](https://exa.ai/docs/reference/context.md)
