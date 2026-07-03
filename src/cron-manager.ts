import { Key, type KeyId, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { CoreBridge } from "./types.ts";
import { coreCall, isRecord, stringField } from "./util.ts";

type CronMode = "message" | "goal";

type CronTask = {
  readonly id: string;
  readonly cron: string;
  readonly prompt: string;
  readonly recurring: boolean;
  readonly mode: CronMode;
  readonly enabled: boolean;
  readonly nextDueText: string;
  readonly pending: boolean;
};

type CronState = {
  readonly enabled: boolean;
  readonly tasks: readonly CronTask[];
};

type ManagerAction =
  | { readonly kind: "exit" }
  | { readonly kind: "edit_prompt"; readonly id: string }
  | { readonly kind: "edit_schedule"; readonly id: string };

type MutationAction =
  | { readonly kind: "toggle_master" }
  | { readonly kind: "toggle_task"; readonly id: string }
  | { readonly kind: "cancel_task"; readonly id: string }
  | { readonly kind: "toggle_recurring"; readonly id: string }
  | { readonly kind: "toggle_mode"; readonly id: string };

type MutationOutcome = {
  readonly ok: boolean;
  readonly message: string;
  readonly state: CronState;
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

type CronManagerCallbacks = {
  readonly onDone: (action: ManagerAction) => void;
  readonly onMutate: (action: MutationAction) => Promise<MutationOutcome>;
  readonly requestRender: () => void;
};

function commandResult(ok: boolean, message: string, details: Record<string, unknown>): Record<string, unknown> {
  return { ok, action: "command_result", message, ...(ok ? {} : { error: message }), details };
}

function boolField(record: Record<string, unknown>, name: string): boolean {
  return record[name] === true;
}

function stringOr(record: Record<string, unknown>, name: string, fallback: string): string {
  const value = record[name];
  return typeof value === "string" ? value : fallback;
}

function parseTask(value: unknown): CronTask | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringOr(value, "id", "");
  const cron = stringOr(value, "cron", "");
  if (id === "" || cron === "") return undefined;
  const mode = value["mode"] === "goal" ? "goal" : "message";
  return {
    id,
    cron,
    prompt: stringOr(value, "prompt", ""),
    recurring: boolField(value, "recurring"),
    mode,
    enabled: boolField(value, "enabled"),
    nextDueText: stringOr(value, "nextDueText", String(value["nextDue"] ?? "")),
    pending: boolField(value, "pending"),
  };
}

function stateDetails(state: CronState): Record<string, unknown> {
  return { enabled: state.enabled, tasks: state.tasks };
}

function parseStateFromDetails(details: unknown): CronState {
  if (!isRecord(details)) throw new Error("Invalid Taumel cron details");
  const tasks = Array.isArray(details["tasks"])
    ? details["tasks"].map(parseTask).filter((task): task is CronTask => task !== undefined)
    : [];
  return { enabled: boolField(details, "enabled"), tasks };
}

function loadCronState(core: CoreBridge, ctx: unknown): CronState {
  const result = coreCall(core, "prepareTool", ["cron_list", {}, ctx]);
  if (!isRecord(result)) throw new Error("Invalid Taumel cron list result");
  return parseStateFromDetails(result["details"]);
}

function uiFromContext(ctx: unknown): UiLike | undefined {
  return isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
}

function notify(ui: UiLike | undefined, message: string, level: "info" | "warning" = "info"): void {
  const fn = ui?.["notify"];
  if (typeof fn === "function") fn.call(ui, message, level);
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
  return padToWidth(truncateToWidth(text, width, "…"), width);
}

function taskTableRow(
  id: string,
  state: string,
  schedule: string,
  mode: string,
  type: string,
  next: string,
): string {
  return [
    column(id, 8),
    column(state, 8),
    column(schedule, 19),
    column(mode, 7),
    column(type, 9),
    next,
  ].join("  ");
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

function normalizeCronInput(input: string): string {
  return input.trim().split(/\s+/).join(" ");
}

function taskModeLabel(task: CronTask): string {
  return task.mode === "goal" ? "goal" : "message";
}

function taskTypeLabel(task: CronTask): string {
  return task.recurring ? "recurring" : "one-shot";
}

function taskStatusLabel(task: CronTask): string {
  return task.enabled ? "enabled" : "disabled";
}

function taskById(state: CronState, id: string): CronTask | undefined {
  return state.tasks.find((task) => task.id === id);
}

class CronManagerComponent {
  private selected = 0;
  private view: "list" | "details" | "confirm_cancel" = "list";
  private busy: string | undefined;
  private status: string | undefined;

  constructor(
    private state: CronState,
    private readonly theme: ThemeLike,
    private readonly keybindings: KeybindingsLike,
    private readonly callbacks: CronManagerCallbacks,
    selectedId?: string,
  ) {
    if (selectedId) {
      const index = state.tasks.findIndex((task) => task.id === selectedId);
      if (index >= 0) this.selected = index + 1;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.view === "details") return this.renderDetails(width);
    if (this.view === "confirm_cancel") return this.renderConfirmCancel(width);
    return this.renderList(width);
  }

  handleInput(data: string): void {
    if (this.busy !== undefined) return;
    if (this.view === "confirm_cancel") {
      this.handleConfirmInput(data);
      return;
    }
    if (this.view === "details" && this.isCancel(data)) {
      this.view = "list";
      this.callbacks.requestRender();
      return;
    }
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
    if (data === "m") {
      this.runMutation({ kind: "toggle_master" });
      return;
    }
    if (this.isConfirm(data)) {
      this.openDetails();
      return;
    }
    this.handleTaskShortcut(data);
  }

  private renderList(width: number): string[] {
    const lines = this.baseHeader(width);
    lines.push(this.renderMasterRow(width));
    lines.push("");
    lines.push(this.line(this.dim(`  ${taskTableRow("ID", "State", "Schedule", "Mode", "Type", "Next")}`), width));
    for (const task of this.state.tasks) lines.push(this.renderTaskRow(task, width));
    if (this.state.tasks.length === 0) lines.push(this.line(this.dim("  No cron tasks."), width));
    this.addStatus(lines, width);
    lines.push("");
    lines.push(this.line(this.dim("  ↑↓ select • enter details • e toggle • c cancel • p prompt • s schedule"), width));
    lines.push(this.line(this.dim("  r recurring • g goal/message • m master • esc close"), width));
    lines.push(this.border(width));
    return lines;
  }

  private renderDetails(width: number): string[] {
    const task = this.selectedTask();
    if (!task) return this.renderList(width);
    const lines = this.baseHeader(width, `Cron task ${task.id}`);
    lines.push(this.line(`  id:        ${task.id}`, width));
    lines.push(this.line(`  enabled:   ${taskStatusLabel(task)}`, width));
    lines.push(this.line(`  schedule:  ${task.cron}`, width));
    lines.push(this.line(`  next:      ${task.nextDueText}${task.pending ? " (pending)" : ""}`, width));
    lines.push(this.line(`  mode:      ${taskModeLabel(task)}`, width));
    lines.push(this.line(`  type:      ${taskTypeLabel(task)}`, width));
    lines.push("");
    lines.push(this.line(this.accent("  Prompt"), width));
    const promptLines = wrapTextWithAnsi(task.prompt || "(empty)", Math.max(1, width - 4));
    for (const line of promptLines) lines.push(this.line(`  ${line}`, width));
    this.addStatus(lines, width);
    lines.push("");
    lines.push(this.line(this.dim("  p edit prompt • s edit schedule • e toggle • c cancel • r recurring"), width));
    lines.push(this.line(this.dim("  g goal/message • esc back"), width));
    lines.push(this.border(width));
    return lines;
  }

  private renderConfirmCancel(width: number): string[] {
    const task = this.selectedTask();
    if (!task) return this.renderList(width);
    const lines = this.baseHeader(width, "Confirm cancel");
    lines.push(this.line(`  Cancel cron task ${task.id}?`, width));
    lines.push(this.line(this.dim(`  ${task.cron} • ${taskModeLabel(task)} • next=${task.nextDueText}`), width));
    lines.push("");
    lines.push(this.line(this.dim("  y/enter/c confirm • n/esc back"), width));
    lines.push(this.border(width));
    return lines;
  }

  private baseHeader(width: number, subtitle = "Manage cron tasks"): string[] {
    return [
      this.border(width),
      this.line(this.accent(bold(this.theme, subtitle)), width),
      this.line(`  Cron master: ${this.state.enabled ? "enabled" : "disabled"}`, width),
      "",
    ];
  }

  private renderMasterRow(width: number): string {
    const selected = this.selected === 0;
    return this.renderRow(`Master switch: ${this.state.enabled ? "enabled" : "disabled"}  m/e toggle`, selected, width);
  }

  private renderTaskRow(task: CronTask, width: number): string {
    const index = this.state.tasks.findIndex((item) => item.id === task.id) + 1;
    const row = taskTableRow(
      task.id,
      taskStatusLabel(task),
      task.cron,
      taskModeLabel(task),
      taskTypeLabel(task),
      `${task.nextDueText}${task.pending ? " pending" : ""}`,
    );
    return this.renderRow(row, this.selected === index, width);
  }

  private renderRow(text: string, selected: boolean, width: number): string {
    const prefix = selected ? this.accent("→ ") : "  ";
    const row = selected ? bg(this.theme, "selectedBg", this.accent(text)) : text;
    return this.line(prefix + row, width);
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
    return this.accent("─".repeat(width));
  }

  private accent(text: string): string {
    return fg(this.theme, "accent", text);
  }

  private dim(text: string): string {
    return fg(this.theme, "dim", text);
  }

  private selectedTask(): CronTask | undefined {
    return this.selected > 0 ? this.state.tasks[this.selected - 1] : undefined;
  }

  private openDetails(): void {
    if (this.selectedTask()) {
      this.view = "details";
      this.callbacks.requestRender();
    }
  }

  private handleTaskShortcut(data: string): void {
    const task = this.selectedTask();
    if (!task) {
      if (data === "e") this.runMutation({ kind: "toggle_master" });
      return;
    }
    if (data === "e") this.runMutation({ kind: "toggle_task", id: task.id });
    else if (data === "c") {
      this.view = "confirm_cancel";
      this.callbacks.requestRender();
    } else if (data === "p" || data === "i") this.callbacks.onDone({ kind: "edit_prompt", id: task.id });
    else if (data === "s") this.callbacks.onDone({ kind: "edit_schedule", id: task.id });
    else if (data === "r") this.runMutation({ kind: "toggle_recurring", id: task.id });
    else if (data === "g") this.runMutation({ kind: "toggle_mode", id: task.id });
  }

  private handleConfirmInput(data: string): void {
    const task = this.selectedTask();
    if (!task) return;
    if (this.isCancel(data) || data === "n") {
      this.view = "list";
      this.callbacks.requestRender();
    } else if (this.isConfirm(data) || data === "y" || data === "c") {
      this.runMutation({ kind: "cancel_task", id: task.id });
    }
  }

  private moveSelection(delta: number): void {
    const count = this.state.tasks.length + 1;
    this.selected = (this.selected + delta + count) % count;
    if (this.view === "details" && this.selected === 0) this.view = "list";
    this.callbacks.requestRender();
  }

  private runMutation(action: MutationAction): void {
    this.busy = "Updating cron task…";
    this.status = undefined;
    this.callbacks.requestRender();
    void this.callbacks.onMutate(action).then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.clampSelection();
      if (action.kind === "cancel_task") this.view = "list";
      this.callbacks.requestRender();
    });
  }

  private clampSelection(): void {
    this.selected = Math.max(0, Math.min(this.selected, this.state.tasks.length));
    if (this.view === "details" && this.selected === 0) this.view = "list";
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

function command(core: CoreBridge, args: string, ctx: unknown): Record<string, unknown> {
  const result = coreCall(core, "handleCommand", ["cron", args, ctx]);
  if (!isRecord(result)) throw new Error("Invalid Taumel cron command result");
  return result;
}

function updateTask(core: CoreBridge, patch: Record<string, unknown>, ctx: unknown): Record<string, unknown> {
  const result = coreCall(core, "cronUpdateTask", [patch, ctx]);
  if (!isRecord(result)) throw new Error("Invalid Taumel cron update result");
  return result;
}

function resultMessage(result: Record<string, unknown>): string {
  return typeof result["message"] === "string" ? result["message"] : "Cron updated.";
}

function mutationOk(result: Record<string, unknown>): boolean {
  return result["ok"] === true;
}

async function runMutation(
  core: CoreBridge,
  action: MutationAction,
  state: CronState,
  ctx: unknown,
  ui: UiLike | undefined,
): Promise<MutationOutcome> {
  const task = "id" in action ? taskById(state, action.id) : undefined;
  const result = (() => {
    switch (action.kind) {
      case "toggle_master":
        return command(core, state.enabled ? "disable" : "enable", ctx);
      case "toggle_task":
        return command(core, task?.enabled ? `disable ${action.id}` : `enable ${action.id}`, ctx);
      case "cancel_task":
        return command(core, `cancel ${action.id}`, ctx);
      case "toggle_recurring":
        return updateTask(core, { id: action.id, recurring: !(task?.recurring ?? true) }, ctx);
      case "toggle_mode":
        return updateTask(core, { id: action.id, mode: task?.mode === "goal" ? "message" : "goal" }, ctx);
    }
  })();
  const nextState = loadCronState(core, ctx);
  const ok = mutationOk(result);
  const message = resultMessage(result);
  notify(ui, message, ok ? "info" : "warning");
  return { ok, message, state: nextState };
}

async function editTaskPrompt(
  core: CoreBridge,
  ctx: unknown,
  ui: UiLike | undefined,
  task: CronTask,
): Promise<boolean> {
  const editor = ui?.["editor"];
  if (typeof editor !== "function") {
    notify(ui, "Prompt editing requires Pi TUI editor support.", "warning");
    return false;
  }
  const edited = await editor.call(ui, `Edit cron prompt ${task.id}`, task.prompt);
  if (typeof edited !== "string") return false;
  const result = updateTask(core, { id: task.id, prompt: edited }, ctx);
  notify(ui, resultMessage(result), mutationOk(result) ? "info" : "warning");
  return mutationOk(result);
}

async function editTaskSchedule(
  core: CoreBridge,
  ctx: unknown,
  ui: UiLike | undefined,
  task: CronTask,
): Promise<boolean> {
  const editor = ui?.["editor"];
  if (typeof editor !== "function") {
    notify(ui, "Schedule editing requires Pi TUI editor support.", "warning");
    return false;
  }
  const edited = await editor.call(ui, `Edit cron schedule ${task.id}`, task.cron);
  if (typeof edited !== "string") return false;
  const result = updateTask(core, { id: task.id, cron: normalizeCronInput(edited) }, ctx);
  notify(ui, resultMessage(result), mutationOk(result) ? "info" : "warning");
  return mutationOk(result);
}

function fallbackCronPrompt(core: CoreBridge, prompt: Record<string, unknown>, ctx: unknown): unknown {
  const plan = coreCall(core, "planCronPrompt", [prompt, { uiAvailable: false }]);
  if (isRecord(plan) && plan["action"] === "result" && isRecord(plan["result"])) return plan["result"];
  const state = loadCronState(core, ctx);
  return commandResult(true, state.tasks.length === 0 ? "No cron tasks." : "Cron tasks listed.", stateDetails(state));
}

function parseManagerAction(value: unknown): ManagerAction {
  if (!isRecord(value)) return { kind: "exit" };
  const kind = stringOr(value, "kind", "exit");
  if (kind === "edit_prompt" || kind === "edit_schedule") return { kind, id: stringField(value, "id") };
  return { kind: "exit" };
}

export async function executeCronManager(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  const ui = uiFromContext(ctx);
  const custom = ui?.["custom"];
  if (typeof custom !== "function") return fallbackCronPrompt(core, prompt, ctx);

  let state = loadCronState(core, ctx);
  let selectedId: string | undefined;
  let dirty = false;

  while (true) {
    if (state.tasks.length === 0) return commandResult(true, "No cron tasks.", stateDetails(state));
    const action = parseManagerAction(await custom.call(ui, (tui: unknown, theme: ThemeLike, keybindings: KeybindingsLike, done: (action: ManagerAction) => void) => {
      const requestRender = () => {
        if (isRecord(tui) && typeof tui["requestRender"] === "function") tui["requestRender"].call(tui);
      };
      return new CronManagerComponent(state, theme, keybindings, {
        onDone: done,
        requestRender,
        onMutate: async (mutation) => {
          const outcome = await runMutation(core, mutation, state, ctx, ui);
          dirty = dirty || outcome.ok;
          state = outcome.state;
          return outcome;
        },
      }, selectedId);
    }));

    if (action.kind === "exit") {
      const message = dirty ? "Cron tasks updated." : "Cron manager closed.";
      return commandResult(true, message, stateDetails(state));
    }

    selectedId = action.id;
    const task = taskById(state, action.id);
    if (!task) {
      notify(ui, `No cron task matched ${action.id}.`, "warning");
      state = loadCronState(core, ctx);
      continue;
    }
    dirty = action.kind === "edit_prompt"
      ? (await editTaskPrompt(core, ctx, ui, task)) || dirty
      : (await editTaskSchedule(core, ctx, ui, task)) || dirty;
    state = loadCronState(core, ctx);
  }
}
