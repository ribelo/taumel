---
kind: requirement
tags: [usage, provider, command]
depends_on: []
---
# Usage

## Intent

`/usage` presents a transient inspection of OpenAI Codex account and quota
information in a compact terminal modal.
Provider fetching and parsing stay separate from rendering; Pi command wiring
stays at the edge. Scope stays on account and quota rather than general status.

## Requirements

- When the user runs `/usage`, the system shall report OpenAI usage and account information. ^usage-cm01
- The system shall support OpenAI as the only provider and shall make provider support explicit. ^usage-pv01
- The system shall render usage as a transient terminal modal with a visually distinct title, aligned account metadata, and one progress section per quota window. ^usage-rn01
- The system shall render quota reset timestamps as human-readable relative durations and local clock times rather than Unix timestamps. ^usage-rn02
- When the current quota window provides enough information for a meaningful estimate, the system shall show average burn per hour and either estimated exhaustion before reset or `Safe until reset`; it shall derive the estimate from elapsed time and consumed quota in the current provider window and shall omit the estimate when it cannot be calculated. ^usage-rn03
- The system shall use themed emphasis for the title, progress bars, secondary text, and errors. ^usage-rn04
- On narrow terminals, the system shall shrink progress bars, move reset details onto additional lines, and ellipsize long account labels rather than clipping or horizontally scrolling. ^usage-rn05
- The system shall color remaining quota above 25 percent with `success`, from 11 through 25 percent with `warning`, from 0 through 10 percent with `error`, and unknown quota with `dim`. ^usage-rn06
- The system shall omit unavailable optional account metadata and quota windows; if a successful response contains no quota windows, it shall explicitly report `No quota windows returned`. ^usage-rn07
- The system shall order quota windows from shortest duration to longest duration, placing unknown-duration windows last. ^usage-rn08
- When OpenAI reports a finite credits balance for a non-unlimited account, the system shall include that unitless balance in the account metadata without assuming a currency; otherwise it shall omit the credits row. ^usage-rn09
- The modal shall not show an `Updated` timestamp or freshness label. ^usage-rn10
- Reset and estimated-exhaustion times shall combine a concise relative duration with adaptive local time: clock time for today, weekday and clock time within seven days, and day, abbreviated month, and clock time thereafter. ^usage-rn11
- The completed modal shall ignore unrelated input and close only on `Esc`, `q`, or `Enter`. ^usage-in02
- On fetch failure, the modal shall show a concise failure classification and bounded sanitized detail, and shall never expose credentials, authorization headers, or response bodies. ^usage-er01
- Usage inspection shall not create a transcript entry, enter model context, or contact the agent. ^usage-in01
- Each `/usage` invocation shall perform the existing one-shot fetch before rendering; the open modal shall not perform additional network requests or manually or automatically refresh. ^usage-rf01
- While the one-shot fetch is pending, the system shall show a temporary Pi status indicator and shall open the modal only after the fetch resolves. ^usage-fx01
- After presenting usage success or failure in the modal, the system shall suppress the redundant command completion notification. ^usage-fx02
- The system shall separate provider fetching and parsing from terminal rendering and keep Pi command wiring at the edge. ^usage-ar01
- The system shall scope `/usage` output to account and quota information and exclude sandbox, goal, model, and footer state. ^usage-sc01
