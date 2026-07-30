import assert from "node:assert/strict";
import { installPlanContinuationLoop, registerGatewayCommands } from "../src/command-executor.ts";

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
    if (method === "commandSpecs") return { specs: [{ name: "plan", description: "Manage plan" }] };
    if (method === "planCommandExecution") return { kind: "direct" };
    if (method === "handleCommand") {
      const input = args[0].args;
      if (input === "") return {
        ok: true,
        action: "command_result",
        message: "Plan active: ship (2s)",
        details: { plan: { statusLabel: "active", completedTasks: 0, totalTasks: 1, tasks: [{ taskId: "task-1", title: "ship", status: "pending", origin: "user", depends_on: [] }], blocks: [{ blockedAt: 1, reason: "Need input.", source: "agent", clearedAt: 2, clearedBy: "user", resolution: "Input supplied." }], timeUsage: "2s", tokensUsed: 3, timeLimitSeconds: null }, automation: { continuation: "enabled" } },
        planInspection: true,
      };
      if (input === "ship") return {
        ok: true,
        action: "command_result",
        message: "Plan active: ship (0s)",
        details: {},
        planSubmitUserMessage: "ship",
        planRollback: { plan: null, automation: { continuation: "enabled", requiresUserInput: false } },
      };
      return { ok: true, action: "command_result", message: "Plan cleared.", details: {} };
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
        assert.deepEqual(component.render(120), ["Plan · active · 0/1 tasks · 2s"]);
        component.handleInput("\x0f");
        const expanded = component.render(120).join("\n");
        assert.match(expanded, /Block 1: 1970-01-01T00:00:01.000Z · source agent/);
        assert.match(expanded, /Reason: Need input./);
        assert.match(expanded, /Resolution: Input supplied./);
        component.handleInput("escape");
      });
    },
  },
};

registerGatewayCommands(pi, core, new Map());
const plan = commands.get("plan");
assert(plan, "plan command not registered");
const systemPrompt = commands.get("system-prompt");
assert(systemPrompt, "system-prompt command not registered");

let inspectedPrompt = "";
await systemPrompt.handler("", {
  getSystemPrompt: () => "first line\nsecond line",
  ui: {
    custom: async (factory) => {
      await new Promise((resolve) => {
        const theme = {
          prefix: "",
          fg(_color, text) {
            if (this !== theme) throw new Error("theme.fg receiver was lost");
            return text;
          },
        };
        const component = factory({ requestRender() {} }, theme, {}, resolve);
        inspectedPrompt = component.render(120).join("\n");
        component.handleInput("escape");
      });
    },
  },
});
assert.match(inspectedPrompt, /first line\nsecond line/, "system-prompt should inspect the current prompt");
assert.deepEqual(sentUserMessages, [], "system-prompt should not contact agent");

await plan.handler("", ctx);
assert.equal(inspections, 1, "bare plan should render one local inspection");
assert.deepEqual(notifications, [], "bare plan should not notify");
assert.deepEqual(sentUserMessages, [], "bare plan should not contact agent");

await plan.handler("ship", ctx);
assert.deepEqual(sentUserMessages, ["ship"], "plan task text should be the only agent message");
assert.deepEqual(notifications, [], "plan creation should not notify");

await plan.handler("clear", ctx);
assert.deepEqual(notifications, [{ message: "Plan cleared.", level: "info" }], "clear should notify exactly once");

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
    if (method === "finalizePlanError") {
      finalizations.push(args[0].status);
      return {};
    }
    if (method === "planPlanContinuation") return { kind: "none" };
    if (method === "clearInterruptedPlanAutomation" || method === "interruptPlanAutomation") return {};
    throw new Error(`unexpected lifecycle core call: ${method}`);
  },
};
installPlanContinuationLoop(lifecyclePi, lifecycleCore);
const agentEnd = lifecycleHandlers.get("agent_end");
await agentEnd({
  willRetry: false,
  messages: [{ role: "assistant", stopReason: "error", errorMessage: "insufficient_quota" }],
}, { sessionManager: { getSessionId: () => "s" } });
assert.deepEqual(finalizations, ["blocked"], "final unrecoverable errors should block the plan");
