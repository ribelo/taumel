import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { executeAgentPrepared, installAgentLifecycle } from "../src/agent-orchestration.ts";

const root = mkdtempSync(join(tmpdir(), "taumel-agent-child-cleanup-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent-home");

try {
  const require = createRequire(import.meta.url);
  require("../dist/taumel.cjs");
  const core = globalThis.taumel.init({
    resolveAuthorizationPath: realpathSync,
    on: () => undefined,
    eventsOn: () => () => undefined,
    emit: () => undefined,
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    setFooter: () => undefined,
    sessionSnapshot: () => ({
      cwd: process.cwd(), provider: "test", model: "model", thinking: "medium",
      totalCost: 0, contextPercent: 0, contextWindow: 1000,
    }),
    getGitBranch: () => "main",
    onBranchChange: () => () => undefined,
    requestRender: () => undefined,
    themeFg: (_theme, _color, value) => value,
  });
  const entries = [];
  const ctx = {
    cwd: process.cwd(),
    activeTools: ["read", "agent_spawn", "agent_send", "agent_close"],
    model: { provider: "test", id: "model" },
    sessionManager: {
      getSessionId: () => "cleanup-parent",
      getSessionFile: () => join(root, "parent.jsonl"),
      getEntries: () => entries,
      appendCustomEntry: (customType, data) => {
        entries.push({ type: "custom", customType, data });
      },
    },
  };

  function spawn(description, claim = true) {
    const started = core.call("prepareTool", [{
      name: "agent_spawn",
      params: { message: "test cleanup", description },
      ctx,
    }]);
    assert.equal(started.action, "agent_start");
    if (claim) {
      const capabilityFacts = {
        capabilityId: started.capabilityId, agentId: started.agentId,
        action: started.action, runId: started.runId,
        submissionId: started.submissionId, ctx,
      };
      assert.equal(core.call("claimAgentAction", [capabilityFacts]).ok, true);
      assert.equal(core.call("releaseAgentAction", [capabilityFacts]).ok, true);
    }
    return started;
  }

  function privateDirectory(started, parentSessionFile = join(root, "parent.jsonl")) {
    const plan = core.call("planChildSessionStart", [{
      metadata: started.metadata,
      parentSessionId: "cleanup-parent",
      parentSessionFile,
    }, ctx]);
    assert.equal(typeof plan.privateSessionDirectory, "string");
    return plan.privateSessionDirectory;
  }

  function recordChildSession(agentId, sessionId, sessionFile) {
    const send = core.call("prepareTool", [{
      name: "agent_send",
      params: { agent_id: agentId, message: "bind cleanup child", description: "Bind cleanup child" },
      ctx,
    }]);
    const capabilityFacts = {
      capabilityId: send.capabilityId, agentId, action: send.action,
      runId: send.runId, submissionId: send.submissionId, ctx,
    };
    assert.equal(core.call("claimAgentAction", [capabilityFacts]).ok, true);
    const result = core.call("recordAgentChildSessionStartAuthorized", [{
      agent_id: agentId, sessionId, sessionFile,
    }, capabilityFacts, ctx]);
    assert.equal(core.call("releaseAgentAction", [capabilityFacts]).ok, true);
    return result;
  }

  function writeChildMarker(directory, agentId, markerAgentId = agentId) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "session.jsonl"), `${JSON.stringify({
      type: "custom",
      customType: "taumel.childSession",
      data: { agentId: markerAgentId, parentSessionId: "cleanup-parent" },
    })}\n`);
    const sentinel = join(directory, "sentinel.txt");
    writeFileSync(sentinel, "private child artifact\n");
    return sentinel;
  }

  async function closeAgent(agentId, childSessions = new Map()) {
    const close = core.call("prepareTool", [{
      name: "agent_close", params: { agent_id: agentId }, ctx,
    }]);
    assert.equal(close.action, "agent_close");
    assert.equal(Object.hasOwn(close, "childSessionFile"), false);
    return executeAgentPrepared({}, core, childSessions, new Map(), close, ctx);
  }

  const started = spawn("Reject persisted deletion target");

  const victimDirectory = join(root, "victim", started.agentId);
  const victimSessionFile = join(victimDirectory, "session.jsonl");
  const victimSentinel = join(victimDirectory, "must-survive.txt");
  mkdirSync(victimDirectory, { recursive: true });
  writeFileSync(victimSessionFile, `${JSON.stringify({
    type: "custom",
    customType: "taumel.childSession",
    data: { agentId: started.agentId, parentSessionId: "cleanup-parent" },
  })}\n`);
  writeFileSync(victimSentinel, "persisted state must not authorize deletion\n");

  assert.equal(recordChildSession(
    started.agentId, "forged-child", victimSessionFile,
  ).ok, true);
  core.call("reloadSessionState", [ctx]);

  await closeAgent(started.agentId);

  assert.equal(
    existsSync(victimSentinel),
    true,
    "a persisted child_session_file selected an arbitrary recursive deletion target",
  );

  const mismatched = spawn("Reject mismatched marker");
  const mismatchedDirectory = privateDirectory(mismatched);
  const mismatchedSentinel = writeChildMarker(
    mismatchedDirectory,
    mismatched.agentId,
    "agent-wrong",
  );
  appendFileSync(join(mismatchedDirectory, "session.jsonl"), `${JSON.stringify({
    type: "custom",
    customType: "taumel.childSession",
    data: { agentId: mismatched.agentId, parentSessionId: "cleanup-parent" },
  })}\n`);
  let stoppedForFailedClose = false;
  const mismatchedChildren = new Map([[
    `cleanup-parent\0${mismatched.agentId}`,
    {
      stop: async () => {
        stoppedForFailedClose = true;
      },
      close: async () => undefined,
    },
  ]]);
  const mismatchedClose = await closeAgent(mismatched.agentId, mismatchedChildren);
  assert.equal(stoppedForFailedClose, true, "failed close did not exercise interruption");
  assert.equal(existsSync(mismatchedSentinel), true, "marker mismatch did not fail closed");
  assert.match(mismatchedClose.content[0].text, /identity marker is missing or mismatched/);
  const failedCloseSnapshot = core.call("agentManagerSnapshot", [ctx]);
  const failedCloseRun = failedCloseSnapshot.runs.find(
    (run) => run.agentId === mismatched.agentId,
  );
  assert.equal(failedCloseRun?.status, "suspended");
  assert.equal(failedCloseRun?.reasonCode, "close_cleanup_failed");
  assert.equal(
    existsSync(join(mismatchedDirectory, "session.jsonl")),
    true,
    "failed close deleted the exact child session before durable state transition",
  );
  rmSync(mismatchedDirectory, { recursive: true, force: true });
  await closeAgent(mismatched.agentId);

  // agent-cl04/agent-70b4/agent-ps19: after permanent identity removal, a finalize
  // failure must leave cleanup retryable without restoring a usable identity.
  const tombstone = spawn("Retry cleanup after durable close and finalize failure");
  const tombstoneDirectory = privateDirectory(tombstone);
  const tombstoneSentinel = writeChildMarker(tombstoneDirectory, tombstone.agentId);
  let stoppedForTombstone = false;
  const tombstoneChildren = new Map([[
    `cleanup-parent\0${tombstone.agentId}`,
    {
      stop: async () => {
        stoppedForTombstone = true;
      },
      close: async () => undefined,
    },
  ]]);
  // Make recursive private-session deletion fail after durable identity removal by
  // turning the live session into a non-empty directory whose contents cannot be
  // unlinked (read-only nested file). The derived envelope/payload must remain
  // retryable under a cleanup tombstone rather than restoring a usable identity.
  const nestedBlocked = join(tombstoneDirectory, "blocked");
  mkdirSync(nestedBlocked, { recursive: true });
  const blockedFile = join(nestedBlocked, "locked.txt");
  writeFileSync(blockedFile, "cannot unlink while parent is restricted\n");
  chmodSync(blockedFile, 0o444);
  chmodSync(nestedBlocked, 0o555);
  const firstClose = await closeAgent(tombstone.agentId, tombstoneChildren);
  assert.equal(stoppedForTombstone, true);
  assert.match(
    firstClose.content[0].text,
    /cleanup_failed/,
    "finalize failure after durable close must fail closed",
  );
  const afterFirst = core.call("agentManagerSnapshot", [ctx]);
  assert.equal(
    afterFirst.agents.some((agent) => agent.agentId === tombstone.agentId),
    false,
    "usable identity must not remain listed after durable permanent close",
  );
  const envelopeDir = join(dirname(tombstoneDirectory), `.cleanup-${tombstone.agentId}`);
  const envelopePayload = join(envelopeDir, "session");
  const envelopePayloadSentinel = join(envelopePayload, "sentinel.txt");
  assert.equal(
    existsSync(envelopePayloadSentinel),
    true,
    "private session payload must remain for tombstone-backed cleanup retry",
  );
  // Restore permissions on the staged payload before retry.
  const restoreTree = (path) => {
    try {
      const st = statSync(path);
      chmodSync(path, st.isDirectory() ? 0o755 : 0o644);
      if (st.isDirectory()) {
        for (const name of readdirSync(path)) restoreTree(join(path, name));
      }
    } catch {
      /* ignore */
    }
  };
  restoreTree(envelopePayload);
  // Retry must complete cleanup without restoring a listable identity mid-flight.
  const retryClose = await closeAgent(tombstone.agentId);
  const retryPayload = JSON.parse(retryClose.content[0].text);
  assert.equal(
    retryPayload.ok === false,
    false,
    `retry close must succeed once artifacts are deletable: ${retryClose.content[0].text}`,
  );
  assert.equal(
    core.call("agentManagerSnapshot", [ctx]).agents.some(
      (agent) => agent.agentId === tombstone.agentId,
    ),
    false,
  );
  assert.equal(existsSync(tombstoneDirectory), false);
  assert.equal(
    existsSync(join(dirname(tombstoneDirectory), `.cleanup-${tombstone.agentId}`)),
    false,
    "cleanup envelope must be absent after successful retry",
  );

  const valid = spawn("Delete derived marked target");
  const validDirectory = privateDirectory(valid);
  writeChildMarker(validDirectory, valid.agentId);
  await closeAgent(valid.agentId);
  assert.equal(existsSync(validDirectory), false, "derived marked child directory was retained");

  const escaped = spawn("Reject canonical escape");
  const escapedDirectory = privateDirectory(escaped);
  const ownerDirectory = dirname(escapedDirectory);
  const outsideOwnerDirectory = join(root, "outside-owner");
  rmSync(ownerDirectory, { recursive: true, force: true });
  mkdirSync(join(outsideOwnerDirectory, escaped.agentId), { recursive: true });
  symlinkSync(outsideOwnerDirectory, ownerDirectory, "dir");
  const escapedSentinel = writeChildMarker(
    join(outsideOwnerDirectory, escaped.agentId),
    escaped.agentId,
  );
  const escapedClose = await closeAgent(escaped.agentId);
  assert.equal(existsSync(escapedSentinel), true, "canonical escape target was deleted");
  assert.match(escapedClose.content[0].text, /escapes its derived owner directory/);
  unlinkSync(ownerDirectory);
  rmSync(outsideOwnerDirectory, { recursive: true, force: true });
  await closeAgent(escaped.agentId);

  const failedStart = spawn("Retain failed-start cleanup authority", false);
  const failedStartDirectory = privateDirectory(failedStart);
  const failedStartResult = await executeAgentPrepared(
    {
      modelRegistry: {
        find: () => ({ provider: "test", id: "model", reasoning: true }),
        hasConfiguredAuth: () => true,
      },
      getAllTools: () => failedStart.metadata.activeTools,
      createAgentSession: async (options) => {
        const sessionFile = options.sessionManager.getSessionFile();
        mkdirSync(dirname(sessionFile), { recursive: true });
        writeChildMarker(dirname(sessionFile), failedStart.agentId, "agent-wrong");
        throw new Error("forced child creation failure");
      },
    },
    core,
    new Map(),
    new Map(),
    failedStart,
    ctx,
  );
  assert.match(failedStartResult.content[0].text, /"code":"cleanup_failed"/);
  assert.equal(existsSync(failedStartDirectory), true);
  assert.equal(
    core.call("prepareTool", [{ name: "agent_list", params: {}, ctx }]).details.agents
      .some((agent) => agent.agent_id === failedStart.agentId),
    true,
    "failed creation cleanup discarded the only authenticated retry identity",
  );
  rmSync(failedStartDirectory, { recursive: true, force: true });
  await closeAgent(failedStart.agentId);

  const ephemeral = spawn("Reject shutdown deletion target");
  const journalFailure = spawn("Finalize ephemeral cleanup after journal failure");
  const journalFailureDirectory = privateDirectory(journalFailure, "");
  assert.equal(
    existsSync(join(
      dirname(journalFailureDirectory),
      `.cleanup-${journalFailure.agentId}`,
      "cleanup-marker.json",
    )),
    true,
    "ephemeral child planning did not durably register deferred cleanup",
  );
  const journalFailureSentinel = writeChildMarker(
    journalFailureDirectory,
    journalFailure.agentId,
  );
  const deferredFailure = spawn("Recover deferred ephemeral cleanup");
  const deferredFailureDirectory = privateDirectory(deferredFailure, "");
  writeChildMarker(deferredFailureDirectory, deferredFailure.agentId);
  const deferredFailureEnvelope = join(
    dirname(deferredFailureDirectory),
    `.cleanup-${deferredFailure.agentId}`,
  );
  const deferredFailurePayload = join(deferredFailureEnvelope, "session");
  assert.equal(core.call("reconcileProvisionalAgentWorktrees", []).ok, true);
  assert.equal(
    existsSync(journalFailureSentinel),
    true,
    "reconciler reused its own lifetime lease before identity removal",
  );
  assert.equal(
    existsSync(deferredFailureDirectory),
    true,
    "reconciler deleted a registered live child while its owner lease was held",
  );
  const shutdownVictimDirectory = join(root, "shutdown-victim", ephemeral.agentId);
  const shutdownVictimFile = join(shutdownVictimDirectory, "session.jsonl");
  const shutdownVictimSentinel = writeChildMarker(
    shutdownVictimDirectory,
    ephemeral.agentId,
  );
  assert.equal(recordChildSession(
    ephemeral.agentId, "forged-shutdown-child", shutdownVictimFile,
  ).ok, true);
  const lifecycleHandlers = new Map();
  installAgentLifecycle(
    {
      on: (event, handler) => {
        lifecycleHandlers.set(event, [...(lifecycleHandlers.get(event) ?? []), handler]);
      },
    },
    core,
    new Map(),
    new Map(),
  );
  const ephemeralCtx = {
    ...ctx,
    sessionManager: {
      getSessionId: () => "cleanup-parent",
      getEntries: () => entries,
      appendCustomEntry: ctx.sessionManager.appendCustomEntry,
    },
  };
  const fsModule = require("node:fs");
  const originalAppendFileSync = fsModule.appendFileSync;
  const originalRmSync = fsModule.rmSync;
  fsModule.appendFileSync = (path, ...args) => {
    if (String(path).endsWith("cleanup-journal.jsonl")) {
      throw new Error("forced cleanup journal append failure");
    }
    return originalAppendFileSync(path, ...args);
  };
  fsModule.rmSync = (path, ...args) => {
    if (String(path) === deferredFailurePayload) {
      throw new Error("forced deferred cleanup finalization failure");
    }
    return originalRmSync(path, ...args);
  };
  try {
    for (const handler of lifecycleHandlers.get("session_shutdown") ?? []) {
      await handler({ type: "session_shutdown" }, ephemeralCtx);
    }
  } finally {
    fsModule.appendFileSync = originalAppendFileSync;
    fsModule.rmSync = originalRmSync;
  }
  assert.equal(
    existsSync(shutdownVictimSentinel),
    true,
    "ephemeral shutdown used persisted path data as deletion authority",
  );
  assert.equal(
    existsSync(journalFailureSentinel),
    false,
    "journal publication failure stranded an ephemeral cleanup envelope",
  );
  assert.equal(
    existsSync(deferredFailureEnvelope),
    true,
    "dual cleanup failure did not retain its deferred durable marker",
  );
  const deferredFailureLease = join(
    dirname(deferredFailureDirectory),
    ".ephemeral-cleanup.lease.json",
  );
  writeFileSync(deferredFailureLease, JSON.stringify({
    owner_session_id: "cleanup-parent",
    nonce: "live-test-lease",
    pid: process.pid,
    process_start: "",
  }));
  assert.equal(core.call("reconcileProvisionalAgentWorktrees", []).ok, true);
  assert.equal(
    existsSync(deferredFailureEnvelope),
    true,
    "reconciler acted while the ephemeral owner lease was live",
  );
  unlinkSync(deferredFailureLease);
  assert.equal(core.call("reconcileProvisionalAgentWorktrees", []).ok, true);
  assert.equal(
    existsSync(deferredFailureEnvelope),
    false,
    "deferred ephemeral cleanup was not reconciled after lease release",
  );
} finally {
  // Best-effort recursive permission restore for intentional permission traps.
  const restore = (path) => {
    try {
      const st = statSync(path);
      chmodSync(path, st.isDirectory() ? 0o755 : 0o644);
      if (st.isDirectory()) {
        for (const name of readdirSync(path)) restore(join(path, name));
      }
    } catch {
      /* ignore */
    }
  };
  restore(root);
  rmSync(root, { recursive: true, force: true });
}

console.log("agent child-session cleanup smoke: all assertions passed");
