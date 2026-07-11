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
  execHostFacts,
  modelRegistryFrom,
  openAiCredentialRaw,
  openAiUsageTokenRaw,
  sessionInfoFromContext,
  threadSources,
  validateWorkspaceMutationPaths,
  writeFileAtomically,
  writePatchFiles,
  appendToFile,
} from "./util.ts";
import { notificationMessageRenderer, renderersForTool } from "./tool-renderer.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  refreshOwnedChildPermissions,
  sendToChildSession,
} from "./child-sessions.ts";
import { installExecNotificationLifecycle, startExecCompletionWaiter } from "./exec-notifications.ts";
import { decodeBridgeToolExecutionResult, decodeBridgeToolResult, decodeEditApplicationResult, decodeExecApprovalPromptPlan, decodeExecApprovalResult, decodeExecPolicyAllowRuleResult, decodeExecToolResult, decodePatchApplicationResult, decodeToolNamesResult, decodeToolResultEnvelope, decodeViewMediaResultEnvelope, type PreparedToolAction, type ToolResultEnvelope } from "./bridge-contracts.ts";
import {
  decodeOpenAiUsageHostAuth,
  decodeOpenAiUsageHostParams,
  type OpenAiUsageHostLookupFacts,
  type OpenAiUsageHostParams,
} from "./bridge-contracts.ts";
import {
  errorToolResult,
  hostToolResult,
  preparedAction,
  preparedToolResult,
} from "./tool-results.ts";

type SettingsObject = { [key: string]: unknown };
type ToolContext = { readonly cwd?: unknown; readonly model?: unknown; readonly ui?: unknown; readonly sessionManager?: unknown };
type ToolUi = { readonly confirm?: (...args: unknown[]) => Promise<unknown>; readonly select?: (...args: unknown[]) => Promise<unknown> };
type SessionManagerHost = { readonly getEntries?: () => unknown };
type SessionEntry = { readonly type?: unknown; readonly customType?: unknown; readonly data?: unknown };
type ChildMetadata = { readonly isolated_child?: unknown; readonly kind?: unknown; readonly parentSessionId?: unknown };
type ImageModel = { readonly input?: unknown };
type EditReplacement = { readonly oldText?: unknown; readonly newText?: unknown };
type NodeError = { readonly code?: unknown };

type PreparedSuccess = Exclude<PreparedToolAction, { ok: false }>;
type PreparedExaAction = Extract<PreparedSuccess, { action: "exa_fetch" | "exa_agent_create_run_approval" }>;
type PreparedOpenAiAction = Extract<PreparedSuccess, { action: "openai_usage_fetch" }>;
type PreparedApprovalAction = Extract<PreparedSuccess, { action: "exec_command_approval" | "write_approval" | "edit_approval" | "apply_patch_approval" | "exa_agent_create_run_approval" }>;
type PreparedMutationAction = Extract<PreparedSuccess, { action: "write" | "write_approval" | "edit" | "edit_approval" | "apply_patch" | "apply_patch_approval" }>;

function settingsObject(value: unknown): SettingsObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as SettingsObject : undefined;
}
function toolContext(value: unknown): Partial<ToolContext> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<ToolContext> : undefined;
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
  const root = settingsObject(settings) ?? {};
  const taumel = settingsObject(root["taumel"]) ?? {};
  const execPolicy = settingsObject(taumel["execPolicy"]) ?? {};
  const rules = Array.isArray(execPolicy["rules"]) ? execPolicy["rules"] : [];
  const pattern = [...tokens];
  rules.push({ pattern, decision: "allow", match: [pattern] });
  execPolicy["rules"] = rules;
  taumel["execPolicy"] = execPolicy;
  root["taumel"] = taumel;
  await writeFileAtomically(settingsPath, `${JSON.stringify(root, null, 2)}\n`);
  decodeExecPolicyAllowRuleResult(core.call("appendExecPolicyAllowRule", [{ tokens: pattern }]));
}

function mutationApprovalDenied(core: CoreBridge, action: string, outcome: ApprovalOutcome): ToolResultEnvelope {
  return errorToolResult(core, approvalOutcomeMessage(action, outcome), {
    ok: false,
    approvalRequired: true,
    approvalOutcome: outcome,
  });
}

function childSessionMetadataFromContext(ctx: unknown): Partial<ChildMetadata> | undefined {
  const sessionManager = toolContext(ctx)?.sessionManager;
  if (typeof sessionManager !== "object" || sessionManager === null) return undefined;
  const getEntries = (sessionManager as SessionManagerHost).getEntries;
  if (typeof getEntries !== "function") return undefined;
  try {
    const entries = getEntries.call(sessionManager);
    if (!Array.isArray(entries)) return undefined;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (typeof entry !== "object" || entry === null) continue;
      const sessionEntry = entry as SessionEntry;
      if (sessionEntry.type !== "custom" || sessionEntry.customType !== "taumel.childSession") {
        continue;
      }
      return typeof sessionEntry.data === "object" && sessionEntry.data !== null
        ? sessionEntry.data as Partial<ChildMetadata>
        : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

let loadedMainSessionId: string | undefined;

function childApprovalOwnerIsLoaded(ctx: unknown): boolean {
  const metadata = childSessionMetadataFromContext(ctx);
  if (metadata === undefined) return true;
  const isolatedChild = metadata.isolated_child === true || metadata.kind === "ralph";
  if (!isolatedChild) return true;
  const parentSessionId =
    typeof metadata.parentSessionId === "string" ? metadata.parentSessionId.trim() : "";
  return parentSessionId !== "" && parentSessionId === loadedMainSessionId;
}

function installIsolatedChildOwnershipLifecycle(
  pi: PiLike,
  childSessions: Map<string, ChildSessionBridge>,
): void {
  const loadParent = (ctx: unknown) => {
    if (childSessionMetadataFromContext(ctx) !== undefined) return;
    loadedMainSessionId = sessionInfoFromContext(ctx).sessionId;
    refreshOwnedChildPermissions(childSessions, ctx);
  };
  // A newly spawned child starts while its parent is still loaded, so its
  // session_start must retain ownership. Resuming or switching into a child is
  // different: the parent is no longer the loaded main session.
  pi.on("session_start", (_event, ctx) => loadParent(ctx));
  const replaceLoadedSession = (_event: unknown, ctx: unknown) => {
    if (childSessionMetadataFromContext(ctx) !== undefined) {
      loadedMainSessionId = undefined;
      return;
    }
    loadParent(ctx);
  };
  pi.on("session_resume", replaceLoadedSession);
  pi.on("session_switch", replaceLoadedSession);
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined && ownerId === loadedMainSessionId) loadedMainSessionId = undefined;
  });
}

function boundedApprovalEvidence(prepared: PreparedApprovalAction): string {
  const limit = 4_000;
  const action = prepared.action;
  const lines: string[] = [];
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
        .map((edit) => {
          const replacement = typeof edit === "object" && edit !== null ? edit as EditReplacement : {};
          return `-${String(replacement.oldText ?? "")}\n+${String(replacement.newText ?? "")}`;
        })
        .join("\n");
    if (effect !== undefined && effect !== "") lines.push(`Bounded effect diff:\n${effect}`);
  }
  const sandbox = "sandbox" in prepared ? prepared.sandbox : undefined;
  if (sandbox !== undefined) {
    const mode =
      sandbox.filesystemMode;
    const roots = sandbox.workspaceRoots;
    lines.push(`Sandbox boundary: ${mode || "active sandbox"}; roots: ${roots.join(", ")}`);
  } else {
    const roots = "workspaceRoots" in prepared ? prepared.workspaceRoots : undefined;
    if (roots !== undefined) lines.push(`Sandbox boundary: workspace roots: ${roots.join(", ")}`);
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

async function executeExaInCore(
  core: CoreBridge,
  prepared: PreparedExaAction,
) {
  const bodyJson = prepared.bodyJson;
  const lastEventId = prepared.lastEventId;
  const rendered = decodeBridgeToolExecutionResult(await core.call("executeExa", [{
    toolName: prepared.toolName, method: prepared.method, path: prepared.path,
    ...(bodyJson === undefined ? {} : { bodyJson }),
    ...(lastEventId === undefined ? {} : { lastEventId }),
  }]));
  if (!rendered.ok) {
    return errorToolResult(core, rendered.error, { ...rendered });
  }
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
  prepared: Extract<PreparedSuccess, { action: "exec_command" }>,
  ctx: unknown,
  signal: AbortSignal | undefined,
  forceUnsandboxed = false,
) {
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  const result = decodeExecToolResult(await core.call("runExecCommand", [
    prepared,
    execHostFacts(core, prepared),
    {
      defaultCwd: process.cwd(),
      bashPath: resolveBashPath(),
    },
    ownerId,
    signal ?? null,
    forceUnsandboxed,
  ]));
  // The command outlived the first yield window and is now a background session.
  // Start a detached waiter that delivers its completion if the parent is idle
  // when it exits (the exec analogue of isolated_child onCompletion); turn_end/idle
  // flushes cover the other cases.
  const sessionId = result.details.session_id;
  if (sessionId !== undefined) {
    void startExecCompletionWaiter(pi, core, ctx, sessionId);
  }
  return result;
}

function defaultCwdFromContext(ctx: unknown): string {
  const cwd = toolContext(ctx)?.cwd;
  return typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
}

async function runPreparedRead(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "read" }>,
  ctx: unknown,
) {
  const { offset, limit } = prepared;
  return decodeToolResultEnvelope(await core.call("readFile", [{
    path: prepared.path, defaultCwd: defaultCwdFromContext(ctx),
    ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }),
  }]));
}

async function runPreparedViewMedia(
  core: CoreBridge,
  prepared: Extract<PreparedSuccess, { action: "view_media" }>,
  ctx: unknown,
) {
  return decodeViewMediaResultEnvelope(await core.call("viewMedia", [{
    path: prepared.path, defaultCwd: defaultCwdFromContext(ctx),
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
  const { sessionId, outputMode, yieldTimeMs } = prepared;
  return decodeExecToolResult(await core.call("writeExecStdin", [{
    sessionId, chars: prepared.chars,
    ownerId: sessionInfoFromContext(ctx).sessionId ?? "current",
    ...(outputMode === undefined ? {} : { outputMode }),
    ...(yieldTimeMs === undefined ? {} : { yieldTimeMs }),
    ...(signal === undefined ? {} : { signal }),
  }]));
}

async function confirmExecApproval(
  core: CoreBridge,
  prepared: PreparedApprovalAction,
  ctx: unknown,
  signal?: AbortSignal,
): Promise<ApprovalOutcome> {
  if (!childApprovalOwnerIsLoaded(ctx)) return "unavailable";
  const rawUi = toolContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as ToolUi : undefined;
  const confirm = ui?.confirm;
  const plan = decodeExecApprovalPromptPlan(core.call("planExecApprovalPrompt", [{
    approvalTitle: prepared.approvalTitle,
    approvalPrompt: prepared.approvalPrompt,
    approvalTimeoutMs: prepared.approvalTimeoutMs,
    uiAvailable: typeof confirm === "function",
  }]));
  if (plan.kind === "unavailable") {
    return "unavailable";
  }
  if (typeof confirm !== "function") {
    throw new Error("Invalid Taumel exec approval prompt plan");
  }
  if (signal?.aborted === true) return "interrupted";

  const allowAlwaysTokens = prepared.action === "exec_command_approval"
    ? prepared.execPolicyAllowAlwaysTokens
    : undefined;
  const select = ui?.select;

  const timeoutMs = plan.timeoutMs;
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

  const confirmOptions = { signal: controller.signal };

  try {
    const requester = undefined;
    const title =
      requester === undefined
        ? plan.title
        : `${plan.title} - ${requester}`;
    const prompt =
      requester === undefined
        ? `${plan.prompt}\n\n${boundedApprovalEvidence(prepared)}`
        : `Requesting ${requester}\n\n${plan.prompt}\n\n${boundedApprovalEvidence(prepared)}`;
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
  prepared: PreparedApprovalAction,
  ctx: unknown,
  signal: AbortSignal | undefined,
  run: () => Promise<ToolResultEnvelope> | ToolResultEnvelope,
): Promise<ToolResultEnvelope> {
  const outcome = await confirmExecApproval(core, prepared, ctx, signal);
  if (outcome !== "approved") {
    return mutationApprovalDenied(core, action, outcome);
  }
  return await run();
}

async function validatePreparedMutationPath(
  core: CoreBridge,
  prepared: PreparedMutationAction,
  paths: readonly string[],
): Promise<string | undefined> {
  if (!prepared.validateWorkspacePaths) return undefined;
  try {
    await validateWorkspaceMutationPaths(core, paths, prepared.workspaceRoots);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
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
  const displayPath = prepared.displayPath || path;
  const mode = prepared.mode === "append" ? "append" : "overwrite";
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
  prepared: Extract<PreparedSuccess, { action: "edit" }>,
): Promise<ToolResultEnvelope> {
  const { path } = prepared;
  const displayPath = prepared.displayPath || path;
  const validationError = await validatePreparedMutationPath(core, prepared, [path]);
  if (validationError !== undefined) {
    return errorToolResult(core, validationError, { ok: false, error: validationError });
  }
  let content: string;
  try {
    content = await readFile(path, "utf8");
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
  const application = decodeEditApplicationResult(core.call("applyEditToFile", [{ prepared, contents: content }]));
  if (application.kind === "error") return errorToolResult(core, application.message, { ...application });
  const nextContent = application.contents;
  const editCount = application.editCount;
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
  core: CoreBridge,
  rawParams: unknown,
  prepared: Extract<PreparedSuccess, { action: "apply_patch" }>,
  ctx: unknown,
): Promise<ToolResultEnvelope> {
  const files: Record<string, string> = {};
  const { affectedPaths } = prepared;
  const readValidationError = await validatePreparedMutationPath(core, prepared, affectedPaths);
  if (readValidationError !== undefined) {
    return errorToolResult(core, readValidationError, { ok: false, error: readValidationError });
  }
  for (const path of affectedPaths) {
    try {
      files[path] = await readFile(path, "utf8");
    } catch (error) {
      const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
  const application = decodePatchApplicationResult(core.call("applyPatchToFiles", [{
    params: rawParams, files, ctx, filesystemApproval: prepared.filesystemApproval === true,
  }]));
  if (application.kind === "error") return errorToolResult(core, application.message, { ...application });
  const deletes = application.deletes;
  const writes = application.writes;
  // Attach the pre-patch file contents so the renderer can compute a real
  // unified diff per file (apply_patch details already carry the new contents).
  const writesWithBefore = writes.map((write) => {
    const writePath = write.path;
    return { ...write, before: files[writePath] ?? "" };
  });
  const deletedFiles = deletes.map((path) => ({ path, before: files[path] ?? "" }));
  const writePaths = writes.map((write) => write.path);
  const writeValidationError = await validatePreparedMutationPath(core, prepared, [...deletes, ...writePaths]);
  if (writeValidationError !== undefined) {
    return errorToolResult(core, writeValidationError, { ok: false, error: writeValidationError });
  }
  await writePatchFiles({ deletes, writes });
  return hostToolResult(core, "apply_patch", { ...application, writes: writesWithBefore, deletedFiles });
}

export async function executeTool(
  pi: PiLike,
  core: CoreBridge,
  _childSessions: Map<string, ChildSessionBridge>,
  name: string,
  rawParams: unknown,
  ctx: unknown,
  signal?: AbortSignal,
) {
  const parsed = parseToolParams(name, rawParams);
  if (!parsed.ok) {
    return errorToolResult(core, parsed.error, { ok: false, error: parsed.error });
  }
  if (name === "view_media" && !contextModelSupportsImages(ctx)) {
    const error = "Current model does not support image input";
    return errorToolResult(core, error, { ok: false, error, modelSupportsImages: false });
  }
  const prepared = preparedAction(core, name, parsed.params, ctx);
  if (!prepared.ok) {
    return errorToolResult(core, prepared.error, { ...prepared });
  }
  switch (prepared.action) {
    case "tool_result":
      return preparedToolResult(core, prepared);
    case "openai_usage_fetch":
      return executeOpenAiUsageWithHostAuth(pi, core, prepared, ctx);
    case "exa_fetch":
      return executeExaInCore(core, prepared);
    case "exa_agent_create_run_approval":
      return withMutationApproval(core, "exa_agent_create_run", prepared, ctx, signal, () =>
        executeExaInCore(core, prepared)
      );
    case "query_threads":
    case "read_thread": {
      const result = await runThreadTool(core, name, prepared, ctx);
      return result;
    }
    case "exec_command":
      return runPreparedExec(pi, core, prepared, ctx, signal);
    case "exec_command_approval": {
      const outcome = await confirmExecApproval(core, prepared, ctx, signal);
      const approvalPlan = decodeExecApprovalResult(core.call("finishExecApproval", [{
        outcome: outcome === "approved_always" ? "approved" : outcome,
      }]));
      if (approvalPlan.kind === "denied") return approvalPlan.result;
      return runPreparedExec(pi, core, { ...prepared, action: "exec_command" }, ctx, signal, approvalPlan.forceUnsandboxed);
    }
    case "write_stdin":
      return writePreparedStdin(core, prepared, ctx, signal);
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
    pi.registerMessageRenderer("notification", notificationMessageRenderer());
  }
  installExecNotificationLifecycle(pi, core);
  installIsolatedChildOwnershipLifecycle(pi, childSessions);
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
      execute: async (...args: unknown[]) =>
        executeTool(pi, core, childSessions, name, args[1], args[4], args[2] instanceof AbortSignal ? args[2] : undefined),
      ...(renderersForTool(name) ?? {}),
    });
  }
}
