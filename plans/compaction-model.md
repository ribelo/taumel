---
kind: requirement
status: draft
tags: [compaction, model, command]
depends_on: ["[[plans/shared-infrastructure]]"]
traces_to: ["pi-mono compaction (packages/coding-agent/src/core/compaction)", "pi-mono ModelSelectorComponent"]
---
# Compaction model

## Intent

Choose a different model for context compaction. Pi owns compaction and exposes
the `session_before_compact` hook plus an exported `compact()`; Taumel reuses
both and swaps only the model and its auth, so Pi keeps ownership of the
summarization prompt, split-turn merge, file tracking, and structured format.

Configuration lives in Pi-owned settings: a `taumel.compaction.model` string in
project and global scope, with project taking precedence. The setting is
optional; absence inherits the session model, matching Pi's default. A
`/compaction-model` command reads and writes the setting and offers a searchable
picker that reuses Pi's model selector.

This stays a thin host shim: model-registry lookup, auth resolution, the
`compact()` call, and the picker live in the TypeScript host layer; selection
validation and persistence policy live in the OCaml core.

## Requirements

- **compaction-rs01** (ubiquitous): The system shall reuse Pi's exported `compact()` and swap only the model and its auth, inheriting Pi's summarization prompt, split-turn merge, file tracking, and structured summary format.
- **compaction-hk01** (event-driven): When `session_before_compact` fires and a compaction model resolves, the system shall summarize through `compact()` with the resolved model and its auth and return the result to Pi.
- **compaction-in01** (state-driven): While no compaction model is configured, the system shall defer to Pi's default compaction and summarize with the session model.
- **compaction-cf01** (ubiquitous): The system shall read `taumel.compaction.model` as a `provider/model` string from project `<cwd>/.pi/settings.json` and global `~/.pi/agent/settings.json`, and the project value shall take precedence over the global value.
- **compaction-cf02** (ubiquitous): The system shall read the project compaction-model setting directly, as a personal and company preference, without a project-trust gate.
- **compaction-cmd01** (event-driven): When the user runs `/compaction-model <provider/model>`, the system shall set the session compaction model and persist it to the project settings file in one step.
- **compaction-cmd02** (event-driven): When the user runs `/compaction-model` with no argument, the system shall open a searchable model picker and, on selection, set and persist the chosen model.
- **compaction-cmd03** (event-driven): When the user runs `/compaction-model clear`, the system shall remove the project compaction-model setting and restore the global value, then inherit.
- **compaction-pk01** (ubiquitous): The system shall present the picker by reusing Pi's `ModelSelectorComponent` through `ctx.ui.custom`, supply a `SettingsManager.inMemory()` instance to absorb the component's default-model write, and take the chosen model from the select callback.
- **compaction-pk02** (ubiquitous): The system shall mark the current resolved compaction model in the picker and shall source the candidate list from `ctx.modelRegistry`.
- **compaction-fb01** (unwanted): If the configured compaction model is absent from the registry or lacks auth, then the system shall fall back to Pi's default compaction and notify the user once with a warning.
- **compaction-fb02** (ubiquitous): The system shall keep compaction succeeding under compaction-model misconfiguration by falling back to Pi's default compaction.
- **compaction-ar01** (ubiquitous): The system shall keep selection validation and persistence policy in the OCaml core and keep the model-registry lookup, auth resolution, `compact()` call, and picker in the TypeScript host layer, with the candidate model list flowing from TypeScript into the OCaml plan.
- **compaction-th01** (ubiquitous): The system shall summarize with the session thinking level, and the model layer shall clamp it to the configured model's capabilities.
