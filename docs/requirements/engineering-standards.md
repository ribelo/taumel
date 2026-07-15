---
kind: requirement
tags: [engineering-standards]
---
# Engineering standards

## Intent

Cross-cutting engineering constraints that hold across every component,
independent of any single feature.

## Requirements

- Each `lib/`, `bin/`, and `src/` source file shall stay at or under 1000 lines, split along cohesive module seams. ^eng-fs01
- Code shall make invalid states unrepresentable where practical. Prefer domain-specific types, explicit variants, and narrow data shapes that prevent misuse over generic records plus late assertions. When an invalid state cannot be made impossible, catch it at the earliest practical boundary, preferably at compile time, then at parse/normalization time, and only lastly through behavior tests or runtime assertions. ^eng-ds01
- Every value returned through the Taumel core-call boundary shall be constructed through the generated builder for its declared bridge contract; code shall not return an ad hoc JavaScript object through that boundary except inside a field that the declared contract explicitly types as open data. ^eng-bc01
- Generated bridge-contract builders shall supply literal discriminants such as `ok`, `action`, and `kind` internally and shall not permit callers to choose those values. ^eng-bc02
- If production OCaml adds an untyped core-call result producer or directly invokes a generated constructor whose contract contains caller-controlled literal discriminants, then the repository gate shall fail. ^eng-bc03
- Every generated OCaml bridge producer shall emit each JavaScript property under exactly the name declared by the corresponding TypeBox transport schema. ^bridge-7m4k
- Taumel single-selection lists shall use Pi's `SelectList`, and Taumel mutable-settings lists shall use Pi's `SettingsList`. These lists shall use Pi's standard themes and built-in filtering, selection, navigation, scrolling, truncation, value presentation, and list hints. Feature-specific workflows shall be composed around the list component. ^eng-l2o2
- The system shall implement only the currently declared contract and shall not provide backward-compatible aliases, adapters, fallback interpretation, dual reads or writes, or state migrations unless a feature requirement explicitly mandates a named exception. ^eng-ce01
- When configuration, persisted state, input, or an artifact conforms only to a superseded contract, the system shall leave it inert and shall not migrate, interpret, resurrect, or expose it through the current model-facing or user-facing contract. ^eng-ce02
- A compatibility or migration exception shall exist only when the user explicitly requires it; design and implementation shall not infer, solicit, or add such an exception by default. ^eng-ce03
- The project shall express behavioral, interface, persistence, and architecture contracts as uniquely identified EARS requirements in `docs/requirements/*.md` and shall treat those requirements as the authoritative design source. ^eng-rq01
- The project shall not create ADRs or use ADRs as an authoritative source for new decisions; it shall capture each new decision by adding or updating the applicable EARS requirements. ^eng-rq02
