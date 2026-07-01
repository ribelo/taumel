import type { CoreBridge, PiLike } from "./types.ts";
import { coreCall, isRecord } from "./util.ts";
import { skillMessageRenderer } from "./tool-renderer.ts";

function promptFromEvent(event: unknown): string {
  if (!isRecord(event)) return "";
  for (const key of ["prompt", "content", "message", "input"]) {
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

export function installSkillResolver(pi: PiLike, core: CoreBridge): void {
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("taumel.skill", skillMessageRenderer());
  }
  pi.on("before_agent_start", (event, ctx) => {
    const prompt = promptFromEvent(event);
    const cwd = isRecord(ctx) && typeof ctx["cwd"] === "string" ? ctx["cwd"] : process.cwd();
    const result = coreCall(core, "resolveSkillMentions", [{ prompt, cwd }]);
    if (!isRecord(result)) throw new Error("Invalid Taumel skill resolver result");
    notifyWarnings(result, ctx);
    const messages = Array.isArray(result["messages"]) ? result["messages"] : [];
    return messages.length === 0 ? undefined : { messages };
  });
}
