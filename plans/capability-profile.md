---
kind: requirement
status: draft
tags: [capability-profile, security, authorization]
depends_on: []
---
# Capability profile

## Intent

A capability profile is the resolved execution data for a session or subagent:
model id, thinking level, sandbox preset, approval policy, assigned tool surface,
allowed agents, and whether `--no-sandbox` is permitted. The profile is pure,
testable, and resolvable without Pi. The tool gateway enforces the profile for
that agent; Pi active-tool state is an exposure hint, not authority.

Tool delegation and permission inheritance are separate. A child may receive a
different tool surface from its parent, including tools the parent does not
have, while its permission envelope remains no broader than the parent's.

## Requirements

- **profile-fd01** (ubiquitous): The system shall represent a capability profile as model id, thinking level, sandbox preset, approval policy, tool allowlist, agent allowlist, and a `noSandboxAllowed` flag.
- **profile-fd02** (ubiquitous): The system shall provide sandbox presets `read-only`, `workspace-write`, and `danger-full-access`, and approval policies `never`, `on-request`, `on-failure`, and `untrusted`.
- **profile-fd03** (ubiquitous): The system shall represent an allowlist as `none`, `all`, or an explicit set of names.
- **profile-df01** (ubiquitous): The system shall default a profile to model `inherit`, thinking `medium`, sandbox `workspace-write`, approval `on-request`, tools `all`, agents `all`, and `noSandboxAllowed = false`.
- **profile-al01** (event-driven): When checking a tool or agent against an allowlist, the system shall allow `all`, deny `none`, and allow a name only when the explicit set contains it.
- **profile-rk01** (ubiquitous): The system shall rank sandbox strictness `read-only < workspace-write < danger-full-access` and approval strictness `untrusted < on-request < on-failure < never`, treating the lower rank as stricter.
- **profile-pu01** (ubiquitous): The system shall resolve a profile purely from profile data, without Pi.
- **profile-ch01** (event-driven): When deriving a child profile, the system shall set the child sandbox preset to the stricter of the parent preset and the requested preset, and the child approval policy to the stricter of the parent and requested policy.
- **profile-ch02** (event-driven): When a parent's preset is `danger-full-access` and the child requests no preset, the system shall set the inherited preset to `workspace-write`.
- **profile-ch03** (unwanted): If a child profile requests `danger-full-access`, then the system shall reject it.
- **profile-ch04** (event-driven): When deriving a child profile, the system shall resolve the child's tool allowlist from the child profile independently of the parent's tool allowlist, intersect the parent and child agent allowlists, and set the child's `noSandboxAllowed` to false.
- **profile-ch06** (ubiquitous): A child tool allowlist shall describe that child's tool surface rather than an inherited authorization ceiling; it may include tools absent from the parent's tool allowlist or active-tool exposure.
- **profile-ch07** (ubiquitous): A child tool that can execute a side effect shall remain constrained by the child's sandbox, approval, network, and no-sandbox state even when the parent does not have that tool.
- **profile-ch08** (ubiquitous): The system shall not remove an assigned child tool merely because the child's effective permission envelope will deny some or all calls to it; tool assignment and effect authorization shall remain separate decisions.
- **profile-ch09** (state-driven): While an existing child's parent permission envelope is stricter than the child's spawn-time permission ceiling, the system shall derive the child's effective envelope by clamping every side-effect authorization to the stricter current parent state.
- **profile-ch10** (event-driven): When the user later relaxes the parent's permission envelope, the child's effective envelope may regain authority only up to its immutable spawn-time ceiling and shall never become broader than that ceiling.
- **profile-ch11** (ubiquitous): Parent permission changes shall not add, remove, or otherwise mutate an existing child's tool surface.
- **profile-ch05** (unwanted): If a requested agent is disabled or outside the parent's agent allowlist, then the system shall reject the child profile.
- **profile-sr01** (ubiquitous): The system shall authorize or deny a tool call from profile data alone, so wrong Pi active-tool state cannot grant capability beyond the resolved profile.
