import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initializeTaumelGlobalConfig } from "../src/global-settings.ts";

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
