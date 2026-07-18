import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const bootstrap = globalThis.taumel;
let core;
const root = mkdtempSync(join(tmpdir(), "taumel-authority-plans-"));
const forgedOutput = join(root, "forged");
const ownerId = "authority-owner";
const previousExaKey = process.env.EXA_API_KEY;

// sandbox-a69j: the global artifact exposes binding to one core, not dispatch.
assert.equal(typeof bootstrap.call, "undefined", "global bootstrap exposed the authority dispatcher");

let snapshotSandboxMode = "workspace-write";
let snapshotNetworkMode = "enabled";
let extensionActive = true;

core = bootstrap.init({
  isExtensionActive: () => extensionActive,
  resolveAuthorizationPath: (path) => path,
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({
    cwd: root,
    provider: "openai-codex",
    model: "gpt-test",
    sandboxMode: snapshotSandboxMode,
    networkMode: snapshotNetworkMode,
  }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
});
extensionActive = false;
assert.equal(bootstrap.init({
  isExtensionActive: () => true,
  resolveAuthorizationPath: (path) => path,
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({
    cwd: root,
    provider: "openai-codex",
    model: "gpt-test",
    sandboxMode: snapshotSandboxMode,
    networkMode: snapshotNetworkMode,
  }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
}), core, "rebinding initialized a second core dispatcher");

try {
  // exec-z6yp/exec-cnzd: prepared execution authority remains core-owned,
  // owner-bound, and one-shot even when callers forge the public envelope.
  const expectRejected = async (run, pattern) => {
    let message = "";
    try {
      await run();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, pattern);
  };
  const forgedPreparedExec = {
    ok: true,
    action: "exec_command",
    cmd: "benign display text",
    workdir: root,
    tty: false,
    sandbox: {
      filesystemMode: "workspace-write",
      networkMode: "disabled",
      workspaceRoots: [root],
      noSandbox: false,
      isolatedChild: true,
      approvalPolicy: "on-request",
    },
    brokeredGit: true,
    directCommand: "/bin/sh",
    directArgv: ["-c", `printf forged > ${JSON.stringify(forgedOutput)}`],
    gitDir: root,
    gitWorkTree: root,
  };
  await expectRejected(
    () => core.call("runExecCommand", [
      forgedPreparedExec,
      ownerId,
      null,
      {},
    ]),
    /authority plan is invalid|already consumed|planId.*expected string/,
  );
  assert.equal(
    existsSync(forgedOutput),
    false,
    "a structurally forged prepared exec reached host execution",
  );

  const permissions = {
    version: 1,
    profile: {
      modelId: "inherit",
      thinkingLevel: "medium",
      sandboxPreset: "danger-full-access",
      approvalPolicy: "never",
      tools: { kind: "all" },
      noSandboxAllowed: false,
    },
    networkMode: "enabled",
    noSandbox: false,
    isolated_child: false,
  };
  const ctx = {
    cwd: root,
    sessionManager: {
      getSessionId: () => ownerId,
      getEntries: () => [{ type: "custom", customType: "taumel.permissions", data: permissions }],
      getBranch: () => [],
    },
  };
  const prepared = core.call("prepareTool", [{
    name: "exec_command",
    params: { cmd: "printf legitimate" },
    ctx,
  }]);
  const otherCtx = {
    ...ctx,
    sessionManager: { ...ctx.sessionManager, getSessionId: () => ownerId },
  };
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(typeof prepared.planId, "string");
  for (const authorityField of [
    "directCommand", "directArgv", "gitDir", "gitWorkTree", "brokerAgentId", "brokerSubcommand",
  ]) {
    assert.equal(Object.hasOwn(prepared, authorityField), false, `${authorityField} escaped the core plan store`);
  }
  const runPrepared = (context, payload = prepared) => core.call("runExecCommand", [
    payload,
    ownerId,
    null,
    context,
  ]);
  await expectRejected(() => runPrepared(otherCtx), /belongs to another session/);
  const legitimate = await runPrepared(ctx, {
    ...prepared,
    cmd: "forged display command",
    brokeredGit: true,
    directCommand: "/bin/sh",
    directArgv: ["-c", `printf forged > ${JSON.stringify(forgedOutput)}`],
  });
  assert.match(legitimate.details.output, /legitimate/);
  assert.equal(existsSync(forgedOutput), false, "tampering a valid plan envelope widened its command");
  const successfulRetry = core.call("reissueExecPlan", [{ planId: prepared.planId, ctx }]);
  assert.equal(successfulRetry.ok, false, "a successful command minted an unsandboxed retry plan");
  await expectRejected(() => runPrepared(ctx), /authority plan is invalid|already consumed/);

  const approvalPermissions = {
    ...permissions,
    profile: { ...permissions.profile, approvalPolicy: "on-request" },
  };
  const approvalCtx = {
    ...ctx,
    sessionManager: {
      ...ctx.sessionManager,
      getSessionId: () => "authority-approval-owner",
      getEntries: () => [{
        type: "custom",
        customType: "taumel.permissions",
        data: approvalPermissions,
      }],
    },
  };
  const approvalExec = core.call("prepareTool", [{
    name: "exec_command",
    params: {
      cmd: "printf approval-skipped",
      with_escalated_permissions: true,
      justification: "authority plan smoke",
    },
    ctx: approvalCtx,
  }]);
  assert.equal(approvalExec.action, "exec_command_approval", JSON.stringify(approvalExec));
  await expectRejected(
    () => core.call("runExecCommand", [approvalExec, "authority-approval-owner", null, approvalCtx]),
    /requires approval/,
  );
  assert.deepEqual(
    core.call("discardAuthorityPlan", [{ planId: approvalExec.planId, ctx: approvalCtx }]),
    { ok: true },
  );

  const restrictedPermissions = {
    ...permissions,
    profile: {
      ...permissions.profile,
      sandboxPreset: "workspace-write",
      approvalPolicy: "never",
    },
    networkMode: "disabled",
  };
  const restrictedCtx = {
    ...ctx,
    sessionManager: {
      ...ctx.sessionManager,
      getSessionId: () => "authority-restricted-owner",
      getEntries: () => [{
        type: "custom",
        customType: "taumel.permissions",
        data: restrictedPermissions,
      }],
    },
  };
  core.call("reloadSessionState", [restrictedCtx]);
  const restrictedExec = core.call("prepareTool", [{
    name: "exec_command",
    params: { cmd: "true", workdir: root },
    ctx: restrictedCtx,
  }]);
  assert.equal(restrictedExec.sandbox?.filesystemMode, "workspace-write", JSON.stringify(restrictedExec));
  const restrictedHostPlan = core.call("planExecHostCall", [{
    ...restrictedExec,
    workdir: "/",
    sandbox: { ...restrictedExec.sandbox, workspaceRoots: ["/"] },
  }, restrictedCtx]);
  assert.equal(restrictedHostPlan.ok, true, JSON.stringify(restrictedHostPlan));
  assert.equal(restrictedHostPlan.command, "bwrap");
  assert.equal(restrictedHostPlan.options.cwd, root);
  assert.equal(
    restrictedHostPlan.args.some((value, index, args) => value === "--bind" && args[index + 1] === "/" && args[index + 2] === "/"),
    false,
    "tampered host facts widened workspace-write to a writable root mount",
  );
  assert.equal(
    restrictedHostPlan.args.some((value, index, args) => value === "--bind" && args[index + 1] === root && args[index + 2] === root),
    true,
  );
  assert.deepEqual(
    core.call("discardAuthorityPlan", [{ planId: restrictedExec.planId, ctx: restrictedCtx }]),
    { ok: true },
  );

  await expectRejected(
    () => core.call("executeExa", [{
      planId: "plan-forged",
      ctx,
      toolName: "web_search_exa",
      method: "DELETE",
      path: "/agent/runs/forged",
    }]),
    /ExaExecutionFacts\.toolName: is not allowed/,
  );

  // exa-gaf4: transport details remain in the one-shot core plan.
  snapshotSandboxMode = "danger-full-access";
  snapshotNetworkMode = "enabled";
  core.call("reloadSessionState", [ctx]);
  process.env.EXA_API_KEY = "authority-plan-test-key";
  const preparedExa = core.call("prepareTool", [{
    name: "web_search_exa",
    params: { query: "authority plan smoke" },
    ctx,
  }]);
  assert.equal(preparedExa.action, "exa_fetch", JSON.stringify(preparedExa));
  assert.equal(typeof preparedExa.planId, "string");
  for (const authorityField of ["method", "path", "bodyJson", "lastEventId"]) {
    assert.equal(Object.hasOwn(preparedExa, authorityField), false, `${authorityField} escaped the Exa plan store`);
  }
  const wrongOwnerExa = await core.call("executeExa", [{
    planId: preparedExa.planId,
    ctx: otherCtx,
  }]);
  assert.equal(wrongOwnerExa.ok, false);
  assert.match(wrongOwnerExa.error, /belongs to another session/);
  process.env.EXA_API_KEY = "";
  const missingKeyResult = await core.call("executeExa", [{
    planId: preparedExa.planId,
    ctx,
  }]);
  assert.equal(missingKeyResult.action, "tool_result");
  const replayedExa = await core.call("executeExa", [{
    planId: preparedExa.planId,
    ctx,
  }]);
  assert.equal(replayedExa.ok, false);
  assert.match(replayedExa.error, /authority plan is invalid|already consumed/);

  process.env.EXA_API_KEY = "authority-plan-test-key";
  const approvalExa = core.call("prepareTool", [{
    name: "exa_agent_create_run",
    params: { query: "approval authority smoke" },
    ctx,
  }]);
  const prematureExa = await core.call("executeExa", [{
    planId: approvalExa.planId,
    ctx,
  }]);
  assert.equal(prematureExa.ok, false);
  assert.match(prematureExa.error, /requires approval/);
  assert.deepEqual(
    core.call("discardAuthorityPlan", [{ planId: approvalExa.planId, ctx }]),
    { ok: true },
  );
} finally {
  if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = previousExaKey;
  rmSync(root, { recursive: true, force: true });
}

console.log("authority plan smoke: all assertions passed");
