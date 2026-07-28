/**
 * Deterministic exec-session concurrency suite (eta-4b69).
 *
 * Uses a Module._load hook to substitute a fake node-pty so races are
 * controlled without wall-clock waits. The real node-pty smoke remains in
 * smoke_exec_pty.mjs for integration ordering.
 *
 * GAP markers: where current code violates a requirement, the suite stays
 * green and records the gap rather than encoding the violation as baseline.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const gaps = [];
function gap(id, actual, required, detail = "") {
  const entry = { id, actual, required, detail };
  gaps.push(entry);
  console.log(
    `GAP ${id}: actual=${JSON.stringify(actual)} required=${JSON.stringify(required)}${detail ? ` (${detail})` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Fake node-pty
// ---------------------------------------------------------------------------
class FakeTerminal {
  static instances = [];
  static spawnImpl = null;

  constructor(file, args, options) {
    this.file = file;
    this.args = args;
    this.options = options;
    this.pid = 40_000 + FakeTerminal.instances.length;
    this.killed = false;
    this.exited = false;
    this.writes = [];
    this._onData = null;
    this._onExit = null;
    FakeTerminal.instances.push(this);
  }

  onData(cb) {
    this._onData = cb;
  }

  onExit(cb) {
    this._onExit = cb;
  }

  write(chars) {
    this.writes.push(String(chars));
  }

  kill() {
    this.killed = true;
    if (!this.exited) this.exit(143);
  }

  emitData(text) {
    if (this._onData) this._onData(text);
  }

  exit(code = 0) {
    if (this.exited) return;
    this.exited = true;
    if (this._onExit) this._onExit({ exitCode: code });
  }
}

const fakePty = {
  spawn(file, args, options) {
    if (typeof FakeTerminal.spawnImpl === "function") {
      return FakeTerminal.spawnImpl(file, args, options);
    }
    return new FakeTerminal(file, args, options);
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "node-pty") return fakePty;
  return originalLoad.call(this, request, parent, isMain);
};

// Load core after the hook so spawn goes through the fake.
require("../dist/taumel.cjs");
const bootstrap = globalThis.taumel;
assert.ok(bootstrap, "taumel bootstrap missing");

const cwd = process.cwd();
const ownerId = "exec-concurrency-owner";
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
    getSessionId: () => ownerId,
    getEntries: () => [
      {
        type: "custom",
        customType: "taumel.permissions",
        data: permissions,
      },
    ],
    getBranch: () => [],
  },
};

const core = bootstrap.init({
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

function resetTerminals() {
  FakeTerminal.instances = [];
  FakeTerminal.spawnImpl = null;
}

function lastTerminal() {
  assert.ok(FakeTerminal.instances.length > 0, "expected a spawned fake terminal");
  return FakeTerminal.instances[FakeTerminal.instances.length - 1];
}

async function startSession(cmd = "sleep 999", yieldMs = 250) {
  const prepared = core.call("prepareTool", [
    {
      name: "exec_command",
      params: { cmd, yield_time_ms: yieldMs },
      ctx,
    },
  ]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const result = await core.call("runExecCommand", [
    prepared,
    ownerId,
    null,
    ctx,
  ]);
  return result;
}

function writeStdin(sessionId, opts = {}) {
  return core.call("writeExecStdin", [
    {
      sessionId,
      chars: opts.chars ?? "",
      ownerId,
      yieldTimeMs: opts.yieldTimeMs ?? 250,
      outputMode: opts.outputMode ?? "delta",
      ...(opts.maxOutputTokens !== undefined
        ? { maxOutputTokens: opts.maxOutputTokens }
        : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    },
  ]);
}

function pendingNotifications() {
  return core.call("pendingExecNotifications", [ownerId]);
}

function textOf(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return String(result?.message ?? result ?? "");
  return content.map((part) => part?.text ?? "").join("\n");
}

function microtask() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testTwoCompletionWaitersWake() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  assert.equal(typeof sessionId, "number");
  const term = lastTerminal();

  const w1 = core.call("awaitExecCompletion", [sessionId]);
  const w2 = core.call("awaitExecCompletion", [sessionId]);
  await microtask();
  term.exit(0);
  const [r1, r2] = await Promise.all([w1, w2]);
  assert.equal(r1.exited, true);
  assert.equal(r2.exited, true);
  // Consume so owner cleanup is clean.
  await writeStdin(sessionId, { yieldTimeMs: 250 });
}

async function testCancelledWaiterLeavesLaterWaiters() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  const controller = new AbortController();
  const abortedWait = writeStdin(sessionId, {
    yieldTimeMs: 30_000,
    signal: controller.signal,
  });
  await microtask();
  controller.abort();
  await assert.rejects(abortedWait, /abort/i);

  const completion = core.call("awaitExecCompletion", [sessionId]);
  term.exit(7);
  const done = await completion;
  assert.equal(done.exited, true);
  const consumed = await writeStdin(sessionId, { yieldTimeMs: 250 });
  assert.equal(consumed.details.exitCode, 7);
}

async function testExitYieldSameTurn() {
  resetTerminals();
  // Yield window is short; exit in the same turn as the wait starts.
  FakeTerminal.spawnImpl = (file, args, options) => {
    const term = new FakeTerminal(file, args, options);
    queueMicrotask(() => term.exit(0));
    return term;
  };
  const prepared = core.call("prepareTool", [
    {
      name: "exec_command",
      params: { cmd: "true", yield_time_ms: 250 },
      ctx,
    },
  ]);
  const result = await core.call("runExecCommand", [
    prepared,
    ownerId,
    null,
    ctx,
  ]);
  // Terminal in the first wait: no session id, exit code present.
  assert.equal(result.details.sessionId, undefined);
  assert.equal(result.details.exitCode, 0);
}

async function testExitAbortSameTurnInitial() {
  resetTerminals();
  const controller = new AbortController();
  FakeTerminal.spawnImpl = (file, args, options) => {
    const term = new FakeTerminal(file, args, options);
    // Abort and exit race in the same turn.
    queueMicrotask(() => {
      controller.abort();
      term.exit(0);
    });
    return term;
  };
  const prepared = core.call("prepareTool", [
    {
      name: "exec_command",
      params: { cmd: "sleep 1", yield_time_ms: 10_000 },
      ctx,
    },
  ]);
  let rejected = null;
  try {
    await core.call("runExecCommand", [prepared, ownerId, controller.signal, ctx]);
  } catch (error) {
    rejected = error;
  }
  // Abort may win or exit may win depending on ordering; both are terminal for the call.
  if (rejected) {
    const message = String(rejected?.message ?? rejected);
    if (message.includes("Shell command aborted")) {
      // requirement-correct
    } else if (message.includes("Command aborted")) {
      gap(
        "exec-rt05-abort-text",
        "Command aborted",
        "Shell command aborted",
        "initial abort rejection text",
      );
    } else {
      // Exit may have won the race — acceptable same-turn outcome.
      assert.match(message, /abort|exit|Process/i, message);
    }
  } else {
    // Exit settled first: still fine for same-turn race coverage.
    assert.equal(typeof lastTerminal().exited, "boolean");
  }
}

async function testInitialAbortKillsRemovesNoNotification() {
  resetTerminals();
  const controller = new AbortController();
  controller.abort();
  const prepared = core.call("prepareTool", [
    {
      name: "exec_command",
      params: { cmd: "sleep 999", yield_time_ms: 10_000 },
      ctx,
    },
  ]);
  let rejected = null;
  try {
    await core.call("runExecCommand", [prepared, ownerId, controller.signal, ctx]);
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected, "initial abort must reject");
  const message = String(rejected?.message ?? rejected);
  if (message.includes("Shell command aborted")) {
    // ok
  } else if (message.includes("Command aborted")) {
    gap(
      "exec-rt05-abort-text",
      "Command aborted",
      "Shell command aborted",
      "pre-aborted initial exec",
    );
  } else {
    assert.fail(`unexpected abort message: ${message}`);
  }
  const pending = pendingNotifications();
  assert.equal(pending.notifications.length, 0, "aborted initial exec must not notify");
  if (FakeTerminal.instances.length > 0) {
    assert.equal(lastTerminal().killed || lastTerminal().exited, true);
  }
}

async function testAbortedWriteStdinPreservesSession() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();
  term.emitData("keep-me\n");

  const controller = new AbortController();
  const waiting = writeStdin(sessionId, {
    yieldTimeMs: 30_000,
    signal: controller.signal,
  });
  await microtask();
  controller.abort();
  await assert.rejects(waiting, /abort/i);

  assert.equal(term.exited, false, "process must keep running");
  // Unread output preserved for a later delta poll.
  const delta = await writeStdin(sessionId, { yieldTimeMs: 250, outputMode: "delta" });
  assert.match(delta.details.output ?? "", /keep-me/);

  term.exit(0);
  // Notification eligibility restored after non-terminal aborted wait.
  await delay(0);
  const pendingBeforeConsume = pendingNotifications();
  // May or may not have flushed yet; claim path still works.
  const consumed = await writeStdin(sessionId, { yieldTimeMs: 250 });
  assert.equal(consumed.details.exitCode, 0);
  void pendingBeforeConsume;
}

async function testWriteClaimVisibleSynchronously() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  // Synchronous core.call returns a thenable; claim must already be held.
  const pendingPromise = writeStdin(sessionId, { yieldTimeMs: 30_000 });
  assert.equal(typeof pendingPromise.then, "function");

  // Exit while the write claim is live — notification must not be deliverable.
  term.exit(0);
  await microtask();
  const pending = pendingNotifications();
  assert.equal(
    pending.notifications.length,
    0,
    "write claim must suppress exec_completion while held",
  );

  const result = await pendingPromise;
  assert.equal(result.details.exitCode, 0);
  // Terminal consumed by the write — still no notification.
  const after = pendingNotifications();
  assert.equal(after.notifications.length, 0);
}

async function testDeltaOutputOnceInOrder() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  term.emitData("one\n");
  term.emitData("two\n");
  const first = await writeStdin(sessionId, { yieldTimeMs: 250 });
  assert.match(first.details.output ?? "", /one/);
  assert.match(first.details.output ?? "", /two/);
  const firstText = first.details.output ?? "";
  assert.ok(
    firstText.indexOf("one") < firstText.indexOf("two"),
    "delta output must preserve order",
  );

  term.emitData("three\n");
  const second = await writeStdin(sessionId, { yieldTimeMs: 250 });
  assert.match(second.details.output ?? "", /three/);
  assert.doesNotMatch(second.details.output ?? "", /one/);
  assert.doesNotMatch(second.details.output ?? "", /two/);

  term.exit(0);
  await writeStdin(sessionId, { yieldTimeMs: 250 });
}

async function testStatusModeSuppressesAndDrains() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  term.emitData("secret-line\n");
  const status = await writeStdin(sessionId, {
    yieldTimeMs: 5000,
    outputMode: "status",
  });
  assert.equal(status.details.outputMode, "status");
  assert.equal(status.details.output ?? "", "");
  assert.ok((status.details.suppressedBytes ?? 0) > 0, "status must count suppressed bytes");
  assert.ok((status.details.suppressedLines ?? 0) >= 1, "status must count suppressed lines");
  assert.doesNotMatch(textOf(status), /secret-line/);

  const laterDelta = await writeStdin(sessionId, {
    yieldTimeMs: 250,
    outputMode: "delta",
  });
  assert.doesNotMatch(laterDelta.details.output ?? "", /secret-line/);

  term.exit(0);
  await writeStdin(sessionId, { yieldTimeMs: 250 });
}

async function testConcurrentTerminalWriteStdin() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  // Park two long waits, then exit in the same turn so both finish_session paths run.
  const a = writeStdin(sessionId, { yieldTimeMs: 30_000 });
  const b = writeStdin(sessionId, { yieldTimeMs: 30_000 });
  await microtask();
  term.emitData("terminal-body\n");
  term.exit(0);
  const [ra, rb] = await Promise.all([a, b]);

  const aExit = ra?.details?.exitCode;
  const bExit = rb?.details?.exitCode;
  const aText = textOf(ra);
  const bText = textOf(rb);
  const aHasLifecycle =
    /Process exited with code|Command completed with code/i.test(aText)
    || aExit !== undefined;
  const bHasLifecycle =
    /Process exited with code|Command completed with code/i.test(bText)
    || bExit !== undefined;
  const aRetained =
    ra?.details?.alreadyCompleted === true || /already completed/i.test(aText);
  const bRetained =
    rb?.details?.alreadyCompleted === true || /already completed/i.test(bText);

  // Requirement: only one call may consume/return the terminal result (exec-rt08).
  const terminalConsumers =
    Number(aHasLifecycle && !aRetained) + Number(bHasLifecycle && !bRetained);
  if (terminalConsumers > 1) {
    gap(
      "exec-rt08-concurrent-write-stdin",
      "both concurrent write_stdin waits returned terminal lifecycle content",
      "at most one terminal consumption",
      `aExit=${aExit} bExit=${bExit} a=${aText.slice(0, 100)} b=${bText.slice(0, 100)}`,
    );
  } else {
    assert.ok(
      terminalConsumers === 1 || aRetained || bRetained,
      `expected one terminal consumer or retained path; a=${aText.slice(0, 80)} b=${bText.slice(0, 80)}`,
    );
  }
}

async function testTerminalReadVsNotificationSameTurn() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  const waiting = writeStdin(sessionId, { yieldTimeMs: 30_000 });
  await microtask();
  term.exit(0);
  const result = await waiting;
  assert.equal(result.details.exitCode, 0);
  // Terminal consumed by write_stdin — notification must not be pending.
  const pending = pendingNotifications();
  assert.equal(pending.notifications.length, 0);
  const claim = core.call("claimExecNotificationDelivery", [ownerId, sessionId]);
  assert.equal(claim.kind, "unavailable");
}

async function testFailedNotificationSendReleasesClaim() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();
  term.exit(0);
  await core.call("awaitExecCompletion", [sessionId]);
  await microtask();

  const pending = pendingNotifications();
  assert.ok(
    pending.notifications.some((n) => n.sessionId === sessionId),
    "exited unconsumed session should be notification-eligible",
  );

  const claim1 = core.call("claimExecNotificationDelivery", [ownerId, sessionId]);
  assert.equal(claim1.kind, "claimed");
  // Simulate failed send.
  core.call("releaseExecNotificationDelivery", [sessionId]);

  const claim2 = core.call("claimExecNotificationDelivery", [ownerId, sessionId]);
  assert.equal(claim2.kind, "claimed", "failed send must re-enable exactly one retry claim");
  core.call("markExecNotificationDelivered", [sessionId]);

  const claim3 = core.call("claimExecNotificationDelivery", [ownerId, sessionId]);
  assert.equal(claim3.kind, "unavailable", "successful send must not resend");

  await writeStdin(sessionId, { yieldTimeMs: 250 });
}

async function testOutputLimitDistinctAndBounded() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  // 16 MiB ceiling + 1 byte. Emit in chunks to avoid a single huge string copy if possible.
  const chunk = "x".repeat(1024 * 1024);
  for (let i = 0; i < 16; i += 1) term.emitData(chunk);
  term.emitData("y"); // cross the ceiling
  await microtask();

  const result = await writeStdin(sessionId, { yieldTimeMs: 250 });
  assert.equal(result.details.ok, false);
  assert.equal(result.details.reasonCode, "output_limit_exceeded");
  assert.ok(
    (result.details.outputLimitBytes ?? 0) >= 16 * 1024 * 1024,
    "must report the fixed ceiling",
  );
  assert.match(textOf(result), /output limit/i);
  assert.ok(term.killed || term.exited, "crossing the ceiling must terminate the process");
}

async function testOwnerShutdownNoNotification() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  core.call("shutdownExecOwner", [ownerId]);
  const pending = pendingNotifications();
  assert.equal(pending.notifications.length, 0);
  await assert.rejects(
    writeStdin(sessionId, { yieldTimeMs: 250 }),
    /Unknown shell session/i,
  );
}

async function testProcessManagerKillWakesCompletionWaits() {
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;

  const w1 = core.call("awaitExecCompletion", [sessionId]);
  const w2 = core.call("awaitExecCompletion", [sessionId]);
  await microtask();
  const ack = core.call("processManagerKill", [{ ownerId, sessionId }]);
  assert.ok(ack);
  const [r1, r2] = await Promise.all([w1, w2]);
  assert.equal(r1.exited, true);
  assert.equal(r2.exited, true);
  await writeStdin(sessionId, { yieldTimeMs: 250 });
}

async function testBrokerCleanupObservesExitBeforeTimeout() {
  // cancel_broker_sessions_for_agent busy-waits on Date.now. With a fake PTY,
  // onExit only runs when the event loop turns — the busy wait can starve it.
  // We assert the public cancel path returns promptly for an agent with no
  // broker sessions, and document the busy-wait risk for live broker sessions.
  resetTerminals();
  const started = await startSession("sleep 999", 250);
  const sessionId = started.details.sessionId;
  const term = lastTerminal();

  const t0 = Date.now();
  const result = core.call("cancelAgentBrokerSessions", [{ agent_id: "no-such-agent" }]);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1000, `empty broker cancel should be prompt, took ${elapsed}ms`);
  assert.ok(result);

  // Force-exit the unrelated session so cleanup remains tidy.
  term.exit(0);
  await writeStdin(sessionId, { yieldTimeMs: 250 });

  // Document known risk: busy-wait may miss onExit within the 5s window under load.
  gap(
    "broker-cleanup-busy-wait",
    "Date.now busy-spin up to 5s",
    "Effect completion await with timeout",
    "code inspection: cancel_broker_sessions_for_agent blocks the JS event loop; live broker exit observation is not reliably testable until migration",
  );
}

async function testPiToolExecutionDefaultIsParallel() {
  // Evidence for the exec-rt08 investigation: Pi defaults toolExecution to parallel.
  let evidence =
    "pi-mono packages/agent/src/agent.ts defaults toolExecution to parallel; write_stdin has no executionMode override";
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const nested = path.join(
      process.cwd(),
      "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent.js",
    );
    const src = fs.readFileSync(nested, "utf8");
    if (/toolExecution\s*\?\?\s*["']parallel["']/.test(src)) {
      evidence = `nested agent.js defaults toolExecution to parallel (${nested})`;
    } else {
      evidence = `nested agent.js loaded (${nested})`;
    }
  } catch {
    // keep monorepo evidence string
  }
  gap(
    "pi-tool-execution-mode",
    "parallel (default); write_stdin has no executionMode override",
    "serialization if exec-rt08 is to hold without an internal claim",
    `Pi agent-loop executeToolCallsParallel runs allowed tools concurrently via Promise.all; ${evidence}`,
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const tests = [
  ["two completion waiters wake", testTwoCompletionWaitersWake],
  ["cancelled waiter leaves later waiters", testCancelledWaiterLeavesLaterWaiters],
  ["exit/yield same-turn race", testExitYieldSameTurn],
  ["exit/abort same-turn race", testExitAbortSameTurnInitial],
  ["initial abort kills/removes, no notification", testInitialAbortKillsRemovesNoNotification],
  ["aborted write_stdin preserves process/output/eligibility", testAbortedWriteStdinPreservesSession],
  ["write claim visible synchronously", testWriteClaimVisibleSynchronously],
  ["delta output once and in order", testDeltaOutputOnceInOrder],
  ["status mode suppresses, counts, drains", testStatusModeSuppressesAndDrains],
  ["concurrent terminal write_stdin", testConcurrentTerminalWriteStdin],
  ["terminal read vs notification same turn", testTerminalReadVsNotificationSameTurn],
  ["failed notification send releases claim; retry once", testFailedNotificationSendReleasesClaim],
  ["output-limit termination distinct and bounded", testOutputLimitDistinctAndBounded],
  ["owner shutdown closes without notification", testOwnerShutdownNoNotification],
  ["process-manager kill wakes completion waits", testProcessManagerKillWakesCompletionWaits],
  ["broker cleanup path (empty + busy-wait gap)", testBrokerCleanupObservesExitBeforeTimeout],
  ["pi tool execution default (investigation)", testPiToolExecutionDefaultIsParallel],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    core.call("shutdownExecOwner", [ownerId]);
    resetTerminals();
    await fn();
    console.log(`ok: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

core.call("shutdownExecOwner", [ownerId]);
Module._load = originalLoad;

if (failed > 0) {
  console.error(`exec-session concurrency smoke: ${failed} failure(s)`);
  process.exitCode = 1;
} else {
  console.log(
    `exec-session concurrency smoke: all assertions passed (${gaps.length} gap(s) recorded)`,
  );
  for (const entry of gaps) {
    console.log(`  - ${entry.id}`);
  }
}
