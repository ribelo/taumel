import { readFile } from "node:fs/promises";

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
  parseToolParams,
  toolContracts,
  toolNames,
} from "./tool-contracts.ts";

import {
  applyChildActiveTools,
  childBridgeFacts,
  childSessionStartPlan,
  coreCall,
  execHostFacts,
  isRecord,
  modelRegistryFrom,
  numberField,
  optionalNumberField,
  optionalStringField,
  openAiCredentialRaw,
  openAiUsageTokenRaw,
  requiredError,
  sessionInfoFromContext,
  sessionInfoFromManager,
  stringArrayFromUnknown,
  stringField,
  threadSources,
  validateWorkspaceMutationPaths,
  writePatchFiles,
} from "./util.ts";
import { renderersForTool } from "./tool-renderer.ts";

function preparedToolResult(core: CoreBridge, prepared: Record<string, unknown>, extraDetails: Record<string, unknown> = {}) {
  const result = coreCall(core, "toolResultEnvelope", [{ prepared, extraDetails }]);
  if (!isRecord(result)) throw new Error("Invalid Taumel prepared tool result envelope");
  return result;
}

function errorToolResult(core: CoreBridge, text: string, details: unknown = undefined) {
  const result = coreCall(core, "toolResultEnvelope", [{
    error: text,
    ...(details !== undefined ? { details } : {}),
  }]);
  if (!isRecord(result)) throw new Error("Invalid Taumel error tool result envelope");
  return result;
}

function hostToolResult(core: CoreBridge, action: string, details: unknown): Record<string, unknown> {
  const result = coreCall(core, "hostToolResult", [{ action, details }]);
  if (!isRecord(result)) throw new Error("Invalid Taumel host tool result");
  return result;
}

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

function splitProviderModelId(modelId: string | undefined): { readonly provider: string; readonly model: string } | undefined {
  if (modelId === undefined) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1) return undefined;
  return { provider: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
}

function resolveChildModel(pi: PiLike, ctx: unknown, modelId: string | undefined): { readonly model?: unknown; readonly applied: boolean } {
  const registry = modelRegistryFrom(pi, ctx);
  const requested = splitProviderModelId(modelId);
  if (requested !== undefined && isRecord(registry) && typeof registry["find"] === "function") {
    const model = registry["find"].call(registry, requested.provider, requested.model);
    if (model !== undefined && model !== null) {
      return { model, applied: true };
    }
  }
  if (modelId !== undefined) {
    return { applied: false };
  }
  const inherited = currentModelFromContext(ctx);
  return inherited === undefined || inherited === null ? { applied: false } : { model: inherited, applied: true };
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

async function withGoalClockPaused<T>(core: CoreBridge, run: () => Promise<T>): Promise<T> {
  coreCall(core, "goalClockPauseStart", []);
  try {
    return await run();
  } finally {
    coreCall(core, "goalClockPauseEnd", []);
  }
}

type ApprovalOutcome =
  | "approved"
  | "denied_by_user"
  | "timed_out"
  | "unavailable"
  | "interrupted";

function approvalOutcomeMessage(action: string, outcome: ApprovalOutcome): string {
  switch (outcome) {
    case "denied_by_user":
      return `Error: ${action} approval denied by user`;
    case "timed_out":
      return `Error: ${action} approval timed out`;
    case "unavailable":
      return `Error: ${action} approval unavailable`;
    case "interrupted":
      return `Error: ${action} approval interrupted`;
    case "approved":
      return "";
  }
}

function mutationApprovalDenied(core: CoreBridge, action: string, outcome: ApprovalOutcome): Record<string, unknown> {
  return errorToolResult(core, approvalOutcomeMessage(action, outcome), {
    ok: false,
    approvalRequired: true,
    approvalOutcome: outcome,
  });
}

function childSessionMetadataFromContext(ctx: unknown): Record<string, unknown> | undefined {
  if (!isRecord(ctx) || !isRecord(ctx["sessionManager"])) return undefined;
  const getEntries = ctx["sessionManager"]["getEntries"];
  if (typeof getEntries !== "function") return undefined;
  try {
    const entries = getEntries.call(ctx["sessionManager"]);
    if (!Array.isArray(entries)) return undefined;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== "taumel.childSession") {
        continue;
      }
      return isRecord(entry["data"]) ? entry["data"] : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function approvalRequesterLabel(ctx: unknown): string | undefined {
  const metadata = childSessionMetadataFromContext(ctx);
  if (metadata === undefined || metadata["kind"] !== "agent") return undefined;
  const workerId = typeof metadata["workerId"] === "string" ? metadata["workerId"].trim() : "";
  const profile =
    typeof metadata["profileName"] === "string" ? metadata["profileName"].trim() :
    typeof metadata["definitionName"] === "string" ? metadata["definitionName"].trim() :
    "";
  if (workerId === "" && profile === "") return undefined;
  if (workerId === "") return `agent profile ${profile}`;
  if (profile === "") return `agent ${workerId}`;
  return `agent ${workerId} (${profile})`;
}

function openAiUsageHostAuth(core: CoreBridge): Record<string, unknown> {
  const auth = coreCall(core, "openAiUsageHostAuth");
  if (!isRecord(auth)) {
    throw new Error("Invalid Taumel OpenAI usage auth plan");
  }
  return auth;
}

function openAiUsageHostParams(core: CoreBridge, params: Record<string, unknown>): Record<string, unknown> {
  const planned = coreCall(core, "openAiUsageHostParams", [params]);
  if (!isRecord(planned) || planned["ok"] !== true || !isRecord(planned["params"])) {
    throw new Error("Invalid Taumel OpenAI usage host params");
  }
  return planned["params"];
}

async function executeOpenAiUsageInCore(
  core: CoreBridge,
  ctx: unknown,
  params: Record<string, unknown>,
) {
  const rendered = await coreCall(core, "executeOpenAiUsage", [params, ctx]);
  if (!isRecord(rendered)) {
    throw new Error("Invalid OpenAI usage result");
  }
  if (rendered["ok"] !== true) {
    return errorToolResult(core, requiredError(rendered, "OpenAI usage"), rendered);
  }
  return preparedToolResult(core, rendered);
}

async function executeExaInCore(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
) {
  const rendered = await coreCall(core, "executeExa", [prepared, ctx]);
  if (!isRecord(rendered)) {
    throw new Error("Invalid Exa result");
  }
  if (rendered["ok"] !== true) {
    return errorToolResult(core, requiredError(rendered, "Exa"), rendered);
  }
  return preparedToolResult(core, rendered);
}

export async function executeOpenAiUsageWithHostAuth(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
) {
  const apiKeyPresent = prepared["apiKeyPresent"] === true;
  const registry = modelRegistryFrom(pi, ctx);
  const auth = openAiUsageHostAuth(core);
  const providerKey = stringField(auth, "providerKey");
  const credentialKey = stringField(auth, "credentialKey");
  const credential = openAiCredentialRaw(registry, credentialKey);
  let tokenFacts: Record<string, unknown>;

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

async function runPreparedExec(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
  signal: AbortSignal | undefined,
  forceUnsandboxed = false,
) {
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  const result = await coreCall(core, "runExecCommand", [
    prepared,
    execHostFacts(core, prepared),
    {
      defaultCwd: process.cwd(),
      envShell: process.env.SHELL ?? "",
    },
    ownerId,
    signal ?? null,
    forceUnsandboxed,
  ]);
  if (!isRecord(result)) throw new Error("Invalid Taumel exec_command result");
  return result;
}

async function writePreparedStdin(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
) {
  const result = await coreCall(core, "writeExecStdin", [
    prepared,
    sessionInfoFromContext(ctx).sessionId ?? "current",
  ]);
  if (!isRecord(result)) throw new Error("Invalid Taumel write_stdin result");
  return result;
}

async function confirmExecApproval(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
  signal?: AbortSignal,
): Promise<ApprovalOutcome> {
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : {};
  const confirm = ui["confirm"];
  const plan = coreCall(core, "planExecApprovalPrompt", [prepared, {
    uiAvailable: typeof confirm === "function",
  }]);
  if (!isRecord(plan)) throw new Error("Invalid Taumel exec approval prompt plan");
  const action = stringField(plan, "action");
  if (action === "unavailable") {
    return "unavailable";
  }
  if (action !== "confirm" || typeof confirm !== "function") {
    throw new Error("Invalid Taumel exec approval prompt plan");
  }
  if (signal?.aborted === true) return "interrupted";

  const options = isRecord(plan["options"]) ? plan["options"] : {};
  const timeoutMs = optionalNumberField(options, "timeout");
  const controller = new AbortController();
  let outcome: ApprovalOutcome | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      outcome = "timed_out";
      controller.abort();
    }, timeoutMs);
  }

  if (signal !== undefined) {
    const abort = () => {
      if (outcome === undefined) outcome = "interrupted";
      controller.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", abort);
  }

  const confirmOptions: Record<string, unknown> = {
    ...options,
    signal: controller.signal,
  };
  delete confirmOptions["timeout"];

  try {
    const requester = approvalRequesterLabel(ctx);
    const title =
      requester === undefined
        ? stringField(plan, "title")
        : `${stringField(plan, "title")} - ${requester}`;
    const prompt =
      requester === undefined
        ? stringField(plan, "prompt")
        : `Requesting ${requester}\n\n${stringField(plan, "prompt")}`;
    const approved = await withGoalClockPaused(core, async () =>
      await confirm.call(
        ui,
        title,
        prompt,
        confirmOptions,
      )
    );
    if (approved === true) return "approved";
    if (controller.signal.aborted) return outcome ?? "interrupted";
    return "denied_by_user";
  } catch (error) {
    if (controller.signal.aborted) return outcome ?? "interrupted";
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeAbortListener?.();
  }
}

async function validatePreparedMutationPath(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  paths: readonly string[],
): Promise<string | undefined> {
  const validateWorkspacePaths = prepared["validateWorkspacePaths"] !== false;
  if (!validateWorkspacePaths) return undefined;
  const workspaceRoots = stringArrayFromUnknown(prepared["workspaceRoots"]) ?? [];
  try {
    await validateWorkspaceMutationPaths(core, paths, workspaceRoots);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
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
  const cwd = cwdFromContext(ctx);
  const model = resolveChildModel(pi, ctx, modelId);
  const systemPrompt = agentSystemPromptFromMetadata(metadata);
  const sessionManager = SessionManager.inMemory(cwd);
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
    const setupInfo = appendSetupEntries(childSessionManager, setupEntries);
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
      modelId,
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
  const plan = coreCall(core, "planChildDispatch", [{
    ...childBridgeFacts(child),
    prompt,
    emptyReason,
    sendAvailable: childSendAvailable || hostSendAvailable,
    deliverAs: options.deliverAs ?? "",
  }]);
  if (!isRecord(plan)) {
    throw new Error("Invalid Taumel child dispatch plan");
  }
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
    if (!awaitCompletion) {
      return completeLater(() => childCtx["sendUserMessage"].call(childCtx, dispatchPrompt, sendOptions));
    }
    const hostResult = await childCtx["sendUserMessage"].call(childCtx, dispatchPrompt, sendOptions);
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

function sessionEntriesFromManager(sessionManager: unknown): unknown[] {
  if (!isRecord(sessionManager) || typeof sessionManager["getEntries"] !== "function") return [];
  try {
    const entries = sessionManager["getEntries"].call(sessionManager);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function customEntryData(entry: unknown, customType: string): unknown {
  if (!isRecord(entry)) return undefined;
  if (entry["customType"] === customType) return entry["data"];
  if (entry["type"] === customType) return entry["value"];
  if (entry["type"] === "custom" && entry["customType"] === customType) return entry["data"];
  return undefined;
}

function latestChildCustomEntry(bridge: ChildSessionBridge | undefined, customType: string): unknown {
  const entries = sessionEntriesFromManager(bridge?.sessionManager);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const data = customEntryData(entries[index], customType);
    if (data !== undefined) return data;
  }
  return undefined;
}

function latestChildGoalStatus(bridge: ChildSessionBridge | undefined): string | undefined {
  const goal = latestChildCustomEntry(bridge, "taumel.goal");
  if (!isRecord(goal)) return undefined;
  return typeof goal["status"] === "string" ? goal["status"] : undefined;
}

function isSpawnedObjectiveCompletion(prepared: Record<string, unknown>): boolean {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  return optionalStringField(details, "runInitialSubmissionKind") === "objective";
}

function completionStatus(completion: Record<string, unknown>): string {
  return typeof completion["status"] === "string" && completion["status"] !== ""
    ? completion["status"]
    : "completed";
}

function completionFinalOutput(completion: Record<string, unknown>): string | undefined {
  return typeof completion["finalOutput"] === "string" ? completion["finalOutput"] : undefined;
}

function withSpawnGoalStatus(
  prepared: Record<string, unknown>,
  bridge: ChildSessionBridge | undefined,
  completion: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isSpawnedObjectiveCompletion(prepared)) return completion;
  if (completionStatus(completion) !== "completed") return completion;
  const goalStatus = latestChildGoalStatus(bridge);
  if (goalStatus === "complete") return { ...completion, status: "completed" };
  if (goalStatus === "blocked") {
    return { ...completion, status: "failed", reason: "goal_blocked" };
  }
  if (goalStatus === undefined) return completion;
  return undefined;
}

const TOO_BRIEF_AGENT_HANDOFF_PROMPT = `Your previous response was too brief. Please provide a more comprehensive summary that includes:

1. Specific technical details and implementations
2. Detailed findings and analysis
3. All important information that the parent agent should know`;

async function expandTooBriefSpawnCompletion(
  pi: PiLike,
  core: CoreBridge,
  bridge: ChildSessionBridge | undefined,
  prepared: Record<string, unknown>,
  completion: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isSpawnedObjectiveCompletion(prepared) || completionStatus(completion) !== "completed") {
    return completion;
  }
  const output = completionFinalOutput(completion) ?? "";
  if (output.trim().length >= 200) return completion;
  if (bridge === undefined) return completion;
  const dispatch = await sendToChildSession(
    pi,
    core,
    bridge,
    TOO_BRIEF_AGENT_HANDOFF_PROMPT,
    "too-brief follow-up prompt missing",
    { awaitCompletion: true },
  );
  const followup = isRecord(dispatch["completion"]) ? dispatch["completion"] : undefined;
  const finalOutput = followup === undefined ? undefined : completionFinalOutput(followup);
  return finalOutput === undefined ? completion : { ...completion, finalOutput };
}

async function prepareAgentCompletionForRecording(
  pi: PiLike,
  core: CoreBridge,
  bridge: ChildSessionBridge | undefined,
  prepared: Record<string, unknown>,
  completion: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const goalAdjusted = withSpawnGoalStatus(prepared, bridge, completion);
  if (goalAdjusted === undefined) return undefined;
  return expandTooBriefSpawnCompletion(pi, core, bridge, prepared, goalAdjusted);
}

type NotificationDeliveryMode = "steer" | "trigger";

// Deliver one queued completion as a taumel.notification custom message.
// 'trigger' wakes a fresh turn (parent idle); 'steer' injects at the start of
// the next turn (parent mid-turn / turn_end). A notification is inherently a
// custom message (it carries customType/display/details for the renderer), so
// we require pi.sendMessage; if it is unavailable we report not-sent and leave
// the run pending for a later flush rather than delivering a render-less blob.
async function deliverNotificationMessage(
  pi: PiLike,
  content: string,
  customType: string,
  display: boolean,
  mode: NotificationDeliveryMode,
): Promise<boolean> {
  if (typeof pi.sendMessage !== "function") return false;
  await pi.sendMessage(
    { customType, content, display },
    mode === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" },
  );
  return true;
}

function recordAgentBackgroundNotification(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
): void {
  const result = coreCall(core, "recordAgentBackgroundNotification", [{ prepared }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    throw new Error("Invalid Taumel agent background notification update");
  }
}

// Flush Taumel's notification queue: deliver every pending, unconsumed,
// undelivered terminal run owned by this parent session, then mark each
// delivered. "steer" is used on turn_end (injected at the start of the next
// turn); "trigger" is used when the parent is idle (wakes a turn). A run with an
// active agent_wait pending is skipped so the wait takes first claim.
async function flushPendingAgentNotifications(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  mode: NotificationDeliveryMode,
  pendingAgentWaits: PendingAgentWaits,
): Promise<void> {
  const result = coreCall(core, "pendingAgentNotifications", [ctx]);
  if (!isRecord(result)) return;
  const notifications = Array.isArray(result["notifications"]) ? result["notifications"] : [];
  for (const notification of notifications) {
    if (!isRecord(notification)) continue;
    const runId = stringField(notification, "run_id");
    if (runId !== "" && pendingAgentWaits.has(pendingAgentWaitKey(ctx, runId))) continue;
    const sent = await deliverNotificationMessage(
      pi,
      stringField(notification, "content"),
      stringField(notification, "customType"),
      notification["display"] === true,
      mode,
    );
    if (sent && runId !== "") {
      recordAgentBackgroundNotification(core, { run_id: runId }, ctx);
    }
  }
}

function parentIsIdle(pi: PiLike): boolean {
  return typeof pi.isIdle === "function" ? pi.isIdle() : true;
}

// Called after a terminal completion is recorded. If the parent is idle there is
// no turn_end coming and no agent_wait can run, so deliver now via a triggerTurn
// flush. If the parent is mid-turn, leave the run pending; the turn_end flush
// (steer) will deliver it before the next assistant response.
async function deliverCompletionIfParentIdle(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
): Promise<void> {
  if (!parentIsIdle(pi)) return;
  await flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits);
}

async function recordAgentDispatchCompletion(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  dispatch: Record<string, unknown>,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
  bridge?: ChildSessionBridge,
): Promise<void> {
  const completion = dispatch["completion"];
  if (!isRecord(completion)) {
    return;
  }
  const preparedCompletion = await prepareAgentCompletionForRecording(
    pi,
    core,
    bridge,
    prepared,
    completion,
  );
  if (preparedCompletion === undefined) {
    return;
  }
  const result = coreCall(core, "recordAgentDispatchCompletion", [{
    prepared,
    completion: preparedCompletion,
  }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    throw new Error("Invalid Taumel agent completion update");
  }
  if (result["notify"] === true) {
    await deliverCompletionIfParentIdle(pi, core, ctx, pendingAgentWaits);
  }
}

function recordAgentChildSessionStart(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  bridge: ChildSessionBridge | undefined,
  ctx: unknown,
): void {
  const result = coreCall(core, "recordAgentChildSessionStart", [{
    prepared,
    bridge: childBridgeFacts(bridge),
  }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    throw new Error("Invalid Taumel agent child session update");
  }
}

function recordAgentActiveToolsSnapshot(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  activeTools: readonly string[],
  ctx: unknown,
): void {
  const result = coreCall(core, "recordAgentActiveToolsSnapshot", [{
    prepared,
    activeTools: [...activeTools],
  }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    throw new Error("Invalid Taumel agent active tools snapshot update");
  }
}

function recordAgentDispatchCompletionInBackground(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
  bridge?: ChildSessionBridge,
): (dispatch: Record<string, unknown>) => void {
  return (dispatch) => {
    void recordAgentDispatchCompletion(pi, core, prepared, dispatch, ctx, pendingAgentWaits, bridge).catch((error) => {
      // Background completion must not crash the parent turn; persistent run state
      // will be reconciled by later wait/list commands if this notification fails.
      console.warn("Taumel agent completion recording failed:", error);
    });
  };
}

function completionStopReason(completion: Record<string, unknown> | undefined): string {
  if (completion === undefined) return "";
  if (completionStatus(completion) === "completed") return "";
  return typeof completion["reason"] === "string" ? completion["reason"] : "";
}

// Records an already-resolved goal-mode terminal completion directly, bypassing
// withSpawnGoalStatus (the continuation loop has already decided the terminal
// status from child goal state), then delivers/notifies like the normal path.
async function recordAndDeliverChildGoalCompletion(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  completion: Record<string, unknown>,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
): Promise<void> {
  const result = coreCall(core, "recordAgentDispatchCompletion", [{ prepared, completion }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    throw new Error("Invalid Taumel agent completion update");
  }
  if (result["notify"] === true) {
    await deliverCompletionIfParentIdle(pi, core, ctx, pendingAgentWaits);
  }
}

// Drives the spawned goal-mode continuation loop. Runs in the background after
// agent_spawn returns. Starting from the first child turn's completion, it asks
// OCaml planChildGoalContinuation per step: send the next continuation prompt
// into the same child session until the goal is complete/blocked or the
// continuation cap is hit, then record the terminal run exactly once.
async function runChildGoalContinuationLoop(
  pi: PiLike,
  core: CoreBridge,
  bridge: ChildSessionBridge | undefined,
  prepared: Record<string, unknown>,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
  firstDispatch: Record<string, unknown>,
): Promise<void> {
  let dispatch = firstDispatch;
  let iterations = 0;
  for (;;) {
    const lastCompletion = isRecord(dispatch["completion"]) ? dispatch["completion"] : undefined;
    const plan = coreCall(core, "planChildGoalContinuation", [{
      goal: latestChildCustomEntry(bridge, "taumel.goal") ?? null,
      automation: latestChildCustomEntry(bridge, "taumel.goal_automation") ?? null,
      iterations,
      maxIterations: 0,
      latestAssistantStopReason: completionStopReason(lastCompletion),
    }]);
    if (!isRecord(plan)) throw new Error("Invalid Taumel child goal continuation plan");
    if (stringField(plan, "action") === "send_goal_continuation") {
      iterations += 1;
      dispatch = await sendToChildSession(pi, core, bridge, stringField(plan, "content"), "goal continuation prompt", {
        awaitCompletion: true,
        deliverAs: stringField(plan, "deliverAs"),
      });
      continue;
    }
    const finalStatus = stringField(plan, "status") || "completed";
    const finalReason = optionalStringField(plan, "reason");
    const finalOutput = lastCompletion !== undefined ? completionFinalOutput(lastCompletion) : undefined;
    let completion: Record<string, unknown> = {
      status: finalStatus,
      ...(finalOutput !== undefined ? { finalOutput } : {}),
      ...(finalReason !== undefined ? { reason: finalReason } : {}),
    };
    if (finalStatus === "completed") {
      completion = await expandTooBriefSpawnCompletion(pi, core, bridge, prepared, completion);
    }
    await recordAndDeliverChildGoalCompletion(pi, core, prepared, completion, ctx, pendingAgentWaits);
    return;
  }
}

function startChildGoalContinuationLoop(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
  bridge?: ChildSessionBridge,
): (dispatch: Record<string, unknown>) => void {
  return (dispatch) => {
    void runChildGoalContinuationLoop(pi, core, bridge, prepared, ctx, pendingAgentWaits, dispatch).catch((error) => {
      console.warn("Taumel child goal continuation loop failed:", error);
    });
  };
}

export function childSessionCacheKeyScopeFromContext(ctx: unknown): string {
  if (isRecord(ctx) && typeof ctx["taumelSessionId"] === "string") {
    const value = ctx["taumelSessionId"].trim();
    if (value !== "") return value;
  }
  return sessionInfoFromContext(ctx).sessionId ?? "current";
}

function childSessionCacheKey(key: string, keyScope: string | undefined): string {
  return keyScope === undefined || keyScope === "" ? key : `${keyScope}\u0000${key}`;
}

async function createAgentChildSessionForPrepared(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  prepared: Record<string, unknown>,
  ctx: unknown,
): Promise<{ readonly workerId: string; readonly bridge: ChildSessionBridge | undefined; readonly prompt: string }> {
  const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
  const spawnPlan = coreCall(core, "planAgentSpawn", [{
    prepared,
    currentActiveToolsAvailable: currentActiveToolNames !== undefined,
    currentActiveTools: currentActiveToolNames ?? [],
  }]);
  if (!isRecord(spawnPlan)) throw new Error("Invalid Taumel agent spawn plan");
  if (spawnPlan["ok"] !== true) {
    throw new Error(requiredError(spawnPlan, "agent spawn plan"));
  }
  const workerId = stringField(spawnPlan, "workerId");
  const metadata = isRecord(spawnPlan["metadata"]) ? spawnPlan["metadata"] : {};
  const activeTools = stringArrayFromUnknown(metadata["activeTools"]);
  if (activeTools !== undefined) {
    recordAgentActiveToolsSnapshot(core, prepared, activeTools, ctx);
  }
  const bridge = await createChildSession(pi, core, ctx, metadata);
  await applyChildSessionUpdate(
    childSessions,
    coreCall(core, "planAgentBridgeUpdate", [{
      prepared,
      workerId,
      bridge: childBridgeFacts(bridge),
    }]),
    bridge,
    childSessionCacheKeyScopeFromContext(ctx),
  );
  recordAgentChildSessionStart(core, prepared, bridge, ctx);
  return { workerId, bridge, prompt: stringField(spawnPlan, "prompt") };
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

async function applyChildSessionUpdatesFromDetails(
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

function readInvocation(args: unknown[]) {
  const params =
    typeof args[0] === "string" && args.length > 1 ? args[1] : args[0];
  const signal = args.find((arg): arg is AbortSignal => isRecord(arg) && "aborted" in arg);
  const ctx =
    args.length >= 5
      ? args[4]
      : args.find((arg) => isRecord(arg) && ("cwd" in arg || "sessionManager" in arg));
  return { params, signal, ctx: ctx ?? {} };
}

function preparedAction(core: CoreBridge, name: string, params: unknown, ctx: unknown) {
  const prepared = coreCall(core, "prepareTool", [name, params, ctx]);
  if (!isRecord(prepared)) throw new Error("Invalid Taumel tool preparation result");
  return prepared;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function agentWaitHasActiveRuns(prepared: Record<string, unknown>): boolean {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  return details["hasActiveRuns"] === true;
}

function agentWaitPollParams(params: unknown, prepared: Record<string, unknown>): unknown {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  return isRecord(details["pollParams"]) ? details["pollParams"] : params;
}

function agentDeliveryKind(prepared: Record<string, unknown>): string {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  return stringField(details, "deliveryKind");
}

type PendingAgentWaits = Map<string, number>;

function agentWaitPendingRunIds(prepared: Record<string, unknown>): string[] {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  const pollParams = isRecord(details["pollParams"]) ? details["pollParams"] : undefined;
  return pollParams === undefined ? [] : stringArrayFromUnknown(pollParams["run_ids"]) ?? [];
}

function pendingAgentWaitKey(ctx: unknown, runId: string): string {
  return `${childSessionCacheKeyScopeFromContext(ctx)}\0${runId}`;
}

function addPendingAgentWaits(pending: PendingAgentWaits, ctx: unknown, runIds: readonly string[]): void {
  for (const runId of runIds) {
    const key = pendingAgentWaitKey(ctx, runId);
    pending.set(key, (pending.get(key) ?? 0) + 1);
  }
}

function removePendingAgentWaits(pending: PendingAgentWaits, ctx: unknown, runIds: readonly string[]): void {
  for (const runId of runIds) {
    const key = pendingAgentWaitKey(ctx, runId);
    const count = pending.get(key) ?? 0;
    if (count <= 1) pending.delete(key);
    else pending.set(key, count - 1);
  }
}

async function executeAgentWait(
  core: CoreBridge,
  params: unknown,
  ctx: unknown,
  signal: AbortSignal | undefined,
  initialPrepared: Record<string, unknown>,
  pendingAgentWaits: PendingAgentWaits,
): Promise<Record<string, unknown>> {
  const timeoutSeconds = isRecord(params) ? optionalNumberField(params, "timeout_seconds") : undefined;
  let prepared = initialPrepared;
  if (timeoutSeconds === 0 || !agentWaitHasActiveRuns(prepared)) {
    return preparedToolResult(core, prepared);
  }
  const pollParams = agentWaitPollParams(params, prepared);
  const pendingRunIds = agentWaitPendingRunIds(prepared);
  addPendingAgentWaits(pendingAgentWaits, ctx, pendingRunIds);

  const startedAt = Date.now();
  const deadline =
    timeoutSeconds !== undefined ? startedAt + Math.max(0, timeoutSeconds) * 1000 : undefined;

  try {
    while (agentWaitHasActiveRuns(prepared)) {
      if (signal?.aborted === true) {
        prepared = preparedAction(core, "agent_wait", pollParams, ctx);
        if (prepared["ok"] !== true) {
          return errorToolResult(core, requiredError(prepared, "tool preparation"), prepared);
        }
        if (!agentWaitHasActiveRuns(prepared)) return preparedToolResult(core, prepared);
        return preparedToolResult(core, prepared, {
          waitInterrupted: true,
          status: "interrupted",
        });
      }
      const now = Date.now();
      if (deadline !== undefined && now >= deadline) {
        prepared = preparedAction(core, "agent_wait", pollParams, ctx);
        if (prepared["ok"] !== true) {
          return errorToolResult(core, requiredError(prepared, "tool preparation"), prepared);
        }
        if (!agentWaitHasActiveRuns(prepared)) return preparedToolResult(core, prepared);
        return preparedToolResult(core, prepared, {
          waitTimedOut: true,
          status: "timed_out",
        });
      }
      const delay = Math.min(250, Math.max(10, (deadline ?? (now + 250)) - now));
      await sleep(delay);
      prepared = preparedAction(core, "agent_wait", pollParams, ctx);
      if (prepared["ok"] !== true) {
        return errorToolResult(core, requiredError(prepared, "tool preparation"), prepared);
      }
    }
    return preparedToolResult(core, prepared);
  } finally {
    removePendingAgentWaits(pendingAgentWaits, ctx, pendingRunIds);
  }
}

async function runThreadTool(core: CoreBridge, name: string, prepared: Record<string, unknown>, ctx: unknown) {
  const result = coreCall(core, "runThreadTool", [name, prepared, await threadSources(core, ctx), ctx]);
  if (!isRecord(result)) throw new Error("Invalid Taumel thread tool result");
  return result;
}

async function executeLegacyWrite(
  core: CoreBridge,
  prepared: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = stringField(prepared, "path");
  const displayPath = stringField(prepared, "displayPath") || path;
  const contents = stringField(prepared, "contents");
  if (path === "") throw new Error("Invalid Taumel write plan");
  const validationError = await validatePreparedMutationPath(core, prepared, [path]);
  if (validationError !== undefined) {
    return errorToolResult(core, validationError, { ok: false, error: validationError });
  }
  await writePatchFiles({ deletes: [], writes: [{ path, contents }] });
  return hostToolResult(core, "write", {
    ok: true,
    action: "write",
    path,
    displayPath,
    byteLength: contents.length,
  });
}

async function executeLegacyEdit(
  core: CoreBridge,
  prepared: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = stringField(prepared, "path");
  const displayPath = stringField(prepared, "displayPath") || path;
  if (path === "") throw new Error("Invalid Taumel edit plan");
  const validationError = await validatePreparedMutationPath(core, prepared, [path]);
  if (validationError !== undefined) {
    return errorToolResult(core, validationError, { ok: false, error: validationError });
  }
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const errorMessage = isRecord(error) && typeof error["code"] === "string"
      ? `Error code: ${error["code"]}`
      : String(error);
    return errorToolResult(core, `Could not edit file: ${displayPath}. ${errorMessage}.`, {
      ok: false,
      error: errorMessage,
    });
  }
  const application = coreCall(core, "applyEditToFile", [prepared, content]);
  if (!isRecord(application)) throw new Error("Invalid Taumel edit result");
  if (application["ok"] !== true) {
    return errorToolResult(core, requiredError(application, "edit"), application);
  }
  const nextContent = application["contents"];
  if (typeof nextContent !== "string") throw new Error("Invalid Taumel edit result");
  const editCount = numberField(application, "editCount");
  await writePatchFiles({ deletes: [], writes: [{ path, contents: nextContent }] });
  return hostToolResult(core, "edit", {
    ok: true,
    action: "edit",
    path,
    displayPath,
    editCount,
  });
}

async function executeApplyPatch(
  pi: PiLike,
  core: CoreBridge,
  name: string,
  rawParams: unknown,
  prepared: Record<string, unknown>,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  const files: Record<string, string> = {};
  const affectedPaths = stringArrayFromUnknown(prepared["affectedPaths"]);
  if (affectedPaths === undefined) throw new Error("Invalid Taumel apply_patch plan");
  const readValidationError = await validatePreparedMutationPath(core, prepared, affectedPaths);
  if (readValidationError !== undefined) {
    return errorToolResult(core, readValidationError, { ok: false, error: readValidationError });
  }
  for (const path of affectedPaths) {
    try {
      files[path] = await readFile(path, "utf8");
    } catch (error) {
      if (!isRecord(error) || error["code"] !== "ENOENT") throw error;
    }
  }
  const application = coreCall(core, "applyPatchToFiles", [
    rawParams,
    files,
    ctx,
    { filesystemApproval: prepared["filesystemApproval"] === true },
  ]);
  if (!isRecord(application)) throw new Error("Invalid Taumel apply_patch result");
  if (application["ok"] !== true) {
    return errorToolResult(core, requiredError(application, "apply_patch"), application);
  }
  const deletes = stringArrayFromUnknown(application["deletes"]);
  const writes = application["writes"];
  if (!Array.isArray(writes) || !writes.every(isRecord)) {
    throw new Error("Invalid Taumel apply_patch result");
  }
  const writePaths = writes
    .map((write) => stringField(write, "path"))
    .filter((path) => path !== "");
  const writeValidationError = await validatePreparedMutationPath(core, prepared, [...(deletes ?? []), ...writePaths]);
  if (writeValidationError !== undefined) {
    return errorToolResult(core, writeValidationError, { ok: false, error: writeValidationError });
  }
  if (stringField(application, "action") !== "apply_patch") {
    throw new Error("Invalid Taumel apply_patch result");
  }
  await writePatchFiles(application);
  return hostToolResult(core, "apply_patch", application);
}

export async function executeTool(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  pendingAgentWaits: PendingAgentWaits,
  name: string,
  rawParams: unknown,
  ctx: unknown,
  signal?: AbortSignal,
) {
  const parsed = parseToolParams(name, rawParams);
  if (!parsed.ok) {
    return errorToolResult(core, parsed.error, { ok: false, error: parsed.error });
  }
  const prepared = preparedAction(core, name, parsed.params, ctx);
  if (prepared["ok"] !== true) {
    return errorToolResult(core, requiredError(prepared, "tool preparation"), prepared);
  }
  if (name === "agent_wait") {
    return executeAgentWait(core, parsed.params, ctx, signal, prepared, pendingAgentWaits);
  }

  const action = stringField(prepared, "action");
  switch (action) {
    case "tool_result":
      return preparedToolResult(core, prepared);
    case "openai_usage_fetch":
      return executeOpenAiUsageWithHostAuth(pi, core, prepared, ctx);
    case "exa_fetch":
      return executeExaInCore(core, prepared, ctx);
    case "exa_agent_create_run_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      if (outcome !== "approved") {
        return mutationApprovalDenied(core, "exa_agent_create_run", outcome);
      }
      return executeExaInCore(core, prepared, ctx);
    }
    case "agent_spawn": {
      const { bridge, prompt } = await createAgentChildSessionForPrepared(
        pi,
        core,
        childSessions,
        prepared,
        ctx,
      );
      const goalMode = isSpawnedObjectiveCompletion(prepared);
      const onCompletion = goalMode
        ? startChildGoalContinuationLoop(pi, core, prepared, ctx, pendingAgentWaits, bridge)
        : recordAgentDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits, bridge);
      const dispatch = await sendToChildSession(pi, core, bridge, prompt, "no initial prompt", {
        awaitCompletion: false,
        onCompletion,
      });
      const result = coreCall(core, "finishAgentAction", [{
        prepared,
        bridge: childBridgeFacts(bridge),
        dispatch,
      }, ctx]);
      if (!isRecord(result)) throw new Error("Invalid Taumel agent result");
      return result;
    }
    case "agent_send": {
      const workerId = stringField(prepared, "workerId");
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      await applyChildSessionUpdatesFromDetails(childSessions, prepared, keyScope);
      const deliveryKind = agentDeliveryKind(prepared);
      if (
        (deliveryKind === "suspended" || deliveryKind === "no_active_run") &&
        stringField(prepared, "prompt") === ""
      ) {
        return preparedToolResult(core, prepared);
      }
      let bridge = childSessions.get(childSessionCacheKey(workerId, keyScope));
      if (bridge === undefined) {
        bridge = (
          await createAgentChildSessionForPrepared(
            pi,
            core,
            childSessions,
            prepared,
            ctx,
          )
        ).bridge;
      }
      const dispatch = await sendToChildSession(
        pi,
        core,
        bridge,
        stringField(prepared, "prompt"),
        "empty prompt",
        {
          awaitCompletion: false,
          deliverAs: optionalStringField(prepared, "dispatchDeliverAs") ?? "",
          onCompletion: recordAgentDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits, bridge),
        },
      );
      const result = coreCall(core, "finishAgentAction", [{ prepared, dispatch }, ctx]);
      if (!isRecord(result)) throw new Error("Invalid Taumel agent result");
      return result;
    }
    case "agent_wait":
      return preparedToolResult(core, prepared);
    case "agent_close": {
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      const applied = await applyChildSessionUpdatesFromDetails(childSessions, prepared, keyScope);
      if (!applied) {
        await applyChildSessionUpdate(
          childSessions,
          coreCall(core, "planAgentBridgeUpdate", [{ prepared }]),
          undefined,
          keyScope,
        );
      }
      return preparedToolResult(core, prepared);
    }
    case "find_thread":
    case "read_thread": {
      const result = await runThreadTool(core, name, prepared, ctx);
      return result;
    }
    case "exec_command":
      return runPreparedExec(core, prepared, ctx, signal);
    case "exec_command_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      const approvalPlan = coreCall(core, "finishExecApproval", [{
        prepared,
        outcome,
      }]);
      if (!isRecord(approvalPlan)) throw new Error("Invalid Taumel exec approval result");
      if (stringField(approvalPlan, "action") === "result") {
        const result = approvalPlan["result"];
        if (!isRecord(result)) throw new Error("Invalid Taumel exec approval result");
        return result;
      }
      if (stringField(approvalPlan, "action") !== "exec_command") {
        throw new Error("Invalid Taumel exec approval result");
      }
      return runPreparedExec(core, prepared, ctx, signal, approvalPlan["forceUnsandboxed"] === true);
    }
    case "write_stdin":
      return writePreparedStdin(core, prepared, ctx);
    case "write_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      if (outcome !== "approved") {
        return mutationApprovalDenied(core, "write", outcome);
      }
      return executeLegacyWrite(core, {
        ...prepared,
        action: "write",
        filesystemApproval: true,
        validateWorkspacePaths: false,
      });
    }
    case "edit_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      if (outcome !== "approved") {
        return mutationApprovalDenied(core, "edit", outcome);
      }
      return executeLegacyEdit(core, {
        ...prepared,
        action: "edit",
        filesystemApproval: true,
        validateWorkspacePaths: false,
      });
    }
    case "apply_patch_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      if (outcome !== "approved") {
        return mutationApprovalDenied(core, "apply_patch", outcome);
      }
      return executeApplyPatch(pi, core, name, parsed.params, {
        ...prepared,
        action: "apply_patch",
        filesystemApproval: true,
        validateWorkspacePaths: false,
      }, ctx);
    }
    case "write":
      return executeLegacyWrite(core, prepared);
    case "edit":
      return executeLegacyEdit(core, prepared);
    case "apply_patch":
      return executeApplyPatch(pi, core, name, parsed.params, prepared, ctx);
    default:
      throw new Error(`${name} is registered by Taumel, but its executor is not connected yet.`);
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertToolCatalogMatchesCore(core: CoreBridge): void {
  const coreToolNames = stringArrayFromUnknown(coreCall(core, "toolPolicyNames"));
  if (coreToolNames === undefined) throw new Error("Invalid Taumel tool policy names");
  const expected = sorted(toolNames);
  const actual = sorted(coreToolNames);
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new Error(`Taumel tool catalog drift: TS=[${expected.join(", ")}] OCaml=[${actual.join(", ")}]`);
  }
}

export const agentGatewayToolNames = [
  "agent_spawn",
  "agent_send",
  "agent_wait",
  "agent_list",
  "agent_close",
  "agent_profiles",
] as const;

const agentGatewayToolNameSet = new Set<string>(agentGatewayToolNames);

export type GatewayToolRegistration = {
  readonly registerAgentTools: () => void;
};

export function registerGatewayTools(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
): GatewayToolRegistration {
  if (typeof pi.registerTool !== "function") {
    return { registerAgentTools: () => undefined };
  }
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined) coreCall(core, "shutdownExecOwner", [ownerId]);
  });
  assertToolCatalogMatchesCore(core);
  const allowedToolNames = stringArrayFromUnknown(coreCall(core, "allowedToolNames"));
  if (allowedToolNames === undefined) throw new Error("Invalid Taumel allowed tool names");
  const allowed = new Set(allowedToolNames);
  const registered = new Set<string>();
  const pendingAgentWaits: PendingAgentWaits = new Map();
  // turn_end: flush pending child completions via steering, injected at the start
  // of the next parent turn (before the assistant response).
  //
  // agent_end: the loop is ending. We must NOT trigger synchronously here: Pi
  // keeps isStreaming === true throughout the agent_end emit and only clears it
  // in finishRun() after listeners settle, so a synchronous triggerTurn would be
  // routed to steer() on a loop that's already terminating and never drained.
  // Deferring to a macrotask runs after finishRun(), when the parent is idle and
  // triggerTurn starts a fresh turn. (queueMicrotask runs too early; nextTurn
  // could defer indefinitely.)
  pi.on("turn_end", async (_event, ctx) => {
    try {
      await flushPendingAgentNotifications(pi, core, ctx, "steer", pendingAgentWaits);
    } catch (error) {
      console.warn("Taumel agent turn_end notification flush failed:", error);
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    setTimeout(() => {
      void flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits).catch((error) => {
        console.warn("Taumel agent agent_end notification flush failed:", error);
      });
    }, 0);
  });
  const registerMatching = (agentTools: boolean) => {
    for (const spec of toolContracts) {
      const name = spec.name;
      if (!allowed.has(name) || registered.has(name)) continue;
      if (agentGatewayToolNameSet.has(name) !== agentTools) continue;
      pi.registerTool({
        name,
        label: spec.label,
        description: spec.description,
        promptSnippet: spec.promptSnippet,
        promptGuidelines: spec.promptGuidelines ?? [],
        parameters: spec.parameters,
        ...renderersForTool(name),
        execute: async (...args) => {
          const { params, signal, ctx } = readInvocation(args);
          return executeTool(pi, core, childSessions, pendingAgentWaits, name, params, ctx, signal);
        },
      });
      registered.add(name);
    }
  };
  registerMatching(false);
  return { registerAgentTools: () => registerMatching(true) };
}
