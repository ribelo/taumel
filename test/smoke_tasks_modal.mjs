import assert from "node:assert/strict";
import { executeTasksModal } from "../src/tasks-modal.ts";
import { registerGatewayCommands } from "../src/command-executor.ts";

function planPresentation(tasks, status = "active") {
  return {
    planId: "plan-1",
    sessionId: "session-1",
    status,
    statusLabel: status,
    tasks,
    completedTasks: tasks.filter((task) => task.status === "completed" || task.status === "cancelled").length,
    totalTasks: tasks.length,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    timeUsage: "0s",
    timeLimitSeconds: null,
    extensionUnlocked: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function task(overrides = {}) {
  return {
    taskId: "task-ab12",
    title: "Ship feature",
    description: null,
    status: "pending",
    origin: "user",
    depends_on: ["task-zz99"],
    ...overrides,
  };
}

function makeUi(handlers) {
  const renders = [];
  const notifications = [];
  const confirms = [];
  const inputs = [];
  const ui = {
    notify: (message, level) => notifications.push({ message, level }),
    select: async (title, labels) => {
      confirms.push({ title, labels });
      return handlers.confirm === undefined ? labels[0] : handlers.confirm(title, labels);
    },
    input: async (title, placeholder) => {
      inputs.push({ title, placeholder });
      return handlers.input === undefined ? undefined : handlers.input(title, placeholder, inputs.length);
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
  return { ui, renders, notifications, confirms, inputs };
}

// --- list rendering, cursor, depends_on, status colors ---
{
  const plan = planPresentation([
    task({ taskId: "task-aa11", status: "pending", depends_on: ["task-zz99"] }),
    task({ taskId: "task-bb22", title: "Review", status: "in_progress", depends_on: [], origin: "agent" }),
  ]);
  const coreCalls = [];
  const core = {
    call(name, args) {
      coreCalls.push([name, args]);
      if (name === "handleCommand") {
        return {
          ok: true,
          action: "command_result",
          message: "Plan active: 0/2 tasks (0s)",
          details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
          planInspection: true,
        };
      }
      throw new Error(`unexpected: ${name}`);
    },
  };
  const { ui, renders } = makeUi({
    drive(component) {
      const first = component.render(120).join("\n");
      assert.match(first, /\[dim\]task-aa11/);
      assert.match(first, /\[dim\]pending/);
      assert.match(first, /depends on/);
      assert.match(first, /task-zz99/);
      assert.match(first, /\[warning\]in_progress/);
      assert.match(first, /\[accent\]›/);
      assert.match(first, /a add · e edit · s advance · x cancel · d delete · q close/);
      component.handleInput("\x1b[B");
      const second = component.render(120).join("\n");
      const accentRows = second.split("\n").filter((line) => line.includes("[accent]›"));
      assert.equal(accentRows.length, 1);
      assert.match(accentRows[0], /task-bb22/);
      component.handleInput("q");
    },
  });
  const result = await executeTasksModal(core, { ui });
  assert.equal(result.inspection, true);
  assert.equal(result.ok, true);
  assert.ok(renders.length >= 1);
  assert.equal(
    coreCalls.filter(([name]) => name === "handleCommand").length,
    1,
    "close-only session loads plan once",
  );
}

// --- all five actions call the right core commands ---
{
  let plan = planPresentation([
    task({ taskId: "task-aa11", status: "pending", depends_on: [] }),
  ]);
  const commands = [];
  const core = {
    call(name, args) {
      if (name !== "handleCommand") throw new Error(name);
      const input = args[0].args;
      commands.push(input);
      if (input === "") {
        return {
          ok: true,
          action: "command_result",
          message: "summary",
          details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
          planInspection: true,
        };
      }
      if (input.startsWith("task add ")) {
        plan = planPresentation([
          plan.tasks[0],
          task({ taskId: "task-cc33", title: "New task", status: "pending", depends_on: [], description: "desc" }),
        ], "draft");
      } else if (input.startsWith("task edit ")) {
        const id = input.split(" ")[2];
        plan = planPresentation(plan.tasks.map((entry) => (
          entry.taskId === id ? { ...entry, title: "Renamed" } : entry
        )));
      } else if (input.startsWith("task advance ")) {
        const id = input.split(" ")[2];
        plan = planPresentation(plan.tasks.map((entry) => (
          entry.taskId === id ? { ...entry, status: "in_progress" } : entry
        )));
      } else if (input.startsWith("task cancel ")) {
        const id = input.split(" ")[2];
        plan = planPresentation(plan.tasks.map((entry) => (
          entry.taskId === id ? { ...entry, status: "cancelled" } : entry
        )));
      } else if (input.startsWith("task delete ")) {
        const id = input.split(" ")[2];
        const remaining = plan.tasks.filter((entry) => entry.taskId !== id);
        plan = remaining.length === 0
          ? planPresentation([task({ taskId: "task-keep", title: "Keep", depends_on: [] })])
          : planPresentation(remaining);
      }
      return {
        ok: true,
        action: "command_result",
        message: "ok",
        details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
      };
    },
  };
  const textInputs = [
    "New task", "desc", // add
    "Renamed", "", // edit selected (new task after add)
  ];
  let inputIndex = 0;
  const driveKeys = ["a", "e", "s", "x", "d", "q"];
  let driveIndex = 0;
  const { ui } = makeUi({
    input: () => textInputs[inputIndex++] ?? "",
    confirm: (title) => {
      if (title.includes("Cancel")) return "Confirm cancel";
      if (title.includes("Delete")) return "Confirm delete";
      return "Cancel";
    },
    drive(component) {
      const key = driveKeys[driveIndex++];
      if (key !== undefined) component.handleInput(key);
    },
  });
  const actionResult = await executeTasksModal(core, { ui });
  assert.equal(actionResult.inspection, true);
  assert.ok(commands.some((value) => value.startsWith("task add ")));
  assert.ok(commands.some((value) => value.startsWith("task edit ")));
  assert.ok(commands.some((value) => value.startsWith("task advance ")));
  assert.ok(commands.some((value) => value.startsWith("task cancel ")));
  assert.ok(commands.some((value) => value.startsWith("task delete ")));
  const addPayload = JSON.parse(commands.find((value) => value.startsWith("task add ")).slice("task add ".length));
  assert.deepEqual(addPayload, { title: "New task", description: "desc" });
  assert.equal(commands.includes("New task"), false, "must not submit task text as /plan body");
}

// --- destructive confirm required ---
{
  const plan = planPresentation([task({ taskId: "task-aa11", depends_on: [] })]);
  const commands = [];
  const core = {
    call(name, args) {
      if (name !== "handleCommand") throw new Error(name);
      const input = args[0].args;
      commands.push(input);
      return {
        ok: true,
        action: "command_result",
        message: "ok",
        details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
        ...(input === "" ? { planInspection: true } : {}),
      };
    },
  };
  let opened = 0;
  const { ui } = makeUi({
    confirm: () => "Cancel",
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("d");
      else component.handleInput("q");
    },
  });
  await executeTasksModal(core, { ui });
  assert.equal(commands.some((value) => value.startsWith("task delete")), false);
}

// --- advance rejection for terminal tasks (client-side) ---
{
  const plan = planPresentation([task({ taskId: "task-aa11", status: "completed", depends_on: [] })]);
  const commands = [];
  const core = {
    call(name, args) {
      commands.push(args[0].args);
      return {
        ok: true,
        action: "command_result",
        message: "ok",
        details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
        ...(args[0].args === "" ? { planInspection: true } : {}),
      };
    },
  };
  let opened = 0;
  const { ui, notifications } = makeUi({
    drive(component) {
      opened += 1;
      if (opened === 1) component.handleInput("s");
      else component.handleInput("q");
    },
  });
  await executeTasksModal(core, { ui });
  assert.equal(commands.some((value) => value.startsWith("task advance")), false);
  assert.ok(notifications.some((entry) => /cannot advance a completed task/.test(entry.message)));
}

// --- no-plan bootstrap ---
{
  let plan = null;
  const commands = [];
  const core = {
    call(name, args) {
      const input = args[0].args;
      commands.push(input);
      if (input.startsWith("task add ")) {
        plan = planPresentation([task({ taskId: "task-new1", title: "First", depends_on: [] })], "draft");
      }
      return {
        ok: true,
        action: "command_result",
        message: plan ? "Task added." : "No plan.",
        details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
        ...(input === "" ? { planInspection: true } : {}),
      };
    },
  };
  const textInputs = ["First", ""];
  let inputIndex = 0;
  let opened = 0;
  const { ui, renders } = makeUi({
    input: () => textInputs[inputIndex++],
    drive(component) {
      opened += 1;
      if (opened === 1) {
        const text = component.render(120).join("\n");
        assert.match(text, /No plan yet/);
        assert.match(text, /Press a to add/);
        component.handleInput("a");
      } else {
        component.handleInput("q");
      }
    },
  });
  await executeTasksModal(core, { ui });
  assert.ok(commands.some((value) => value.startsWith("task add ")));
  assert.ok(renders.some((lines) => lines.join("\n").includes("No plan yet")));
}

// --- core rejection notifies and modal stays open ---
{
  const plan = planPresentation([
    task({ taskId: "task-aa11", status: "pending", depends_on: [] }),
    task({ taskId: "task-bb22", status: "pending", depends_on: ["task-aa11"] }),
  ]);
  const commands = [];
  const core = {
    call(name, args) {
      const input = args[0].args;
      commands.push(input);
      if (input === "task advance task-bb22") {
        return { ok: false, error: "cannot set plan task to in_progress while dependencies are unfinished" };
      }
      return {
        ok: true,
        action: "command_result",
        message: "ok",
        details: { plan, automation: { continuation: "enabled", requiresUserInput: false } },
        ...(input === "" ? { planInspection: true } : {}),
      };
    },
  };
  let opened = 0;
  const { ui, notifications } = makeUi({
    drive(component) {
      opened += 1;
      if (opened === 1) {
        component.handleInput("\x1b[B");
        component.handleInput("s");
      } else {
        component.handleInput("q");
      }
    },
  });
  await executeTasksModal(core, { ui });
  assert.ok(notifications.some((entry) => /dependencies are unfinished/.test(entry.message)));
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
            { name: "plan", description: "Manage plan" },
            { name: "tasks", description: "Open tasks" },
          ],
        };
      }
      if (method === "planCommandExecution") return { kind: "direct" };
      if (method === "handleCommand") {
        // TS handles /tasks; core is only hit for plan loads inside the modal.
        return {
          ok: true,
          action: "command_result",
          message: "No plan.",
          details: { plan: null, automation: { continuation: "enabled", requiresUserInput: false } },
          planInspection: true,
        };
      }
      if (method === "planCommandNotification") {
        return { kind: "notify", message: args[0].message || "done", level: "info" };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  registerGatewayCommands(pi, core, new Map());
  const tasks = commands.get("tasks");
  assert.ok(tasks, "tasks command registered");
  await tasks.handler("", {
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      custom: async (factory) => {
        await new Promise((resolve) => {
          const component = factory({ requestRender() {} }, { fg: (_c, t) => t }, {}, resolve);
          component.handleInput("q");
        });
      },
    },
  });
  assert.deepEqual(notifications, [], "tasks inspection must not notify");
}

console.log("tasks modal smoke: all assertions passed");
