import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { executeAgentPrepared } from "../src/agent-orchestration.ts";
import { sendToChildSession } from "../src/child-sessions.ts";
import { executeTool } from "../src/tool-executor.ts";

const root = mkdtempSync(join(tmpdir(), "taumel-agent-async-"));
process.env.PI_CODING_AGENT_DIR = root;
const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const bootstrap = globalThis.taumel;
let core;

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
core = bootstrap.init({
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
let allocatedAppendPrompt;
let allocatedResourceLoader;
let createSessionError;
const sessionMessages = [];
const model = { provider: "test", id: "model", reasoning: true };
const pi = {
  modelRegistry: {
    find: (provider, id) => provider === "test" && id === "model" ? model : undefined,
    hasConfiguredAuth: () => true,
  },
  getAllTools: () => ["read", "exec_command", "write_stdin"],
  createAgentSession: async (options) => {
    if (createSessionError !== undefined) throw new Error(createSessionError);
    allocatedSessionFile = options.sessionManager.getSessionFile();
    mkdirSync(dirname(allocatedSessionFile), { recursive: true });
    writeFileSync(
      allocatedSessionFile,
      `${options.sessionManager.getEntries().map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
    allocatedResourceLoader = options.resourceLoader;
    allocatedAppendPrompt = options.resourceLoader.getAppendSystemPrompt();
    return ({
    session: {
      sessionId: "async-child", sessionFile: childFile, sessionManager: childManager,
      messages: sessionMessages,
      get isStreaming() { return streaming; },
      getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
      getActiveToolNames: () => options.tools,
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
const invalidPreparedSend = await executeAgentPrepared(pi, core, childSessions, pendingWaits, {
  action: "agent_send", agentId: prepared.agentId, capabilityId: "forged",
  dispatch: true, dispatchDeliverAs: "followUp", outcome: "started",
}, ctx);
assert.equal(JSON.parse(invalidPreparedSend.content[0].text).error.code, "internal_error");
const invalidPreparedClose = await executeAgentPrepared(pi, core, childSessions, pendingWaits, {
  action: "agent_close", agentId: prepared.agentId, capabilityId: "forged", deleteWorktree: true,
}, ctx);
assert.equal(JSON.parse(invalidPreparedClose.content[0].text).error.code, "internal_error");
// agent-tc17: failed agent calls use the stable JSON error envelope.
const invalidStart = await executeTool(pi, core, childSessions, "agent_spawn", { message: "missing label" }, ctx);
assert.deepEqual(JSON.parse(invalidStart.content[0].text), {
  ok: false,
  error: { code: "invalid_arguments", message: "agent_spawn: must have required properties description" },
});
const result = await executeAgentPrepared(pi, core, childSessions, pendingWaits, prepared, ctx);
assert.equal(result.details.status, "running");
// agent-kd03: generic children leave base-system-prompt selection to Pi's ordinary loader behavior.
assert.equal(allocatedResourceLoader.getSystemPrompt(), undefined);
const commonSubagentPrompt = allocatedAppendPrompt.join("\n\n");
// subprompt-3yl1/subprompt-4f06/subprompt-3fcs: every child receives the common role, handoff, and Git instructions.
assert.match(commonSubagentPrompt, /You are now running as a subagent\./);
assert.match(commonSubagentPrompt, /Your final message is the entire handoff/);
assert.match(commonSubagentPrompt, /Use version control only for read-only inspection\./);
assert.match(commonSubagentPrompt, /resetting, and pushing to the parent agent\./);
assert.equal(
  allocatedSessionFile.startsWith(join(root, "taumel", "agents", "owners", createHash("sha256").update("async-parent").digest("hex"), prepared.agentId)),
  true,
  "private child storage must be namespaced by owner rather than the public handle alone",
);
assert.equal(typeof settle, "function", "start must dispatch without waiting for completion");
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status, "running", "initial dispatch remained running");

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

const retainedChildSessions = [...childSessions];
childSessions.clear();
createSessionError = "failed to reopen child session";
const failedPreflightResult = await executeTool(
  pi,
  core,
  childSessions,
  "agent_send",
  { agent_id: prepared.agentId, message: "must not allocate", description: "Fail send preflight" },
  ctx,
);
assert.equal(JSON.parse(failedPreflightResult.content[0].text).error.code, "child_session_unavailable");
createSessionError = undefined;
for (const [key, bridge] of retainedChildSessions) childSessions.set(key, bridge);
const failedPreflightRunId = `${prepared.agentId}-run-2`;
const afterFailedPreflight = core.call("agentManagerSnapshot", [ctx]);
assert.equal(
  afterFailedPreflight.runs.some((run) => run.runId === failedPreflightRunId),
  false,
  "failed send left a phantom run",
);
assert.equal(core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [failedPreflightRunId], timeout_seconds: 0 }, ctx,
}]).ok, false, "failed send exposed prior output under a new run id");

const failedSend = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "fail", description: "Trigger failed work" }, ctx,
}]);
assert.notEqual(failedSend.runId, failedPreflightRunId, "rolled-back run id must remain retired");
const failedSendResult = await executeAgentPrepared(pi, core, childSessions, pendingWaits, failedSend, ctx);
assert.equal(failedSendResult.details.status, "running");
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status, "running", "failed-send dispatch remained running before settlement");
assert.equal(subscribers.size, 1);
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

// agent-ki03/agent-xe88/agent-kd05: specialists supply their own base prompts through Pi's resource loader.
for (const [toolName, params, promptFile, requirementId] of [
  ["finder", { query: "locate prompt ownership", description: "Locate prompt ownership" }, "finder.md", "agent-ki03"],
  ["oracle", { message: "review prompt ownership", description: "Review prompt ownership" }, "oracle.md", "agent-xe88"],
]) {
  const specialist = core.call("prepareTool", [{ name: toolName, params, ctx }]);
  const started = await executeAgentPrepared(pi, core, childSessions, pendingWaits, specialist, ctx);
  assert.equal(started.details.status, "running");
  const expectedPrompt = readFileSync(new URL(`../resources/agents/${promptFile}`, import.meta.url), "utf8").trim();
  assert.equal(allocatedResourceLoader.getSystemPrompt(), expectedPrompt, `${requirementId}: specialist owns its base system prompt`);
  assert.equal(
    allocatedResourceLoader.getAppendSystemPrompt().includes(expectedPrompt),
    false,
    `${requirementId}: specialist prompt is not appended to Pi's base prompt`,
  );
  settle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const specialistClose = core.call("prepareTool", [{ name: "agent_close", params: { agent_id: specialist.agentId }, ctx }]);
  await executeAgentPrepared(pi, core, childSessions, pendingWaits, specialistClose, ctx);
}

// A close must cancel an indefinite wait for a run it removes.
const send = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "run again", description: "Run agent again" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, send, ctx);
assert.equal(core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status, "running", "close-test dispatch remained running");
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

// agent-l7da: unknown SDK states must never be normalized to successful completion.
const unknownCompletion = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "unknown completion", description: "Reject unknown completion" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, unknownCompletion, ctx);
settle({ role: "assistant", content: [{ type: "text", text: "ambiguous answer" }], stopReason: "future_terminal" });
await new Promise((resolve) => setTimeout(resolve, 0));
const unknownCompletionList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0];
assert.equal(unknownCompletionList.status, "failed");
const unknownCompletionWait = core.call("prepareTool", [{
  name: "agent_wait", params: { run_ids: [unknownCompletion.runId], timeout_seconds: 0 }, ctx,
}]);
assert.match(unknownCompletionWait.details.results[0].error, /unknown SDK stop reason.*future_terminal/i);

const unknownHostCompletion = await sendToChildSession({}, {
  call: () => ({
    send: true, prompt: "probe", deliverAs: "followUp",
    result: { dispatched: true },
  }),
}, {
  sendUserMessage: async () => ({ status: "future_terminal", output: "ambiguous host answer" }),
}, "probe");
assert.equal(unknownHostCompletion.completion.status, "failed");
assert.match(unknownHostCompletion.completion.reason, /unknown SDK completion status.*future_terminal/i);

for (const malformedCompletion of [
  { status: 42, output: "ambiguous" },
  { stopReason: "", output: "ambiguous" },
  { isError: "true", output: "ambiguous" },
]) {
  const malformedHostCompletion = await sendToChildSession({}, {
    call: () => ({ send: true, prompt: "probe", deliverAs: "followUp", result: { dispatched: true } }),
  }, { sendUserMessage: async () => malformedCompletion }, "probe");
  assert.equal(malformedHostCompletion.completion.status, "failed");
}
const oversizedHostCompletion = await sendToChildSession({}, {
  call: () => ({ send: true, prompt: "probe", deliverAs: "followUp", result: { dispatched: true } }),
}, { sendUserMessage: async () => ({ status: `future_${"x".repeat(5000)}`, output: "ambiguous" }) }, "probe");
assert.equal(oversizedHostCompletion.completion.reason.length, 4096);
const errorOnlyHostCompletion = await sendToChildSession({}, {
  call: () => ({ send: true, prompt: "probe", deliverAs: "followUp", result: { dispatched: true } }),
}, { sendUserMessage: async () => ({ errorMessage: "provider failed" }) }, "probe");
assert.equal(errorOnlyHostCompletion.completion.status, "failed");
assert.equal(errorOnlyHostCompletion.completion.reason, "provider failed");

const abortedCompletion = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "abort completion", description: "Classify aborted completion" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, abortedCompletion, ctx);
settle({ role: "assistant", content: [], stopReason: "aborted", errorMessage: "Request was aborted" });
await new Promise((resolve) => setTimeout(resolve, 0));
const abortedCompletionList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0];
assert.equal(abortedCompletionList.status, "cancelled");

const malformedMessageCompletion = core.call("prepareTool", [{
  name: "agent_send", params: { agent_id: prepared.agentId, message: "malformed completion", description: "Reject malformed completion" }, ctx,
}]);
await executeAgentPrepared(pi, core, childSessions, pendingWaits, malformedMessageCompletion, ctx);
settle({ role: "assistant", content: [], stopReason: "stop", errorMessage: 42 });
await new Promise((resolve) => setTimeout(resolve, 0));
const malformedMessageList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0];
assert.equal(malformedMessageList.status, "failed");

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
