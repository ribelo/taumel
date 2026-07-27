import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { threadSources } from "../src/thread-sources.ts";

const root = await mkdtemp(join(tmpdir(), "taumel-thread-sources-"));
const globalRoot = await mkdtemp(join(tmpdir(), "taumel-global-thread-sources-"));
const sessionsDir = join(root, "sessions");
const localSessionsDir = join(root, ".pi", "sessions");
const globalSessionsDir = join(globalRoot, "sessions");

try {
  await mkdir(sessionsDir);
  await mkdir(localSessionsDir, { recursive: true });
  await mkdir(globalSessionsDir);
  const padding = "x".repeat(4 * 1024 * 1024);
  let targetPath = "";
  for (let index = 0; index < 30; index += 1) {
    const id = `thread-${index.toString().padStart(3, "0")}`;
    const path = join(sessionsDir, `${id}.jsonl`);
    if (index === 29) targetPath = path;
    const header = JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: `2026-07-20T00:00:${index.toString().padStart(2, "0")}.000Z`,
      cwd: root,
    });
    const message = JSON.stringify({
      type: "message",
      id: `entry-${index}`,
      message: {
        role: "user",
        content: index === 29 ? `find 459730 here ${padding}` : padding,
      },
    });
    await writeFile(path, `${header}\n${message}\n`, "utf8");
  }
  const oversizedPath = join(sessionsDir, "oversized.jsonl");
  await writeFile(oversizedPath, '{"type":"session","id":"oversized","cwd":"/tmp"}\n459730\n', "utf8");
  const oversized = await open(oversizedPath, "r+");
  await oversized.truncate(33 * 1024 * 1024);
  await oversized.close();
  await writeFile(
    join(sessionsDir, "oversized-child.jsonl"),
    `${JSON.stringify({ type: "session", id: "oversized-child", cwd: root })}\n`,
    "utf8",
  );
  await writeFile(
    join(sessionsDir, "legacy-thread.jsonl"),
    `${JSON.stringify({ type: "session", cwd: root })}\n`,
    "utf8",
  );
  const localPath = join(localSessionsDir, "local-thread.jsonl");
  await writeFile(
    localPath,
    `${JSON.stringify({ type: "session", id: "local-thread", cwd: root })}\n${JSON.stringify({ type: "message", id: "local-entry", message: { role: "user", content: "local-only" } })}\n`,
    "utf8",
  );
  await writeFile(
    join(globalSessionsDir, "global-match.jsonl"),
    `${JSON.stringify({ type: "session", id: "global-match", cwd: "/other" })}\n459730\n`,
    "utf8",
  );

  const core = {
    call(name) {
      assert.equal(name, "planThreadCatalogScans");
      return {
        scans: [
          { root: sessionsDir, maxDepth: 1, maxFiles: 100, suffix: ".jsonl" },
          { root: localSessionsDir, maxDepth: 1, maxFiles: 100, suffix: ".jsonl" },
          { root: globalSessionsDir, maxDepth: 1, maxFiles: 100, suffix: ".jsonl" },
        ],
      };
    },
  };
  const ctx = {
    cwd: root,
    sessionManager: { getSessionDir: () => sessionsDir },
  };
  const sources = await threadSources(core, ctx, {
    action: "query_threads",
    query: "459730",
    scope: "current_workspace",
  });
  const files = sources.filter((source) => source.kind === "sessionFile");
  // threads-cykq, threads-sw2b, threads-9292
  assert.equal(files.length, 1, "query discovery should fully load only matching session files");
  assert.equal(files[0]?.path, targetPath);
  assert(files[0].text.length < 5 * 1024 * 1024, "selected source should remain within the per-file budget");
  assert(
    sources.some((source) => source.kind === "diagnostic" && source.path === oversizedPath && source.error.includes("safety limit")),
    "oversized matching sources should become diagnostics instead of being loaded",
  );

  const readSources = await threadSources(core, ctx, {
    action: "read_thread",
    threadID: "thread-029",
  });
  const readFiles = readSources.filter((source) => source.kind === "sessionFile");
  assert.equal(readFiles.length, 1, "read discovery should fully load only matching thread IDs");
  assert.equal(readFiles[0]?.path, targetPath);

  const localSources = await threadSources(core, ctx, {
    action: "query_threads",
    query: "local-only",
    scope: "current_workspace",
  });
  assert.equal(localSources.filter((source) => source.kind === "sessionFile")[0]?.path, localPath);

  const legacySources = await threadSources(core, ctx, {
    action: "query_threads",
    query: "legacy-thread",
    scope: "current_workspace",
  });
  assert.equal(legacySources.filter((source) => source.kind === "sessionFile")[0]?.path.endsWith("legacy-thread.jsonl"), true);

  const oversizedReadSources = await threadSources(core, ctx, {
    action: "read_thread",
    threadID: "oversized",
  });
  const oversizedReadFiles = oversizedReadSources.filter((source) => source.kind === "sessionFile");
  assert.equal(oversizedReadFiles.length, 1, "an oversized exact ID must suppress smaller prefix matches");
  assert.equal(oversizedReadFiles[0]?.path, oversizedPath);
  assert(oversizedReadFiles[0].text.length < 64 * 1024, "oversized exact reads should retain only bounded identity metadata");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(globalRoot, { recursive: true, force: true });
}

console.log("thread source smoke: all assertions passed");
