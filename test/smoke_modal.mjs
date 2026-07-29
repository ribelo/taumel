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
