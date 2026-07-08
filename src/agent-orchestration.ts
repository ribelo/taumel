import type { ChildSessionBridge, CoreBridge, PiLike } from "./types.ts";
import {
  childBridgeFacts,
  contextIsLive,
  coreCallOptionalRecord,
  coreCallRecord,
  isRecord,
  optionalNumberField,
  optionalStringField,
  requiredError,
  sessionInfoFromContext,
  stringArrayFromUnknown,
  stringField,
} from "./util.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  sendToChildSession,
} from "./child-sessions.ts";
import { errorToolResult, preparedAction, preparedToolResult } from "./tool-results.ts";

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

export function isSpawnedObjectiveCompletion(prepared: Record<string, unknown>): boolean {
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

// Deliver one queued completion as a notification custom message.
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
  const result = coreCallRecord(core, "recordAgentBackgroundNotification", [{ prepared }, ctx], "agent background notification update");
  if (result["ok"] !== true) {
    throw new Error("Invalid Taumel agent background notification update");
  }
}

// Flush Taumel's notification queue: deliver every pending, unconsumed,
// undelivered terminal run owned by this parent session, then mark each
// delivered. "steer" is used on turn_end (injected at the start of the next
// turn); "trigger" is used when the parent is idle (wakes a turn). A run with an
// active agent_wait pending is skipped so the wait takes first claim.
export async function flushPendingAgentNotifications(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  mode: NotificationDeliveryMode,
  pendingAgentWaits: PendingAgentWaits,
): Promise<void> {
  if (!contextIsLive(ctx)) return;
  const result = coreCallOptionalRecord(core, "pendingAgentNotifications", [ctx]);
  if (result === undefined) return;
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

// Flush Taumel's exec notification queue: deliver every async command session
// owned by this parent that has exited but was not drained inline, then mark it
// delivered (which removes it). Mirrors flushPendingAgentNotifications; "steer"
// on turn_end, "trigger" when idle. A poll that drained the session removed it
// already, so it never appears here (the inline first-claim path).
export async function flushPendingExecNotifications(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  mode: NotificationDeliveryMode,
): Promise<void> {
  if (!contextIsLive(ctx)) return;
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  const result = coreCallOptionalRecord(core, "pendingExecNotifications", [ownerId]);
  if (result === undefined) return;
  const notifications = Array.isArray(result["notifications"]) ? result["notifications"] : [];
  for (const notification of notifications) {
    if (!isRecord(notification)) continue;
    const sessionId = optionalNumberField(notification, "session_id");
    if (sessionId === undefined) continue;
    const claim = coreCallRecord(core, "claimExecNotificationDelivery", [ownerId, sessionId], "exec notification claim");
    if (claim["claimed"] !== true) continue;
    try {
      const sent = await deliverNotificationMessage(
        pi,
        stringField(claim, "content"),
        stringField(claim, "customType"),
        claim["display"] === true,
        mode,
      );
      if (sent) {
        core.call("markExecNotificationDelivered", [sessionId]);
      } else {
        core.call("releaseExecNotificationDelivery", [sessionId]);
      }
    } catch (error) {
      core.call("releaseExecNotificationDelivery", [sessionId]);
      throw error;
    }
  }
}

// Detached per-session waiter: resolves when the async command exits, then
// delivers its completion if the parent is idle (no turn_end coming). When the
// parent is mid-turn, the turn_end flush handles it instead.
export async function startExecCompletionWaiter(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  sessionId: number,
): Promise<void> {
  try {
    await core.call("awaitExecCompletion", [sessionId]);
  } catch {
    return;
  }
  if (parentIsIdle(pi)) {
    await flushPendingExecNotifications(pi, core, ctx, "trigger");
  }
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
  const result = coreCallRecord(core, "recordAgentDispatchCompletion", [{
    prepared,
    completion: preparedCompletion,
  }, ctx], "agent completion update");
  if (result["ok"] !== true) {
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
  const result = coreCallRecord(core, "recordAgentChildSessionStart", [{
    prepared,
    bridge: childBridgeFacts(bridge),
  }, ctx], "agent child session update");
  if (result["ok"] !== true) {
    throw new Error("Invalid Taumel agent child session update");
  }
}

function recordAgentActiveToolsSnapshot(
  core: CoreBridge,
  prepared: Record<string, unknown>,
  activeTools: readonly string[],
  ctx: unknown,
): void {
  const result = coreCallRecord(core, "recordAgentActiveToolsSnapshot", [{
    prepared,
    activeTools: [...activeTools],
  }, ctx], "agent active tools snapshot update");
  if (result["ok"] !== true) {
    throw new Error("Invalid Taumel agent active tools snapshot update");
  }
}

export function recordAgentDispatchCompletionInBackground(
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
  const result = coreCallRecord(core, "recordAgentDispatchCompletion", [{ prepared, completion }, ctx], "agent completion update");
  if (result["ok"] !== true) {
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
    const plan = coreCallRecord(core, "planChildGoalContinuation", [{
      goal: latestChildCustomEntry(bridge, "taumel.goal") ?? null,
      automation: latestChildCustomEntry(bridge, "taumel.goal_automation") ?? null,
      iterations,
      maxIterations: 0,
      latestAssistantStopReason: completionStopReason(lastCompletion),
    }], "child goal continuation plan");
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

export function startChildGoalContinuationLoop(
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

export async function createAgentChildSessionForPrepared(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  prepared: Record<string, unknown>,
  ctx: unknown,
): Promise<{ readonly workerId: string; readonly bridge: ChildSessionBridge | undefined; readonly prompt: string }> {
  const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
  const spawnPlan = coreCallRecord(core, "planAgentSpawn", [{
    prepared,
    currentActiveToolsAvailable: currentActiveToolNames !== undefined,
    currentActiveTools: currentActiveToolNames ?? [],
  }], "agent spawn plan");
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
    coreCallRecord(core, "planAgentBridgeUpdate", [{
      prepared,
      workerId,
      bridge: childBridgeFacts(bridge),
    }], "agent bridge update plan"),
    bridge,
    childSessionCacheKeyScopeFromContext(ctx),
  );
  recordAgentChildSessionStart(core, prepared, bridge, ctx);
  return { workerId, bridge, prompt: stringField(spawnPlan, "prompt") };
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

export function agentDeliveryKind(prepared: Record<string, unknown>): string {
  const details = isRecord(prepared["details"]) ? prepared["details"] : {};
  return stringField(details, "deliveryKind");
}

export type PendingAgentWaits = Map<string, number>;

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

export async function executeAgentWait(
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
