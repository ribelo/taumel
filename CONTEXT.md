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

**Permission envelope**:
The side-effect authority within which tools execute, including sandbox,
approval, network, and no-sandbox constraints.
_Avoid_: Tool surface, active tools

**Owner permission state**:
The latest permission envelope of the parent session, carried by a live owned
asynchronous resource while that parent is not the loaded session.
_Avoid_: Loaded session permissions, spawn-time permission ceiling

**Cron fire**:
One delivered occurrence of a scheduled Taumel cron task, including a single
delivery that represents multiple coalesced scheduled occurrences.
_Avoid_: User message, reminder message, cron run
