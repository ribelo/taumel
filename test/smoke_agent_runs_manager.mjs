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

console.log("agent runs manager smoke: all assertions passed");
