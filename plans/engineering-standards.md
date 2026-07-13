---
kind: requirement
status: draft
tags: [engineering-standards]
---
# Engineering standards

## Intent

Cross-cutting engineering constraints that hold across every component,
independent of any single feature.

## Requirements

- **eng-fs01** (ubiquitous): Each `lib/`, `bin/`, and `src/` source file shall
  stay at or under 1000 lines, split along cohesive module seams.
- **eng-ds01** (ubiquitous): Code shall make invalid states unrepresentable where
  practical. Prefer domain-specific types, explicit variants, and narrow data
  shapes that prevent misuse over generic records plus late assertions. When an
  invalid state cannot be made impossible, catch it at the earliest practical
  boundary, preferably at compile time, then at parse/normalization time, and
  only lastly through behavior tests or runtime assertions.
- **eng-bc01** (ubiquitous): Every value returned through the Taumel core-call
  boundary shall be constructed through the generated builder for its declared
  bridge contract; code shall not return an ad hoc JavaScript object through that
  boundary except inside a field that the declared contract explicitly types as
  open data.
- **eng-bc02** (ubiquitous): Generated bridge-contract builders shall supply
  literal discriminants such as `ok`, `action`, and `kind` internally and shall
  not permit callers to choose those values.
- **eng-bc03** (unwanted): If production OCaml adds an untyped core-call result
  producer or directly invokes a generated constructor whose contract contains
  caller-controlled literal discriminants, then the repository gate shall fail.
- **bridge-7m4k** (ubiquitous): Every generated OCaml bridge producer shall emit
  each JavaScript property under exactly the name declared by the corresponding
  TypeBox transport schema.
- **eng-host01** (ubiquitous): Taumel single-selection lists shall use Pi's
  `SelectList`, and Taumel mutable-settings lists shall use Pi's `SettingsList`.
  These lists shall use Pi's standard themes and built-in filtering, selection,
  navigation, scrolling, truncation, value presentation, and list hints.
  Feature-specific workflows shall be composed around the list component.
