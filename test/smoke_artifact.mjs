import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const artifact = new URL("../dist/taumel.cjs", import.meta.url);
const require = createRequire(import.meta.url);
require(fileURLToPath(artifact));

const bootstrap = globalThis.taumel;

if (!bootstrap || typeof bootstrap !== "object" || typeof bootstrap.init !== "function") {
  throw new Error("taumel core was not exported by the jsoo artifact");
}

const exportedKeys = Object.keys(bootstrap).sort();
if (JSON.stringify(exportedKeys) !== JSON.stringify(["init"])) {
  throw new Error(`unexpected Taumel artifact exports: ${JSON.stringify(exportedKeys)}`);
}

const handlers = new Map();
let footerFactory;
const footerInstallSessionIds = [];
const footerFactories = new Map();
let renderRequests = 0;
let firstCostReads = 0;
let tailCostReads = 0;
let appendedCostReads = 0;
const renderedPermissionTokens = [];

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

const core = bootstrap.init({
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
  themeFg: (_theme, color, value) => {
    if (value === "•") renderedPermissionTokens.push(color);
    return value;
  },
});
if (!core || typeof core.call !== "function" || Object.keys(core).join(",") !== "call") {
  throw new Error("Taumel initialization did not return the private core bridge");
}
// shared-0gc2: malformed reverse-boundary values reject before application logic.
for (const [name, params, expectedError] of [
  [
    "exec_command",
    { cmd: "echo safe", with_escalated_permissions: "false" },
    /ExecCommandParams.*with_escalated_permissions.*boolean/,
  ],
  ["write", { path: "artifact.txt", content: "safe", mode: "truncate" }, /WriteParams.*mode/],
  ["agent_send", { agent_id: "agent-test", interrupt: "false" }, /AgentSendParams.*interrupt.*boolean/],
  ["query_threads", { query: "safe", includeTools: "false" }, /QueryThreadsParams.*includeTools.*boolean/],
  ["web_search_exa", { query: 42 }, /WebSearchExaParams.*query.*string/],
  ["get_goal", { unexpected: true }, /EmptyParams.*unexpected.*not allowed/],
]) {
  let rejection = "";
  try {
    core.call("prepareTool", [{ name, params, ctx }]);
  } catch (error) {
    rejection = error instanceof Error ? error.message : String(error);
  }
  if (!expectedError.test(rejection)) {
    throw new Error(
      `malformed TS-to-OCaml ${name} input was not runtime-decoded: ${JSON.stringify({ rejection })}`,
    );
  }
}
let malformedLegacyField = "";
try {
  core.call("cancelAgentBrokerSessions", [{ agent_id: false }]);
} catch (error) {
  malformedLegacyField = error instanceof Error ? error.message : String(error);
}
if (!/agent_id.*expected string/.test(malformedLegacyField)) {
  throw new Error(
    `legacy TS-to-OCaml field access silently defaulted: ${JSON.stringify({ malformedLegacyField })}`,
  );
}
let decodedCommandReads = 0;
const decodedCommandParams = {};
Object.defineProperty(decodedCommandParams, "cmd", {
  enumerable: true,
  get() {
    decodedCommandReads += 1;
    return decodedCommandReads === 1 ? "echo snapshotted" : 42;
  },
});
const decodedCommand = core.call("prepareTool", [{
  name: "exec_command",
  params: decodedCommandParams,
  ctx,
}]);
if (decodedCommandReads !== 1 || decodedCommand?.cmd !== "echo snapshotted") {
  throw new Error(
    `TS-to-OCaml decoding did not snapshot known input fields: ${JSON.stringify({ decodedCommandReads, decodedCommand })}`,
  );
}
const malformedDecisionPolicy = core.call("refreshExecPolicy", [{
  scopes: [{
    scope: "global",
    execPolicy: {
      rules: [
        { pattern: ["rm"], decision: "forbiden" },
        { pattern: ["curl"] },
        { pattern: ["wget"], decision: 1 },
        { pattern: ["echo"], decision: "prompt" },
      ],
    },
  }],
}]);
if (
  malformedDecisionPolicy?.activeRuleCount !== 1 ||
  !Array.isArray(malformedDecisionPolicy.errors) ||
  malformedDecisionPolicy.errors.length !== 3
) {
  throw new Error(
    `invalid exec-policy decisions were not rejected per rule: ${JSON.stringify(malformedDecisionPolicy)}`,
  );
}
const malformedDecisionCheck = core.call("handleCommand", [{
  name: "execpolicy",
  args: "check rm -rf target",
  ctx,
}]);
if (
  malformedDecisionCheck?.details?.decision !== "prompt" ||
  malformedDecisionCheck?.details?.defaultedToPrompt !== true
) {
  throw new Error(
    `invalid exec-policy decision widened command authority: ${JSON.stringify(malformedDecisionCheck)}`,
  );
}
core.call("refreshExecPolicy", [{ scopes: [] }]);
const policyNames = core.call("toolPolicyNames", []);
const allowedNames = core.call("allowedToolNames", []);
const commandSpecs = core.call("commandSpecs", []);
if (!Array.isArray(policyNames?.names) || !Array.isArray(allowedNames?.names) || !Array.isArray(commandSpecs?.specs)) {
  throw new Error("Taumel artifact specs did not return typed result objects");
}

const preparedWrite = core.call("prepareTool", [{
  name: "write",
  params: { path: "README.md", content: "artifact authorization smoke" },
  ctx,
}]);
if (preparedWrite?.ok !== true || preparedWrite.path !== realpathSync("README.md")) {
  throw new Error(`jsoo mutation preparation did not use the host authorization path: ${JSON.stringify(preparedWrite)}`);
}

for (const [name, params, expectedAction] of [
  ["web_search_exa", { query: "artifact contract smoke" }, "exa_fetch"],
  ["crawling_exa", { urls: ["https://example.com"] }, "exa_fetch"],
  ["get_code_context_exa", { query: "artifact contract smoke" }, "exa_fetch"],
  ["exa_agent_create_run", { query: "artifact contract smoke" }, "exa_agent_create_run_approval"],
  ["exa_agent_get_run", { id: "artifact-run" }, "exa_fetch"],
  ["exa_agent_list_runs", {}, "exa_fetch"],
  ["exa_agent_cancel_run", { id: "artifact-run" }, "exa_fetch"],
  ["exa_agent_list_events", { id: "artifact-run" }, "exa_fetch"],
]) {
  const preparedExa = core.call("prepareTool", [{ name, params, ctx }]);
  if (
    preparedExa?.ok !== true ||
    preparedExa.action !== expectedAction ||
    preparedExa.toolName !== name ||
    Object.hasOwn(preparedExa, "apiKeyPresent")
  ) {
    throw new Error(`jsoo ${name} preparation violated its bridge contract: ${JSON.stringify(preparedExa)}`);
  }
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
core.call("updateFooterThinking", ["high", ctx]);
const thinkingLines = component.render(120);
if (!thinkingLines[0].includes("gpt-test • high")) {
  throw new Error(`footer did not render the directly updated thinking level: ${JSON.stringify(thinkingLines)}`);
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
    }, {
      type: "custom",
      customType: "taumel.permissions",
      data: {
        version: 1,
        profile: {
          modelId: "inherit",
          thinkingLevel: "low",
          sandboxPreset: "read-only",
          approvalPolicy: "untrusted",
          tools: { kind: "all" },
          noSandboxAllowed: false,
        },
        networkMode: "disabled",
        noSandbox: false,
        isolated_child: true,
      },
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
core.call("updateFooterThinking", ["low", childCtx]);
const childThinkingLines = component.render(120);
if (!childThinkingLines[0].includes("gpt-test • high")) {
  throw new Error(`isolated_child updateFooterThinking moved the parent footer thinking: ${JSON.stringify(childThinkingLines)}`);
}
if (footerInstallSessionIds.includes("artifact-child-session")) {
  throw new Error(`isolated_child session_start reinstalled the parent footer: ${JSON.stringify(footerInstallSessionIds)}`);
}

renderedPermissionTokens.length = 0;
component.render(120);
const parentPermissionTokens = renderedPermissionTokens.slice(0, 3);
core.call("prepareTool", [{ name: "get_goal", params: {}, ctx: childCtx }]);
renderedPermissionTokens.length = 0;
component.render(120);
const permissionTokensAfterChildTool = renderedPermissionTokens.slice(0, 3);
if (JSON.stringify(permissionTokensAfterChildTool) !== JSON.stringify(parentPermissionTokens)) {
  throw new Error(
    `isolated_child tool sync overwrote parent footer permissions: ${JSON.stringify({ parentPermissionTokens, permissionTokensAfterChildTool })}`,
  );
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
