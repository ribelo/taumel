import { structuredPatch } from "diff";
import {
  emptyComponent,
  renderBlock,
  withLeftGutter,
  type Block,
  type Entry,
  type HeaderSpec,
} from "./render-layout.ts";
import {
  boolFieldOrUndefined,
  isRecord,
  numberFieldOrUndefined,
  recordArrayFieldOrEmpty,
  recordFieldOrUndefined,
  stringArrayFieldOrEmpty,
  stringFieldOrUndefined,
} from "./util.ts";

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

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers
// ─────────────────────────────────────────────────────────────────────────────

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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
// Width-aware layout engine.
//
// Every renderer returns a Component { render(width), invalidate() } built by
// renderBlock, instead of a pre-wrapped Text. The real viewport width arrives
// at render() time, so the header can be clipped to one physical line and the
// body can clip (collapsed) or wrap (expanded) against it. All width math uses
// pi-tui's ANSI-aware primitives (visibleWidth / truncateToWidth /
// wrapTextWithAnsi), so theme color codes never corrupt measurements.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Grammar primitives
// ─────────────────────────────────────────────────────────────────────────────

function dot(theme: unknown, color: string): string {
  return themeFg(theme, color, "•");
}

function headerSpec(name: string, subject: string, dotColor: string, theme: unknown, trailing = ""): HeaderSpec {
  const lead = `${dot(theme, dotColor)} ${themeFg(theme, "toolTitle", name)} ${themeFg(theme, "dim", "·")} `;
  return { lead, subject, trailing };
}

function moreLine(count: number, theme: unknown, unit: "more" | "more lines"): string {
  return themeFg(theme, "dim", `… ${count} ${unit}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// State → dot color
// ─────────────────────────────────────────────────────────────────────────────

function dotFromDetails(details: Record<string, unknown>): string {
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");
  if (code !== undefined) return code === 0 ? "success" : "error";
  if (boolFieldOrUndefined(details, "ok") === false) return "error";
  return "success";
}

// ─────────────────────────────────────────────────────────────────────────────
// Subjects (one-line identity of the call), derived from args
// ─────────────────────────────────────────────────────────────────────────────

function quotedQuery(args: Record<string, unknown>): string {
  return `"${oneLine(stringFieldOrUndefined(args, "query") ?? "")}"`;
}

function subjectFromArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "exec_command":
      return oneLine(stringFieldOrUndefined(args, "cmd") ?? "exec_command");
    case "write_stdin": {
      const chars = stringFieldOrUndefined(args, "chars") ?? "";
      if (chars.trim() !== "") return oneLine(chars);
      const sid = numberFieldOrUndefined(args, "session_id");
      return sid === undefined ? "poll" : `poll session ${sid}`;
    }
    case "write":
    case "edit":
    case "read":
      return stringFieldOrUndefined(args, "path") ?? "";
    case "apply_patch":
      return oneLine(stringFieldOrUndefined(args, "input") ?? stringFieldOrUndefined(args, "patch") ?? "patch");
    case "agent_spawn":
      return stringFieldOrUndefined(args, "profile") ?? "";
    case "agent_send":
      return stringFieldOrUndefined(args, "agent_id") ?? "";
    case "agent_wait": {
      const agentIds = Array.isArray(args["agent_ids"]) ? args["agent_ids"].length : 0;
      const runIds = Array.isArray(args["run_ids"]) ? args["run_ids"].length : 0;
      const timeout = numberFieldOrUndefined(args, "timeout_seconds");
      const waitMode =
        timeout === undefined ? "until completion" :
        timeout === 0 ? "poll now" :
        `up to ${timeout}s`;
      const selector =
        runIds > 0 ? `${runIds} run${runIds === 1 ? "" : "s"}` :
        agentIds > 0 ? `${agentIds} agent${agentIds === 1 ? "" : "s"}` :
        "active runs";
      return `${selector} · ${waitMode}`;
    }
    case "agent_list":
      return args["include_closed"] === true ? "including closed" : "open agents";
    case "agent_close":
      return args["all"] === true ? "all" : `${Array.isArray(args["agent_ids"]) ? args["agent_ids"].length : 0} agent(s)`;
    case "agent_profiles":
      return "profiles";
    case "create_goal":
      return oneLine(stringFieldOrUndefined(args, "objective") ?? "");
    case "update_goal":
      return stringFieldOrUndefined(args, "status") ?? "";
    case "query_threads":
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return quotedQuery(args);
    case "read_thread": {
      const locator = recordFieldOrUndefined(args, "locator");
      const threadID = stringFieldOrUndefined(args, "threadID") ?? (locator !== undefined ? stringFieldOrUndefined(locator, "threadID") : undefined) ?? "";
      const mode = stringFieldOrUndefined(args, "mode") ?? "overview";
      return `${threadID} (${mode})`;
    }
    case "ralph_continue":
    case "ralph_finish":
      return stringFieldOrUndefined(args, "task_id") ?? "";
    case "crawling_exa": {
      const urls = Array.isArray(args["urls"]) ? args["urls"].length : 0;
      const ids = Array.isArray(args["ids"]) ? args["ids"].length : 0;
      return urls > 0 ? `${urls} url${urls === 1 ? "" : "s"}` : `${ids} id${ids === 1 ? "" : "s"}`;
    }
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return stringFieldOrUndefined(args, "id") ?? "";
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
  const context = expanded ? 3 : 2;
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
  const codeAt = (_marker: string, _oldLine: number, _newLine: number, raw: string): string => {
    const plain = raw.slice(1);
    return themeFg(theme, "toolOutput", plain);
  };
  const lines: string[] = [];
  const markers: string[] = [];
  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      if (raw[0] === "\\") continue; // "\ No newline at end of file" marker
      const marker = raw[0];
      const num = marker === "+" ? newLine : marker === "-" ? oldLine : newLine;
      const codeStr = codeAt(marker, oldLine, newLine, raw);
      if (marker === "+") newLine += 1;
      else if (marker === "-") oldLine += 1;
      else { oldLine += 1; newLine += 1; }
      const gutter = themeFg(theme, "dim", `  ${String(num).padStart(width)}`);
      const markColor = marker === "+" ? "toolDiffAdded" : marker === "-" ? "toolDiffRemoved" : "dim";
      const mark = themeFg(theme, markColor, marker);
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
// Per-tool spec builders → Block
// ─────────────────────────────────────────────────────────────────────────────

function tailEntries(text: string, expanded: boolean, theme: unknown, cap: number, expandedCap: number): Entry[] {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "") return [{ text: themeFg(theme, "dim", "(no output)") }];
  const all = cleaned.split(/\r?\n/);
  const limit = expanded ? expandedCap : cap;
  if (all.length <= limit) return all.map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
  const visible = all.slice(-limit);
  return [{ text: moreLine(all.length - limit, theme, "more lines"), exempt: true }, ...visible.map((line) => ({ text: themeFg(theme, "toolOutput", line) }))];
}

function headEntries(text: string, expanded: boolean, theme: unknown, cap: number, expandedCap: number): Entry[] {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "") return [{ text: themeFg(theme, "dim", "(no output)") }];
  const all = cleaned.split(/\r?\n/);
  const limit = expanded ? expandedCap : cap;
  if (all.length <= limit) return all.map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
  const visible = all.slice(0, limit);
  return [...all.slice(0, limit).map((line) => ({ text: themeFg(theme, "toolOutput", line) })), { text: moreLine(all.length - limit, theme, "more lines"), exempt: true }];
}

function fullTextEntries(text: string, theme: unknown): Entry[] {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "") return [];
  return cleaned.split(/\r?\n/).map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
}

function buildShell(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const subject = subjectFromArgs(name, args);
  const sid = numberFieldOrUndefined(details, "sessionId") ?? numberFieldOrUndefined(details, "session_id");
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");

  // Async session still running: yellow dot, `(session N)` in the subject, no body yet.
  if (name === "exec_command" && sid !== undefined && code === undefined) {
    return { header: headerSpec(name, subject, "warning", theme, themeFg(theme, "dim", `(session ${sid})`)), body: undefined };
  }

  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  const output = stringFieldOrUndefined(details, "output") ?? textContent(result);

  // write_stdin poll with no new output.
  if (name === "write_stdin") {
    const chars = stringFieldOrUndefined(args, "chars") ?? "";
    if (chars.trim() === "" && output.trim() === "") {
      return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(still running; no new output)"), exempt: true }] } };
    }
  }

  return { header, body: { mode: "rail", entries: tailEntries(output, expanded, theme, 5, 200) } };
}

function buildRead(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const total = numberFieldOrUndefined(details, "totalLines");
  const shown = numberFieldOrUndefined(details, "shownLines");
  const subject =
    total === undefined
      ? path
      : shown !== undefined && shown < total
        ? `${path} (${shown}/${total} lines)`
        : `${path} (${total} line${total === 1 ? "" : "s"})`;
  const header = headerSpec("read", subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };

  const rawText = textContent(result);
  const physical = rawText.trimEnd().split(/\r?\n/);
  const entries: Entry[] = physical.map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
  if (shown !== undefined && total !== undefined && shown < total) {
    entries.push({ text: moreLine(total - shown, theme, "more lines"), exempt: true });
  }
  if (entries.length === 0) return { header, body: undefined };
  return { header, body: { mode: "rail", entries } };
}

function buildWrite(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "displayPath") ?? stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const mode = stringFieldOrUndefined(details, "mode");
  const contents = stringFieldOrUndefined(details, "contents") ?? "";
  const lineCount = contents === "" ? 0 : contents.trimEnd().split(/\r?\n/).length;
  const trailing = themeFg(theme, "dim", mode === "append" ? `(append +${lineCount})` : `(${lineCount} line${lineCount === 1 ? "" : "s"})`);
  const header = headerSpec("write", path, dotFromDetails(details), theme, trailing);
  if (contents.trim() === "") return { header, body: undefined };
  const all = contents.trimEnd().split(/\r?\n/).map((line) => themeFg(theme, "toolOutput", line));
  const limit = expanded ? 120 : 3;
  const entries: Entry[] = all.slice(0, limit).map((text) => ({ text }));
  if (all.length > limit) entries.push({ text: moreLine(all.length - limit, theme, "more lines"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildEdit(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "displayPath") ?? stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const before = stringFieldOrUndefined(details, "before");
  const after = stringFieldOrUndefined(details, "after");
  if (before === undefined || after === undefined) {
    const editCount = numberFieldOrUndefined(details, "editCount");
    const summary = editCount !== undefined ? `${editCount} replacement${editCount === 1 ? "" : "s"}` : "";
    return {
      header: headerSpec("edit", path, dotFromDetails(details), theme),
      body: summary === "" ? undefined : { mode: "rail", entries: [{ text: themeFg(theme, "dim", summary), exempt: true }] },
    };
  }
  const diff = renderDiff(before, after, expanded, theme);
  const header = headerSpec("edit", path, dotFromDetails(details), theme, themeFg(theme, "dim", `(+${diff.added} -${diff.removed})`));
  const entries: Entry[] = diff.lines.map((text) => ({ text }));
  // Collapsed: cap to ~6 changed lines; advertise the rest with an exempt hint.
  if (!expanded && diff.lines.length > 6) {
    return {
      header,
      body: {
        mode: "flush",
        clip: true,
        entries: [...diff.lines.slice(0, 6).map((text) => ({ text })), { text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true }],
      },
    };
  }
  return { header, body: { mode: "flush", clip: true, entries } };
}

function buildApplyPatch(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const writes = recordArrayFieldOrEmpty(details, "writes").map((write) => ({
    path: stringFieldOrUndefined(write, "path") ?? "",
    before: stringFieldOrUndefined(write, "before") ?? "",
    after: stringFieldOrUndefined(write, "contents") ?? stringFieldOrUndefined(write, "after") ?? "",
  }));
  const deletes = stringArrayFieldOrEmpty(details, "deletes");
  const dotColor = dotFromDetails(details);

  if (boolFieldOrUndefined(details, "ok") === false && writes.length === 0 && deletes.length === 0) {
    const errorText = textContent(result) || stringFieldOrUndefined(details, "error") || compactJson(details);
    const entries = expanded
      ? fullTextEntries(errorText, theme)
      : [{ text: themeFg(theme, "toolOutput", oneLine(errorText) || "apply_patch failed") }];
    return {
      header: headerSpec(name, subjectFromArgs(name, args), dotColor, theme),
      body: { mode: "rail", entries },
    };
  }

  if (writes.length === 0 && deletes.length === 0) {
    return { header: headerSpec(name, subjectFromArgs(name, args), dotColor, theme), body: undefined };
  }

  const perFile = writes.map((write) => {
    const { added, removed } = diffCounts(write.before, write.after);
    return { ...write, added, removed };
  });
  const totalAdded = perFile.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = perFile.reduce((sum, file) => sum + file.removed, 0);
  const fileCount = writes.length + deletes.length;
  const header = headerSpec(name, `${fileCount} file${fileCount === 1 ? "" : "s"}`, dotColor, theme, themeFg(theme, "dim", `(+${totalAdded} -${totalRemoved})`));

  if (!expanded) {
    if (writes.length === 1 && deletes.length === 0) {
      const file = perFile[0];
      const diff = renderDiff(file.before, file.after, false, theme);
      const singleHeader = headerSpec(name, file.path, dotColor, theme, themeFg(theme, "dim", `(+${diff.added} -${diff.removed})`));
      const entries: Entry[] = diff.lines.map((text) => ({ text }));
      if (diff.lines.length > 6) {
        return {
          header: singleHeader,
          body: {
            mode: "flush",
            clip: true,
            entries: [...diff.lines.slice(0, 6).map((text) => ({ text })), { text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true }],
          },
        };
      }
      return { header: singleHeader, body: { mode: "flush", clip: true, entries } };
    }

    const entries: Entry[] = [
      ...perFile.map((file) => ({ text: `${themeFg(theme, "toolTitle", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}` })),
      ...deletes.map((path) => ({ text: `${themeFg(theme, "toolTitle", path)} ${themeFg(theme, "dim", "(deleted)")}` })),
      { text: themeFg(theme, "dim", "… expand for full diff"), exempt: true },
    ];
    return { header, body: { mode: "rail", entries } };
  }

  const entries: Entry[] = [];
  for (const file of perFile) {
    entries.push({ text: `${themeFg(theme, "toolTitle", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}` });
    const diff = renderDiff(file.before, file.after, true, theme);
    entries.push(...diff.lines.map((text) => ({ text })));
  }
  for (const path of deletes) {
    entries.push({ text: `${themeFg(theme, "toolTitle", path)} ${themeFg(theme, "dim", "(deleted)")}` });
  }
  return { header, body: { mode: "flush", clip: true, entries } };
}

function buildGoal(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const goal = recordFieldOrUndefined(details, "goal");
  const accountingPending = details["accountingPending"] === true;
  const subject = goal !== undefined ? stringFieldOrUndefined(goal, "objective") ?? subjectFromArgs(name, args) : subjectFromArgs(name, args);
  const header = headerSpec(name, oneLine(subject), dotFromDetails(details), theme);
  const entries: Entry[] = [];
  if (goal !== undefined) {
    const facts = [
      stringFieldOrUndefined(goal, "status"),
      accountingPending ? "final accounting pending" : undefined,
      !accountingPending && numberFieldOrUndefined(goal, "tokensUsed") !== undefined ? `${numberFieldOrUndefined(goal, "tokensUsed")} tokens` : undefined,
      !accountingPending && numberFieldOrUndefined(goal, "timeUsedSeconds") !== undefined ? `${numberFieldOrUndefined(goal, "timeUsedSeconds")}s` : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function listItemTitle(item: Record<string, unknown>, fallback: string): string {
  return stringFieldOrUndefined(item, "title") ?? stringFieldOrUndefined(item, "id") ?? stringFieldOrUndefined(item, "url") ?? fallback;
}

function resultDescription(item: Record<string, unknown>): string | undefined {
  const summary = stringFieldOrUndefined(item, "summary") ?? stringFieldOrUndefined(item, "text") ?? stringFieldOrUndefined(item, "content");
  if (summary !== undefined) return summary;
  const highlights = item["highlights"];
  if (Array.isArray(highlights)) return highlights.find((part): part is string => typeof part === "string");
  return undefined;
}

function collectionMeta(item: Record<string, unknown>): string {
  const parts: string[] = [];
  const url = stringFieldOrUndefined(item, "url");
  if (url !== undefined) parts.push(domainOf(url));
  const count = numberFieldOrUndefined(item, "messageCount") ?? numberFieldOrUndefined(item, "message_count");
  if (count !== undefined) parts.push(`${count} msgs`);
  const status = stringFieldOrUndefined(item, "status");
  if (status !== undefined) parts.push(status);
  const lifecycle = stringFieldOrUndefined(item, "lifecycle");
  if (lifecycle !== undefined) parts.push(lifecycle);
  const sandbox = stringFieldOrUndefined(item, "sandbox");
  if (sandbox !== undefined) parts.push(sandbox);
  return parts.join(" · ");
}

function collectionEntries(items: Record<string, unknown>[], expanded: boolean, theme: unknown): Entry[] {
  const sep = ` ${themeFg(theme, "dim", "·")} `;
  const entries: Entry[] = [];
  items.forEach((item, index) => {
    const title = listItemTitle(item, `item ${index + 1}`);
    let line = `${themeFg(theme, "accent", String(index + 1))}${sep}${themeFg(theme, "toolOutput", title)}`;
    const meta = collectionMeta(item);
    if (meta !== "") line += `${sep}${themeFg(theme, "dim", meta)}`;
    entries.push({ text: line });
    if (expanded) {
      const description = resultDescription(item);
      if (description !== undefined && description.trim() !== "") {
        entries.push({ text: themeFg(theme, "dim", oneLine(description)) });
      }
    }
  });
  return entries;
}

function buildCollection(name: string, details: Record<string, unknown>, options: unknown, theme: unknown, baseSubject: string, items: Record<string, unknown>[]): Block {
  const expanded = expandedFromOptions(options);
  const header = headerSpec(name, baseSubject, dotFromDetails(details), theme, themeFg(theme, "dim", `(${items.length} result${items.length === 1 ? "" : "s"})`));
  if (items.length === 0) {
    return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(none)"), exempt: true }] } };
  }
  const limit = expanded ? 30 : 3;
  const entries = collectionEntries(items.slice(0, limit), expanded, theme);
  if (items.length > limit) entries.push({ text: moreLine(items.length - limit, theme, "more"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function hitCount(threads: Record<string, unknown>[]): number {
  return threads.reduce((total, thread) => total + recordArrayFieldOrEmpty(thread, "hits").length, 0);
}

function buildQueryThreads(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const threads = recordArrayFieldOrEmpty(details, "threads");
  const hits = hitCount(threads);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme, themeFg(theme, "dim", `(${threads.length} thread${threads.length === 1 ? "" : "s"}, ${hits} hit${hits === 1 ? "" : "s"})`));
  if (threads.length === 0) {
    return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(none)"), exempt: true }] } };
  }
  const sep = ` ${themeFg(theme, "dim", "·")} `;
  const limit = expanded ? 30 : 3;
  const entries: Entry[] = [];
  threads.slice(0, limit).forEach((thread, index) => {
    const title = stringFieldOrUndefined(thread, "title") ?? stringFieldOrUndefined(thread, "id") ?? `thread ${index + 1}`;
    const id = stringFieldOrUndefined(thread, "id") ?? "";
    const workspace = stringFieldOrUndefined(thread, "workspace");
    const threadHits = recordArrayFieldOrEmpty(thread, "hits");
    const meta = [
      id,
      workspace,
      `${threadHits.length} hit${threadHits.length === 1 ? "" : "s"}`,
    ].filter((part): part is string => part !== undefined && part !== "");
    entries.push({
      text: `${themeFg(theme, "accent", String(index + 1))}${sep}${themeFg(theme, "toolOutput", title)}${sep}${themeFg(theme, "dim", meta.join(" · "))}`,
    });
    if (expanded) {
      for (const hit of threadHits) {
        const kind = stringFieldOrUndefined(hit, "kind") ?? "";
        const role = stringFieldOrUndefined(hit, "role");
        const tool = stringFieldOrUndefined(hit, "toolName");
        const snippet = stringFieldOrUndefined(hit, "snippet") ?? "";
        const label = [kind, role, tool].filter((part): part is string => part !== undefined && part !== "").join("/");
        entries.push({ text: themeFg(theme, "dim", `${label}: ${oneLine(snippet)}`) });
      }
    }
  });
  if (threads.length > limit) entries.push({ text: moreLine(threads.length - limit, theme, "more"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildReadThread(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const thread = recordFieldOrUndefined(details, "thread");
  const mode = stringFieldOrUndefined(details, "mode") ?? stringFieldOrUndefined(args, "mode") ?? "overview";
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const entries: Entry[] = [];
  if (thread !== undefined) {
    const facts = [
      stringFieldOrUndefined(thread, "title"),
      mode,
      (numberFieldOrUndefined(thread, "messageCount") ?? numberFieldOrUndefined(thread, "message_count")) !== undefined
        ? `${numberFieldOrUndefined(thread, "messageCount") ?? numberFieldOrUndefined(thread, "message_count")} msgs`
        : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  if (!expanded) {
    const diagnostics = recordArrayFieldOrEmpty(details, "diagnostics");
    const cursor = stringFieldOrUndefined(details, "cursor");
    const facts = [
      diagnostics.length > 0 ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}` : undefined,
      cursor !== undefined ? "more available" : undefined,
    ].filter((part): part is string => part !== undefined);
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  if (name === "agent_spawn") return buildAgentSpawn(name, result, expanded, theme, args);
  if (name === "agent_wait") return buildAgentWait(name, result, expanded, theme, args);
  const workers = recordArrayFieldOrEmpty(details, "workers");
  const profiles = recordArrayFieldOrEmpty(details, "profiles");
  if (workers.length > 0) return buildCollection(name, details, options, theme, subjectFromArgs(name, args), workers);
  if (profiles.length > 0) return buildCollection(name, details, options, theme, subjectFromArgs(name, args), profiles);

  const worker = recordFieldOrUndefined(details, "worker");
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const entries: Entry[] = [];
  if (worker !== undefined) {
    const id = stringFieldOrUndefined(worker, "id");
    const lifecycle = stringFieldOrUndefined(worker, "lifecycle");
    const facts = [id !== undefined ? `run ${id}` : undefined, lifecycle].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildAgentSpawn(
  name: string,
  result: unknown,
  expanded: boolean,
  theme: unknown,
  args: Record<string, unknown>,
): Block {
  const details = detailsRecord(result);
  const worker = recordFieldOrUndefined(details, "worker");
  const profile = stringFieldOrUndefined(details, "profile") ?? stringFieldOrUndefined(args, "profile") ?? "";
  const agentId = stringFieldOrUndefined(details, "agent_id") ?? stringFieldOrUndefined(details, "workerId") ?? stringFieldOrUndefined(worker ?? {}, "id") ?? "";
  const runId = stringFieldOrUndefined(details, "run_id") ?? "";
  const status = stringFieldOrUndefined(details, "status") ?? stringFieldOrUndefined(worker ?? {}, "lifecycle") ?? "";
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const facts = [agentId !== "" ? `run ${agentId}` : undefined, status].filter((part): part is string => part !== undefined && part !== "");
  const entries: Entry[] = [];
  if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  if (expanded) {
    const message = stringFieldOrUndefined(args, "message") ?? stringFieldOrUndefined(args, "objective") ?? stringFieldOrUndefined(result as Record<string, unknown>, "prompt") ?? "";
    const messageLabel = args["create_goal"] === true ? "Objective sent" : "Message sent";
    for (const line of [
      `Profile: ${profile}`,
      `Agent id: ${agentId}`,
      `Run id: ${runId}`,
      `Status: ${status}`,
      "",
      `${messageLabel}:`,
      message,
    ]) {
      entries.push({ text: themeFg(theme, line.endsWith(":") ? "dim" : "toolOutput", line) });
    }
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function waitRunHeader(run: Record<string, unknown>, single: boolean): string {
  const agentId = stringFieldOrUndefined(run, "agent_id") ?? "";
  const runId = stringFieldOrUndefined(run, "run_id") ?? "";
  const status = stringFieldOrUndefined(run, "status") ?? "";
  if (single) return `${agentId}${agentId === "" ? "" : " "}${status}`.trim();
  return [agentId, runId, status].filter((part) => part !== "").join(" · ");
}

function buildAgentWait(
  name: string,
  result: unknown,
  expanded: boolean,
  theme: unknown,
  args: Record<string, unknown>,
): Block {
  const details = detailsRecord(result);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const runs = recordArrayFieldOrEmpty(details, "runs");
  if (!expanded) return { header, body: undefined };
  if (runs.length === 0) {
    return {
      header,
      body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(none)"), exempt: true }] },
    };
  }
  const entries: Entry[] = [];
  runs.forEach((run, index) => {
    if (index > 0) entries.push({ text: "" });
    entries.push({ text: themeFg(theme, "dim", waitRunHeader(run, runs.length === 1)), exempt: true });
    const finalOutput = stringFieldOrUndefined(run, "finalOutput");
    const error = stringFieldOrUndefined(run, "error");
    const outputAvailable = boolFieldOrUndefined(run, "outputAvailable") !== false;
    const body =
      finalOutput !== undefined && finalOutput.trim() !== "" ? finalOutput :
      error !== undefined && error.trim() !== "" ? error :
      outputAvailable ? "" : "(output unavailable)";
    if (body === "") return;
    for (const line of body.split(/\r?\n/)) {
      entries.push({ text: themeFg(theme, "toolOutput", line) });
    }
  });
  return { header, body: { mode: "rail", entries } };
}

function buildRalph(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const taskId = stringFieldOrUndefined(details, "taskId") ?? subjectFromArgs(name, args);
  const header = headerSpec(name, taskId, dotFromDetails(details), theme);
  const facts = [
    numberFieldOrUndefined(details, "iteration") !== undefined ? `iteration ${numberFieldOrUndefined(details, "iteration")}` : undefined,
    stringFieldOrUndefined(details, "status"),
    boolFieldOrUndefined(details, "reflection") === true ? "reflection" : undefined,
  ].filter((part): part is string => part !== undefined && part !== "");
  const entries: Entry[] = [];
  if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildExaSearch(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordFieldOrUndefined(details, "response") ?? {};
  const results = recordArrayFieldOrEmpty(response, "results");
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme, themeFg(theme, "dim", `(${results.length} result${results.length === 1 ? "" : "s"})`));
  if (results.length === 0) {
    return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(none)"), exempt: true }] } };
  }
  const limit = expanded ? 10 : 3;
  const sep = ` ${themeFg(theme, "dim", "·")} `;
  const entries: Entry[] = [];
  results.slice(0, limit).forEach((item, index) => {
    const title = listItemTitle(item, `result ${index + 1}`);
    const url = stringFieldOrUndefined(item, "url") ?? "";
    const domain = domainOf(url);
    let line = `${themeFg(theme, "accent", String(index + 1))}${sep}${themeFg(theme, "toolOutput", title)}`;
    if (domain !== "") line += `${sep}${themeFg(theme, "dim", domain)}`;
    entries.push({ text: line });
    if (expanded) {
      if (url !== "") entries.push({ text: themeFg(theme, "dim", url) });
      const published = stringFieldOrUndefined(item, "publishedDate");
      if (published !== undefined) entries.push({ text: themeFg(theme, "dim", published) });
      const description = resultDescription(item);
      if (description !== undefined && description.trim() !== "") {
        entries.push({ text: themeFg(theme, "dim", oneLine(description)) });
      }
    }
  });
  if (results.length > limit) entries.push({ text: moreLine(results.length - limit, theme, "more"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildCodeContext(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordFieldOrUndefined(details, "response") ?? {};
  const text = stringFieldOrUndefined(response, "response") ?? textContent(result);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  return { header, body: { mode: "rail", entries: headEntries(text, expanded, theme, 5, 100000) } };
}

function buildExaAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordFieldOrUndefined(details, "response") ?? {};

  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    const data = recordArrayFieldOrEmpty(response, "data");
    const items = data.length > 0 ? data : recordArrayFieldOrEmpty(response, "results");
    return buildCollection(name, details, options, theme, subjectFromArgs(name, args), items);
  }
  if (name === "exa_agent_cancel_run") {
    return { header: headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme), body: undefined };
  }
  // create_run / get_run: single entity `<id> · <status>`, output.text full when expanded.
  const id = stringFieldOrUndefined(response, "id") ?? subjectFromArgs(name, args);
  const status = stringFieldOrUndefined(response, "status");
  const subject = status !== undefined ? `${id} · ${status}` : id;
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  const output = recordFieldOrUndefined(response, "output");
  const text = output !== undefined ? stringFieldOrUndefined(output, "text") ?? "" : stringFieldOrUndefined(response, "response") ?? "";
  const entries = expanded ? fullTextEntries(text, theme) : [];
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildGeneric(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const text = textContent(result);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const body = expanded ? (text === "" ? compactJson(details) : text) : text;
  return { header, body: { mode: "rail", entries: tailEntries(body, expanded, theme, 5, 200) } };
}

// ─────────────────────────────────────────────────────────────────────────────
// notification message renderer (subagent + exec completion availability)
// ─────────────────────────────────────────────────────────────────────────────

function attrValue(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match ? match[1] : undefined;
}

function parseSkillAttrs(rawAttrs: string): { name: string; location: string } | undefined {
  const name = attrValue(rawAttrs, /\bname="([^"]*)"/);
  const location = attrValue(rawAttrs, /\blocation="([^"]*)"/);
  return name !== undefined && location !== undefined ? { name, location } : undefined;
}

function parseSkillBlocks(content: string): { name: string; location: string; body: string }[] {
  const re = /<skill\b([^>]*)>\s*References are relative to [^\n]*\.\s*\n\n([\s\S]*?)\n<\/skill>/g;
  const blocks: { name: string; location: string; body: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const attrs = parseSkillAttrs(match[1]);
    if (attrs !== undefined) blocks.push({ ...attrs, body: match[2] });
  }
  const childTag = /<skill>\s*<name>([\s\S]*?)<\/name>\s*<path>([\s\S]*?)<\/path>\s*([\s\S]*?)\s*<\/skill>/g;
  while ((match = childTag.exec(content)) !== null) {
    const name = match[1].trim();
    const location = match[2].trim();
    const body = match[3].trim();
    if (name !== "" && location !== "" && body !== "") blocks.push({ name, location, body });
  }
  return blocks;
}

export function skillMessageRenderer() {
  return (message: unknown, options: unknown, theme: unknown) => {
    const content = isRecord(message) ? stringFieldOrUndefined(message, "content") ?? "" : "";
    const skills = parseSkillBlocks(content);
    if (skills.length === 0) return undefined;
    const expanded = expandedFromOptions(options);
    const skill = skills[0];
    const details = detailsRecord(message);
    const trigger = stringFieldOrUndefined(details, "trigger") ?? `$${skill.name}`;
    const provenance = `Skill "${skill.name}" was injected automatically by the harness because the user mentioned ${trigger}.`;
    return withLeftGutter(
      renderBlock(
        {
          header: {
            lead: themeFg(theme, "info", "• skill: "),
            subject: skill.name,
            trailing: themeFg(theme, "dim", expanded ? skill.location : `auto from ${trigger} (expand)`),
          },
          body: expanded
            ? { mode: "rail", entries: tailEntries(`${provenance}\n\n${skill.body}`, true, theme, 5, 100000) }
            : undefined,
        },
        expanded,
      ),
    );
  };
}

function buildNotificationBlock(message: unknown, options: unknown, theme: unknown): Block | undefined {
  const content = isRecord(message) ? stringFieldOrUndefined(message, "content") ?? "" : "";
  if (content === "") return undefined;
  const expanded = expandedFromOptions(options);
  const execMatch = /^Command session ([0-9]+) has finished\./.exec(content);
  const agentMatch = /^Agent run \S+ for (\S+) \(([^)]*)\) has finished\./.exec(content);
  const name = execMatch !== null ? "exec_completion" : agentMatch !== null ? "agent_completion" : "notification";
  const subject = execMatch !== null
    ? `session ${execMatch[1]} ready`
    : agentMatch !== null
    ? `${agentMatch[1]} (${agentMatch[2]}) ready`
    : "ready";

  return {
    header: headerSpec(name, subject, "info", theme),
    body: { mode: "rail", entries: tailEntries(content, expanded, theme, 6, 100000) },
  };
}

export function notificationMessageRenderer() {
  return (message: unknown, options: unknown, theme: unknown) => {
    const block = buildNotificationBlock(message, options, theme);
    return block === undefined ? undefined : withLeftGutter(renderBlock(block, expandedFromOptions(options)));
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory
// ─────────────────────────────────────────────────────────────────────────────

function progressText(name: string): string {
  if (name.startsWith("exa_") || name.endsWith("_exa")) return "waiting for Exa";
  if (name === "query_threads") return "searching threads";
  if (name === "read_thread") return "reading thread";
  if (name === "read") return "reading";
  if (name === "agent_wait") return "waiting";
  return "running";
}

function buildResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  if (name === "exec_command" || name === "write_stdin") return buildShell(name, result, options, theme, args);
  if (name === "read") return buildRead(name, result, options, theme, args);
  if (name === "write") return buildWrite(name, result, options, theme, args);
  if (name === "edit") return buildEdit(name, result, options, theme, args);
  if (name === "apply_patch") return buildApplyPatch(name, result, options, theme, args);
  if (name === "get_goal" || name === "create_goal" || name === "update_goal") return buildGoal(name, result, options, theme, args);
  if (name === "query_threads") return buildQueryThreads(name, result, options, theme, args);
  if (name === "read_thread") return buildReadThread(name, result, options, theme, args);
  if (name.startsWith("agent_")) return buildAgent(name, result, options, theme, args);
  if (name === "ralph_continue" || name === "ralph_finish") return buildRalph(name, result, options, theme, args);
  if (name === "get_code_context_exa") return buildCodeContext(name, result, options, theme, args);
  if (name === "web_search_exa" || name === "crawling_exa") return buildExaSearch(name, result, options, theme, args);
  if (name.startsWith("exa_agent_")) return buildExaAgent(name, result, options, theme, args);
  return buildGeneric(name, result, options, theme, args);
}

export function renderersForTool(name: string) {
  return {
    renderCall(args: unknown, theme: unknown, context: unknown) {
      if (isRecord(context) && context["isPartial"] === false) return emptyComponent();
      const callArgs = isRecord(args) ? args : {};
      // In-flight call: yellow dot header + dim (progress), header-only, clipped to one line.
      const header = headerSpec(name, subjectFromArgs(name, callArgs), "warning", theme, themeFg(theme, "dim", `(${progressText(name)})`));
      return renderBlock({ header, body: undefined }, false);
    },
    renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
      const expanded = expandedFromOptions(options);
      if (isRecord(options) && options["isPartial"] === true) {
        const args = argsFromContext(context);
        const header = headerSpec(name, subjectFromArgs(name, args), "warning", theme, themeFg(theme, "dim", `(${progressText(name)})`));
        return renderBlock({ header, body: undefined }, false);
      }
      const args = argsFromContext(context);
      return renderBlock(buildResult(name, result, options, theme, args), expanded);
    },
  };
}
