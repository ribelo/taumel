set -eu

switch_name="${TAUMEL_OPAM_SWITCH:-5.4.1}"
export OPAMROOT="${OPAMROOT:-$HOME/.cache/opam}"

if ! opam switch list --short 2>/dev/null | grep -Fxq "$switch_name"; then
  taumel-opam-init
fi

export OPAMSWITCH="$switch_name"
eval "$(opam env --switch "$switch_name" --set-switch)"

if ! ocamlfind query js_of_ocaml >/dev/null 2>&1; then
  taumel-opam-init
  eval "$(opam env --switch "$switch_name" --set-switch)"
fi

node scripts/generate-contract-bindings.mjs
dune build --profile release bin/taumel_main.bc.js
mkdir -p dist
rm -f dist/taumel.cjs
cp _build/default/bin/taumel_main.bc.js dist/taumel.cjs
chmod u+w dist/taumel.cjs
