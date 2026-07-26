import type { CoreBridge, PiLike } from "./types.ts";
import { isObjectLike } from "./util.ts";
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
import { showAgentInspection } from "./agent-inspection.ts";
import { confirmSelection } from "./modal.ts";

type UnknownFields = { readonly [key: string]: unknown };

type AgentListItem = AgentManagerSnapshot["agents"][number];
type AgentRunItem = AgentManagerSnapshot["runs"][number];

function loadSnapshot(core: CoreBridge, ctx: unknown): AgentManagerSnapshot {
  return decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [{ ctx }]));
}

function agentLabel(agent: AgentListItem): string {
  return `${agent.agentId} · ${agent.kind}`;
}

function runLabel(run: AgentRunItem): string {
  const activity = run.status === "running" ? ` · ${run.activityState}` : "";
  const baseline = run.lastActivityAt ?? run.startedAt;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - baseline);
  return `${run.runId} · ${run.status}${activity} · ${run.description} · ${run.turnCount} turns · ${age}s`;
}

function identityRunSummary(run: AgentRunItem): string {
  const activity = run.status === "running" ? ` · ${run.activityState}` : "";
  const baseline = run.lastActivityAt ?? run.startedAt;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - baseline);
  return `${run.status}${activity} · ${run.description} · ${run.turnCount} turns · ${age}s`;
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
  if (typeof ui?.custom !== "function" && typeof (ui as { select?: unknown } | undefined)?.select !== "function") {
    return runAgentRunsCommand(core, ctx, "list");
  }

  const labels = agents.map((agent) => {
    const latest = snapshot.runs.find((run) => run.agentId === agent.agentId);
    return latest === undefined ? agentLabel(agent) : `${agentLabel(agent)} · ${identityRunSummary(latest)}`;
  });
  const selectedLabel =
    typeof (ui as { select?: (title: string, labels: string[]) => unknown }).select === "function"
      ? await (ui as { select: (title: string, labels: string[]) => Promise<string | undefined> }).select(
        "Taumel agent runs",
        labels,
      )
      : undefined;
  if (typeof selectedLabel !== "string" || selectedLabel === "") {
    return commandResult(true, "Agent runs unchanged.", { cancelled: true });
  }
  const index = labels.indexOf(selectedLabel);
  const agent = index >= 0 ? agents[index] : undefined;
  const agentId = agent?.agentId ?? "";
  if (agent === undefined || agentId === "") {
    return commandResult(false, "Invalid agent selection.", { error: "invalid selection" });
  }

  const agentRuns = snapshot.runs.filter((run) => run.agentId === agentId);
  const actions = ["Inspect", "Runs", "Output", "Stop", "Close", "Cancel"];
  const action =
    typeof (ui as { select?: (title: string, labels: string[]) => unknown }).select === "function"
      ? await (ui as { select: (title: string, labels: string[]) => Promise<string | undefined> }).select(
        `Agent ${agentId}`,
        actions,
      )
      : undefined;
  if (action === "Inspect") {
    const latest = agentRuns[0];
    const instruction = await fetchLatestInstruction(core, ctx, agentId);
    await showAgentInspection(ui, agent, latest, instruction);
    return { ...commandResult(true, `Inspected ${agentId}.`, { agent_id: agentId }), inspection: true };
  }
  if (action === "Runs") {
    if (agentRuns.length === 0) return commandResult(true, `No runs for ${agentId}.`, { agent_id: agentId });
    const runLabels = agentRuns.map(runLabel);
    const selectedRunLabel =
      typeof (ui as { select?: (title: string, labels: string[]) => unknown }).select === "function"
        ? await (ui as { select: (title: string, labels: string[]) => Promise<string | undefined> }).select(
          `Runs for ${agentId}`,
          runLabels,
        )
        : undefined;
    const runIndex = selectedRunLabel === undefined ? -1 : runLabels.indexOf(selectedRunLabel);
    const selectedRun = runIndex >= 0 ? agentRuns[runIndex] : undefined;
    if (selectedRun === undefined) return commandResult(true, "Run inspection cancelled.", { cancelled: true });
    return runAgentRunsCommand(core, ctx, `output ${selectedRun.runId}`);
  }
  if (action === "Output") {
    const latest = agentRuns[0];
    return latest === undefined
      ? commandResult(true, `No runs for ${agentId}.`, { agent_id: agentId })
      : runAgentRunsCommand(core, ctx, `output ${latest.runId}`);
  }
  if (action === "Stop") {
    const result = await runAgentRunsCommand(core, ctx, `stop ${agentId}`);
    await applyChildUpdates(childSessions, result, ctx);
    return result;
  }
  if (action === "Close") {
    if (!await confirmSelection(ui, `Close ${agentId}?`, "Confirm close")) {
      return commandResult(true, "Agent close cancelled.", { cancelled: true, agent_id: agentId });
    }
    const result = await closeAgent(pi, core, childSessions, agentId, ctx);
    notify(ui, `Closed ${agentId}`, "info");
    return result;
  }
  return commandResult(true, "Agent runs unchanged.", { cancelled: true });
}
