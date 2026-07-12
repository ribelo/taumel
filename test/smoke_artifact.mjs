import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const artifact = new URL("../dist/taumel.cjs", import.meta.url);
const require = createRequire(import.meta.url);
require(fileURLToPath(artifact));

const core = globalThis.taumel;

if (!core || typeof core !== "object" || typeof core.init !== "function" || typeof core.call !== "function") {
  throw new Error("taumel core was not exported by the jsoo artifact");
}

const exportedKeys = Object.keys(core).sort();
if (JSON.stringify(exportedKeys) !== JSON.stringify(["call", "init"])) {
  throw new Error(`unexpected Taumel artifact exports: ${JSON.stringify(exportedKeys)}`);
}

const policyNames = core.call("toolPolicyNames", []);
const allowedNames = core.call("allowedToolNames", []);
const commandSpecs = core.call("commandSpecs", []);
if (
  !Array.isArray(policyNames?.names) ||
  !Array.isArray(allowedNames?.names) ||
  !Array.isArray(commandSpecs?.specs)
) {
  throw new Error("Taumel artifact specs did not return typed result objects");
}

const handlers = new Map();
let footerFactory;
const footerInstallSessionIds = [];
const footerFactories = new Map();
let renderRequests = 0;
let firstCostReads = 0;
let tailCostReads = 0;
let appendedCostReads = 0;

const pushHandler = (event, handler) => {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
};

const assistantCostMessage = (value, counter) => {
  const cost = {};
  Object.defineProperty(cost, "total", {
    configurable: true,
    get() {
      counter();
      return value;
    },
  });
  return {
    type: "message",
    message: { role: "assistant", content: `cost ${value}`, usage: { cost } },
  };
};

const branch = [
  { type: "message", message: { role: "user", content: "artifact smoke" } },
  assistantCostMessage(0.1, () => {
    firstCostReads += 1;
  }),
  assistantCostMessage(0.025, () => {
    tailCostReads += 1;
  }),
];

const ctx = {
  ui: {},
  model: { provider: "openai-codex", id: "gpt-test" },
  sessionManager: {
    getSessionId: () => "artifact-session",
    getEntries: () => [],
    getBranch: () => branch,
  },
};

core.init({
  resolveAuthorizationPath: realpathSync,
  on: pushHandler,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: (_ctx, factory) => {
    footerFactory = factory;
    const sessionId = _ctx.sessionManager.getSessionId();
    footerInstallSessionIds.push(sessionId);
    footerFactories.set(sessionId, factory);
  },
  sessionSnapshot: (snapshotCtx) => {
    const model = snapshotCtx?.model ?? {};
    return {
      cwd: "/home/ribelo/projects/ribelo/taumel",
      provider: model.provider ?? "openai-codex",
      model: model.id ?? "gpt-test",
      thinking: "medium",
      totalCost: 0.125,
      contextPercent: 12,
      contextWindow: 200000,
    };
  },
  getGitBranch: () => "main",
  onBranchChange: (_footerData, handler) => {
    handler();
    return () => undefined;
  },
  requestRender: () => {
    renderRequests += 1;
  },
  themeFg: (_theme, _color, value) => value,
});

const preparedWrite = core.call("prepareTool", [{
  name: "write",
  params: { path: "README.md", content: "artifact authorization smoke" },
  ctx,
}]);
if (preparedWrite?.ok !== true || preparedWrite.path !== realpathSync("README.md")) {
  throw new Error(`jsoo mutation preparation did not use the host authorization path: ${JSON.stringify(preparedWrite)}`);
}

for (const handler of handlers.get("session_start") ?? []) {
  handler({ type: "session_start" }, ctx);
}

if (typeof footerFactory !== "function") {
  throw new Error("footer factory was not installed");
}

const component = footerFactory({}, {}, {});
const lines = component.render(120);
if (!Array.isArray(lines) || typeof lines[0] !== "string") {
  throw new Error(`footer render did not return lines: ${JSON.stringify(lines)}`);
}
if (!lines[0].includes("$0.125")) {
  throw new Error(`footer did not use branch-local cost: ${JSON.stringify(lines)}`);
}
if (!lines[0].includes("gpt-test")) {
  throw new Error(`footer did not render parent model: ${JSON.stringify(lines)}`);
}
if (firstCostReads === 0 || tailCostReads === 0) {
  throw new Error(`artifact smoke did not exercise branch cost reads: ${JSON.stringify({ firstCostReads, tailCostReads })}`);
}

const childCtx = {
  ...ctx,
  model: {
    provider: "amazon-bedrock",
    id: "arn:aws:bedrock:us-east-1:284227543028:application-inference-profile/4stpxjpc6efk",
  },
  sessionManager: {
    getSessionId: () => "artifact-child-session",
    getEntries: () => [{
      type: "custom",
      customType: "taumel.childSession",
      data: { kind: "agent", isolated_child: true },
    }],
    getBranch: () => [],
  },
};
for (const handler of handlers.get("session_start") ?? []) {
  handler({ type: "session_start" }, childCtx);
}
for (const handler of handlers.get("model_select") ?? []) {
  handler({ type: "model_select" }, childCtx);
}
const childLines = component.render(120);
if (!childLines[0].includes("gpt-test") || childLines[0].includes("amazon-bedrock")) {
  throw new Error(`isolated_child context overwrote parent footer model: ${JSON.stringify(childLines)}`);
}
if (footerInstallSessionIds.includes("artifact-child-session")) {
  throw new Error(`isolated_child session_start reinstalled the parent footer: ${JSON.stringify(footerInstallSessionIds)}`);
}

const firstReadsAfterStart = firstCostReads;
for (const handler of handlers.get("session_switch") ?? []) {
  handler({ type: "session_switch" }, ctx);
}
if (firstCostReads !== firstReadsAfterStart) {
  throw new Error(`same-length session sync rescanned old branch costs: ${firstCostReads}`);
}
const switchedCtx = {
  ...ctx,
  sessionManager: {
    getSessionId: () => "switched-session",
    getEntries: () => [],
    getBranch: () => [],
  },
};
for (const handler of handlers.get("session_switch") ?? []) {
  handler({ type: "session_switch" }, switchedCtx);
}
if (!footerFactories.has("switched-session")) {
  throw new Error(`session_switch did not rebind footer: ${JSON.stringify(footerInstallSessionIds)}`);
}
for (const handler of handlers.get("session_resume") ?? []) {
  handler({ type: "session_resume" }, ctx);
}
if (footerInstallSessionIds.filter((id) => id === "artifact-session").length < 2) {
  throw new Error(`session_resume did not rebind footer: ${JSON.stringify(footerInstallSessionIds)}`);
}

branch.push(
  assistantCostMessage(0.25, () => {
    appendedCostReads += 1;
  }),
);
for (const handler of handlers.get("model_select") ?? []) {
  handler({ type: "model_select" }, ctx);
}
const updatedLines = component.render(120);
if (!updatedLines[0].includes("$0.375") || appendedCostReads === 0) {
  throw new Error(`incremental branch cost did not update after append: ${JSON.stringify(updatedLines)}`);
}
component.dispose();

if (renderRequests < 1) {
  throw new Error("footer did not request render");
}

process.exit(0);
