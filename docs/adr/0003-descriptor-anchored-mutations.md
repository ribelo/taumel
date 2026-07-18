# Anchor mutation syscalls to authorized ancestor descriptors

Taumel's mutation guarantee (sandbox-w54h) previously rested on pathname
identity checks performed immediately before each mutation syscall. A
concurrent process able to rename within an authorized workspace — including a
sandboxed `exec_command` session, which holds the workspace read-write and
stays alive across tool calls by design — could swap a validated ancestor for
an outside-pointing symlink in the gap between the last check and the
pathname-based `open`, `rename`, or `unlink`, redirecting host mutations
outside the workspace. This was reproduced end to end, so the gap was a
practical sandbox-boundary escape, not a theoretical one. Node's public
filesystem API exposes no `openat`/`renameat`/`unlinkat`, and a native addon is
not an option because Pi extensions must remain pure JavaScript.

Taumel therefore pins authorized ancestor directories as `FileHandle`s and
addresses every mutation syscall through `/proc/self/fd/<fd>/<name>`, which the
kernel resolves through the pinned inode regardless of later namespace changes
(`src/descriptor-paths.ts`, used by `src/util.ts` for append, atomic
write/rename, authorized reads, patch deletes, and rollback). An ancestor
swapped for a symlink fails closed through `O_NOFOLLOW`, and an ancestor
swapped for another directory keeps the mutation inside the pinned, authorized
tree. Reads are anchored as well as writes, closing the equivalent
exfiltration channel. Recursive host deletion (private child-session cleanup
and trusted-worktree removal, `bin/agent_anchored_fs.ml`) canonicalizes the
target's parent and then walks from the filesystem root with
`O_NOFOLLOW|O_DIRECTORY` opens per component, so even ancestors above the
validated envelope cannot redirect deletion into a symlinked outside tree;
symlink entries inside a payload are unlinked, never traversed. The mechanism
requires Linux with procfs; anywhere else, guarded workspace mutations fail
closed (sandbox-fx9n) rather than silently falling back to the vulnerable
pathname path, extending the sandbox's existing Linux-only execution posture
(sandbox-bw06) to mutation.

Two scope decisions qualify that posture. First, mutations that no sandboxed
racer can reach — host settings writes such as Pi/Taumel settings, exec-policy
rules, and compaction model config — may opt into a legacy pathname parent
walk so non-Linux hosts keep working; their identity checks remain, but they
are outside the sandbox threat model and carry no confinement guarantee.
Second, post-commit bookkeeping must never redefine an outcome: directory
sync and anchor close are best-effort, and any verification failure after a
successful rename is classified as committed so patch rollback journals it
instead of leaving an unjournalied replacement behind.

One irreducible residual remains. POSIX offers no compare-and-swap for the
final directory entry, so between the last target-state check and the syscall
a final component can still be swapped within its pinned parent. For append
and authorized read the opened descriptor's `fstat` still rejects a stale
target before any byte is transferred. For rename and unlink there is no
opened target descriptor, so the operation can overwrite or delete a
replacement entry — but only inside the pinned, authorized directory, never
outside it: a swapped-in symlink's entry is replaced or removed without being
followed, and a swapped-in hardlink loses at most its inside alias. Confinement
(sandbox-w54h) is therefore absolute, while final-entry identity stability is
detection-based and best-effort, which is why the requirement is phrased as
failing on detected identity changes rather than promising no change can
occur.
