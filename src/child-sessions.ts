import {
  createAgentSession as createPiAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type {
  ChildSessionBridge,
  CoreBridge,
  PiLike,
  SessionInfo,
} from "./types.ts";
import {
  applyChildActiveTools,
  childBridgeFacts,
  childSessionStartPlan,
  coreCallRecord,
  isRecord,
  modelRegistryFrom,
  optionalStringField,
  sessionInfoFromContext,
  sessionInfoFromManager,
  stringArrayFromUnknown,
  stringField,
} from "./util.ts";
import { statSync } from "node:fs";

async function callOptionalAsync(receiver: unknown, names: readonly string[], args: readonly unknown[] = []): Promise<string | undefined> {
  if (!isRecord(receiver)) return undefined;
  for (const name of names) {
    const method = receiver[name];
    if (typeof method !== "function") continue;
    await method.apply(receiver, args);
    return name;
  }
  return undefined;
}

function cwdFromContext(ctx: unknown): string {
  return isRecord(ctx) && typeof ctx["cwd"] === "string" && ctx["cwd"] !== "" ? ctx["cwd"] : process.cwd();
}

function currentModelFromContext(ctx: unknown): unknown {
  if (!isRecord(ctx)) return undefined;
  const getModel = ctx["getModel"];
  if (typeof getModel === "function") {
    try {
      const model = getModel.call(ctx);
      if (model !== undefined && model !== null) return model;
    } catch {
      // Fall through to the exposed model snapshot.
    }
  }
  return ctx["model"];
}

function modelIdOf(model: unknown): string | undefined {
  if (!isRecord(model)) return undefined;
  const provider = typeof model["provider"] === "string" ? model["provider"].trim() : "";
  const id = typeof model["id"] === "string" ? model["id"].trim() : "";
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
  if (requested !== undefined && isRecord(registry) && typeof registry["find"] === "function") {
    const model = registry["find"].call(registry, requested.provider, requested.model);
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
  if (!isRecord(sessionManager) || typeof sessionManager["getEntries"] !== "function") return false;
  try {
    const entries = sessionManager["getEntries"].call(sessionManager);
    return Array.isArray(entries) && entries.some((entry) =>
      isRecord(entry) &&
      (
        entry["customType"] === customType ||
        entry["type"] === customType ||
        (entry["type"] === "custom" && entry["customType"] === customType)
      )
    );
  } catch {
    return false;
  }
}

function customEntryData(entry: unknown, customType: string): unknown {
  if (!isRecord(entry)) return undefined;
  if (entry["customType"] === customType) return entry["data"];
  if (entry["type"] === customType) return entry["value"];
  if (entry["type"] === "custom" && entry["customType"] === customType) return entry["data"];
  return undefined;
}

function latestCustomEntry(sessionManager: unknown, customType: string): unknown {
  if (!isRecord(sessionManager) || typeof sessionManager["getEntries"] !== "function") return undefined;
  const entries = sessionManager["getEntries"].call(sessionManager);
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
  if (!isRecord(parentCtx)) return;
  const parentManager = parentCtx["sessionManager"];
  const parentPermissions = latestCustomEntry(parentManager, "taumel.permissions");
  if (!isRecord(parentPermissions) || !isRecord(parentPermissions["profile"])) return;
  const parentProfile = parentPermissions["profile"];
  const scopePrefix = `${childSessionCacheKeyScopeFromContext(parentCtx)}\0`;

  for (const [key, child] of childSessions) {
    if (!key.startsWith(scopePrefix)) continue;
    const manager = child.sessionManager;
    const childMetadata = latestCustomEntry(manager, "taumel.childSession");
    if (!isRecord(childMetadata) || !isRecord(childMetadata["capabilityProfile"])) continue;
    const ceiling = childMetadata["capabilityProfile"];
    const sandboxPreset = stricterValue(
      ceiling["sandboxPreset"],
      parentProfile["sandboxPreset"],
      sandboxRank,
    );
    const approvalPolicy = stricterValue(
      ceiling["approvalPolicy"],
      parentProfile["approvalPolicy"],
      approvalRank,
    );
    if (sandboxPreset === undefined || approvalPolicy === undefined) continue;
    if (!isRecord(manager) || typeof manager["appendCustomEntry"] !== "function") continue;
    manager["appendCustomEntry"].call(manager, "taumel.permissions", {
      version: 1,
      profile: {
        ...ceiling,
        sandboxPreset,
        approvalPolicy,
        noSandboxAllowed: false,
      },
      networkMode: "disabled",
      noSandbox: false,
      subagent: true,
    });
  }
}

function appendSetupEntries(sessionManager: unknown, entries: readonly Record<string, unknown>[]): SessionInfo {
  if (isRecord(sessionManager) && typeof sessionManager["appendCustomEntry"] === "function") {
    for (const entry of entries) {
      const customType = stringField(entry, "customType");
      if (customType === "") continue;
      sessionManager["appendCustomEntry"].call(sessionManager, customType, entry["data"]);
    }
  }
  return sessionInfoFromManager(sessionManager);
}

function agentSystemPromptFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const value = metadata["agentSystemPrompt"];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function assistantTextFromMessage(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const content = message["content"];
  if (typeof content === "string") return content.trim() === "" ? undefined : content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => isRecord(part) && typeof part["text"] === "string" ? part["text"] : "")
    .filter((part) => part.trim() !== "")
    .join("\n");
  return text === "" ? undefined : text;
}

function completionFromAgentEndEvent(event: unknown): Record<string, unknown> | undefined {
  if (!isRecord(event) || event["type"] !== "agent_end" || !Array.isArray(event["messages"])) {
    return undefined;
  }
  const messages = event["messages"];
  const assistant = [...messages].reverse().find((message) => isRecord(message) && message["role"] === "assistant");
  const finalOutput = assistantTextFromMessage(assistant);
  const stopReason = isRecord(assistant) && typeof assistant["stopReason"] === "string" ? assistant["stopReason"] : "";
  const errorMessage = isRecord(assistant) && typeof assistant["errorMessage"] === "string" ? assistant["errorMessage"] : undefined;
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

async function sendToSdkAgentSession(session: unknown, prompt: string, options: Record<string, unknown>): Promise<unknown> {
  if (!isRecord(session)) {
    return undefined;
  }
  const subscribe = session["subscribe"];
  let completion: Record<string, unknown> | undefined;
  const unsubscribe =
    typeof subscribe === "function"
      ? subscribe.call(session, (event: unknown) => {
        completion = completionFromAgentEndEvent(event) ?? completion;
      })
      : undefined;
  try {
    const deliverAs = typeof options["deliverAs"] === "string" ? options["deliverAs"] : "followUp";
    const isStreaming = session["isStreaming"] === true;
    if (isStreaming && deliverAs === "steer" && typeof session["steer"] === "function") {
      const result = await session["steer"].call(session, prompt);
      return completion ?? result;
    }
    if (isStreaming && typeof session["followUp"] === "function") {
      const result = await session["followUp"].call(session, prompt);
      return completion ?? result;
    }
    if (typeof session["prompt"] === "function") {
      const result = await session["prompt"].call(session, prompt, {
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
  const manager = isRecord(ctx) ? ctx["sessionManager"] : undefined;
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
  const manager = isRecord(ctx) ? ctx["sessionManager"] : undefined;
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
  metadata: Record<string, unknown>,
): Promise<ChildSessionBridge | undefined> {
  const parent = sessionInfoFromContext(ctx);
  const plan = childSessionStartPlan(core, metadata, parent);
  const activeTools = stringArrayFromUnknown(plan["activeTools"]);
  const modelId = optionalStringField(plan, "modelId");
  const thinkingLevel = optionalStringField(plan, "thinkingLevel");
  const setupEntriesRaw = plan["setupEntries"];
  if (!Array.isArray(setupEntriesRaw) || !setupEntriesRaw.every(isRecord)) {
    throw new Error("Invalid Taumel child session start plan");
  }
  const setupEntries = setupEntriesRaw;
  const workspaceDirectory = optionalStringField(metadata, "workspaceDirectory");
  const cwd = workspaceDirectory ?? cwdFromContext(ctx);
  if (workspaceDirectory !== undefined) {
    try {
      if (!statSync(workspaceDirectory).isDirectory()) {
        return { error: "working_directory_unavailable" };
      }
    } catch {
      return { error: "working_directory_unavailable" };
    }
  }
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
        .map((tool) => typeof tool === "string" ? tool : isRecord(tool) && typeof tool["name"] === "string" ? tool["name"] : undefined)
        .filter((name): name is string => name !== undefined),
    );
    const missing = activeTools.filter((name) => !liveNames.has(name));
    if (missing.length > 0) {
      return { error: `tool_surface_unavailable: ${missing.join(", ")}` };
    }
  }
  const systemPrompt = agentSystemPromptFromMetadata(metadata);
  const sessionManager = SessionManager.inMemory(cwd);
  appendSetupEntries(sessionManager, setupEntries);
  const resourceLoader =
    systemPrompt === undefined
      ? undefined
      : new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir(),
        appendSystemPromptOverride: (base) => [...base, systemPrompt],
      });
  try {
    await resourceLoader?.reload();
    const options = {
      cwd,
      sessionManager,
      ...(model.model !== undefined ? { model: model.model } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(activeTools !== undefined ? { tools: [...activeTools] } : {}),
      ...(resourceLoader !== undefined ? { resourceLoader } : {}),
    };
    const result =
      typeof pi.createAgentSession === "function"
        ? await pi.createAgentSession(options)
        : await createPiAgentSession(options as Parameters<typeof createPiAgentSession>[0]);
    const session = isRecord(result) ? result["session"] : undefined;
    if (!isRecord(session)) return { error: "createAgentSession did not return a session" };
    const childSessionManager = session["sessionManager"] ?? sessionManager;
    const setupInfo =
      childSessionManager === sessionManager || hasCustomEntry(childSessionManager, "taumel.childSession")
        ? sessionInfoFromManager(childSessionManager)
        : appendSetupEntries(childSessionManager, setupEntries);
    const sessionId =
      typeof session["sessionId"] === "string" && session["sessionId"] !== ""
        ? session["sessionId"]
        : setupInfo.sessionId;
    const sessionFile =
      typeof session["sessionFile"] === "string" && session["sessionFile"] !== ""
        ? session["sessionFile"]
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
        if (typeof session["abort"] === "function") await session["abort"].call(session, reason);
      },
      close: async (reason) => {
        const closed = await callOptionalAsync(session, ["close", "shutdown"], [reason]);
        if (closed !== undefined) return;
        if (typeof session["abort"] === "function") await session["abort"].call(session, reason);
        if (typeof session["dispose"] === "function") session["dispose"].call(session);
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
    readonly onCompletion?: (dispatch: Record<string, unknown>) => void | Promise<void>;
  } = {},
): Promise<Record<string, unknown>> {
  const childCtx = child?.ctx;
  const childSendAvailable =
    typeof child?.sendUserMessage === "function" ||
    (isRecord(childCtx) && typeof childCtx["sendUserMessage"] === "function");
  const hostSendAvailable = typeof pi.sendUserMessage === "function";
  const plan = coreCallRecord(core, "planChildDispatch", [{
    ...childBridgeFacts(child),
    prompt,
    emptyReason,
    sendAvailable: childSendAvailable || hostSendAvailable,
    deliverAs: options.deliverAs ?? "",
  }], "child dispatch plan");
  const result = isRecord(plan["result"]) ? plan["result"] : undefined;
  if (result === undefined) throw new Error("Invalid Taumel child dispatch result");
  if (plan["send"] !== true) return result;

  const dispatchPrompt = stringField(plan, "prompt");
  const deliverAs = stringField(plan, "deliverAs");
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
  if (isRecord(childCtx) && typeof childCtx["sendUserMessage"] === "function") {
    const sendUserMessage = childCtx["sendUserMessage"];
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
    .map((item) => isRecord(item) && typeof item["text"] === "string" ? item["text"] : "")
    .filter((text) => text.trim() !== "");
  return parts.length === 0 ? undefined : parts.join("\n");
}

function dispatchCompletionFromHostResult(hostResult: unknown): Record<string, unknown> | undefined {
  if (typeof hostResult === "string" && hostResult.trim() !== "") {
    return { status: "completed", finalOutput: hostResult };
  }
  if (!isRecord(hostResult)) {
    return undefined;
  }
  const finalOutput =
    typeof hostResult["finalOutput"] === "string" ? hostResult["finalOutput"] :
    typeof hostResult["output"] === "string" ? hostResult["output"] :
    typeof hostResult["result"] === "string" ? hostResult["result"] :
    completionTextFromContent(hostResult["content"]);
  const rawStatus = typeof hostResult["status"] === "string" ? hostResult["status"] : "";
  const stopReason = typeof hostResult["stopReason"] === "string" ? hostResult["stopReason"] : "";
  const status = rawStatus === "failed" || hostResult["isError"] === true || stopReason === "error" ? "failed" :
    rawStatus === "cancelled" || rawStatus === "aborted" || stopReason === "cancelled" || stopReason === "aborted" ? "cancelled" :
    rawStatus === "timed_out" || stopReason === "timed_out" ? "timed_out" :
    "completed";
  const reason =
    typeof hostResult["reason"] === "string" ? hostResult["reason"] :
    typeof hostResult["errorMessage"] === "string" ? hostResult["errorMessage"] :
    typeof hostResult["error"] === "string" ? hostResult["error"] :
    stopReason !== "" ? stopReason :
    undefined;
  const hasOutput = finalOutput !== undefined && finalOutput.trim() !== "";
  const explicitTerminal = rawStatus !== "" || hostResult["isError"] === true || stopReason !== "";
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
  result: Record<string, unknown>,
  hostResult: unknown,
): Record<string, unknown> {
  const completion = dispatchCompletionFromHostResult(hostResult);
  return completion === undefined ? result : { ...result, completion };
}

export function childSessionCacheKeyScopeFromContext(ctx: unknown): string {
  if (isRecord(ctx) && typeof ctx["taumelSessionId"] === "string") {
    const value = ctx["taumelSessionId"].trim();
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
  if (!isRecord(update)) throw new Error("Invalid Taumel child session update");
  switch (stringField(update, "action")) {
    case "none":
      return;
    case "store_child_session": {
      const rawKey = stringField(update, "key");
      if (rawKey === "" || !bridge) throw new Error("Invalid Taumel child session update");
      childSessions.set(childSessionCacheKey(rawKey, keyScope), bridge);
      return;
    }
    case "stop_child_session": {
      const rawKey = stringField(update, "key");
      if (rawKey === "") throw new Error("Invalid Taumel child session update");
      const key = childSessionCacheKey(rawKey, keyScope);
      await stopChildSession(childSessions.get(key) ?? bridge, optionalStringField(update, "reason") ?? "stopped_by_parent");
      return;
    }
    case "drop_child_session": {
      const rawKey = stringField(update, "key");
      if (rawKey === "") throw new Error("Invalid Taumel child session update");
      childSessions.delete(childSessionCacheKey(rawKey, keyScope));
      return;
    }
    case "delete_child_session": {
      const rawKey = stringField(update, "key");
      if (rawKey === "") throw new Error("Invalid Taumel child session update");
      const key = childSessionCacheKey(rawKey, keyScope);
      await closeChildSession(childSessions.get(key) ?? bridge, optionalStringField(update, "reason") ?? "closed_by_parent");
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
  if (!isRecord(result)) return false;
  const details = isRecord(result["details"]) ? result["details"] : undefined;
  const updates = Array.isArray(details?.["childSessionUpdates"])
    ? details["childSessionUpdates"]
    : [];
  for (const update of updates) {
    if (isRecord(update)) await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
  }
  return updates.length > 0;
}
