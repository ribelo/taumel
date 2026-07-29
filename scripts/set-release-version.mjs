#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!/^0\.0\.\d+-g[0-9a-f]{12}$/.test(version ?? "")) {
  throw new Error("expected release version 0.0.<commit-count>-g<12-character-source-hash>");
}

// ^release-h2oz: package metadata and the bundled status version share one value.
for (const name of ["package.json", "package-lock.json"]) {
  const document = JSON.parse(await readFile(name, "utf8"));
  if (name === "package.json") document.version = version;
  else {
    document.version = version;
    document.packages[""].version = version;
  }
  await writeFile(name, `${JSON.stringify(document, null, 2)}\n`);
}
