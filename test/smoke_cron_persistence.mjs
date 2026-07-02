import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

const create = core.call("prepareTool", [
  "cron_create",
  { cron: "* * * * *", prompt: "persist me", recurring: true },
  ctx,
]);
assert.equal(create?.ok, true, `cron_create failed: ${JSON.stringify(create)}`);
assert.equal(entries.at(-1)?.customType, "taumel.cron", "cron_create should persist a cron entry");
assert.equal(entries.at(-1)?.data?.tasks?.length, 1, "cron_create should persist one task");

const startup = core.call("cronStartup", [{ type: "session_start", reason: "resume" }, ctx]);
assert.equal(startup?.notify, true, "resume with stored cron tasks should notify");
assert.equal(entries.at(-1)?.data?.enabled, false, "resume should persist disabled cron state");
assert.equal(entries.at(-1)?.data?.tasks?.length, 1, "resume should keep stored cron tasks");

const list = core.call("prepareTool", ["cron_list", {}, ctx]);
assert.equal(list?.details?.enabled, false, `cron_list should expose disabled master switch: ${JSON.stringify(list)}`);
assert.equal(list?.details?.tasks?.length, 1, `cron_list should retain stored task: ${JSON.stringify(list)}`);
assert.match(list?.text ?? "", /disabled.*\/cron enable/i, "cron_list text should explain disabled stored tasks");
