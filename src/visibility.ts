import { existsSync, readFileSync } from "node:fs";
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";

import type { CoreBridge, PiLike } from "./types.ts";
import { taumelGlobalSettingsPath } from "./global-settings.ts";
import { cwdFromContext, isProjectTrusted, liveToolNames, projectSettingsPath, readJsonObjectForAtomicUpdate, writeFileAtomically, type MutationPathAuthorization } from "./util.ts";
import { decodeSkillListResult } from "./bridge-contracts.ts";
import { decodeVisibilityListResult, decodeVisibilityRowsResult, decodeVisibilitySavePlan, decodeVisibilityToggleResult, decodeVisibilityWarningsResult, type VisibilityPrompt, type VisibilityRowsResult } from "./bridge-contracts.ts";
import { toolNames } from "./tool-contracts.ts";
import { toolContracts } from "./tool-contract-catalog.ts";
import { appendTaumelCustomEntry, latestTaumelCustomEntry } from "./pi-session-entries.ts";
import {
  bold,
  commandResult,
  fg,
  mutationOk,
  notify,
  requestRenderFromTui,
  resultMessage,
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
  const project = isProjectTrusted(ctx) ? readVisibilityFile(projectSettingsPath(cwdFromContext(ctx))) : {};
  return {
    tools: project.tools ?? global.tools ?? [],
    skills: project.skills ?? global.skills ?? [],
  };
}

function hasSessionVisibilityEntry(ctx: unknown): boolean {
  const sessionManager = objectAdapter<VisibilitySessionManager>(objectAdapter<VisibilityContext>(ctx)?.sessionManager);
  return latestTaumelCustomEntry(sessionManager, "taumel.visibility").kind
    !== "absent";
}

function appendSessionVisibilityEntry(ctx: unknown, disabled: { tools: string[]; skills: string[] }): void {
  const sessionManager = objectAdapter<VisibilitySessionManager>(objectAdapter<VisibilityContext>(ctx)?.sessionManager);
  appendTaumelCustomEntry(sessionManager, "taumel.visibility", {
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

const toolDescriptions = new Map(toolContracts.map((contract) => [contract.name, contract.description]));

function withManagerDescriptions(state: VisibilityState): VisibilityState {
  if (state.category !== "tools") return state;
  return {
    ...state,
    rows: state.rows.map((row) => ({
      ...row,
      description: row.available ? toolDescriptions.get(row.name) ?? "" : "",
    })),
  };
}

function loadVisibilityState(core: CoreBridge, category: Category, ctx: unknown): VisibilityState {
  return withManagerDescriptions(decodeVisibilityRowsResult(core.call("visibilityRows", [{ category, ctx }])));
}

const MAX_VISIBLE_ROWS = 10;

class VisibilityManagerComponent {
  private busy: string | undefined;
  private status: string | undefined;
  private settingsList: SettingsList;
  private readonly frame: DynamicBorder;

  constructor(
    private state: VisibilityState,
    private readonly theme: ThemeLike,
    private readonly callbacks: ManagerCallbacks,
  ) {
    this.frame = new DynamicBorder((text: string) => fg(this.theme, "accent", text));
    this.settingsList = this.createSettingsList();
  }

  invalidate(): void {
    this.frame.invalidate();
    this.settingsList.invalidate();
  }

  render(width: number): string[] {
    const lines = this.baseHeader(width);
    lines.push(...this.settingsList.render(width));
    this.addStatus(lines, width);
    lines.push(this.line(this.dim("  Ctrl+S save to project"), width));
    lines.push(this.border(width));
    return lines;
  }

  handleInput(data: string): void {
    if (this.busy !== undefined) return;
    if (isCtrlS(data)) {
      this.runSave();
      return;
    }
    this.settingsList.handleInput(data);
    this.callbacks.requestRender();
  }

  private createSettingsList(): SettingsList {
    const items: SettingItem[] = this.state.rows.map((row) => ({
      id: row.name,
      label: row.name,
      description: row.description || undefined,
      currentValue: row.available ? row.state : "unavailable",
      values: row.available ? ["enabled", "disabled"] : ["unavailable", "enabled"],
    }));
    return new SettingsList(
      items,
      Math.min(Math.max(items.length, 1), MAX_VISIBLE_ROWS),
      getSettingsListTheme(),
      (name) => this.runToggle(name),
      () => this.callbacks.onDone({ kind: "exit" }),
      { enableSearch: true },
    );
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
    return this.frame.render(width)[0] ?? "";
  }

  private accent(text: string): string {
    return fg(this.theme, "accent", text);
  }

  private dim(text: string): string {
    return fg(this.theme, "dim", text);
  }

  private runToggle(name: string): void {
    this.busy = "Updating visibility...";
    this.status = undefined;
    this.callbacks.requestRender();
    void this.callbacks.onToggle(name).then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.settingsList = this.createSettingsList();
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
      this.settingsList = this.createSettingsList();
      this.callbacks.requestRender();
    });
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
  const path = projectSettingsPath(cwdFromContext(ctx));
  let root: VisibilitySettings, authorization: MutationPathAuthorization;
  try {
    ({ settings: root, authorization } = await readJsonObjectForAtomicUpdate(path, true));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandResult(false, `Cannot save ${category} visibility: ${message}`, { ...state, category, path });
  }
  const existingTaumel = root["taumel"];
  const taumel = existingTaumel === undefined ? {} : settingsObject(existingTaumel);
  if (taumel === undefined) {
    return commandResult(false, `Cannot save ${category} visibility: taumel must be a JSON object.`, { ...state, category, path });
  }
  const existingBlock = taumel[category];
  const block = existingBlock === undefined ? {} : settingsObject(existingBlock);
  if (block === undefined) {
    return commandResult(false, `Cannot save ${category} visibility: taumel.${category} must be a JSON object.`, { ...state, category, path });
  }
  block["disabled"] = disabled;
  taumel[category] = block;
  root["taumel"] = taumel;
  await writeFileAtomically(authorization, `${JSON.stringify(root, null, 2)}\n`, true);
  const stale = state.unavailable.length === 0 ? "" : ` Unavailable names remain: ${state.unavailable.join(", ")}.`;
  return commandResult(true, `Saved ${category} visibility to ${path}.${stale}`, { ...state, category, path });
}

async function saveFromCore(core: CoreBridge, category: Category, ctx: unknown) {
  const plan = decodeVisibilitySavePlan(core.call("visibilitySaveProjectPlan", [{ category, ctx }]));
  return saveProjectVisibility(category, plan.disabled, plan.details, ctx);
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
    _keybindings: unknown,
    done: (action: ManagerAction) => void,
  ) => {
    const requestRender = requestRenderFromTui(tui);
    return new VisibilityManagerComponent(state, theme, {
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
