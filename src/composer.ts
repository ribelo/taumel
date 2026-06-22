import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

import type { ComposerController, CoreBridge, PiLike } from "./types.ts";
import {
  defaultTaumelGlobalSettings,
  readTaumelGlobalSettings,
  requireTaumelGlobalSettings,
  taumelGlobalSettingsPath,
  writeTaumelGlobalSettings,
} from "./global-settings.ts";
import { coreCall, isRecord, maybeCall, stringField } from "./util.ts";

const EVERFOREST_BG1 = "\x1b[48;2;46;56;60m";
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function isHorizontalBorderLine(line: string): boolean {
  const plain = stripAnsi(line);
  return plain.length > 0 && /^[─]+$/.test(plain);
}

function withBackground(line: string, width: number): string {
  const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
  const patched = padded.replaceAll("\x1b[0m", `\x1b[0m${EVERFOREST_BG1}`);
  return `${EVERFOREST_BG1}${patched}\x1b[0m`;
}

export function renderComposerInput(width: number, next: (width: number) => string[], enabled: boolean): string[] {
  if (!enabled) return next(width);

  const promptPrefix = "\x1b[1m›\x1b[0m ";
  const continuationPrefix = "  ";
  const prefixWidth = 2;

  if (width <= prefixWidth) return next(width);
  const contentWidth = Math.max(1, width - prefixWidth);
  const base = next(contentWidth);
  if (base.length < 2) return base;

  let bottomBorderIndex = -1;
  for (let index = base.length - 1; index >= 1; index -= 1) {
    if (isHorizontalBorderLine(base[index] ?? "")) {
      bottomBorderIndex = index;
      break;
    }
  }

  if (bottomBorderIndex === -1) {
    return base.map((line, index) =>
      withBackground(`${index === 0 ? promptPrefix : continuationPrefix}${line}`, width),
    );
  }

  const contentLines = base.slice(1, bottomBorderIndex);
  const autocompleteLines = base.slice(bottomBorderIndex + 1);
  const result: string[] = [];

  result.push(withBackground("", width));
  for (let index = 0; index < contentLines.length; index += 1) {
    const prefix = index === 0 ? promptPrefix : continuationPrefix;
    result.push(withBackground(prefix + (contentLines[index] ?? ""), width));
  }
  result.push(withBackground("", width));

  for (const line of autocompleteLines) {
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
    result.push(continuationPrefix + line + padding);
  }

  return result;
}

class TaumelComposerEditor extends CustomEditor {
  private readonly controller: ComposerController;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, controller: ComposerController) {
    super(tui, theme, keybindings);
    this.controller = controller;
    this.controller.latestTui = tui;
  }

  override render(width: number): string[] {
    return renderComposerInput(
      width,
      (innerWidth: number) => super.render(innerWidth),
      this.controller.settings.composer.enabled,
    );
  }
}

function uiFromContext(ctx: unknown): Record<string, unknown> | undefined {
  if (!isRecord(ctx) || ctx["hasUI"] !== true || !isRecord(ctx["ui"])) return undefined;
  return ctx["ui"];
}

function requestRender(controller: ComposerController, ctx: unknown): void {
  maybeCall(controller.latestTui, "requestRender");
  maybeCall(uiFromContext(ctx), "requestRender");
}

function installComposerForContext(controller: ComposerController, ctx: unknown): void {
  const ui = uiFromContext(ctx);
  if (!ui) return;
  const setEditorComponent = ui["setEditorComponent"];
  if (typeof setEditorComponent !== "function") return;
  setTimeout(() => {
    setEditorComponent.call(
      ui,
      (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
        new TaumelComposerEditor(tui, theme, keybindings, controller),
    );
  }, 1);
}

export async function createComposerController(pi: PiLike): Promise<ComposerController> {
  const path = taumelGlobalSettingsPath();
  const controller: ComposerController = {
    path,
    settings: await readTaumelGlobalSettings(path),
  };
  const install = (_event: unknown, ctx?: unknown) => installComposerForContext(controller, ctx);
  pi.on("session_start", install);
  pi.on("session_resume", install);
  pi.on("session_switch", install);
  return controller;
}

export async function executeComposerCommand(
  core: CoreBridge,
  controller: ComposerController | undefined,
  args: string,
  ctx: unknown,
): Promise<unknown> {
  if (!controller) {
    controller = { path: taumelGlobalSettingsPath(), settings: defaultTaumelGlobalSettings };
  }
  const result = coreCall(core, "handleComposerCommand", [
    args,
    { path: controller.path, settings: controller.settings },
  ]);
  if (!isRecord(result)) throw new Error("Invalid Taumel composer command result");
  if (result["ok"] !== true) return result;
  if (result["ok"] === true && result["writeSettings"] === true) {
    const nextSettings = requireTaumelGlobalSettings(result["settings"]);
    controller.settings = nextSettings;
    await writeTaumelGlobalSettings(controller.path, nextSettings);
    requestRender(controller, ctx);
  }
  if (stringField(result, "action") !== "command_result") {
    throw new Error("Invalid Taumel composer command result");
  }
  return result;
}
