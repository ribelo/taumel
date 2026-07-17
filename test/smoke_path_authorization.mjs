import { strict as assert } from "node:assert";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const bootstrap = globalThis.taumel;
let core;

function resolveAuthorizationPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(resolveAuthorizationPath(parent), basename(path));
  }
}

const root = await mkdtemp(join(tmpdir(), "taumel-path-authorization-"));
try {
  const workspace = join(root, "allowed");
  const alias = join(root, "alias");
  const inside = join(workspace, "inside.txt");
  const missing = join(alias, "created.txt");
  const secret = join(root, "secret.txt");
  const escape = join(workspace, "escape.txt");
  const metadata = join(workspace, ".git", "config");
  const metadataAlias = join(workspace, "git-config");
  const brokenAlias = join(workspace, "broken.txt");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(inside, "inside\n");
  await writeFile(secret, "secret\n");
  await writeFile(metadata, "git\n");
  await symlink(workspace, alias);
  await symlink(secret, escape);
  await symlink(metadata, metadataAlias);
  await symlink(join(root, "missing-target.txt"), brokenAlias);

  core = bootstrap.init({
    resolveAuthorizationPath,
    on: () => undefined,
    eventsOn: () => () => undefined,
    emit: () => undefined,
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    setFooter: () => undefined,
    sessionSnapshot: () => ({
      cwd: workspace,
      provider: "openai-codex",
      model: "gpt-test",
      sandboxMode: "workspace-write",
      networkMode: "disabled",
    }),
    getGitBranch: () => "main",
    onBranchChange: () => () => undefined,
    requestRender: () => undefined,
    themeFg: (_theme, _color, value) => value,
  });

  const permissions = {
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
  };
  const ctx = {
    cwd: workspace,
    sessionManager: {
      getSessionId: () => "path-authorization-smoke",
      getSessionFile: () => join(root, "session.jsonl"),
      getEntries: () => [{ type: "custom", customType: "taumel.permissions", data: permissions }],
      getBranch: () => [],
    },
  };
  const prepareWrite = (path) => core.call("prepareTool", [{
    name: "write",
    params: { path, content: "updated\n" },
    ctx,
  }]);

  const throughAlias = prepareWrite(join(alias, "inside.txt"));
  assert.equal(throughAlias.ok, true, JSON.stringify(throughAlias));
  assert.equal(throughAlias.path, realpathSync(inside));

  const nonexistent = prepareWrite(missing);
  assert.equal(nonexistent.ok, true, JSON.stringify(nonexistent));
  assert.equal(nonexistent.path, join(realpathSync(workspace), "created.txt"));

  const escaped = prepareWrite(escape);
  assert.equal(escaped.ok, false, JSON.stringify(escaped));
  assert.match(escaped.error, /outside workspace roots/);
  assert.match(escaped.error, new RegExp(`requested path: ${escape.replaceAll("/", "\\/")}`));
  assert.match(escaped.error, new RegExp(`resolved target: ${secret.replaceAll("/", "\\/")}`));

  const protectedMetadata = prepareWrite(metadataAlias);
  assert.equal(protectedMetadata.ok, false, JSON.stringify(protectedMetadata));
  assert.match(protectedMetadata.error, /protected workspace metadata/);
  assert.match(protectedMetadata.error, new RegExp(`requested path: ${metadataAlias.replaceAll("/", "\\/")}`));
  assert.match(protectedMetadata.error, new RegExp(`resolved target: ${metadata.replaceAll("/", "\\/")}`));

  const brokenRead = core.call("readFile", [{ path: brokenAlias, defaultCwd: workspace }]);
  assert.equal(brokenRead.details.ok, false, JSON.stringify(brokenRead));
  assert.match(brokenRead.details.error, /symbolic link/i);
  assert.match(brokenRead.details.error, /target does not exist or cannot be accessed/i);

  const preparedExec = core.call("prepareTool", [{
    name: "exec_command",
    params: { cmd: "pwd", workdir: alias },
    ctx,
  }]);
  assert.equal(preparedExec.ok, true, JSON.stringify(preparedExec));
  const execPlan = core.call("planExecHostCall", [
    preparedExec,
    ctx,
  ]);
  assert.equal(execPlan.ok, true, JSON.stringify(execPlan));
  assert.equal(execPlan.options.cwd, realpathSync(workspace));
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("path authorization smoke: all assertions passed");
