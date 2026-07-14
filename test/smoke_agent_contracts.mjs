import assert from "node:assert/strict";
import { parseToolParams, toolNames } from "../src/tool-contracts.ts";

for (const name of [
  "agent_spawn",
  "agent_send",
  "agent_wait",
  "agent_list",
  "agent_close",
  "finder",
  "oracle",
]) {
  assert.ok(toolNames.includes(name), `missing tool contract: ${name}`);
}

// agent-tc01: start calls require a parent-facing description.
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "Investigate agent work" }).ok, true);
assert.equal(parseToolParams("agent_spawn", { message: "investigate", description: "Investigate agent work", effort: "high" }).ok, true);
assert.equal(parseToolParams("agent_spawn", { message: "investigate" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "x", effort: "extreme" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "x", profile: "finder" }).ok, false);
assert.equal(parseToolParams("agent_spawn", { message: "   " }).ok, false);

assert.equal(parseToolParams("finder", { query: "find auth", description: "Locate authentication code" }).ok, true);
assert.equal(parseToolParams("oracle", { message: "review architecture", description: "Review system architecture" }).ok, true);
assert.equal(parseToolParams("finder", { query: "x", effort: "low" }).ok, false);

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
assert.equal(parseToolParams("agent_close", { agent_ids: ["a1"] }).ok, false);
assert.equal(parseToolParams("agent_close", { all: true }).ok, false);

console.log("agent contract smoke: all assertions passed");
