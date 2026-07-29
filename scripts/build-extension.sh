set -eu

mkdir -p dist
version="${TAUMEL_VERSION:-}"
version_json="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$version")"
bun build src/index.ts \
  --target=node \
  --format=esm \
  --packages=external \
  --define "TAUMEL_RELEASE_VERSION=$version_json" \
  --outfile=dist/extension.js
