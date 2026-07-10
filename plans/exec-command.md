---
kind: requirement
status: draft
tags: [exec-command, execution, sandbox, tools]
depends_on: ["[[plans/sandbox]]", "[[plans/tool-gateway]]", "[[plans/capability-profile]]", "[[plans/subagents]]"]
---
# Exec command

## Intent

`exec_command` is the canonical shell execution tool. Every command passes
through capability-profile authorization, the tool gateway, sandbox policy,
optional approval for escalation, and Taumel-owned output rendering and session
lifecycle. `write_stdin` polls a running session and writes stdin when the
command started with `tty=true`. Execution is asynchronous with incremental
draining; result and rendering match Pi's `bash` tool, with async draining as
the one intentional difference.

## Requirements

### Tool contracts

- **exec-tc01** (ubiquitous): The system shall expose `exec_command` requiring a non-empty `cmd`, with optional `workdir`, `yield_time_ms`, `tty`, `sandbox_permissions` (`require_escalated`), `justification`, and `prefix_rule`, and no `shell` or `login` parameter.
- **exec-tc02** (unwanted): If `cmd` is empty or whitespace, or a parameter is unknown, then the system shall reject the call through the TypeBox schema.
- **exec-tc03** (ubiquitous): The system shall expose `write_stdin` requiring a numeric `session_id`, with optional `chars` (empty meaning poll), `yield_time_ms`, and `output_mode` restricted to `delta` or `status` and defaulting to `delta`.
- **exec-tc04** (unwanted): If `session_id` is negative, missing, unknown with no retained terminal state, or owned by another parent session, or non-empty stdin targets a non-TTY, stdin-closed, or completed session, then the system shall reject the call.
- **exec-tc05** (unwanted): If `output_mode` is `status` while `chars` is non-empty, then the system shall reject the call; status-only operation is an empty-input wait or poll, not an interactive write.

### Shell selection

- **exec-sh01** (ubiquitous): The system shall run commands with bash as `bash -c <cmd>` non-login, resolving `/bin/bash`, then `PATH` bash, then `sh`, never reading `$SHELL`, and shall not expose shell choice as a model parameter.
- **exec-sh02** (ubiquitous): The system shall inherit `PATH` from Pi's ambient process environment and shall not invoke a login shell, source shell profiles, or synthesize a replacement `PATH` before command execution.

### Authorization and sandbox

- **exec-az01** (ubiquitous): The system shall give `exec_command` the gateway effect `execute` and authorize it in every sandbox mode.
- **exec-az02** (event-driven): When `sandbox_permissions` is `use_default` with a `workdir`, the system shall require that directory readable under filesystem policy; with no `workdir` it shall allow execution and use the session cwd.
- **exec-az03** (event-driven): When `sandbox_permissions` is `require_escalated`, the system shall accept it only while the approval policy is `on-request` and otherwise reject it with a model-visible message.
- **exec-az04** (event-driven): When escalation is approved, the system shall re-run the prepared command unsandboxed and mark the result `escalated = true`.
- **exec-az05** (event-driven): When planning the host invocation, the system shall apply the sandbox execution rules (`sandbox-bw01`–`sandbox-bw06`).

### Approval

- **exec-ap01** (event-driven): When escalation needs approval, the system shall use the shared command approval prompt titled "Command requires approval", with a body of the justification and command and a 120000 ms timeout.
- **exec-ap02** (ubiquitous): The system shall treat UI-unavailable, timeout, denial, and interruption as distinct model-visible outcomes with normalized denial messages.
- **exec-ap03** (ubiquitous): The system shall pause goal active-time accounting during approval waits and identify the requesting agent or profile in child-agent prompts.

### Runtime and sessions

- **exec-rt01** (ubiquitous): The system shall create an in-memory command session tracking its id, owning parent session, TTY flag, child process, a temp-file full-output record plus a bounded rolling tail, unread-output position, exit status, terminal-result consumption state, completion-notification state, and waiters.
- **exec-rt02** (ubiquitous): The system shall stream all output to a temp file, keep only a bounded rolling tail in memory (last 2000 lines / 50KB), merge stdout and stderr into one ordered stream, and drain incremental deltas per call.
- **exec-rt03** (event-driven): When the first `exec_command` call runs, the system shall wait up to `yield_time_ms` (default 10000, minimum 250, maximum 30000); if the process exits first it shall return an exit code and no `sessionId`, otherwise it shall return a `sessionId` and no exit code.
- **exec-rt04** (event-driven): When `write_stdin` runs, the system shall write to stdin for non-empty `chars` on a TTY-backed running session, or poll for empty `chars` (default 250 ms write; empty poll 5000–300000 ms), and remove a live session only after its terminal result has been consumed by an explicit tool response or after owner shutdown.
- **exec-rt05** (event-driven): When the initial `exec_command` wait is aborted before a `sessionId` is returned, the system shall kill the process and reject with "Shell command aborted"; owner shutdown shall kill every live session for that owner; the system shall provide no wall-clock auto-kill timeout.
- **exec-rt06** (event-driven): When a live session is removed after terminal output has been consumed, the system shall retain a bounded per-owner terminal session record containing the session id and terminal metadata until at least the next owner turn, and may expire retained records after that bounded window.
- **exec-rt07** (ubiquitous): The system shall represent terminal-result consumption state as a closed enum with exactly `pending` and `consumed_by_tool`; status-only polls, non-terminal output, and completion notifications shall not change this state.
- **exec-rt08** (unwanted): If a command's terminal-result consumption state is `consumed_by_tool`, then the system shall reject or make impossible any later transition that would return the terminal result content again.
- **exec-rt09** (ubiquitous): The system shall represent completion-notification state separately from terminal-result consumption state, so sending an `exec_completion` notification cannot consume, discard, or otherwise satisfy the terminal result.
- **exec-rt10** (ubiquitous): The system shall represent completion-notification state as a closed enum with exactly `pending` and `sent`; failed notification sends leave the state `pending`, and successful sends transition it to `sent`.
- **exec-rt11** (event-driven): When the user interrupts a pending `write_stdin` wait, the system shall interrupt only the wait, leave the shell session running or terminal result retained, not mark the terminal result consumed, and not suppress later completion-availability notification or explicit `write_stdin` reads.
- **exec-rt12** (ubiquitous): The system shall enforce a fixed 16 MiB total combined stdout-and-stderr byte ceiling for every command, whether the command completes during the initial `exec_command` wait or continues as an asynchronous session.
- **exec-rt13** (event-driven): When a command crosses the total output ceiling, the system shall terminate the command process tree, stop accepting further output, and settle it with a distinct output-limit terminal outcome.
- **exec-rt14** (unwanted): If a command crosses the total output ceiling, then the system shall not let it continue while silently discarding subsequent output.
- **exec-rt15** (ubiquitous): The 16 MiB total output ceiling shall not be configurable through tool parameters, settings, environment variables, profiles, or session state.
- **exec-rt16** (event-driven): When empty `write_stdin` uses `output_mode = status`, the system shall wait under the same yield and interruption rules as a delta poll, atomically drain all output produced since the previous response, preserve that output in the command's full-output record, and omit the drained stdout/stderr from model-facing result text.
- **exec-rt17** (ubiquitous): Output drained by a status-only response, including bytes omitted from the in-memory buffer, shall be considered consumed for incremental-read purposes and shall never be returned by a later delta poll.

### Result

- **exec-rs01** (ubiquitous): The system shall match Pi `bash` result text: completed exit 0 shows the truncated output or "(no output)"; non-zero shows the output and "Command exited with code N" marked as an error; aborted shows the drained output and "Command aborted"; timed out shows the drained output and "Command timed out after N seconds"; a still-running async session shows the drained output and a status line naming the session and pointing to `write_stdin`.
- **exec-rs02** (ubiquitous): The system shall keep command duration out of the model text and include it only in the UI render and the `wallTimeMs` detail.
- **exec-rs03** (ubiquitous): The system shall include details `ok`, `output`, `stdout`, `stderr`, `truncation` and `fullOutputPath` when truncated, `wallTimeMs`, `exitCode`/`code` when complete, `sessionId`/`session_id` when running, `sandboxed`, and `escalated`.
- **exec-rs04** (ubiquitous): The system shall truncate displayed output with Pi `bash` tail semantics: keep the last output lines subject to hard limits of 2000 lines and 50KB, whichever is hit first; apply no token budget; write full output to a temp file whenever truncated; and include a model-visible footer naming the shown line range/counts, the limit hit, and `fullOutputPath`.
- **exec-rs05** (event-driven): When a sandboxed command fails, the system shall scan for network and filesystem failure evidence and append `SANDBOX_DIAGNOSTIC=<json>` plus a human message, with `sandboxDiagnostic` in details.
- **exec-rs06** (event-driven): When empty `write_stdin` polls a retained terminal session owned by the caller, the system shall return success with no new output, terminal metadata, and text equivalent to "(session N already completed; no new output)" rather than a tool error.
- **exec-rs07** (unwanted): If non-empty `write_stdin` targets a retained terminal session, then the system shall reject the write with "session N already completed; cannot write stdin" or an equivalent clear non-retryable message.
- **exec-rs08** (event-driven): When truncated exec output can fit at least one complete line, the system shall render only complete output lines and shall not begin the visible output in the middle of a line.
- **exec-rs09** (event-driven): When the tail-oriented output consists of a single line larger than the 50KB byte cap and no complete line can fit, the system may render a UTF-8-boundary-safe suffix of that line within the byte cap, shall set `lastLinePartial`, and shall include a footer equivalent to Pi `bash`: "Showing last X of line N (line is Y). Full output: PATH".
- **exec-rs10** (ubiquitous): The `truncation` detail shall preserve structured metadata needed to render and reason about truncation: `truncated`, `truncatedBy`, `totalLines`, `totalBytes`, `outputLines`, `outputBytes`, `maxLines`, `maxBytes`, `lastLinePartial`, `firstLineExceedsLimit`, and `fullOutputPath` when available.
- **exec-rs11** (event-driven): When a command is terminated by the total output ceiling, the result shall be an error that states the configured ceiling was exceeded, preserves the bounded final output preview and truncation metadata, and advises redirecting intentionally large output to a file for selective inspection.
- **exec-rs12** (ubiquitous): The output-limit terminal outcome shall remain distinct from timeout, user abort, sandbox denial, spawn failure, and an ordinary command exit code.
- **exec-rs13** (event-driven): A non-terminal status-only `write_stdin` response shall return a concise running state, session id, suppressed line and byte counts for that drained interval, and `fullOutputPath` when available, with no process stdout or stderr in its model-visible text.
- **exec-rs14** (event-driven): A terminal status-only `write_stdin` response shall return the terminal state, exit metadata, suppressed line and byte counts, and `fullOutputPath` when available; it shall consume the terminal result exactly as a terminal delta response does.
- **exec-rs15** (ubiquitous): Status-only suppression shall be represented separately from truncation with structured `outputMode`, `suppressedLines`, and `suppressedBytes` details; it shall not claim that the suppressed output was absent or lost.
- **exec-rs16** (ubiquitous): When an async command is still running, the model-visible result and tool description shall explain that intermediate output is optional: use a long status-only poll when the next action depends on completion, or, outside automation that will immediately continue, end the turn and rely on `exec_completion`; repeated delta polling is for progress inspection or interaction rather than passive waiting.

### Background completion

- **exec-bg01** (event-driven): When an async session exits while its terminal result has not been consumed by `write_stdin`, the system shall send a background availability notification to its owner at most once after a successful send, unless the terminal result was already consumed by the initial `exec_command` response.
- **exec-bg02** (event-driven): When `write_stdin` returns a terminal command result to the parent, including exit, abort, timeout, or final error, the system shall mark that terminal result consumed and suppress any future completion-availability notifications for that session.
- **exec-bg03** (event-driven): When `write_stdin` returns only non-terminal output or a still-running status, the system shall not mark the terminal result consumed and shall not suppress a later completion-availability notification.
- **exec-bg04** (event-driven): When the owner's turn ends, the system shall flush each exited session whose terminal result is unconsumed and completion-notification state is `pending` as a `notification` custom message for `exec_completion`, flushing via `triggerTurn` when the owner is idle and never as a follow-up.
- **exec-bg05** (ubiquitous): An `exec_completion` notification shall be plain text and opaque: it shall not include the command text, terminal output, exit code, `ok`, terminal status, or error class. It shall include only the `session_id` locator and a visible instruction equivalent to: `Command session N has finished. To read and consume the result, call write_stdin with session_id=N, chars="", yield_time_ms=5000.`
- **exec-bg06** (ubiquitous): The system shall mark a completion notification sent only after the Pi send succeeds, leave failed notification sends pending for a later flush, and never resend a successfully sent notification even while its terminal result remains unconsumed.
- **exec-bg07** (ubiquitous): The system shall produce no background notification for synchronous commands whose terminal result was consumed by the initial `exec_command` response or for sessions killed because the owner shut down.
- **exec-bg08** (event-driven): When the initial `exec_command` response or `write_stdin` returns a terminal command result, the system shall transition terminal-result consumption state from `pending` to `consumed_by_tool`.
- **exec-bg09** (event-driven): When an `exec_completion` notification send succeeds, the system shall transition only the completion-notification state; it shall leave terminal-result consumption state as `pending`.
- **exec-bg10** (ubiquitous): While the owner session remains live, every completed async command whose terminal result is unconsumed shall remain readable through `write_stdin` until it is consumed or the owner shuts down.
- **exec-bg11** (ubiquitous): The read instruction in an `exec_completion` notification shall name a poll read and shall not rely on the default empty-poll wait; it shall use the shortest valid empty-poll cap, currently `yield_time_ms = 5000`.
- **exec-bg12** (ubiquitous): The read instruction shall appear in the visible `notification` content itself; structured details may mirror it for rendering and tests, but hidden details shall not be the only source of the read instruction.
- **exec-bg13** (event-driven): While a `write_stdin` call is actively waiting on or claiming a session, the background notification queue shall treat that session as unavailable for `exec_completion` delivery; if the `write_stdin` call returns a terminal result it consumes the session, and if it returns only non-terminal status or is aborted the session may become notification-eligible again later.
- **exec-bg14** (unwanted): A completion notification shall not be sent after a `write_stdin` call for the same session has returned a terminal result, even when process exit wakes both the `write_stdin` waiter and the detached completion waiter in the same event-loop turn.
- **exec-bg15** (event-driven): Immediately before sending an `exec_completion` custom message, the system shall revalidate and transiently claim the session against the same deliverability rules; if the claim fails the stale pending notification shall be skipped, if send fails the claim shall be released, and only a successful send shall mark notification state `sent`.

### Rendering and security

- **exec-rn01** (ubiquitous): The system shall render `exec_command` and `write_stdin` per `tool-rendering` (`render-ex01`), matching Pi `bash` static layout without the live-ticking timer.
- **exec-sec01** (ubiquitous): The system shall let no command bypass the tool gateway, never delegate shell execution to a built-in host tool, own command sessions by their parent session, block `write_stdin` from reaching another parent's session, and require an approved action for escalated execution.
- **exec-om01** (ubiquitous): The system shall omit a terminal-emulator UI, cross-session command control, automatic retries, persistent command history, and persistence of live sessions across process restart.
- **exec-om02** (out-of-scope): Taumel shall not rewrite, remove, summarize, or replace prior exec tool results in Pi history to control cumulative context; Pi owns history retention and compaction.
