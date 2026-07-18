// sandbox-w54h / sandbox-fx9n: anchored mutations stay confined to the authorized
// canonical destination under ancestor, intermediate, and final-component swaps,
// fail closed when descriptor anchoring is unavailable, and can never be redirected
// outside by a concurrent process racing the workspace namespace.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { constants, existsSync, renameSync, symlinkSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  descriptorPath,
  DescriptorPathUnavailableError,
  openPinnedDirectory,
  setDescriptorPathProbeOverrideForTests,
} from "../src/descriptor-paths.ts";
import {
  appendToFile,
  authorizeMutationPaths,
  readAuthorizedFile,
  readJsonObjectForAtomicUpdate,
  writeFileAtomically,
  writePatchFiles,
} from "../src/util.ts";

const root = await mkdtemp(join(tmpdir(), "taumel-descriptor-paths-"));
const workspace = join(root, "workspace");
const authorized = join(workspace, "authorized");
const parked = join(workspace, "parked");
const outside = join(root, "outside");
await mkdir(authorized, { recursive: true });
await mkdir(outside);

async function authorize(path) {
  const [authorization] = await authorizeMutationPaths([path]);
  return authorization;
}

async function exists(path) {
  try { await lstat(path); return true; } catch { return false; }
}

function swapDirectoryForSymlink(target, parkedName) {
  const parkedPath = join(workspace, parkedName);
  renameSync(target, parkedPath);
  symlinkSync(outside, target, "dir");
  return parkedPath;
}

async function restoreSwap(target, parkedPath) {
  await rm(target, { force: true });
  renameSync(parkedPath, target);
}

try {
  // 1. Pin-then-swap confinement (primitive level): a mutation addressed through
  //    a descriptor pinned before the swap lands in the real directory even while
  //    the pathname points outside.
  {
    const anchor = await openPinnedDirectory(authorized);
    const parkedPath = swapDirectoryForSymlink(authorized, "parked-1");
    try {
      const created = await open(
        descriptorPath(anchor, "victim.txt"),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o666,
      );
      await created.writeFile("host write\n");
      await created.close();
      assert.ok(await exists(join(parkedPath, "victim.txt")), "descriptor write must land in the pinned directory");
      assert.ok(!(await exists(join(outside, "victim.txt"))), "descriptor write must not escape outside");
    } finally {
      await anchor.close();
      await restoreSwap(authorized, parkedPath);
    }
  }

  // 2. Normal anchored operations still work: append (new + existing), atomic
  //    write (create + overwrite), authorized read, patch write + delete.
  {
    const appendPath = join(authorized, "append.txt");
    await appendToFile(await authorize(appendPath), "first\n");
    await appendToFile(await authorize(appendPath), "second\n");
    assert.equal(await readFile(appendPath, "utf8"), "first\nsecond\n");

    const atomicPath = join(authorized, "atomic.txt");
    await writeFileAtomically(await authorize(atomicPath), "one\n");
    await writeFileAtomically(await authorize(atomicPath), "two\n");
    assert.equal(await readFile(atomicPath, "utf8"), "two\n");

    const read = await readAuthorizedFile(await authorize(atomicPath));
    assert.equal(new TextDecoder().decode(read.contents), "two\n");

    const nestedPath = join(authorized, "made", "deep", "nested.txt");
    await writeFileAtomically(await authorize(nestedPath), "nested\n");
    assert.equal(await readFile(nestedPath, "utf8"), "nested\n", "mkdir-p through the anchor must still work");

    const patchPath = join(authorized, "patch.txt");
    await writePatchFiles({
      deletes: [],
      writes: [{ path: patchPath, contents: "patched\n" }],
      authorizations: await authorizeMutationPaths([patchPath]),
    });
    assert.equal(await readFile(patchPath, "utf8"), "patched\n");
    await writePatchFiles({
      deletes: [patchPath],
      writes: [],
      authorizations: await authorizeMutationPaths([patchPath]),
    });
    assert.ok(!(await exists(patchPath)), "patch delete must remove the file");
  }

  // 3. A swapped anchor fails closed instead of following the symlink outside.
  for (const mutate of [
    ["append", async (path) => appendToFile(await authorize(path), "x\n")],
    ["atomic write", async (path) => writeFileAtomically(await authorize(path), "x\n")],
  ]) {
    const targetPath = join(authorized, `anchor-swap-${mutate[0].includes("atomic") ? "atomic" : "append"}.txt`);
    const authorization = await authorize(targetPath);
    const parkedPath = swapDirectoryForSymlink(authorized, `parked-3-${targetPath.split("/").pop()}`);
    try {
      const attack = mutate[0] === "append"
        ? appendToFile(authorization, "must not land\n")
        : writeFileAtomically(authorization, "must not land\n");
      await assert.rejects(attack, `${mutate[0]} must reject a swapped anchor`);
      assert.ok(!(await exists(join(outside, targetPath.split("/").pop()))), `${mutate[0]} must not escape outside`);
    } finally {
      await restoreSwap(authorized, parkedPath);
    }
  }

  // 4. A swapped intermediate component fails closed.
  {
    const deepPath = join(authorized, "sub", "deep", "new.txt");
    await mkdir(join(authorized, "sub"));
    const authorization = await authorize(deepPath);
    await mkdir(join(authorized, "sub", "deep"));
    renameSync(join(authorized, "sub", "deep"), join(authorized, "sub", "deep-parked"));
    symlinkSync(outside, join(authorized, "sub", "deep"), "dir");
    try {
      await assert.rejects(
        appendToFile(authorization, "must not land\n"),
        "append must reject a swapped intermediate directory",
      );
      assert.ok(!(await exists(join(outside, "new.txt"))), "swapped intermediate must not escape outside");
    } finally {
      await rm(join(authorized, "sub", "deep"), { force: true });
      renameSync(join(authorized, "sub", "deep-parked"), join(authorized, "sub", "deep"));
    }
  }

  // 5. A final component swapped for an outside-pointing symlink fails closed
  //    and leaves the outside file untouched.
  {
    const outsideFile = join(outside, "final-swap-target.txt");
    await writeFile(outsideFile, "outside contents\n", "utf8");
    const targetPath = join(authorized, "final-swap.txt");
    await writeFile(targetPath, "original\n", "utf8");
    const authorization = await authorize(targetPath);
    await rm(targetPath);
    symlinkSync(outsideFile, targetPath);
    try {
      await assert.rejects(appendToFile(authorization, "must not land\n"));
      await assert.rejects(writeFileAtomically(authorization, "must not land\n"));
      assert.equal(await readFile(outsideFile, "utf8"), "outside contents\n", "outside file must stay untouched");
    } finally {
      await rm(targetPath, { force: true });
    }
  }

  // 6. Descriptor paths unavailable -> guarded mutation fails closed, while an
  //    unguarded caller that opted into the pathname fallback still mutates.
  {
    setDescriptorPathProbeOverrideForTests(() => Promise.reject(new DescriptorPathUnavailableError()));
    try {
      await assert.rejects(
        appendToFile(await authorize(join(authorized, "no-procfs.txt")), "x\n"),
        /procfs/,
      );
      const fallbackPath = join(authorized, "fallback-settings.json");
      await writeFileAtomically(fallbackPath, '{"a":1}\n', true);
      assert.equal(await readFile(fallbackPath, "utf8"), '{"a":1}\n', "pathname fallback must still write");
      const read = await readJsonObjectForAtomicUpdate(fallbackPath, true);
      assert.deepEqual(read.settings, { a: 1 });
      await assert.rejects(writeFileAtomically(fallbackPath, '{"b":2}\n'), /procfs/);
      assert.equal(await readFile(fallbackPath, "utf8"), '{"a":1}\n', "guarded write must not use the fallback implicitly");
    } finally {
      setDescriptorPathProbeOverrideForTests(undefined);
    }
  }

  // 7. Bounded black-box race: a concurrent process swapping the authorized
  //    directory for an outside-pointing symlink can never redirect an anchored
  //    append. Zero escapes are expected by construction, not by probability.
  {
    let succeeded = 0;
    const count = 1500;
    const paths = Array.from({ length: count }, (_, index) => join(authorized, `race-${index}.txt`));
    const authorizations = await authorizeMutationPaths(paths);
    const racer = spawn(process.execPath, ["-e", String.raw`
      const fs = require("node:fs");
      const [parent, parked, outside] = process.argv.slice(1);
      process.stdout.write("ready\n");
      for (;;) {
        try { fs.renameSync(parent, parked); } catch {}
        try { fs.symlinkSync(outside, parent, "dir"); } catch {}
        try { fs.unlinkSync(parent); } catch {}
        try { fs.renameSync(parked, parent); } catch {}
      }
    `, authorized, parked, outside], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((resolve, reject) => {
      racer.stdout.once("data", resolve);
      racer.once("error", reject);
      racer.once("exit", (code) => reject(new Error(`racer exited ${code}`)));
    });
    try {
      for (const authorization of authorizations) {
        try { await appendToFile(authorization, "host write\n"); succeeded += 1; } catch {}
      }
      for (let index = 0; index < count; index += 1) {
        assert.ok(
          !existsSync(join(outside, `race-${index}.txt`)),
          `raced append must never create outside/target-${index}.txt`,
        );
      }
      assert.ok(succeeded > 0, "at least some raced appends should succeed when the path is stable");
    } finally {
      racer.kill("SIGKILL");
      await new Promise((resolve) => racer.once("exit", resolve));
      for (let attempt = 0; attempt < 100 && !(await exists(authorized)); attempt += 1) {
        try { await rm(authorized, { force: true }); } catch {}
        try { renameSync(parked, authorized); } catch {}
      }
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("descriptor paths smoke: all assertions passed");
