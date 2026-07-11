import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  visibleWidth,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

import type { ComposerController, CoreBridge, PiLike } from "./types.ts";
import {
  defaultTaumelGlobalSettings,
  readTaumelGlobalSettings,
  taumelGlobalSettingsPath,
  writeTaumelComposerEnabled,
} from "./global-settings.ts";
import { maybeCall } from "./util.ts";
import { decodeComposerCommandResult } from "./bridge-contracts.ts";
import { decodeSkillListResult } from "./bridge-contracts.ts";

type ComposerUi = {
  setEditorComponent?: (...args: unknown[]) => unknown;
  requestRender?: () => unknown;
};
type ComposerContext = { hasUI?: unknown; ui?: unknown; cwd?: unknown };

const EVERFOREST_BG1 = "\x1b[48;2;46;56;60m";
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const SKILL_TOKEN_PATTERN = /(^|[\s])\$([a-z0-9-]*)$/;
const RESOLVABLE_SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

type EditorWithPrivateAutocomplete = {
  tryTriggerAutocomplete?: (explicitTab?: boolean) => void;
};

type SkillAutocompleteEntry = {
  readonly name: string;
  readonly description?: string;
  readonly location?: string;
};

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

function skillTokenPrefix(textBeforeCursor: string): string | null {
  const match = SKILL_TOKEN_PATTERN.exec(textBeforeCursor);
  return match ? `$${match[2] ?? ""}` : null;
}

function shouldAutoTriggerSkillAutocomplete(
  editor: { isShowingAutocomplete: () => boolean; getCursor: () => { line: number; col: number }; getLines: () => string[] },
  data: string,
): boolean {
  if (data.length !== 1) return false;
  if (editor.isShowingAutocomplete()) return false;
  if (data !== "$" && !/[a-z0-9-]/.test(data)) return false;

  const { line, col } = editor.getCursor();
  const currentLine = editor.getLines()[line] ?? "";
  return skillTokenPrefix(currentLine.slice(0, col)) !== null;
}

function skillItems(skills: readonly SkillAutocompleteEntry[], prefix: string): AutocompleteItem[] {
  const query = prefix.slice(1);
  const items: AutocompleteItem[] = [];
  for (const skill of skills) {
    if (!RESOLVABLE_SKILL_NAME_PATTERN.test(skill.name) || !skill.name.startsWith(query)) continue;
    const description = skill.description || skill.location;
    items.push({
      value: `$${skill.name}`,
      label: `$${skill.name}`,
      ...(description ? { description } : {}),
    });
  }
  return items;
}

function skillTriggerCharacters(current: AutocompleteProvider): string[] {
  const characters = new Set(current.triggerCharacters ?? []);
  characters.add("$");
  return [...characters];
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

export class SkillAutocompleteProvider implements AutocompleteProvider {
  triggerCharacters: string[];

  constructor(
    private current: AutocompleteProvider,
    private readonly skills: () => readonly SkillAutocompleteEntry[],
  ) {
    this.triggerCharacters = skillTriggerCharacters(current);
  }

  setBase(current: AutocompleteProvider): void {
    this.current = current;
    this.triggerCharacters = skillTriggerCharacters(current);
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    if (options.force !== true) {
      const currentLine = lines[cursorLine] || "";
      const prefix = skillTokenPrefix(currentLine.slice(0, cursorCol));
      if (prefix !== null) {
        const items = skillItems(this.skills(), prefix);
        return items.length === 0 ? null : { items, prefix };
      }
    }
    return this.current.getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    if (prefix.startsWith("$")) {
      const currentLine = lines[cursorLine] || "";
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      const suffix = afterCursor.startsWith(" ") ? "" : " ";
      const newLine = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + suffix.length };
    }
    return this.current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    return this.current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
  }
}

class TaumelComposerEditor extends CustomEditor {
  private readonly controller: ComposerController;
  private skillAutocompleteProvider?: SkillAutocompleteProvider;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, controller: ComposerController) {
    super(tui, theme, keybindings);
    this.controller = controller;
    this.controller.latestTui = tui;
  }

  override render(width: number): string[] {
    return renderComposerInput(
      width,
      (innerWidth: number) => super.render(innerWidth),
      this.controller.settings.taumel.composer.enabled,
    );
  }

  override handleInput(data: string): void {
    super.handleInput(data);
    if (shouldAutoTriggerSkillAutocomplete(this, data)) {
      (this as unknown as EditorWithPrivateAutocomplete).tryTriggerAutocomplete?.(false);
    }
  }

  override setAutocompleteProvider(provider: AutocompleteProvider): void {
    const skillEntries = this.controller.skillEntries;
    if (!skillEntries) {
      super.setAutocompleteProvider(provider);
      return;
    }
    if (!this.skillAutocompleteProvider) {
      this.skillAutocompleteProvider = new SkillAutocompleteProvider(provider, skillEntries);
    } else {
      this.skillAutocompleteProvider.setBase(provider);
    }
    super.setAutocompleteProvider(this.skillAutocompleteProvider);
  }
}

function uiFromContext(ctx: unknown): ComposerUi | undefined {
  if (typeof ctx !== "object" || ctx === null) return undefined;
  const context = ctx as ComposerContext;
  if (context.hasUI !== true || typeof context.ui !== "object" || context.ui === null) return undefined;
  return context.ui as ComposerUi;
}

function requestRender(controller: ComposerController, ctx: unknown): void {
  maybeCall(controller.latestTui, "requestRender");
  maybeCall(uiFromContext(ctx), "requestRender");
}

function listSkills(core: CoreBridge, controller: ComposerController): SkillAutocompleteEntry[] {
  const result = decodeSkillListResult(core.call("listSkills", [{
    cwd: controller.latestCwd ?? process.cwd(),
    includeDisabled: false,
  }]));
  return result.skills.map(({ name, description, location }) => ({ name, description, location }));
}

export function installSkillAutocomplete(_pi: PiLike, core: CoreBridge, controller: ComposerController): void {
  controller.skillEntries = () => listSkills(core, controller);
}

function installComposerForContext(controller: ComposerController, ctx: unknown): void {
  const context = typeof ctx === "object" && ctx !== null ? ctx as ComposerContext : undefined;
  if (typeof context?.cwd === "string" && context.cwd !== "") controller.latestCwd = context.cwd;
  const ui = uiFromContext(ctx);
  if (!ui) return;
  const setEditorComponent = ui.setEditorComponent;
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
  const result = decodeComposerCommandResult(core.call("handleComposerCommand", [{
    args, path: controller.path, settings: controller.settings,
  }]));
  if (result.kind === "error") return { ok: false, action: "command_result", message: result.message, error: result.message };
  if (result.writeSettings) {
    const nextSettings = result.settings;
    controller.settings = nextSettings;
    await writeTaumelComposerEnabled(controller.path, nextSettings.taumel.composer.enabled);
    requestRender(controller, ctx);
  }
  return { ok: true, action: "command_result", message: result.message };
}
