import {
  createAgentSession as createPiAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import finderPromptResource from "../resources/agents/finder.md" with { type: "text" };
import oraclePromptResource from "../resources/agents/oracle.md" with { type: "text" };
import subagentPromptResource from "../resources/agents/subagent.md" with { type: "text" };
import type { ChildDispatchCompletion, ChildDispatchResult, ChildSessionMetadata, ChildSessionSetupEntry } from "./bridge-contracts.ts";
import { decodeChildDispatchPlan, decodeChildPermissionRefreshPlan, decodeCoreAck } from "./bridge-contracts.ts";
import {
  appendChildSessionSetupEntry,
  appendTaumelCustomEntry,
  isCanonicalEntryPresent,
  latestTaumelCustomEntry,
} from "./pi-session-entries.ts";

import type {
  ChildSessionBridge,
  CoreBridge,
  MessageDeliveryOptions,
  PiLike,
  SessionInfo,
} from "./types.ts";
import {
  applyChildActiveTools,
  childBridgeFacts,
  childSessionStartPlan,
  cwdFromContext,
  modelRegistryFrom,
  sessionInfoFromContext,
  sessionInfoFromManager,
  splitProviderModelId,
} from "./util.ts";

type HostMethods = { [name: string]: unknown };
type ChildContext = { readonly cwd?: unknown; readonly getModel?: () => unknown; readonly model?: unknown; readonly sessionManager?: unknown; readonly taumelSessionId?: unknown };
type ModelDescriptor = { readonly provider?: unknown; readonly id?: unknown };
type ModelRegistry = {
  readonly find?: (provider: string, model: string) => unknown;
  readonly hasConfiguredAuth?: (model: unknown) => boolean;
};
type SessionManagerHost = { readonly getEntries?: () => unknown; readonly appendCustomEntry?: (customType: string, data: unknown) => unknown };
type MessageEntry = { readonly type?: unknown; readonly id?: unknown; readonly message?: unknown };
type AgentMessage = { readonly role?: unknown; readonly content?: unknown; readonly stopReason?: unknown; readonly errorMessage?: unknown };
type TextPart = { readonly text?: unknown };
type SdkSession = {
  readonly subscribe?: (handler: (event: unknown) => void) => unknown;
  readonly messages?: unknown;
  readonly isStreaming?: unknown;
  readonly steer?: (prompt: string) => Promise<unknown>;
  readonly followUp?: (prompt: string) => Promise<unknown>;
  readonly prompt?: (prompt: string, options: { streamingBehavior: string }) => Promise<unknown>;
  readonly getAvailableThinkingLevels?: () => readonly string[];
  readonly getActiveToolNames?: () => readonly string[];
  readonly sessionManager?: unknown; readonly sessionId?: unknown; readonly sessionFile?: unknown;
  readonly abort?: (reason?: string) => Promise<unknown>; readonly dispose?: () => unknown;
};
type CreatedSession = { readonly session?: unknown };
type NamedTool = { readonly name?: unknown };
type LoadedExtension = { readonly tools?: ReadonlyMap<string, unknown> };
type ChildSendContext = { readonly sendUserMessage?: (content: string, options: MessageDeliveryOptions) => Promise<unknown>; readonly sessionManager?: unknown };
type HostCompletion = {
  readonly finalOutput?: unknown; readonly output?: unknown; readonly result?: unknown; readonly content?: unknown;
  readonly status?: unknown; readonly stopReason?: unknown; readonly isError?: unknown;
  readonly reason?: unknown; readonly errorMessage?: unknown; readonly error?: unknown;
};
type ChildSessionUpdate = { readonly action?: unknown; readonly key?: unknown; readonly reason?: unknown };
type ChildUpdatesResult = { readonly details?: unknown };
type ChildUpdatesDetails = { readonly childSessionUpdates?: unknown };

const sdkStopReasons = new Set(["stop", "length", "toolUse", "error", "aborted"]);
const hostCompletionStatuses = new Set(["completed", "failed", "cancelled", "aborted", "timed_out"]);
const hostStopReasons = new Set([...sdkStopReasons, "cancelled", "timed_out"]);

function boundedCompletionReason(value: string): string {
  return value.slice(0, 4096);
}

function hostObject<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<T> : undefined;
}

function loadSpecialistPrompt(kind: string): string | undefined {
  const text = kind === "finder"
    ? finderPromptResource.trim()
    : kind === "oracle"
      ? oraclePromptResource.trim()
      : "";
  return text === "" ? undefined : text;
}

function loadSubagentPrompt(): string | undefined {
  const text = subagentPromptResource.trim();
  return text === "" ? undefined : text;
}

function withoutRecursiveTaumelError<
  T extends { readonly errors: readonly { readonly path?: unknown; readonly error?: unknown }[] },
>(
  result: T,
): T {
  const extensionPath = realpathSync(fileURLToPath(import.meta.url));
  return {
    ...result,
    errors: result.errors.filter((entry) => {
      if (typeof entry.path !== "string" || typeof entry.error !== "string") return true;
      let sourcePath: string;
      try {
        sourcePath = realpathSync(entry.path);
      } catch {
        return true;
      }
      return sourcePath !== extensionPath
        || !entry.error.endsWith("Taumel core is already initialized");
    }),
  };
}

function childResourceToolNames(resourceLoader: DefaultResourceLoader): Set<string> {
  const names = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
  for (const extension of resourceLoader.getExtensions().extensions as LoadedExtension[]) {
    if (extension.tools === undefined) continue;
    for (const name of extension.tools.keys()) names.add(name);
  }
  return names;
}

function specialistPromptForMetadata(metadata: Partial<{ readonly kind?: unknown; readonly agentKind?: unknown }> | undefined): string | undefined {
  const agentKind = typeof metadata?.agentKind === "string" ? metadata.agentKind.trim() : "";
  const kind = typeof metadata?.kind === "string" ? metadata.kind.trim() : "";
  return loadSpecialistPrompt(agentKind !== "" ? agentKind : kind);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function validateAgentSessionMarker(
  sessionManager: unknown,
  agentId: string,
  parent: SessionInfo,
): string | undefined {
  const markerLookup = latestTaumelCustomEntry(sessionManager, "taumel.childSession");
  if (markerLookup.kind !== "contract_valid") return "child_session_identity_missing";
  const marker = markerLookup.entry.data;
  if (marker.kind !== "agent") return "child_session_agent_mismatch";
  if (nonEmptyString(marker.agentId) !== agentId) return "child_session_agent_mismatch";

  const expectedParentFile = nonEmptyString(parent.sessionFile);
  const markerParentFile = nonEmptyString(marker.parentSessionFile);
  if (expectedParentFile !== undefined) {
    if (markerParentFile !== expectedParentFile) return "child_session_owner_mismatch";
  } else {
    const expectedParentId = nonEmptyString(parent.sessionId);
    const markerParentId = nonEmptyString(marker.parentSessionId);
    if (expectedParentId === undefined || markerParentId !== expectedParentId) {
      return "child_session_owner_mismatch";
    }
  }
  return undefined;
}

async function callOptionalAsync(receiver: unknown, names: readonly string[], args: readonly unknown[] = []): Promise<string | undefined> {
  const host = hostObject<HostMethods>(receiver);
  if (host === undefined) return undefined;
  for (const name of names) {
    const method = host[name];
    if (typeof method !== "function") continue;
    await method.apply(receiver, args);
    return name;
  }
  return undefined;
}

function currentModelFromContext(ctx: unknown): unknown {
  const context = hostObject<ChildContext>(ctx);
  if (context === undefined) return undefined;
  const getModel = context.getModel;
  if (typeof getModel === "function") {
    try {
      const model = getModel.call(ctx);
      if (model !== undefined && model !== null) return model;
    } catch {
      // Fall through to the exposed model snapshot.
    }
  }
  return context.model;
}

function modelIdOf(model: unknown): string | undefined {
  const descriptor = hostObject<ModelDescriptor>(model);
  if (descriptor === undefined) return undefined;
  const provider = typeof descriptor.provider === "string" ? descriptor.provider.trim() : "";
  const id = typeof descriptor.id === "string" ? descriptor.id.trim() : "";
  return provider !== "" && id !== "" ? `${provider}/${id}` : undefined;
}

function normalizeChildModelId(modelId: string | undefined): string | undefined {
  const trimmed = modelId?.trim();
  return trimmed === undefined || trimmed === "" || trimmed === "inherit" ? undefined : trimmed;
}

function resolveChildModel(pi: PiLike, ctx: unknown, modelId: string | undefined): { readonly model?: unknown; readonly applied: boolean } {
  modelId = normalizeChildModelId(modelId);
  const registry = modelRegistryFrom(pi, ctx);
  const requested = splitProviderModelId(modelId);
  const find = hostObject<ModelRegistry>(registry)?.find;
  if (requested !== undefined && typeof find === "function") {
    const model = find.call(registry, requested.provider, requested.model);
    if (model !== undefined && model !== null) {
      return { model, applied: true };
    }
  }
  if (modelId !== undefined) {
    const current = currentModelFromContext(ctx);
    if (modelIdOf(current) === modelId) return { model: current, applied: true };
    return { applied: false };
  }
  const inherited = currentModelFromContext(ctx);
  return inherited === undefined || inherited === null ? { applied: false } : { model: inherited, applied: true };
}

export function refreshOwnedChildPermissions(
  childSessions: Map<string, ChildSessionBridge>,
  parentCtx: unknown,
  core: CoreBridge,
  revalidateAuthority?: () => void,
): void {
  const parentManager = hostObject<ChildContext>(parentCtx)?.sessionManager;
  const parentLookup = latestTaumelCustomEntry(parentManager, "taumel.permissions");
  const parentPermissions = parentLookup.kind === "absent"
    ? null
    : parentLookup.kind === "contract_valid"
      ? parentLookup.entry.data
      : parentLookup.kind === "invalid"
        ? parentLookup.rawEntry.data
        : {};
  const scopePrefix = `${childSessionCacheKeyScopeFromContext(parentCtx)}\0`;

  for (const [key, child] of childSessions) {
    if (!key.startsWith(scopePrefix)) continue;
    const manager = child.sessionManager;
    const childLookup = latestTaumelCustomEntry(manager, "taumel.childSession");
    const childMetadata = childLookup.kind === "contract_valid"
      ? childLookup.entry.data
      : childLookup.kind === "invalid"
        ? childLookup.rawEntry.data
        : null;
    const plan = decodeChildPermissionRefreshPlan(
      core.call("planChildPermissionRefresh", [
        parentPermissions,
        childMetadata,
        parentCtx,
      ]),
    );
    revalidateAuthority?.();
    appendTaumelCustomEntry(manager, "taumel.permissions", plan.permissions);
  }
}

function appendSetupEntries(sessionManager: unknown, entries: readonly ChildSessionSetupEntry[]): SessionInfo {
  for (const entry of entries) appendChildSessionSetupEntry(sessionManager, entry);
  return sessionInfoFromManager(sessionManager);
}

function assistantTextFromMessage(message: unknown): string | undefined {
  const assistant = hostObject<AgentMessage>(message);
  if (assistant === undefined) return undefined;
  const content = assistant.content;
  if (typeof content === "string") return content;
  return completionTextFromContent(content);
}

export function latestAssistantEntryId(sessionManager: unknown): string | undefined {
  const manager = hostObject<SessionManagerHost>(sessionManager);
  if (typeof manager?.getEntries !== "function") return undefined;
  const entries = manager.getEntries.call(sessionManager);
  if (!Array.isArray(entries)) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = hostObject<MessageEntry>(entries[index]);
    const message = hostObject<AgentMessage>(entry?.message);
    if (entry?.type === "message" && message?.role === "assistant") {
      return typeof entry.id === "string" && entry.id !== "" ? entry.id : undefined;
    }
  }
  return undefined;
}

function completionFromMessages(messages: unknown, startIndex = 0): ChildDispatchCompletion | undefined {
  if (!Array.isArray(messages)) return undefined;
  let assistant: unknown;
  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index];
    if (hostObject<AgentMessage>(message)?.role === "assistant") {
      assistant = message;
      break;
    }
  }
  if (assistant === undefined) return undefined;
  const finalOutput = assistantTextFromMessage(assistant);
  const assistantMessage = hostObject<AgentMessage>(assistant);
  const stopReason = assistantMessage?.stopReason;
  const hasErrorMessage = Object.prototype.hasOwnProperty.call(assistantMessage, "errorMessage");
  const malformedErrorMessage = hasErrorMessage && typeof assistantMessage?.errorMessage !== "string";
  const errorMessage = typeof assistantMessage?.errorMessage === "string" && assistantMessage.errorMessage !== ""
    ? assistantMessage.errorMessage : undefined;
  let status: ChildDispatchCompletion["status"];
  let reason = errorMessage;
  if (malformedErrorMessage) {
    status = "failed";
    reason = "Malformed SDK errorMessage state";
  } else if (stopReason === "aborted") status = "cancelled";
  else if (stopReason === "error" || (sdkStopReasons.has(String(stopReason)) && errorMessage !== undefined)) status = "failed";
  else if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse") status = "completed";
  else {
    status = "failed";
    reason = typeof stopReason === "string" && stopReason !== ""
      ? boundedCompletionReason(`Unknown SDK stop reason: ${stopReason}`)
      : "Missing SDK stop reason";
  }
  return {
    status,
    ...(finalOutput !== undefined ? { finalOutput } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

async function sendToSdkAgentSession(session: unknown, prompt: string, options: MessageDeliveryOptions): Promise<unknown> {
  const sdk = hostObject<SdkSession>(session);
  if (sdk === undefined) {
    return undefined;
  }
  const subscribe = sdk.subscribe;
  const messageCount = Array.isArray(sdk.messages) ? sdk.messages.length : 0;
  let resolveSettled: ((value: unknown) => void) | undefined;
  const settled = new Promise<unknown>((resolve) => {
    resolveSettled = resolve;
  });
  let settlementCheckStarted = false;
  const settleWhenIdle = async (event: unknown) => {
    if (settlementCheckStarted) return;
    settlementCheckStarted = true;
    while (sdk.isStreaming === true) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    resolveSettled?.(
      completionFromMessages(sdk.messages, messageCount) ?? event,
    );
  };
  const unsubscribe =
    typeof subscribe === "function"
      ? subscribe.call(session, (event: unknown) => {
        options.onEvent?.(event);
        const lifecycle = hostObject<{ readonly type?: unknown; readonly willRetry?: unknown }>(event);
        if (lifecycle?.type === "agent_end" && lifecycle.willRetry !== true) {
          void settleWhenIdle(event);
        }
      })
      : undefined;
  try {
    const deliverAs = typeof options.deliverAs === "string" ? options.deliverAs : "followUp";
    const isStreaming = sdk.isStreaming === true;
    if (isStreaming && deliverAs === "steer" && typeof sdk.steer === "function") {
      const result = await sdk.steer.call(session, prompt);
      return typeof subscribe === "function" ? await settled : result;
    }
    if (isStreaming && typeof sdk.followUp === "function") {
      const result = await sdk.followUp.call(session, prompt);
      return typeof subscribe === "function" ? await settled : result;
    }
    if (typeof sdk.prompt === "function") {
      const result = await sdk.prompt.call(session, prompt, {
        streamingBehavior: deliverAs === "steer" ? "steer" : "followUp",
      });
      return completionFromMessages(sdk.messages, messageCount) ?? result;
    }
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", finalOutput: message, reason: message };
  } finally {
    if (typeof unsubscribe === "function") unsubscribe();
  }
}

async function stopChildSession(
  child: ChildSessionBridge | undefined, reason: string, authorize?: () => void,
): Promise<void> {
  if (child?.stop !== undefined) {
    authorize?.();
    await child.stop(reason);
    return;
  }
  const ctx = child?.ctx;
  const manager = hostObject<ChildContext>(ctx)?.sessionManager;
  try {
    authorize?.();
    const stopped = await callOptionalAsync(ctx, ["abort", "cancel", "stop"], [reason]);
    if (stopped !== undefined) return;
    authorize?.();
    await callOptionalAsync(manager, ["abort", "cancel", "stop"], [reason]);
  } catch {
    // Closing/stopping an already-settled child is best effort; persisted state
    // remains the source of truth for parent-visible lifecycle.
  }
}

async function closeChildSession(
  child: ChildSessionBridge | undefined, reason: string, authorize?: () => void,
): Promise<void> {
  if (child?.close !== undefined) {
    authorize?.();
    await child.close(reason, authorize);
    return;
  }
  const ctx = child?.ctx;
  const manager = hostObject<ChildContext>(ctx)?.sessionManager;
  await stopChildSession(child, reason, authorize);
  try {
    authorize?.();
    const closed = await callOptionalAsync(ctx, ["close", "dispose", "shutdown"], [reason]);
    if (closed !== undefined) return;
    authorize?.();
    await callOptionalAsync(manager, ["close", "dispose", "shutdown"], [reason]);
  } catch {
    // See stopChildSession: host cleanup is intentionally non-fatal.
  }
}

export function deleteAgentChildSession(core: CoreBridge, agentId: string, ctx: unknown): void {
  decodeCoreAck(core.call("deleteAgentChildSession", [{ agent_id: agentId }, ctx]));
}

async function removeNewPrivateSessionArtifacts(
  core: CoreBridge,
  ctx: unknown,
  agentId: string,
): Promise<void> {
  deleteAgentChildSession(core, agentId, ctx);
}

export async function createChildSession(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  metadata: ChildSessionMetadata,
  childExtensionFactory?: (pi: PiLike) => void,
  authorizeCleanup?: () => void,
  revalidateAuthority?: () => void,
): Promise<ChildSessionBridge | undefined> {
  const parent = sessionInfoFromContext(ctx);
  const plan = childSessionStartPlan(core, metadata, parent, ctx);
  const activeTools = plan.activeTools;
  const modelId = plan.modelId;
  const thinkingLevel = plan.thinkingLevel;
  const setupEntries = plan.setupEntries;
  const parentCwd = cwdFromContext(ctx);
  const normalizedModelId = normalizeChildModelId(modelId);
  const model = resolveChildModel(pi, ctx, normalizedModelId);
  if (!model.applied || model.model === undefined) {
    return { error: "model_unavailable" };
  }
  const registry = modelRegistryFrom(pi, ctx);
  const hasConfiguredAuth = hostObject<ModelRegistry>(registry)?.hasConfiguredAuth;
  if (
    normalizedModelId !== undefined &&
    typeof hasConfiguredAuth === "function" &&
    hasConfiguredAuth.call(registry, model.model) !== true
  ) {
    return { error: `model_authentication_unavailable: ${normalizedModelId}` };
  }
  if (activeTools === undefined) {
    return { error: "identity_snapshot_incomplete" };
  }
  if (typeof pi.getAllTools === "function") {
    const liveNames = new Set<string>();
    for (const tool of pi.getAllTools()) {
      if (typeof tool === "string") {
        liveNames.add(tool);
        continue;
      }
      const name = hostObject<NamedTool>(tool)?.name;
      if (typeof name === "string") liveNames.add(name);
    }
    const missing = activeTools.filter((name) => !liveNames.has(name));
    if (missing.length > 0) {
      return { error: `tool_surface_unavailable: ${missing.join(", ")}` };
    }
  }
  const metadataRecord = hostObject<{
    readonly kind?: unknown;
    readonly agentKind?: unknown;
    readonly agentId?: unknown;
    readonly childSessionFile?: unknown;
    readonly workspaceDirectory?: unknown;
  }>(metadata);
  const childKind = typeof metadataRecord?.kind === "string" ? metadataRecord.kind : "";
  const agentId = typeof metadataRecord?.agentId === "string" ? metadataRecord.agentId.trim() : "";
  const existingSessionFile =
    typeof metadataRecord?.childSessionFile === "string" ? metadataRecord.childSessionFile.trim() : "";
  const boundWorkspace = nonEmptyString(metadataRecord?.workspaceDirectory);
  const usePrivatePersistentSession =
    (childKind === "agent" || childKind === "generic" || childKind === "finder" || childKind === "oracle")
    && (agentId !== "" || existingSessionFile !== "");
  if (usePrivatePersistentSession
    && (authorizeCleanup === undefined || revalidateAuthority === undefined)) {
    return { error: "agent_cleanup_authority_missing" };
  }
  const privateSessionDirectory = plan.privateSessionDirectory;
  if (usePrivatePersistentSession && existingSessionFile === "" && privateSessionDirectory === undefined) {
    return { error: "private_child_session_directory_missing" };
  }
  const cwd = usePrivatePersistentSession ? boundWorkspace : parentCwd;
  if (cwd === undefined) return { error: "identity_workspace_missing" };
  try {
    if (!statSync(cwd).isDirectory()) return { error: "identity_workspace_unavailable" };
  } catch {
    return { error: "identity_workspace_unavailable" };
  }
  const specialistPrompt = specialistPromptForMetadata(metadataRecord);
  const agentKind = nonEmptyString(metadataRecord?.agentKind);
  if ((agentKind === "finder" || agentKind === "oracle") && specialistPrompt === undefined) {
    return { error: `specialist_prompt_unavailable: ${agentKind}` };
  }
  const subagentPrompt = loadSubagentPrompt();
  if (subagentPrompt === undefined) return { error: "subagent_prompt_unavailable" };
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    ...(childExtensionFactory === undefined
      ? {}
      : {
        extensionFactories: [(childPi) => childExtensionFactory(childPi as unknown as PiLike)],
        extensionsOverride: withoutRecursiveTaumelError,
      }),
    ...(specialistPrompt === undefined
      ? {}
      : { systemPromptOverride: () => specialistPrompt }),
    appendSystemPromptOverride: (base) => [...base, subagentPrompt],
  });
  try {
    await resourceLoader.reload();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (childExtensionFactory !== undefined) {
    const resourceNames = childResourceToolNames(resourceLoader);
    const missingResources = activeTools.filter((name) => !resourceNames.has(name));
    if (missingResources.length > 0) {
      return { error: `tool_surface_unavailable: ${missingResources.join(", ")}` };
    }
  }
  const removeCreatedPrivateSession = async () => {
    authorizeCleanup?.();
    await removeNewPrivateSessionArtifacts(core, ctx, agentId);
  };
  let createdSession: SdkSession | undefined;
  let createdSessionCleaned = false;
  const cleanupCreatedSession = async (reason: string) => {
    if (createdSession === undefined || createdSessionCleaned) return;
    createdSessionCleaned = true;
    let closed;
    try {
      authorizeCleanup?.();
      closed = await callOptionalAsync(createdSession, ["close", "shutdown"], [reason]);
    } catch {
      closed = undefined;
    }
    if (closed !== undefined) return;
    try {
      if (typeof createdSession.abort === "function") {
        authorizeCleanup?.();
        await createdSession.abort.call(createdSession, reason);
      }
    } finally {
      if (typeof createdSession.dispose === "function") {
        authorizeCleanup?.();
        createdSession.dispose.call(createdSession);
      }
    }
  };
  try {
    revalidateAuthority?.();
    const sessionManager = usePrivatePersistentSession
      ? (existingSessionFile !== ""
        ? SessionManager.open(existingSessionFile)
        : SessionManager.create(
          cwd,
          privateSessionDirectory as string,
        ))
      : SessionManager.inMemory(cwd);
    if (usePrivatePersistentSession && existingSessionFile !== "") {
      const markerError = validateAgentSessionMarker(sessionManager, agentId, parent);
      if (markerError !== undefined) return { error: markerError };
    } else {
      appendSetupEntries(sessionManager, setupEntries);
    }
    const options = {
      cwd,
      sessionManager,
      ...(model.model !== undefined ? { model: model.model } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(activeTools !== undefined ? { tools: [...activeTools] } : {}),
      resourceLoader,
    };
    revalidateAuthority?.();
    const result =
      typeof pi.createAgentSession === "function"
        ? await pi.createAgentSession(options)
        : await createPiAgentSession(options as Parameters<typeof createPiAgentSession>[0]);
    const session = hostObject<SdkSession>(hostObject<CreatedSession>(result)?.session);
    createdSession = session;
    revalidateAuthority?.();
    if (session === undefined) {
      if (usePrivatePersistentSession && existingSessionFile === "") {
        await removeCreatedPrivateSession();
      }
      return { error: "createAgentSession did not return a session" };
    }
    if (thinkingLevel !== undefined && typeof session.getAvailableThinkingLevels === "function") {
      const available = session.getAvailableThinkingLevels.call(session);
      if (!Array.isArray(available) || !available.includes(thinkingLevel)) {
        await cleanupCreatedSession("thinking_level_unavailable");
        if (usePrivatePersistentSession && existingSessionFile === "") {
          await removeCreatedPrivateSession();
        }
        return { error: `thinking_level_unavailable: ${thinkingLevel}` };
      }
    }
    const childSessionManager = session.sessionManager ?? sessionManager;
    const childMarker = latestTaumelCustomEntry(childSessionManager, "taumel.childSession");
    const setupInfo =
      childSessionManager === sessionManager
        || isCanonicalEntryPresent(childMarker)
        || childMarker.kind === "unavailable"
        ? sessionInfoFromManager(childSessionManager)
        : appendSetupEntries(childSessionManager, setupEntries);
    const sessionId =
      typeof session.sessionId === "string" && session.sessionId !== ""
        ? session.sessionId
        : setupInfo.sessionId;
    const sessionFile =
      typeof session.sessionFile === "string" && session.sessionFile !== ""
        ? session.sessionFile
        : setupInfo.sessionFile;
    if (!sessionId && !sessionFile) {
      await cleanupCreatedSession("missing_session_identifier");
      if (usePrivatePersistentSession && existingSessionFile === "") {
        await removeCreatedPrivateSession();
      }
      return { missingSessionIdentifier: true };
    }
    const activeToolsApplied = activeTools === undefined ? false : applyChildActiveTools(session, activeTools);
    const effectiveActiveTools = typeof session.getActiveToolNames === "function"
      ? session.getActiveToolNames.call(session)
      : [];
    const effectiveNames = new Set(effectiveActiveTools);
    const missingActiveTools = activeTools.filter((name) => !effectiveNames.has(name));
    if (missingActiveTools.length > 0) {
      await cleanupCreatedSession("tool_surface_unavailable");
      if (usePrivatePersistentSession && existingSessionFile === "") {
        await removeCreatedPrivateSession();
      }
      return { error: `tool_surface_unavailable: ${missingActiveTools.join(", ")}` };
    }
    return {
      sessionId: sessionId ?? sessionFile,
      sessionFile,
      session,
      sessionManager: childSessionManager,
      activeTools,
      activeToolsApplied,
      modelId: normalizedModelId,
      modelApplied: model.applied,
      thinkingLevel,
      thinkingApplied: thinkingLevel !== undefined,
      sendUserMessage: (content, options = {}) => sendToSdkAgentSession(session, content, options),
      stop: async (reason) => {
        if (typeof session.abort === "function") await session.abort.call(session, reason);
      },
      close: async (reason, authorize) => {
        authorize?.();
        const closed = await callOptionalAsync(session, ["close", "shutdown"], [reason]);
        if (closed !== undefined) return;
        if (typeof session.abort === "function") {
          authorize?.();
          await session.abort.call(session, reason);
        }
        if (typeof session.dispose === "function") {
          authorize?.();
          session.dispose.call(session);
        }
      },
    };
  } catch (error) {
    try {
      await cleanupCreatedSession("child_session_creation_failed");
    } catch {
      // Preserve the creation error; artifact cleanup remains independently authorized.
    }
    if (usePrivatePersistentSession && existingSessionFile === "") {
      try {
        await removeCreatedPrivateSession();
      } catch {
        // Preserve the original creation error; the identity rollback remains authoritative.
      }
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendToChildSession(
  pi: PiLike,
  core: CoreBridge,
  child: ChildSessionBridge | undefined,
  prompt: string,
  emptyReason = "empty prompt",
  options: {
    readonly awaitCompletion?: boolean;
    readonly deliverAs?: string;
    readonly onEvent?: (event: unknown) => void;
    readonly onCompletion?: (dispatch: ChildDispatchResult) => void | Promise<void>;
    readonly completionGate?: Promise<void>;
  } = {},
): Promise<ChildDispatchResult> {
  const childCtx = child?.ctx;
  const sendContext = hostObject<ChildSendContext>(childCtx);
  const childSendAvailable =
    typeof child?.sendUserMessage === "function" ||
    typeof sendContext?.sendUserMessage === "function";
  const hostSendAvailable = typeof pi.sendUserMessage === "function";
  const plan = decodeChildDispatchPlan(core.call("planChildDispatch", [{
    ...childBridgeFacts(child),
    prompt,
    emptyReason,
    sendAvailable: childSendAvailable || hostSendAvailable,
    deliverAs: options.deliverAs ?? "",
  }]));
  const result = plan.result;
  if (!plan.send) return result;

  const dispatchPrompt = plan.prompt;
  const deliverAs = plan.deliverAs;
  if (deliverAs === "") throw new Error("Invalid Taumel child dispatch delivery mode");
  const sendOptions = { deliverAs, onEvent: options.onEvent };
  const awaitCompletion = options.awaitCompletion !== false;
  const completeLater = (send: () => Promise<unknown> | unknown) => {
    let hostResult: Promise<unknown> | unknown;
    try {
      hostResult = send();
    } catch (error) {
      const completed = dispatchResultWithHostCompletion(result, {
        status: "failed",
        finalOutput: error instanceof Error ? error.message : String(error),
      });
      void Promise.resolve(options.completionGate)
        .then(() => options.onCompletion?.(completed))
        .catch((failure) => {
          console.error("Taumel child completion callback failed", failure);
        });
      return completed;
    }
    void Promise.resolve(hostResult)
      .then(async (value) => {
        await options.completionGate;
        const completed = dispatchResultWithHostCompletion(result, value);
        if (completed["completion"] !== undefined) {
          await options.onCompletion?.(completed);
        }
      }, async (error) => {
        await options.completionGate;
        await options.onCompletion?.({
          ...result,
          completion: {
            status: "failed",
            finalOutput: error instanceof Error ? error.message : String(error),
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      })
      .catch((error) => {
        console.error("Taumel child completion callback failed", error);
      });
    return result;
  };
  if (typeof child?.sendUserMessage === "function") {
    if (!awaitCompletion) {
      return completeLater(() => child.sendUserMessage?.(dispatchPrompt, sendOptions));
    }
    const hostResult = await child.sendUserMessage(dispatchPrompt, sendOptions);
    return dispatchResultWithHostCompletion(result, hostResult);
  }
  if (typeof sendContext?.sendUserMessage === "function") {
    const sendUserMessage = sendContext.sendUserMessage;
    if (!awaitCompletion) {
      return completeLater(() => sendUserMessage.call(childCtx, dispatchPrompt, sendOptions));
    }
    const hostResult = await sendUserMessage.call(childCtx, dispatchPrompt, sendOptions);
    return dispatchResultWithHostCompletion(result, hostResult);
  }
  if (typeof pi.sendUserMessage === "function") {
    if (!awaitCompletion) {
      return completeLater(() => pi.sendUserMessage?.(dispatchPrompt, sendOptions));
    }
    const hostResult = await pi.sendUserMessage(dispatchPrompt, sendOptions);
    return dispatchResultWithHostCompletion(result, hostResult);
  }
  return result;
}

function completionTextFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    const text = hostObject<TextPart>(item)?.text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.length === 0 ? "" : parts.join("\n");
}

function dispatchCompletionFromHostResult(hostResult: unknown): ChildDispatchCompletion | undefined {
  if (typeof hostResult === "string" && hostResult.trim() !== "") {
    return { status: "completed", finalOutput: hostResult };
  }
  const completion = hostObject<HostCompletion>(hostResult);
  if (completion === undefined) return undefined;
  const finalOutput =
    typeof completion.finalOutput === "string" ? completion.finalOutput :
    typeof completion.output === "string" ? completion.output :
    typeof completion.result === "string" ? completion.result :
    completionTextFromContent(completion.content);
  const rawStatus = typeof completion.status === "string" ? completion.status : "";
  const stopReason = typeof completion.stopReason === "string" ? completion.stopReason : "";
  const hasStatus = Object.prototype.hasOwnProperty.call(completion, "status");
  const hasStopReason = Object.prototype.hasOwnProperty.call(completion, "stopReason");
  const hasIsError = Object.prototype.hasOwnProperty.call(completion, "isError");
  const hasErrorMessage = Object.prototype.hasOwnProperty.call(completion, "errorMessage");
  const hasError = Object.prototype.hasOwnProperty.call(completion, "error");
  const unknownStatus = hasStatus && (rawStatus === "" || !hostCompletionStatuses.has(rawStatus));
  const unknownStopReason = hasStopReason && (stopReason === "" || !hostStopReasons.has(stopReason));
  const malformedIsError = hasIsError && typeof completion.isError !== "boolean";
  const malformedError = (hasErrorMessage && typeof completion.errorMessage !== "string")
    || (hasError && typeof completion.error !== "string");
  const hasErrorSignal = completion.isError === true
    || (typeof completion.errorMessage === "string" && completion.errorMessage !== "")
    || (typeof completion.error === "string" && completion.error !== "");
  const status: ChildDispatchCompletion["status"] = unknownStatus || unknownStopReason || malformedIsError || malformedError ? "failed" :
    rawStatus === "cancelled" || rawStatus === "aborted" || stopReason === "cancelled" || stopReason === "aborted" ? "cancelled" :
    rawStatus === "timed_out" || stopReason === "timed_out" ? "timed_out" :
    rawStatus === "failed" || hasErrorSignal || stopReason === "error" ? "failed" :
    "completed";
  const explicitReason =
    typeof completion.reason === "string" ? completion.reason :
    typeof completion.errorMessage === "string" ? completion.errorMessage :
    typeof completion.error === "string" ? completion.error :
    stopReason !== "" ? stopReason :
    undefined;
  const reason = unknownStatus
    ? boundedCompletionReason(`Unknown SDK completion status: ${typeof completion.status === "string" ? completion.status : String(completion.status)}`)
    : unknownStopReason
      ? boundedCompletionReason(`Unknown SDK stop reason: ${typeof completion.stopReason === "string" ? completion.stopReason : String(completion.stopReason)}`)
      : malformedIsError
        ? "Malformed SDK isError state"
        : malformedError
          ? "Malformed SDK error state"
          : explicitReason;
  const hasOutput = finalOutput !== undefined;
  const explicitTerminal = rawStatus !== "" || completion.isError === true || stopReason !== "";
  if (!hasOutput && status === "completed" && !explicitTerminal) {
    return undefined;
  }
  return {
    status,
    ...(hasOutput ? { finalOutput } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function dispatchResultWithHostCompletion(
  result: ChildDispatchResult,
  hostResult: unknown,
): ChildDispatchResult {
  const completion = dispatchCompletionFromHostResult(hostResult);
  return completion === undefined ? result : { ...result, completion };
}

export function childSessionCacheKeyScopeFromContext(ctx: unknown): string {
  const taumelSessionId = hostObject<ChildContext>(ctx)?.taumelSessionId;
  if (typeof taumelSessionId === "string") {
    const value = taumelSessionId.trim();
    if (value !== "") return value;
  }
  return sessionInfoFromContext(ctx).sessionId ?? "current";
}

export function childSessionCacheKey(key: string, keyScope: string | undefined): string {
  return keyScope === undefined || keyScope === "" ? key : `${keyScope}\u0000${key}`;
}

export async function applyChildSessionUpdate(
  childSessions: Map<string, ChildSessionBridge>,
  update: unknown,
  bridge: ChildSessionBridge | undefined,
  keyScope?: string,
  authorizeEffect?: () => void,
): Promise<void> {
  const childUpdate = hostObject<ChildSessionUpdate>(update);
  if (childUpdate === undefined) throw new Error("Invalid Taumel child session update");
  switch (childUpdate.action) {
    case "none":
      return;
    case "store_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "" || !bridge) throw new Error("Invalid Taumel child session update");
      childSessions.set(childSessionCacheKey(rawKey, keyScope), bridge);
      return;
    }
    case "stop_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "") throw new Error("Invalid Taumel child session update");
      const key = childSessionCacheKey(rawKey, keyScope);
      await stopChildSession(childSessions.get(key) ?? bridge, typeof childUpdate.reason === "string" ? childUpdate.reason : "stopped_by_parent", authorizeEffect);
      return;
    }
    case "drop_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "") throw new Error("Invalid Taumel child session update");
      childSessions.delete(childSessionCacheKey(rawKey, keyScope));
      return;
    }
    case "delete_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "") throw new Error("Invalid Taumel child session update");
      const key = childSessionCacheKey(rawKey, keyScope);
      await closeChildSession(childSessions.get(key) ?? bridge, typeof childUpdate.reason === "string" ? childUpdate.reason : "agent_closed", authorizeEffect);
      authorizeEffect?.();
      childSessions.delete(key);
      return;
    }
    default:
      throw new Error("Invalid Taumel child session update");
  }
}

export async function applyChildSessionUpdatesFromDetails(
  childSessions: Map<string, ChildSessionBridge>,
  result: unknown,
  keyScope?: string,
): Promise<boolean> {
  const rawDetails = hostObject<ChildUpdatesResult>(result)?.details;
  const details = hostObject<ChildUpdatesDetails>(rawDetails);
  const updates = Array.isArray(details?.childSessionUpdates)
    ? details.childSessionUpdates
    : [];
  for (const update of updates) {
    if (typeof update === "object" && update !== null) await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
  }
  return updates.length > 0;
}
