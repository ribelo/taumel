import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { registerGatewayCommands } from "../src/command-executor.ts";
import {
  decodeUsageInspection,
  renderUsageInspection,
  showUsageInspection,
} from "../src/usage-inspection.ts";

const details = {
  accountLabel: "person-with-a-long-address@example.com",
  plan: "Pro",
  creditsBalance: 990.563425,
  notConfigured: false,
  rateLimits: [
    { label: "Weekly Limit", durationSeconds: 604800, percentLeft: 41, resetsAt: 1_700_300_000, burnRatePerHour: 0.4, exhaustsAt: 1_800_000_000, exhaustsBeforeReset: false },
    { label: "5h Limit", durationSeconds: 18000, percentLeft: 9, resetsAt: 1_700_010_000, burnRatePerHour: 5.2, exhaustsAt: 1_700_005_000, exhaustsBeforeReset: true },
  ],
};
const decoded = decodeUsageInspection(details);
assert.deepEqual(decoded.rateLimits.map((row) => row.label), ["5h Limit", "Weekly Limit"]);

const colors = [];
const theme = {
  fg(color, text) {
    if (this !== theme) throw new Error("usage renderer lost theme receiver");
    colors.push({ color, text });
    return text;
  },
};
const rendered = renderUsageInspection(decoded, theme, 80, 1_700_000_000_000);
const output = rendered.join("\n");
assert.match(output, /OpenAI Codex Usage/);
assert.match(output, /Credits\s+990\.56/);
assert.doesNotMatch(output, /\$990\.56/, "credits must not assume a currency");
assert.ok(output.indexOf("5h limit") < output.indexOf("Weekly limit"));
assert.match(output, /Burn 5\.2%\/h/);
assert.match(output, /Est\. empty in/);
assert.match(output, /Safe until reset/);
assert.doesNotMatch(output, /Updated/);
assert.match(output, /\[[█░]+\]/, "usage bars should use block glyphs");
assert.doesNotMatch(output, /\[[#-]+\]/, "usage bars should not use ASCII hash bars");
assert.ok(colors.some(({ color, text }) => color === "error" && text.includes("[")), "low quota bar should be error-colored");
assert.ok(colors.some(({ color, text }) => color === "success" && text.includes("[")), "healthy quota bar should be success-colored");
const thresholdColors = [];
renderUsageInspection({ notConfigured: false, rateLimits: [
  { label: "Warning", percentLeft: 20 },
  { label: "Unknown" },
] }, { fg: (color, text) => { thresholdColors.push({ color, text }); return text; } }, 80);
assert.ok(thresholdColors.some(({ color, text }) => color === "warning" && text.includes("[")));
assert.ok(thresholdColors.some(({ color, text }) => color === "dim" && text.includes("[")));

const narrow = renderUsageInspection(decoded, theme, 32, 1_700_000_000_000);
assert.ok(narrow.every((line) => visibleWidth(line) <= 32), "narrow usage lines must fit their width");
assert.ok(narrow.some((line) => line.includes("...")), "narrow account metadata should ellipsize");

const empty = renderUsageInspection(decodeUsageInspection({ notConfigured: false, rateLimits: [] }), theme, 80);
assert.match(empty.join("\n"), /No quota windows returned/);
const failed = renderUsageInspection(decodeUsageInspection({ notConfigured: false, error: "Bearer secret-token failed", rateLimits: [] }), theme, 80);
assert.doesNotMatch(failed.join("\n"), /secret-token/);
const staleEstimate = renderUsageInspection(decodeUsageInspection({
  notConfigured: false,
  rateLimits: [{ label: "Weekly Limit", percentLeft: 99, burnRatePerHour: 1.8, exhaustsAt: 1_699_999_000, exhaustsBeforeReset: true }],
}), theme, 80, 1_700_000_000_000).join("\n");
assert.doesNotMatch(staleEstimate, /Est\. empty in under 1m/, "past exhaustion timestamps must not render as imminent estimates");

let component;
let closed = 0;
await showUsageInspection(details, {
  ui: {
    custom(factory) {
      component = factory({}, theme, {}, () => { closed += 1; });
      return Promise.resolve();
    },
  },
});
component.handleInput("x");
assert.equal(closed, 0, "unrelated input must not close usage inspection");
component.handleInput("q");
assert.equal(closed, 1, "q should close usage inspection");
component.handleInput("\x1b");
component.handleInput("\r");
assert.equal(closed, 3, "escape and enter should close usage inspection");

const commands = new Map();
const statuses = [];
let notificationPlans = 0;
const integrationCore = {
  call(method, args = []) {
    if (method === "commandSpecs") return { specs: [{ name: "usage", description: "Show usage" }] };
    if (method === "planCommandExecution") return { kind: "direct" };
    if (method === "handleCommand") return { ok: true, action: "openai_usage_fetch", apiKeyPresent: false };
    if (method === "openAiUsageHostAuth") return { providerKey: "openai-codex", credentialKey: "openai-codex", source: "openai-codex" };
    if (method === "openAiUsageHostParams") return { apiKeyPresent: false, tokenState: "present", token: "token" };
    if (method === "executeOpenAiUsage") return { ok: true, action: "tool_result", text: "legacy", details };
    if (method === "toolResultEnvelope") {
      const prepared = args[0].prepared;
      return { content: [{ type: "text", text: prepared.text }], details: prepared.details };
    }
    if (method === "toolResultToCommandResult") {
      return { ok: true, action: "command_result", message: "legacy", details: args[0].details };
    }
    if (method === "planCommandNotification") {
      notificationPlans += 1;
      return { kind: "notify", message: "usage completed.", level: "info" };
    }
    throw new Error(`unexpected integration core call: ${method}`);
  },
};
registerGatewayCommands({ registerCommand: (name, command) => commands.set(name, command) }, integrationCore, new Map());
await commands.get("usage").handler("", {
  modelRegistry: {
    authStorage: { get: () => ({}) },
    getApiKeyForProvider: async () => "token",
  },
  ui: {
    setStatus: (key, value) => statuses.push([key, value]),
    custom: async (factory) => {
      await new Promise((done) => {
        const modal = factory({}, theme, {}, done);
        assert.match(modal.render(80).join("\n"), /OpenAI Codex Usage/);
        modal.handleInput("q");
      });
    },
    notify: () => { throw new Error("usage must not notify"); },
  },
});
assert.deepEqual(statuses, [
  ["taumel:usage", "Fetching OpenAI Codex usage..."],
  ["taumel:usage", undefined],
]);
assert.equal(notificationPlans, 0, "usage should suppress command completion notification planning");

console.log("usage inspection smoke passed");
