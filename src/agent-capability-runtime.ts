import type { ChildSessionBridge, CoreBridge } from "./types.ts";
import {
  decodeCoreAck,
  type AgentActionCapabilityFacts,
  type PreparedToolAction,
} from "./bridge-contracts.ts";
import { latestAssistantEntryId } from "./child-sessions.ts";

type PreparedAgentAction = Extract<PreparedToolAction, {
  action: "agent_start" | "agent_send" | "agent_wait" | "agent_close";
}>;
type PreparedDispatchAction = Extract<PreparedAgentAction, {
  action: "agent_start" | "agent_send";
}>;

export function completionGate() {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

export function agentActionCapabilityFacts(
  prepared: PreparedAgentAction,
  ctx: unknown,
): AgentActionCapabilityFacts | undefined {
  if (prepared.action === "agent_wait") return undefined;
  const common = { capabilityId: prepared.capabilityId, agentId: prepared.agentId, ctx };
  if (prepared.action === "agent_start") {
    return { ...common, action: "agent_start", runId: prepared.runId, submissionId: prepared.submissionId };
  }
  if (prepared.action === "agent_close") return { ...common, action: "agent_close" };
  if (prepared.runId === undefined) return { ...common, action: "agent_send" };
  if (prepared.submissionId === undefined) return { ...common, action: "agent_send", runId: prepared.runId };
  return { ...common, action: "agent_send", runId: prepared.runId, submissionId: prepared.submissionId };
}

export function recordAuthorizedDispatchBoundary(
  core: CoreBridge,
  prepared: PreparedDispatchAction,
  ctx: unknown,
  bridge: ChildSessionBridge | undefined,
  capabilityFacts: AgentActionCapabilityFacts,
): void {
  const previousAssistantEntryId = latestAssistantEntryId(bridge?.sessionManager);
  const facts = {
    run_id: prepared.runId ?? "",
    submission_id: prepared.submissionId ?? "",
    ...(previousAssistantEntryId === undefined ? {} : {
      previous_assistant_entry_id: previousAssistantEntryId,
    }),
  };
  decodeCoreAck(core.call(
    "recordAgentDispatchBoundaryAuthorized", [facts, capabilityFacts, { ctx }],
  ));
}
