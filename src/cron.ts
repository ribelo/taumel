import type { CoreBridge, PiLike } from "./types.ts";
import { contextIsLive, coreCallOptionalRecord, extensionRuntimeIsLive, isRecord, isStaleContextError, stringField } from "./util.ts";

function canSend(pi: PiLike): boolean {
  return typeof pi.sendMessage === "function" || typeof pi.sendUserMessage === "function";
}

async function sendCronMessage(
  pi: PiLike,
  content: string,
  deliveryKind: "trigger" | "steer",
  coalesced: number,
): Promise<boolean> {
  const prefix = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n` : "[cron]\n";
  const options = deliveryKind === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" };
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType: "taumel.cron.fire", content: `${prefix}${content}`, display: true }, options);
    return true;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(`${prefix}${content}`, options);
    return true;
  }
  return false;
}

async function deliverCron(
  pi: PiLike,
  core: CoreBridge,
  delivery: Record<string, unknown>,
  ctx: unknown,
  deliveryKind: "trigger" | "steer",
): Promise<boolean> {
  if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return false;
  const mode = stringField(delivery, "mode");
  const content = stringField(delivery, "content");
  const coalesced = typeof delivery["coalesced"] === "number" ? delivery["coalesced"] as number : 1;
  if (mode !== "goal") {
    return await sendCronMessage(pi, content, deliveryKind, coalesced);
  }

  const objective = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n${content}` : content;
  const result = coreCallOptionalRecord(core, "prepareTool", ["create_goal", { objective }, ctx]);
  if (result === undefined || result["ok"] !== true) {
    return await sendCronMessage(pi, content, deliveryKind, coalesced);
  }
  const plan = coreCallOptionalRecord(core, "planGoalContinuation", [true, {
    hostIdle: true,
    hasPendingMessages: false,
    retrying: false,
    compacting: false,
  }, {}, ctx]);
  if (plan === undefined || stringField(plan, "action") !== "send_goal_continuation") return false;
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({
      customType: stringField(plan, "customType"),
      content: stringField(plan, "content"),
      display: plan["display"] === true,
    }, {
      triggerTurn: plan["triggerTurn"] === true,
      deliverAs: stringField(plan, "deliverAs"),
    });
    return true;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(stringField(plan, "content"), { deliverAs: stringField(plan, "deliverAs") });
    return true;
  }
  return false;
}

function notify(ctx: unknown, message: string): void {
  if (!isRecord(ctx) || !isRecord(ctx["ui"])) return;
  const fn = ctx["ui"]["notify"];
  if (typeof fn === "function") fn.call(ctx["ui"], message, "warning");
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
      const goalFacts = coreCallOptionalRecord(core, "cronGoalFacts", [ctx]);
      const goalSlotFree = goalFacts?.["goalSlotFree"] === true;
      const goalDriving = goalFacts?.["goalDriving"] === true;
      const plan = coreCallOptionalRecord(core, "cronPoll", [{
        now: Date.now(),
        hostIdle: typeof pi.isIdle === "function" ? pi.isIdle() : true,
        goalDriving,
        goalSlotFree,
      }, ctx]);
      if (stopped || generation !== pollGeneration) return;
      if (plan !== undefined && stringField(plan, "action") === "deliver") {
        const delivered = await deliverCron(pi, core, plan, ctx, deliveryKind);
        if (stopped || generation !== pollGeneration) return;
        if (!delivered) return;
        core.call("cronDelivered", [{ id: stringField(plan, "id"), now: Date.now() }, ctx]);
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
    const result = coreCallOptionalRecord(core, "cronStartup", [event, ctx]);
    if (result !== undefined && result["notify"] === true) notify(ctx, stringField(result, "message"));
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
