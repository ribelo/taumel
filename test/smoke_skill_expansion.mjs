import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { applySkillExpansionPlan, installSkillResolver, planSkillExpansion } from "../src/skills.ts";

const message = (name) => ({
  customType: "skill",
  content: `<skill name="${name}" location="/${name}/SKILL.md">\n${name}\n</skill>`,
  display: true,
  details: {
    source: "auto-skill-mention",
    trigger: `$${name}`,
    name,
  },
});

// skr-4281/skr-12m2/skr-wxvz/skr-wl60: plans apply warnings, messages, and text in order.
const effects = [];
const handled = await applySkillExpansionPlan({
  text: "review $first and $second",
  messages: [message("first"), message("second")],
  warnings: [{ message: "read warning" }],
}, {
  notifyWarning: async (warning) => effects.push(["warning", warning]),
  sendMessage: async (planned) => effects.push(["message", planned.details.name]),
  sendText: async (text) => effects.push(["text", text]),
});
assert.equal(handled, "handled");
assert.deepEqual(effects, [
  ["warning", "read warning"],
  ["message", "first"],
  ["message", "second"],
  ["text", "review $first and $second"],
]);

// skr-fzw6: a plan without messages reports warnings and leaves text delivery to the caller.
const passthroughEffects = [];
const passthrough = await applySkillExpansionPlan({
  text: "$missing stays literal",
  messages: [],
  warnings: [{ message: "read warning" }],
}, {
  notifyWarning: (warning) => passthroughEffects.push(["warning", warning]),
  sendMessage: () => passthroughEffects.push(["message"]),
  sendText: () => passthroughEffects.push(["text"]),
});
assert.equal(passthrough, "passthrough");
assert.deepEqual(passthroughEffects, [["warning", "read warning"]]);

// skr-efbe: a failed destination operation prevents all later effects.
const failedEffects = [];
await assert.rejects(
  applySkillExpansionPlan({
    text: "review $first and $second",
    messages: [message("first"), message("second")],
    warnings: [],
  }, {
    notifyWarning: () => failedEffects.push(["warning"]),
    sendMessage: async (planned) => {
      failedEffects.push(["message", planned.details.name]);
      if (planned.details.name === "first") throw new Error("append failed");
    },
    sendText: () => failedEffects.push(["text"]),
  }),
  /append failed/,
);
assert.deepEqual(failedEffects, [["message", "first"]]);

// skr-3ws3/skr-sc04: the parent hook applies one plan and bypasses its own text re-entry.
let inputHandler;
let reentry;
const hookEffects = [];
const hookPi = {
  on: (event, handler) => {
    if (event === "input") inputHandler = handler;
  },
  sendMessage: async (planned) => hookEffects.push(["message", planned.details.name]),
  sendUserMessage: async (text) => {
    hookEffects.push(["text", text]);
    reentry = await inputHandler({ text }, hookCtx);
  },
};
const hookCtx = {
  cwd: process.cwd(),
  ui: { notify: (warning) => hookEffects.push(["warning", warning]) },
};
const hookCore = {
  call: (method, [facts]) => {
    assert.equal(method, "planSkillExpansion");
    assert.deepEqual(facts, { text: "review $first", cwd: process.cwd(), ctx: hookCtx });
    return {
      messages: [message("first")],
      warnings: [{ message: "hook warning" }],
    };
  },
};
installSkillResolver(hookPi, hookCore);
const hookOutcome = await inputHandler({ text: "review $first" }, hookCtx);
assert.deepEqual(hookOutcome, { action: "handled" });
assert.deepEqual(reentry, { action: "continue" });
assert.deepEqual(hookEffects, [
  ["warning", "hook warning"],
  ["message", "first"],
  ["text", "review $first"],
]);

// skr-dbwy/skr-j8su/skr-yyck: the host retains exact text around one core request.
// skr-pvy4/skr-lxjt: the core request produces cycle-safe nested messages.
const root = mkdtempSync(join(tmpdir(), "taumel-skill-expansion-"));
process.env.HOME = root;
const workspace = join(root, "workspace");
const skillRoot = join(workspace, ".pi", "skills");
for (const [name, body] of [
  ["plan-alpha", "Alpha uses $plan-beta."],
  ["plan-beta", "Beta uses $plan-alpha."],
]) {
  const directory = join(skillRoot, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`);
}
const entries = [];
const coreCtx = {
  cwd: workspace,
  sessionManager: {
    getSessionId: () => "skill-expansion-parent",
    getSessionFile: () => join(root, "parent.jsonl"),
    getEntries: () => entries,
    appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
  },
};
const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const core = globalThis.taumel.init({
  resolveAuthorizationPath: realpathSync,
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({ cwd: workspace, provider: "test", model: "model", thinking: "medium", totalCost: 0, contextPercent: 0, contextWindow: 1000 }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
});
const text = "\ud800\nreview $plan-alpha\n";
const corePlan = planSkillExpansion(core, { text, cwd: workspace, ctx: coreCtx });
assert.equal(corePlan.text, text);
assert.deepEqual(corePlan.messages.map((planned) => planned.details), [
  { source: "auto-skill-mention", trigger: "$plan-alpha", name: "plan-alpha" },
  { source: "auto-skill-mention", trigger: "$plan-beta", name: "plan-beta", parent: "plan-alpha" },
]);
assert.deepEqual(corePlan.messages.map(({ customType, display }) => ({ customType, display })), [
  { customType: "skill", display: true },
  { customType: "skill", display: true },
]);
assert.equal(corePlan.messages[0].content, [
  `<skill name="plan-alpha" location="${join(skillRoot, "plan-alpha", "SKILL.md")}">`,
  `References are relative to ${join(skillRoot, "plan-alpha")}.`,
  "",
  "Alpha uses $plan-beta.",
  "</skill>",
].join("\n"));

// skr-i5o9: a later expansion observes a skill added after the first scan.
const addedDirectory = join(skillRoot, "plan-added");
mkdirSync(addedDirectory, { recursive: true });
writeFileSync(join(addedDirectory, "SKILL.md"), "---\nname: plan-added\n---\nAdded later.\n");
const addedPlan = planSkillExpansion(core, {
  text: "use $plan-added",
  cwd: workspace,
  ctx: coreCtx,
});
assert.deepEqual(addedPlan.messages.map((planned) => planned.details.name), ["plan-added"]);
rmSync(root, { recursive: true, force: true });

console.log("skill expansion smoke: all assertions passed");
