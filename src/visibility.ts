import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Key, type KeyId, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { CoreBridge, PiLike } from "./types.ts";
import { coreCallOptionalRecord, coreCallRecord, isRecord, stringArrayFromUnknown, stringField, writeFileAtomically } from "./util.ts";
import { toolNames } from "./tool-contracts.ts";

type Category = "agents" | "tools" | "skills";

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

type ThemeLike = {
  readonly fg?: (color: string, text: string) => string;
  readonly bg?: (color: string, text: string) => string;
  readonly bold?: (text: string) => string;
};

type KeybindingsLike = {
  readonly matches?: (data: string, id: string) => boolean;
};

type UiLike = Record<string, unknown>;

type ManagerAction = { readonly kind: "exit" };

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

function uiFromContext(ctx: unknown): UiLike | undefined {
  return isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
}

function notify(ui: UiLike | undefined, message: string, level: "info" | "warning" = "info"): void {
  const fn = ui?.["notify"];
  if (typeof fn === "function") fn.call(ui, message, level);
}

function isProjectTrusted(ctx: unknown): boolean {
  if (!isRecord(ctx)) return false;
  const trusted = ctx["isProjectTrusted"];
  return typeof trusted === "function" ? trusted.call(ctx) === true : false;
}

function cwdFromContext(ctx: unknown): string {
  return isRecord(ctx) && typeof ctx["cwd"] === "string" && ctx["cwd"] !== "" ? ctx["cwd"] : process.cwd();
}

function projectSettingsPath(ctx: unknown): string {
  return join(cwdFromContext(ctx), ".pi", "settings.json");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value !== "" && !result.includes(value)) result.push(value);
  }
  return result;
}

function visibilityFromSettings(settings: unknown): Record<Category, string[]> {
  const taumel = isRecord(settings) && isRecord(settings["taumel"]) ? settings["taumel"] : {};
  const category = (name: Category): string[] => {
    const block = isRecord(taumel) && isRecord(taumel[name]) ? taumel[name] : {};
    return isRecord(block) ? stringArray(block["disabled"]) : [];
  };
  return { agents: category("agents"), tools: category("tools"), skills: category("skills") };
}

function readProjectVisibilityDefaults(ctx: unknown): Record<Category, string[]> {
  if (!isProjectTrusted(ctx)) return { agents: [], tools: [], skills: [] };
  const path = projectSettingsPath(ctx);
  if (!existsSync(path)) return { agents: [], tools: [], skills: [] };
  try {
    return visibilityFromSettings(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return { agents: [], tools: [], skills: [] };
  }
}

function hasSessionVisibilityEntry(ctx: unknown): boolean {
  if (!isRecord(ctx) || !isRecord(ctx["sessionManager"])) return false;
  const getEntries = ctx["sessionManager"]["getEntries"];
  if (typeof getEntries !== "function") return false;
  try {
    const entries = getEntries.call(ctx["sessionManager"]);
    return Array.isArray(entries) && entries.some((entry) =>
      isRecord(entry) && entry["type"] === "custom" && entry["customType"] === "taumel.visibility"
    );
  } catch {
    return false;
  }
}

function legacyDisabledAgentsFromSession(ctx: unknown): string[] {
  if (!isRecord(ctx) || !isRecord(ctx["sessionManager"])) return [];
  const getEntries = ctx["sessionManager"]["getEntries"];
  if (typeof getEntries !== "function") return [];
  try {
    const entries = getEntries.call(ctx["sessionManager"]);
    if (!Array.isArray(entries)) return [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== "taumel.agents") {
        continue;
      }
      const data = isRecord(entry["data"]) ? entry["data"] : {};
      const profiles = Array.isArray(data["profiles"]) ? data["profiles"].filter(isRecord) : [];
      return uniqueStrings(profiles.flatMap((profile) =>
        profile["enabled"] === false && typeof profile["name"] === "string" ? [profile["name"]] : []
      ));
    }
  } catch {
    return [];
  }
  return [];
}

function appendSessionVisibilityEntry(ctx: unknown, disabled: Record<Category, string[]>): void {
  if (!isRecord(ctx) || !isRecord(ctx["sessionManager"])) return;
  const append = ctx["sessionManager"]["appendCustomEntry"];
  if (typeof append !== "function") return;
  append.call(ctx["sessionManager"], "taumel.visibility", {
    version: 1,
    agents: { disabled: disabled.agents },
    tools: { disabled: disabled.tools },
    skills: { disabled: disabled.skills },
  });
}

function seedVisibilityFromProject(ctx: unknown): boolean {
  if (hasSessionVisibilityEntry(ctx)) return false;
  const projectDisabled = readProjectVisibilityDefaults(ctx);
  if (
    projectDisabled.agents.length === 0 &&
    projectDisabled.tools.length === 0 &&
    projectDisabled.skills.length === 0
  ) {
    return false;
  }
  const disabled = {
    ...projectDisabled,
    agents: uniqueStrings([...projectDisabled.agents, ...legacyDisabledAgentsFromSession(ctx)]),
  };
  appendSessionVisibilityEntry(ctx, disabled);
  return true;
}

function fg(theme: ThemeLike, color: string, text: string): string {
  return typeof theme.fg === "function" ? theme.fg(color, text) : text;
}

function bg(theme: ThemeLike, color: string, text: string): string {
  return typeof theme.bg === "function" ? theme.bg(color, text) : text;
}

function bold(theme: ThemeLike, text: string): string {
  return typeof theme.bold === "function" ? theme.bold(text) : text;
}

function padToWidth(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function column(text: string, width: number): string {
  return padToWidth(truncateToWidth(text, width, "..."), width);
}

function keybindingMatches(keybindings: unknown, data: string, id: string): boolean {
  if (!isRecord(keybindings)) return false;
  const matches = keybindings["matches"];
  if (typeof matches !== "function") return false;
  try {
    return matches.call(keybindings, data, id) === true;
  } catch {
    return false;
  }
}

function matchesSelect(keybindings: unknown, data: string, id: string, fallback: KeyId): boolean {
  return keybindingMatches(keybindings, data, id) || matchesKey(data, fallback);
}

function isCtrlS(data: string): boolean {
  return data === "\x13";
}

function parseRows(details: unknown): VisibilityState {
  if (!isRecord(details)) throw new Error("Invalid Taumel visibility details");
  const category = details["category"];
  if (category !== "agents" && category !== "tools" && category !== "skills") {
    throw new Error("Invalid Taumel visibility category");
  }
  const rows = Array.isArray(details["rows"])
    ? details["rows"].filter(isRecord).map((row): Row => ({
      name: typeof row["name"] === "string" ? row["name"] : "",
      state: typeof row["state"] === "string" ? row["state"] : "",
      available: row["available"] === true,
      description: typeof row["description"] === "string" ? row["description"] : "",
    })).filter((row) => row.name !== "")
    : [];
  return {
    category,
    title: typeof details["title"] === "string" ? details["title"] : `Taumel ${category}`,
    rows,
    disabled: stringArray(details["disabled"]),
    unavailable: stringArray(details["unavailable"]),
  };
}

function detailsFromCommandResult(result: unknown): unknown {
  return isRecord(result) ? result["details"] : undefined;
}

function loadVisibilityState(core: CoreBridge, category: Category, ctx: unknown): VisibilityState {
  const result = coreCallRecord(core, "visibilityRows", [category, ctx], "visibility rows");
  return parseRows(detailsFromCommandResult(result));
}

function commandResult(ok: boolean, message: string, details: Record<string, unknown>): Record<string, unknown> {
  return { ok, action: "command_result", message, ...(ok ? {} : { error: message }), details };
}

function resultMessage(result: Record<string, unknown>): string {
  return typeof result["message"] === "string" ? result["message"] : "Visibility updated.";
}

function mutationOk(result: Record<string, unknown>): boolean {
  return result["ok"] === true;
}

class VisibilityManagerComponent {
  private selected = 0;
  private busy: string | undefined;
  private status: string | undefined;

  constructor(
    private state: VisibilityState,
    private readonly theme: ThemeLike,
    private readonly keybindings: KeybindingsLike,
    private readonly callbacks: ManagerCallbacks,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = this.baseHeader(width);
    lines.push(this.line(this.dim(`  ${column("State", 12)}  ${column("Name", 24)}  Description`), width));
    for (const row of this.state.rows) lines.push(this.renderRow(row, width));
    if (this.state.rows.length === 0) lines.push(this.line(this.dim("  Nothing registered."), width));
    this.addStatus(lines, width);
    lines.push("");
    lines.push(this.line(this.dim("  e toggle • ctrl+s save to project • esc close"), width));
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
    if (data === "e" || this.isConfirm(data)) {
      const row = this.state.rows[this.selected];
      if (row) this.runToggle(row.name);
    }
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

  private renderRow(row: Row, width: number): string {
    const selected = this.state.rows[this.selected]?.name === row.name;
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

  private moveSelection(delta: number): void {
    if (this.state.rows.length === 0) return;
    this.selected = (this.selected + delta + this.state.rows.length) % this.state.rows.length;
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
    this.selected = Math.max(0, Math.min(this.selected, Math.max(0, this.state.rows.length - 1)));
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
  details: unknown,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  const state = parseRows(details);
  if (!isProjectTrusted(ctx)) {
    const message = `Cannot save ${category} visibility: project is not trusted.`;
    return commandResult(false, message, { ...state, category });
  }
  const path = projectSettingsPath(ctx);
  let root: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      root = isRecord(parsed) ? { ...parsed } : {};
    } catch {
      root = {};
    }
  }
  const taumel = isRecord(root["taumel"]) ? { ...root["taumel"] } : {};
  const block = isRecord(taumel[category]) ? { ...taumel[category] } : {};
  block["disabled"] = [...disabled];
  taumel[category] = block;
  root["taumel"] = taumel;
  await writeFileAtomically(path, `${JSON.stringify(root, null, 2)}\n`);
  const stale = state.unavailable.length === 0 ? "" : ` Unavailable names remain: ${state.unavailable.join(", ")}.`;
  return commandResult(true, `Saved ${category} visibility to ${path}.${stale}`, { ...state, category, path });
}

async function saveFromCore(core: CoreBridge, category: Category, ctx: unknown): Promise<Record<string, unknown>> {
  const plan = coreCallRecord(core, "handleCommand", [category, "save", ctx], "visibility save plan");
  if (plan["action"] !== "visibility_save_project") return plan;
  return saveProjectVisibility(category, stringArrayFromUnknown(plan["disabled"]) ?? [], plan["details"], ctx);
}

export async function executeVisibilityManager(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
  syncTools: (enabledName?: string) => void,
): Promise<unknown> {
  const category = stringField(prompt, "category") as Category;
  const ui = uiFromContext(ctx);
  const custom = ui?.["custom"];
  if (typeof custom !== "function") {
    return coreCallRecord(core, "handleCommand", [category, "list", ctx], "visibility list result");
  }

  let state = loadVisibilityState(core, category, ctx);
  let dirty = false;

  const action = await custom.call(ui, (
    tui: unknown,
    theme: ThemeLike,
    keybindings: KeybindingsLike,
    done: (action: ManagerAction) => void,
  ) => {
    const requestRender = () => {
      if (isRecord(tui) && typeof tui["requestRender"] === "function") tui["requestRender"].call(tui);
    };
    return new VisibilityManagerComponent(state, theme, keybindings, {
      onDone: done,
      requestRender,
      onToggle: async (name) => {
        const result = coreCallRecord(core, "toggleVisibilityRow", [category, name, ctx], "visibility toggle result");
        const ok = mutationOk(result);
        if (ok) dirty = true;
        const enabledName = isRecord(result["details"]) && typeof result["details"]["enabledName"] === "string"
          ? result["details"]["enabledName"]
          : undefined;
        if (category === "tools") syncTools(enabledName);
        state = loadVisibilityState(core, category, ctx);
        const message = resultMessage(result);
        notify(ui, message, ok ? "info" : "warning");
        return { ok, message, state };
      },
      onSave: async () => {
        const result = await saveFromCore(core, category, ctx);
        const ok = mutationOk(result);
        state = loadVisibilityState(core, category, ctx);
        const message = resultMessage(result);
        notify(ui, message, ok ? "info" : "warning");
        return { ok, message, state };
      },
    });
  });

  if (isRecord(action) && action["kind"] === "exit") {
    return commandResult(true, dirty ? "Visibility updated." : "Visibility manager closed.", {
      ...state,
      category,
    });
  }
  return commandResult(true, "Visibility manager closed.", { ...state, category });
}

function toolNameFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (isRecord(value) && typeof value["name"] === "string" && value["name"] !== "") return value["name"];
  return undefined;
}

function liveToolNames(pi: PiLike): string[] {
  const fromRegistry =
    typeof pi.getAllTools === "function"
      ? pi.getAllTools().map(toolNameFromUnknown).filter((name): name is string => name !== undefined)
      : [];
  return [...new Set([...toolNames, ...fromRegistry])];
}

function listSkillNames(core: CoreBridge, ctx: unknown): string[] {
  const result = coreCallOptionalRecord(core, "listSkills", [{ cwd: cwdFromContext(ctx), includeDisabled: true }]);
  if (result === undefined || !Array.isArray(result["skills"])) return [];
  return result["skills"].filter(isRecord).flatMap((skill) =>
    typeof skill["name"] === "string" && skill["name"] !== "" ? [skill["name"]] : []
  );
}

function listAgentNames(core: CoreBridge, ctx: unknown): string[] {
  try {
    const state = loadVisibilityState(core, "agents", ctx);
    return state.rows.filter((row) => row.available).map((row) => row.name);
  } catch {
    return [];
  }
}

function notifyVisibilityWarnings(pi: PiLike, core: CoreBridge, ctx: unknown): void {
  const result = coreCallOptionalRecord(core, "visibilityWarnings", [{
    tools: liveToolNames(pi),
    skills: listSkillNames(core, ctx),
    agents: listAgentNames(core, ctx),
  }]);
  if (result === undefined) return;
  const messages = stringArrayFromUnknown(result["messages"]) ?? [];
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
