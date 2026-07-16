import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseToolParams } from "../src/tool-contracts.ts";

const require = createRequire(import.meta.url);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// agent-tc01 / agent-tc02 / agent-tc06: isolation and delete_worktree contracts
assert.equal(parseToolParams("agent_spawn", {
  message: "work",
  description: "Work in isolation",
  isolation: "worktree",
}).ok, true);
assert.equal(parseToolParams("finder", {
  query: "find",
  description: "Find files",
  isolation: "none",
}).ok, true);
assert.equal(parseToolParams("agent_close", {
  agent_id: "agent-ab12",
  delete_worktree: true,
}).ok, true);

// Pure path derivation and binding encoding are covered by OCaml tests.
// Host-side provision: create a temp git repo and exercise native worktree + baseline shape.
const root = mkdtempSync(join(tmpdir(), "taumel-worktree-"));
const repo = join(root, "project");
mkdirSync(repo);
try {
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  writeFileSync(join(repo, "dirty.txt"), "dirty\n");
  writeFileSync(join(repo, "README.md"), "hello changed\n");

  const head = git(repo, ["rev-parse", "HEAD"]);
  const branch = "taumel/agent/project/owner/agent-ab12/test";
  const worktree = join(root, "agent-wt");
  git(repo, ["worktree", "add", "-b", branch, worktree, head]);
  // Reproduce dirty state
  writeFileSync(join(worktree, "dirty.txt"), "dirty\n");
  writeFileSync(join(worktree, "README.md"), "hello changed\n");
  execFileSync("git", ["add", "-A"], {
    cwd: worktree,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Pi Baseline",
      GIT_AUTHOR_EMAIL: "pi-baseline@local",
      GIT_COMMITTER_NAME: "Pi Baseline",
      GIT_COMMITTER_EMAIL: "pi-baseline@local",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  execFileSync("git", ["-c", "user.useConfigOnly=true", "commit", "--allow-empty", "-m", "pi agent baseline"], {
    cwd: worktree,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Pi Baseline",
      GIT_AUTHOR_EMAIL: "pi-baseline@local",
      GIT_COMMITTER_NAME: "Pi Baseline",
      GIT_COMMITTER_EMAIL: "pi-baseline@local",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const status = git(worktree, ["status", "--porcelain"]);
  assert.equal(status, "", "baseline leaves clean worktree");
  const author = git(worktree, ["log", "-1", "--format=%an <%ae>"]);
  assert.equal(author, "Pi Baseline <pi-baseline@local>");
  assert.ok(existsSync(join(worktree, "dirty.txt")));
  assert.equal(readFileSync(join(worktree, "README.md"), "utf8"), "hello changed\n");

  // clean remove without force
  git(repo, ["worktree", "remove", worktree]);
  assert.equal(existsSync(worktree), false);
  // branch preserved
  const branches = git(repo, ["branch", "--list", branch]);
  assert.ok(branches.includes(branch.split("/").pop()) || branches.includes(branch));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("agent worktree smoke: all assertions passed");
