# Bind agent identities to their spawn-time workspaces

An agent identity keeps an immutable workspace binding in its spawn-time
execution snapshot, because changing repositories underneath a durable identity
would make its retained context, sandbox roots, and mutation targets misleading.
If that workspace disappears, a later run fails clearly and the identity remains
open; Taumel never silently rebinds it to the parent's current directory, so the
user must close it and spawn a new identity for another workspace.
