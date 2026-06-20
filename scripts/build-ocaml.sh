set -eu

dune build bin/taumel_footer.bc.js
mkdir -p dist
rm -f dist/taumel_footer.cjs
cp _build/default/bin/taumel_footer.bc.js dist/taumel_footer.cjs
chmod u+w dist/taumel_footer.cjs
