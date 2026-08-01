import type { CoreBridge, PiLike } from "./types.ts";
import { decodeSkillExpansionEffects, type SkillExpansionEffects } from "./bridge-contracts.ts";
import { objectValue } from "./util.ts";

type PromptEvent = {
  text?: unknown; prompt?: unknown; content?: unknown; message?: unknown; input?: unknown;
  messages?: unknown;
};
type PromptMessage = { role?: unknown; content?: unknown };
type SkillContext = { cwd?: unknown; ui?: unknown };
type NotificationUi = { notify: (message: string, level: "warning") => unknown };
export type SkillExpansionFacts = {
  readonly text: string;
  readonly cwd: string;
  readonly ctx?: unknown;
};

export type SkillExpansionPlan = Readonly<{
  text: string;
  messages: SkillExpansionEffects["messages"];
  warnings: SkillExpansionEffects["warnings"];
}>;
type SkillMessage = SkillExpansionPlan["messages"][number];

export type SkillExpansionDestination = {
  readonly notifyWarning: (message: string) => unknown | Promise<unknown>;
  readonly sendMessage: (message: SkillMessage) => unknown | Promise<unknown>;
  readonly sendText: (text: string) => unknown | Promise<unknown>;
};

export type SkillExpansionOutcome = "passthrough" | "handled";

export function planSkillExpansion(
  core: CoreBridge,
  facts: SkillExpansionFacts,
): SkillExpansionPlan {
  const effects = decodeSkillExpansionEffects(
    core.call("planSkillExpansion", [facts]),
  );
  return { text: facts.text, ...effects };
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

function notifyWarnings(plan: SkillExpansionPlan, ctx?: unknown): void {
  const warnings = plan.warnings;
  const context = objectValue<SkillContext>(ctx);
  const ui = notificationUi(context?.ui);
  if (warnings.length === 0 || ui === undefined) return;
  for (const warning of warnings) {
    ui.notify(warning.message, "warning");
  }
}

export async function applySkillExpansionPlan(
  plan: SkillExpansionPlan,
  destination: SkillExpansionDestination,
): Promise<SkillExpansionOutcome> {
  for (const warning of plan.warnings) {
    await destination.notifyWarning(warning.message);
  }
  if (plan.messages.length === 0) return "passthrough";
  for (const message of plan.messages) {
    await destination.sendMessage(message);
  }
  await destination.sendText(plan.text);
  return "handled";
}

export function installSkillResolver(pi: PiLike, core: CoreBridge): void {
  const bypassOnce = new Map<string, number>();
  pi.on("input", async (event, ctx) => {
    const text = promptFromEvent(event);
    const bypassCount = bypassOnce.get(text) ?? 0;
    if (bypassCount > 0) {
      if (bypassCount === 1) bypassOnce.delete(text);
      else bypassOnce.set(text, bypassCount - 1);
      return { action: "continue" };
    }
    const context = objectValue<SkillContext>(ctx);
    const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
    const plan = planSkillExpansion(core, { text, cwd, ctx });
    const sendMessage = pi.sendMessage;
    const sendUserMessage = pi.sendUserMessage;
    if (typeof sendMessage !== "function" || typeof sendUserMessage !== "function") {
      notifyWarnings(plan, ctx);
      return { action: "continue" };
    }
    const outcome = await applySkillExpansionPlan(plan, {
      notifyWarning: (message) => {
        const ui = notificationUi(context?.ui);
        if (ui !== undefined) ui.notify(message, "warning");
      },
      sendMessage: (message) => sendMessage.call(pi, message),
      sendText: async (plannedText) => {
        bypassOnce.set(plannedText, (bypassOnce.get(plannedText) ?? 0) + 1);
        try {
          await sendUserMessage.call(pi, plannedText);
        } catch (error) {
          const count = bypassOnce.get(plannedText) ?? 0;
          if (count === 1) bypassOnce.delete(plannedText);
          else if (count > 1) bypassOnce.set(plannedText, count - 1);
          throw error;
        }
      },
    });
    return { action: outcome === "handled" ? "handled" : "continue" };
  });
}
