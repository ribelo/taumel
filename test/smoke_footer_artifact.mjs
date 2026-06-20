import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const artifact = new URL("../dist/taumel_footer.cjs", import.meta.url);
const require = createRequire(import.meta.url);
require(fileURLToPath(artifact));

if (
  !globalThis.taumelFooter ||
  typeof globalThis.taumelFooter.init !== "function"
) {
  throw new Error("taumelFooter.init was not exported by the jsoo artifact");
}

const handlers = new Map();
const internalHandlers = new Map();
let footerFactory;
let renderRequests = 0;

const pushHandler = (map, event, handler) => {
  const list = map.get(event) ?? [];
  list.push(handler);
  map.set(event, list);
};

const host = {
  on: (event, handler) => pushHandler(handlers, event, handler),
  eventsOn: (event, handler) => {
    pushHandler(internalHandlers, event, handler);
    return () => undefined;
  },
  emit: (event, payload) => {
    for (const handler of internalHandlers.get(event) ?? []) handler(payload);
  },
  exec: async () => ({ code: 0, stdout: "2\t1\tlib/a.ml\n", stderr: "" }),
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
};

globalThis.taumelFooter.init(host);

for (const handler of handlers.get("session_start") ?? []) {
  handler({ type: "session_start" }, { ui: {} });
}

if (typeof footerFactory !== "function") {
  throw new Error("footer factory was not installed");
}

const component = footerFactory({}, {}, {});
const lines = component.render(120);
const [line] = lines;

if (!line.includes("taumel:main")) throw new Error(`missing repo/branch: ${line}`);
if (!line.includes("codex")) throw new Error(`missing provider alias: ${line}`);
if (!line.includes("gpt-test")) throw new Error(`missing model: ${line}`);
if (!line.includes("$0.125")) throw new Error(`missing cost: ${line}`);
if (!line.includes("12%/200k")) throw new Error(`missing context usage: ${line}`);
if (line.includes("ρ")) throw new Error(`backlog segment should be omitted: ${line}`);

component.dispose();
if (renderRequests < 1) throw new Error("footer did not request render");

process.exit(0);
