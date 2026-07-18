---
kind: requirement
tags: [sandbox, security, execution, filesystem, network]
depends_on: ["[[docs/requirements/capability-profile]]", "[[docs/requirements/tool-gateway]]"]
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

- The system shall route every command execution, filesystem mutation, child-agent spawn, and network effect through the sandbox policy boundary. ^sandbox-gw01
- The system shall keep no execution, filesystem-mutation, or approval path that reaches host effects outside the sandbox gateway. ^sandbox-gw02
- The system shall let the tool gateway decide whether a tool may run and let the sandbox decide how execution and mutation are constrained. ^sandbox-gw03
- The system shall hold a security level at least equal to Tau. ^sandbox-gw04
- The system shall expose effect-bearing core dispatch only through the private bridge capability returned by one-time core initialization and shall not publish that dispatcher on the global bootstrap object. ^sandbox-a69j

### Modes and configuration

- The system shall provide the filesystem modes `read-only`, `workspace-write`, and `danger-full-access`. ^sandbox-md01
- The system shall provide the network modes `disabled` and `enabled`. ^sandbox-md02
- The system shall provide the approval policies `never`, `on-request`, `on-failure`, and `untrusted`. ^sandbox-md03
- The system shall derive the active sandbox config from the capability profile, taking filesystem mode from the profile's sandbox preset and approval policy from the profile's approval policy. ^sandbox-md04
- The OCaml sandbox configuration type shall hide record construction behind validated constructors that reject isolated-child combinations with no-sandbox or danger-full-access before a configuration reaches authorization logic. ^sandbox-m8dk
- The system shall default a profile to `workspace-write`, `never`, and `noSandboxAllowed = false`. ^sandbox-md05
- While the sandbox preset is `danger-full-access`, the system shall force network `enabled`; while the preset is `read-only` or `workspace-write`, network shall default to `disabled` and stay user-controlled. ^sandbox-md06
- When no persisted permissions exist, the system shall start a top-level session at `danger-full-access` with network enabled and approval `never`; when persisted permissions are invalid, it shall fall back to `workspace-write` with network disabled. ^sandbox-md07
- The system shall treat approval policy and sandbox preset as orthogonal: the preset governs OS enforcement and the approval policy governs only the human-in-the-loop cadence, so `danger-full-access` composes with any approval policy — `never` runs unsandboxed with no prompts, and `on-request` runs unsandboxed while still asking before destructive commands. ^sandbox-md09
- When decoding persisted permissions, the system shall accept only version `1` with exactly the fields `version`, `profile`, `networkMode`, `noSandbox`, and `isolated_child`, rejecting missing, unknown, or repeated fields. ^sandbox-o9ky
- When decoding version `1` persisted permissions, the system shall accept only the canonical network values `disabled` and `enabled` and shall reject `danger-full-access` combined with disabled network. ^sandbox-2m4o
- When persisted permissions are invalid, the system shall deny every tool in the fallback capability profile. ^sandbox-xg3g
- When creating persisted permissions for a child session, the system shall write `isolated_child = true`. ^sandbox-qb00
- When creating persisted permissions for a child session, the system shall write `noSandbox = false`. ^sandbox-5pf1
- When refreshing a child's permissions from its parent, the system shall decode the parent entry through the exact persisted-permissions contract and apply the resolved missing, invalid, or persisted parent state before emitting a codec-valid child entry. ^sandbox-co3e
- When refreshing a child's permissions, the system shall apply the current host sandbox, network, and no-sandbox overrides to the resolved parent envelope before clamping the child. ^sandbox-jrcw
- If a child permission refresh encounters missing or invalid required child ceiling metadata, then the system shall emit a codec-valid isolated-child entry with read-only filesystem access, network disabled, approval untrusted, no-sandbox disabled, and no allowed tools. ^sandbox-zp0z
- When refreshing child permissions after an asynchronous boundary, the system shall synchronize and verify the supplied parent context before reading host overrides; if that context is stale or cannot be synchronized, then it shall emit the fail-closed child entry. ^sandbox-afnn
- When refreshing child permissions, the system shall require an agent ceiling to carry `networkMode` and shall treat an omitted Ralph ceiling `networkMode` as disabled. ^sandbox-tusv

### Effect authorization

- When a tool's effect is execution, the system shall authorize it in every filesystem mode, constraining how it runs rather than whether it runs. ^sandbox-ef01
- When a tool's effect is mutation while the filesystem mode is `read-only`, the system shall reject it with "mutation is disabled in read-only sandbox". ^sandbox-ef02
- When a tool's effect is mutation while the filesystem mode is `workspace-write` or `danger-full-access`, the system shall authorize the effect and apply the path checks. ^sandbox-ef03
- When a tool's effect is network while the network mode is `disabled`, the system shall reject it with "network is disabled by sandbox policy". ^sandbox-ef04

### Path and mutation authorization

- While the filesystem mode is `danger-full-access`, the system shall allow read, write, and delete on any path. ^sandbox-pa01
- While the filesystem mode is `read-only`, the system shall allow reads and deny writes and deletes. ^sandbox-pa02
- While the filesystem mode is `workspace-write`, the system shall allow reads everywhere and allow writes and deletes only when their authorization paths are within the authorization paths of the workspace roots. ^sandbox-pa03
- If an ordinary path write or delete's authorization path targets a protected workspace metadata directory (`.git`, `.hg`, `.svn`), then the system shall deny it in `read-only` and `workspace-write` modes. ^sandbox-grmm
- When a write or delete's authorization path falls outside the authorization paths of the workspace roots under a policy that permits approval, the system shall request approval before allowing it. ^sandbox-pa05
- Before an ordinary `workspace-write` mutation reaches any host effect, the system shall validate each authorization path against the authorization paths of the workspace roots and reject any path that escapes the workspace or enters protected metadata. ^sandbox-6jre
- The trusted worktree host adapter shall keep provision, broker, and cleanup mutation paths separate and shall verify the resources required by the selected operation before mutating them. ^sandbox-ie72
- Before provisioning, the trusted host adapter shall derive repository identity from the source Git repository, reject an expected-binding mismatch or resource collision, and verify the resulting native registration and baseline; before broker or cleanup mutation, it shall verify the identity-owned worktree and relevant native Git registration from authoritative host state rather than a caller-supplied effect. ^sandbox-2llx
- Worktree lifecycle mutation shall be reachable only through the trusted host adapter performing the matching validated lifecycle operation; no model-facing tool, child shell, ordinary path mutation, or escalated command shall be able to select, widen, or reuse that authority. ^sandbox-hvys
- Worktree lifecycle authority shall permit only the paths and Git operation verified by the host adapter and shall not weaken protected-metadata handling for any other execution or mutation. ^sandbox-i1ev
- The system shall resolve a relative mutation path against the first workspace root before authorizing it. ^sandbox-pa07
- For every path-based policy decision, the system shall derive the authorization path by resolving existing path components and symbolic links to their canonical filesystem location; it shall apply the same canonicalization to workspace roots before comparing them. ^sandbox-pa08
- Two requested paths that resolve to the same authorization path shall receive the same path-policy decision, including when one reaches an allowed location through a symbolic-link directory. ^sandbox-pa09
- When the final destination or one or more trailing components do not exist, the system shall canonicalize the nearest existing ancestor, normalize the unresolved suffix, and derive the authorization path beneath that ancestor so dot segments or separator forms cannot change the intended ancestor relationship. ^sandbox-pa10
- The system shall retain the requested path for approval evidence, result rendering, and diagnostics while using only the authorization path for workspace containment and protected-metadata decisions. ^sandbox-pa11
- A planner shall not deny a path as outside a workspace root from lexical containment alone when canonical filesystem facts can establish its authorization path; authorization shall fail closed if the required canonical filesystem facts cannot be obtained. ^sandbox-pa12
- While approval policy is `never`, the system shall apply the same authorization-path rules as every other approval policy, allowing operations already inside the permission envelope without prompting and denying canonical boundary crossings that would otherwise require approval. ^sandbox-pa13
- When a filesystem mutation path has been authorized, the system shall confine the mutation to the authorized canonical destination's pinned ancestor directories and shall fail before mutation whenever an ancestor or target identity change is detected. ^sandbox-w54h
- If the system cannot anchor a guarded workspace mutation to its authorized ancestor directories, then the system shall reject the mutation rather than mutate through pathname-based syscalls. ^sandbox-fx9n

### Exec authorization and escalation

- When a command runs with default permissions and a working directory, the system shall authorize read access to that working directory by its authorization path before execution. ^sandbox-ex01
- When a command requests escalation while the approval policy is `on-request`, the system shall request approval using the supplied justification. ^sandbox-ex02
- If a command requests escalation while the approval policy is not `on-request`, then the system shall deny the command and report that escalation cannot be requested under the current policy. ^sandbox-ex03
- When the approval policy is `never`, the system shall deny a sandbox-boundary decision that would otherwise require approval — a read-only write, or a write or delete whose authorization path is outside the authorization paths of the workspace roots — while letting exec-policy `prompt` classifications run without asking. ^sandbox-ex04
- When the approval policy is `on-request`, `on-failure`, or `untrusted`, the system shall surface a decision that requires approval as an approval request. ^sandbox-ex05
- If a child owned by an unloaded parent session reaches a decision that requires approval, then the system shall deny that decision with reason `approval_unavailable` without opening an approval prompt in the currently loaded session. ^sandbox-ex06
- An approval-unavailable denial shall be terminal for that tool call and model-visible, and shall not suspend the child pending a later parent-session reload. ^sandbox-ex07
- An approval prompt shall show the concrete effect being authorized: command and working directory for execution, or affected paths and a bounded diff for mutation, together with the sandbox boundary being crossed. ^sandbox-ex08
- The system shall label model-supplied justification as untrusted explanatory text rather than authorization evidence; truncating a preview shall preserve affected paths and report omitted-content counts. ^sandbox-ex09

### bubblewrap execution

- When a command runs sandboxed, the system shall execute it under bubblewrap with a new session, die-with-parent, and unshared user, pid, and ipc namespaces, mounting `/dev` and `/proc`. ^sandbox-bw01
- While the network mode is `disabled`, the system shall unshare the network namespace for sandboxed execution. ^sandbox-bw02
- While the filesystem mode is `read-only`, the system shall bind workspace roots read-only and mount `/tmp` as tmpfs. ^sandbox-bw03
- While the filesystem mode is `workspace-write`, the system shall bind workspace roots read-write, bind temp roots, and bind protected workspace metadata children read-only. ^sandbox-bw04
- When the filesystem mode is `danger-full-access` with network `enabled`, or `--no-sandbox` is active, or the effect is escalated, the system shall run the command unsandboxed. ^sandbox-bw05
- If sandboxed execution is requested on a non-Linux platform, then the system shall report that sandboxed execution is supported only on Linux and point to `/permissions`. ^sandbox-bw06
- When a command's requested working directory reaches an authorized directory through a symbolic link, the sandbox invocation shall make that working directory usable by the command rather than fail solely because its requested path differs from its authorization path. ^sandbox-bw07

### Failure diagnostics

- When a sandboxed command exits non-zero with output matching network-failure signatures while the network is not enabled, the system shall attach a network diagnostic suggesting a retry with `sandbox_permissions="require_escalated"`. ^sandbox-fd01
- When a sandboxed command exits non-zero with output matching filesystem-failure signatures while the mode is not `danger-full-access`, the system shall attach a filesystem diagnostic suggesting a retry with `sandbox_permissions="require_escalated"`. ^sandbox-fd02
- The system shall emit sandbox state for the footer and other UI. ^sandbox-fd03

### Tools

- The system shall expose `exec_command`, `write_stdin`, and provider-appropriate mutation tools through Taumel-owned wrappers. ^sandbox-tl01
- The system shall disable, hide, or wrap Pi built-in `bash`, `write`, and `edit` so filesystem mutation cannot bypass the gateway. ^sandbox-tl02
- When the provider is OpenAI or OpenAI-Codex, the system shall route mutation through `apply_patch`; for other providers it shall route through sandboxed `edit` and `write` wrappers. ^sandbox-tl03
- The system shall implement `apply_patch` as an object-shaped Pi function tool contract with exactly one required model-facing parameter named `input`, whose string value carries the complete patch body, while the patch engine accepts Tau-tolerant forms (heredocs, missing end markers, git and unified diffs, rename/add/delete, loose hunks, CRLF preservation, fallback context matching). ^sandbox-tl04
- The system shall enforce the same filesystem policy boundary for `apply_patch`, `edit`, and `write` as for shell execution. ^sandbox-tl05
- When the host adapter cannot service `write_stdin`, or the session id is missing, the system shall report the unavailable or invalid-session result rather than execute. ^sandbox-tl06
- The system shall describe `apply_patch` to the model as `Apply a patch to add, update, move, or delete one or more workspace files. Use the *** Begin Patch format.` ^sandbox-tl07
- The system shall describe `apply_patch.input` to the model as `The complete patch in *** Begin Patch format.` ^sandbox-tl08
- The system shall reject an `apply_patch` call that omits `input` or supplies any unknown parameter through its closed TypeBox schema. ^sandbox-tl09
- The system shall present `apply_patch` in the system tool catalog with the prompt snippet `Add, update, move, or delete workspace files with one patch.` ^sandbox-tl10
- The system shall describe `read` to the model as `Read a UTF-8 text file. Output is line-numbered and truncated to 2000 lines, 50KB total, and 2000 characters per line.` ^sandbox-tl11
- The system shall describe `read.path` to the model as `Path to the UTF-8 text file to read, relative to the current working directory or absolute.` ^sandbox-tl12
- The system shall describe `read.offset` to the model as `1-indexed line at which to start. Omit to start at line 1; a negative value starts that many lines from the end of the file.` ^sandbox-tl13
- The system shall describe `read.limit` to the model as `Maximum number of lines to return. Omit to read from offset to the end of the file, subject to the tool's truncation limits.` ^sandbox-tl14
- The system shall require `read.path` to be a non-empty string, allow optional integer `offset` and optional integer `limit` no smaller than 1, and reject unknown parameters through its closed TypeBox schema. ^sandbox-tl15
- The system shall present `read` in the system tool catalog with the prompt snippet `Read a line-numbered UTF-8 text file.` and no additional `read`-specific prompt guidance. ^sandbox-tl16
- The system shall describe `view_media` to the model as `View a PNG, JPEG, GIF, or WebP image.` ^sandbox-tl17
- The system shall describe `view_media.path` to the model as `Path to the image, relative to the current working directory or absolute.` ^sandbox-tl18
- The system shall require `view_media.path` to be a non-empty string and reject unknown parameters through its closed TypeBox schema. ^sandbox-tl19
- The system shall present `view_media` in the system tool catalog with the prompt snippet `View an image file.` and no additional `view_media`-specific prompt guidance. ^sandbox-tl20
- The system shall describe `edit` to the model as `Edit an existing text file with one or more exact text replacements.` ^sandbox-tl21
- The system shall describe `edit.path` to the model as `Path to the existing UTF-8 text file to edit, relative to the current working directory or absolute.` ^sandbox-tl22
- The system shall describe `edit.edits` to the model as `One or more non-overlapping replacements, all matched against the original file.` ^sandbox-tl23
- The system shall describe `edit.edits[].oldText` to the model as `Exact, non-empty text to replace. It must occur exactly once in the original file.` ^sandbox-tl24
- The system shall describe `edit.edits[].newText` to the model as `Replacement text. Use an empty string to delete oldText.` ^sandbox-tl25
- The system shall require `edit.path` and each `edit.edits[].oldText` to be non-empty strings, require at least one `edit.edits` entry, allow each `edit.edits[].newText` to be any string, and reject unknown parameters at every object level through its closed TypeBox schemas. ^sandbox-tl26
- The system shall present `edit` in the system tool catalog with the prompt snippet `Make one or more exact replacements in a text file.` and no additional `edit`-specific prompt guidance. ^sandbox-tl27
- The system shall describe `write` to the model as `Create, overwrite, or append to a UTF-8 text file. Parent directories are created as needed.` ^sandbox-tl28
- The system shall describe `write.path` to the model as `Path to the file, relative to the current working directory or absolute.` ^sandbox-tl29
- The system shall describe `write.content` to the model as `UTF-8 text to write exactly as provided.` ^sandbox-tl30
- The system shall describe `write.mode` to the model as `Write behavior: overwrite (default) replaces the file; append adds content at the end without inserting a newline.` ^sandbox-tl31
- The system shall require `write.path` to be a non-empty string, allow `write.content` to be any string, allow optional `write.mode` values `overwrite` and `append`, and reject unknown parameters through its closed TypeBox schema. ^sandbox-tl32
- The system shall present `write` in the system tool catalog with the prompt snippet `Create, overwrite, or append to a text file.` and no additional `write`-specific prompt guidance. ^sandbox-tl33

### no-sandbox escape hatch

- While a session is a top-level orchestrator, the system shall allow `--no-sandbox` only when the active capability profile permits it. ^sandbox-ns01
- When `--no-sandbox` is active, the system shall show it in the footer and sandbox state. ^sandbox-ns03


- When authorizing any side effect for an existing child, the system shall use the stricter combination of the child's spawn-time permission ceiling and the parent's current sandbox, approval, network, and no-sandbox constraints. ^sandbox-cp05
- When the user tightens or relaxes the parent's permissions, the new current envelope shall affect subsequent child tool authorizations immediately, while relaxation shall restore no authority beyond the child's spawn-time ceiling. ^sandbox-cp06
- While a child remains live and its parent session is not loaded, the system shall authorize child side effects against the stricter combination of the child's spawn-time ceiling and the owner permission state captured by that child resource. ^sandbox-cp07
- An unloaded parent's child shall never inherit permissions from the currently loaded main session, even when that session has the same working directory or a broader envelope. ^sandbox-cp08
- An unloaded parent's child shall never borrow the currently loaded session's approval channel or user approval. ^sandbox-cp09

### Permissions and network commands

- When the user runs `/network`, the system shall set network access to `enabled` or `disabled`. ^sandbox-pc02
- If the user disables network while the preset is `danger-full-access`, then the system shall reject the change and ask them to choose `read-only` or `workspace-write` first. ^sandbox-pc03
- When the user changes the sandbox preset, the system shall reset network mode to that preset's default and leave the approval policy unchanged. ^sandbox-pc04
- When the user opens the interactive `/permissions` menu, the system shall offer the approval policies as selectable options alongside the sandbox presets, marking the current one, so approval is changeable without typing a subcommand. ^sandbox-pc05
