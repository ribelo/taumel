---
kind: requirement
tags: [compaction, model, command]
depends_on: ["[[docs/requirements/shared-infrastructure]]"]
traces_to: ["pi-mono compaction (packages/coding-agent/src/core/compaction)", "pi-mono ModelSelectorComponent"]
---
# Compaction model

## Intent

Choose a different model for session-compression summaries: context compaction
and branch summaries. Pi owns compaction and branch navigation and exposes
`session_before_compact` / `session_before_tree` hooks plus exported summary
generators; Taumel reuses them and swaps only the model and its auth, so Pi keeps
ownership of summarization prompts, split-turn merge, file tracking, and
structured format.
Taumel does not bypass Pi's pre-hook compaction lifecycle; it controls the
summarization request once Pi asks the extension for a compaction result.

Configuration lives in Pi-owned settings: a `taumel.compaction.model` string in
trusted project and global scope, following the shared Taumel config precedence.
The setting is optional; absence inherits the session model, matching Pi's default. A
`/compaction-model` command reads and writes the setting and offers a searchable
picker that reuses Pi's model selector.

This stays a thin host shim: model-registry lookup, auth resolution, the
`compact()` call, and the picker live in the TypeScript host layer; selection
validation and persistence policy live in the OCaml core.

## Requirements

- The system shall reuse Pi's exported `compact()` and `generateBranchSummary()` and swap only the model and its auth, inheriting Pi's summarization prompts, split-turn merge, file tracking, and structured summary formats. ^compaction-rs01
- When `session_before_compact` fires and a compaction model is configured, the system shall summarize through `compact()` with exactly that model and its auth and return the result to Pi. ^compaction-hk01
- When `session_before_tree` fires for a user-requested branch summary and a compaction model is configured, the system shall summarize through `generateBranchSummary()` with exactly that model and its auth and return the result to Pi. ^compaction-hk02
- While no compaction model is configured, the system shall defer to Pi's default compaction and summarize with the session model. ^compaction-in01
- The system shall not change the active session model to implement compaction-model selection. ^compaction-lc01
- The system shall not promise to bypass Pi's pre-hook compaction checks, including active-session-model auth resolution performed before `session_before_compact`. ^compaction-lc02
- Taumel shall not add a compaction-summary command, shortcut, transcript renderer, expansion state, or alternate summary browser; Pi owns presentation and navigation of its compaction entries. ^compaction-lc03
- The system shall read `taumel.compaction.model` as a `provider/model` string from trusted project `<cwd>/.pi/settings.json` and global `~/.pi/agent/settings.json`, following the shared Taumel config precedence. ^compaction-cf01
- The system shall not read project compaction-model config while the project is untrusted. ^compaction-cf02
- The system shall treat the first `/` as the provider/model separator so provider-qualified model IDs may contain additional `/` characters in the model segment. ^compaction-cf03
- The system shall treat missing, empty, and whitespace-only compaction-model values as absent, so an empty higher-precedence scope shall not shadow a configured lower-precedence scope. ^compaction-cf04
- When the user runs `/compaction-model <provider/model>`, the system shall set the session compaction model and, while the project is trusted, persist it to the project settings file in one step. ^compaction-7bgp
- When the user runs `/compaction-model` with no argument, the system shall open a searchable model picker and, on selection, set the chosen session compaction model and apply the same project persistence rule as `/compaction-model <provider/model>`. ^compaction-3t00
- When the user runs `/compaction-model clear`, the system shall clear the session compaction model and, while the project is trusted, remove the project compaction-model setting so the global value can apply. ^compaction-snsr
- If `/compaction-model` would persist to project config while the project is untrusted, then the system shall leave the project file unchanged and warn that project persistence was skipped. ^compaction-ypis
- The system shall present the picker by reusing Pi's `ModelSelectorComponent` through `ctx.ui.custom`, supply a `SettingsManager.inMemory()` instance to absorb the component's default-model write, and take the chosen model from the select callback. ^compaction-pk01
- The system shall mark the current resolved compaction model in the picker and shall source the candidate list from `ctx.modelRegistry`. ^compaction-pk02
- If the configured compaction model is invalid, absent from the registry, or lacks auth, then the system shall fail compaction visibly and shall not fall back to Pi's default compaction. ^compaction-er01
- If summarization through the configured compaction model fails, then the system shall fail compaction visibly and shall not retry with the session model. ^compaction-er02
- If branch-summary generation through the configured compaction model fails, then the system shall fail branch summarization visibly and shall not retry with the session model. ^compaction-er03
- The system shall keep selection validation and persistence policy in the OCaml core and keep the model-registry lookup, auth resolution, `compact()` call, and picker in the TypeScript host layer, with the candidate model list flowing from TypeScript into the OCaml plan. ^compaction-ar01
- The system shall summarize with the session thinking level, and the model layer shall clamp it to the configured model's capabilities. ^compaction-th01
