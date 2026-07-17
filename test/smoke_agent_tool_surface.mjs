import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentDir = await mkdtemp(join(tmpdir(), "taumel-agent-tool-surface-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const extensionPath = join(root, "dist", "extension.js");
const providerPath = join(root, "test", "fixtures", "tool-surface-provider.ts");
await writeFile(join(agentDir, "settings.json"), JSON.stringify({
  defaultProvider: "taumel-test",
  defaultModel: "tool-probe",
  defaultThinkingLevel: "off",
  extensions: [extensionPath, providerPath],
  taumel: {
    agents: {
      generic: {
        high: { model: "taumel-test/tool-probe", thinking: "off" },
      },
    },
  },
}));

const { createAgentSession, SessionManager } = await import("@earendil-works/pi-coding-agent");
const tools = ["exec_command", "write_stdin", "agent_spawn", "agent_wait", "agent_close"];
const { session } = await createAgentSession({
  cwd: root,
  agentDir,
  tools,
  sessionManager: SessionManager.inMemory(root),
});

function tool(name) {
  const found = session.agent.state.tools.find((candidate) => candidate.name === name);
  assert(found, `missing parent tool ${name}`);
  return found;
}

let agentId;
let output = "";
try {
  const spawn = await tool("agent_spawn").execute("tool-surface-spawn", {
    message: "Invoke exec_command once.",
    description: "Probe child tool surface",
    tier: "high",
    isolation: "none",
  });
  agentId = spawn.details.agent_id;
  const wait = await tool("agent_wait").execute("tool-surface-wait", {
    run_ids: [spawn.details.run_id],
    timeout_seconds: 5,
  });
  output = wait.details.results[0]?.output ?? "";
} finally {
  if (agentId) {
    await tool("agent_close").execute("tool-surface-close", { agent_id: agentId });
  }
  session.dispose();
  await rm(agentDir, { recursive: true, force: true });
}

assert.equal(output, "TAUMEL_CHILD_EXEC_OK", `spawned child did not receive exec_command: ${output}`);
console.log("agent tool surface smoke test passed");
