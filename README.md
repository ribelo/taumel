# taumel

Taumel is a standalone OCaml/js_of_ocaml rewrite experiment for the tau pi
extension. It does not depend on the Tau codebase.

The OCaml core owns the kept rewrite surface: shared infrastructure contracts,
capability profiles, the tool gateway, sandbox policy and canonical tools,
sub-agents, goals, Ralph-loop state, structured user input, thread lookup,
OpenAI usage rendering, and the footer model. The TypeScript entrypoint remains
a small pi loading and host-adapter boundary.

## Build

Initialize the shared normal OCaml opam switch and local Eta pins:

```sh
nix develop -c taumel-opam-init
```

Build and copy the jsoo artifact to `dist/taumel.cjs`:

```sh
npm run build:ocaml
```

Run tests:

```sh
nix develop -c dune runtest
```

Run the full local gate:

```sh
npm run gate
```

## Install As A pi Extension

```sh
mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD" ~/.pi/agent/extensions/taumel
```
