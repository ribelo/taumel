import { strict as assert } from "node:assert";

import { installCompactionModelHookWithCompact } from "../src/compaction-model.ts";

function makeHarness(corePlan, registry, compactRunner, branchSummaryRunner = async () => {
  throw new Error("branch summary should not run");
}) {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    events: { on: () => () => undefined, emit: () => undefined },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    modelRegistry: registry,
  };
  const core = {
    init: () => undefined,
    call(name) {
      assert.equal(name, "planSessionBeforeCompact");
      return corePlan;
    },
  };
  installCompactionModelHookWithCompact(pi, core, compactRunner, branchSummaryRunner);
  return handlers;
}

function makeContext(registry, notifications = []) {
  return {
    modelRegistry: registry,
    thinkingLevel: "medium",
    sessionManager: {
      getSessionId() {
        return "session-1";
      },
    },
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  };
}

const model = {
  provider: "openrouter",
  id: "deepseek/deepseek-v4-pro",
};
const preparation = { kind: "prepared" };
const signal = new AbortController().signal;
const event = {
  type: "session_before_compact",
  preparation,
  customInstructions: "focus",
  signal,
};

{
  const compactCalls = [];
  const registry = {
    find(provider, modelId) {
      assert.equal(provider, "openrouter");
      assert.equal(modelId, "deepseek/deepseek-v4-pro");
      return model;
    },
    async getApiKeyAndHeaders(requestedModel) {
      assert.equal(requestedModel, model);
      await Promise.resolve();
      return {
        ok: true,
        apiKey: "openrouter-key",
        headers: { Authorization: "Bearer openrouter-key" },
        env: { OPENROUTER_API_KEY: "openrouter-key" },
      };
    },
  };
  const handler = makeHarness(
    { kind: "compact", model: "openrouter/deepseek/deepseek-v4-pro" },
    registry,
    async (...args) => {
      compactCalls.push(args);
      return {
        summary: "summary",
        firstKeptEntryId: "entry-1",
        tokensBefore: 123,
        details: { ok: true },
      };
    },
  ).get("session_before_compact");
  const notifications = [];
  const result = await handler(event, makeContext(registry, notifications));

  assert.deepEqual(result, {
    compaction: {
      summary: "summary",
      firstKeptEntryId: "entry-1",
      tokensBefore: 123,
      details: { ok: true },
    },
  });
  assert.equal(compactCalls.length, 1, "configured compaction should call compact once");
  assert.equal(compactCalls[0][0], preparation);
  assert.equal(compactCalls[0][1], model);
  assert.equal(compactCalls[0][2], "openrouter-key");
  assert.deepEqual(compactCalls[0][3], { Authorization: "Bearer openrouter-key" });
  assert.equal(compactCalls[0][4], "focus");
  assert.equal(compactCalls[0][5], signal);
  assert.equal(compactCalls[0][6], "medium");
  assert.equal(compactCalls[0][7], undefined);
  assert.deepEqual(compactCalls[0][8], { OPENROUTER_API_KEY: "openrouter-key" });
  assert.deepEqual(notifications, []);
}

{
  const notifications = [];
  const registry = {
    find() {
      return model;
    },
    async getApiKeyAndHeaders() {
      return { ok: false, error: "missing token" };
    },
  };
  const handler = makeHarness(
    { kind: "compact", model: "openrouter/deepseek/deepseek-v4-pro" },
    registry,
    async () => {
      throw new Error("compact should not run without auth");
    },
  ).get("session_before_compact");
  const result = await handler(event, makeContext(registry, notifications));

  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(notifications, [{
    message: "Taumel compaction model lacks auth: openrouter/deepseek/deepseek-v4-pro: missing token",
    type: "warning",
  }]);
}

{
  const notifications = [];
  const registry = {
    find() {
      throw new Error("find should not run for invalid model ids");
    },
    async getApiKeyAndHeaders() {
      throw new Error("auth should not run for invalid model ids");
    },
  };
  const handler = makeHarness(
    { kind: "compact", model: "not-a-model-id" },
    registry,
    async () => {
      throw new Error("compact should not run for invalid model ids");
    },
  ).get("session_before_compact");
  const result = await handler(event, makeContext(registry, notifications));

  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(notifications, [{
    message: "Taumel compaction model is invalid: not-a-model-id",
    type: "warning",
  }]);
}

{
  const notifications = [];
  const registry = {
    find() {
      return model;
    },
    async getApiKeyAndHeaders() {
      return { ok: true, apiKey: "key" };
    },
  };
  const handler = makeHarness(
    { kind: "compact", model: "openrouter/deepseek/deepseek-v4-pro" },
    registry,
    async () => {
      throw new Error("provider failed");
    },
  ).get("session_before_compact");
  const result = await handler(event, makeContext(registry, notifications));

  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(notifications, [{
    message: "Taumel compaction failed: provider failed",
    type: "warning",
  }]);
}

{
  const branchCalls = [];
  const registry = {
    find(provider, modelId) {
      assert.equal(provider, "openrouter");
      assert.equal(modelId, "deepseek/deepseek-v4-pro");
      return model;
    },
    async getApiKeyAndHeaders(requestedModel) {
      assert.equal(requestedModel, model);
      return {
        ok: true,
        apiKey: "openrouter-key",
        headers: { Authorization: "Bearer openrouter-key" },
        env: { OPENROUTER_API_KEY: "openrouter-key" },
      };
    },
  };
  const handlers = makeHarness(
    { kind: "compact", model: "openrouter/deepseek/deepseek-v4-pro" },
    registry,
    async () => {
      throw new Error("compact should not run for branch summaries");
    },
    async (...args) => {
      branchCalls.push(args);
      return {
        summary: "branch summary",
        readFiles: ["/tmp/read.txt"],
        modifiedFiles: ["/tmp/write.txt"],
      };
    },
  );
  const treeHandler = handlers.get("session_before_tree");
  const entriesToSummarize = [{ type: "message", id: "entry-1" }];
  const result = await treeHandler({
    type: "session_before_tree",
    preparation: {
      userWantsSummary: true,
      entriesToSummarize,
      customInstructions: "focus branch",
      replaceInstructions: true,
    },
    signal,
  }, makeContext(registry));

  assert.deepEqual(result, {
    summary: {
      summary: "branch summary",
      details: {
        readFiles: ["/tmp/read.txt"],
        modifiedFiles: ["/tmp/write.txt"],
      },
    },
  });
  assert.equal(branchCalls.length, 1, "configured branch summary should call generateBranchSummary once");
  assert.equal(branchCalls[0][0], entriesToSummarize);
  assert.equal(branchCalls[0][1].model, model);
  assert.equal(branchCalls[0][1].apiKey, "openrouter-key");
  assert.deepEqual(branchCalls[0][1].headers, { Authorization: "Bearer openrouter-key" });
  assert.deepEqual(branchCalls[0][1].env, { OPENROUTER_API_KEY: "openrouter-key" });
  assert.equal(branchCalls[0][1].signal, signal);
  assert.equal(branchCalls[0][1].customInstructions, "focus branch");
  assert.equal(branchCalls[0][1].replaceInstructions, true);
}

{
  const notifications = [];
  const registry = {
    find() {
      return model;
    },
    async getApiKeyAndHeaders() {
      return { ok: true, apiKey: "key" };
    },
  };
  const treeHandler = makeHarness(
    { kind: "compact", model: "openrouter/deepseek/deepseek-v4-pro" },
    registry,
    async () => {
      throw new Error("compact should not run for branch summaries");
    },
    async () => ({ error: "summary provider failed" }),
  ).get("session_before_tree");
  const result = await treeHandler({
    type: "session_before_tree",
    preparation: {
      userWantsSummary: true,
      entriesToSummarize: [{ type: "message", id: "entry-1" }],
    },
    signal,
  }, makeContext(registry, notifications));

  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(notifications, [{
    message: "Taumel branch summary failed: summary provider failed",
    type: "warning",
  }]);
}

// ────────────────────────────────────────────────────────────────────────────
// executeCompactionModelCommand tests
// ────────────────────────────────────────────────────────────────────────────

import { executeCompactionModelCommand } from "../src/compaction-model.ts";

function makeCommandHarness(plans) {
  let planIndex = 0;
  const core = {
    init: () => undefined,
    call(name) {
      assert.equal(name, "planCompactionModelCommand");
      const plan = plans[planIndex];
      if (plan === undefined) throw new Error("unexpected plan call");
      planIndex += 1;
      return plan;
    },
  };
  const pi = {
    on: () => undefined,
    events: { on: () => () => undefined, emit: () => undefined },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  };
  const notifications = [];
  const ctx = {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "compaction-model-test",
      getSessionFile: () => "/tmp/compaction-model-test.jsonl",
    },
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  };
  return { pi, core, ctx, notifications, planIndex: () => planIndex };
}

// Show current model (no configured model -> inherit).
{
  const { pi, core, ctx } = makeCommandHarness([
    { kind: "show", model: "", source: "inherit" },
  ]);
  const result = await executeCompactionModelCommand(pi, core, "", ctx);
  assert.equal(result.ok, true, "show current should succeed");
  assert.equal(result.message, "Compaction model: inherit", "show with no model should say inherit");
}

// Show current model (configured).
{
  const { pi, core, ctx } = makeCommandHarness([
    { kind: "show", model: "openai/gpt-4o", source: "global" },
  ]);
  const result = await executeCompactionModelCommand(pi, core, "", ctx);
  assert.equal(result.ok, true, "show configured should succeed");
  assert.equal(result.message, "Compaction model: openai/gpt-4o (global)", "show should include source");
}

// Set model (set_project action).
{
  const { pi, core, ctx, notifications } = makeCommandHarness([
    { kind: "set_project", model: "anthropic/claude-3-5-sonnet" },
  ]);
  const result = await executeCompactionModelCommand(pi, core, "anthropic/claude-3-5-sonnet", ctx);
  assert.equal(result.ok, true, "set model should succeed");
  assert.match(result.message, /anthropic\/claude-3-5-sonnet/, "set should echo the model");
}

// Clear model.
{
  const { pi, core, ctx } = makeCommandHarness([
    { kind: "clear_project" },
  ]);
  const result = await executeCompactionModelCommand(pi, core, "clear", ctx);
  assert.equal(result.ok, true, "clear should succeed");
  assert.match(result.message, /cleared/i, "clear should mention cleared");
}

// Open picker falls back when no custom function available.
{
  const notifications = [];
  const ctx = {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "no-ui-test",
      getSessionFile: () => "/tmp/no-ui-test.jsonl",
    },
    ui: { notify: (m, t) => notifications.push({ message: m, type: t }) },
  };
  const pi = {
    on: () => undefined,
    events: { on: () => () => undefined, emit: () => undefined },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  };
  const core = {
    init: () => undefined,
    call(name) {
      assert.equal(name, "planCompactionModelCommand");
      return { kind: "open_picker", current: "" };
    },
  };
  const result = await executeCompactionModelCommand(pi, core, "", ctx);
  // No ui.custom function -> falls back gracefully
  assert.equal(result.ok, false, "picker unavailable should return ok=false");
  assert.equal(result.error, "Picker is not available.", "picker should explain not available");
}

console.log("compaction model smoke: all assertions passed");
