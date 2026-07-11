import type { CoreBridge, PiLike } from "./types.ts";
import {
  contextIsLive,
  isStaleContextError,
  sessionInfoFromContext,
} from "./util.ts";
import {
  decodeExecNotificationClaim,
  decodePendingExecNotificationsResult,
} from "./bridge-contracts.ts";

type DeliveryMode = "steer" | "trigger";
type IdleContext = { isIdle: () => unknown };

function idleContext(value: unknown): IdleContext | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<IdleContext>;
  return typeof candidate.isIdle === "function" ? candidate as IdleContext : undefined;
}

function parentIsIdle(ctx: unknown): boolean {
  const candidate = idleContext(ctx);
  return candidate?.isIdle.call(ctx) === true;
}

async function deliver(
  pi: PiLike,
  content: string,
  customType: string,
  display: boolean,
  mode: DeliveryMode,
): Promise<boolean> {
  if (typeof pi.sendMessage !== "function") return false;
  await pi.sendMessage(
    { customType, content, display },
    mode === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" },
  );
  return true;
}

export async function flushPendingExecNotifications(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  mode: DeliveryMode,
): Promise<void> {
  if (!contextIsLive(ctx)) return;
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  const { notifications } = decodePendingExecNotificationsResult(
    core.call("pendingExecNotifications", [ownerId]),
  );
  for (const notification of notifications) {
    const sessionId = notification.session_id;
    const claim = decodeExecNotificationClaim(
      core.call("claimExecNotificationDelivery", [ownerId, sessionId]),
    );
    if (claim.kind === "unavailable") continue;
    try {
      const sent = await deliver(pi, claim.content, claim.customType, claim.display, mode);
      core.call(sent ? "markExecNotificationDelivered" : "releaseExecNotificationDelivery", [sessionId]);
    } catch (error) {
      core.call("releaseExecNotificationDelivery", [sessionId]);
      throw error;
    }
  }
}

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
  if (parentIsIdle(ctx)) await flushPendingExecNotifications(pi, core, ctx, "trigger");
}

export function installExecNotificationLifecycle(pi: PiLike, core: CoreBridge): void {
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined) core.call("shutdownExecOwner", [ownerId]);
  });

  pi.on("turn_end", async (_event, ctx) => {
    try {
      await flushPendingExecNotifications(pi, core, ctx, "steer");
    } catch (error) {
      if (isStaleContextError(error)) return;
      console.warn("Taumel exec turn_end notification flush failed:", error);
    }
  });

  pi.on("agent_end", (_event, ctx) => {
    setTimeout(() => {
      void flushPendingExecNotifications(pi, core, ctx, "trigger").catch((error) => {
        if (isStaleContextError(error)) return;
        console.warn("Taumel exec agent_end notification flush failed:", error);
      });
    }, 0);
  });
}
