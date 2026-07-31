// ^agentui-xqzc: run descriptions are display-side knowledge remembered from
// spawn/send arguments and wait-time snapshots, so agent_wait can name the
// awaited run without widening the model-facing result contract (^agent-rs17).
const descriptions = new Map<string, string>();

export function rememberAgentDescription(agentId: string, description: string | undefined): void {
  const cleaned = description?.trim() ?? "";
  if (agentId === "" || cleaned === "") return;
  descriptions.set(agentId, cleaned);
}

export function agentDescriptionFor(agentId: string): string | undefined {
  return descriptions.get(agentId);
}

export function agentIdFromRunId(runId: string): string {
  const match = /^(.*)-run-\d+$/.exec(runId);
  return match?.[1] ?? runId;
}
