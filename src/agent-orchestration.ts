import type { ChildSessionBridge, CoreBridge, PiLike } from "./types.ts";
import {
  contextIsLive,
  isStaleContextError,
  sessionInfoFromContext,
} from "./util.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKey,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  deleteAgentChildSession,
  latestAssistantEntryId,
  refreshOwnedChildPermissions,
  sendToChildSession,
} from "./child-sessions.ts";
import { latestTaumelCustomEntry } from "./pi-session-entries.ts";
import { agentErrorToolResult, preparedToolResult } from "./tool-results.ts";
import { cancelAgentApprovals } from "./approval-coordinator.ts";
import {
  decodeAgentActiveCountResult,
  decodeAgentCleanupPlan,
  decodeAgentManagerSnapshot,
  decodeAgentNotificationClaimValidation,
  decodeAgentRoutingDiagnosticsResult,
  decodeCoreAck,
  decodeChildSessionMetadata,
  decodePendingAgentNotificationsResult,
  decodePreparedToolAction,
  decodeToolResultEnvelope,
  type AgentActionCapabilityFacts,
  type ChildDispatchResult,
  type PreparedToolAction,
} from "./bridge-contracts.ts";

type UnknownFields = { readonly [key: string]: unknown };
type PreparedAgentAction = Extract<PreparedToolAction, { action: "agent_start" | "agent_send" | "agent_wait" | "agent_close" }>;
type PreparedDispatchAction = Extract<PreparedAgentAction, { action: "agent_start" | "agent_send" }>;
type AgentActivityEvent = "agent_start" | "turn_start" | "turn_end" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end";

function agentActionCapabilityFacts(prepared: PreparedAgentAction, ctx: unknown): AgentActionCapabilityFacts | undefined {
  if (prepared.action === "agent_wait") return undefined;
  const common = { capabilityId: prepared.capabilityId, agentId: prepared.agentId, ctx };
  if (prepared.action === "agent_start") {
    return { ...common, action: "agent_start", runId: prepared.runId, submissionId: prepared.submissionId };
  }
  if (prepared.action === "agent_close") return { ...common, action: "agent_close" };
  if (prepared.runId === undefined) return { ...common, action: "agent_send" };
  if (prepared.submissionId === undefined) return { ...common, action: "agent_send", runId: prepared.runId };
  return { ...common, action: "agent_send", runId: prepared.runId, submissionId: prepared.submissionId };
}

type PendingAgentWaits = Map<string, Set<AbortController>>;
export const pendingAgentWaits: PendingAgentWaits = new Map();
const activeNoninteractiveDrains = new Set<string>();

function isObject(value: unknown): value is UnknownFields {
  return typeof value === "object" && value !== null;
}

function stringField(value: UnknownFields, key: string): string {
  const raw = value[key];
  return typeof raw === "string" ? raw : "";
}

function childFailureCode(message: string): string {
  if (/cleanup_failed|cleanup failed/.test(message)) return "cleanup_failed";
  if (/model|authentication|thinking/.test(message)) return "routing_unavailable";
  if (/workspace/.test(message)) return "workspace_unavailable";
  if (/child_session|agent_mismatch|owner_mismatch|identity_missing/.test(message)) return "child_session_unavailable";
  return "dispatch_failed";
}

function pendingAgentWaitKey(ctx: unknown, runId: string): string {
  return `${sessionInfoFromContext(ctx).sessionId ?? "current"}\0${runId}`;
}

function parentIsIdle(ctx: unknown): boolean {
  if (!isObject(ctx) || typeof ctx.isIdle !== "function") return false;
  return ctx.isIdle.call(ctx) === true;
}

function reconcilePersistedAgentNotifications(core: CoreBridge, ctx: unknown): void {
  if (!isObject(ctx) || !isObject(ctx.sessionManager)) return;
  const getEntries = ctx.sessionManager.getEntries;
  if (typeof getEntries !== "function") return;
  const entries = getEntries.call(ctx.sessionManager);
  if (!Array.isArray(entries)) return;
  const childMarker = latestTaumelCustomEntry(ctx.sessionManager, "taumel.childSession");
  if (childMarker.kind !== "absent") return;
  for (const entry of entries) {
    if (!isObject(entry) || entry.type !== "message" || !isObject(entry.message)) continue;
    const message = entry.message;
    if (message.role !== "custom" || !isObject(message.details)) continue;
    const notificationId = stringField(message.details, "notificationId");
    if (!notificationId.startsWith("agent_completion:")) continue;
    const runId = notificationId.slice("agent_completion:".length);
    if (runId === "") continue;
    try {
      decodeCoreAck(core.call("recordAgentBackgroundNotification", [{ run_id: runId }, ctx]));
    } catch {
      // A message for a closed or copied identity is inert history.
    }
  }
}

async function deliverNotificationMessage(
  pi: PiLike,
  content: string,
  customType: string,
  display: boolean,
  mode: "steer" | "trigger",
  details?: unknown,
): Promise<boolean> {
  if (typeof pi.sendMessage !== "function") return false;
  await pi.sendMessage(
    {
      customType,
      content,
      display,
      ...(details === undefined ? {} : { details }),
    },
    mode === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" },
  );
  return true;
}

export async function flushPendingAgentNotifications(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  mode: "steer" | "trigger",
  pendingAgentWaits: PendingAgentWaits,
): Promise<number> {
  if (!contextIsLive(ctx)) return 0;
  const result = decodePendingAgentNotificationsResult(core.call("pendingAgentNotifications", [ctx]));
  let sentCount = 0;
  for (const notification of result.notifications) {
    if (!isObject(notification)) continue;
    const runId = notification.runId;
    if (runId !== "" && pendingAgentWaits.has(pendingAgentWaitKey(ctx, runId))) {
      decodeCoreAck(core.call("releaseAgentBackgroundNotification", [{ run_id: runId }]));
      continue;
    }
    try {
      const validation = decodeAgentNotificationClaimValidation(
        core.call("validateAgentBackgroundNotificationClaim", [{ run_id: runId }, ctx]),
      );
      if (validation.valid !== true) continue;
      const sent = await deliverNotificationMessage(
        pi,
        notification.content,
        notification.customType,
        notification.display,
        mode,
        notification.details,
      );
      if (sent && runId !== "") {
        decodeCoreAck(core.call("recordAgentBackgroundNotification", [{ run_id: runId }, ctx]));
        sentCount += 1;
      } else if (runId !== "") {
        decodeCoreAck(core.call("releaseAgentBackgroundNotification", [{ run_id: runId }]));
      }
    } catch (error) {
      if (runId !== "") {
        decodeCoreAck(core.call("releaseAgentBackgroundNotification", [{ run_id: runId }]));
      }
      throw error;
    }
  }
  return sentCount;
}

function recordDispatchCompletionInBackground(
  pi: PiLike,
  core: CoreBridge,
  prepared: PreparedDispatchAction,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
  bridge: ChildSessionBridge | undefined,
) {
  return async (dispatch: ChildDispatchResult) => {
    const completion = dispatch.completion;
    if (completion === undefined) return;
    const resultEntryId = typeof completion.finalOutput === "string"
      ? latestAssistantEntryId(bridge?.sessionManager)
      : undefined;
    decodeCoreAck(core.call("recordAgentDispatchCompletion", [{
      run_id: stringField(prepared, "runId"),
      submission_id: stringField(prepared, "submissionId"),
      completion: {
        ...completion,
        ...(resultEntryId === undefined ? {} : { resultEntryId }),
      },
    }, ctx]));
    if (parentIsIdle(ctx)) {
      await flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits);
    }
    void bridge;
  };
}

function recordDispatchActivity(core: CoreBridge, prepared: PreparedDispatchAction, ctx: unknown) {
  return (event: unknown) => {
    if (!isObject(event) || typeof event.type !== "string") return;
    const observed = new Set<AgentActivityEvent>([
      "agent_start", "turn_start", "turn_end", "tool_execution_start",
      "tool_execution_update", "tool_execution_end",
    ]);
    if (!observed.has(event.type as AgentActivityEvent)) return;
    decodeCoreAck(core.call("recordAgentActivity", [{
      run_id: stringField(prepared, "runId"),
      submission_id: stringField(prepared, "submissionId"),
      event: event.type as AgentActivityEvent,
    }, ctx]));
  };
}

function recordDispatchBoundary(
  core: CoreBridge,
  prepared: PreparedDispatchAction,
  ctx: unknown,
  bridge: ChildSessionBridge | undefined,
): void {
  const previousAssistantEntryId = latestAssistantEntryId(bridge?.sessionManager);
  decodeCoreAck(core.call("recordAgentDispatchBoundary", [{
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId"),
    ...(previousAssistantEntryId === undefined ? {} : {
      previous_assistant_entry_id: previousAssistantEntryId,
    }),
  }, ctx]));
}

async function cleanupUnacceptedStartChild(
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  prepared: Extract<PreparedAgentAction, { action: "agent_start" }>,
  ctx: unknown,
  authorizeCleanup: () => void,
  bridge?: ChildSessionBridge,
): Promise<void> {
  const agentId = stringField(prepared, "agentId");
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  if (bridge !== undefined) {
    authorizeCleanup();
    await applyChildSessionUpdate(childSessions, {
      action: "delete_child_session",
      key: agentId,
      reason: "unaccepted_start",
    }, bridge, keyScope);
  }
  authorizeCleanup();
  deleteAgentChildSession(core, agentId, ctx);
}

function rollbackUnacceptedStartState(
  core: CoreBridge,
  prepared: Extract<PreparedAgentAction, { action: "agent_start" }>,
  ctx: unknown,
  authorizeCleanup: () => void,
): void {
  authorizeCleanup();
  decodeCoreAck(core.call("rollbackUnacceptedAgentStart", [{
    agent_id: stringField(prepared, "agentId"),
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId"),
  }, ctx]));
}

function rollbackAgentSendPreflight(
  core: CoreBridge,
  prepared: Extract<PreparedAgentAction, { action: "agent_send" }>,
  ctx: unknown,
  revalidateAuthority: () => void,
): void {
  revalidateAuthority();
  decodeCoreAck(core.call("rollbackAgentSendPreflight", [{
    agent_id: stringField(prepared, "agentId"),
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId"),
    previous_submission_id: stringField(prepared, "previousSubmissionId"),
    ...(prepared.previousReasonCode === undefined ? {} : {
      previous_reason_code: prepared.previousReasonCode,
    }),
    outcome: prepared.outcome,
  }, ctx]));
}

async function createAgentChildSession(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  prepared: PreparedDispatchAction,
  ctx: unknown,
  revalidateAuthority: () => void,
  authorizeCleanup: () => void,
  childExtensionFactory?: (pi: PiLike) => void,
): Promise<ChildSessionBridge | undefined> {
  const metadata = prepared.metadata;
  if (!isObject(metadata)) return { error: "missing agent metadata" };
  let typedMetadata;
  try {
    typedMetadata = decodeChildSessionMetadata(metadata);
  } catch {
    return { error: "invalid agent metadata" };
  }
  const bridge = await createChildSession(pi, core, ctx, typedMetadata, childExtensionFactory);
  if (bridge === undefined || bridge.error !== undefined || bridge.missingSessionIdentifier) {
    return bridge;
  }
  const agentId = stringField(prepared, "agentId");
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  const cacheKey = childSessionCacheKey(agentId, keyScope);
  try {
    revalidateAuthority();
    childSessions.set(cacheKey, bridge);
    refreshOwnedChildPermissions(childSessions, ctx, core);
    revalidateAuthority();
    decodeCoreAck(core.call("recordAgentChildSessionStart", [{
      agent_id: agentId,
      ...(bridge.sessionId === undefined ? {} : { sessionId: bridge.sessionId }),
      ...(bridge.sessionFile === undefined ? {} : { sessionFile: bridge.sessionFile }),
    }, ctx]));
    return bridge;
  } catch (error) {
    childSessions.delete(cacheKey);
    let closeError: unknown;
    try {
      await bridge.close?.("stale_agent_action");
    } catch (failure) {
      closeError = failure;
    } finally {
      authorizeCleanup();
      deleteAgentChildSession(core, agentId, ctx);
    }
    throw closeError ?? error;
  }
}

export async function executeAgentPrepared(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  pendingAgentWaits: PendingAgentWaits,
  prepared: PreparedAgentAction,
  ctx: unknown,
  signal?: AbortSignal,
  childExtensionFactory?: (pi: PiLike) => void,
) {
  const action = prepared.action;
  let dispatchDeliverAs: "steer" | "followUp" | undefined;
  if (action === "agent_start") {
    const details = prepared.details;
    const metadata = prepared.metadata;
    const activeTools = Array.isArray(details.activeTools) ? details.activeTools : [];
    const metadataTools = Array.isArray(metadata.activeTools) ? metadata.activeTools : [];
    if (stringField(prepared, "agentId") !== stringField(details, "agentId")
      || stringField(prepared, "agentId") !== stringField(metadata as UnknownFields, "agentId")
      || stringField(prepared, "runId") !== stringField(details, "runId")
      || stringField(prepared, "prompt") !== stringField(details, "prompt")
      || stringField(prepared, "prompt").trim() === ""
      || stringField(details, "kind") !== stringField(metadata, "agentKind")
      || stringField(details, "model") !== stringField(metadata, "modelId")
      || stringField(details, "thinking") !== stringField(metadata, "thinkingLevel")
      || stringField(details, "workspace") !== stringField(metadata, "sourceWorkspace")
      || stringField(details, "isolation") !== stringField(metadata, "isolation")
      || JSON.stringify(activeTools) !== JSON.stringify(metadataTools)) {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent start state");
    }
  }
  if (action === "agent_send") {
    const rawDeliverAs = prepared.dispatchDeliverAs;
    if (rawDeliverAs !== "steer" && rawDeliverAs !== "followUp") {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent delivery mode");
    }
    dispatchDeliverAs = rawDeliverAs;
    const dispatch = prepared.dispatch === true;
    const outcome = stringField(prepared, "outcome");
    const prompt = stringField(prepared, "prompt");
    const runId = stringField(prepared, "runId");
    const submissionId = stringField(prepared, "submissionId");
    const details = isObject(prepared.details) ? prepared.details : {};
    const allowedOutcomes = dispatch
      ? ["message_sent", "interrupted_and_sent", "resumed", "started"]
      : ["suspended", "already_suspended", "no_active_run"];
    const metadata = prepared.metadata;
    if (!allowedOutcomes.includes(outcome)
      || typeof metadata !== "object" || metadata === null
      || stringField(prepared, "agentId") !== stringField(details, "agentId")
      || stringField(prepared, "agentId") !== stringField(metadata as UnknownFields, "agentId")
      || outcome !== stringField(details, "outcome")
      || runId !== stringField(details, "runId")
      || submissionId !== stringField(details, "submissionId")
      || (dispatch && (runId === "" || submissionId === "" || prompt.trim() === ""
        || stringField(details, "status") !== "running"))
      || ((outcome === "suspended" || outcome === "already_suspended")
        && (runId === "" || submissionId !== "" || prompt !== ""
          || prepared.interrupt !== true || stringField(details, "status") !== "suspended"))
      || (outcome === "no_active_run" && (runId !== "" || submissionId !== ""
        || prompt !== "" || prepared.interrupt !== true || stringField(details, "status") !== ""))
      || (outcome === "message_sent" && (prepared.interrupt !== false || rawDeliverAs !== "steer"))
      || (outcome === "interrupted_and_sent" && prepared.interrupt !== true)
      || ((outcome === "message_sent" || outcome === "interrupted_and_sent" || outcome === "resumed")
        && stringField(prepared, "previousSubmissionId") === "")
      || (outcome === "resumed" && !["interrupted_by_parent", "parent_shutdown", "process_interrupted", "close_cleanup_failed"]
        .includes(stringField(prepared, "previousReasonCode")))
      || (outcome === "started" && stringField(prepared, "previousSubmissionId") !== "")
      || (outcome !== "message_sent" && dispatch && rawDeliverAs !== "followUp")) {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent send state");
    }
  }
  if (action === "agent_close") {
    const details = isObject(prepared.details) ? prepared.details : {};
    const agentId = stringField(prepared, "agentId");
    const runIds = Array.isArray(prepared.runIds) ? prepared.runIds : [];
    const snapshot = decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [ctx]));
    const authoritativeRunIds = snapshot.runs
      .filter((run) => run.agentId === agentId)
      .map((run) => run.runId)
      .sort();
    const suppliedRunIds = runIds
      .filter((runId): runId is string => typeof runId === "string")
      .sort();
    if (agentId !== stringField(details, "agentId")
      || JSON.stringify(suppliedRunIds) !== JSON.stringify(authoritativeRunIds)) {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent close state");
    }
  }
  if (action === "agent_close" && prepared.deleteWorktree === true
    && (stringField(prepared, "worktreePath") === ""
      || stringField(prepared, "worktreeBranch") === ""
      || stringField(prepared, "mainRepositoryRoot") === ""
      || prepared.isolation !== "worktree")) {
    return agentErrorToolResult(core, "internal_error", "invalid prepared agent worktree cleanup");
  }
  const capabilityFacts = agentActionCapabilityFacts(prepared, ctx);
  const capabilityGuarded = capabilityFacts !== undefined;
  if (capabilityGuarded) {
    try {
      decodeCoreAck(core.call("claimAgentAction", [capabilityFacts!]));
    } catch (error) {
      return agentErrorToolResult(
        core, "persistence_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const revalidateCapability = () => {
    if (capabilityGuarded) {
      decodeCoreAck(core.call("revalidateAgentAction", [capabilityFacts!]));
    }
  };
  const authorizeCapabilityCleanup = () => {
    if (capabilityGuarded) {
      decodeCoreAck(core.call("authorizeAgentActionCleanup", [capabilityFacts!]));
    }
  };
  try {
    switch (action) {
    case "agent_start": {
      let bridge: ChildSessionBridge | undefined;
      const rollbackWorktreeThenState = async () => {
        try {
          await cleanupUnacceptedStartChild(
            core, childSessions, prepared, ctx, authorizeCapabilityCleanup, bridge,
          );
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        try {
          authorizeCapabilityCleanup();
          decodeCoreAck(core.call("rollbackAgentWorktreeStart", [{ agent_id: prepared.agentId }, ctx]));
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        try {
          rollbackUnacceptedStartState(
            core, prepared, ctx, authorizeCapabilityCleanup,
          );
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return undefined;
      };
      try {
        bridge = await createAgentChildSession(
          pi, core, childSessions, prepared, ctx, revalidateCapability,
          authorizeCapabilityCleanup, childExtensionFactory,
        );
        revalidateCapability();
      } catch (error) {
        const cleanupError = await rollbackWorktreeThenState();
        const message = cleanupError ?? (error instanceof Error ? error.message : String(error));
        return agentErrorToolResult(core, childFailureCode(message), message);
      }
      if (bridge?.error !== undefined || bridge?.missingSessionIdentifier) {
        const cleanupError = await rollbackWorktreeThenState();
        const message = cleanupError
          ?? bridge?.error
          ?? "failed to create child session";
        return agentErrorToolResult(core, childFailureCode(message), message);
      }
      try {
        recordDispatchBoundary(core, prepared, ctx, bridge);
      } catch (error) {
        const cleanupError = await rollbackWorktreeThenState();
        const message = cleanupError
          ?? (error instanceof Error ? error.message : String(error));
        return agentErrorToolResult(core, cleanupError ? childFailureCode(cleanupError) : "persistence_failed", message);
      }
      const dispatch = await sendToChildSession(
        pi,
        core,
        bridge,
        stringField(prepared, "prompt"),
        "no initial prompt",
        {
          awaitCompletion: false,
          onEvent: recordDispatchActivity(core, prepared, ctx),
          onCompletion: recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits, bridge),
        },
      );
      if (dispatch.dispatched !== true) {
        const cleanupError = await rollbackWorktreeThenState();
        const reason = cleanupError
          ?? (typeof dispatch.reason === "string"
            ? dispatch.reason
            : "initial message was not accepted");
        return agentErrorToolResult(core, cleanupError ? childFailureCode(cleanupError) : "dispatch_failed", reason);
      }
      try {
        authorizeCapabilityCleanup();
        decodeCoreAck(core.call("acceptAgentWorktreeStart", [{ agent_id: prepared.agentId }, ctx]));
      } catch (error) {
        const cleanupError = await rollbackWorktreeThenState();
        const message = cleanupError
          ?? (error instanceof Error ? error.message : String(error))
          ?? "failed to accept agent worktree";
        return agentErrorToolResult(core, childFailureCode(message), message);
      }
      return preparedToolResult(core, {
        text: stringField(prepared, "text"),
        details: prepared.details,
      });
    }
    case "agent_send": {
      const agentId = stringField(prepared, "agentId");
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      const interrupt = prepared.interrupt === true;
      let bridge = childSessions.get(childSessionCacheKey(agentId, keyScope));
      if (interrupt && stringField(prepared, "prompt") === "") {
        try {
          if (bridge?.stop !== undefined) {
            revalidateCapability();
            await bridge.stop("interrupted_by_parent");
          }
        } catch (error) {
          authorizeCapabilityCleanup();
          decodeCoreAck(core.call("rollbackFailedAgentInterruption", [{
            agent_id: agentId,
            run_id: stringField(prepared, "runId"),
          }, ctx]));
          const message = error instanceof Error ? error.message : String(error);
          return agentErrorToolResult(core, "dispatch_failed", `agent interruption failed: ${message}`);
        }
        authorizeCapabilityCleanup();
        return preparedToolResult(core, {
          text: stringField(prepared, "text"),
          details: prepared.details,
        });
      }
      const metadata = isObject(prepared.metadata) ? prepared.metadata : undefined;
      const workspace = metadata === undefined ? "" : stringField(metadata, "workspaceDirectory");
      if (workspace === "") {
        rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
        return agentErrorToolResult(core, "workspace_unavailable", "identity workspace is missing");
      }
      try {
        const fs = await import("node:fs/promises");
        if (!(await fs.stat(workspace)).isDirectory()) throw new Error("not a directory");
      } catch {
        rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
        return agentErrorToolResult(core, "workspace_unavailable", "identity workspace is unavailable");
      }
      revalidateCapability();
      if (bridge === undefined) {
        try {
          bridge = await createAgentChildSession(
            pi, core, childSessions, prepared, ctx, revalidateCapability,
            authorizeCapabilityCleanup, childExtensionFactory,
          );
          revalidateCapability();
        } catch (error) {
          rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          return agentErrorToolResult(
            core,
            "child_session_unavailable",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      if (bridge === undefined || bridge.error !== undefined || bridge.missingSessionIdentifier) {
        rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
        return agentErrorToolResult(core, "child_session_unavailable", bridge?.error ?? "failed to reopen child session");
      }
      try {
        recordDispatchBoundary(core, prepared, ctx, bridge);
      } catch (error) {
        rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
        return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
      }
      if (interrupt && bridge.stop !== undefined) {
        try {
          revalidateCapability();
          await bridge.stop("interrupted_by_parent");
        } catch (error) {
          rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          return agentErrorToolResult(
            core,
            "dispatch_failed",
            `agent interruption failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        try {
          revalidateCapability();
        } catch (error) {
          authorizeCapabilityCleanup();
          decodeCoreAck(core.call("recordAgentSendDispatchFailure", [{
            run_id: stringField(prepared, "runId"),
            submission_id: stringField(prepared, "submissionId"),
            error: error instanceof Error ? error.message : String(error),
          }, ctx]));
          return agentErrorToolResult(
            core, "persistence_failed",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      if (prepared.dispatch === true) {
        revalidateCapability();
        const dispatch = await sendToChildSession(
          pi,
          core,
          bridge,
          stringField(prepared, "prompt"),
          "empty prompt",
          {
            awaitCompletion: false,
            deliverAs: dispatchDeliverAs!,
            onEvent: recordDispatchActivity(core, prepared, ctx),
            onCompletion: recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits, bridge),
          },
        );
        if (dispatch.dispatched !== true) {
          const reason = typeof dispatch.reason === "string"
            ? dispatch.reason
            : "agent message was not accepted";
          if (interrupt && stringField(prepared, "outcome") === "interrupted_and_sent") {
            authorizeCapabilityCleanup();
            decodeCoreAck(core.call("recordAgentSendDispatchFailure", [{
              run_id: stringField(prepared, "runId"),
              submission_id: stringField(prepared, "submissionId"),
              error: reason,
            }, ctx]));
          } else {
            rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          }
          return agentErrorToolResult(core, "dispatch_failed", reason);
        }
        authorizeCapabilityCleanup();
      }
      return preparedToolResult(core, {
        text: stringField(prepared, "text"),
        details: prepared.details,
      });
    }
    case "agent_wait": {
      const runIds = Array.isArray(prepared.runIds)
        ? prepared.runIds.filter((value): value is string => typeof value === "string")
        : [];
      const timeoutSeconds =
        typeof prepared.timeoutSeconds === "number" ? prepared.timeoutSeconds : undefined;
      const controllers: AbortController[] = [];
      for (const runId of runIds) {
        const controller = new AbortController();
        controllers.push(controller);
        const key = pendingAgentWaitKey(ctx, runId);
        const claims = pendingAgentWaits.get(key) ?? new Set<AbortController>();
        claims.add(controller);
        pendingAgentWaits.set(key, claims);
      }
      const clearClaims = () => {
        for (let index = 0; index < runIds.length; index += 1) {
          const key = pendingAgentWaitKey(ctx, runIds[index]);
          const claims = pendingAgentWaits.get(key);
          if (claims === undefined) continue;
          claims.delete(controllers[index]);
          if (claims.size === 0) pendingAgentWaits.delete(key);
        }
      };
      const closed = () => controllers.some((controller) => controller.signal.aborted);
      const cancelledByClose = () => agentErrorToolResult(
        core, "run_not_found", "one or more selected runs no longer exist",
      );
      try {
        if (closed()) return cancelledByClose();
        if (signal?.aborted) {
          clearClaims();
          return agentErrorToolResult(core, "internal_error", "agent_wait was interrupted");
        }
        const started = Date.now();
        while (true) {
          const finished = decodePreparedToolAction(
            core.call("finishAgentWait", [{ run_ids: runIds }, ctx]),
          );
          if (finished.ok === false) {
            if (closed()) return cancelledByClose();
            return agentErrorToolResult(core, "run_not_found", finished.error);
          }
          if (finished.ok === true && finished.action === "tool_result") {
            clearClaims();
            return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{ prepared: finished, extraDetails: {} }]));
          }
          if (timeoutSeconds !== undefined) {
            const elapsed = (Date.now() - started) / 1000;
            if (elapsed >= timeoutSeconds) {
              clearClaims();
              const payload = { timed_out: true, results: [], pending_run_ids: runIds };
              return preparedToolResult(core, { text: JSON.stringify(payload), details: payload });
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (closed()) return cancelledByClose();
          if (signal?.aborted) {
            clearClaims();
            return agentErrorToolResult(core, "internal_error", "agent_wait was interrupted");
          }
        }
      } finally {
        clearClaims();
      }
    }
    case "agent_close": {
      const agentId = stringField(prepared, "agentId");
      cancelAgentApprovals(sessionInfoFromContext(ctx).sessionId, agentId);
      const runIds = Array.isArray(prepared.runIds)
        ? prepared.runIds.filter((value): value is string => typeof value === "string")
        : [];
      for (const runId of runIds) {
        const waitKey = pendingAgentWaitKey(ctx, runId);
        for (const controller of pendingAgentWaits.get(waitKey) ?? []) {
          controller.abort();
        }
        pendingAgentWaits.delete(waitKey);
      }
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      const key = childSessionCacheKey(agentId, keyScope);
      const bridge = childSessions.get(key);
      let childExecutionInterrupted = false;
      const failClose = (code: string, message: string) => {
        let transitionError = "";
        // Only pre-tombstone interruptions need suspended/close_cleanup_failed.
        // After durable permanent close, cleanup retries use the tombstone path.
        if (childExecutionInterrupted && !/unknown agent:/.test(message)) {
          try {
            authorizeCapabilityCleanup();
            decodeCoreAck(core.call("recordAgentCloseCleanupFailure", [{ agent_id: agentId }, ctx]));
          } catch (error) {
            transitionError = error instanceof Error ? error.message : String(error);
          }
        }
        const fullMessage = transitionError === "" ? message : `${message}; ${transitionError}`;
        return agentErrorToolResult(core, code, fullMessage);
      };
      try {
        revalidateCapability();
        // Cancel identity-owned broker sessions before cleanliness/removal inspection.
        try {
          decodeCoreAck(core.call("cancelAgentBrokerSessions", [{ agent_id: agentId }]));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return agentErrorToolResult(core, "cleanup_failed", message || "broker session cancellation failed");
        }
        // Stop child execution first, but keep private session files until worktree
        // cleanup succeeds so close remains retryable on cleanup_failed.
        if (bridge?.stop !== undefined) {
          try {
            revalidateCapability();
            childExecutionInterrupted = true;
            await bridge.stop("agent_closed");
            revalidateCapability();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return failClose("cleanup_failed", `agent stop failed: ${message}`);
          }
        }
        if (prepared.deleteWorktree === true) {
          try {
            revalidateCapability();
            decodeCoreAck(core.call("deleteAgentWorktree", [{ agent_id: agentId }, ctx]));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return failClose("cleanup_failed", message || "worktree deletion failed");
          }
        }
        if (bridge !== undefined) childExecutionInterrupted = true;
        // Drop only the live bridge. finishAgentClose stages and finalizes the
        // private session while the identity is still listed, then removes durable
        // state. Physical failure unstages and retains identity + exact session.
        revalidateCapability();
        await applyChildSessionUpdate(childSessions, {
          action: "delete_child_session",
          key: agentId,
          reason: "agent_closed",
        }, bridge, keyScope);
        revalidateCapability();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failClose("cleanup_failed", `agent_close cleanup failed: ${message}`);
      }
      let finished;
      try {
        revalidateCapability();
        finished = decodeCoreAck(core.call("finishAgentClose", [{ agent_id: agentId }, ctx]));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failClose(
          /cleanup_failed/.test(message) ? "cleanup_failed" : "persistence_failed",
          message,
        );
      }
      if (finished.ok !== true) {
        return failClose("persistence_failed", "agent close state removal failed");
      }
      return preparedToolResult(core, {
        text: stringField(prepared, "text"),
        details: prepared.details,
      });
    }
    default:
      return agentErrorToolResult(core, "internal_error", `unknown agent action: ${action}`);
    }
  } catch (error) {
    return agentErrorToolResult(
      core, "persistence_failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (capabilityGuarded) {
      try {
        decodeCoreAck(core.call("releaseAgentAction", [capabilityFacts!]));
      } catch {
        // The capability is already one-shot; release is best-effort after execution.
      }
    }
  }
}

export function countActiveChildRuns(core: CoreBridge, ctx: unknown): number {
  try {
    return decodeAgentActiveCountResult(core.call("countActiveChildRuns", [ctx])).count;
  } catch {
    return 0;
  }
}

async function noninteractiveTurnDrain(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
): Promise<void> {
  if (!isObject(ctx)) return;
  if (ctx.mode !== "print" && ctx.mode !== "json") return;
  if (typeof pi.sendMessage !== "function") return;
  const drainKey = sessionInfoFromContext(ctx).sessionId ?? "current";
  if (activeNoninteractiveDrains.has(drainKey)) return;
  activeNoninteractiveDrains.add(drainKey);
  try {
    // Flush each completion as it appears. Triggered parent continuations can
    // spawn more work, so active runs are deliberately re-enumerated.
    while (true) {
      const sent = await flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits);
      // Let an accepted triggered turn run before deciding what work remains.
      if (sent > 0) return;
      if (countActiveChildRuns(core, ctx) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    activeNoninteractiveDrains.delete(drainKey);
  }
}

export function installAgentLifecycle(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  pendingAgentWaits: PendingAgentWaits,
): void {
  const reconcileAfterLoad = (_event: unknown, ctx: unknown) => {
    setTimeout(() => {
      try {
        decodeCoreAck(core.call("reconcileProvisionalAgentWorktrees", []));
      } catch {
        /* best-effort provisional worktree reclaim */
      }
      reconcilePersistedAgentNotifications(core, ctx);
      if (!isObject(ctx) || ctx.hasUI !== true || !isObject(ctx.ui)) return;
      const notify = ctx.ui.notify;
      if (typeof notify !== "function") return;
      const diagnostics = decodeAgentRoutingDiagnosticsResult(
        core.call("agentRoutingDiagnostics", []),
      ).diagnostics;
      for (const diagnostic of diagnostics) {
        notify.call(ctx.ui, diagnostic, "warning");
      }
    }, 0);
  };
  pi.on("session_start", reconcileAfterLoad);
  pi.on("session_switch", reconcileAfterLoad);
  pi.on("session_fork", reconcileAfterLoad);
  pi.on("session_shutdown", async (_event, ctx) => {
    const shutdown = async () => {
      const info = sessionInfoFromContext(ctx);
      const agents = decodeAgentCleanupPlan(
        core.call("ephemeralAgentCleanupPlan", [ctx]),
      ).agents;
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      if (info.sessionFile === undefined) {
        for (const agent of agents) {
          const agentId = agent.agentId;
          if (agentId === "") continue;
          await applyChildSessionUpdate(childSessions, {
            action: "delete_child_session",
            key: agentId,
            reason: "parent_shutdown",
          }, undefined, keyScope);
        }
        // A process lease prevents another reconciler from promoting prepared
        // ephemeral tombstones until this shutdown transaction has removed the
        // in-process identities or rolled staging back.
        try {
          decodeCoreAck(core.call("finishEphemeralAgentCleanup", [ctx]));
        } finally {
          decodeCoreAck(core.call("releaseEphemeralAgentCleanupLease", [ctx]));
        }
        return;
      }
      decodeCoreAck(core.call("suspendOwnerAgentsOnShutdown", [ctx]));
      for (const agent of agents) {
        const agentId = agent.agentId;
        if (agentId === "") continue;
        await applyChildSessionUpdate(childSessions, {
          action: "stop_child_session",
          key: agentId,
          reason: "parent_shutdown",
        }, undefined, keyScope);
      }
    };
    try {
      await shutdown();
    } catch (error) {
      if (!isStaleContextError(error)) {
        console.warn("Taumel agent shutdown suspend failed:", error);
      }
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    try {
      await flushPendingAgentNotifications(pi, core, ctx, "steer", pendingAgentWaits);
      await noninteractiveTurnDrain(pi, core, ctx, pendingAgentWaits);
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
      void noninteractiveTurnDrain(pi, core, ctx, pendingAgentWaits).catch((error) => {
        if (isStaleContextError(error)) return;
        console.warn("Taumel agent noninteractive drain failed:", error);
      });
    }, 0);
  });
}
