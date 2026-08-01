import type { Block, Entry } from "./render-layout.ts";
import {
  boolFieldOrUndefined,
  numberFieldOrUndefined,
  recordArrayFieldOrEmpty,
  recordFieldOrUndefined,
  stringFieldOrUndefined,
} from "./util.ts";
import {
  detailsRecord, dotFromDetails, expandedFromOptions, formatTimestampValue, fullTextEntries, headerSpec,
  labeled, labeledText, labeledTimestamp, oneLine, planTaskRow, quotedQuery, textContent, themeFg,
  agentRunStatusColor,
  type ToolRenderFields,
} from "./tool-renderer-kit.ts";
import { formatWaitDuration } from "./util.ts";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

function buildPlan(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const plan = recordFieldOrUndefined<ToolRenderFields>(details, "plan");
  const planTasks = plan !== undefined ? recordArrayFieldOrEmpty<ToolRenderFields>(plan, "tasks") : [];
  const status = plan !== undefined
    ? stringFieldOrUndefined(plan, "statusLabel") ?? stringFieldOrUndefined(plan, "status")
    : undefined;
  const argTasks = recordArrayFieldOrEmpty<ToolRenderFields>(args, "tasks");
  const taskId = stringFieldOrUndefined(args, "taskId");
  const completed = plan !== undefined ? numberFieldOrUndefined(plan, "completedTasks") : undefined;
  const total = plan !== undefined ? numberFieldOrUndefined(plan, "totalTasks") : undefined;
  const progress = completed === undefined || total === undefined ? undefined : `${completed}/${total} tasks`;
  const createdTaskIds = Array.isArray(details["createdTaskIds"])
    ? details["createdTaskIds"].filter((value): value is string => typeof value === "string" && value !== "")
    : [];
  const createdTaskIdSet = new Set(createdTaskIds);
  // Compact subject: create_task keeps titles with short ids when available; update_task is id · title.
  let subject: string;
  if (name === "update_task" && taskId !== undefined) {
    const touched = planTasks.find((task) => stringFieldOrUndefined(task, "taskId") === taskId);
    const title = (touched !== undefined ? stringFieldOrUndefined(touched, "title") : undefined)
      ?? stringFieldOrUndefined(args, "title");
    subject = oneLine(title === undefined || title === "" ? taskId : `${taskId} · ${title}`);
  } else if (name === "create_task") {
    const createdParts = argTasks.map((task, index) => {
      const title = stringFieldOrUndefined(task, "title") ?? "";
      const explicitId = stringFieldOrUndefined(task, "id");
      const id = explicitId ?? createdTaskIds[index];
      if (title === "") return id ?? "";
      return id === undefined ? title : `${id} · ${title}`;
    }).filter(Boolean);
    subject = oneLine(createdParts.join(", ") || progress || name);
  } else {
    subject = oneLine(progress ?? stringFieldOrUndefined(args, "status") ?? name);
  }
  const header = headerSpec(name, subject, dotFromDetails(details), theme, status !== undefined ? themeFg(theme, "dim", `(${status})`) : "");
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  entries.push(...labeled("Status", status, theme));
  entries.push(...labeled("Progress", progress, theme));
  const automation = recordFieldOrUndefined<ToolRenderFields>(details, "automation");
  entries.push(...labeled("Automation", automation !== undefined ? stringFieldOrUndefined(automation, "continuation") : undefined, theme));
  if (details["accountingPending"] === true) entries.push(...labeled("Accounting", "final accounting pending", theme));
  const tokens = plan !== undefined ? numberFieldOrUndefined(plan, "tokensUsed") : undefined;
  const seconds = plan !== undefined ? numberFieldOrUndefined(plan, "timeUsedSeconds") : undefined;
  const timeUsage = plan !== undefined ? stringFieldOrUndefined(plan, "timeUsage") : undefined;
  const timeLimit = plan !== undefined ? numberFieldOrUndefined(plan, "timeLimitSeconds") : undefined;
  if (tokens !== undefined) entries.push(...labeled("Tokens", String(tokens), theme));
  if (timeUsage !== undefined) entries.push(...labeled("Active time", timeUsage, theme));
  else if (seconds !== undefined) entries.push(...labeled("Active time", `${seconds}s`, theme));
  if (timeLimit !== undefined) entries.push(...labeled("Time limit", `${timeLimit}s`, theme));
  // ^render-go01 affected tasks only; ^render-78m0 no plan/session ids.
  const affectedTasks = (() => {
    if (name === "get_plan" || name === "update_plan") return planTasks;
    if (name === "create_task") {
      if (createdTaskIdSet.size > 0) {
        return planTasks.filter((task) => createdTaskIdSet.has(stringFieldOrUndefined(task, "taskId") ?? ""));
      }
      // Fallback when envelope lacks createdTaskIds: last N titles from args.
      return planTasks.slice(Math.max(0, planTasks.length - argTasks.length));
    }
    if (name === "update_task" && taskId !== undefined) {
      return planTasks.filter((task) => stringFieldOrUndefined(task, "taskId") === taskId);
    }
    return planTasks;
  })();
  for (const task of affectedTasks) entries.push(...planTaskRow(task, theme));
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
  entries.push(...labeled("Cron", stringFieldOrUndefined(task, "cron"), theme));
  entries.push(...labeled("Recurrence", boolState(boolFieldOrUndefined(task, "recurring"), "recurring", "one-shot"), theme));
  entries.push(...labeled("Next due", stringFieldOrUndefined(task, "nextDueText"), theme));
  entries.push(...labeled("Prompt", stringFieldOrUndefined(task, "prompt"), theme));
  return entries;
}

function buildCron(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  if (name === "cron_delete") {
    const id = stringFieldOrUndefined(details, "id") ?? stringFieldOrUndefined(args, "id") ?? "";
    const deleted = boolFieldOrUndefined(details, "deleted") === true;
    const outcome = deleted ? "deleted" : "not found";
    const header = headerSpec(name, id, dotFromDetails(details), theme, themeFg(theme, "dim", `(${outcome})`));
    return expanded ? { header, body: { mode: "rail", entries: [...labeled("Task ID", id, theme), ...labeled("Outcome", outcome, theme)] } } : { header, body: undefined };
  }
  if (name === "cron_list") {
    const tasks = recordArrayFieldOrEmpty<ToolRenderFields>(details, "tasks");
    const enabled = boolFieldOrUndefined(details, "enabled") === true;
    const header = headerSpec(name, `${tasks.length} task${tasks.length === 1 ? "" : "s"}`, dotFromDetails(details), theme, themeFg(theme, "dim", `(${enabled ? "enabled" : "disabled"})`));
    if (!expanded) return { header, body: undefined };
    const entries: Entry[] = [...labeled("Master switch", enabled ? "enabled" : "disabled", theme)];
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
  const header = headerSpec(name, [id, schedule].filter((part) => part !== "").join(" · "), dotFromDetails(details), theme, enabled === undefined ? "" : themeFg(theme, "dim", `(${enabled})`));
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
  // Title-first groups (^render-th01 latitude): headline is title; full id stays on a dim labeled ID row.
  threads.slice(0, 30).forEach((thread, index) => {
    if (index > 0) entries.push({ text: "" });
    const title = stringFieldOrUndefined(thread, "title") ?? stringFieldOrUndefined(thread, "id") ?? `thread ${index + 1}`;
    const id = stringFieldOrUndefined(thread, "id");
    const workspace = stringFieldOrUndefined(thread, "workspace");
    const threadHits = recordArrayFieldOrEmpty<ToolRenderFields>(thread, "hits");
    const meta = [workspace, `${threadHits.length} hit${threadHits.length === 1 ? "" : "s"}`].filter((part): part is string => part !== undefined && part !== "");
    entries.push({ text: `${themeFg(theme, "accent", String(index + 1))} ${themeFg(theme, "dim", "·")} ${themeFg(theme, "toolOutput", title)}${meta.length === 0 ? "" : ` ${themeFg(theme, "dim", "·")} ${themeFg(theme, "dim", meta.join(" · "))}`}` });
    entries.push(...labeled("ID", id, theme));
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
    entries.push(...labeled("Messages", messages === undefined ? undefined : String(messages), theme));
  }
  entries.push(...fullTextEntries(textContent(result), theme));
  if (diagnostics.length > 0) {
    entries.push({ text: "" });
    entries.push(...labeled("Diagnostics", String(diagnostics.length), theme));
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

function buildRalph(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const taskId = stringFieldOrUndefined(details, "taskId") ?? stringFieldOrUndefined(args, "task_id") ?? "";
  const iteration = numberFieldOrUndefined(details, "iteration");
  const maxIterations = numberFieldOrUndefined(details, "maxIterations") ?? numberFieldOrUndefined(details, "max_iterations");
  const reflectionEvery = numberFieldOrUndefined(details, "reflectionEvery") ?? numberFieldOrUndefined(details, "reflection_every");
  const facts = [iteration !== undefined ? `iteration ${iteration}` : undefined, stringFieldOrUndefined(details, "status")].filter((part): part is string => part !== undefined && part !== "");
  const header = headerSpec(name, taskId, dotFromDetails(details), theme, facts.length > 0 ? themeFg(theme, "dim", `(${facts.join(" · ")})`) : "");
  if (!expanded) return { header, body: undefined };
  // Header already carries task id (^render-ra01); omit the redundant body Task ID row.
  const entries = [
    ...labeled("Iteration", iteration === undefined ? undefined : String(iteration), theme),
    ...labeled("Status", stringFieldOrUndefined(details, "status"), theme),
  ];
  if (boolFieldOrUndefined(details, "reflection") === true) entries.push(...labeled("Reflection", "true", theme));
  entries.push(...labeled("Max iterations", maxIterations === undefined ? undefined : String(maxIterations), theme));
  entries.push(...labeled("Reflection every", reflectionEvery === undefined ? undefined : String(reflectionEvery), theme));
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
      const when = formatTimestampValue(item["createdAt"] ?? item["updatedAt"] ?? item["timestamp"] ?? item["created_at"] ?? item["updated_at"]);
      entries.push({ text: [themeFg(theme, "toolOutput", title), stringFieldOrUndefined(item, "status"), when].filter((part): part is string => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `) });
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
    ...labeled("Run ID", id, theme),
    ...labeled("Status", status, theme),
    ...labeledTimestamp("Created", response["createdAt"] ?? response["created_at"], theme),
    ...labeledTimestamp("Updated", response["updatedAt"] ?? response["updated_at"], theme),
    ...labeled("Error", stringFieldOrUndefined(response, "error"), theme),
    ...fullTextEntries(text, theme),
  ];
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}

// ^agent-8xkn: expanded agent_list uses labeled fields per identity, not a flat ·-joined line.
function agentListEntries(item: ToolRenderFields, theme: unknown): Entry[] {
  const status = stringFieldOrUndefined(item, "status")
    ?? stringFieldOrUndefined(item, "latest_run_status");
  const activity = recordFieldOrUndefined<ToolRenderFields>(item, "activity");
  const activityState = activity === undefined ? undefined : stringFieldOrUndefined(activity, "state");
  const showActivity = status === "running" && activityState !== undefined && activityState !== "" && activityState !== "inactive";
  const turns = numberFieldOrUndefined(item, "turn_count") ?? numberFieldOrUndefined(item, "turnCount");
  return [
    ...labeled("Agent", stringFieldOrUndefined(item, "agent_id"), theme),
    ...labeled("Kind", stringFieldOrUndefined(item, "kind"), theme),
    ...labeled("Status", status, theme),
    ...labeled("Activity", showActivity ? activityState : undefined, theme),
    ...labeled("Description", stringFieldOrUndefined(item, "description"), theme),
    ...labeled("Run ID", stringFieldOrUndefined(item, "run_id") ?? stringFieldOrUndefined(item, "latest_run_id"), theme),
    ...labeled("Turns", turns === undefined ? undefined : String(turns), theme),
    ...labeled("Model", stringFieldOrUndefined(item, "model"), theme),
    ...labeled("Thinking", stringFieldOrUndefined(item, "thinking"), theme),
    ...labeled("Workspace", stringFieldOrUndefined(item, "workspace"), theme),
  ];
}

function agentResultEntries(item: ToolRenderFields, theme: unknown): Entry[] {
  const duration = formatWaitDuration(item["duration_ms"]);
  return [
    ...labeled("Agent", stringFieldOrUndefined(item, "agent_id"), theme),
    ...labeled("Run ID", stringFieldOrUndefined(item, "run_id"), theme),
    ...labeled("Kind", stringFieldOrUndefined(item, "kind"), theme),
    ...labeled("Model", stringFieldOrUndefined(item, "model"), theme),
    ...labeled("Thinking", stringFieldOrUndefined(item, "thinking"), theme),
    ...labeled("Status", stringFieldOrUndefined(item, "status"), theme),
    // ^agentui-5qzn: expanded runs carry their work and duration telemetry.
    ...labeled("Turns", numberFieldOrUndefined(item, "turn_count")?.toString(), theme),
    ...labeled("Tool calls", numberFieldOrUndefined(item, "tool_call_count")?.toString(), theme),
    ...labeled("Failed tool calls", numberFieldOrUndefined(item, "failed_tool_call_count")?.toString(), theme),
    ...labeled("Duration", duration === "" ? undefined : duration, theme),
  ];
}

function buildAgent(name: string, result: unknown, options: unknown, theme: unknown, args: ToolRenderFields): Block {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const agents = recordArrayFieldOrEmpty<ToolRenderFields>(details, "agents");
  const results = recordArrayFieldOrEmpty<ToolRenderFields>(details, "results");
  const agentId = stringFieldOrUndefined(details, "agentId")
    ?? stringFieldOrUndefined(args, "agent_id")
    ?? "";
  const runId = stringFieldOrUndefined(details, "runId") ?? "";
  const kind = stringFieldOrUndefined(details, "kind")
    ?? (["finder", "oracle", "code_reviewer", "code_quality_reviewer"].includes(name)
      ? name.replaceAll("_", "-")
      : "generic");
  const status = stringFieldOrUndefined(details, "status")
    ?? stringFieldOrUndefined(details, "outcome");
  let dotColor = dotFromDetails(details);
  let subject: string;
  let trailing = "";
  if (name === "agent_list") subject = `${agents.length} agent${agents.length === 1 ? "" : "s"}`;
  else if (name === "agent_wait") {
    const pending = Array.isArray(details["pending_run_ids"]) ? details["pending_run_ids"].length : 0;
    const total = results.length + pending;
    const singleRun = results.length === 1 && pending === 0 ? results[0] : undefined;
    if (singleRun !== undefined) {
      // ^agentui-s3jx: a single observed run is named; the semantic color
      // lives on the status dot and the status word stays plain; counts stay
      // for multi-run waits (^agentui-hdst).
      const runStatus = stringFieldOrUndefined(singleRun, "status") ?? "";
      const runReason = stringFieldOrUndefined(singleRun, "reason");
      const statusText = runReason !== undefined && runStatus !== "completed"
        ? `${runStatus} (${runReason})`
        : runStatus;
      const duration = formatWaitDuration(singleRun["duration_ms"]);
      dotColor = agentRunStatusColor(runStatus);
      subject = [
        stringFieldOrUndefined(singleRun, "agent_id") ?? agentId,
        statusText,
        duration,
      ].filter((part) => part !== "").join(" · ");
    } else {
      subject = `${total} run${total === 1 ? "" : "s"}`;
      trailing = themeFg(theme, "dim", `(${results.length} ready, ${pending} pending)`);
    }
  } else if (name === "agent_spawn") {
    // agentui-weo6 / agent-9ach: handle already encodes tier (agent-medium-…),
    // so compact subject is handle · description only.
    subject = [agentId, stringFieldOrUndefined(args, "description")]
      .filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (["finder", "oracle", "code_reviewer", "code_quality_reviewer"].includes(name)) {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "agent_send") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "agent_close") {
    subject = agentId;
    trailing = status === undefined ? "" : themeFg(theme, "dim", `(${status})`);
  } else {
    subject = [agentId, runId, kind, status].filter((part) => part !== "").join(" · ");
  }
  const header = headerSpec(name, subject, dotColor, theme, trailing);
  if (!expanded) return { header, body: undefined };
  const entries: Entry[] = [];
  if (agents.length > 0) {
    agents.forEach((agent, index) => {
      if (index > 0) entries.push({ text: "" });
      entries.push(...agentListEntries(agent, theme));
    });
  } else if (results.length > 0) {
    results.forEach((run, index) => {
      if (index > 0) entries.push({ text: "" });
      entries.push(...agentResultEntries(run, theme));
      entries.push(...labeledTimestamp("Started", run["started_at"] ?? run["startedAt"], theme));
      entries.push(...labeledTimestamp("Ended", run["ended_at"] ?? run["endedAt"] ?? run["suspended_at"] ?? run["suspendedAt"], theme));
      entries.push(...labeled("Reason", stringFieldOrUndefined(run, "reason"), theme));
      entries.push(...labeled("Error", stringFieldOrUndefined(run, "error"), theme));
      entries.push(...labeledText("Response", stringFieldOrUndefined(run, "output"), theme));
      entries.push(...labeledText("Partial response", stringFieldOrUndefined(run, "partial_output"), theme));
    });
  } else if (name === "agent_close") {
    entries.push(...labeled("Agent", agentId, theme));
    entries.push(...labeled("Status", status, theme));
    entries.push(...labeled("Permanent closure", "confirmed", theme));
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
  if (["agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close", "finder", "oracle", "code_reviewer", "code_quality_reviewer"].includes(name)) {
    return buildAgent(name, result, options, theme, args);
  }
  if (name === "get_plan" || name === "create_task" || name === "update_task" || name === "update_plan") return buildPlan(name, result, options, theme, args);
  if (name.startsWith("cron_")) return buildCron(name, result, options, theme, args);
  if (name === "query_threads") return buildQueryThreads(name, result, options, theme, args);
  if (name === "read_thread") return buildReadThread(name, result, options, theme, args);
  if (name === "ralph_continue" || name === "ralph_finish") return buildRalph(name, result, options, theme, args);
  if (name === "get_code_context_exa") return buildCodeContext(name, result, options, theme, args);
  if (name === "web_search_exa" || name === "crawling_exa") return buildExaSearch(name, result, options, theme, args);
  if (name.startsWith("exa_agent_")) return buildExaAgent(name, result, options, theme, args);
  return undefined;
}
