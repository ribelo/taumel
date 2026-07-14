---
kind: requirement
status: draft
tags: [sandbox, security, execution, filesystem, network]
depends_on: ["[[plans/capability-profile]]", "[[plans/tool-gateway]]"]
---
# Sandbox

## Intent

The sandbox is Taumel's central capability gateway. Every path that executes
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
- **sandbox-md09** (ubiquitous): The system shall treat approval policy and sandbox preset as orthogonal: the preset governs OS enforcement and the approval policy governs only the human-in-the-loop cadence, so `danger-full-access` composes with any approval policy — `never` runs unsandboxed with no prompts, and `on-request` runs unsandboxed while still asking before destructive commands.

### Effect authorization

- **sandbox-ef01** (event-driven): When a tool's effect is execution, the system shall authorize it in every filesystem mode, constraining how it runs rather than whether it runs.
- **sandbox-ef02** (event-driven): When a tool's effect is mutation while the filesystem mode is `read-only`, the system shall reject it with "mutation is disabled in read-only sandbox".
- **sandbox-ef03** (event-driven): When a tool's effect is mutation while the filesystem mode is `workspace-write` or `danger-full-access`, the system shall authorize the effect and apply the path checks.
- **sandbox-ef04** (event-driven): When a tool's effect is network while the network mode is `disabled`, the system shall reject it with "network is disabled by sandbox policy".

### Path and mutation authorization

- **sandbox-pa01** (state-driven): While the filesystem mode is `danger-full-access`, the system shall allow read, write, and delete on any path.
- **sandbox-pa02** (state-driven): While the filesystem mode is `read-only`, the system shall allow reads and deny writes and deletes.
- **sandbox-pa03** (state-driven): While the filesystem mode is `workspace-write`, the system shall allow reads everywhere and allow writes and deletes only when their authorization paths are within the authorization paths of the workspace roots.
- **sandbox-pa04** (unwanted): If a write or delete's authorization path targets a protected workspace metadata directory (`.git`, `.hg`, `.svn`), then the system shall deny it in `read-only` and `workspace-write` modes.
- **sandbox-pa05** (event-driven): When a write or delete's authorization path falls outside the authorization paths of the workspace roots under a policy that permits approval, the system shall request approval before allowing it.
- **sandbox-pa06** (event-driven): Before a `workspace-write` mutation reaches any host effect, the system shall validate each authorization path against the authorization paths of the workspace roots and reject any path that escapes the workspace or enters protected metadata.
- **sandbox-pa07** (ubiquitous): The system shall resolve a relative mutation path against the first workspace root before authorizing it.
- **sandbox-pa08** (ubiquitous): For every path-based policy decision, the system shall derive the authorization path by resolving existing path components and symbolic links to their canonical filesystem location; it shall apply the same canonicalization to workspace roots before comparing them.
- **sandbox-pa09** (ubiquitous): Two requested paths that resolve to the same authorization path shall receive the same path-policy decision, including when one reaches an allowed location through a symbolic-link directory.
- **sandbox-pa10** (event-driven): When the final destination or one or more trailing components do not exist, the system shall canonicalize the nearest existing ancestor, normalize the unresolved suffix, and derive the authorization path beneath that ancestor so dot segments or separator forms cannot change the intended ancestor relationship.
- **sandbox-pa11** (ubiquitous): The system shall retain the requested path for approval evidence, result rendering, and diagnostics while using only the authorization path for workspace containment and protected-metadata decisions.
- **sandbox-pa12** (unwanted): A planner shall not deny a path as outside a workspace root from lexical containment alone when canonical filesystem facts can establish its authorization path; authorization shall fail closed if the required canonical filesystem facts cannot be obtained.
- **sandbox-pa13** (state-driven): While approval policy is `never`, the system shall apply the same authorization-path rules as every other approval policy, allowing operations already inside the permission envelope without prompting and denying canonical boundary crossings that would otherwise require approval.

### Exec authorization and escalation

- **sandbox-ex01** (event-driven): When a command runs with default permissions and a working directory, the system shall authorize read access to that working directory by its authorization path before execution.
- **sandbox-ex02** (event-driven): When a command requests escalation while the approval policy is `on-request`, the system shall request approval using the supplied justification.
- **sandbox-ex03** (unwanted): If a command requests escalation while the approval policy is not `on-request`, then the system shall deny the command and report that escalation cannot be requested under the current policy.
- **sandbox-ex04** (event-driven): When the approval policy is `never`, the system shall deny a sandbox-boundary decision that would otherwise require approval — a read-only write, or a write or delete whose authorization path is outside the authorization paths of the workspace roots — while letting exec-policy `prompt` classifications run without asking.
- **sandbox-ex05** (event-driven): When the approval policy is `on-request`, `on-failure`, or `untrusted`, the system shall surface a decision that requires approval as an approval request.
- **sandbox-ex06** (unwanted): If a child owned by an unloaded parent session reaches a decision that requires approval, then the system shall deny that decision with reason `approval_unavailable` without opening an approval prompt in the currently loaded session.
- **sandbox-ex07** (ubiquitous): An approval-unavailable denial shall be terminal for that tool call and model-visible, and shall not suspend the child pending a later parent-session reload.
- **sandbox-ex08** (ubiquitous): An approval prompt shall show the concrete effect being authorized: command and working directory for execution, or affected paths and a bounded diff for mutation, together with the sandbox boundary being crossed.
- **sandbox-ex09** (ubiquitous): The system shall label model-supplied justification as untrusted explanatory text rather than authorization evidence; truncating a preview shall preserve affected paths and report omitted-content counts.

### bubblewrap execution

- **sandbox-bw01** (event-driven): When a command runs sandboxed, the system shall execute it under bubblewrap with a new session, die-with-parent, and unshared user, pid, and ipc namespaces, mounting `/dev` and `/proc`.
- **sandbox-bw02** (state-driven): While the network mode is `disabled`, the system shall unshare the network namespace for sandboxed execution.
- **sandbox-bw03** (state-driven): While the filesystem mode is `read-only`, the system shall bind workspace roots read-only and mount `/tmp` as tmpfs.
- **sandbox-bw04** (state-driven): While the filesystem mode is `workspace-write`, the system shall bind workspace roots read-write, bind temp roots, and bind protected workspace metadata children read-only.
- **sandbox-bw05** (event-driven): When the filesystem mode is `danger-full-access` with network `enabled`, or `--no-sandbox` is active, or the effect is escalated, the system shall run the command unsandboxed.
- **sandbox-bw06** (unwanted): If sandboxed execution is requested on a non-Linux platform, then the system shall report that sandboxed execution is supported only on Linux and point to `/permissions`.
- **sandbox-bw07** (event-driven): When a command's requested working directory reaches an authorized directory through a symbolic link, the sandbox invocation shall make that working directory usable by the command rather than fail solely because its requested path differs from its authorization path.

### Failure diagnostics

- **sandbox-fd01** (event-driven): When a sandboxed command exits non-zero with output matching network-failure signatures while the network is not enabled, the system shall attach a network diagnostic suggesting a retry with `sandbox_permissions="require_escalated"`.
- **sandbox-fd02** (event-driven): When a sandboxed command exits non-zero with output matching filesystem-failure signatures while the mode is not `danger-full-access`, the system shall attach a filesystem diagnostic suggesting a retry with `sandbox_permissions="require_escalated"`.
- **sandbox-fd03** (ubiquitous): The system shall emit sandbox state for the footer and other UI.

### Tools

- **sandbox-tl01** (ubiquitous): The system shall expose `exec_command`, `write_stdin`, and provider-appropriate mutation tools through Taumel-owned wrappers.
- **sandbox-tl02** (ubiquitous): The system shall disable, hide, or wrap Pi built-in `bash`, `write`, and `edit` so filesystem mutation cannot bypass the gateway.
- **sandbox-tl03** (event-driven): When the provider is OpenAI or OpenAI-Codex, the system shall route mutation through `apply_patch`; for other providers it shall route through sandboxed `edit` and `write` wrappers.
- **sandbox-tl04** (ubiquitous): The system shall implement `apply_patch` as an object-shaped Pi function tool contract with exactly one required model-facing parameter named `input`, whose string value carries the complete patch body, while the patch engine accepts Tau-tolerant forms (heredocs, missing end markers, git and unified diffs, rename/add/delete, loose hunks, CRLF preservation, fallback context matching).
- **sandbox-tl05** (ubiquitous): The system shall enforce the same filesystem policy boundary for `apply_patch`, `edit`, and `write` as for shell execution.
- **sandbox-tl06** (event-driven): When the host adapter cannot service `write_stdin`, or the session id is missing, the system shall report the unavailable or invalid-session result rather than execute.
- **sandbox-tl07** (ubiquitous): The system shall describe `apply_patch` to the model as `Apply a patch to add, update, move, or delete one or more workspace files. Use the *** Begin Patch format.`
- **sandbox-tl08** (ubiquitous): The system shall describe `apply_patch.input` to the model as `The complete patch in *** Begin Patch format.`
- **sandbox-tl09** (ubiquitous): The system shall reject an `apply_patch` call that omits `input` or supplies any unknown parameter through its closed TypeBox schema.
- **sandbox-tl10** (ubiquitous): The system shall present `apply_patch` in the system tool catalog with the prompt snippet `Add, update, move, or delete workspace files with one patch.`
- **sandbox-tl11** (ubiquitous): The system shall describe `read` to the model as `Read a UTF-8 text file. Output is line-numbered and truncated to 2000 lines, 50KB total, and 2000 characters per line.`
- **sandbox-tl12** (ubiquitous): The system shall describe `read.path` to the model as `Path to the UTF-8 text file to read, relative to the current working directory or absolute.`
- **sandbox-tl13** (ubiquitous): The system shall describe `read.offset` to the model as `1-indexed line at which to start. Omit to start at line 1; a negative value starts that many lines from the end of the file.`
- **sandbox-tl14** (ubiquitous): The system shall describe `read.limit` to the model as `Maximum number of lines to return. Omit to read from offset to the end of the file, subject to the tool's truncation limits.`
- **sandbox-tl15** (ubiquitous): The system shall require `read.path` to be a non-empty string, allow optional integer `offset` and optional integer `limit` no smaller than 1, and reject unknown parameters through its closed TypeBox schema.
- **sandbox-tl16** (ubiquitous): The system shall present `read` in the system tool catalog with the prompt snippet `Read a line-numbered UTF-8 text file.` and no additional `read`-specific prompt guidance.
- **sandbox-tl17** (ubiquitous): The system shall describe `view_media` to the model as `View a PNG, JPEG, GIF, or WebP image.`
- **sandbox-tl18** (ubiquitous): The system shall describe `view_media.path` to the model as `Path to the image, relative to the current working directory or absolute.`
- **sandbox-tl19** (ubiquitous): The system shall require `view_media.path` to be a non-empty string and reject unknown parameters through its closed TypeBox schema.
- **sandbox-tl20** (ubiquitous): The system shall present `view_media` in the system tool catalog with the prompt snippet `View an image file.` and no additional `view_media`-specific prompt guidance.
- **sandbox-tl21** (ubiquitous): The system shall describe `edit` to the model as `Edit an existing text file with one or more exact text replacements.`
- **sandbox-tl22** (ubiquitous): The system shall describe `edit.path` to the model as `Path to the existing UTF-8 text file to edit, relative to the current working directory or absolute.`
- **sandbox-tl23** (ubiquitous): The system shall describe `edit.edits` to the model as `One or more non-overlapping replacements, all matched against the original file.`
- **sandbox-tl24** (ubiquitous): The system shall describe `edit.edits[].oldText` to the model as `Exact, non-empty text to replace. It must occur exactly once in the original file.`
- **sandbox-tl25** (ubiquitous): The system shall describe `edit.edits[].newText` to the model as `Replacement text. Use an empty string to delete oldText.`
- **sandbox-tl26** (ubiquitous): The system shall require `edit.path` and each `edit.edits[].oldText` to be non-empty strings, require at least one `edit.edits` entry, allow each `edit.edits[].newText` to be any string, and reject unknown parameters at every object level through its closed TypeBox schemas.
- **sandbox-tl27** (ubiquitous): The system shall present `edit` in the system tool catalog with the prompt snippet `Make one or more exact replacements in a text file.` and no additional `edit`-specific prompt guidance.
- **sandbox-tl28** (ubiquitous): The system shall describe `write` to the model as `Create, overwrite, or append to a UTF-8 text file. Parent directories are created as needed.`
- **sandbox-tl29** (ubiquitous): The system shall describe `write.path` to the model as `Path to the file, relative to the current working directory or absolute.`
- **sandbox-tl30** (ubiquitous): The system shall describe `write.content` to the model as `UTF-8 text to write exactly as provided.`
- **sandbox-tl31** (ubiquitous): The system shall describe `write.mode` to the model as `Write behavior: overwrite (default) replaces the file; append adds content at the end without inserting a newline.`
- **sandbox-tl32** (ubiquitous): The system shall require `write.path` to be a non-empty string, allow `write.content` to be any string, allow optional `write.mode` values `overwrite` and `append`, and reject unknown parameters through its closed TypeBox schema.
- **sandbox-tl33** (ubiquitous): The system shall present `write` in the system tool catalog with the prompt snippet `Create, overwrite, or append to a text file.` and no additional `write`-specific prompt guidance.

### no-sandbox escape hatch

- **sandbox-ns01** (state-driven): While a session is a top-level orchestrator, the system shall allow `--no-sandbox` only when the active capability profile permits it.
- **sandbox-ns03** (event-driven): When `--no-sandbox` is active, the system shall show it in the footer and sandbox state.


- **sandbox-cp05** (event-driven): When authorizing any side effect for an existing child, the system shall use the stricter combination of the child's spawn-time permission ceiling and the parent's current sandbox, approval, network, and no-sandbox constraints.
- **sandbox-cp06** (event-driven): When the user tightens or relaxes the parent's permissions, the new current envelope shall affect subsequent child tool authorizations immediately, while relaxation shall restore no authority beyond the child's spawn-time ceiling.
- **sandbox-cp07** (state-driven): While a child remains live and its parent session is not loaded, the system shall authorize child side effects against the stricter combination of the child's spawn-time ceiling and the owner permission state captured by that child resource.
- **sandbox-cp08** (unwanted): An unloaded parent's child shall never inherit permissions from the currently loaded main session, even when that session has the same working directory or a broader envelope.
- **sandbox-cp09** (unwanted): An unloaded parent's child shall never borrow the currently loaded session's approval channel or user approval.

### Permissions and network commands

- **sandbox-pc02** (event-driven): When the user runs `/network`, the system shall set network access to `enabled` or `disabled`.
- **sandbox-pc03** (unwanted): If the user disables network while the preset is `danger-full-access`, then the system shall reject the change and ask them to choose `read-only` or `workspace-write` first.
- **sandbox-pc04** (event-driven): When the user changes the sandbox preset, the system shall reset network mode to that preset's default and leave the approval policy unchanged.
- **sandbox-pc05** (event-driven): When the user opens the interactive `/permissions` menu, the system shall offer the approval policies as selectable options alongside the sandbox presets, marking the current one, so approval is changeable without typing a subcommand.
