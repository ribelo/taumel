import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url);
const forbidden = [
  ["Record<string, unknown>", /Record\s*<\s*string\s*,\s*unknown\s*>/g],
  ["isRecord", /\bisRecord\s*\(/g],
  ["temporary interop object", /\b(?:InteropObject|isInteropObject)\b/g],
  ["generic core-call helper", /\b(?:coreCallRecord|coreCallOptionalRecord)\b/g],
  ["unvalidated core.call assignment", /=\s*(?:await\s+)?core\.call\s*\(/g],
  ["unvalidated core.call return", /return\s+(?:await\s+)?core\.call\s*\(/g],
];

const failures = [];
function visit(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) visit(file);
    else if (name.endsWith(".ts")) {
      const source = readFileSync(file, "utf8");
      for (const [label, pattern] of forbidden) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split("\n").length;
          failures.push(`${relative(root.pathname, file)}:${line}: ${label}`);
        }
      }
    }
  }
}

visit(root.pathname);
if (failures.length > 0) {
  throw new Error(`Untyped production boundaries are forbidden:\n${failures.join("\n")}`);
}
