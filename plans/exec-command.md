---
kind: requirement
status: draft
tags: [exec-command, execution, sandbox, tools]
---
# Exec command

## Intent

`exec_command` is the canonical shell execution tool. Every command passes
through capability-profile authorization, the tool gateway, sandbox policy,
optional approval for escalation, and Taumel-owned output rendering and session
lifecycle. Every command runs in a PTY; `write_stdin` polls a running session
or writes to its stdin. Execution is asynchronous with incremental
draining. Its model-facing tool contract follows Codex unified exec unless a
Taumel integration constraint gives a documented reason to diverge; user-facing
rendering remains Taumel-owned.

## Requirements

### Tool contracts

- **exec-tc01** (ubiquitous): The system shall expose `exec_command` requiring a non-empty `cmd`, with optional `workdir`, `yield_time_ms`, `max_output_tokens`, `with_escalated_permissions`, and `justification`, and no `tty`, `shell`, `login`, `sandbox_permissions`, or `prefix_rule` parameter.
- **exec-tc02** (unwanted): If `cmd` is empty or whitespace, or a parameter is unknown, then the system shall reject the call through the TypeBox schema.
- **exec-tc03** (ubiquitous): The system shall expose `write_stdin` requiring a numeric `session_id`, with optional `chars` (empty meaning poll), `yield_time_ms`, `max_output_tokens`, and `output_mode` restricted to `delta` or `status` and defaulting to `delta`.
- **exec-tc04** (unwanted): If `session_id` is negative, missing, unknown with no retained terminal state, or owned by another parent session, or non-empty stdin targets a session whose stdin is closed or whose process has completed, then the system shall reject the call.
- **exec-tc08** (ubiquitous): The system shall run every `exec_command` process in a PTY and shall not expose a TTY mode choice to the model.
- **exec-tc09** (optional): Where an asynchronous command outlives the agent turn, the system shall retain `exec_completion` as an explicit Taumel extension to the Codex unified-exec model-facing contract.
- **exec-tc10** (ubiquitous): The model-facing `exec_command` description shall be Codex's `Runs a command in a PTY, returning output or a session ID for ongoing interaction.`
- **exec-tc11** (ubiquitous): The model-facing `write_stdin` description shall begin with Codex's `Writes characters to an existing unified exec session and returns recent output.` and shall append only the guidance needed to explain Taumel's `output_mode = status` extension.
- **exec-tc12** (ubiquitous): The model-facing `workdir` parameter shall be optional, shall default to the current turn working directory, and shall treat an empty string as omitted.
- **exec-tc13** (event-driven): When `exec_command` returns `Process running with session ID N`, the model-facing guidance shall instruct the agent to call `write_stdin` only with that exact id.
- **exec-tc14** (event-driven): When `exec_command` returns `Process exited with code N`, the model-facing guidance shall state that the command is complete and that `write_stdin` must not be called for it.
- **exec-tc15** (ubiquitous): The model-facing guidance shall direct agents to use status mode for quiet passive waits and delta mode only to inspect output or send input.
- **exec-tc05** (unwanted): If `output_mode` is `status` while `chars` is non-empty, then the system shall reject the call; status-only operation is an empty-input wait or poll, not an interactive write.
- **exec-tc06** (optional): Where Taumel exposes Codex-compatible unified exec, the system shall retain `write_stdin.output_mode = status` as an explicit Taumel extension for passive waits that drain process output without adding it to model context.
- **exec-tc07** (ubiquitous): The system shall retain numeric session ids as an integration-level representation difference from Codex; model-facing behavior shall treat the id as an opaque locator and require `write_stdin` to receive the exact id returned by `exec_command`.

### Shell selection

- **exec-sh01** (ubiquitous): The system shall run commands with bash as `bash -c <cmd>` non-login, resolving `/bin/bash`, then `PATH` bash, then `sh`, never reading `$SHELL`, and shall not expose shell choice as a model parameter.
- **exec-sh02** (ubiquitous): The system shall inherit `PATH` from Pi's ambient process environment and shall not invoke a login shell, source shell profiles, or synthesize a replacement `PATH` before command execution.
- **exec-sh03** (ubiquitous): As an intentional permission-boundary divergence from Codex, the system shall not expose `shell` or `login` to the model; command authorization and execution shall share the fixed non-login Bash interpretation specified by `exec-sh01`.

### Authorization and sandbox

- **exec-az01** (ubiquitous): The system shall give `exec_command` the gateway effect `execute` and authorize it in every sandbox mode.
- **exec-az02** (event-driven): When `with_escalated_permissions` is false or omitted and a non-empty `workdir` is present, the system shall require that directory readable under filesystem policy using the sandbox's requested-path and authorization-path rules and shall permit an authorized directory reached through a symbolic link; with omitted or empty `workdir` it shall allow execution and use the session cwd.
- **exec-az03** (event-driven): When `with_escalated_permissions` is true, the system shall accept it only while the approval policy is `on-request` and otherwise reject it with the Codex-compatible model-visible policy message.
- **exec-az04** (event-driven): When explicit escalation is approved, the system shall run the prepared command unsandboxed and mark the result `escalated = true`.
- **exec-az05** (event-driven): When planning the host invocation, the system shall apply the sandbox execution rules (`sandbox-bw01`–`sandbox-bw07`).
- **exec-az06** (event-driven): When a default-sandbox command fails with evidence that the sandbox caused the failure and approval policy permits asking, the system shall match Codex by requesting approval and, if approved, retrying the same command unsandboxed.
- **exec-az07** (unwanted): If a command has an ordinary nonzero exit without sandbox-failure evidence, then the system shall not request escalation or retry it unsandboxed.

### Approval

- **exec-ap01** (event-driven): When escalation needs approval, the system shall use the shared command approval prompt titled "Command requires approval", with a body of the justification and command and a 120000 ms timeout.
- **exec-ap02** (ubiquitous): The system shall treat UI-unavailable, timeout, denial, and interruption as distinct model-visible outcomes with normalized denial messages.
- **exec-ap03** (ubiquitous): The system shall pause goal active-time accounting during approval waits and identify the requesting agent or profile in child-agent prompts.

### Runtime and sessions

- **exec-rt01** (ubiquitous): The system shall create an in-memory command session tracking its id, owning parent session, child process, a temp-file full-output record plus a bounded rolling tail, unread-output position, exit status, terminal-result consumption state, completion-notification state, and waiters.
- **exec-rt02** (ubiquitous): The system shall stream all output to a temp file, retain each unread interval in memory only up to the fixed total-output ceiling so Codex middle truncation can preserve its beginning and end, merge PTY output into one ordered stream, and drain incremental deltas per call.
- **exec-rt03** (event-driven): When the first `exec_command` call runs, the system shall wait up to `yield_time_ms` (default 10000, minimum 250, maximum 30000); if the process exits first it shall return an exit code and no `sessionId`, otherwise it shall return a `sessionId` and no exit code.
- **exec-rt04** (event-driven): When delta-mode `write_stdin` runs, the system shall match Codex by writing non-empty `chars` to a running session or polling for empty `chars`, with a default wait of 250 ms clamped to 250–30000 ms, and shall remove a live session only after its terminal result has been consumed by an explicit tool response or after owner shutdown.
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
- **exec-rt16** (event-driven): When empty `write_stdin` uses `output_mode = status`, the system shall use the status-specific wait range while retaining delta polling's interruption semantics, atomically drain all output produced since the previous response, preserve that output in the command's full-output record, and omit the drained stdout/stderr from model-facing result text.
- **exec-rt17** (ubiquitous): Output drained by a status-only response, including bytes omitted from the in-memory buffer, shall be considered consumed for incremental-read purposes and shall never be returned by a later delta poll.
- **exec-rt18** (ubiquitous): As a Taumel passive-wait extension, status-mode `write_stdin` shall default to a 5000 ms wait and accept waits from 5000 through 300000 ms; callers needing a longer delay shall end the turn and rely on completion notification rather than hold a tool call open.

### Result

- **exec-rs01** (ubiquitous): The system shall follow the Codex unified-exec model-facing result contract unless a Taumel integration constraint gives a documented reason to diverge.
- **exec-rs17** (event-driven): When `exec_command` or `write_stdin` returns a completed process, the model-facing result shall state `Process exited with code N` and shall not include a session id.
- **exec-rs18** (event-driven): When `exec_command` or `write_stdin` returns a process that remains live, the model-facing result shall state `Process running with session ID N` using the exact id accepted by `write_stdin` and shall not include an exit code.
- **exec-rs19** (ubiquitous): The model-facing result shall follow Codex unified-exec framing by presenting chunk id, wall time, lifecycle state, original token count when available, and an `Output:` section in that order.
- **exec-rs22** (event-driven): When a process exits with a nonzero code, the system shall treat command execution as a successful tool invocation and report the nonzero lifecycle state in model-facing result text; only failure to invoke or manage execution shall produce a tool error.
- **exec-rs23** (ubiquitous): Each model-facing delta result shall carry a Codex-compatible six-character hexadecimal chunk id, wall time in seconds to four decimal places, and an approximate original token count.
- **exec-rs03** (ubiquitous): The system shall include details `ok`, `output`, `stdout`, `stderr`, `truncation` and `fullOutputPath` when truncated, `wallTimeMs`, `exitCode`/`code` when complete, `sessionId`/`session_id` when running, `sandboxed`, and `escalated`.
- **exec-rs20** (ubiquitous): The system shall implement Codex-compatible `max_output_tokens`, defaulting to 10000, without a tokenizer by treating one nominal token as four UTF-8 bytes, estimating the original token count as the ceiling of byte length divided by four, and truncating the middle within the corresponding byte budget at UTF-8 boundaries so model-visible output preserves both its beginning and end with the Codex-compatible truncation marker between them.
- **exec-rs21** (ubiquitous): The Codex-compatible model-output budget shall remain separate from Taumel's fixed 16 MiB total command-output safety ceiling and full-output record.
- **exec-rs24** (event-driven): When model-visible output is truncated, the system shall append a Taumel extension notice giving the path to the complete output record so the model can inspect it selectively.
- **exec-rs05** (event-driven): When a sandboxed command fails, the system shall scan for network and filesystem failure evidence and append `SANDBOX_DIAGNOSTIC=<json>` plus a human message, with `sandboxDiagnostic` in details.
- **exec-rs06** (event-driven): When empty `write_stdin` polls a retained terminal session owned by the caller, the system shall return success with no new output, terminal metadata, and text equivalent to "(session N already completed; no new output)" rather than a tool error.
- **exec-rs07** (unwanted): If non-empty `write_stdin` targets a retained terminal session, then the system shall reject the write with "session N already completed; cannot write stdin" or an equivalent clear non-retryable message.
- **exec-rs10** (ubiquitous): The `truncation` detail shall preserve structured metadata needed to render and reason about truncation, including whether truncation occurred, the token-derived byte budget, original and returned sizes, and `fullOutputPath` when available.
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
- **exec-bg16** (ubiquitous): Exec completion waiting and delivery shall be owned by the exec subsystem and shall not depend on child-agent or sub-agent lifecycle facilities being installed.

### Rendering and security

- **exec-rn01** (ubiquitous): The system shall render `exec_command` and `write_stdin` per `tool-rendering` (`render-ex01`), matching Pi `bash` static layout without the live-ticking timer.
- **exec-sec01** (ubiquitous): The system shall let no command bypass the tool gateway, never delegate shell execution to a built-in host tool, own command sessions by their parent session, block `write_stdin` from reaching another parent's session, and require an approved action for escalated execution.
- **exec-om01** (ubiquitous): The system shall omit a terminal-emulator UI, cross-session command control, automatic retries, persistent command history, and persistence of live sessions across process restart.
- **exec-om02** (out-of-scope): Taumel shall not rewrite, remove, summarize, or replace prior exec tool results in Pi history to control cumulative context; Pi owns history retention and compaction.
