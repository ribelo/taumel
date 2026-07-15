---
kind: requirement
---
# Thinking shortcuts

## Intent

Provide directional shortcuts for changing Pi's active thinking level.

## Requirements

- Taumel shall register Codex-style directional thinking shortcuts through Pi's existing shortcut API rather than implementing a separate key-dispatch mechanism. ^think-ks01
- `alt+,` and `shift+down` shall decrease the active Pi thinking level by one step; `alt+.` and `shift+up` shall increase it by one step. ^think-ks02
- Directional thinking shortcuts shall walk the Pi thinking order `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, clamp at the ends, and never wrap. ^think-ks03
- Taumel shall apply the requested level with `pi.setThinkingLevel`, then read back `pi.getThinkingLevel` so Pi remains responsible for model-capability clamping. ^think-ks04
- After handling a directional thinking shortcut, Taumel shall surface the same user-facing status text shape as Pi's built-in thinking cycle: `Thinking level: LEVEL`. ^think-ks05
- Taumel shall not add OCaml state, a model-facing tool, or a separate Taumel configuration toggle for directional thinking shortcuts. ^think-ks06
