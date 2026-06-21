set -eu

dune build bin/taumel_main.bc.js
mkdir -p dist
rm -f dist/taumel.cjs
cp _build/default/bin/taumel_main.bc.js dist/taumel.cjs
chmod u+w dist/taumel.cjs
