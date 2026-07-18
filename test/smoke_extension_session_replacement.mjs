import assert from "node:assert/strict";

import taumel from "../dist/extension.js";

function makePi() {
  let active = true;
  const handlers = new Map();
  const eventHandlers = new Map();
  const tools = new Set();
  const commands = new Set();
  const addHandler = (target, event, handler) => {
    const entries = target.get(event) ?? [];
    entries.push(handler);
    target.set(event, entries);
  };
  return {
    handlers,
    tools,
    commands,
    invalidate: () => { active = false; },
    pi: {
      on: (event, handler) => addHandler(handlers, event, handler),
      events: {
        on: (event, handler) => {
          addHandler(eventHandlers, event, handler);
          return () => undefined;
        },
        emit: () => undefined,
      },
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      registerTool: (tool) => tools.add(tool.name),
      registerCommand: (name) => commands.add(name),
      registerShortcut: () => undefined,
      registerFlag: () => undefined,
      registerMessageRenderer: () => undefined,
      getActiveTools: () => [],
      setActiveTools: () => undefined,
      getThinkingLevel: () => {
        if (!active) throw new Error("stale extension API");
        return "medium";
      },
    },
  };
}

// shared-lc01/footer-sl01: Pi caches extension modules but reruns their factories
// when /new replaces the session runtime. The replacement instance must bind the
// existing core to its fresh ExtensionAPI instead of initializing a second core.
const first = makePi();
await taumel(first.pi);

const recursiveChild = makePi();
await assert.rejects(
  () => taumel(recursiveChild.pi),
  /Taumel core is already initialized/,
  "an active owning extension allowed recursive child initialization",
);

first.invalidate();

const replacement = makePi();
await taumel(replacement.pi);

assert.deepEqual(replacement.tools, first.tools, "replacement session lost Taumel tools");
assert.deepEqual(replacement.commands, first.commands, "replacement session lost Taumel commands");
assert.equal(
  replacement.handlers.get("session_start")?.length,
  first.handlers.get("session_start")?.length,
  "replacement session did not rebind all core lifecycle handlers",
);

console.log("extension session replacement smoke: all assertions passed");
