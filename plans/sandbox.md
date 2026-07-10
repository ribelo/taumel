---
kind: requirement
status: draft
tags: [sandbox, security, execution, filesystem, network]
depends_on: ["[[plans/capability-profile]]", "[[plans/tool-gateway]]"]
---
# Sandbox

## Intent

The sandbox is Taumel's central capability gateway. Every path that executes
commands, mutates files, spawns child agents, or reaches the network passes
through it, so one boundary constrains all side effects. Codex sandbox behavior
is the reference model; Tau sets the minimum security baseline.

The tool gateway decides whether a tool may run; the sandbox decides how
execution and mutation are constrained. Approval policy, filesystem policy, and
patch parsing stay separate from each other and from execution.

## Requirements

### Gateway

- **sandbox-gw01** (ubiquitous): The system shall route every command execution, filesystem mutation, child-agent spawn, and network effect through the sandbox policy boundary.
- **sandbox-gw02** (ubiquitous): The system shall keep no execution, filesystem-mutation, or approval path that reaches host effects outside the sandbox gateway.
- **sandbox-gw03** (ubiquitous): The system shall let the tool gateway decide whether a tool may run and let the sandbox decide how execution and mutation are constrained.
- **sandbox-gw04** (ubiquitous): The system shall hold a security level at least equal to Tau.

### Modes and configuration

- **sandbox-md01** (ubiquitous): The system shall provide the filesystem modes `read-only`, `workspace-write`, and `danger-full-access`.
- **sandbox-md02** (ubiquitous): The system shall provide the network modes `disabled` and `enabled`.
- **sandbox-md03** (ubiquitous): The system shall provide the approval policies `never`, `on-request`, `on-failure`, and `untrusted`.
- **sandbox-md04** (ubiquitous): The system shall derive the active sandbox config from the capability profile, taking filesystem mode from the profile's sandbox preset and approval policy from the profile's approval policy.
- **sandbox-md05** (ubiquitous): The system shall default a profile to `workspace-write`, `on-request`, and `noSandboxAllowed = false`.
- **sandbox-md06** (state-driven): While the sandbox preset is `danger-full-access`, the system shall force network `enabled`; while the preset is `read-only` or `workspace-write`, network shall default to `disabled` and stay user-controlled.
- **sandbox-md07** (event-driven): When no persisted permissions exist, the system shall start a top-level session at `danger-full-access` with network enabled and approval `on-request`; when persisted permissions are invalid, it shall fall back to `workspace-write` with network disabled.
- **sandbox-md08** (event-driven): When the host supplies `--sandbox-mode`, a network flag, or `--no-sandbox`, the system shall override the resolved active state with those values, applying `--no-sandbox` only to non-subagent sessions.
- **sandbox-md09** (ubiquitous): The system shall treat approval policy and sandbox preset as orthogonal: the preset governs OS enforcement and the approval policy governs only the human-in-the-loop cadence, so `danger-full-access` composes with any approval policy — `never` runs unsandboxed with no prompts, and `on-request` runs unsandboxed while still asking before destructive commands.

### Effect authorization

- **sandbox-ef01** (event-driven): When a tool's effect is execution, the system shall authorize it in every filesystem mode, constraining how it runs rather than whether it runs.
- **sandbox-ef02** (event-driven): When a tool's effect is mutation while the filesystem mode is `read-only`, the system shall reject it with "mutation is disabled in read-only sandbox".
- **sandbox-ef03** (event-driven): When a tool's effect is mutation while the filesystem mode is `workspace-write` or `danger-full-access`, the system shall authorize the effect and apply the path checks.
- **sandbox-ef04** (event-driven): When a tool's effect is network while the network mode is `disabled`, the system shall reject it with "network is disabled by sandbox policy".
- **sandbox-ef05** (event-driven): When a tool's effect is a child-agent spawn, the system shall authorize the spawn effect and leave nesting and ownership to the subagent layer.

### Path and mutation authorization

- **sandbox-pa01** (state-driven): While the filesystem mode is `danger-full-access`, the system shall allow read, write, and delete on any path.
- **sandbox-pa02** (state-driven): While the filesystem mode is `read-only`, the system shall allow reads and deny writes and deletes.
- **sandbox-pa03** (state-driven): While the filesystem mode is `workspace-write`, the system shall allow reads everywhere and allow writes and deletes only within the workspace roots.
- **sandbox-pa04** (unwanted): If a write or delete targets a protected workspace metadata directory (`.git`, `.hg`, `.svn`), then the system shall deny it in `read-only` and `workspace-write` modes.
- **sandbox-pa05** (event-driven): When a write or delete falls outside the workspace roots under a policy that permits approval, the system shall request approval before allowing it.
- **sandbox-pa06** (event-driven): When `workspace-write` mutation runs, the system shall validate each path against the workspace roots after realpath resolution and reject any path that escapes the workspace or enters protected metadata.
- **sandbox-pa07** (ubiquitous): The system shall resolve a relative mutation path against the first workspace root before authorizing it.

### Exec authorization and escalation

- **sandbox-ex01** (event-driven): When a command runs with default permissions and a working directory, the system shall authorize read access to that working directory before execution.
- **sandbox-ex02** (event-driven): When a command requests escalation while the approval policy is `on-request`, the system shall request approval using the supplied justification.
- **sandbox-ex03** (unwanted): If a command requests escalation while the approval policy is not `on-request`, then the system shall deny the command and report that escalation cannot be requested under the current policy.
- **sandbox-ex04** (event-driven): When the approval policy is `never`, the system shall deny a sandbox-boundary decision that would otherwise require approval — a read-only write, or a write or delete outside the workspace roots — while letting exec-policy `prompt` classifications run without asking.
- **sandbox-ex05** (event-driven): When the approval policy is `on-request`, `on-failure`, or `untrusted`, the system shall surface a decision that requires approval as an approval request.
- **sandbox-ex06** (unwanted): If a child owned by an unloaded parent session reaches a decision that requires approval, then the system shall deny that decision with reason `approval_unavailable` without opening an approval prompt in the currently loaded session.
- **sandbox-ex07** (ubiquitous): An approval-unavailable denial shall be terminal for that tool call and model-visible, and shall not suspend the child pending a later parent-session reload.
- **sandbox-ex08** (ubiquitous): An approval prompt shall show the concrete effect being authorized: command and working directory for execution, or affected paths and a bounded diff for mutation, together with the sandbox boundary being crossed and the requesting agent identity when applicable.
- **sandbox-ex09** (ubiquitous): The system shall label model-supplied justification as untrusted explanatory text rather than authorization evidence; truncating a preview shall preserve affected paths and report omitted-content counts.

### bubblewrap execution

- **sandbox-bw01** (event-driven): When a command runs sandboxed, the system shall execute it under bubblewrap with a new session, die-with-parent, and unshared user, pid, and ipc namespaces, mounting `/dev` and `/proc`.
- **sandbox-bw02** (state-driven): While the network mode is `disabled`, the system shall unshare the network namespace for sandboxed execution.
- **sandbox-bw03** (state-driven): While the filesystem mode is `read-only`, the system shall bind workspace roots read-only and mount `/tmp` as tmpfs.
- **sandbox-bw04** (state-driven): While the filesystem mode is `workspace-write`, the system shall bind workspace roots read-write, bind temp roots, and bind protected workspace metadata children read-only.
- **sandbox-bw05** (event-driven): When the filesystem mode is `danger-full-access` with network `enabled`, or `--no-sandbox` is active, or the effect is escalated, the system shall run the command unsandboxed.
- **sandbox-bw06** (unwanted): If sandboxed execution is requested on a non-Linux platform, then the system shall report that sandboxed execution is supported only on Linux and point to `/permissions`.

### Failure diagnostics

- **sandbox-fd01** (event-driven): When a sandboxed command exits non-zero with output matching network-failure signatures while the network is not enabled, the system shall attach a network diagnostic suggesting a retry with `sandbox_permissions="require_escalated"`.
- **sandbox-fd02** (event-driven): When a sandboxed command exits non-zero with output matching filesystem-failure signatures while the mode is not `danger-full-access`, the system shall attach a filesystem diagnostic suggesting a retry with `sandbox_permissions="require_escalated"`.
- **sandbox-fd03** (ubiquitous): The system shall emit sandbox state for the footer and other UI.

### Tools

- **sandbox-tl01** (ubiquitous): The system shall expose `exec_command`, `write_stdin`, and provider-appropriate mutation tools through Taumel-owned wrappers.
- **sandbox-tl02** (ubiquitous): The system shall disable, hide, or wrap Pi built-in `bash`, `write`, and `edit` so filesystem mutation cannot bypass the gateway.
- **sandbox-tl03** (event-driven): When the provider is OpenAI or OpenAI-Codex, the system shall route mutation through `apply_patch`; for other providers it shall route through sandboxed `edit` and `write` wrappers.
- **sandbox-tl04** (ubiquitous): The system shall implement `apply_patch` as an object-shaped Pi tool contract whose `input` or `patch` field carries the patch body, while the patch engine accepts Tau-tolerant forms (heredocs, missing end markers, git and unified diffs, rename/add/delete, loose hunks, CRLF preservation, fallback context matching).
- **sandbox-tl05** (ubiquitous): The system shall enforce the same filesystem policy boundary for `apply_patch`, `edit`, and `write` as for shell execution.
- **sandbox-tl06** (event-driven): When the host adapter cannot service `write_stdin`, or the session id is missing, the system shall report the unavailable or invalid-session result rather than execute.

### no-sandbox escape hatch

- **sandbox-ns01** (state-driven): While a session is a top-level orchestrator, the system shall allow `--no-sandbox` only when the active capability profile permits it.
- **sandbox-ns02** (unwanted): If a subagent or agent definition requests `--no-sandbox`, then the system shall reject it.
- **sandbox-ns03** (event-driven): When `--no-sandbox` is active, the system shall show it in the footer and sandbox state.

### Capability profile and subagents

- **sandbox-cp01** (event-driven): When deriving a child profile, the system shall set its sandbox preset to the stricter of the parent preset and the requested preset, and its approval policy to the stricter of the parent and requested policy.
- **sandbox-cp02** (unwanted): If a subagent profile requests `danger-full-access`, then the system shall reject it; an inherited `danger-full-access` parent preset shall downgrade to `workspace-write` for the child.
- **sandbox-cp03** (event-driven): When deriving a child profile, the system shall allow the child tool surface to differ from and exceed the parent's tool surface, intersect the parent and child agent allowlists, and set the child's `noSandboxAllowed` to false; the child's side effects shall remain bounded by its inherited permission envelope.
- **sandbox-cp04** (unwanted): If a requested agent is disabled or outside the parent's agent allowlist, then the system shall reject the child profile.
- **sandbox-cp05** (event-driven): When authorizing any side effect for an existing child, the system shall use the stricter combination of the child's spawn-time permission ceiling and the parent's current sandbox, approval, network, and no-sandbox constraints.
- **sandbox-cp06** (event-driven): When the user tightens or relaxes the parent's permissions, the new current envelope shall affect subsequent child tool authorizations immediately, while relaxation shall restore no authority beyond the child's spawn-time ceiling.
- **sandbox-cp07** (state-driven): While a child remains live and its parent session is not loaded, the system shall authorize child side effects against the stricter combination of the child's spawn-time ceiling and the owner permission state captured by that child resource.
- **sandbox-cp08** (unwanted): An unloaded parent's child shall never inherit permissions from the currently loaded main session, even when that session has the same working directory or a broader envelope.
- **sandbox-cp09** (unwanted): An unloaded parent's child shall never borrow the currently loaded session's approval channel or user approval.

### Permissions and network commands

- **sandbox-pc01** (event-driven): When the user runs `/permissions`, the system shall set sandbox preset, approval policy, `no-sandbox`, and tool and agent allowlists following Codex naming, and shall direct network changes to `/network`.
- **sandbox-pc02** (event-driven): When the user runs `/network`, the system shall set network access to `enabled` or `disabled`.
- **sandbox-pc03** (unwanted): If the user disables network while the preset is `danger-full-access`, then the system shall reject the change and ask them to choose `read-only` or `workspace-write` first.
- **sandbox-pc04** (event-driven): When the user changes the sandbox preset, the system shall reset network mode to that preset's default and leave the approval policy unchanged.
- **sandbox-pc05** (event-driven): When the user opens the interactive `/permissions` menu, the system shall offer the approval policies as selectable options alongside the sandbox presets, marking the current one, so approval is changeable without typing a subcommand.
