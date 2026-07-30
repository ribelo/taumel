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

const maximum = 1000;
const oversized = [];

for (const path of files) {
  const actual = lineCount(path);
  if (actual > maximum) oversized.push({ path, actual });
}

for (const { path, actual } of oversized) {
  const message = `eng-fs01: ${path} has ${actual} lines (recommended maximum ${maximum})`;
  if (process.env.GITHUB_ACTIONS === "true") {
    console.warn(`::warning file=${path},title=eng-fs01::${message}`);
  } else {
    console.warn(`warning: ${message}`);
  }
}

console.log(
  oversized.length === 0
    ? "source file size check: all files are within the recommendation"
    : `source file size check: ${oversized.length} informational warning(s)`,
);
