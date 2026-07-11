import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Focusable, fuzzyFilter, Input, Key, truncateToWidth } from "@earendil-works/pi-tui";

import type { CoreBridge, PiLike } from "./types.ts";
import { taumelGlobalSettingsPath } from "./global-settings.ts";
import { cwdFromContext, isProjectTrusted, liveToolNames, writeFileAtomically } from "./util.ts";
import { decodeSkillListResult } from "./bridge-contracts.ts";
import { decodeVisibilityListResult, decodeVisibilityRowsResult, decodeVisibilitySavePlan, decodeVisibilityToggleResult, decodeVisibilityWarningsResult, type VisibilityPrompt, type VisibilityRowsResult } from "./bridge-contracts.ts";
import { toolNames } from "./tool-contracts.ts";
import {
  bg,
  bold,
  column,
  commandResult,
  fg,
  matchesSelect,
  mutationOk,
  notify,
  requestRenderFromTui,
  resultMessage,
  type KeybindingsLike,
  type ThemeLike,
  uiFromContext,
} from "./manager-kit.ts";

type Category = "tools" | "skills";

type Row = {
  readonly name: string;
  readonly state: string;
  readonly available: boolean;
  readonly description: string;
};

type VisibilityState = {
  readonly category: Category;
  readonly title: string;
  readonly rows: readonly Row[];
  readonly disabled: readonly string[];
  readonly unavailable: readonly string[];
};

type ManagerAction = { readonly kind: "exit" };
type VisibilityContext = { readonly isProjectTrusted?: () => unknown; readonly cwd?: unknown; readonly sessionManager?: unknown };
type VisibilitySessionManager = {
  readonly getEntries?: () => unknown;
  readonly appendCustomEntry?: (customType: string, data: unknown) => unknown;
};
type VisibilityEntry = { readonly type?: unknown; readonly customType?: unknown };
type VisibilitySettings = { [key: string]: unknown };

function objectAdapter<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Partial<T>
    : undefined;
}

function settingsObject(value: unknown): VisibilitySettings | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as VisibilitySettings
    : undefined;
}

type MutationOutcome = {
  readonly ok: boolean;
  readonly message: string;
  readonly state: VisibilityState;
};

type ManagerCallbacks = {
  readonly onDone: (action: ManagerAction) => void;
  readonly onToggle: (name: string) => Promise<MutationOutcome>;
  readonly onSave: () => Promise<MutationOutcome>;
  readonly requestRender: () => void;
};

function projectSettingsPath(ctx: unknown): string {
  return join(cwdFromContext(ctx), ".pi", "settings.json");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

function visibilityFromSettings(settings: unknown): Partial<{ tools: string[]; skills: string[] }> {
  const root = settingsObject(settings);
  const taumel = settingsObject(root?.["taumel"]);
  const category = (name: Category): string[] | undefined => {
    const block = settingsObject(taumel?.[name]);
    if (block?.["disabled"] === undefined) return undefined;
    return stringArray(block["disabled"]);
  };
  return { tools: category("tools"), skills: category("skills") };
}

function readVisibilityFile(path: string): Partial<{ tools: string[]; skills: string[] }> {
  if (!existsSync(path)) return {};
  try {
    return visibilityFromSettings(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return {};
  }
}

function readConfigVisibilityDefaults(ctx: unknown): { tools: string[]; skills: string[] } {
  const global = readVisibilityFile(taumelGlobalSettingsPath());
  const project = isProjectTrusted(ctx) ? readVisibilityFile(projectSettingsPath(ctx)) : {};
  return {
    tools: project.tools ?? global.tools ?? [],
    skills: project.skills ?? global.skills ?? [],
  };
}

function hasSessionVisibilityEntry(ctx: unknown): boolean {
  const sessionManager = objectAdapter<VisibilitySessionManager>(objectAdapter<VisibilityContext>(ctx)?.sessionManager);
  const getEntries = sessionManager?.getEntries;
  if (typeof getEntries !== "function") return false;
  try {
    const entries = getEntries.call(sessionManager);
    return Array.isArray(entries) && entries.some((entry) =>
      objectAdapter<VisibilityEntry>(entry)?.type === "custom" && objectAdapter<VisibilityEntry>(entry)?.customType === "taumel.visibility"
    );
  } catch {
    return false;
  }
}

function appendSessionVisibilityEntry(ctx: unknown, disabled: { tools: string[]; skills: string[] }): void {
  const sessionManager = objectAdapter<VisibilitySessionManager>(objectAdapter<VisibilityContext>(ctx)?.sessionManager);
  const append = sessionManager?.appendCustomEntry;
  if (typeof append !== "function") return;
  append.call(sessionManager, "taumel.visibility", {
    version: 1,
    tools: { disabled: disabled.tools },
    skills: { disabled: disabled.skills },
  });
}

function seedVisibilityFromProject(ctx: unknown): boolean {
  if (hasSessionVisibilityEntry(ctx)) return false;
  const projectDisabled = readConfigVisibilityDefaults(ctx);
  if (
    projectDisabled.tools.length === 0 &&
    projectDisabled.skills.length === 0
  ) {
    return false;
  }
  appendSessionVisibilityEntry(ctx, projectDisabled);
  return true;
}

function isCtrlS(data: string): boolean {
  return data === "\x13";
}

function loadVisibilityState(core: CoreBridge, category: Category, ctx: unknown): VisibilityState {
  return decodeVisibilityRowsResult(core.call("visibilityRows", [{ category, ctx }]));
}

const MAX_VISIBLE_ROWS = 10;

function rowSearchText(row: Row): string {
  return `${row.name} ${row.description}`;
}

class VisibilityManagerComponent implements Focusable {
  private selected = 0;
  private busy: string | undefined;
  private status: string | undefined;
  private readonly searchInput = new Input();
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    private state: VisibilityState,
    private readonly theme: ThemeLike,
    private readonly keybindings: KeybindingsLike,
    private readonly callbacks: ManagerCallbacks,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = this.baseHeader(width);
    const rows = this.filteredRows();
    for (const inputLine of this.searchInput.render(Math.max(0, width - 2))) {
      lines.push(this.line(`  ${inputLine}`, width));
    }
    lines.push("");
    lines.push(this.line(this.dim(`  ${column("State", 12)}  ${column("Name", 24)}  Description`), width));
    const startIndex = Math.max(
      0,
      Math.min(this.selected - Math.floor(MAX_VISIBLE_ROWS / 2), rows.length - MAX_VISIBLE_ROWS),
    );
    const endIndex = Math.min(startIndex + MAX_VISIBLE_ROWS, rows.length);
    for (let index = startIndex; index < endIndex; index += 1) {
      const row = rows[index];
      if (row) lines.push(this.renderRow(row, index === this.selected, width));
    }
    if (this.state.rows.length === 0) lines.push(this.line(this.dim("  Nothing registered."), width));
    else if (rows.length === 0) lines.push(this.line(this.dim("  No matching entries."), width));
    if (startIndex > 0 || endIndex < rows.length) {
      lines.push(this.line(this.dim(`  (${this.selected + 1}/${rows.length})`), width));
    }
    this.addStatus(lines, width);
    lines.push("");
    lines.push(this.line(this.dim("  type search • ↑↓ select • enter toggle • ctrl+s save to project • esc close"), width));
    lines.push(this.border(width));
    return lines;
  }

  handleInput(data: string): void {
    if (this.busy !== undefined) return;
    if (this.isCancel(data)) {
      this.callbacks.onDone({ kind: "exit" });
      return;
    }
    if (this.isUp(data)) {
      this.moveSelection(-1);
      return;
    }
    if (this.isDown(data)) {
      this.moveSelection(1);
      return;
    }
    if (isCtrlS(data)) {
      this.runSave();
      return;
    }
    if (this.isConfirm(data)) {
      const row = this.filteredRows()[this.selected];
      if (row) this.runToggle(row.name);
      return;
    }
    this.searchInput.handleInput(data);
    this.clampSelection();
    this.callbacks.requestRender();
  }

  private baseHeader(width: number): string[] {
    const disabled = `${this.state.disabled.length} disabled`;
    const stale = this.state.unavailable.length === 0 ? "" : ` • ${this.state.unavailable.length} unavailable`;
    return [
      this.border(width),
      this.line(this.accent(bold(this.theme, this.state.title)), width),
      this.line(`  ${disabled}${stale}`, width),
      "",
    ];
  }

  private renderRow(row: Row, selected: boolean, width: number): string {
    const state = row.available ? row.state : "unavailable";
    const text = `${column(state, 12)}  ${column(row.name, 24)}  ${row.description}`;
    const rowText = selected ? bg(this.theme, "selectedBg", this.accent(text)) : text;
    return this.line((selected ? this.accent("-> ") : "  ") + rowText, width);
  }

  private addStatus(lines: string[], width: number): void {
    if (this.busy) {
      lines.push("");
      lines.push(this.line(this.dim(`  ${this.busy}`), width));
    } else if (this.status) {
      lines.push("");
      lines.push(this.line(this.dim(`  ${this.status}`), width));
    }
  }

  private line(text: string, width: number): string {
    return truncateToWidth(text, Math.max(0, width), "");
  }

  private border(width: number): string {
    if (width <= 0) return "";
    return this.accent("-".repeat(width));
  }

  private accent(text: string): string {
    return fg(this.theme, "accent", text);
  }

  private dim(text: string): string {
    return fg(this.theme, "dim", text);
  }

  private filteredRows(): readonly Row[] {
    const query = this.searchInput.getValue().trim();
    return query === "" ? this.state.rows : fuzzyFilter([...this.state.rows], query, rowSearchText);
  }

  private moveSelection(delta: number): void {
    const rows = this.filteredRows();
    if (rows.length === 0) return;
    this.selected = (this.selected + delta + rows.length) % rows.length;
    this.callbacks.requestRender();
  }

  private runToggle(name: string): void {
    this.busy = "Updating visibility...";
    this.status = undefined;
    this.callbacks.requestRender();
    void this.callbacks.onToggle(name).then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.clampSelection();
      this.callbacks.requestRender();
    });
  }

  private runSave(): void {
    this.busy = "Saving visibility...";
    this.status = undefined;
    this.callbacks.requestRender();
    void this.callbacks.onSave().then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.clampSelection();
      this.callbacks.requestRender();
    });
  }

  private clampSelection(): void {
    this.selected = Math.max(0, Math.min(this.selected, Math.max(0, this.filteredRows().length - 1)));
  }

  private isUp(data: string): boolean {
    return matchesSelect(this.keybindings, data, "tui.select.up", Key.up);
  }

  private isDown(data: string): boolean {
    return matchesSelect(this.keybindings, data, "tui.select.down", Key.down);
  }

  private isConfirm(data: string): boolean {
    return matchesSelect(this.keybindings, data, "tui.select.confirm", Key.enter);
  }

  private isCancel(data: string): boolean {
    return matchesSelect(this.keybindings, data, "tui.select.cancel", Key.escape);
  }
}

export async function saveProjectVisibility(
  category: Category,
  disabled: readonly string[],
  details: VisibilityRowsResult,
  ctx: unknown,
) {
  const state: VisibilityState = details;
  if (!isProjectTrusted(ctx)) {
    const message = `Cannot save ${category} visibility: project is not trusted.`;
    return commandResult(false, message, { ...state, category });
  }
  const path = projectSettingsPath(ctx);
  let root: VisibilitySettings = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const parsedRoot = settingsObject(parsed);
      root = parsedRoot ?? {};
    } catch {
      root = {};
    }
  }
  const taumel = settingsObject(root["taumel"]) ?? {};
  const block = settingsObject(taumel[category]) ?? {};
  block["disabled"] = [...disabled];
  taumel[category] = block;
  root["taumel"] = taumel;
  await writeFileAtomically(path, `${JSON.stringify(root, null, 2)}\n`);
  const stale = state.unavailable.length === 0 ? "" : ` Unavailable names remain: ${state.unavailable.join(", ")}.`;
  return commandResult(true, `Saved ${category} visibility to ${path}.${stale}`, { ...state, category, path });
}

async function saveFromCore(core: CoreBridge, category: Category, ctx: unknown) {
  const plan = decodeVisibilitySavePlan(core.call("visibilitySaveProjectPlan", [{ category, ctx }]));
  return saveProjectVisibility(category, [...plan.disabled], plan.details, ctx);
}

export async function executeVisibilityManager(
  core: CoreBridge,
  prompt: VisibilityPrompt,
  ctx: unknown,
  syncTools: (enabledName?: string) => void,
): Promise<unknown> {
  const category = prompt.category;
  const ui = uiFromContext(ctx);
  const custom = ui?.["custom"];
  if (typeof custom !== "function") {
    return decodeVisibilityListResult(core.call("visibilityListCommand", [{ category, ctx }]));
  }

  let state = loadVisibilityState(core, category, ctx);
  let dirty = false;

  const action = await custom.call(ui, (
    tui: unknown,
    theme: ThemeLike,
    keybindings: KeybindingsLike,
    done: (action: ManagerAction) => void,
  ) => {
    const requestRender = requestRenderFromTui(tui);
    return new VisibilityManagerComponent(state, theme, keybindings, {
      onDone: done,
      requestRender,
      onToggle: async (name) => {
        const result = decodeVisibilityToggleResult(core.call("toggleVisibilityRow", [{ category, name, ctx }]));
        const ok = result.ok;
        if (ok) dirty = true;
        const enabledName = result.ok ? result.details.enabledName : undefined;
        if (category === "tools") syncTools(enabledName);
        state = loadVisibilityState(core, category, ctx);
        const message = resultMessage(result, "Visibility updated.");
        notify(ui, message, ok ? "info" : "warning");
        return { ok, message, state };
      },
      onSave: async () => {
        const result = await saveFromCore(core, category, ctx);
        const ok = mutationOk(result);
        state = loadVisibilityState(core, category, ctx);
        const message = resultMessage(result, "Visibility updated.");
        notify(ui, message, ok ? "info" : "warning");
        return { ok, message, state };
      },
    });
  });

  if (typeof action === "object" && action !== null && (action as { kind?: unknown }).kind === "exit") {
    return commandResult(true, dirty ? "Visibility updated." : "Visibility manager closed.", {
      ...state,
      category,
    });
  }
  return commandResult(true, "Visibility manager closed.", { ...state, category });
}

function listSkillNames(core: CoreBridge, ctx: unknown): string[] {
  return decodeSkillListResult(core.call("listSkills", [{
    cwd: cwdFromContext(ctx),
    includeDisabled: true,
  }])).skills.map((skill) => skill.name);
}

function notifyVisibilityWarnings(pi: PiLike, core: CoreBridge, ctx: unknown): void {
  const result = decodeVisibilityWarningsResult(core.call("visibilityWarnings", [{
    tools: liveToolNames(pi, toolNames),
    skills: listSkillNames(core, ctx),
  }]));
  const messages = result.messages;
  const ui = uiFromContext(ctx);
  for (const message of messages) notify(ui, message, "warning");
}

export function installVisibilityLifecycle(pi: PiLike, core: CoreBridge): void {
  const sync = (_event: unknown, ctx?: unknown) => {
    if (seedVisibilityFromProject(ctx)) {
      core.call("reloadSessionState", [ctx]);
    }
    setTimeout(() => notifyVisibilityWarnings(pi, core, ctx), 0);
  };
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
  pi.on("session_switch", sync);
}
