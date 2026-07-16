---
kind: requirement
---
# Agent permissions

## Intent

Keep child-agent side effects within an owner-scoped permission envelope while
allowing the user to decide concrete approval requests through the Pi host's
approval UI without involving either the parent or child model.

## Requirements

- While an agent's owning session is loaded with an interactive approval channel, when the agent reaches a decision that requires approval, the agent subsystem shall route an agent approval request through the same Pi-host approval UI used for top-level tool calls. ^agentperm-04k9
- When the agent subsystem presents an agent approval request, it shall identify the requesting agent handle. ^agentperm-flmg
- When the agent subsystem presents an agent approval request, it shall show the concrete side effect and the permission boundary that requires approval. ^agentperm-9des
- If an agent requires approval while its owning parent session is unloaded or has no interactive approval channel, then the agent subsystem shall deny that tool call with reason `approval_unavailable`. ^agentperm-1ph9
- If an agent requires approval while its owning parent session is unloaded, then the agent subsystem shall neither display the request in another session nor wait for its owner to be loaded later. ^agentperm-ry9p
- If no agent approval request was presented to and answered by the user, then the agent subsystem shall not report that the approval was denied by the user. ^agentperm-ryj1
- When an agent reaches an approval decision, the agent subsystem shall apply the owning session's current approval policy using the same approval behavior and outcome taxonomy as an equivalent top-level tool call. ^agentperm-sznz
- When Finder, Oracle, or any worktree-isolated child requests command escalation, the agent subsystem shall reject the request against the identity's immutable ceiling without presenting an approval prompt. ^agentperm-ehai
- An exec-policy prompt for Finder, Oracle, or a worktree-isolated child may authorize an otherwise eligible command only within that identity's existing filesystem sandbox and shall never convert the command into unsandboxed execution. ^agentperm-buxc
- No approval decision or persisted exec-policy rule shall widen a Finder, Oracle, or worktree-isolated identity beyond its immutable read-only or isolation ceiling. ^agentperm-p59u
- When the user chooses an approval scope for an agent approval request, the agent subsystem shall apply the same one-call or persisted-rule scope as the equivalent top-level approval choice and shall not otherwise change the agent's permission envelope. ^agentperm-l6hi
- The agent subsystem shall not inject an agent approval request or the user's approval decision into the parent model's conversation. ^agentperm-in5w
- The harness approval coordinator shall serialize every top-level and agent approval request sharing the loaded session's Pi-host approval UI. ^agentperm-hh1j
- While an approval dialog is active, the harness approval coordinator shall present no other approval dialog and shall not preempt the active dialog. ^agentperm-e0k9
- When top-level and agent approval requests are queued simultaneously, the harness approval coordinator shall present queued top-level requests before queued agent requests and preserve arrival order within each class. ^agentperm-t4mv
- When an approval request waits behind another request, the harness approval coordinator shall start its presentation timeout only when its dialog is displayed. ^agentperm-cmuh
- If a queued approval request's originating tool call is interrupted or its agent is closed, then the harness approval coordinator shall remove that request without displaying it and settle it as interrupted. ^agentperm-asaw
- When the loaded session changes, the harness approval coordinator shall settle the former owner's active and queued agent approval requests as `approval_unavailable` without presenting them in the newly loaded session. ^agentperm-1rbh
- Before presenting an approval request and before executing an approved effect, the harness approval coordinator shall revalidate the request's owner, originating tool call, and current permission policy. ^agentperm-mdzk
- If an active approval dialog's originating tool call is interrupted or its agent is closed, then the harness approval coordinator shall dismiss the dialog, settle the request as interrupted, and proceed to the next eligible request. ^agentperm-h14k
