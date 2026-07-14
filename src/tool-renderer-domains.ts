import type { Block, Entry } from "./render-layout.ts";
import {
  boolFieldOrUndefined,
  numberFieldOrUndefined,
  recordArrayFieldOrEmpty,
  recordFieldOrUndefined,
  stringFieldOrUndefined,
} from "./util.ts";
import {
  detailsRecord, dotFromDetails, expandedFromOptions, fullTextEntries, headerSpec,
  oneLine, quotedQuery, textContent, themeFg, type ToolRenderFields,
} from "./tool-renderer-kit.ts";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function labeled(label: string, value: string | undefined, theme: unknown): Entry[] {
  if (value === undefined || value.trim() === "") return [];
  return [{ text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", value)}` }];
}

function labeledText(label: string, value: string | undefined, theme: unknown): Entry[] {
  if (value === undefined || value.trim() === "") return [];
  const lines = value.trimEnd().split(/\r?\n/);
  return [
    { text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", lines[0])}` },
    ...lines.slice(1).map((line) => ({ text: themeFg(theme, "toolOutput", line) })),
  ];
}

function boolState(value: boolean | undefined, trueText: string, falseText: string): string | undefined {
  if (value === undefined) return undefined;
  return value ? trueText : falseText;
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
  const status = goal !== undefined
    ? stringFieldOrUndefined(goal, "statusLabel") ?? stringFieldOrUndefined(goal, "status")
    : undefined;
  const subject = oneLine(objective ?? stringFieldOrUndefined(args, "objective") ?? stringFieldOrUndefined(args, "status") ?? name);
  const header = headerSpec(name, subject, dotFromDetails(details), theme, status !== undefined ? themeFg(theme, "dim", `(${status})`) : "");
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  entries.push(...labeled("Objective", objective, theme));
  entries.push(...labeled("Status", status, theme));
  const automation = recordFieldOrUndefined<ToolRenderFields>(details, "automation");
  entries.push(...labeled("Automation", automation !== undefined ? stringFieldOrUndefined(automation, "continuation") : undefined, theme));
  if (details["accountingPending"] === true) entries.push({ text: themeFg(theme, "dim", "Accounting: final accounting pending"), exempt: true });
  const tokens = goal !== undefined ? numberFieldOrUndefined(goal, "tokensUsed") : undefined;
  const seconds = goal !== undefined ? numberFieldOrUndefined(goal, "timeUsedSeconds") : undefined;
  const timeUsage = goal !== undefined ? stringFieldOrUndefined(goal, "timeUsage") : undefined;
  const timeLimit = goal !== undefined ? numberFieldOrUndefined(goal, "timeLimitSeconds") : undefined;
  if (tokens !== undefined) entries.push({ text: themeFg(theme, "dim", `Tokens: ${tokens}`), exempt: true });
  if (timeUsage !== undefined) entries.push({ text: themeFg(theme, "dim", `Active time: ${timeUsage}`), exempt: true });
  else if (seconds !== undefined) entries.push({ text: themeFg(theme, "dim", `Active time: ${seconds}s`), exempt: true });
  if (timeLimit !== undefined) entries.push({ text: themeFg(theme, "dim", `Time limit: ${timeLimit}s`), exempt: true });
  if (goal !== undefined) {
    entries.push(...labeled("Goal ID", stringFieldOrUndefined(goal, "goalId"), theme));
    entries.push(...labeled("Session ID", stringFieldOrUndefined(goal, "sessionId"), theme));
  }
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
  const cron = stringFieldOrUndefined(task, "cron");
  const nextDueText = stringFieldOrUndefined(task, "nextDueText");
  const details = [
    cron !== undefined ? `cron=${cron}` : undefined,
    boolState(boolFieldOrUndefined(task, "recurring"), "recurring", "one-shot"),
    nextDueText !== undefined ? `next=${nextDueText}` : undefined,
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
  const iteration = numberFieldOrUndefined(details, "iteration");
  const facts = [iteration !== undefined ? `iteration ${iteration}` : undefined, stringFieldOrUndefined(details, "status")].filter((part): part is string => part !== undefined && part !== "");
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
  const urls = args["urls"];
  const ids = args["ids"];
  const subject = name === "crawling_exa"
    ? `${Array.isArray(urls) ? urls.length : Array.isArray(ids) ? ids.length : results.length} ${Array.isArray(urls) ? "urls" : "ids"}`
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
    const data = recordArrayFieldOrEmpty<ToolRenderFields>(response, "data");
    const items = data.length > 0 ? data : recordArrayFieldOrEmpty<ToolRenderFields>(response, "results");
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

function agentLine(item: ToolRenderFields, theme: unknown): string {
  const id = stringFieldOrUndefined(item, "agent_id") ?? "agent";
  const kind = stringFieldOrUndefined(item, "kind") ?? "generic";
  const status = stringFieldOrUndefined(item, "status")
    ?? stringFieldOrUndefined(item, "latest_run_status")
    ?? "idle";
  const model = stringFieldOrUndefined(item, "model") ?? "";
  const thinking = stringFieldOrUndefined(item, "thinking") ?? "";
  const activity = recordFieldOrUndefined<ToolRenderFields>(item, "activity");
  const activitySummary = activity === undefined ? "" : [
    stringFieldOrUndefined(activity, "state"),
    stringFieldOrUndefined(activity, "last_at"),
    stringFieldOrUndefined(activity, "recommendation"),
  ].filter((part) => part !== undefined && part !== "").join("/");
  const turns = typeof item.turn_count === "number" ? `${item.turn_count} turns` : "";
  return [
    themeFg(theme, "toolOutput", id), kind, status,
    stringFieldOrUndefined(item, "run_id") ?? "",
    turns, activitySummary,
    stringFieldOrUndefined(item, "workspace") ?? "",
    stringFieldOrUndefined(item, "effort") ?? "",
    model, thinking,
  ]
    .filter((part) => part !== "")
    .join(` ${themeFg(theme, "dim", "·")} `);
}

function agentResultEntries(item: ToolRenderFields, theme: unknown): Entry[] {
  return [
    ...labeled("Agent", stringFieldOrUndefined(item, "agent_id"), theme),
    ...labeled("Run", stringFieldOrUndefined(item, "run_id"), theme),
    ...labeled("Kind", stringFieldOrUndefined(item, "kind"), theme),
    ...labeled("Model", stringFieldOrUndefined(item, "model"), theme),
    ...labeled("Thinking", stringFieldOrUndefined(item, "thinking"), theme),
    ...labeled("Status", stringFieldOrUndefined(item, "status"), theme),
  ];
}

function buildAgent(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const agents = recordArrayFieldOrEmpty<ToolRenderFields>(details, "agents");
  const results = recordArrayFieldOrEmpty<ToolRenderFields>(details, "results");
  const agentId = stringFieldOrUndefined(details, "agent_id")
    ?? stringFieldOrUndefined(args, "agent_id")
    ?? "";
  const runId = stringFieldOrUndefined(details, "run_id") ?? "";
  const kind = stringFieldOrUndefined(details, "kind")
    ?? (name === "finder" || name === "oracle" ? name : "generic");
  const status = stringFieldOrUndefined(details, "status")
    ?? stringFieldOrUndefined(details, "outcome");
  let subject: string;
  if (name === "agent_list") subject = `${agents.length} agent${agents.length === 1 ? "" : "s"}`;
  else if (name === "agent_wait") {
    const pending = Array.isArray(details["pending_run_ids"]) ? details["pending_run_ids"].length : 0;
    subject = `${results.length} ready · ${pending} pending`;
  } else if (name === "agent_spawn") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "finder" || name === "oracle") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "agent_send") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else {
    subject = [agentId, runId, kind, status].filter((part) => part !== "").join(" · ");
  }
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  if (agents.length > 0) {
    for (const agent of agents) entries.push({ text: agentLine(agent, theme) });
  } else if (results.length > 0) {
    for (const run of results) {
      entries.push(...agentResultEntries(run, theme));
      entries.push(...labeled("Started", stringFieldOrUndefined(run, "started_at"), theme));
      entries.push(...labeled("Ended", stringFieldOrUndefined(run, "ended_at") ?? stringFieldOrUndefined(run, "suspended_at"), theme));
      entries.push(...labeled("Reason", stringFieldOrUndefined(run, "reason"), theme));
      entries.push(...labeled("Error", stringFieldOrUndefined(run, "error"), theme));
      entries.push(...labeledText("Response", stringFieldOrUndefined(run, "output"), theme));
      entries.push(...labeledText("Partial response", stringFieldOrUndefined(run, "partial_output"), theme));
    }
  } else {
    entries.push(...agentResultEntries({
      agent_id: agentId,
      run_id: runId,
      kind,
      model: details["model"],
      thinking: details["thinking"],
      status,
    }, theme));
    entries.push(...labeled("Description", stringFieldOrUndefined(args, "description"), theme));
    if (name === "finder") {
      entries.push(...labeledText("Query", stringFieldOrUndefined(args, "query"), theme));
    } else {
      entries.push(...labeledText("Message", stringFieldOrUndefined(args, "message"), theme));
    }
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

export function buildDomainResult(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block | undefined {
  if (["agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close", "finder", "oracle"].includes(name)) {
    return buildAgent(name, result, options, theme, args);
  }
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
