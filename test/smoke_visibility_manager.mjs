import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { executeVisibilityManager, saveProjectVisibility } from "../src/visibility.ts";

initTheme();

for (const category of ["tools", "skills"]) {
  let disabled = [];
  let rendered = [];
  const name = category === "tools" ? "read" : "example";
  const suppliedDescription = category === "tools" ? "pure" : "Example description";
  const rows = () => ({
    category,
    title: `${category} visibility`,
    rows: [{
      name,
      state: disabled.includes(name) ? "disabled" : "enabled",
      available: true,
      description: suppliedDescription,
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
  assert.deepEqual(disabled, [name], `${category} manager should apply the selected visibility change`);
  assert(rendered.some((line) => line.includes(name) && line.includes("enabled")));
  if (category === "tools") {
    assert(rendered.some((line) => line.includes("Read a UTF-8 text file.")));
    assert(!rendered.some((line) => line.includes("pure")));
  } else {
    assert(rendered.some((line) => line.includes("Example description")));
  }
  assert(rendered.some((line) => line.includes("Ctrl+S save to project")));
}

// shared-r544: malformed settings survive rejected read-modify-write operations.
const malformedRoot = await mkdtemp(join(tmpdir(), "taumel-visibility-malformed-"));
try {
  const settingsPath = join(malformedRoot, ".pi", "settings.json");
  await mkdir(join(malformedRoot, ".pi"), { recursive: true });
  const malformed = "{ malformed visibility settings";
  await writeFile(settingsPath, malformed);
  const details = { category: "tools", title: "Tool visibility", rows: [], disabled: [], unavailable: [] };
  const outcome = await saveProjectVisibility("tools", ["read"], details, {
    cwd: malformedRoot, isProjectTrusted: () => true,
  });
  assert.equal(outcome.ok, false);
  assert.equal(await readFile(settingsPath, "utf8"), malformed);
} finally {
  await rm(malformedRoot, { recursive: true, force: true });
}
