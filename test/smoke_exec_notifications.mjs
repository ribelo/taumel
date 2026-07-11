import { installExecNotificationLifecycle } from "../src/exec-notifications.ts";

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
