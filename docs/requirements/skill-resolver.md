---
kind: requirement
tags: [skills, input, resolver]
traces_to:
  - "pi-mono (packages/coding-agent/src/core/skills.ts; input event transform/handled; sendCustomMessage + sendUserMessage)"
  - "pi-mono (packages/agent/src/agent-loop.ts runAgentLoop merges context.messages + prompts)"
  - "codex ($SkillName mention syntax; core/src/skills/render.rs)"
---
# Skill resolver

## Intent

The skill resolver converts arbitrary text into a host-effect plan. The plan
contains the unchanged text, ordered skill messages, and warnings. This boundary
lets different message sources use one expansion mechanism.

The OCaml core owns mention recognition, skill discovery, nested expansion, and
message planning. The TypeScript host retains the source text and adds the OCaml
effects to the plan. It does not implement expansion policy.

The Pi `input` event is the first plan consumer. The host sends each planned
skill message before it sends the original user text. Pi then presents each
skill as separate user context before the text.

Nested skill mentions use one cycle-safe traversal. Missing and disabled skills
remain normal text. A read failure produces a warning and no message for that
skill.

## Requirements

### Scope and hook

- When Taumel receives text for skill expansion, the skill resolver shall create one complete host-effect plan. ^skr-1537
- The host-effect plan shall contain the exact original JavaScript string, planned custom messages, and warnings. ^skr-dbwy
- The OCaml core shall own mention recognition, skill discovery, nested expansion, block assembly, planned messages, and warnings. ^skr-iz3n
- The TypeScript host shall apply the host-effect plan without implementing skill-expansion policy. ^skr-b7ff
- The system shall run always-on under session-effective skill visibility controls, staying inert unless the prompt contains at least one mention that resolves to a known enabled skill. ^skr-sc03
- When `sendUserMessage` re-triggers the `input` event with the unchanged prose, the system shall allow that one re-entry to return `{ action: "continue" }`, allowing the turn to proceed without infinite recursion while preserving the literal `$name` text. ^skr-sc04

### Token recognition

- The system shall recognize a mention as `$` immediately followed by a lowercase letter and then a run of lowercase letters, digits, and hyphens (`$[a-z][a-z0-9-]*`), taking the longest such run as the candidate skill name. ^skr-tk01
- The system shall start a mention at a `$` only when the character immediately before it is not a letter, digit, `$`, or backslash, so a `$` inside a word (`foo$bar`), a doubled `$$foo`, and a backslashed `\$foo` never start a mention. ^skr-tk02
- The system shall end a candidate name at the first character outside `[a-z0-9-]`, keeping any trailing punctuation such as `$foo.` or `$foo)` as literal text. ^skr-tk03
- The system shall leave escape sequences verbatim, neither collapsing `$$foo` to `$foo` nor stripping the backslash from `\$foo`, since the original prose is sent verbatim to the model. ^skr-tk04
- The system shall match candidate names case-sensitively against lowercase skill names, so `$Foo` resolves to nothing. ^skr-tk05
- When a candidate name matches no discovered skill, the system shall leave the literal `$name` text in the prose unchanged and emit no custom message for it. ^skr-tk06

### Skill discovery

- The system shall build the name-to-skill map from the same sources Pi loads, in this precedence with first-wins on name collision: user default `~/.pi/agent/skills`, project default `<cwd>/.pi/skills`, `skillPaths` from global then project settings, and `--skill` paths from the process arguments. ^skr-ds01
- The system shall discover skills with Pi's rule — treat a directory containing `SKILL.md` as a skill root whose name is its frontmatter `name` (falling back to the directory name), and otherwise recurse into subdirectories. ^skr-ds02
- When input text contains a candidate mention, the system shall scan the skill sources and shall not reuse a prior scan. ^skr-i5o9
- The system shall resolve a mention to its skill regardless of that skill's `disable-model-invocation` flag, because a `$name` mention is an explicit user invocation; session-effective skill visibility still wins over that flag. ^skr-ds04
- The system shall cover every skill a user configures through the sources in skr-ds01; skills contributed at load time by other extensions stay out of scope, as Pi exposes no runtime API to enumerate them. ^skr-ds05
- The system shall scan skill directories without applying `.gitignore`/`.ignore`/`.fdignore` filtering in v1. ^skr-ds06

### Skill message emission

- The system shall emit one custom message with `customType: "skill"` per unique matched skill, so each mention becomes its own rendered message and its own block for the model. ^skr-em01
- The system shall order the emitted messages by the first appearance of their mentions and deduplicate by name, emitting each matched skill at most once per turn. ^skr-em02
- The system shall send the user's prose via `pi.sendUserMessage()` after all skill messages, so skills precede the prose in the transcript and for the model. ^skr-em03
- Each planned skill message shall set `customType` to `skill`, set `display` to `true`, and contain one complete skill block. ^skr-z2n2
- Each planned skill message shall include `source`, `trigger`, `name`, and optional `parent` details. ^skr-copf
- The system shall register a message renderer for `skill` that draws each block as a collapsed-by-default, collapsible skill component (header = `skill: <name>`, body expandable), and never as raw markup. ^skr-em05
- The system shall attach renderer-visible provenance to each skill custom message indicating, for a direct mention, that the harness injected the skill because the user mentioned `$name`, and, for a nested mention, that the harness injected the skill because the skill `$parent` mentions `$name`, in both cases without modifying the `<skill>` block content sent to the model. ^skr-em06

### Plan application

- The TypeScript host shall apply plans through a destination that provides warning, custom-message, and text operations. ^skr-vkno
- When a plan contains messages, the plan applicator shall notify warnings before it sends the messages. ^skr-12m2
- When a plan contains messages, the plan applicator shall send them sequentially in plan order before it sends the unchanged text. ^skr-wxvz
- When the plan applicator sends the text, it shall return `handled`. ^skr-wl60
- When a plan contains no messages, the plan applicator shall notify warnings, send no text, and return `passthrough`. ^skr-fzw6
- If a destination operation fails, then the plan applicator shall stop, propagate the failure, and execute no later operation. ^skr-efbe

### Nested expansion

- When a resolved skill's body contains a mention of another known enabled skill, the system shall resolve that mention transitively and emit the nested skill as its own custom message. ^skr-pvy4
- The system shall share one visited set across direct and nested mentions within a turn, reading and emitting each matched skill at most once per turn, so cyclically referencing skills each resolve exactly once. ^skr-lxjt
- The system shall emit nested skills breadth-first after all direct mentions, ordered by first discovery across emitted bodies. ^skr-073y
- The system shall apply direct-mention handling to mentions found in skill bodies unchanged: the token rules of **skr-tk01** through **skr-tk06**, the disabled-skill skip of **skr-vs01**, the invocation-flag override of **skr-ds04**, and the read-failure handling of **skr-er01**. ^skr-tl39

### Errors

- When reading a matched skill's `SKILL.md` fails, the system shall omit that one block, continue emitting the remaining blocks, and emit one brief warning through the extension error channel. ^skr-er01

### Visibility controls

- When a mentioned skill is disabled for the session, the resolver shall ignore that mention without emitting a skill block, warning, or error. ^skr-vs01
- The skill autocomplete provider shall omit skills disabled for the session. ^skr-vs02
- `/skills` in TUI mode shall open a cron-style skill manager; `/skills list`, `/skills enable <name>`, `/skills disable <name>`, and `/skills save` shall work in TUI and non-TUI modes. ^skr-vs03

### Architecture

- The system shall place recognition and assembly in a pure `lib/skill_resolver.ml` — `mentions` extracts ordered, deduplicated candidate names from raw text, a block-assembly function builds one skill block's content from its name, location, base directory, and body, and a closure function discovers nested mentions breadth-first from bodies supplied by an injected fetch — with no I/O. ^skr-ar01
- The pure resolver shall plan expansion as the unchanged text and its ordered direct mentions. ^skr-amig
- The system shall confine discovery, body reads, frontmatter removal, and expansion-effect construction to `bin/skill_tools.ml`. ^skr-ufw0
- The `planSkillExpansion` core method shall accept `{ text, cwd, ctx }` and return planned messages and warnings in one response. ^skr-yyck
- The TypeScript host shall combine the original JavaScript text with the core response without routing that text back through OCaml. ^skr-j8su
- The system shall unit-test the pure functions filesystem-free, covering boundaries and non-matches, escapes, the leading-letter and case rules, miss pass-through, deduplication with first-appearance order, the exact block form, and the closure's cycles, self-references, shared dependencies, breadth-first discovery order, and parent attribution. ^skr-ar03
- The system shall test the generated bridge and plan applicator as public contract seams. ^skr-4281
- The system shall test the Pi input hook as the parent-message integration seam. ^skr-3ws3

## Verification seams

- The pure OCaml resolver seam verifies exact text preservation, direct mention
  order, nested breadth-first order, and cycle prevention.
- The generated bridge seam verifies the request and expansion-effects contracts.
- The TypeScript planning seam verifies exact JavaScript text preservation.
- The TypeScript plan-applicator seam verifies effect order, passthrough,
  handled delivery, and destination failures.
- The Pi input-hook seam verifies unchanged parent `$skill` behavior and
  one-time re-entry.
