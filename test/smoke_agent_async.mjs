import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { executeAgentPrepared } from "../src/agent-orchestration.ts";
import { executeTool } from "../src/tool-executor.ts";

const root = mkdtempSync(join(tmpdir(), "taumel-agent-async-"));
process.env.PI_CODING_AGENT_DIR = root;
const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const core = globalThis.taumel;

const parentEntries = [];
const ctx = {
  cwd: process.cwd(), mode: "print", hasUI: false,
  model: { provider: "test", id: "model" },
  activeTools: ["read", "exec_command", "agent_spawn", "agent_wait", "agent_close"],
  sessionManager: {
    getSessionId: () => "async-parent",
    getSessionFile: () => join(root, "parent.jsonl"),
    getEntries: () => parentEntries,
    appendCustomEntry: (customType, data) => parentEntries.push({ type: "custom", customType, data }),
  },
};
core.init({
  resolveAuthorizationPath: realpathSync,
  on: () => undefined, eventsOn: () => () => undefined, emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }), setFooter: () => undefined,
  sessionSnapshot: () => ({ cwd: process.cwd(), provider: "test", model: "model", thinking: "medium", totalCost: 0, contextPercent: 0, contextWindow: 1000 }),
  getGitBranch: () => "main", onBranchChange: () => () => undefined,
  requestRender: () => undefined, themeFg: (_theme, _color, value) => value,
});

const prepared = core.call("prepareTool", [{
  name: "agent_spawn", params: { message: "work asynchronously", description: "Run asynchronous work" }, ctx,
}]);
assert.equal(prepared.action, "agent_start");
const childDirectory = join(root, "taumel", "agents", prepared.agentId);
const childFile = join(childDirectory, "session.jsonl");
mkdirSync(childDirectory, { recursive: true });
writeFileSync(childFile, "");
const childEntries = [];
const childManager = {
  getSessionId: () => "async-child",
  getSessionFile: () => childFile,
  getEntries: () => childEntries,
  getBranch: () => childEntries,
  appendCustomEntry: (customType, data) => childEntries.push({ type: "custom", customType, data }),
};

let settle;
const subscribers = new Set();
let streaming = false;
let allocatedSessionFile;
const sessionMessages = [];
const model = { provider: "test", id: "model", reasoning: true };
const pi = {
  modelRegistry: {
    find: (provider, id) => provider === "test" && id === "model" ? model : undefined,
    hasConfiguredAuth: () => true,
  },
  getAllTools: () => ["read", "exec_command", "write_stdin"],
  createAgentSession: async (options) => {
    allocatedSessionFile = options.sessionManager.getSessionFile();
    return ({
    session: {
      sessionId: "async-child", sessionFile: childFile, sessionManager: childManager,
      messages: sessionMessages,
      get isStreaming() { return streaming; },
      getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
      subscribe: (handler) => {
        subscribers.add(handler);
        return () => { subscribers.delete(handler); };
      },
      prompt: () => new Promise((resolve) => {
        streaming = true;
        settle = (message = { role: "assistant", content: [{ type: "text", text: "async answer" }], stopReason: "stop" }) => {
          sessionMessages.push(message);
          childEntries.push({ type: "message", id: `async-answer-${childEntries.length}`, message });
          for (const subscriber of subscribers) subscriber({ type: "turn_end", message, toolResults: [] });
          for (const subscriber of subscribers) subscriber({ type: "agent_end", messages: [message], willRetry: false });
          streaming = false;
          resolve(undefined);
        };
      }),
      followUp: async () => undefined,
      abort: async () => undefined,
      dispose: () => undefined,
    },
  });
  },
};

const childSessions = new Map();
const pendingWaits = new Map();
// agent-tc17: failed agent calls use the stable JSON error envelope.
const invalidStart = await executeTool(pi, core, childSessions, "agent_spawn", { message: "missing label" }, ctx);
assert.deepEqual(JSON.parse(invalidStart.content[0].text), {
  ok: false,
  error: { code: "invalid_arguments", message: "agent_spawn: must have required properties description" },
});
const result = await executeAgentPrepared(pi, core, childSessions, pendingWaits, prepared, ctx);
assert.equal(result.details.status, "running");
assert.equal(
  allocatedSessionFile.startsWith(join(root, "taumel", "agents", "owners", createHash("sha256").update("async-parent").digest("hex"), prepared.agentId)),
  true,
  "private child storage must be namespaced by owner rather than the public handle alone",
);
assert.equal(typeof settle, "function", "start must dispatch without waiting for completion");
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status, "running");

settle();
await new Promise((resolve) => setTimeout(resolve, 0));
// agent-nt04/agentui-3txs: completion carries attributed presentation metadata, never child output.
const pendingNotification = core.call("pendingAgentNotifications", [ctx]).notifications[0];
assert.deepEqual(JSON.parse(pendingNotification.content), {
  event: "agent_completion",
  agent_id: prepared.agentId,
  run_id: prepared.runId,
  kind: "generic",
  description: "Run asynchronous work",
  status: "completed",
  next_action: { tool: "agent_wait", arguments: { run_ids: [prepared.runId], timeout_seconds: 0 } },
});
assert.equal(pendingNotification.content.includes("async answer"), false);
core.call("releaseAgentBackgroundNotification", [{ run_id: prepared.runId }]);
const waited = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [prepared.runId], timeout_seconds: 0 }, ctx,
}]);
assert.equal(waited.details.results[0].output, "async answer");
// agent-rs17: completed wait results contain only common and completed fields.
const waitedJson = JSON.parse(waited.text);
assert.deepEqual(Object.keys(waitedJson).sort(), ["pending_run_ids", "results", "timed_out"]);
assert.deepEqual(Object.keys(waitedJson.results[0]).sort(), ["agent_id", "ended_at", "kind", "output", "run_id", "started_at", "status"]);
assert.equal("model" in waitedJson.results[0], false);
assert.equal("thinking" in waitedJson.results[0], false);
// agentui-oqzy: model-facing results omit routing diagnostics.
assert.equal("model" in JSON.parse(prepared.text), false);
assert.equal("thinking" in JSON.parse(prepared.text), false);

const failedSend = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "fail", description: "Trigger failed work" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, failedSend, ctx);
settle({ role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" });
await new Promise((resolve) => setTimeout(resolve, 0));
const failedNotification = JSON.parse(core.call("pendingAgentNotifications", [ctx]).notifications[0].content);
assert.equal(failedNotification.description, "Trigger failed work");
assert.equal(failedNotification.status, "failed");
const failedWait = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [failedSend.runId], timeout_seconds: 0 }, ctx,
}]);
assert.equal(failedWait.details.results[0].status, "failed");
assert.equal(failedWait.details.results[0].error, "provider failed");

// A close must cancel an indefinite wait for a run it removes.
const send = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "run again", description: "Run agent again" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, send, ctx);
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status, "running");
// agent-id20/agent-id22: a queued follow-up keeps its subscription through agent_settled.
const steered = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "steer queued", description: "Steer queued work" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, steered, ctx);
assert.equal(subscribers.size, 2, "queued follow-up subscription must remain live until settlement");
settle({ role: "assistant", content: [{ type: "text", text: "steered answer" }], stopReason: "stop" });
await new Promise((resolve) => setTimeout(resolve, 0));
const steeredList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0];
assert.equal(steeredList.status, "completed");
assert.equal(steeredList.turn_count, 1);
assert.equal(subscribers.size, 0, "all dispatch subscriptions must be released after host settlement");
const steeredWait = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [steered.runId], timeout_seconds: 0 }, ctx,
}]);
assert.equal(steeredWait.details.results[0].output, "steered answer");

const closeRun = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "wait for close", description: "Wait for agent close" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, closeRun, ctx);
const pendingWait = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [closeRun.runId] }, ctx,
}]);
assert.equal(pendingWait.action, "agent_wait");
assert.equal(core.call("finishAgentWait", [{ run_ids: [closeRun.runId] }, ctx]).action, "agent_wait");
const waitPromise = executeAgentPrepared(pi, core, childSessions, pendingWaits, pendingWait, ctx);
const secondWaitPromise = executeAgentPrepared(pi, core, childSessions, pendingWaits, pendingWait, ctx);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(pendingWaits.size, 1);
assert.equal([...pendingWaits.values()][0].size, 2);
const close = core.call("prepareTool", [{
  name: "agent_close", params: { agent_id: prepared.agentId }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, close, ctx);
const waitOutcome = await Promise.race([
  Promise.all([waitPromise, secondWaitPromise]).then(() => "settled"),
  new Promise((resolve) => setTimeout(() => resolve("timed_out"), 250)),
]);
assert.equal(waitOutcome, "settled", "agent_close must cancel a concurrent indefinite agent_wait");

rmSync(root, { recursive: true, force: true });
console.log("agent async orchestration smoke: all assertions passed");
