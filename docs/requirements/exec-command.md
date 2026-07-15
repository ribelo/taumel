---
kind: requirement
tags: [exec-command, execution, sandbox, tools]
---
# Exec command

## Intent

`exec_command` is the canonical shell execution tool. Every command passes
through capability-profile authorization, the tool gateway, sandbox policy,
optional approval for escalation, and Taumel-owned output rendering and session
lifecycle. Every command runs in a PTY; `write_stdin` polls a running session
or writes to its stdin. Execution is asynchronous with incremental draining,
and user-facing rendering remains Taumel-owned.

## Requirements

### Tool contracts

- The system shall expose `exec_command` requiring a non-empty `cmd`, with optional `workdir`, `yield_time_ms`, `max_output_tokens`, `with_escalated_permissions`, and `justification`, and no `tty`, `shell`, `login`, `sandbox_permissions`, or `prefix_rule` parameter. ^exec-tc01
- If `cmd` is empty or whitespace, or a parameter is unknown, then the system shall reject the call through the TypeBox schema. ^exec-tc02
- The system shall expose `write_stdin` requiring a numeric `session_id`, with optional `chars` (empty meaning poll), `yield_time_ms`, `max_output_tokens`, and `output_mode` restricted to `delta` or `status` and defaulting to `delta`. ^exec-tc03
- If `session_id` is negative, missing, unknown with no retained terminal state, or owned by another parent session, or non-empty stdin targets a session whose stdin is closed or whose process has completed, then the system shall reject the call. ^exec-tc04
- The system shall run every `exec_command` process in a PTY and shall not expose a TTY mode choice to the model. ^exec-tc08
- When an asynchronous command outlives the agent turn, the system shall make its completion available through an `exec_completion` notification. ^exec-tc09
- The system shall describe `exec_command` to the model as `Run a shell command in a PTY. Returns completed output, or a session ID when the command is still running so it can be continued with write_stdin. Yielding does not stop the command.` ^exec-tc10
- The system shall describe `write_stdin` to the model as `Send characters to or wait on an exec_command session and return recent output. Use output_mode=status for passive waits that should not add process output to your context; use delta only when you need to inspect the process’s progress or interact with it.` ^exec-tc11
- The system shall expose an optional model-facing `workdir` parameter, default it to the current turn working directory, and treat an empty string as omitted. ^exec-tc12
- The system shall describe the model-facing `exec_command.cmd` parameter as `The bash command to run.` ^exec-47ew
- When `exec_command` returns `Process running with session ID N`, the system shall instruct the agent to call `write_stdin` only with that exact id. ^exec-tc13
- When `exec_command` returns `Process exited with code N`, the system shall state that the command is complete and that `write_stdin` must not be called for it. ^exec-tc14
- The system shall direct agents to use status mode for quiet passive waits and delta mode only to inspect output or send input. ^exec-tc15
- The system shall make the model-facing `exec_command.workdir` description state that omission uses the current turn working directory. ^exec-tc16
- The system shall make the model-facing `exec_command.yield_time_ms` description state its millisecond unit, 10000 ms default, integer rounding, 250 ms minimum, 30000 ms maximum, and that yielding leaves a live command running. ^exec-tc17
- The system shall make the model-facing `exec_command.max_output_tokens` description state that it is an approximate returned-output limit, defaults to 10000, and truncates excess model-visible output without changing the command-output safety ceiling. ^exec-tc18
- The system shall make the model-facing escalation parameter descriptions state that `with_escalated_permissions = true` requests execution outside sandbox restrictions and may require approval or be denied, and that `justification` is a one-sentence explanation supplied only with that request. ^exec-tc19
- The system shall present `exec_command` in the system tool catalog with the prompt snippet `Run shell commands in a PTY; continue live sessions with write_stdin.` ^exec-tc20
- The system shall make the model-facing `write_stdin.session_id` description require the exact session id returned by `exec_command`. ^exec-tc21
- The system shall make the model-facing `write_stdin.chars` description state that characters are sent verbatim and omission or an empty string polls without writing. ^exec-tc22
- The system shall make the model-facing `write_stdin.yield_time_ms` description state that yielding leaves the process running, delta-mode writes and polls default to 250 ms and accept 250–30000 ms, and empty status-mode waits default to 5000 ms and accept 5000–300000 ms. ^exec-tc23
- The system shall make the model-facing `write_stdin.max_output_tokens` description state that it is an approximate returned-output limit, defaults to 10000, and truncates excess model-visible output. ^exec-tc24
- The system shall make the model-facing `write_stdin.output_mode` description state that `delta` returns output to the agent’s context and permits interaction, `status` silently drains output during an empty-input passive wait, and omission defaults to `delta`. ^exec-tc25
- The system shall present `write_stdin` in the system tool catalog with the prompt snippet `Send input to or wait on an exec_command session.` ^exec-tc26
- If `output_mode` is `status` while `chars` is non-empty, then the system shall reject the call; status-only operation is an empty-input wait or poll, not an interactive write. ^exec-tc05
- The system shall provide `write_stdin.output_mode = status` for passive waits that drain process output without adding it to model context. ^exec-tc06
- The system shall represent command session ids as opaque numeric locators and require `write_stdin` to receive the exact id returned by `exec_command`. ^exec-tc07
- The repository gate shall verify that actual built OCaml prepared-exec outputs, both with and without optional `exec_command` parameters, are accepted by the TypeScript prepared-action decoder. ^exec-2q9v

### Shell selection

- The system shall run commands with bash as `bash -c <cmd>` non-login, resolving `/bin/bash`, then `PATH` bash, then `sh`, never reading `$SHELL`, and shall not expose shell choice as a model parameter. ^exec-sh01
- The system shall inherit `PATH` from Pi's ambient process environment and shall not invoke a login shell, source shell profiles, or synthesize a replacement `PATH` before command execution. ^exec-sh02
- The system shall not expose `shell` or `login` to the model; command authorization and execution shall share the fixed non-login Bash interpretation specified by `exec-sh01`. ^exec-sh03
- The system shall give every command a non-interactive PTY environment by setting `NO_COLOR=1`, `TERM=dumb`, `LANG=C.UTF-8`, `LC_CTYPE=C.UTF-8`, `LC_ALL=C.UTF-8`, `COLORTERM` to the empty string, `PAGER=cat`, and `GIT_PAGER=cat`. ^exec-sh04
- When `cmd` explicitly assigns an environment variable, the system shall give that command-local assignment ordinary shell precedence over the non-interactive PTY environment. ^exec-sh05
- The system shall support line-oriented interaction through the default non-interactive PTY environment but shall not guarantee full-screen terminal UI behavior; a caller that needs a full-screen terminal application shall explicitly assign an appropriate `TERM` and any related environment variables in `cmd`. ^exec-sh06
- When user, global, or repository Git configuration selects a pager, the system shall run a plain `git diff` with `GIT_PAGER=cat` and complete without waiting for pager input unless `cmd` overrides that variable under `exec-sh05`. ^exec-sh07
- The system shall create each PTY with 80 columns and 24 rows. ^exec-sh09
- The system shall inherit Pi's complete ambient process environment before applying the overrides in `exec-sh04` and shall not filter variables whose names contain `KEY`, `SECRET`, or `TOKEN`. ^exec-sh10
- The system shall set `SHELL` to the executable selected by `exec-sh01` so the command environment identifies the shell that executes `cmd`. ^exec-sh11
- The system shall set `GIT_TERMINAL_PROMPT=0` unless `cmd` explicitly overrides it under `exec-sh05`. ^exec-sh12

### Authorization and sandbox

- The system shall give `exec_command` the gateway effect `execute` and authorize it in every sandbox mode. ^exec-az01
- When `with_escalated_permissions` is false or omitted and a non-empty `workdir` is present, the system shall require that directory readable under filesystem policy using the sandbox's requested-path and authorization-path rules and shall permit an authorized directory reached through a symbolic link; with omitted or empty `workdir` it shall allow execution and use the session cwd. ^exec-az02
- When `with_escalated_permissions` is true, the system shall accept it only while the approval policy is `on-request` and otherwise return a model-visible policy rejection. ^exec-az03
- When explicit escalation is approved, the system shall run the prepared command unsandboxed and mark the result `escalated = true`. ^exec-az04
- When planning the host invocation, the system shall apply the sandbox execution rules (`sandbox-bw01`–`sandbox-bw07`). ^exec-az05
- When a default-sandbox command fails with evidence that the sandbox caused the failure and approval policy permits asking, the system shall request approval and, if approved, retry the same command unsandboxed. ^exec-az06
- If a command has an ordinary nonzero exit without sandbox-failure evidence, then the system shall not request escalation or retry it unsandboxed. ^exec-az07

### Approval

- When escalation needs approval, the system shall use the shared command approval prompt titled "Command requires approval", with a body of the justification and command and a 120000 ms timeout. ^exec-ap01
- The system shall treat UI-unavailable, timeout, denial, and interruption as distinct model-visible outcomes with normalized denial messages. ^exec-ap02
- The system shall pause goal active-time accounting during approval waits and identify the requesting agent or profile in child-agent prompts. ^exec-ap03

### Runtime and sessions

- The system shall create an in-memory command session tracking its id, owning parent session, child process, a temp-file full-output record plus a bounded rolling tail, unread-output position, exit status, terminal-result consumption state, completion-notification state, and waiters. ^exec-rt01
- The system shall stream all output to a temp file, retain each unread interval in memory only up to the fixed total-output ceiling, merge PTY output into one ordered stream, preserve the beginning and end when middle truncation is required, and drain incremental deltas per call. ^exec-rt02
- When the first `exec_command` call runs, the system shall wait up to `yield_time_ms` (default 10000, minimum 250, maximum 30000); if the process exits first it shall return an exit code and no `sessionId`, otherwise it shall return a `sessionId` and no exit code. ^exec-rt03
- When delta-mode `write_stdin` runs, the system shall write non-empty `chars` to a running session or poll for empty `chars`, use a default wait of 250 ms clamped to 250–30000 ms, and remove a live session only after its terminal result has been consumed by an explicit tool response or after owner shutdown. ^exec-rt04
- When the initial `exec_command` wait is aborted before a `sessionId` is returned, the system shall kill the process and reject with "Shell command aborted"; owner shutdown shall kill every live session for that owner; the system shall provide no wall-clock auto-kill timeout. ^exec-rt05
- When a live session is removed after terminal output has been consumed, the system shall retain a bounded per-owner terminal session record containing the session id and terminal metadata until at least the next owner turn, and may expire retained records after that bounded window. ^exec-rt06
- The system shall represent terminal-result consumption state as a closed enum with exactly `pending` and `consumed_by_tool`; status-only polls, non-terminal output, and completion notifications shall not change this state. ^exec-rt07
- If a command's terminal-result consumption state is `consumed_by_tool`, then the system shall reject or make impossible any later transition that would return the terminal result content again. ^exec-rt08
- The system shall represent completion-notification state separately from terminal-result consumption state, so sending an `exec_completion` notification cannot consume, discard, or otherwise satisfy the terminal result. ^exec-rt09
- The system shall represent completion-notification state as a closed enum with exactly `pending` and `sent`; failed notification sends leave the state `pending`, and successful sends transition it to `sent`. ^exec-rt10
- When the user interrupts a pending `write_stdin` wait, the system shall interrupt only the wait, leave the shell session running or terminal result retained, not mark the terminal result consumed, and not suppress later completion-availability notification or explicit `write_stdin` reads. ^exec-rt11
- The system shall enforce a fixed 16 MiB total combined stdout-and-stderr byte ceiling for every command, whether the command completes during the initial `exec_command` wait or continues as an asynchronous session. ^exec-rt12
- When a command crosses the total output ceiling, the system shall terminate the command process tree, stop accepting further output, and settle it with a distinct output-limit terminal outcome. ^exec-rt13
- If a command crosses the total output ceiling, then the system shall not let it continue while silently discarding subsequent output. ^exec-rt14
- The system shall keep the 16 MiB total output ceiling fixed and shall not expose it through tool parameters, settings, environment variables, profiles, or session state. ^exec-rt15
- When empty `write_stdin` uses `output_mode = status`, the system shall use the status-specific wait range while retaining delta polling's interruption semantics, atomically drain all output produced since the previous response, preserve that output in the command's full-output record, and omit the drained stdout/stderr from model-facing result text. ^exec-rt16
- The system shall consider output drained by a status-only response, including bytes omitted from the in-memory buffer, consumed for incremental-read purposes and shall never return it through a later delta poll. ^exec-rt17
- The system shall default status-mode `write_stdin` to a 5000 ms wait, accept waits from 5000 through 300000 ms, and instruct callers needing a longer delay to end the turn and rely on completion notification. ^exec-rt18

### Result

- When `exec_command` or `write_stdin` returns a completed process, the system shall state `Process exited with code N` in the model-facing result and omit a session id. ^exec-rs17
- When `exec_command` or `write_stdin` returns a process that remains live, the system shall state `Process running with session ID N` in the model-facing result using the exact id accepted by `write_stdin` and omit an exit code. ^exec-rs18
- The system shall present model-facing result sections in this order: chunk id, wall time, lifecycle state, original token count when available, and `Output:`. ^exec-rs19
- When a process exits with a nonzero code, the system shall treat command execution as a successful tool invocation and report the nonzero lifecycle state in model-facing result text; only failure to invoke or manage execution shall produce a tool error. ^exec-rs22
- The system shall include in each model-facing delta result a six-character hexadecimal chunk id, wall time in seconds to four decimal places, and an approximate original token count. ^exec-rs23
- The system shall include details `ok`, `output`, `stdout`, `stderr`, `truncation` and `fullOutputPath` when truncated, `wallTimeMs`, `exitCode`/`code` when complete, `sessionId`/`session_id` when running, `sandboxed`, and `escalated`. ^exec-rs03
- The system shall implement `max_output_tokens`, defaulting to 10000, without a tokenizer by treating one nominal token as four UTF-8 bytes, estimating the original token count as the ceiling of byte length divided by four, and truncating the middle within the corresponding byte budget at UTF-8 boundaries so model-visible output preserves both its beginning and end with a marker formatted as `…N tokens truncated…` between them. ^exec-rs20
- The system shall keep the model-output budget separate from the fixed 16 MiB total command-output safety ceiling and full-output record. ^exec-rs21
- When model-visible output is truncated, the system shall append a Taumel extension notice giving the path to the complete output record so the model can inspect it selectively. ^exec-rs24
- When a sandboxed command fails, the system shall scan for network and filesystem failure evidence and append `SANDBOX_DIAGNOSTIC=<json>` plus a human message, with `sandboxDiagnostic` in details. ^exec-rs05
- When empty `write_stdin` polls a retained terminal session owned by the caller, the system shall return success with no new output, terminal metadata, and text equivalent to "(session N already completed; no new output)" rather than a tool error. ^exec-rs06
- If non-empty `write_stdin` targets a retained terminal session, then the system shall reject the write with "session N already completed; cannot write stdin" or an equivalent clear non-retryable message. ^exec-rs07
- The system shall preserve structured `truncation` metadata including whether truncation occurred, the token-derived byte budget, original and returned sizes, and `fullOutputPath` when available. ^exec-rs10
- When a command is terminated by the total output ceiling, the system shall return an error that states the configured ceiling was exceeded, preserves the bounded final output preview and truncation metadata, and advises redirecting intentionally large output to a file for selective inspection. ^exec-rs11
- The system shall represent the output-limit terminal outcome distinctly from timeout, user abort, sandbox denial, spawn failure, and an ordinary command exit code. ^exec-rs12
- When status-only `write_stdin` returns a non-terminal response, the system shall include a concise running state, session id, suppressed line and byte counts for that drained interval, and `fullOutputPath` when available, and shall omit process stdout and stderr from model-visible text. ^exec-rs13
- When status-only `write_stdin` returns a terminal response, the system shall include the terminal state, exit metadata, suppressed line and byte counts, and `fullOutputPath` when available, and shall consume the terminal result exactly as a terminal delta response does. ^exec-rs14
- The system shall represent status-only suppression separately from truncation with structured `outputMode`, `suppressedLines`, and `suppressedBytes` details and shall not claim that suppressed output was absent or lost. ^exec-rs15
- When an async command is still running, the system shall explain in the model-visible result and tool description that intermediate output is optional, long status-only polling is for completion dependencies, `exec_completion` is available after ending the turn, and repeated delta polling is for progress inspection or interaction. ^exec-rs16

### Background completion

- When an async session exits while its terminal result has not been consumed by `write_stdin`, the system shall send a background availability notification to its owner at most once after a successful send, unless the terminal result was already consumed by the initial `exec_command` response. ^exec-bg01
- When `write_stdin` returns a terminal command result to the parent, including exit, abort, timeout, or final error, the system shall mark that terminal result consumed and suppress any future completion-availability notifications for that session. ^exec-bg02
- When `write_stdin` returns only non-terminal output or a still-running status, the system shall not mark the terminal result consumed and shall not suppress a later completion-availability notification. ^exec-bg03
- When the owner's turn ends, the system shall flush each exited session whose terminal result is unconsumed and completion-notification state is `pending` as a `notification` custom message for `exec_completion`, flushing via `triggerTurn` when the owner is idle and never as a follow-up. ^exec-bg04
- The system shall make an `exec_completion` notification plain text and opaque, omit command text, terminal output, exit code, `ok`, terminal status, and error class, and include only the `session_id` locator and a visible instruction equivalent to `Command session N has finished. To read and consume the result, call write_stdin with session_id=N, chars="", yield_time_ms=5000.` ^exec-bg05
- The system shall mark a completion notification sent only after the Pi send succeeds, leave failed notification sends pending for a later flush, and never resend a successfully sent notification even while its terminal result remains unconsumed. ^exec-bg06
- The system shall produce no background notification for synchronous commands whose terminal result was consumed by the initial `exec_command` response or for sessions killed because the owner shut down. ^exec-bg07
- When the initial `exec_command` response or `write_stdin` returns a terminal command result, the system shall transition terminal-result consumption state from `pending` to `consumed_by_tool`. ^exec-bg08
- When an `exec_completion` notification send succeeds, the system shall transition only the completion-notification state; it shall leave terminal-result consumption state as `pending`. ^exec-bg09
- While the owner session remains live, the system shall keep every completed async command with an unconsumed terminal result readable through `write_stdin` until consumption or owner shutdown. ^exec-bg10
- The system shall make the read instruction in an `exec_completion` notification name a poll read and use the shortest valid empty-poll cap, currently `yield_time_ms = 5000`. ^exec-bg11
- The system shall place the read instruction in visible `notification` content; structured details may mirror it for rendering and tests but shall not be its only source. ^exec-bg12
- While a `write_stdin` call is actively waiting on or claiming a session, the system shall treat that session as unavailable for `exec_completion` delivery and shall restore notification eligibility only after a non-terminal response or aborted wait. ^exec-bg13
- If a `write_stdin` call for a session has returned a terminal result, then the system shall not send a later completion notification for that session even when process exit wakes concurrent waiters in the same event-loop turn. ^exec-bg14
- When the system is about to send an `exec_completion` custom message, the system shall revalidate and transiently claim the session, skip a stale notification if the claim fails, release the claim if sending fails, and mark notification state `sent` only after successful delivery. ^exec-bg15
- The system shall own exec completion waiting and delivery within the exec subsystem and shall not depend on child-agent or sub-agent lifecycle facilities. ^exec-bg16

### Rendering and security

- The system shall render `exec_command` and `write_stdin` per `tool-rendering` (`render-ex01`), matching Pi `bash` static layout without the live-ticking timer. ^exec-rn01
- The system shall let no command bypass the tool gateway, never delegate shell execution to a built-in host tool, own command sessions by their parent session, block `write_stdin` from reaching another parent's session, and require an approved action for escalated execution. ^exec-kps7
- The system shall omit a terminal-emulator UI, cross-session command control, automatic retries, persistent command history, and persistence of live sessions across process restart. ^exec-om01
- The system shall not rewrite, remove, summarize, or replace prior exec tool results in Pi history to control cumulative context. ^exec-om02
