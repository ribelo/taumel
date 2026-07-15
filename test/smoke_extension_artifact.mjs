import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const artifact = join(process.cwd(), "dist", "extension.js");

// agent-um6s: the built module loads from an artifact-only layout with no loose Markdown resources.
const isolatedRoot = mkdtempSync(join(process.cwd(), ".taumel-extension-artifact-"));
try {
  const isolatedDist = join(isolatedRoot, "dist");
  mkdirSync(isolatedDist);
  copyFileSync(artifact, join(isolatedDist, "extension.js"));
  copyFileSync(join(process.cwd(), "dist", "taumel.cjs"), join(isolatedDist, "taumel.cjs"));
  const loaded = await import(pathToFileURL(join(isolatedDist, "extension.js")).href);
  assert.equal(typeof loaded.default, "function");
} finally {
  rmSync(isolatedRoot, { recursive: true, force: true });
}

console.log("extension artifact smoke: all assertions passed");
