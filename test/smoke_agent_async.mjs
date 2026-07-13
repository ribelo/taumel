import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { executeAgentPrepared } from "../src/agent-orchestration.ts";

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
  name: "agent_spawn", params: { message: "work asynchronously" }, ctx,
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
let subscriber;
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
      getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
      subscribe: (handler) => {
        subscriber = handler;
        return () => { subscriber = undefined; };
      },
      prompt: () => new Promise((resolve) => {
        settle = (message = { role: "assistant", content: [{ type: "text", text: "async answer" }], stopReason: "stop" }) => {
          sessionMessages.push(message);
          resolve(undefined);
          queueMicrotask(() => {
            childEntries.push({ type: "message", id: `async-answer-${childEntries.length}`, message });
            subscriber?.({ type: "agent_end", messages: [message] });
          });
        };
      }),
      abort: async () => undefined,
      dispose: () => undefined,
    },
  });
  },
};

const childSessions = new Map();
const pendingWaits = new Map();
const result = await executeAgentPrepared(pi, core, childSessions, pendingWaits, prepared, ctx);
assert.equal(result.details.status, "running");
assert.equal(
  allocatedSessionFile.startsWith(join(root, "taumel", "agents", "owners", createHash("sha256").update("async-parent").digest("hex"), prepared.agentId)),
  true,
  "private child storage must be namespaced by owner rather than the public handle alone",
);
assert.equal(typeof settle, "function", "start must dispatch without waiting for completion");
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].latest_run_status, "running");

settle();
await new Promise((resolve) => setTimeout(resolve, 0));
const waited = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [prepared.runId], timeout_seconds: 0 }, ctx,
}]);
assert.equal(waited.details.results[0].output, "async answer");

const failedSend = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "fail" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, failedSend, ctx);
settle({ role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" });
await new Promise((resolve) => setTimeout(resolve, 0));
const failedWait = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [failedSend.runId], timeout_seconds: 0 }, ctx,
}]);
assert.equal(failedWait.details.results[0].status, "failed");
assert.equal(failedWait.details.results[0].error, "provider failed");

// A close must cancel an indefinite wait for a run it removes.
const send = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "run again" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, send, ctx);
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].latest_run_status, "running");
const pendingWait = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [send.runId] }, ctx,
}]);
assert.equal(pendingWait.action, "agent_wait");
assert.equal(core.call("finishAgentWait", [{ run_ids: [send.runId] }, ctx]).action, "agent_wait");
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
