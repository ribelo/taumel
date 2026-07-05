import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ChildSessionBridge,
  CoreBridge,
  PiLike,
} from "./types.ts";
import {
  parseToolParams,
  toolContracts,
  toolNames,
} from "./tool-contracts.ts";

import {
  childBridgeFacts,
  execHostFacts,
  isRecord,
  isStaleContextError,
  modelRegistryFrom,
  numberField,
  optionalNumberField,
  optionalStringField,
  openAiCredentialRaw,
  openAiUsageTokenRaw,
  requiredError,
  sessionInfoFromContext,
  stringArrayFromUnknown,
  stringField,
  threadSources,
  validateWorkspaceMutationPaths,
  writeFileAtomically,
  writePatchFiles,
  appendToFile,
  coreCallRecord,
  coreCallStringArray,
} from "./util.ts";
import { notificationMessageRenderer, renderersForTool } from "./tool-renderer.ts";
import {
  applyChildSessionUpdate,
  applyChildSessionUpdatesFromDetails,
  childSessionCacheKey,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  sendToChildSession,
} from "./child-sessions.ts";
import {
  agentDeliveryKind,
  createAgentChildSessionForPrepared,
  executeAgentWait,
  flushPendingAgentNotifications,
  flushPendingExecNotifications,
  isSpawnedObjectiveCompletion,
  recordAgentDispatchCompletionInBackground,
  startChildGoalContinuationLoop,
  startExecCompletionWaiter,
  type PendingAgentWaits,
} from "./agent-orchestration.ts";
import {
  errorToolResult,
  hostToolResult,
  preparedAction,
  preparedToolResult,
} from "./tool-results.ts";

export {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
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

type ApprovalOutcome =
  | "approved"
  | "approved_always"
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
    case "approved_always":
    case "approved":
      return "";
  }
}

async function appendExecPolicyAllowRule(core: CoreBridge, tokens: readonly string[]): Promise<void> {
  const settingsPath = join(getAgentDir(), "settings.json");
  let settings: unknown = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
  } catch {
    settings = {};
  }
  const root: Record<string, unknown> = isRecord(settings) ? { ...settings } : {};
  const taumel = isRecord(root["taumel"]) ? { ...root["taumel"] } : {};
  const execPolicy = isRecord(taumel["execPolicy"]) ? { ...taumel["execPolicy"] } : {};
  const rules = Array.isArray(execPolicy["rules"]) ? [...execPolicy["rules"]] : [];
  rules.push({ pattern: [...tokens], decision: "allow", match: [[...tokens]] });
  execPolicy["rules"] = rules;
  taumel["execPolicy"] = execPolicy;
  root["taumel"] = taumel;
  await writeFileAtomically(settingsPath, `${JSON.stringify(root, null, 2)}\n`);
  const result = coreCallRecord(core, "appendExecPolicyAllowRule", [{ tokens: [...tokens] }], "exec policy amendment result");
  if (result["ok"] !== true) {
    throw new Error("Invalid Taumel exec policy amendment result");
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
  return coreCallRecord(core, "openAiUsageHostAuth", [], "OpenAI usage auth plan");
}

function openAiUsageHostParams(core: CoreBridge, params: Record<string, unknown>): Record<string, unknown> {
  const planned = coreCallRecord(core, "openAiUsageHostParams", [params], "OpenAI usage host params");
  if (planned["ok"] !== true || !isRecord(planned["params"])) {
    throw new Error("Invalid Taumel OpenAI usage host params");
  }
  return planned["params"];
}

async function executeOpenAiUsageInCore(
  core: CoreBridge,
  ctx: unknown,
  params: Record<string, unknown>,
) {
  const rendered = await coreCallRecord(core, "executeOpenAiUsage", [params, ctx], "OpenAI usage result");
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
  const rendered = await coreCallRecord(core, "executeExa", [prepared, ctx], "Exa result");
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

// exec_command always runs under bash, never $SHELL. Resolve like Pi:
// /bin/bash -> `which bash` (handles NixOS, where /bin/bash does not exist and
// bash lives in the nix store on PATH) -> sh as a last resort.
let cachedBashPath: string | undefined;
function resolveBashPath(): string {
  if (cachedBashPath !== undefined) return cachedBashPath;
  let resolved = "bash";
  if (existsSync("/bin/bash")) {
    resolved = "/bin/bash";
  } else {
    try {
      const which = spawnSync("which", ["bash"], { encoding: "utf-8" });
      const first = which.status === 0 ? which.stdout.trim().split(/\r?\n/)[0] : "";
      resolved = first !== "" ? first : "sh";
    } catch {
      resolved = "sh";
    }
  }
  cachedBashPath = resolved;
  return resolved;
}

async function runPreparedExec(
  pi: PiLike,
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
  signal: AbortSignal | undefined,
  forceUnsandboxed = false,
) {
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  const result = await coreCallRecord(core, "runExecCommand", [
    prepared,
    execHostFacts(core, prepared),
    {
      defaultCwd: process.cwd(),
      bashPath: resolveBashPath(),
    },
    ownerId,
    signal ?? null,
    forceUnsandboxed,
  ], "exec_command result");
  // The command outlived the first yield window and is now a background session.
  // Start a detached waiter that delivers its completion if the parent is idle
  // when it exits (the exec analogue of subagent onCompletion); turn_end/idle
  // flushes cover the other cases.
  const details = result["details"];
  const sessionId = isRecord(details) ? optionalNumberField(details, "session_id") : undefined;
  if (sessionId !== undefined) {
    void startExecCompletionWaiter(pi, core, ctx, sessionId);
  }
  return result;
}

async function runPreparedRead(
  core: CoreBridge,
  prepared: Record<string, unknown>,
) {
  return await coreCallRecord(core, "readFile", [
    prepared,
    { defaultCwd: process.cwd() },
  ], "read result");
}

async function writePreparedStdin(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
) {
  return await coreCallRecord(core, "writeExecStdin", [
    prepared,
    sessionInfoFromContext(ctx).sessionId ?? "current",
  ], "write_stdin result");
}

async function confirmExecApproval(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  ctx: unknown,
  signal?: AbortSignal,
): Promise<ApprovalOutcome> {
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : {};
  const confirm = ui["confirm"];
  const plan = coreCallRecord(core, "planExecApprovalPrompt", [prepared, {
    uiAvailable: typeof confirm === "function",
  }], "exec approval prompt plan");
  const action = stringField(plan, "action");
  if (action === "unavailable") {
    return "unavailable";
  }
  if (action !== "confirm" || typeof confirm !== "function") {
    throw new Error("Invalid Taumel exec approval prompt plan");
  }
  if (signal?.aborted === true) return "interrupted";

  const allowAlwaysTokens = stringArrayFromUnknown(prepared["execPolicyAllowAlwaysTokens"]);
  const select = ui["select"];

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
    if (allowAlwaysTokens !== undefined && allowAlwaysTokens.length > 0 && typeof select === "function") {
      const selected = await withGoalClockPaused(core, async () =>
        await select.call(ui, title, ["Deny", "Allow once", "Allow always"])
      );
      if (selected === "Allow once") return "approved";
      if (selected === "Allow always") {
        await appendExecPolicyAllowRule(core, allowAlwaysTokens);
        return "approved_always";
      }
      return controller.signal.aborted ? outcome ?? "interrupted" : "denied_by_user";
    }
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

async function withMutationApproval(
  core: CoreBridge,
  action: string,
  prepared: Record<string, unknown>,
  ctx: unknown,
  signal: AbortSignal | undefined,
  run: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const outcome = await confirmExecApproval(core, prepared, ctx, signal);
  if (outcome !== "approved") {
    return mutationApprovalDenied(core, action, outcome);
  }
  return await run();
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

async function runThreadTool(core: CoreBridge, name: string, prepared: Record<string, unknown>, ctx: unknown) {
  return coreCallRecord(core, "runThreadTool", [name, prepared, await threadSources(core, ctx), ctx], "thread tool result");
}

async function executeLegacyWrite(
  core: CoreBridge,
  prepared: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = stringField(prepared, "path");
  const displayPath = stringField(prepared, "displayPath") || path;
  const contents = stringField(prepared, "contents");
  const mode = stringField(prepared, "mode") === "append" ? "append" : "overwrite";
  if (path === "") throw new Error("Invalid Taumel write plan");
  const validationError = await validatePreparedMutationPath(core, prepared, [path]);
  if (validationError !== undefined) {
    return errorToolResult(core, validationError, { ok: false, error: validationError });
  }
  if (mode === "append") {
    await appendToFile(path, contents);
  } else {
    await writePatchFiles({ deletes: [], writes: [{ path, contents }] });
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
  const application = coreCallRecord(core, "applyEditToFile", [prepared, content], "edit result");
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
    before: content,
    after: nextContent,
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
  const application = coreCallRecord(core, "applyPatchToFiles", [
    rawParams,
    files,
    ctx,
    { filesystemApproval: prepared["filesystemApproval"] === true },
  ], "apply_patch result");
  if (application["ok"] !== true) {
    return errorToolResult(core, requiredError(application, "apply_patch"), application);
  }
  const deletes = stringArrayFromUnknown(application["deletes"]);
  const writes = application["writes"];
  if (!Array.isArray(writes) || !writes.every(isRecord)) {
    throw new Error("Invalid Taumel apply_patch result");
  }
  // Attach the pre-patch file contents so the renderer can compute a real
  // unified diff per file (apply_patch details already carry the new contents).
  const writesWithBefore = writes.map((write) => {
    const writePath = stringField(write, "path");
    return writePath === "" ? write : { ...write, before: files[writePath] ?? "" };
  });
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
  return hostToolResult(core, "apply_patch", { ...application, writes: writesWithBefore });
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
    case "exa_agent_create_run_approval":
      return withMutationApproval(core, "exa_agent_create_run", prepared, ctx, signal, () =>
        executeExaInCore(core, prepared, ctx)
      );
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
      const result = coreCallRecord(core, "finishAgentAction", [{
        prepared,
        bridge: childBridgeFacts(bridge),
        dispatch,
      }, ctx], "agent result");
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
      return coreCallRecord(core, "finishAgentAction", [{ prepared, dispatch }, ctx], "agent result");
    }
    case "agent_wait":
      return preparedToolResult(core, prepared);
    case "agent_close": {
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      const applied = await applyChildSessionUpdatesFromDetails(childSessions, prepared, keyScope);
      if (!applied) {
        await applyChildSessionUpdate(
          childSessions,
          coreCallRecord(core, "planAgentBridgeUpdate", [{ prepared }], "agent bridge update plan"),
          undefined,
          keyScope,
        );
      }
      return preparedToolResult(core, prepared);
    }
    case "query_threads":
    case "read_thread": {
      const result = await runThreadTool(core, name, prepared, ctx);
      return result;
    }
    case "exec_command":
      return runPreparedExec(pi, core, prepared, ctx, signal);
    case "exec_command_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      const approvalPlan = coreCallRecord(core, "finishExecApproval", [{
        prepared,
        outcome: outcome === "approved_always" ? "approved" : outcome,
      }], "exec approval result");
      if (stringField(approvalPlan, "action") === "result") {
        const result = approvalPlan["result"];
        if (!isRecord(result)) throw new Error("Invalid Taumel exec approval result");
        return result;
      }
      if (stringField(approvalPlan, "action") !== "exec_command") {
        throw new Error("Invalid Taumel exec approval result");
      }
      return runPreparedExec(pi, core, prepared, ctx, signal, approvalPlan["forceUnsandboxed"] === true);
    }
    case "write_stdin":
      return writePreparedStdin(core, prepared, ctx);
    case "write_approval":
      return withMutationApproval(core, "write", prepared, ctx, signal, () =>
        executeLegacyWrite(core, {
          ...prepared,
          action: "write",
          filesystemApproval: true,
          validateWorkspacePaths: false,
        })
      );
    case "edit_approval":
      return withMutationApproval(core, "edit", prepared, ctx, signal, () =>
        executeLegacyEdit(core, {
          ...prepared,
          action: "edit",
          filesystemApproval: true,
          validateWorkspacePaths: false,
        })
      );
    case "apply_patch_approval":
      return withMutationApproval(core, "apply_patch", prepared, ctx, signal, () =>
        executeApplyPatch(pi, core, name, parsed.params, {
          ...prepared,
          action: "apply_patch",
          filesystemApproval: true,
          validateWorkspacePaths: false,
        }, ctx)
      );
    case "write":
      return executeLegacyWrite(core, prepared);
    case "read":
      return runPreparedRead(core, prepared);
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
  const coreToolNames = coreCallStringArray(core, "toolPolicyNames", [], "tool policy names");
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
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("notification", notificationMessageRenderer());
  }
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined) core.call("shutdownExecOwner", [ownerId]);
  });
  const clearRetainedAgentOutputs = (_event: unknown, ctx: unknown) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined) core.call("clearRetainedAgentOutputsForSession", [ownerId]);
  };
  pi.on("session_start", clearRetainedAgentOutputs);
  pi.on("session_resume", clearRetainedAgentOutputs);
  pi.on("session_switch", clearRetainedAgentOutputs);
  assertToolCatalogMatchesCore(core);
  const allowedToolNames = coreCallStringArray(core, "allowedToolNames", [], "allowed tool names");
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
      await flushPendingExecNotifications(pi, core, ctx, "steer");
    } catch (error) {
      if (isStaleContextError(error)) return;
      console.warn("Taumel agent turn_end notification flush failed:", error);
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    setTimeout(() => {
      void flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits).catch((error) => {
        if (isStaleContextError(error)) return;
        console.warn("Taumel agent agent_end notification flush failed:", error);
      });
      void flushPendingExecNotifications(pi, core, ctx, "trigger").catch((error) => {
        if (isStaleContextError(error)) return;
        console.warn("Taumel exec agent_end notification flush failed:", error);
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
        renderShell: "default",
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
