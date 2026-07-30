import { readFileSync } from "node:fs";
import { parseToolParams } from "../src/tool-contracts.ts";
import { toolContracts } from "../src/tool-contract-catalog.ts";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const forbiddenSchemaKeys = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
  "const",
]);

function collectForbiddenKeys(value, path, found) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, found));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenSchemaKeys.has(key)) found.push(`${path}.${key}`);
    collectForbiddenKeys(item, `${path}.${key}`, found);
  }
}

assert(toolContracts.length > 0, "expected registered Taumel tool contracts");

for (const tool of toolContracts) {
  const forbidden = [];
  collectForbiddenKeys(tool.parameters, `${tool.name}.parameters`, forbidden);
  assert(
    forbidden.length === 0,
    `provider-facing tool schema includes unsupported schema metadata:\n${forbidden.join("\n")}`,
  );
}

assert(parseToolParams("exec_command", { cmd: "printf ok" }).ok, "exec_command should accept a non-empty command");
assert(parseToolParams("exec_command", { cmd: "printf ok", max_output_tokens: 10000, with_escalated_permissions: true, justification: "Needs host access." }).ok, "exec_command should accept Codex-compatible options");
assert(!parseToolParams("exec_command", { cmd: "" }).ok, "exec_command should reject an empty command");
assert(!parseToolParams("exec_command", { cmd: " \t\n" }).ok, "exec_command should reject a whitespace-only command");
for (const removed of ["tty", "sandbox_permissions", "prefix_rule", "shell", "login"]) {
  assert(!parseToolParams("exec_command", { cmd: "printf ok", [removed]: removed === "tty" ? true : "x" }).ok, `exec_command should reject removed parameter ${removed}`);
}
assert(parseToolParams("write_stdin", { session_id: 1, max_output_tokens: 10000 }).ok, "write_stdin should accept max_output_tokens");

const expectOk = (name, params) => {
  const parsed = parseToolParams(name, params);
  assert(parsed.ok === true, `${name} should parse: ${JSON.stringify(parsed)}`);
};
const expectError = (name, params, text) => {
  const parsed = parseToolParams(name, params);
  assert(parsed.ok === false, `${name} should reject: ${JSON.stringify(params)}`);
  assert(parsed.error.includes(text), `${name} error did not include ${text}: ${parsed.error}`);
};

const patch = "*** Begin Patch\n*** End Patch\n";
expectOk("apply_patch", { input: patch });
expectError("apply_patch", { input: "*** Begin Patch\n*** End Patch\n", patch: "x" }, "additional");
expectError("apply_patch", {}, "required");
expectOk("update_plan", { status: "active" });
expectOk("update_plan", { status: "blocked", reason: "Need user input." });
expectError("update_plan", { status: "paused" }, "constant");

const constrainedTools = toolContracts.filter((tool) => Object.hasOwn(tool, "constrainedSampling"));
assert(constrainedTools.length === 1, "only apply_patch should use constrained sampling");
assert(constrainedTools[0]?.name === "apply_patch", "apply_patch should use constrained sampling");
assert(
  JSON.stringify(Object.keys(constrainedTools[0]?.constrainedSampling?.variants ?? {})) ===
    JSON.stringify(["openai_lark"]),
  "apply_patch constrained sampling should define only the openai_lark variant",
);
assert(
  constrainedTools[0]?.constrainedSampling?.variants.openai_lark ===
    readFileSync(new URL("../src/apply_patch.lark", import.meta.url), "utf8"),
  "apply_patch constrained sampling grammar should match src/apply_patch.lark byte-for-byte",
);

const cronSnippet = toolContracts.find((t) => t.name === "cron_create");
assert(
  cronSnippet?.description.includes("local timezone"),
  "cron_create description should mention local timezone",
);
assert(cronSnippet?.promptSnippet.includes("/cron"), "cron_create prompt snippet should mention /cron");
