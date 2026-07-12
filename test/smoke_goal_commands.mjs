import assert from "node:assert/strict";
import { installGoalContinuationLoop, registerGatewayCommands } from "../src/command-executor.ts";

const commands = new Map();
const sentUserMessages = [];
const notifications = [];
let inspections = 0;

const pi = {
  registerCommand: (name, definition) => commands.set(name, definition),
  sendUserMessage: async (message) => sentUserMessages.push(message),
};

const core = {
  call(method, args = []) {
    if (method === "commandSpecs") return { specs: [{ name: "goal", description: "Manage goal" }] };
    if (method === "planCommandExecution") return { kind: "direct" };
    if (method === "handleCommand") {
      const input = args[0].args;
      if (input === "") return {
        ok: true,
        action: "command_result",
        message: "Goal active: ship (2s)",
        details: { goal: { statusLabel: "active", objective: "ship", timeUsage: "2s", tokensUsed: 3, timeLimitSeconds: null }, automation: { continuation: "enabled" } },
        goalInspection: true,
      };
      if (input === "ship") return {
        ok: true,
        action: "command_result",
        message: "Goal active: ship (0s)",
        details: {},
        goalStartObjective: "ship",
        goalRollback: { goal: null, automation: { continuation: "enabled", requiresUserInput: false } },
      };
      return { ok: true, action: "command_result", message: "Goal cleared.", details: {} };
    }
    if (method === "planCommandNotification") {
      return { kind: "notify", message: args[0].message || "done", level: "info" };
    }
    throw new Error(`unexpected core call: ${method}`);
  },
};

const ctx = {
  ui: {
    notify: (message, level) => notifications.push({ message, level }),
    custom: async (factory) => {
      inspections += 1;
      await new Promise((resolve) => {
        const component = factory({ requestRender() {} }, { fg: (_color, text) => text }, {}, resolve);
        assert.deepEqual(component.render(120), ["Goal · active · ship · 2s"]);
        component.handleInput("escape");
      });
    },
  },
};

registerGatewayCommands(pi, core, new Map());
const goal = commands.get("goal");
assert(goal, "goal command not registered");

await goal.handler("", ctx);
assert.equal(inspections, 1, "bare goal should render one local inspection");
assert.deepEqual(notifications, [], "bare goal should not notify");
assert.deepEqual(sentUserMessages, [], "bare goal should not contact agent");

await goal.handler("ship", ctx);
assert.deepEqual(sentUserMessages, ["ship"], "goal objective should be the only agent message");
assert.deepEqual(notifications, [], "goal creation should not notify");

await goal.handler("clear", ctx);
assert.deepEqual(notifications, [{ message: "Goal cleared.", level: "info" }], "clear should notify exactly once");

const lifecycleHandlers = new Map();
const finalizations = [];
const lifecyclePi = {
  on: (event, handler) => lifecycleHandlers.set(event, handler),
  subscribe: () => () => undefined,
  isIdle: () => true,
  sendMessage: async () => undefined,
};
const lifecycleCore = {
  call(method, args = []) {
    if (method === "finalizeGoalError") {
      finalizations.push(args[0].status);
      return {};
    }
    if (method === "planGoalContinuation") return { kind: "none" };
    if (method === "clearInterruptedGoalAutomation" || method === "interruptGoalAutomation") return {};
    throw new Error(`unexpected lifecycle core call: ${method}`);
  },
};
installGoalContinuationLoop(lifecyclePi, lifecycleCore);
const agentEnd = lifecycleHandlers.get("agent_end");
await agentEnd({
  willRetry: false,
  messages: [{ role: "assistant", stopReason: "error", errorMessage: "insufficient_quota" }],
}, { sessionManager: { getSessionId: () => "s" } });
assert.deepEqual(finalizations, ["usage_limited"], "final quota errors should usage-limit the goal");
