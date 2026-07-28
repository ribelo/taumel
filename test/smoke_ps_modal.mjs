import assert from "node:assert/strict";
import { executePsModal } from "../src/ps-modal.ts";
import { registerGatewayCommands } from "../src/command-executor.ts";

function entry(overrides = {}) {
  return {
    sessionId: 1,
    command: "sleep 30",
    runState: "running",
    ageSeconds: 12,
    retained: false,
    ...overrides,
  };
}

function makeUi(handlers) {
  const renders = [];
  const notifications = [];
  const confirms = [];
  const ui = {
    notify: (message, level) => notifications.push({ message, level }),
    select: async (title, labels) => {
      confirms.push({ title, labels });
      return handlers.confirm === undefined ? labels[0] : handlers.confirm(title, labels);
    },
    custom: async (factory) => {
      await new Promise((resolve) => {
        const component = factory(
          { requestRender: () => undefined },
          {
            fg(color, text) {
              return `[${color}]${text}`;
            },
          },
          {},
          resolve,
        );
        renders.push(component.render(120));
        if (handlers.drive) handlers.drive(component, resolve, renders);
      });
    },
  };
  return { ui, renders, notifications, confirms };
}

// --- list rendering ---
{
  let snapshot = {
    sessions: [
      entry({ sessionId: 7, command: "make test", ageSeconds: 5 }),
      entry({
        sessionId: 9,
        command: "echo done",
        runState: "exited",
        exitCode: 0,
        ageSeconds: 40,
        retained: true,
      }),
    ],
  };
  const calls = [];
  const core = {
    call(name, args) {
      calls.push([name, args]);
      if (name === "processManagerSnapshot") return snapshot;
      throw new Error(`unexpected: ${name}`);
    },
  };
  const { ui, renders } = makeUi({
    drive(component) {
      const text = component.render(120).join("\n");
      assert.match(text, /make test/);
      assert.match(text, /echo done/);
      assert.match(text, /\[accent\]running/);
      assert.match(text, /exit 0/);
      assert.match(text, /retained/);
      assert.match(text, /o output · k kill · q close/);
      component.handleInput("q");
    },
  });
  const result = await executePsModal(core, {
    ui,
    sessionManager: { getSessionId: () => "owner-1" },
  });
  assert.equal(result.inspection, true);
  assert.equal(result.ok, true);
  assert.ok(renders.length >= 1);
  assert.equal(calls.filter(([name]) => name === "processManagerSnapshot").length, 1);
}

// --- output view ---
{
  const snapshot = { sessions: [entry({ sessionId: 3, command: "printf hi" })] };
  const calls = [];
  const core = {
    call(name, args) {
      calls.push([name, args]);
      if (name === "processManagerSnapshot") return snapshot;
      if (name === "processManagerOutput") {
        assert.deepEqual(args[0], { ownerId: "owner-1", sessionId: 3 });
        return { available: true, text: "hello from session" };
      }
      throw new Error(name);
    },
  };
  let opened = 0;
  const { ui, renders } = makeUi({
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("o");
      else if (opened === 2) {
        const text = component.render(80).join("\n");
        assert.match(text, /Session 3/);
        assert.match(text, /hello from session/);
        component.handleInput("q");
      } else {
        component.handleInput("q");
      }
    },
  });
  await executePsModal(core, {
    ui,
    sessionManager: { getSessionId: () => "owner-1" },
  });
  assert.ok(calls.some(([name]) => name === "processManagerOutput"));
  assert.ok(renders.some((lines) => lines.join("\n").includes("hello from session")));
}

// --- unavailable output ---
{
  const snapshot = { sessions: [entry({ sessionId: 4 })] };
  const core = {
    call(name) {
      if (name === "processManagerSnapshot") return snapshot;
      if (name === "processManagerOutput") return { available: false, text: "no longer available" };
      throw new Error(name);
    },
  };
  let opened = 0;
  const { ui } = makeUi({
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("o");
      else if (opened === 2) {
        const text = component.render(80).join("\n");
        assert.match(text, /no longer available/i);
        component.handleInput("q");
      } else component.handleInput("q");
    },
  });
  await executePsModal(core, {
    ui,
    sessionManager: { getSessionId: () => "owner-1" },
  });
}

// --- kill confirm flow ---
{
  let snapshot = { sessions: [entry({ sessionId: 11, command: "sleep 99" })] };
  const kills = [];
  const core = {
    call(name, args) {
      if (name === "processManagerSnapshot") return snapshot;
      if (name === "processManagerKill") {
        kills.push(args[0]);
        snapshot = {
          sessions: [
            entry({
              sessionId: 11,
              command: "sleep 99",
              runState: "exited",
              exitCode: 143,
              retained: true,
            }),
          ],
        };
        return { ok: true };
      }
      throw new Error(name);
    },
  };
  let opened = 0;
  const { ui, confirms } = makeUi({
    confirm: () => "Confirm kill",
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("k");
      else component.handleInput("q");
    },
  });
  await executePsModal(core, {
    ui,
    sessionManager: { getSessionId: () => "owner-1" },
  });
  assert.deepEqual(kills, [{ ownerId: "owner-1", sessionId: 11 }]);
  assert.equal(confirms.length, 1);
}

// --- kill cancel does not mutate ---
{
  const snapshot = { sessions: [entry({ sessionId: 12 })] };
  const kills = [];
  const core = {
    call(name, args) {
      if (name === "processManagerSnapshot") return snapshot;
      if (name === "processManagerKill") {
        kills.push(args[0]);
        return { ok: true };
      }
      throw new Error(name);
    },
  };
  let opened = 0;
  const { ui } = makeUi({
    confirm: () => "Cancel",
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("k");
      else component.handleInput("q");
    },
  });
  await executePsModal(core, {
    ui,
    sessionManager: { getSessionId: () => "owner-1" },
  });
  assert.deepEqual(kills, []);
}

// --- rejection surfaces as notify ---
{
  const snapshot = { sessions: [entry({ sessionId: 13 })] };
  const core = {
    call(name) {
      if (name === "processManagerSnapshot") return snapshot;
      if (name === "processManagerKill") return { ok: false, error: "Shell session 13 belongs to another pi session" };
      throw new Error(name);
    },
  };
  let opened = 0;
  const { ui, notifications } = makeUi({
    confirm: () => "Confirm kill",
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("k");
      else component.handleInput("q");
    },
  });
  await executePsModal(core, {
    ui,
    sessionManager: { getSessionId: () => "owner-1" },
  });
  assert.ok(notifications.some((entry) => /belongs to another pi session/.test(entry.message)));
  assert.equal(opened >= 2, true, "modal reopened after rejection");
}

// --- silent command result through registerGatewayCommands ---
{
  const commands = new Map();
  const notifications = [];
  const pi = {
    registerCommand: (name, definition) => commands.set(name, definition),
  };
  const core = {
    call(method, args = []) {
      if (method === "commandSpecs") {
        return {
          specs: [
            { name: "ps", description: "Open process manager" },
            { name: "tasks", description: "Open tasks" },
          ],
        };
      }
      if (method === "planCommandExecution") return { kind: "direct" };
      if (method === "processManagerSnapshot") return { sessions: [] };
      if (method === "planCommandNotification") {
        return { kind: "notify", message: args[0].message || "done", level: "info" };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  registerGatewayCommands(pi, core, new Map());
  const ps = commands.get("ps");
  assert.ok(ps, "ps command registered");
  await ps.handler("", {
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      custom: async (factory) => {
        await new Promise((resolve) => {
          const component = factory({ requestRender() {} }, { fg: (_c, t) => t }, {}, resolve);
          component.handleInput("q");
        });
      },
    },
    sessionManager: { getSessionId: () => "owner-1" },
  });
  assert.deepEqual(notifications, [], "ps inspection must not notify");
}

console.log("ps modal smoke: all assertions passed");
