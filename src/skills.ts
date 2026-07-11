import type { CoreBridge, PiLike } from "./types.ts";
import { decodeSkillResolveResult, type SkillResolveResult } from "./bridge-contracts.ts";

type PromptEvent = {
  text?: unknown; prompt?: unknown; content?: unknown; message?: unknown; input?: unknown;
  messages?: unknown;
};
type PromptMessage = { role?: unknown; content?: unknown };
type SkillContext = { cwd?: unknown; ui?: unknown };
type NotificationUi = { notify: (message: string, level: "warning") => unknown };

function objectValue<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Partial<T>
    : undefined;
}

function notificationUi(value: unknown): NotificationUi | undefined {
  const candidate = objectValue<NotificationUi>(value);
  return typeof candidate?.notify === "function" ? candidate as NotificationUi : undefined;
}

function promptFromEvent(event: unknown): string {
  const source = objectValue<PromptEvent>(event);
  if (source === undefined) return "";
  for (const key of ["text", "prompt", "content", "message", "input"]) {
    const value = source[key as keyof PromptEvent];
    if (typeof value === "string") return value;
  }
  const messages = source.messages;
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const candidate = objectValue<PromptMessage>(message);
      if (candidate?.role === "user" && typeof candidate.content === "string") {
        return candidate.content;
      }
    }
  }
  return "";
}

function notifyWarnings(result: SkillResolveResult, ctx?: unknown): void {
  const warnings = result.warnings;
  const context = objectValue<SkillContext>(ctx);
  const ui = notificationUi(context?.ui);
  if (warnings.length === 0 || ui === undefined) return;
  for (const warning of warnings) {
    ui.notify(warning.message, "warning");
  }
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
    const context = objectValue<SkillContext>(ctx);
    const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
    const result = decodeSkillResolveResult(core.call("resolveSkillMentions", [{ prompt, cwd, ctx }]));
    notifyWarnings(result, ctx);
    const blocks = result.blocks;
    if (blocks.length === 0) return { action: "continue" };
    if (typeof pi.sendMessage !== "function" || typeof pi.sendUserMessage !== "function") {
      return { action: "continue" };
    }
    let sentCount = 0;
    for (const block of blocks) {
      const { content, name } = block;
      sentCount += 1;
      await pi.sendMessage({
        customType: "skill",
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
