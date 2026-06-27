# Exec Command

## Status

Implemented.

The Shell Selection, output model, result text, truncation, and rendering
sections describe the behavior Taumel implements: parity with Pi's `bash` tool,
with asynchronous draining as the one intentional difference. The remaining
sections (approval, sandbox, security, session persistence) describe current
behavior and still carry open Grilling Targets.

Background Completion Notification (below) reuses the subagent notification
mechanism (see subagents.md "Completion Delivery") so an async command that
exits while the model has moved on is delivered in a later turn instead of being
silently lost.

## Product Intent

Taumel provides a canonical shell execution tool that lets the model run local
commands while preserving Taumel's central capability, sandbox, approval, and
session-ownership boundaries.

The execution surface replaces direct host shell access. All command execution
must pass through:

- `CapabilityProfile` tool authorization.
- The tool gateway.
- Sandbox policy.
- Optional user approval for explicit escalation.
- Taumel-owned output rendering and session lifecycle tracking.

## In Scope

- `exec_command` for starting shell commands.
- `write_stdin` for polling a running command session and writing stdin when
  the original command was started with `tty=true`.
- Sandbox-aware host invocation planning.
- Approval prompt planning and outcome normalization.
- Long-running command session ownership per parent Pi session.
- Background completion notification for async sessions that exit while
  unpolled, reusing the subagent notification delivery.
- Output truncation and incremental draining.
- Shell result details for model-visible and UI rendering.
- Shutdown of live command sessions when the owning session is shut down.

## Out Of Scope

- A general terminal emulator UI.
- Arbitrary cross-session command control.
- Shell execution outside the Taumel tool gateway.
- Retrying failed commands automatically.
- Keeping command history beyond the current process memory.
- Persisting live command sessions across process restart.

## Tool Contracts

### `exec_command`

Required:

- `cmd`: non-empty shell command string.

Optional:

- `workdir`: working directory. If omitted, the active session `cwd` is used.
- `yield_time_ms`: how long the first call waits for output or completion.
- `tty`: when true, stdin is kept open for `write_stdin`.
- `sandbox_permissions`: currently recognized value is `require_escalated`.
- `justification`: user-facing reason for escalation. Defaults to
  `command requested escalation`.
- `prefix_rule`: optional command prefix rule associated with escalation.

There are no `shell` or `login` parameters: the shell is always bash and is not
a model-facing knob (see Shell Selection).

Invalid:

- Empty or whitespace-only `cmd`.
- Unknown parameters, as rejected by the TypeScript TypeBox schema.

### `write_stdin`

Required:

- `session_id`: numeric command session id.

Optional:

- `chars`: text to write to stdin. Empty string means poll for output.
- `yield_time_ms`: how long to wait for new output or completion.

Invalid:

- Negative or missing `session_id`.
- Unknown session id.
- Session owned by another parent Pi session.
- Non-empty stdin when the original command was not started with `tty=true`, or
  when the session stdin is already closed.

## Shell Selection

`exec_command` always runs commands with **bash**, regardless of the user's
login shell (`$SHELL`) or ecosystem. This matches Pi's `bash` tool and keeps
command semantics stable across machines (the model can rely on bash syntax).

- The shell is resolved by path and never read from `$SHELL`: `/bin/bash` when
  it exists, otherwise the bash found on `PATH` (`which bash`), otherwise `sh`
  as a last resort. This mirrors Pi's `getShellConfig` resolution.
- On systems without `/bin/bash` (for example NixOS), resolution falls through
  to the `PATH`-resolved bash (in the nix store); `/bin/bash` is never assumed
  to exist.
- Commands are invoked **non-login** as `bash -c <cmd>` (matching Pi; not
  `-lc`).
- Shell choice is not a per-call model parameter (no `shell`/`login` args), the
  same as Pi and Codex. If an override is ever needed it is a host/setting
  concern, not a tool argument.

## Authorization And Sandbox Behavior

`exec_command` has gateway effect `Execute`.

Execution is authorized in all sandbox modes. The sandbox controls how the
command runs, not whether the execute effect exists.

For `sandbox_permissions=use_default`:

- If `workdir` is present, it must be readable under sandbox filesystem policy.
- If no `workdir` is present, execution is allowed and the default session cwd is
  used.

For `sandbox_permissions=require_escalated`:

- The request is accepted only when approval policy is `on-request`.
- Other approval policies reject immediately with a model-visible message.
- If accepted, Taumel returns an approval action before host execution.
- Approval success re-runs the same prepared command unsandboxed.

Sandbox invocation:

- If forced unsandboxed, `no_sandbox=true`, or sandbox is effectively full
  filesystem plus network access, Taumel invokes the shell directly.
- Otherwise, Linux commands run through `bwrap`.
- Non-Linux sandboxed execution fails with an instruction to change sandbox
  mode.
- Read-only mode binds workspace roots read-only and uses tmpfs for temporary
  paths.
- Workspace-write mode bind-mounts workspace roots and temp roots writable, but
  protects workspace metadata such as `.git`, `.hg`, and `.svn`.
- Network-disabled mode adds network isolation.

## Approval Behavior

Escalation approval uses the shared command approval prompt path.

- Prompt title: `Command requires approval`.
- Prompt body includes the escalation justification and the command.
- Timeout: 120000 ms.
- UI unavailability, timeout, explicit denial, and interruption are distinct
  model-visible outcomes.
- Approval waits pause goal active-time accounting.
- Child agent approval prompts identify the requesting agent/profile.

Normalized denial messages:

- `Sandbox: command blocked (approval denied by user)`
- `Sandbox: command blocked (approval timed out)`
- `Sandbox: command blocked (approval unavailable)`
- `Sandbox: command blocked (approval interrupted)`

## Runtime Behavior

`exec_command` creates an in-memory command session.

Each session tracks:

- Numeric session id.
- Owning parent Pi session id.
- Whether it was started with TTY stdin.
- Running child process.
- A temp file holding the full output, plus a bounded in-memory rolling tail of
  recent output (Pi's accumulator model) - not unbounded in-memory buffers.
- Unread-output tracking for incremental draining.
- Exit status.
- Background-delivery state: whether the terminal result was consumed by a
  drain (inline poll/initial call) or delivered as a background notification.
- Waiters for output, completion, timeout, or abort.

Output model (Pi's accumulator with incremental async draining):

- All output is streamed to a temp file - the full, lossless record.
- Only a bounded rolling tail is kept in memory (last 2000 lines / 50KB), so a
  chatty long-running command cannot grow memory without bound. This replaces
  the previous unbounded `stdout`/`stderr`/combined string buffers.
- stdout and stderr are merged into one ordered stream, as in Pi (preserving
  interleaving), rather than tracked as separate full buffers.
- Each `exec_command`/`write_stdin` call drains and returns the output produced
  since the last read (incremental deltas), never a cumulative re-send (matching
  Codex's `unified_exec` drain-per-request behavior).
- On the short-command path (the process exits within the first yield window),
  the single drain is the full output, tail-truncated exactly like Pi with the
  temp-file footer - i.e. byte-for-byte Pi behavior.

The first `exec_command` call waits up to `yield_time_ms`.

- Default is 10000 ms.
- Minimum accepted responsive wait is 250 ms.
- Maximum is 30000 ms.
- If the process exits before the wait ends, the result has an exit code and no
  `sessionId`.
- If the process is still running, the result has a `sessionId` and no exit
  code.

`write_stdin` either writes to stdin or polls:

- Non-empty `chars` writes to stdin when the session is TTY-backed.
- Empty `chars` only polls for output or completion.
- Default wait is 250 ms for non-empty input.
- Empty polls wait at least 5000 ms and at most 300000 ms.
- When a process exits, the session is removed after its final output is
  drained, or after its background completion notification is delivered.

Abort behavior:

- Aborting an `exec_command` wait kills the process and rejects with
  `Shell command aborted`.
- Shutting down the owning session kills all live command sessions for that
  owner.
- There is no wall-clock auto-kill `timeout`, by design (see Known Current
  Constraints). Following Codex's `unified_exec`, a still-running command is
  ended by owner shutdown or by writing an interrupt to a TTY session; the model
  is free to stop polling. (An explicit stop/kill interface remains an open
  target.)

## Result Behavior

The model-visible tool text matches Pi's `bash` tool, with one async-only
addition:

- Completed, exit 0: the (truncated) output, or `(no output)` when empty. No
  `Wall time:` or `Output:` labels.
- Completed, nonzero exit: the output followed by `Command exited with code N`,
  and the result is marked as an error.
- Aborted: output drained so far followed by `Command aborted`.
- Timed out: output drained so far followed by `Command timed out after N
  seconds`.
- Still running (async only; Pi has no such case): the output drained so far
  followed by a single status line naming the session id and pointing to
  `write_stdin`, e.g. `[Running - session N; use write_stdin to read more]`.
  This is the one intentional async-vs-sync difference.

Command duration is not part of the model text; it appears only in the UI
render (`Took Xs` / `Elapsed Xs`) and as `wallTimeMs` in details.

Details include:

- `ok`: true for running sessions or exit code 0.
- `output`: newly drained combined output.
- `stdout`: truncated full stdout.
- `stderr`: truncated full stderr.
- `truncation` and `fullOutputPath` when output is truncated (as in Pi).
- `wallTimeMs`.
- `exitCode` and `code` when complete.
- `sessionId` and `session_id` when still running.
- `sandboxed`.
- `escalated`.

Output truncation matches Pi:

- The displayed output is the last 2000 lines or 50KB, whichever is hit first.
- When truncated, the full output is streamed to a temp file and a footer is
  appended: `[Showing lines X-Y of Z. Full output: <path>]` (with the byte-limit
  and partial-last-line variants Pi uses).
- There is no `max_output_tokens` budget; the line/byte limits are fixed, as in
  Pi. This implies a rolling-tail + lazy-temp-file accumulator (Pi's
  `OutputAccumulator` behavior) rather than a plain string concat.

Sandbox diagnostics:

- Failed sandboxed commands are scanned for network and filesystem failure
  evidence.
- Diagnostics append `SANDBOX_DIAGNOSTIC=<json>` plus a human message to tool
  text.
- Details include `sandboxDiagnostic`.

## Background Completion Notification

A command that outlives its initial `yield_time_ms` returns a `sessionId` and
keeps running. The model may poll it with `write_stdin`, but it is not required
to. So a background command's result is never silently lost when the model moves
on, an async session that exits on its own is delivered to its owner as a
background completion notification, reusing the same Taumel notification queue
and delivery mechanism as subagent completions (see subagents.md "Completion
Delivery").

A session is a **pending deliverable completion** when all of:

- it went async (a `sessionId` was returned because the process outlived the
  first call), and
- its process has exited, and
- its final output was not already drained-to-completion by a `write_stdin`
  poll or the original call (not consumed), and
- it has not already been delivered (not notified).

As with subagents, two readers pull from the single per-session delivery state,
and the first to reach a terminal session claims it exactly once:

1. **`write_stdin` poll (pull).** A poll that observes the exit and drains the
   final output consumes the session, returns the output inline, and suppresses
   any background notification. This is the model's first-claim path during an
   active turn (the exec analogue of `agent_wait`).
2. **`turn_end` / idle flush (push).** On the owner's `turn_end`, Taumel flushes
   every pending, unconsumed, undelivered exited session for that owner as a
   `taumel.notification` **steering** message, injected at the start of the next
   turn before the assistant response. When the owner is **idle** (no loop, no
   poll possible) it flushes via `triggerTurn` to wake a turn. Never follow-up.
   See subagents.md for why steer vs trigger and why not follow-up. Each session
   is marked delivered only after the Pi send succeeds; a failed send leaves it
   pending for a later flush.

The notification is a `taumel.notification` custom message with
`kind="exec_completion"`, delivered through the same path as subagent
completions (model-visible `content` plus `display`, no tool-specific message
type). Its content names the session id and exit code and includes the
(truncated) final output, with the same temp-file footer the inline result uses
when truncated.

Lifecycle interaction:

- An exited async session is retained until its completion is either drained by
  a poll or delivered as a notification; it is not removed the instant the
  process exits (otherwise the result would be lost). After delivery or drain it
  is removed.
- A session aborted by the model (`Command aborted`) or killed by owner shutdown
  is consumed by that terminal outcome and does not produce a background
  notification — the owner already knows, or is gone.
- Synchronous commands (those that exit within the first `yield_time_ms`, with
  no `sessionId`) never notify: their result was already returned inline.
- Delivery is exactly once: the consumed/delivered flags are the single source
  of truth, identical to the subagent model.

## Rendering Behavior

The UI matches Pi's `bash` tool's static layout. The live-ticking timer is
intentionally not replicated: it is inapplicable to the async model (the call
returns within the yield window while the command keeps running) and would force
stateful components into a deliberately stateless renderer.

- Title: `$ <command>` in bold tool-title color, plus `(timeout Ns)` when a
  timeout is set. For `write_stdin`, the title is the stdin text being written,
  or `poll session N` when polling.
- Output: Pi's preview style - about 5 lines when compact, with a
  `... (N earlier lines, <key> to expand)` hint; full output when expanded.
- Truncation warning line: `[Showing lines X-Y of Z. Full output: <path>]` (with
  Pi's byte-limit / partial-last-line variants).
- Footer status: a completed command shows `Took Xs`; a still-running command
  shows `running session N` (the async stand-in for Pi's ticking `Elapsed`).

## Security Invariants

- No command may bypass the tool gateway.
- Active tool exposure is not the security boundary.
- Shell execution is never directly delegated to a built-in host tool.
- Child agents inherit/clamp sandbox and approval behavior through their
  capability profile.
- Command sessions are owned by their parent Pi session.
- `write_stdin` cannot access another parent session's command session.
- Escalated execution requires an explicit approved approval action.

## Acceptance

- `exec_command` rejects empty `cmd`.
- `exec_command` always runs under bash (`bash -c`) even when `$SHELL` is not
  bash, and resolves bash via `PATH` on systems without `/bin/bash`.
- `exec_command` uses the session cwd when `workdir` is omitted.
- `require_escalated` is rejected without a UI prompt unless approval policy is
  `on-request`.
- Approved escalation runs unsandboxed and marks result `escalated=true`.
- Denied, timed-out, unavailable, and interrupted approvals produce distinct
  outcomes.
- A normal command returns output and exit code when it completes within the
  yield window.
- A long-running command returns `sessionId`.
- `write_stdin` can poll a running session and returns later output.
- `write_stdin` rejects sessions owned by another parent.
- Non-TTY sessions reject non-empty stdin writes.
- Sandbox diagnostics are shown when a sandboxed command appears blocked by
  filesystem or network policy.
- Live command sessions are killed when the owning session shuts down.
- An async command that exits while unpolled delivers a background completion
  notification to its owner exactly once (steered at `turn_end`, or via
  `triggerTurn` when the owner is idle).
- A session drained to completion by `write_stdin` does not also produce a
  background notification.
- Synchronous commands and aborted/owner-killed sessions produce no background
  notification.

## Known Current Constraints

- Live command sessions are process-memory state only.
- Sandbox execution depends on Linux and `bwrap` for constrained modes.
- There is no persistent command history.
- There is no model-visible structured command timeline beyond tool results.
- There is no command-kill `timeout` parameter, by design: `exec_command` is
  asynchronous (it returns within the yield window while the command keeps
  running), so Pi's blocking-model timeout - which exists to stop a *blocking*
  call from hanging the agent - does not apply. This follows Codex's
  `unified_exec`, whose async session tool exposes only `yield_time_ms` and no
  kill-timeout (Codex's kill-timeout lives on its separate synchronous `exec`).
  The internal `timeout_ms` plumbing stays unexposed.

## Grilling Targets

Resolved (now captured above as target design):

- Raw shell primitive vs higher-level task primitive -> raw shell primitive.
- Always bash vs ecosystem shell -> always bash (`bash -c`).
- Output as incremental stream vs cumulative snapshots -> incremental deltas
  with a full-output temp file.
- Result/rendering look -> Pi `bash` parity, async draining as the one
  difference.

Still open (not yet grilled):

- Whether approval escalation should be per-call only or support durable
  prefix-rule approvals.
- Whether live sessions should persist across process/session resume.
- Whether `write_stdin` should remain a separate tool or become part of a
  unified exec session interface.
- Whether sandbox diagnostics should be advisory text or typed recovery
  instructions.
