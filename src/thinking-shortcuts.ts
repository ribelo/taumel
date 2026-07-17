import type { CoreBridge, PiLike } from "./types.ts";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ThinkingNotificationContext = { ui?: { notify?: (message: string, level: "info") => unknown } };
type ThinkingSelectEvent = { level?: unknown };

const thinkingLevels: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (thinkingLevels as readonly string[]).includes(value);
}

function currentThinkingLevel(pi: PiLike): ThinkingLevel {
  const level = pi.getThinkingLevel?.();
  return isThinkingLevel(level) ? level : "off";
}

function updateFooterThinking(core: CoreBridge, level: ThinkingLevel, ctx?: unknown): void {
  core.call("updateFooterThinking", [level, ctx]);
}

function stepThinkingLevel(pi: PiLike, core: CoreBridge, ctx: unknown, delta: -1 | 1): void {
  if (typeof pi.setThinkingLevel !== "function") return;
  const before = currentThinkingLevel(pi);
  const index = thinkingLevels.indexOf(before);
  const nextIndex = Math.max(0, Math.min(thinkingLevels.length - 1, index + delta));
  pi.setThinkingLevel(thinkingLevels[nextIndex]);
  const after = currentThinkingLevel(pi);
  updateFooterThinking(core, after, ctx);
  const context = typeof ctx === "object" && ctx !== null ? ctx as ThinkingNotificationContext : undefined;
  const ui = context?.ui;
  const notify = ui?.notify;
  if (typeof notify === "function") notify.call(ui, `Thinking level: ${after}`, "info");
}

export function installThinkingFooterRefresh(pi: PiLike, core: CoreBridge): void {
  pi.on("thinking_level_select", (event: unknown, ctx?: unknown) => {
    const level = typeof event === "object" && event !== null
      ? (event as ThinkingSelectEvent).level
      : undefined;
    if (isThinkingLevel(level)) updateFooterThinking(core, level, ctx);
  });
}

export function registerThinkingShortcuts(pi: PiLike, core: CoreBridge): void {
  if (typeof pi.registerShortcut !== "function") return;
  pi.registerShortcut("alt+,", {
    description: "Decrease thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, core, ctx, -1),
  });
  pi.registerShortcut("shift+down", {
    description: "Decrease thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, core, ctx, -1),
  });
  pi.registerShortcut("alt+.", {
    description: "Increase thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, core, ctx, 1),
  });
  pi.registerShortcut("shift+up", {
    description: "Increase thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, core, ctx, 1),
  });
}
