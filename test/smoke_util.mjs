import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writePatchFiles } from "../src/util.ts";

const root = await mkdtemp(join(tmpdir(), "taumel-util-"));

try {
  const firstPath = join(root, "first.txt");
  const failingPath = join(root, "as-directory");
  await writeFile(firstPath, "original\n", "utf8");
  await mkdir(failingPath);

  await assert.rejects(
    () =>
      writePatchFiles({
        deletes: [],
        writes: [
          { path: firstPath, contents: "changed\n" },
          { path: failingPath, contents: "cannot replace directory\n" },
        ],
      }),
    "writePatchFiles should fail when a later write cannot be committed",
  );

  assert.equal(await readFile(firstPath, "utf8"), "original\n", "failed patches should roll back earlier writes");

  const deletePath = join(root, "delete.txt");
  const undeletablePath = join(root, "undeletable-directory");
  await writeFile(deletePath, "delete original\n", "utf8");
  await mkdir(undeletablePath);

  await assert.rejects(
    () =>
      writePatchFiles({
        deletes: [deletePath, undeletablePath],
        writes: [],
      }),
    "writePatchFiles should fail when a later delete cannot be committed",
  );

  assert.equal(await readFile(deletePath, "utf8"), "delete original\n", "failed patches should roll back earlier deletes");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("util smoke: all assertions passed");
