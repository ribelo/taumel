import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { structuredPatch } from "diff";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";

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

// Syntax highlighting via pi's bundled cli-highlight (the same call pi's own
// read/write tools make). Synchronous, ANSI-colored, theme-aware at runtime.
// `highlightCode(code, lang)` returns an ANSI-colored string array, one per line;
// it no-ops (plain output) when the language is unknown. Returns plain lines on
// any failure so rendering never breaks.
function highlightLines(code: string, lang: string | undefined): string[] {
  if (!lang) return (code ?? "").split(/\r?\n/);
  try {
    const out = highlightCode(code, lang);
    return Array.isArray(out) ? out : (code ?? "").split(/\r?\n/);
  } catch {
    return (code ?? "").split(/\r?\n/);
  }
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

function langFromPath(path: string): string | undefined {
  return getLanguageFromPath(path);
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

// A header is `• <name> · <subject>[ <trailing>]`. `lead` is the fully-colored
// `• name · ` prefix; `subject` and `trailing` are separately colored. The
// subject-start column is visibleWidth(lead).
type HeaderSpec = { readonly lead: string; readonly subject: string; readonly trailing: string };

// A body is either a └-railed block or a flush (self-guttered) block.
//   rail  — first physical line prefixed `  └ `, continuation `    ` (4 spaces).
//            normal entries: collapsed clips each line to (width-4), expanded
//            wraps to (width-4) with continuation at column 4.
//            exempt entries (the `… N more` / expand hints): rendered as-is,
//            never clipped — never clip a line whose job is to advertise hidden
//            content.
//   flush — self-guttered lines (diffs, apply_patch expanded). no └ rail. each
//            line clipped to width when clip is set (diffs always clip in both
//            modes; they are a structured grid, not a document).
type Entry = { readonly text: string; readonly exempt?: boolean };
type Body =
  | { readonly mode: "rail"; readonly entries: readonly Entry[] }
  | { readonly mode: "flush"; readonly entries: readonly Entry[]; readonly clip: boolean };

const RAIL_FIRST = "  └ ";
const RAIL_CONT = "    ";
const ELLIPSIS = "…";

type Block = { readonly header: HeaderSpec; readonly body: Body | undefined };

function layoutHeader(header: HeaderSpec, expanded: boolean, width: number): string[] {
  const full =
    header.subject === ""
      ? header.lead + header.trailing
      : header.lead + header.subject + (header.trailing === "" ? "" : " " + header.trailing);
  // Collapsed: always exactly one line, clipped to width.
  // Expanded: one line if it fits, else wrap the subject under a hanging indent
  // aligned to the subject-start column.
  if (!expanded || visibleWidth(full) <= width) {
    return [truncateToWidth(full, width, ELLIPSIS)];
  }
  const subjectStart = visibleWidth(header.lead);
  const avail = Math.max(1, width - subjectStart);
  const indent = " ".repeat(subjectStart);
  const wrapped = wrapTextWithAnsi(header.subject, avail);
  const lines = [header.lead + wrapped[0]];
  for (let index = 1; index < wrapped.length; index += 1) {
    lines.push(indent + wrapped[index]);
  }
  if (header.trailing !== "") {
    lines[lines.length - 1] = lines[lines.length - 1] + " " + header.trailing;
  }
  return lines;
}

function railEntryPhysical(entry: Entry, expanded: boolean, contentWidth: number): string[] {
  if (entry.exempt) return [entry.text];
  if (expanded) return wrapTextWithAnsi(entry.text, contentWidth);
  return entry.text.split(/\r?\n/).map((line) => truncateToWidth(line, contentWidth, ELLIPSIS));
}

function layoutRail(entries: readonly Entry[], expanded: boolean, width: number): string[] {
  const contentWidth = Math.max(1, width - visibleWidth(RAIL_FIRST));
  const physical = entries.flatMap((entry) => railEntryPhysical(entry, expanded, contentWidth));
  return physical.map((line, index) => (index === 0 ? RAIL_FIRST + line : RAIL_CONT + line));
}

function layoutFlush(entries: readonly Entry[], clip: boolean, width: number): string[] {
  return entries.flatMap((entry) => {
    if (entry.exempt || !clip) return [entry.text];
    return entry.text.split(/\r?\n/).map((line) => truncateToWidth(line, width, ELLIPSIS));
  });
}

function renderBlock(block: Block, expanded: boolean): { render(width: number): string[]; invalidate(): void } {
  let cache: { width: number; lines: string[] } | undefined;
  return {
    render(width: number): string[] {
      if (cache !== undefined && cache.width === width) return cache.lines;
      const lines = layoutHeader(block.header, expanded, width);
      if (block.body !== undefined) {
        if (block.body.mode === "rail") {
          lines.push(...layoutRail(block.body.entries, expanded, width));
        } else {
          lines.push(...layoutFlush(block.body.entries, block.body.clip, width));
        }
      }
      cache = { width, lines };
      return lines;
    },
    invalidate() {
      cache = undefined;
    },
  };
}

function emptyComponent(): { render(_width: number): string[]; invalidate(): void } {
  return {
    render(_width: number): string[] {
      return [];
    },
    invalidate() {},
  };
}

function withLeftGutter(component: { render(width: number): string[]; invalidate(): void }): { render(width: number): string[]; invalidate(): void } {
  return {
    render(width: number): string[] {
      return component.render(Math.max(1, width - 1)).map((line) => ` ${line}`);
    },
    invalidate() {
      component.invalidate();
    },
  };
}

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
  const code = numberField(details, "exitCode") ?? numberField(details, "code");
  if (code !== undefined) return code === 0 ? "success" : "error";
  if (boolField(details, "ok") === false) return "error";
  return "success";
}

// ─────────────────────────────────────────────────────────────────────────────
// Subjects (one-line identity of the call), derived from args
// ─────────────────────────────────────────────────────────────────────────────

function quotedQuery(args: Record<string, unknown>): string {
  return `"${oneLine(stringField(args, "query") ?? "")}"`;
}

function subjectFromArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "exec_command":
      return oneLine(stringField(args, "cmd") ?? "exec_command");
    case "write_stdin": {
      const chars = stringField(args, "chars") ?? "";
      if (chars.trim() !== "") return oneLine(chars);
      const sid = numberField(args, "session_id");
      return sid === undefined ? "poll" : `poll session ${sid}`;
    }
    case "write":
    case "edit":
    case "read":
      return stringField(args, "path") ?? "";
    case "apply_patch":
      return oneLine(stringField(args, "input") ?? stringField(args, "patch") ?? "patch");
    case "agent_spawn":
      return stringField(args, "profile") ?? "";
    case "agent_send":
      return stringField(args, "agent_id") ?? "";
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
      return oneLine(stringField(args, "objective") ?? "");
    case "update_goal":
      return stringField(args, "status") ?? "";
    case "find_thread":
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return quotedQuery(args);
    case "read_thread":
      return stringField(args, "threadID") ?? "";
    case "ralph_continue":
    case "ralph_finish":
      return stringField(args, "task_id") ?? "";
    case "crawling_exa": {
      const urls = Array.isArray(args["urls"]) ? args["urls"].length : 0;
      const ids = Array.isArray(args["ids"]) ? args["ids"].length : 0;
      return urls > 0 ? `${urls} url${urls === 1 ? "" : "s"}` : `${ids} id${ids === 1 ? "" : "s"}`;
    }
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return stringField(args, "id") ?? "";
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

function renderDiff(before: string, after: string, expanded: boolean, theme: unknown, lang: string | undefined = undefined): DiffRender {
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
  // Highlight the full before/after once so multi-line tokens (strings, block
  // comments) tokenize correctly; each diff line pulls its own highlighted copy
  // by line number. `+` and context lines come from `after`; `-` from `before`.
  const highlightedAfter = lang !== undefined ? highlightLines(after ?? "", lang) : undefined;
  const highlightedBefore = lang !== undefined ? highlightLines(before ?? "", lang) : undefined;
  const codeAt = (marker: string, oldLine: number, newLine: number, raw: string): string => {
    const plain = raw.slice(1);
    if (marker === "-") {
      const hl = highlightedBefore?.[oldLine - 1];
      return hl ?? themeFg(theme, "toolOutput", plain);
    }
    const hl = highlightedAfter?.[newLine - 1];
    return hl ?? themeFg(theme, "toolOutput", plain);
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
  const sid = numberField(details, "sessionId") ?? numberField(details, "session_id");
  const code = numberField(details, "exitCode") ?? numberField(details, "code");

  // Async session still running: yellow dot, `(session N)` in the subject, no body yet.
  if (name === "exec_command" && sid !== undefined && code === undefined) {
    return { header: headerSpec(name, subject, "warning", theme, themeFg(theme, "dim", `(session ${sid})`)), body: undefined };
  }

  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  const output = stringField(details, "output") ?? textContent(result);

  // write_stdin poll with no new output.
  if (name === "write_stdin") {
    const chars = stringField(args, "chars") ?? "";
    if (chars.trim() === "" && output.trim() === "") {
      return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(still running; no new output)"), exempt: true }] } };
    }
  }

  return { header, body: { mode: "rail", entries: tailEntries(output, expanded, theme, 5, 200) } };
}

function buildRead(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
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
  const header = headerSpec("read", subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };

  const rawText = textContent(result);
  const lang = langFromPath(path);
  const highlighted = lang !== undefined ? highlightLines(rawText, lang) : undefined;
  const physical = (highlighted ?? rawText.trimEnd().split(/\r?\n/));
  const entries: Entry[] = (highlighted ?? physical.map((line) => themeFg(theme, "toolOutput", line))).map((text) => ({ text }));
  if (shown !== undefined && total !== undefined && shown < total) {
    entries.push({ text: moreLine(total - shown, theme, "more lines"), exempt: true });
  }
  if (entries.length === 0) return { header, body: undefined };
  return { header, body: { mode: "rail", entries } };
}

function buildWrite(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringField(details, "displayPath") ?? stringField(details, "path") ?? stringField(args, "path") ?? "";
  const mode = stringField(details, "mode");
  const contents = stringField(details, "contents") ?? "";
  const lineCount = contents === "" ? 0 : contents.trimEnd().split(/\r?\n/).length;
  const trailing = themeFg(theme, "dim", mode === "append" ? `(append +${lineCount})` : `(${lineCount} line${lineCount === 1 ? "" : "s"})`);
  const header = headerSpec("write", path, dotFromDetails(details), theme, trailing);
  if (contents.trim() === "") return { header, body: undefined };
  const lang = langFromPath(path);
  const all = lang !== undefined ? highlightLines(contents, lang) : contents.trimEnd().split(/\r?\n/).map((line) => themeFg(theme, "toolOutput", line));
  const limit = expanded ? 120 : 3;
  const entries: Entry[] = all.slice(0, limit).map((text) => ({ text }));
  if (all.length > limit) entries.push({ text: moreLine(all.length - limit, theme, "more lines"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildEdit(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringField(details, "displayPath") ?? stringField(details, "path") ?? stringField(args, "path") ?? "";
  const before = stringField(details, "before");
  const after = stringField(details, "after");
  if (before === undefined || after === undefined) {
    const editCount = numberField(details, "editCount");
    const summary = editCount !== undefined ? `${editCount} replacement${editCount === 1 ? "" : "s"}` : "";
    return {
      header: headerSpec("edit", path, dotFromDetails(details), theme),
      body: summary === "" ? undefined : { mode: "rail", entries: [{ text: themeFg(theme, "dim", summary), exempt: true }] },
    };
  }
  const diff = renderDiff(before, after, expanded, theme, langFromPath(path));
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
  const writes = recordArrayField(details, "writes").map((write) => ({
    path: stringField(write, "path") ?? "",
    before: stringField(write, "before") ?? "",
    after: stringField(write, "contents") ?? stringField(write, "after") ?? "",
  }));
  const deletes = stringArrayField(details, "deletes");
  const dotColor = dotFromDetails(details);

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
      const diff = renderDiff(file.before, file.after, false, theme, langFromPath(file.path));
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
    const diff = renderDiff(file.before, file.after, true, theme, langFromPath(file.path));
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
  const goal = recordField(details, "goal");
  const subject = goal !== undefined ? stringField(goal, "objective") ?? subjectFromArgs(name, args) : subjectFromArgs(name, args);
  const header = headerSpec(name, oneLine(subject), dotFromDetails(details), theme);
  const entries: Entry[] = [];
  if (goal !== undefined) {
    const facts = [
      stringField(goal, "status"),
      numberField(goal, "tokensUsed") !== undefined ? `${numberField(goal, "tokensUsed")} tokens` : undefined,
      numberField(goal, "timeUsedSeconds") !== undefined ? `${numberField(goal, "timeUsedSeconds")}s` : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
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

function buildFindThread(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const details = detailsRecord(result);
  return buildCollection(name, details, options, theme, subjectFromArgs(name, args), recordArrayField(details, "threads"));
}

function buildReadThread(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const thread = recordField(details, "thread");
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const entries: Entry[] = [];
  if (thread !== undefined) {
    const facts = [
      stringField(thread, "title"),
      (numberField(thread, "messageCount") ?? numberField(thread, "message_count")) !== undefined
        ? `${numberField(thread, "messageCount") ?? numberField(thread, "message_count")} msgs`
        : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const workers = recordArrayField(details, "workers");
  const profiles = recordArrayField(details, "profiles");
  if (workers.length > 0) return buildCollection(name, details, options, theme, subjectFromArgs(name, args), workers);
  if (profiles.length > 0) return buildCollection(name, details, options, theme, subjectFromArgs(name, args), profiles);

  const worker = recordField(details, "worker");
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const entries: Entry[] = [];
  if (worker !== undefined) {
    const id = stringField(worker, "id");
    const lifecycle = stringField(worker, "lifecycle");
    const facts = [id !== undefined ? `run ${id}` : undefined, lifecycle].filter((part): part is string => part !== undefined && part !== "");
    if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  }
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildRalph(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const taskId = stringField(details, "taskId") ?? subjectFromArgs(name, args);
  const header = headerSpec(name, taskId, dotFromDetails(details), theme);
  const facts = [
    numberField(details, "iteration") !== undefined ? `iteration ${numberField(details, "iteration")}` : undefined,
    stringField(details, "status"),
    boolField(details, "reflection") === true ? "reflection" : undefined,
  ].filter((part): part is string => part !== undefined && part !== "");
  const entries: Entry[] = [];
  if (facts.length > 0) entries.push({ text: themeFg(theme, "dim", facts.join(" · ")), exempt: true });
  if (expanded) entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildExaSearch(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordField(details, "response") ?? {};
  const results = recordArrayField(response, "results");
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme, themeFg(theme, "dim", `(${results.length} result${results.length === 1 ? "" : "s"})`));
  if (results.length === 0) {
    return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(none)"), exempt: true }] } };
  }
  const limit = expanded ? 10 : 3;
  const sep = ` ${themeFg(theme, "dim", "·")} `;
  const entries: Entry[] = [];
  results.slice(0, limit).forEach((item, index) => {
    const title = listItemTitle(item, `result ${index + 1}`);
    const url = stringField(item, "url") ?? "";
    const domain = domainOf(url);
    let line = `${themeFg(theme, "accent", String(index + 1))}${sep}${themeFg(theme, "toolOutput", title)}`;
    if (domain !== "") line += `${sep}${themeFg(theme, "dim", domain)}`;
    entries.push({ text: line });
    if (expanded) {
      if (url !== "") entries.push({ text: themeFg(theme, "dim", url) });
      const published = stringField(item, "publishedDate");
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
  const response = recordField(details, "response") ?? {};
  const text = stringField(response, "response") ?? textContent(result);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  return { header, body: { mode: "rail", entries: headEntries(text, expanded, theme, 5, 100000) } };
}

function buildExaAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordField(details, "response") ?? {};

  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    const data = recordArrayField(response, "data");
    const items = data.length > 0 ? data : recordArrayField(response, "results");
    return buildCollection(name, details, options, theme, subjectFromArgs(name, args), items);
  }
  if (name === "exa_agent_cancel_run") {
    return { header: headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme), body: undefined };
  }
  // create_run / get_run: single entity `<id> · <status>`, output.text full when expanded.
  const id = stringField(response, "id") ?? subjectFromArgs(name, args);
  const status = stringField(response, "status");
  const subject = status !== undefined ? `${id} · ${status}` : id;
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  const output = recordField(response, "output");
  const text = output !== undefined ? stringField(output, "text") ?? "" : stringField(response, "response") ?? "";
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

function parseSkillBlocks(content: string): { name: string; location: string; body: string }[] {
  const re = /<skill name="([^"]*)" location="([^"]*)">\nReferences are relative to [^\n]*\.\n\n([\s\S]*?)\n<\/skill>/g;
  const blocks: { name: string; location: string; body: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    blocks.push({ name: match[1], location: match[2], body: match[3] });
  }
  return blocks;
}

export function skillMessageRenderer() {
  return (message: unknown, options: unknown, theme: unknown) => {
    const content = isRecord(message) ? stringField(message, "content") ?? "" : "";
    const skills = parseSkillBlocks(content);
    if (skills.length === 0) return undefined;
    const expanded = expandedFromOptions(options);
    const components = skills.map((skill) =>
      withLeftGutter(
        renderBlock({
          header: headerSpec("skill", skill.name, "info", theme, themeFg(theme, "dim", skill.location)),
          body: { mode: "rail", entries: tailEntries(skill.body, expanded, theme, 5, 100000) },
        }, expanded),
      ),
    );
    return {
      render(width: number): string[] {
        const lines: string[] = [];
        components.forEach((component, index) => {
          if (index > 0) lines.push("");
          lines.push(...component.render(width));
        });
        return lines;
      },
      invalidate(): void {
        for (const component of components) component.invalidate();
      },
    };
  };
}

function buildNotificationBlock(message: unknown, options: unknown, theme: unknown): Block | undefined {
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
    return {
      header: headerSpec("exec_completion", subject, dotColor, theme),
      body: { mode: "rail", entries: tailEntries(blockBetween(content, "output"), expanded, theme, 5, 100000) },
    };
  }

  if (kind === "agent_completion") {
    const agentId = attrValue(content, /<agent id="([^"]*)"/);
    const profile = attrValue(content, /profile="([^"]*)"/);
    const runStatus = attrValue(content, /<run id="[^"]*" status="([^"]*)"/) ?? "completed";
    const dotColor = runStatus === "completed" || runStatus === "succeeded" ? "success" : "error";
    const subject = [agentId, profile !== undefined ? `(${profile})` : undefined].filter(Boolean).join(" ");
    const finalOutput = blockBetween(content, "final_output");
    const text = finalOutput !== "" ? finalOutput : blockBetween(content, "error");
    return {
      header: headerSpec("agent_completion", subject, dotColor, theme),
      body: { mode: "rail", entries: tailEntries(text, expanded, theme, 5, 100000) },
    };
  }

  return {
    header: { lead: "", subject: "", trailing: "" },
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
  if (name === "find_thread") return "searching threads";
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
  if (name === "find_thread") return buildFindThread(name, result, options, theme, args);
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
