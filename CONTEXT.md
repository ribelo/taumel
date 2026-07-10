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

**Loaded session state**:
The single in-memory projection of Taumel component state for Pi's currently
active main session.
_Avoid_: Global session state, session cache

**Owned asynchronous resource**:
Taumel work that may remain live after its initiating call and therefore carries
the identity of the parent session that may observe or control it.
_Avoid_: Background global, detached task

**Agent identity**:
A durable child agent that may perform multiple runs while retaining its
spawn-time execution snapshot until closed.
_Avoid_: Agent run, disposable worker

**Agent run**:
One bounded execution undertaken by an agent identity, with its own lifecycle
and terminal result.
_Avoid_: Agent identity, child session

**Workspace binding**:
The immutable association between an agent identity and the workspace in which
its runs operate.
_Avoid_: Current directory, fallback workspace

**Execution snapshot**:
The immutable resolved instructions, model routing, tool surface, spawn-time
permission ceiling, and workspace binding that define a durable agent identity.
_Avoid_: Current profile, profile reference, run prompt

**Tool surface**:
The tools assigned to one agent as its callable interface, independent of
whether its current permission envelope will authorize a particular call. A
child may have a different tool surface from its parent without gaining broader
permissions.
_Avoid_: Permission set, inherited capability ceiling

**Permission envelope**:
The side-effect authority within which an agent's tools execute, including
sandbox, approval, network, and no-sandbox constraints. A child's effective
envelope is clamped by both its spawn-time ceiling and its parent's current
envelope.
_Avoid_: Tool surface, active tools

**Owner permission state**:
The latest permission envelope of the parent session, carried by a live owned
asynchronous resource while that parent is not the loaded session.
_Avoid_: Loaded session permissions, spawn-time permission ceiling

**Cron fire**:
One delivered occurrence of a scheduled Taumel cron task, including a single
delivery that represents multiple coalesced scheduled occurrences.
_Avoid_: User message, reminder message, cron run
