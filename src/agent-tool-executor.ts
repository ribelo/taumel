import type { ChildSessionBridge, CoreBridge, PiLike } from "./types.ts";
import { parseToolParams } from "./tool-contracts.ts";
import { contextWithOverrides, isObjectLike, objectValue } from "./util.ts";
import { latestTaumelCustomEntry } from "./pi-session-entries.ts";
import { childSessionCacheKeyScopeFromContext } from "./child-sessions.ts";
import { rememberAgentDescription } from "./agent-run-registry.ts";
import { isToolRenderFields, type ToolRenderFields } from "./tool-renderer-kit.ts";
import { executeAgentPrepared, pendingAgentWaits } from "./agent-orchestration.ts";
import { decodeCoreAck, type ToolResultEnvelope } from "./bridge-contracts.ts";
import { agentErrorToolResult, errorToolResult, preparedAction } from "./tool-results.ts";
import { planAgentStartContext, startKindForAgentTool } from "./agent-start-policy.ts";

type SettingsObject = { [key: string]: unknown };
type ToolContext = { readonly sessionManager?: unknown };

const agentToolNames = new Set([
  "agent_spawn", "finder", "oracle", "code_reviewer", "code_quality_reviewer",
  "agent_send", "agent_wait", "agent_list", "agent_close",
]);

export function isAgentToolName(name: string): boolean {
  return agentToolNames.has(name);
}

export function agentFailureText(
  name: string,
  result: { readonly details: unknown; readonly content: readonly { readonly type: string; readonly text?: string }[] },
): string | undefined {
  if (!isAgentToolName(name)) return undefined;
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

export async function executeAgentTool(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  name: string,
  rawParams: unknown,
  ctx: unknown,
  signal?: AbortSignal,
  childExtensionFactory?: (pi: PiLike) => void,
): Promise<ToolResultEnvelope> {
  const parsed = parseToolParams(name, rawParams);
  if (!parsed.ok) return agentErrorToolResult(core, "invalid_arguments", parsed.error);

  const marker = childMarker(ctx);
  if (name !== "agent_wait" && name !== "agent_list"
    && (marker.kind === "invalid" || marker.kind === "unavailable")) {
    return errorToolResult(core, "invalid child session authority metadata", {
      ok: false,
      error: "invalid child session authority metadata",
      childMarker: marker.kind,
    });
  }

  const startKind = startKindForAgentTool(name);
  const startContext = startKind === undefined
    ? { ok: true as const }
    : planAgentStartContext(core, startKind, ctx);
  if (!startContext.ok) {
    return agentErrorToolResult(core, startContext.code, startContext.message);
  }

  if (name === "agent_list") {
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

  const prepareCtx = startKind !== undefined && typeof pi.getActiveTools === "function"
    ? contextWithOverrides(ctx, { activeTools: pi.getActiveTools() })
    : ctx;
  let prepared;
  try {
    prepared = preparedAction(core, name, parsed.params, prepareCtx);
  } catch (error) {
    return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
  }
  if (!prepared.ok) {
    const code = preparedFailureCode(prepared.error);
    return agentErrorToolResult(core, code, safePreparedFailureMessage(code, prepared.error));
  }
  if (prepared.action !== "agent_start" && prepared.action !== "agent_send"
    && prepared.action !== "agent_wait" && prepared.action !== "agent_close") {
    return agentErrorToolResult(core, "internal_error", `unexpected agent action: ${prepared.action}`);
  }

  rememberDescription(parsed.params);
  return executeAgentPrepared(
    pi,
    core,
    childSessions,
    pendingAgentWaits,
    prepared,
    ctx,
    signal,
    childExtensionFactory,
    startContext.skillExpansion,
  );
}
