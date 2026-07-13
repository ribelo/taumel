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
  latestAssistantEntryId,
  refreshOwnedChildPermissions,
  sendToChildSession,
} from "./child-sessions.ts";
import { errorToolResult, preparedToolResult } from "./tool-results.ts";
import {
  decodeAgentActiveCountResult,
  decodeAgentCleanupPlan,
  decodeAgentNotificationClaimValidation,
  decodeAgentRoutingDiagnosticsResult,
  decodeCoreAck,
  decodePendingAgentNotificationsResult,
  decodePreparedToolAction,
  decodeToolResultEnvelope,
} from "./bridge-contracts.ts";

type UnknownFields = { readonly [key: string]: unknown };

type PendingAgentWaits = Map<string, Set<AbortController>>;
const activeNoninteractiveDrains = new Set<string>();

function isObject(value: unknown): value is UnknownFields {
  return typeof value === "object" && value !== null;
}

function stringField(value: UnknownFields, key: string): string {
  const raw = value[key];
  return typeof raw === "string" ? raw : "";
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
  const isAgentChild = entries.some((entry) => {
    if (!isObject(entry)) return false;
    return entry.type === "custom" && entry.customType === "taumel.childSession";
  });
  if (isAgentChild) return;
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
        stringField(notification, "content"),
        stringField(notification, "customType") || "notification",
        notification.display === true,
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
  prepared: UnknownFields,
  ctx: unknown,
  pendingAgentWaits: PendingAgentWaits,
  bridge: ChildSessionBridge | undefined,
) {
  return async (dispatch: UnknownFields) => {
    const completion = isObject(dispatch.completion) ? dispatch.completion : undefined;
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

async function rollbackUnacceptedStart(
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  prepared: UnknownFields,
  ctx: unknown,
  bridge?: ChildSessionBridge,
): Promise<void> {
  const agentId = stringField(prepared, "agentId");
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  if (bridge !== undefined) {
    await applyChildSessionUpdate(childSessions, {
      action: "delete_child_session",
      key: agentId,
      reason: "unaccepted_start",
    }, bridge, keyScope);
    if (typeof bridge.sessionFile === "string" && bridge.sessionFile !== "") {
      try {
        const fs = await import("node:fs/promises");
        await fs.rm(bridge.sessionFile, { force: true });
      } catch {
        // Best-effort physical cleanup after authoritative state rollback.
      }
    }
  }
  decodeCoreAck(core.call("rollbackUnacceptedAgentStart", [{
    agent_id: agentId,
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId"),
  }, ctx]));
}

function rollbackAgentSendPreflight(
  core: CoreBridge,
  prepared: UnknownFields,
  ctx: unknown,
): void {
  decodeCoreAck(core.call("rollbackAgentSendPreflight", [{
    agent_id: stringField(prepared, "agentId"),
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId"),
    previous_submission_id: stringField(prepared, "previousSubmissionId"),
    previous_reason_code: stringField(prepared, "previousReasonCode"),
    outcome: stringField(prepared, "outcome"),
  }, ctx]));
}

async function createAgentChildSession(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  prepared: UnknownFields,
  ctx: unknown,
): Promise<ChildSessionBridge | undefined> {
  const metadata = prepared.metadata;
  if (!isObject(metadata)) return { error: "missing agent metadata" };
  const bridge = await createChildSession(pi, core, ctx, metadata as never);
  if (bridge === undefined || bridge.error !== undefined || bridge.missingSessionIdentifier) {
    return bridge;
  }
  const agentId = stringField(prepared, "agentId");
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  childSessions.set(childSessionCacheKey(agentId, keyScope), bridge);
  refreshOwnedChildPermissions(childSessions, ctx);
  decodeCoreAck(core.call("recordAgentChildSessionStart", [{
    agent_id: agentId,
    sessionId: bridge.sessionId,
    sessionFile: bridge.sessionFile,
  }, ctx]));
  return bridge;
}

export async function executeAgentPrepared(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  pendingAgentWaits: PendingAgentWaits,
  prepared: UnknownFields,
  ctx: unknown,
  signal?: AbortSignal,
) {
  const action = stringField(prepared, "action");
  switch (action) {
    case "agent_start": {
      const bridge = await createAgentChildSession(pi, core, childSessions, prepared, ctx);
      if (bridge?.error !== undefined || bridge?.missingSessionIdentifier) {
        await rollbackUnacceptedStart(core, childSessions, prepared, ctx, bridge);
        return errorToolResult(core, bridge?.error ?? "failed to create child session", {
          ok: false,
          error: bridge?.error ?? "failed to create child session",
        });
      }
      const dispatch = await sendToChildSession(
        pi,
        core,
        bridge,
        stringField(prepared, "prompt"),
        "no initial prompt",
        {
          awaitCompletion: false,
          onCompletion: recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits, bridge),
        },
      );
      if (dispatch.dispatched !== true) {
        await rollbackUnacceptedStart(core, childSessions, prepared, ctx, bridge);
        const reason = typeof dispatch.reason === "string"
          ? dispatch.reason
          : "initial message was not accepted";
        return errorToolResult(core, reason, { ok: false, error: reason });
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
            await bridge.stop("interrupted_by_parent");
          }
        } catch (error) {
          decodeCoreAck(core.call("rollbackFailedAgentInterruption", [{
            agent_id: agentId,
            run_id: stringField(prepared, "runId"),
          }, ctx]));
          const message = error instanceof Error ? error.message : String(error);
          return errorToolResult(core, `agent interruption failed: ${message}`, {
            ok: false,
            error: message,
          });
        }
        return preparedToolResult(core, {
          text: stringField(prepared, "text"),
          details: prepared.details,
        });
      }
      const metadata = isObject(prepared.metadata) ? prepared.metadata : undefined;
      const workspace = metadata === undefined ? "" : stringField(metadata, "workspaceDirectory");
      if (workspace === "") {
        rollbackAgentSendPreflight(core, prepared, ctx);
        return errorToolResult(core, "identity_workspace_missing", {
          ok: false,
          error: "identity_workspace_missing",
        });
      }
      try {
        const fs = await import("node:fs/promises");
        if (!(await fs.stat(workspace)).isDirectory()) throw new Error("not a directory");
      } catch {
        rollbackAgentSendPreflight(core, prepared, ctx);
        return errorToolResult(core, "identity_workspace_unavailable", {
          ok: false,
          error: "identity_workspace_unavailable",
        });
      }
      if (bridge === undefined) {
        bridge = await createAgentChildSession(pi, core, childSessions, prepared, ctx);
      }
      if (bridge === undefined || bridge.error !== undefined || bridge.missingSessionIdentifier) {
        rollbackAgentSendPreflight(core, prepared, ctx);
        return errorToolResult(core, bridge?.error ?? "failed to reopen child session", {
          ok: false,
          error: bridge?.error ?? "failed to reopen child session",
        });
      }
      if (interrupt && bridge.stop !== undefined) {
        await bridge.stop("interrupted_by_parent");
      }
      if (prepared.dispatch === true) {
        const dispatch = await sendToChildSession(
          pi,
          core,
          bridge,
          stringField(prepared, "prompt"),
          "empty prompt",
          {
            awaitCompletion: false,
            deliverAs: stringField(prepared, "dispatchDeliverAs") || "followUp",
            onCompletion: recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits, bridge),
          },
        );
        if (dispatch.dispatched !== true) {
          const reason = typeof dispatch.reason === "string"
            ? dispatch.reason
            : "agent message was not accepted";
          if (interrupt && stringField(prepared, "outcome") === "interrupted_and_sent") {
            decodeCoreAck(core.call("recordAgentSendDispatchFailure", [{
              run_id: stringField(prepared, "runId"),
              submission_id: stringField(prepared, "submissionId"),
              error: reason,
            }, ctx]));
          } else {
            rollbackAgentSendPreflight(core, prepared, ctx);
          }
          return errorToolResult(core, reason, { ok: false, error: reason });
        }
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
      const cancelledByClose = () => errorToolResult(
        core,
        "agent_wait cancelled because a selected run was closed",
        { ok: false, error: "agent_closed" },
      );
      try {
        if (closed()) return cancelledByClose();
        if (signal?.aborted) {
          clearClaims();
          return errorToolResult(core, "agent_wait interrupted", { ok: false, error: "interrupted" });
        }
        const started = Date.now();
        while (true) {
          const finished = decodePreparedToolAction(
            core.call("finishAgentWait", [{ run_ids: runIds }, ctx]),
          );
          if (finished.ok === false) {
            if (closed()) return cancelledByClose();
            return errorToolResult(core, finished.error, finished);
          }
          if (finished.ok === true && finished.action === "tool_result") {
            clearClaims();
            return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{ prepared: finished, extraDetails: {} }]));
          }
          if (timeoutSeconds !== undefined) {
            const elapsed = (Date.now() - started) / 1000;
            if (elapsed >= timeoutSeconds) {
              clearClaims();
              return preparedToolResult(core, {
                text: `agent_wait timed out\npending_run_ids=${runIds.join(",")}`,
                details: {
                  ok: true,
                  timed_out: true,
                  results: [],
                  pending_run_ids: runIds,
                },
              });
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (closed()) return cancelledByClose();
          if (signal?.aborted) {
            clearClaims();
            return errorToolResult(core, "agent_wait interrupted", { ok: false, error: "interrupted" });
          }
        }
      } finally {
        clearClaims();
      }
    }
    case "agent_close": {
      const agentId = stringField(prepared, "agentId");
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
      try {
        await applyChildSessionUpdate(childSessions, {
          action: "delete_child_session",
          key: agentId,
          reason: "agent_closed",
        }, bridge, keyScope);
        const sessionFile = prepared.childSessionFile;
        if (typeof sessionFile === "string" && sessionFile !== "") {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const directory = path.dirname(sessionFile);
          if (path.basename(directory) === agentId) {
            await fs.rm(directory, { recursive: true, force: true });
          } else {
            await fs.rm(sessionFile, { force: true });
          }
        }
      } catch (error) {
        decodeCoreAck(core.call("releaseAgentClose", [{ agent_id: agentId }]));
        const message = error instanceof Error ? error.message : String(error);
        return errorToolResult(core, `agent_close cleanup failed: ${message}`, {
          ok: false,
          error: message,
        });
      }
      const finished = decodeCoreAck(core.call("finishAgentClose", [{ agent_id: agentId }, ctx]));
      if (finished.ok !== true) {
        decodeCoreAck(core.call("releaseAgentClose", [{ agent_id: agentId }]));
        const message = "agent close state removal failed";
        return errorToolResult(core, message, finished);
      }
      return preparedToolResult(core, {
        text: stringField(prepared, "text"),
        details: prepared.details,
      });
    }
    default:
      return errorToolResult(core, `unknown agent action: ${action}`, { ok: false, error: action });
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
          const sessionFile = agent.childSessionFile ?? "";
          if (sessionFile !== "") {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            const directory = path.dirname(sessionFile);
            if (path.basename(directory) === agentId) {
              await fs.rm(directory, { recursive: true, force: true });
            } else {
              await fs.rm(sessionFile, { force: true });
            }
          }
        }
        decodeCoreAck(core.call("finishEphemeralAgentCleanup", [ctx]));
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
