import {
  createAgentSession as createPiAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ChildDispatchCompletion, ChildDispatchResult, ChildSessionCustomEntry, ChildSessionMetadata } from "./bridge-contracts.ts";
import { decodeChildDispatchPlan } from "./bridge-contracts.ts";

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
  modelRegistryFrom,
  sessionInfoFromContext,
  sessionInfoFromManager,
} from "./util.ts";

type HostMethods = { [name: string]: unknown };
type ChildContext = { readonly cwd?: unknown; readonly getModel?: () => unknown; readonly model?: unknown; readonly sessionManager?: unknown; readonly taumelSessionId?: unknown };
type ModelDescriptor = { readonly provider?: unknown; readonly id?: unknown };
type ModelRegistry = { readonly find?: (provider: string, model: string) => unknown };
type SessionManagerHost = { readonly getEntries?: () => unknown; readonly appendCustomEntry?: (customType: string, data: unknown) => unknown };
type CustomEntry = { readonly customType?: unknown; readonly type?: unknown; readonly data?: unknown; readonly value?: unknown };
type CapabilityProfile = { readonly sandboxPreset?: unknown; readonly approvalPolicy?: unknown; [key: string]: unknown };
type PermissionsEntry = { readonly profile?: unknown };
type ChildMetadataEntry = { readonly capabilityProfile?: unknown };
type AgentMessage = { readonly role?: unknown; readonly content?: unknown; readonly stopReason?: unknown; readonly errorMessage?: unknown };
type TextPart = { readonly text?: unknown };
type AgentEndEvent = { readonly type?: unknown; readonly messages?: unknown };
type SdkSession = {
  readonly subscribe?: (handler: (event: unknown) => void) => unknown;
  readonly isStreaming?: unknown;
  readonly steer?: (prompt: string) => Promise<unknown>;
  readonly followUp?: (prompt: string) => Promise<unknown>;
  readonly prompt?: (prompt: string, options: { streamingBehavior: string }) => Promise<unknown>;
  readonly sessionManager?: unknown; readonly sessionId?: unknown; readonly sessionFile?: unknown;
  readonly abort?: (reason?: string) => Promise<unknown>; readonly dispose?: () => unknown;
};
type CreatedSession = { readonly session?: unknown };
type NamedTool = { readonly name?: unknown };
type ChildSendContext = { readonly sendUserMessage?: (content: string, options: MessageDeliveryOptions) => Promise<unknown>; readonly sessionManager?: unknown };
type HostCompletion = {
  readonly finalOutput?: unknown; readonly output?: unknown; readonly result?: unknown; readonly content?: unknown;
  readonly status?: unknown; readonly stopReason?: unknown; readonly isError?: unknown;
  readonly reason?: unknown; readonly errorMessage?: unknown; readonly error?: unknown;
};
type ChildSessionUpdate = { readonly action?: unknown; readonly key?: unknown; readonly reason?: unknown };
type ChildUpdatesResult = { readonly details?: unknown };
type ChildUpdatesDetails = { readonly childSessionUpdates?: unknown };

function hostObject<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<T> : undefined;
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

function cwdFromContext(ctx: unknown): string {
  const cwd = hostObject<ChildContext>(ctx)?.cwd;
  return typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
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

function splitProviderModelId(modelId: string | undefined): { readonly provider: string; readonly model: string } | undefined {
  if (modelId === undefined) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1) return undefined;
  return { provider: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
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

function hasCustomEntry(sessionManager: unknown, customType: string): boolean {
  const manager = hostObject<SessionManagerHost>(sessionManager);
  if (typeof manager?.getEntries !== "function") return false;
  try {
    const entries = manager.getEntries.call(sessionManager);
    return Array.isArray(entries) && entries.some((entry) => {
      const value = hostObject<CustomEntry>(entry);
      return value !== undefined && (
        value.customType === customType ||
        value.type === customType ||
        (value.type === "custom" && value.customType === customType)
      );
    });
  } catch {
    return false;
  }
}

function customEntryData(entry: unknown, customType: string): unknown {
  const value = hostObject<CustomEntry>(entry);
  if (value === undefined) return undefined;
  if (value.customType === customType) return value.data;
  if (value.type === customType) return value.value;
  if (value.type === "custom" && value.customType === customType) return value.data;
  return undefined;
}

function latestCustomEntry(sessionManager: unknown, customType: string): unknown {
  const manager = hostObject<SessionManagerHost>(sessionManager);
  if (typeof manager?.getEntries !== "function") return undefined;
  const entries = manager.getEntries.call(sessionManager);
  if (!Array.isArray(entries)) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const data = customEntryData(entries[index], customType);
    if (data !== undefined) return data;
  }
  return undefined;
}

const sandboxRank: Record<string, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
};

const approvalRank: Record<string, number> = {
  untrusted: 0,
  "on-request": 1,
  "on-failure": 2,
  never: 3,
};

function stricterValue(
  left: unknown,
  right: unknown,
  ranks: Record<string, number>,
): string | undefined {
  if (typeof left !== "string" || typeof right !== "string") return undefined;
  const leftRank = ranks[left];
  const rightRank = ranks[right];
  if (leftRank === undefined || rightRank === undefined) return undefined;
  return leftRank <= rightRank ? left : right;
}

export function refreshOwnedChildPermissions(
  childSessions: Map<string, ChildSessionBridge>,
  parentCtx: unknown,
): void {
  const parentManager = hostObject<ChildContext>(parentCtx)?.sessionManager;
  if (parentManager === undefined) return;
  const parentPermissions = latestCustomEntry(parentManager, "taumel.permissions");
  const parentProfile = hostObject<CapabilityProfile>(hostObject<PermissionsEntry>(parentPermissions)?.profile);
  if (parentProfile === undefined) return;
  const scopePrefix = `${childSessionCacheKeyScopeFromContext(parentCtx)}\0`;

  for (const [key, child] of childSessions) {
    if (!key.startsWith(scopePrefix)) continue;
    const manager = child.sessionManager;
    const childMetadata = latestCustomEntry(manager, "taumel.childSession");
    const ceiling = hostObject<CapabilityProfile>(hostObject<ChildMetadataEntry>(childMetadata)?.capabilityProfile);
    if (ceiling === undefined) continue;
    const sandboxPreset = stricterValue(
      ceiling.sandboxPreset,
      parentProfile.sandboxPreset,
      sandboxRank,
    );
    const approvalPolicy = stricterValue(
      ceiling.approvalPolicy,
      parentProfile.approvalPolicy,
      approvalRank,
    );
    if (sandboxPreset === undefined || approvalPolicy === undefined) continue;
    const append = hostObject<SessionManagerHost>(manager)?.appendCustomEntry;
    if (typeof append !== "function") continue;
    append.call(manager, "taumel.permissions", {
      version: 1,
      profile: {
        ...ceiling,
        sandboxPreset,
        approvalPolicy,
        noSandboxAllowed: false,
      },
      networkMode: "disabled",
      noSandbox: false,
      isolated_child: true,
    });
  }
}

function appendSetupEntries(sessionManager: unknown, entries: readonly ChildSessionCustomEntry[]): SessionInfo {
  const append = hostObject<SessionManagerHost>(sessionManager)?.appendCustomEntry;
  if (typeof append === "function") {
    for (const entry of entries) {
      append.call(sessionManager, entry.customType, entry.data);
    }
  }
  return sessionInfoFromManager(sessionManager);
}

function assistantTextFromMessage(message: unknown): string | undefined {
  const assistant = hostObject<AgentMessage>(message);
  if (assistant === undefined) return undefined;
  const content = assistant.content;
  if (typeof content === "string") return content.trim() === "" ? undefined : content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      const text = hostObject<TextPart>(part)?.text;
      return typeof text === "string" ? text : "";
    })
    .filter((part) => part.trim() !== "")
    .join("\n");
  return text === "" ? undefined : text;
}

function completionFromAgentEndEvent(event: unknown): ChildDispatchCompletion | undefined {
  const agentEnd = hostObject<AgentEndEvent>(event);
  if (agentEnd?.type !== "agent_end" || !Array.isArray(agentEnd.messages)) {
    return undefined;
  }
  const messages = agentEnd.messages;
  const assistant = [...messages].reverse().find((message) => hostObject<AgentMessage>(message)?.role === "assistant");
  const finalOutput = assistantTextFromMessage(assistant);
  const assistantMessage = hostObject<AgentMessage>(assistant);
  const stopReason = typeof assistantMessage?.stopReason === "string" ? assistantMessage.stopReason : "";
  const errorMessage = typeof assistantMessage?.errorMessage === "string" ? assistantMessage.errorMessage : undefined;
  const status =
    errorMessage !== undefined || stopReason === "error" ? "failed" :
    stopReason === "cancelled" || stopReason === "aborted" ? "cancelled" :
    stopReason === "timed_out" ? "timed_out" :
    "completed";
  const reason = errorMessage ?? (status !== "completed" && stopReason !== "" ? stopReason : undefined);
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
  let completion: ChildDispatchCompletion | undefined;
  const unsubscribe =
    typeof subscribe === "function"
      ? subscribe.call(session, (event: unknown) => {
        completion = completionFromAgentEndEvent(event) ?? completion;
      })
      : undefined;
  try {
    const deliverAs = typeof options.deliverAs === "string" ? options.deliverAs : "followUp";
    const isStreaming = sdk.isStreaming === true;
    if (isStreaming && deliverAs === "steer" && typeof sdk.steer === "function") {
      const result = await sdk.steer.call(session, prompt);
      return completion ?? result;
    }
    if (isStreaming && typeof sdk.followUp === "function") {
      const result = await sdk.followUp.call(session, prompt);
      return completion ?? result;
    }
    if (typeof sdk.prompt === "function") {
      const result = await sdk.prompt.call(session, prompt, {
        streamingBehavior: deliverAs === "steer" ? "steer" : "followUp",
      });
      return completion ?? result;
    }
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", finalOutput: message, reason: message };
  } finally {
    if (typeof unsubscribe === "function") unsubscribe();
  }
}

async function stopChildSession(child: ChildSessionBridge | undefined, reason: string): Promise<void> {
  if (child?.stop !== undefined) {
    await child.stop(reason);
    return;
  }
  const ctx = child?.ctx;
  const manager = hostObject<ChildContext>(ctx)?.sessionManager;
  try {
    const stopped = await callOptionalAsync(ctx, ["abort", "cancel", "stop"], [reason]);
    if (stopped !== undefined) return;
    await callOptionalAsync(manager, ["abort", "cancel", "stop"], [reason]);
  } catch {
    // Closing/stopping an already-settled child is best effort; persisted state
    // remains the source of truth for parent-visible lifecycle.
  }
}

async function closeChildSession(child: ChildSessionBridge | undefined, reason: string): Promise<void> {
  if (child?.close !== undefined) {
    await child.close(reason);
    return;
  }
  const ctx = child?.ctx;
  const manager = hostObject<ChildContext>(ctx)?.sessionManager;
  await stopChildSession(child, reason);
  try {
    const closed = await callOptionalAsync(ctx, ["close", "dispose", "shutdown"], [reason]);
    if (closed !== undefined) return;
    await callOptionalAsync(manager, ["close", "dispose", "shutdown"], [reason]);
  } catch {
    // See stopChildSession: host cleanup is intentionally non-fatal.
  }
}

export async function createChildSession(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  metadata: ChildSessionMetadata,
): Promise<ChildSessionBridge | undefined> {
  const parent = sessionInfoFromContext(ctx);
  const plan = childSessionStartPlan(core, metadata, parent);
  const activeTools = plan.activeTools === undefined ? undefined : [...plan.activeTools];
  const modelId = plan.modelId;
  const thinkingLevel = plan.thinkingLevel;
  const setupEntries = [...plan.setupEntries];
  const cwd = cwdFromContext(ctx);
  const normalizedModelId = normalizeChildModelId(modelId);
  const model = resolveChildModel(pi, ctx, normalizedModelId);
  if (!model.applied || model.model === undefined) {
    return { error: "model_unavailable" };
  }
  if (activeTools === undefined) {
    return { error: "identity_snapshot_incomplete" };
  }
  if (typeof pi.getAllTools === "function") {
    const liveNames = new Set(
      pi.getAllTools()
        .map((tool) => {
          if (typeof tool === "string") return tool;
          const name = hostObject<NamedTool>(tool)?.name;
          return typeof name === "string" ? name : undefined;
        })
        .filter((name): name is string => name !== undefined),
    );
    const missing = activeTools.filter((name) => !liveNames.has(name));
    if (missing.length > 0) {
      return { error: `tool_surface_unavailable: ${missing.join(", ")}` };
    }
  }
  const sessionManager = SessionManager.inMemory(cwd);
  appendSetupEntries(sessionManager, setupEntries);
  try {
    const options = {
      cwd,
      sessionManager,
      ...(model.model !== undefined ? { model: model.model } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(activeTools !== undefined ? { tools: [...activeTools] } : {}),
    };
    const result =
      typeof pi.createAgentSession === "function"
        ? await pi.createAgentSession(options)
        : await createPiAgentSession(options as Parameters<typeof createPiAgentSession>[0]);
    const session = hostObject<SdkSession>(hostObject<CreatedSession>(result)?.session);
    if (session === undefined) return { error: "createAgentSession did not return a session" };
    const childSessionManager = session.sessionManager ?? sessionManager;
    const setupInfo =
      childSessionManager === sessionManager || hasCustomEntry(childSessionManager, "taumel.childSession")
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
      return { missingSessionIdentifier: true };
    }
    const activeToolsApplied = activeTools === undefined ? false : applyChildActiveTools(session, activeTools);
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
      close: async (reason) => {
        const closed = await callOptionalAsync(session, ["close", "shutdown"], [reason]);
        if (closed !== undefined) return;
        if (typeof session.abort === "function") await session.abort.call(session, reason);
        if (typeof session.dispose === "function") session.dispose.call(session);
      },
    };
  } catch (error) {
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
    readonly onCompletion?: (dispatch: ChildDispatchResult) => void | Promise<void>;
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
  const sendOptions = { deliverAs };
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
      void options.onCompletion?.(completed);
      return completed;
    }
    void Promise.resolve(hostResult)
      .then(async (value) => {
        const completed = dispatchResultWithHostCompletion(result, value);
        if (completed["completion"] !== undefined) {
          await options.onCompletion?.(completed);
        }
      })
      .catch(async (error) => {
        await options.onCompletion?.({
          ...result,
          completion: {
            status: "failed",
            finalOutput: error instanceof Error ? error.message : String(error),
            reason: error instanceof Error ? error.message : String(error),
          },
        });
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
  const parts = content
    .map((item) => {
      const text = hostObject<TextPart>(item)?.text;
      return typeof text === "string" ? text : "";
    })
    .filter((text) => text.trim() !== "");
  return parts.length === 0 ? undefined : parts.join("\n");
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
  const status = rawStatus === "failed" || completion.isError === true || stopReason === "error" ? "failed" :
    rawStatus === "cancelled" || rawStatus === "aborted" || stopReason === "cancelled" || stopReason === "aborted" ? "cancelled" :
    rawStatus === "timed_out" || stopReason === "timed_out" ? "timed_out" :
    "completed";
  const reason =
    typeof completion.reason === "string" ? completion.reason :
    typeof completion.errorMessage === "string" ? completion.errorMessage :
    typeof completion.error === "string" ? completion.error :
    stopReason !== "" ? stopReason :
    undefined;
  const hasOutput = finalOutput !== undefined && finalOutput.trim() !== "";
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
      await stopChildSession(childSessions.get(key) ?? bridge, typeof childUpdate.reason === "string" ? childUpdate.reason : "stopped_by_parent");
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
      await closeChildSession(childSessions.get(key) ?? bridge, typeof childUpdate.reason === "string" ? childUpdate.reason : "closed_by_parent");
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
