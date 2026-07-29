#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

revision="${1:-HEAD}"
version="$(bash scripts/release-version.sh "$revision")"
node scripts/set-release-version.mjs "$version"

if [[ ! -s dist/taumel.cjs ]]; then
  echo "dist/taumel.cjs is missing; run the full gate before staging a release" >&2
  exit 1
fi

TAUMEL_VERSION="$version" npm run build:extension
# ^release-chbb: both runtime artifacts must be present before publication.
test -s dist/extension.js
grep -Fq "$version" dist/extension.js
printf '%s\n' "$version"
