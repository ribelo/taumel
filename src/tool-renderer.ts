import { structuredPatch } from "diff";
import { parseSkillBlock, SkillInvocationMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  emptyComponent,
  renderBlock,
  withLeftGutter,
  type Block,
  type Entry,
  type HeaderSpec,
} from "./render-layout.ts";
import { buildDomainResult } from "./tool-renderer-domains.ts";
import {
  detailsRecord, dotFromDetails, expandedFromOptions, fullTextEntries, headerSpec,
  isToolRenderFields, oneLine, quotedQuery, textContent, themeFg, type ToolRenderFields,
} from "./tool-renderer-kit.ts";
export { fullTextEntries } from "./tool-renderer-kit.ts";
import {
  boolFieldOrUndefined,
  numberFieldOrUndefined,
  recordArrayFieldOrEmpty,
  recordFieldOrUndefined,
  stringArrayFieldOrEmpty,
  stringFieldOrUndefined,
} from "./util.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Theme helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers
// ─────────────────────────────────────────────────────────────────────────────

function sentCharsSubject(value: string): string {
  let escaped = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32) escaped += `^${String.fromCharCode(code + 64)}`;
    else if (code === 127) escaped += "^?";
    else escaped += char;
  }
  return oneLine(escaped) || JSON.stringify(value);
}

function argsFromContext(context: unknown): ToolRenderFields {
  return isToolRenderFields(context) && isToolRenderFields(context["args"]) ? context["args"] : {};
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

function pathHeaderSpec(name: string, subject: string, dotColor: string, theme: unknown, trailing = ""): HeaderSpec {
  return { ...headerSpec(name, subject, dotColor, theme, trailing), subjectClip: "middle" };
}

function moreLine(count: number, theme: unknown, unit: "more" | "more lines"): string {
  return themeFg(theme, "dim", `… ${count} ${unit}`);
}

function appendDiffLines(entries: Entry[], lines: readonly string[], limit = lines.length): void {
  for (let index = 0; index < Math.min(lines.length, limit); index += 1) {
    entries.push({ text: lines[index] });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State → dot color
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Subjects (one-line identity of the call), derived from args
// ─────────────────────────────────────────────────────────────────────────────

function subjectFromArgs(name: string, args: ToolRenderFields): string {
  switch (name) {
    case "exec_command":
      return oneLine(stringFieldOrUndefined(args, "cmd") ?? "exec_command");
    case "write_stdin": {
      const chars = stringFieldOrUndefined(args, "chars") ?? "";
      if (chars !== "") return sentCharsSubject(chars);
      const sid = numberFieldOrUndefined(args, "session_id");
      const verb = stringFieldOrUndefined(args, "output_mode") === "status" ? "wait" : "poll";
      return sid === undefined ? verb : `${verb} session ${sid}`;
    }
    case "write":
    case "edit":
    case "read":
    case "view_media":
      return stringFieldOrUndefined(args, "path") ?? "";
    case "apply_patch":
      return oneLine(stringFieldOrUndefined(args, "input") ?? stringFieldOrUndefined(args, "patch") ?? "patch");
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
      const locator = recordFieldOrUndefined<ToolRenderFields>(args, "locator");
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
  const codeAt = (marker: string, _oldLine: number, _newLine: number, raw: string): string => {
    const plain = raw.slice(1);
    if (marker === "+") return themeFg(theme, "toolDiffAdded", plain);
    if (marker === "-") return themeFg(theme, "toolDiffRemoved", plain);
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

function buildShell(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const subject = subjectFromArgs(name, args);
  const sid = numberFieldOrUndefined(details, "sessionId") ?? numberFieldOrUndefined(details, "session_id");
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");
  const outputMode = stringFieldOrUndefined(details, "outputMode") ?? stringFieldOrUndefined(args, "output_mode") ?? "delta";

  if (name === "write_stdin" && outputMode === "status") {
    const suppressedLines = numberFieldOrUndefined(details, "suppressedLines") ?? 0;
    const suppressedBytes = numberFieldOrUndefined(details, "suppressedBytes") ?? 0;
    const state = sid !== undefined ? "running" : code !== undefined ? `exit ${code}` : "completed";
    const trailing = themeFg(
      theme,
      "dim",
      `(${state}; suppressed ${suppressedLines} line${suppressedLines === 1 ? "" : "s"} / ${suppressedBytes} bytes)`,
    );
    return {
      header: headerSpec(name, subjectFromArgs(name, args), sid !== undefined ? "warning" : dotFromDetails(details), theme, trailing),
      body: undefined,
    };
  }

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

  return { header, body: { mode: "rail", entries: tailEntries(output, expanded, theme, 5, 100000) } };
}

function buildRead(result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const total = numberFieldOrUndefined(details, "totalLines");
  const shown = numberFieldOrUndefined(details, "shownLines");
  const lineFact =
    total === undefined
      ? ""
      : shown !== undefined && shown < total
        ? `(${shown}/${total} lines)`
        : `(${total} line${total === 1 ? "" : "s"})`;
  const header = pathHeaderSpec("read", path, dotFromDetails(details), theme, lineFact === "" ? "" : themeFg(theme, "dim", lineFact));
  if (!expanded) return { header, body: undefined };

  const rawText = textContent(result);
  const physical = rawText.trimEnd().split(/\r?\n/);
  const entries: Entry[] = physical.map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
  if (entries.length === 0) return { header, body: undefined };
  return { header, body: { mode: "rail", entries } };
}

function buildViewMedia(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const width = numberFieldOrUndefined(details, "width");
  const height = numberFieldOrUndefined(details, "height");
  const originalWidth = numberFieldOrUndefined(details, "originalWidth");
  const originalHeight = numberFieldOrUndefined(details, "originalHeight");
  const wasResized = boolFieldOrUndefined(details, "wasResized") === true;
  const dimensions =
    width === undefined || height === undefined
      ? ""
      : wasResized && originalWidth !== undefined && originalHeight !== undefined
        ? `(${originalWidth}x${originalHeight} -> ${width}x${height})`
        : `(${width}x${height})`;
  const header = pathHeaderSpec(name, path, dotFromDetails(details), theme, dimensions === "" ? "" : themeFg(theme, "dim", dimensions));
  if (!expanded) return { header, body: undefined };
  const mime = stringFieldOrUndefined(details, "mime") ?? stringFieldOrUndefined(details, "mimeType") ?? stringFieldOrUndefined(details, "type");
  const payloadBytes =
    numberFieldOrUndefined(details, "payloadBytes") ??
    numberFieldOrUndefined(details, "base64Bytes") ??
    numberFieldOrUndefined(details, "encodedBytes");
  const entries: Entry[] = [
    { text: `${themeFg(theme, "dim", "Path:")} ${themeFg(theme, "toolOutput", path)}` },
    ...(mime === undefined ? [] : [{ text: `${themeFg(theme, "dim", "Type:")} ${themeFg(theme, "toolOutput", mime)}` }]),
    ...(originalWidth !== undefined && originalHeight !== undefined ? [{ text: `${themeFg(theme, "dim", "Original:")} ${themeFg(theme, "toolOutput", `${originalWidth}x${originalHeight}`)}` }] : []),
    ...(width !== undefined && height !== undefined ? [{ text: `${themeFg(theme, "dim", "Processed:")} ${themeFg(theme, "toolOutput", `${width}x${height}`)}` }] : []),
    { text: `${themeFg(theme, "dim", "Resized:")} ${themeFg(theme, "toolOutput", wasResized ? "yes" : "no")}` },
    ...(payloadBytes === undefined ? [] : [{ text: `${themeFg(theme, "dim", "Payload:")} ${themeFg(theme, "toolOutput", `${payloadBytes} bytes`)}` }]),
    ...fullTextEntries(textContent(result), theme),
  ];
  return { header, body: { mode: "rail", entries } };
}

function buildWrite(result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "displayPath") ?? stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const mode = stringFieldOrUndefined(details, "mode");
  const contents = stringFieldOrUndefined(details, "contents") ?? "";
  const lineCount = contents === "" ? 0 : contents.trimEnd().split(/\r?\n/).length;
  const trailing = themeFg(theme, "dim", mode === "append" ? `(append +${lineCount})` : `(${lineCount} line${lineCount === 1 ? "" : "s"})`);
  const header = pathHeaderSpec("write", path, dotFromDetails(details), theme, trailing);
  if (contents.trim() === "") return { header, body: undefined };
  const all = contents.trimEnd().split(/\r?\n/).map((line) => themeFg(theme, "toolOutput", line));
  const limit = expanded ? all.length : 3;
  const entries: Entry[] = all.slice(0, limit).map((text) => ({ text }));
  if (all.length > limit) entries.push({ text: moreLine(all.length - limit, theme, "more lines"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildEdit(result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const path = stringFieldOrUndefined(details, "displayPath") ?? stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const before = stringFieldOrUndefined(details, "before");
  const after = stringFieldOrUndefined(details, "after");
  if (before === undefined || after === undefined) {
    const editCount = numberFieldOrUndefined(details, "editCount");
    const summary = editCount !== undefined ? `${editCount} replacement${editCount === 1 ? "" : "s"}` : "";
    return {
      header: pathHeaderSpec("edit", path, dotFromDetails(details), theme),
      body: summary === "" ? undefined : { mode: "rail", entries: [{ text: themeFg(theme, "dim", summary), exempt: true }] },
    };
  }
  const diff = renderDiff(before, after, expanded, theme);
  const header = pathHeaderSpec("edit", path, dotFromDetails(details), theme, themeFg(theme, "dim", `(+${diff.added} -${diff.removed})`));
  // Collapsed: cap to ~6 changed lines; advertise the rest with an exempt hint.
  if (!expanded && diff.lines.length > 6) {
    const entries: Entry[] = [];
    appendDiffLines(entries, diff.lines, 6);
    entries.push({ text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true });
    return {
      header,
      body: { mode: "flush", clip: true, entries },
    };
  }
  const entries: Entry[] = [];
  appendDiffLines(entries, diff.lines);
  return { header, body: { mode: "flush", clip: true, entries } };
}

function buildApplyPatch(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const writes = recordArrayFieldOrEmpty<ToolRenderFields>(details, "writes").map((write) => ({
    path: stringFieldOrUndefined(write, "path") ?? "",
    before: stringFieldOrUndefined(write, "before") ?? "",
    after: stringFieldOrUndefined(write, "contents") ?? stringFieldOrUndefined(write, "after") ?? "",
  }));
  const deletes = stringArrayFieldOrEmpty(details, "deletes");
  const deletedFiles = recordArrayFieldOrEmpty<ToolRenderFields>(details, "deletedFiles").map((file) => ({
    path: stringFieldOrUndefined(file, "path") ?? "",
    before: stringFieldOrUndefined(file, "before") ?? "",
    after: "",
  }));
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

  const deletedPathsWithContents = new Set(deletedFiles.map((file) => file.path));
  const files = [
    ...writes,
    ...deletedFiles,
    ...deletes.filter((path) => !deletedPathsWithContents.has(path)).map((path) => ({ path, before: "", after: "" })),
  ];
  let totalAdded = 0;
  let totalRemoved = 0;
  const perFile = files.map((file) => {
    const { added, removed } = diffCounts(file.before, file.after);
    totalAdded += added;
    totalRemoved += removed;
    return { ...file, added, removed };
  });
  const fileCount = perFile.length;
  const header = headerSpec(name, `${fileCount} file${fileCount === 1 ? "" : "s"}`, dotColor, theme, themeFg(theme, "dim", `(+${totalAdded} -${totalRemoved})`));

  if (!expanded) {
    if (perFile.length === 1) {
      const file = perFile[0];
      const diff = renderDiff(file.before, file.after, false, theme);
      const singleHeader = pathHeaderSpec(name, file.path, dotColor, theme, themeFg(theme, "dim", `(+${diff.added} -${diff.removed})`));
      const entries: Entry[] = [];
      if (diff.lines.length > 6) {
        appendDiffLines(entries, diff.lines, 6);
        entries.push({ text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true });
        return {
          header: singleHeader,
          body: { mode: "flush", clip: true, entries },
        };
      }
      appendDiffLines(entries, diff.lines);
      return { header: singleHeader, body: { mode: "flush", clip: true, entries } };
    }

    const entries: Entry[] = [];
    perFile.forEach((file, index) => {
      if (index > 0) entries.push({ text: "", exempt: true });
      entries.push({ text: `${themeFg(theme, "dim", "  └ ")}${themeFg(theme, "toolOutput", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}` });
      const diff = renderDiff(file.before, file.after, false, theme);
      appendDiffLines(entries, diff.lines, 6);
      if (diff.lines.length > 6) {
        entries.push({ text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true });
      }
    });
    return { header, body: { mode: "flush", clip: true, entries } };
  }

  const entries: Entry[] = [];
  perFile.forEach((file, index) => {
    if (index > 0) entries.push({ text: "", exempt: true });
    entries.push({ text: `${themeFg(theme, "dim", "  └ ")}${themeFg(theme, "toolOutput", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}` });
    const diff = renderDiff(file.before, file.after, true, theme);
    appendDiffLines(entries, diff.lines);
  });
  return { header, body: { mode: "flush", clip: true, entries } };
}

function buildGeneric(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const text = textContent(result);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const body = expanded ? (text === "" ? compactJson(details) : text) : text;
  return { header, body: { mode: "rail", entries: tailEntries(body, expanded, theme, 5, 200) } };
}

// ─────────────────────────────────────────────────────────────────────────────
// notification message renderer
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
    const content = isToolRenderFields(message) ? stringFieldOrUndefined(message, "content") ?? "" : "";
    const parsed = parseSkillBlock(content);
    if (parsed !== null) {
      try {
        const component = new SkillInvocationMessageComponent(parsed);
        if (typeof component.setExpanded === "function") component.setExpanded(expandedFromOptions(options));
        return withLeftGutter(component);
      } catch {
        // Some non-TUI test contexts do not initialize Pi's global theme. Fall
        // through to the parity fallback below rather than leaking the XML block.
      }
    }
    const skills = parseSkillBlocks(content);
    if (skills.length === 0) return undefined;
    const expanded = expandedFromOptions(options);
    const skill = skills[0];
    const details = detailsRecord(message);
    const trigger = stringFieldOrUndefined(details, "trigger") ?? `$${skill.name}`;
    const provenance = `Skill "${skill.name}" was injected automatically by the harness because the user mentioned ${trigger}.`;
    return renderBlock(
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
    );
  };
}

function buildNotificationBlock(message: unknown, options: unknown, theme: unknown): Block | undefined {
  const content = isToolRenderFields(message) ? stringFieldOrUndefined(message, "content") ?? "" : "";
  if (content === "") return undefined;
  const expanded = expandedFromOptions(options);
  const execMatch = /^Command session ([0-9]+) has finished\./.exec(content);
  const name = execMatch !== null ? "exec_completion" : "notification";
  const subject = execMatch !== null ? `session ${execMatch[1]} ready` : "ready";

  return {
    header: headerSpec(name, subject, "muted", theme),
    body: expanded ? { mode: "rail", entries: tailEntries(content, true, theme, 6, 100000) } : undefined,
  };
}

export function notificationMessageRenderer() {
  return (message: unknown, options: unknown, theme: unknown) => {
    const block = buildNotificationBlock(message, options, theme);
    return block === undefined ? undefined : renderBlock(block, expandedFromOptions(options));
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// taumel.cron.fire message renderer (live and replayed cron fires)
// ─────────────────────────────────────────────────────────────────────────────

function buildCronFireBlock(message: unknown, options: unknown, theme: unknown): Block | undefined {
  const expanded = expandedFromOptions(options);
  const details = isToolRenderFields(message) ? detailsRecord(message) : {};
  const id = stringFieldOrUndefined(details, "id") ?? "";
  const schedule = stringFieldOrUndefined(details, "schedule") ?? "";
  const coalesced = numberFieldOrUndefined(details, "coalesced") ?? 1;
  const prompt =
    stringFieldOrUndefined(details, "prompt") ??
    (isToolRenderFields(message) ? stringFieldOrUndefined(message, "content") : undefined) ??
    "";
  if (id === "" && prompt === "") return undefined;

  const trailingParts = [schedule].filter((part) => part !== "");
  if (coalesced > 1) trailingParts.push(`${coalesced} coalesced`);
  const trailing = trailingParts.length > 0 ? themeFg(theme, "dim", trailingParts.join(" · ")) : "";
  const subject = trailing === "" ? id : `${id} · ${trailing}`;
  const header = headerSpec("cron.fire", subject, "muted", theme);

  if (!expanded) return { header, body: undefined };

  const cronExpr = stringFieldOrUndefined(details, "cron");
  const entries: Entry[] = [
    ...(id !== "" ? [{ text: `${themeFg(theme, "dim", "Task:")} ${themeFg(theme, "toolOutput", id)}` }] : []),
    ...(cronExpr !== undefined ? [{ text: `${themeFg(theme, "dim", "Schedule:")} ${themeFg(theme, "toolOutput", cronExpr)}` }] : []),
    ...(schedule !== "" ? [{ text: `${themeFg(theme, "dim", "Human:")} ${themeFg(theme, "toolOutput", schedule)}` }] : []),
    ...(coalesced > 1 ? [{ text: `${themeFg(theme, "dim", "Coalesced:")} ${themeFg(theme, "toolOutput", String(coalesced))}` }] : []),
  ];
  if (prompt !== "") {
    entries.push({ text: "" });
    entries.push({ text: themeFg(theme, "dim", "Prompt:"), exempt: true });
    entries.push(...fullTextEntries(prompt, theme));
  }
  return { header, body: { mode: "rail", entries } };
}

export function cronFireMessageRenderer() {
  return (message: unknown, options: unknown, theme: unknown) => {
    const block = buildCronFireBlock(message, options, theme);
    return block === undefined ? undefined : renderBlock(block, expandedFromOptions(options));
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
  if (name === "view_media") return "viewing image";
  return "running";
}

function buildResult(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  if (name === "exec_command" || name === "write_stdin") return buildShell(name, result, options, theme, args);
  if (name === "read") return buildRead(result, options, theme, args);
  if (name === "view_media") return buildViewMedia(name, result, options, theme, args);
  if (name === "write") return buildWrite(result, options, theme, args);
  if (name === "edit") return buildEdit(result, options, theme, args);
  if (name === "apply_patch") return buildApplyPatch(name, result, options, theme, args);
  const domain = buildDomainResult(name, result, options, theme, args);
  if (domain !== undefined) return domain;
  return buildGeneric(name, result, options, theme, args);
}

export function renderersForTool(name: string) {
  return {
    renderCall(args: unknown, theme: unknown, context: unknown) {
      if (isToolRenderFields(context) && context["isPartial"] === false) return emptyComponent();
      const callArgs = isToolRenderFields(args) ? args : {};
      // In-flight call: yellow dot header + dim (progress), header-only, clipped to one line.
      const header = headerSpec(name, subjectFromArgs(name, callArgs), "warning", theme, themeFg(theme, "dim", `(${progressText(name)})`));
      return renderBlock({ header, body: undefined }, false);
    },
    renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
      const expanded = expandedFromOptions(options);
      if (isToolRenderFields(options) && options["isPartial"] === true) {
        const args = argsFromContext(context);
        const header = headerSpec(name, subjectFromArgs(name, args), "warning", theme, themeFg(theme, "dim", `(${progressText(name)})`));
        return renderBlock({ header, body: undefined }, false);
      }
      const args = argsFromContext(context);
      const renderedResult = isToolRenderFields(context) && context["isError"] === true && isToolRenderFields(result)
        ? { ...result, details: { ...detailsRecord(result), ok: false } }
        : result;
      return renderBlock(buildResult(name, renderedResult, options, theme, args), expanded);
    },
  };
}
