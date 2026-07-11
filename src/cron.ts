import type { CoreBridge, PiLike } from "./types.ts";
import { contextIsLive, extensionRuntimeIsLive, isStaleContextError } from "./util.ts";
import { decodeCronDeliveredResult, decodeCronGoalCreationResult, decodeCronGoalFacts, decodeCronPollPlan, decodeCronStartupPlan, type CronPollPlan } from "./bridge-contracts.ts";

type CronMessageDetails = {
  readonly id: string; readonly cron: string; readonly schedule: string;
  readonly coalesced: number; readonly prompt: string; readonly goalCreated?: boolean;
};
type CronUi = { notify: (message: string, level: "warning") => unknown };
type CronContext = { ui?: unknown };
type SessionStartEvent = { reason?: unknown };

function canSend(pi: PiLike): boolean {
  return typeof pi.sendMessage === "function";
}

async function sendCronMessage(
  pi: PiLike,
  content: string,
  deliveryKind: "trigger" | "steer",
  coalesced: number,
  details?: CronMessageDetails,
): Promise<boolean> {
  const prefix = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n` : "[cron]\n";
  const options = deliveryKind === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" };
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({
      customType: "taumel.cron.fire",
      content: `${prefix}${content}`,
      display: true,
      ...(details === undefined ? {} : { details }),
    }, options);
    return true;
  }
  return false;
}

async function deliverCron(
  pi: PiLike,
  core: CoreBridge,
  delivery: Extract<CronPollPlan, { kind: "deliver" }>,
  ctx: unknown,
  deliveryKind: "trigger" | "steer",
): Promise<boolean> {
  if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return false;
  const mode = delivery.mode;
  const content = delivery.content;
  const coalesced = delivery.coalesced;
  const cronDetails: CronMessageDetails = {
    id: delivery.id,
    cron: delivery.cron,
    schedule: delivery.schedule,
    coalesced,
    prompt: content,
  };
  if (mode !== "goal") {
    return await sendCronMessage(pi, content, deliveryKind, coalesced, cronDetails);
  }

  const objective = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n${content}` : content;
  const result = decodeCronGoalCreationResult(core.call("createCronGoal", [{ objective, ctx }]));
  if (!result.created) {
    return await sendCronMessage(pi, content, deliveryKind, coalesced, cronDetails);
  }
  return await sendCronMessage(pi, content, deliveryKind, coalesced, {
    ...cronDetails,
    goalCreated: true,
  });
}

function notify(ctx: unknown, message: string): void {
  if (typeof ctx !== "object" || ctx === null) return;
  const ui = (ctx as CronContext).ui;
  if (typeof ui !== "object" || ui === null) return;
  const candidate = ui as Partial<CronUi>;
  if (typeof candidate.notify === "function") candidate.notify.call(ui, message, "warning");
}

export function installCronLoop(pi: PiLike, core: CoreBridge): void {
  if (!canSend(pi)) return;
  let latestCtx: unknown;
  let pollInFlight = false;
  let stopped = false;
  let generation = 0;

  const rememberCtx = (ctx: unknown): boolean => {
    generation += 1;
    if (!contextIsLive(ctx)) {
      latestCtx = undefined;
      return false;
    }
    latestCtx = ctx;
    return true;
  };

  const poll = async (deliveryKind: "trigger" | "steer" = "trigger") => {
    if (stopped) return;
    if (pollInFlight) return;
    pollInFlight = true;
    const ctx = latestCtx;
    const pollGeneration = generation;
    try {
      if (ctx === undefined) return;
      if (!extensionRuntimeIsLive(pi)) return;
      if (!contextIsLive(ctx)) {
        if (latestCtx === ctx) latestCtx = undefined;
        return;
      }
      const goalFacts = decodeCronGoalFacts(core.call("cronGoalFacts", [{ ctx }]));
      const goalSlotFree = goalFacts.goalSlotFree;
      const goalDriving = goalFacts.goalDriving;
      const plan = decodeCronPollPlan(core.call("cronPoll", [{
        now: Date.now(),
        hostIdle: typeof pi.isIdle === "function" ? pi.isIdle() : true,
        goalDriving,
        goalSlotFree,
        ctx,
      }]));
      if (stopped || generation !== pollGeneration) return;
      if (plan.kind === "deliver") {
        const delivered = await deliverCron(pi, core, plan, ctx, deliveryKind);
        if (stopped || generation !== pollGeneration) return;
        if (!delivered) return;
        decodeCronDeliveredResult(core.call("cronDelivered", [{ id: plan.id, now: Date.now(), ctx }]));
      }
    } catch (error) {
      if (isStaleContextError(error)) {
        if (latestCtx === ctx) latestCtx = undefined;
        return;
      }
      throw error;
    } finally {
      pollInFlight = false;
    }
  };

  const timer = setInterval(() => void poll().catch((error) => console.warn("Taumel cron poll failed:", error)), 30_000);
  timer.unref?.();

  pi.on("session_start", (event, ctx) => {
    if (stopped) return;
    if (!extensionRuntimeIsLive(pi)) return;
    if (!rememberCtx(ctx)) return;
    const source = typeof event === "object" && event !== null ? event as SessionStartEvent : undefined;
    const reason = typeof source?.reason === "string" ? source.reason : "";
    const result = decodeCronStartupPlan(core.call("cronStartup", [{ reason, ctx }]));
    if (result.kind === "notify") notify(ctx, result.message);
  });
  pi.on("turn_start", (_event, ctx) => {
    if (!stopped && extensionRuntimeIsLive(pi)) rememberCtx(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    if (stopped) return;
    if (!extensionRuntimeIsLive(pi)) return;
    rememberCtx(ctx);
    const scheduledGeneration = generation;
    setTimeout(() => {
      if (stopped || generation !== scheduledGeneration) return;
      void poll("trigger").catch((error) => console.warn("Taumel cron agent_end poll failed:", error));
    }, 0);
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    latestCtx = undefined;
    generation += 1;
    clearInterval(timer);
  });
}
