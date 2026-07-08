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
- **render-bd05** (ubiquitous): The system shall render truncated plain-text tool output on complete output-line boundaries whenever at least one complete line fits the display budget. If an individual line is too long to fit, the system may show a bounded UTF-8-boundary-safe long-line preview only with explicit truncation metadata or an omission marker; it shall never show a silent mid-line slice.
- **render-bd06** (ubiquitous): The system shall use tail-oriented truncation for command execution output and head-oriented truncation for file/read/search-like bodies. Head-oriented truncation shall not render a partial first line; when the first line exceeds the byte budget, it shall render an explicit recovery message naming the line, limit, and how to inspect the full content instead.
- **render-sh01** (ubiquitous): The system shall register every Taumel-rendered model-callable tool with `renderShell = "self"` so Pi's default tool shell cannot background-paint multiline bodies, diff gutters, indentation, wrapped whitespace, or blank rows.
- **render-sh02** (ubiquitous): The system shall keep every Taumel-rendered tool line below the terminal's last column when width permits, leaving a one-cell guard so exact-width writes cannot trigger terminal auto-wrap or smear background color after wrapped fragments.
- **render-ce01** (ubiquitous): The system shall clip collapsed renders and show full content-bearing fields when expanded, with no line cap and no per-line truncation.
- **render-cl01** (ubiquitous): The system shall use color only for the state dot, diff `+`/`-`, dim separators and counts, and body output, with no syntax highlighting, and shall introduce no new theme tokens.

### Per-tool

- **render-ex01** (ubiquitous): The system shall render `exec_command` and `write_stdin` with the command or sent chars as subject, tail-oriented output capped at 5 lines collapsed and 200 expanded, a running async session as a yellow dot with `(session N)`, and a poll as subject `poll session N` with body `(still running; no new output)`, stripping ANSI and written-echo.
- **render-rd01** (ubiquitous): The system shall render `read` as `• read · <path> (<N> lines)`, header-only collapsed, and the full head-oriented file with its line-number gutter and `… N more` at the bottom when expanded.
- **rendermedia-a8k2** (event-driven): When a `view_media` call is in flight, the system shall render a yellow-dot header with trailing progress text `(viewing image)`.
- **rendermedia-h6m4** (ubiquitous): The system shall render successful `view_media` results with the path and processed dimensions in the subject, using `<original-width>x<original-height> -> <width>x<height>` when the image was resized.
- **rendermedia-p9x1** (ubiquitous): The system shall render `view_media` collapsed as header-only and expanded with the tool-result text summary.
- **render-df01** (ubiquitous): The system shall render `edit` and `apply_patch` as a real unified diff (via the `diff` package) with a dim right-aligned line-number gutter, colored `+`/`-`/space markers, a `(+N -M)` subject summary, 2 context rows above and below the change block capped near 6 changed lines collapsed, and full hunks expanded. Total diff-body height is 2 + (changed rows) + 2 (e.g., 5 rows for a pure add/delete, 6 rows for a one-line replacement), not counting the header row. `apply_patch` with a single write and no deletes renders like `edit` when collapsed; otherwise it shows a per-file `path (+x -y)` summary, and expanded always shows each file's full diff.
- **render-df02** (ubiquitous): When `apply_patch` fails, the system shall render the failure reason to the user instead of only a red dot: collapsed shows a short error line and expanded shows the full tool-result/error text.
- **render-wr01** (ubiquitous): The system shall render `write` with a content head and `(<N> lines)` for new or overwrite, and the appended chunk with `(append +<N>)` for append.
- **render-co01** (ubiquitous): The system shall render collection tools (`agent_list`, `web_search_exa`, `crawling_exa`, `exa_agent_list_runs`, `exa_agent_list_events`) with a query/filter subject plus dim `(<N> results)`, the top 3 items one line each when collapsed, up to ~30 items with an optional second dim line when expanded, and `(none)` when empty.
- **render-th01** (ubiquitous): The system shall render `query_threads` collapsed as `• query_threads · "<query>" (N threads, M hits)` plus the top 3 thread lines. Expanded, it shall group by thread and show title/id, workspace when known, bounded summary metadata when present, and top hits with kind/role/tool/timestamp plus snippet, with no raw JSON and no score numbers.
- **render-th02** (ubiquitous): The system shall render `read_thread` collapsed as `• read_thread · <threadID> (<mode>)` with one short status/facts line. Expanded, it shall render structured thread content by mode: `overview` shows metadata, summaries, and recent visible entries; `window` shows target metadata plus adjacent visible entries and marks the target position textually; `full` shows the transcript page plus cursor/truncation footer. It shall render no raw JSON.
- **render-se01** (ubiquitous): The system shall render single-entity and action tools with a header plus one dim `·`-joined facts line collapsed, the header alone when there is nothing extra, and the full text body appended uncapped when expanded.
- **render-nt01** (ubiquitous): The system shall render `notification` completion-availability events as opaque plain-text ready signals with a neutral/info state marker and no terminal output, command text, exit code, final run status, reason, or error class. `exec_completion` shall show subject `session N ready` and the plain-text instruction to call `write_stdin` with empty `chars` and the shortest valid empty-poll `yield_time_ms`; `agent_completion` shall show subject `<agent-id> (<profile>) ready` and the plain-text instruction to call `agent_wait` with `run_ids` and `timeout_seconds = 0`.
- **render-nt02** (unwanted): The `notification` renderer shall not parse XML, infer success or failure, color by exit/run status, extract output/error blocks, or hide the plain-text body behind expansion.
- **render-nt03** (ubiquitous): The `notification` renderer shall remain registered as a custom renderer so completion availability is visually distinct from ordinary chat text, but its implementation shall be a dumb plain-text renderer: neutral marker, simple subject, and the visible notification body.
- **render-nt04** (ubiquitous): Completion-availability messages shall use `customType = "notification"`, not `customType = "taumel.notification"`.
- **render-ag01** (ubiquitous): The system shall render `agent_spawn` expanded output without raw XML, showing profile, agent id, run id, status, and the full tool-argument `message`; when `create_goal = true`, the message label shall be `Objective sent`.
- **render-ag02** (ubiquitous): The system shall render `agent_wait` collapsed subjects with the selector and wait mode: omitted `timeout_seconds` as `until completion`, positive timeout as `up to Ns`, and `timeout_seconds = 0` as `poll now`, never as `infinity`.
- **render-ag03** (ubiquitous): The system shall render `agent_wait` expanded output without raw XML. For one run, it shall show a tiny `<agent-id> completed`/status header followed by final output, error, or status-only marker such as `already_consumed`. For multiple runs, it shall group by `<agent-id> · <run-id> · <status>` followed by that run's final output, error, or status-only marker.

### Exa rendering

- **render-xa01** (ubiquitous): The system shall render `web_search_exa` and `crawling_exa` as collections showing `idx · title · domain` for the top 3 collapsed and up to ~10 items with full url and a dim summary snippet expanded, omitting score, cost, and author, with `crawling_exa` using an `N urls` subject and a longer per-page excerpt.
- **render-xa02** (ubiquitous): The system shall render `get_code_context_exa` as a head-oriented body tool with the query as subject, a ~5-line preview collapsed, and the full `response` expanded as plain output.
- **render-xa03** (ubiquitous): The system shall render `exa_agent_create_run` and `exa_agent_get_run` as single-entity tools showing `<id> · <status>` with the run output text full when expanded, `exa_agent_cancel_run` as a header-only action, and `exa_agent_list_runs` and `exa_agent_list_events` as collections.
