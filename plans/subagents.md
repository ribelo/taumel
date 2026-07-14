---
kind: requirement
status: draft
tags: [agents, subagents, finder, oracle, orchestration]
depends_on: ["[[plans/capability-profile]]", "[[plans/sandbox]]", "[[plans/tool-gateway]]", "[[plans/shared-infrastructure]]"]
traces_to: ["[[docs/research/amp-agent-surfaces]]", "[[docs/adr/0003-persist-agent-context-in-private-pi-sessions]]", "[[docs/adr/0004-deduplicate-agent-completion-notifications]]", "[[docs/adr/0005-bind-agent-identities-to-their-workspaces]]", "[[docs/adr/0006-scope-agent-ownership-to-pi-sessions]]", "[[docs/adr/0007-remove-agent-state-on-close]]"]
---
# Agents

## Intent

Taumel provides durable, asynchronous child agents owned by a main Pi session.
A generic agent is created with a message and a low, medium, or high effort; it
otherwise behaves like a normal Pi agent. Finder is created with a codebase
search query, while Oracle is created with a message. Both are built-in
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

- **agent-ts01** (ubiquitous): The system shall expose exactly the agent tools `agent_spawn`, `agent_send`, `agent_wait`, `agent_list`, `agent_close`, `finder`, and `oracle`.
- **agent-ts02** (unwanted): The system shall not expose `agent_profiles`, a legacy agent multiplexer, a profile or persona selector, Librarian, Review, or Painter.
- **agent-ts03** (ubiquitous): The system shall provide all seven tools in TUI, print, JSON, and RPC modes and shall not gate them on interactive UI availability.
- **agent-ts04** (ubiquitous): The system shall keep every agent tool schema stable for the main session lifetime; configuration and agent state shall change behavior, not registered schemas.
- **agent-ts05** (ubiquitous): The system shall keep nesting depth exactly one and expose none of the seven agent tools to a child agent.

### Tool contracts

- **agent-tc01** (ubiquitous): `agent_spawn` shall require a non-empty `message` and non-empty `description`, accept optional `effort` restricted to `low`, `medium`, or `high`, default effort to `medium`, and reject unknown parameters. ^agent-tc01
- **agent-tc02** (ubiquitous): `finder` shall require only a non-empty `query` and non-empty `description`, `oracle` shall require only a non-empty `message` and non-empty `description`, and both tools shall reject unknown parameters.
- **agent-tc03** (ubiquitous): `agent_send` shall require `agent_id`, accept optional `message`, `description`, and `interrupt`, require a non-empty message unless `interrupt = true`, require a non-empty `description` exactly when a message is supplied, and reject routing, prompt, tool, sandbox, and profile overrides.
- **agent-tc04** (ubiquitous): `agent_wait` shall require a non-empty array of unique `run_ids`, accept optional non-negative `timeout_seconds`, and reject agent-id selectors, empty or duplicate selections, implicit all-run selection, and unknown parameters.
- **agent-tc05** (ubiquitous): `agent_list` shall accept no parameters.
- **agent-tc06** (ubiquitous): `agent_close` shall require one non-empty `agent_id` and reject arrays, `all`, and unknown parameters.
- **agent-tc07** (ubiquitous): Every successful start through `agent_spawn`, `finder`, or `oracle` shall return one JSON object whose base fields are exactly `agent_id`, `run_id`, `kind`, and `status = running` without waiting for completion; the model-facing result shall not expose resolved model or thinking.
- **agent-tc08** (ubiquitous): A successful generic start shall additionally return its resolved `effort`; Finder and Oracle start objects shall omit `effort`.
- **agent-tc09** (ubiquitous): A successful `agent_send` that affects a run shall return one JSON object containing exactly `agent_id`, affected `run_id`, resulting `status`, and `outcome`; `no_active_run` shall return exactly `agent_id` and `outcome = no_active_run`, omitting `run_id` and `status`.
- **agent-tc10** (ubiquitous): `agent_list` shall return one top-level JSON array whose items contain exactly `agent_id`, identity `created_at`, `kind`, `workspace`, active or latest `run_id` and `started_at`, authoritative lifecycle `status`, per-run `turn_count`, and an `activity` object containing exactly `state`, `last_at`, and `recommendation`, plus `effort` only for generic identities; items shall not expose resolved model or thinking, and an empty list shall be `[]`.
- **agent-tc11** (event-driven): A successful `agent_close` shall return only the closed `agent_id` and `status = closed`; after that result, every former agent and run ID shall be unknown to all agent tools.
- **agent-tc12** (ubiquitous): The model-facing `finder` description shall identify it as an asynchronous specialist for conceptual, behavior-based, or multi-step codebase searches that correlate findings across files, and shall direct callers to use direct read or search tools for a known path, symbol, or exact text.
- **agent-tc13** (ubiquitous): The model-facing description of `finder.query` shall ask for relevant technical terms, file types, expected code patterns, and clear success criteria.
- **agent-tc14** (ubiquitous): The model-facing `agent_spawn` description shall position generic delegation for substantial work that benefits from independent asynchronous execution rather than routine work that direct tools can complete more simply.
- **agent-tc15** (ubiquitous): The model-facing description of every agent `description` parameter shall request a specific, action-oriented, three-to-five-word label written for the user and shall state that the label is used for compact TUI display rather than sent to the child.
- **agent-tc16** (ubiquitous): The model-facing `agent_list` description shall state that it returns lifecycle status, per-run turn count, and observable activity phase and timing for progress inspection, and shall not claim that elapsed silence proves a stall.
- **agent-tc17** (ubiquitous): A failed agent tool call shall use exactly one stable `error.code` from `invalid_arguments`, `agent_not_found`, `run_not_found`, `agent_limit_reached`, `routing_unavailable`, `workspace_unavailable`, `child_session_unavailable`, `dispatch_failed`, `persistence_failed`, `cleanup_failed`, or `internal_error`. ^agent-tc17
- **agent-tc18** (unwanted): Unknown, closed, and not-owned agent resources shall all use `agent_not_found`, while unknown, closed, and not-owned run resources shall all use `run_not_found`; the error code or message shall not reveal whether another owner has the requested resource.
- **agent-tc19** (event-driven): Routing configuration, model availability, authentication, and thinking-selection failures discovered before dispatch shall use `routing_unavailable`; child creation or message-acceptance failures shall use `dispatch_failed`; unavailable bound workspaces and private child sessions shall use their corresponding stable codes.
- **agent-tc20** (event-driven): A provider, quota, authentication, or transport failure after run acceptance shall fail the run and remain observable through `agent_wait` rather than retroactively failing the accepted tool call; the same failure before message acceptance shall use the applicable `routing_unavailable` or `dispatch_failed` failed-call code.
- **agent-tc21** (event-driven): Failure to read or write durable agent state shall use `persistence_failed`, failure to complete permanent close cleanup shall use `cleanup_failed`, and only otherwise-unclassified subsystem failures shall use `internal_error`; unavailable child output shall remain a successful wait result with null output rather than use any failed-call code.
- **agent-tc22** (ubiquitous): The model-facing `oracle` description shall be `Start an asynchronous Oracle specialist for architecture or code review, root-cause analysis from code and runtime evidence, complex planning, or a second opinion on technical decisions. Use Oracle selectively when the problem warrants expensive independent reasoning.`; `message` shall be described as `The Oracle's initial instruction. Include the guidance or decision needed, relevant context and constraints, available evidence, and attempted approaches.`
- **agent-tc23** (ubiquitous): The model-facing `agent_send` description shall be `Send an instruction to an existing open agent, resume a suspended run, steer or replace active work, or interrupt execution. A message requires a short user-facing description.`; its parameters shall use the approved descriptions: `agent_id` identifies the owner-scoped handle returned by a start or `agent_list`, `message` explains idle start, active steering, suspended resume, and omission only for interruption without replacement work, `description` requests the required three-to-five-word TUI label not sent to the child, and `interrupt` explains replace, suspend, and no-additional-effect behavior.
- **agent-tc24** (ubiquitous): The model-facing `agent_wait` description shall be `Race selected agent runs and return every result ready at the observation point. Omitted timeout waits indefinitely; a timeout bounds only this call and never stops the runs. Call again with returned pending_run_ids to await later completions.`; `run_ids` shall describe unique owner-scoped IDs all belonging to the current session, and `timeout_seconds` shall describe indefinite omission and zero-value polling.
- **agent-tc25** (ubiquitous): The model-facing `agent_list` description shall be `List all open agent identities owned by the current session. Returns lifecycle status, per-run turn count, and observable activity phase and timing for progress inspection. Activity describes observable execution, not inferred health or a time-based stall.`
- **agent-tc26** (ubiquitous): The model-facing `agent_close` description shall be `Permanently close one agent identity, interrupt active execution, and remove all of its runs from current Taumel state. Closed identities cannot be resumed; use agent_send interruption for a reversible stop.`; `agent_id` shall be described as the owner-scoped handle of the identity to close permanently.

### Agent kinds and definitions

- **agent-kd01** (ubiquitous): The system shall support exactly three agent kinds: `generic`, `finder`, and `oracle`.
- **agent-kd02** (ubiquitous): Generic agents shall have no named profile or persona and shall receive no Taumel-authored prompt instructions.
- **agent-kd03** (ubiquitous): Pi shall build a generic child's prompt through its ordinary agent-session machinery for the child's model, tools, workspace, and project guidance; Taumel shall not copy or rewrite the main agent's effective prompt.
- **agent-kd04** (ubiquitous): Finder and Oracle shall be Taumel-owned built-ins whose extra instructions live in body-only Markdown resources with no YAML frontmatter.
- **agent-kd05** (ubiquitous): The system shall add Finder and Oracle instructions through Pi's existing resource/context mechanism and shall not implement a general prompt assembler, profile parser, or agent-definition file format.
- **agent-kd06** (unwanted): The system shall not discover user-authored agent files or allow configuration to replace Finder or Oracle prompts, tools, purpose, or sandbox policy.
- **agent-kd07** (ubiquitous): Finder shall specialize in local conceptual and multi-step codebase discovery rather than mutation or external research.
- **agent-kd08** (ubiquitous): Oracle shall specialize in expensive second-opinion analysis, including architecture, debugging, planning, and ad-hoc code review.
- **agent-kd09** (ubiquitous): Finder and Oracle shall use the same internal identity and run lifecycle as generic agents rather than separate orchestration implementations.
- **agent-kd10** (ubiquitous): Pi shall continue to own each child's provider interaction, retry, compaction, message history, and ordinary agent-session lifecycle; Taumel shall orchestrate identities and runs without duplicating those host behaviors.
- **agent-kd11** (ubiquitous): Every child shall use Pi's ordinary resource and extension loading; Taumel shall not filter discovered extensions, suppress their initialization, or construct a restricted resource loader for children.
- **agent-kd12** (ubiquitous): Parent and child shall remain independent conversations whose only communication is explicit parent-supplied messages and the child's returned last assistant message for a run; Taumel shall not copy, summarize, or otherwise transfer the parent transcript, current turn, reasoning, tool results, or hidden context into a child.
- **agent-kd13** (event-driven): The system shall treat a child run as completed only after Pi settles it, including provider retries, auto-compaction retries, tool turns, and accepted steering; an intermediate low-level `agent_end` shall not complete the Taumel run.
- **agent-kd14** (ubiquitous): Finder's extra instructions shall make it a strict code locator that returns at most a two-line summary followed by absolute paths and relevant line ranges, prioritizes source code, searches exhaustively when completeness is requested, scopes and parallelizes independent searches without fixed call or turn quotas, and includes complete logical units with five to ten lines of surrounding context.
- **agent-kd15** (ubiquitous): Oracle's extra instructions shall retain its expert-subagent framing and default to the simplest viable recommendation, minimal incremental changes, YAGNI and KISS, at most one materially distinct alternative, context-first tool use, and a concise flexible response ordered as recommendation, rationale, risks, and escalation triggers when relevant; they shall not require effort estimates, fixed response headings, or citations.
- **agent-kd16** (ubiquitous): The system shall retain an agent task description as parent-facing metadata and shall not include it in the initial, steering, or resumed message delivered to the child.
- **agent-kd17** (ubiquitous): Taumel shall deliver final or partial child answers to the parent only as attributed `agent_wait` tool-result fields and shall not inject child answers automatically as user, assistant, developer, or custom conversation messages.

### Routing and configuration

- **agent-rt01** (ubiquitous): The system shall interpret generic effort as a routing key whose zero-configuration behavior inherits the parent's model and selects the matching Pi thinking level `low`, `medium`, or `high`.
- **agent-rt02** (ubiquitous): The system shall default Finder to inherited parent model with `low` thinking and Oracle to inherited parent model with `high` thinking.
- **agent-rt03** (ubiquitous): Taumel config shall allow complete model/thinking overrides for `taumel.agents.generic.low`, `taumel.agents.generic.medium`, `taumel.agents.generic.high`, `taumel.agents.finder`, and `taumel.agents.oracle`.
- **agent-rt04** (ubiquitous): A routing entry's `model` shall be either `inherit` or one canonical `provider/model` string, and its `thinking` shall be one Pi-supported thinking level.
- **agent-rt05** (ubiquitous): A present routing override shall contain both `model` and `thinking`; the shared Taumel config precedence shall select one whole entry without field-by-field merging across scopes.
- **agent-rt06** (event-driven): When a routing entry is malformed, the system shall report a scoped diagnostic and fail requests that depend on that entry rather than silently using defaults.
- **agent-rt07** (event-driven): When concrete configured routing names an unregistered model or a model without usable authentication, identity creation shall fail clearly and shall not substitute the parent model, another model, an alias target, or a provider default.
- **agent-rt08** (ubiquitous): The system shall resolve and snapshot the actual model and thinking level when creating an identity; later config or parent-model changes shall affect only new identities.
- **agent-rt09** (ubiquitous): User-only TUI surfaces, including expanded start slots and `/agent-runs`, shall expose the actual resolved model and thinking level so users need not infer what routing selected; model-facing start, send, wait, list, and close results shall not expose either value.
- **agent-rt10** (event-driven): When the resolved model cannot use the requested or configured thinking level, identity creation shall fail clearly rather than silently clamp, disable, or replace that level.

### Tool surfaces

- **agent-tl01** (ubiquitous): A generic identity shall inherit the parent's active logical tool selection at creation, excluding all seven agent tools, and keep the resulting selection stable for its lifetime.
- **agent-tl02** (ubiquitous): Finder shall inherit only parent-active local read and command-execution tools, excluding mutation, network, approval-request, and agent-spawn effects.
- **agent-tl03** (ubiquitous): Oracle shall inherit only parent-active read, command-execution, and network tools, excluding mutation, approval-request, and agent-spawn effects.
- **agent-tl04** (ubiquitous): Neither specialist shall gain a tool absent from the parent's active selection.
- **agent-tl05** (event-driven): After resolving the child provider, the system shall apply the existing provider-aware `Tool_catalog` normalization to the child's selected tools.
- **agent-tl06** (event-driven): When an OpenAI or OpenAI-Codex child inherits mutation capability, normalization shall replace `edit` and `write` with `apply_patch`; for another provider it shall replace an inherited `apply_patch` capability with the corresponding `edit` and `write` selection.
- **agent-tl07** (ubiquitous): Capability normalization shall also preserve the existing shell-tool rewrite and shall not duplicate provider-specific tool logic inside the agent subsystem.
- **agent-tl08** (unwanted): Agent children shall receive neither goal lifecycle tools automatically nor goal-mode continuation behavior.

### Permissions and ownership

- **agent-pm01** (ubiquitous): A generic identity's spawn-time permission ceiling shall be no broader than its parent's permission envelope at creation.
- **agent-pm02** (ubiquitous): Finder and Oracle shall additionally have a fixed read-only sandbox ceiling and shall never receive mutation authority.
- **agent-pm03** (state-driven): Every child side effect shall be authorized against the stricter combination of the identity's immutable spawn-time ceiling and its parent's current permission envelope.
- **agent-pm04** (event-driven): Tightening parent permissions shall affect existing identities immediately; relaxing them may restore authority only up to the spawn-time ceiling and shall not change the identity's tool surface.
- **agent-pm05** (ubiquitous): No child shall enable `no_sandbox` or inherit `danger-full-access` beyond the existing child clamp.
- **agent-pm06** (event-driven): A child approval prompt shall identify the requesting agent; if its owning parent session is not loaded, the tool call shall receive `approval_unavailable` rather than displaying a prompt in another session or waiting indefinitely.
- **agent-pm07** (ubiquitous): Every identity, run, wait, notification, send, list, close, and manager action shall remain scoped to the owning parent session and shall reveal no metadata for another owner's resources.
- **agent-pm08** (ubiquitous): The agent owner shall be the Pi session identity rather than a conversation branch; in-place tree navigation shall retain ownership and access to that session's agents, including agents created on another branch.

### Identities and runs

- **agent-id01** (ubiquitous): An agent identity shall retain one Pi child conversation across multiple runs until permanently closed.
- **agent-id02** (ubiquitous): The system shall generate an owner-scoped `agent_id` shaped `<kind>-<nano-id>`, where kind is `agent`, `finder`, or `oracle` and `nano-id` is exactly four characters from `abcdefghjkmnpqrstuvwxyz23456789`; it shall generate each owner-scoped `run_id` as `<agent_id>-run-<positive-integer>` with the integer increasing monotonically per identity, retry agent-handle collisions, never accept either ID from a spawning caller, and never reuse either within that parent session, including after closure. Exhausting a kind's four-character namespace shall fail creation clearly rather than lengthening or reusing a handle; the entropy strategy is not contractual.
- **agent-id03** (ubiquitous): An identity shall have at most one active or suspended run; concurrent executions shall never mutate one child conversation.
- **agent-id04** (ubiquitous): An identity shall keep immutable kind, generic effort when applicable, resolved routing, assigned tool surface, spawn-time permission ceiling, workspace binding, and child-session reference.
- **agent-id05** (ubiquitous): A run shall have one of `running`, `suspended`, `completed`, `failed`, `cancelled`, or `lost` status, a bounded reason code, timestamps, and independent completion-announcement state.
- **agent-id06** (ubiquitous): Only the currently authoritative child dispatch may transition a run or supply its output; late completion, error, cancellation, or output from a superseded dispatch shall have no model-facing effect.
- **agent-id07** (ubiquitous): Closing an identity shall permanently remove that identity and all of its runs from Taumel state; every former agent and run ID shall thereafter be unknown and shall never be reused.
- **agent-id08** (ubiquitous): A run reason code shall be absent for completion or one of `interrupted_by_parent`, `parent_shutdown`, `process_interrupted`, `host_cancelled`, `dispatch_failed`, `agent_failed`, `internal_error`, or `child_session_lost`; arbitrary host or provider messages shall not become reason codes.
- **agent-id09** (ubiquitous): Variable run diagnostics shall use a separate optional `error` field bounded to 4,096 characters; truncating that field shall not alter the run's status or reason code.
- **agent-id10** (ubiquitous): Suspended runs shall use only `interrupted_by_parent`, `parent_shutdown`, or `process_interrupted`; cancelled runs shall use `host_cancelled`; failed runs shall use `dispatch_failed`, `agent_failed`, or `internal_error`; lost runs shall use `child_session_lost`; running and completed runs shall have no reason code.
- **agent-id11** (ubiquitous): State-changing operations and child callbacks for one identity shall be serialized so every observable outcome is equivalent to one total order; no send, interrupt, completion, shutdown, or close race shall create concurrent runs, restore removed state, or make a stale dispatch authoritative.
- **agent-id12** (ubiquitous): Identity creation, successful closure, and owner-capacity accounting shall be serialized per owner so parallel starts can never exceed the 64-identity limit or reuse a slot before closure is durable.
- **agent-id13** (event-driven): When Pi settles a run with a final assistant answer, the system shall transition that run to `completed` and persist its output locator independently of `agent_wait`, `/agent-runs`, notification delivery, or any other observation of the answer.
- **agent-id14** (ubiquitous): Every run shall initialize `turn_count` to zero, increment it once for each assistant turn emitted during that run, including tool-call turns and the final-answer turn, and shall not carry the count across runs in the same identity.
- **agent-id15** (event-driven): When the system accepts an initial, steering, or resumed instruction for a run, it shall retain that instruction's caller-supplied agent task description as the run's latest description independently from the full submitted message or query.
- **agent-id16** (event-driven): When a child emits an assistant turn, starts a tool, reports tool progress, or returns a tool result for the authoritative dispatch, the system shall set that run's `last_activity_at` to the observation time; stale-dispatch activity shall not change it.
- **agent-id17** (state-driven): While a run has emitted no child activity, its `activity.last_at` shall be null and any user-facing elapsed-time or configured-deadline evaluation shall use the run's `started_at` as its baseline.
- **agent-id18** (unwanted): If an accepted run terminates because of a provider, authentication, quota, transport, or host execution error, then the system shall set its lifecycle status to `failed`, use the applicable existing bounded reason code, and retain bounded variable diagnostics separately; activity state shall not replace that terminal status.
- **agent-id19** (ubiquitous): `activity.state` shall describe observable execution phase using exactly `starting`, `reasoning`, `using_tool`, `orphaned`, or `inactive`; accepted runs with no child activity shall be `starting`, live model/provider work shall be `reasoning`, live child-tool execution shall be `using_tool`, a run recorded as `running` without an authoritative live dispatch shall be `orphaned`, and suspended or terminal runs shall be `inactive`; elapsed silence alone shall not select an activity state.
- **agent-id20** (event-driven): An accepted run shall begin in `starting`; authoritative Pi `agent_start` or `turn_start` shall set `reasoning`; the first active `tool_execution_start` shall set `using_tool`; parallel tool execution shall keep that state until the last active `tool_execution_end`, which shall restore `reasoning`; suspension or terminal settlement shall set `inactive`; and reconciliation without a live authoritative dispatch shall set `orphaned`. ^agent-id20
- **agent-id21** (event-driven): Authoritative Pi `turn_end` shall increment `turn_count` and update `last_activity_at`; `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` shall update `last_activity_at`; phase-only `agent_start` and `turn_start` events shall not update that timestamp.
- **agent-id22** (event-driven): Pi `agent_end` shall not settle a Taumel run or force an inactive phase because Pi may retry, compact, or process follow-up work; authoritative `agent_settled` shall determine terminal settlement after those continuations finish.

### Workspace binding

- **agent-ws01** (ubiquitous): An identity shall bind immutably to the parent's working directory at creation.
- **agent-ws02** (event-driven): Parent directory changes, session switching, and process resume shall not rebind an existing identity.
- **agent-ws03** (event-driven): When the bound workspace is unavailable for a later send or reopen, the attempted run shall fail clearly while the identity remains inspectable and closeable.
- **agent-ws04** (unwanted): The system shall not substitute the parent's current directory, process directory, another workspace, or a temporary directory for an unavailable bound workspace.

### Starting agents

- **agent-sp01** (event-driven): `agent_spawn` shall create one generic identity and immediately start its first run from `message` using the resolved effort routing.
- **agent-sp02** (event-driven): `finder` shall create one Finder identity and immediately start its first run by passing `query` as the child's initial message; `oracle` shall create one Oracle identity and immediately start its first run from `message` through the same shared start machinery.
- **agent-sp03** (ubiquitous): Starts shall be asynchronous and shall return only after child creation and message acceptance are known, not after the run finishes.
- **agent-sp04** (event-driven): If child creation, routing, workspace validation, or initial message acceptance fails, the system shall return a clear error and shall not leave an apparently running orphan identity or run.
- **agent-sp05** (event-driven): A parent session shall own at most 64 existing agent identities; `agent_spawn`, `finder`, and `oracle` shall fail clearly before routing or child creation when that limit is reached, and successful `agent_close` shall free one identity slot.

### Sending, steering, and suspension

- **agent-sd01** (event-driven): When `agent_send` supplies a message to an existing idle identity, the system shall start a new run with a new `run_id` in the retained child conversation.
- **agent-sd02** (event-driven): When `agent_send` supplies a message to an active run without interruption, the system shall steer that same logical run and return its existing `run_id` rather than create a concurrent run.
- **agent-sd03** (event-driven): When `agent_send` supplies `interrupt = true` and a message to an active run, the system shall first interrupt the current child execution and then send the message through the retained child session, keeping the same logical run active under the same `run_id`.
- **agent-sd04** (event-driven): When `agent_send` supplies `interrupt = true` without a message to an active run, the system shall interrupt execution and mark that run suspended without closing the identity or creating a replacement run.
- **agent-sd05** (event-driven): When `agent_send` supplies a message to a suspended run, with either value of `interrupt`, the system shall resume that same run through the retained child session and return the same `run_id`; there is no live execution to interrupt first.
- **agent-sd06** (event-driven): When interruption without a message targets an identity with no active or suspended run, the system shall return a normal no-active-run result and change nothing.
- **agent-sd07** (ubiquitous): `agent_send` shall work uniformly for generic, Finder, and Oracle identities while preserving each identity's kind, routing, tools, prompt behavior, permissions, and workspace.
- **agent-sd08** (event-driven): If message dispatch fails after the current execution was interrupted, the logical run shall fail clearly and the interrupted execution shall not become authoritative again.
- **agent-sd09** (event-driven): When an idle or suspended identity cannot pass workspace, child-session, routing, tool-surface, or message-acceptance preflight, `agent_send` shall fail without allocating a new run or changing the suspended run; the identity shall remain inspectable and closeable.
- **agent-sd10** (event-driven): When interruption without a message targets a suspended run, the system shall return `already_suspended` with that run ID and change nothing.
- **agent-sd11** (event-driven): When `agent_send` supplies a message to an idle identity, with either value of `interrupt`, the system shall start a new run; `interrupt = true` shall have no additional effect because no execution exists to interrupt.
- **agent-sd12** (ubiquitous): Successful `agent_send` results shall use exactly one model-visible outcome from `message_sent`, `interrupted_and_sent`, `suspended`, `already_suspended`, `resumed`, `started`, or `no_active_run` according to the identity state and supplied fields.

### Waiting

- **agent-wt01** (ubiquitous): `agent_wait` shall implement a race over exactly the supplied run IDs rather than a join.
- **agent-wt02** (event-driven): If one or more selected runs are already terminal or suspended, `agent_wait` shall return immediately with every selected result ready at the observation point and list the remaining active IDs as `pending_run_ids`.
- **agent-wt03** (event-driven): If every valid selected run is active, `agent_wait` shall block until at least one becomes terminal or suspended, then return every result ready at that observation point plus `pending_run_ids`.
- **agent-wt04** (ubiquitous): Omitted `timeout_seconds` shall wait indefinitely, zero shall poll once, and a positive value shall bound only that wait call.
- **agent-wt05** (event-driven): On bounded timeout, `agent_wait` shall return a successful timeout result with unchanged `pending_run_ids` and shall not alter any run.
- **agent-wt06** (event-driven): User interruption of a pending wait shall interrupt only the wait and leave every selected agent run unchanged.
- **agent-wt07** (ubiquitous): Terminal run results shall remain idempotently readable through repeated `agent_wait` calls and shall have no consume-once or `already_consumed` state.
- **agent-wt08** (event-driven): Because an already-ready run wins a later race immediately, `pending_run_ids` shall contain exactly the still-active selected run IDs that may be passed to the next `agent_wait` call.
- **agent-wt09** (event-driven): Before claiming or observing any selected run, `agent_wait` shall validate the complete selection and reject the whole call if any run ID is unknown or not owned; a rejected call shall change no run or announcement state, and not-owned errors shall reveal no agent kind, status, timing, output, error, or other metadata.
- **agent-wt10** (event-driven): When a pending wait returns a terminal run whose completion announcement is still pending, the system shall mark that announcement observed before resolving the tool call so no later background notification is emitted for it; an already-sent notification shall remain sent.
- **agent-wt11** (event-driven): When a race returns, the system shall release wait claims for losing active runs so their later completions remain eligible for notification or another wait.

### Result boundaries

- **agent-rs01** (event-driven): A completed run shall return its final assistant answer without Taumel summarization.
- **agent-rs02** (event-driven): A failed, cancelled, or lost run shall return its reason or error separately and label any available incomplete assistant text as partial rather than final.
- **agent-rs03** (event-driven): A suspended run shall return status and reason without presenting incomplete text as a final answer.
- **agent-rs04** (ubiquitous): Agent tools shall never return hidden reasoning, raw transcripts, tool logs, or a specialist's resolved prompt.
- **agent-rs05** (ubiquitous): Wait results shall include agent and run IDs, kind, status, timing, and bounded reason metadata; they shall not expose resolved model or thinking.
- **agent-rs06** (event-driven): If a completed answer cannot be recovered from Pi's child session, `agent_wait` shall return `output = null` rather than inventing output or treating the read as a tool failure; if incomplete text for a failed, cancelled, or lost run cannot be recovered, it shall analogously return `partial_output = null`.
- **agent-rs07** (event-driven): When a recovered answer exceeds the shared tool-output line or byte limits, `agent_wait` shall use the same truncation and full-output artifact mechanism as command sessions, return clearly marked truncated text with truncation metadata and the complete output file path, and shall not summarize the answer.
- **agent-rs08** (ubiquitous): `agent_wait` shall return one stable JSON object containing `timed_out`, `results`, and `pending_run_ids`; each result shall contain agent and run IDs, kind, status, start and applicable end timestamps, shall contain the status-specific answer field when required below, and shall omit resolved model and thinking.
- **agent-rs09** (event-driven): A completed result shall expose the child's final assistant text only as `output: string | null`; a failed, cancelled, or lost result shall expose available incomplete assistant text only as `partial_output: string | null`; suspended results shall expose neither field, and final and partial fields shall never coexist.
- **agent-rs10** (event-driven): `agent_wait` shall represent a recoverable empty final or partial assistant answer as an empty string and unavailable answer text as null.
- **agent-rs11** (ubiquitous): A run's returned output shall come only from that run's last assistant message after Pi settles the run; Taumel shall not concatenate intermediate assistant turns, prior-run messages, tool results, or transcript content into the output.
- **agent-rs12** (ubiquitous): Only `agent_wait` shall return a child's final or partial assistant message to the parent; starts, sends, lists, closes, completion announcements, and automatically injected conversation messages shall never copy that answer into model-visible content.
- **agent-rs13** (ubiquitous): Every successful `agent_spawn`, `finder`, `oracle`, `agent_send`, `agent_wait`, `agent_list`, and `agent_close` result shall present its complete model-visible result as valid JSON with no surrounding prose; `agent_list` shall use a top-level array, the other tools shall use their defined JSON objects, and arbitrary final or partial child text in `agent_wait` shall be encoded as a JSON string field without summarization.
- **agent-rs14** (unwanted): If an agent tool call fails, then the tool shall return a valid JSON object with `ok = false` and an `error` object containing a stable bounded `code` and human-readable bounded `message`, with no surrounding prose; Pi shall still mark the result as a tool error independently from that JSON content.
- **agent-rs15** (ubiquitous): Every timestamp exposed by an agent tool shall be an ISO 8601 local date-time with an explicit numeric UTC offset, such as `2026-07-14T11:19:18+02:00`; agent tools shall not expose offset-less local time, epoch seconds, or epoch milliseconds.
- **agent-rs16** (ubiquitous): Successful agent tool JSON objects shall omit an `ok` field and contain only their domain result fields; `ok = false` is reserved for the stable failed-call envelope, and `agent_list` shall remain a bare JSON array.
- **agent-rs17** (ubiquitous): Every ready `agent_wait` result shall contain the common fields `agent_id`, `run_id`, `kind`, `status`, and `started_at`; a completed result shall additionally contain exactly `ended_at` and `output`; a failed, cancelled, or lost result shall additionally contain exactly `ended_at`, `reason`, `error`, and `partial_output`; and a suspended result shall additionally contain exactly `suspended_at` and `reason`, apart from truncation metadata permitted by **agent-rs07**. ^agent-rs17
- **agent-rs18** (unwanted): An `agent_wait` result shall omit inapplicable status-specific fields rather than setting their timestamps to null; only `output`, `partial_output`, and `error` may use null to distinguish unavailable text or absent variable diagnostics from an inapplicable field.
- **agent-rs19** (event-driven): If a bounded wait reaches its deadline before any selected result becomes ready, `agent_wait` shall return `timed_out = true`, an empty `results` array, and every still-active selected run ID in `pending_run_ids`; otherwise it shall return `timed_out = false` with the results and pending IDs ready at the winning observation point.
- **agent-rs20** (event-driven): Although ordinary agent answers are not expected to reach the shared output limits, a truncated `output` or `partial_output` shall add exactly `truncation = { "original_bytes": <non-negative integer>, "returned_bytes": <non-negative integer>, "full_output_path": <absolute path> }`; an untruncated result shall omit `truncation`, and the returned text shall retain the visible shared truncation marker.

### Completion announcements

- **agent-nt01** (ubiquitous): Every terminal run shall track completion announcement state independently from its idempotently readable result, using the states `pending`, `observed_by_agent_wait`, and `notification_sent`.
- **agent-nt02** (event-driven): A terminal run observed by `agent_wait` before notification delivery shall transition to `observed_by_agent_wait` and shall never emit a completion notification.
- **agent-nt03** (event-driven): An unobserved terminal run shall be eligible for one opaque `agent_completion` custom message to its owning parent at turn end, or immediately via a triggered turn when the parent is idle.
- **agent-nt04** (ubiquitous): The model-visible content of an `agent_completion` message shall be exactly one valid JSON object containing `event = agent_completion`, `agent_id`, `run_id`, `kind`, and `next_action = { "tool": "agent_wait", "arguments": { "run_ids": [<run_id>], "timeout_seconds": 0 } }`; it shall have no surrounding prose and omit result text, error, terminal status, reason, model metadata, and delivery metadata. ^agent-nt04
- **agent-nt05** (ubiquitous): Sending a completion notification shall not consume, remove, or otherwise alter the run result.
- **agent-nt06** (state-driven): While an `agent_wait` call claims a run, completion flushing shall treat that run as unavailable for notification delivery.
- **agent-nt07** (event-driven): Before sending, the system shall transiently claim and revalidate the run; concurrent flushes shall not send the same notification.
- **agent-nt08** (event-driven): The system shall mark `notification_sent` only after Pi accepts the message, release the claim after a failed send, and retry a still-pending notification later.
- **agent-nt09** (ubiquitous): Each completion message shall use Pi custom type `notification` and carry stable hidden delivery identity `agent_completion:<run_id>` in its persistent parent-session message details, following the established exec-completion rendering convention.
- **agent-nt10** (event-driven): On resume or retry, the system shall inspect the parent session for that stable completion message and reconcile the run to `notification_sent` instead of inserting a duplicate.
- **agent-nt11** (unwanted): Suspended runs shall not emit completion notifications.
- **agent-nt12** (event-driven): User-only output inspection in `/agent-runs` shall not mark a completion observed or suppress the model-facing notification.
- **agent-nt13** (state-driven): While an owning parent session is not loaded, its pending completion notifications shall remain queued and shall never be delivered into another loaded session; they shall become deliverable when their owner is loaded again.

### Persistence and resume

- **agent-ps01** (ubiquitous): Taumel shall create every child with a persistent Pi `SessionManager` in a Taumel-owned child-session directory outside Pi's normal main-session index.
- **agent-ps02** (unwanted): Child sessions shall not appear in Pi's normal `/resume` list or pollute main-session discovery.
- **agent-ps03** (ubiquitous): Pi child session files shall own child messages, transcripts, reasoning, tool records, compaction, and final assistant text; Taumel shall not duplicate Pi's transcript format in parent state.
- **agent-ps04** (ubiquitous): Parent state shall persist identity and run metadata, resolved routing, tool and permission snapshots, workspace binding, child session reference, and completion announcement state.
- **agent-ps05** (event-driven): On parent resume, the system shall restore identities and terminal or suspended run metadata without automatically opening or running every child.
- **agent-ps06** (event-driven): A later `agent_send` shall reopen the identity's exact private Pi session and continue its retained conversation.
- **agent-ps07** (event-driven): When a run was persisted as running but its process ended without Pi session shutdown, the system shall never restart it automatically; if its exact private child session remains recoverable, the run shall become `suspended` with reason `process_interrupted`, otherwise it shall become `lost` with reason `child_session_lost`.
- **agent-ps08** (event-driven): A lost run shall remain idempotently waitable and eligible for one opaque completion notification when not already observed.
- **agent-ps09** (ubiquitous): An identity with unavailable routing, workspace, tools, or child session data shall remain listable and closeable; a new send shall fail clearly rather than reconstruct missing facts from current defaults.
- **agent-ps10** (event-driven): Closing an identity shall remove its private Pi session and Taumel-owned full-output artifacts as part of removing the identity from current Taumel state; it shall not rewrite the append-only parent Pi conversation, undo child side effects, or promise forensic erasure.
- **agent-ps11** (event-driven): When Pi forks or clones a parent into a new session identity, the new session shall own none of the source session's agents; copied agent metadata shall remain inert and shall not clone, reassign, or share an identity or private child session.
- **agent-ps12** (event-driven): On every Pi `session_shutdown`, regardless of shutdown reason, the system shall interrupt each running child owned by that session and persist its run as `suspended` with reason `parent_shutdown`; durable identities and already-suspended runs shall remain retained, and later reopening an identity shall use its exact private child session.
- **agent-ps13** (state-driven): When the owning parent Pi session is ephemeral, its agents shall be process-scoped: all agent tools and non-interactive draining shall work during that process, but session shutdown shall close its identities and remove their Taumel-owned private artifacts because no durable parent mapping can address them after restart.
- **agent-ps14** (ubiquitous): Parent run metadata shall persist Pi child-entry locators needed to recover each run's final or partial assistant output from the exact private child session; it shall not duplicate assistant text in parent state.
- **agent-ps15** (event-driven): A private child session shall carry immutable agent and owner identity markers; reopening shall validate those markers against the parent mapping and fail closed on absence or mismatch rather than attaching the conversation to another identity or owner.
- **agent-ps16** (ubiquitous): The agent subsystem shall read only its exact current persisted-state schema; legacy agent entries shall remain inert append-only history and shall receive no migration, fallback interpretation, compatibility shim, or identity resurrection, while an unknown newer schema shall fail closed rather than be treated as empty state.
- **agent-ps17** (ubiquitous): The owning parent's durable mapping shall resolve each owner-scoped agent handle to one globally unique private Pi child session; persistence and private artifacts shall remain isolated when different parent sessions issue the same handle and shall never use the public handle alone as a global identity.
- **agent-ps18** (event-driven): When parent state records a run as `running` but its exact private child session proves that Pi already settled that authoritative run with a final assistant answer, reconciliation shall recover the output locator and mark the run `completed` rather than leave it running, suspend it, or require manual repair. ^agent-ps18

### Listing and closing

- **agent-ls01** (event-driven): `agent_list` shall list every existing identity owned by the caller; closed identities shall not exist in Taumel state and there shall be no closed-identity filter.
- **agent-ls02** (ubiquitous): Each list item shall include `agent_id`, identity `created_at`, kind, generic effort when applicable, workspace, active or latest `run_id` and `started_at`, authoritative lifecycle `status`, `turn_count`, and an `activity` object containing `state`, `last_at`, and `recommendation`; it shall not prefix those latest-run fields with `latest_`, include `seconds_since`, or expose resolved model or thinking. ^agent-ls02
- **agent-ls03** (unwanted): `agent_list` shall not include full run output, transcript, prompt, or unbounded errors.
- **agent-ls04** (unwanted): `agent_list` shall not include the agent task description; it shall expose progress through run status and turn count instead.
- **agent-ls05** (ubiquitous): `activity.recommendation` shall be one stable action code: `wait` for `starting`, `reasoning`, or `using_tool` while status is `running`; `interrupt_or_close` for `orphaned` while status is `running`; `call_agent_wait` for `inactive` with status `completed`, `failed`, `cancelled`, or `lost`; and `resume_or_close` for `inactive` with status `suspended`.
- **agent-cl01** (event-driven): `agent_close` shall interrupt any active execution, permanently close exactly the selected owned identity, and return success only after that identity and all of its runs no longer exist in current Taumel state.
- **agent-cl02** (event-driven): Unknown and not-owned agent IDs shall fail without revealing another owner's metadata; an ID from a successfully closed identity shall be unknown on every later call.
- **agent-cl03** (event-driven): Closing shall cancel pending waits and discard pending completion announcements and delivery claims for the removed runs; late child callbacks shall have no state or model-facing effect.
- **agent-cl04** (event-driven): If physical cleanup or durable state removal fails, `agent_close` shall return a clear failure and retain enough current state to retry cleanup; it shall never report success while the identity remains usable or listed.
- **agent-cl05** (ubiquitous): The model-facing close contract shall describe permanent identity closure without exposing child-session files, persistence mappings, or other implementation mechanisms.

### User manager

- **agent-ui01** (event-driven): `/agent-runs` shall open a TUI manager for identities and runs with inspect, output, stop, and close controls.
- **agent-ui02** (event-driven): Stop shall suspend active execution without closing the identity; Close shall require user confirmation and use the same permanent close semantics as `agent_close`.
- **agent-ui03** (ubiquitous): The manager shall show actual model, thinking, kind, workspace, and run status without exposing hidden reasoning or raw prompts.
- **agent-ui04** (unwanted): The system shall not restore the old `/agents` profile manager or profile enable/disable state.
- **agent-ui05** (event-driven): When the user opens an identity's Inspect submenu in `/agent-runs`, the manager shall show the full path to that identity's private Pi child-session file.
- **agent-ui06** (ubiquitous): The `/agent-runs` manager shall show each run's latest agent task description, turn count, and wall-clock age since its latest activity in its identity and run rows; before the first child activity, it shall show age since run start; an identity row shall use the values from its latest run.
- **agent-ui07** (ubiquitous): Identity rows shall show handle, kind, latest lifecycle status, activity state only while running, latest task description, turn count, and derived activity age; run rows shall show the corresponding run ID, status, running activity state, description, turn count, and age, without exact timestamps or recommendations. ^agent-ui07
- **agent-ui08** (ubiquitous): The Inspect submenu shall show identity ID, kind, applicable effort, resolved model and thinking, workspace, creation time, and private child-session path, plus run ID, lifecycle status, activity state and recommendation, start time, exact last-activity time, applicable end or suspension time, turn count, task description, bounded reason or error, and notification state.
- **agent-ui09** (unwanted): A terminal or suspended row shall omit the redundant `inactive` activity label, while a running row shall expose `starting`, `reasoning`, `using_tool`, or `orphaned` beside its lifecycle status.

### Non-interactive draining

- **agent-ni01** (event-driven): When a print or JSON main-agent turn would finish while an owned run remains active, the system shall keep the process open rather than exit and kill the child silently.
- **agent-ni02** (event-driven): When the first run completes during non-interactive draining, the system shall deliver its ordinary opaque completion notification and allow the main agent to call `agent_wait` and react.
- **agent-ni03** (ubiquitous): The drain shall re-enumerate active runs after every completion and resulting main-agent continuation so newly spawned work is also drained.
- **agent-ni04** (ubiquitous): Draining shall finish when all owned runs are terminal or suspended and shall impose no separate arbitrary batch or wall-clock timeout.
- **agent-ni05** (event-driven): Overall Pi cancellation or shutdown may terminate the drain and shall use the ordinary session-shutdown suspension and ephemeral-owner cleanup semantics; an abrupt process loss shall use ordinary process-interruption recovery semantics on resume.
- **agent-ni06** (ubiquitous): Non-interactive agent draining shall not wait for exec sessions, cron tasks, Exa Agent runs, or unrelated asynchronous resources.

### Rendering and diagnostics

- **agent-rn01** (ubiquitous): All model-needed identifiers, statuses, pending IDs, results, and read instructions shall appear in model-visible tool or notification content rather than only hidden details or UI rendering; resolved routing facts are user-only and shall remain absent from model-visible content.
- **agent-rn02** (ubiquitous): Human rendering shall present generic, Finder, and Oracle starts and runs with one shared agent-event grammar while labeling specialist purpose distinctly.
- **agent-rn03** (ubiquitous): Compact rendering shall remain bounded and shall not display raw protocol envelopes, full transcripts, or final output in `agent_list`.
- **agent-rn04** (event-driven): Startup and call-time routing diagnostics shall identify the affected config key and reason without exposing credentials or silently changing routing.
- **agent-rn05** (event-driven): When a successful `agent_spawn`, `finder`, or `oracle` result becomes available in a collapsed Pi TUI tool slot, the system shall display the tool name, short agent handle, and caller-supplied agent task description, plus requested effort for a generic identity, so concurrent starts remain visibly distinct without expansion.
- **agent-rn06** (unwanted): Except for the private child-session file path shown explicitly in the `/agent-runs` Inspect submenu, the system shall not expose owner-session tokens, private child-session IDs, private session paths, storage keys, or any other internal agent-mapping identity through model-facing tool content, notifications, ordinary TUI rendering, or the agent manager; those surfaces shall identify agents only by their short owner-scoped handles and identify runs only by their owner-scoped run IDs.
- **agent-rn07** (state-driven): While the Pi TUI is active, each invocation of `agent_spawn`, `finder`, `oracle`, `agent_send`, `agent_wait`, `agent_list`, or `agent_close` shall occupy exactly one visible tool slot throughout its lifecycle, matching the one-invocation/one-slot behavior of ordinary tools such as `read` and `exec_command`; one invocation shall never render as zero or multiple visible tool slots.
- **agent-rn08** (event-driven): When the user expands a successful `agent_spawn` tool slot, the system shall show the message submitted to that subagent together with the labeled agent, run, kind, model, thinking, and status fields; it shall not show child conversation history.
- **agent-rn09** (event-driven): When the user expands an `agent_wait` tool slot, the system shall render each ready result with the same labeled agent, run, kind, model, thinking, and status field layout used by expanded `agent_spawn`, followed by the response returned by `agent_wait`; it shall not show the child conversation history.
- **agent-rn10** (event-driven): When the user expands a successful `finder` tool slot, the system shall label and show the submitted query together with the agent, run, kind, model, thinking, and status fields; it shall not show child conversation history.
- **agent-rn11** (event-driven): When a successful `agent_send` carrying a message appears in a collapsed Pi TUI tool slot, the system shall show `agent_send`, the short agent handle, and the caller-supplied agent task description; interruption without a message shall not invent a description.
- **agent-rn12** (ubiquitous): Collapsed successful slots shall use the shared compact grammar of tool name followed by the minimum identifying summary: Oracle handle and description, send handle and description plus outcome, wait ready and pending counts, list identity count, or close handle and `closed`; pending slots shall show the submitted description or selected-run count with a bounded active-state label.
- **agent-rn13** (unwanted): Collapsed agent slots shall not show child output, resolved model or thinking, raw JSON, or private paths.
- **agent-rn14** (event-driven): Expanded Oracle slots shall show description, submitted instruction, agent, run, kind, resolved model, thinking, and status; expanded send slots shall show applicable description and message, interrupt value, agent, affected run, outcome, and status.
- **agent-rn15** (event-driven): Expanded wait slots shall show timeout state, ready count, pending IDs, and for each ready result its agent, run, kind, user-only model and thinking, status, applicable timestamps, bounded reason or error, and returned output or partial output; expanded list slots shall show a bounded table of returned fields augmented with user-only model and thinking. ^agent-rn15
- **agent-rn16** (event-driven): Expanded close slots shall show the agent, closed status, and permanent-closure confirmation; every expanded failed agent slot shall show its stable error code and bounded message.

## Open questions

None.
