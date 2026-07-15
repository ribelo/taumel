/**
 * Verifies model-facing tool metadata from plans/ (baseline 15dccb6).
 */
import { parseToolParams } from "../src/tool-contracts.ts";
import { toolContracts } from "../src/tool-contract-catalog.ts";
import {
  PARAM_DESCRIPTIONS,
  PROMPT_GUIDELINES,
  PROMPT_GUIDELINE_REQUIREMENTS,
  PROMPT_SNIPPETS,
  REQUIREMENT_CHECKS,
  TOOL_DESCRIPTIONS,
} from "./tool-metadata-expected.mjs";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function contract(name) {
  const c = toolContracts.find((t) => t.name === name);
  assert(c !== undefined, `missing tool contract: ${name}`);
  return c;
}

/** Walk JSON Schema properties; supports `items` for array element shapes. */
function schemaDescription(toolName, path) {
  const segments = path.split(".");
  let node = contract(toolName).parameters;
  for (const seg of segments) {
    if (node === undefined || node === null) return undefined;
    if (seg === "items") {
      node = node.items;
      continue;
    }
    node = node.properties?.[seg];
  }
  return typeof node?.description === "string" ? node.description : undefined;
}

function resolveParam(key) {
  const dot = key.indexOf(".");
  assert(dot > 0, `bad param key ${key}`);
  return schemaDescription(key.slice(0, dot), key.slice(dot + 1));
}

for (const [reqId, kind, key] of REQUIREMENT_CHECKS) {
  if (kind === "tool") {
    assert(contract(key).description === TOOL_DESCRIPTIONS[key], `${reqId}: ${key} description`);
  } else if (kind === "snippet") {
    assert(contract(key).promptSnippet === PROMPT_SNIPPETS[key], `${reqId}: ${key} promptSnippet`);
  } else if (kind === "param") {
    assert(resolveParam(key) === PARAM_DESCRIPTIONS[key], `${reqId}: ${key} param description`);
  }
}

for (const [toolName, expected] of Object.entries(PROMPT_GUIDELINES)) {
  const actual = contract(toolName).promptGuidelines;
  const requirementIds = PROMPT_GUIDELINE_REQUIREMENTS[toolName] ?? [];
  assert(requirementIds.length === expected.length, `${toolName}: prompt guideline requirement IDs`);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${requirementIds.join("/")}: ${toolName} promptGuidelines: ${JSON.stringify(actual)}`,
  );
}

for (const name of ["agent_spawn", "finder", "oracle", "agent_send", "agent_wait", "agent_list", "agent_close"]) {
  for (const line of contract(name).promptGuidelines ?? []) {
    assert(line.includes(name), `agent-1xfj: ${name} guideline must name the tool: ${line}`);
  }
}

for (const name of ["read", "view_media", "edit", "write"]) {
  assert(!("promptGuidelines" in contract(name)), `sandbox-tl16/20/27/33: ${name} no promptGuidelines`);
}

const patch = "*** Begin Patch\n*** End Patch\n";
assert(parseToolParams("apply_patch", { input: patch }).ok, "sandbox-tl04: apply_patch input");
assert(
  parseToolParams("apply_patch", { input: patch, patch: "x" }).ok === false,
  "sandbox-tl09: unknown param",
);

assert(
  parseToolParams("web_search_exa", { query: "x", startCrawlDate: "2020" }).ok === false,
  "exa-tl13: no startCrawlDate",
);
assert(
  parseToolParams("web_search_exa", { query: "x", endCrawlDate: "2020" }).ok === false,
  "exa-tl13: no endCrawlDate",
);
assert(
  parseToolParams("exa_agent_create_run", { query: "q", budget: {} }).ok === false,
  "exa-om01: no budget field",
);
assert(
  parseToolParams("web_search_exa", { query: "x", contents: { highlights: { maxCharacters: 50 } } }).ok,
  "exa-tl13: highlights.maxCharacters",
);
assert(
  parseToolParams("web_search_exa", {
    query: "x",
    contents: { highlights: { numSentences: 2 } },
  }).ok === false,
  "exa-tl13: no highlights.numSentences",
);

assert(parseToolParams("read", { path: "a.txt", extra: true }).ok === false, "sandbox-tl15: read unknown param");
assert(!parseToolParams("read", { path: "" }).ok, "sandbox-tl15: read path non-empty");
assert(
  parseToolParams("view_media", { path: "x.png", extra: true }).ok === false,
  "sandbox-tl19: view_media unknown param",
);
assert(!parseToolParams("view_media", { path: "" }).ok, "sandbox-tl19: view_media path non-empty");
assert(
  parseToolParams("write", { path: "f", content: "", extra: true }).ok === false,
  "sandbox-tl32: write unknown param",
);
assert(!parseToolParams("write", { path: "" }).ok, "sandbox-tl32: write path non-empty");
assert(
  parseToolParams("edit", { path: "f", edits: [{ oldText: "", newText: "" }] }).ok === false,
  "sandbox-tl26: edit non-empty oldText",
);
assert(!parseToolParams("edit", { path: "", edits: [{ oldText: "a", newText: "b" }] }).ok, "sandbox-tl26: edit path");
assert(
  parseToolParams("edit", { path: "f", edits: [] }).ok === false,
  "sandbox-tl26: edit at least one edit",
);

assert(contract("web_search_exa").promptGuidelines?.length >= 3, "exa-tl03: web_search guidance");
assert(contract("crawling_exa").promptGuidelines?.length >= 2, "exa-tl09: crawling guidance");
assert(contract("exa_agent_create_run").promptGuidelines?.length >= 2, "exa-tl11: agent create guidance");

console.log("smoke_tool_metadata_requirements: all assertions passed");
