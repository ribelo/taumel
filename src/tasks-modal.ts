import type { CoreBridge } from "./types.ts";
import {
  decodeGatewayCommandOutput,
  type GatewayCommandOutput,
} from "./bridge-contracts.ts";
import {
  confirmSelection,
  promptModalText,
  showInteractiveList,
  type ModalTheme,
  type ModalUi,
} from "./modal.ts";
import { planTaskStatusColor } from "./tool-renderer-kit.ts";
import { isObjectLike } from "./util.ts";

type PlanTask = {
  readonly taskId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly origin: string;
  readonly depends_on: readonly string[];
};

type PlanPresentation = {
  readonly planId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly tasks: readonly PlanTask[];
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly tokensUsed: number;
  readonly timeUsedSeconds: number;
  readonly timeUsage: string;
  readonly timeLimitSeconds: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

type PlanDetails = {
  readonly plan: PlanPresentation | null;
  readonly automation?: unknown;
};

const footer = " ↑↓ move · a add · e edit · s advance · x cancel · d delete · q close";

function asPlanDetails(value: unknown): PlanDetails {
  if (!isObjectLike<{ readonly plan?: unknown }>(value)) {
    return { plan: null };
  }
  const plan = value.plan;
  if (plan === null || plan === undefined) return { plan: null };
  if (!isObjectLike<PlanPresentation>(plan) || !Array.isArray(plan.tasks)) {
    return { plan: null };
  }
  return { plan: plan as PlanPresentation };
}

function runPlanCommand(core: CoreBridge, ctx: unknown, args: string): GatewayCommandOutput {
  return decodeGatewayCommandOutput(core.call("handleCommand", [{ name: "plan", args, ctx }]));
}

function loadPlan(core: CoreBridge, ctx: unknown): PlanDetails {
  const result = runPlanCommand(core, ctx, "");
  if (!("action" in result) || result.action !== "command_result") {
    return { plan: null };
  }
  return asPlanDetails(result.details);
}

function notify(ui: ModalUi | undefined, message: string, level: "info" | "warning" = "warning"): void {
  const fn = ui?.notify;
  if (typeof fn === "function") {
    (fn as (message: string, level: string) => unknown).call(ui, message, level);
  }
}

function mutationError(result: GatewayCommandOutput): string | undefined {
  if (!("ok" in result)) return "plan command failed";
  if (result.ok === true && "action" in result && result.action === "command_result") {
    return undefined;
  }
  if ("error" in result && typeof result.error === "string" && result.error !== "") {
    return result.error;
  }
  if ("message" in result && typeof result.message === "string" && result.message !== "") {
    return result.message;
  }
  return "plan command failed";
}

function applyMutation(
  core: CoreBridge,
  ui: ModalUi | undefined,
  ctx: unknown,
  args: string,
): PlanDetails | undefined {
  const result = runPlanCommand(core, ctx, args);
  const error = mutationError(result);
  if (error !== undefined) {
    notify(ui, error, "warning");
    return undefined;
  }
  if (!("action" in result) || result.action !== "command_result") {
    notify(ui, "plan command failed", "warning");
    return undefined;
  }
  return asPlanDetails(result.details);
}

function renderTaskRow(
  task: PlanTask,
  _index: number,
  selected: boolean,
  theme: ModalTheme,
  width: number,
): string[] {
  const statusText = theme.fg(planTaskStatusColor(task.status), task.status);
  const marker = selected ? theme.fg("accent", "›") : " ";
  const head = `${marker} ${theme.fg("dim", task.taskId)} ${theme.fg("dim", "[")}${statusText}${theme.fg("dim", `/${task.origin}]:`)} ${theme.fg("toolOutput", task.title)}`;
  const lines = [head.length <= width ? head : `${head.slice(0, Math.max(0, width - 3))}...`];
  if (task.depends_on.length > 0) {
    const deps = `   ${theme.fg("dim", "depends on")} ${theme.fg("dim", task.depends_on.join(", "))}`;
    lines.push(deps.length <= width ? deps : `${deps.slice(0, Math.max(0, width - 3))}...`);
  }
  return lines;
}

function emptyLines(theme: ModalTheme, _width: number): string[] {
  return [
    theme.fg("dim", " No plan yet."),
    theme.fg("dim", " Press a to add the first task."),
  ];
}

async function promptNewTask(
  ui: ModalUi | undefined,
): Promise<{ title: string; description?: string } | undefined> {
  const titleRaw = await promptModalText(ui, "Task title", "required");
  if (titleRaw === undefined) return undefined;
  const title = titleRaw.trim();
  if (title === "") return undefined;
  const descriptionRaw = await promptModalText(ui, "Task description", "optional");
  // Description is optional: cancel or blank both mean no description.
  const description = descriptionRaw?.trim() ?? "";
  return description === "" ? { title } : { title, description };
}

async function promptEditTask(
  ui: ModalUi | undefined,
  task: PlanTask,
): Promise<{ title?: string; description?: string | null } | undefined> {
  const titleRaw = await promptModalText(ui, "Task title", task.title);
  if (titleRaw === undefined) return undefined;
  const titleTrimmed = titleRaw.trim();
  // Empty keeps current value (^plan-kz4n).
  const title = titleTrimmed === "" ? undefined : titleTrimmed;
  const descriptionPlaceholder = task.description ?? "";
  const descriptionRaw = await promptModalText(ui, "Task description", descriptionPlaceholder);
  if (descriptionRaw === undefined) return undefined;
  const descriptionTrimmed = descriptionRaw.trim();
  if (descriptionTrimmed === "") {
    // Empty keeps current description.
    return title === undefined ? {} : { title };
  }
  return title === undefined
    ? { description: descriptionTrimmed }
    : { title, description: descriptionTrimmed };
}

function jsonPayload(fields: { readonly title?: string; readonly description?: string | null }): string {
  return JSON.stringify(fields);
}

export async function executeTasksModal(
  core: CoreBridge,
  ctx: unknown,
): Promise<unknown> {
  const ui = (typeof ctx === "object" && ctx !== null
    ? (ctx as { readonly ui?: unknown }).ui
    : undefined) as ModalUi | undefined;

  let details = loadPlan(core, ctx);
  let cursor = 0;

  while (true) {
    const tasks = details.plan?.tasks ?? [];
    const selection = await showInteractiveList(ui, {
      items: tasks,
      renderRow: renderTaskRow,
      emptyLines,
      footer,
      actionKeys: ["a", "e", "s", "x", "d"],
      initialIndex: cursor,
    });
    if (selection === undefined) {
      return {
        ok: true,
        action: "command_result",
        message: "Tasks unchanged.",
        details,
        inspection: true,
      };
    }
    cursor = selection.index;
    const selected = tasks[selection.index];

    if (selection.key === "a") {
      const created = await promptNewTask(ui);
      if (created === undefined) continue;
      const payload = created.description === undefined
        ? { title: created.title }
        : { title: created.title, description: created.description };
      const next = applyMutation(core, ui, ctx, `task add ${jsonPayload(payload)}`);
      if (next !== undefined) {
        details = next;
        cursor = Math.max(0, (next.plan?.tasks.length ?? 1) - 1);
      }
      continue;
    }

    if (selected === undefined) continue;

    if (selection.key === "e") {
      const edited = await promptEditTask(ui, selected);
      if (edited === undefined) continue;
      if (edited.title === undefined && edited.description === undefined) continue;
      const next = applyMutation(
        core,
        ui,
        ctx,
        `task edit ${selected.taskId} ${jsonPayload(edited)}`,
      );
      if (next !== undefined) details = next;
      continue;
    }

    if (selection.key === "s") {
      if (selected.status === "completed" || selected.status === "cancelled") {
        notify(ui, `cannot advance a ${selected.status} task`, "warning");
        continue;
      }
      const next = applyMutation(core, ui, ctx, `task advance ${selected.taskId}`);
      if (next !== undefined) details = next;
      continue;
    }

    if (selection.key === "x") {
      if (selected.status === "completed" || selected.status === "cancelled") {
        notify(ui, `cannot cancel a ${selected.status} task`, "warning");
        continue;
      }
      if (!await confirmSelection(ui, `Cancel ${selected.taskId}?`, "Confirm cancel")) {
        continue;
      }
      const next = applyMutation(core, ui, ctx, `task cancel ${selected.taskId}`);
      if (next !== undefined) details = next;
      continue;
    }

    if (selection.key === "d") {
      if (!await confirmSelection(ui, `Delete ${selected.taskId}?`, "Confirm delete")) {
        continue;
      }
      const next = applyMutation(core, ui, ctx, `task delete ${selected.taskId}`);
      if (next !== undefined) {
        details = next;
        const remaining = next.plan?.tasks.length ?? 0;
        cursor = Math.min(cursor, Math.max(0, remaining - 1));
      }
      continue;
    }
  }
}
