import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { latestTaumelCustomEntry } from "../src/pi-session-entries.ts";

const agentHome = mkdtempSync(join(tmpdir(), "taumel-agent-lifecycle-"));
process.env.PI_CODING_AGENT_DIR = agentHome;
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
const ownerSessionId = "agent-lifecycle-smoke";
const ownerHash = createHash("sha256").update(ownerSessionId).digest("hex");
const registryPath = join(agentHome, "taumel", "agents", "owners", ownerHash, "registry.json");
function presenceMarkers() {
  return entries.filter((entry) => entry.customType === "taumel.agents.presence");
}
function forceNextRegistryWriteFailure() {
  process.env.TAUMEL_FAIL_NEXT_AGENT_REGISTRY_WRITE = "1";
}
const ctx = {
  cwd: process.cwd(),
  activeTools: [
    "read", "exec_command", "edit",
    "agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close",
    "finder", "oracle",
  ],
  model: { provider: "openai-codex", id: "gpt-test" },
  sessionManager: {
    sessionId: ownerSessionId,
    getSessionId() { return this.sessionId; },
    getSessionFile: () => join(agentHome, "agent-lifecycle-smoke.jsonl"),
    getEntries: () => entries,
    appendCustomEntry: (customType, data) => {
      entries.push({ type: "custom", customType, data });
    },
  },
};

const host = {
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
};
core = bootstrap.init(host);

for (const [method, args] of [
  ["rollbackUnacceptedAgentStart", [{}, ctx]],
  ["recordAgentChildSessionStartAuthorized", [{}, {}, ctx]],
  ["rollbackAgentSendPreflight", [{}, ctx]], ["recordAgentSendDispatchFailure", [{}, ctx]],
  ["rollbackFailedAgentInterruption", [{}, ctx]], ["recordAgentDispatchCompletion", [{}, ctx]],
  ["recordAgentActivity", [{}, ctx]],
  ["recordAgentDispatchBoundaryAuthorized", [{}, {}, ctx]],
  ["reconcileLiveAgentDispatches", [{}, ctx]], ["recordAgentBackgroundNotification", [{}, ctx]],
  ["validateAgentBackgroundNotificationClaim", [{}, ctx]], ["finishAgentWait", [{}, ctx]],
  ["finishAgentClose", [{}, ctx]], ["acceptAgentWorktreeStart", [{}, ctx]],
  ["rollbackAgentWorktreeStart", [{}, ctx]], ["deleteAgentWorktree", [{}, ctx]],
  ["cancelAgentBrokerSessions", [{}]], ["deleteAgentChildSession", [{}, ctx]],
  ["recordAgentCloseCleanupFailure", [{}, ctx]],
]) {
  assert.throws(
    () => core.call(method, args),
    `${method} accepted malformed lifecycle facts`,
  );
}
for (const facts of [
  { capabilityId: "missing", agentId: "agent-x", action: "agent_start", ctx },
  { capabilityId: "missing", agentId: "agent-x", action: "agent_close", runId: "run-x", ctx },
  { capabilityId: "missing", agentId: "agent-x", action: "agent_send", submissionId: "submission-x", ctx },
]) {
  assert.throws(() => core.call("claimAgentAction", [facts]), "invalid capability binding was representable at runtime");
}
for (const method of [
  "claimAgentAction", "revalidateAgentAction", "ratchetAgentAction",
  "authorizeAgentActionCleanup", "prepareAgentCloseStop",
  "completeAgentCloseStop", "releaseAgentAction",
]) {
  assert.throws(() => core.call(method, [{}]), `${method} accepted malformed capability facts`);
}

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
  agent_id: start.details.agentId,
  run_id: start.details.runId,
  kind: "generic",
  status: "running",
  tier: "high",
});

const { agentId: agentId, runId, submissionId } = start;
assert.match(agentId, /^agent-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
assert.equal(runId, `${agentId}-run-1`);
assert.equal(start.details.agentId, agentId);
assert.equal(start.details.runId, runId);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents.length,
  0,
  "agent-1inq: unclaimed start committed agent state",
);
const startCapabilityFacts = {
  capabilityId: start.capabilityId, agentId, action: start.action,
  runId: start.runId, submissionId: start.submissionId, ctx,
};
assert.equal(core.call("claimAgentAction", [startCapabilityFacts]).ok, true);
const replayedStartCapability = core.call("claimAgentAction", [startCapabilityFacts]);
assert.equal(replayedStartCapability.ok, false, "agent action capability was replayable");
assert.match(replayedStartCapability.error, /invalid|consumed/);
assert.equal(core.call("revalidateAgentAction", [startCapabilityFacts]).ok, true,
  "claimed capability was not ratcheted across its committed state transition");
assert.equal(core.call("ratchetAgentAction", [startCapabilityFacts]).ok, true);
assert.equal(core.call("revalidateAgentAction", [startCapabilityFacts]).ok, true,
  "explicit capability progression did not preserve forward authority");
const realDateNow = Date.now;
try {
  Date.now = () => realDateNow() + (11 * 60 * 1000);
  const expiredCleanup = core.call("authorizeAgentActionCleanup", [startCapabilityFacts]);
  assert.equal(expiredCleanup.ok, false, "expired agent capability authorized cleanup");
  assert.match(expiredCleanup.error, /expired/);
} finally {
  Date.now = realDateNow;
}
assert.equal(core.call("releaseAgentAction", [startCapabilityFacts]).ok, true);

const prepareCloseCapability = () => {
  const prepared = core.call("prepareTool", [{
    name: "agent_close", params: { agent_id: agentId }, ctx,
  }]);
  assert.equal(prepared.action, "agent_close");
  return {
    capabilityId: prepared.capabilityId,
    agentId,
    action: prepared.action,
    ctx,
  };
};

const ownerBoundFacts = prepareCloseCapability();
assert.equal(core.call("claimAgentAction", [ownerBoundFacts]).ok, true);
const foreignCapabilityCtx = {
  ...ctx,
  sessionManager: {
    ...ctx.sessionManager,
    sessionId: "foreign-agent-owner",
    getSessionId() { return this.sessionId; },
    getSessionFile: () => "/tmp/foreign-agent-owner.jsonl",
    getEntries: () => [],
  },
};
const wrongOwnerCleanup = core.call("authorizeAgentActionCleanup", [{
  ...ownerBoundFacts, ctx: foreignCapabilityCtx,
}]);
assert.equal(wrongOwnerCleanup.ok, false, "foreign owner authorized agent cleanup");
assert.match(wrongOwnerCleanup.error, /another session/);
const ownerEpochStaleCleanup = core.call("authorizeAgentActionCleanup", [ownerBoundFacts]);
assert.equal(ownerEpochStaleCleanup.ok, false, "owner-epoch-stale capability authorized cleanup");
assert.match(ownerEpochStaleCleanup.error, /stale/);
assert.equal(core.call("releaseAgentAction", [ownerBoundFacts]).ok, true);

const permissionBoundFacts = prepareCloseCapability();
assert.equal(core.call("claimAgentAction", [permissionBoundFacts]).ok, true);
entries.push({
  type: "custom",
  customType: "taumel.permissions",
  data: {
    version: 1,
    profile: {
      modelId: "inherit",
      thinkingLevel: "medium",
      sandboxPreset: "workspace-write",
      approvalPolicy: "never",
      tools: { kind: "all" },
      noSandboxAllowed: false,
    },
    networkMode: "disabled",
    noSandbox: false,
    isolated_child: false,
  },
});
core.call("reloadSessionState", [ctx]);
const wrongPermissionCleanup = core.call("authorizeAgentActionCleanup", [permissionBoundFacts]);
assert.equal(wrongPermissionCleanup.ok, false, "permission-epoch-stale capability authorized cleanup");
assert.match(wrongPermissionCleanup.error, /stale/);
assert.equal(core.call("releaseAgentAction", [permissionBoundFacts]).ok, true);

const rollbackPrepared = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "rollback", description: "Exercise transactional persistence" },
  ctx,
}]);
const rollbackCapabilityFacts = {
  capabilityId: rollbackPrepared.capabilityId,
  agentId: rollbackPrepared.agentId,
  action: rollbackPrepared.action,
  runId: rollbackPrepared.runId,
  submissionId: rollbackPrepared.submissionId,
  ctx,
};
assert.equal(core.call("claimAgentAction", [rollbackCapabilityFacts]).ok, true);
assert.equal(core.call("recordAgentChildSessionStartAuthorized", [{
  agent_id: agentId,
  sessionId: "forged-cross-agent-session",
}, rollbackCapabilityFacts, ctx]).ok, false,
"capability authorized another agent's lifecycle transition");
forceNextRegistryWriteFailure();
assert.equal(core.call("recordAgentChildSessionStartAuthorized", [{
  agent_id: rollbackPrepared.agentId,
  sessionId: "uncommitted-child-session",
  sessionFile: "/tmp/uncommitted-child-session.jsonl",
}, rollbackCapabilityFacts, ctx]).ok, false);
forceNextRegistryWriteFailure();
assert.equal(core.call("recordAgentDispatchBoundaryAuthorized", [{
  run_id: rollbackPrepared.runId,
  submission_id: rollbackPrepared.submissionId,
  previous_assistant_entry_id: "uncommitted-boundary",
}, rollbackCapabilityFacts, ctx]).ok, false);
assert.equal(core.call("authorizeAgentActionCleanup", [rollbackCapabilityFacts]).ok, true,
  "tentative persistence failure invalidated required compensation authority");
assert.equal(core.call("rollbackUnacceptedAgentStart", [{
  agent_id: rollbackPrepared.agentId,
  run_id: rollbackPrepared.runId,
  submission_id: rollbackPrepared.submissionId,
}, ctx]).ok, true);
assert.equal(core.call("releaseAgentAction", [rollbackCapabilityFacts]).ok, true);
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
// agent-ishi/agent-zr7q/agent-dh9z: activity and metrics stay memory-only; the
// parent session receives only the bounded presence marker, not registry
// snapshots or activity samples.
const markersAfterLifecycle = presenceMarkers();
assert.equal(markersAfterLifecycle.length, 1, "agent-cbh3: exactly one presence marker after first durable state");
assert.deepEqual(markersAfterLifecycle[0].data, {
  storage_schema_version: 1,
  owner_session_id: ownerSessionId,
});
assert.equal(
  entries.filter((entry) => entry.customType === "taumel.agents.v4").length,
  0,
  "agent-dh9z: parent session must not receive registry snapshots",
);
assert.ok(existsSync(registryPath), "agent-qeg2: current registry lives in owner storage");
const registryEnvelope = JSON.parse(readFileSync(registryPath, "utf8"));
assert.equal(registryEnvelope.storage_schema_version, 1);
assert.equal(registryEnvelope.owner_session_id, ownerSessionId);
assert.equal(registryEnvelope.registry.version, 6);
const registryBeforeActivity = readFileSync(registryPath, "utf8");
const registryInodeBeforeActivity = statSync(registryPath).ino;
const markersBeforeActivity = presenceMarkers().length;
assert.equal(core.call("recordAgentActivity", [{ run_id: runId, submission_id: submissionId, event: "turn_start" }, ctx]).ok, true);
assert.equal(readFileSync(registryPath, "utf8"), registryBeforeActivity, "agent-ishi: activity must not write durable state");
assert.equal(statSync(registryPath).ino, registryInodeBeforeActivity,
  "agent-ishi: activity must not physically replace durable state");
assert.equal(presenceMarkers().length, markersBeforeActivity, "activity must not append another parent marker");
const swapChildCtx = {
  ...ctx,
  sessionManager: {
    sessionId: "journal-swap-child-session",
    getSessionId() { return this.sessionId; },
    getSessionFile: () => join(agentHome, "journal-swap-child.jsonl"),
    getEntries: () => [{
      type: "custom",
      customType: "taumel.childSession",
      data: { kind: "agent", isolated_child: true, parentSessionId: ownerSessionId },
    }],
    getBranch: () => [],
  },
};
// Isolated children may load their own non-agent session state, but nesting is
// unavailable and they must not replace the live parent's agent projection.
assert.throws(
  () => core.call("agentManagerSnapshot", [swapChildCtx]),
  /projection unavailable/,
);
core.call("agentManagerSnapshot", [ctx]);
const afterSwapList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]);
assert.equal(afterSwapList.details.agents.length, 1, "owner registry reloads from durable current registry");
assert.equal(afterSwapList.details.agents[0].status, "running");
assert.equal(afterSwapList.details.agents[0].turn_count, 1,
  "child projection load must preserve the parent's memory-only activity");
const presenceLookup = latestTaumelCustomEntry(ctx.sessionManager, "taumel.agents.presence");
assert.equal(presenceLookup.kind, "contract_valid", "presence marker satisfies the persisted-entry contract");
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
const childBinding = core.call("prepareTool", [{
  name: "agent_send",
  params: { agent_id: agentId, message: "bind child", description: "Bind child session" },
  ctx,
}]);
const childBindingCapability = {
  capabilityId: childBinding.capabilityId,
  agentId,
  action: childBinding.action,
  runId: childBinding.runId,
  submissionId: childBinding.submissionId,
  ctx,
};
assert.equal(core.call("claimAgentAction", [childBindingCapability]).ok, true);
assert.equal(core.call("recordAgentChildSessionStartAuthorized", [{
  agent_id: agentId,
  sessionId: "private-child-session",
  sessionFile: childFile,
}, childBindingCapability, ctx]).ok, true);
assert.equal(core.call("releaseAgentAction", [childBindingCapability]).ok, true);

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
const followUpCapabilityFacts = {
  capabilityId: followUp.capabilityId, agentId, action: followUp.action,
  runId: followUp.runId, submissionId: followUp.submissionId, ctx,
};
assert.equal(core.call("claimAgentAction", [followUpCapabilityFacts]).ok, true);
assert.equal(core.call("recordAgentDispatchBoundaryAuthorized", [{
  run_id: followUp.runId,
  submission_id: followUp.submissionId,
  previous_assistant_entry_id: "answer-entry",
}, followUpCapabilityFacts, ctx]).ok, true);
assert.equal(core.call("releaseAgentAction", [followUpCapabilityFacts]).ok, true);
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
const closeCapabilityFacts = {
  capabilityId: closePlan.capabilityId, agentId, action: closePlan.action, ctx,
};
assert.equal(core.call("claimAgentAction", [closeCapabilityFacts]).ok, true);
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents.length,
  1,
  "close planning must not remove state before physical cleanup",
);
assert.equal(core.call("finishAgentClose", [{ agent_id: agentId }, ctx]).ok, true);
assert.equal(core.call("releaseAgentAction", [closeCapabilityFacts]).ok, true);
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
const replacementCapabilityFacts = {
  capabilityId: replacement.capabilityId, agentId: replacement.agentId,
  action: replacement.action, runId: replacement.runId,
  submissionId: replacement.submissionId, ctx,
};
assert.equal(core.call("claimAgentAction", [replacementCapabilityFacts]).ok, true);
assert.equal(core.call("releaseAgentAction", [replacementCapabilityFacts]).ok, true);
assert.match(replacement.agentId, /^agent-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
assert.notEqual(replacement.agentId, agentId, "closed agent handles must remain retired");
assert.equal(core.call("finishAgentClose", [{ agent_id: replacement.agentId }, ctx]).ok, true);

// agent-zr7q/agent-ishi: repeated active finishAgentWait polling and activity
// produce zero physical registry writes; the first terminal observation writes once.
const pollAgent = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "poll", description: "Agent for poll write test", tier: "low" },
  ctx,
}]);
assert.equal(pollAgent.ok, true);
const pollCapabilityFacts = {
  capabilityId: pollAgent.capabilityId, agentId: pollAgent.agentId,
  action: pollAgent.action, runId: pollAgent.runId,
  submissionId: pollAgent.submissionId, ctx,
};
assert.equal(core.call("claimAgentAction", [pollCapabilityFacts]).ok, true);
assert.equal(core.call("releaseAgentAction", [pollCapabilityFacts]).ok, true);
const registryBeforePoll = readFileSync(registryPath, "utf8");
const registryInodeBeforePoll = statSync(registryPath).ino;
const markersBeforePoll = presenceMarkers().length;
const startedAt = Date.now();
while (Date.now() - startedAt < 50) {
  assert.equal(core.call("finishAgentWait", [{
    run_ids: [pollAgent.runId],
  }, ctx]).ok, true);
  assert.equal(core.call("recordAgentActivity", [{
    run_id: pollAgent.runId,
    submission_id: pollAgent.submissionId,
    event: "tool_execution_update",
  }, ctx]).ok, true);
}
assert.equal(readFileSync(registryPath, "utf8"), registryBeforePoll,
  "agent-zr7q: repeated active wait/activity loop must not rewrite the registry");
assert.equal(statSync(registryPath).ino, registryInodeBeforePoll,
  "agent-zr7q: repeated active wait/activity loop must perform zero physical writes");
assert.equal(presenceMarkers().length, markersBeforePoll,
  "agent-cbh3: polling must not append another presence marker");
assert.equal(core.call("recordAgentDispatchCompletion", [{
  run_id: pollAgent.runId,
  submission_id: pollAgent.submissionId,
  completion: { status: "completed", finalOutput: "poll complete" },
}, ctx]).ok, true);
const registryAfterTerminal = readFileSync(registryPath, "utf8");
assert.notEqual(registryAfterTerminal, registryBeforePoll,
  "first terminal lifecycle mutation must write the current registry once");
assert.equal(
  JSON.parse(registryAfterTerminal).registry.runs.find((run) => run.run_id === pollAgent.runId)?.status,
  "completed",
);
assert.equal(core.call("finishAgentWait", [{ run_ids: [pollAgent.runId] }, ctx]).ok, true);
const registryAfterObservedWait = readFileSync(registryPath, "utf8");
const registryInodeAfterObservedWait = statSync(registryPath).ino;
assert.notEqual(registryAfterObservedWait, registryAfterTerminal,
  "first terminal observation must write announcement state once");
const registryAfterRepeatWait = (() => {
  assert.equal(core.call("finishAgentWait", [{ run_ids: [pollAgent.runId] }, ctx]).ok, true);
  return readFileSync(registryPath, "utf8");
})();
assert.equal(registryAfterRepeatWait, registryAfterObservedWait,
  "idempotent terminal wait must perform no durable write");
assert.equal(statSync(registryPath).ino, registryInodeAfterObservedWait,
  "idempotent terminal wait must perform zero physical writes");
assert.equal(presenceMarkers().length, markersBeforePoll,
  "later durable writes reuse the existing presence marker");
assert.equal(core.call("finishAgentClose", [{ agent_id: pollAgent.agentId }, ctx]).ok, true);

// agent-ps12/shared-st03 regression: shutdown entry points must synchronize the
// owner projection before touching the registry. With a child projection
// loaded last, an unsynchronized shutdown would read the foreign (empty)
// registry and persist it over the owner.
const shutdownAgent = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "shutdown", description: "Agent for shutdown sync test", tier: "low" },
  ctx,
}]);
assert.equal(shutdownAgent.ok, true);
const shutdownCapabilityFacts = {
  capabilityId: shutdownAgent.capabilityId, agentId: shutdownAgent.agentId,
  action: shutdownAgent.action, runId: shutdownAgent.runId,
  submissionId: shutdownAgent.submissionId, ctx,
};
assert.equal(core.call("claimAgentAction", [shutdownCapabilityFacts]).ok, true);
assert.equal(core.call("releaseAgentAction", [shutdownCapabilityFacts]).ok, true);
assert.equal(core.call("recordAgentActivity", [{
  run_id: shutdownAgent.runId,
  submission_id: shutdownAgent.submissionId,
  event: "turn_end",
}, ctx]).ok, true);
const stateBoundClose = core.call("prepareTool", [{
  name: "agent_close", params: { agent_id: shutdownAgent.agentId }, ctx,
}]);
const stateBoundFacts = {
  capabilityId: stateBoundClose.capabilityId,
  agentId: shutdownAgent.agentId,
  action: stateBoundClose.action,
  ctx,
};
assert.equal(core.call("claimAgentAction", [stateBoundFacts]).ok, true);
assert.equal(core.call("prepareAgentCloseStop", [stateBoundFacts]).ok, true);
assert.equal(core.call("suspendOwnerAgentsOnShutdown", [ctx]).ok, true);
assert.equal(core.call("recordAgentDispatchCompletion", [{
  run_id: shutdownAgent.runId,
  submission_id: shutdownAgent.submissionId,
  completion: { status: "completed", finalOutput: "late completion" },
}, ctx]).ok, true);
const staleCloseStop = core.call("completeAgentCloseStop", [stateBoundFacts]);
assert.equal(staleCloseStop.ok, false,
  "no-op late completion revived close-stop authority after suspension");
assert.match(staleCloseStop.error, /stale|does not match/);
const stateStaleForward = core.call("revalidateAgentAction", [stateBoundFacts]);
assert.equal(stateStaleForward.ok, false, "agent-state-stale capability retained forward authority");
assert.match(stateStaleForward.error, /stale/);
const revivedStateCapability = core.call("ratchetAgentAction", [stateBoundFacts]);
assert.equal(revivedStateCapability.ok, false, "public ratchet revived a state-stale capability");
assert.match(revivedStateCapability.error, /stale/);
const stateStaleCleanup = core.call("authorizeAgentActionCleanup", [stateBoundFacts]);
assert.equal(stateStaleCleanup.ok, false, "agent-state-stale capability authorized cleanup");
assert.match(stateStaleCleanup.error, /stale/);
assert.equal(core.call("releaseAgentAction", [stateBoundFacts]).ok, true);
assert.throws(() => core.call("agentManagerSnapshot", [swapChildCtx]), /projection unavailable/);
assert.equal(core.call("suspendOwnerAgentsOnShutdown", [ctx]).ok, true);
const afterShutdownList = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]);
assert.equal(afterShutdownList.details.agents.length, 1,
  "shutdown with a child projection loaded must not clobber the owner registry");
assert.equal(afterShutdownList.details.agents[0].status, "suspended",
  "owner runs must be suspended on shutdown");
assert.equal(afterShutdownList.details.agents[0].agent_id, shutdownAgent.agentId,
  "owner identity survives shutdown with a child projection loaded");

// agent-7jhj: bootstrap from latest same-owner v4 parent snapshot when no
// sidecar/marker exists. Keep the original owner so deterministic issued-handle
// reconstruction matches the retained identity.
const bootstrapOwner = "bootstrap-owner";
const bootstrapHash = createHash("sha256").update(bootstrapOwner).digest("hex");
const bootstrapRegistry = join(agentHome, "taumel", "agents", "owners", bootstrapHash, "registry.json");
const bootstrapEntries = [];
const bootstrapCtx = {
  ...ctx,
  sessionManager: {
    sessionId: bootstrapOwner,
    getSessionId() { return this.sessionId; },
    getSessionFile: () => join(agentHome, "bootstrap-owner.jsonl"),
    getEntries: () => bootstrapEntries,
    appendCustomEntry: (customType, data) => {
      bootstrapEntries.push({ type: "custom", customType, data });
    },
  },
};
const seed = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "seed", description: "Seed bootstrap registry", tier: "low" },
  ctx: bootstrapCtx,
}]);
assert.equal(seed.ok, true);
const seedCapability = {
  capabilityId: seed.capabilityId, agentId: seed.agentId,
  action: seed.action, runId: seed.runId, submissionId: seed.submissionId,
  ctx: bootstrapCtx,
};
assert.equal(core.call("claimAgentAction", [seedCapability]).ok, true);
assert.equal(core.call("releaseAgentAction", [seedCapability]).ok, true);
const currentEnvelope = JSON.parse(readFileSync(bootstrapRegistry, "utf8"));
const currentRegistry = currentEnvelope.registry;
const { issued_ids: _issuedIds, ...issuedCounts } = currentRegistry.issued_identity_counts;
const v4Snapshot = {
  version: 4,
  issued_identity_counts: issuedCounts,
  identities: currentRegistry.identities,
  runs: currentRegistry.runs,
};
// Drop durable current registry and presence marker; leave only the v4 snapshot.
rmSync(bootstrapRegistry, { force: true });
for (let index = bootstrapEntries.length - 1; index >= 0; index -= 1) {
  if (bootstrapEntries[index].customType === "taumel.agents.presence") {
    bootstrapEntries.splice(index, 1);
  }
}
bootstrapEntries.push({ type: "custom", customType: "taumel.agents.v4", data: v4Snapshot });
// Force a different main-owner projection before reloading bootstrapOwner.
core.call("agentManagerSnapshot", [ctx]);
const bootstrapped = core.call("prepareTool", [{ name: "agent_list", params: {}, ctx: bootstrapCtx }]);
assert.equal(bootstrapped.details.agents.length, 1, "agent-7jhj: latest same-owner v4 snapshot bootstraps");
assert.equal(bootstrapped.details.agents[0].agent_id, seed.agentId);
assert.ok(existsSync(bootstrapRegistry), "bootstrap materializes the current registry sidecar");
assert.ok(
  bootstrapEntries.some((entry) => entry.customType === "taumel.agents.presence"),
  "bootstrap appends the presence marker",
);

// agent-oqhi: marker without matching sidecar fails closed.
const failClosedEntries = [{
  type: "custom",
  customType: "taumel.agents.presence",
  data: { storage_schema_version: 1, owner_session_id: "fail-closed-owner" },
}];
const failClosedCtx = {
  ...ctx,
  sessionManager: {
    sessionId: "fail-closed-owner",
    getSessionId() { return this.sessionId; },
    getSessionFile: () => join(agentHome, "fail-closed-owner.jsonl"),
    getEntries: () => failClosedEntries,
    appendCustomEntry: (customType, data) => {
      failClosedEntries.push({ type: "custom", customType, data });
    },
  },
};
assert.throws(
  () => core.call("prepareTool", [{ name: "agent_list", params: {}, ctx: failClosedCtx }]),
  /registry|presence|unavailable|Failing closed|malformed|agent registry/i,
  "agent-oqhi: marker without sidecar must fail closed",
);

// Round-5 regression: with a child projection loaded last, a parent agent tool
// whose host session snapshot fails must fail closed. Proceeding would load
// the owner registry while state.cwd still points at the child workspace and
// durably bind a parent identity to the wrong repository.
assert.throws(() => core.call("agentManagerSnapshot", [swapChildCtx]), /projection unavailable/);
const originalSnapshot = host.sessionSnapshot;
host.sessionSnapshot = () => { throw new Error("host unavailable"); };
const hostFailSpawn = core.call("prepareTool", [{
  name: "agent_spawn",
  params: { message: "host failure", description: "Spawn during host failure", tier: "low" },
  ctx,
}]);
host.sessionSnapshot = originalSnapshot;
assert.notEqual(hostFailSpawn.ok, true,
  "agent tools must fail closed when the host session snapshot is unavailable");
assert.equal(
  core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents.length,
  1,
  "a failed-closed spawn must not append or provision an identity",
);

rmSync(childDirectory, { recursive: true, force: true });
rmSync(agentHome, { recursive: true, force: true });

console.log("agent lifecycle smoke: all assertions passed");
