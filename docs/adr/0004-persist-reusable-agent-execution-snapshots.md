# Persist reusable agent execution snapshots

Taumel persists each durable agent identity's complete resolved execution
snapshot, including its system prompt, because a lost child runtime cannot be
recreated faithfully from metadata alone. This deliberately stores the resolved
prompt in `taumel.agents`, but does not store run submissions, outputs,
transcripts, reasoning, or tool logs; reloading current profile files was rejected
because it would silently change an existing identity after resume, and refusing
all post-resume reuse would contradict durable identity semantics. The persisted
permission envelope is the identity's spawn-time maximum, not irrevocable live
authority: every child side effect is also clamped by the parent's current
permissions, so explicit revocation and restoration take effect without granting
more than the snapshot originally allowed.
