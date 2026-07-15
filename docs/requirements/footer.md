---
kind: requirement
tags: [footer, ui]
depends_on: ["[[docs/requirements/sandbox]]"]
---
# Footer

## Intent

The footer is a whole-footer replacement driven from OCaml through a tiny
TypeScript entrypoint. Display formatting lives in a pure OCaml model; Pi and
JavaScript interop stay behind a narrow adapter. The refresh loop uses
`Eta_jsoo`.

## Requirements

- The system shall replace the whole footer from the extension user's perspective and install it from OCaml through a tiny TypeScript entrypoint. ^footer-rp01
- The system shall display session, model/provider/status, git branch and change delta, and sandbox status. ^footer-ds01
- The footer shall represent the loaded session's permission envelope as exactly three adjacent dots ordered sandbox, network, and approval, without a textual permission label. ^footer-pi01
- The sandbox dot shall use the theme's success color for read-only, warning color for workspace-write, and error color for full-access. ^footer-pi02
- The network dot shall use the theme's success color when network access is disabled and error color when network access is enabled. ^footer-pi03
- The approval dot shall use the theme's success color for untrusted, accent color for on-request, warning color for on-failure, and error color for never. ^footer-pi04
- While no-sandbox is enabled, the footer shall override the normal sandbox, network, and approval colors and render all three permission dots using the theme's default text color. ^footer-pi05
- After a permissions or network change, and on session start, resume, or switch, the footer shall immediately render the loaded session's current sandbox, network, no-sandbox, and approval state rather than retained state from another session. ^footer-pi06
- The permission indicator shall use only Pi's standard semantic theme tokens and shall not require custom theme tokens or modifications to Pi theme files. ^footer-pi07
- While the footer is width-constrained, it shall preserve the three independently themed permission dots before repository, model, provider, cost, or context text, and shall not flatten their colors into the dim fallback style. ^footer-pi08
- The system shall hold display formatting in a pure OCaml model, keep Pi/JavaScript interop behind a narrow adapter, and let OCaml own setup, event registration, state, and render decisions. ^footer-ar01
- The system shall drive the footer refresh loop with `Eta_jsoo`. ^footer-rl01
- The system shall omit a backlog indicator and persistent footer settings. ^footer-om01
- On `session_start`, `session_resume`, and `session_switch`, the system shall immediately bind the footer and its subscriptions to Pi's currently loaded main session rather than retaining session-bound footer data from the previously loaded session. ^footer-sl01
- After the loaded main session changes, the footer shall not render the previous session's git branch or change delta. ^footer-sl02
- When session activation changes the working directory, the system shall refresh the git change delta immediately; periodic polling shall update changes that occur between lifecycle events. ^footer-sl03
- While collecting the newly activated session's git change delta, the footer shall show no delta rather than retain the previous session's delta. ^footer-sl04
- When the active working directory is not inside a git repository, the footer shall omit git branch and change-delta information. ^footer-ge01
- The system shall not represent a failed git repository-status or change-delta query as an empty or clean repository state. ^footer-ge02
- When a git repository-status or change-delta query fails for a reason other than the active working directory not being a git repository, the footer shall visibly report a short git query failure indicator. ^footer-ge03
- After a git query failure, periodic refresh shall retry the query and replace the failure indication with current branch and change-delta information on the next successful query. ^footer-ge04
