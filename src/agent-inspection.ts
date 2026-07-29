import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentManagerSnapshot } from "./bridge-contracts.ts";
import { formatLocalTime } from "./util.ts";
import { showScrollModal, wrapModalText, type ModalTheme, type ModalUi } from "./modal.ts";

type AgentIdentity = AgentManagerSnapshot["agents"][number];
type AgentRun = AgentManagerSnapshot["runs"][number];

export function statusColor(status: AgentRun["status"]): string {
  switch (status) {
    case "completed": return "success";
    case "failed":
    case "lost": return "error";
    case "running":
    case "suspended": return "warning";
    case "cancelled": return "dim";
  }
}

function fieldLines(fields: readonly [string, string][], width: number): string[] {
  const labelWidth = fields.reduce((max, [label]) => Math.max(max, label.length), 0);
  return fields.map(([label, value]) => truncateToWidth(` ${label.padEnd(labelWidth)}   ${value}`, width, "..."));
}

export function renderAgentInspection(
  agent: AgentIdentity,
  run: AgentRun | undefined,
  instruction: string | undefined,
  theme: ModalTheme,
  width: number,
  nowMs = Date.now(),
): string[] {
  const w = Math.max(1, width);
  const line = (value: string) => truncateToWidth(value, w, "...");
  const lines: string[] = [];
  const header = ` ${agent.agentId} · ${agent.kind}`;
  lines.push(line(
    run === undefined
      ? theme.fg("accent", header)
      : `${theme.fg("accent", header)} · ${theme.fg(statusColor(run.status), run.status)}`,
  ));
  lines.push("");

  lines.push(theme.fg("accent", " Identity"));
  const identityFields: [string, string][] = [
    ["Model", agent.model],
    ["Thinking", agent.thinking],
  ];
  if (agent.tier !== undefined) identityFields.push(["Tier", agent.tier]);
  identityFields.push(["Isolation", agent.isolation ?? "none"]);
  identityFields.push(["Workspace", agent.workspace]);
  if (agent.effectiveWorkspace !== undefined && agent.effectiveWorkspace !== agent.workspace) {
    identityFields.push(["Effective", agent.effectiveWorkspace]);
  }
  identityFields.push(["Created", formatLocalTime(agent.createdAt, nowMs)]);
  if (agent.childSessionFile !== undefined) identityFields.push(["Session", agent.childSessionFile]);
  lines.push(...fieldLines(identityFields, w));

  if (run !== undefined) {
    lines.push("");
    lines.push(theme.fg("accent", ` Run ${run.runId}`));
    const runFields: [string, string][] = [
      ["Status", theme.fg(statusColor(run.status), run.status)],
      ["Activity", run.activityState],
      ["Recommendation", run.recommendation],
      ["Started", formatLocalTime(run.startedAt, nowMs)],
    ];
    if (run.lastActivityAt !== undefined) runFields.push(["Last active", formatLocalTime(run.lastActivityAt, nowMs)]);
    if (run.endedAt !== undefined) runFields.push(["Ended", formatLocalTime(run.endedAt, nowMs)]);
    if (run.suspendedAt !== undefined) runFields.push(["Suspended", formatLocalTime(run.suspendedAt, nowMs)]);
    runFields.push(["Turns", String(run.turnCount)]);
    runFields.push(["Description", run.description]);
    if (run.reasonCode !== undefined) runFields.push(["Reason", run.reasonCode]);
    if (run.error !== undefined) runFields.push(["Error", run.error]);
    runFields.push(["Notification", run.announcement]);
    lines.push(...fieldLines(runFields, w));
  }

  lines.push("");
  lines.push(theme.fg("accent", " Instruction"));
  if (instruction === undefined) {
    lines.push(theme.fg("dim", " Instruction unavailable."));
  } else {
    for (const wrapped of wrapModalText(instruction, Math.max(1, w - 2))) {
      lines.push(` ${wrapped}`);
    }
  }
  return lines;
}

export async function showAgentInspection(
  ui: ModalUi | undefined,
  agent: AgentIdentity,
  run: AgentRun | undefined,
  instruction: string | undefined,
): Promise<void> {
  await showScrollModal(ui, (width, theme) => renderAgentInspection(agent, run, instruction, theme, width));
}
