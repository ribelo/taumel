import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const bootstrap = globalThis.taumel;
let core;
assert.ok(bootstrap && typeof bootstrap.init === "function");

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

core = bootstrap.init({
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
  params: { message: "investigate", description: "Investigate agent lifecycle", tier: "high" },
  ctx,
}]);
assert.equal(start.ok, true);
assert.equal(start.action, "agent_start");
assert.equal(start.details.status, "running");
assert.equal(start.details.tier, "high");
assert.deepEqual(JSON.parse(start.text), {
  agent_id: start.details.agent_id,
  run_id: start.details.run_id,
  kind: "generic",
  status: "running",
  tier: "high",
});

const { agentId: agentId, runId, submissionId } = start;
assert.match(agentId, /^agent-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
assert.equal(runId, `${agentId}-run-1`);
assert.equal(start.details.agent_id, agentId);
assert.equal(start.details.run_id, runId);
// agent-id19: reconciliation without a live authoritative dispatch is observable as orphaned.
assert.equal(core.call("reconcileLiveAgentDispatches", [{ live_agent_ids: [] }, ctx]).ok, true);
const orphanedList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]);
assert.equal(orphanedList.details.agents[0].activity.state, "orphaned");
assert.equal(orphanedList.details.agents[0].activity.recommendation, "interrupt_or_close");
// agent-id20/agent-id21: authoritative child events drive observable phase and turn count.
for (const event of ["turn_start", "tool_execution_start", "tool_execution_update", "tool_execution_end", "turn_end"]) {
  assert.equal(core.call("recordAgentActivity", [{ run_id: runId, submission_id: submissionId, event }, ctx]).ok, true);
}
// agent-ls02: list exposes lifecycle/activity metadata without routing in model-visible JSON.
const activeList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]);
assert.equal(activeList.details.agents[0].activity.state, "reasoning");
assert.equal(activeList.details.agents[0].turn_count, 1);
assert.match(activeList.details.agents[0].activity.last_at, /[+-]\d\d:\d\d$/);
assert.equal("model" in JSON.parse(activeList.text)[0], false);
assert.equal("thinking" in JSON.parse(activeList.text)[0], false);
const offsetMinutes = -new Date().getTimezoneOffset();
const expectedOffset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMinutes) % 60).padStart(2, "0")}`;
assert.equal(activeList.details.agents[0].created_at.endsWith(expectedOffset), true, "agent-rs15 timestamps must include the DST-aware local offset");
const childDirectory = `/tmp/${agentId}`;
const childFile = `${childDirectory}/session.jsonl`;
mkdirSync(childDirectory, { recursive: true });
writeFileSync(childFile, `${JSON.stringify({
  type: "custom",
  customType: "taumel.childSession",
  data: { agentId, parentSessionId: "agent-lifecycle-smoke" },
})}\n`);
const settledAssistantEntry = JSON.stringify({
  type: "message",
  id: "answer-entry",
  parentId: null,
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    content: [{ type: "text", text: "the answer" }],
    stopReason: "stop",
  },
});
const olderAssistantEntry = JSON.stringify({
  type: "message",
  id: "answer-a",
  parentId: null,
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    content: [{ type: "text", text: "answer A" }],
    stopReason: "stop",
  },
});
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
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status,
  "running",
  "an isolated child session_start must not replace its parent's live agent state",
);
// agent-ps18: list reconciliation repairs a settled child whose callback was lost.
appendFileSync(childFile, `${olderAssistantEntry}\n${settledAssistantEntry}\n`);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status,
  "completed",
);

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

// agent-ps18: the prior assistant entry is an unambiguous dispatch boundary,
// even when a follow-up is accepted in the same timestamp second.
const followUp = core.call("prepareTool", [{
  name: "agent_send",
  params: { agent_id: agentId, message: "continue", description: "Continue lifecycle work" },
  ctx,
}]);
assert.equal(core.call("recordAgentDispatchBoundary", [{
  run_id: followUp.runId,
  submission_id: followUp.submissionId,
  previous_assistant_entry_id: "answer-entry",
}, ctx]).ok, true);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents[0].status,
  "running",
  "the preceding answer must not settle a newly accepted follow-up",
);
const answerC = JSON.stringify({
  type: "message",
  id: "answer-c",
  parentId: null,
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    content: [{ type: "text", text: "answer C" }],
    stopReason: "stop",
  },
});
appendFileSync(childFile, `${answerC}\n`);
const completedFollowUp = core.call("prepareTool", [{
  name: "agent_wait",
  params: { run_ids: [followUp.runId], timeout_seconds: 0 },
  ctx,
}]);
assert.equal(completedFollowUp.details.results[0].output, "answer C");

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
  params: { message: "replacement", description: "Start replacement agent", tier: "low" },
  ctx,
}]);
assert.equal(replacement.ok, true);
assert.match(replacement.agentId, /^agent-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
assert.notEqual(replacement.agentId, agentId, "closed agent handles must remain retired");
assert.equal(core.call("finishAgentClose", [{ agent_id: replacement.agentId }, ctx]).ok, true);

rmSync(childDirectory, { recursive: true, force: true });

console.log("agent lifecycle smoke: all assertions passed");
