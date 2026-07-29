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

commands_output="$temporary/commands.jsonl"
status_output="$temporary/status.jsonl"
(
  cd "$temporary"
  { printf '%s\n' '{"id":"commands","type":"get_commands"}'; sleep 0.5; } \
    | HOME="$git_home" PI_CODING_AGENT_DIR="$agent_dir" \
        "$root/node_modules/.bin/pi" --mode rpc --no-session >"$commands_output"
  { printf '%s\n' '{"id":"status","type":"prompt","message":"/taumel"}'; sleep 0.5; } \
    | HOME="$git_home" PI_CODING_AGENT_DIR="$agent_dir" \
        "$root/node_modules/.bin/pi" --mode rpc --no-session >"$status_output"
)

TAUMEL_COMMANDS_OUTPUT="$commands_output" TAUMEL_STATUS_OUTPUT="$status_output" \
  TAUMEL_EXPECTED_VERSION="$version" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const records = [];
for (const path of [process.env.TAUMEL_COMMANDS_OUTPUT, process.env.TAUMEL_STATUS_OUTPUT]) {
  records.push(...(await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}
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
