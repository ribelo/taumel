import { strict as assert } from "node:assert";

import { installCronLoop } from "../src/cron.ts";

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

const handlers = new Map();
const intervals = [];
const cleared = [];
const calls = [];

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
    isIdle: () => true,
  };
  const core = {
    init: () => undefined,
    call: (name, args) => {
      calls.push({ name, args });
      if (name === "cronStartup") return { notify: false };
      if (name === "cronGoalFacts") return { goalSlotFree: true, goalDriving: false };
      if (name === "cronPoll") return { action: "none" };
      if (name === "cronDelivered") return { ok: true };
      throw new Error(`unexpected core call: ${name}`);
    },
  };

  installCronLoop(pi, core);
  assert.equal(intervals.length, 1, "cron loop should install one interval");
  assert.equal(intervals[0].ms, 30_000, "cron loop interval should be 30s");
  assert.equal(intervals[0].unrefCalled, true, "cron interval should be unref'd");

  emit("session_start", { type: "session_start", reason: "startup" }, { sessionManager: {} });
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

  emit("session_shutdown", { type: "session_shutdown", reason: "reload" }, { sessionManager: {} });
  assert.deepEqual(cleared, [intervals[0]], "cron loop should clear its interval on session shutdown");
} finally {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}
