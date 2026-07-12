import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { executeCronManager } from "../src/cron-manager.ts";

initTheme();

const artifact = new URL("../dist/taumel.cjs", import.meta.url);
const require = createRequire(import.meta.url);
require(fileURLToPath(artifact));

const core = globalThis.taumel;
if (!core || typeof core.call !== "function" || typeof core.init !== "function") {
  throw new Error("taumel core was not exported by the jsoo artifact");
}

core.init({
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({ cwd: process.cwd(), provider: "openai-codex", model: "gpt-test" }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
});

const entries = [];
const sessionManager = {
  getSessionId: () => "cron-persist-session",
  getSessionFile: () => "/tmp/cron-persist-session.jsonl",
  getEntries: () => entries,
  getBranch: () => entries,
  appendCustomEntry: (customType, data) => {
    entries.push({ type: "custom", customType, data });
  },
};
const ctx = { cwd: process.cwd(), sessionManager };

const create = core.call("prepareTool", [{
  name: "cron_create", params: { cron: "* * * * *", prompt: "persist me", recurring: true }, ctx,
}]);
assert.equal(create?.ok, true, `cron_create failed: ${JSON.stringify(create)}`);
assert.equal(entries.at(-1)?.customType, "taumel.cron", "cron_create should persist a cron entry");
assert.equal(entries.at(-1)?.data?.tasks?.length, 1, "cron_create should persist one task");

const startup = core.call("cronStartup", [{ reason: "resume", ctx }]);
assert.equal(startup?.kind, "notify", "resume with stored cron tasks should notify");
assert.equal(entries.at(-1)?.data?.enabled, false, "resume should persist disabled cron state");
assert.equal(entries.at(-1)?.data?.tasks?.length, 1, "resume should keep stored cron tasks");

const list = core.call("prepareTool", [{ name: "cron_list", params: {}, ctx }]);
assert.equal(list?.details?.enabled, false, `cron_list should expose disabled master switch: ${JSON.stringify(list)}`);
assert.equal(list?.details?.tasks?.length, 1, `cron_list should retain stored task: ${JSON.stringify(list)}`);
assert.equal(list?.details?.tasks?.[0]?.enabled, true, `cron_list should expose task enabled flag: ${JSON.stringify(list)}`);
assert.equal(typeof list?.details?.tasks?.[0]?.nextDueText, "string", `cron_list should expose human next-due text: ${JSON.stringify(list)}`);
assert.match(list?.text ?? "", /disabled.*\/cron enable/i, "cron_list text should explain disabled stored tasks");

const prompt = core.call("planCronPrompt", [
  { prompt: { ok: true, action: "cron_prompt", enabled: false, tasks: list.details.tasks }, uiAvailable: true },
]);
assert.equal(prompt?.kind, "result", `deprecated cron prompt planner should not open multi-row picker: ${JSON.stringify(prompt)}`);
assert(!Array.isArray(prompt?.labels), `deprecated cron prompt planner should not return action labels: ${JSON.stringify(prompt)}`);

const taskId = entries.at(-1)?.data?.tasks?.[0]?.id;
const disabled = core.call("handleCommand", [{ name: "cron", args: `disable ${taskId}`, ctx }]);
assert.equal(disabled?.details?.enabled, false, `task disable action should report disabled: ${JSON.stringify(disabled)}`);
assert.equal(entries.at(-1)?.data?.tasks?.[0]?.enabled, false, "task disable action should persist task enabled=false");

let renderedCronManagerLines = [];
ctx.ui = {
  custom: async (factory) => {
    const component = factory(
      { requestRender: () => undefined },
      {
        fg: (_color, text) => text,
        bg: (_color, text) => text,
        bold: (text) => text,
      },
      { matches: () => false },
      () => undefined,
    );
    renderedCronManagerLines = component.render(120);
    return { kind: "exit" };
  },
};
const managerResult = await executeCronManager(core, {
  ok: true, action: "cron_prompt", enabled: false, tasks: list.details.tasks,
}, ctx);
assert.equal(managerResult?.ok, true, `cron manager should close cleanly: ${JSON.stringify(managerResult)}`);
assert.equal(
  renderedCronManagerLines.filter((line) => line.includes(taskId)).length,
  1,
  `cron manager should render one row per task: ${JSON.stringify(renderedCronManagerLines)}`,
);
assert(
  !renderedCronManagerLines.some((line) => /Disable task|Cancel task/.test(line)),
  `cron manager should not render action rows per task: ${JSON.stringify(renderedCronManagerLines)}`,
);
const taskLine = renderedCronManagerLines.find((line) => line.includes(taskId));
const masterLineIndex = renderedCronManagerLines.findIndex((line) => line.includes("Master switch:"));
assert(masterLineIndex >= 0, `cron manager should render the master switch: ${JSON.stringify(renderedCronManagerLines)}`);
assert.match(taskLine ?? "", /disabled/, "task summary should include enabled state");
assert.match(taskLine ?? "", /message/, "task summary should include mode");
assert.match(taskLine ?? "", /recurring/, "task summary should include recurrence");
