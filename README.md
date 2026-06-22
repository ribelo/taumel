# taumel

Taumel is a standalone OCaml/js_of_ocaml rewrite experiment for the tau pi
extension. It does not depend on the Tau codebase.

The OCaml core owns policy and domain behavior: capability profiles, tool
authorization, sandbox policy, mutation planning, sub-agents, goals, Ralph-loop
state, structured user input, thread lookup, OpenAI usage rendering, Exa HTTP
tools, and the footer model. TypeScript owns the Pi-facing tool contracts with
TypeBox schemas, validates tool arguments before calling OCaml, and stays
otherwise focused on Pi loading and host-adapter side effects.

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
npm run test:ocaml
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
