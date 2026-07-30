#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="$(node -p 'require("./package.json").version ?? ""')"
if [[ ! "$version" =~ ^0\.0\.[0-9]+-g[0-9a-f]{12}$ ]]; then
  echo "release checkout has no valid package version" >&2
  exit 1
fi
grep -Fq "$version" dist/extension.js
test -s dist/taumel.cjs

temporary="$(mktemp -d)"
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

source_checkout="$temporary/source"
mkdir -p "$source_checkout"
git archive HEAD | tar -xf - -C "$source_checkout"
git -C "$source_checkout" init -q
git -C "$source_checkout" config user.name "Taumel release test"
git -C "$source_checkout" config user.email "release-test@localhost"
git -C "$source_checkout" add .
git -C "$source_checkout" commit -q -m "source revision"
source_commit="$(git -C "$source_checkout" rev-parse HEAD)"

cp package.json package-lock.json "$source_checkout/"
mkdir -p "$source_checkout/dist"
cp dist/extension.js dist/taumel.cjs "$source_checkout/dist/"
git -C "$source_checkout" add package.json package-lock.json
git -C "$source_checkout" add -f dist/extension.js dist/taumel.cjs
git -C "$source_checkout" commit -q -m "release v$version"
release_commit="$(git -C "$source_checkout" rev-parse HEAD)"
test "$(git -C "$source_checkout" rev-parse HEAD^)" = "$source_commit"
git -C "$source_checkout" tag -a "v$version" -m "release v$version"

remote="$temporary/taumel.git"
git clone -q --bare "$source_checkout" "$remote"
git_home="$temporary/home"
mkdir -p "$git_home"
git_config="$git_home/.gitconfig"
git config --file "$git_config" \
  "url.file://$remote.insteadOf" "https://github.com/taumel-release-test/taumel"
git_source="git:github.com/taumel-release-test/taumel@v$version"

# ^release-yevc: exercise Pi's Git-package clone, production install, and load path.
agent_dir="$temporary/agent"
mkdir -p "$agent_dir"
install_log="$temporary/install.log"
if ! HOME="$git_home" PI_CODING_AGENT_DIR="$agent_dir" GIT_TERMINAL_PROMPT=0 \
  "$root/node_modules/.bin/pi" install "$git_source" >"$install_log" 2>&1; then
  cat "$install_log" >&2
  exit 1
fi

installed="$(find "$agent_dir/git" -type f -path '*/dist/extension.js' -printf '%h\n' -quit)"
installed="${installed%/dist}"
test -n "$installed"
test "$(git -C "$installed" rev-parse HEAD)" = "$release_commit"
test "$(git -C "$installed" rev-parse "v$version^{commit}")" = "$release_commit"
test "$(git -C "$installed" cat-file -t "refs/tags/v$version")" = "tag"
test "$(node -p "require('$installed/package.json').version")" = "$version"
test ! -e "$installed/node_modules/typescript"

TAUMEL_PI="$root/node_modules/.bin/pi" TAUMEL_RPC_CWD="$temporary" \
  TAUMEL_RPC_HOME="$git_home" PI_CODING_AGENT_DIR="$agent_dir" \
  TAUMEL_EXPECTED_VERSION="$version" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const records = [];
let stdout = "";
let stderr = "";
let statusSent = false;
let inputEnded = false;
const child = spawn(process.env.TAUMEL_PI, ["--mode", "rpc", "--no-session"], {
  cwd: process.env.TAUMEL_RPC_CWD,
  env: {
    ...process.env,
    HOME: process.env.TAUMEL_RPC_HOME,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const completeInputIfReady = () => {
  const status = records.some((record) => record.type === "response" && record.id === "status");
  const notification = records.some((record) =>
    record.type === "extension_ui_request"
    && record.method === "notify"
    && record.message?.startsWith(`Taumel version: ${process.env.TAUMEL_EXPECTED_VERSION}\n`)
  );
  if (status && notification && !inputEnded) {
    inputEnded = true;
    child.stdin.end();
  }
};

const acceptRecord = (record) => {
  records.push(record);
  if (record.type === "response" && record.id === "commands" && !statusSent) {
    statusSent = true;
    child.stdin.write('{"id":"status","type":"prompt","message":"/taumel"}\n');
  }
  completeInputIfReady();
};

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  let newline;
  while ((newline = stdout.indexOf("\n")) !== -1) {
    const line = stdout.slice(0, newline).trim();
    stdout = stdout.slice(newline + 1);
    if (line !== "") acceptRecord(JSON.parse(line));
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

child.stdin.write('{"id":"commands","type":"get_commands"}\n');
const exitCode = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error(`Pi RPC timed out: ${JSON.stringify(records)}\n${stderr}`));
  }, 30_000);
  child.once("error", reject);
  child.once("close", (code) => {
    clearTimeout(timeout);
    resolve(code);
  });
});

assert.equal(exitCode, 0, stderr);
assert.equal(records.some((record) => record.type === "extension_error"), false);
const commands = records.find((record) => record.type === "response" && record.id === "commands");
assert.equal(commands?.success, true, JSON.stringify(records));
assert.ok(commands.data.commands.some((command) => command.name === "taumel"));
const status = records.find((record) => record.type === "response" && record.id === "status");
assert.equal(status?.success, true, JSON.stringify(records));
const notification = records.find((record) =>
  record.type === "extension_ui_request"
  && record.method === "notify"
  && record.message?.startsWith(`Taumel version: ${process.env.TAUMEL_EXPECTED_VERSION}\n`)
);
assert.ok(notification, "installed /taumel did not report the release version");
NODE

printf 'release checkout smoke passed: %s\n' "$version"
