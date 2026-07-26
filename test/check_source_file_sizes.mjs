import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function lineCount(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).length - 1;
}

const files = execFileSync("find", ["lib", "bin", "src", "-type", "f"], {
  encoding: "utf8",
}).trim().split("\n").filter((path) =>
  path !== "" && !path.includes("/generated/") && /\.(?:ml|mli|ts)$/.test(path)
);

for (const path of files) {
  const maximum = 1000;
  const actual = lineCount(path);
  assert.ok(actual <= maximum, `eng-fs01: ${path} has ${actual} lines (maximum ${maximum})`);
}

console.log("source file size check: all assertions passed");
