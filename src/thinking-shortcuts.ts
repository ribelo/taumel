import type { CoreBridge, PiLike } from "./types.ts";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const thinkingLevels: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (thinkingLevels as readonly string[]).includes(value);
}

function currentThinkingLevel(pi: PiLike): ThinkingLevel {
  const level = pi.getThinkingLevel?.();
  return isThinkingLevel(level) ? level : "off";
}

function stepThinkingLevel(pi: PiLike, ctx: unknown, delta: -1 | 1): void {
  if (typeof pi.setThinkingLevel !== "function") return;
  const before = currentThinkingLevel(pi);
  const index = thinkingLevels.indexOf(before);
  const nextIndex = Math.max(0, Math.min(thinkingLevels.length - 1, index + delta));
  pi.setThinkingLevel(thinkingLevels[nextIndex]);
  const after = currentThinkingLevel(pi);
  const ui = typeof ctx === "object" && ctx !== null ? (ctx as Record<string, unknown>)["ui"] : undefined;
  const notify = typeof ui === "object" && ui !== null ? (ui as Record<string, unknown>)["notify"] : undefined;
  if (typeof notify === "function") notify.call(ui, `Thinking level: ${after}`, "info");
}

export function installThinkingFooterRefresh(pi: PiLike, core: CoreBridge): void {
  pi.on("thinking_level_select", (_event: unknown, ctx?: unknown) => {
    core.call("refreshFooterState", [ctx]);
  });
}

export function registerThinkingShortcuts(pi: PiLike): void {
  if (typeof pi.registerShortcut !== "function") return;
  pi.registerShortcut("alt+,", {
    description: "Decrease thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, ctx, -1),
  });
  pi.registerShortcut("shift+down", {
    description: "Decrease thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, ctx, -1),
  });
  pi.registerShortcut("alt+.", {
    description: "Increase thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, ctx, 1),
  });
  pi.registerShortcut("shift+up", {
    description: "Increase thinking level",
    handler: (ctx: unknown) => stepThinkingLevel(pi, ctx, 1),
  });
}
