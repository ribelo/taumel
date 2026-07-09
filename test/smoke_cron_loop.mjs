import { strict as assert } from "node:assert";

import { installCronLoop } from "../src/cron.ts";

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

const handlers = new Map();
const intervals = [];
const cleared = [];
const calls = [];
const notifications = [];
let runtimeStale = false;
let cronPollResult = { action: "none" };
let prepareToolResult = { ok: true };
let goalContinuationResult = { action: "none" };

const on = (event, handler) => {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
};

const emit = (event, payload = {}, ctx = {}) => {
  for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

globalThis.setInterval = (fn, ms, ...args) => {
  const timer = {
    fn,
    ms,
    args,
    unrefCalled: false,
    unref() {
      this.unrefCalled = true;
    },
  };
  intervals.push(timer);
  return timer;
};

globalThis.clearInterval = (timer) => {
  cleared.push(timer);
};

try {
  const pi = {
    on,
    events: { on: () => () => undefined, emit: () => undefined },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    sendMessage: async () => undefined,
    getFlag: () => {
      if (runtimeStale) throw new Error("This extension ctx is stale after session replacement or reload.");
      return undefined;
    },
    isIdle: () => true,
  };
  const core = {
    init: () => undefined,
    call: (name, args) => {
      calls.push({ name, args });
      if (name === "cronStartup") return { notify: true, message: "2 stored cron tasks exist in this session. Cron is disabled on startup; run /cron enable to arm them." };
      if (name === "cronGoalFacts") return { goalSlotFree: true, goalDriving: false };
      if (name === "cronPoll") return cronPollResult;
      if (name === "prepareTool") return prepareToolResult;
      if (name === "planGoalContinuation") return goalContinuationResult;
      if (name === "cronDelivered") return { ok: true };
      throw new Error(`unexpected core call: ${name}`);
    },
  };

  installCronLoop(pi, core);
  assert.equal(intervals.length, 1, "cron loop should install one interval");
  assert.equal(intervals[0].ms, 30_000, "cron loop interval should be 30s");
  assert.equal(intervals[0].unrefCalled, true, "cron interval should be unref'd");

  emit("session_start", { type: "session_start", reason: "startup" }, {
    sessionManager: {},
    ui: { notify: (message, type) => notifications.push({ message, type }) },
  });
  assert.deepEqual(notifications, [{
    message: "2 stored cron tasks exist in this session. Cron is disabled on startup; run /cron enable to arm them.",
    type: "warning",
  }], "cron startup should notify the user about stored disabled crons");
  calls.length = 0;
  intervals[0].fn();
  await tick();
  assert.deepEqual(calls.map((call) => call.name), ["cronGoalFacts", "cronPoll"], "cron interval should poll with a fresh ctx");

  const staleCtx = {
    get sessionManager() {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    },
  };
  emit("turn_start", { type: "turn_start" }, staleCtx);
  calls.length = 0;
  intervals[0].fn();
  await tick();
  assert.deepEqual(calls, [], "cron interval should skip a stale captured ctx before calling core");

  const staleMethodCtx = {
    sessionManager: {
      getSessionId() {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
    },
  };
  emit("turn_start", { type: "turn_start" }, staleMethodCtx);
  calls.length = 0;
  intervals[0].fn();
  await tick();
  assert.deepEqual(calls, [], "cron interval should skip a ctx whose session manager is stale before calling core");

  emit("turn_start", { type: "turn_start" }, { sessionManager: {} });
  runtimeStale = true;
  calls.length = 0;
  intervals[0].fn();
  await tick();
  runtimeStale = false;
  assert.deepEqual(calls, [], "cron interval should skip a stale captured pi runtime before calling core");

  cronPollResult = { action: "deliver", id: "deadbeef", mode: "goal", content: "goal fire", coalesced: 1 };
  goalContinuationResult = { action: "none" };
  emit("turn_start", { type: "turn_start" }, { sessionManager: {} });
  calls.length = 0;
  intervals[0].fn();
  await tick();
  assert.deepEqual(
    calls.map((call) => call.name),
    ["cronGoalFacts", "cronPoll", "prepareTool", "planGoalContinuation"],
    "cron loop should not mark a skipped goal delivery as delivered",
  );
  cronPollResult = { action: "none" };

  emit("session_shutdown", { type: "session_shutdown", reason: "reload" }, { sessionManager: {} });
  assert.deepEqual(cleared, [intervals[0]], "cron loop should clear its interval on session shutdown");
} finally {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}
