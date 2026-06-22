import { Text } from "@earendil-works/pi-tui";

type Status = { readonly text: string; readonly color: string };

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

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
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

function statusFromDetails(details: Record<string, unknown>): Status {
  if (numberField(details, "sessionId") !== undefined || numberField(details, "session_id") !== undefined) {
    const id = numberField(details, "sessionId") ?? numberField(details, "session_id");
    return { text: `running session ${id}`, color: "accent" };
  }
  const exitCode = numberField(details, "exitCode") ?? numberField(details, "code");
  if (exitCode !== undefined) {
    return exitCode === 0
      ? { text: "exit 0", color: "success" }
      : { text: `exit ${exitCode}`, color: "error" };
  }
  return boolField(details, "ok") === false
    ? { text: "failed", color: "error" }
    : { text: "done", color: "success" };
}

function header(name: string, inline: string, status: Status, theme: unknown): string {
  const suffix = inline === "" ? "" : ` ${themeFg(theme, "muted", "-")} ${themeFg(theme, "toolOutput", inline)}`;
  return `${themeFg(theme, status.color, status.text)} ${themeFg(theme, "toolTitle", name)}${suffix}`;
}

function callLine(name: string, inline: string, progress: string, theme: unknown): string {
  const suffix = inline === "" ? "" : ` ${themeFg(theme, "muted", "-")} ${themeFg(theme, "toolOutput", inline)}`;
  return `${themeFg(theme, "accent", "...")} ${themeFg(theme, "toolTitle", name)}${suffix} ${themeFg(theme, "dim", `(${progress})`)}`;
}

function limitedText(value: string, expanded: boolean, theme: unknown, compactLines = 8, expandedLines = 120): string {
  const cleaned = value.trimEnd();
  if (cleaned === "") return themeFg(theme, "dim", "  (no output)");
  const lines = cleaned.split(/\r?\n/);
  const limit = expanded ? expandedLines : compactLines;
  const omitted = Math.max(0, lines.length - limit);
  const visible = omitted > 0 ? lines.slice(-limit) : lines;
  const prefix = omitted > 0 ? `${themeFg(theme, "muted", `  ... ${omitted} earlier lines (expand for more)`)}\n` : "";
  return prefix + visible.map((line) => themeFg(theme, "toolOutput", `  ${expanded ? line : truncate(line, 220)}`)).join("\n");
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

function renderItems(items: Record<string, unknown>[], expanded: boolean, theme: unknown): string {
  const limit = expanded ? 30 : 5;
  const visible = items.slice(0, limit);
  const lines = visible.map((item, index) => {
    const title = listItemTitle(item, `item ${index + 1}`);
    const url = stringField(item, "url");
    const id = stringField(item, "id");
    const count = numberField(item, "messageCount") ?? numberField(item, "message_count");
    const status = stringField(item, "status");
    const parts = [
      url,
      id !== undefined && id !== title ? `id: ${id}` : undefined,
      count !== undefined ? `${count} messages` : undefined,
      status !== undefined ? `status: ${status}` : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    const description = resultDescription(item);
    const base = `${themeFg(theme, "accent", `${index + 1}.`)} ${themeFg(theme, "toolOutput", title)}`;
    const meta = parts.length === 0 ? "" : `\n   ${themeFg(theme, "dim", parts.join(" · "))}`;
    const detail = description === undefined || description === "" ? "" : `\n   ${themeFg(theme, "muted", truncate(oneLine(description), expanded ? 900 : 220))}`;
    return `${base}${meta}${detail}`;
  });
  if (items.length > limit) {
    lines.push(themeFg(theme, "dim", `... ${items.length - limit} more (expand for more)`));
  }
  return lines.length === 0 ? themeFg(theme, "dim", "  (none)") : lines.join("\n");
}

function inlineForTool(name: string, args: Record<string, unknown>, expanded: boolean): string {
  const maxChars = expanded ? 400 : 120;
  switch (name) {
    case "exec_command":
      return truncate(oneLine(stringField(args, "cmd") ?? "exec_command"), maxChars);
    case "write_stdin": {
      const chars = stringField(args, "chars") ?? "";
      if (chars.trim() !== "") return truncate(oneLine(chars), maxChars);
      const sessionId = numberField(args, "session_id");
      return sessionId === undefined ? "poll" : `session ${sessionId}`;
    }
    case "write":
    case "edit":
      return truncate(stringField(args, "path") ?? "", maxChars);
    case "apply_patch":
      return truncate(oneLine(stringField(args, "input") ?? stringField(args, "patch") ?? "patch"), maxChars);
    case "agent":
      return truncate([stringField(args, "action") ?? "list", stringField(args, "id") ?? stringField(args, "agent")].filter(Boolean).join(" "), maxChars);
    case "create_goal":
      return truncate(oneLine(stringField(args, "objective") ?? ""), maxChars);
    case "update_goal":
      return stringField(args, "status") ?? "";
    case "request_user_input": {
      const questions = Array.isArray(args["questions"]) ? args["questions"].length : 0;
      return `${questions} question${questions === 1 ? "" : "s"}`;
    }
    case "find_thread":
      return truncate(oneLine(stringField(args, "query") ?? ""), maxChars);
    case "read_thread":
      return truncate(oneLine(stringField(args, "threadID") ?? ""), maxChars);
    case "ralph_continue":
    case "ralph_finish":
      return truncate(stringField(args, "task_id") ?? "", maxChars);
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return truncate(oneLine(stringField(args, "query") ?? ""), maxChars);
    case "crawling_exa": {
      const urls = Array.isArray(args["urls"]) ? args["urls"].length : 0;
      const ids = Array.isArray(args["ids"]) ? args["ids"].length : 0;
      return urls > 0 ? `${urls} url${urls === 1 ? "" : "s"}` : `${ids} id${ids === 1 ? "" : "s"}`;
    }
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return truncate(stringField(args, "id") ?? "", maxChars);
    case "exa_agent_list_runs":
      return args["limit"] === undefined ? "recent runs" : `limit ${args["limit"]}`;
    default:
      return "";
  }
}

function renderShellResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const output = stringField(details, "output") ?? textContent(result);
  const title = name === "write_stdin" && (stringField(args, "chars") ?? "") === "" ? "poll" : name;
  return new Text(`${header(title, inlineForTool(name, args, expanded), statusFromDetails(details), theme)}\n${limitedText(output, expanded, theme)}`, 0, 0);
}

function renderMutationResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const status = statusFromDetails(details);
  const path = stringField(details, "displayPath") ?? stringField(details, "path") ?? inlineForTool(name, args, expanded);
  const summary =
    name === "write"
      ? `${numberField(details, "byteLength") ?? 0} bytes`
      : name === "edit"
        ? `${numberField(details, "editCount") ?? 0} replacement${numberField(details, "editCount") === 1 ? "" : "s"}`
        : [
            `${recordArrayField(details, "writes").length} write${recordArrayField(details, "writes").length === 1 ? "" : "s"}`,
            `${stringArrayField(details, "deletes").length} delete${stringArrayField(details, "deletes").length === 1 ? "" : "s"}`,
          ].join(" · ");
  const lines = [header(name, path, status, theme), `  ${themeFg(theme, "muted", summary)}`];
  if (expanded) {
    const affected = stringArrayField(details, "affectedPaths");
    const writes = recordArrayField(details, "writes").map((write) => stringField(write, "path")).filter(Boolean);
    const deletes = stringArrayField(details, "deletes");
    const detailLines = [...affected, ...writes, ...deletes];
    if (detailLines.length > 0) {
      lines.push(...detailLines.slice(0, 80).map((item) => themeFg(theme, "toolOutput", `  ${item}`)));
    } else {
      lines.push(limitedText(textContent(result), expanded, theme));
    }
  }
  return new Text(lines.join("\n"), 0, 0);
}

function renderGoalResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const goal = recordField(details, "goal");
  const inline = goal === undefined ? inlineForTool(name, args, expanded) : stringField(goal, "objective") ?? "";
  const lines = [header(name, truncate(oneLine(inline), expanded ? 300 : 120), statusFromDetails(details), theme)];
  if (goal !== undefined) {
    const parts = [
      stringField(goal, "status"),
      numberField(goal, "tokensUsed") !== undefined ? `${numberField(goal, "tokensUsed")} tokens` : undefined,
      numberField(goal, "timeUsedSeconds") !== undefined ? `${numberField(goal, "timeUsedSeconds")}s` : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");
    if (parts.length > 0) lines.push(`  ${themeFg(theme, "dim", parts.join(" · "))}`);
  }
  if (expanded) lines.push(limitedText(textContent(result), true, theme));
  return new Text(lines.join("\n"), 0, 0);
}

function renderRequestInputResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const answers = recordField(details, "answers") ?? {};
  const lines = [header(name, inlineForTool(name, args, expanded), statusFromDetails(details), theme)];
  for (const [id, value] of Object.entries(answers)) {
    const answer = isRecord(value) ? stringField(value, "answer") : undefined;
    lines.push(`  ${themeFg(theme, "accent", `${id}:`)} ${themeFg(theme, "toolOutput", answer ?? compactJson(value))}`);
  }
  if (expanded && lines.length === 1) lines.push(limitedText(textContent(result), true, theme));
  return new Text(lines.join("\n"), 0, 0);
}

function renderThreadResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const lines = [header(name, inlineForTool(name, args, expanded), statusFromDetails(details), theme)];
  const threads = recordArrayField(details, "threads");
  if (threads.length > 0) {
    lines.push(renderItems(threads, expanded, theme));
  } else {
    const thread = recordField(details, "thread");
    if (thread !== undefined) {
      lines.push(`  ${themeFg(theme, "toolOutput", stringField(thread, "title") ?? stringField(thread, "id") ?? "thread")}`);
    }
    lines.push(limitedText(textContent(result), expanded, theme, name === "read_thread" ? 10 : 6, 180));
  }
  return new Text(lines.join("\n"), 0, 0);
}

function renderAgentResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const lines = [header(name, inlineForTool(name, args, expanded), statusFromDetails(details), theme)];
  const worker = recordField(details, "worker");
  const workers = recordArrayField(details, "workers");
  if (worker !== undefined) {
    lines.push(`  ${themeFg(theme, "toolOutput", stringField(worker, "id") ?? "worker")} ${themeFg(theme, "dim", `${stringField(worker, "lifecycle") ?? ""} · ${stringField(worker, "sandbox") ?? ""}`)}`);
  } else if (workers.length > 0) {
    lines.push(renderItems(workers, expanded, theme));
  }
  if (expanded) lines.push(limitedText(textContent(result), true, theme));
  return new Text(lines.join("\n"), 0, 0);
}

function renderRalphResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const taskId = stringField(details, "taskId") ?? inlineForTool(name, args, expanded);
  const parts = [
    stringField(details, "status"),
    numberField(details, "iteration") !== undefined ? `iteration ${numberField(details, "iteration")}` : undefined,
    boolField(details, "reflection") === true ? "reflection" : undefined,
  ].filter((part): part is string => part !== undefined);
  const lines = [header(name, taskId, statusFromDetails(details), theme), `  ${themeFg(theme, "dim", parts.join(" · ") || textContent(result))}`];
  if (expanded) lines.push(limitedText(textContent(result), true, theme));
  return new Text(lines.join("\n"), 0, 0);
}

function renderExaResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const response = recordField(details, "response") ?? {};
  const lines = [header(name, inlineForTool(name, args, expanded), statusFromDetails(details), theme)];
  const results = recordArrayField(response, "results");
  const data = recordArrayField(response, "data");
  if (results.length > 0) {
    lines.push(renderItems(results, expanded, theme));
  } else if (data.length > 0) {
    lines.push(renderItems(data, expanded, theme));
  } else {
    const output = recordField(response, "output");
    const text = stringField(response, "response") ?? (output === undefined ? undefined : stringField(output, "text")) ?? textContent(result);
    lines.push(limitedText(text, expanded, theme, 10, 180));
  }
  return new Text(lines.join("\n"), 0, 0);
}

function renderGenericResult(name: string, result: unknown, options: unknown, theme: unknown, args: Record<string, unknown>): Text {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result);
  const text = textContent(result);
  const body = expanded ? (text === "" ? compactJson(details) : text) : text;
  return new Text(`${header(name, inlineForTool(name, args, expanded), statusFromDetails(details), theme)}\n${limitedText(body, expanded, theme)}`, 0, 0);
}

function progressText(name: string): string {
  if (name === "request_user_input") return "waiting for user input";
  if (name.startsWith("exa_") || name.endsWith("_exa")) return "waiting for Exa";
  if (name === "find_thread") return "searching threads";
  if (name === "read_thread") return "reading thread";
  return "running";
}

export function renderersForTool(name: string) {
  return {
    renderCall(args: unknown, theme: unknown, context: unknown) {
      if (isRecord(context) && context["isPartial"] === false) return new Text("", 0, 0);
      return new Text(callLine(name, inlineForTool(name, isRecord(args) ? args : {}, false), progressText(name), theme), 0, 0);
    },
    renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
      if (isRecord(options) && options["isPartial"] === true) {
        return new Text(themeFg(theme, "warning", `${name} ${progressText(name)}...`), 0, 0);
      }
      const args = argsFromContext(context);
      if (name === "exec_command" || name === "write_stdin") return renderShellResult(name, result, options, theme, args);
      if (name === "write" || name === "edit" || name === "apply_patch") return renderMutationResult(name, result, options, theme, args);
      if (name === "get_goal" || name === "create_goal" || name === "update_goal") return renderGoalResult(name, result, options, theme, args);
      if (name === "request_user_input") return renderRequestInputResult(name, result, options, theme, args);
      if (name === "find_thread" || name === "read_thread") return renderThreadResult(name, result, options, theme, args);
      if (name === "agent") return renderAgentResult(name, result, options, theme, args);
      if (name === "ralph_continue" || name === "ralph_finish") return renderRalphResult(name, result, options, theme, args);
      if (name.endsWith("_exa") || name.startsWith("exa_agent_")) return renderExaResult(name, result, options, theme, args);
      return renderGenericResult(name, result, options, theme, args);
    },
  };
}
