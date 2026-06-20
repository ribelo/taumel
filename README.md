# taumel

Taumel is a standalone pi extension rewrite experiment for tau.

The first milestone is a footer-only extension implemented in OCaml, compiled
to JavaScript with js_of_ocaml, and run on Eta_jsoo. The TypeScript entrypoint is
only a pi loading and host-adapter boundary.

## Build

Initialize the shared normal OCaml opam switch and local Eta pins:

```sh
nix develop -c taumel-opam-init
```

Build and copy the jsoo artifact to `dist/taumel_footer.cjs`:

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
