import assert from "node:assert/strict";
import { parseToolParams, toolContractByName, toolNames } from "../src/tool-contract-catalog.ts";

for (const name of [
  "agent_spawn",
  "agent_send",
  "agent_wait",
  "agent_list",
  "agent_close",
  "finder",
  "oracle",
  "code_reviewer",
  "code_quality_reviewer",
]) {
  assert.ok(toolNames.includes(name), `missing tool contract: ${name}`);
  assert.equal(typeof toolContractByName(name).parseParams, "function", `${name} must carry its parameter parser`);
}

const executionByTool = {
  agent_spawn: ["agent_start", true, false, true, false],
  finder: ["agent_start", true, false, true, false],
  oracle: ["agent_start", true, false, true, false],
  code_reviewer: ["agent_start", true, false, true, false],
  code_quality_reviewer: ["agent_start", true, false, true, false],
  agent_send: ["agent_send", false, false, true, false],
  agent_wait: ["agent_wait", false, true, false, false],
  agent_list: ["agent_wait", false, true, false, true],
  agent_close: ["agent_close", false, false, false, false],
};
for (const [name, expected] of Object.entries(executionByTool)) {
  const execution = toolContractByName(name).execution;
  assert.ok(execution, `${name} must carry its agent execution descriptor`);
  assert.deepEqual([
    execution.preparedAction,
    execution.parentActiveTools,
    execution.allowInvalidChildMetadata,
    execution.rememberDescription,
    execution.reconcileLiveDispatches,
  ], expected, `${name} execution descriptor`);
}
assert.deepEqual(toolContractByName("code_reviewer").execution.additionalInstruction, {
  text: "Your rubric: $code-review. Follow it exactly.",
  requiredSkill: "code-review",
  unavailable: {
    code: "rubric_unavailable",
    message: "reviewer rubric skill is unavailable: code-review",
  },
});
assert.deepEqual(toolContractByName("code_quality_reviewer").execution.additionalInstruction, {
  text: "Your rubric: $code-quality-review. Follow it exactly.",
  requiredSkill: "code-quality-review",
  unavailable: {
    code: "rubric_unavailable",
    message: "reviewer rubric skill is unavailable: code-quality-review",
  },
});
assert.equal(toolContractByName("oracle").execution.additionalInstruction, undefined);
assert.equal(toolContractByName("read").execution, undefined);

// agent-tc01: start calls require a parent-facing description.
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "Investigate agent work" }).ok, true);
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "Investigate agent work", tier: "high" }).ok, true);
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "Investigate agent work", isolation: "worktree" }).ok, true);
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "Investigate agent work", isolation: "none" }).ok, true);
assert.equal(parseToolParams("agent_spawn", { message: "investigate" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "x", tier: "extreme" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "x", effort: "high" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "x", profile: "finder" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "x", isolation: "tmp" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "   " }).ok, false);

assert.equal(parseToolParams("finder", { query: "find auth", description: "Locate authentication code" }).ok, true);
assert.equal(parseToolParams("finder", { query: "find auth", description: "Locate authentication code", isolation: "worktree" }).ok, true);
assert.equal(parseToolParams("oracle", { message: "review architecture", description: "Review system architecture" }).ok, true);
assert.equal(parseToolParams("oracle", { message: "review architecture", description: "Review system architecture", isolation: "none" }).ok, true);
for (const name of ["code_reviewer", "code_quality_reviewer"]) {
  assert.equal(parseToolParams(name, { message: "review HEAD~1..HEAD", description: "Review latest changes" }).ok, true);
  assert.equal(parseToolParams(name, { message: "review HEAD~1..HEAD", description: "Review latest changes", isolation: "worktree" }).ok, true);
  assert.equal(parseToolParams(name, { message: "   ", description: "Review latest changes" }).ok, false);
  assert.equal(parseToolParams(name, { message: "review", description: "Review latest changes", tier: "high" }).ok, false);
}
assert.equal(parseToolParams("finder", { query: "x", tier: "low" }).ok, false);

assert.equal(parseToolParams("agent_send", { agent_id: "a1", message: "continue", description: "Continue agent work" }).ok, true);
assert.equal(parseToolParams("agent_send", { agent_id: "a1", message: "continue" }).ok, false);
assert.equal(parseToolParams("agent_send", { agent_id: "a1", interrupt: true }).ok, true);
assert.equal(parseToolParams("agent_send", { agent_id: "a1" }).ok, false);
assert.equal(parseToolParams("agent_send", { agent_id: "a1", message: "" }).ok, false);

assert.equal(parseToolParams("agent_wait", { run_ids: ["r1"] }).ok, true);
assert.equal(parseToolParams("agent_wait", { run_ids: [] }).ok, false);
assert.equal(parseToolParams("agent_wait", { agent_ids: ["a1"] }).ok, false);
assert.equal(parseToolParams("agent_wait", { run_ids: ["r1", "r1"] }).ok, false);

assert.equal(parseToolParams("agent_list", {}).ok, true);
assert.equal(parseToolParams("agent_list", { include_closed: true }).ok, false);

assert.equal(parseToolParams("agent_close", { agent_id: "a1" }).ok, true);
assert.equal(parseToolParams("agent_close", { agent_id: "a1", delete_worktree: true }).ok, true);
assert.equal(parseToolParams("agent_close", { agent_ids: ["a1"] }).ok, false);
assert.equal(parseToolParams("agent_close", { all: true }).ok, false);

console.log("agent contract smoke: all assertions passed");
