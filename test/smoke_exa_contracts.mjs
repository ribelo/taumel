import { parseToolParams, toolNames } from "../src/tool-contracts.ts";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const expectOk = (name, params) => {
  const parsed = parseToolParams(name, params);
  assert(parsed.ok === true, `${name} should parse: ${JSON.stringify(parsed)}`);
};

const expectError = (name, params, text) => {
  const parsed = parseToolParams(name, params);
  assert(parsed.ok === false, `${name} should reject: ${JSON.stringify(params)}`);
  assert(parsed.error.includes(text), `${name} error did not include ${text}: ${parsed.error}`);
};

for (const name of [
  "web_search_exa",
  "crawling_exa",
  "get_code_context_exa",
  "exa_agent_create_run",
  "exa_agent_get_run",
  "exa_agent_list_runs",
  "exa_agent_cancel_run",
  "exa_agent_list_events",
]) {
  assert(toolNames.includes(name), `missing Exa contract: ${name}`);
}

assert(!toolNames.includes("exa_agent_delete_run"), "delete run must not be exposed");

expectOk("web_search_exa", {
  query: "latest Exa docs",
  type: "auto",
  numResults: 3,
  contents: { highlights: true, maxAgeHours: 24 },
});
expectError("web_search_exa", { query: "docs", context: true }, "additional properties");
expectError("web_search_exa", { query: "docs", startCrawlDate: "2020-01-01" }, "additional properties");
expectError("web_search_exa", { query: "docs", endCrawlDate: "2020-01-01" }, "additional properties");
assert(
  parseToolParams("web_search_exa", { query: "docs", contents: { highlights: { numSentences: 2 } } }).ok === false,
  "web_search_exa should reject deprecated highlights.numSentences",
);
expectError("web_search_exa", { query: "docs", contents: { livecrawl: "always" } }, "additional properties");

expectOk("crawling_exa", { urls: ["https://exa.ai"], text: true, maxAgeHours: 0 });
expectError("crawling_exa", { ids: ["a"], urls: ["https://exa.ai"] }, "either ids or urls");
expectError("crawling_exa", { urls: ["https://exa.ai"], livecrawl: "always" }, "additional properties");

expectOk("get_code_context_exa", { query: "Eta HTTP request body", tokensNum: "dynamic" });
expectOk("get_code_context_exa", { query: "Eta HTTP request body", tokensNum: 5000 });

expectOk("exa_agent_create_run", {
  query: "find recent AI infrastructure funding",
  effort: "low",
  input: { data: [{ company: "Example" }] },
  outputSchema: { type: "object", properties: { name: { type: "string" } } },
  metadata: { source: "smoke" },
});
expectError("exa_agent_create_run", {
  query: "find recent AI infrastructure funding",
  budget: {},
}, "additional properties");
