import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentDir = await mkdtemp(join(tmpdir(), "taumel-agent-missing-tool-"));
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

const { createAgentSession, defineTool, SessionManager } = await import("@earendil-works/pi-coding-agent");
const parentOnly = defineTool({
  name: "parent_only",
  label: "Parent only",
  description: "A test tool intentionally unavailable in child sessions.",
  parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: "text", text: "parent" }], details: {} }),
});
const { session } = await createAgentSession({
  cwd: root,
  agentDir,
  tools: ["exec_command", "write_stdin", "parent_only", "agent_spawn", "agent_wait", "agent_close"],
  customTools: [parentOnly],
  sessionManager: SessionManager.inMemory(root),
});

function tool(name) {
  const found = session.agent.state.tools.find((candidate) => candidate.name === name);
  assert(found, `missing parent tool ${name}`);
  return found;
}

let started;
let failure;
try {
  try {
    started = await tool("agent_spawn").execute("missing-tool-spawn", {
      message: "Invoke exec_command once.",
      description: "Reject incomplete tool surface",
      tier: "high",
      isolation: "none",
    });
  } catch (error) {
    failure = error;
  }
  if (started?.details?.agent_id) {
    await tool("agent_wait").execute("missing-tool-wait", {
      run_ids: [started.details.runId],
      timeout_seconds: 5,
    });
    await tool("agent_close").execute("missing-tool-close", {
      agent_id: started.details.agentId,
    });
  }
} finally {
  session.dispose();
  await rm(agentDir, { recursive: true, force: true });
}

assert.match(String(failure), /tool_surface_unavailable: parent_only/);
console.log("missing child tool surface smoke test passed");
