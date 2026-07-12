import { DynamicBorder, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Key, type SelectItem, SelectList, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { CoreBridge } from "./types.ts";
import { decodeCronCommandResult, decodeCronListResult, decodeCronPrompt, decodeCronPromptPlan, type CronPrompt, type CronTaskPatch } from "./bridge-contracts.ts";
import {
  bold,
  commandResult,
  fg,
  matchesSelect,
  mutationOk,
  notify,
  requestRenderFromTui,
  resultMessage,
  type KeybindingsLike,
  type ThemeLike,
  type UiLike,
  uiFromContext,
} from "./manager-kit.ts";

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
type CronStateDetails = { readonly enabled: boolean; readonly tasks: readonly CronTask[] };

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

type CronManagerCallbacks = {
  readonly onDone: (action: ManagerAction) => void;
  readonly onMutate: (action: MutationAction) => Promise<MutationOutcome>;
  readonly requestRender: () => void;
};

function stateDetails(state: CronState): CronStateDetails {
  return { enabled: state.enabled, tasks: state.tasks };
}

function loadCronState(core: CoreBridge, ctx: unknown): CronState {
  return decodeCronListResult(core.call("prepareTool", [{ name: "cron_list", params: {}, ctx }])).details;
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
  private selectList: SelectList;
  private readonly frame: DynamicBorder;

  constructor(
    private state: CronState,
    private readonly theme: ThemeLike,
    private readonly keybindings: KeybindingsLike,
    private readonly callbacks: CronManagerCallbacks,
    selectedId?: string,
  ) {
    this.frame = new DynamicBorder((text: string) => fg(this.theme, "accent", text));
    if (selectedId) {
      const index = state.tasks.findIndex((task) => task.id === selectedId);
      if (index >= 0) this.selected = index + 1;
    }
    this.selectList = this.createSelectList();
  }

  invalidate(): void {
    this.frame.invalidate();
    this.selectList.invalidate();
  }

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
    if (this.view === "details") {
      if (this.isCancel(data)) {
        this.view = "list";
        this.callbacks.requestRender();
      } else {
        this.handleTaskShortcut(data);
      }
      return;
    }
    if (data === "m") {
      this.runMutation({ kind: "toggle_master" });
      return;
    }
    if (["e", "c", "p", "i", "s", "r", "g"].includes(data)) {
      this.handleTaskShortcut(data);
      return;
    }
    this.selectList.handleInput(data);
    this.callbacks.requestRender();
  }

  private renderList(width: number): string[] {
    const lines = this.baseHeader(width);
    lines.push(...this.selectList.render(width));
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

  private createSelectList(): SelectList {
    const items: SelectItem[] = [
      {
        value: "master",
        label: "Master switch:",
        description: this.state.enabled ? "enabled" : "disabled",
      },
      ...this.state.tasks.map((task) => ({
        value: task.id,
        label: task.id,
        description: [
          taskStatusLabel(task),
          task.cron,
          taskModeLabel(task),
          taskTypeLabel(task),
          `${task.nextDueText}${task.pending ? " pending" : ""}`,
        ].join(" • "),
      })),
    ];
    const list = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
    list.setSelectedIndex(this.selected);
    list.onSelectionChange = (item) => {
      this.selected = item.value === "master"
        ? 0
        : Math.max(1, this.state.tasks.findIndex((task) => task.id === item.value) + 1);
    };
    list.onSelect = (item) => {
      if (item.value === "master") {
        this.runMutation({ kind: "toggle_master" });
      } else {
        this.selected = Math.max(1, this.state.tasks.findIndex((task) => task.id === item.value) + 1);
        this.openDetails();
      }
    };
    list.onCancel = () => this.callbacks.onDone({ kind: "exit" });
    return list;
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
      this.selectList = this.createSelectList();
      this.callbacks.requestRender();
    });
  }

  private clampSelection(): void {
    this.selected = Math.max(0, Math.min(this.selected, this.state.tasks.length));
    if (this.view === "details" && this.selected === 0) this.view = "list";
  }

  private isConfirm(data: string): boolean {
    return matchesSelect(this.keybindings, data, "tui.select.confirm", Key.enter);
  }

  private isCancel(data: string): boolean {
    return matchesSelect(this.keybindings, data, "tui.select.cancel", Key.escape);
  }
}

function command(core: CoreBridge, args: string, ctx: unknown) {
  return decodeCronCommandResult(core.call("handleCronManagerCommand", [{ args, ctx }]));
}

function updateTask(core: CoreBridge, patch: CronTaskPatch, ctx: unknown) {
  return decodeCronCommandResult(core.call("cronUpdateTask", [{ patch, ctx }]));
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
  const message = resultMessage(result, "Cron updated.");
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
  notify(ui, resultMessage(result, "Cron updated."), mutationOk(result) ? "info" : "warning");
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
  notify(ui, resultMessage(result, "Cron updated."), mutationOk(result) ? "info" : "warning");
  return mutationOk(result);
}

function fallbackCronPrompt(core: CoreBridge, prompt: CronPrompt): unknown {
  return decodeCronPromptPlan(core.call("planCronPrompt", [{ prompt, uiAvailable: false }])).result;
}

function parseManagerAction(value: unknown): ManagerAction {
  if (typeof value !== "object" || value === null) return { kind: "exit" };
  const candidate = value as { kind?: unknown; id?: unknown };
  if ((candidate.kind === "edit_prompt" || candidate.kind === "edit_schedule") && typeof candidate.id === "string") {
    return { kind: candidate.kind, id: candidate.id };
  }
  return { kind: "exit" };
}

export async function executeCronManager(
  core: CoreBridge,
  rawPrompt: unknown,
  ctx: unknown,
): Promise<unknown> {
  const prompt = decodeCronPrompt(rawPrompt);
  const ui = uiFromContext(ctx);
  const custom = ui?.["custom"];
  if (typeof custom !== "function") return fallbackCronPrompt(core, prompt);

  let state = loadCronState(core, ctx);
  let selectedId: string | undefined;
  let dirty = false;

  while (true) {
    if (state.tasks.length === 0) return commandResult(true, "No cron tasks.", stateDetails(state));
    const action = parseManagerAction(await custom.call(ui, (tui: unknown, theme: ThemeLike, keybindings: KeybindingsLike, done: (action: ManagerAction) => void) => {
      const requestRender = requestRenderFromTui(tui);
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
