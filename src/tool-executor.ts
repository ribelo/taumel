import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ChildSessionBridge,
  CoreBridge,
  PiLike,
} from "./types.ts";
import {
  parseToolParams,
  toolNames,
} from "./tool-contracts.ts";
import { toolContracts } from "./tool-contract-catalog.ts";

import {
  cwdFromContext,
  modelRegistryFrom,
  openAiCredentialRaw,
  openAiUsageTokenRaw,
  sessionInfoFromContext,
  threadSources,
  authorizeCanonicalMutationPaths,
  readAuthorizedFile,
  readJsonObjectForAtomicUpdate,
  validateWorkspaceMutationPaths,
  writePatchFiles,
  appendToFile,
  writeFileAtomically,
  contextWithOverrides,
  type MutationPathAuthorization,
} from "./util.ts";
import { goalContinuationMessageRenderer, notificationMessageRenderer, renderersForTool } from "./tool-renderer.ts";
import { bindHarnessApprovalUi, clearHarnessApprovalUi, requestHarnessApproval, type ApprovalOutcome, type ApprovalResolution, type ApprovalUi } from "./approval-coordinator.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  refreshOwnedChildPermissions,
  sendToChildSession,
} from "./child-sessions.ts";
import { installExecNotificationLifecycle, startExecCompletionWaiter } from "./exec-notifications.ts";
import { executeAgentPrepared, installAgentLifecycle, pendingAgentWaits } from "./agent-orchestration.ts";
import { decodeAuthorityPlanIssued, decodeBridgeToolResult, decodeEditApplicationResult, decodeExecApprovalPromptPlan, decodeExecApprovalResult, decodeExecPolicyAllowRuleResult, decodeExecToolResult, decodePatchApplicationResult, decodeToolNamesResult, decodeToolResultEnvelope, decodeViewMediaResultEnvelope, type PreparedToolAction, type ToolResultEnvelope } from "./bridge-contracts.ts";
import {
  decodeOpenAiUsageHostAuth,
  decodeOpenAiUsageHostParams,
  type OpenAiUsageHostLookupFacts,
  type OpenAiUsageHostParams,
} from "./bridge-contracts.ts";
import {
  agentErrorToolResult,
  errorToolResult,
  hostToolResult,
  preparedAction,
  preparedToolResult,
} from "./tool-results.ts";
import { authorityPlanId, discardPreparedAuthorityPlan, executeApprovedExaInCore, executeExaInCore } from "./authority-plans.ts";
import { latestTaumelCustomEntry } from "./pi-session-entries.ts";
type SettingsObject = { [key: string]: unknown };
type ToolContext = { readonly cwd?: unknown; readonly model?: unknown; readonly ui?: unknown; readonly hasUI?: unknown; readonly sessionManager?: unknown };
type ImageModel = { readonly input?: unknown };
type NodeError = { readonly code?: unknown };
type PreparedSuccess = Exclude<PreparedToolAction, { ok: false }>;
type PreparedOpenAiAction = Extract<PreparedSuccess, { action: "openai_usage_fetch" }>;
type PreparedApprovalAction = Extract<PreparedSuccess, { action: "exec_command_approval" | "write_approval" | "edit_approval" | "apply_patch_approval" | "exa_agent_create_run_approval" }>;
type PreparedMutationAction = Extract<PreparedSuccess, { action: "write" | "write_approval" | "edit" | "edit_approval" | "apply_patch" | "apply_patch_approval" }>;
type GatewayToolResult = ToolResultEnvelope | ReturnType<typeof decodeViewMediaResultEnvelope>;
const agentToolNames = new Set(["agent_spawn", "finder", "oracle", "agent_send", "agent_wait", "agent_list", "agent_close"]);
const invalidChildSafeToolNames = new Set([
  "read", "view_media", "get_goal", "query_threads", "read_thread",
  "ralph_continue", "ralph_finish", "cron_list", "agent_wait", "agent_list",
]);

function settingsObject(value: unknown): SettingsObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as SettingsObject : undefined;
}
function toolContext(value: unknown): Partial<ToolContext> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<ToolContext> : undefined;
}
function agentFailureText(name: string, result: GatewayToolResult): string | undefined {
  if (!agentToolNames.has(name)) return undefined;
  const details = settingsObject(result.details);
  const error = settingsObject(details?.["error"]);
  if (details?.["ok"] !== false || typeof error?.["code"] !== "string" || typeof error["message"] !== "string") {
    return undefined;
  }
  return result.content
    .flatMap((item) => item.type === "text" ? [item.text] : [])
    .join("\n");
}

export {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  refreshOwnedChildPermissions,
  sendToChildSession,
};

async function withGoalClockPaused<T>(core: CoreBridge, run: () => Promise<T>): Promise<T> {
  core.call("goalClockPauseStart", []);
  try {
    return await run();
  } finally {
    core.call("goalClockPauseEnd", []);
  }
}

function approvalOutcomeMessage(action: string, outcome: ApprovalOutcome): string {
  switch (outcome) {
    case "denied_by_user":
      return `Error: ${action} approval denied by user`;
    case "timed_out":
      return `Error: ${action} approval timed out`;
    case "unavailable":
      return `Error: approval_unavailable: ${action} approval is unavailable`;
    case "interrupted":
      return `Error: ${action} approval interrupted`;
    case "approved_always":
    case "approved":
      return "";
  }
}

async function appendExecPolicyAllowRule(core: CoreBridge, tokens: readonly string[]): Promise<void> {
  const settingsPath = join(getAgentDir(), "settings.json");
  const { settings: root, authorization } = await readJsonObjectForAtomicUpdate(settingsPath);
  const existingTaumel = root["taumel"], taumel = existingTaumel === undefined ? {} : settingsObject(existingTaumel);
  if (taumel === undefined) throw new Error(`${settingsPath}: taumel must be a JSON object`);
  const existingExecPolicy = taumel["execPolicy"], execPolicy = existingExecPolicy === undefined ? {} : settingsObject(existingExecPolicy);
  if (execPolicy === undefined) throw new Error(`${settingsPath}: taumel.execPolicy must be a JSON object`);
  const existingRules = execPolicy["rules"];
  if (existingRules !== undefined && !Array.isArray(existingRules)) throw new Error(`${settingsPath}: taumel.execPolicy.rules must be an array`);
  const rules = existingRules ?? [];
  const pattern = [...tokens];
  rules.push({ pattern, decision: "allow", match: [pattern] });
  execPolicy["rules"] = rules;
  taumel["execPolicy"] = execPolicy;
  root["taumel"] = taumel;
  await writeFileAtomically(authorization, `${JSON.stringify(root, null, 2)}\n`);
  decodeExecPolicyAllowRuleResult(core.call("appendExecPolicyAllowRule", [{ tokens: pattern }]));
}

function mutationApprovalDenied(core: CoreBridge, action: string, outcome: ApprovalOutcome): ToolResultEnvelope {
  return errorToolResult(core, approvalOutcomeMessage(action, outcome), {
    ok: false,
    approvalRequired: true,
    approvalOutcome: outcome,
    ...(outcome === "unavailable" ? { reason: "approval_unavailable" } : {}),
  });
}

function childSessionMarkerFromContext(ctx: unknown) {
  return latestTaumelCustomEntry(
    toolContext(ctx)?.sessionManager,
    "taumel.childSession",
  );
}

function childSessionMetadataFromContext(ctx: unknown) {
  const marker = childSessionMarkerFromContext(ctx);
  return marker.kind === "contract_valid" ? marker.entry.data : undefined;
}

function childMutationConfinement(ctx: unknown): "none" | "worktree" | "invalid" {
  const marker = childSessionMarkerFromContext(ctx);
  if (marker.kind === "absent") return "none";
  if (marker.kind !== "contract_valid") return "invalid";
  const metadata = marker.entry.data;
  return metadata.kind === "agent" && metadata.isolation === "worktree"
    ? "worktree"
    : "none";
}

let loadedMainSessionId: string | undefined;

function childApprovalOwnerIsLoaded(ctx: unknown): boolean {
  const marker = childSessionMarkerFromContext(ctx);
  if (marker.kind === "absent") return true;
  if (marker.kind !== "contract_valid") return false;
  const metadata = marker.entry.data;
  const parentSessionId =
    typeof metadata.parentSessionId === "string" ? metadata.parentSessionId.trim() : "";
  return parentSessionId !== "" && parentSessionId === loadedMainSessionId;
}

function approvalOwnerId(ctx: unknown): string | undefined {
  const metadata = childSessionMetadataFromContext(ctx);
  if (metadata !== undefined) {
    const owner = typeof metadata.parentSessionId === "string" ? metadata.parentSessionId.trim() : "";
    return owner === "" ? undefined : owner;
  }
  return sessionInfoFromContext(ctx).sessionId;
}

function installIsolatedChildOwnershipLifecycle(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
): void {
  const loadParent = (ctx: unknown) => {
    if (childSessionMarkerFromContext(ctx).kind !== "absent") return;
    loadedMainSessionId = sessionInfoFromContext(ctx).sessionId;
    bindHarnessApprovalUi(loadedMainSessionId, toolContext(ctx)?.hasUI === true, toolContext(ctx)?.ui);
    refreshOwnedChildPermissions(childSessions, ctx, core);
  };
  // A newly spawned child starts while its parent is still loaded, so its
  // session_start must retain ownership. Resuming or switching into a child is
  // different: the parent is no longer the loaded main session.
  pi.on("session_start", (_event, ctx) => loadParent(ctx));
  const replaceLoadedSession = (_event: unknown, ctx: unknown) => {
    if (childSessionMarkerFromContext(ctx).kind !== "absent") {
      loadedMainSessionId = undefined;
      clearHarnessApprovalUi();
      return;
    }
    loadParent(ctx);
  };
  pi.on("session_resume", replaceLoadedSession);
  pi.on("session_switch", replaceLoadedSession);
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined && ownerId === loadedMainSessionId) {
      loadedMainSessionId = undefined;
      clearHarnessApprovalUi(ownerId);
    }
  });
}

function boundedApprovalEvidence(prepared: PreparedApprovalAction): string {
  const limit = 4_000;
  const action = prepared.action;
  const lines: string[] = [];
  const sandbox = "sandbox" in prepared ? prepared.sandbox : undefined;
  if (sandbox !== undefined) {
    lines.push(`Sandbox boundary: ${sandbox.filesystemMode}; roots: ${sandbox.workspaceRoots.join(", ")}`);
  } else {
    const roots = "workspaceRoots" in prepared ? prepared.workspaceRoots : undefined;
    if (roots !== undefined) lines.push(`Sandbox boundary: workspace roots: ${roots.join(", ")}`);
  }
  if (action === "exec_command_approval") {
    lines.push(`Command: ${prepared.cmd}`);
    lines.push(`Working directory: ${prepared.workdir}`);
  } else {
    const paths = "affectedPaths" in prepared ? prepared.affectedPaths : undefined;
    if (paths !== undefined) lines.push(`Paths: ${paths.join(", ")}`);
    else {
      const path = "path" in prepared ? prepared.path : "";
      if (path !== "") lines.push(`Path: ${path}`);
    }
    const patch = "patch" in prepared ? prepared.patch : undefined;
    const contents = "contents" in prepared ? prepared.contents : undefined;
    const edits = "edits" in prepared ? prepared.edits : [];
    const effect =
      patch ??
      (contents === undefined ? undefined : contents.split(/\r?\n/).map((line) => `+${line}`).join("\n")) ??
      edits
        .map((edit) => `-${edit.oldText}\n+${edit.newText}`)
        .join("\n");
    if (effect !== undefined && effect !== "") lines.push(`Bounded effect diff:\n${effect}`);
  }
  const evidence = lines.join("\n\n");
  return evidence.length <= limit ? evidence : `${evidence.slice(0, limit)}\n… effect diff truncated`;
}

function openAiUsageHostAuth(core: CoreBridge) {
  return decodeOpenAiUsageHostAuth(core.call("openAiUsageHostAuth", []));
}

function openAiUsageHostParams(core: CoreBridge, facts: OpenAiUsageHostLookupFacts): OpenAiUsageHostParams {
  return decodeOpenAiUsageHostParams(core.call("openAiUsageHostParams", [facts]));
}

async function executeOpenAiUsageInCore(
  core: CoreBridge,
  ctx: unknown,
  params: OpenAiUsageHostParams,
) {
  const rendered = decodeBridgeToolResult(await core.call("executeOpenAiUsage", [params, ctx]));
  return preparedToolResult(core, { ...rendered });
}


export async function executeOpenAiUsageWithHostAuth(
  pi: PiLike,
  core: CoreBridge,
  prepared: PreparedOpenAiAction,
  ctx: unknown,
) {
  const apiKeyPresent = prepared["apiKeyPresent"] === true;
  const registry = modelRegistryFrom(pi, ctx);
  const auth = openAiUsageHostAuth(core);
  const providerKey = auth.providerKey;
  const credentialKey = auth.credentialKey;
  const credential = openAiCredentialRaw(registry, credentialKey);
  let tokenFacts: Omit<OpenAiUsageHostLookupFacts, "apiKeyPresent">;

  try {
    tokenFacts = { token: await openAiUsageTokenRaw(registry, providerKey) };
  } catch (error) {
    tokenFacts = { tokenError: error instanceof Error ? error.message : String(error) };
  }
  return executeOpenAiUsageInCore(
    core,
    ctx,
    openAiUsageHostParams(core, {
      apiKeyPresent,
      ...(credential !== undefined ? { credential } : {}),
      ...tokenFacts,
    }),
  );
}

async function requestSandboxRetryApproval(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "exec_command" }>,
  ctx: unknown,
  signal?: AbortSignal,
  validate?: () => boolean,
): Promise<ApprovalResolution> {
  if (!childApprovalOwnerIsLoaded(ctx)) return "unavailable";
  const metadata = childSessionMetadataFromContext(ctx);
  const agentId = metadata?.kind === "agent" ? metadata.agentId.trim() : "";
  const requester = agentId !== "" ? `Agent ${agentId}: ` : "";
  return requestHarnessApproval({
    ownerSessionId: approvalOwnerId(ctx),
    origin: requester === "" ? "top-level" : "agent",
    ...(agentId === "" ? {} : { agentId }),
    signal,
    validate,
    run: async (ui, requestSignal) => {
      const approved = await withGoalClockPaused(core, async () =>
        await ui.confirm(
          `${requester}Command requires approval`,
          `command failed; retry without sandbox?\n\n${prepared.cmd}`,
          { signal: requestSignal },
        )
      );
      if (requestSignal.aborted) return "interrupted";
      return approved === true ? "approved" : "denied_by_user";
    },
  });
}

async function runPreparedExec(
  pi: PiLike,
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "exec_command" }>,
  ctx: unknown,
  signal: AbortSignal | undefined,
  forceUnsandboxed = false,
  validateApproval?: () => boolean,
  replan?: () => Promise<GatewayToolResult>,
) {
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  let result: ReturnType<typeof decodeExecToolResult>;
  try {
    result = decodeExecToolResult(await core.call("runExecCommand", [
      prepared,
      ownerId,
      signal ?? null,
      ctx,
    ]));
  } catch (error) {
    discardPreparedAuthorityPlan(core, prepared, ctx);
    throw error;
  }
  if (!forceUnsandboxed && shouldOfferSandboxRetry(prepared, result)) {
    const outcome = await requestSandboxRetryApproval(core, prepared, ctx, signal, validateApproval);
    if (outcome === "replan") {
      discardPreparedAuthorityPlan(core, prepared, ctx);
      if (replan !== undefined) return replan();
      throw new Error("approval policy changed; retry the command");
    }
    if (outcome === "approved") {
      const retry = decodeAuthorityPlanIssued(core.call("reissueExecPlan", [{
        planId: prepared.planId,
        ctx,
      }]));
      return runPreparedExec(pi, core, { ...prepared, planId: retry.planId }, ctx, signal, true);
    }
    discardPreparedAuthorityPlan(core, prepared, ctx);
    if (outcome === "denied_by_user") throw new Error("rejected by user");
    throw new Error(approvalOutcomeMessage("command retry", outcome));
  }
  discardPreparedAuthorityPlan(core, prepared, ctx);
  // The command outlived the first yield window and is now a background session.
  // Start a detached waiter that delivers its completion if the parent is idle
  // when it exits (the exec analogue of isolated_child onCompletion); turn_end/idle
  // flushes cover the other cases.
  const sessionId = result.details.sessionId;
  if (sessionId !== undefined) {
    void startExecCompletionWaiter(pi, core, ctx, sessionId);
  }
  return result;
}

const networkSandboxEvidence = [
  "temporary failure", "could not resolve", "name resolution", "network is unreachable",
  "no route to host", "failed to connect", "connection timed out", "dns",
];
const filesystemSandboxEvidence = [
  "permission denied", "operation not permitted", "read-only file system", "erofs", "eacces", "eperm",
];

function shouldOfferSandboxRetry(
  prepared: Extract<PreparedSuccess, { action: "exec_command" }>,
  result: ReturnType<typeof decodeExecToolResult>,
): boolean {
  if (prepared.sandbox.approvalPolicy !== "on-failure" && prepared.sandbox.approvalPolicy !== "untrusted") return false;
  if (result.details.sandboxed !== true || result.details.escalated === true || result.details.exitCode === undefined || result.details.exitCode === 0) return false;
  const output = result.details.output.toLowerCase();
  if (prepared.sandbox.networkMode !== "enabled" && networkSandboxEvidence.some((value) => output.includes(value))) return true;
  return prepared.sandbox.filesystemMode !== "danger-full-access" && filesystemSandboxEvidence.some((value) => output.includes(value));
}

async function runPreparedRead(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "read" }>,
  ctx: unknown,
) {
  const { offset, limit } = prepared;
  return decodeToolResultEnvelope(await core.call("readFile", [{
    path: prepared.path, defaultCwd: cwdFromContext(ctx),
    ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }),
  }]));
}

async function runPreparedViewMedia(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "view_media" }>,
  ctx: unknown,
) {
  return decodeViewMediaResultEnvelope(await core.call("viewMedia", [{
    path: prepared.path, defaultCwd: cwdFromContext(ctx),
  }]));
}

function contextModelSupportsImages(ctx: unknown): boolean {
  const rawModel = toolContext(ctx)?.model;
  if (typeof rawModel !== "object" || rawModel === null) return false;
  const input = (rawModel as ImageModel).input;
  return Array.isArray(input) && input.includes("image");
}

async function writePreparedStdin(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "write_stdin" }>,
  ctx: unknown,
  signal?: AbortSignal,
) {
  const { sessionId, outputMode, yieldTimeMs, maxOutputTokens } = prepared;
  return decodeExecToolResult(await core.call("writeExecStdin", [{
    sessionId, chars: prepared.chars,
    ownerId: sessionInfoFromContext(ctx).sessionId ?? "current",
    ...(outputMode === undefined ? {} : { outputMode }),
    ...(yieldTimeMs === undefined ? {} : { yieldTimeMs }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(signal === undefined ? {} : { signal }),
  }]));
}

async function confirmExecApproval(
  core: CoreBridge,
  prepared: PreparedApprovalAction,
  ctx: unknown,
  signal?: AbortSignal,
  validate?: () => boolean,
): Promise<ApprovalResolution> {
  const childMetadata = childSessionMetadataFromContext(ctx);
  const agentId = childMetadata?.kind === "agent" ? childMetadata.agentId.trim() : "";
  const requester = agentId !== ""
    ? `Agent ${agentId}: `
    : "";
  if (!childApprovalOwnerIsLoaded(ctx)) return "unavailable";
  const outcome = await requestHarnessApproval({
    ownerSessionId: approvalOwnerId(ctx),
    origin: requester === "" ? "top-level" : "agent",
    ...(agentId === "" ? {} : { agentId }),
    signal,
    validate,
    commit: async (committedOutcome) => {
      if (committedOutcome !== "approved_always") return;
      const allowAlwaysTokens = prepared.action === "exec_command_approval"
        ? prepared.execPolicyAllowAlwaysTokens
        : undefined;
      if (allowAlwaysTokens !== undefined) await appendExecPolicyAllowRule(core, allowAlwaysTokens);
    },
    run: async (ui: ApprovalUi, requestSignal: AbortSignal) => {
      const plan = decodeExecApprovalPromptPlan(core.call("planExecApprovalPrompt", [{
        approvalTitle: `${requester}${prepared.approvalTitle}`,
        approvalPrompt: `${requester}${prepared.approvalPrompt}`,
        approvalTimeoutMs: prepared.approvalTimeoutMs,
        uiAvailable: true,
      }]));
      if (plan.kind === "unavailable") return "unavailable";
      const allowAlwaysTokens = prepared.action === "exec_command_approval"
        ? prepared.execPolicyAllowAlwaysTokens
        : undefined;
      const timeoutMs = plan.timeoutMs;
      const controller = new AbortController();
      let outcome: ApprovalOutcome | undefined;
      const abort = () => {
        if (outcome === undefined) outcome = "interrupted";
        controller.abort();
      };
      requestSignal.addEventListener("abort", abort, { once: true });
      const timeoutId = timeoutMs !== undefined && timeoutMs > 0
        ? setTimeout(() => {
          outcome = "timed_out";
          controller.abort();
        }, timeoutMs)
        : undefined;
      try {
        const prompt = `${plan.prompt}\n\n${boundedApprovalEvidence(prepared)}`;
        if (allowAlwaysTokens !== undefined && allowAlwaysTokens.length > 0 && typeof ui.select === "function") {
          const selected = await withGoalClockPaused(core, async () =>
            await ui.select?.(`${plan.title}\n\n${prompt}`, ["Deny", "Allow once", "Allow always"], { signal: controller.signal })
          );
          if (selected === "Allow once") return "approved";
          if (selected === "Allow always") return "approved_always";
          return controller.signal.aborted ? outcome ?? "interrupted" : "denied_by_user";
        }
        const approved = await withGoalClockPaused(core, async () =>
          await ui.confirm(plan.title, prompt, { signal: controller.signal })
        );
        if (approved === true) return "approved";
        return controller.signal.aborted ? outcome ?? "interrupted" : "denied_by_user";
      } catch (error) {
        if (controller.signal.aborted) return outcome ?? "interrupted";
        throw error;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        requestSignal.removeEventListener("abort", abort);
      }
    },
  });
  return outcome;
}

async function withMutationApproval(
  core: CoreBridge,
  action: string,
  prepared: PreparedApprovalAction,
  ctx: unknown,
  signal: AbortSignal | undefined,
  validate: () => boolean,
  replan: () => Promise<GatewayToolResult>,
  run: () => Promise<ToolResultEnvelope> | ToolResultEnvelope,
): Promise<GatewayToolResult> {
  const outcome = await confirmExecApproval(core, prepared, ctx, signal, validate);
  if (outcome === "replan") {
    discardPreparedAuthorityPlan(core, prepared, ctx);
    return replan();
  }
  if (outcome !== "approved") {
    discardPreparedAuthorityPlan(core, prepared, ctx);
    return mutationApprovalDenied(core, action, outcome);
  }
  return run();
}

type PreparedMutationAuthorization =
  | Readonly<{ kind: "authorized"; paths: readonly MutationPathAuthorization[] }>
  | Readonly<{ kind: "invalid"; error: string }>;

async function authorizePreparedMutationPaths(
  core: CoreBridge,
  prepared: PreparedMutationAction,
  paths: readonly string[],
): Promise<PreparedMutationAuthorization> {
  try {
    const authorizations = prepared.validateWorkspacePaths
      ? await validateWorkspaceMutationPaths(core, paths, prepared.workspaceRoots)
      : await authorizeCanonicalMutationPaths(paths);
    return { kind: "authorized", paths: authorizations };
  } catch (error) {
    return { kind: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
}

async function runThreadTool(core: CoreBridge, name: string, prepared: Extract<PreparedSuccess, { action: "query_threads" | "read_thread" }>, ctx: unknown) {
  if (name !== "query_threads" && name !== "read_thread") throw new Error(`Invalid thread tool: ${name}`);
  return decodeToolResultEnvelope(core.call("runThreadTool", [{
    name, params: prepared, catalog: await threadSources(core, ctx), ctx,
  }]));
}

async function executeLegacyWrite(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "write" }>,
): Promise<ToolResultEnvelope> {
  const { path, contents } = prepared;
  const displayPath = prepared.displayPath;
  const mode = prepared.mode;
  const authorization = await authorizePreparedMutationPaths(core, prepared, [path]);
  if (authorization.kind === "invalid") {
    return errorToolResult(core, authorization.error, { ok: false, error: authorization.error });
  }
  if (mode === "append") {
    await appendToFile(authorization.paths[0]!, contents);
  } else {
    await writePatchFiles({ deletes: [], writes: [{ path, contents }], authorizations: authorization.paths });
  }
  return hostToolResult(core, "write", {
    ok: true,
    action: "write",
    path,
    displayPath,
    mode,
    contents,
    byteLength: contents.length,
  });
}

async function executeLegacyEdit(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "edit" }>,
): Promise<ToolResultEnvelope> {
  const { path } = prepared;
  const displayPath = prepared.displayPath;
  const authorization = await authorizePreparedMutationPaths(core, prepared, [path]);
  if (authorization.kind === "invalid") {
    return errorToolResult(core, authorization.error, { ok: false, error: authorization.error });
  }
  let content: string;
  let editAuthorization = authorization.paths[0]!;
  try {
    const read = await readAuthorizedFile(editAuthorization);
    editAuthorization = read.authorization;
    content = new TextDecoder().decode(read.contents);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
    const errorMessage = typeof code === "string"
      ? `Error code: ${code}`
      : String(error);
    return errorToolResult(core, `Could not edit file: ${displayPath}. ${errorMessage}.`, {
      ok: false,
      error: errorMessage,
    });
  }
  const application = decodeEditApplicationResult(core.call("applyEditToFile", [{
    path, displayPath, edits: prepared.edits, contents: content,
  }]));
  if (application.kind === "error") return errorToolResult(core, application.message, { ...application });
  const nextContent = application.contents;
  const editCount = application.editCount;
  await writePatchFiles({
    deletes: [], writes: [{ path, contents: nextContent }], authorizations: [editAuthorization],
  });
  return hostToolResult(core, "edit", {
    ok: true,
    action: "edit",
    path,
    displayPath,
    editCount,
    before: content,
    after: nextContent,
  });
}

async function executeApplyPatch(
  core: CoreBridge,
  rawParams: unknown,
  prepared: Extract<PreparedSuccess, { action: "apply_patch" }>,
  ctx: unknown,
): Promise<ToolResultEnvelope> {
  const files: Record<string, string> = {};
  const { affectedPaths } = prepared;
  const readAuthorization = await authorizePreparedMutationPaths(core, prepared, affectedPaths);
  if (readAuthorization.kind === "invalid") {
    return errorToolResult(core, readAuthorization.error, { ok: false, error: readAuthorization.error });
  }
  const authorizedResolvedPaths = new Set<string>();
  for (const authorizedPath of prepared.authorizedPaths) {
    if (authorizedResolvedPaths.has(authorizedPath.resolvedPath)) {
      const error = `Duplicate canonical patch authorization: ${authorizedPath.resolvedPath}`;
      return errorToolResult(core, error, { ok: false, error });
    }
    authorizedResolvedPaths.add(authorizedPath.resolvedPath);
  }
  if (
    authorizedResolvedPaths.size !== affectedPaths.length
    || affectedPaths.some((path) => !authorizedResolvedPaths.has(path))
  ) {
    const error = "Patch authorization mapping does not match affected paths";
    return errorToolResult(core, error, { ok: false, error });
  }
  const patchAuthorizations = new Map<string, MutationPathAuthorization>();
  for (const authorization of readAuthorization.paths) {
    if (authorization.targetState === undefined) {
      patchAuthorizations.set(authorization.path, authorization);
      continue;
    }
    const read = await readAuthorizedFile(authorization);
    patchAuthorizations.set(authorization.path, read.authorization);
    files[authorization.path] = new TextDecoder().decode(read.contents);
  }
  const application = decodePatchApplicationResult(core.call("applyPatchToFiles", [{
    params: rawParams, files, ctx, filesystemApproval: prepared.filesystemApproval === true,
    authorizedPaths: prepared.authorizedPaths,
  }]));
  if (application.kind === "error") return errorToolResult(core, application.message, { ...application });
  const deletes = application.deletes;
  const writes = application.writes;
  // Attach the pre-patch file contents so the renderer can compute a real
  // unified diff per file (apply_patch details already carry the new contents).
  const writesWithBefore = [];
  const writePaths: string[] = [];
  for (const write of writes) {
    writePaths.push(write.path);
    writesWithBefore.push({ ...write, before: files[write.path] ?? "" });
  }
  const deletedFiles = deletes.map((path) => ({ path, before: files[path] ?? "" }));
  const outputPaths = [...deletes, ...writePaths];
  const outputAuthorizations: MutationPathAuthorization[] = [];
  const seenOutputPaths = new Set<string>();
  for (const path of outputPaths) {
    const authorization = patchAuthorizations.get(path);
    if (authorization === undefined || seenOutputPaths.has(path)) {
      const error = `Patch output path was not authorized: ${path}`;
      return errorToolResult(core, error, { ok: false, error });
    }
    seenOutputPaths.add(path);
    outputAuthorizations.push(authorization);
  }
  await writePatchFiles({ deletes, writes, authorizations: outputAuthorizations });
  return hostToolResult(core, "apply_patch", { ...application, writes: writesWithBefore, deletedFiles });
}

export async function executeTool(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  name: string,
  rawParams: unknown,
  ctx: unknown,
  signal?: AbortSignal,
  childExtensionFactory?: (pi: PiLike) => void,
): Promise<GatewayToolResult> {
  const parsed = parseToolParams(name, rawParams);
  if (!parsed.ok) {
    if (agentToolNames.has(name)) {
      return agentErrorToolResult(core, "invalid_arguments", parsed.error);
    }
    return errorToolResult(core, parsed.error, { ok: false, error: parsed.error });
  }
  const childMarker = childSessionMarkerFromContext(ctx);
  if (
    !invalidChildSafeToolNames.has(name)
    && (childMarker.kind === "invalid" || childMarker.kind === "unavailable")
  ) {
    return errorToolResult(core, "invalid child session authority metadata", {
      ok: false,
      error: "invalid child session authority metadata",
      childMarker: childMarker.kind,
    });
  }
  if (name === "view_media" && !contextModelSupportsImages(ctx)) {
    const error = "Current model does not support image input";
    return errorToolResult(core, error, { ok: false, error, modelSupportsImages: false });
  }
  const agentTool = name === "agent_spawn" || name === "finder" || name === "oracle";
  if (name === "agent_list") {
    const prefix = `${childSessionCacheKeyScopeFromContext(ctx)}\0`;
    const liveAgentIds = [...childSessions.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    try {
      core.call("reconcileLiveAgentDispatches", [{ live_agent_ids: liveAgentIds }, ctx]);
    } catch (error) {
      return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
    }
  }
  const prepareCtx = agentTool && typeof pi.getActiveTools === "function"
    ? contextWithOverrides(ctx, { activeTools: pi.getActiveTools() })
    : ctx;
  let prepared;
  try {
    prepared = preparedAction(core, name, parsed.params, prepareCtx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (agentToolNames.has(name)) {
      return agentErrorToolResult(core, "persistence_failed", message);
    }
    throw error;
  }
  if (!prepared.ok) {
    if (agentToolNames.has(name)) {
      const message = prepared.error;
      const code = /unknown run|not owned.*run/.test(message) ? "run_not_found"
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
      const safeMessage = code === "run_not_found" ? "run not found"
        : code === "agent_not_found" ? "agent not found"
        : message;
      return agentErrorToolResult(core, code, safeMessage);
    }
    return errorToolResult(core, prepared.error, { ...prepared });
  }
  const approvalStillCurrent = () => {
    try {
      const candidate = preparedAction(core, name, parsed.params, ctx);
      const candidatePlanId = authorityPlanId(candidate as PreparedSuccess);
      const currentPlanId = authorityPlanId(prepared);
      if (candidatePlanId !== undefined) {
        discardPreparedAuthorityPlan(core, candidate as PreparedSuccess, ctx);
      }
      const withoutPlanId = (value: PreparedSuccess) => {
        if (!("planId" in value)) return value;
        const { planId: _planId, ...rest } = value;
        return rest;
      };
      return JSON.stringify(withoutPlanId(candidate as PreparedSuccess)) === JSON.stringify(withoutPlanId(prepared))
        && (candidatePlanId === undefined) === (currentPlanId === undefined);
    } catch {
      return false;
    }
  };
  const replan = () => executeTool(pi, core, childSessions, name, parsed.params, ctx, signal, childExtensionFactory);
  switch (prepared.action) {
    case "tool_result":
      return preparedToolResult(core, prepared);
    case "agent_start":
    case "agent_send":
    case "agent_wait":
    case "agent_close":
      return executeAgentPrepared(
        pi,
        core,
        childSessions,
        pendingAgentWaits,
        prepared as { readonly [key: string]: unknown },
        ctx,
        signal,
        childExtensionFactory,
      );
    case "openai_usage_fetch":
      return executeOpenAiUsageWithHostAuth(pi, core, prepared, ctx);
    case "exa_fetch":
      return executeExaInCore(core, prepared, ctx);
    case "exa_agent_create_run_approval":
      return withMutationApproval(core, "exa_agent_create_run", prepared, ctx, signal, approvalStillCurrent, replan, () =>
        executeApprovedExaInCore(core, prepared, ctx)
      );
    case "query_threads":
    case "read_thread": {
      const result = await runThreadTool(core, name, prepared, ctx);
      return result;
    }
    case "exec_command":
      return runPreparedExec(pi, core, prepared, ctx, signal, false, approvalStillCurrent, replan);
    case "exec_command_approval": {
      let outcome: ApprovalResolution;
      try {
        outcome = await confirmExecApproval(core, prepared, ctx, signal, approvalStillCurrent);
      } catch (error) {
        discardPreparedAuthorityPlan(core, prepared, ctx);
        throw error;
      }
      if (outcome === "replan") {
        discardPreparedAuthorityPlan(core, prepared, ctx);
        return replan();
      }
      const approvalPlan = decodeExecApprovalResult(core.call("finishExecApproval", [{
        planId: prepared.planId,
        ctx,
        outcome: outcome === "approved_always" ? "approved" : outcome,
      }]));
      if (approvalPlan.kind === "denied") return approvalPlan.result;
      return runPreparedExec(pi, core, { ...prepared, action: "exec_command" }, ctx, signal, false);
    }
    case "write_stdin":
      return writePreparedStdin(core, prepared, ctx, signal);
    case "write_approval":
      if (childMutationConfinement(ctx) !== "none") {
        return errorToolResult(core, "worktree-isolated child filesystem approval is forbidden", { ok: false });
      }
      return withMutationApproval(core, "write", prepared, ctx, signal, approvalStillCurrent, replan, () =>
        executeLegacyWrite(core, {
          ...prepared,
          action: "write",
          filesystemApproval: true,
          validateWorkspacePaths: false,
        })
      );
    case "edit_approval":
      if (childMutationConfinement(ctx) !== "none") {
        return errorToolResult(core, "worktree-isolated child filesystem approval is forbidden", { ok: false });
      }
      return withMutationApproval(core, "edit", prepared, ctx, signal, approvalStillCurrent, replan, () =>
        executeLegacyEdit(core, {
          ...prepared,
          action: "edit",
          filesystemApproval: true,
          validateWorkspacePaths: false,
        })
      );
    case "apply_patch_approval":
      if (childMutationConfinement(ctx) !== "none") {
        return errorToolResult(core, "worktree-isolated child filesystem approval is forbidden", { ok: false });
      }
      return withMutationApproval(core, "apply_patch", prepared, ctx, signal, approvalStillCurrent, replan, () =>
        executeApplyPatch(core, parsed.params, {
          ...prepared,
          action: "apply_patch",
          filesystemApproval: true,
          validateWorkspacePaths: false,
        }, ctx)
      );
    case "write":
      return executeLegacyWrite(core, prepared);
    case "read":
      return runPreparedRead(core, prepared, ctx);
    case "view_media":
      return runPreparedViewMedia(core, prepared, ctx);
    case "edit":
      return executeLegacyEdit(core, prepared);
    case "apply_patch":
      return executeApplyPatch(core, parsed.params, prepared, ctx);
    default:
      throw new Error(`${name} is registered by Taumel, but its executor is not connected yet.`);
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertToolCatalogMatchesCore(core: CoreBridge): void {
  const coreToolNames = decodeToolNamesResult(core.call("toolPolicyNames", [])).names;
  const expected = sorted(toolNames);
  const actual = sorted(coreToolNames);
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new Error(`Taumel tool catalog drift: TS=[${expected.join(", ")}] OCaml=[${actual.join(", ")}]`);
  }
}

export function registerGatewayTools(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
): void {
  if (typeof pi.registerTool !== "function") return;
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("notification", notificationMessageRenderer(), { background: "toolSuccessBg" });
    pi.registerMessageRenderer("taumel.goal.continue", goalContinuationMessageRenderer());
  }
  installExecNotificationLifecycle(pi, core);
  installAgentLifecycle(pi, core, childSessions, pendingAgentWaits);
  installIsolatedChildOwnershipLifecycle(pi, core, childSessions);
  assertToolCatalogMatchesCore(core);
  const allowed = new Set(decodeToolNamesResult(core.call("allowedToolNames", [])).names);
  for (const contract of toolContracts) {
    const name = contract.name;
    if (!allowed.has(name)) continue;
    pi.registerTool({
      name,
      label: contract.label,
      description: contract.description,
      parameters: contract.parameters,
      promptSnippet: contract.promptSnippet ?? "",
      ...(contract.promptGuidelines !== undefined ? { promptGuidelines: contract.promptGuidelines } : {}),
      execute: async (...args: unknown[]) => {
        const childExtensionFactory = (childPi: PiLike) =>
          registerGatewayTools(childPi, core, childSessions);
        const result = await executeTool(
          pi, core, childSessions, name, args[1], args[4],
          args[2] instanceof AbortSignal ? args[2] : undefined,
          childExtensionFactory,
        );
        const failure = agentFailureText(name, result);
        if (failure !== undefined) throw new Error(failure);
        return result;
      },
      ...(renderersForTool(name) ?? {}),
    });
  }
}
