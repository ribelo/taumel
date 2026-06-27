set -eu

node scripts/generate-contract-bindings.mjs
dune build --profile release bin/taumel_main.bc.js
mkdir -p dist
rm -f dist/taumel.cjs
cp _build/default/bin/taumel_main.bc.js dist/taumel.cjs
chmod u+w dist/taumel.cjs
