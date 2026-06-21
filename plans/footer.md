# Footer

## Decision

Ported as a whole replacement.

## Classification

Port with selective redesign.

## Why keep it

The footer is always visible and is useful as a low-risk dogfooding target for
Taumel: it exercises Pi integration, rendering, events, local state, git status
polling, and Eta_jsoo scheduling without pulling in Tau's larger systems.

## Preserve

- Whole-footer replacement behavior from the extension user's perspective.
- Session and model/provider/status display.
- Git branch and change delta display.
- Sandbox status signal.
- Lightweight host adapter with a tiny TypeScript entrypoint.

## Redesign

- Move display formatting into a pure OCaml model.
- Keep Pi/JavaScript interop behind a narrow adapter.
- Let OCaml own setup, event registration, state, and render decisions.
- Use Eta_jsoo for the refresh loop instead of Effect.

## Omit

- Backlog indicator.
- Persistent footer settings.
- Broader Tau service graph dependencies.

## Acceptance

- Tau no longer installs its footer.
- Taumel installs a footer from OCaml through the tiny TypeScript entrypoint.
- Pi can load the installed Taumel extension.
- The visible footer works well enough for side-by-side comparison.
