set -eu

mkdir -p dist
bun build src/index.ts \
  --target=node \
  --format=esm \
  --packages=external \
  --outfile=dist/extension.js
