# Keep one loaded-session state

Taumel keeps one in-memory projection for Pi's currently active main session
instead of maintaining owner-keyed maps for every component and visited session.
This matches Pi's single-active-session interaction model and keeps the
extension simple; only asynchronous resources that can outlive a call carry an
explicit parent-session owner, while stale contexts fail closed. A live child
also carries its owner's latest permission envelope because it may continue
after another main session is loaded; this resource-local authorization state is
not a second session-state cache and can never be replaced by permissions from
the newly loaded session. Interactive approval is likewise owner-scoped: a child
whose parent is unloaded receives an `approval_unavailable` denial rather than
displaying a cross-session prompt or waiting indefinitely for a reload.
