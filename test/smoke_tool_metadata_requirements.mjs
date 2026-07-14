/**
 * Verifies model-facing tool metadata from plans/ (baseline 15dccb6).
 */
import { parseToolParams } from "../src/tool-contracts.ts";
import { toolContracts } from "../src/tool-contract-catalog.ts";
import {
  PARAM_DESCRIPTIONS,
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

function paramDescription(toolName, path) {
  let node = contract(toolName).parameters;
  for (const key of path.split(".")) {
    node = node?.properties?.[key];
    if (node === undefined) return undefined;
  }
  return typeof node?.description === "string" ? node.description : undefined;
}

function resolveParam(key) {
  const dot = key.indexOf(".");
  assert(dot > 0, `bad param key ${key}`);
  return paramDescription(key.slice(0, dot), key.slice(dot + 1));
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
  contract("web_search_exa").parameters.properties?.contents?.description ===
    "Content extraction to include with each search result.",
  "exa-tl06: contents object description",
);
assert(
  contract("crawling_exa").parameters.properties?.summary?.description ===
    "Request a generated summary for each result.",
  "exa-tl08: summary description",
);

assert(
  parseToolParams("web_search_exa", { query: "x", startCrawlDate: "2020" }).ok === false,
  "exa-tl13: no startCrawlDate",
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
  parseToolParams("read", { path: "a.txt", extra: true }).ok === false,
  "sandbox-tl15: read rejects unknown parameters",
);
assert(
  parseToolParams("view_media", { path: "x.png", extra: true }).ok === false,
  "sandbox-tl19: view_media rejects unknown parameters",
);
assert(
  parseToolParams("write", { path: "f", content: "", extra: true }).ok === false,
  "sandbox-tl32: write rejects unknown parameters",
);
assert(
  parseToolParams("edit", { path: "f", edits: [{ oldText: "", newText: "" }] }).ok === false,
  "sandbox-tl26: edit requires non-empty oldText",
);

console.log("smoke_tool_metadata_requirements: all assertions passed");