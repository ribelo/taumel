# Tool rendering

End-state for how every Taumel tool call and result renders in the Pi TUI.
Each tool has a **collapsed** and an **expanded** form. Collapsed is clipped to
the essentials (usually one line); expanded is rich. Color is semantic only —
no syntax highlighting.

## Shared grammar

### Header line
Every tool renders a one-line header:

```
• <name> · <subject>
```

- Leading **`•`** colored by state:
  - **green** — ok / exit 0
  - **red** — failed or non-zero exit (the red dot alone signals failure; the
    exit code is not repeated in the subject)
  - **yellow** — running / in-flight
- `<name>` is the tool name (`read`, `edit`, `exec_command`, …), in `toolTitle`.
- `·` is a dim separator.
- `<subject>` is the one-line identity of the call (command, path, query,
  objective, agent id, …), truncated with `…` when collapsed.

In-flight calls (`renderCall`, `isPartial`) render the header with a **yellow**
dot and a trailing dim `(<progress>)`, e.g. `• exec_command · cargo build (running)`.

### Body block
Output/details hang under the header:

- First body line prefixed with a dim **`  └ `** connector; continuation lines
  indented **`    `** (4 spaces) to align.
- Body lines in `toolOutput`.
- Truncation shown as a single dim line **`… N more`** (or `… N more lines`) —
  placed at the **top** for tail-oriented tools (exec) and at the **bottom** for
  head-oriented tools (read). The expand keybinding is **not** hardcoded into the
  hint: the renderer has no access to Pi's keybinding registry, so the line only
  states the remaining count and relies on the user's known expand binding.
- Empty output renders dim **`  └ (no output)`** (or `(none)` for empty lists).
- **No separate metadata block** (no `exit:` / `session:` / `wrote:` lines).
  State lives in the dot; load-bearing facts live in the subject or a single
  dim facts line.

### Collapsed vs expanded
- **Collapsed** is clipped: subject gets `…`, body is a small preview or a
  single facts line.
- **Expanded** shows the **full** content for content-bearing fields — no line
  cap and no per-line truncation (like `read` expanded). The complete objective,
  sent message, sub-agent output, file, or diff is always recoverable by
  expanding.

### Color
Semantic only: the **dot** (state), diff **`+`/`-`** (green/red), **dim**
(separators, counts, `(no output)`, `… N more`), and **`toolOutput`** (body).
**No syntax highlighting** — Codex's diffs don't use it either. A dormant
`theme.highlightCode(code, lang)` seam is left at one call site (read-expanded)
for later, shipped off.

Reuse the existing theme tokens — `toolTitle`, `toolOutput`, `toolDiffAdded` /
`toolDiffRemoved`, `muted`, `dim`, `accent`, and `success` / `error` / `warning`
for the dot. No new theme tokens are introduced (the diff gutter uses `dim`).

## Per-tool

### exec_command / write_stdin
- Subject = the command text (no `$` prefix) / the sent chars.
- Output is **tail-oriented**: last N lines, `… N more` at the top. Collapsed
  cap 5 lines, expanded 200.
- Running async session → yellow dot + trailing `(session N)` in the subject, no
  body yet; on completion the dot turns green/red and the body fills in.
- `write_stdin` with input → subject = sent chars. Poll (no chars) → subject =
  `poll session N`, body = `(still running; no new output)`.
- ANSI stripping and written-echo stripping carry over.

```
• exec_command · cargo build --release
  └ Compiling taumel v0.1.0
    Finished release in 12.3s

• exec_command · cargo test
  └ … 22 more lines
    test result: FAILED. 2 passed; 1 failed     (red dot)

• exec_command · sleep 60; echo done   (session 4)     (yellow dot, no body)

• write_stdin · poll session 4
  └ (still running; no new output)
```

### read
- `• read · <path> (<N> lines)` (or `(<shown>/<N> lines)` when clipped).
- Collapsed = header only.
- Expanded = full file, **head-oriented**, with the line-number gutter the tool
  already produces; `… N more` at the bottom.

### edit / apply_patch — Codex-parity diff
- Real unified diff computed with the `diff` package (`structuredPatch`).
- Rendered with a dim **right-aligned line-number gutter** (the gutter replaces
  the `└` connector — a single left rail), a colored `+`/`-`/(space) marker, and
  the code.
- Context lines shown plain. **Collapsed = changed lines + 0–1 context, cap ~6**;
  **expanded = full hunks with context.**
- Subject summary **`(+N -M)`**.
- `apply_patch` collapsed = per-file summary lines `path (+x -y)`; expanded =
  each file's full diff.

```
• edit · src/tool-renderer.ts  (+3 -1)
  133 - function limitedText(value, expanded, theme, compactLines = 8) {
  133 + function limitedText(value, expanded, theme, compactLines = 8, expandedLines = 120) {
  137   const limit = expanded ? expandedLines : compactLines;
  138 + const omitted = Math.max(0, lines.length - limit);
  … +1 more

• apply_patch · 2 files  (+18 -4)
  └ src/a.ts  (+12 -1)
    src/b.ts  (+6 -3)
    … expand for full diff
```

### write
- New / overwrite → content head + `(<N> lines)`.
- Append → the appended chunk + `(append +<N>)`.

```
• write · src/new-file.ts  (42 lines)
  └ import { Text } from "@earendil-works/pi-tui";
    export function render() {
    … 40 more lines
```

### Collection tools
`find_thread`, `agent_list`, `agent_wait`, `web_search_exa`, `crawling_exa`,
`exa_agent_list_runs`, `exa_agent_list_events`.

- Subject = query/filter + dim `(<N> results)`.
- **Collapsed = top 3 items**, one line each: `idx · title · dim-meta`
  (meta = url / id / count / status joined by `·`).
- **Expanded = up to ~30**, each item allowed a second dim wrapped line for the
  description/summary.
- Empty → `└ (none)`.

```
• find_thread · "auth bug"  (12 results)
  └ 1 · Fix login race · 14 msgs
    2 · Token refresh edge case · 8 msgs
    3 · Session cookie bug · 22 msgs
    … 9 more
```

### Single-entity / action tools
`get_goal` / `create_goal` / `update_goal`, `agent_spawn` / `agent_send` /
`agent_close` / `agent_profiles`, `ralph_continue` / `ralph_finish`,
`exa_agent_create_run` / `exa_agent_get_run` / `exa_agent_cancel_run`,
`read_thread`.
- Header + a single dim `· `-joined **facts line** collapsed (status, tokens,
  time, run id, lifecycle, iteration — whatever is load-bearing). If there is
  nothing extra (e.g. `update_goal`, `agent_close`) the header alone is the
  whole render.
- **Expanded appends the full text body** — the complete objective, sent
  message, or returned output, uncapped.

```
• create_goal · Ship the read tool
  └ active · 0 tokens · 0s

• agent_spawn · researcher
  └ run a1b2c3 · queued

• ralph_continue · task-42
  └ iteration 3 · running
```

### Completion notifications
`taumel.notification` custom messages.

- `exec_completion` — dot = exit status, subject = `session N`, tail body
  (5 collapsed / full expanded).
- `agent_completion` — dot = run status, subject = `<agent-id> (<profile>)`,
  body = final output (or the error block), **full when expanded**.

```
• exec_completion · session 4
  └ … 22 more lines
    test result: ok. 41 passed

• agent_completion · researcher-1 (researcher)
  └ Found 3 candidate fixes; recommend patching tool-executor…
```

## Exa tools

Three Exa tools refine or diverge from the shared patterns.

### web_search_exa / crawling_exa (collection)
Items are `results[]` of `{title, url, summary|highlights|text}`.

- **Collapsed top-3**: `idx · title · domain` (the URL domain, not the full URL).
- **Expanded ~10**, per item: `idx · title`, then dim full `url`, then a dim
  wrapped `summary` / first-highlight snippet.
- Skip score / cost / author; an optional dim `publishedDate` may appear in
  expanded only.
- `crawling_exa` uses the same shape but subject = `N urls`, and its expanded
  per-page excerpt is allowed to be longer (~10 lines) since fetching page text
  is the point.

```
• web_search_exa · "rust async runtime"  (10 results)
  └ 1 · Tokio — async runtime for Rust · tokio.rs
    2 · async-std book · docs.rs
    3 · Comparing async runtimes · without.boats
    … 7 more
```

### get_code_context_exa (head-oriented body)
Returns a single `response` string (code + explanation), not a list — so it is a
body tool, not a collection.

- Subject = the query (truncated).
- Head-oriented body: collapsed ~5-line preview, expanded = the full `response`
  uncapped (like `read` expanded). Plain `toolOutput` — no highlighting even
  though it is code.

```
• get_code_context_exa · "how to use tokio::select"
  └ `tokio::select!` waits on multiple async branches, running the first to complete…
        fn run() { tokio::select! { … } }
    … 38 more lines
```

### exa_agent_* runs
- `exa_agent_create_run` / `exa_agent_get_run` → single-entity:
  `• exa_agent_get_run · <id> · <status>`, with the run's `output.text` shown
  **full when expanded**.
- `exa_agent_cancel_run` → action, header only.
- `exa_agent_list_runs` / `exa_agent_list_events` → collection.
