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

function blockRecords(result: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(result["blocks"]) ? result["blocks"].filter(isRecord) : [];
}

export function installSkillResolver(pi: PiLike, core: CoreBridge): void {
  const bypassOnce = new Map<string, number>();
  pi.on("input", async (event, ctx) => {
    const prompt = promptFromEvent(event);
    const bypassCount = bypassOnce.get(prompt) ?? 0;
    if (bypassCount > 0) {
      if (bypassCount === 1) bypassOnce.delete(prompt);
      else bypassOnce.set(prompt, bypassCount - 1);
      return { action: "continue" };
    }
    const cwd = isRecord(ctx) && typeof ctx["cwd"] === "string" ? ctx["cwd"] : process.cwd();
    const result = coreCall(core, "resolveSkillMentions", [{ prompt, cwd }]);
    if (!isRecord(result)) throw new Error("Invalid Taumel skill resolver result");
    notifyWarnings(result, ctx);
    const blocks = blockRecords(result);
    if (blocks.length === 0) return { action: "continue" };
    if (typeof pi.sendMessage !== "function" || typeof pi.sendUserMessage !== "function") {
      return { action: "continue" };
    }
    let sentCount = 0;
    for (const block of blocks) {
      const content = typeof block["content"] === "string" ? block["content"] : "";
      const name = typeof block["name"] === "string" ? block["name"] : "";
      if (content === "" || name === "") continue;
      sentCount += 1;
      await pi.sendMessage({
        customType: "taumel.skill",
        content,
        display: true,
        details: { source: "auto-skill-mention", trigger: `$${name}`, name },
      });
    }
    if (sentCount === 0) return { action: "continue" };
    bypassOnce.set(prompt, (bypassOnce.get(prompt) ?? 0) + 1);
    await pi.sendUserMessage(prompt);
    return { action: "handled" };
  });
}
