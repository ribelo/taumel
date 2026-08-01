import type { ChildSessionBridge, CoreBridge, PiLike } from "./types.ts";
import type { AgentToolContract, AgentToolExecution, ToolContract } from "./tool-contract-model.ts";
import { isAgentToolContract, parseContractParams } from "./tool-contract-model.ts";
import { contextWithOverrides, cwdFromContext, isObjectLike, objectValue } from "./util.ts";
import { latestTaumelCustomEntry } from "./pi-session-entries.ts";
import { childSessionCacheKeyScopeFromContext } from "./child-sessions.ts";
import { rememberAgentDescription } from "./agent-run-registry.ts";
import { isToolRenderFields, type ToolRenderFields } from "./tool-renderer-kit.ts";
import { executeAgentPrepared, pendingAgentWaits } from "./agent-orchestration.ts";
import { decodeCoreAck, type ToolResultEnvelope } from "./bridge-contracts.ts";
import { agentErrorToolResult, errorToolResult, preparedAction } from "./tool-results.ts";
import { planSkillExpansion, type SkillExpansionPlan } from "./skills.ts";

type SettingsObject = { [key: string]: unknown };
type ToolContext = { readonly sessionManager?: unknown };

export type AgentToolRuntime = {
  readonly pi: PiLike;
  readonly core: CoreBridge;
  readonly childSessions: Map<string, ChildSessionBridge>;
  readonly childExtensionFactory?: (pi: PiLike) => void;
};

export type AgentToolInvocation = {
  readonly contract: AgentToolContract;
  readonly params: unknown;
  readonly ctx: unknown;
  readonly signal?: AbortSignal;
};

export function agentFailureText(
  contract: ToolContract,
  result: { readonly details: unknown; readonly content: readonly { readonly type: string; readonly text?: string }[] },
): string | undefined {
  if (!isAgentToolContract(contract)) return undefined;
  const details = objectValue<SettingsObject>(result.details);
  const error = objectValue<SettingsObject>(details?.["error"]);
  if (details?.["ok"] !== false || typeof error?.["code"] !== "string" || typeof error["message"] !== "string") {
    return undefined;
  }
  return result.content
    .flatMap((item) => item.type === "text" && item.text !== undefined ? [item.text] : [])
    .join("\n");
}

function childMarker(ctx: unknown) {
  return latestTaumelCustomEntry(
    isObjectLike<ToolContext>(ctx) ? ctx.sessionManager : undefined,
    "taumel.childSession",
  );
}

function preparedFailureCode(message: string): string {
  return /unknown run|not owned.*run/.test(message) ? "run_not_found"
    : /unknown agent|not owned.*agent|closing/.test(message) ? "agent_not_found"
    : /64 agents|namespace is exhausted/.test(message) ? "agent_limit_reached"
    : /routing|model|thinking|authentication/.test(message) ? "routing_unavailable"
    : /delete_worktree is only valid|invalid_arguments/.test(message) ? "invalid_arguments"
    : /workspace_unavailable|workspace|Git repository|HEAD commit|isolated agent worktree/.test(message)
      ? "workspace_unavailable"
    : /state is unavailable|persistence_failed/.test(message) ? "persistence_failed"
    : /cleanup_failed|cleanup|worktree has uncommitted|worktree deletion|provisional worktree cleanup/.test(message)
      ? "cleanup_failed"
    : "internal_error";
}

function safePreparedFailureMessage(code: string, message: string): string {
  if (code === "run_not_found") return "run not found";
  if (code === "agent_not_found") return "agent not found";
  return message;
}

function rememberDescription(params: unknown): void {
  const fields: ToolRenderFields = isToolRenderFields(params) ? params : {};
  rememberAgentDescription(
    typeof fields["agent_id"] === "string" ? fields["agent_id"] : "",
    typeof fields["description"] === "string" ? fields["description"] : undefined,
  );
}

function planAdditionalInstruction(
  core: CoreBridge,
  execution: AgentToolExecution,
  ctx: unknown,
): SkillExpansionPlan | ToolResultEnvelope | undefined {
  const instruction = execution.additionalInstruction;
  if (instruction === undefined) return undefined;
  const plan = planSkillExpansion(core, {
    text: instruction.text,
    cwd: cwdFromContext(ctx),
    ctx,
  });
  const requiredSkillResolved = plan.messages.some(
    (message) => message.details.name === instruction.requiredSkill,
  );
  return requiredSkillResolved
    ? plan
    : agentErrorToolResult(core, instruction.unavailable.code, instruction.unavailable.message);
}

function isToolResult(value: SkillExpansionPlan | ToolResultEnvelope): value is ToolResultEnvelope {
  return "content" in value;
}

export async function executeAgentTool(
  runtime: AgentToolRuntime,
  invocation: AgentToolInvocation,
): Promise<ToolResultEnvelope> {
  const { pi, core, childSessions, childExtensionFactory } = runtime;
  const { contract, params, ctx, signal } = invocation;
  const { execution } = contract;
  const parsed = parseContractParams(contract, params);
  if (!parsed.ok) return agentErrorToolResult(core, "invalid_arguments", parsed.error);

  const marker = childMarker(ctx);
  if (!execution.allowInvalidChildMetadata
    && (marker.kind === "invalid" || marker.kind === "unavailable")) {
    return errorToolResult(core, "invalid child session authority metadata", {
      ok: false,
      error: "invalid child session authority metadata",
      childMarker: marker.kind,
    });
  }

  const additionalInstruction = planAdditionalInstruction(core, execution, ctx);
  if (additionalInstruction !== undefined && isToolResult(additionalInstruction)) {
    return additionalInstruction;
  }

  if (execution.reconcileLiveDispatches) {
    const prefix = `${childSessionCacheKeyScopeFromContext(ctx)}\0`;
    const liveAgentIds = [...childSessions.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    try {
      decodeCoreAck(core.call("reconcileLiveAgentDispatches", [{ live_agent_ids: liveAgentIds }, { ctx }]));
    } catch (error) {
      return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
    }
  }

  const prepareCtx = execution.parentActiveTools && typeof pi.getActiveTools === "function"
    ? contextWithOverrides(ctx, { activeTools: pi.getActiveTools() })
    : ctx;
  let prepared;
  try {
    prepared = preparedAction(core, contract.name, parsed.params, prepareCtx);
  } catch (error) {
    return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
  }
  if (!prepared.ok) {
    const code = preparedFailureCode(prepared.error);
    return agentErrorToolResult(core, code, safePreparedFailureMessage(code, prepared.error));
  }
  const expectedAction = execution.preparedAction;
  if (prepared.action !== expectedAction) {
    return agentErrorToolResult(core, "internal_error", `expected ${expectedAction}, got ${prepared.action}`);
  }

  if (execution.rememberDescription) rememberDescription(parsed.params);
  return executeAgentPrepared(
    pi,
    core,
    childSessions,
    pendingAgentWaits,
    prepared,
    ctx,
    signal,
    childExtensionFactory,
    additionalInstruction,
  );
}
