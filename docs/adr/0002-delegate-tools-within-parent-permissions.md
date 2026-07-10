# Delegate different tools within parent permissions

Taumel allows a child agent to have tools that its parent does not have, so a
tool-light orchestrator can delegate implementation to a child with mutation
tools. Tool surfaces are agent interfaces rather than inherited permission
ceilings; privilege escalation is prevented by clamping the child's sandbox,
approval, network, and no-sandbox authority to the parent's permission envelope.
Assigned tools remain visible when that envelope will deny their effects, so the
child receives an immediate sandbox error instead of an unexplained missing tool.
For existing children, the effective envelope is always clamped by both the
spawn-time permission ceiling and the parent's current permissions; explicit
parent changes take effect immediately and may later restore authority only up
to the original ceiling.
