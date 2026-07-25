# Plans: an executable task list replaces the objective-centric goal

Every harness we surveyed ships a task or todo tool disconnected from its
continuation machinery: Codex renders `update_plan` cosmetically and stores
nothing; Claude Code and Kimi inject stale-task reminders but never gate
completion; Zenith gates completion, but inside a heavyweight multi-agent
mission harness. Taumel already owned the missing half — the goal continuation
loop that refuses to let the agent stop early. This decision connects the two
halves and, in doing so, dissolves the goal/objective concept into a single
one: the **plan**.

A plan is an ordered task list with a lifecycle. A task carries a `task-`
identity, a title, an optional description, a status (`pending`, `in_progress`,
`completed`, `cancelled`), `depends_on` edges, and an `origin` (`user` or
`agent`). What the old model called an objective-only goal is now a plan with
one task; a task's text is that task's objective. Every special case that the
two-concept model accumulated — objective immutability, objective late-fill,
birth-with-tasks, objective-less goals — was an artifact of having two
concepts and is gone.

The coupling is what makes tasks more than decoration. The stop-time
continuation carries the unfinished tasks as untrusted JSON with
runnable/waiting marks derived from `depends_on`, and `update_plan complete` is
rejected while any task remains pending or in progress, with `cancelled` as
the honest escape hatch. Dependencies reference existing or same-call task
identities, cycles are rejected at write time, and a task cannot enter
`in_progress` while a task it depends on is unfinished. There is no limit on
concurrent in-progress tasks, because the agent may pursue several through
spawned subagents; the tasks themselves remain session-local and are never
exposed to those subagents.

Unification handed the agent control of the loop's termination condition —
it edits the very list the continuation pursues — which admits two failure
modes: never terminating (adding tasks forever) and scope drift (rewriting the
contract it is policed against). The control is the lifecycle itself, not a
flag. Editability is a pure mapping of status: the plan is editable while
`draft` and frozen in every other status. The agent drafts in `draft` status —
creating, editing, and cancelling its own tasks freely — and commits by
activating; continuation runs only while `active`. While active the agent may
change task statuses but cannot touch content, so the executed list is exactly
the committed list. Only the user returns a plan to `draft`, so revision of
a running plan is always a user-gated act; `paused` suspends execution without
opening edits, and automation interruption never touches lifecycle status. User-authored task text and
cancellation are reserved to the user in every status, which preserves the old
objective immutability one level down and closes the cancel-everything-then-
complete gaming hole; the user may still append tasks in any status.

The name is "plan" because the object's definition is its task list: "goal"
named the discarded objective-centric model, and the ecosystem's cosmetic
plan tools are precisely what this one is not. The rename is total — record,
tools, command, session entry, requirement identifiers — and legacy
`taumel.goal` entries are rejected with a non-fatal diagnostic rather than
migrated.

Consequences: agent autonomy exists at plan time (draft freely) and execution
time (status transitions) but not at run time (no new scope mid-flight);
the user gains sovereign append and unfreeze powers plus a modal task browser,
since people should not have to type task identities to edit a list; the model
reads all state through `get_plan` alone; and a frozen plan is finite work,
which bounds unattended continuation without a separate budget mechanism.
