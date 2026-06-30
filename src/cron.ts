import type { CoreBridge, PiLike } from "./types.ts";
import { coreCall, isRecord, stringField } from "./util.ts";

function canSend(pi: PiLike): boolean {
  return typeof pi.sendMessage === "function" || typeof pi.sendUserMessage === "function";
}

async function sendCronMessage(pi: PiLike, content: string, mode: string, coalesced: number): Promise<void> {
  const prefix = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n` : "[cron]\n";
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType: "taumel.cron.fire", content: `${prefix}${content}`, display: true }, { triggerTurn: true });
    return;
  }
  await pi.sendUserMessage?.(`${prefix}${content}`, { triggerTurn: true, deliverAs: mode === "steer" ? "steer" : undefined });
}

async function deliverCron(pi: PiLike, core: CoreBridge, delivery: Record<string, unknown>, ctx: unknown): Promise<void> {
  const mode = stringField(delivery, "mode");
  const content = stringField(delivery, "content");
  const coalesced = typeof delivery["coalesced"] === "number" ? delivery["coalesced"] as number : 1;
  if (mode !== "goal") {
    await sendCronMessage(pi, content, "message", coalesced);
    return;
  }

  const result = coreCall(core, "prepareTool", ["create_goal", { objective: content }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    await sendCronMessage(pi, content, "message", coalesced);
    return;
  }
  const plan = coreCall(core, "planGoalContinuation", [true, {
    hostIdle: true,
    hasPendingMessages: false,
    retrying: false,
    compacting: false,
  }, {}, ctx]);
  if (!isRecord(plan) || stringField(plan, "action") !== "send_goal_continuation") return;
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({
      customType: stringField(plan, "customType"),
      content: stringField(plan, "content"),
      display: plan["display"] === true,
    }, {
      triggerTurn: plan["triggerTurn"] === true,
      deliverAs: stringField(plan, "deliverAs"),
    });
  } else {
    await pi.sendUserMessage?.(stringField(plan, "content"), { deliverAs: stringField(plan, "deliverAs") });
  }
}

function notify(ctx: unknown, message: string): void {
  if (!isRecord(ctx) || !isRecord(ctx["ui"])) return;
  const fn = ctx["ui"]["notify"];
  if (typeof fn === "function") fn.call(ctx["ui"], message, "warning");
}

export function installCronLoop(pi: PiLike, core: CoreBridge): void {
  if (!canSend(pi)) return;
  let latestCtx: unknown;
  let goalDriving = false;

  const poll = async () => {
    if (latestCtx === undefined) return;
    const goalFacts = coreCall(core, "cronGoalFacts", [latestCtx]);
    const goalSlotFree = isRecord(goalFacts) ? goalFacts["goalSlotFree"] === true : false;
    const plan = coreCall(core, "cronPoll", [{
      now: Date.now(),
      hostIdle: typeof pi.isIdle === "function" ? pi.isIdle() : true,
      goalDriving,
      goalSlotFree,
    }, latestCtx]);
    if (isRecord(plan) && stringField(plan, "action") === "deliver") {
      await deliverCron(pi, core, plan, latestCtx);
      coreCall(core, "cronDelivered", [{ id: stringField(plan, "id"), now: Date.now() }, latestCtx]);
    }
  };

  const timer = setInterval(() => void poll().catch((error) => console.warn("Taumel cron poll failed:", error)), 30_000);
  timer.unref?.();

  pi.on("session_start", (event, ctx) => {
    latestCtx = ctx;
    const result = coreCall(core, "cronStartup", [event, ctx]);
    if (isRecord(result) && result["notify"] === true) notify(ctx, stringField(result, "message"));
  });
  pi.on("session_resume", (event, ctx) => {
    latestCtx = ctx;
    const result = coreCall(core, "cronStartup", [event, ctx]);
    if (isRecord(result) && result["notify"] === true) notify(ctx, stringField(result, "message"));
  });
  pi.on("turn_start", (_event, ctx) => {
    latestCtx = ctx;
    goalDriving = true;
  });
  pi.on("agent_end", (_event, ctx) => {
    latestCtx = ctx;
    goalDriving = false;
    setTimeout(() => void poll().catch((error) => console.warn("Taumel cron agent_end poll failed:", error)), 0);
  });
}
