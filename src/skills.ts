import type { CoreBridge, PiLike } from "./types.ts";
import { coreCall, isRecord } from "./util.ts";

function promptFromEvent(event: unknown): string {
  if (!isRecord(event)) return "";
  for (const key of ["text", "prompt", "content", "message", "input"]) {
    const value = event[key];
    if (typeof value === "string") return value;
  }
  const messages = event["messages"];
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isRecord(message) && message["role"] === "user" && typeof message["content"] === "string") {
        return message["content"];
      }
    }
  }
  return "";
}

function notifyWarnings(result: Record<string, unknown>, ctx?: unknown): void {
  const warnings = Array.isArray(result["warnings"])
    ? result["warnings"].filter(isRecord)
    : [];
  if (warnings.length === 0 || !isRecord(ctx) || !isRecord(ctx["ui"])) return;
  const notify = ctx["ui"]["notify"];
  if (typeof notify !== "function") return;
  for (const warning of warnings) {
    if (typeof warning["message"] === "string" && warning["message"] !== "") {
      notify.call(ctx["ui"], warning["message"], "warning");
    }
  }
}

function mentionPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9$\\\\])\\$${escaped}(?=[^a-z0-9-]|$)`, "g");
}

function stripResolvedMentions(text: string, names: readonly string[]): string {
  let stripped = text;
  for (const name of names) {
    stripped = stripped.replace(mentionPattern(name), (_match, prefix: string) => prefix);
  }
  return stripped.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

function blockRecords(result: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(result["blocks"]) ? result["blocks"].filter(isRecord) : [];
}

export function installSkillResolver(pi: PiLike, core: CoreBridge): void {
  pi.on("input", async (event, ctx) => {
    const prompt = promptFromEvent(event);
    const cwd = isRecord(ctx) && typeof ctx["cwd"] === "string" ? ctx["cwd"] : process.cwd();
    const result = coreCall(core, "resolveSkillMentions", [{ prompt, cwd }]);
    if (!isRecord(result)) throw new Error("Invalid Taumel skill resolver result");
    notifyWarnings(result, ctx);
    const blocks = blockRecords(result);
    if (blocks.length === 0) return { action: "continue" };
    if (typeof pi.sendMessage !== "function" || typeof pi.sendUserMessage !== "function") {
      return { action: "continue" };
    }
    const names: string[] = [];
    for (const block of blocks) {
      const content = typeof block["content"] === "string" ? block["content"] : "";
      const name = typeof block["name"] === "string" ? block["name"] : "";
      if (content === "" || name === "") continue;
      names.push(name);
      await pi.sendMessage({ customType: "taumel.skill", content, display: true });
    }
    const stripped = stripResolvedMentions(prompt, names);
    await pi.sendUserMessage(stripped);
    return { action: "handled" };
  });
}
