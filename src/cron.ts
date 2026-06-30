import type { CoreBridge, PiLike } from "./types.ts";
import { coreCall, isRecord, stringField } from "./util.ts";

function canSend(pi: PiLike): boolean {
  return typeof pi.sendMessage === "function" || typeof pi.sendUserMessage === "function";
}

async function sendCronMessage(
  pi: PiLike,
  content: string,
  deliveryKind: "trigger" | "steer",
  coalesced: number,
): Promise<void> {
  const prefix = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n` : "[cron]\n";
  const options = deliveryKind === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" };
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType: "taumel.cron.fire", content: `${prefix}${content}`, display: true }, options);
    return;
  }
  await pi.sendUserMessage?.(`${prefix}${content}`, options);
}

async function deliverCron(
  pi: PiLike,
  core: CoreBridge,
  delivery: Record<string, unknown>,
  ctx: unknown,
  deliveryKind: "trigger" | "steer",
): Promise<void> {
  const mode = stringField(delivery, "mode");
  const content = stringField(delivery, "content");
  const coalesced = typeof delivery["coalesced"] === "number" ? delivery["coalesced"] as number : 1;
  if (mode !== "goal") {
    await sendCronMessage(pi, content, deliveryKind, coalesced);
    return;
  }

  const objective = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]\n${content}` : content;
  const result = coreCall(core, "prepareTool", ["create_goal", { objective }, ctx]);
  if (!isRecord(result) || result["ok"] !== true) {
    await sendCronMessage(pi, content, deliveryKind, coalesced);
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
  let pollInFlight = false;

  const poll = async (deliveryKind: "trigger" | "steer" = "trigger") => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      if (latestCtx === undefined) return;
      const goalFacts = coreCall(core, "cronGoalFacts", [latestCtx]);
      const goalSlotFree = isRecord(goalFacts) ? goalFacts["goalSlotFree"] === true : false;
      const goalDriving = isRecord(goalFacts) ? goalFacts["goalDriving"] === true : false;
      const plan = coreCall(core, "cronPoll", [{
        now: Date.now(),
        hostIdle: typeof pi.isIdle === "function" ? pi.isIdle() : true,
        goalDriving,
        goalSlotFree,
      }, latestCtx]);
      if (isRecord(plan) && stringField(plan, "action") === "deliver") {
        await deliverCron(pi, core, plan, latestCtx, deliveryKind);
        coreCall(core, "cronDelivered", [{ id: stringField(plan, "id"), now: Date.now() }, latestCtx]);
      }
    } finally {
      pollInFlight = false;
    }
  };

  const timer = setInterval(() => void poll().catch((error) => console.warn("Taumel cron poll failed:", error)), 30_000);
  timer.unref?.();

  pi.on("session_start", (event, ctx) => {
    latestCtx = ctx;
    const result = coreCall(core, "cronStartup", [event, ctx]);
    if (isRecord(result) && result["notify"] === true) notify(ctx, stringField(result, "message"));
  });
  pi.on("turn_start", (_event, ctx) => {
    latestCtx = ctx;
  });
  pi.on("agent_end", (_event, ctx) => {
    latestCtx = ctx;
    setTimeout(() => void poll("trigger").catch((error) => console.warn("Taumel cron agent_end poll failed:", error)), 0);
  });
}
