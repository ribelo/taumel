import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const core = globalThis.taumel;
assert.ok(core && typeof core.call === "function" && typeof core.init === "function");

const entries = [];
entries.push({
  type: "custom",
  customType: "taumel.agents",
  data: { version: 1, issued_identity_count: 99, identities: [], runs: [] },
});
const handlers = new Map();
const ctx = {
  cwd: process.cwd(),
  activeTools: [
    "read", "exec_command", "edit",
    "agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close",
    "finder", "oracle",
  ],
  model: { provider: "openai-codex", id: "gpt-test" },
  sessionManager: {
    sessionId: "agent-lifecycle-smoke",
    getSessionId() { return this.sessionId; },
    getSessionFile: () => "/tmp/agent-lifecycle-smoke.jsonl",
    getEntries: () => entries,
    appendCustomEntry: (customType, data) => {
      entries.push({ type: "custom", customType, data });
    },
  },
};

core.init({
  resolveAuthorizationPath: realpathSync,
  on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({
    cwd: process.cwd(),
    provider: "openai-codex",
    model: "gpt-test",
    thinking: "medium",
    totalCost: 0,
    contextPercent: 0,
    contextWindow: 200_000,
  }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
});

const start = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "investigate", effort: "high" },
  ctx,
}]);
assert.equal(start.ok, true);
assert.equal(start.action, "agent_start");
assert.equal(start.details.status, "running");
assert.equal(start.details.effort, "high");
assert.match(start.text, /agent_id=/);
assert.match(start.text, /run_id=/);

const { agentId: agentId, runId, submissionId } = start;
assert.match(agentId, /^agent-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
assert.equal(runId, `${agentId}-run-1`);
assert.equal(start.details.agent_id, agentId);
assert.equal(start.details.run_id, runId);
const childDirectory = `/tmp/${agentId}`;
const childFile = `${childDirectory}/session.jsonl`;
mkdirSync(childDirectory, { recursive: true });
writeFileSync(childFile, `${JSON.stringify({
  type: "message",
  id: "answer-entry",
  parentId: null,
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    content: [{ type: "text", text: "the answer" }],
    stopReason: "stop",
  },
})}\n`);
assert.equal(core.call("recordAgentChildSessionStart", [{
  agent_id: agentId,
  sessionId: "private-child-session",
  sessionFile: childFile,
}, ctx]).ok, true);

const isolatedChildCtx = {
  ...ctx,
  sessionManager: {
    sessionId: "isolated-child-session",
    getSessionId() { return this.sessionId; },
    getSessionFile: () => childFile,
    getEntries: () => [{
      type: "custom",
      customType: "taumel.childSession",
      data: { kind: "agent", isolated_child: true, parentSessionId: "agent-lifecycle-smoke" },
    }],
    getBranch: () => [],
  },
};
for (const handler of handlers.get("session_start") ?? []) {
  handler({ type: "session_start" }, isolatedChildCtx);
}
core.call("planActiveToolsSync", [{ tools: ["read"], ctx: isolatedChildCtx }]);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].latest_run_status,
  "running",
  "an isolated child session_start must not replace its parent's live agent state",
);

assert.equal(core.call("recordAgentDispatchCompletion", [{
  run_id: runId,
  submission_id: submissionId,
  completion: {
    status: "completed",
    finalOutput: "the answer",
    resultEntryId: "answer-entry",
  },
}, ctx]).ok, true);

// Simulate process resume: the parent snapshot contains only the child entry
// locator, not the assistant text. agent_wait must recover the exact message.
core.call("reloadSessionState", [ctx]);

const waited = core.call("prepareTool", [{
  name: "agent_wait",
  params: { run_ids: [runId], timeout_seconds: 0 },
  ctx,
}]);
assert.equal(waited.ok, true);
assert.equal(waited.action, "tool_result");
assert.equal(waited.details.results[0].output, "the answer");
assert.match(waited.text, /the answer/);
assert.deepEqual(waited.details.pending_run_ids, []);
assert.deepEqual(core.call("pendingAgentNotifications", [ctx]).notifications, []);
const managerSnapshot = core.call("agentManagerSnapshot", [ctx]);
assert.equal(managerSnapshot.agents[0].agentId, agentId);
assert.equal(managerSnapshot.runs[0].runId, runId);
assert.equal(managerSnapshot.runs[0].status, "completed");

const foreignCtx = {
  ...ctx,
  sessionManager: {
    sessionId: "foreign-session",
    getSessionId() { return this.sessionId; },
    getSessionFile: () => "/tmp/foreign-session.jsonl",
    getEntries: () => entries,
    appendCustomEntry: () => undefined,
  },
};
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx: foreignCtx }]).details.agents.length,
  0,
  "copied agent metadata must remain owned by its original Pi session",
);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents.length,
  1,
);

const closePlan = core.call("prepareTool", [{
  name: "agent_close",
  params: { agent_id: agentId },
  ctx,
}]);
assert.equal(closePlan.ok, true);
assert.equal(closePlan.action, "agent_close");
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents.length,
  1,
  "close planning must not remove state before physical cleanup",
);
assert.equal(core.call("finishAgentClose", [{ agent_id: agentId }, ctx]).ok, true);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents.length,
  0,
);
assert.equal(core.call("prepareTool", [{
  name: "agent_wait",
  params: { run_ids: [runId], timeout_seconds: 0 },
  ctx,
}]).ok, false);

const replacement = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "replacement", effort: "low" },
  ctx,
}]);
assert.equal(replacement.ok, true);
assert.match(replacement.agentId, /^agent-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
assert.notEqual(replacement.agentId, agentId, "closed agent handles must remain retired");
assert.equal(core.call("finishAgentClose", [{ agent_id: replacement.agentId }, ctx]).ok, true);

rmSync(childDirectory, { recursive: true, force: true });

console.log("agent lifecycle smoke: all assertions passed");
