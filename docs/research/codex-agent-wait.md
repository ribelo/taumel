# Codex agent-wait behavior

## Scope

Inspected local `~/projects/github/codex` at `origin/main` commit `266dcbfe5b1972c027a4c04728e45949ccc1e820` to determine whether waiting returns an agent's final message.

## Findings

Codex currently contains two multi-agent wait designs:

1. **V1 `wait_agent` waits for terminal status and can return the final message.** Its tool description says completed statuses may include the agent's final message. The handler races selected agents until one reaches a final status, then serializes a JSON status map. `AgentStatus::Completed(Option<String>)` embeds the final assistant message in the completed status. Sources: `codex-rs/core/src/tools/handlers/multi_agents/wait.rs`, `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`, and `codex-rs/protocol/src/protocol.rs` at the commit above.
2. **V2 `wait_agent` is only a mailbox wake-up primitive.** Its description explicitly says it does not return content. It returns only a message and `timed_out`; content arrives through a separate mailbox/update mechanism. Source: `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs` and `codex-rs/core/src/tools/handlers/multi_agents_spec.rs` at the commit above.

The older synchronous `task` tool on the checked-out branch also waits for `TaskComplete`, extracts `last_agent_message`, and returns that final text directly with session metadata. Source: `core/src/tools/handlers/task.rs`.

## Taumel implication

Taumel should follow the Codex V1 explicit-delivery shape, not V2 mailbox semantics: `agent_wait` is the sole model-facing operation that returns final or partial child text. A completed result therefore contains `output`, while a failed, cancelled, or lost result contains `partial_output`; status and notification surfaces omit both.

This is also the provider-portable choice in Pi. Provider-facing messages have `user`, `assistant`, or `toolResult` roles, while custom messages are converted to `user`; Pi has no attributed `agent_message` input item. Automatic mailbox delivery would therefore falsely attribute child output to the user or assistant. Sources: `packages/ai/src/types.ts`, `packages/coding-agent/src/core/messages.ts`, and `packages/coding-agent/docs/session-format.md` in pi-mono.
