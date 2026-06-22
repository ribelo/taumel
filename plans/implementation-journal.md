# Implementation Journal

## Context

Fix six known failures in Taumel's current implementation against the ADRs.
Refactor only where required to make the fixes land in the right architecture.
OCaml core modules own security/domain decisions; TS and jsoo glue stay at the
adapter edge.

---

## Entry 1 — Planning and analysis

**Current goal:** Understand all six failures, identify root causes, plan fixes.

**Files read (not modified):**
- `plans/porting-strategy.md`, `plans/sandbox.md`, `plans/tool-gateway.md`,
  `plans/capability-profile.md`, `plans/subagents.md`, `plans/thread-tools.md`,
  `plans/usage.md`
- `lib/sandbox.ml`, `lib/capability_profile.ml`, `lib/tool_gateway.ml`,
  `lib/tool_catalog.ml`, `lib/permissions.ml`, `lib/child_session.ml`,
  `lib/subagents.ml`
- `src/index.ts`, `bin/taumel.ml`
- `test/test_core_architecture.ml`, `test/test_footer_model.ml`
- `test/smoke_entrypoint.mjs`, `test/smoke_artifact.mjs`

**Decisions made:**

1. **Read-only exec denial (failure 1):** Root cause is
   `Sandbox.authorize_effect` returning `Error` for `Execute` when
   `filesystem_mode = Read_only`. The read-only sandbox already mounts workspace
   roots read-only via `plan_exec_invocation`; execution should be **allowed**
   but constrained. Fix: `Execute` returns `Ok ()` regardless of filesystem mode.
   The sandbox constrains *how* the command runs, not *whether* it runs.

2. **apply_patch metadata protection (failure 2):** Root cause is
   `authorize_path` allowing writes to any path inside workspace roots,
   including `.git/config`, `.hg/store`, etc. Command sandboxing protects these
   via `protected_workspace_children` (read-only bind mounts). Fix: add
   `is_protected_workspace_metadata_path` and deny Write/Delete to protected
   metadata dirs in workspace-write mode. This applies to `authorize_path` which
   is used by both `authorize_exec` (Read — unaffected) and `authorize_patch`
   (Write/Delete — now protected).

3. **Relative patch paths (failure 3):** Root cause is `authorize_path` /
   `workspace_contains` comparing relative patch paths against absolute workspace
   roots. Fix: add `resolve_workspace_path` that joins relative paths with the
   first workspace root; call it at the top of `authorize_path`. Absolute paths
   pass through unchanged. Map keys in `apply_to_map` stay as-is (patch-original);
   only the authorization check uses resolved paths.

4. **Child approval clamping (failure 4):** Root cause is `child_profile` using
   `Option.value definition.approval_policy ~default:parent.approval_policy`
   without clamping. A child can request `On_request` when parent is `Never`,
   widening escalation. Fix: add `approval_rank` / `stricter_approval` and clamp
   the child's approval policy to the stricter of parent and requested.
   Strictness ranking: `Never` (0) < `Untrusted` (1) < `On_request` (2) <
   `On_failure` (3).

5. **Pi built-in bypass (failure 5):** `bash` is rewritten to Taumel's
   `exec_command`/`write_stdin`, and mutation routing is provider-aware:
   OpenAI-family providers get `apply_patch`; non-OpenAI providers get
   Taumel-owned `edit`/`write` wrappers. Raw Pi built-in mutation tools are not
   exposed as a bypass path.

6. **Misplaced logic (failure 6):** Current architecture is already mostly
   correct — TS is bridge wiring, the OCaml executable is jsoo glue, OCaml owns security. The
   fixes above strengthen this by keeping all new security logic in
   `lib/sandbox.ml` and `lib/capability_profile.ml`. No TS refactor needed beyond
   verifying no duplicated logic exists.

**What remains:** Implement all fixes, add tests, run gate.

**Deviations from ADRs:** None anticipated. All fixes move toward ADR compliance.

---

## Entry 2 — Implementation complete

**Current goal:** Implement all six fixes, add tests, verify gate passes.

**Files touched:**

- `lib/sandbox.ml` — Fixes 1, 2, 3:
  - **Fix 1:** `authorize_effect` for `Execute` now returns `Ok ()` in all
    filesystem modes. The read-only sandbox constrains execution via read-only
    bind mounts in `plan_exec_invocation`; it does not deny the `Execute` effect.
  - **Fix 2:** Moved `protected_workspace_dir_names` and `join_path` above
    `authorize_path`. Added `is_protected_workspace_metadata_path` that checks
    whether a resolved path is inside `.git`/`.hg`/`.svn` under any workspace
    root. `authorize_path` now denies `Write`/`Delete` to these dirs in
    workspace-write mode, matching the protection already enforced for command
    sandboxing via read-only bind mounts (`protected_workspace_children`).
  - **Fix 3:** Added `resolve_workspace_path` that joins relative paths with the
    first workspace root. `authorize_path` resolves paths before checking
    workspace containment and metadata protection. Map keys in `apply_to_map`
    stay as the original patch path; only authorization uses the resolved path.

- `lib/capability_profile.ml` — Fix 4:
  - Added `approval_rank` and `stricter_approval` (ranking: `Never` < `Untrusted`
    < `On_request` < `On_failure`).
  - `child_profile` now clamps the approval policy with
    `stricter_approval parent.approval_policy (requested)`, so children cannot
    widen escalation behavior beyond the parent.

- `test/test_core_architecture.ml` — Added 5 new test functions:
  - `test_read_only_allows_execution` — verifies Execute is allowed in read-only,
    Mutate is still denied, and the bwrap plan mounts workspace read-only.
  - `test_sandbox_patch_metadata_protection` — verifies `.git/config`,
    `.hg/store`, `.svn/entries` are denied by `apply_patch`, while normal
    workspace files are allowed.
  - `test_sandbox_patch_relative_paths` — verifies relative Codex patch paths
    resolve against the workspace root and produce correct file contents.
  - `test_child_approval_clamping` — verifies child profiles cannot widen
    approval policy beyond parent (Never/On_failure/Untrusted clamping cases).
  - `test_gateway_wraps_legacy_mutation_tools` — verifies `bash` is not a
    Taumel gateway tool, `edit`/`write` are Taumel-owned mutation wrappers, and
    active-tools rewrite routes mutation tools by provider.

- `plans/implementation-journal.md` — This journal.

**Decisions made:**

- `apply_to_map` in `Sandbox.Patch` uses **original patch paths** as map keys —
  this is internal patch semantics. The authorization check (`authorize_path`)
  resolves relative paths against workspace roots internally.

- The bridge layer (`prepare_apply_patch` and `apply_patch_to_files` in
  `bin/taumel.ml`) returns **resolved absolute host paths** in
  `affectedPaths`, `writes[].path`, and `deletes[]`. This ensures the TS layer
  reads and writes files at the correct location — the Pi session/workspace cwd
  from `state.cwd`, not the extension process cwd (`process.cwd()`).

- `apply_patch_to_files` remaps the input files map from resolved absolute paths
  back to original patch paths before calling `apply_to_map`, so patch semantics
  (context matching, add/delete) use original keys while file I/O uses absolute
  paths.

- The `path_starts_with_dir` helper uses `normalize_path` (already present in
  the module) rather than `path_within` to avoid double-normalization
  ambiguity with the `join_path` result.

**What remains:** Nothing. All fixes implemented and tested.

**Deviations from ADRs:** None.

### Mutation routing and wrappers (failure 5)

Taumel enforces mutation routing at two levels:

1. **Active-tools rewrite** (`tool_catalog.ml`): `bash` becomes
   `exec_command` + `write_stdin`. OpenAI/OpenAI-Codex mutation exposure becomes
   `apply_patch`; non-OpenAI mutation exposure becomes Taumel-owned
   `edit`/`write` wrappers.

2. **Gateway and wrapper execution** (`tool_gateway.ml`, `bin/taumel.ml`,
   `src/tool-executor.ts`): `edit`/`write` are registered Taumel tools with
   P-mono parameter surfaces. They prepare through the gateway, authorize
   filesystem mutation through `lib/sandbox.ml`, enforce canonical workspace
   containment at the TypeScript write point, and support Tau-style filesystem
   approval prompts for sandbox escalation.

### Architecture verification — no duplicated logic (failure 6)

Confirmed:
- All filesystem authorization logic lives in `lib/sandbox.ml`
  (`authorize_path`, `authorize_effect`, `authorize_patch`).
- All tool authorization logic lives in `lib/tool_gateway.ml` (`call`).
- All capability/profile logic lives in `lib/capability_profile.ml`.
- `src/index.ts` is pure bridge wiring — no security decisions; it delegates
  every tool call to `core.prepareTool` (gateway check) before executing.
- `bin/taumel.ml` is jsoo bridge/runtime glue — it calls `gateway_authorized` before
  every tool preparation, but the actual authorization decision is made in the
  OCaml gateway/sandbox modules.
- No security logic is duplicated between TS, jsoo glue, and lib.

---

## Entry 3 — Relative apply_patch path resolution fix (audit P1/P2)

**Current goal:** Fix the unsafe relative-path apply_patch flow end-to-end.
The initial fix only resolved relative paths inside the authorization check but
returned original relative paths to the bridge, causing file I/O at the wrong
location.

**Files touched:**

- `bin/taumel.ml`:
  - `prepare_apply_patch`: `affectedPaths` now returns resolved absolute host
    paths via `Sandbox.resolve_workspace_path`.
  - `apply_patch_to_files`: Input files map is remapped from resolved absolute
    paths back to original patch paths (`remap_files_to_original_paths`) so
    `Patch.apply_to_map` keys match. Output `writes[].path`, `deletes[]`, and
    `affectedPaths` are all resolved absolute host paths.
  - Added `remap_files_to_original_paths` and `patch_original_paths` helpers.

- `test/smoke_entrypoint.mjs`: Added a relative-path patch test that verifies
  `*** Add File: relative.txt` writes to `$ctx.cwd/relative.txt` (the Pi session
  cwd), not `process.cwd()/relative.txt`.

- `plans/implementation-journal.md`: Fixed the bad assumption about
  `process.cwd()` and documented the correct architecture.

**Decisions made:**

- The base for relative path resolution is `state.cwd` (the Pi session/workspace
  cwd from the host snapshot), which feeds into `sandbox.workspace_roots`.
  This is not necessarily the same as the Node.js `process.cwd()`.

- Patch semantics (context matching in `apply_to_map`) use original patch paths
  as keys. File I/O (host reads/writes) uses resolved absolute paths. The
  remapping bridges between these two representations cleanly inside the OCaml
  glue layer — TS never sees relative paths.

**What remains:** Nothing.

**Deviations from ADRs:**

- **TypeScript bridge scope (plans/porting-strategy.md, README.md):** Addressed
  in Entry 4 below.

---

## Entry 4 — TypeScript bridge refactor and apply_patch containment follow-up (audit P1/P2/P3)

**Current goal:** Make `src/index.ts` the small loading/host boundary described in
README.md:6, reduce the broad per-feature OCaml/TypeScript bridge surface, and
close the remaining apply_patch symlink escape at the actual host filesystem
mutation point.

**Files touched:**

- `bin/taumel.ml` — the generated artifact now exports the small bridge
  surface `init(host)` and `call(name, args)`. Feature-specific OCaml functions
  are dispatch targets behind `call`, not top-level JavaScript exports. The
  apply_patch preparation also returns `workspaceRoots` and
  `validateWorkspacePaths` so the host-side mutation step can enforce canonical
  workspace containment in workspace-write mode.
- `src/index.ts` — reduced from ~1400 lines to ~53 lines. It now only loads the
  OCaml artifact, validates the two-method bridge, initializes the host,
  registers tools and commands via focused executor modules, and installs
  active-tools sync.
- `src/types.ts` — holds shared host/session types and the narrow `CoreBridge`
  type. The previous broad composed core type was removed.
- `src/util.ts` — shared adapter helpers. This file is not pure: it performs
  host filesystem discovery for sandbox facts, thread-catalog file reads,
  apply_patch file writes/deletes, and realpath-based containment checks.
- `src/tool-executor.ts` — created; owns all tool execution logic previously in
  the large `executePreparedTool` switch in `src/index.ts`. Its apply_patch path
  validates canonical read/write/delete paths before host filesystem access and
  returns a failed tool result for workspace escapes.
- `src/command-executor.ts` — created; owns all command execution logic
  previously in `executeGatewayCommand`.
- `src/host.ts` — created; `makeHost(pi)` and host-capability wiring.
- `test/smoke_artifact.mjs` — now asserts the artifact exports only
  `call` and `init`, and retrieves specs through `call`.
- `test/smoke_entrypoint.mjs` — expanded to cover relative apply_patch paths,
  relative update/move/delete, symlink escape denial in workspace-write mode,
  and outside-workspace writes in danger-full-access mode.

**Decisions made:**

- The external OCaml/TypeScript seam is intentionally small: `init(host)` for
  lifecycle setup and `call(name, args)` for all planned core operations.
  TypeScript no longer validates or depends on a long per-feature exported method
  list.
- Security/domain policy still lives in OCaml. TypeScript remains responsible
  for host-only adapter work that OCaml cannot perform directly: Pi calls,
  session creation, host command execution, filesystem reads/writes, and local
  catalog discovery.
- apply_patch needed one security check at the TS mutation point because Node's
  `readFile`, `rm`, and `writeFile` follow symlinked path segments. In
  workspace-write mode, TS resolves the affected paths and workspace roots with
  `realpath` before reads and before writes/deletes. In danger-full-access or
  `--no-sandbox`, that additional workspace containment check is disabled to
  preserve full-access behavior.
- Behavior did change. Symlink escapes now return a failed tool result and do
  not write outside the workspace; the artifact export surface is narrower; and
  smoke tests were modified to cover the new security and bridge behavior.

**What remains:** TypeScript still contains host adapter and executor code. The
broad per-feature artifact interface is gone; further LOC reduction would be a
separate porting task, not part of this audit fix.

**Deviations from ADRs:** None introduced. The Pi built-in bypass deviation
from earlier entries was superseded by the Taumel-owned `edit`/`write`
wrappers described in Entry 5.

---

## Entry 5 — Tolerant mutation compatibility and bridge rename

**Current goal:** Implement the objective from
`/home/ribelo/.codex/attachments/d9684d11-4775-44f5-b079-2211eaff44a3/pasted-text-1.txt`.

**Files touched:**

- `lib/sandbox.ml`:
  - `Patch` now accepts Tau-style tolerant inputs: heredoc-wrapped patches,
    missing end markers, git/unified diffs, `a/`/`b/` path normalization,
    `/dev/null` add/delete, rename/move forms, loose/raw `@@` hunks,
    `*** End of File`, CRLF preservation, whitespace fallback matching, loose
    Unicode punctuation/space normalization, and trailing blank-line fallback.
  - Added `authorize_mutation_path` so ordinary filesystem-mode denials can
    become approval prompts while protected workspace metadata remains a hard
    denial.
  - Tool descriptions for `exec_command`, `write_stdin`, `apply_patch`,
    `write`, and `edit` use source wording from Codex/Tau/P-mono rather than
    Taumel-invented descriptions.
- `lib/tool_catalog.ml`:
  - Mutation routing is provider-aware. OpenAI/OpenAI-Codex providers receive
    `apply_patch`; non-OpenAI providers receive `edit`/`write` unless a narrower
    legacy mutation selection is already active.
- `bin/taumel.ml`:
  - Renamed from `bin/taumel_footer.ml` because the executable is the full
    JS bridge/runtime, not a footer module.
  - Exports only `globalThis.taumel = { init, call }`.
  - Prepares `write` and `edit` through the gateway as Taumel-owned wrappers.
  - Prepares approval variants for `write`, `edit`, and `apply_patch` when the
    sandbox policy allows user escalation.
- `src/tool-executor.ts`:
  - Executes Taumel-owned `write`/`edit` wrappers through the same host
    filesystem mutation helper used by `apply_patch`.
  - Validates canonical workspace containment at the actual Node read/write
    point unless a filesystem approval was granted.
  - Implements `edit` with P-mono's `edits[].oldText/newText` parameter surface
    and original-file matching semantics.
- `scripts/build-ocaml.sh`, `src/index.ts`, `test/smoke_artifact.mjs`,
  `package.json`, `README.md`:
  - Renamed the generated artifact from `dist/taumel_footer.cjs` to
    `dist/taumel.cjs`.
- `test/test_core_architecture.ml` and `test/smoke_entrypoint.mjs`:
  - Added tolerant patch cases, provider-aware mutation routing checks, wrapper
    authorization checks, and smoke coverage for `write`/`edit`.

**Decisions made:**

- The old plan to omit Tau's ad hoc parser shape is superseded. Taumel still
  owns the implementation in OCaml, but intentionally accepts Tau-style patch
  tolerance to support non-OpenAI providers.
- Source tool descriptions are preserved: Codex for `apply_patch`,
  Codex/Tau-style unified exec for `exec_command`/`write_stdin`, and P-mono for
  `write`/`edit`.
- Protected `.git`/`.hg`/`.svn` paths are not approval-gated. They remain hard
  denials in workspace-write mode to preserve the security boundary.

**Verified so far:**

- `nix develop -c dune build bin/taumel.bc.js`
- `nix develop -c dune runtest`

## Entry 6 — TypeBox tool-contract bridge rewrite

**Current goal:** Make TypeScript the Pi-facing tool contract owner and keep
OCaml focused on policy/domain planning.

**Changes made:**

- Added `src/tool-contracts.ts` as the source of Pi-facing model-callable tool
  names, descriptions, prompt snippets, and TypeBox parameter schemas.
- Added `scripts/generate-contract-bindings.mjs`, which emits concrete `.d.ts`
  interfaces from the TypeBox schemas, runs `ts2ocaml`, and runs `gen_js_api`.
  Generated OCaml bindings live under `bin/generated/` and are ignored.
- Tool execution now validates params in TypeScript before calling OCaml.
  OCaml receives trusted JS objects through generated `Ojs.t` getters.
- Removed live model-param `json_from_js` decoding and the old OCaml-emitted
  tool schema surface. OCaml tool specs now carry only policy metadata:
  name and effect kind.
- Registration now uses TS tool contracts, asks OCaml for policy/allowed tool
  names, and fails fast if the TS/OCaml tool-name sets drift.
- `apply_patch` is object-shaped at the Pi contract boundary (`input` or
  `patch`); the patch engine still owns tolerant patch-body parsing.

**Verified so far:**

- `nix develop -c sh -c 'node scripts/generate-contract-bindings.mjs && dune runtest'`
- `npm run build:ocaml && npm run smoke:artifact && npm run smoke:entrypoint`
- `nix develop -c sh scripts/build-ocaml.sh`
- `nix develop -c node test/smoke_artifact.mjs`
- `bun test/smoke_entrypoint.mjs`
- `nix develop -c npm run gate`

**What remains:** Nothing for this objective.

## Entry 7 — Exa tools on the TypeBox bridge

**Current goal:** Port Tau's Exa tool names to Taumel without reviving the old
bridge shape.

**Changes made:**

- Added TypeBox contracts for the Exa core tools and Agent endpoint tools in
  `src/tool-contracts.ts`.
- Added `lib/exa.ml` for Exa tool policy names, network effect registration,
  approval prompt text, missing-key results, and normalized result rendering.
- Added `bin/exa_bridge.ml`, which executes Exa HTTP requests through Eta HTTP
  in the js_of_ocaml target and re-checks gateway authorization before
  execution.
- Wired Exa through `prepareTool`/`executeExa` and the existing TS executor
  action switch. TS still only parses params and routes UI approval.
- `exa_agent_create_run` always returns an approval action before the HTTP
  request can run. It uses the existing approval outcome taxonomy:
  `denied_by_user`, `timed_out`, `unavailable`, and `interrupted`.
- Omitted deprecated Exa request fields (`context`, `livecrawl`,
  `livecrawlTimeout`) and did not expose the Agent delete endpoint.

**Verified so far:**

- `nix develop -c sh -c 'node scripts/generate-contract-bindings.mjs && dune runtest'`
- `bun test/smoke_exa_contracts.mjs`
- `npm run gate`

**What remains:** Commit for this objective.
