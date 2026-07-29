import type { CoreBridge, PiLike } from "./types.ts";
import { executeAgentPrepared, pendingAgentWaits } from "./agent-orchestration.ts";
import {
  commandResult,
  notify,
  uiFromContext,
} from "./manager-kit.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
} from "./child-sessions.ts";
import type { ChildSessionBridge } from "./types.ts";
import {
  decodeAgentManagerSnapshot,
  decodeCoreAck,
  decodeGatewayCommandOutput,
  decodePreparedToolAction,
  type AgentManagerSnapshot,
  type GatewayCommandOutput,
} from "./bridge-contracts.ts";
import { showAgentInspection, statusColor } from "./agent-inspection.ts";
import {
  confirmSelection,
  showInteractiveList,
  showScrollModal,
  wrapModalText,
  type ModalTheme,
} from "./modal.ts";
import { formatRelativeDuration, isObjectLike } from "./util.ts";
import { truncateToWidth } from "@earendil-works/pi-tui";

type UnknownFields = { readonly [key: string]: unknown };

type AgentListItem = AgentManagerSnapshot["agents"][number];
type AgentRunItem = AgentManagerSnapshot["runs"][number];

function loadSnapshot(core: CoreBridge, ctx: unknown): AgentManagerSnapshot {
  return decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [{ ctx }]));
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "lost"]);

type PickerItem = {
  readonly agent: AgentListItem;
  readonly latest: AgentRunItem | undefined;
  readonly baseline: number;
};

function pickerItems(snapshot: AgentManagerSnapshot): PickerItem[] {
  const items = snapshot.agents.map((agent) => {
    const latest = snapshot.runs.find((run) => run.agentId === agent.agentId);
    const baseline = latest === undefined ? agent.createdAt : (latest.lastActivityAt ?? latest.startedAt);
    return { agent, latest, baseline };
  });
  // agent-wuyh: non-terminal latest run first, most recent activity first within a group.
  const rank = (item: PickerItem) =>
    item.latest !== undefined && TERMINAL_RUN_STATUSES.has(item.latest.status) ? 1 : 0;
  return [...items].sort((a, b) => (rank(a) - rank(b)) || (b.baseline - a.baseline));
}

function pickerRow(
  item: PickerItem,
  selected: boolean,
  theme: ModalTheme,
  width: number,
  nowMs: number,
): string[] {
  const cursor = selected ? theme.fg("accent", "→ ") : "  ";
  const header = `${item.agent.agentId} · ${item.agent.kind}`;
  if (item.latest === undefined) return [truncateToWidth(`${cursor}${header}`, width, "...")];
  const run = item.latest;
  // agent-ui09: activity state only beside a running status.
  const activity = run.status === "running" ? ` · ${run.activityState}` : "";
  const status = theme.fg(statusColor(run.status), `${run.status}${activity}`);
  const ageSeconds = Math.max(0, Math.floor(nowMs / 1000) - item.baseline);
  const line =
    `${cursor}${header} · ${status} · ${run.description} · ${run.turnCount} turns · ${formatRelativeDuration(ageSeconds)}`;
  return [truncateToWidth(line, width, "...")];
}

function runLabel(run: AgentRunItem): string {
  const activity = run.status === "running" ? ` · ${run.activityState}` : "";
  const baseline = run.lastActivityAt ?? run.startedAt;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - baseline);
  return `${run.runId} · ${run.status}${activity} · ${run.description} · ${run.turnCount} turns · ${formatRelativeDuration(age)}`;
}

function resultOk(result: unknown): boolean {
  return isObjectLike<{ readonly ok?: unknown }>(result) && result.ok === true;
}

function resultErrorMessage(result: unknown, fallback: string): string {
  if (isObjectLike<{ readonly error?: unknown; readonly message?: unknown }>(result)) {
    if (typeof result.error === "string" && result.error !== "") return result.error;
    if (typeof result.message === "string" && result.message !== "") return result.message;
  }
  return fallback;
}

type ManagerUi = ReturnType<typeof uiFromContext>;

function notifyOutcome(ui: ManagerUi, result: unknown, successMessage: string): void {
  if (resultOk(result)) notify(ui, successMessage, "info");
  else notify(ui, resultErrorMessage(result, "Action failed."), "warning");
}

async function fetchLatestInstruction(
  core: CoreBridge,
  ctx: unknown,
  agentId: string,
): Promise<string | undefined> {
  const result = await runAgentRunsCommand(core, ctx, `instruction ${agentId}`);
  if (!("action" in result) || result.action !== "command_result" || result.ok !== true) return undefined;
  const details = isObjectLike<{ readonly available?: unknown }>(result.details) ? result.details : undefined;
  if (details?.available !== true) return undefined;
  return result.message.trim() === "" ? undefined : result.message;
}

async function runAgentRunsCommand(
  core: CoreBridge,
  ctx: unknown,
  args: string,
): Promise<GatewayCommandOutput> {
  return decodeGatewayCommandOutput(core.call("handleCommand", [{ name: "agent-runs", args, ctx }]));
}

async function applyChildUpdates(
  childSessions: Map<string, ChildSessionBridge>,
  result: unknown,
  ctx: unknown,
): Promise<void> {
  if (!isObjectLike<UnknownFields>(result)) return;
  const details = isObjectLike<UnknownFields>(result.details) ? result.details : {};
  const updates = Array.isArray(details.childSessionUpdates) ? details.childSessionUpdates : [];
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  for (const update of updates) {
    if (isObjectLike<UnknownFields>(update)) {
      await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
    }
  }
}

async function closeAgent(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  agentId: string,
  ctx: unknown,
): Promise<unknown> {
  const prepared = decodePreparedToolAction(core.call("prepareTool", [{
    name: "agent_close",
    params: { agent_id: agentId },
    ctx,
  }]));
  if (prepared.ok !== true || prepared.action !== "agent_close") return prepared;
  const result = await executeAgentPrepared(
    pi, core, childSessions, pendingAgentWaits, prepared, ctx,
  );
  const details = isObjectLike<UnknownFields>(result.details) ? result.details : {};
  const error = typeof details.error === "string"
    ? details.error
    : isObjectLike<UnknownFields>(details.error) && typeof details.error.message === "string"
      ? details.error.message
      : undefined;
  return error === undefined
    ? commandResult(true, `Closed ${agentId}.`, { agent_id: agentId, status: "closed" })
    : commandResult(false, `Agent close failed: ${error}`, { agent_id: agentId, error });
}

async function showRunOutput(
  core: CoreBridge,
  ui: ManagerUi,
  ctx: unknown,
  runId: string,
): Promise<void> {
  const result = await runAgentRunsCommand(core, ctx, `output ${runId}`);
  if (!("action" in result) || result.action !== "command_result" || result.ok !== true) {
    notify(ui, resultErrorMessage(result, `No output for ${runId}.`), "warning");
    return;
  }
  const output = result.message;
  await showScrollModal(ui, (width, theme) => [
    theme.fg("accent", ` Output ${runId}`),
    "",
    ...(output.trim() === ""
      ? [theme.fg("dim", " No output.")]
      : wrapModalText(output, Math.max(1, width - 2)).map((line) => ` ${line}`)),
  ]);
}

async function pickRunAndShowOutput(
  core: CoreBridge,
  ui: ManagerUi,
  ctx: unknown,
  snapshot: AgentManagerSnapshot,
  agentId: string,
): Promise<void> {
  const agentRuns = snapshot.runs.filter((run) => run.agentId === agentId);
  if (agentRuns.length === 0) {
    notify(ui, `No runs for ${agentId}.`, "info");
    return;
  }
  const select = (ui as { select?: unknown } | undefined)?.select;
  if (typeof select !== "function") {
    await showRunOutput(core, ui, ctx, agentRuns[0]!.runId);
    return;
  }
  const labels = agentRuns.map(runLabel);
  const selected = await (select as (title: string, labels: string[]) => Promise<string | undefined>).call(
    ui,
    `Runs for ${agentId}`,
    labels,
  );
  const index = typeof selected === "string" ? labels.indexOf(selected) : -1;
  const run = index >= 0 ? agentRuns[index] : undefined;
  if (run === undefined) return;
  await showRunOutput(core, ui, ctx, run.runId);
}

export async function executeAgentRunsManager(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  args: string,
  ctx: unknown,
): Promise<unknown> {
  const trimmed = args.trim();
  if (trimmed !== "") {
    if (trimmed.startsWith("close ")) {
      const agentId = trimmed.slice("close ".length).trim();
      if (agentId !== "") {
        const ui = uiFromContext(ctx);
        if (typeof (ui as { select?: unknown } | undefined)?.select !== "function") {
          return commandResult(false, "Closing an agent requires interactive confirmation.", {
            agent_id: agentId,
          });
        }
        if (!await confirmSelection(ui, `Close ${agentId}?`, "Confirm close")) {
          return commandResult(true, "Agent close cancelled.", { cancelled: true, agent_id: agentId });
        }
        return closeAgent(pi, core, childSessions, agentId, ctx);
      }
    }
    const result = await runAgentRunsCommand(core, ctx, trimmed);
    await applyChildUpdates(childSessions, result, ctx);
    return result;
  }

  const ui = uiFromContext(ctx);
  const prefix = `${childSessionCacheKeyScopeFromContext(ctx)}\0`;
  const liveAgentIds = [...childSessions.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
  decodeCoreAck(core.call("reconcileLiveAgentDispatches", [{ live_agent_ids: liveAgentIds }, { ctx }]));
  const snapshot = loadSnapshot(core, ctx);
  const agents = snapshot.agents;
  if (agents.length === 0) {
    return commandResult(true, "No agents.", { agents: [] });
  }
  if (typeof ui?.custom !== "function") {
    return runAgentRunsCommand(core, ctx, "list");
  }

  let lastAgentId: string | undefined;
  // agent-mljb: after each action the picker reopens with a refreshed snapshot.
  for (;;) {
    const items = pickerItems(loadSnapshot(core, ctx));
    if (items.length === 0) return commandResult(true, "No agents.", { agents: [] });
    // agent-u5gw/agent-64x4: interactive modal list, single-key actions.
    const selection = await showInteractiveList(ui, {
      items,
      header: (theme) => theme.fg("accent", ` Agent runs (${items.length})`),
      renderRow: (item, _index, selected, theme, width) => pickerRow(item, selected, theme, width, Date.now()),
      footer: " ↑↓/jk move · Enter/i inspect · o output · r runs · s stop · c close · x prune · q/Esc close",
      actionKeys: ["enter", "i", "o", "r", "s", "c", "x"],
      initialIndex: Math.max(0, items.findIndex((item) => item.agent.agentId === lastAgentId)),
    });
    // agent-bxg4: closing the manager stays silent.
    if (selection === undefined) {
      return { ...commandResult(true, "Agent runs unchanged.", { cancelled: true }), inspection: true };
    }
    const item = items[selection.index];
    if (item === undefined) continue;
    const agentId = item.agent.agentId;
    lastAgentId = agentId;
    if (selection.key === "enter" || selection.key === "i") {
      const instruction = await fetchLatestInstruction(core, ctx, agentId);
      await showAgentInspection(ui, item.agent, item.latest, instruction);
      continue;
    }
    if (selection.key === "o") {
      if (item.latest === undefined) notify(ui, `No runs for ${agentId}.`, "info");
      else await showRunOutput(core, ui, ctx, item.latest.runId);
      continue;
    }
    if (selection.key === "r") {
      await pickRunAndShowOutput(core, ui, ctx, loadSnapshot(core, ctx), agentId);
      continue;
    }
    if (selection.key === "s") {
      const result = await runAgentRunsCommand(core, ctx, `stop ${agentId}`);
      await applyChildUpdates(childSessions, result, ctx);
      notifyOutcome(ui, result, `Stopped ${agentId}.`);
      continue;
    }
    if (selection.key === "c") {
      if (await confirmSelection(ui, `Close ${agentId}?`, "Confirm close")) {
        const result = await closeAgent(pi, core, childSessions, agentId, ctx);
        notifyOutcome(ui, result, `Closed ${agentId}.`);
      }
      continue;
    }
    if (selection.key === "x") {
      // agent-6d58: prune closes terminal identities only, after confirmation.
      const terminal = items.filter((candidate) =>
        candidate.latest !== undefined && TERMINAL_RUN_STATUSES.has(candidate.latest.status));
      if (terminal.length === 0) {
        notify(ui, "No terminal identities to prune.", "info");
        continue;
      }
      const noun = terminal.length === 1 ? "identity" : "identities";
      if (await confirmSelection(ui, `Close ${terminal.length} terminal ${noun}?`, "Confirm prune")) {
        let closed = 0;
        let failed = 0;
        for (const candidate of terminal) {
          const result = await closeAgent(pi, core, childSessions, candidate.agent.agentId, ctx);
          if (resultOk(result)) closed += 1;
          else failed += 1;
        }
        if (closed > 0 && terminal.some((candidate) => candidate.agent.agentId === lastAgentId)) {
          lastAgentId = undefined;
        }
        notify(
          ui,
          failed === 0
            ? `Pruned ${closed} ${closed === 1 ? "identity" : "identities"}.`
            : `Pruned ${closed} ${noun}; ${failed} failed.`,
          failed === 0 ? "info" : "warning",
        );
      }
      continue;
    }
  }
}
