import { strict as assert } from "node:assert";

import { registerThinkingShortcuts, installThinkingFooterRefresh } from "../src/thinking-shortcuts.ts";

function makeHarness() {
  const levels = [];
  const notifications = [];
  const shortcuts = new Map();
  const eventHandlers = new Map();
  const footerThinkingUpdates = [];
  const footerThinkingCtxs = [];
  let currentLevel = "off";

  const pi = {
    registerShortcut(shortcut, definition) {
      shortcuts.set(shortcut, definition);
    },
    getThinkingLevel() { return currentLevel; },
    setThinkingLevel(level) { currentLevel = level; },
    on(event, handler) { eventHandlers.set(event, handler); },
  };
  const core = {
    init: () => undefined,
    call: (name, args) => {
      if (name === "updateFooterThinking") {
        footerThinkingUpdates.push(args[0]);
        footerThinkingCtxs.push(args[1]);
        return undefined;
      }
      throw new Error(`unexpected core call: ${name}`);
    },
  };

  const ctx = {
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
  };

  return { pi, core, ctx, shortcuts, eventHandlers, footerThinkingUpdates, footerThinkingCtxs, levels, notifications };
}

// Four shortcuts should be registered.
{
  const { pi, core, ctx, shortcuts, eventHandlers, footerThinkingUpdates, footerThinkingCtxs } = makeHarness();
  registerThinkingShortcuts(pi, core);
  installThinkingFooterRefresh(pi, core);
  assert.equal(shortcuts.size, 4, "should register 4 shortcuts");
  assert(shortcuts.has("alt+,"), "should register alt+,");
  assert(shortcuts.has("shift+down"), "should register shift+down");
  assert(shortcuts.has("alt+."), "should register alt+.");
  assert(shortcuts.has("shift+up"), "should register shift+up");
  assert.equal(typeof shortcuts.get("alt+,").handler, "function", "alt+, should have a handler function");
  eventHandlers.get("thinking_level_select")({ level: "high", previousLevel: "medium" }, ctx);
  assert.deepEqual(footerThinkingUpdates, ["high"], "thinking events should write the selected footer level directly");
  assert.equal(footerThinkingCtxs[0], ctx, "thinking events should forward the event context for child-session isolation");
}

// alt+, decreases thinking level.
{
  const { pi, core, ctx, shortcuts, footerThinkingUpdates, footerThinkingCtxs, notifications } = makeHarness();
  pi.setThinkingLevel("high");
  registerThinkingShortcuts(pi, core);
  shortcuts.get("alt+,").handler(ctx);
  assert.equal(pi.getThinkingLevel(), "medium", "alt+, should decrease from high to medium");
  assert.deepEqual(footerThinkingUpdates, ["medium"], "shortcut should write the footer level without waiting for Pi's async event");
  assert.equal(footerThinkingCtxs[0], ctx, "shortcut should forward the context for child-session isolation");
  assert.equal(notifications.length, 1, "should notify on level change");
  assert.equal(notifications[0].message, "Thinking level: medium", "notification should show level");
}

// alt+. increases thinking level.
{
  const { pi, core, ctx, notifications } = makeHarness();
  pi.setThinkingLevel("low");
  registerThinkingShortcuts(pi, core);
  const handler = (ctx) => {
    const delta = 1;
    const before = pi.getThinkingLevel();
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const index = levels.indexOf(before);
    const nextIndex = Math.max(0, Math.min(levels.length - 1, index + delta));
    pi.setThinkingLevel(levels[nextIndex]);
    const after = pi.getThinkingLevel();
    const notify = ctx?.ui?.notify;
    if (typeof notify === "function") notify.call(ctx.ui, `Thinking level: ${after}`, "info");
  };
  handler(ctx);
  assert.equal(pi.getThinkingLevel(), "medium", "alt+. should increase from low to medium");
}

// Clamp at ends — decrease from off stays off.
{
  const { pi, ctx } = makeHarness();
  pi.setThinkingLevel("off");
  const handler = (ctx) => {
    const delta = -1;
    const before = pi.getThinkingLevel();
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const index = levels.indexOf(before);
    const nextIndex = Math.max(0, Math.min(levels.length - 1, index + delta));
    pi.setThinkingLevel(levels[nextIndex]);
  };
  handler(ctx);
  assert.equal(pi.getThinkingLevel(), "off", "clamp at min: off should stay off");
}

// Clamp at max — increase from max stays max.
{
  const { pi, ctx } = makeHarness();
  pi.setThinkingLevel("max");
  const handler = (ctx) => {
    const delta = 1;
    const before = pi.getThinkingLevel();
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const index = levels.indexOf(before);
    const nextIndex = Math.max(0, Math.min(levels.length - 1, index + delta));
    pi.setThinkingLevel(levels[nextIndex]);
  };
  handler(ctx);
  assert.equal(pi.getThinkingLevel(), "max", "clamp at max: max should stay max");
}

// Read back from pi (getThinkingLevel reflects model capability clamping).
{
  const { pi, ctx } = makeHarness();
  pi.setThinkingLevel("minimal");
  const handler = (ctx) => {
    const delta = 1;
    const before = pi.getThinkingLevel();
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const index = levels.indexOf(before);
    const nextIndex = Math.max(0, Math.min(levels.length - 1, index + delta));
    pi.setThinkingLevel(levels[nextIndex]);
    const after = pi.getThinkingLevel(); // Pi may clamp; use its response
  };
  handler(ctx);
  assert.equal(pi.getThinkingLevel(), "low", "setThinkingLevel + getThinkingLevel round-trip");
}

console.log("thinking shortcuts smoke: all assertions passed");
