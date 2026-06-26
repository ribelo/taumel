# Exec Command

## Status

Reconstructed PRD from current implementation and tests.

This document describes the behavior Taumel currently implements for
`exec_command` and its paired `write_stdin` polling/input path. It is not yet an
approved future-state design.

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
- `max_output_tokens`: output budget. The implementation maps tokens to an
  approximate character limit.
- `tty`: when true, stdin is kept open for `write_stdin`.
- `shell`: shell executable. If omitted, the runtime uses the environment shell
  fallback path.
- `login`: defaults to true. Uses `-lc` when true and `-c` when false.
- `sandbox_permissions`: currently recognized value is `require_escalated`.
- `justification`: user-facing reason for escalation. Defaults to
  `command requested escalation`.
- `prefix_rule`: optional command prefix rule associated with escalation.

Invalid:

- Empty or whitespace-only `cmd`.
- Unknown parameters, as rejected by the TypeScript TypeBox schema.

### `write_stdin`

Required:

- `session_id`: numeric command session id.

Optional:

- `chars`: text to write to stdin. Empty string means poll for output.
- `yield_time_ms`: how long to wait for new output or completion.
- `max_output_tokens`: output budget.

Invalid:

- Negative or missing `session_id`.
- Unknown session id.
- Session owned by another parent Pi session.
- Non-empty stdin when the original command was not started with `tty=true`, or
  when the session stdin is already closed.

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
- Full stdout, stderr, and combined output buffers.
- Read offset for incremental output draining.
- Exit status.
- Waiters for output, completion, timeout, or abort.

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
  drained.

Abort behavior:

- Aborting an `exec_command` wait kills the process and rejects with
  `Shell command aborted`.
- Shutting down the owning session kills all live command sessions for that
  owner.

## Result Behavior

Tool text includes:

- Wall time.
- Exit code when complete.
- Session id when still running.
- Drained output.

Details include:

- `ok`: true for running sessions or exit code 0.
- `output`: newly drained combined output.
- `stdout`: truncated full stdout.
- `stderr`: truncated full stderr.
- `wallTimeMs`.
- `exitCode` and `code` when complete.
- `sessionId` and `session_id` when still running.
- `sandboxed`.
- `escalated`.

Output truncation:

- `max_output_tokens` maps to approximately four characters per token.
- Output is capped between 1000 and 200000 characters.
- Truncated output is prefixed with an omission notice.

Sandbox diagnostics:

- Failed sandboxed commands are scanned for network and filesystem failure
  evidence.
- Diagnostics append `SANDBOX_DIAGNOSTIC=<json>` plus a human message to tool
  text.
- Details include `sandboxDiagnostic`.

## Rendering Behavior

Compact UI rendering:

- `exec_command` call title is a one-line truncated command.
- `write_stdin` call title is non-empty stdin text, `session <id>`, or `poll`.
- Partial calls render as running.
- Results render shell output with compact or expanded truncation.

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

## Known Current Constraints

- Live command sessions are process-memory state only.
- Sandbox execution depends on Linux and `bwrap` for constrained modes.
- There is no persistent command history.
- There is no model-visible structured command timeline beyond tool results.
- `timeout_ms` exists in lower-level host call types but is not exposed in the
  current public `exec_command` schema.

## Grilling Targets

- Whether `exec_command` should be a raw shell primitive or a higher-level task
  execution primitive.
- Whether approval escalation should be per-call only or support durable
  prefix-rule approvals.
- Whether output should be incremental stream-like state or only tool-call
  snapshots.
- Whether live sessions should persist across process/session resume.
- Whether `write_stdin` should remain a separate tool or become part of a
  unified exec session interface.
- Whether sandbox diagnostics should be advisory text or typed recovery
  instructions.
