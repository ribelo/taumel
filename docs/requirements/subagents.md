---
kind: requirement
tags: [agents, subagents, finder, oracle, orchestration]
depends_on: ["[[docs/requirements/capability-profile]]", "[[docs/requirements/sandbox]]", "[[docs/requirements/tool-gateway]]", "[[docs/requirements/shared-infrastructure]]"]
traces_to: ["[[docs/research/amp-agent-surfaces]]", "[[docs/adr/0003-persist-agent-context-in-private-pi-sessions]]", "[[docs/adr/0004-deduplicate-agent-completion-notifications]]", "[[docs/adr/0005-bind-agent-identities-to-their-workspaces]]", "[[docs/adr/0006-scope-agent-ownership-to-pi-sessions]]", "[[docs/adr/0007-remove-agent-state-on-close]]"]
---
# Agents

## Intent

Taumel provides durable, asynchronous child agents owned by a main Pi session.
A generic agent is created with a message and a low, medium, or high tier; it
otherwise behaves like a normal Pi agent. Finder is created with a discovery
query, while Oracle is created with a message. Both are built-in
specialists with dedicated model-facing tools, fixed purposes, and read-only
authority. All three kinds share identity, continuation, waiting, persistence,
notification, and closing mechanics.

Model-facing orchestration remains provider-portable: every tool result is valid
JSON, child output is delivered only by an explicit `agent_wait`, resolved model
and thinking stay user-only, and short caller-supplied descriptions label work
without becoming part of the child instruction.

An agent identity retains its Pi conversation across runs. Each run is a
separately addressable asynchronous unit. `agent_wait` races explicitly selected
runs and returns when the first result is ready, while opaque completion
notifications make unwaited finishes visible without copying their results into
the parent conversation.

This design deliberately exceeds Amp's one-shot `Task`: Taumel agents are
steerable, reusable, and resumable. It deliberately omits profiles, user-defined
agents, goal-mode continuation, Librarian, Review, and Painter.

## Requirements

### Model-facing surface

- The system shall expose exactly the agent tools `agent_spawn`, `agent_send`, `agent_wait`, `agent_list`, `agent_close`, `finder`, and `oracle`. ^agent-ts01
- The system shall not expose `agent_profiles`, a legacy agent multiplexer, a profile or persona selector, Librarian, Review, or Painter. ^agent-ts02
- The system shall provide all seven tools in TUI, print, JSON, and RPC modes and shall not gate them on interactive UI availability. ^agent-ts03
- The system shall keep every agent tool schema stable for the main session lifetime; configuration and agent state shall change behavior, not registered schemas. ^agent-ts04
- The system shall keep nesting depth exactly one and expose none of the seven agent tools to a child agent. ^agent-ts05

### Tool contracts

- `agent_spawn` shall require a non-empty `message` and non-empty `description`, accept optional `tier` restricted to `low`, `medium`, or `high`, default tier to `medium`, accept optional `isolation` restricted to `none` or `worktree` and default it to `none`, and reject unknown parameters. ^agent-tc01
- `finder` shall require a non-empty `query` and non-empty `description`, `oracle` shall require a non-empty `message` and non-empty `description`, both tools shall accept optional `isolation` restricted to `none` or `worktree` and default it to `none`, and both tools shall reject unknown parameters. ^agent-tc02
- `agent_send` shall require `agent_id`, accept optional `message`, `description`, and `interrupt`, require a non-empty message unless `interrupt = true`, require a non-empty `description` exactly when a message is supplied, and reject routing, prompt, tool, sandbox, and profile overrides. ^agent-tc03
- `agent_wait` shall require a non-empty array of unique `run_ids`, accept optional non-negative `timeout_seconds`, and reject agent-id selectors, empty or duplicate selections, implicit all-run selection, and unknown parameters. ^agent-tc04
- `agent_list` shall accept no parameters. ^agent-tc05
- `agent_close` shall require one non-empty `agent_id`, accept optional Boolean `delete_worktree` defaulting to `false`, and reject arrays, `all`, and unknown parameters. ^agent-tc06
- Every successful start through `agent_spawn`, `finder`, or `oracle` shall return one JSON object whose base fields are exactly `agent_id`, `run_id`, `kind`, and `status = running` without waiting for completion; the model-facing result shall not expose resolved model or thinking. ^agent-tc07
- A successful generic start shall additionally return its resolved `tier`; Finder and Oracle start objects shall omit `tier`. ^agent-tc08
- A successful `agent_send` that affects a run shall return one JSON object containing exactly `agent_id`, affected `run_id`, resulting `status`, and `outcome`; `no_active_run` shall return exactly `agent_id` and `outcome = no_active_run`, omitting `run_id` and `status`. ^agent-tc09
- `agent_list` shall return one top-level JSON array whose items contain `agent_id`, identity `created_at`, `kind`, `isolation`, source `workspace`, active or latest `run_id` and `started_at`, authoritative lifecycle `status`, the run snapshot fields defined below, and an `activity` object containing `state`, `last_at`, `recommendation`, and `active_tool_calls`, plus `tier` only for generic identities; items shall not expose resolved model or thinking, and an empty list shall be `[]`. ^agent-2jx5
- A successful `agent_close` shall return only the closed `agent_id` and `status = closed`; after that result, every former agent and run ID shall be unknown to all agent tools. ^agent-tc11
- The model-facing `finder` description shall identify it as an asynchronous specialist for conceptual, behavior-based, or multi-step discovery that correlates findings across files. ^agent-tc12
- The model-facing description of `finder.query` shall ask for relevant terms, file types, expected content or naming patterns, and clear success criteria. ^agent-tc13
- The model-facing `agent_spawn` metadata shall position generic delegation for substantial execution tasks whose primary outcome is an action or artifact and that benefit from independent asynchronous execution. ^agent-tc14
- The model-facing description of every agent `description` parameter shall request a specific, action-oriented, three-to-five-word label written for the user and shall state that the label is used for compact TUI display rather than sent to the child. ^agent-tc15
- The model-facing `agent_list` description shall state that it returns lifecycle status, per-run execution metrics, and observable activity phase and timing for progress inspection, and shall not claim that elapsed silence proves a stall. ^agent-tc16
- A failed agent tool call shall use exactly one stable `error.code` from `invalid_arguments`, `agent_not_found`, `run_not_found`, `agent_limit_reached`, `routing_unavailable`, `workspace_unavailable`, `child_session_unavailable`, `dispatch_failed`, `persistence_failed`, `cleanup_failed`, or `internal_error`. ^agent-tc17
- Unknown, closed, and not-owned agent resources shall all use `agent_not_found`, while unknown, closed, and not-owned run resources shall all use `run_not_found`; the error code or message shall not reveal whether another owner has the requested resource. ^agent-tc18
- Routing configuration, model availability, authentication, and thinking-selection failures discovered before dispatch shall use `routing_unavailable`; child creation or message-acceptance failures shall use `dispatch_failed`; unavailable bound workspaces and private child sessions shall use their corresponding stable codes. ^agent-tc19
- A provider, quota, authentication, or transport failure after run acceptance shall fail the run and remain observable through `agent_wait` rather than retroactively failing the accepted tool call; the same failure before message acceptance shall use the applicable `routing_unavailable` or `dispatch_failed` failed-call code. ^agent-tc20
- Failure to read or write durable agent state shall use `persistence_failed`, failure to complete permanent close cleanup shall use `cleanup_failed`, and only otherwise-unclassified subsystem failures shall use `internal_error`; unavailable child output shall remain a successful wait result with null output rather than use any failed-call code. ^agent-tc21
- The model-facing `oracle` description shall be `Create a durable, read-only Oracle advisory specialist and start an asynchronous run for independent technical reasoning, judgment, critique, diagnosis, planning, review, or recommendations. The identity can be continued with agent_send; the call returns after the instruction is accepted, without waiting for completion.`; `message` shall be described as `The Oracle's initial instruction. Include the guidance, decision, or review needed, relevant context and constraints, available evidence, and attempted approaches.` ^agent-tc22
- The model-facing `agent_send` description shall be `Send an instruction to an existing open agent in its retained conversation. Depending on current state, the call starts new work, steers active work, resumes suspended work, interrupts and replaces active execution, or interrupts without replacement. A message requires a short user-facing description.`; `agent_id` shall be described as `The owner-scoped agent handle returned by agent_spawn, finder, oracle, or agent_list.`; `message` shall be described as `The instruction to start idle work, steer active work, resume suspended work, or replace interrupted work. Omit only to interrupt without replacement.`; `description` shall be described as `A required three-to-five-word user-facing label for the message, used in compact TUI display and not sent to the child.`; and `interrupt` shall be described as `When true, interrupt active work before sending a message, suspend active work when message is omitted, and have no additional effect when no active execution exists.` ^agent-tc23
- The model-facing `agent_wait` description shall be `Race selected agent runs and return every result ready at the observation point. Omitted timeout waits indefinitely; a timeout bounds only this call and never stops the runs. Call again with returned pending_run_ids to await later completions.`; `run_ids` shall be described as `Unique owner-scoped run IDs that all belong to the current session.`; and `timeout_seconds` shall be described as `Maximum seconds to wait. Omit to wait indefinitely; use 0 to poll once. Timing out leaves all pending runs active.` ^agent-tc24
- The model-facing `agent_list` description shall be `List all open agent identities owned by the current session, including lifecycle status, per-run execution metrics, and observable activity phase, timing, and recommended next action.` ^agent-tc25
- The model-facing `agent_close` description shall be `Permanently close one agent identity, interrupt active execution, and remove all of its runs from current Taumel state. By default, an agent worktree and its dedicated branch are preserved; optional worktree deletion removes only a clean, verified worktree and preserves its branch. Closed identities cannot be resumed; use agent_send interruption for a reversible stop.`; `agent_id` shall be described as the owner-scoped handle of the identity to close permanently; and `delete_worktree` shall be described as `When true, remove the agent's clean, verified worktree while preserving its dedicated branch. Defaults to false.` ^agent-tc26
- The model-facing description of `agent_spawn.isolation`, `finder.isolation`, and `oracle.isolation` shall be `Workspace isolation for the new identity: none (default) uses the bound parent workspace; worktree creates a dedicated Git worktree.` ^agent-w981
- The model-facing metadata for each agent tool shall use its tool description for the complete capability and important operational semantics, its prompt snippet for a concise and distinctive one-line catalog orientation, its parameter descriptions only for field-local meaning, units, defaults, constraints, or examples, and its optional prompt guidelines for tool-selection or usage policy. ^agent-695o
- Every model-facing agent prompt guideline shall explicitly identify the tool or tools to which it applies and shall not repeat parameter-schema facts or duplicate the complete capability description. ^agent-1xfj
- The model-facing agent prompt guidelines shall direct callers to use `finder` for conceptual, behavior-based, or multi-file discovery that correlates findings across files, `oracle` when the primary deliverable is independent judgment, critique, diagnosis, planning, review, or a recommendation, and `agent_spawn` for substantial delegated execution only when neither specialist purpose fits, especially independent multi-step work, parallel disjoint work, or work with extensive intermediate output that the parent does not need; they shall direct callers to prefer direct tools for known paths, symbols, or exact text. ^agent-cu3c
- The model-facing agent prompt guidelines shall distinguish `agent_send` as the tool for instructing an existing open identity, including idle start, active steering, suspended resume, and active interruption; `agent_wait` as the tool for awaiting or polling selected runs and retrieving their outcomes and child output; and `agent_list` as the tool for inspecting owned open identities, lifecycle status, per-run turn count, and observable activity before choosing a lifecycle action, without inferring a stall from elapsed silence alone. ^agent-mbxx
- Each of `agent_spawn`, `finder`, `oracle`, `agent_send`, `agent_wait`, and `agent_list` shall own a separate prompt guideline that describes when, and where useful when not, to use that tool; a guideline shall reference another tool only where needed to resolve a selection ambiguity, and the system shall not place the complete cross-tool routing policy under one tool. ^agent-vkp0
- The model-facing generic-agent tier parameter description shall identify the field's meaning and state that `medium` is the default, while the `agent_spawn` prompt guideline shall provide concrete low, medium, and high selection examples for coding, independent research, and verification or operational work. ^agent-78rs
- The model-facing `agent_spawn` tier guideline shall be `For agent_spawn, choose tier by task complexity and scope. Use low for straightforward, well-defined work: a one-file change or simple mechanical refactor across the codebase; bounded delegated internet research; or one known check or bounded evidence collection. Use medium for well-scoped work requiring reasoning across several files; focused independent research across multiple sources; or reproducing and verifying a workflow across several components. Use high for difficult, open-ended, or repository-wide work: broad cross-cutting changes; comprehensive independent research requiring broad source synthesis; or repository-wide failure investigation and validation. Medium is the default.` ^agent-cqyx
- The model-facing description of `agent_spawn.tier` shall be `The generic agent's capacity tier. Defaults to medium.` ^agent-us77
- The model-facing `agent_spawn` routing guideline shall be `Use agent_spawn for substantial delegated execution that does not fit finder or oracle, especially independent multi-step work, parallel disjoint work, or work with extensive intermediate output that the parent does not need.` ^agent-wdfo
- The model-facing `finder` routing guideline shall be `Use finder for conceptual, behavior-based, or multi-file discovery that requires correlating findings across files. Do not use finder when the path, symbol, or exact text is known; use direct read or search tools instead.` ^agent-84os
- The model-facing `oracle` routing guideline shall be `Use oracle when the primary outcome is independent reasoning, judgment, critique, diagnosis, planning, review, or a recommendation rather than carrying out the resulting action.` ^agent-pkzt
- The model-facing `agent_send` routing guideline shall be `Use agent_send when new instructions, steering, interruption, or resumed work should target an existing open agent and retain its context.` ^agent-lfet
- The model-facing `agent_send` reuse guideline shall be `Prefer agent_send over starting a new agent when an existing agent's retained context is relevant to the next task, such as work on the same objective, files, component, or constraints.` ^agent-dw6e
- The model-facing `agent_spawn` distinct-scope guideline shall be `Use agent_spawn to create a new identity when substantial delegated execution has a materially different objective, files, component, or constraints and an existing agent's retained context would not help.` ^agent-mqpf
- The model-facing `agent_close` usage guideline shall be `Use agent_close when an open agent is no longer expected to receive related follow-up work.` ^agent-wgj7
- The model-facing `agent_spawn` context-handoff guideline shall be `When using agent_spawn, remember that the child has its own conversation and does not inherit the parent conversation. Include all relevant decisions, context, constraints, and validation instructions in message, or reference paths to files that contain them.` ^agent-4zay
- The model-facing `agent_wait` usage guideline shall be `Use agent_wait to retrieve outcomes and child output from selected runs, or to pause until at least one selected run is ready.` ^agent-f0iv
- The model-facing `agent_list` usage guideline shall be `Use agent_list when you need an overview of open agents before deciding which identity or run to wait for, continue, interrupt, resume, or close. Treat activity as observed progress, not a health or stall judgment.` ^agent-hx8f
- The model-facing `agent_spawn` description shall be `Create a durable generic agent for substantial delegated execution and start its first asynchronous run. The identity retains its conversation across later agent_send calls. The call returns after the initial instruction is accepted, without waiting for completion.` ^agent-pqmy
- The model-facing `agent_spawn` prompt snippet shall be `Start a durable generic agent for substantial asynchronous execution.` ^agent-todp
- The model-facing description of `agent_spawn.message` shall be `The agent's initial instruction. Include the desired outcome, scope, relevant context, constraints, validation, and expected result.` ^agent-7i3j
- The model-facing `finder` description shall be `Create a durable, read-only Finder specialist and start an asynchronous run for conceptual, behavior-based, or multi-step discovery that correlates findings across files. The identity can be continued with agent_send; the call returns after the query is accepted, without waiting for completion.` ^agent-s58q
- The model-facing `finder` prompt snippet shall be `Start a read-only Finder for conceptual, multi-file discovery.` ^agent-ub6w
- The model-facing description of `finder.query` shall be `The discovery query. Be specific and include relevant terms, file types, expected content or naming patterns, and clear success criteria.` ^agent-9s9b
- The model-facing `oracle` prompt snippet shall be `Start a read-only Oracle for independent technical reasoning and advice.` ^agent-4mcx
- The model-facing `agent_send` prompt snippet shall be `Continue, steer, resume, or interrupt an existing agent.` ^agent-44uh
- Model-facing descriptions, parameter descriptions, prompt snippets, and prompt guidelines shall not characterize Finder, Oracle, or a generic-agent tier as fast, medium-speed, slow, cheap, or expensive; callers shall select among them by purpose, task complexity, and scope because configured routing and runtime conditions do not guarantee relative latency or cost. ^agent-48td
- The model-facing `agent_wait` waiting-strategy guideline shall be `Prefer one indefinite agent_wait call over repeated polling or agent_list checks when no useful work can proceed until a selected run finishes.` ^agent-88sp
- The model-facing `agent_wait` prompt snippet shall be `Wait for selected agent runs and retrieve ready outcomes.` ^agent-lbc5
- The model-facing `agent_list` prompt snippet shall be `Inspect open agent identities and their latest run activity.` ^agent-p9k1

### Agent kinds and definitions

- The system shall support exactly three agent kinds: `generic`, `finder`, and `oracle`. ^agent-kd01
- When Taumel creates a generic child, Pi shall provide the child's base system prompt through its ordinary agent-session machinery for the child's model, tools, workspace, and project guidance. ^agent-kd03
- When Taumel creates a Finder child, Taumel shall use the content of `resources/agents/finder.md` as the child's base system prompt. ^agent-ki03
- When Taumel creates an Oracle child, Taumel shall use the content of `resources/agents/oracle.md` as the child's base system prompt. ^agent-xe88
- Taumel shall provide the Finder and Oracle base system prompts to Pi through Pi's resource/context mechanism. ^agent-kd05
- The Taumel build shall import and embed each agent prompt Markdown resource—`resources/agents/subagent.md`, `resources/agents/finder.md`, and `resources/agents/oracle.md`—in the shipped extension build output. ^agent-8wra
- At runtime, Taumel shall obtain the common subagent, Finder, and Oracle prompts from the embedded Markdown resource imports produced by the build. ^agent-um6s
- Finder shall specialize in local conceptual and multi-step discovery across files rather than mutation or external research. ^agent-kd07
- Oracle shall specialize in advisory tasks whose primary outcome is independent reasoning, judgment, critique, or a recommendation rather than carrying out the resulting action, including architecture, root-cause analysis, planning, review, and technical second opinions. ^agent-kd08
- Finder and Oracle shall use the same internal identity and run lifecycle as generic agents rather than separate orchestration implementations. ^agent-kd09
- Pi shall continue to own each child's provider interaction, retry, compaction, message history, and ordinary agent-session lifecycle; Taumel shall orchestrate identities and runs without duplicating those host behaviors. ^agent-kd10
- Every child shall use Pi's ordinary resource and extension loading; Taumel shall not filter discovered extensions, suppress their initialization, or construct a restricted resource loader for children. ^agent-kd11
- Parent and child shall remain independent conversations whose only communication is explicit parent-supplied messages and the child's returned last assistant message for a run; Taumel shall not copy, summarize, or otherwise transfer the parent transcript, current turn, reasoning, tool results, or hidden context into a child. ^agent-kd12
- The system shall treat a child run as completed only after Pi settles it, including provider retries, auto-compaction retries, tool turns, and accepted steering; an intermediate low-level `agent_end` shall not complete the Taumel run. ^agent-kd13
- Finder's extra instructions shall make it a strict file locator that returns at most a two-line summary followed by absolute paths and relevant line ranges, searches exhaustively when completeness is requested, scopes and parallelizes independent searches without fixed call or turn quotas, and includes complete relevant sections with five to ten lines of surrounding context. ^agent-kd14
- Oracle's extra instructions shall retain its expert-subagent framing and default to the simplest viable recommendation, minimal incremental changes, YAGNI and KISS, at most one materially distinct alternative, context-first tool use, and a concise flexible response ordered as recommendation, rationale, risks, and escalation triggers when relevant; they shall not require effort estimates, fixed response headings, or citations. ^agent-kd15
- The system shall retain an agent task description as parent-facing metadata and shall not include it in the initial, steering, or resumed message delivered to the child. ^agent-kd16
- Taumel shall deliver final or partial child answers to the parent only as attributed `agent_wait` tool-result fields and shall not inject child answers automatically as user, assistant, developer, or custom conversation messages. ^agent-kd17

### Routing and configuration

- The system shall interpret generic tier as a routing key whose zero-configuration behavior inherits the parent's model and selects the matching Pi thinking level `low`, `medium`, or `high`. ^agent-rt01
- The system shall default Finder to inherited parent model with `low` thinking and Oracle to inherited parent model with `high` thinking. ^agent-rt02
- Taumel config shall allow complete model/thinking overrides for `taumel.agents.generic.low`, `taumel.agents.generic.medium`, `taumel.agents.generic.high`, `taumel.agents.finder`, and `taumel.agents.oracle`. ^agent-rt03
- A routing entry's `model` shall be either `inherit` or one canonical `provider/model` string, and its `thinking` shall be one Pi-supported thinking level. ^agent-rt04
- A present routing override shall contain both `model` and `thinking`; the shared Taumel config precedence shall select one whole entry without field-by-field merging across scopes. ^agent-rt05
- When a routing entry is malformed, the system shall report a scoped diagnostic and fail requests that depend on that entry rather than silently using defaults. ^agent-rt06
- When concrete configured routing names an unregistered model or a model without usable authentication, identity creation shall fail clearly and shall not substitute the parent model, another model, an alias target, or a provider default. ^agent-rt07
- The system shall resolve and snapshot the actual model and thinking level when creating an identity; later config or parent-model changes shall affect only new identities. ^agent-rt08
- User-only TUI surfaces, including expanded start slots and `/agent-runs`, shall expose the actual resolved model and thinking level so users need not infer what routing selected; model-facing start, send, wait, list, and close results shall not expose either value. ^agent-rt09
- When the resolved model cannot use the requested or configured thinking level, identity creation shall fail clearly rather than silently clamp, disable, or replace that level. ^agent-rt10

### Tool surfaces

- A generic identity shall inherit the parent's active logical tool selection at creation, excluding all seven agent tools, and keep the resulting selection stable for its lifetime. ^agent-tl01
- Finder shall inherit only parent-active local read and command-execution tools, excluding mutation, network, approval-request, and agent-spawn effects. ^agent-tl02
- Oracle shall inherit only parent-active read, command-execution, and network tools, excluding mutation, approval-request, and agent-spawn effects. ^agent-tl03
- Neither specialist shall gain a tool absent from the parent's active selection. ^agent-tl04
- After resolving the child provider, the system shall apply the existing provider-aware `Tool_catalog` normalization to the child's selected tools. ^agent-tl05
- When an OpenAI or OpenAI-Codex child inherits mutation capability, normalization shall replace `edit` and `write` with `apply_patch`; for another provider it shall replace an inherited `apply_patch` capability with the corresponding `edit` and `write` selection. ^agent-tl06
- Capability normalization shall also preserve the existing shell-tool rewrite and shall not duplicate provider-specific tool logic inside the agent subsystem. ^agent-tl07
- Agent children shall receive neither goal lifecycle tools automatically nor goal-mode continuation behavior. ^agent-tl08

### Permissions and ownership

- A generic identity's spawn-time permission ceiling shall be no broader than its parent's permission envelope at creation. ^agent-pm01
- Finder and Oracle shall additionally have a fixed read-only sandbox ceiling and shall never receive mutation authority. ^agent-pm02
- Every child side effect shall be authorized against the stricter combination of the identity's immutable spawn-time ceiling and its parent's current permission envelope. ^agent-pm03
- Tightening parent permissions shall affect existing identities immediately; relaxing them may restore authority only up to the spawn-time ceiling and shall not change the identity's tool surface. ^agent-pm04
- No child shall enable `no_sandbox` or inherit `danger-full-access` beyond the existing child clamp, and every Finder, Oracle, and worktree-isolated child shall reject command escalation rather than use approval to cross its immutable filesystem ceiling. ^agent-082w
- A child approval prompt shall identify the requesting agent; if its owning parent session is not loaded, the tool call shall receive `approval_unavailable` rather than displaying a prompt in another session or waiting indefinitely. ^agent-pm06
- Every identity, run, wait, notification, send, list, close, and manager action shall remain scoped to the owning parent session and shall reveal no metadata for another owner's resources. ^agent-pm07
- The agent owner shall be the Pi session identity rather than a conversation branch; in-place tree navigation shall retain ownership and access to that session's agents, including agents created on another branch. ^agent-pm08

### Identities and runs

- An agent identity shall retain one Pi child conversation across multiple runs until permanently closed. ^agent-id01
- The system shall generate an owner-scoped `agent_id` shaped `<kind>-<nano-id>`, where kind is `agent`, `finder`, or `oracle` and `nano-id` is exactly four characters from `abcdefghjkmnpqrstuvwxyz23456789`; it shall generate each owner-scoped `run_id` as `<agent_id>-run-<positive-integer>` with the integer increasing monotonically per identity, retry agent-handle collisions, never accept either ID from a spawning caller, and never reuse either within that parent session, including after closure. Exhausting a kind's four-character namespace shall fail creation clearly rather than lengthening or reusing a handle; the entropy strategy is not contractual. ^agent-id02
- An identity shall have at most one active or suspended run; concurrent executions shall never mutate one child conversation. ^agent-id03
- An identity shall keep immutable kind, generic tier when applicable, resolved routing, assigned tool surface, spawn-time permission ceiling, one closed workspace-binding variant, and child-session reference; isolation mode and effective-workspace behavior shall derive from the workspace binding rather than exist as independently variable identity fields. ^agent-gx91
- A run shall have one of `running`, `suspended`, `completed`, `failed`, `cancelled`, or `lost` status, a bounded reason code, timestamps, and independent completion-announcement state. ^agent-id05
- When decoding a child SDK completion, the system shall accept only the closed set of known completion statuses and stop reasons; an unknown or malformed state shall fail the run rather than be normalized to successful completion. ^agent-l7da
- Only the currently authoritative child dispatch may transition a run or supply its output; late completion, error, cancellation, or output from a superseded dispatch shall have no model-facing effect. ^agent-id06
- Closing an identity shall permanently remove that identity and all of its runs from Taumel state; every former agent and run ID shall thereafter be unknown and shall never be reused. ^agent-id07
- A run reason code shall be absent for completion or one of `interrupted_by_parent`, `parent_shutdown`, `process_interrupted`, `close_cleanup_failed`, `host_cancelled`, `dispatch_failed`, `agent_failed`, `internal_error`, or `child_session_lost`; arbitrary host or provider messages shall not become reason codes. ^agent-xcql
- Variable run diagnostics shall use a separate optional `error` field bounded to 4,096 characters; truncating that field shall not alter the run's status or reason code. ^agent-id09
- Suspended runs shall use only `interrupted_by_parent`, `parent_shutdown`, `process_interrupted`, or `close_cleanup_failed`; cancelled runs shall use `host_cancelled`; failed runs shall use `dispatch_failed`, `agent_failed`, or `internal_error`; lost runs shall use `child_session_lost`; running and completed runs shall have no reason code. ^agent-sc2r
- State-changing operations and child callbacks for one identity shall be serialized so every observable outcome is equivalent to one total order; no send, interrupt, completion, shutdown, or close race shall create concurrent runs, restore removed state, or make a stale dispatch authoritative. ^agent-id11
- When the system prepares an agent start, send, or close action, it shall issue an expiring one-shot capability bound to the owner session, exact agent and action, permission epoch, and per-owner/per-agent state epoch. ^agent-kbo4
- On capability issuance and every authority-relevant agent state transition, the system shall advance the per-owner/per-agent state epoch; expected synchronous progression shall ratchet only its fully validated claimed capability, while an incompatible transition shall leave every prior capability stale. ^agent-p7r2
- Until a prepared agent-action capability is successfully claimed, the system shall not commit its agent state, reserve closure, or provision its worktree; after claim, the system shall fully revalidate expiry, owner, action, agent, owner epoch, permission epoch, and agent-state epoch following asynchronous waits and before every further authority-sensitive effect, including worktree acceptance. ^agent-1inq
- Before a compensating agent cleanup effect, the system shall validate the claimed capability's expiry, owner, exact action and agent, owner epoch, permission epoch, and agent-state epoch, and cleanup authorization shall never authorize a successful forward effect. ^agent-q8m3
- Identity creation, successful closure, and owner-capacity accounting shall be serialized per owner so parallel starts can never exceed the 64-identity limit or reuse a slot before closure is durable. ^agent-id12
- When Pi settles a run with a final assistant answer, the system shall transition that run to `completed` and persist its output locator independently of `agent_wait`, `/agent-runs`, notification delivery, or any other observation of the answer. ^agent-id13
- Every run shall initialize `turn_count` to zero, increment it once for each assistant turn emitted during that run, including tool-call turns and the final-answer turn, and shall not carry the count across runs in the same identity. ^agent-id14
- When the system accepts an initial, steering, or resumed instruction for a run, it shall retain that instruction's caller-supplied agent task description as the run's latest description independently from the full submitted message or query. ^agent-id15
- When a child emits an assistant turn, starts a tool, reports tool progress, or returns a tool result for the authoritative dispatch, the system shall set that run's `last_activity_at` to the observation time; stale-dispatch activity shall not change it. ^agent-id16
- While a run has emitted no child activity, its `activity.last_at` shall be null and any user-facing elapsed-time or configured-deadline evaluation shall use the run's `started_at` as its baseline. ^agent-id17
- If an accepted run terminates because of a provider, authentication, quota, transport, or host execution error, then the system shall set its lifecycle status to `failed`, use the applicable existing bounded reason code, and retain bounded variable diagnostics separately; activity state shall not replace that terminal status. ^agent-id18
- `activity.state` shall describe observable execution phase using exactly `starting`, `reasoning`, `using_tool`, `orphaned`, or `inactive`; accepted runs with no child activity shall be `starting`, live model/provider work shall be `reasoning`, live child-tool execution shall be `using_tool`, a run recorded as `running` without an authoritative live dispatch shall be `orphaned`, and suspended or terminal runs shall be `inactive`; elapsed silence alone shall not select an activity state. ^agent-id19
- An accepted run shall begin in `starting`; authoritative Pi `agent_start` or `turn_start` shall set `reasoning`; the first active `tool_execution_start` shall set `using_tool`; parallel tool execution shall keep that state until the last active `tool_execution_end`, which shall restore `reasoning`; suspension or terminal settlement shall set `inactive`; and reconciliation without a live authoritative dispatch shall set `orphaned`. ^agent-id20
- Authoritative Pi `turn_end` shall increment `turn_count` and update `last_activity_at`; `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` shall update `last_activity_at`; phase-only `agent_start` and `turn_start` events shall not update that timestamp. ^agent-id21
- Pi `agent_end` shall not settle a Taumel run or force an inactive phase because Pi may retry, compact, or process follow-up work; authoritative `agent_settled` shall determine terminal settlement after those continuations finish. ^agent-id22
- When an authoritative child activity event changes only observable activity or run metrics, the system shall apply it to the loaded session state without writing durable agent state. ^agent-ishi

### Run snapshots and metrics

- The system shall maintain run-scoped `turn_count`, `tool_call_count`, `failed_tool_call_count`, and `tool_calls_by_name` for every run; a later run in the same identity shall initialize fresh counters rather than inherit an earlier run's metrics. ^agent-uvso
- When an authoritative child dispatch starts a tool call, the system shall increment `tool_call_count`, increment the count for that tool's logical name in `tool_calls_by_name`, and increment `activity.active_tool_calls`; progress events shall not increment those cumulative counters, and a matching terminal tool event shall decrement `activity.active_tool_calls` without allowing it below zero. ^agent-v2is
- When an authoritative terminal tool event identifies the tool call as failed, the system shall increment `failed_tool_call_count` exactly once; retries represented as distinct tool starts shall remain distinct calls, and stale-dispatch events shall change no run metric. ^agent-ogol
- While a run is active, its list snapshot shall expose non-negative `elapsed_ms` measured from `started_at` to the observation time; when a run is suspended or terminal, its list and wait snapshots shall instead expose non-negative `duration_ms` measured from `started_at` to the applicable suspension or end time. ^agent-6zrf
- When Pi reports token usage for an authoritative assistant turn, the system shall accumulate that run's non-negative `input_tokens`, `cached_input_tokens`, and `output_tokens` and expose them as a `usage` object; the system shall omit `usage` when authoritative usage is unavailable and shall not substitute identity-lifetime or parent-session usage. ^agent-08az
- When Pi reports child-context utilization, the system shall snapshot and expose it as `context = { "window_tokens": <non-negative integer>, "utilization_percent": <number from 0 through 100> }`; terminal and suspended run results shall retain the snapshot captured for that run, and the system shall omit `context` when authoritative context information is unavailable. ^agent-tkh5
- The system shall expose `turn_count`, `tool_call_count`, `failed_tool_call_count`, and `tool_calls_by_name` in model-facing run snapshots, where `tool_calls_by_name` maps each used logical tool name to its positive call count and omits unused tools; snapshots shall expose no tool arguments, raw tool results, hidden reasoning, transcript content, separate run-level worktree path, continuation flag, or resume hint, while identity-level `workspace` remains governed by the list contract. ^agent-vuzo
- The system shall not add redundant continuation metadata to list or wait snapshots because every existing identity is continuable through its returned `agent_id`; continuation guidance shall remain part of the `agent_send` contract rather than persisted run state. ^agent-b52c

### Workspace binding

- At creation, an identity shall receive exactly one immutable workspace binding: `shared` containing one canonical source root, or `worktree` containing the canonical source origin and immutable main-repository identity needed to derive and verify its dedicated worktree. ^agent-bfle
- A shared workspace binding shall have its source root as its only possible effective workspace and shall contain no worktree, branch, or alternate effective-path state. ^agent-u9ie
- A worktree workspace binding shall derive its isolation mode, effective path, and dedicated branch from the binding, owner, and agent identity and shall not persist a separately mutable effective path, isolation field, or branch field. ^agent-w3zz
- Before any child start, reopen, filesystem authorization, brokered Git operation, or physical cleanup, the system shall resolve the identity's workspace binding into one complete verified shared-workspace or worktree capability; if verification fails, it shall produce `workspace_unavailable` or `cleanup_failed` as applicable rather than pass a partial path combination to execution. ^agent-12lz
- After a worktree identity is accepted, the source-origin path shall remain immutable descriptive metadata but shall not be an execution dependency; later runs shall require the verified agent worktree, its native Git registration, and its main-repository metadata instead. ^agent-s6sg
- The system shall never recreate, refresh, rebaseline, rebase, or substitute an accepted agent worktree because its source-origin path changed or became unavailable. ^agent-axo5
- Parent directory changes, session switching, and process resume shall not rebind an existing identity. ^agent-ws02
- When the bound workspace is unavailable for a later send or reopen, the attempted run shall fail clearly while the identity remains inspectable and closeable. ^agent-ws03
- The system shall not substitute the parent's current directory, process directory, another workspace, or a temporary directory for an unavailable bound workspace. ^agent-ws04

### Starting agents

- `agent_spawn` shall create one generic identity and immediately start its first run from `message` using the resolved tier routing. ^agent-sp01
- `finder` shall create one Finder identity and immediately start its first run by passing `query` as the child's initial message; `oracle` shall create one Oracle identity and immediately start its first run from `message` through the same shared start machinery. ^agent-sp02
- Starts shall be asynchronous and shall return only after child creation and message acceptance are known, not after the run finishes. ^agent-sp03
- If child creation, routing, workspace validation, or initial message acceptance fails, the system shall return a clear error and shall not leave an apparently running orphan identity or run. ^agent-sp04
- A parent session shall own at most 64 existing agent identities; `agent_spawn`, `finder`, and `oracle` shall fail clearly before routing or child creation when that limit is reached, and successful `agent_close` shall free one identity slot. ^agent-sp05

### Sending, steering, and suspension

- When `agent_send` supplies a message to an existing idle identity, the system shall start a new run with a new `run_id` in the retained child conversation. ^agent-sd01
- When `agent_send` supplies a message to an active run without interruption, the system shall steer that same logical run and return its existing `run_id` rather than create a concurrent run. ^agent-sd02
- When `agent_send` supplies `interrupt = true` and a message to an active run, the system shall first interrupt the current child execution and then send the message through the retained child session, keeping the same logical run active under the same `run_id`. ^agent-sd03
- When `agent_send` supplies `interrupt = true` without a message to an active run, the system shall interrupt execution and mark that run suspended without closing the identity or creating a replacement run. ^agent-sd04
- When `agent_send` supplies a message to a suspended run, with either value of `interrupt`, the system shall resume that same run through the retained child session and return the same `run_id`; there is no live execution to interrupt first. ^agent-sd05
- When interruption without a message targets an identity with no active or suspended run, the system shall return a normal no-active-run result and change nothing. ^agent-sd06
- `agent_send` shall work uniformly for generic, Finder, and Oracle identities while preserving each identity's kind, routing, tools, prompt behavior, permissions, and workspace. ^agent-sd07
- If message dispatch fails after the current execution was interrupted, the logical run shall fail clearly and the interrupted execution shall not become authoritative again. ^agent-sd08
- When an idle or suspended identity cannot pass workspace, child-session, routing, tool-surface, or message-acceptance preflight, `agent_send` shall fail without allocating a new run or changing the suspended run; the identity shall remain inspectable and closeable. ^agent-sd09
- When interruption without a message targets a suspended run, the system shall return `already_suspended` with that run ID and change nothing. ^agent-sd10
- When `agent_send` supplies a message to an idle identity, with either value of `interrupt`, the system shall start a new run; `interrupt = true` shall have no additional effect because no execution exists to interrupt. ^agent-sd11
- Successful `agent_send` results shall use exactly one model-visible outcome from `message_sent`, `interrupted_and_sent`, `suspended`, `already_suspended`, `resumed`, `started`, or `no_active_run` according to the identity state and supplied fields. ^agent-sd12

### Waiting

- `agent_wait` shall implement a race over exactly the supplied run IDs rather than a join. ^agent-wt01
- If one or more selected runs are already terminal or suspended, `agent_wait` shall return immediately with every selected result ready at the observation point and list the remaining active IDs as `pending_run_ids`. ^agent-wt02
- If every valid selected run is active, `agent_wait` shall block until at least one becomes terminal or suspended, then return every result ready at that observation point plus `pending_run_ids`. ^agent-wt03
- Omitted `timeout_seconds` shall wait indefinitely, zero shall poll once, and a positive value shall bound only that wait call. ^agent-wt04
- On bounded timeout, `agent_wait` shall return a successful timeout result with unchanged `pending_run_ids` and shall not alter any run. ^agent-wt05
- User interruption of a pending wait shall interrupt only the wait and leave every selected agent run unchanged. ^agent-wt06
- Terminal run results shall remain idempotently readable through repeated `agent_wait` calls and shall have no consume-once or `already_consumed` state. ^agent-wt07
- Because an already-ready run wins a later race immediately, `pending_run_ids` shall contain exactly the still-active selected run IDs that may be passed to the next `agent_wait` call. ^agent-wt08
- Before claiming or observing any selected run, `agent_wait` shall validate the complete selection and reject the whole call if any run ID is unknown or not owned; a rejected call shall change no run or announcement state, and not-owned errors shall reveal no agent kind, status, timing, output, error, or other metadata. ^agent-wt09
- When a pending wait returns a terminal run whose completion announcement is still pending, the system shall mark that announcement observed before resolving the tool call so no later background notification is emitted for it; an already-sent notification shall remain sent. ^agent-wt10
- When a race returns, the system shall release wait claims for losing active runs so their later completions remain eligible for notification or another wait. ^agent-wt11

### Result boundaries

- A completed run shall return its final assistant answer without Taumel summarization. ^agent-rs01
- A failed, cancelled, or lost run shall return its reason or error separately and label any available incomplete assistant text as partial rather than final. ^agent-rs02
- A suspended run shall return status and reason without presenting incomplete text as a final answer. ^agent-rs03
- Agent tools shall never return hidden reasoning, raw transcripts, tool logs, or a specialist's resolved prompt. ^agent-rs04
- Wait results shall include agent and run IDs, kind, status, timing, run-scoped execution metrics, and bounded reason metadata; they shall not expose resolved model or thinking. ^agent-rs05
- If a completed answer cannot be recovered from Pi's child session, `agent_wait` shall return `output = null` rather than inventing output or treating the read as a tool failure; if incomplete text for a failed, cancelled, or lost run cannot be recovered, it shall analogously return `partial_output = null`. ^agent-rs06
- When a recovered answer exceeds the shared tool-output line or byte limits, `agent_wait` shall use the same truncation and full-output artifact mechanism as command sessions, return clearly marked truncated text with truncation metadata and the complete output file path, and shall not summarize the answer. ^agent-rs07
- `agent_wait` shall return one stable JSON object containing `timed_out`, `results`, and `pending_run_ids`; each result shall contain agent and run IDs, kind, status, start and applicable end timestamps, the run snapshot fields defined above, and the status-specific answer field when required below, and shall omit resolved model and thinking. ^agent-rs08
- A completed result shall expose the child's final assistant text only as `output: string | null`; a failed, cancelled, or lost result shall expose available incomplete assistant text only as `partial_output: string | null`; suspended results shall expose neither field, and final and partial fields shall never coexist. ^agent-rs09
- `agent_wait` shall represent a recoverable empty final or partial assistant answer as an empty string and unavailable answer text as null. ^agent-rs10
- A run's returned output shall come only from that run's last assistant message after Pi settles the run; Taumel shall not concatenate intermediate assistant turns, prior-run messages, tool results, or transcript content into the output. ^agent-rs11
- Only `agent_wait` shall return a child's final or partial assistant message to the parent; starts, sends, lists, closes, completion announcements, and automatically injected conversation messages shall never copy that answer into model-visible content. ^agent-rs12
- Every successful `agent_spawn`, `finder`, `oracle`, `agent_send`, `agent_wait`, `agent_list`, and `agent_close` result shall present its complete model-visible result as valid JSON with no surrounding prose; `agent_list` shall use a top-level array, the other tools shall use their defined JSON objects, and arbitrary final or partial child text in `agent_wait` shall be encoded as a JSON string field without summarization. ^agent-rs13
- If an agent tool call fails, then the tool shall return a valid JSON object with `ok = false` and an `error` object containing a stable bounded `code` and human-readable bounded `message`, with no surrounding prose; Pi shall still mark the result as a tool error independently from that JSON content. ^agent-rs14
- Every timestamp exposed by an agent tool shall be an ISO 8601 local date-time with an explicit numeric UTC offset, such as `2026-07-14T11:19:18+02:00`; agent tools shall not expose offset-less local time, epoch seconds, or epoch milliseconds. ^agent-rs15
- Successful agent tool JSON objects shall omit an `ok` field and contain only their domain result fields; `ok = false` is reserved for the stable failed-call envelope, and `agent_list` shall remain a bare JSON array. ^agent-rs16
- Every ready `agent_wait` result shall contain the common fields `agent_id`, `run_id`, `kind`, `status`, `started_at`, `turn_count`, `tool_call_count`, `failed_tool_call_count`, `tool_calls_by_name`, and `duration_ms`, plus `usage` and `context` when available; a completed result shall additionally contain exactly the status-specific fields `ended_at` and `output`; a failed, cancelled, or lost result shall additionally contain exactly the status-specific fields `ended_at`, `reason`, `error`, and `partial_output`; and a suspended result shall additionally contain exactly the status-specific fields `suspended_at` and `reason`, apart from truncation metadata permitted by **agent-rs07**. ^agent-rs17
- An `agent_wait` result shall omit inapplicable status-specific fields and unavailable `usage` or `context` rather than setting them or their timestamps to null; only `output`, `partial_output`, and `error` may use null to distinguish unavailable text or absent variable diagnostics from an inapplicable field. ^agent-rs18
- If a bounded wait reaches its deadline before any selected result becomes ready, `agent_wait` shall return `timed_out = true`, an empty `results` array, and every still-active selected run ID in `pending_run_ids`; otherwise it shall return `timed_out = false` with the results and pending IDs ready at the winning observation point. ^agent-rs19
- Although ordinary agent answers are not expected to reach the shared output limits, a truncated `output` or `partial_output` shall add exactly `truncation = { "original_bytes": <non-negative integer>, "returned_bytes": <non-negative integer>, "full_output_path": <absolute path> }`; an untruncated result shall omit `truncation`, and the returned text shall retain the visible shared truncation marker. ^agent-rs20

### Completion announcements

- Every terminal run shall track completion announcement state independently from its idempotently readable result, using the states `pending`, `observed_by_agent_wait`, and `notification_sent`. ^agent-nt01
- A terminal run observed by `agent_wait` before notification delivery shall transition to `observed_by_agent_wait` and shall never emit a completion notification. ^agent-nt02
- An unobserved terminal run shall be eligible for one opaque `agent_completion` custom message to its owning parent at turn end, or immediately via a triggered turn when the parent is idle. ^agent-nt03
- The model-visible content of an `agent_completion` message shall be exactly one valid JSON object containing `event = agent_completion`, `agent_id`, `run_id`, `kind`, and `next_action = { "tool": "agent_wait", "arguments": { "run_ids": [<run_id>], "timeout_seconds": 0 } }`; it shall have no surrounding prose and omit result text, error, terminal status, reason, model metadata, and delivery metadata. ^agent-nt04
- Sending a completion notification shall not consume, remove, or otherwise alter the run result. ^agent-nt05
- While an `agent_wait` call claims a run, completion flushing shall treat that run as unavailable for notification delivery. ^agent-nt06
- Before sending, the system shall transiently claim and revalidate the run; concurrent flushes shall not send the same notification. ^agent-nt07
- The system shall mark `notification_sent` only after Pi accepts the message, release the claim after a failed send, and retry a still-pending notification later. ^agent-nt08
- Each completion message shall use Pi custom type `notification` and carry stable hidden delivery identity `agent_completion:<run_id>` in its persistent parent-session message details, following the established exec-completion rendering convention. ^agent-nt09
- On resume or retry, the system shall inspect the parent session for that stable completion message and reconcile the run to `notification_sent` instead of inserting a duplicate. ^agent-nt10
- Suspended runs shall not emit completion notifications. ^agent-nt11
- User-only output inspection in `/agent-runs` shall not mark a completion observed or suppress the model-facing notification. ^agent-nt12
- While an owning parent session is not loaded, its pending completion notifications shall remain queued and shall never be delivered into another loaded session; they shall become deliverable when their owner is loaded again. ^agent-nt13

### Persistence and resume

- Taumel shall create every child with a persistent Pi `SessionManager` in a Taumel-owned child-session directory outside Pi's normal main-session index. ^agent-ps01
- Child sessions shall not appear in Pi's normal `/resume` list or pollute main-session discovery. ^agent-ps02
- Pi child session files shall own child messages, transcripts, reasoning, tool records, compaction, and final assistant text; Taumel shall not duplicate Pi's transcript format in parent state. ^agent-ps03
- When the system durably records an agent lifecycle transition, the owner's current agent registry shall include identity and run metadata, the latest run-scoped execution metrics and terminal context snapshot, resolved routing, tool and permission snapshots, the closed workspace binding, child session reference, and completion announcement state; it shall not persist isolation mode or effective-workspace facts separately from that binding. ^agent-1qif
- After a persistent agent owner first acquires durable agent state, the system shall maintain exactly one current registry for that owner in Taumel-owned storage outside the parent Pi session. ^agent-qeg2
- When a durable agent lifecycle transition changes the current registry, the system shall atomically replace the owner's stored registry before reporting the transition as successful. ^agent-8ino
- When an agent operation leaves the durable agent registry unchanged, the system shall perform no durable write. ^agent-zr7q
- The system shall not append agent registry snapshots, activity samples, run metrics, or polling results to the parent Pi session. ^agent-dh9z
- When a persistent agent owner first acquires durable agent state, the system shall append exactly one bounded registry-presence marker to the parent Pi session containing the owner session identity and storage schema version but no agent identity, run, path, activity, metric, or permission data. ^agent-cbh3
- If a parent registry-presence marker exists but the matching current registry is missing, malformed, or owned by another session, then the system shall fail closed without treating the owner as having empty agent state. ^agent-oqhi
- When no current registry or registry-presence marker exists and the parent session contains a compatible agent-registry snapshot owned by that same session, the system shall initialize the current registry from the latest such snapshot. ^agent-7jhj
- On parent resume, the system shall restore identities and terminal or suspended run metadata without automatically opening or running every child. ^agent-ps05
- A later `agent_send` shall reopen the identity's exact private Pi session and continue its retained conversation. ^agent-ps06
- When a run was persisted as running but its process ended without Pi session shutdown, the system shall never restart it automatically; if its exact private child session remains recoverable, the run shall become `suspended` with reason `process_interrupted`, otherwise it shall become `lost` with reason `child_session_lost`. ^agent-ps07
- A lost run shall remain idempotently waitable and eligible for one opaque completion notification when not already observed. ^agent-ps08
- An identity with unavailable routing, workspace, tools, or child session data shall remain listable and closeable; a new send shall fail clearly rather than reconstruct missing facts from current defaults. ^agent-ps09
- Closing an identity shall remove its private Pi session and Taumel-owned full-output artifacts as part of removing the identity from current Taumel state; it shall not rewrite the append-only parent Pi conversation, undo child side effects, or promise forensic erasure. ^agent-ps10
- When Pi forks or clones a parent into a new session identity, the new session shall own none of the source session's agents; copied agent metadata shall remain inert and shall not clone, reassign, or share an identity or private child session. ^agent-ps11
- On every Pi `session_shutdown`, regardless of shutdown reason, the system shall interrupt each running child owned by that session and persist its run as `suspended` with reason `parent_shutdown`; durable identities and already-suspended runs shall remain retained, and later reopening an identity shall use its exact private child session. ^agent-ps12
- When the owning parent Pi session is ephemeral, its agents shall be process-scoped: all agent tools and non-interactive draining shall work during that process, but session shutdown shall close its identities with `delete_worktree = false` and remove their Taumel-owned private child sessions and output artifacts because no durable parent mapping can address them after restart; accepted worktrees and dedicated branches shall remain preserved Git resources rather than private artifacts. ^agent-c05p
- Parent run metadata shall persist Pi child-entry locators needed to recover each run's final or partial assistant output from the exact private child session; it shall not duplicate assistant text in parent state. ^agent-ps14
- A private child session shall carry immutable agent and owner identity markers; reopening shall validate those markers against the parent mapping and fail closed on absence or mismatch rather than attaching the conversation to another identity or owner. ^agent-ps15
- Before recursively deleting a private child session, the system shall derive its owner-scoped directory from the authenticated agent owner and handle rather than from persisted path data, require the canonical target to equal that derived location beneath Taumel's canonical private-agent root, and verify the matching immutable owner and agent marker immediately before deletion. ^agent-ps19
- The agent subsystem shall decode only the exact current registry schema and the compatible parent-snapshot schema used to initialize an absent current registry; malformed, unsupported legacy, and unknown newer schemas shall fail closed rather than become partial or empty agent state. ^agent-8udz
- The agent subsystem shall persist a monotonic set of every issued agent handle independently of the non-contractual handle-generation strategy, shall never generate a handle in that set again, and shall reject persisted state containing duplicate identity or run ids, a retained handle absent from the issued set, a run without its referenced identity, an issuance counter behind the issued set, or duplicate pending-cleanup ownership rather than construct a partial registry. ^agent-zwxp
- The owning parent's durable mapping shall resolve each owner-scoped agent handle to one globally unique private Pi child session; persistence and private artifacts shall remain isolated when different parent sessions issue the same handle and shall never use the public handle alone as a global identity. ^agent-ps17
- When parent state records a run as `running` but its exact private child session proves that Pi already settled that authoritative run with a final assistant answer, reconciliation shall recover the output locator and mark the run `completed` rather than leave it running, suspend it, or require manual repair. ^agent-ps18

### Listing and closing

- `agent_list` shall list every existing identity owned by the caller; closed identities shall not exist in Taumel state and there shall be no closed-identity filter. ^agent-ls01
- Each list item shall include `agent_id`, identity `created_at`, kind, isolation mode, generic tier when applicable, source workspace, active or latest `run_id` and `started_at`, authoritative lifecycle `status`, `turn_count`, `tool_call_count`, `failed_tool_call_count`, `tool_calls_by_name`, applicable `elapsed_ms` or `duration_ms`, optional `usage` and `context` when available, and an `activity` object containing `state`, `last_at`, `recommendation`, and `active_tool_calls`; it shall not prefix those latest-run fields with `latest_`, include `seconds_since`, or expose resolved model or thinking. ^agent-8kyn
- `agent_list` shall not include full run output, transcript, prompt, or unbounded errors. ^agent-ls03
- `agent_list` shall not include the agent task description; it shall expose progress through run status and turn count instead. ^agent-ls04
- `activity.recommendation` shall be one stable action code: `wait` for `starting`, `reasoning`, or `using_tool` while status is `running`; `interrupt_or_close` for `orphaned` while status is `running`; `call_agent_wait` for `inactive` with status `completed`, `failed`, `cancelled`, or `lost`; and `resume_or_close` for `inactive` with status `suspended`. ^agent-ls05
- `agent_close` shall interrupt any active execution, permanently close exactly the selected owned identity, and return success only after that identity and all of its runs no longer exist in current Taumel state. ^agent-cl01
- Unknown and not-owned agent IDs shall fail without revealing another owner's metadata; an ID from a successfully closed identity shall be unknown on every later call. ^agent-cl02
- Closing shall cancel pending waits and discard pending completion announcements and delivery claims for the removed runs; late child callbacks shall have no state or model-facing effect. ^agent-cl03
- If physical cleanup or durable state removal fails, `agent_close` shall return a clear failure and retain enough current state to retry cleanup; it shall never report success while the identity remains usable or listed. ^agent-cl04
- If `agent_close` interrupts an active run but then fails before completing permanent identity removal, the system shall persist that run as `suspended` with reason `close_cleanup_failed`, retain its exact child session and identity state, and never restart its interrupted process automatically. ^agent-70b4
- The model-facing close contract shall describe permanent identity closure without exposing child-session files, persistence mappings, or other implementation mechanisms. ^agent-cl05

### User manager

- `/agent-runs` shall open a TUI manager for identities and runs with inspect, output, stop, and close controls. ^agent-ui01
- Stop shall suspend active execution without closing the identity; Close shall require user confirmation and use the same permanent close semantics as `agent_close`. ^agent-ui02
- The manager shall show actual model, thinking, kind, isolation mode, source workspace, effective workspace, and run status without exposing hidden reasoning or raw prompts. ^agent-29qq
- The system shall not restore the old `/agents` profile manager or profile enable/disable state. ^agent-ui04
- When the user opens an identity's Inspect submenu in `/agent-runs`, the manager shall show the full path to that identity's private Pi child-session file. ^agent-ui05
- The `/agent-runs` manager shall show each run's latest agent task description, turn count, and wall-clock age since its latest activity in its identity and run rows; before the first child activity, it shall show age since run start; an identity row shall use the values from its latest run. ^agent-ui06
- Identity rows shall show handle, kind, latest lifecycle status, activity state only while running, latest task description, turn count, and derived activity age; run rows shall show the corresponding run ID, status, running activity state, description, turn count, and age, without exact timestamps or recommendations. ^agent-ui07
- The Inspect submenu shall show identity ID, kind, isolation mode, applicable tier, resolved model and thinking, source workspace, effective workspace, creation time, and private child-session path, plus run ID, lifecycle status, activity state and recommendation, start time, exact last-activity time, applicable end or suspension time, turn count, task description, bounded reason or error, and notification state. ^agent-91jh
- A terminal or suspended row shall omit the redundant `inactive` activity label, while a running row shall expose `starting`, `reasoning`, `using_tool`, or `orphaned` beside its lifecycle status. ^agent-ui09

### Non-interactive draining

- When a print or JSON main-agent turn would finish while an owned run remains active, the system shall keep the process open rather than exit and kill the child silently. ^agent-ni01
- When the first run completes during non-interactive draining, the system shall deliver its ordinary opaque completion notification and allow the main agent to call `agent_wait` and react. ^agent-ni02
- The drain shall re-enumerate active runs after every completion and resulting main-agent continuation so newly spawned work is also drained. ^agent-ni03
- Draining shall finish when all owned runs are terminal or suspended and shall impose no separate arbitrary batch or wall-clock timeout. ^agent-ni04
- Overall Pi cancellation or shutdown may terminate the drain and shall use the ordinary session-shutdown suspension and ephemeral-owner cleanup semantics; an abrupt process loss shall use ordinary process-interruption recovery semantics on resume. ^agent-ni05
- Non-interactive agent draining shall not wait for exec sessions, cron tasks, Exa Agent runs, or unrelated asynchronous resources. ^agent-ni06

### Rendering and diagnostics

- All model-needed identifiers, statuses, pending IDs, results, and read instructions shall appear in model-visible tool or notification content rather than only hidden details or UI rendering; resolved routing facts are user-only and shall remain absent from model-visible content. ^agent-rn01
- Human rendering shall present generic, Finder, and Oracle starts and runs with one shared agent-event grammar while labeling specialist purpose distinctly. ^agent-rn02
- Compact rendering shall remain bounded and shall not display raw protocol envelopes, full transcripts, or final output in `agent_list`. ^agent-rn03
- Startup and call-time routing diagnostics shall identify the affected config key and reason without exposing credentials or silently changing routing. ^agent-rn04
- When a successful `agent_spawn`, `finder`, or `oracle` result becomes available in a collapsed Pi TUI tool slot, the system shall display the tool name, short agent handle, and caller-supplied agent task description, plus requested tier for a generic identity, so concurrent starts remain visibly distinct without expansion. ^agent-rn05
- Except for the private child-session file path and effective worktree path shown explicitly in the `/agent-runs` Inspect submenu, the system shall not expose owner-session tokens, private child-session IDs, private session paths, storage keys, or any other internal agent-mapping identity through model-facing tool content, notifications, ordinary TUI rendering, or the agent manager; those surfaces shall identify agents only by their short owner-scoped handles and identify runs only by their owner-scoped run IDs. ^agent-0ujk
- While the Pi TUI is active, each invocation of `agent_spawn`, `finder`, `oracle`, `agent_send`, `agent_wait`, `agent_list`, or `agent_close` shall occupy exactly one visible tool slot throughout its lifecycle, matching the one-invocation/one-slot behavior of ordinary tools such as `read` and `exec_command`; one invocation shall never render as zero or multiple visible tool slots. ^agent-rn07
- When the user expands a successful `agent_spawn` tool slot, the system shall show the message submitted to that subagent together with the labeled agent, run, kind, model, thinking, and status fields; it shall not show child conversation history. ^agent-rn08
- When the user expands an `agent_wait` tool slot, the system shall render each ready result with the same labeled agent, run, kind, model, thinking, and status field layout used by expanded `agent_spawn`, followed by the response returned by `agent_wait`; it shall not show the child conversation history. ^agent-rn09
- When the user expands a successful `finder` tool slot, the system shall label and show the submitted query together with the agent, run, kind, model, thinking, and status fields; it shall not show child conversation history. ^agent-rn10
- When a successful `agent_send` carrying a message appears in a collapsed Pi TUI tool slot, the system shall show `agent_send`, the short agent handle, and the caller-supplied agent task description; interruption without a message shall not invent a description. ^agent-rn11
- Collapsed successful slots shall use the shared compact grammar of tool name followed by the minimum identifying summary: Oracle handle and description, send handle and description plus outcome, wait ready and pending counts, list identity count, or close handle and `closed`; pending slots shall show the submitted description or selected-run count with a bounded active-state label. ^agent-rn12
- Collapsed agent slots shall not show child output, resolved model or thinking, raw JSON, or private paths. ^agent-rn13
- Expanded Oracle slots shall show description, submitted instruction, agent, run, kind, resolved model, thinking, and status; expanded send slots shall show applicable description and message, interrupt value, agent, affected run, outcome, and status. ^agent-rn14
- Expanded wait slots shall show timeout state, ready count, pending IDs, and for each ready result its agent, run, kind, user-only model and thinking, status, applicable timestamps, bounded reason or error, and returned output or partial output; expanded list slots shall show a bounded table of returned fields augmented with user-only model and thinking. ^agent-rn15
- Expanded close slots shall show the agent, closed status, and permanent-closure confirmation; every expanded failed agent slot shall show its stable error code and bounded message. ^agent-rn16

## Open questions

None.
