---
kind: requirement
tags: [execpolicy, sandbox, security]
depends_on: ["[[docs/requirements/sandbox]]", "[[docs/requirements/capability-profile]]", "[[docs/requirements/tool-gateway]]"]
traces_to: ["codex/execpolicy (crate: codex-execpolicy)"]
---
# Exec command policy

## Intent

Add a rules-based command classification to Taumel's exec authorization, ported
from codex `execpolicy`. A rule classifies a command as `allow`, `prompt`, or
`forbidden`; the result feeds the existing `authorize_exec` decision as one more
Ralph child sessions, so the classification covers all of them through the path
that already exists.

New code is small: a prefix-rule matcher, a tree-sitter-bash parse plus
allow-list walk, and a reader for rules in Pi config. The decision type,
approval flow, sandbox composition, and config plumbing already exist.

Scope boundary: `exec_command` carries the gate. `write_stdin` writes to an
already-authorized running session and stays out of scope for v1, matching codex
(codex gates the spawn).

## Requirements

- The system shall port the codex `execpolicy` engine as its rule model and evaluation semantics — the `prefix_rule` shape, the `allow`/`prompt`/`forbidden` decisions, strictest-wins precedence, and `match`/`not_match` validation — and preserve behavior parity with codex for equivalent rules and commands. ^execpolicy-cdx7
- When the model invokes `exec_command`, the system shall classify the command and produce a decision of `allow`, `prompt`, or `forbidden` before authorizing execution. ^execpolicy-7q2a
- The system shall parse the command script with tree-sitter-bash and accept word-only command sequences joined by `&&`, `||`, `;`, and `|`. ^execpolicy-k4d1
- If parsing fails or the script contains a construct outside the safe word-only subset, then the system shall treat the command as unmatched and defer to the sandbox and approval context rather than force a `prompt`. ^execpolicy-m9x3
- When a prefix rule's ordered tokens match a command's leading tokens, the system shall record that rule as a match, treating a nested token list as accepted alternatives. ^execpolicy-2f8w
- When several rules match one command, the system shall select the strictest decision in the order `forbidden`, `prompt`, `allow`. ^execpolicy-p1n6
- When no explicit rule matches a command, the system shall add no override and defer the decision to the existing exec authorization. ^execpolicy-3rt5
- The system shall combine the policy decision with the existing exec authorization decision by selecting the strictest of the two. ^execpolicy-9bc2
- When the policy decision is `forbidden`, the system shall deny the command. ^execpolicy-w7k8
- When the policy decision is `prompt`, the system shall request user approval through the existing approval flow. ^execpolicy-q5h9
- While the approval policy is `never`, the system shall resolve a `prompt` classification to `allow` and run the command without asking, reserving denial for `forbidden` rules and sandbox-boundary violations. ^execpolicy-z3v4
- When an unmatched command is destructive (`rm -f`/`rm -rf`, or `sudo` wrapping one), the system shall resolve it to `prompt` only while the approval policy is `on-request` or `untrusted`, resolve it to `allow` while the policy is `never` or `on-failure`, and never resolve it to `forbidden`, applying the same rule in every sandbox mode. ^execpolicy-dgr1
- When an explicit `allow` rule matches a command, the policy decision shall be `allow`, and the system shall not request approval on the policy's behalf. ^execpolicy-t6m0
- The system shall read global rules from `~/.pi/agent/settings.json` under `taumel.execPolicy`. ^execpolicy-h2j7
- While the project is trusted, the system shall read project rules from `<cwd>/.pi/settings.json` under `taumel.execPolicy`. ^execpolicy-r8p3
- The system shall evaluate global and project rules as one pool and select the strictest decision across both scopes, so project rules tighten and global rules hold. ^execpolicy-c1y5
- When rules load, the system shall confirm each rule's `match` examples resolve to that rule and each `not_match` example resolves elsewhere. ^execpolicy-d4q8
- When a session starts or resumes, the system shall load and compile the rule set into core state; the exec path shall evaluate against the compiled set. ^execpolicy-n7l2
- If a rule's `match` or `not_match` examples fail validation, then the system shall surface the error through a notification and skip that rule while keeping the valid rules. ^execpolicy-v8a1
- If a scope's config block is malformed, then the system shall surface the error through a notification and keep the valid rules from the other scope. ^execpolicy-b3e7
- While any scope holds a validation error, the system shall use `prompt` as the no-match default. ^execpolicy-f6c9
- The system shall layer explicit user and project rules over the existing exec authorization, adding rules and keeping the baseline. ^execpolicy-j2d8
- When a command needs approval, the system shall present a three-way choice — deny, allow once, allow always — and on "allow always" shall append an `allow` prefix rule whose pattern is the prompted command's full token sequence and update the in-memory rule set. ^execpolicy-amd3
- When persisting an amended `allow` rule, the system shall write it to `taumel.execPolicy.rules` in the Pi global config file `~/.pi/agent/settings.json` through an atomic read-modify-write that preserves other keys. ^execpolicy-amw5
- If an explicit `prompt` or `forbidden` rule produced the decision, then the system shall withhold the allow-rule amendment offer. ^execpolicy-amd7
- When the system requests approval, it shall report the reason derived from the matched rule or heuristic. ^execpolicy-rsn2
- When the user runs `/execpolicy check <command>`, the system shall report the resolved decision and the rules that matched, and shall leave the command unexecuted. ^execpolicy-u4r1
- When the user runs `/execpolicy` with no argument, the system shall report the active rule count and the scopes that contributed rules. ^execpolicy-y9w6


## Example policy (ported from codex `examples/example.codexpolicy`)

Documentation example for the JSON shape; not a recommended runtime default.

```json
{
  "taumel": {
    "execPolicy": {
      "rules": [
        { "pattern": ["git", "reset", "--hard"], "decision": "forbidden",
          "match": [["git","reset","--hard"]],
          "notMatch": [["git","reset","--keep"], "git reset --merge"] },
        { "pattern": ["cp"], "decision": "prompt",
          "match": [["cp","foo","bar"], "cp -r src dest"] },
        { "pattern": ["ls"], "match": [["ls"], ["ls","-l"]] },
        { "pattern": ["cat"], "match": [["cat","file.txt"]] },
        { "pattern": ["pwd"], "match": [["pwd"]] }
      ]
    }
  }
}
```
