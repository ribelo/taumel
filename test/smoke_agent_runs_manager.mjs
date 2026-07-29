import assert from "node:assert/strict";
import { executeAgentRunsManager } from "../src/agent-runs-manager.ts";

function agent(overrides = {}) {
  return {
    agentId: "agent-abcd",
    kind: "generic",
    model: "provider/model",
    thinking: "high",
    workspace: "/repo",
    tier: "high",
    createdAt: 100,
    childSessionFile: "/private/agent-abcd/session.jsonl",
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    runId: "agent-abcd-run-1",
    agentId: "agent-abcd",
    status: "completed",
    startedAt: 100,
    endedAt: 130,
    description: "Inspect agent lifecycle",
    turnCount: 3,
    lastActivityAt: 129,
    activityState: "inactive",
    recommendation: "call_agent_wait",
    submissionId: "agent-abcd-run-1-submission-1",
    announcement: "pending",
    ...overrides,
  };
}

const singleSnapshot = { agents: [agent()], runs: [run()] };

// agent-wuyh: live identities first, then most recent terminal activity.
const sortedSnapshot = {
  agents: [
    agent({ agentId: "agent-term-old", kind: "finder", createdAt: 100 }),
    agent({ agentId: "agent-live", kind: "oracle", createdAt: 50 }),
    agent({ agentId: "agent-term-new", kind: "generic", createdAt: 200 }),
  ],
  runs: [
    run({
      runId: "agent-term-old-run-1",
      agentId: "agent-term-old",
      status: "completed",
      description: "Old terminal",
      lastActivityAt: 1000,
    }),
    run({
      runId: "agent-live-run-1",
      agentId: "agent-live",
      status: "running",
      description: "Live run",
      lastActivityAt: 900,
      activityState: "reasoning",
      recommendation: "wait",
      endedAt: undefined,
    }),
    run({
      runId: "agent-term-new-run-1",
      agentId: "agent-term-new",
      status: "failed",
      description: "New terminal",
      lastActivityAt: 2000,
      error: "boom",
    }),
  ],
};

function makeCore(snapshot, handleCommand) {
  const calls = [];
  return {
    calls,
    call(name, args) {
      calls.push([name, args]);
      if (name === "reconcileLiveAgentDispatches") return { ok: true };
      if (name === "agentManagerSnapshot") return snapshot;
      if (name === "handleCommand") return handleCommand(args);
      throw new Error(`unexpected core call: ${name}`);
    },
  };
}

function instructionResult(args) {
  return {
    ok: true,
    action: "command_result",
    message: "Refactor the compiler.",
    details: { agent_id: args[0].args.split(" ")[1], available: true },
  };
}

// Drives custom components in invocation order. Each drive receives the
// component; the default renders once and closes with q.
function makeUi({ drives = [], confirm } = {}) {
  const rendered = [];
  const notifications = [];
  const confirms = [];
  let customCalls = 0;
  const ui = {
    notify: (message, level) => notifications.push({ message, level }),
    select: async (title, labels) => {
      confirms.push({ title, labels });
      return confirm === undefined ? labels[0] : confirm(title, labels);
    },
    custom: async (factory) => {
      const drive = drives[customCalls] ?? ((component) => {
        rendered.push(...component.render(120));
        component.handleInput("q");
      });
      customCalls += 1;
      await new Promise((resolve) => {
        const component = factory(
          { requestRender: () => undefined },
          { fg: (color, text) => `[${color}]${text}` },
          {},
          resolve,
        );
        drive(component, rendered);
      });
    },
  };
  return { ui, rendered, notifications, confirms };
}

function rowLines(rendered) {
  return rendered.filter((line) => line.includes("agent-"));
}

// --- picker: inspect flow, row shape, silent close ---
{
  const core = makeCore(singleSnapshot, instructionResult);
  const { ui, rendered } = makeUi({
    drives: [
      // agent-u5gw/agent-64x4: the picker is an interactive modal.
      (component, out) => {
        const lines = component.render(120);
        out.push(...lines);
        const rows = rowLines(lines);
        assert.equal(rows.length, 1);
        assert.match(rows[0], /→ /);
        assert.match(rows[0], /agent-abcd · generic/);
        // agent-ui06/agent-ui07: description, turns, human-readable age, no raw seconds.
        assert.match(rows[0], /Inspect agent lifecycle · 3 turns/);
        assert.doesNotMatch(rows[0], /\d{4,}s\b/);
        // agent-ui09: no inactive label on a terminal row.
        assert.equal(rows[0].includes("inactive"), false);
        component.handleInput("i");
      },
      (component, out) => {
        out.push(...component.render(120));
        component.handleInput("q");
      },
    ],
  });
  const result = await executeAgentRunsManager({}, core, new Map(), "", { ui });
  // agent-qjn0/agent-bxg4: the command result stays silent.
  assert.equal(result.inspection, true);
  // agent-91jh/agent-byg8: labeled identity, run, and instruction sections.
  assert.ok(rendered.some((line) => line.includes("/private/agent-abcd/session.jsonl")));
  assert.ok(rendered.some((line) => line.includes("provider/model")));
  assert.ok(rendered.some((line) => /Thinking\s+high/.test(line)));
  assert.ok(rendered.some((line) => line.includes("call_agent_wait")));
  assert.ok(rendered.some((line) => line.includes("Inspect agent lifecycle")));
  assert.ok(rendered.some((line) => line.includes("Refactor the compiler.")));
  // agent-9jof/agent-lpbp: the instruction is recovered on demand through the gateway.
  assert.deepEqual(
    core.calls.find(([name]) => name === "handleCommand")?.[1],
    [{ name: "agent-runs", args: "instruction agent-abcd", ctx: { ui } }],
  );
}

// --- agent-oy3p: an unavailable instruction renders as a placeholder ---
{
  const core = makeCore(singleSnapshot, () => ({
    ok: true,
    action: "command_result",
    message: "",
    details: { agent_id: "agent-abcd", available: false },
  }));
  const { ui, rendered } = makeUi({
    drives: [(component) => component.handleInput("i")],
  });
  const result = await executeAgentRunsManager({}, core, new Map(), "", { ui });
  assert.equal(result.inspection, true);
  assert.ok(rendered.some((line) => line.includes("Instruction unavailable.")));
}

// --- picker: sort order and j/k cursor movement ---
{
  const core = makeCore(sortedSnapshot, instructionResult);
  const { ui } = makeUi({
    drives: [
      (component) => {
        const initial = rowLines(component.render(120));
        assert.equal(initial.length, 3);
        assert.match(initial[0], /agent-live/);
        assert.match(initial[0], /running · reasoning/);
        assert.match(initial[1], /agent-term-new/);
        assert.match(initial[2], /agent-term-old/);
        assert.match(initial[0], /→ /);
        component.handleInput("j");
        const moved = rowLines(component.render(120));
        assert.match(moved[1], /→ /);
        component.handleInput("k");
        const returned = rowLines(component.render(120));
        assert.match(returned[0], /→ /);
        component.handleInput("j");
        component.handleInput("i");
      },
      (component) => component.handleInput("q"),
    ],
  });
  await executeAgentRunsManager({}, core, new Map(), "", { ui });
  // j moved the cursor to agent-term-new before inspecting.
  assert.deepEqual(
    core.calls.find(([name]) => name === "handleCommand")?.[1],
    [{ name: "agent-runs", args: "instruction agent-term-new", ctx: { ui } }],
  );
}

// --- picker: latest-run output opens in a scroll modal ---
{
  const core = makeCore(singleSnapshot, (args) =>
    args[0].args.startsWith("output ")
      ? { ok: true, action: "command_result", message: "final answer text", details: {} }
      : instructionResult(args));
  const { ui, rendered } = makeUi({
    drives: [(component) => component.handleInput("o")],
  });
  await executeAgentRunsManager({}, core, new Map(), "", { ui });
  assert.deepEqual(
    core.calls.find(([name]) => name === "handleCommand")?.[1],
    [{ name: "agent-runs", args: "output agent-abcd-run-1", ctx: { ui } }],
  );
  assert.ok(rendered.some((line) => line.includes("final answer text")));
}

// --- agent-6d58: prune closes terminal identities after confirmation ---
{
  const closed = [];
  const core = {
    calls: [],
    call(name, args) {
      this.calls.push([name, args]);
      if (name === "reconcileLiveAgentDispatches") return { ok: true };
      if (name === "agentManagerSnapshot") return sortedSnapshot;
      if (name === "prepareTool") {
        const agentId = args[0].params.agent_id;
        closed.push(agentId);
        return {
          ok: true,
          action: "agent_close",
          text: JSON.stringify({ agent_id: agentId, status: "closed" }),
          details: { agentId, status: "closed" },
          agentId,
          runIds: [`${agentId}-run-1`],
          capabilityId: `manager-close-${agentId}`,
        };
      }
      if (
        name === "claimAgentAction" || name === "revalidateAgentAction" || name === "releaseAgentAction"
        || name === "authorizeAgentActionCleanup" || name === "cancelAgentBrokerSessions"
        || name === "finishAgentClose" || name === "releaseAgentClose"
      ) return { ok: true };
      if (name === "toolResultEnvelope") {
        return {
          content: [{ type: "text", text: args[0].prepared?.text ?? args[0].error }],
          details: args[0].prepared?.details ?? args[0].details,
        };
      }
      throw new Error(`unexpected prune core call: ${name}`);
    },
  };
  const { ui, notifications, confirms } = makeUi({
    drives: [(component) => component.handleInput("x")],
    confirm: () => "Confirm prune",
  });
  const result = await executeAgentRunsManager({}, core, new Map(), "", { ui });
  assert.equal(result.inspection, true);
  assert.deepEqual(confirms[0]?.title, "Close 2 terminal identities?");
  assert.deepEqual([...closed].sort(), ["agent-term-new", "agent-term-old"]);
  assert.deepEqual(
    notifications.find(({ message }) => message.startsWith("Pruned")),
    { message: "Pruned 2 identities.", level: "info" },
  );
}

// --- prune: nothing terminal never asks for confirmation ---
{
  const liveOnly = {
    agents: [agent({ agentId: "agent-live" })],
    runs: [run({
      agentId: "agent-live",
      runId: "agent-live-run-1",
      status: "running",
      activityState: "reasoning",
      recommendation: "wait",
      endedAt: undefined,
    })],
  };
  const core = makeCore(liveOnly, instructionResult);
  const { ui, notifications, confirms } = makeUi({
    drives: [(component) => component.handleInput("x")],
    confirm: () => "Confirm prune",
  });
  await executeAgentRunsManager({}, core, new Map(), "", { ui });
  assert.equal(confirms.length, 0);
  assert.deepEqual(notifications[0], { message: "No terminal identities to prune.", level: "info" });
}

// --- close flow through command args (unchanged path) ---
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
    if (name === "agentManagerSnapshot") return singleSnapshot;
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
// finishAgentClose takes AgentIdFacts + AgentOwnerContextFacts ({ ctx }).
assert.deepEqual(finishCall?.[1], [{ agent_id: "agent-abcd" }, { ctx: closeCtx }]);
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
    if (name === "agentManagerSnapshot") return singleSnapshot;
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
  "current agent-abcd",
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
