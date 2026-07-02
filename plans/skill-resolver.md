---
kind: requirement
status: draft
tags: [skills, input, resolver]
traces_to:
  - "pi-mono (packages/coding-agent/src/core/skills.ts; before_agent_start + registerMessageRenderer; SkillInvocationMessageComponent)"
  - "pi-mono (packages/agent/src/harness/messages.ts convertToLlm: custom -> user content)"
  - "codex ($SkillName mention syntax; core/src/skills/render.rs)"
---
# Skill resolver

## Intent

The skill resolver expands `$name` skill mentions found anywhere in a submitted
prompt into full skill blocks, so a single message such as
`yada yada $foo yada $bar` sends both the `foo` and `bar` skill bodies. It
combines codex's `$name` trigger syntax with Pi's eager inlining: where Pi's
built-in `/skill:name` must lead the message and expands exactly one skill, the
resolver matches multiple mentions in any position and expands each into its own
block.

The resolver hooks Pi's `before_agent_start` event and returns a single custom
message (`customType: "taumel.skill"`) whose content carries one `<skill>` block
per unique matched skill — Pi's `before_agent_start` accepts exactly one `message`
per handler, so all blocks ride in one message. Pi's `convertToLlm` maps every
`custom` message to `user` content before the provider request, so each block
reaches the model as user content. A registered message renderer splits that
message back into one collapsible skill block per skill, so every mention renders
as a proper block for any count — never raw markup. The user's prose message is
left untouched, keeping the user bubble clean with the `$name` mentions visible.

The OCaml core owns the algorithm — skill discovery, mention recognition, and
per-block assembly — as the reference implementation; TypeScript is a thin bridge
that registers the `before_agent_start` handler and the `taumel.skill` renderer.

## Requirements

### Scope and hook

- **skr-sc01** (ubiquitous): The system shall resolve `$name` skill mentions found anywhere in a submitted prompt by appending, through Pi's `before_agent_start` event, a single custom message whose content carries one full skill block per unique mention, and by registering a renderer that displays each block.
- **skr-sc02** (ubiquitous): The system shall place discovery, mention recognition, and block assembly in the OCaml core; the TypeScript host shall register the `before_agent_start` handler that returns the custom messages and the `taumel.skill` message renderer.
- **skr-sc03** (ubiquitous): The system shall run always-on with no configuration surface, staying inert unless the prompt contains at least one mention that resolves to a known skill.
- **skr-sc04** (state-driven): While Pi fires `before_agent_start` for a turn — every prompt submitted while the agent is idle — the system shall resolve that turn's mentions; a message submitted while the agent is streaming (queued or steered) keeps its mentions literal, because Pi fires `before_agent_start` once per turn and exposes no interception on the direct steer or follow-up path.

### Token recognition

- **skr-tk01** (ubiquitous): The system shall recognize a mention as `$` immediately followed by a lowercase letter and then a run of lowercase letters, digits, and hyphens (`$[a-z][a-z0-9-]*`), taking the longest such run as the candidate skill name.
- **skr-tk02** (ubiquitous): The system shall start a mention at a `$` only when the character immediately before it is not a letter, digit, `$`, or backslash, so a `$` inside a word (`foo$bar`), a doubled `$$foo`, and a backslashed `\$foo` never start a mention.
- **skr-tk03** (ubiquitous): The system shall end a candidate name at the first character outside `[a-z0-9-]`, keeping any trailing punctuation such as `$foo.` or `$foo)` as literal text.
- **skr-tk04** (ubiquitous): The system shall leave escape sequences verbatim, neither collapsing `$$foo` to `$foo` nor stripping the backslash from `\$foo`, since it never mutates the prose message.
- **skr-tk05** (ubiquitous): The system shall match candidate names case-sensitively against lowercase skill names, so `$Foo` resolves to nothing.
- **skr-tk06** (event-driven): When a candidate name matches no discovered skill, the system shall leave the literal `$name` text unchanged and emit nothing for it.

### Skill discovery

- **skr-ds01** (ubiquitous): The system shall build the name-to-skill map from the same sources Pi loads, in this precedence with first-wins on name collision: user default `~/.pi/agent/skills`, project default `<cwd>/.pi/skills`, `skillPaths` from global then project settings, and `--skill` paths from the process arguments.
- **skr-ds02** (ubiquitous): The system shall discover skills with Pi's rule — treat a directory containing `SKILL.md` as a skill root whose name is its frontmatter `name` (falling back to the directory name), and otherwise recurse into subdirectories.
- **skr-ds03** (event-driven): When a prompt contains at least one candidate mention, the system shall scan the sources at that moment and use the result for that turn only, holding no cache between turns.
- **skr-ds04** (ubiquitous): The system shall resolve a mention to its skill regardless of that skill's `disable-model-invocation` flag, because a `$name` mention is an explicit user invocation.
- **skr-ds05** (ubiquitous): The system shall cover every skill a user configures through the sources in skr-ds01; skills contributed at load time by other extensions stay out of scope, as Pi exposes no runtime API to enumerate them.
- **skr-ds06** (ubiquitous): The system shall scan skill directories without applying `.gitignore`/`.ignore`/`.fdignore` filtering in v1.

### Skill message emission and display

- **skr-em01** (ubiquitous): The system shall emit a single custom message with `customType: "taumel.skill"` whose content carries one `<skill>` block per unique matched skill, because Pi's `before_agent_start` accepts one `message` per handler.
- **skr-em02** (ubiquitous): The system shall order the blocks within that message by the first appearance of their mentions and deduplicate by name, including each matched skill at most once per turn.
- **skr-em03** (ubiquitous): The system shall leave the prose message untouched, including the `$name` tokens; the emitted skill message appends after it, so the blocks follow the prose for the model.
- **skr-em04** (ubiquitous): The system shall set each custom message's content to Pi's skill-block form — an opening `<skill name="NAME" location="PATH">`, a line stating that references are relative to the skill's base directory, a blank line, the `SKILL.md` body with its frontmatter removed and surrounding whitespace trimmed, and a closing `</skill>` — matching Pi's `/skill:` expansion.
- **skr-em05** (ubiquitous): The system shall register a message renderer for `taumel.skill` that splits the message content into its `<skill>` blocks and draws each as its own collapsible component, mirroring Pi's `SkillInvocationMessageComponent`, and never as raw markup, for any number of blocks.

### Errors

- **skr-er01** (event-driven): When reading a matched skill's `SKILL.md` fails, the system shall omit that one block, continue emitting the remaining blocks, and emit one brief warning through the extension error channel.

### Architecture

- **skr-ar01** (ubiquitous): The system shall place recognition and assembly in a pure `lib/skill_resolver.ml` — `mentions` extracts ordered, deduplicated candidate names from raw text, and a block-assembly function builds one skill block's content from its name, location, base directory, and body — with no I/O.
- **skr-ar02** (ubiquitous): The system shall confine discovery, body reads, and frontmatter stripping to an impure `bin/skill_tools.ml` that delegates recognition and assembly to `lib/skill_resolver.ml` and returns the ordered custom-message payloads.
- **skr-ar03** (ubiquitous): The system shall unit-test the pure functions filesystem-free, covering boundaries and non-matches, escapes, the leading-letter and case rules, miss pass-through, deduplication with first-appearance order, and the exact block form.
