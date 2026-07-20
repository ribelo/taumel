---
kind: requirement
tags: [usage, provider, command]
depends_on: []
---
# Usage

## Intent

`/usage` presents a transient inspection of fixed-pair account and quota
information for OpenAI Codex and Kimi Code in one compact terminal modal.
Provider fetching and parsing stay separate from rendering; Pi command wiring
stays at the edge. Scope stays on account and quota rather than general status.
The module is a deep fixed pair, not a generic provider registry.

## Requirements

- When the user runs `/usage`, the system shall report OpenAI Codex usage and
  Kimi Code usage together. ^usage-cm01
- The system shall support exactly the fixed provider pair OpenAI Codex and Kimi
  Code and shall make that pair explicit rather than a generic provider
  registry. ^usage-pv01
- When resolving credentials for `/usage`, the system shall obtain OpenAI Codex
  credentials exactly as the existing OpenAI host-auth path does, and shall
  obtain the Kimi Code API key only through the Pi model registry provider key
  `moonshot`. ^usage-pv02
- The system shall not use OAuth, secret environment variables, or credential
  files to resolve Kimi Code usage authentication. ^usage-pv03
- The system shall fetch both providers concurrently in OCaml with Eta
  `Effect.par`, and shall normalize each provider's expected failures before
  entering `Effect.par` so one provider's failure cannot cancel the other.
  ^usage-pv04
- The Kimi Code request shall be a fixed `GET`
  `https://api.kimi.com/coding/v1/usages` with `Accept: application/json` and
  `Authorization: Bearer <token>` only. ^usage-pv05
- The system shall render usage as one transient terminal modal that stacks an
  `OpenAI Codex Usage` section above a `Kimi Code Usage` section, with no overall
  modal title, aligned account metadata per section, one progress section per
  quota window, and one shared close footer. ^usage-rn01
- The system shall render quota reset timestamps as human-readable relative
  durations and local clock times rather than Unix timestamps. ^usage-rn02
- When the current quota window provides enough information for a meaningful
  estimate, the system shall show average burn per hour and either estimated
  exhaustion before reset or `Safe until reset`; it shall derive the estimate
  from elapsed time and consumed quota in the current provider window and shall
  omit the estimate when it cannot be calculated. ^usage-rn03
- The system shall use themed emphasis for section titles, progress bars,
  secondary text, and errors. ^usage-rn04
- On narrow terminals, the system shall shrink progress bars, move reset details
  onto additional lines, and ellipsize long account labels rather than clipping
  or horizontally scrolling. ^usage-rn05
- The system shall color remaining quota above 25 percent with `success`, from 11
  through 25 percent with `warning`, from 0 through 10 percent with `error`, and
  unknown quota with `dim`. ^usage-rn06
- The system shall omit unavailable optional account metadata and quota windows;
  if a successful provider response contains no valid quota windows, that
  provider section shall explicitly report `No quota windows returned`.
  ^usage-rn07
- The system shall order each provider's quota windows from shortest duration to
  longest duration, placing unknown-duration windows last. ^usage-rn08
- When OpenAI reports a finite credits balance for a non-unlimited account, the
  system shall include that unitless balance in the OpenAI account metadata
  without assuming a currency; otherwise it shall omit the credits row.
  ^usage-rn09
- The modal shall not show an `Updated` timestamp or freshness label. ^usage-rn10
- Reset and estimated-exhaustion times shall combine a concise relative duration
  with adaptive local time: clock time for today, weekday and clock time within
  seven days, and day, abbreviated month, and clock time thereafter. ^usage-rn11
- When Kimi Code reports `membership.level` values such as `LEVEL_ADVANCED`, the
  system shall render a human plan value such as `Advanced` and shall omit
  internal identifiers. ^usage-rn12
- When Kimi Code reports a finite `boosterWallet` currency balance, the system
  shall include that balance and currency in Kimi account metadata; when a
  monthly charge cap is enabled with a finite cap, the system shall also expose
  it as a percent-left quota window. ^usage-rn13
- The system shall normalize Kimi Code payloads into the same percent-left window
  model used for OpenAI Codex: weekly `usage` as a seven-day `Plan limit` so its
  burn rate can be derived, each valid `limits[]` entry with a duration-derived
  label, and `totalQuota` as `Total quota` with unknown duration ordered last;
  finite numbers and numeric strings plus `resetTime` shall parse when valid,
  and malformed optional rows shall be omitted. ^usage-rn14
- When Kimi Code is not configured in Pi, the Kimi section shall show
  `Kimi Code is not configured in Pi.` and
  `Configure the moonshot provider and try again.` ^usage-rn15
- The completed modal shall ignore unrelated input and close only on `Esc`, `q`,
  or `Enter`. ^usage-in02
- On fetch failure, each provider section shall show a concise failure
  classification and bounded sanitized detail based on HTTP status only, never
  response bodies, and shall never expose credentials or authorization headers.
  ^usage-er01
- Usage inspection shall not create a transcript entry, enter model context, or
  contact the agent. ^usage-in01
- Each `/usage` invocation shall perform the existing one-shot dual fetch before
  rendering; the open modal shall not perform additional network requests or
  manually or automatically refresh. ^usage-rf01
- While the one-shot fetch is pending, the system shall show a temporary Pi
  status indicator reading `Fetching account usage...` and shall open the modal
  only after the fetch resolves. ^usage-fx01
- After presenting usage success or failure in the modal, the system shall
  suppress the redundant command completion notification. ^usage-fx02
- The system shall separate provider fetching and parsing from terminal rendering
  and keep Pi command wiring at the edge. ^usage-ar01
- The system shall scope `/usage` output to account and quota information and
  exclude sandbox, goal, model, and footer state. ^usage-sc01
