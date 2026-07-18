import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeTaumelGlobalConfig, writeTaumelComposerEnabled } from "../src/global-settings.ts";

const originalJsonParse = JSON.parse;
let racedReplacement;
JSON.parse = function (...args) {
  const parsed = originalJsonParse.apply(this, args);
  const replacement = racedReplacement;
  if (replacement !== undefined) {
    racedReplacement = undefined;
    writeFileSync(replacement.path, replacement.contents, "utf8");
  }
  return parsed;
};

const root = await mkdtemp(join(tmpdir(), "taumel-settings-"));
const malformedPath = join(root, "malformed.json");
const malformed = `${JSON.stringify({ keep: true, taumel: { tools: "wrong" } }, null, 2)}\n`;
await writeFile(malformedPath, malformed);
const rejected = await initializeTaumelGlobalConfig(malformedPath);
if (rejected.ok !== false || !rejected.details.diagnostics.some((item) => item.key === "taumel.tools")) {
  throw new Error(`malformed nested settings were not rejected: ${JSON.stringify(rejected)}`);
}
if (await readFile(malformedPath, "utf8") !== malformed) {
  throw new Error("malformed settings were modified");
}

const validPath = join(root, "valid.json");
await writeFile(validPath, `${JSON.stringify({ keep: true }, null, 2)}\n`);
const initialized = await initializeTaumelGlobalConfig(validPath);
const valid = JSON.parse(await readFile(validPath, "utf8"));
if (
  initialized.ok !== true ||
  valid.keep !== true ||
  valid.taumel?.composer?.enabled !== true ||
  !Array.isArray(valid.taumel?.tools?.disabled) ||
  !Array.isArray(valid.taumel?.skills?.disabled)
) {
  throw new Error(`valid settings were not initialized safely: ${JSON.stringify({ initialized, valid })}`);
}

// shared-r544: a malformed replacement after the read must not be overwritten
// using the stale parsed document.
for (const [name, update] of [
  ["initialize", (path) => initializeTaumelGlobalConfig(path)],
  ["composer", (path) => writeTaumelComposerEnabled(path, false)],
]) {
  const path = join(root, `${name}-raced.json`);
  const malformedReplacement = `{ raced malformed ${name}`;
  await writeFile(path, `${JSON.stringify({ keep: name }, null, 2)}\n`);
  racedReplacement = { path, contents: malformedReplacement };
  await assert.rejects(update(path), /changed after authorization/);
  assert.equal(racedReplacement, undefined, "the test must replace the file during the settings read");
  assert.equal(await readFile(path, "utf8"), malformedReplacement);
}

JSON.parse = originalJsonParse;
