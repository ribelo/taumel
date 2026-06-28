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
- **exec-tc03** (ubiquitous): The system shall expose `write_stdin` requiring a numeric `session_id`, with optional `chars` (empty meaning poll) and `yield_time_ms`.
- **exec-tc04** (unwanted): If `session_id` is negative, missing, unknown, or owned by another parent session, or non-empty stdin targets a non-TTY or stdin-closed session, then the system shall reject the call.

### Shell selection

- **exec-sh01** (ubiquitous): The system shall run commands with bash as `bash -c <cmd>` non-login, resolving `/bin/bash`, then `PATH` bash, then `sh`, never reading `$SHELL`, and shall not expose shell choice as a model parameter.

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

- **exec-rt01** (ubiquitous): The system shall create an in-memory command session tracking its id, owning parent session, TTY flag, child process, a temp-file full-output record plus a bounded rolling tail, unread-output position, exit status, background-delivery state, and waiters.
- **exec-rt02** (ubiquitous): The system shall stream all output to a temp file, keep only a bounded rolling tail in memory (last 2000 lines / 50KB), merge stdout and stderr into one ordered stream, and drain incremental deltas per call.
- **exec-rt03** (event-driven): When the first `exec_command` call runs, the system shall wait up to `yield_time_ms` (default 10000, minimum 250, maximum 30000); if the process exits first it shall return an exit code and no `sessionId`, otherwise it shall return a `sessionId` and no exit code.
- **exec-rt04** (event-driven): When `write_stdin` runs, the system shall write to stdin for non-empty `chars` on a TTY-backed session, or poll for empty `chars` (default 250 ms write; empty poll 5000–300000 ms), and remove a session after its final drain or notification delivery.
- **exec-rt05** (event-driven): When a wait is aborted, the system shall kill the process and reject with "Shell command aborted"; owner shutdown shall kill every live session for that owner; the system shall provide no wall-clock auto-kill timeout.

### Result

- **exec-rs01** (ubiquitous): The system shall match Pi `bash` result text: completed exit 0 shows the truncated output or "(no output)"; non-zero shows the output and "Command exited with code N" marked as an error; aborted shows the drained output and "Command aborted"; timed out shows the drained output and "Command timed out after N seconds"; a still-running async session shows the drained output and a status line naming the session and pointing to `write_stdin`.
- **exec-rs02** (ubiquitous): The system shall keep command duration out of the model text and include it only in the UI render and the `wallTimeMs` detail.
- **exec-rs03** (ubiquitous): The system shall include details `ok`, `output`, `stdout`, `stderr`, `truncation` and `fullOutputPath` when truncated, `wallTimeMs`, `exitCode`/`code` when complete, `sessionId`/`session_id` when running, `sandboxed`, and `escalated`.
- **exec-rs04** (ubiquitous): The system shall truncate displayed output to the last 2000 lines or 50KB with a temp-file footer and apply no token budget.
- **exec-rs05** (event-driven): When a sandboxed command fails, the system shall scan for network and filesystem failure evidence and append `SANDBOX_DIAGNOSTIC=<json>` plus a human message, with `sandboxDiagnostic` in details.

### Background completion

- **exec-bg01** (event-driven): When an async session exits while unpolled and undelivered, the system shall deliver a background completion notification to its owner exactly once.
- **exec-bg02** (event-driven): When `write_stdin` observes the exit and drains the final output, the system shall consume the session and suppress the background notification.
- **exec-bg03** (event-driven): When the owner's turn ends, the system shall flush each pending, unconsumed, exited session as a `taumel.notification` steering message with `kind = exec_completion`, flushing via `triggerTurn` when the owner is idle and never as a follow-up.
- **exec-bg04** (ubiquitous): The system shall mark a session delivered only after the Pi send succeeds and shall deliver exactly once through the consumed and delivered flags.
- **exec-bg05** (ubiquitous): The system shall produce no background notification for synchronous commands or for aborted or owner-killed sessions.

### Rendering and security

- **exec-rn01** (ubiquitous): The system shall render `exec_command` and `write_stdin` per `tool-rendering` (`render-ex01`), matching Pi `bash` static layout without the live-ticking timer.
- **exec-sec01** (ubiquitous): The system shall let no command bypass the tool gateway, never delegate shell execution to a built-in host tool, own command sessions by their parent session, block `write_stdin` from reaching another parent's session, and require an approved action for escalated execution.
- **exec-om01** (ubiquitous): The system shall omit a terminal-emulator UI, cross-session command control, automatic retries, persistent command history, and persistence of live sessions across process restart.
