# Amp agent surfaces and Taumel port boundary

Research date: 2026-07-13.

## Sources

- Amp Owner's Manual, especially [Subagents](https://ampcode.com/manual#subagents),
  [Oracle](https://ampcode.com/manual#oracle), and
  [Code Review](https://ampcode.com/manual#code-review).
- Extracted Amp CLI bundle version `0.0.1783504389-g0a07a6` at
  `/home/ribelo/projects/github/ampcode/amp.bundle.mjs`.
- First-party CLI tool introspection from installed Amp
  `0.0.1769198488-gb44d5f`: `amp tools show Task --json`,
  `amp tools show finder --json`, and `amp tools show oracle --json`. These
  schemas are supporting evidence only because the installed CLI is older than
  the extracted bundle.

## Findings

### Generic subagents are one-shot isolated tasks in Amp

Amp documents subagents as fresh isolated contexts that cannot be guided while
running and return only a final summary. The older introspected `Task` contract
accepts `prompt` and a short `description`, recommends parallel sibling tool
calls, and explicitly says the parent cannot communicate with a subagent until
it finishes. The current bundle still renders `Task` as one nested subagent
activity and recognizes `description`, `prompt`, and an optional `mode`
(`amp.bundle.mjs:58044-58049`).

Therefore Taumel's agreed asynchronous handles, retained identities, and
`agent_send` continuation are deliberate extensions, not an exact Amp port.

### Oracle already covers ad-hoc review

Amp defines Oracle as a costly, powerful second-opinion model for complex
reasoning and analysis. The manual explicitly names debugging and reviewing
complex code, and gives code-review prompts as examples. Amp also routes Oracle
to a different frontier model from the main agent: currently GPT-5.6 Sol at high
reasoning, or Claude Fable 5 when GPT-5.6 Sol is already the main model.

The older introspected Oracle contract is read-oriented (`Read`, `Grep`, `glob`,
web and thread search), accepts a required task plus optional context/files, and
describes code review, architecture feedback, debugging, and planning as its
scope. The current bundle renders `oracle` as a subagent activity
(`amp.bundle.mjs:58035-58038`).

A separate free-form Review agent would overlap Oracle almost completely.

### Amp Code Review is a workflow, not an Oracle-like tool

Amp exposes code review primarily as `amp review` or by asking the main agent to
review changes. The CLI accepts a diff description, focused files, additional
instructions, check scope/filter, checks-only mode, structured JSON output, and
low/high thinking (`amp.bundle.mjs:76281-76314`).

Internally it starts a hidden `review` agent mode, discovers repository-scoped
`.agents/checks/*.md`, asks the review agent to run applicable checks in
parallel, requires one structured `submit_review`, and mechanically combines
main findings with check-agent findings (`amp.bundle.mjs:75868-76024`). The
review mode has a dedicated tool surface of `shell_command`, `run_check`, and
`submit_review` (`amp.bundle.mjs:207849`).

Thus a Taumel `review(message)` wrapper around ordinary agent spawning would not
port Amp Code Review. It would create a misleading duplicate of Oracle while
omitting the actual review workflow.

### Finder is a specialized semantic-search tool

Amp's Finder contract accepts a search query and is intended for conceptual,
multi-step codebase search rather than exact symbols or modification. The
current CLI renders it as “Searching codebase,” separately from the generic
subagent renderer (`amp.bundle.mjs:82481-82504`). Amp's manual and Grep tool
guidance describe Finder as complementary semantic search.

Finder may use agents internally, but its public domain contract is search, not
general delegation.

### The remaining named specialists are Librarian and Painter

Amp's documented and introspectable agent-adjacent surface consists of `Task`,
`finder`, `oracle`, `librarian`, and `painter`. The installed CLI's
`amp tools list --json` exposes those five and no `review` or `advisor` tool.

Librarian is a remote-repository research subagent. It searches and reads public
GitHub repositories plus explicitly authorized private repositories, emphasizes
cross-repository architecture and history, and returns long,
documentation-quality explanations. It is not for local search or mutation
([Amp manual: Librarian](https://ampcode.com/manual#librarian)).

Painter is an image-generation/editing tool rather than a coding subagent. The
current manual says it is powered by GPT Image 2 and supports generation,
mockups, icons, and edits with up to three reference images
([Amp manual: Painter](https://ampcode.com/manual#painter)). Its contract is
backend-specific and should not be modeled as a normal text agent merely because
it invokes a model.

The current extracted bundle contains an internal `advisor` tool-name constant,
but it is absent from the documented manual, absent from the installed CLI's
active tool list, and absent from the standard mode tool sets. It is not an
observable product surface to port.

## Recommended Taumel port

1. Keep the agreed generic asynchronous agent lifecycle, acknowledging that its
   retained identity and continuation semantics intentionally exceed Amp's
   one-shot `Task` behavior.
2. Port `oracle` as the sole built-in reasoning/advisory specialist. It should
   remain read-oriented and route to a configured high-capability model,
   preferably different from the parent model.
3. Port `finder` as a dedicated semantic-search specialist with a narrow query
   contract and read-only tools, implemented on the shared agent-run machinery.
4. Remove the proposed free-form `review` agent tool. Oracle can perform ad-hoc
   reviews.
5. If Code Review is desired later, specify it independently as a structured
   review workflow with diff selection, findings, and optional checks—not as a
   predefined `agent_spawn`.
6. Postpone Painter. Its image-generation lifecycle and media result contract
   are separate from durable text-agent orchestration.

This leaves seven model-facing tools: `agent_spawn`, `agent_send`, `agent_wait`,
`agent_list`, `agent_close`, `finder`, and `oracle`.
