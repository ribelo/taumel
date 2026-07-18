import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latestTaumelCustomEntry } from "../src/pi-session-entries.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentDir = await mkdtemp(join(tmpdir(), "taumel-ralph-tool-surface-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
globalThis.taumelToolSurfaceProbe = {
  receivedTools: [],
  issuedToolCalls: [],
  completedToolCalls: [],
  toolResults: [],
};

const extensionPath = join(root, "dist", "extension.js");
const providerPath = join(root, "test", "fixtures", "tool-surface-provider.ts");
await writeFile(join(agentDir, "settings.json"), JSON.stringify({
  defaultProvider: "taumel-test",
  defaultModel: "tool-probe",
  defaultThinkingLevel: "off",
  extensions: [extensionPath, providerPath],
}));

const { createAgentSession, SessionManager } = await import("@earendil-works/pi-coding-agent");
const { session } = await createAgentSession({
  cwd: root,
  agentDir,
  model: {
    id: "tool-probe",
    name: "Tool surface probe",
    api: "taumel-test-api",
    provider: "taumel-test",
    baseUrl: "http://127.0.0.1/unused",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
  },
  tools: ["ralph_continue", "ralph_finish"],
  sessionManager: SessionManager.inMemory(root),
});
const ralph = session.extensionRunner.getCommand("ralph");
assert(ralph, "Ralph command was not registered");
const commandContext = session.extensionRunner.createCommandContext();

let probe;
let listResult;
let persistedRalph;
try {
  await ralph.handler("start Verify child tool surface", commandContext);
  probe = globalThis.taumelToolSurfaceProbe;
  listResult = await ralph.handler("list", commandContext);
  persistedRalph = latestTaumelCustomEntry(session.sessionManager, "taumel.ralph");
} finally {
  session.dispose();
  await rm(agentDir, { recursive: true, force: true });
  delete globalThis.taumelToolSurfaceProbe;
}

assert(probe.receivedTools.includes("ralph_continue"), "Ralph child did not receive ralph_continue");
assert.deepEqual(probe.issuedToolCalls, ["ralph_continue"], "Ralph child did not invoke ralph_continue");
assert.deepEqual(probe.completedToolCalls, ["ralph_continue"], "ralph_continue did not complete");
assert.match(probe.toolResults[0] ?? "", /ralph_continue accepted/, "ralph_continue was not accepted");
assert.match(listResult?.message ?? "", /iteration=1/, "controller did not retain the child iteration");
assert.ok(persistedRalph.kind === "contract_valid" && persistedRalph.entry.data.tasks.length > 0, "non-empty Ralph state satisfies the persisted-entry contract");
console.log("Ralph tool surface smoke test passed");
