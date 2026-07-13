import type { CoreBridge, PiLike } from "./types.ts";
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
} from "./bridge-contracts.ts";

type UnknownFields = { readonly [key: string]: unknown };

type AgentListItem = AgentManagerSnapshot["agents"][number];
type AgentRunItem = AgentManagerSnapshot["runs"][number];

function isObject(value: unknown): value is UnknownFields {
  return typeof value === "object" && value !== null;
}

function loadSnapshot(core: CoreBridge, ctx: unknown): AgentManagerSnapshot {
  return decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [ctx]));
}

function agentLabel(agent: AgentListItem): string {
  return `${agent.agentId} · ${agent.kind} · ${agent.model}:${agent.thinking}`;
}

function runLabel(run: AgentRunItem): string {
  return `${run.runId} · ${run.status}${run.reasonCode === undefined ? "" : ` · ${run.reasonCode}`}`;
}

async function runAgentRunsCommand(
  core: CoreBridge,
  ctx: unknown,
  args: string,
): Promise<unknown> {
  return decodeGatewayCommandOutput(core.call("handleCommand", [{ name: "agent-runs", args, ctx }]));
}

async function applyChildUpdates(
  childSessions: Map<string, ChildSessionBridge>,
  result: unknown,
  ctx: unknown,
): Promise<void> {
  if (!isObject(result)) return;
  const details = isObject(result.details) ? result.details : {};
  const updates = Array.isArray(details.childSessionUpdates) ? details.childSessionUpdates : [];
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  for (const update of updates) {
    if (isObject(update)) {
      await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
    }
  }
}

async function closeAgent(
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
  try {
    const keyScope = childSessionCacheKeyScopeFromContext(ctx);
    await applyChildSessionUpdate(childSessions, {
      action: "delete_child_session",
      key: agentId,
      reason: "agent_closed",
    }, undefined, keyScope);
    const sessionFile = prepared.childSessionFile;
    if (typeof sessionFile === "string" && sessionFile !== "") {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const directory = path.dirname(sessionFile);
      if (path.basename(directory) === agentId) {
        await fs.rm(directory, { recursive: true, force: true });
      } else {
        await fs.rm(sessionFile, { force: true });
      }
    }
  } catch (error) {
    decodeCoreAck(core.call("releaseAgentClose", [{ agent_id: agentId }]));
    const message = error instanceof Error ? error.message : String(error);
    return commandResult(false, `Agent close failed: ${message}`, { agent_id: agentId, error: message });
  }
  const finished = decodeCoreAck(core.call("finishAgentClose", [{ agent_id: agentId }, ctx]));
  if (finished.ok !== true) {
    decodeCoreAck(core.call("releaseAgentClose", [{ agent_id: agentId }]));
    return finished;
  }
  return commandResult(true, `Closed ${agentId}.`, {
    agent_id: agentId,
    status: "closed",
  });
}

export async function executeAgentRunsManager(
  _pi: PiLike,
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
        const select = (ui as { select?: (title: string, labels: string[]) => Promise<string | undefined> } | undefined)?.select;
        if (typeof select !== "function") {
          return commandResult(false, "Closing an agent requires interactive confirmation.", {
            agent_id: agentId,
          });
        }
        const confirmed = await select.call(ui, `Close ${agentId}?`, ["Confirm close", "Cancel"]);
        if (confirmed !== "Confirm close") {
          return commandResult(true, "Agent close cancelled.", { cancelled: true, agent_id: agentId });
        }
        return closeAgent(core, childSessions, agentId, ctx);
      }
    }
    const result = await runAgentRunsCommand(core, ctx, trimmed);
    await applyChildUpdates(childSessions, result, ctx);
    return result;
  }

  const ui = uiFromContext(ctx);
  const snapshot = loadSnapshot(core, ctx);
  const agents = snapshot.agents;
  if (agents.length === 0) {
    return commandResult(true, "No agents.", { agents: [] });
  }
  if (typeof ui?.custom !== "function" && typeof (ui as { select?: unknown } | undefined)?.select !== "function") {
    return runAgentRunsCommand(core, ctx, "list");
  }

  const labels = agents.map((agent) => agentLabel(agent));
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
    return commandResult(true, `${agentLabel(agent)}\nworkspace=${agent.workspace}\nlatest_run_id=${latest?.runId ?? ""}\nlatest_status=${latest?.status ?? ""}`, {
      agent,
      runs: agentRuns,
    });
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
    const confirm =
      typeof (ui as { select?: (title: string, labels: string[]) => unknown }).select === "function"
        ? await (ui as { select: (title: string, labels: string[]) => Promise<string | undefined> }).select(
          `Close ${agentId}?`,
          ["Confirm close", "Cancel"],
        )
        : undefined;
    if (confirm !== "Confirm close") {
      return commandResult(true, "Agent close cancelled.", { cancelled: true, agent_id: agentId });
    }
    const result = await closeAgent(core, childSessions, agentId, ctx);
    notify(ui, `Closed ${agentId}`, "info");
    return result;
  }
  return commandResult(true, "Agent runs unchanged.", { cancelled: true });
}
