import type { Entry, HeaderSpec } from "./render-layout.ts";
import { boolFieldOrUndefined, numberFieldOrUndefined, objectValue, stringFieldOrUndefined } from "./util.ts";

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

export function quotedQuery(args: ToolRenderFields): string {
  return `"${oneLine(stringFieldOrUndefined(args, "query") ?? "")}"`;
}

function planTaskStatusColor(status: string): string {
  switch (status) {
    case "completed": return "success";
    case "in_progress": return "warning";
    case "cancelled": return "error";
    case "pending":
    default: return "dim";
  }
}

/** Shared plan task-row grammar: `task-x7aa [in_progress/agent]: Title` + indented Depends on. */
export function planTaskRow(task: ToolRenderFields, theme: unknown): Entry[] {
  const id = stringFieldOrUndefined(task, "taskId") ?? "task";
  const title = stringFieldOrUndefined(task, "title") ?? "";
  const taskStatus = stringFieldOrUndefined(task, "status") ?? "unknown";
  const origin = stringFieldOrUndefined(task, "origin") ?? "unknown";
  // ^render-rffp: status as colored text only — no status-dot glyph in task rows.
  const statusText = themeFg(theme, planTaskStatusColor(taskStatus), taskStatus);
  const entries: Entry[] = [{
    text: `${themeFg(theme, "dim", id)} ${themeFg(theme, "dim", "[")}${statusText}${themeFg(theme, "dim", `/${origin}]:`)} ${themeFg(theme, "toolOutput", title)}`,
  }];
  const dependencies = task["depends_on"];
  if (Array.isArray(dependencies) && dependencies.length > 0) {
    const deps = dependencies.filter((value): value is string => typeof value === "string").join(", ");
    if (deps !== "") entries.push({ text: `  ${themeFg(theme, "dim", "Depends on:")} ${themeFg(theme, "toolOutput", deps)}` });
  }
  return entries;
}
