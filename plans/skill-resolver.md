---
kind: requirement
status: draft
tags: [skills, input, resolver]
traces_to:
  - "pi-mono (packages/coding-agent/src/core/skills.ts; input event transform/handled; sendCustomMessage + sendUserMessage)"
  - "pi-mono (packages/agent/src/agent-loop.ts runAgentLoop merges context.messages + prompts)"
  - "codex ($SkillName mention syntax; core/src/skills/render.rs)"
---
# Skill resolver

## Intent

The skill resolver expands `$name` skill mentions found anywhere in a submitted
prompt into full skill blocks. A message such as `yada $foo yada $bar` splits
into **N + 1 messages**: one rendered skill block per unique resolved mention
(before the user's prose), then the user's prose as a normal user message. It
combines codex's `$name` trigger syntax with Pi's eager inlining.

The resolver hooks Pi's `input` extension event. It resolves mentions, emits
each resolved skill as a separate custom message (`customType: "taumel.skill"`)
via `pi.sendMessage()` — which appends to the agent's state and renders a
collapsed skill block in the transcript — then sends the user's prose unchanged
via `pi.sendUserMessage()` to start the actual turn, and
returns `{ action: "handled" }` to swallow the original input.

When `sendUserMessage` re-invokes `prompt()`, the `input` event fires again
with the same text; the resolver recognizes this one re-entry and returns
`{ action: "continue" }` so the turn proceeds normally. The agent loop merges
existing state (skill blocks appended via `sendMessage`) with the new user
message, so the model sees each skill block as separate user content preceding
the prose.

Pi's `parseSkillBlock` is not used; the renderer owns each message's display
as a collapsed-by-default collapsible block, with one block per message. The
skill body sent to the model remains the exact `<skill>` block; provenance such
as "injected because the user mentioned `$foo`" is carried in custom message
details and renderer text, not inserted into the skill body.

The OCaml core owns the algorithm — skill discovery, mention recognition, and
per‑skill block assembly — as the reference implementation; TypeScript is a
thin bridge that registers the `input` handler and the `taumel.skill` renderer.

## Requirements

### Scope and hook

- **skr-sc01** (ubiquitous): The system shall resolve `$name` skill mentions found anywhere in a submitted prompt by emitting each resolved skill as a separate custom message via `pi.sendMessage()`, then sending the original prose unchanged via `pi.sendUserMessage()`, and returning `{ action: "handled" }` from Pi's `input` event.
- **skr-sc02** (ubiquitous): The system shall place discovery, mention recognition, and per‑skill block assembly in the OCaml core; the TypeScript host shall register the `input` handler and the `taumel.skill` message renderer.
- **skr-sc03** (ubiquitous): The system shall run always‑on with no configuration surface, staying inert unless the prompt contains at least one mention that resolves to a known skill.
- **skr-sc04** (event‑driven): When `sendUserMessage` re‑triggers the `input` event with the unchanged prose, the system shall allow that one re-entry to return `{ action: "continue" }`, allowing the turn to proceed without infinite recursion while preserving the literal `$name` text.

### Token recognition

- **skr-tk01** (ubiquitous): The system shall recognize a mention as `$` immediately followed by a lowercase letter and then a run of lowercase letters, digits, and hyphens (`$[a-z][a-z0-9-]*`), taking the longest such run as the candidate skill name.
- **skr-tk02** (ubiquitous): The system shall start a mention at a `$` only when the character immediately before it is not a letter, digit, `$`, or backslash, so a `$` inside a word (`foo$bar`), a doubled `$$foo`, and a backslashed `\$foo` never start a mention.
- **skr-tk03** (ubiquitous): The system shall end a candidate name at the first character outside `[a-z0-9-]`, keeping any trailing punctuation such as `$foo.` or `$foo)` as literal text.
- **skr-tk04** (ubiquitous): The system shall leave escape sequences verbatim, neither collapsing `$$foo` to `$foo` nor stripping the backslash from `\$foo`, since the original prose is sent verbatim to the model.
- **skr-tk05** (ubiquitous): The system shall match candidate names case‑sensitively against lowercase skill names, so `$Foo` resolves to nothing.
- **skr-tk06** (event‑driven): When a candidate name matches no discovered skill, the system shall leave the literal `$name` text in the prose unchanged and emit no custom message for it.

### Skill discovery

- **skr-ds01** (ubiquitous): The system shall build the name‑to‑skill map from the same sources Pi loads, in this precedence with first‑wins on name collision: user default `~/.pi/agent/skills`, project default `<cwd>/.pi/skills`, `skillPaths` from global then project settings, and `--skill` paths from the process arguments.
- **skr-ds02** (ubiquitous): The system shall discover skills with Pi's rule — treat a directory containing `SKILL.md` as a skill root whose name is its frontmatter `name` (falling back to the directory name), and otherwise recurse into subdirectories.
- **skr-ds03** (event‑driven): When a prompt contains at least one candidate mention, the system shall scan the sources at that moment and use the result for that turn only, holding no cache between turns.
- **skr-ds04** (ubiquitous): The system shall resolve a mention to its skill regardless of that skill's `disable-model-invocation` flag, because a `$name` mention is an explicit user invocation.
- **skr-ds05** (ubiquitous): The system shall cover every skill a user configures through the sources in skr‑ds01; skills contributed at load time by other extensions stay out of scope, as Pi exposes no runtime API to enumerate them.
- **skr-ds06** (ubiquitous): The system shall scan skill directories without applying `.gitignore`/`.ignore`/`.fdignore` filtering in v1.

### Skill message emission

- **skr-em01** (ubiquitous): The system shall emit one custom message with `customType: "taumel.skill"` per unique matched skill, so each mention becomes its own rendered message and its own block for the model.
- **skr-em02** (ubiquitous): The system shall order the emitted messages by the first appearance of their mentions and deduplicate by name, emitting each matched skill at most once per turn.
- **skr-em03** (ubiquitous): The system shall send the user's prose via `pi.sendUserMessage()` after all skill messages, so skills precede the prose in the transcript and for the model.
- **skr-em04** (ubiquitous): The OCaml core shall return one ordered per‑skill block payload per mention; the TypeScript handler shall iterate them, calling `pi.sendMessage({ customType: "taumel.skill", content: block, display: true })` for each.
- **skr-em05** (ubiquitous): The system shall register a message renderer for `taumel.skill` that draws each block as a collapsed‑by‑default, collapsible skill component (header = `skill: <name>`, body expandable), and never as raw markup.
- **skr-em06** (ubiquitous): The system shall attach renderer-visible provenance to each skill custom message indicating that the harness injected the skill because the user mentioned `$name`, without modifying the `<skill>` block content sent to the model.

### Errors

- **skr-er01** (event‑driven): When reading a matched skill's `SKILL.md` fails, the system shall omit that one block, continue emitting the remaining blocks, and emit one brief warning through the extension error channel.

### Architecture

- **skr-ar01** (ubiquitous): The system shall place recognition and assembly in a pure `lib/skill_resolver.ml` — `mentions` extracts ordered, deduplicated candidate names from raw text, and a block‑assembly function builds one skill block's content from its name, location, base directory, and body — with no I/O.
- **skr-ar02** (ubiquitous): The system shall confine discovery, body reads, and frontmatter stripping to an impure `bin/skill_tools.ml` that delegates recognition and assembly to `lib/skill_resolver.ml` and returns the ordered per‑skill block payloads.
- **skr-ar03** (ubiquitous): The system shall unit‑test the pure functions filesystem‑free, covering boundaries and non‑matches, escapes, the leading‑letter and case rules, miss pass‑through, deduplication with first‑appearance order, and the exact block form.
