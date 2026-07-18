import assert from "node:assert/strict";
import { executeAgentRunsManager } from "../src/agent-runs-manager.ts";

const selections = [];
const ctx = {
  ui: {
    select: async (_title, labels) => {
      selections.push(labels);
      return selections.length === 1 ? labels[0] : "Inspect";
    },
  },
};
const snapshot = {
  agents: [{
    agentId: "agent-abcd", kind: "generic", model: "provider/model", thinking: "high",
    workspace: "/repo", tier: "high", createdAt: 100,
    childSessionFile: "/private/agent-abcd/session.jsonl",
  }],
  runs: [{
    runId: "agent-abcd-run-1", agentId: "agent-abcd", status: "completed",
    startedAt: 100, endedAt: 130, description: "Inspect agent lifecycle", turnCount: 3,
    lastActivityAt: 129, activityState: "inactive", recommendation: "call_agent_wait",
    submissionId: "agent-abcd-run-1-submission-1", announcement: "pending",
  }],
};
const core = {
  call(name) {
    if (name === "reconcileLiveAgentDispatches") return { ok: true };
    if (name === "agentManagerSnapshot") return snapshot;
    throw new Error(`unexpected core call: ${name}`);
  },
};

// agent-ui07/agent-ui08: rows are compact; Inspect contains exact private diagnostics.
const result = await executeAgentRunsManager({}, core, new Map(), "", ctx);
assert.match(selections[0][0], /agent-abcd · generic · completed · Inspect agent lifecycle · 3 turns/);
assert.equal(selections[0][0].includes("inactive"), false);
assert.match(result.message, /child_session_file=\/private\/agent-abcd\/session.jsonl/);
assert.match(result.message, /tier=high/);
assert.match(result.message, /model=provider\/model/);
assert.match(result.message, /recommendation=call_agent_wait/);
assert.match(result.message, /description=Inspect agent lifecycle/);

const closeCalls = [];
const closeCore = {
  call(name, args) {
    closeCalls.push([name, args]);
    if (name === "prepareTool") {
      return {
        ok: true,
        action: "agent_close",
        text: JSON.stringify({ agent_id: "agent-abcd", status: "closed" }),
        details: { agentId: "agent-abcd", status: "closed" },
        agentId: "agent-abcd",
        runIds: ["agent-abcd-run-1"],
        capabilityId: "manager-close-capability",
      };
    }
    if (name === "agentManagerSnapshot") return snapshot;
    if (name === "claimAgentAction" || name === "revalidateAgentAction" || name === "releaseAgentAction" || name === "authorizeAgentActionCleanup") return { ok: true };
    if (name === "cancelAgentBrokerSessions") return { ok: true };
    if (name === "finishAgentClose") return { ok: true };
    if (name === "releaseAgentClose") return { ok: true };
    if (name === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].prepared?.text ?? args[0].error }],
      details: args[0].prepared?.details ?? args[0].details,
    };
    throw new Error(`unexpected close core call: ${name}`);
  },
};
const closeCtx = {
  ui: { select: async () => "Confirm close" },
};
const closeResult = await executeAgentRunsManager(
  {},
  closeCore,
  new Map(),
  "close agent-abcd",
  closeCtx,
);
assert.equal(closeResult.ok, true);
const finishCall = closeCalls.find(([name]) => name === "finishAgentClose");
assert.deepEqual(finishCall?.[1], [{ agent_id: "agent-abcd" }, closeCtx]);
assert.equal(
  closeCalls.some(([name]) => name === "deleteAgentChildSession"),
  false,
  "manager close must not host-delete before durable finishAgentClose",
);
assert.equal(
  closeCalls.some(([, args]) => JSON.stringify(args).includes("/private/agent-abcd")),
  false,
  "the manager close path forwarded persisted child-session path authority",
);

const failedCloseCalls = [];
const failedCloseCore = {
  call(name, args) {
    failedCloseCalls.push(name);
    if (name === "prepareTool") {
      return {
        ok: true,
        action: "agent_close",
        text: "{}",
        details: { agentId: "agent-abcd", status: "closed" },
        agentId: "agent-abcd",
        runIds: ["agent-abcd-run-1"],
        capabilityId: "manager-failed-close-capability",
      };
    }
    if (name === "agentManagerSnapshot") return snapshot;
    if (name === "claimAgentAction" || name === "revalidateAgentAction" || name === "releaseAgentAction" || name === "authorizeAgentActionCleanup") return { ok: true };
    if (name === "cancelAgentBrokerSessions") return { ok: true };
    if (name === "finishAgentClose") throw new Error("cleanup_failed: marker mismatch");
    if (name === "recordAgentCloseCleanupFailure" || name === "releaseAgentClose") {
      return { ok: true };
    }
    if (name === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].prepared?.text ?? args[0].error }],
      details: args[0].prepared?.details ?? args[0].details,
    };
    throw new Error(`unexpected failed-close core call: ${name}`);
  },
};
const failedChildren = new Map([[
  "current\0agent-abcd",
  { close: async () => undefined },
]]);
const failedClose = await executeAgentRunsManager(
  {},
  failedCloseCore,
  failedChildren,
  "close agent-abcd",
  closeCtx,
);
assert.equal(failedClose.ok, false);
assert.equal(failedCloseCalls.includes("recordAgentCloseCleanupFailure"), true);

console.log("agent runs manager smoke: all assertions passed");
