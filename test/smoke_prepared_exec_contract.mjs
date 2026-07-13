import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

import { decodePreparedToolAction } from "../src/bridge-contracts.ts";

const require = createRequire(import.meta.url);
require("../dist/taumel.cjs");
const core = globalThis.taumel;
const cwd = process.cwd();

core.init({
  resolveAuthorizationPath: (path) => path,
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({
    cwd,
    provider: "openai-codex",
    model: "gpt-test",
    sandboxMode: "danger-full-access",
    networkMode: "enabled",
  }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
});

const ctx = {
  cwd,
  sessionManager: {
    getSessionId: () => "prepared-exec-contract-smoke",
    getEntries: () => [{
      type: "custom",
      customType: "taumel.permissions",
      data: {
        version: 1,
        profile: {
          modelId: "inherit",
          thinkingLevel: "medium",
          sandboxPreset: "danger-full-access",
          approvalPolicy: "never",
          tools: { kind: "all" },
          noSandboxAllowed: false,
        },
        networkMode: "enabled",
        noSandbox: false,
        isolated_child: false,
      },
    }],
    getBranch: () => [],
  },
};

// exec-2q9v: exercise the built OCaml producer, not a hand-written prepared-action fixture.
const prepareExec = (params) => core.call("prepareTool", [{ name: "exec_command", params, ctx }]);
const prepared = prepareExec({ cmd: "pwd" });

assert.doesNotThrow(
  () => decodePreparedToolAction(prepared),
  `prepared exec action must satisfy the TypeScript bridge contract: ${JSON.stringify(prepared)}`,
);

const capturedCall = prepareExec({
  cmd: "pwd",
  workdir: cwd,
  yield_time_ms: 1000,
  max_output_tokens: 1000,
});
assert.doesNotThrow(
  () => decodePreparedToolAction(capturedCall),
  `captured exec action must satisfy the TypeScript bridge contract: ${JSON.stringify(capturedCall)}`,
);

console.log("prepared exec contract smoke: all assertions passed");
