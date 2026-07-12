import { strict as assert } from "node:assert";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { executeVisibilityManager } from "../src/visibility.ts";

initTheme();

for (const category of ["tools", "skills"]) {
  let disabled = [];
  let rendered = [];
  const rows = () => ({
    category,
    title: `${category} visibility`,
    rows: [{
      name: "example",
      state: disabled.includes("example") ? "disabled" : "enabled",
      available: true,
      description: "Example description",
    }],
    disabled,
    unavailable: [],
  });
  const core = {
    call(method, [facts]) {
      if (method === "visibilityRows") return rows();
      if (method === "toggleVisibilityRow") {
        disabled = disabled.includes(facts.name) ? [] : [facts.name];
        return {
          ok: true,
          action: "command_result",
          message: "Visibility updated.",
          details: {
            ...rows(),
            visibilityChanged: true,
            ...(disabled.length ? { disabledName: facts.name } : { enabledName: facts.name }),
          },
        };
      }
      throw new Error(`unexpected core call: ${method}`);
    },
  };
  const ctx = {
    ui: {
      notify: () => undefined,
      custom: (factory) => new Promise((resolve) => {
        const component = factory(
          { requestRender: () => undefined },
          { fg: (_color, text) => text, bold: (text) => text },
          {},
          resolve,
        );
        rendered = component.render(80);
        component.handleInput("\r");
        setTimeout(() => component.handleInput("\x1b"), 0);
      }),
    },
  };

  const result = await executeVisibilityManager(core, { category }, ctx, () => undefined);
  assert.equal(result.ok, true);
  assert.deepEqual(disabled, ["example"], `${category} manager should apply the selected visibility change`);
  assert(rendered.some((line) => line.includes("example") && line.includes("enabled")));
  assert(rendered.some((line) => line.includes("Example description")));
  assert(rendered.some((line) => line.includes("Ctrl+S save to project")));
}
