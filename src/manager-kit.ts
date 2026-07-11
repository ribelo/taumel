import { type KeyId, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ThemeLike = {
  readonly fg?: (color: string, text: string) => string;
  readonly bg?: (color: string, text: string) => string;
  readonly bold?: (text: string) => string;
};

export type KeybindingsLike = {
  readonly matches?: (data: string, id: string) => boolean;
};

export type UiLike = {
  readonly notify?: (message: string, level: "info" | "warning") => unknown;
  readonly editor?: (...args: unknown[]) => unknown;
  readonly custom?: (...args: unknown[]) => unknown;
};
type UiContext = { readonly ui?: unknown };
type ResultLike = { readonly ok?: unknown; readonly message?: unknown };
type CommandResult = {
  readonly ok: boolean; readonly action: "command_result"; readonly message: string;
  readonly error?: string; readonly details: unknown;
};

function objectAdapter<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<T> : undefined;
}

export function uiFromContext(ctx: unknown): UiLike | undefined {
  const ui = objectAdapter<UiContext>(ctx)?.ui;
  return typeof ui === "object" && ui !== null ? ui as UiLike : undefined;
}

export function notify(ui: UiLike | undefined, message: string, level: "info" | "warning" = "info"): void {
  const fn = ui?.notify;
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
  const matches = objectAdapter<KeybindingsLike>(keybindings)?.matches;
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

export function commandResult(ok: boolean, message: string, details: unknown): CommandResult {
  return { ok, action: "command_result", message, ...(ok ? {} : { error: message }), details };
}

export function resultMessage(result: ResultLike, fallback: string): string {
  return typeof result.message === "string" ? result.message : fallback;
}

export function mutationOk(result: ResultLike): boolean {
  return result.ok === true;
}

export function requestRenderFromTui(tui: unknown): () => void {
  return () => {
    const requestRender = objectAdapter<{ requestRender?: () => unknown }>(tui)?.requestRender;
    if (typeof requestRender === "function") requestRender.call(tui);
  };
}
