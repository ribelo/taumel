import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");
const bash = spawnSync("which", ["bash"], { encoding: "utf8" }).stdout.trim();
assert(bash, "bash must be resolvable for the PTY smoke test");

let output = "";
const result = await new Promise((resolve) => {
  const terminal = pty.spawn(bash, ["-c", "printf pty-ok"], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: process.env,
  });
  terminal.onData((chunk) => output += chunk);
  terminal.onExit(resolve);
});

assert.equal(result.exitCode, 0);
assert.match(output, /pty-ok/);
console.log("exec PTY smoke: all assertions passed");
