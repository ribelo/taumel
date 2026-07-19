import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAgentPrepared } from "../src/agent-orchestration.ts";
import { executeTool, registerGatewayTools } from "../src/tool-executor.ts";
import { toolNames } from "../src/tool-contracts.ts";

const registered = [];
const registeredTools = new Map();
const renderers = [];
const rendererOptions = new Map();
const handlers = new Map();
const injectedMessages = [];
const pi = {
  registerTool: (tool) => { registered.push(tool.name); registeredTools.set(tool.name, tool); },
  registerMessageRenderer: (name, _renderer, options) => {
    renderers.push(name);
    rendererOptions.set(name, options);
  },
  on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  sendMessage: (message) => injectedMessages.push(message),
  sendUserMessage: (message) => injectedMessages.push(message),
};
const core = {
  call(method) {
    if (method === "toolPolicyNames") return { names: [...toolNames] };
    if (method === "allowedToolNames") return { names: ["read"] };
    throw new Error(`unexpected core call: ${method}`);
  },
};

// gateway-nkm1: child gateways reuse the owning initialized core.
registerGatewayTools(pi, core, new Map());

if (JSON.stringify(registered) !== JSON.stringify(["read"])) {
  throw new Error(`gateway registration ignored OCaml exposure policy: ${JSON.stringify(registered)}`);
}
if (!renderers.includes("notification")) {
  throw new Error("notification renderer was not registered");
}
// render-nt03: the notification renderer renders flush, without a Pi background box.
if (rendererOptions.get("notification") !== undefined) {
  throw new Error("notification renderer must not request a background box");
}
// render-sh01: every Taumel-rendered tool registers its own shell.
for (const [name, tool] of registeredTools) {
  if (tool.renderShell !== "self") throw new Error(`${name} did not register renderShell \"self\"`);
}
if (!renderers.includes("taumel.goal.continue")) {
  throw new Error("goal continuation renderer was not registered");
}
for (const event of ["session_start", "session_resume", "session_switch", "session_shutdown", "turn_end", "agent_end"]) {
  if ((handlers.get(event) ?? []).length === 0) throw new Error(`missing gateway lifecycle handler: ${event}`);
}

const parentEntries = [];
const parentCtx = {
  hasUI: true,
  ui: {
    confirm: async (title, message) => {
      parentConfirmations.push({ title, message });
      return false;
    },
  },
  sessionManager: { getSessionId: () => "parent-a", getEntries: () => parentEntries },
};
const parentConfirmations = [];
let childConfirmations = 0;
const childCtx = {
  hasUI: false,
  sessionManager: {
    getSessionId: () => "child-a",
    getEntries: () => [{
      type: "custom",
      customType: "taumel.childSession",
      data: {
        kind: "agent", agentKind: "generic", agentId: "agent-test",
        modelId: "test/model", thinkingLevel: "medium", activeTools: ["write"],
        capabilityProfile: {
          modelId: "inherit", thinkingLevel: "medium", sandboxPreset: "workspace-write",
          approvalPolicy: "on-request", tools: { kind: "all" }, noSandboxAllowed: false,
        }, networkMode: "disabled", isolated_child: true,
        workspaceDirectory: "/tmp", sourceWorkspace: "/tmp", isolation: "none",
        workspaceBinding: { variant: "shared", source_root: "/tmp" },
        parentSessionId: "parent-a", parentSessionFile: "",
      },
    }],
  },
  ui: { confirm: async () => { childConfirmations += 1; return false; } },
};
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);

let promptPlans = 0;
const ownershipCore = {
  finishOutcomes: [],
  call(method, args) {
    if (method === "claimAgentAction" || method === "revalidateAgentAction" || method === "releaseAgentAction" || method === "authorizeAgentActionCleanup") {
      return { ok: true };
    }
    if (method === "claimAgentAction" || method === "revalidateAgentAction" || method === "releaseAgentAction" || method === "authorizeAgentActionCleanup") {
      return { ok: true };
    }
    if (method === "prepareTool") return {
      ok: true,
      action: "exec_command_approval",
      planId: "plan-ownership",
      cmd: "echo test",
      workdir: "/tmp",
      tty: false,
      sandbox: { filesystemMode: "workspace-write", networkMode: "disabled", workspaceRoots: ["/tmp"], noSandbox: false, isolatedChild: true, approvalPolicy: "on-request" },
      approvalMessage: "approval required",
      approvalTitle: "Approve",
      approvalPrompt: "Run command?",
      approvalTimeoutMs: 0,
    };
    if (method === "planExecApprovalPrompt") {
      promptPlans += 1;
      return { kind: "confirm", title: args[0].approvalTitle, prompt: args[0].approvalPrompt };
    }
    if (method === "finishExecApproval") {
      this.finishOutcomes.push(args[0].outcome);
      return {
        kind: "denied",
        result: {
          content: [{ type: "text", text: `approval ${args[0].outcome}` }],
          details: {
            approvalOutcome: args[0].outcome,
            ...(args[0].outcome === "unavailable" ? { reason: "approval_unavailable" } : {}),
          },
        },
      };
    }
    if (method === "discardAuthorityPlan") return { ok: true };
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].error ?? "result" }],
      details: args[0].details ?? {},
    };
    if (method === "goalClockPauseStart" || method === "goalClockPauseEnd") return null;
    throw new Error(`unexpected ownership core call: ${method}`);
  },
};
// agentperm-04k9/agentperm-flmg/agentperm-ryj1: a loaded owner's real harness UI
// receives the attributed child request; the child's no-op UI is never consulted.
const parentEntryCount = parentCtx.sessionManager.getEntries().length;
const deniedChildResult = await executeTool(pi, ownershipCore, new Map(), "exec_command", { cmd: "echo test" }, childCtx);
if (parentConfirmations.length !== 1 || !parentConfirmations[0].title.includes("agent-test")) {
  throw new Error(`child approval did not reach attributed harness UI: ${JSON.stringify(parentConfirmations)}`);
}
// agentperm-9des: the harness prompt carries concrete effect and boundary evidence.
assert.match(parentConfirmations[0].message, /Command: echo test/);
assert.match(parentConfirmations[0].message, /Working directory: \/tmp/);
assert.match(parentConfirmations[0].message, /Sandbox boundary: workspace-write/);
// agentperm-in5w: presentation does not inject protocol messages into the parent conversation.
assert.equal(parentCtx.sessionManager.getEntries().length, parentEntryCount);
assert.deepEqual(injectedMessages, []);
assert.equal(deniedChildResult.details.approvalOutcome, "denied_by_user");
if (childConfirmations !== 0) {
  throw new Error("child approval consulted the child session UI");
}
const malformedChildCtx = {
  ...childCtx,
  sessionManager: {
    ...childCtx.sessionManager,
    getEntries: () => [{
      type: "custom", customType: "taumel.childSession", data: { kind: "agent" },
    }],
  },
};
const confirmationsBeforeMalformedChild = parentConfirmations.length;
await executeTool(
  pi,
  ownershipCore,
  new Map(),
  "exec_command",
  { cmd: "echo malformed-child" },
  malformedChildCtx,
);
assert.equal(
  parentConfirmations.length,
  confirmationsBeforeMalformedChild,
  "shared-o11w malformed child marker borrowed parent approval UI",
);
let invalidChildPrepareCalls = 0;
const invalidChildCore = {
  call(method, args) {
    if (method === "prepareTool") {
      invalidChildPrepareCalls += 1;
      throw new Error("invalid child authority reached preparation");
    }
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].error }], details: args[0].details,
    };
    throw new Error(`unexpected invalid-child core call: ${method}`);
  },
};
const unavailableChildContexts = [
  malformedChildCtx,
  { ...childCtx, sessionManager: { getSessionId: () => "missing-scanner" } },
  {
    ...childCtx,
    sessionManager: { getSessionId: () => "invalid-scanner", getEntries: () => ({}) },
  },
];
for (const invalidCtx of unavailableChildContexts) {
  for (const [toolName, params] of [
    ["exec_command", { cmd: "echo forbidden" }],
    ["write", { path: "/tmp/forbidden", content: "x" }],
  ]) {
    const result = await executeTool(
      pi, invalidChildCore, new Map(), toolName, params, invalidCtx,
    );
    assert.equal(result.details.error, "invalid child session authority metadata");
  }
}
assert.equal(invalidChildPrepareCalls, 0, "invalid child authority reached preparation");

// agentperm-hh1j/agentperm-e0k9/agentperm-t4mv: one active dialog, then
// top-level priority and FIFO within the agent class.
const shown = [];
const dialogResolvers = [];
parentCtx.ui.confirm = async (title, _message, options) => {
  shown.push(title);
  return await new Promise((resolve) => {
    const settle = (value) => resolve(value);
    options?.signal?.addEventListener("abort", () => settle(false), { once: true });
    dialogResolvers.push(settle);
  });
};
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
const queueCore = {
  finishOutcomes: [],
  call(method, args) {
    if (method === "prepareTool") return {
      ok: true,
      action: "exec_command_approval",
      planId: `plan-${args[0].params.cmd}`,
      cmd: args[0].params.cmd,
      workdir: "/tmp",
      tty: false,
      sandbox: { filesystemMode: "workspace-write", networkMode: "disabled", workspaceRoots: ["/tmp"], noSandbox: false, isolatedChild: false, approvalPolicy: "on-request" },
      approvalMessage: "approval required",
      approvalTitle: `Approve ${args[0].params.cmd}`,
      approvalPrompt: `Run ${args[0].params.cmd}?`,
      approvalTimeoutMs: args[0].params.cmd === "timed" ? 20 : 0,
    };
    if (method === "planExecApprovalPrompt") return {
      kind: "confirm", title: args[0].approvalTitle, prompt: args[0].approvalPrompt,
      ...(args[0].approvalTimeoutMs > 0 ? { timeoutMs: args[0].approvalTimeoutMs } : {}),
    };
    if (method === "finishExecApproval") {
      this.finishOutcomes.push(args[0].outcome);
      return { kind: "denied", result: { content: [{ type: "text", text: "denied" }], details: {} } };
    }
    if (method === "discardAuthorityPlan") return { ok: true };
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].error ?? "result" }], details: args[0].details ?? {},
    };
    if (method === "goalClockPauseStart" || method === "goalClockPauseEnd") return null;
    throw new Error(`unexpected queue core call: ${method}`);
  },
};
const childCtxB = {
  ...childCtx,
  sessionManager: {
    ...childCtx.sessionManager,
    getSessionId: () => "child-b",
    getEntries: () => [{
      type: "custom", customType: "taumel.childSession",
      data: { ...childCtx.sessionManager.getEntries()[0].data, agentId: "agent-b" },
    }],
  },
};
const firstChild = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "child-a" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
const secondChild = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "child-b" }, childCtxB);
const topLevel = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "main" }, parentCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(shown, ["Agent agent-test: Approve child-a"]);
dialogResolvers.shift()(false);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(shown, ["Agent agent-test: Approve child-a", "Approve main"]);
dialogResolvers.shift()(false);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(shown, ["Agent agent-test: Approve child-a", "Approve main", "Agent agent-b: Approve child-b"]);
dialogResolvers.shift()(false);
await Promise.all([firstChild, secondChild, topLevel]);

// agentperm-mdzk: a queued request whose current policy no longer permits the
// prepared approval is discarded before presentation.
shown.length = 0;
let policyStillRequiresApproval = true;
const revalidationCore = {
  finishOutcomes: [],
  call(method, args) {
    if (method === "prepareTool" && !policyStillRequiresApproval) {
      return { ok: false, error: "approval no longer permitted" };
    }
    if (method === "finishExecApproval") {
      this.finishOutcomes.push(args[0].outcome);
      return { kind: "denied", result: { content: [{ type: "text", text: "denied" }], details: {} } };
    }
    return queueCore.call(method, args);
  },
};
const policyBlocker = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "policy-blocker" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
const stalePolicyRequest = executeTool(pi, revalidationCore, new Map(), "exec_command", { cmd: "stale-policy" }, childCtxB);
policyStillRequiresApproval = false;
parentCtx.ui.confirm = async (title) => { shown.push(title); return false; };
dialogResolvers.shift()(false);
const [, stalePolicyResult] = await Promise.all([policyBlocker, stalePolicyRequest]);
assert.deepEqual(shown, ["Agent agent-test: Approve policy-blocker"]);
assert.match(stalePolicyResult.content[0].text, /approval no longer permitted/);

// agentperm-mdzk: policy is revalidated again after approval and before effect execution.
shown.length = 0;
policyStillRequiresApproval = true;
parentCtx.ui.confirm = async (title) => {
  shown.push(title);
  policyStillRequiresApproval = false;
  return true;
};
const postApprovalResult = await executeTool(pi, revalidationCore, new Map(), "exec_command", { cmd: "post-approval-policy" }, childCtxB);
assert.deepEqual(shown, ["Agent agent-b: Approve post-approval-policy"]);
assert.match(postApprovalResult.content[0].text, /approval no longer permitted/);

// agentperm-cmuh: time spent invisibly queued does not consume the presentation timeout.
shown.length = 0;
parentCtx.ui.confirm = async (title, _message, options) => {
  shown.push(title);
  return await new Promise((resolve) => {
    const settle = (value) => resolve(value);
    options?.signal?.addEventListener("abort", () => settle(false), { once: true });
    dialogResolvers.push(settle);
  });
};
const blocker = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "blocker" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
const timed = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "timed" }, childCtxB);
await new Promise((resolve) => setTimeout(resolve, 40));
assert.deepEqual(shown, ["Agent agent-test: Approve blocker"]);
dialogResolvers.shift()(false);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(shown, ["Agent agent-test: Approve blocker", "Agent agent-b: Approve timed"]);
await Promise.all([blocker, timed]);
assert.equal(queueCore.finishOutcomes.at(-1), "timed_out");

// agentperm-asaw/agentperm-h14k: queued and active requests follow tool interruption.
shown.length = 0;
const activeController = new AbortController();
const queuedController = new AbortController();
const activeRequest = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "active" }, childCtx, activeController.signal);
await new Promise((resolve) => setTimeout(resolve, 10));
const queuedRequest = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "queued" }, childCtxB, queuedController.signal);
queuedController.abort();
await queuedRequest;
assert.deepEqual(shown, ["Agent agent-test: Approve active"]);
assert.equal(queueCore.finishOutcomes.at(-1), "interrupted");
activeController.abort();
await activeRequest;
assert.equal(queueCore.finishOutcomes.at(-1), "interrupted");

// agentperm-1rbh: switching the loaded owner dismisses an active former-owner request.
shown.length = 0;
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
const switchedRequest = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "switch-owner" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
const queuedSwitchRequest = executeTool(pi, queueCore, new Map(), "exec_command", { cmd: "switch-queued" }, childCtxB);
assert.deepEqual(shown, ["Agent agent-test: Approve switch-owner"]);
const nextParentCtx = {
  ...parentCtx,
  sessionManager: { ...parentCtx.sessionManager, getSessionId: () => "parent-b" },
};
for (const handler of handlers.get("session_switch") ?? []) handler({}, nextParentCtx);
await Promise.all([switchedRequest, queuedSwitchRequest]);
assert.deepEqual(queueCore.finishOutcomes.slice(-2), ["unavailable", "unavailable"]);

// agentperm-hh1j: filesystem and explicitly gated network approvals use the
// same tool-independent coordinator as command approval.
const crossToolTitles = [];
const crossToolMessages = [];
parentCtx.ui.confirm = async (title, message) => {
  crossToolTitles.push(title);
  crossToolMessages.push(message);
  return false;
};
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
const crossToolCore = {
  call(method, args) {
    if (method === "prepareTool" && args[0].name === "write") return {
      ok: true, action: "write_approval", workspaceRoots: ["/tmp"], validateWorkspacePaths: false,
      path: "/tmp/probe", displayPath: "/tmp/probe", contents: args[0].params.content, mode: "overwrite",
      approvalAction: "write", approvalTitle: "Approve write", approvalPrompt: "Write file?", approvalTimeoutMs: 0,
    };
    if (method === "prepareTool" && args[0].name === "exa_agent_create_run") return {
      ok: true, action: "exa_agent_create_run_approval", planId: "plan-exa", toolName: "exa_agent_create_run",
      approvalTitle: "Approve Exa", approvalPrompt: "Create run?", approvalTimeoutMs: 0,
    };
    if (method === "planExecApprovalPrompt") return {
      kind: "confirm", title: args[0].approvalTitle, prompt: args[0].approvalPrompt,
    };
    if (method === "goalClockPauseStart" || method === "goalClockPauseEnd") return null;
    if (method === "discardAuthorityPlan") return { ok: true };
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].error ?? "ok" }], details: args[0].details ?? {},
    };
    throw new Error(`unexpected cross-tool core call: ${method}`);
  },
};
await executeTool(pi, crossToolCore, new Map(), "write", { path: "/tmp/probe", content: "x".repeat(5_000) }, childCtx);
await executeTool(pi, crossToolCore, new Map(), "exa_agent_create_run", { query: "probe" }, childCtx);
assert.deepEqual(crossToolTitles, ["Agent agent-test: Approve write", "Agent agent-test: Approve Exa"]);
assert.match(crossToolMessages[0], /Sandbox boundary: workspace roots: \/tmp/);
assert.match(crossToolMessages[0], /effect diff truncated/);

// agentperm-3fx1: Oracle's fixed read-only sandbox may use the same attributed
// command-escalation flow when the owner policy permits asking.
const oracleCtx = {
  ...childCtx,
  sessionManager: {
    ...childCtx.sessionManager,
    getEntries: () => [{
      type: "custom", customType: "taumel.childSession",
      data: {
        ...childCtx.sessionManager.getEntries()[0].data,
        agentKind: "oracle", agentId: "oracle-test",
      },
    }],
  },
};
const oracleTitles = [];
parentCtx.ui.confirm = async (title) => { oracleTitles.push(title); return false; };
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
const oracleCore = {
  ...ownershipCore,
  call(method, args) {
    if (method === "prepareTool") return {
      ...ownershipCore.call(method, args),
      sandbox: {
        filesystemMode: "read-only", networkMode: "enabled", workspaceRoots: ["/tmp"],
        noSandbox: false, isolatedChild: true, approvalPolicy: "on-request",
      },
    };
    return ownershipCore.call(method, args);
  },
};
await executeTool(pi, oracleCore, new Map(), "exec_command", { cmd: "echo test" }, oracleCtx);
assert.deepEqual(oracleTitles, ["Agent oracle-test: Approve"]);

// agentperm-l6hi: an agent's Allow always choice persists the same exact-token
// rule and reports approved to the existing execution planner.
const temporaryAgentDir = mkdtempSync(join(tmpdir(), "taumel-approval-rule-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = temporaryAgentDir;
const allowAlwaysCalls = [];
let allowRuleActive = false;
let resolveAllowAlways;
let allowAlwaysDialogCount = 0;
let allowAlwaysTitle = "";
let discardedAllowPlans = 0;
parentCtx.ui.select = async (title) => {
  allowAlwaysDialogCount += 1;
  allowAlwaysTitle = title;
  return await new Promise((resolve) => { resolveAllowAlways = resolve; });
};
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
const allowAlwaysCore = {
  call(method, args) {
    if (method === "prepareTool") {
      if (allowRuleActive) return { ok: true, action: "tool_result", text: "allowed by persisted rule", details: { allowed: true } };
      return {
        ok: true, action: "exec_command_approval", planId: "plan-persistent", cmd: "echo persistent", workdir: "/tmp", tty: false,
        sandbox: {
          filesystemMode: "read-only", networkMode: "disabled", workspaceRoots: ["/tmp"],
          noSandbox: false, isolatedChild: true, approvalPolicy: "on-request",
        },
        approvalMessage: "approval required", approvalTitle: "Approve persistent",
        approvalPrompt: "Run persistent command?", approvalTimeoutMs: 0,
        execPolicyAllowAlwaysTokens: ["echo", "persistent"],
      };
    }
    if (method === "planExecApprovalPrompt") return {
      kind: "confirm", title: args[0].approvalTitle, prompt: args[0].approvalPrompt,
    };
    if (method === "appendExecPolicyAllowRule") {
      allowAlwaysCalls.push(args[0].tokens);
      allowRuleActive = true;
      return { activeRuleCount: 1 };
    }
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].prepared?.text ?? "result" }],
      details: args[0].prepared?.details ?? {},
    };
    if (method === "finishExecApproval") {
      allowAlwaysCalls.push(args[0].outcome);
      return { kind: "denied", result: { content: [{ type: "text", text: "planned" }], details: {} } };
    }
    if (method === "discardAuthorityPlan") {
      discardedAllowPlans += 1;
      return { ok: true };
    }
    if (method === "goalClockPauseStart" || method === "goalClockPauseEnd") return null;
    throw new Error(`unexpected allow-always core call: ${method}`);
  },
};
const approvalSettingsPath = join(temporaryAgentDir, "settings.json");
// shared-r544: Allow always cannot erase malformed global settings.
const malformedApprovalSettings = "{ malformed approval settings";
writeFileSync(approvalSettingsPath, malformedApprovalSettings);
const malformedPersistent = executeTool(pi, allowAlwaysCore, new Map(), "exec_command", { cmd: "echo persistent" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
resolveAllowAlways("Allow always");
await assert.rejects(malformedPersistent, /invalid JSON|Unexpected token|JSON/i);
assert.equal(readFileSync(approvalSettingsPath, "utf8"), malformedApprovalSettings);
assert(discardedAllowPlans >= 1);
allowRuleActive = false;
writeFileSync(approvalSettingsPath, `${JSON.stringify({ preserved: true }, null, 2)}\n`);
const firstPersistent = executeTool(pi, allowAlwaysCore, new Map(), "exec_command", { cmd: "echo persistent" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
const queuedPersistent = executeTool(pi, allowAlwaysCore, new Map(), "exec_command", { cmd: "echo persistent" }, childCtxB);
resolveAllowAlways("Allow always");
const [, queuedPersistentResult] = await Promise.all([firstPersistent, queuedPersistent]);
assert.deepEqual(allowAlwaysCalls, [["echo", "persistent"], "approved"]);
assert.equal(allowAlwaysDialogCount, 2);
assert.match(allowAlwaysTitle, /Command: echo persistent/);
assert.match(allowAlwaysTitle, /Sandbox boundary: read-only/);
assert.equal(queuedPersistentResult.content[0].text, "allowed by persisted rule");
const persistedRule = JSON.parse(readFileSync(approvalSettingsPath, "utf8"));
assert.equal(persistedRule.preserved, true);
assert.deepEqual(persistedRule.taumel.execPolicy.rules[0].pattern, ["echo", "persistent"]);
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
rmSync(temporaryAgentDir, { recursive: true, force: true });
delete parentCtx.ui.select;

// agentperm-04k9/agentperm-hh1j: on-failure sandbox retry also routes through
// the harness coordinator rather than the child session UI.
const retryTitles = [];
parentCtx.ui.confirm = async (title) => { retryTitles.push(title); return false; };
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
childConfirmations = 0;
const truncation = {
  truncated: false, truncatedBy: "none", totalLines: 1, totalBytes: 17,
  outputLines: 1, outputBytes: 17, maxLines: 2000, maxBytes: 40000,
  lastLinePartial: false, firstLineExceedsLimit: false,
};
const retryCore = {
  call(method) {
    if (method === "prepareTool") return {
      ok: true, action: "exec_command", planId: "plan-retry", cmd: "touch probe", workdir: "/tmp", tty: false,
      sandbox: {
        filesystemMode: "read-only", networkMode: "disabled", workspaceRoots: ["/tmp"],
        noSandbox: false, isolatedChild: true, approvalPolicy: "on-failure",
      },
    };
    if (method === "runExecCommand") return {
      content: [{ type: "text", text: "permission denied" }],
      details: {
        ok: false, output: "permission denied", stdout: "", stderr: "permission denied",
        truncation, wallTimeMs: 1, outputMode: "delta", suppressedLines: 0,
        suppressedBytes: 0, exitCode: 1, code: 1, sandboxed: true, escalated: false,
      },
    };
    if (method === "sandboxHostPathPlan") return {
      tempRootCandidates: ["/tmp"], systemRoPathCandidates: ["/usr", "/bin"],
    };
    if (method === "sandboxMetadataDirNames") return { names: [".git"] };
    if (method === "discardAuthorityPlan") return { ok: true };
    if (method === "goalClockPauseStart" || method === "goalClockPauseEnd") return null;
    throw new Error(`unexpected retry core call: ${method}`);
  },
};
await assert.rejects(
  executeTool(pi, retryCore, new Map(), "exec_command", { cmd: "touch probe" }, childCtx),
  /rejected by user/,
);
assert.equal(childConfirmations, 0);
assert.equal(retryTitles.length, 1);
assert.match(retryTitles[0], /agent-test/);

// agentperm-h14k: closing an agent dismisses its active approval even if the
// child tool signal has not yet propagated cancellation.
const closeTitles = [];
parentCtx.ui.confirm = async (title, _message, options) => {
  closeTitles.push(title);
  return await new Promise((resolve) => options?.signal?.addEventListener("abort", () => resolve(false), { once: true }));
};
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
const closeCore = {
  finishOutcomes: [],
  call(method, args) {
    if (method === "claimAgentAction" || method === "revalidateAgentAction" || method === "releaseAgentAction" || method === "authorizeAgentActionCleanup") {
      return { ok: true };
    }
    if (method === "finishExecApproval") {
      this.finishOutcomes.push(args[0].outcome);
      return { kind: "denied", result: { content: [{ type: "text", text: "denied" }], details: {} } };
    }
    if (method === "finishAgentClose" || method === "releaseAgentClose") return { ok: true };
    if (method === "agentManagerSnapshot") return { agents: [], runs: [] };
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].prepared?.text ?? args[0].error ?? "closed" }],
      details: args[0].prepared?.details ?? args[0].details ?? {},
    };
    return queueCore.call(method, args);
  },
};
const approvalDuringClose = executeTool(pi, closeCore, new Map(), "exec_command", { cmd: "close-active" }, childCtx);
await new Promise((resolve) => setTimeout(resolve, 10));
await executeAgentPrepared(pi, closeCore, new Map(), new Map(), {
  action: "agent_close", agentId: "agent-test", runIds: [], capabilityId: "close-active-capability",
  text: '{"agent_id":"agent-test","status":"closed"}', details: { agentId: "agent-test", status: "closed" },
}, parentCtx);
await approvalDuringClose;
assert.deepEqual(closeTitles, ["Agent agent-test: Approve close-active"]);
assert.equal(closeCore.finishOutcomes.at(-1), "interrupted");

// agentperm-ry9p/agentperm-1ph9/agentperm-ryj1: an unloaded owner produces the
// unavailable outcome immediately, never a fabricated user denial or deferred dialog.
const plansBeforeUnavailable = promptPlans;
for (const handler of handlers.get("session_switch") ?? []) handler({}, childCtx);
const unloadedOwnerResult = await executeTool(pi, ownershipCore, new Map(), "exec_command", { cmd: "echo test" }, childCtx);
assert.equal(promptPlans, plansBeforeUnavailable);
assert.equal(unloadedOwnerResult.details.approvalOutcome, "unavailable");
assert.equal(unloadedOwnerResult.details.reason, "approval_unavailable");
assert.equal(ownershipCore.finishOutcomes.at(-1), "unavailable");

// agentperm-1ph9/agentperm-sznz: a loaded headless owner uses the same explicit
// unavailable taxonomy instead of consulting either model or a no-op UI.
const headlessParentCtx = { ...parentCtx, hasUI: false };
for (const handler of handlers.get("session_switch") ?? []) handler({}, headlessParentCtx);
const headlessOwnerResult = await executeTool(pi, ownershipCore, new Map(), "exec_command", { cmd: "echo test" }, childCtx);
assert.equal(headlessOwnerResult.details.approvalOutcome, "unavailable");
assert.equal(headlessOwnerResult.details.reason, "approval_unavailable");
assert.equal(ownershipCore.finishOutcomes.at(-1), "unavailable");

// sandbox-w54h: a validated ancestor must not be replaceable with an out-of-workspace symlink
// between path authorization and the actual mutation.
const raceRoot = mkdtempSync(join(tmpdir(), "taumel-mutation-race-"));
const raceWorkspace = join(raceRoot, "workspace");
const authorizedParent = join(raceWorkspace, "authorized");
const parkedParent = join(raceWorkspace, "parked");
const outsideParent = join(raceRoot, "outside");
const mutationPath = join(authorizedParent, "target.txt");
const outsidePath = join(outsideParent, "target.txt");
mkdirSync(authorizedParent, { recursive: true });
mkdirSync(outsideParent, { recursive: true });
writeFileSync(mutationPath, "inside");
writeFileSync(outsidePath, "outside");
let swappedValidatedParent = false;
const raceCore = {
  call(method, args) {
    if (method === "prepareTool") return {
      ok: true, action: "write", workspaceRoots: [raceWorkspace],
      validateWorkspacePaths: true, path: mutationPath, displayPath: mutationPath,
      contents: "attacker-controlled", mode: "overwrite",
    };
    if (method === "validateWorkspaceMutationPaths") {
      assert.equal(args[0].paths[0].resolvedPath, mutationPath);
      renameSync(authorizedParent, parkedParent);
      symlinkSync(outsideParent, authorizedParent, "dir");
      swappedValidatedParent = true;
      return { kind: "valid" };
    }
    if (method === "hostToolResult") return {
      content: [{ type: "text", text: "write completed" }], details: args[0].details,
    };
    throw new Error(`unexpected mutation-race core call: ${method}`);
  },
};
const raceCtx = {
  sessionManager: { getSessionId: () => "mutation-race", getEntries: () => [] },
};
try {
  await assert.rejects(
    executeTool(pi, raceCore, new Map(), "write", { path: mutationPath, content: "attacker-controlled" }, raceCtx),
    /changed after authorization/,
  );
  assert.equal(swappedValidatedParent, true);
  assert.equal(readFileSync(outsidePath, "utf8"), "outside");
} finally {
  rmSync(raceRoot, { recursive: true, force: true });
}

// Replacing a validated target at the same canonical pathname must also fail;
// canonical-string equality alone does not bind the authorized inode.
const inodeRaceRoot = mkdtempSync(join(tmpdir(), "taumel-mutation-inode-race-"));
const inodeRaceTarget = join(inodeRaceRoot, "target.txt");
const originalInodeTarget = join(inodeRaceRoot, "original.txt");
writeFileSync(inodeRaceTarget, "authorized inode");
const inodeRaceCore = {
  call(method, args) {
    if (method === "prepareTool") return {
      ok: true, action: "write", workspaceRoots: [inodeRaceRoot],
      validateWorkspacePaths: true, path: inodeRaceTarget, displayPath: inodeRaceTarget,
      contents: "mutation", mode: "overwrite",
    };
    if (method === "validateWorkspaceMutationPaths") {
      assert.equal(args[0].paths[0].resolvedPath, inodeRaceTarget);
      renameSync(inodeRaceTarget, originalInodeTarget);
      writeFileSync(inodeRaceTarget, "replacement inode");
      return { kind: "valid" };
    }
    if (method === "hostToolResult") return {
      content: [{ type: "text", text: "write completed" }], details: args[0].details,
    };
    throw new Error(`unexpected inode-race core call: ${method}`);
  },
};
try {
  await assert.rejects(
    executeTool(pi, inodeRaceCore, new Map(), "write", { path: inodeRaceTarget, content: "mutation" }, raceCtx),
    /changed after authorization/,
  );
  assert.equal(readFileSync(inodeRaceTarget, "utf8"), "replacement inode");
} finally {
  rmSync(inodeRaceRoot, { recursive: true, force: true });
}

// agent-kbo4: a prepared destructive agent action must be consumable only once.
let replayedCloseFinishes = 0;
const consumedAgentCapabilities = new Set();
const replayCloseCore = {
  call(method, args) {
    if (method === "claimAgentAction") {
      const capabilityId = args[0].capabilityId;
      if (consumedAgentCapabilities.has(capabilityId)) throw new Error("authority plan is invalid or already consumed");
      consumedAgentCapabilities.add(capabilityId);
      return { ok: true };
    }
    if (method === "revalidateAgentAction" || method === "releaseAgentAction" || method === "authorizeAgentActionCleanup") return { ok: true };
    if (method === "cancelAgentBrokerSessions" || method === "releaseAgentClose") return { ok: true };
    if (method === "agentManagerSnapshot") return { agents: [], runs: [] };
    if (method === "finishAgentClose") {
      replayedCloseFinishes += 1;
      return { ok: true };
    }
    if (method === "toolResultEnvelope") return {
      content: [{ type: "text", text: args[0].prepared?.text ?? args[0].error }],
      details: args[0].prepared?.details ?? args[0].details,
    };
    throw new Error(`unexpected replay-close core call: ${method}`);
  },
};
const replayCloseCtx = {
  sessionManager: { getSessionId: () => "replay-close", getEntries: () => [] },
};
const replayClosePrepared = {
  action: "agent_close", agentId: "agent-replay", runIds: [],
  capabilityId: "agent-capability-replay", text: "closed", details: { agentId: "agent-replay", status: "closed" },
};
await executeAgentPrepared(
  pi, replayCloseCore, new Map(), new Map(), replayClosePrepared, replayCloseCtx,
);
await executeAgentPrepared(
  pi, replayCloseCore, new Map(), new Map(), replayClosePrepared, replayCloseCtx,
);
assert.equal(replayedCloseFinishes, 1, "prepared agent_close was replayed");
