import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { executeTool, registerGatewayTools } from "../src/tool-executor.ts";

const root = mkdtempSync(join(tmpdir(), "taumel-worktree-runtime-"));
const main = join(root, "main");
const worktree = join(root, "worktree");
const branch = "taumel/agent/test/agent-runtime";
const trustedGit = realpathSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim());
process.env.PI_CODING_AGENT_DIR = join(root, "agent-home");
process.env.HOME = join(root, "home");
process.env.XDG_CONFIG_HOME = join(process.env.HOME, ".config");
mkdirSync(process.env.HOME, { recursive: true });
mkdirSync(join(process.env.XDG_CONFIG_HOME, "git"), { recursive: true });

function git(cwd, ...args) {
  return execFileSync(trustedGit, args, { cwd, encoding: "utf8" }).trim();
}

try {
  git(root, "init", "-b", "main", main);
  git(main, "config", "user.name", "Test");
  git(main, "config", "user.email", "test@example.com");
  git(main, "config", "commit.gpgsign", "false");
  writeFileSync(join(main, "tracked.txt"), "tracked\n");
  git(main, "add", "tracked.txt");
  git(main, "commit", "-m", "initial");
  git(main, "worktree", "add", "-b", branch, worktree);
  git(main, "config", "--global", "user.name", "Global Test");
  git(main, "config", "--global", "user.email", "global@example.com");
  git(main, "config", "--unset", "user.name");
  git(main, "config", "--unset", "user.email");
  const fakeBin = join(root, "fake-bin");
  const fakeGitMarker = join(root, "fake-git-invoked");
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, "git"), `#!/bin/sh\nprintf invoked > ${JSON.stringify(fakeGitMarker)}\nexit 97\n`);
  chmodSync(join(fakeBin, "git"), 0o755);
  process.env.PATH = `${fakeBin}:${process.env.PATH}`;

  const require = createRequire(import.meta.url);
  require(fileURLToPath(new URL("../dist/taumel.cjs", import.meta.url)));
const bootstrap = globalThis.taumel;
let core;
  core = bootstrap.init({
    resolveAuthorizationPath: (path) => path,
    on: () => undefined,
    eventsOn: () => () => undefined,
    emit: () => undefined,
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    setFooter: () => undefined,
    sessionSnapshot: (ctx) => ({
      cwd: ctx?.cwd ?? main,
      provider: "test",
      model: "test",
      thinking: "medium",
      totalCost: 0,
      contextPercent: 0,
      contextWindow: 1,
    }),
    getGitBranch: () => "main",
    onBranchChange: () => () => undefined,
    requestRender: () => undefined,
    themeFg: (_theme, _color, value) => value,
  });

  const parentEntries = [];
  const parentCtx = {
    cwd: main,
    activeTools: ["read", "exec_command", "agent_spawn"],
    model: { provider: "test", id: "test" },
    sessionManager: {
      getSessionId: () => "parent",
      getSessionFile: () => join(root, "parent.jsonl"),
      getEntries: () => parentEntries,
      getBranch: () => [],
      appendCustomEntry: (customType, data) => {
        parentEntries.push({ type: "custom", customType, data });
      },
    },
  };
  const parentPwd = core.call("prepareTool", [{
    name: "exec_command", params: { cmd: "pwd" }, ctx: parentCtx,
  }]);
  assert.equal(parentPwd.workdir, main);

  const metadata = {
    kind: "agent",
    agentKind: "generic",
    agentId: "agent-runtime",
    modelId: "test/test",
    thinkingLevel: "medium",
    activeTools: ["exec_command", "write"],
    capabilityProfile: {
      modelId: "inherit",
      thinkingLevel: "medium",
      sandboxPreset: "workspace-write",
      approvalPolicy: "on-request",
      tools: { kind: "all" },
      noSandboxAllowed: false,
    },
    networkMode: "disabled",
    isolated_child: true,
    workspaceDirectory: worktree,
    sourceWorkspace: main,
    isolation: "worktree",
    workspaceBinding: {
      variant: "worktree",
      source_origin: main,
      main_repository_root: main,
      main_repository_id: "test-repository",
    },
    worktreePath: worktree,
    worktreeBranch: branch,
    mainRepositoryRoot: main,
  };
  const plan = core.call("planChildSessionStart", [{
    metadata, parentSessionId: "parent", parentSessionFile: "",
  }, parentCtx]);
  const marker = plan.setupEntries.find((entry) => entry.customType === "taumel.childSession")?.data;
  assert.equal(marker?.workspaceDirectory, worktree, "worktree metadata was lost at the child-session bridge");
  assert.equal(marker?.mainRepositoryRoot, main, "repository metadata was lost at the child-session bridge");

  const entries = plan.setupEntries.map((entry) => ({ type: "custom", ...entry }));
  const childCtx = {
    cwd: worktree,
    sessionManager: {
      getSessionId: () => "child",
      getEntries: () => entries,
      getBranch: () => [],
    },
  };
  const childPwd = core.call("prepareTool", [{
    name: "exec_command", params: { cmd: "pwd" }, ctx: childCtx,
  }]);
  assert.equal(childPwd.workdir, worktree, "isolated child retained the parent cwd");
  assert.deepEqual(childPwd.sandbox?.workspaceRoots, [worktree]);

  const childWrite = core.call("prepareTool", [{
    name: "write", params: { path: "probe.txt", content: "probe\n" }, ctx: childCtx,
  }]);
  assert.equal(childWrite.path, join(worktree, "probe.txt"), "child write targeted the parent workspace");

  for (const [name, params] of [
    ["write", { path: join(main, "leak.txt"), content: "leak\n" }],
    ["edit", {
      path: join(main, "tracked.txt"),
      edits: [{ oldText: "tracked", newText: "escaped" }],
    }],
    ["apply_patch", {
      input: `*** Begin Patch\n*** Add File: ${join(main, "leak.txt")}\n+leak\n*** End Patch`,
    }],
  ]) {
    const outsideMutation = core.call("prepareTool", [{ name, params, ctx: childCtx }]);
    assert.equal(outsideMutation.ok, false, `${name} made an out-of-worktree mutation approvable`);
    assert.match(outsideMutation.error, /worktree-isolated child mutation/);
  }

  const childGitAdd = core.call("prepareTool", [{
    name: "exec_command", params: { cmd: "git add --all" }, ctx: childCtx,
  }]);
  assert.equal(childGitAdd.brokeredGit, true, "isolated child git add bypassed broker routing");
  assert.equal(typeof childGitAdd.planId, "string");
  assert.equal(Object.hasOwn(childGitAdd, "gitWorkTree"), false);
  assert.equal(Object.hasOwn(childGitAdd, "directCommand"), false);
  const brokerHostPlan = core.call("planExecHostCall", [
    childGitAdd,
    childCtx,
  ]);
  assert.equal(brokerHostPlan.ok, true, JSON.stringify(brokerHostPlan));
  assert.equal(brokerHostPlan.command.startsWith("/"), true, "broker plan lost trusted Git executable");

  let runExecCalls = 0;
  const guardedCore = {
    call(name, args) {
      if (name === "runExecCommand") runExecCalls += 1;
      return core.call(name, args);
    },
  };
  const rejectedExecution = await executeTool(
    {},
    guardedCore,
    new Map(),
    "exec_command",
    { cmd: "TAUMEL_PROBE=1 git status" },
    childCtx,
  );
  assert.match(rejectedExecution.content[0].text, /unsupported shell syntax|simple git command/);
  assert.equal(runExecCalls, 0, "forbidden Git reached process execution");

  for (const command of [
    "TAUMEL_PROBE=1 git status",
    "env TAUMEL_PROBE=1 git status",
    "env -u PATH git status",
    "\'git\' status",
    "g\\it status",
    "$GIT status",
    "echo probe | git status",
    "echo $(git status)",
    "/usr/bin/git status",
    "command git status",
    "sh -c \'git status\'",
    "exec git status",
  ]) {
    const disguisedGit = core.call("prepareTool", [{
      name: "exec_command", params: { cmd: command }, ctx: childCtx,
    }]);
    assert.equal(
      disguisedGit.ok,
      false,
      `non-simple Git bypassed mandatory worktree planner rejection: ${command}`,
    );
  }
  for (const command of [
    "echo git",
    "env echo git",
    "env -u git echo ok",
    "command -v git",
    "command -V git",
    "sh -c \'echo git\'",
    "\'g\\it\' status",
    "printf \'g%s status\\n\' it | sh",
  ]) {
    const ordinarySandboxedCommand = core.call("prepareTool", [{
      name: "exec_command", params: { cmd: command }, ctx: childCtx,
    }]);
    assert.equal(
      ordinarySandboxedCommand.ok,
      true,
      `ordinary command was rejected instead of remaining sandboxed: ${command}`,
    );
    assert.notEqual(ordinarySandboxedCommand.brokeredGit, true);
  }

  writeFileSync(join(worktree, "global-identity.txt"), "global identity\n");
  const staged = await executeTool(
    {}, core, new Map(), "exec_command", { cmd: "git add --all" }, childCtx,
  );
  assert.equal(staged.details.exitCode, 0, staged.content[0]?.text);
  const committed = await executeTool(
    {}, core, new Map(), "exec_command", { cmd: "git commit -m 'global identity'" }, childCtx,
  );
  assert.equal(committed.details.exitCode, 0, committed.content[0]?.text);
  assert.equal(
    git(worktree, "show", "-s", "--format=%an <%ae>|%cn <%ce>", "HEAD"),
    "Global Test <global@example.com>|Global Test <global@example.com>",
  );

  const escalated = core.call("prepareTool", [{
    name: "exec_command",
    params: { cmd: "pwd", with_escalated_permissions: true, justification: "test" },
    ctx: childCtx,
  }]);
  assert.equal(escalated.ok, false, "worktree child accepted command escalation");

  const invalidMarker = { ...marker };
  delete invalidMarker.mainRepositoryRoot;
  const invalidCtx = {
    ...childCtx,
    sessionManager: {
      ...childCtx.sessionManager,
      getEntries: () => entries.map((entry) => entry.customType === "taumel.childSession"
        ? { ...entry, data: invalidMarker }
        : entry),
    },
  };
  const invalidPrepared = core.call("prepareTool", [{
    name: "exec_command", params: { cmd: "pwd" }, ctx: invalidCtx,
  }]);
  assert.equal(invalidPrepared.ok, false, "invalid worktree metadata degraded to ordinary execution");
  const invalidWrite = core.call("prepareTool", [{
    name: "write", params: { path: "invalid.txt", content: "invalid\n" }, ctx: invalidCtx,
  }]);
  assert.equal(invalidWrite.ok, false, "invalid worktree metadata produced a write approval");
  assert.match(invalidWrite.error, /child session metadata/);

  const firstStart = core.call("prepareTool", [{
    name: "agent_spawn",
    params: { message: "first", description: "Start first worktree", isolation: "worktree" },
    ctx: parentCtx,
  }]);
  assert.equal(firstStart.ok, true);
  const firstStartCapability = {
    capabilityId: firstStart.capabilityId, agentId: firstStart.agentId,
    action: firstStart.action, runId: firstStart.runId,
    submissionId: firstStart.submissionId, ctx: parentCtx,
  };
  assert.deepEqual(core.call("claimAgentAction", [firstStartCapability]), { ok: true });
  assert.equal(git(main, "show-ref", "--verify", "--quiet", `refs/heads/${firstStart.metadata.worktreeBranch}`), "");
  const secondStart = core.call("prepareTool", [{
    name: "agent_spawn",
    params: { message: "second", description: "Start second worktree", isolation: "worktree" },
    ctx: parentCtx,
  }]);
  assert.equal(secondStart.ok, true);
  assert.deepEqual(core.call("acceptAgentWorktreeStart", [firstStart, parentCtx]), { ok: true });
  assert.deepEqual(core.call("releaseAgentAction", [firstStartCapability]), { ok: true });
  assert.deepEqual(core.call("reconcileProvisionalAgentWorktrees", []), { ok: true });
  assert.equal(
    execFileSync(trustedGit, ["worktree", "list", "--porcelain"], { cwd: main, encoding: "utf8" })
      .includes(`worktree ${firstStart.metadata.worktreePath}`),
    true,
    "starting another identity reclaimed a live provisional worktree",
  );
  assert.equal(existsSync(fakeGitMarker), false, "Git execution resolved through poisoned PATH");
  writeFileSync(join(firstStart.metadata.worktreePath, "dirty.txt"), "dirty\n");
  const failedClose = await executeTool(
    {},
    core,
    new Map(),
    "agent_close",
    { agent_id: firstStart.agentId, delete_worktree: true },
    parentCtx,
  );
  const failedClosePayload = JSON.parse(failedClose.content[0].text);
  assert.equal(failedClosePayload.error.code, "cleanup_failed");
  assert.match(failedClosePayload.error.message, /uncommitted changes/);
  assert.doesNotMatch(failedClosePayload.error.message, /Invalid OCaml acknowledgement/);
  const registeredTools = new Map();
  registerGatewayTools({
    registerTool(tool) { registeredTools.set(tool.name, tool); },
    on() {},
  }, core, new Map());
  let registeredCloseError = "";
  try {
    await registeredTools.get("agent_close").execute(
      "close-call",
      { agent_id: firstStart.agentId, delete_worktree: true },
      undefined,
      undefined,
      parentCtx,
    );
  } catch (error) {
    registeredCloseError = error instanceof Error ? error.message : String(error);
  }
  const registeredClosePayload = JSON.parse(registeredCloseError);
  assert.equal(registeredClosePayload.error.code, "cleanup_failed");
  assert.match(registeredClosePayload.error.message, /uncommitted changes/);

  rmSync(join(firstStart.metadata.worktreePath, "dirty.txt"));
  const gitlinkHead = git(firstStart.metadata.worktreePath, "rev-parse", "HEAD");
  git(
    firstStart.metadata.worktreePath,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${gitlinkHead},broken-submodule`,
  );
  git(firstStart.metadata.worktreePath, "commit", "-m", "add malformed submodule entry");
  const brokenSubmodule = join(firstStart.metadata.worktreePath, "broken-submodule");
  mkdirSync(brokenSubmodule);
  git(brokenSubmodule, "init");
  git(brokenSubmodule, "remote", "add", "origin", firstStart.metadata.worktreePath);
  git(brokenSubmodule, "fetch", "origin", gitlinkHead);
  git(brokenSubmodule, "checkout", "FETCH_HEAD");
  assert.equal(git(firstStart.metadata.worktreePath, "status", "--porcelain=v1"), "");
  assert.throws(
    () => git(firstStart.metadata.worktreePath, "submodule", "status", "--recursive"),
    /no submodule mapping/,
  );
  const failedSubmoduleInspection = await executeTool(
    {},
    core,
    new Map(),
    "agent_close",
    { agent_id: firstStart.agentId, delete_worktree: true },
    parentCtx,
  );
  const failedSubmodulePayload = JSON.parse(failedSubmoduleInspection.content[0].text);
  assert.equal(failedSubmodulePayload.error.code, "cleanup_failed");
  assert.match(failedSubmodulePayload.error.message, /inspect.*submodule/i);
  assert.equal(existsSync(firstStart.metadata.worktreePath), true);
  assert.equal(
    core.call("prepareTool", [{ name: "agent_list", params: {}, ctx: parentCtx }])
      .details.agents.some((agent) => agent.agent_id === firstStart.agentId),
    true,
    "failed submodule inspection removed the identity",
  );

  writeFileSync(
    join(firstStart.metadata.worktreePath, ".gitmodules"),
    `[submodule "broken-submodule"]\n\tpath = broken-submodule\n\turl = ${firstStart.metadata.worktreePath}\n\tignore = all\n`,
  );
  git(firstStart.metadata.worktreePath, "add", ".gitmodules");
  git(firstStart.metadata.worktreePath, "commit", "-m", "configure ignored submodule");
  writeFileSync(join(brokenSubmodule, "tracked.txt"), "hidden dirty submodule\n");
  assert.equal(
    git(firstStart.metadata.worktreePath, "status", "--porcelain=v1"),
    "",
    "test precondition: repository config did not hide dirty submodule",
  );
  assert.notEqual(
    git(firstStart.metadata.worktreePath, "status", "--porcelain=v1", "--ignore-submodules=none"),
    "",
  );
  const hiddenDirtyClose = await executeTool(
    {},
    core,
    new Map(),
    "agent_close",
    { agent_id: firstStart.agentId, delete_worktree: true },
    parentCtx,
  );
  const hiddenDirtyPayload = JSON.parse(hiddenDirtyClose.content[0].text);
  assert.equal(hiddenDirtyPayload.error.code, "cleanup_failed");
  assert.match(hiddenDirtyPayload.error.message, /uncommitted changes/);
  assert.equal(existsSync(firstStart.metadata.worktreePath), true);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("agent worktree runtime smoke: all assertions passed");
