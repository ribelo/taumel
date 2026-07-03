---
kind: requirement
status: draft
tags: [tool-rendering, ui]
depends_on: []
---
# Tool rendering

## Intent

Every Taumel tool call and result renders in the Pi TUI with a collapsed and an
expanded form. Collapsed clips to essentials, usually one line; expanded is rich
and recovers full content. Color is semantic only, with no syntax highlighting,
reusing existing theme tokens.

## Requirements

### Shared grammar

- **render-hd01** (ubiquitous): The system shall render every tool call with a one-line header `• <name> · <subject>`, the tool name in `toolTitle`, a dim separator, and a subject truncated with `…` when collapsed.
- **render-hd02** (ubiquitous): The system shall color the header dot by state: green for ok or exit 0, red for failure or non-zero exit, and yellow for running.
- **render-hd03** (event-driven): When a call is in flight, the system shall render a yellow dot and a trailing dim `(<progress>)`, and shall not repeat the exit code in the subject.
- **render-bd01** (ubiquitous): The system shall hang the body under the header with a dim `└` connector and align continuation lines with a 4-space indent, in `toolOutput`.
- **render-bd02** (ubiquitous): The system shall show truncation as a single dim `… N more` line, placed at the top for tail-oriented tools and the bottom for head-oriented tools, without hardcoding the expand keybinding.
- **render-bd03** (ubiquitous): The system shall render empty output as dim `(no output)`, or `(none)` for empty lists.
- **render-bd04** (ubiquitous): The system shall omit a separate metadata block, carrying state in the dot and load-bearing facts in the subject or one dim facts line.
- **render-ce01** (ubiquitous): The system shall clip collapsed renders and show full content-bearing fields when expanded, with no line cap and no per-line truncation.
- **render-cl01** (ubiquitous): The system shall use color only for the state dot, diff `+`/`-`, dim separators and counts, and body output, with no syntax highlighting, and shall introduce no new theme tokens.

### Per-tool

- **render-ex01** (ubiquitous): The system shall render `exec_command` and `write_stdin` with the command or sent chars as subject, tail-oriented output capped at 5 lines collapsed and 200 expanded, a running async session as a yellow dot with `(session N)`, and a poll as subject `poll session N` with body `(still running; no new output)`, stripping ANSI and written-echo.
- **render-rd01** (ubiquitous): The system shall render `read` as `• read · <path> (<N> lines)`, header-only collapsed, and the full head-oriented file with its line-number gutter and `… N more` at the bottom when expanded.
- **render-df01** (ubiquitous): The system shall render `edit` and `apply_patch` as a real unified diff (via the `diff` package) with a dim right-aligned line-number gutter, colored `+`/`-`/space markers, a `(+N -M)` subject summary, 2 context rows above and below the change block capped near 6 changed lines collapsed, and full hunks expanded. Total diff-body height is 2 + (changed rows) + 2 (e.g., 5 rows for a pure add/delete, 6 rows for a one-line replacement), not counting the header row. `apply_patch` with a single write and no deletes renders like `edit` when collapsed; otherwise it shows a per-file `path (+x -y)` summary, and expanded always shows each file's full diff.
- **render-df02** (ubiquitous): When `apply_patch` fails, the system shall render the failure reason to the user instead of only a red dot: collapsed shows a short error line and expanded shows the full tool-result/error text.
- **render-wr01** (ubiquitous): The system shall render `write` with a content head and `(<N> lines)` for new or overwrite, and the appended chunk with `(append +<N>)` for append.
- **render-co01** (ubiquitous): The system shall render collection tools (`find_thread`, `agent_list`, `web_search_exa`, `crawling_exa`, `exa_agent_list_runs`, `exa_agent_list_events`) with a query/filter subject plus dim `(<N> results)`, the top 3 items one line each when collapsed, up to ~30 items with an optional second dim line when expanded, and `(none)` when empty.
- **render-se01** (ubiquitous): The system shall render single-entity and action tools with a header plus one dim `·`-joined facts line collapsed, the header alone when there is nothing extra, and the full text body appended uncapped when expanded.
- **render-nt01** (ubiquitous): The system shall render `taumel.notification` completions with `exec_completion` (dot by exit status, subject `session N`, tail body 5 collapsed / full expanded) and `agent_completion` (dot by run status, subject `<agent-id> (<profile>)`, body of final output or error, full when expanded).
- **render-ag01** (ubiquitous): The system shall render `agent_spawn` expanded output without raw XML, showing profile, agent id, run id, status, and the full tool-argument `message`; when `create_goal = true`, the message label shall be `Objective sent`.
- **render-ag02** (ubiquitous): The system shall render `agent_wait` collapsed subjects with the selector and wait mode: omitted `timeout_seconds` as `until completion`, positive timeout as `up to Ns`, and `timeout_seconds = 0` as `poll now`, never as `infinity`.
- **render-ag03** (ubiquitous): The system shall render `agent_wait` expanded output without raw XML. For one run, it shall show a tiny `<agent-id> completed`/status header followed by final output or error. For multiple runs, it shall group by `<agent-id> · <run-id> · <status>` followed by that run's final output or error.

### Exa rendering

- **render-xa01** (ubiquitous): The system shall render `web_search_exa` and `crawling_exa` as collections showing `idx · title · domain` for the top 3 collapsed and up to ~10 items with full url and a dim summary snippet expanded, omitting score, cost, and author, with `crawling_exa` using an `N urls` subject and a longer per-page excerpt.
- **render-xa02** (ubiquitous): The system shall render `get_code_context_exa` as a head-oriented body tool with the query as subject, a ~5-line preview collapsed, and the full `response` expanded as plain output.
- **render-xa03** (ubiquitous): The system shall render `exa_agent_create_run` and `exa_agent_get_run` as single-entity tools showing `<id> · <status>` with the run output text full when expanded, `exa_agent_cancel_run` as a header-only action, and `exa_agent_list_runs` and `exa_agent_list_events` as collections.
