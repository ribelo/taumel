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
  if (finalOutput === undefined) return undefined;
  const stopReason = isRecord(assistant) && typeof assistant["stopReason"] === "string" ? assistant["stopReason"] : "";
  const errorMessage = isRecord(assistant) && typeof assistant["errorMessage"] === "string" ? assistant["errorMessage"] : undefined;
  const status =
    errorMessage !== undefined || stopReason === "error" ? "failed" :
    stopReason === "cancelled" || stopReason === "aborted" ? "cancelled" :
    "completed";
  return {
    status,
    finalOutput,
    ...(errorMessage !== undefined ? { reason: errorMessage } : {}),
  };
}

async function sendToSdkAgentSession(session: unknown, prompt: string, options: Record<string, unknown>): Promise<unknown> {
  if (!isRecord(session)) return undefined;
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
    const setupInfo = appendSetupEntries(session["sessionManager"] ?? sessionManager, setupEntries);
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
    readonly deliverAs?: "followUp" | "steer";
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
  }]);
  if (!isRecord(plan)) {
    throw new Error("Invalid Taumel child dispatch plan");
  }
  const result = isRecord(plan["result"]) ? plan["result"] : undefined;
  if (result === undefined) throw new Error("Invalid Taumel child dispatch result");
  if (plan["send"] !== true) return result;

  const dispatchPrompt = stringField(plan, "prompt");
  const deliverAs = options.deliverAs ?? stringField(plan, "deliverAs");
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
  if (!isRecord(hostResult)) return undefined;
  const finalOutput =
    typeof hostResult["finalOutput"] === "string" ? hostResult["finalOutput"] :
    typeof hostResult["output"] === "string" ? hostResult["output"] :
    typeof hostResult["result"] === "string" ? hostResult["result"] :
    completionTextFromContent(hostResult["content"]);
  if (finalOutput === undefined || finalOutput.trim() === "") return undefined;
  const rawStatus = typeof hostResult["status"] === "string" ? hostResult["status"] : "";
  const status = rawStatus === "failed" || hostResult["isError"] === true ? "failed" :
    rawStatus === "cancelled" || rawStatus === "aborted" ? "cancelled" :
    rawStatus === "timed_out" ? "timed_out" :
    "completed";
  const reason =
    typeof hostResult["reason"] === "string" ? hostResult["reason"] :
    typeof hostResult["error"] === "string" ? hostResult["error"] :
    typeof hostResult["stopReason"] === "string" ? hostResult["stopReason"] :
    undefined;
  return {
    status,
    finalOutput,
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

async function deliverAgentCompletion(
  pi: PiLike,
  result: Record<string, unknown>,
): Promise<void> {
  if (result["notify"] !== true) return;
  const content = stringField(result, "content");
  const deliverAs = stringField(result, "deliverAs");
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({
      customType: stringField(result, "customType"),
      content,
      display: result["display"] === true,
    }, {
      triggerTurn: result["triggerTurn"] === true,
      deliverAs,
    });
    return;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(content, { deliverAs });
  }
}

async function recordAgentDispatchCompletion(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  dispatch: Record<string, unknown>,
  ctx: unknown,
): Promise<void> {
  const completion = dispatch["completion"];
  if (!isRecord(completion)) return;
  const result = coreCall(core, "recordAgentDispatchCompletion", [{
    prepared,
    completion,
  }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    throw new Error("Invalid Taumel agent completion update");
  }
  await deliverAgentCompletion(pi, result);
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

function preparedInterruptedActiveRun(prepared: Record<string, unknown>): boolean {
  const details = isRecord(prepared["details"]) ? prepared["details"] : undefined;
  return typeof details?.["previousRunStatus"] === "string" &&
    details["previousRunStatus"] !== "" &&
    details["deliveryKind"] === "started";
}

function preparedDeliveryKind(prepared: Record<string, unknown>): string {
  const details = isRecord(prepared["details"]) ? prepared["details"] : undefined;
  return typeof details?.["deliveryKind"] === "string" ? details["deliveryKind"] : "";
}

function recordAgentDispatchCompletionInBackground(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
): (dispatch: Record<string, unknown>) => void {
  return (dispatch) => {
    void recordAgentDispatchCompletion(pi, core, prepared, dispatch, ctx).catch((error) => {
      // Background completion must not crash the parent turn; persistent run state
      // will be reconciled by later wait/list commands if this notification fails.
      console.warn("Taumel agent completion recording failed:", error);
    });
  };
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
  const bridge = await createChildSession(pi, core, ctx, metadata);
  await applyChildSessionUpdate(
    childSessions,
    coreCall(core, "planAgentBridgeUpdate", [{
      prepared,
      workerId,
      bridge: childBridgeFacts(bridge),
    }]),
    bridge,
  );
  recordAgentChildSessionStart(core, prepared, bridge, ctx);
  return { workerId, bridge, prompt: stringField(spawnPlan, "prompt") };
}

export async function applyChildSessionUpdate(
  childSessions: Map<string, ChildSessionBridge>,
  update: unknown,
  bridge: ChildSessionBridge | undefined,
): Promise<void> {
  if (!isRecord(update)) throw new Error("Invalid Taumel child session update");
  switch (stringField(update, "action")) {
    case "none":
      return;
    case "store_child_session": {
      const key = stringField(update, "key");
      if (key === "" || !bridge) throw new Error("Invalid Taumel child session update");
      childSessions.set(key, bridge);
      return;
    }
    case "stop_child_session": {
      const key = stringField(update, "key");
      if (key === "") throw new Error("Invalid Taumel child session update");
      await stopChildSession(childSessions.get(key) ?? bridge, optionalStringField(update, "reason") ?? "stopped_by_parent");
      return;
    }
    case "delete_child_session": {
      const key = stringField(update, "key");
      if (key === "") throw new Error("Invalid Taumel child session update");
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
): Promise<boolean> {
  if (!isRecord(result)) return false;
  const details = isRecord(result["details"]) ? result["details"] : undefined;
  const updates = Array.isArray(details?.["childSessionUpdates"])
    ? details["childSessionUpdates"]
    : [];
  for (const update of updates) {
    if (isRecord(update)) await applyChildSessionUpdate(childSessions, update, undefined);
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

const activeAgentRunStatuses = new Set(["queued", "running", "suspended"]);

function agentWaitHasActiveRuns(prepared: Record<string, unknown>): boolean {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  const runs = Array.isArray(details["runs"]) ? details["runs"] : [];
  return runs.some((run) =>
    isRecord(run) &&
    typeof run["status"] === "string" &&
    activeAgentRunStatuses.has(run["status"])
  );
}

function preparedActiveRunIds(prepared: Record<string, unknown>): string[] {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  const runs = Array.isArray(details["runs"]) ? details["runs"] : [];
  const runIds: string[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    if (!isRecord(run)) continue;
    const runId = stringField(run, "run_id");
    const status = stringField(run, "status");
    if (runId === "" || !activeAgentRunStatuses.has(status) || seen.has(runId)) continue;
    seen.add(runId);
    runIds.push(runId);
  }
  return runIds;
}

function pinnedAgentWaitParams(params: unknown, prepared: Record<string, unknown>): unknown {
  if (isRecord(params) && Array.isArray(params["run_ids"])) return params;
  const runIds = preparedActiveRunIds(prepared);
  if (runIds.length === 0) return params;
  const pinned = isRecord(params) ? { ...params } : {};
  delete pinned["agent_ids"];
  return { ...pinned, run_ids: runIds };
}

async function executeAgentWait(
  core: CoreBridge,
  params: unknown,
  ctx: unknown,
  signal: AbortSignal | undefined,
  initialPrepared: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const timeoutSeconds = isRecord(params) ? optionalNumberField(params, "timeout_seconds") : undefined;
  let prepared = initialPrepared;
  if (timeoutSeconds === 0 || !agentWaitHasActiveRuns(prepared)) {
    return preparedToolResult(core, prepared);
  }
  const pollParams = pinnedAgentWaitParams(params, prepared);

  const startedAt = Date.now();
  const deadline =
    timeoutSeconds !== undefined ? startedAt + Math.max(0, timeoutSeconds) * 1000 : undefined;

  while (agentWaitHasActiveRuns(prepared)) {
    if (signal?.aborted === true) {
      return preparedToolResult(core, prepared, {
        waitInterrupted: true,
        status: "interrupted",
      });
    }
    const now = Date.now();
    if (deadline !== undefined && now >= deadline) {
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
    return executeAgentWait(core, parsed.params, ctx, signal, prepared);
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
      const dispatch = await sendToChildSession(pi, core, bridge, prompt, "no initial prompt", {
        awaitCompletion: false,
        onCompletion: recordAgentDispatchCompletionInBackground(pi, core, prepared, ctx),
      });
      const result = coreCall(core, "finishAgentAction", [{
        prepared,
        bridge: childBridgeFacts(bridge),
        dispatch,
      }]);
      if (!isRecord(result)) throw new Error("Invalid Taumel agent result");
      return result;
    }
    case "agent_send": {
      const workerId = stringField(prepared, "workerId");
      if (preparedInterruptedActiveRun(prepared)) {
        await applyChildSessionUpdate(
          childSessions,
          {
            action: "stop_child_session",
            key: workerId,
            reason: "interrupted_by_parent",
          },
          undefined,
        );
        childSessions.delete(workerId);
      }
      let bridge = childSessions.get(workerId);
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
      const deliverAs = preparedDeliveryKind(prepared) === "steered" ? "steer" : "followUp";
      const dispatch = await sendToChildSession(
        pi,
        core,
        bridge,
        stringField(prepared, "prompt"),
        "empty prompt",
        {
          awaitCompletion: false,
          deliverAs,
          onCompletion: recordAgentDispatchCompletionInBackground(pi, core, prepared, ctx),
        },
      );
      const result = coreCall(core, "finishAgentAction", [{ prepared, dispatch }]);
      if (!isRecord(result)) throw new Error("Invalid Taumel agent result");
      return result;
    }
    case "agent_wait":
      return preparedToolResult(core, prepared);
    case "agent_close": {
      const applied = await applyChildSessionUpdatesFromDetails(childSessions, prepared);
      if (!applied) {
        await applyChildSessionUpdate(
          childSessions,
          coreCall(core, "planAgentBridgeUpdate", [{ prepared }]),
          undefined,
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
          return executeTool(pi, core, childSessions, name, params, ctx, signal);
        },
      });
      registered.add(name);
    }
  };
  registerMatching(false);
  return { registerAgentTools: () => registerMatching(true) };
}
