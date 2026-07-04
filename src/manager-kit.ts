import { type KeyId, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { isRecord } from "./util.ts";

export type ThemeLike = {
  readonly fg?: (color: string, text: string) => string;
  readonly bg?: (color: string, text: string) => string;
  readonly bold?: (text: string) => string;
};

export type KeybindingsLike = {
  readonly matches?: (data: string, id: string) => boolean;
};

export type UiLike = Record<string, unknown>;

export function uiFromContext(ctx: unknown): UiLike | undefined {
  return isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
}

export function notify(ui: UiLike | undefined, message: string, level: "info" | "warning" = "info"): void {
  const fn = ui?.["notify"];
  if (typeof fn === "function") fn.call(ui, message, level);
}

export function fg(theme: ThemeLike, color: string, text: string): string {
  return typeof theme.fg === "function" ? theme.fg(color, text) : text;
}

export function bg(theme: ThemeLike, color: string, text: string): string {
  return typeof theme.bg === "function" ? theme.bg(color, text) : text;
}

export function bold(theme: ThemeLike, text: string): string {
  return typeof theme.bold === "function" ? theme.bold(text) : text;
}

export function padToWidth(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function column(text: string, width: number): string {
  return padToWidth(truncateToWidth(text, width, "…"), width);
}

export function keybindingMatches(keybindings: unknown, data: string, id: string): boolean {
  if (!isRecord(keybindings)) return false;
  const matches = keybindings["matches"];
  if (typeof matches !== "function") return false;
  try {
    return matches.call(keybindings, data, id) === true;
  } catch {
    return false;
  }
}

export function matchesSelect(keybindings: unknown, data: string, id: string, fallback: KeyId): boolean {
  return keybindingMatches(keybindings, data, id) || matchesKey(data, fallback);
}

export function commandResult(ok: boolean, message: string, details: Record<string, unknown>): Record<string, unknown> {
  return { ok, action: "command_result", message, ...(ok ? {} : { error: message }), details };
}

export function resultMessage(result: Record<string, unknown>, fallback: string): string {
  return typeof result["message"] === "string" ? result["message"] : fallback;
}

export function mutationOk(result: Record<string, unknown>): boolean {
  return result["ok"] === true;
}

export function requestRenderFromTui(tui: unknown): () => void {
  return () => {
    if (isRecord(tui) && typeof tui["requestRender"] === "function") {
      tui["requestRender"].call(tui);
    }
  };
}
