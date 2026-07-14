---
kind: requirement
status: draft
tags: [thread-tools, search, tools]
depends_on: ["[[plans/capability-profile]]", "[[plans/tool-gateway]]"]
---
# Thread tools

## Intent

`query_threads` and `read_thread` help agents recover prior context across
sessions. Session search stays separate from transcript reading, relevance
scoring stays pure and testable, and Pi `SessionManager` access stays at the
adapter edge. The capability profile gates both tools, and neither depends on
goal internals or memory. Raw `rg` over session files is not the recovery
interface for prior context; Taumel provides structured session search so large
JSONL event lines, hidden fields, and embedded tool output cannot make search
unusable.

## Requirements

### Tool and domain

- **threads-tl01** (ubiquitous): The system shall provide exactly the thread tools `query_threads` and `read_thread`, with no deprecated aliases or legacy thread-search tool names.
- **threads-tl03** (unwanted): The system shall not provide compatibility shims for removed or legacy thread parameters. `read_thread` shall accept `threadID`, not `thread_id` or `id`, and shall not accept the removed `goal` parameter.
- **threads-tl04** (ubiquitous): The system shall describe `query_threads` to the model as `Search persisted Pi conversations by thread ID, title, visible messages, summaries, tool calls, tool results, and notifications. Use it to find relevant context from earlier threads before reading a specific thread with read_thread.`
- **threads-tl05** (ubiquitous): The system shall describe `query_threads.query` to the model as `Text to find in persisted conversations. Matching is case-insensitive substring search, not regex or a query language. Maximum 500 characters.`
- **threads-tl06** (ubiquitous): The system shall describe `query_threads.limit` to the model as `Maximum number of threads to return. Defaults to 10; accepts 1–50.`
- **threads-tl07** (ubiquitous): The system shall describe `query_threads.scope` to the model as `Where to search. current_workspace searches threads associated with your current workspace and is the default; all searches all persisted threads.`
- **threads-tl08** (ubiquitous): The system shall describe `query_threads.includeTools` to the model as `Whether to search tool calls, tool results, and notifications. Defaults to true.`
- **threads-tl09** (ubiquitous): The system shall present `query_threads` in the system tool catalog with the prompt snippet `Search persisted Pi conversations for relevant prior context.`
- **threads-tl10** (ubiquitous): The system shall describe `read_thread` to the model as `Read a persisted Pi conversation by exact thread ID, unique ID prefix, or a locator returned by query_threads. Use overview for orientation, window for context around a hit, or full for paginated transcript recovery.`
- **threads-tl11** (ubiquitous): The system shall describe `read_thread.threadID` to the model as `Exact thread ID or unique ID prefix. Required unless locator supplies the thread ID.`
- **threads-tl12** (ubiquitous): The system shall describe `read_thread.locator` to the model as `Exact hit locator returned by query_threads. Use with mode = window to read context around that hit.`
- **threads-tl13** (ubiquitous): The system shall describe `read_thread.locator.threadID` to the model as `Thread ID carried by the locator.`
- **threads-tl14** (ubiquitous): The system shall describe `read_thread.locator.sourcePath` to the model as `Persisted source path carried by the locator for exact source recovery. Copy it unchanged.`
- **threads-tl15** (ubiquitous): The system shall describe `read_thread.locator.entryID` to the model as `Persisted entry ID identifying the matched event.`
- **threads-tl16** (ubiquitous): The system shall describe `read_thread.locator.line` to the model as `Persisted JSONL line number used as a fallback locator for the matched event.`
- **threads-tl17** (ubiquitous): The system shall describe `read_thread.entryID` to the model as `Entry ID to target when using mode = window without a locator.`
- **threads-tl18** (ubiquitous): The system shall describe `read_thread.line` to the model as `Persisted JSONL line number to target when using mode = window without a locator.`
- **threads-tl19** (ubiquitous): The system shall describe `read_thread.mode` to the model as `What to read: overview returns bounded metadata, summaries, and recent entries and is the default; window returns context around a locator, entry ID, or line; full returns a paginated visible transcript.`
- **threads-tl20** (ubiquitous): The system shall describe `read_thread.around` to the model as `Number of visible entries to include before and after a window target. Defaults to 3; accepts 0–10.`
- **threads-tl21** (ubiquitous): The system shall describe `read_thread.cursor` to the model as `Opaque cursor returned by a previous full response. Use only with mode = full; omit it for the first page.`
- **threads-tl22** (ubiquitous): The system shall present `read_thread` in the system tool catalog with the prompt snippet `Read context from a specific persisted Pi conversation.`
- **threads-dm01** (ubiquitous): The system shall use `thread` as the user- and model-facing domain word for recovered conversation context; Pi sessions, session files, JSONL lines, and filesystem paths are storage/adapter details exposed only as recovery metadata when useful.
- **threads-dm02** (event-driven): When deriving `threadID` for a persisted Pi JSONL session, the system shall use the session record `id` when present and shall fall back to the filename stem only when no usable session id exists.
- **threads-dm03** (unwanted): If multiple discovered sources resolve to the same `threadID`, the system shall deduplicate exact duplicate source paths seen through overlapping roots. Distinct-source `threadID` collisions are invalid store state and shall be reported as bounded diagnostics rather than modeled as a normal workflow.

### Query

- **threads-se01** (event-driven): When the model runs `query_threads`, the system shall search the current workspace before global sessions, matching by id, title, and content.
- **threads-se02** (event-driven): When discovering persisted session sources, the system shall include Pi JSONL session files as first-class sources, parse them line-by-line as events, and keep legacy single-document JSON parsing only as a compatibility path.
- **threads-se18** (event-driven): When a persisted source is unreadable or invalid, `query_threads` and `read_thread` shall continue over remaining sources and include bounded diagnostics in structured details instead of silently skipping or failing the whole query.
- **threads-se19** (unwanted): `query_threads` shall not search, score, or rank diagnostic text from unreadable or invalid sources as conversation content.
- **threads-se03** (ubiquitous): The system shall search structured, visible fields rather than raw file lines: session id/path/title/workspace, branch and compaction summaries, visible user and assistant messages, tool call names/arguments, bounded tool result text, and Taumel notification text.
- **threads-se04** (unwanted): The system shall not search, score, match, or return persisted agent execution-snapshot system prompts, hidden reasoning payloads, encrypted reasoning content, raw full JSON event lines, or unbounded embedded tool-output blobs as search snippets, even if such fields contain the only occurrence of the query.
- **threads-se05** (ubiquitous): The `query_threads` result shall include bounded match-level snippets with enough recovery metadata to read the source later: thread id, title, workspace when known, source path when persisted, entry id or line number, timestamp when known, role/kind/tool name when known, and a line/byte-bounded snippet with an explicit omission marker when clipped.
- **threads-se23** (ubiquitous): Each `query_threads` hit snippet shall be capped at 5 complete lines or 1KB, whichever is hit first, with an explicit omission marker when clipped.
- **threads-se06** (ubiquitous): The `query_threads` result shall be grouped by ranked thread, but hits shall be the primary payload: each returned thread shall include its top bounded hits/snippets so the model can see why it matched and can call `read_thread` with an exact locator.
- **threads-se07** (ubiquitous): The `query_threads` input shall be limited to `query`, optional `limit`, optional `scope`, and optional `includeTools`. `scope` shall be `current_workspace` or `all`, defaulting to `current_workspace`; `includeTools` shall default to `true`.
- **threads-se21** (ubiquitous): `includeTools = false` shall suppress only tool calls, tool results, and Taumel notifications. It shall not suppress visible user/assistant messages or branch, compaction, and goal summaries.
- **threads-se08** (ubiquitous): The `query_threads` `limit` shall default to 10 and cap at 50. Each returned thread shall include at most 3 top hits by default.
- **threads-se24** (unwanted): The v1 thread tools shall not expose configurable snippet or transcript byte/line budgets. The only query/read knobs shall be `limit`, `around`, `scope`, `includeTools`, `mode`, and `cursor`.
- **threads-se10** (ubiquitous): The thread tools shall use persisted thread sources as their data source. They shall not merge live in-memory session branch/entry state into `query_threads` or `read_thread`; a current thread is searchable only through its persisted JSONL/session representation.
- **threads-se11** (ubiquitous): The thread tools shall discover sources only from configured/current workspace Pi/Taumel session roots and the user's Pi session roots. They shall not accept arbitrary filesystem paths or directories as query inputs.
- **threads-se12** (event-driven): When `query_threads` runs with `scope = current_workspace`, the system shall include a persisted thread if its recorded `cwd`/workspace matches the current workspace, or if the source path is under the current workspace's configured session root when recorded workspace metadata is absent or incomplete.
- **threads-se22** (ubiquitous): `query_threads` shall not repeat the caller's current workspace root on every thread result. Each thread may include its own recorded workspace when known, and structured details may include the effective `scope` once.
- **threads-se13** (ubiquitous): The v1 `query_threads` matcher shall use simple case-insensitive substring matching over eligible structured fields. It shall not expose a phrase language, boolean operators, regex, or ranking DSL.
- **threads-se14** (event-driven): When a returned thread has branch, compaction, or goal summaries, `query_threads` may include those summaries as bounded thread metadata for orientation. Such summaries shall count as hits only when they match the query.
- **threads-se20** (ubiquitous): `query_threads` shall recover compacted-away context only through persisted visible compaction or branch summaries. It shall not reconstruct older branch history or hidden pre-compaction entries in v1.
- **threads-se15** (event-driven): When a query matches tool-call arguments, `query_threads` shall return a bounded argument snippet with the tool name and matching fragment, not the full raw argument object.
- **threads-se16** (ubiquitous): The v1 `query_threads` ranking shall be deterministic and explainable, ordered by exact thread id, thread id prefix, title match, summary match, visible message/tool hit count and recency, then current-workspace boost. It shall not use BM25 or opaque learned ranking in v1.
- **threads-se17** (ubiquitous): Each `query_threads` hit shall include non-numeric match metadata explaining why it matched, such as `field`/`kind`, role, tool name, and timestamp when known. The tool shall not expose numeric scores as part of the public result.

### Read

- **threads-rd01** (event-driven): When the model runs `read_thread`, the system shall accept an exact `threadID` or unique prefix plus optional `mode`. `mode` shall be one of `overview`, `window`, or `full`, defaulting to `overview`; the tool shall not expose a vague `goal` string parameter.
- **threads-rd02** (unwanted): If a thread id is ambiguous, then the system shall return a clear result rather than guess.
- **threads-rd03** (event-driven): When `read_thread` is called with only `threadID`, the system shall return a bounded structured overview rather than the full transcript: thread title, workspace when known, available time range, summaries when present, recent visible messages, and instructions/metadata for reading exact hits or requesting fuller context.
- **threads-rd15** (ubiquitous): `read_thread` `overview` mode shall include at most 10 recent visible entries.
- **threads-rd04** (unwanted): The system shall not dump a full transcript by default; full transcript retrieval shall require `mode = full` and shall remain subject to display/output budgets.
- **threads-rd05** (ubiquitous): The `query_threads` hit shall include a stable `locator` object with `threadID`, and `read_thread` shall accept that locator object directly as the preferred exact-read path. Every read path, including locator-based reads, shall require `threadID`; source path and JSONL line are adapter recovery metadata, not replacements for the thread identity. For manual retrieval, `read_thread` shall also accept loose fields `threadID` plus optional `entryID` or `line`; these are intentional input shapes, not deprecated aliases.
- **threads-rd06** (event-driven): When `read_thread` receives a hit locator, the system shall return a bounded context window around the referenced event, including exact event metadata and adjacent visible entries, without requiring the model to translate storage details by hand.
- **threads-rd07** (unwanted): The `read_thread` result shall not include persisted agent execution-snapshot system prompts, hidden reasoning payloads, encrypted reasoning content, raw full JSON event lines, or unbounded embedded tool-output blobs, even when reading an exact event locator.
- **threads-rd08** (unwanted): If `read_thread` is called with `mode = window` but without a locator, `entryID`, or `line`, then the system shall reject the request with a clear message rather than guessing a window.
- **threads-rd09** (ubiquitous): The `read_thread` `window` mode shall default to 3 visible entries before and after the referenced event, and cap an explicit `around` value at 10.
- **threads-rd10** (event-driven): Tool results inside a `window` response shall use bounded snippets. If the referenced event itself is a tool result, the system may show a larger bounded snippet for that event and shall include full-output or recovery metadata when available.
- **threads-rd16** (ubiquitous): In `window` mode, non-target tool result snippets shall cap at 2KB, and the referenced target event snippet shall cap at 8KB.
- **threads-rd11** (ubiquitous): In `mode = full`, `read_thread` shall return as much complete visible transcript as fits within the output budget, starting at the beginning by default, and shall include explicit truncation plus an opaque `cursor` when more transcript remains. Pagination shall use `cursor`, while JSONL line numbers remain available only as manual/exact recovery metadata.
- **threads-rd17** (ubiquitous): In `full` mode, truncation shall preserve complete visible entries, include explicit truncation metadata, and use a cursor when more remains.
- **threads-rd12** (ubiquitous): A `read_thread` cursor shall be opaque to the model but self-contained and validated on each call. It shall not require server-side cursor state or a hidden cache, preserving stateless tool behavior.
- **threads-rd13** (ubiquitous): In `mode = full`, `read_thread` shall include visible conversation structure but shall represent tool results as bounded snippets plus recovery metadata, not full unbounded tool blobs.
- **threads-rd14** (event-driven): If a requested thread has a usable identity but contains invalid JSONL entries, `read_thread` shall return the readable visible entries and include bounded diagnostics with line numbers for invalid entries. It shall fail only when the source metadata cannot establish the requested thread identity.

### Results

- **threads-rs01** (ubiquitous): Thread tools shall return both concise model-visible text and structured details. Structured details shall include returned threads, hits, locators, cursor, truncation, and read metadata needed by renderers and follow-up calls.

### Architecture and authorization

- **threads-ar01** (ubiquitous): The system shall separate session catalog and search from transcript reading, keep relevance scoring pure and testable, keep Pi access at the adapter edge, and keep rendering separate from execution.
- **threads-gp01** (event-driven): When a thread tool is called, the system shall authorize it through the capability profile.
- **threads-dp01** (ubiquitous): The system shall keep thread tools free of dependencies on goal state and memory.
- **threads-dp02** (ubiquitous): The thread tools shall be stateless across calls. `read_thread` shall not depend on the last `query_threads` result or any hidden per-tool cache to decide what to return; exact reads shall be driven only by explicit `threadID`, locator, `entryID`, line, mode, cursor, and window parameters.

### Verification

- **threads-vf01** (ubiquitous): Tests shall cover JSONL discovery and parsing for real `.jsonl` session files.
- **threads-vf02** (ubiquitous): Tests shall cover `query_threads` finding a term inside tool result text and returning bounded hit snippets.
- **threads-vf03** (unwanted): Tests shall verify hidden and encrypted reasoning are not searched or returned.
- **threads-vf04** (ubiquitous): Tests shall cover `read_thread` `overview`, `window`, and `full` modes, including budgets and no raw JSON output.
- **threads-vf05** (ubiquitous): Tests shall verify a locator returned by `query_threads` can be passed directly to `read_thread`.
- **threads-vf06** (event-driven): Tests shall verify invalid JSONL entries become bounded diagnostics and do not fail the whole query.
