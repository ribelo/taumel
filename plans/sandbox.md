# Sandbox

## Decision

Port.

## Classification

Port with major redesign.

## Source Of Truth

Use Codex sandbox behavior as the reference model where Tau was modeling Codex.
Use Tau as the minimum security baseline: Taumel must not be less secure than
Tau.

## Security Invariant

Sandboxing is a core Taumel capability, not a standalone plugin-style feature.
Every mechanism that can execute commands, mutate files, spawn child agents, or
invoke tool-like side effects must go through the sandbox policy boundary.

No Taumel component should bypass sandboxing by directly exposing process,
filesystem mutation, or approval behavior outside the central sandbox gateway.

## Why Keep It

The sandbox is the security foundation for all other mechanisms. A separate
sandbox plugin and a separate sub-agent plugin are not enough if sub-agents or
other tools can bypass the sandbox. Taumel needs one integrated policy boundary
that all execution and mutation paths use.

## Preserve

- Sandboxed command execution.
- `exec_command`.
- `write_stdin`.
- `apply_patch`.
- Codex `apply_patch` tool shape and output behavior.
- Tau-style tolerant mutation input handling for provider compatibility.
- Routing or disabling unsafe Pi built-in shell/file tools.
- Approval flow for escalation.
- `/permissions` command, following Codex naming and behavior: choose what
  Codex/Taumel is allowed to do.
- Sandbox presets and effective config.
- Filesystem policy checks.
- Network restriction behavior.
- Sandbox diagnostics for failures.
- Sandbox state event for footer and other UI.
- Top-level `--no-sandbox` escape hatch.
- Sub-agent sandboxing.
- Security level at least equal to Tau.

## Redesign

- Treat the sandbox as a central capability gateway.
- Let the tool gateway enforce whether a tool may run; let sandbox enforce how
  execution and mutation are constrained.
- Expose `exec_command`, `write_stdin`, and provider-appropriate mutation tools
  through Taumel-owned wrappers.
- Route OpenAI/OpenAI-Codex providers to `apply_patch`; route non-OpenAI
  providers to sandboxed `edit`/`write` wrappers rather than forcing strict
  `apply_patch`.
- Disable, hide, or wrap Pi built-ins such as `bash`, `write`, and `edit` so
  filesystem mutation cannot bypass Taumel's gateway.
- Separate shell execution from policy decisions.
- Separate approval policy from execution.
- Separate filesystem policy from patch parsing/application.
- Implement `apply_patch` as a compatibility/tolerance layer: accept Codex
  patch bodies plus Tau-style heredocs, missing end markers, git/unified diffs,
  rename/add/delete forms, loose hunks, CRLF preservation, and fallback context
  matching, while still enforcing the same sandbox policy at authorization and
  host mutation time.
- Rename Tau's `/approval` command to `/permissions`.
- Let `/permissions` edit sandbox/capability-profile state rather than global
  Tau state.
- Feed sandbox mode flags into the initial sandbox config.
- Allow `--no-sandbox` only for top-level orchestrator sessions.
- Make `--no-sandbox` visible in footer/sandbox state.
- Keep tool specs separate from tool implementations.
- Keep Pi rendering at the edge.
- Keep child-agent sandbox inheritance explicit.
- Keep Codex behavior as the behavioral reference where applicable.

## Omit

- Tau compatibility for old settings or persisted state unless explicitly needed.
- Generic Tau service-layer wiring.
- Autoresearch-specific sandbox behavior.
- Tau's `/approval` naming.
- Sub-agent `--no-sandbox`.
- Agent-definition-controlled `--no-sandbox`.
- Plugin composition assumptions where unrelated tools can bypass the sandbox.
- Any direct shell or filesystem mutation path outside the sandbox gateway.

## Acceptance

- Every Taumel command/file mutation path has a clear sandbox policy boundary.
- Built-in Pi shell/file tools cannot bypass Taumel's sandbox gateway.
- Sub-agents cannot bypass sandboxing.
- Sub-agents cannot enable `--no-sandbox`.
- `apply_patch` enforces the same filesystem policy boundary as shell execution.
- `edit`/`write` compatibility paths are Taumel-owned wrappers and enforce the
  same filesystem policy boundary.
- Non-OpenAI providers are not forced into strict `apply_patch`.
- Escalation requires the same kind of approval discipline as Tau/Codex.
- Taumel is not less secure than Tau.
