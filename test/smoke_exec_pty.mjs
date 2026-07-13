import { strict as assert } from "node:assert";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeTool } from "../src/tool-executor.ts";

const require = createRequire(import.meta.url);
const pty = require("node-pty");
const bash = spawnSync("which", ["bash"], { encoding: "utf8" }).stdout.trim();
assert(bash, "bash must be resolvable for the PTY smoke test");

let output = "";
const result = await new Promise((resolve) => {
  const terminal = pty.spawn(bash, ["-c", "printf pty-ok"], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: process.env,
  });
  terminal.onData((chunk) => output += chunk);
  terminal.onExit(resolve);
});

assert.equal(result.exitCode, 0);
assert.match(output, /pty-ok/);

require("../dist/taumel.cjs");
const core = globalThis.taumel;
const cwd = process.cwd();
core.init({
  resolveAuthorizationPath: (path) => realpathSync(path),
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({
    cwd,
    provider: "openai-codex",
    model: "gpt-test",
    sandboxMode: "danger-full-access",
    networkMode: "enabled",
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
    sandboxPreset: "danger-full-access",
    approvalPolicy: "never",
    tools: { kind: "all" },
    noSandboxAllowed: true,
  },
  networkMode: "enabled",
  noSandbox: true,
  isolated_child: false,
};
const ctx = {
  cwd,
  sessionManager: {
    getSessionId: () => "exec-pty-smoke",
    getEntries: () => [{ type: "custom", customType: "taumel.permissions", data: permissions }],
    getBranch: () => [],
  },
};
const host = {
  platform: process.platform,
  tempRoots: ["/tmp"],
  systemRoPaths: [],
  homeMount: "/home",
  workspaceRoots: [cwd],
  authorizationCwd: cwd,
  workspaceMetadataListings: [],
};
async function runExec(cmd) {
  const prepared = core.call("prepareTool", [{ name: "exec_command", params: { cmd }, ctx }]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  return core.call("runExecCommand", [
    prepared,
    host,
    { defaultCwd: cwd, bashPath: bash },
    "exec-pty-smoke",
    null,
    true,
  ]);
}

const bridgeResult = await runExec("printf 'stdout-ok\\n'; printf 'stderr-ok\\n' >&2");
assert.match(bridgeResult.details.output, /stdout-ok/);
assert.match(bridgeResult.details.output, /stderr-ok/);

let completionWaits = 0;
const observingCore = {
  call(method, args) {
    if (method === "awaitExecCompletion") completionWaits += 1;
    return core.call(method, args);
  },
};
const asyncResult = await executeTool(
  {},
  observingCore,
  new Map(),
  "exec_command",
  { cmd: "sleep 1", yield_time_ms: 250 },
  ctx,
);
assert.equal(typeof asyncResult.details.sessionId, "number");
assert.equal(completionWaits, 1, "an async built exec result must start its completion waiter");
await core.call("awaitExecCompletion", [asyncResult.details.sessionId]);
await core.call("writeExecStdin", [{
  sessionId: asyncResult.details.sessionId,
  chars: "",
  ownerId: "exec-pty-smoke",
  yieldTimeMs: 5000,
  outputMode: "delta",
}]);

process.env.TAUMEL_TEST_TOKEN = "ambient-token-ok";
const environmentResult = await runExec(
  `printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$NO_COLOR" "$TERM" "$LANG" "$LC_CTYPE" "$LC_ALL" "$COLORTERM" "$PAGER" "$GIT_PAGER" "$SHELL" "$GIT_TERMINAL_PROMPT"; printf '%s\\n' "$TAUMEL_TEST_TOKEN"; stty size`,
);
assert.match(
  environmentResult.details.output,
  new RegExp(`1\\|dumb\\|C\\.UTF-8\\|C\\.UTF-8\\|C\\.UTF-8\\|\\|cat\\|cat\\|${bash.replaceAll("/", "\\/")}\\|0`),
);
assert.match(environmentResult.details.output, /ambient-token-ok/);
assert.match(environmentResult.details.output, /24 80/);

const gitDir = await mkdtemp(join(tmpdir(), "taumel-exec-pager-"));
try {
  const runGit = (...args) => {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  runGit("init", "-q", gitDir);
  await writeFile(join(gitDir, "tracked.txt"), "before\n");
  runGit("-C", gitDir, "add", "tracked.txt");
  runGit("-C", gitDir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial");
  await writeFile(join(gitDir, "tracked.txt"), "after\n");
  runGit("-C", gitDir, "config", "core.pager", "sh -c 'printf pager-launched; exit 97'");

  const gitResult = await runExec(`git -C '${gitDir}' diff`);
  assert.equal(gitResult.details.exitCode, 0, gitResult.content[0]?.text);
  assert.match(gitResult.details.output, /-before/);
  assert.match(gitResult.details.output, /\+after/);
  assert.doesNotMatch(gitResult.details.output, /pager-launched/);
} finally {
  await rm(gitDir, { recursive: true, force: true });
}
console.log("exec PTY smoke: all assertions passed");
