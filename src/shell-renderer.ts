import { Text } from "@earendil-works/pi-tui";

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

function outputFromResult(result: unknown): string {
  if (!isRecord(result)) return "";
  const details = isRecord(result["details"]) ? result["details"] : {};
  return stringField(details, "output") ?? textContent(result);
}

function tailLines(output: string, maxLines: number): { lines: string[]; omitted: number } {
  const lines = output.trimEnd() === "" ? [] : output.trimEnd().split(/\r?\n/);
  if (lines.length <= maxLines) return { lines, omitted: 0 };
  return { lines: lines.slice(-maxLines), omitted: lines.length - maxLines };
}

function argsFromContext(context: unknown): Record<string, unknown> {
  return isRecord(context) && isRecord(context["args"]) ? context["args"] : {};
}

function shellInline(toolName: string, args: Record<string, unknown>, expanded: boolean): string {
  const maxChars = expanded ? 400 : 120;
  if (toolName === "exec_command") {
    return truncate(oneLine(stringField(args, "cmd") ?? "exec_command"), maxChars);
  }
  const chars = stringField(args, "chars") ?? "";
  if (chars.trim() !== "") return truncate(oneLine(chars), maxChars);
  const sessionId = numberField(args, "session_id");
  return sessionId === undefined ? "poll" : `session ${sessionId}`;
}

function statusText(result: unknown): { text: string; color: string } {
  if (!isRecord(result)) return { text: "done", color: "success" };
  const details = isRecord(result["details"]) ? result["details"] : {};
  const sessionId = numberField(details, "sessionId") ?? numberField(details, "session_id");
  if (sessionId !== undefined) return { text: `running session ${sessionId}`, color: "accent" };
  const exitCode = numberField(details, "exitCode") ?? numberField(details, "code");
  if (exitCode === undefined) {
    return boolField(details, "ok") === false
      ? { text: "failed", color: "error" }
      : { text: "done", color: "success" };
  }
  return exitCode === 0
    ? { text: "exit 0", color: "success" }
    : { text: `exit ${exitCode}`, color: "error" };
}

function renderOutput(output: string, expanded: boolean, theme: unknown): string {
  const cleaned = output.trimEnd();
  if (cleaned === "") return themeFg(theme, "dim", "  (no output)");
  const { lines, omitted } = tailLines(cleaned, expanded ? 200 : 8);
  const renderedLines = expanded ? lines : lines.map((line) => truncate(line, 200));
  const prefix =
    omitted > 0
      ? `${themeFg(theme, "muted", `  ... ${omitted} earlier lines (expand for more)`)}\n`
      : "";
  return prefix + renderedLines.map((line) => themeFg(theme, "toolOutput", `  ${line}`)).join("\n");
}

export function shellRenderersForTool(name: string) {
  if (name !== "exec_command" && name !== "write_stdin") return {};
  return {
    renderCall(args: unknown, theme: unknown, context: unknown) {
      if (isRecord(context) && context["isPartial"] === false) return new Text("", 0, 0);
      const inline = shellInline(name, isRecord(args) ? args : {}, false);
      return new Text(
        `${themeFg(theme, "toolTitle", name)} ${themeFg(theme, "muted", "-")} ${themeFg(theme, "toolOutput", inline)} ${themeFg(theme, "dim", "(running)")}`,
        0,
        0,
      );
    },
    renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
      const expanded = isRecord(options) && options["expanded"] === true;
      if (isRecord(options) && options["isPartial"] === true) {
        return new Text(themeFg(theme, "warning", `${name} running...`), 0, 0);
      }
      const args = argsFromContext(context);
      const status = statusText(result);
      const title = name === "write_stdin" && (stringField(args, "chars") ?? "") === "" ? "poll" : name;
      const header =
        `${themeFg(theme, status.color, status.text)} ` +
        `${themeFg(theme, "toolTitle", title)} ${themeFg(theme, "muted", "-")} ` +
        themeFg(theme, "toolOutput", shellInline(name, args, expanded));
      return new Text(`${header}\n${renderOutput(outputFromResult(result), expanded, theme)}`, 0, 0);
    },
  };
}
