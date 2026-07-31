import type { Entry, HeaderSpec } from "./render-layout.ts";
import { boolFieldOrUndefined, formatLocalTime, numberFieldOrUndefined, objectValue, stringFieldOrUndefined } from "./util.ts";

export type ToolRenderFields = { readonly [key: string]: unknown };

export function isToolRenderFields(value: unknown): value is ToolRenderFields {
  return objectValue(value) !== undefined;
}

export function themeFg(theme: unknown, color: string, value: string): string {
  if (!isToolRenderFields(theme)) return value;
  const fg = theme["fg"];
  if (typeof fg !== "function") return value;
  const rendered = fg.call(theme, color, value);
  return typeof rendered === "string" ? rendered : value;
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function textContent(result: unknown): string {
  if (!isToolRenderFields(result) || !Array.isArray(result["content"])) return "";
  const parts: string[] = [];
  for (const item of result["content"]) {
    if (isToolRenderFields(item) && item["type"] === "text" && typeof item["text"] === "string") {
      parts.push(item["text"]);
    }
  }
  return parts.join("\n");
}

export function detailsRecord(result: unknown): ToolRenderFields {
  return isToolRenderFields(result) && isToolRenderFields(result["details"])
    ? result["details"]
    : {};
}

export function expandedFromOptions(options: unknown): boolean {
  return isToolRenderFields(options) && options["expanded"] === true;
}

export function headerSpec(name: string, subject: string, dotColor: string, theme: unknown, trailing = ""): HeaderSpec {
  const lead = `${themeFg(theme, dotColor, "•")} ${themeFg(theme, "toolTitle", name)} ${themeFg(theme, "dim", "·")} `;
  return { lead, subject, trailing };
}

export function dotFromDetails(details: ToolRenderFields): string {
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");
  if (code !== undefined) return code === 0 ? "success" : "error";
  return boolFieldOrUndefined(details, "ok") === false ? "error" : "success";
}

export function fullTextEntries(text: string, theme: unknown): Entry[] {
  const cleaned = text.trimEnd();
  return cleaned === ""
    ? []
    : cleaned.split(/\r?\n/).map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
}

/** ^agentui-s3jx: single-run agent_wait status as colored text, mirroring
 * the completion-notification colors (agentui-f545/8elv/svxd/vr2p). */
export function agentRunStatusColor(status: string): string {
  switch (status) {
    case "completed": return "success";
    case "failed":
    case "lost": return "error";
    case "suspended": return "warning";
    default: return "dim";
  }
}

export function quotedQuery(args: ToolRenderFields): string {
  return `"${oneLine(stringFieldOrUndefined(args, "query") ?? "")}"`;
}

/** ^render-rffp: status as colored text only — no status-dot glyph in task rows. */
export function planTaskStatusColor(status: string): string {
  switch (status) {
    case "completed": return "success";
    case "in_progress": return "warning";
    case "cancelled": return "error";
    case "pending":
    default: return "dim";
  }
}

export function planTaskCancellationDetail(
  task: { readonly status?: unknown; readonly cancellationReason?: unknown },
): string | undefined {
  if (task.status !== "cancelled" || typeof task.cancellationReason !== "string") return undefined;
  const reason = oneLine(task.cancellationReason);
  return reason === "" ? undefined : `Reason: ${reason}`;
}

/** Labeled dim/toolOutput row; omit when value is absent or blank. */
export function labeled(label: string, value: string | undefined, theme: unknown): Entry[] {
  if (value === undefined || value.trim() === "") return [];
  return [{ text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", value)}` }];
}

/** Multi-line labeled body: first line after the label, remaining lines as plain toolOutput. */
export function labeledText(label: string, value: string | undefined, theme: unknown): Entry[] {
  if (value === undefined || value.trim() === "") return [];
  const lines = value.trimEnd().split(/\r?\n/);
  return [
    { text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", lines[0])}` },
    ...lines.slice(1).map((line) => ({ text: themeFg(theme, "toolOutput", line) })),
  ];
}

/** Format epoch seconds, epoch ms, or parseable ISO/local timestamps as local clock time (^render-xafb). */
export function formatTimestampValue(value: unknown, nowMs = Date.now()): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = value > 1e12 ? value / 1000 : value;
    return formatLocalTime(seconds, nowMs);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return undefined;
    const seconds = numeric > 1e12 ? numeric / 1000 : numeric;
    return formatLocalTime(seconds, nowMs);
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return undefined;
  return formatLocalTime(ms / 1000, nowMs);
}

export function labeledTimestamp(label: string, value: unknown, theme: unknown): Entry[] {
  return labeled(label, formatTimestampValue(value), theme);
}

/** Shared plan task-row grammar: `task-x7aa [in_progress/agent]: Title` + indented Depends on. */
export function planTaskRow(task: ToolRenderFields, theme: unknown): Entry[] {
  const id = stringFieldOrUndefined(task, "taskId") ?? "task";
  const title = stringFieldOrUndefined(task, "title") ?? "";
  const taskStatus = stringFieldOrUndefined(task, "status") ?? "unknown";
  const origin = stringFieldOrUndefined(task, "origin") ?? "unknown";
  const cancellation = planTaskCancellationDetail(task);
  // ^render-rffp: status as colored text only — no status-dot glyph in task rows.
  const statusText = themeFg(theme, planTaskStatusColor(taskStatus), taskStatus);
  const entries: Entry[] = [{
    text: `${themeFg(theme, "dim", id)} ${themeFg(theme, "dim", "[")}${statusText}${themeFg(theme, "dim", `/${origin}]:`)} ${themeFg(theme, "toolOutput", title)}${cancellation === undefined ? "" : themeFg(theme, "dim", ` · ${cancellation}`)}`,
  }];
  const dependencies = task["depends_on"];
  if (Array.isArray(dependencies) && dependencies.length > 0) {
    const deps = dependencies.filter((value): value is string => typeof value === "string").join(", ");
    if (deps !== "") entries.push({ text: `  ${themeFg(theme, "dim", "Depends on:")} ${themeFg(theme, "toolOutput", deps)}` });
  }
  return entries;
}
