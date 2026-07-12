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

**Loaded session state**:
The single in-memory projection of Taumel component state for Pi's currently
active main session.
_Avoid_: Global session state, session cache

**Owned asynchronous resource**:
Taumel work that may remain live after its initiating call and therefore carries
the identity of the parent session that may observe or control it.
_Avoid_: Background global, detached task

**Permission envelope**:
The side-effect authority within which tools execute, including sandbox,
approval, network, and no-sandbox constraints.
_Avoid_: Tool surface, active tools

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
