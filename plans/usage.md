# Usage

## Decision

Port, renamed from Tau's `/status` to `/usage`.

## Classification

Port with redesign and reduced provider scope.

## Source Of Truth

Use Tau's `/status` OpenAI usage/account behavior as the user-facing reference.
Do not preserve the generic `/status` shape.

## Why Keep It

Provider usage visibility is useful, but it should be scoped to account and
quota information rather than becoming a generic status dumping ground.

## Preserve

- A command for viewing provider usage.
- OpenAI account/API-key status.
- OpenAI plan or quota information where available.
- Compact terminal rendering of usage rows.
- Persistence only where needed for a good user experience.

## Redesign

- Rename the command to `/usage`.
- Make provider support explicit instead of one generic status component.
- Keep OpenAI as the only provider for now.
- Separate provider fetching/parsing from terminal rendering.
- Keep Pi command wiring at the edge.

## Omit

- Gemini CLI usage/status.
- Google Antigravity usage/status.
- Generic `/status` command.
- Sandbox, goal, model, or footer state dumping.

## Acceptance

- `/usage` reports OpenAI usage/account information.
- No Gemini CLI or Antigravity code is ported.
- The component does not become the owner of unrelated runtime status.
