# Thinking shortcuts

- **think-ks01** (ubiquitous): Taumel shall register Codex-style directional thinking shortcuts through Pi's existing shortcut API rather than implementing a separate key-dispatch mechanism.
- **think-ks02** (ubiquitous): `alt+,` and `shift+down` shall decrease the active Pi thinking level by one step; `alt+.` and `shift+up` shall increase it by one step.
- **think-ks03** (ubiquitous): Directional thinking shortcuts shall walk the Pi thinking order `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, clamp at the ends, and never wrap.
- **think-ks04** (ubiquitous): Taumel shall apply the requested level with `pi.setThinkingLevel`, then read back `pi.getThinkingLevel` so Pi remains responsible for model-capability clamping.
- **think-ks05** (ubiquitous): After handling a directional thinking shortcut, Taumel shall surface the same user-facing status text shape as Pi's built-in thinking cycle: `Thinking level: LEVEL`.
- **think-ks06** (unwanted): Taumel shall not add OCaml state, a model-facing tool, or a separate Taumel configuration toggle for directional thinking shortcuts.
