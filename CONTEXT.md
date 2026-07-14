# Taumel

Taumel is a set of Pi extensions that supplies selected capabilities absent from
Pi while leaving host behavior under Pi's ownership.

## Language

**Pi host**:
The coding-agent runtime that owns the agent loop, provider interaction,
compaction, retry, session lifecycle, and process-level application behavior.
_Avoid_: Taumel runtime, platform dependency

**Taumel feature**:
An extension-provided capability that Pi does not provide and that Taumel owns
end to end within Pi's extension boundaries.
_Avoid_: Pi patch, host override, compatibility layer

**Host behavior**:
Behavior supplied and owned by Pi that Taumel uses without duplicating,
policing, or replacing it.
_Avoid_: Taumel requirement, host compatibility requirement

**Model-facing tool contract**:
The tool name, description, parameter schema, and result text presented to the
agent model, independent of hidden result details and user-facing rendering.
_Avoid_: Tool rendering, tool implementation, structured details

**Tool slot**:
The single visible TUI unit occupied by one tool invocation throughout its
lifecycle.
_Avoid_: Renderer callback, tool result, protocol message

**Loaded session state**:
The single in-memory projection of Taumel component state for Pi's currently
active main session.
_Avoid_: Global session state, session cache

**Owned asynchronous resource**:
Taumel work that may remain live after its initiating call and therefore carries
the identity of the parent session that may observe or control it.
_Avoid_: Background global, detached task

**Agent owner**:
The Pi session identity that exclusively observes and controls an agent identity
and its runs. Conversation branches within that session share the same ownership.
_Avoid_: Conversation branch, workspace, loaded session

**Agent identity**:
A durable child agent that retains its conversation and fixed policy across
multiple runs until closed. An identity may be generic or specialist.
_Avoid_: Agent run, disposable worker

**Agent handle**:
The short, human-facing name used to address an agent identity within its owning
Pi session. It is owner-scoped rather than globally unique.
_Avoid_: Pi child session identity, global agent identifier, storage key

**Agent run**:
One accepted asynchronous, bounded unit of agent work owned by a parent session
and identified independently so its eventual result can be awaited. Generic
subagents and specialist tools both produce agent runs.
_Avoid_: Agent identity, synchronous tool call

**Agent turn**:
One assistant response emitted within an agent run, whether it requests tools or
provides the final answer. Turn counting starts again for each run.
_Avoid_: Agent run, conversation entry, identity-wide turn

**Agent task description**:
A short, model-supplied, user-facing label that identifies the latest delegated
work in compact displays without reproducing the full instruction or becoming
part of the child's instruction.
_Avoid_: Agent prompt, generated summary, clipped instruction

**Agent presentation**:
The user-facing representation of an agent tool invocation or agent completion
notification, independent of the model-facing tool contract.
_Avoid_: Model-facing result, agent protocol, tool implementation

**Compact agent presentation**:
The single-line agent presentation shown in the ordinary collapsed timeline.
_Avoid_: Expanded agent presentation, model-facing summary

**Expanded agent presentation**:
The human-readable agent presentation shown when the user expands a timeline
item.
_Avoid_: Raw tool result, protocol serialization, compact agent presentation

**Agent completion notification**:
The asynchronous signal that an agent run has reached a terminal state and can
be retrieved explicitly.
_Avoid_: Agent result, readiness status, agent wait

**Agent instruction**:
A parent-supplied message accepted for an agent run, including its initial task,
steering, or resumed continuation. The latest instruction is the most recently
accepted such message for that run.
_Avoid_: Agent turn, tool result, unaccepted message

**Agent activity**:
An observable sign that an agent run is advancing: an assistant turn, child tool
start, child tool progress, or child tool result.
_Avoid_: Parent instruction, lifecycle status, elapsed wall time

**Agent run status**:
The authoritative lifecycle state of a run: running, suspended, completed,
failed, cancelled, or lost. It records what may happen to the run, independently
of its currently observable activity phase.
_Avoid_: Activity state, health estimate, task description

**Activity state**:
The observable execution phase of an agent run, separate from the run's
authoritative lifecycle status.
_Avoid_: Run status, latency estimate, health guess

**Agent interruption**:
An explicit parent action that stops an agent run's current execution without
closing its identity. A replacement message may continue the same run.
_Avoid_: Steering, cancellation, closing

**Agent suspension**:
The state of an interrupted agent run that received no replacement message and
can continue later in the retained agent conversation.
_Avoid_: Cancellation, completion, closing

**Agent closure**:
The permanent end of an agent identity, after which the identity and its runs no
longer exist in Taumel state and cannot be observed or controlled.
_Avoid_: Interruption, suspension, archival

**Agent message channel**:
The explicit exchange of parent-supplied messages and the child's last assistant
message for a run. The independent conversations share no other conversation state.
_Avoid_: Shared context, transcript inheritance, hidden handoff

**Subagent task**:
A general objective delegated to a durable agent identity without selecting a
named behavioral profile.
_Avoid_: Specialist task, persona, agent run

**Agent effort**:
The low, medium, or high capacity requested when creating a generic agent. By
default it selects the matching thinking level on the parent's model, while
configuration may route it to a different model and thinking level.
_Avoid_: Persona, model name, raw thinking level, specialist task

**Agent routing**:
The model and thinking level resolved for an agent identity when it is created.
Routing is either inherited as declared or concrete and exact; unavailable
concrete routing fails rather than falling back silently.
_Avoid_: Best-effort model selection, model fallback, agent effort

**Specialist task**:
A model-backed objective with a fixed purpose and policy, such as Finder or
Oracle, which is started through its own tool rather than selected as a generic
subagent profile.
_Avoid_: Persona, subagent profile, general subagent task

**Non-interactive PTY environment**:
A command environment that retains PTY capabilities such as ordered combined
output and stdin interaction while suppressing implicit pagers, terminal color,
and cursor-control behavior.
_Avoid_: Non-TTY execution, interactive shell environment

**Permission envelope**:
The side-effect authority within which tools execute, including sandbox,
approval, network, and no-sandbox constraints.
_Avoid_: Tool surface, active tools

**Agent approval request**:
A request attributed to an agent handle for user authorization of one concrete
side effect outside the agent's current permission envelope, presented by the Pi
host without involving either the parent or child model.
_Avoid_: Agent prompt, parent-agent request, implicit permission, generic confirmation

**Harness approval coordinator**:
The Taumel-owned bridge that serializes top-level and agent approval requests
through the loaded session's Pi-host approval UI without involving a model or
giving a child session direct UI ownership.
_Avoid_: Agent approval broker, parent agent, child UI, approval model

**Requested path**:
The pathname supplied by a tool caller, retained for user-facing evidence and
diagnostics even when it names a filesystem location through an alias.
_Avoid_: Authorized path, canonical target

**Authorization path**:
The filesystem location against which path policy is decided, independent of
which equivalent pathname a tool caller used to reach it.
_Avoid_: Requested path, display path

**Owner permission state**:
The latest permission envelope of the parent session, carried by a live owned
asynchronous resource while that parent is not the loaded session.
_Avoid_: Loaded session permissions, spawn-time permission ceiling

**Cron fire**:
One delivered occurrence of a scheduled Taumel cron task, including a single
delivery that represents multiple coalesced scheduled occurrences.
_Avoid_: User message, reminder message, cron run

**Goal inspection**:
A user-requested view of the current goal that does not contact the agent or
advance goal work.
_Avoid_: Goal prompt, goal continuation

**System prompt inspection**:
A user-requested view of Pi's current effective system prompt that does not
contact the agent or become part of the conversation.
_Avoid_: Prompt capture, system prompt message

**Usage inspection**:
A user-requested, transient view of current OpenAI Codex account quota that does
not contact the agent or become part of the conversation.
_Avoid_: Usage message, provider status

**Goal objective submission**:
The visible user-authored message that starts work on a newly created goal.
_Avoid_: Goal notification, goal summary

**Goal acknowledgement**:
A transient confirmation of a goal lifecycle command that does not become part
of the conversation.
_Avoid_: Goal message, goal inspection

**Goal continuation**:
A system-authored follow-up that advances an active goal across turns and is
visible to both the agent and user without appearing user-authored.
_Avoid_: User message, goal acknowledgement, hidden prompt

**Completed goal**:
A goal the agent considers finished, which stops automated continuation but
remains recorded and may be reopened or replaced only by the user.
_Avoid_: Deleted goal, immutable goal, free goal slot
