import type { Block, Entry, HeaderSpec } from "./render-layout.ts";
import {
  boolFieldOrUndefined,
  numberFieldOrUndefined,
  recordArrayFieldOrEmpty,
  recordFieldOrUndefined,
  stringArrayFieldOrEmpty,
  stringFieldOrUndefined,
} from "./util.ts";

type ToolRenderFields = { readonly [key: string]: unknown };
function isToolRenderFields(value: unknown): value is ToolRenderFields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function themeFg(theme: unknown, color: string, value: string): string {
  if (!isToolRenderFields(theme)) return value;
  const fg = theme["fg"];
  if (typeof fg !== "function") return value;
  const rendered = fg.call(theme, color, value);
  return typeof rendered === "string" ? rendered : value;
}

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
  if (!isToolRenderFields(result) || !Array.isArray(result["content"])) return "";
  const parts: string[] = [];
  for (const item of result["content"]) {
    if (isToolRenderFields(item) && item["type"] === "text" && typeof item["text"] === "string") parts.push(item["text"]);
  }
  return parts.join("\n");
}

function detailsRecord(result: unknown): ToolRenderFields {
  return isToolRenderFields(result) && isToolRenderFields(result["details"]) ? result["details"] : {};
}

function expandedFromOptions(options: unknown): boolean {
  return isToolRenderFields(options) && options["expanded"] === true;
}

function dot(theme: unknown, color: string): string {
  return themeFg(theme, color, "•");
}

function headerSpec(name: string, subject: string, dotColor: string, theme: unknown, trailing = ""): HeaderSpec {
  const lead = `${dot(theme, dotColor)} ${themeFg(theme, "toolTitle", name)} ${themeFg(theme, "dim", "·")} `;
  return { lead, subject, trailing };
}

function dotFromDetails(details: ToolRenderFields): string {
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");
  if (code !== undefined) return code === 0 ? "success" : "error";
  if (boolFieldOrUndefined(details, "ok") === false) return "error";
  return "success";
}

function statusColor(status: string): "success" | "warning" | "error" {
  if (["failed", "cancelled", "timed_out", "lost"].includes(status)) return "error";
  if (["running", "queued", "suspended"].includes(status)) return "warning";
  return "success";
}

function fullTextEntries(text: string, theme: unknown): Entry[] {
  const cleaned = text.trimEnd();
  return cleaned === "" ? [] : cleaned.split(/\r?\n/).map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
}

function labeled(label: string, value: string | undefined, theme: unknown): Entry[] {
  if (value === undefined || value.trim() === "") return [];
  return [{ text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", value)}` }];
}

function boolState(value: boolean | undefined, trueText: string, falseText: string): string | undefined {
  if (value === undefined) return undefined;
  return value ? trueText : falseText;
}

function quotedQuery(args: ToolRenderFields): string {
  return `"${oneLine(stringFieldOrUndefined(args, "query") ?? "")}"`;
}

function resultDescription(item: ToolRenderFields): string | undefined {
  const summary = stringFieldOrUndefined(item, "summary") ?? stringFieldOrUndefined(item, "text") ?? stringFieldOrUndefined(item, "content") ?? stringFieldOrUndefined(item, "description");
  if (summary !== undefined) return summary;
  const highlights = item["highlights"];
  return Array.isArray(highlights) ? highlights.find((part): part is string => typeof part === "string") : undefined;
}

function buildGoal(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const goal = recordFieldOrUndefined<ToolRenderFields>(details, "goal");
  const objective = goal !== undefined ? stringFieldOrUndefined(goal, "objective") : undefined;
  const status = goal !== undefined ? stringFieldOrUndefined(goal, "status") : undefined;
  const subject = oneLine(objective ?? stringFieldOrUndefined(args, "objective") ?? stringFieldOrUndefined(args, "status") ?? name);
  const header = headerSpec(name, subject, dotFromDetails(details), theme, status !== undefined ? themeFg(theme, "dim", `(${status})`) : "");
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  entries.push(...labeled("Objective", objective, theme));
  entries.push(...labeled("Status", status, theme));
  if (details["accountingPending"] === true) entries.push({ text: themeFg(theme, "dim", "Accounting: final accounting pending"), exempt: true });
  const tokens = goal !== undefined ? numberFieldOrUndefined(goal, "tokensUsed") : undefined;
  const seconds = goal !== undefined ? numberFieldOrUndefined(goal, "timeUsedSeconds") : undefined;
  if (tokens !== undefined) entries.push({ text: themeFg(theme, "dim", `Tokens: ${tokens}`), exempt: true });
  if (seconds !== undefined) entries.push({ text: themeFg(theme, "dim", `Active time: ${seconds}s`), exempt: true });
  entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function cronTaskLine(task: ToolRenderFields, theme: unknown): string {
  const id = stringFieldOrUndefined(task, "id") ?? "task";
  const schedule = stringFieldOrUndefined(task, "schedule") ?? stringFieldOrUndefined(task, "cron") ?? "";
  const mode = stringFieldOrUndefined(task, "mode");
  const enabled = boolState(boolFieldOrUndefined(task, "enabled"), "enabled", "disabled");
  return [themeFg(theme, "toolOutput", id), schedule, mode, enabled].filter((part): part is string => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `);
}

function cronTaskEntries(task: ToolRenderFields, theme: unknown): Entry[] {
  const entries: Entry[] = [{ text: cronTaskLine(task, theme) }];
  const details = [
    stringFieldOrUndefined(task, "cron") !== undefined ? `cron=${stringFieldOrUndefined(task, "cron")}` : undefined,
    boolState(boolFieldOrUndefined(task, "recurring"), "recurring", "one-shot"),
    stringFieldOrUndefined(task, "nextDueText") !== undefined ? `next=${stringFieldOrUndefined(task, "nextDueText")}` : undefined,
  ].filter((part): part is string => part !== undefined && part !== "");
  if (details.length > 0) entries.push({ text: themeFg(theme, "dim", details.join(" · ")), exempt: true });
  const prompt = stringFieldOrUndefined(task, "prompt");
  if (prompt !== undefined && prompt !== "") entries.push({ text: `${themeFg(theme, "dim", "Prompt:")} ${themeFg(theme, "toolOutput", prompt)}` });
  return entries;
}

function buildCron(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  if (name === "cron_delete") {
    const id = stringFieldOrUndefined(details, "id") ?? stringFieldOrUndefined(args, "id") ?? "";
    const deleted = boolFieldOrUndefined(details, "deleted") === true;
    const header = headerSpec(name, `${id} (${deleted ? "deleted" : "not found"})`, dotFromDetails(details), theme);
    return expanded ? { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "toolOutput", `Task ${id}: ${deleted ? "deleted" : "not found"}`) }] } } : { header, body: undefined };
  }
  if (name === "cron_list") {
    const tasks = recordArrayFieldOrEmpty<ToolRenderFields>(details, "tasks");
    const enabled = boolFieldOrUndefined(details, "enabled") === true;
    const header = headerSpec(name, `${tasks.length} task${tasks.length === 1 ? "" : "s"} (${enabled ? "enabled" : "disabled"})`, dotFromDetails(details), theme);
    if (!expanded) return { header, body: undefined };
    const entries: Entry[] = [{ text: themeFg(theme, "dim", `Master switch: ${enabled ? "enabled" : "disabled"}`), exempt: true }];
    if (tasks.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
    tasks.forEach((task, index) => {
      if (index > 0) entries.push({ text: "" });
      entries.push(...cronTaskEntries(task, theme));
    });
    return { header, body: { mode: "rail", entries } };
  }
  const task = recordFieldOrUndefined<ToolRenderFields>(details, "task") ?? details;
  const id = stringFieldOrUndefined(task, "id") ?? stringFieldOrUndefined(details, "id") ?? "";
  const schedule = stringFieldOrUndefined(task, "schedule") ?? stringFieldOrUndefined(task, "cron") ?? stringFieldOrUndefined(details, "schedule") ?? "";
  const enabled = boolState(boolFieldOrUndefined(task, "enabled") ?? boolFieldOrUndefined(details, "enabled"), "enabled", "disabled");
  const header = headerSpec(name, [id, schedule, enabled].filter((part): part is string => part !== undefined && part !== "").join(" · "), dotFromDetails(details), theme);
  return expanded ? { header, body: { mode: "rail", entries: cronTaskEntries(task, theme) } } : { header, body: undefined };
}

function subjectFromThreadArgs(args: ToolRenderFields): string {
  const locator = recordFieldOrUndefined<ToolRenderFields>(args, "locator");
  const threadID = stringFieldOrUndefined(args, "threadID") ?? (locator !== undefined ? stringFieldOrUndefined(locator, "threadID") : undefined) ?? "";
  const mode = stringFieldOrUndefined(args, "mode") ?? "overview";
  return `${threadID} (${mode})`;
}

function buildQueryThreads(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const threads = recordArrayFieldOrEmpty<ToolRenderFields>(details, "threads");
  const hits = threads.reduce((total, thread) => total + recordArrayFieldOrEmpty<ToolRenderFields>(thread, "hits").length, 0);
  const header = headerSpec(name, quotedQuery(args), dotFromDetails(details), theme, themeFg(theme, "dim", `(${threads.length} thread${threads.length === 1 ? "" : "s"}, ${hits} hit${hits === 1 ? "" : "s"})`));
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  threads.slice(0, 30).forEach((thread, index) => {
    if (index > 0) entries.push({ text: "" });
    const title = stringFieldOrUndefined(thread, "title") ?? stringFieldOrUndefined(thread, "id") ?? `thread ${index + 1}`;
    const id = stringFieldOrUndefined(thread, "id");
    const workspace = stringFieldOrUndefined(thread, "workspace");
    const threadHits = recordArrayFieldOrEmpty<ToolRenderFields>(thread, "hits");
    const meta = [id, workspace, `${threadHits.length} hit${threadHits.length === 1 ? "" : "s"}`].filter((part): part is string => part !== undefined && part !== "");
    entries.push({ text: `${themeFg(theme, "accent", String(index + 1))} ${themeFg(theme, "dim", "·")} ${themeFg(theme, "toolOutput", title)} ${themeFg(theme, "dim", "·")} ${themeFg(theme, "dim", meta.join(" · "))}` });
    for (const hit of threadHits) {
      const label = [stringFieldOrUndefined(hit, "kind") ?? "", stringFieldOrUndefined(hit, "role"), stringFieldOrUndefined(hit, "toolName")].filter((part): part is string => part !== undefined && part !== "").join("/");
      entries.push({ text: themeFg(theme, "dim", `${label}: ${oneLine(stringFieldOrUndefined(hit, "snippet") ?? "")}`) });
    }
  });
  if (threads.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  if (threads.length > 30) entries.push({ text: themeFg(theme, "dim", `… ${threads.length - 30} more`), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildReadThread(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const diagnostics = recordArrayFieldOrEmpty<ToolRenderFields>(details, "diagnostics");
  const cursor = stringFieldOrUndefined(details, "cursor");
  const facts = [diagnostics.length > 0 ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}` : undefined, cursor !== undefined ? "more available" : undefined].filter((part): part is string => part !== undefined);
  const baseSubject = subjectFromThreadArgs(args);
  const subject = facts.length === 0 ? baseSubject : baseSubject.replace(/\)$/, `, ${facts.join(", ")})`);
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  const thread = recordFieldOrUndefined<ToolRenderFields>(details, "thread");
  if (thread !== undefined) {
    entries.push(...labeled("Title", stringFieldOrUndefined(thread, "title"), theme));
    const messages = numberFieldOrUndefined(thread, "messageCount") ?? numberFieldOrUndefined(thread, "message_count");
    if (messages !== undefined) entries.push({ text: themeFg(theme, "dim", `Messages: ${messages}`), exempt: true });
  }
  entries.push(...fullTextEntries(textContent(result), theme));
  if (diagnostics.length > 0) {
    entries.push({ text: "" });
    entries.push({ text: themeFg(theme, "dim", `Diagnostics: ${diagnostics.length}`), exempt: true });
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildRalph(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const taskId = stringFieldOrUndefined(details, "taskId") ?? stringFieldOrUndefined(args, "task_id") ?? "";
  const facts = [numberFieldOrUndefined(details, "iteration") !== undefined ? `iteration ${numberFieldOrUndefined(details, "iteration")}` : undefined, stringFieldOrUndefined(details, "status")].filter((part): part is string => part !== undefined && part !== "");
  const header = headerSpec(name, taskId, dotFromDetails(details), theme, facts.length > 0 ? themeFg(theme, "dim", `(${facts.join(" · ")})`) : "");
  if (!expanded) return { header, body: undefined };
  const entries = [...labeled("Task id", taskId, theme), ...labeled("Status", stringFieldOrUndefined(details, "status"), theme)];
  if (boolFieldOrUndefined(details, "reflection") === true) entries.push({ text: themeFg(theme, "dim", "Reflection: true"), exempt: true });
  entries.push(...fullTextEntries(textContent(result), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function exaResults(details: ToolRenderFields): ToolRenderFields[] {
  const response = recordFieldOrUndefined<ToolRenderFields>(details, "response") ?? {};
  return recordArrayFieldOrEmpty<ToolRenderFields>(response, "results");
}

function buildExaSearch(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const results = exaResults(details);
  const subject = name === "crawling_exa"
    ? `${Array.isArray(args["urls"]) ? args["urls"].length : Array.isArray(args["ids"]) ? args["ids"].length : results.length} ${Array.isArray(args["urls"]) ? "urls" : "ids"}`
    : quotedQuery(args);
  const header = headerSpec(name, subject, dotFromDetails(details), theme, themeFg(theme, "dim", `(${results.length} result${results.length === 1 ? "" : "s"})`));
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  results.slice(0, 10).forEach((item, index) => {
    if (index > 0) entries.push({ text: "" });
    const title = stringFieldOrUndefined(item, "title") ?? stringFieldOrUndefined(item, "url") ?? `result ${index + 1}`;
    const url = stringFieldOrUndefined(item, "url") ?? "";
    entries.push({ text: `${themeFg(theme, "accent", String(index + 1))} ${themeFg(theme, "dim", "·")} ${themeFg(theme, "toolOutput", title)}${url === "" ? "" : ` ${themeFg(theme, "dim", "·")} ${themeFg(theme, "dim", domainOf(url))}`}` });
    entries.push(...labeled("URL", url, theme));
    entries.push(...labeled("Summary", resultDescription(item), theme));
  });
  if (entries.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildCodeContext(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordFieldOrUndefined<ToolRenderFields>(details, "response") ?? {};
  const text = stringFieldOrUndefined(response, "response") ?? textContent(result);
  const lineCount = text === "" ? 0 : text.trimEnd().split(/\r?\n/).length;
  const header = headerSpec(name, quotedQuery(args), dotFromDetails(details), theme, lineCount > 0 ? themeFg(theme, "dim", `(${lineCount} lines)`) : "");
  return expanded ? { header, body: { mode: "rail", entries: fullTextEntries(text, theme) } } : { header, body: undefined };
}

function responseObject(details: ToolRenderFields): ToolRenderFields {
  return recordFieldOrUndefined<ToolRenderFields>(details, "response") ?? {};
}

function buildExaAgent(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = responseObject(details);
  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    const items = recordArrayFieldOrEmpty<ToolRenderFields>(response, "data").length > 0 ? recordArrayFieldOrEmpty<ToolRenderFields>(response, "data") : recordArrayFieldOrEmpty<ToolRenderFields>(response, "results");
    const subject = name === "exa_agent_list_events" ? `${stringFieldOrUndefined(args, "id") ?? "run"} (${items.length} event${items.length === 1 ? "" : "s"})` : `recent runs (${items.length})`;
    const header = headerSpec(name, subject, dotFromDetails(details), theme);
    if (!expanded) return { header, body: undefined };
    const entries: Entry[] = [];
    items.forEach((item, index) => {
      if (index > 0) entries.push({ text: "" });
      const title = stringFieldOrUndefined(item, "title") ?? stringFieldOrUndefined(item, "type") ?? stringFieldOrUndefined(item, "id") ?? `item ${index + 1}`;
      entries.push({ text: [themeFg(theme, "toolOutput", title), stringFieldOrUndefined(item, "status"), stringFieldOrUndefined(item, "createdAt") ?? stringFieldOrUndefined(item, "timestamp")].filter((part): part is string => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `) });
      entries.push(...labeled("Summary", resultDescription(item), theme));
    });
    if (entries.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
    return { header, body: { mode: "rail", entries } };
  }
  if (name === "exa_agent_cancel_run") return { header: headerSpec(name, `${stringFieldOrUndefined(args, "id") ?? ""} (cancelled)`, dotFromDetails(details), theme), body: undefined };
  const id = stringFieldOrUndefined(response, "id") ?? stringFieldOrUndefined(args, "id") ?? "";
  const status = stringFieldOrUndefined(response, "status");
  const header = headerSpec(name, status !== undefined ? `${id} · ${status}` : id, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const output = recordFieldOrUndefined<ToolRenderFields>(response, "output");
  const text = output !== undefined ? stringFieldOrUndefined(output, "text") ?? "" : stringFieldOrUndefined(response, "response") ?? "";
  const entries = [
    ...labeled("ID", id, theme),
    ...labeled("Status", status, theme),
    ...labeled("Created", stringFieldOrUndefined(response, "createdAt"), theme),
    ...labeled("Updated", stringFieldOrUndefined(response, "updatedAt"), theme),
    ...labeled("Error", stringFieldOrUndefined(response, "error"), theme),
    ...fullTextEntries(text, theme),
  ];
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

export function buildDomainResult(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block | undefined {
  if (name === "get_goal" || name === "create_goal" || name === "update_goal") return buildGoal(name, result, options, theme, args);
  if (name.startsWith("cron_")) return buildCron(name, result, options, theme, args);
  if (name === "query_threads") return buildQueryThreads(name, result, options, theme, args);
  if (name === "read_thread") return buildReadThread(name, result, options, theme, args);
  if (name === "ralph_continue" || name === "ralph_finish") return buildRalph(name, result, options, theme, args);
  if (name === "get_code_context_exa") return buildCodeContext(name, result, options, theme, args);
  if (name === "web_search_exa" || name === "crawling_exa") return buildExaSearch(name, result, options, theme, args);
  if (name.startsWith("exa_agent_")) return buildExaAgent(name, result, options, theme, args);
  return undefined;
}
