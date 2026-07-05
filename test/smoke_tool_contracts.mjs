import { parseToolParams, toolContracts } from "../src/tool-contracts.ts";

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
assert(!parseToolParams("exec_command", { cmd: "" }).ok, "exec_command should reject an empty command");
assert(!parseToolParams("exec_command", { cmd: " \t\n" }).ok, "exec_command should reject a whitespace-only command");
