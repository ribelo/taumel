# Inject reviewer criteria as a skill

A reviewer specialist owns its identity, scope anchoring, and output discipline in
its prompt resource, while its review criteria live in an ordinary skill that the
skill resolver injects into the child conversation before the caller's review
request. This keeps three concerns in one home each: the criteria in a skill the
user edits without a Taumel release, the reviewer in a Taumel agent kind, and the
choice of when to review in the calling agent. It also reuses the existing
expansion mechanism instead of adding a second one, because one agent instruction
now produces the same host-effect plan as one user prompt. The cost is a
start-time dependency on a discoverable skill, so a reviewer start resolves its
rubric before it creates any identity, run, worktree, or child session and fails
with `rubric_unavailable` naming the missing skill; a reviewer must never run
without its criteria. Two alternatives were rejected: embedding the criteria in
the prompt resource, which ties every criteria change to a Taumel release and
duplicates shared criteria across kinds, and pasting diffs or criteria into the
dispatch message, which inflates context and lets the reviewed material drift
from the repository the reviewer can read for itself. The injected rubric stays
child context only: it is never returned to the parent and never rendered in the
parent's reviewer tool slot.
