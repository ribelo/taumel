---
kind: requirement
status: draft
tags: [system-prompt, diagnostics, commands]
depends_on: []
---
# System prompt inspection

## Intent

`/system-prompt` is a debug-only inspection command for seeing the effective
system prompt currently held by Pi. It diagnoses prompt construction and active
tool synchronization without contacting the agent or changing conversation
state. It is not a prompt override or historical prompt-capture facility.

## Requirements

- **sysp-in01** (event-driven): When the user invokes `/system-prompt`, Taumel shall read the current effective prompt through the command context's `getSystemPrompt` API.
- **sysp-in02** (ubiquitous): System prompt inspection shall show the complete current prompt immediately in a non-persistent custom UI.
- **sysp-in03** (ubiquitous): System prompt inspection shall wrap content to the available width and support line-by-line scrolling with the up and down keys.
- **sysp-in04** (ubiquitous): Any input other than the supported scrolling keys shall close system prompt inspection.
- **sysp-in05** (unwanted): System prompt inspection shall not contact the agent, trigger a model turn, add a transcript or session entry, or emit a transient notification.
- **sysp-in06** (unwanted): System prompt inspection shall not claim to reproduce a historical provider request or include prompt changes that a later per-turn extension may apply.
- **sysp-in07** (unwanted): Taumel shall not overwrite or otherwise mutate the system prompt as a side effect of inspection.
