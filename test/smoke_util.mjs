import { strict as assert } from "node:assert";
import { renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizeMutationPaths, readJsonObjectForAtomicUpdate, resolveAuthorizationPath, threadCatalogFacts, writeFileAtomically, writePatchFiles } from "../src/util.ts";

async function writeAuthorizedPatch(application) {
  const paths = [...application.deletes, ...application.writes.map((write) => write.path)];
  return writePatchFiles({ ...application, authorizations: await authorizeMutationPaths(paths) });
}

const root = await mkdtemp(join(tmpdir(), "taumel-util-"));

try {
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, '{"preserved":true}\n', "utf8");
  const settingsRead = await readJsonObjectForAtomicUpdate(settingsPath);
  const racedMalformedSettings = "{ raced malformed settings";
  await writeFile(settingsPath, racedMalformedSettings, "utf8");
  await assert.rejects(
    writeFileAtomically(settingsRead.authorization, '{"replacement":true}\n'),
    /changed after authorization/,
  );
  assert.equal(await readFile(settingsPath, "utf8"), racedMalformedSettings);

  const firstPath = join(root, "first.txt");
  const failingPath = join(root, "raced.txt");
  const parkedFailingPath = join(root, "raced-original.txt");
  await writeFile(firstPath, "original\n", "utf8");
  await writeFile(failingPath, "raced original\n", "utf8");
  let failingContentsReads = 0;
  const racedWrite = {
    path: failingPath,
    get contents() {
      failingContentsReads += 1;
      if (failingContentsReads === 2) {
        renameSync(failingPath, parkedFailingPath);
        writeFileSync(failingPath, "replacement inode\n");
      }
      return "must not commit\n";
    },
  };

  await assert.rejects(
    () =>
      writeAuthorizedPatch({
        deletes: [],
        writes: [
          { path: firstPath, contents: "changed\n" },
          racedWrite,
        ],
      }),
    "writePatchFiles should fail when a later write cannot be committed",
  );

  assert.equal(await readFile(firstPath, "utf8"), "original\n", "failed patches should roll back earlier writes");
  assert.equal(await readFile(failingPath, "utf8"), "replacement inode\n", "failed patches should not overwrite a replacement inode");

  const deletePath = join(root, "delete.txt");
  const undeletablePath = join(root, "undeletable-directory");
  await writeFile(deletePath, "delete original\n", "utf8");
  await mkdir(undeletablePath);

  await assert.rejects(
    () =>
      writeAuthorizedPatch({
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
  await writeAuthorizedPatch({
    deletes: [],
    writes: [{ path: linkPath, contents: "via-link\n" }],
  });
  assert.equal(await readFile(targetPath, "utf8"), "via-link\n", "writes through a final symlink should update the target");
  assert.equal(await readFile(linkPath, "utf8"), "via-link\n", "symlink path should still read the updated target");

  const rollbackTargetPath = join(root, "rollback-target.txt");
  const rollbackLinkPath = join(root, "rollback-link.txt");
  await writeFile(rollbackTargetPath, "rollback-original\n", "utf8");
  await symlink(rollbackTargetPath, rollbackLinkPath);
  const rollbackFailurePath = join(root, "rollback-failure-directory");
  await mkdir(rollbackFailurePath);
  await assert.rejects(() => writeAuthorizedPatch({
    deletes: [],
    writes: [
      { path: rollbackLinkPath, contents: "rollback-changed\n" },
      { path: rollbackFailurePath, contents: "still cannot replace directory\n" },
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

  const sessionsDir = join(root, "sessions");
  await mkdir(sessionsDir);
  assert.deepEqual(
    threadCatalogFacts({ cwd: root, sessionManager: { getSessionDir: () => sessionsDir } }),
    { cwd: root, home: process.env.HOME, override: sessionsDir },
    "thread discovery must prioritize Pi's configured session directory",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("util smoke: all assertions passed");
