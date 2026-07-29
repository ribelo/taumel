# Repository Guidelines

## Project Structure & Module Organization

Taumel is a Pi extension with an OCaml policy core and a TypeScript host
adapter. Put reusable OCaml domain logic in `lib/`; `bin/` contains runtime
bridges, tool dispatch, Node bindings, and the `taumel_main.ml` entry point.
TypeScript integration, rendering, and Pi-facing effects live in `src/`.
Generated bridge code belongs in `bin/generated/` and is produced by scripts,
not edited by hand. Tests are in `test/`: `test_*.ml` files are Dune tests and
`smoke_*.mjs` files exercise built artifacts and host boundaries. Requirements
and architecture decisions live under `docs/requirements/` and `docs/adr/`.

## Build, Test, and Development Commands

Development requires Nix with flakes enabled, Node.js, and npm.

- `npm ci` installs the locked JavaScript dependencies.
- `npm run ocaml:init` initializes the pinned OCaml/Eta environment.
- `npm run build` regenerates contracts and builds OCaml and extension artifacts.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run test:ocaml` runs the Dune test suite.
- `npm run smoke:tool-contracts` runs one focused smoke suite; other
  `smoke:*` scripts follow the same pattern.
- `npm run gate` runs the complete required quality gate.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript and conventional OCaml formatting.
Run `ocamlformat` using the checked-in `.ocamlformat` configuration
(`module-item-spacing=sparse`). TypeScript uses strict unused-symbol checks.
Name OCaml modules and files in `snake_case`; use `kebab-case` for TypeScript
files and `camelCase` for identifiers. Keep bridge contracts typed and update
both OCaml and TypeScript sides when their shared shape changes.

## Testing Guidelines

Add focused regression coverage beside the affected layer. Name OCaml tests
`test_<behavior>.ml` and host/artifact checks `smoke_<behavior>.mjs`; register
new OCaml tests in `test/dune`. Run the smallest relevant test during
development, then `npm run gate` before submission. No numeric coverage target
is defined.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, scoped subjects such as
`cron: generate task ids...` and `eta: typed node_date binding...`. Keep each
commit focused. Pull requests should explain the behavior change, identify
affected contracts or requirements, link relevant issues, and list verification
commands. Include screenshots only for visible TUI changes.
