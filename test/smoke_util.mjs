import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAuthorizationPath, writePatchFiles } from "../src/util.ts";

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

  const targetPath = join(root, "target.txt");
  const linkPath = join(root, "link.txt");
  await writeFile(targetPath, "via-target\n", "utf8");
  await symlink(targetPath, linkPath);
  await writePatchFiles({
    deletes: [],
    writes: [{ path: linkPath, contents: "via-link\n" }],
  });
  assert.equal(await readFile(targetPath, "utf8"), "via-link\n", "writes through a final symlink should update the target");
  assert.equal(await readFile(linkPath, "utf8"), "via-link\n", "symlink path should still read the updated target");

  const rollbackTargetPath = join(root, "rollback-target.txt");
  const rollbackLinkPath = join(root, "rollback-link.txt");
  await writeFile(rollbackTargetPath, "rollback-original\n", "utf8");
  await symlink(rollbackTargetPath, rollbackLinkPath);
  await assert.rejects(() => writePatchFiles({
    deletes: [],
    writes: [
      { path: rollbackLinkPath, contents: "rollback-changed\n" },
      { path: failingPath, contents: "still cannot replace directory\n" },
    ],
  }));
  assert.equal(await readFile(rollbackTargetPath, "utf8"), "rollback-original\n", "rollback should restore a symlink write's target contents");
  assert.equal(await readFile(rollbackLinkPath, "utf8"), "rollback-original\n", "rollback should preserve the final symlink");

  const directoryTarget = join(root, "directory-target");
  const directoryLink = join(root, "directory-link");
  await mkdir(directoryTarget);
  await symlink(directoryTarget, directoryLink);
  assert.equal(
    resolveAuthorizationPath(join(directoryLink, "new.txt")),
    join(directoryTarget, "new.txt"),
    "authorization paths should resolve the nearest existing symlink parent",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("util smoke: all assertions passed");
