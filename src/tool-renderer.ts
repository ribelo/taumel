import { Text } from "@earendil-works/pi-tui";
import { structuredPatch } from "diff";

// ─────────────────────────────────────────────────────────────────────────────
// Field accessors
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolField(record: Record<string, unknown>, name: string): boolean | undefined {
  const value = record[name];
  return typeof value === "boolean" ? value : undefined;
}

function recordField(record: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const value = record[name];
  return isRecord(value) ? value : undefined;
}

function recordArrayField(record: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const value = record[name];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArrayField(record: Record<string, unknown>, name: string): string[] {
  const value = record[name];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme helpers
// ─────────────────────────────────────────────────────────────────────────────

function themeFg(theme: unknown, color: string, value: string): string {
  if (!isRecord(theme)) return value;
  const fg = theme["fg"];
  if (typeof fg !== "function") return value;
  const rendered = fg.call(theme, color, value);
  return typeof rendered === "string" ? rendered : value;
}

// Dormant seam: Pi themes may expose `highlightCode(code, lang)` for future
// syntax highlighting. It is invoked at the read-expanded call site only; when
// absent (the common case) the renderer falls back to plain toolOutput.
function maybeHighlight(theme: unknown, code: string, lang: string): string | undefined {
  if (!isRecord(theme)) return undefined;
  const highlight = theme["highlightCode"];
  if (typeof highlight !== "function") return undefined;
  try {
    const rendered = highlight.call(theme, code, lang);
    return typeof rendered === "string" ? rendered : undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers
// ─────────────────────────────────────────────────────────────────────────────

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1);
}

function textContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result["content"])) return "";
  const parts: string[] = [];
  for (const item of result["content"]) {
    if (isRecord(item) && item["type"] === "text" && typeof item["text"] === "string") {
      parts.push(item["text"]);
    }
  }
  return parts.join("\n");
}

function detailsRecord(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) return {};
  return isRecord(result["details"]) ? result["details"] : {};
}

function argsFromContext(context: unknown): Record<string, unknown> {
  return isRecord(context) && isRecord(context["args"]) ? context["args"] : {};
}

function expandedFromOptions(options: unknown): boolean {
  return isRecord(options) && options["expanded"] === true;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grammar primitives: `• <name> · <subject>` header + `  └ ` / `    ` body rail
// ─────────────────────────────────────────────────────────────────────────────

function dot(theme: unknown, color: string): string {
  return themeFg(theme, color, "•");
}

function header(name: string, subject: string, dotColor: string, theme: unknown, dimTrailing = ""): string {
  const parts = [dot(theme, dotColor), themeFg(theme, "toolTitle", name)];
  if (subject !== "") {
    parts.push(themeFg(theme, "dim", "·"));
    parts.push(subject);
  }
  if (dimTrailing !== "") parts.push(themeFg(theme, "dim", dimTrailing));
  return parts.join(" ");
}

function callHeader(name: string, subject: string, progress: string, theme: unknown): string {
  return header(name, subject, "warning", theme, `(${progress})`);
}

// Apply the `  └ ` connector to the first physical line and a 4-space indent to
// every continuation line. Entries may themselves contain newlines (expanded
// collection items with a wrapped description); each physical line is railed.
function joinBody(entries: readonly string[], theme: unknown): string {
  const lines = entries.flatMap((entry) => entry.split(/\r?\n/));
  if (lines.length === 0) return "";
  return lines
    .map((line, index) => `${themeFg(theme, "dim", index === 0 ? "  └ " : "    ")}${line}`)
    .join("\n");
}

function moreLine(count: number, theme: unknown, unit: "more" | "more lines"): string {
  return themeFg(theme, "dim", `… ${count} ${unit}`);
}

function outputLines(lines: readonly string[], expanded: boolean, theme: unknown, maxCollapsed: number): string[] {
  return lines.map((line) => themeFg(theme, "toolOutput", expanded ? line : truncate(line, maxCollapsed)));
}

// Tail-oriented body (exec): last N lines, `… N more lines` at the top.
function renderTailBody(
  text: string,
  expanded: boolean,
  theme: unknown,
  cap: number,
  expandedCap: number,
  maxCollapsed: number,
): string {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "") return joinBody([themeFg(theme, "dim", "(no output)")], theme);
  const all = cleaned.split(/\r?\n/);
  const limit = expanded ? expandedCap : cap;
  if (all.length <= limit) return joinBody(outputLines(all, expanded, theme, maxCollapsed), theme);
  const visible = all.slice(-limit);
  return joinBody([moreLine(all.length - limit, theme, "more lines"), ...outputLines(visible, expanded, theme, maxCollapsed)], theme);
}

// Head-oriented body (read / write / code-context): first N lines, `… N more lines` at the bottom.
function renderHeadBody(
  text: string,
  expanded: boolean,
  theme: unknown,
  cap: number,
  expandedCap: number,
  maxCollapsed: number,
): string {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "") return joinBody([themeFg(theme, "dim", "(no output)")], theme);
  const all = cleaned.split(/\r?\n/);
  const limit = expanded ? expandedCap : cap;
  if (all.length <= limit) return joinBody(outputLines(all, expanded, theme, maxCollapsed), theme);
  const visible = all.slice(0, limit);
  return joinBody([...outputLines(visible, expanded, theme, maxCollapsed), moreLine(all.length - limit, theme, "more lines")], theme);
}

// The full textContent body for single-entity tools expanded: appended under the
// facts line, uncapped.
function fullTextLines(text: string, theme: unknown): string[] {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "") return [];
  return cleaned.split(/\r?\n/).map((line) => themeFg(theme, "toolOutput", line));
}

// ─────────────────────────────────────────────────────────────────────────────
// State → dot color
// ─────────────────────────────────────────────────────────────────────────────

function dotFromDetails(details: Record<string, unknown>): string {
  const code = numberField(details, "exitCode") ?? numberField(details, "code");
  if (code !== undefined) return code === 0 ? "success" : "error";
  if (boolField(details, "ok") === false) return "error";
  return "success";
}

// ─────────────────────────────────────────────────────────────────────────────
// Subjects (one-line identity of the call), derived from args
// ─────────────────────────────────────────────────────────────────────────────

function quotedQuery(args: Record<string, unknown>, expanded: boolean): string {
  return `"${truncate(oneLine(stringField(args, "query") ?? ""), expanded ? 400 : 120)}"`;
}

function subjectFromArgs(name: string, args: Record<string, unknown>, expanded: boolean): string {
  const max = expanded ? 400 : 120;
  switch (name) {
    case "exec_command":
      return truncate(oneLine(stringField(args, "cmd") ?? "exec_command"), max);
    case "write_stdin": {
      const chars = stringField(args, "chars") ?? "";
      if (chars.trim() !== "") return truncate(oneLine(chars), max);
      const sid = numberField(args, "session_id");
      return sid === undefined ? "poll" : `poll session ${sid}`;
    }
    case "write":
    case "edit":
    case "read":
      return truncate(stringField(args, "path") ?? "", max);
    case "apply_patch":
      return truncate(oneLine(stringField(args, "input") ?? stringField(args, "patch") ?? "patch"), max);
    case "agent_spawn":
      return truncate(stringField(args, "profile") ?? "", max);
    case "agent_send":
      return truncate(stringField(args, "agent_id") ?? "", max);
    case "agent_wait": {
      const agentIds = Array.isArray(args["agent_ids"]) ? args["agent_ids"].length : 0;
      const runIds = Array.isArray(args["run_ids"]) ? args["run_ids"].length : 0;
      if (runIds > 0) return `${runIds} run${runIds === 1 ? "" : "s"}`;
      if (agentIds > 0) return `${agentIds} agent${agentIds === 1 ? "" : "s"}`;
      return "active runs";
    }
    case "agent_list":
      return args["include_closed"] === true ? "including closed" : "open agents";
    case "agent_close":
      return args["all"] === true ? "all" : `${Array.isArray(args["agent_ids"]) ? args["agent_ids"].length : 0} agent(s)`;
    case "agent_profiles":
      return "profiles";
    case "create_goal":
      return truncate(oneLine(stringField(args, "objective") ?? ""), max);
    case "update_goal":
      return stringField(args, "status") ?? "";
    case "find_thread":
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return quotedQuery(args, expanded);
    case "read_thread":
      return truncate(stringField(args, "threadID") ?? "", max);
    case "ralph_continue":
    case "ralph_finish":
      return truncate(stringField(args, "task_id") ?? "", max);
    case "crawling_exa": {
      const urls = Array.isArray(args["urls"]) ? args["urls"].length : 0;
      const ids = Array.isArray(args["ids"]) ? args["ids"].length : 0;
      return urls > 0 ? `${urls} url${urls === 1 ? "" : "s"}` : `${ids} id${ids === 1 ? "" : "s"}`;
    }
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return truncate(stringField(args, "id") ?? "", max);
    case "exa_agent_list_runs":
      return args["limit"] === undefined ? "recent runs" : `limit ${args["limit"]}`;
    default:
      return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified diff (edit / apply_patch) via the `diff` package
// ─────────────────────────────────────────────────────────────────────────────

type DiffRender = { readonly added: number; readonly removed: number; readonly lines: string[]; readonly markers: string[] };

function countChanges(hunks: { readonly lines: readonly string[] }[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const raw of hunk.lines) {
      if (raw[0] === "+") added += 1;
      else if (raw[0] === "-") removed += 1;
    }
  }
  return { added, removed };
}

function renderDiff(before: string, after: string, expanded: boolean, theme: unknown): DiffRender {
  const context = expanded ? 3 : 1;
  let patch: { hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] };
  try {
    patch = structuredPatch("", "", before ?? "", after ?? "", "", "", { context });
  } catch {
    patch = { hunks: [] };
  }
  const { added, removed } = countChanges(patch.hunks);
  let maxLine = 0;
  for (const hunk of patch.hunks) {
    maxLine = Math.max(maxLine, hunk.newStart + hunk.newLines, hunk.oldStart + hunk.oldLines);
  }
  const width = Math.max(2, String(maxLine).length);
  const lines: string[] = [];
  const markers: string[] = [];
  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      if (raw[0] === "\\") continue; // "\ No newline at end of file" marker
      const marker = raw[0];
      const code = raw.slice(1);
      let num: number;
      if (marker === "+") {
        num = newLine;
        newLine += 1;
      } else if (marker === "-") {
        num = oldLine;
        oldLine += 1;
      } else {
        num = newLine;
        oldLine += 1;
        newLine += 1;
      }
      const gutter = themeFg(theme, "dim", `  ${String(num).padStart(width)}`);
      const markColor = marker === "+" ? "toolDiffAdded" : marker === "-" ? "toolDiffRemoved" : "dim";
      const mark = themeFg(theme, markColor, marker);
      const codeStr = themeFg(theme, "toolOutput", code);
      lines.push(`${gutter} ${mark} ${codeStr}`);
      markers.push(marker);
    }
  }
  return { added, removed, lines, markers };
}

function diffCounts(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };
  try {
    const patch = structuredPatch("", "", before ?? "", after ?? "", "", "", { context: 0 });
    return countChanges(patch.hunks);
  } catch {
    return { added: 0, removed: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool renderers
// ─────────────────────────────────────────────────────────────────────────────

function renderShell(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const subject = subjectFromArgs(name, args, expanded);
  const sid = numberField(details, "sessionId") ?? numberField(details, "session_id");
  const code = numberField(details, "exitCode") ?? numberField(details, "code");

  // Async session still running: yellow dot, `(session N)` in the subject, no body yet.
  if (name === "exec_command" && sid !== undefined && code === undefined) {
    return new Text(header(name, `${subject} (session ${sid})`, "warning", theme), 0, 0);
  }

  const head = header(name, subject, dotFromDetails(details), theme);
  const output = stringField(details, "output") ?? textContent(result);

  // write_stdin poll with no new output.
  if (name === "write_stdin") {
    const chars = stringField(args, "chars") ?? "";
    if (chars.trim() === "" && output.trim() === "") {
      return new Text([head, joinBody([themeFg(theme, "dim", "(still running; no new output)")], theme)].join("\n"), 0, 0);
    }
  }

  return new Text([head, renderTailBody(output, expanded, theme, 5, 200, 220)].join("\n"), 0, 0);
}

function renderRead(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringField(details, "path") ?? stringField(args, "path") ?? "";
  const total = numberField(details, "totalLines");
  const shown = numberField(details, "shownLines");
  const subject =
    total === undefined
      ? path
      : shown !== undefined && shown < total
        ? `${path} (${shown}/${total} lines)`
        : `${path} (${total} line${total === 1 ? "" : "s"})`;
  const head = header("read", subject, dotFromDetails(details), theme);
  if (!expanded) return new Text(head, 0, 0);

  const rawText = textContent(result);
  const highlighted = maybeHighlight(theme, rawText, langFromPath(path));
  const bodyText = highlighted ?? rawText;
  const physical = bodyText.trimEnd().split(/\r?\n/);
  const colored = highlighted ? physical : physical.map((line) => themeFg(theme, "toolOutput", line));
  if (shown !== undefined && total !== undefined && shown < total) {
    colored.push(moreLine(total - shown, theme, "more lines"));
  }
  if (colored.length === 0 || (colored.length === 1 && colored[0] === "")) return new Text(head, 0, 0);
  return new Text([head, joinBody(colored, theme)].join("\n"), 0, 0);
}

function renderWrite(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringField(details, "displayPath") ?? stringField(details, "path") ?? stringField(args, "path") ?? "";
  const mode = stringField(details, "mode");
  const contents = stringField(details, "contents") ?? "";
  const lineCount = contents === "" ? 0 : contents.trimEnd().split(/\r?\n/).length;
  const trailing = mode === "append" ? `(append +${lineCount})` : `(${lineCount} line${lineCount === 1 ? "" : "s"})`;
  const head = header("write", path, dotFromDetails(details), theme, trailing);
  if (contents.trim() === "") return new Text(head, 0, 0);
  return new Text([head, renderHeadBody(contents, expanded, theme, 3, 120, 220)].join("\n"), 0, 0);
}

function renderEdit(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringField(details, "displayPath") ?? stringField(details, "path") ?? stringField(args, "path") ?? "";
  const before = stringField(details, "before");
  const after = stringField(details, "after");
  const head = header("edit", path, dotFromDetails(details), theme);
  if (before === undefined || after === undefined) {
    const editCount = numberField(details, "editCount");
    const summary = editCount !== undefined ? `${editCount} replacement${editCount === 1 ? "" : "s"}` : "";
    const body = summary === "" ? "" : joinBody([themeFg(theme, "dim", summary)], theme);
    return new Text([head, body].filter(Boolean).join("\n"), 0, 0);
  }
  const diff = renderDiff(before, after, expanded, theme);
  const withSummary = header("edit", path, dotFromDetails(details), theme, `(+${diff.added} -${diff.removed})`);
  let body: string;
  if (!expanded && diff.lines.length > 6) {
    const hiddenMarkers = diff.markers.slice(6);
    const hiddenAdded = hiddenMarkers.filter((marker) => marker === "+").length;
    const label = hiddenAdded > 0 ? `… +${hiddenAdded} more` : `… ${hiddenMarkers.length} more`;
    body = [...diff.lines.slice(0, 6), `  ${themeFg(theme, "dim", label)}`].join("\n");
  } else {
    body = diff.lines.join("\n");
  }
  return new Text([withSummary, body].filter(Boolean).join("\n"), 0, 0);
}

function renderApplyPatch(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const writes = recordArrayField(details, "writes").map((write) => ({
    path: stringField(write, "path") ?? "",
    before: stringField(write, "before") ?? "",
    after: stringField(write, "contents") ?? stringField(write, "after") ?? "",
  }));
  const deletes = stringArrayField(details, "deletes");
  const dotColor = dotFromDetails(details);

  if (writes.length === 0 && deletes.length === 0) {
    return new Text(header(name, subjectFromArgs(name, args, expanded), dotColor, theme), 0, 0);
  }

  const perFile = writes.map((write) => {
    const { added, removed } = diffCounts(write.before, write.after);
    return { ...write, added, removed };
  });
  const totalAdded = perFile.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = perFile.reduce((sum, file) => sum + file.removed, 0);
  const fileCount = writes.length + deletes.length;
  const head = header(name, `${fileCount} file${fileCount === 1 ? "" : "s"}`, dotColor, theme, `(+${totalAdded} -${totalRemoved})`);

  if (!expanded) {
    const summaryLines = [
      ...perFile.map((file) => themeFg(theme, "toolOutput", `${file.path} (+${file.added} -${file.removed})`)),
      ...deletes.map((path) => themeFg(theme, "toolOutput", `${path} (deleted)`)),
    ];
    summaryLines.push(themeFg(theme, "dim", "… expand for full diff"));
    return new Text([head, joinBody(summaryLines, theme)].join("\n"), 0, 0);
  }

  const blocks: string[] = [];
  for (const file of perFile) {
    const fileHead = `  ${themeFg(theme, "toolTitle", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}`;
    const diff = renderDiff(file.before, file.after, true, theme);
    blocks.push(fileHead);
    if (diff.lines.length > 0) blocks.push(diff.lines.join("\n"));
  }
  for (const path of deletes) {
    blocks.push(`  ${themeFg(theme, "toolTitle", path)} ${themeFg(theme, "dim", "(deleted)")}`);
  }
  return new Text([head, ...blocks].join("\n"), 0, 0);
}

function renderGoal(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const goal = recordField(details, "goal");
  const subject = goal !== undefined ? stringField(goal, "objective") ?? subjectFromArgs(name, args, expanded) : subjectFromArgs(name, args, expanded);
  const head = header(name, truncate(oneLine(subject), expanded ? 300 : 120), dotFromDetails(details), theme);
  const bodyLines: string[] = [];
  if (goal !== undefined) {
    const facts = [
      stringField(goal, "status"),
      numberField(goal, "tokensUsed") !== undefined ? `${numberField(goal, "tokensUsed")} tokens` : undefined,
      numberField(goal, "timeUsedSeconds") !== undefined ? `${numberField(goal, "timeUsedSeconds")}s` : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) bodyLines.push(themeFg(theme, "dim", facts.join(" · ")));
  }
  if (expanded) bodyLines.push(...fullTextLines(textContent(result), theme));
  return new Text([head, joinBody(bodyLines, theme)].filter(Boolean).join("\n"), 0, 0);
}

function listItemTitle(item: Record<string, unknown>, fallback: string): string {
  return stringField(item, "title") ?? stringField(item, "id") ?? stringField(item, "url") ?? fallback;
}

function resultDescription(item: Record<string, unknown>): string | undefined {
  const summary = stringField(item, "summary") ?? stringField(item, "text") ?? stringField(item, "content");
  if (summary !== undefined) return summary;
  const highlights = item["highlights"];
  if (Array.isArray(highlights)) return highlights.find((part): part is string => typeof part === "string");
  return undefined;
}

function collectionMeta(item: Record<string, unknown>): string {
  const parts: string[] = [];
  const url = stringField(item, "url");
  if (url !== undefined) parts.push(domainOf(url));
  const count = numberField(item, "messageCount") ?? numberField(item, "message_count");
  if (count !== undefined) parts.push(`${count} msgs`);
  const status = stringField(item, "status");
  if (status !== undefined) parts.push(status);
  const lifecycle = stringField(item, "lifecycle");
  if (lifecycle !== undefined) parts.push(lifecycle);
  const sandbox = stringField(item, "sandbox");
  if (sandbox !== undefined) parts.push(sandbox);
  return parts.join(" · ");
}

function collectionItemLine(item: Record<string, unknown>, index: number, expanded: boolean, theme: unknown): string {
  const sep = ` ${themeFg(theme, "dim", "·")} `;
  const title = listItemTitle(item, `item ${index + 1}`);
  let line = `${themeFg(theme, "accent", String(index + 1))}${sep}${themeFg(theme, "toolOutput", title)}`;
  const meta = collectionMeta(item);
  if (meta !== "") line += `${sep}${themeFg(theme, "dim", meta)}`;
  if (expanded) {
    const description = resultDescription(item);
    if (description !== undefined && description.trim() !== "") {
      line += `\n${themeFg(theme, "dim", truncate(oneLine(description), 900))}`;
    }
  }
  return line;
}

function renderCollectionItems(
  name: string,
  details: Record<string, unknown>,
  options: unknown,
  theme: unknown,
  baseSubject: string,
  items: Record<string, unknown>[],
): Text {
  const expanded = expandedFromOptions(options);
  const head = header(name, baseSubject, dotFromDetails(details), theme, `(${items.length} result${items.length === 1 ? "" : "s"})`);
  if (items.length === 0) return new Text([head, joinBody([themeFg(theme, "dim", "(none)")], theme)].join("\n"), 0, 0);
  const limit = expanded ? 30 : 3;
  const bodyLines = items.slice(0, limit).map((item, index) => collectionItemLine(item, index, expanded, theme));
  if (items.length > limit) bodyLines.push(moreLine(items.length - limit, theme, "more"));
  return new Text([head, joinBody(bodyLines, theme)].join("\n"), 0, 0);
}

function renderFindThread(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const details = detailsRecord(result);
  return renderCollectionItems(name, details, options, theme, subjectFromArgs(name, args, expandedFromOptions(options)), recordArrayField(details, "threads"));
}

function renderReadThread(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const thread = recordField(details, "thread");
  const head = header(name, subjectFromArgs(name, args, expanded), dotFromDetails(details), theme);
  const bodyLines: string[] = [];
  if (thread !== undefined) {
    const facts = [
      stringField(thread, "title"),
      (numberField(thread, "messageCount") ?? numberField(thread, "message_count")) !== undefined
        ? `${numberField(thread, "messageCount") ?? numberField(thread, "message_count")} msgs`
        : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) bodyLines.push(themeFg(theme, "dim", facts.join(" · ")));
  }
  if (expanded) bodyLines.push(...fullTextLines(textContent(result), theme));
  return new Text([head, joinBody(bodyLines, theme)].filter(Boolean).join("\n"), 0, 0);
}

function renderAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const workers = recordArrayField(details, "workers");
  const profiles = recordArrayField(details, "profiles");
  if (workers.length > 0) return renderCollectionItems(name, details, options, theme, subjectFromArgs(name, args, expanded), workers);
  if (profiles.length > 0) return renderCollectionItems(name, details, options, theme, subjectFromArgs(name, args, expanded), profiles);

  const worker = recordField(details, "worker");
  const head = header(name, subjectFromArgs(name, args, expanded), dotFromDetails(details), theme);
  const bodyLines: string[] = [];
  if (worker !== undefined) {
    const id = stringField(worker, "id");
    const lifecycle = stringField(worker, "lifecycle");
    const facts = [id !== undefined ? `run ${id}` : undefined, lifecycle].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) bodyLines.push(themeFg(theme, "dim", facts.join(" · ")));
  }
  if (expanded) bodyLines.push(...fullTextLines(textContent(result), theme));
  return new Text([head, joinBody(bodyLines, theme)].filter(Boolean).join("\n"), 0, 0);
}

function renderRalph(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const taskId = stringField(details, "taskId") ?? subjectFromArgs(name, args, expanded);
  const head = header(name, taskId, dotFromDetails(details), theme);
  const facts = [
    numberField(details, "iteration") !== undefined ? `iteration ${numberField(details, "iteration")}` : undefined,
    stringField(details, "status"),
    boolField(details, "reflection") === true ? "reflection" : undefined,
  ].filter((part): part is string => part !== undefined && part !== "");
  const bodyLines: string[] = [];
  if (facts.length > 0) bodyLines.push(themeFg(theme, "dim", facts.join(" · ")));
  if (expanded) bodyLines.push(...fullTextLines(textContent(result), theme));
  return new Text([head, joinBody(bodyLines, theme)].filter(Boolean).join("\n"), 0, 0);
}

function renderExaSearch(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordField(details, "response") ?? {};
  const results = recordArrayField(response, "results");
  const head = header(name, subjectFromArgs(name, args, expanded), dotFromDetails(details), theme, `(${results.length} result${results.length === 1 ? "" : "s"})`);
  if (results.length === 0) return new Text([head, joinBody([themeFg(theme, "dim", "(none)")], theme)].join("\n"), 0, 0);
  const limit = expanded ? 10 : 3;
  const sep = ` ${themeFg(theme, "dim", "·")} `;
  const bodyLines = results.slice(0, limit).map((item, index) => {
    const title = listItemTitle(item, `result ${index + 1}`);
    const url = stringField(item, "url") ?? "";
    const domain = domainOf(url);
    let line = `${themeFg(theme, "accent", String(index + 1))}${sep}${themeFg(theme, "toolOutput", title)}`;
    if (domain !== "") line += `${sep}${themeFg(theme, "dim", domain)}`;
    if (expanded) {
      const extra: string[] = [];
      if (url !== "") extra.push(themeFg(theme, "dim", url));
      const published = stringField(item, "publishedDate");
      if (published !== undefined) extra.push(themeFg(theme, "dim", published));
      const description = resultDescription(item);
      if (description !== undefined && description.trim() !== "") {
        extra.push(themeFg(theme, "dim", truncate(oneLine(description), name === "crawling_exa" ? 600 : 300)));
      }
      if (extra.length > 0) line += `\n${extra.join("\n")}`;
    }
    return line;
  });
  if (results.length > limit) bodyLines.push(moreLine(results.length - limit, theme, "more"));
  return new Text([head, joinBody(bodyLines, theme)].join("\n"), 0, 0);
}

function renderCodeContext(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordField(details, "response") ?? {};
  const text = stringField(response, "response") ?? textContent(result);
  const head = header(name, subjectFromArgs(name, args, expanded), dotFromDetails(details), theme);
  return new Text([head, renderHeadBody(text, expanded, theme, 5, 100000, 220)].join("\n"), 0, 0);
}

function renderExaAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordField(details, "response") ?? {};

  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    const data = recordArrayField(response, "data");
    const items = data.length > 0 ? data : recordArrayField(response, "results");
    return renderCollectionItems(name, details, options, theme, subjectFromArgs(name, args, expanded), items);
  }
  if (name === "exa_agent_cancel_run") {
    return new Text(header(name, subjectFromArgs(name, args, expanded), dotFromDetails(details), theme), 0, 0);
  }
  // create_run / get_run: single entity `<id> · <status>`, output.text full when expanded.
  const id = stringField(response, "id") ?? subjectFromArgs(name, args, expanded);
  const status = stringField(response, "status");
  const subject = status !== undefined ? `${id} · ${status}` : id;
  const head = header(name, subject, dotFromDetails(details), theme);
  const output = recordField(response, "output");
  const text = output !== undefined ? stringField(output, "text") ?? "" : stringField(response, "response") ?? "";
  const bodyLines = expanded ? fullTextLines(text, theme) : [];
  return new Text([head, joinBody(bodyLines, theme)].filter(Boolean).join("\n"), 0, 0);
}

function renderGeneric(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const text = textContent(result);
  const head = header(name, subjectFromArgs(name, args, expanded), dotFromDetails(details), theme);
  const body = renderTailBody(expanded ? (text === "" ? compactJson(details) : text) : text, expanded, theme, 5, 200, 220);
  return new Text([head, body].join("\n"), 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// taumel.notification message renderer (subagent + exec completions)
// ─────────────────────────────────────────────────────────────────────────────

function attrValue(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match ? match[1] : undefined;
}

function blockBetween(content: string, tag: string): string {
  const match = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?\\s*</${tag}>`).exec(content);
  return match ? match[1] : "";
}

function renderNotificationMessage(message: unknown, options: unknown, theme: unknown): Text | undefined {
  const content = isRecord(message) ? stringField(message, "content") ?? "" : "";
  if (content === "") return undefined;
  const expanded = expandedFromOptions(options);
  const kind = attrValue(content, /kind="([^"]*)"/) ?? "notification";

  if (kind === "exec_completion") {
    const sessionId = attrValue(content, /<session id="([^"]*)"/);
    const exitCode = attrValue(content, /exit_code="(-?\d+)"/);
    const code = exitCode === undefined ? undefined : Number(exitCode);
    const dotColor = code === undefined ? "success" : code === 0 ? "success" : "error";
    const subject = sessionId === undefined ? "" : `session ${sessionId}`;
    const head = header("exec_completion", subject, dotColor, theme);
    const body = renderTailBody(blockBetween(content, "output"), expanded, theme, 5, 100000, 220);
    return new Text([head, body].join("\n"), 0, 0);
  }

  if (kind === "agent_completion") {
    const agentId = attrValue(content, /<agent id="([^"]*)"/);
    const profile = attrValue(content, /profile="([^"]*)"/);
    const runStatus = attrValue(content, /<run id="[^"]*" status="([^"]*)"/) ?? "completed";
    const dotColor = runStatus === "completed" || runStatus === "succeeded" ? "success" : "error";
    const subject = [agentId, profile !== undefined ? `(${profile})` : undefined].filter(Boolean).join(" ");
    const head = header("agent_completion", subject, dotColor, theme);
    const finalOutput = blockBetween(content, "final_output");
    const text = finalOutput !== "" ? finalOutput : blockBetween(content, "error");
    const body = renderTailBody(text, expanded, theme, 5, 100000, 220);
    return new Text([head, body].join("\n"), 0, 0);
  }

  return new Text(renderTailBody(content, expanded, theme, 6, 100000, 220), 0, 0);
}

export function notificationMessageRenderer() {
  return (message: unknown, options: unknown, theme: unknown) =>
    renderNotificationMessage(message, options, theme);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory
// ─────────────────────────────────────────────────────────────────────────────

function progressText(name: string): string {
  if (name.startsWith("exa_") || name.endsWith("_exa")) return "waiting for Exa";
  if (name === "find_thread") return "searching threads";
  if (name === "read_thread") return "reading thread";
  if (name === "read") return "reading";
  if (name === "agent_wait") return "waiting";
  return "running";
}

export function renderersForTool(name: string) {
  return {
    renderCall(args: unknown, theme: unknown, context: unknown) {
      if (isRecord(context) && context["isPartial"] === false) return new Text("", 0, 0);
      const callArgs = isRecord(args) ? args : {};
      if (name === "exec_command" || name === "write_stdin") {
        return new Text(callHeader(name, subjectFromArgs(name, callArgs, false), "running", theme), 0, 0);
      }
      return new Text(callHeader(name, subjectFromArgs(name, callArgs, false), progressText(name), theme), 0, 0);
    },
    renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
      if (isRecord(options) && options["isPartial"] === true) {
        const args = argsFromContext(context);
        return new Text(callHeader(name, subjectFromArgs(name, args, false), progressText(name), theme), 0, 0);
      }
      const args = argsFromContext(context);
      if (name === "exec_command" || name === "write_stdin") return renderShell(name, result, options, theme, args);
      if (name === "read") return renderRead(name, result, options, theme, args);
      if (name === "write") return renderWrite(name, result, options, theme, args);
      if (name === "edit") return renderEdit(name, result, options, theme, args);
      if (name === "apply_patch") return renderApplyPatch(name, result, options, theme, args);
      if (name === "get_goal" || name === "create_goal" || name === "update_goal") return renderGoal(name, result, options, theme, args);
      if (name === "find_thread") return renderFindThread(name, result, options, theme, args);
      if (name === "read_thread") return renderReadThread(name, result, options, theme, args);
      if (name.startsWith("agent_")) return renderAgent(name, result, options, theme, args);
      if (name === "ralph_continue" || name === "ralph_finish") return renderRalph(name, result, options, theme, args);
      if (name === "get_code_context_exa") return renderCodeContext(name, result, options, theme, args);
      if (name === "web_search_exa" || name === "crawling_exa") return renderExaSearch(name, result, options, theme, args);
      if (name.startsWith("exa_agent_")) return renderExaAgent(name, result, options, theme, args);
      return renderGeneric(name, result, options, theme, args);
    },
  };
}
