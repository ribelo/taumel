import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const artifact = new URL("../dist/taumel.cjs", import.meta.url);
const require = createRequire(import.meta.url);
require(fileURLToPath(artifact));

const core = globalThis.taumel;

if (!core || typeof core !== "object" || typeof core.init !== "function" || typeof core.call !== "function") {
  throw new Error("taumel core was not exported by the jsoo artifact");
}

const exportedKeys = Object.keys(core).sort();
if (JSON.stringify(exportedKeys) !== JSON.stringify(["call", "init"])) {
  throw new Error(`unexpected Taumel artifact exports: ${JSON.stringify(exportedKeys)}`);
}

if (!Array.isArray(core.call("toolSpecs", [])) || !Array.isArray(core.call("commandSpecs", []))) {
  throw new Error("Taumel artifact specs did not return arrays");
}

const handlers = new Map();
let footerFactory;
let renderRequests = 0;

const pushHandler = (event, handler) => {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
};

core.init({
  on: pushHandler,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: (_ctx, factory) => {
    footerFactory = factory;
  },
  sessionSnapshot: () => ({
    cwd: "/home/ribelo/projects/ribelo/taumel",
    provider: "openai-codex",
    model: "gpt-test",
    thinking: "medium",
    totalCost: 0.125,
    contextPercent: 12,
    contextWindow: 200000,
  }),
  getGitBranch: () => "main",
  onBranchChange: (_footerData, handler) => {
    handler();
    return () => undefined;
  },
  requestRender: () => {
    renderRequests += 1;
  },
  themeFg: (_theme, _color, value) => value,
});

for (const handler of handlers.get("session_start") ?? []) {
  handler({ type: "session_start" }, { ui: {} });
}

if (typeof footerFactory !== "function") {
  throw new Error("footer factory was not installed");
}

const component = footerFactory({}, {}, {});
const lines = component.render(120);
if (!Array.isArray(lines) || typeof lines[0] !== "string") {
  throw new Error(`footer render did not return lines: ${JSON.stringify(lines)}`);
}
component.dispose();

if (renderRequests < 1) {
  throw new Error("footer did not request render");
}

process.exit(0);
