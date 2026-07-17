import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const tempDir = mkdtempSync(join(tmpdir(), "taumel-view-media-"));
const artifact = join(tempDir, "taumel.cjs");
const image = join(tempDir, "pixel.png");

copyFileSync(fileURLToPath(new URL("../dist/taumel.cjs", import.meta.url)), artifact);
writeFileSync(
  image,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

globalThis.require = createRequire(import.meta.url);
globalThis.taumelPhoton = globalThis.require("@silvia-odwyer/photon-node");
createRequire(import.meta.url)(artifact);

const core = globalThis.taumel.init({
  on: () => undefined,
  eventsOn: () => () => undefined,
  emit: () => undefined,
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  setFooter: () => undefined,
  sessionSnapshot: () => ({ cwd: tempDir, provider: "test", model: "test" }),
  getGitBranch: () => "main",
  onBranchChange: () => () => undefined,
  requestRender: () => undefined,
  themeFg: (_theme, _color, value) => value,
});
const result = core.call("viewMedia", [{ path: image, defaultCwd: tempDir }]);
if (result?.details?.ok !== true) {
  throw new Error(`view_media failed to resolve its image dependency: ${JSON.stringify(result?.details)}`);
}

rmSync(tempDir, { recursive: true });
