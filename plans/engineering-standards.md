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
