import { readFile } from "node:fs/promises";

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
  applyChildModelThinking,
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
  recordArrayField,
  requiredError,
  sessionInfoFromContext,
  sessionInfoFromManager,
  stringArrayFromUnknown,
  stringField,
  threadSources,
  validateWorkspaceMutationPaths,
  writePatchFiles,
} from "./util.ts";
import { shellRenderersForTool } from "./shell-renderer.ts";

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
    const approved = await confirm.call(
      ui,
      stringField(plan, "title"),
      stringField(plan, "prompt"),
      confirmOptions,
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
  core: CoreBridge,
  ctx: unknown,
  metadata: Record<string, unknown>,
): Promise<ChildSessionBridge | undefined> {
  if (!isRecord(ctx) || typeof ctx["newSession"] !== "function") return undefined;

  const parent = sessionInfoFromContext(ctx);
  const plan = childSessionStartPlan(core, metadata, parent);
  let setupInfo: SessionInfo = {};
  let replacementCtx: unknown;
  let activeToolsApplied = false;
  const activeTools = stringArrayFromUnknown(plan["activeTools"]);
  const modelId = optionalStringField(plan, "modelId");
  const thinkingLevel = optionalStringField(plan, "thinkingLevel");
  const parentSession = optionalStringField(plan, "parentSession");
  const setupEntriesRaw = plan["setupEntries"];
  if (!Array.isArray(setupEntriesRaw) || !setupEntriesRaw.every(isRecord)) {
    throw new Error("Invalid Taumel child session start plan");
  }
  const setupEntries = setupEntriesRaw;
  let modelApplied = false;
  let thinkingApplied = false;
  const options = {
    ...(parentSession !== undefined ? { parentSession } : {}),
    ...(modelId !== undefined ? { modelId, model: modelId } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel, thinking: thinkingLevel } : {}),
    setup: async (sessionManager: unknown) => {
      setupInfo = sessionInfoFromManager(sessionManager);
      if (isRecord(sessionManager) && typeof sessionManager["appendCustomEntry"] === "function") {
        for (const entry of setupEntries) {
          const customType = stringField(entry, "customType");
          if (customType === "") continue;
          sessionManager["appendCustomEntry"].call(sessionManager, customType, entry["data"]);
        }
      }
    },
    withSession: async (nextCtx: unknown) => {
      replacementCtx = nextCtx;
      if (activeTools !== undefined) {
        activeToolsApplied = applyChildActiveTools(nextCtx, activeTools);
      }
      const applied = applyChildModelThinking(nextCtx, modelId, thinkingLevel);
      modelApplied = applied.modelApplied;
      thinkingApplied = applied.thinkingApplied;
    },
  };

  try {
    const result = await ctx["newSession"].call(ctx, options);
    if (isRecord(result) && result["cancelled"] === true) {
      return { cancelled: true };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const replacementInfo = sessionInfoFromContext(replacementCtx);
  const sessionId = replacementInfo.sessionId ?? setupInfo.sessionId;
  const sessionFile = replacementInfo.sessionFile ?? setupInfo.sessionFile;
  if (!sessionId && !sessionFile) {
    return { missingSessionIdentifier: true };
  }
  return {
    sessionId: sessionId ?? sessionFile,
    sessionFile,
    ctx: replacementCtx,
    activeTools,
    activeToolsApplied,
    modelId,
    modelApplied,
    thinkingLevel,
    thinkingApplied,
  };
}

export async function sendToChildSession(
  pi: PiLike,
  core: CoreBridge,
  child: ChildSessionBridge | undefined,
  prompt: string,
  emptyReason = "empty prompt",
): Promise<Record<string, unknown>> {
  const childCtx = child?.ctx;
  const childSendAvailable = isRecord(childCtx) && typeof childCtx["sendUserMessage"] === "function";
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
  const deliverAs = stringField(plan, "deliverAs");
  if (deliverAs === "") throw new Error("Invalid Taumel child dispatch delivery mode");
  const options = { deliverAs };
  if (isRecord(childCtx) && typeof childCtx["sendUserMessage"] === "function") {
    await childCtx["sendUserMessage"].call(childCtx, dispatchPrompt, options);
    return result;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(dispatchPrompt, options);
    return result;
  }
  return result;
}

export function applyChildSessionUpdate(
  childSessions: Map<string, ChildSessionBridge>,
  update: unknown,
  bridge: ChildSessionBridge | undefined,
): void {
  if (!isRecord(update)) throw new Error("Invalid Taumel child session update");
  const key = stringField(update, "key");
  switch (stringField(update, "action")) {
    case "none":
      return;
    case "store_child_session":
      if (key === "" || !bridge) throw new Error("Invalid Taumel child session update");
      childSessions.set(key, bridge);
      return;
    case "delete_child_session":
      if (key === "") throw new Error("Invalid Taumel child session update");
      childSessions.delete(key);
      return;
    default:
      throw new Error("Invalid Taumel child session update");
  }
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

async function runThreadTool(core: CoreBridge, name: string, prepared: Record<string, unknown>, ctx: unknown) {
  const result = coreCall(core, "runThreadTool", [name, prepared, await threadSources(core, ctx), ctx]);
  if (!isRecord(result)) throw new Error("Invalid Taumel thread tool result");
  return result;
}

function finishRequestUserInput(core: CoreBridge, params: Record<string, unknown>) {
  const result = coreCall(core, "finishRequestUserInput", [params]);
  if (!isRecord(result)) throw new Error("Invalid request_user_input result");
  return result;
}

async function answerRequestUserInput(core: CoreBridge, prepared: Record<string, unknown>, ctx: unknown) {
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : {};
  const inputMethod = ui["input"];
  const plan = coreCall(core, "planRequestUserInput", [{
    prepared,
    uiAvailable: typeof inputMethod === "function",
    nowMs: Date.now(),
  }]);
  if (!isRecord(plan)) {
    throw new Error("Invalid request_user_input UI plan");
  }
  if (stringField(plan, "action") === "result") {
    const result = plan["result"];
    if (!isRecord(result)) throw new Error("Invalid request_user_input planned result");
    return result;
  }
  if (stringField(plan, "action") !== "ask" || typeof inputMethod !== "function") {
    throw new Error("Invalid request_user_input UI plan");
  }

  const outcomes: Record<string, unknown>[] = [];
  const deadlineMs = optionalNumberField(plan, "deadlineMs");
  for (const prompt of recordArrayField(plan, "prompts")) {
    const id = stringField(prompt, "id");
    const defaultAnswer = stringField(prompt, "defaultAnswer");
    const input = inputMethod.call(
      ui,
      stringField(prompt, "prompt"),
      stringField(prompt, "placeholder"),
    );
    const remainingMs = deadlineMs === undefined ? undefined : Math.max(0, deadlineMs - Date.now());
    const result =
      remainingMs === undefined
        ? { timedOut: false, answer: await input }
        : await Promise.race([
            Promise.resolve(input).then((answer) => ({ timedOut: false, answer })),
            new Promise<{ readonly timedOut: true; readonly answer: undefined }>((resolve) => {
              setTimeout(() => resolve({ timedOut: true, answer: undefined }), remainingMs);
            }),
          ]);
    if (result.timedOut) {
      outcomes.push({ id, defaultAnswer, timedOut: true });
      continue;
    }
    const answer = result.answer;
    if (answer === undefined || answer === null) {
      outcomes.push({ id, defaultAnswer, cancelled: true });
      return finishRequestUserInput(core, { outcomes });
    }
    outcomes.push({ id, defaultAnswer, answer: String(answer) });
  }

  return finishRequestUserInput(core, { outcomes });
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
      const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
      const spawnPlan = coreCall(core, "planAgentSpawn", [{
        prepared,
        currentActiveToolsAvailable: currentActiveToolNames !== undefined,
        currentActiveTools: currentActiveToolNames ?? [],
      }]);
      if (!isRecord(spawnPlan)) throw new Error("Invalid Taumel agent spawn plan");
      if (spawnPlan["ok"] !== true) {
        return errorToolResult(core, requiredError(spawnPlan, "agent spawn plan"), spawnPlan);
      }
      const workerId = stringField(spawnPlan, "workerId");
      const metadata = isRecord(spawnPlan["metadata"]) ? spawnPlan["metadata"] : {};
      const bridge = await createChildSession(core, ctx, metadata);
      applyChildSessionUpdate(
        childSessions,
        coreCall(core, "planAgentBridgeUpdate", [{
          prepared,
          workerId,
          bridge: childBridgeFacts(bridge),
        }]),
        bridge,
      );
      const prompt = stringField(spawnPlan, "prompt");
      const dispatch = await sendToChildSession(pi, core, bridge, prompt, "no initial prompt");
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
      const dispatch = await sendToChildSession(
        pi,
        core,
        childSessions.get(workerId),
        stringField(prepared, "prompt"),
      );
      const result = coreCall(core, "finishAgentAction", [{ prepared, dispatch }]);
      if (!isRecord(result)) throw new Error("Invalid Taumel agent result");
      return result;
    }
    case "agent_wait":
      return preparedToolResult(core, prepared);
    case "agent_close": {
      applyChildSessionUpdate(
        childSessions,
        coreCall(core, "planAgentBridgeUpdate", [{ prepared }]),
        undefined,
      );
      return preparedToolResult(core, prepared);
    }
    case "request_user_input":
      return answerRequestUserInput(core, prepared, ctx);
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

export function registerGatewayTools(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
): void {
  if (typeof pi.registerTool !== "function") return;
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined) coreCall(core, "shutdownExecOwner", [ownerId]);
  });
  assertToolCatalogMatchesCore(core);
  const allowedToolNames = stringArrayFromUnknown(coreCall(core, "allowedToolNames"));
  if (allowedToolNames === undefined) throw new Error("Invalid Taumel allowed tool names");
  const allowed = new Set(allowedToolNames);
  for (const spec of toolContracts) {
    const name = spec.name;
    if (!allowed.has(name)) continue;
    pi.registerTool({
      name,
      label: spec.label,
      description: spec.description,
      promptSnippet: spec.promptSnippet,
      promptGuidelines: spec.promptGuidelines ?? [],
      parameters: spec.parameters,
      ...shellRenderersForTool(name),
      execute: async (...args) => {
        const { params, signal, ctx } = readInvocation(args);
        return executeTool(pi, core, childSessions, name, params, ctx, signal);
      },
    });
  }
}
