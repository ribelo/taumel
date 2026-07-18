---
kind: requirement
tags: [capability-profile, security, authorization]
depends_on: []
---
# Capability profile

## Intent

model id, thinking level, sandbox preset, approval policy, assigned tool surface,
testable, and resolvable without Pi. The tool gateway enforces the profile for
that agent; Pi active-tool state is an exposure hint, not authority.

Tool delegation and permission inheritance are separate. A child may receive a
different tool surface from its parent, including tools the parent does not
have, while its permission envelope remains no broader than the parent's.

## Requirements

- The system shall provide sandbox presets `read-only`, `workspace-write`, and `danger-full-access`, and approval policies `never`, `on-request`, `on-failure`, and `untrusted`. ^profile-fd02
- The system shall represent an allowlist as `none`, `all`, or an explicit set of names. ^profile-fd03
- When checking a tool or agent against an allowlist, the system shall allow `all`, deny `none`, and allow a name only when the explicit set contains it. ^profile-al01
- The system shall rank sandbox strictness `read-only < workspace-write < danger-full-access` and approval strictness `untrusted < on-request < on-failure < never`, treating the lower rank as stricter. ^profile-rk01
- The system shall resolve a profile purely from profile data, without Pi. ^profile-pu01
- When a parent's preset is `danger-full-access` and the child requests no preset, the system shall set the inherited preset to `workspace-write`. ^profile-ch02
- A child tool allowlist shall describe that child's tool surface rather than an inherited authorization ceiling; it may include tools absent from the parent's tool allowlist or active-tool exposure. ^profile-ch06
- A child tool that can execute a side effect shall remain constrained by the child's sandbox, approval, network, and no-sandbox state even when the parent does not have that tool. ^profile-ch07
- The system shall not remove an assigned child tool merely because the child's effective permission envelope will deny some or all calls to it; tool assignment and effect authorization shall remain separate decisions. ^profile-ch08
- While an existing child's parent permission envelope is stricter than the child's spawn-time permission ceiling, the system shall derive the child's effective envelope by clamping every side-effect authorization to the stricter current parent state. ^profile-ch09
- When the user later relaxes the parent's permission envelope, the child's effective envelope may regain authority only up to its immutable spawn-time ceiling and shall never become broader than that ceiling. ^profile-ch10
- Parent permission changes shall not add, remove, or otherwise mutate an existing child's tool surface. ^profile-ch11
- The system shall authorize or deny a tool call from profile data alone, so wrong Pi active-tool state cannot grant capability beyond the resolved profile. ^profile-sr01
- When decoding a persisted capability profile, the system shall require exactly the fields `modelId`, `thinkingLevel`, `sandboxPreset`, `approvalPolicy`, `tools`, and `noSandboxAllowed`, reject repeated or unknown fields, and accept only the canonical sandbox preset values. ^profile-ikfk
- When decoding a persisted tool allowlist, the system shall require exactly `kind` for `none` and `all`, require exactly `kind` and `names` for `only`, and reject missing, repeated, unknown, or variant-incompatible fields. ^profile-kbtx
