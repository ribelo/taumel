---
kind: requirement
tags: [agents, worktrees, git, sandbox]
depends_on: ["[[docs/requirements/subagents]]", "[[docs/requirements/sandbox]]", "[[docs/requirements/tool-gateway]]"]
---
# Agent worktrees

## Intent

An agent identity may use a persistent Git worktree instead of sharing its
parent's workspace. The worktree gives every run of that identity one stable,
isolated filesystem and a dedicated branch. The child may inspect, stage, and
commit through a constrained Git broker, while the main agent exclusively owns
integration and physical-worktree lifecycle decisions.

## Requirements

### Isolation and identity

- The system shall support the immutable agent isolation modes `none` and `worktree`, shall default every identity-creation tool to `none`, and shall apply the selected mode to every run of that identity. ^agent-09i6
- While an identity uses `none`, the system shall use its immutable source workspace as its effective workspace and shall create no worktree or dedicated branch for that identity. ^agent-8jmu
- While an identity uses `worktree`, the system shall use exactly one persistent agent worktree as its effective workspace and shall reuse it for every run until the identity is closed or the main agent removes it. ^agent-1wr2
- The system shall place every agent worktree beneath `$HOME/.pi/agent/taumel/worktrees/<project-name>/<owner-component>/<agent-id>`. ^agent-ciz6
- The system shall derive `project-name` from the basename of the main Git repository root, including when the source workspace is itself a linked worktree. ^agent-jgpi
- The system shall derive `owner-component` as a deterministic, filesystem-safe, non-reversible, collision-resistant digest of the complete owning Pi session identity and shall retain the short owner-scoped agent handle as `agent-id`. ^agent-355j
- The system shall assign every agent worktree one deterministic dedicated branch that is unique to the repository, owning Pi session, and agent identity. ^agent-55ie
- The system shall persist the identity's closed worktree binding but shall derive its isolation mode, effective path, and dedicated branch deterministically rather than store them as independently variable fields or maintain a separate worktree registry. ^agent-bigq
- The system shall treat native Git worktree registration, repository metadata, and refs as authoritative and shall not mirror Git status, commit hashes, integration state, or physical-removal state into agent session state. ^agent-0zl1
- For every model-facing `agent_list` item, the system shall report the identity's immutable source workspace as `workspace`, report its immutable isolation mode as `isolation`, and omit its effective worktree path and dedicated branch. ^agent-tagg
- For a worktree-isolated identity, the `/agent-runs` Inspect submenu shall show the effective worktree path to the user. ^agent-7msy
- The main agent shall discover an isolated identity's physical worktree and dedicated branch through ordinary Git inspection rather than through agent-tool results. ^agent-w5yy

### Creation and baseline

- When a caller requests `isolation = worktree`, the system shall require the source workspace to belong to a Git repository with a resolvable `HEAD` commit. ^agent-wdil
- If the source workspace is not a Git repository, then the identity-creation tool shall fail as a tool-result error with code `workspace_unavailable` and a clear message that an isolated agent worktree cannot be created because the project is not a Git repository. ^agent-b14y
- If the source repository has no resolvable `HEAD` commit, then the identity-creation tool shall fail as a tool-result error with code `workspace_unavailable` and a clear message that an isolated agent worktree cannot be created because the repository has no `HEAD` commit. ^agent-c2vk
- When creating an agent worktree, the system shall use the installed native Git worktree mechanism and shall not synthesize or reimplement Git administrative metadata. ^agent-ifm4
- Before native worktree creation, source-state reproduction, or baseline creation mutates worktree or shared Git metadata, the trusted worktree adapter shall obtain a matching operation-scoped `agent_worktree_mutation(provision)` authorization. ^agent-zywx
- When creating an agent worktree, the system shall create its dedicated branch from the source workspace's current `HEAD`. ^agent-vgba
- When populating an agent worktree, the system shall reproduce the source workspace's tracked modifications, tracked deletions, and untracked non-ignored files and shall omit ignored untracked files. ^agent-okwt
- When the source workspace contains staged and unstaged versions of the same tracked file, the system shall place the current working-tree content in the agent worktree baseline. ^agent-ugw6
- When creating an agent worktree, the system shall create one baseline commit on the dedicated branch after reproducing the source state, including an empty baseline commit when that state matches `HEAD`. ^agent-w2w6
- The system shall author and commit every automatic baseline as `Pi Baseline <pi-baseline@local>` without reading or changing the user's Git identity configuration. ^agent-vptx
- After creating the baseline, the system shall present the child with a clean index and working tree whose filesystem tree exactly matches the accepted source-state snapshot. ^agent-9e5w
- When creating an agent worktree, the system shall compare the source `HEAD` and a fingerprint of tracked content, tracked deletions, and untracked non-ignored content before and after capture. ^agent-ne9r
- The source-state fingerprint and accepted baseline shall preserve regular-file content, executable mode, symbolic-link targets, and Git-tracked file type; if a source entry required by the snapshot cannot be represented safely, then creation shall fail rather than omit or rewrite it. ^agent-s2zv
- The system shall define the accepted source snapshot point as the second matching source fingerprint, conditional on subsequent verification that the baseline represents that fingerprint; a source mutation after the second fingerprint shall belong to a later source state and shall not invalidate the accepted baseline. ^agent-y6kl
- If the source fingerprint changes before the accepted source snapshot point, then the system shall reject the start with `workspace_unavailable` and roll back the newly created worktree and dedicated branch. ^agent-6ln3
- If native worktree creation, source-state reproduction, baseline creation, or verification fails, then the system shall fail the start with `workspace_unavailable` and shall never fall back to the shared workspace, another directory, or a temporary worktree. ^agent-viw6
- Before creating a provisional worktree or branch, the system shall durably record a child-inaccessible provisional marker bound to the owner, agent identity, repository, intended worktree path, intended branch, and completed creation steps. ^agent-2t9n
- If the intended worktree path, native registration, or dedicated branch already exists without the matching provisional marker and verified creation record, then creation shall fail with `workspace_unavailable` and rollback shall not remove, rewrite, or adopt the colliding resource. ^agent-hnbe
- While a worktree-isolated start has not accepted its initial child instruction, the system shall treat its worktree and branch as provisional resources. ^agent-srlr
- If routing, child-session creation, tool-surface validation, initial message acceptance, process continuity, or another start step fails after provisional resources were created, then the system shall use the durable marker to remove only matching provisional resources before completing or recovering rollback. ^agent-npz1
- The system shall clear the provisional marker only after initial child-message acceptance makes the identity and its worktree durable. ^agent-blo8
- On resume after process loss, the system shall reconcile every retained provisional marker before permitting a conflicting creation and shall reclaim only resources whose repository, path, registration, branch, and recorded creation facts match that marker. ^agent-4xub
- If provisional-resource rollback cannot complete, then the model-facing failed call shall return a bounded opaque cleanup incident identifier without a retained path or branch, while user-only rendering or logs shall identify the retained resource without reporting a successful identity start. ^agent-8yj2

### Child confinement

- While an identity uses `worktree`, the system shall start and reopen its child Pi session with the agent worktree as the child's current directory and effective workspace root. ^agent-kaoq
- While an identity uses `worktree`, the system shall authorize ordinary child filesystem mutation only within the canonical authorization path of that agent worktree and shall never authorize mutation of the source workspace through that identity. ^agent-929u
- While an identity uses `worktree`, the system shall retain the existing sandbox read policy and shall not make worktree isolation a new read-confinement mode. ^agent-rsuw
- The system shall keep ordinary child access to protected Git metadata read-only and shall permit Git metadata mutation only through the Agent Git broker. ^agent-z58w
- The Agent Git broker shall obtain one operation-scoped internal `agent_worktree_mutation(broker)` authorization before native Git mutates a verified worktree administration area, dedicated branch ref or reflog, or shared object store. ^agent-nesg
- When authorizing an Agent Git broker subcommand, the system shall enforce the stricter combination of the identity's immutable permission ceiling and its owner's current permission envelope before crossing the ordinary protected-metadata boundary. ^agent-jets
- While the effective permission envelope is read-only, the Agent Git broker shall allow its supported read-only subcommands and shall reject `add`, `restore --staged`, and `commit`. ^agent-3dq7

### Brokered Git execution

- The system shall use the existing `exec_command` model-facing contract for supported agent-worktree Git operations and shall add no separate model-facing Git tool. ^agent-edu3
- When a worktree-isolated generic child calls `exec_command` with `git` as its executable, the execution planner shall classify the request as ordinary sandboxed execution, brokered agent Git, or rejection before any process starts. ^agent-74bh
- The execution planner shall authorize brokered agent Git through a dedicated closed grammar applied after the existing shell parser and shall not treat the ordinary known-safe command classifier as sufficient broker authorization. ^agent-sw83
- The execution planner shall select brokered agent Git only when the parsed request is exactly one simple command whose first token is exactly `git` and whose second token is an allowed subcommand, with no caller-supplied global Git options before that subcommand. ^agent-dc3z
- If a worktree-isolated child requests Git through a pipeline, command list, redirection, substitution, shell expansion, wrapper, environment assignment, executable path, or another non-simple form, then `exec_command` shall reject the complete request rather than execute any part normally or without the sandbox. ^agent-0ykc
- The brokered agent Git grammar shall support only `status`, `diff`, `log`, `show`, `add`, `restore --staged`, and `commit`; it shall not support `rev-parse` or `branch`. ^agent-mx7r
- If an eligible Git request names another subcommand, an abbreviated long option, an unlisted alias, combined short flags, `--pathspec-from-file`, a NUL-output mode, an interactive mode, an editor mode, or a stdin-driven form, then `exec_command` shall fail before invoking Git and shall not fall back to ordinary shell execution. ^agent-01xr
- The brokered agent Git grammar shall require options before revision operands and shall require every pathspec after an explicit `--`. ^agent-o83c
- The brokered agent Git grammar shall accept at most 256 argument tokens and 65,536 total argument bytes, at most 1,024 bytes in each revision expression, at most 4,096 bytes in each pathspec, and at most 16,384 bytes in a commit message. ^agent-gowp

#### Read commands

- The broker shall accept `git status [OPTIONS] [-- PATHSPEC...]`, where the output form is at most one of default, `--short`, `--porcelain=v1`, or `--porcelain=v2`, and the remaining options are at most one `--branch` and one `--untracked-files=no|normal|all`. ^agent-064r
- The broker shall reject every other `status` option, including NUL, verbose, ignored-file, column, stash, rename-control, and submodule-control options. ^agent-sqdc
- The broker shall accept `git diff [OPTIONS] [REV [REV]] [-- PATHSPEC...]` and `git diff (--cached|--staged) [OPTIONS] [REV] [-- PATHSPEC...]`, allowing at most one of `--cached` and `--staged`. ^agent-vvoh
- The broker shall allow at most one `diff` output mode from `--patch`, `--stat`, `--shortstat`, `--numstat`, `--name-only`, `--name-status`, `--summary`, `--check`, and `--quiet`, plus optional `--exit-code`, optional `--no-renames`, and optional `--unified=N` with `0 <= N <= 1000` only for patch output. ^agent-yjga
- The broker shall reject every other `diff` option, including no-index, output-file, external-diff, text-conversion, order-file, pickaxe, binary-output, and submodule-formatting options. ^agent-rpez
- The broker shall accept `git log [OPTIONS] [REV] [-- PATHSPEC...]`, allowing optional `--oneline`, at most one count form from `-n N`, `--max-count=N`, and `-N` with `1 <= N <= 1000`, at most one detail form from `--patch`, `--stat`, `--name-only`, and `--name-status`, and optional `--graph`, `--decorate=short`, `--first-parent`, and `--reverse`. ^agent-c9gj
- When an accepted `log` request omits a count form, the broker shall inject a maximum count of 100 commits. ^agent-3wxz
- The broker shall reject every other `log` option, including custom formatting, date or search filtering, `--all`, reflog walking, line tracing, mailmap controls, decoration patterns, and stdin revisions. ^agent-czh9
- The broker shall accept `git show [OPTIONS] [OBJECT] [-- PATHSPEC...]`, allowing optional `--oneline`, at most one detail form from `--patch`, `--no-patch`, `--stat`, `--name-only`, and `--name-status`, and zero or one object selector defaulting to `HEAD`. ^agent-b7ja
- The broker shall reject multiple `show` objects, custom pretty formats, and every unlisted `show` option. ^agent-vh5r

#### Staging and commit commands

- The broker shall accept selective staging only as `git add -- PATHSPEC...` with at least one pathspec or as `git add --all [-- PATHSPEC...]`. ^agent-p4ft
- The broker shall reject every other `add` option or form, including force, interactive, patch, edit, intent-to-add, update-only, renormalization, chmod, sparse override, refresh, ignore-errors, dry-run, and indirect pathspec input. ^agent-abky
- Before invoking `add`, the broker shall expand selected paths safely, preserve native Git pathspec matching and internal transformations, and reject the complete operation if a selected path resolves to a gitlink, nested repository, or executable clean or process filter. ^agent-7wk8
- The broker shall accept restore only as `git restore --staged -- PATHSPEC...` with at least one pathspec and shall reject `--source`, `--worktree`, patch, merge, conflict, recursion, indirect pathspec input, and every other option. ^agent-1ta1
- The broker shall accept commit only as `git commit -m MESSAGE`, `git commit --message MESSAGE`, or `git commit --message=MESSAGE`, requiring exactly one non-whitespace message and permitting no pathspec or other option. ^agent-stdn
- The broker shall reject commit message files, stdin or editor messages, multiple message paragraphs, amend, empty commits, empty messages, signing, signoff, trailers, author or date overrides, `-a`, include, only, fixup, squash, templates, interactive or patch mode, caller-supplied hook controls, and every other commit option. ^agent-32fp
- Before creating a child-requested commit, the system shall resolve the user's ordinary configured author and committer name and email through a separate hardened lookup; it shall then provide only those resolved identity values and trusted overrides through an isolated Git configuration, force `user.useConfigOnly=true`, and return native Git's nonzero result when nothing is staged or no usable identity exists. ^agent-pf4f

#### Revisions, repository, and execution

- The broker shall treat an allowed revision or object selector as one non-empty argument that does not begin with `-` and contains no control character and shall let native Git validate its revision syntax. ^agent-nse1
- The broker shall preserve native Git pathspec magic and matching after `--`, while forbidding indirect pathspec sources and confining selected paths to the verified worktree and index. ^agent-iy3c
- When `exec_command.workdir` is omitted, the broker shall use the child's effective worktree root; when it is supplied, the broker shall require its canonical authorization path to be the root or a descendant and shall invoke Git from that exact canonical directory. ^agent-ropo
- Before invoking native Git, the broker shall verify that the canonical working directory, registered linked worktree, main repository, owning session, agent identity, and dedicated branch match one another and shall fix `GIT_DIR` and `GIT_WORK_TREE` from that verified registration rather than rediscover or accept them from the caller. ^agent-6w7i
- The broker shall resolve a trusted installed Git executable independently from child-controlled `PATH` and working directory and shall invoke it directly with the validated argument vector without a shell. ^agent-ndmz
- The execution planner shall apply existing explicit exec-policy rules before broker routing and shall never let broker routing weaken a configured prompt or forbidden decision. ^agent-ogkn
- The system shall reject `with_escalated_permissions = true` for every brokered Git invocation and shall never execute the original Git shell command unsandboxed as a broker fallback. ^agent-a7i8
- Before spawning brokered or baseline Git, the system shall remove inherited `GIT_*` variables, hide mutable user and system Git configuration, and install only verified repository values, separately resolved commit identity where applicable, and trusted hardening values. ^agent-kpb3
- The broker shall disable aliases, editors, pagers, color, terminal prompts, replacement objects, filesystem monitors, hooks, signing, credential helpers, automatic maintenance, external diff and text conversion, and submodule recursion; it shall disable optional locking for read commands. ^agent-fxg2
- Provisioning, brokered, baseline, and cleanup Git shall permit descendant execution only of the canonical trusted Git executable and required trusted internal Git helpers recursively constrained by the same fixed repository, isolated environment, validated operation, and metadata authorization; shells and every non-Git descendant shall be denied. ^agent-zblc
- The trusted Git environment shall disable hooks, automatic maintenance, and every other post-operation integration so no untrusted descendant can run after index or ref acceptance. ^agent-gjph
- The broker shall close subprocess stdin, shall allow empty `write_stdin` polling for an active background Git process, and shall reject non-empty stdin writes to that process. ^agent-opts
- The broker shall hold one per-identity lease until a brokered Git process exits and shall reject another overlapping broker invocation for that identity. ^agent-nipa
- The broker shall reuse `exec_command` process-exit, bounded output, truncation, full-output artifact, cancellation, background-session, and rendering semantics. ^agent-og85
- A nonzero native Git exit shall remain an executed-command result, while grammar rejection, permission denial, repository mismatch, unsafe-filter detection, or broker verification failure shall remain a failed `exec_command` tool call. ^agent-hy5x
- The system shall apply the brokered Git subprocess, environment, hook, signing, filter, filesystem-monitor, external-driver, and submodule restrictions to automatic source-state capture and baseline creation. ^agent-cqek

### Integration and lifecycle

- The system shall never automatically copy, merge, rebase, cherry-pick, or otherwise apply an agent worktree or its dedicated branch to the main workspace. ^agent-xva3
- The system shall leave the dedicated branch and native worktree registration available for the main agent to inspect and integrate through ordinary Git operations outside the child broker. ^agent-zefk
- The system shall never remove an accepted agent worktree automatically because a run completed, failed, was cancelled, was suspended, or because its owning process or session stopped. ^agent-hoiz
- `agent_close` shall default `delete_worktree` to `false`; while that value is false, closing shall preserve both the physical agent worktree and its dedicated branch. ^agent-9iax
- If `agent_close` receives `delete_worktree = true` for an identity using `none`, then the tool shall fail with `invalid_arguments` and shall leave the identity unchanged. ^agent-p4tl
- When `agent_close` receives `delete_worktree = true` for a worktree-isolated identity, the system shall stop the child, verify the derived worktree and registration, refuse removal while uncommitted changes remain, invoke native Git worktree removal, preserve the dedicated branch, and remove the identity only after physical removal succeeds. ^agent-vsj8
- Before native worktree removal or cleanup of matching provisional Git resources mutates worktree or shared Git metadata, the trusted worktree adapter shall obtain a matching operation-scoped `agent_worktree_mutation(cleanup)` authorization. ^agent-85dy
- Every brokered Git process and command session shall be owned by its agent identity; before close can succeed or deletion cleanliness can be inspected, the system shall cancel and await all such processes and release their broker leases. ^agent-09sj
- If an identity-owned broker process cannot be terminated and awaited, then `agent_close` shall fail with `cleanup_failed`, retain the identity and process ownership state, and shall not inspect or remove the worktree concurrently. ^agent-4lz5
- For worktree deletion, the system shall define clean as having no staged change, tracked unstaged change, untracked non-ignored file, dirty or untracked content in an initialized submodule, or unfinished repository operation; ignored files and commits reachable from the dedicated branch but absent from the source branch shall not make the worktree dirty. ^agent-ee6h
- Before worktree deletion, the system shall determine cleanliness through hardened native Git inspection with executable integrations disabled and shall inspect the verified linked-worktree administrative state for unfinished operations. ^agent-lf2x
- The system shall invoke native `git worktree remove` without force and shall propagate Git's refusal as `cleanup_failed` even when the preceding cleanliness inspection found no disqualifying state. ^agent-ihd7
- If requested worktree deletion fails verification, detects uncommitted changes, or cannot complete native removal, then `agent_close` shall fail with `cleanup_failed` and shall retain the identity in an inspectable, retryable state; if its worktree remains valid, a suspended identity may be resumed or closed again, while an unavailable worktree shall remain listable and closeable but shall cause a later `agent_send` to fail with `workspace_unavailable`. ^agent-yphg
- If both the derived agent worktree and its Git registration are already absent, then `agent_close(delete_worktree = true)` shall treat physical cleanup as complete and close the identity while preserving any remaining dedicated branch. ^agent-efu8
- If the derived path or Git registration exists but does not match the identity, repository, or each other, then `agent_close(delete_worktree = true)` shall fail with `cleanup_failed` and shall not delete or deregister either resource. ^agent-ew5x
- When an accepted agent worktree becomes unavailable, the identity shall remain listable and closeable, while a later send or reopen shall fail with `workspace_unavailable` rather than substitute another workspace. ^agent-kbsq
- When a worktree identity's source-origin path becomes unavailable but its derived worktree, native registration, and main-repository metadata still verify, the system shall continue to resolve and use that worktree without representing the missing source as an invalid effective-workspace state. ^agent-ms11

## Open questions

None.
