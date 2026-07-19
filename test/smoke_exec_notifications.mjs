import { installExecNotificationLifecycle, startExecCompletionWaiter } from "../src/exec-notifications.ts";

const handlers = new Map();
const calls = [];
const pi = {
  on(name, handler) {
    const values = handlers.get(name) ?? [];
    values.push(handler);
    handlers.set(name, values);
  },
  async sendMessage() {},
};
const core = {
  call(method, args) {
    calls.push({ method, args });
    if (method === "pendingExecNotifications") return { notifications: [] };
    return {};
  },
};

installExecNotificationLifecycle(pi, core);

if (!handlers.has("turn_end") || !handlers.has("agent_end") || !handlers.has("session_shutdown")) {
  throw new Error(`exec notification lifecycle hooks missing: ${JSON.stringify([...handlers.keys()])}`);
}

const ctx = { sessionManager: { getSessionId: () => "owner-1" } };
await handlers.get("turn_end")[0]({}, ctx);
handlers.get("session_shutdown")[0]({}, ctx);
handlers.get("agent_end")[0]({}, ctx);
await new Promise((resolve) => setTimeout(resolve, 5));

const pendingCalls = calls.filter((call) => call.method === "pendingExecNotifications");
if (pendingCalls.length !== 2) {
  throw new Error(`expected turn_end and agent_end notification flushes: ${JSON.stringify(calls)}`);
}
if (!calls.some((call) => call.method === "shutdownExecOwner" && call.args?.[0] === "owner-1")) {
  throw new Error(`session shutdown did not clean up exec owner: ${JSON.stringify(calls)}`);
}

// exec-bg16: a completion waiter retained by the old extension runtime becomes
// inert when its captured context is invalidated by session replacement.
let resolveCompletion;
let contextStale = false;
const waiterCalls = [];
const staleError = () => new Error("This extension ctx is stale after session replacement or reload");
const waiterCtx = {
  get sessionManager() {
    if (contextStale) throw staleError();
    return { getSessionId: () => "owner-2" };
  },
  isIdle() {
    if (contextStale) throw staleError();
    return true;
  },
};
const waiterCore = {
  call(method, args) {
    waiterCalls.push({ method, args });
    if (method === "awaitExecCompletion") {
      return new Promise((resolve) => {
        resolveCompletion = resolve;
      });
    }
    throw new Error(`unexpected post-replacement core call: ${method}`);
  },
};

const waiter = startExecCompletionWaiter(pi, waiterCore, waiterCtx, 42);
contextStale = true;
resolveCompletion({ exited: true });
await waiter;

if (waiterCalls.length !== 1 || waiterCalls[0].method !== "awaitExecCompletion") {
  throw new Error(`stale completion waiter was not inert: ${JSON.stringify(waiterCalls)}`);
}

// Replacement can race the liveness probes, so stale errors from the guarded
// post-completion region must also make the old waiter inert.
const racingCalls = [];
const racingCtx = {
  sessionManager: { getSessionId: () => "owner-3" },
  isIdle() {
    throw staleError();
  },
};
const racingCore = {
  call(method, args) {
    racingCalls.push({ method, args });
    if (method === "awaitExecCompletion") return Promise.resolve({ exited: true });
    throw new Error(`unexpected raced core call: ${method}`);
  },
};

await startExecCompletionWaiter(pi, racingCore, racingCtx, 43);
if (racingCalls.length !== 1 || racingCalls[0].method !== "awaitExecCompletion") {
  throw new Error(`raced stale completion waiter was not inert: ${JSON.stringify(racingCalls)}`);
}
