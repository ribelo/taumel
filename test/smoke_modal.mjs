import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { showInteractiveList, showScrollModal } from "../src/modal.ts";

const WIDTH = 40;
const LONG = "x".repeat(120);

function makeUi(rendered) {
  return {
    custom: async (factory) => {
      await new Promise((resolve) => {
        const component = factory(
          { requestRender: () => undefined },
          { fg: (color, text) => `[${color}]${text}` },
          {},
          resolve,
        );
        rendered.push(...component.render(WIDTH));
        component.handleInput("q");
      });
    },
  };
}

function assertLinesFit(rendered) {
  for (const line of rendered) {
    assert.ok(
      visibleWidth(line) <= WIDTH,
      `line exceeds width ${WIDTH} (${visibleWidth(line)}): ${line}`,
    );
  }
}

// The kit truncates an over-wide footer, header, and rows to the render width.
{
  const rendered = [];
  await showInteractiveList(makeUi(rendered), {
    items: ["a", "b"],
    renderRow: (item) => [`row ${item} ${LONG}`],
    header: `header ${LONG}`,
    footer: `footer ${LONG}`,
  });
  assert.ok(rendered.length > 0);
  assertLinesFit(rendered);
}

// The scroll modal truncates over-wide content lines and footer.
{
  const rendered = [];
  await showScrollModal(makeUi(rendered), () => [`content ${LONG}`], {
    footer: `footer ${LONG}`,
  });
  assert.ok(rendered.length > 0);
  assertLinesFit(rendered);
}

async function selectAfterInputs(inputs, initialIndex = 0) {
  const ui = {
    custom: async (factory) => {
      await new Promise((resolve) => {
        const component = factory(
          { requestRender: () => undefined },
          { fg: (_color, text) => text },
          {},
          resolve,
        );
        for (const input of inputs) component.handleInput(input);
        component.handleInput("\r");
      });
    },
  };
  return showInteractiveList(ui, {
    items: ["a", "b", "c"],
    renderRow: (item) => [item],
    actionKeys: ["enter"],
    initialIndex,
  });
}

// Kitty keyboard-protocol repeat events move the interactive-list cursor.
{
  const down = await selectAfterInputs(["\x1b[B", "\x1b[1;1:2B"]);
  assert.deepEqual(down, { key: "enter", index: 2 });

  const up = await selectAfterInputs(["\x1b[A", "\x1b[1;1:2A"], 2);
  assert.deepEqual(up, { key: "enter", index: 0 });
}

// shared-0mmo/eta-feaq: modal activity is aborted and awaited before close returns.
{
  let started = false;
  let aborted = false;
  let settled = false;
  let renderRequests = 0;
  const ui = {
    custom: async (factory) => {
      await new Promise((resolve) => {
        const component = factory(
          { requestRender: () => { renderRequests += 1; } },
          { fg: (_color, text) => text },
          {},
          resolve,
        );
        component.handleInput("q");
      });
    },
  };
  await showScrollModal(ui, () => ["content"], {
    activity: async ({ signal, requestRender }) => {
      started = true;
      await new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          requestRender();
          queueMicrotask(() => {
            settled = true;
            resolve();
          });
        }, { once: true });
      });
    },
  });
  assert.equal(started, true);
  assert.equal(aborted, true);
  assert.equal(settled, true, "showScrollModal returned before activity settled");
  assert.equal(renderRequests, 1);
}
