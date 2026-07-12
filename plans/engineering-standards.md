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
- **eng-host01** (ubiquitous): When Pi supplies a component appropriate to an
  interactive list's semantics, Taumel shall compose that component and its
  standard theme. Pi's component shall own generic list behavior such as
  filtering, selection, navigation, scrolling, truncation, value presentation,
  and list hints; Taumel shall own only the feature-specific workflow around it.
