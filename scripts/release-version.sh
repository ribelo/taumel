#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

revision="${1:-HEAD}"
git cat-file -e "${revision}^{commit}"
count="$(git rev-list --count "$revision")"
hash="$(git rev-parse --short=12 "$revision")"
printf '0.0.%s-g%s\n' "$count" "$hash"
