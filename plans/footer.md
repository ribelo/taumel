---
kind: requirement
status: draft
tags: [footer, ui]
depends_on: ["[[plans/sandbox]]"]
---
# Footer

## Intent

The footer is a whole-footer replacement driven from OCaml through a tiny
TypeScript entrypoint. Display formatting lives in a pure OCaml model; Pi and
JavaScript interop stay behind a narrow adapter. The refresh loop uses
`Eta_jsoo`.

## Requirements

- **footer-rp01** (ubiquitous): The system shall replace the whole footer from the extension user's perspective and install it from OCaml through a tiny TypeScript entrypoint.
- **footer-ds01** (ubiquitous): The system shall display session, model/provider/status, git branch and change delta, and sandbox status.
- **footer-ar01** (ubiquitous): The system shall hold display formatting in a pure OCaml model, keep Pi/JavaScript interop behind a narrow adapter, and let OCaml own setup, event registration, state, and render decisions.
- **footer-rl01** (ubiquitous): The system shall drive the footer refresh loop with `Eta_jsoo`.
- **footer-om01** (ubiquitous): The system shall omit a backlog indicator and persistent footer settings.
