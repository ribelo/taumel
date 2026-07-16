import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "taumel-worktree-runtime-"));
const main = join(root, "main");
const worktree = join(root, "worktree");
const branch = "taumel/agent/test/agent-runtime";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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

  const require = createRequire(import.meta.url);
  require(fileURLToPath(new URL("../dist/taumel.cjs", import.meta.url)));
  const core = globalThis.taumel;
  core.init({
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

  const parentCtx = {
    cwd: main,
    sessionManager: {
      getSessionId: () => "parent",
      getEntries: () => [],
      getBranch: () => [],
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
  }]);
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
  assert.equal(childGitAdd.gitWorkTree, worktree);

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
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("agent worktree runtime smoke: all assertions passed");
