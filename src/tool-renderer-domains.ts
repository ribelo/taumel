import type { Block, Entry, HeaderSpec } from "./render-layout.ts";
import {
  boolFieldOrUndefined,
  isRecord,
  numberFieldOrUndefined,
  recordArrayFieldOrEmpty,
  recordFieldOrUndefined,
  stringArrayFieldOrEmpty,
  stringFieldOrUndefined,
} from "./util.ts";

function themeFg(theme: unknown, color: string, value: string): string {
  if (!isRecord(theme)) return value;
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
  if (!isRecord(result) || !Array.isArray(result["content"])) return "";
  const parts: string[] = [];
  for (const item of result["content"]) {
    if (isRecord(item) && item["type"] === "text" && typeof item["text"] === "string") parts.push(item["text"]);
  }
  return parts.join("\n");
}

function detailsRecord(result: unknown): Record<string, unknown> {
  return isRecord(result) && isRecord(result["details"]) ? result["details"] : {};
}

function expandedFromOptions(options: unknown): boolean {
  return isRecord(options) && options["expanded"] === true;
}

function dot(theme: unknown, color: string): string {
  return themeFg(theme, color, "•");
}

function headerSpec(name: string, subject: string, dotColor: string, theme: unknown, trailing = ""): HeaderSpec {
  const lead = `${dot(theme, dotColor)} ${themeFg(theme, "toolTitle", name)} ${themeFg(theme, "dim", "·")} `;
  return { lead, subject, trailing };
}

function dotFromDetails(details: Record<string, unknown>): string {
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

function aggregateStatusColor(statuses: string[], fallback: "success" | "warning" | "error" = "success"): "success" | "warning" | "error" {
  if (statuses.length === 0) return fallback;
  if (statuses.some((status) => statusColor(status) === "error")) return "error";
  if (statuses.some((status) => statusColor(status) === "warning")) return "warning";
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

function quotedQuery(args: Record<string, unknown>): string {
  return `"${oneLine(stringFieldOrUndefined(args, "query") ?? "")}"`;
}

function resultDescription(item: Record<string, unknown>): string | undefined {
  const summary = stringFieldOrUndefined(item, "summary") ?? stringFieldOrUndefined(item, "text") ?? stringFieldOrUndefined(item, "content") ?? stringFieldOrUndefined(item, "description");
  if (summary !== undefined) return summary;
  const highlights = item["highlights"];
  return Array.isArray(highlights) ? highlights.find((part): part is string => typeof part === "string") : undefined;
}

function buildGoal(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const goal = recordFieldOrUndefined(details, "goal");
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

function cronTaskLine(task: Record<string, unknown>, theme: unknown): string {
  const id = stringFieldOrUndefined(task, "id") ?? "task";
  const schedule = stringFieldOrUndefined(task, "schedule") ?? stringFieldOrUndefined(task, "cron") ?? "";
  const mode = stringFieldOrUndefined(task, "mode");
  const enabled = boolState(boolFieldOrUndefined(task, "enabled"), "enabled", "disabled");
  return [themeFg(theme, "toolOutput", id), schedule, mode, enabled].filter((part): part is string => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `);
}

function cronTaskEntries(task: Record<string, unknown>, theme: unknown): Entry[] {
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

function buildCron(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  if (name === "cron_delete") {
    const id = stringFieldOrUndefined(details, "id") ?? stringFieldOrUndefined(args, "id") ?? "";
    const deleted = boolFieldOrUndefined(details, "deleted") === true;
    const header = headerSpec(name, `${id} (${deleted ? "deleted" : "not found"})`, dotFromDetails(details), theme);
    return expanded ? { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "toolOutput", `Task ${id}: ${deleted ? "deleted" : "not found"}`) }] } } : { header, body: undefined };
  }
  if (name === "cron_list") {
    const tasks = recordArrayFieldOrEmpty(details, "tasks");
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
  const task = recordFieldOrUndefined(details, "task") ?? details;
  const id = stringFieldOrUndefined(task, "id") ?? stringFieldOrUndefined(details, "id") ?? "";
  const schedule = stringFieldOrUndefined(task, "schedule") ?? stringFieldOrUndefined(task, "cron") ?? stringFieldOrUndefined(details, "schedule") ?? "";
  const enabled = boolState(boolFieldOrUndefined(task, "enabled") ?? boolFieldOrUndefined(details, "enabled"), "enabled", "disabled");
  const header = headerSpec(name, [id, schedule, enabled].filter((part): part is string => part !== undefined && part !== "").join(" · "), dotFromDetails(details), theme);
  return expanded ? { header, body: { mode: "rail", entries: cronTaskEntries(task, theme) } } : { header, body: undefined };
}

function subjectFromThreadArgs(args: Record<string, unknown>): string {
  const locator = recordFieldOrUndefined(args, "locator");
  const threadID = stringFieldOrUndefined(args, "threadID") ?? (locator !== undefined ? stringFieldOrUndefined(locator, "threadID") : undefined) ?? "";
  const mode = stringFieldOrUndefined(args, "mode") ?? "overview";
  return `${threadID} (${mode})`;
}

function buildQueryThreads(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const threads = recordArrayFieldOrEmpty(details, "threads");
  const hits = threads.reduce((total, thread) => total + recordArrayFieldOrEmpty(thread, "hits").length, 0);
  const header = headerSpec(name, quotedQuery(args), dotFromDetails(details), theme, themeFg(theme, "dim", `(${threads.length} thread${threads.length === 1 ? "" : "s"}, ${hits} hit${hits === 1 ? "" : "s"})`));
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  threads.slice(0, 30).forEach((thread, index) => {
    if (index > 0) entries.push({ text: "" });
    const title = stringFieldOrUndefined(thread, "title") ?? stringFieldOrUndefined(thread, "id") ?? `thread ${index + 1}`;
    const id = stringFieldOrUndefined(thread, "id");
    const workspace = stringFieldOrUndefined(thread, "workspace");
    const threadHits = recordArrayFieldOrEmpty(thread, "hits");
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

function buildReadThread(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const diagnostics = recordArrayFieldOrEmpty(details, "diagnostics");
  const cursor = stringFieldOrUndefined(details, "cursor");
  const facts = [diagnostics.length > 0 ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}` : undefined, cursor !== undefined ? "more available" : undefined].filter((part): part is string => part !== undefined);
  const baseSubject = subjectFromThreadArgs(args);
  const subject = facts.length === 0 ? baseSubject : baseSubject.replace(/\)$/, `, ${facts.join(", ")})`);
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  const thread = recordFieldOrUndefined(details, "thread");
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

function buildAgentProfiles(name: string, result: unknown, options: unknown, theme: unknown): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const profiles = recordArrayFieldOrEmpty(details, "profiles");
  const enabledCount = profiles.filter((profile) => boolFieldOrUndefined(profile, "enabled") !== false).length;
  const disabledCount = profiles.length - enabledCount;
  const subject = `${profiles.length} profile${profiles.length === 1 ? "" : "s"} (${enabledCount} enabled${disabledCount > 0 ? `, ${disabledCount} disabled` : ""})`;
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  profiles.forEach((profile, index) => {
    if (index > 0) entries.push({ text: "" });
    const profileName = stringFieldOrUndefined(profile, "name") ?? `profile ${index + 1}`;
    const enabled = boolFieldOrUndefined(profile, "enabled") !== false;
    const sandbox = stringFieldOrUndefined(profile, "sandbox");
    const tools = stringFieldOrUndefined(profile, "tools");
    entries.push({ text: [themeFg(theme, "toolOutput", profileName), enabled ? "enabled" : "disabled", sandbox, tools].filter((part): part is string => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `) });
    entries.push(...labeled("Disabled reason", stringFieldOrUndefined(profile, "disabledReason"), theme));
    entries.push(...labeled("Description", stringFieldOrUndefined(profile, "description"), theme));
  });
  if (entries.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function latestRunFacts(run: Record<string, unknown> | undefined): string[] {
  if (run === undefined) return [];
  const runId = stringFieldOrUndefined(run, "run_id");
  const status = stringFieldOrUndefined(run, "status");
  const elapsed = numberFieldOrUndefined(run, "elapsedSeconds");
  return [runId, status, elapsed !== undefined ? `${elapsed}s` : undefined].filter((part): part is string => part !== undefined && part !== "");
}

function buildAgentList(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const agents = recordArrayFieldOrEmpty(details, "agents");
  const openCount = agents.filter((agent) => stringFieldOrUndefined(agent, "lifecycle") !== "closed").length;
  const closedCount = agents.length - openCount;
  const subject = args["include_closed"] === true ? `agents (${openCount} open, ${closedCount} closed)` : `open agents (${agents.length})`;
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  agents.forEach((agent, index) => {
    if (index > 0) entries.push({ text: "" });
    const id = stringFieldOrUndefined(agent, "agent_id") ?? `agent ${index + 1}`;
    const latest = recordFieldOrUndefined(agent, "latestRun");
    entries.push({ text: [themeFg(theme, "toolOutput", id), stringFieldOrUndefined(agent, "profile"), stringFieldOrUndefined(agent, "lifecycle")].filter((part): part is string => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `) });
    entries.push(...labeled("Child session", stringFieldOrUndefined(agent, "child_session_id"), theme));
    const latestFacts = latestRunFacts(latest);
    if (latestFacts.length > 0) entries.push({ text: `${themeFg(theme, "dim", "Latest run:")} ${themeFg(theme, "toolOutput", latestFacts.join(" · "))}` });
  });
  if (entries.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildAgentSpawn(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const worker = recordFieldOrUndefined(details, "worker");
  const agentId = stringFieldOrUndefined(details, "agent_id") ?? stringFieldOrUndefined(details, "workerId") ?? stringFieldOrUndefined(worker ?? {}, "id") ?? "";
  const header = headerSpec(name, agentId, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const message = stringFieldOrUndefined(args, "message") ?? stringFieldOrUndefined(args, "objective") ?? "";
  const label = args["create_goal"] === true ? "Objective sent" : "Message sent";
  const entries: Entry[] = [];
  entries.push(...labeled("Profile", stringFieldOrUndefined(details, "profile") ?? stringFieldOrUndefined(args, "profile"), theme));
  entries.push(...labeled("Agent id", agentId, theme));
  entries.push(...labeled("Run id", stringFieldOrUndefined(details, "run_id"), theme));
  entries.push(...labeled("Status", stringFieldOrUndefined(details, "status"), theme));
  entries.push(...labeled("Child session", stringFieldOrUndefined(details, "childSessionId"), theme));
  entries.push(...labeled(label, message, theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function deliveryOutcome(details: Record<string, unknown>, args: Record<string, unknown>): string {
  const raw = stringFieldOrUndefined(details, "deliveryKind") ?? stringFieldOrUndefined(details, "status") ?? "steered";
  if (raw === "no_active_run") return "no active run";
  if (args["interrupt"] === true && raw === "steered") return "interrupted";
  return raw.replace(/_/g, " ");
}

function buildAgentSend(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const agentId = stringFieldOrUndefined(details, "agent_id") ?? stringFieldOrUndefined(args, "agent_id") ?? "";
  const outcome = deliveryOutcome(details, args);
  const header = headerSpec(name, `${agentId} (${outcome})`, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  entries.push(...labeled("Agent id", agentId, theme));
  entries.push(...labeled("Profile", stringFieldOrUndefined(details, "profile"), theme));
  entries.push(...labeled("Outcome", outcome, theme));
  if (args["interrupt"] === true) entries.push({ text: themeFg(theme, "dim", "Interrupt: true"), exempt: true });
  entries.push(...labeled("Run id", stringFieldOrUndefined(details, "run_id"), theme));
  entries.push(...labeled("Submission id", stringFieldOrUndefined(details, "submission_id"), theme));
  entries.push(...labeled("Previous status", stringFieldOrUndefined(details, "previousRunStatus"), theme));
  entries.push(...labeled("Message sent", stringFieldOrUndefined(args, "message") ?? stringFieldOrUndefined(result as Record<string, unknown>, "prompt"), theme));
  return { header, body: { mode: "rail", entries } };
}

function summarizeRunStatuses(runs: Record<string, unknown>[], hasActiveRuns: boolean): string {
  if (runs.length === 0) return hasActiveRuns ? "active runs (still running)" : "active runs (none)";
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = stringFieldOrUndefined(run, "status") ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  if (runs.length === 1) return `1 run ${stringFieldOrUndefined(runs[0], "status") ?? "unknown"}`;
  const parts = [...counts.entries()].map(([status, count]) => `${count} ${status}`);
  return `${runs.length} runs (${parts.join(", ")})`;
}

function buildAgentWait(name: string, result: unknown, options: unknown, theme: unknown): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const runs = recordArrayFieldOrEmpty(details, "runs");
  const hasActiveRuns = boolFieldOrUndefined(details, "hasActiveRuns") === true;
  const statuses = runs.map((run) => stringFieldOrUndefined(run, "status") ?? "").filter((status) => status !== "");
  const header = headerSpec(name, summarizeRunStatuses(runs, hasActiveRuns), aggregateStatusColor(statuses, hasActiveRuns ? "warning" : dotFromDetails(details) as "success" | "warning" | "error"), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  runs.forEach((run, index) => {
    if (index > 0) entries.push({ text: "" });
    const headline = [stringFieldOrUndefined(run, "agent_id"), stringFieldOrUndefined(run, "run_id"), stringFieldOrUndefined(run, "status")].filter((part): part is string => part !== undefined && part !== "").join(" · ");
    entries.push({ text: themeFg(theme, "dim", headline), exempt: true });
    const body = stringFieldOrUndefined(run, "finalOutput") ?? stringFieldOrUndefined(run, "error") ?? (boolFieldOrUndefined(run, "outputAvailable") === false ? "(output unavailable)" : "");
    if (body !== "") entries.push(...fullTextEntries(body, theme));
  });
  if (entries.length === 0) entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}

function buildAgentClose(name: string, result: unknown, options: unknown, theme: unknown): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const ids = stringArrayFieldOrEmpty(details, "agent_ids");
  const subject = ids.length === 0 ? "none" : ids.length === 1 ? ids[0] : ids.length <= 3 ? ids.join(", ") : `${ids.length} agents`;
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [{ text: themeFg(theme, "dim", `Closed count: ${ids.length}`), exempt: true }];
  entries.push(...ids.map((id) => ({ text: themeFg(theme, "toolOutput", id) })));
  return { header, body: { mode: "rail", entries } };
}

function buildAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  if (name === "agent_profiles") return buildAgentProfiles(name, result, options, theme);
  if (name === "agent_list") return buildAgentList(name, result, options, theme, args);
  if (name === "agent_spawn") return buildAgentSpawn(name, result, options, theme, args);
  if (name === "agent_send") return buildAgentSend(name, result, options, theme, args);
  if (name === "agent_wait") return buildAgentWait(name, result, options, theme);
  return buildAgentClose(name, result, options, theme);
}

function buildRalph(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
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

function exaResults(details: Record<string, unknown>): Record<string, unknown>[] {
  const response = recordFieldOrUndefined(details, "response") ?? {};
  return recordArrayFieldOrEmpty(response, "results");
}

function buildExaSearch(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
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

function buildCodeContext(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordFieldOrUndefined(details, "response") ?? {};
  const text = stringFieldOrUndefined(response, "response") ?? textContent(result);
  const lineCount = text === "" ? 0 : text.trimEnd().split(/\r?\n/).length;
  const header = headerSpec(name, quotedQuery(args), dotFromDetails(details), theme, lineCount > 0 ? themeFg(theme, "dim", `(${lineCount} lines)`) : "");
  return expanded ? { header, body: { mode: "rail", entries: fullTextEntries(text, theme) } } : { header, body: undefined };
}

function responseObject(details: Record<string, unknown>): Record<string, unknown> {
  return recordFieldOrUndefined(details, "response") ?? {};
}

function buildExaAgent(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = responseObject(details);
  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    const items = recordArrayFieldOrEmpty(response, "data").length > 0 ? recordArrayFieldOrEmpty(response, "data") : recordArrayFieldOrEmpty(response, "results");
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
  const output = recordFieldOrUndefined(response, "output");
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

export function buildDomainResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Block | undefined {
  if (name === "get_goal" || name === "create_goal" || name === "update_goal") return buildGoal(name, result, options, theme, args);
  if (name.startsWith("cron_")) return buildCron(name, result, options, theme, args);
  if (name === "query_threads") return buildQueryThreads(name, result, options, theme, args);
  if (name === "read_thread") return buildReadThread(name, result, options, theme, args);
  if (name.startsWith("agent_")) return buildAgent(name, result, options, theme, args);
  if (name === "ralph_continue" || name === "ralph_finish") return buildRalph(name, result, options, theme, args);
  if (name === "get_code_context_exa") return buildCodeContext(name, result, options, theme, args);
  if (name === "web_search_exa" || name === "crawling_exa") return buildExaSearch(name, result, options, theme, args);
  if (name.startsWith("exa_agent_")) return buildExaAgent(name, result, options, theme, args);
  return undefined;
}
