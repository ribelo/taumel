import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

/**
 * Descriptor-anchored mutation primitives.
 *
 * Node's public filesystem API is pathname-based, so an attacker who can swap
 * an authorized ancestor directory for a symlink between the last identity
 * check and the pathname syscall can redirect a mutation outside the
 * authorized tree. This module closes that gap without a native addon: it
 * pins authorized directories as `FileHandle`s and addresses every mutation
 * syscall through `/proc/self/fd/<fd>/<name>`, which the kernel resolves
 * through the pinned inode regardless of later namespace changes. Symlink
 * swaps fail closed through `O_NOFOLLOW`; directory swaps stay inside the
 * pinned, authorized tree.
 *
 * The mechanism requires Linux with procfs and fails closed otherwise for
 * guarded workspace mutations. Unguarded callers (for example host settings
 * writes, which no sandboxed racer can reach) may opt into a legacy pathname
 * parent walk so non-Linux hosts keep working with the pre-existing
 * identity-check behavior.
 *
 * One irreducible limitation remains and is documented in ADR 0003: POSIX has
 * no compare-and-swap for the final directory entry, so a final component can
 * still be swapped within its pinned parent — but never outside it.
 */

export type FileIdentity = Readonly<{ dev: bigint; ino: bigint }>;
export type FileState = Readonly<{
  identity: FileIdentity;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}>;
export type BigintStatsLike = Readonly<{
  dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint;
}>;

type NodeError = { readonly code?: unknown };

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
}

export function identityMatches(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function stateMatches(left: FileState, right: FileState): boolean {
  return identityMatches(left.identity, right.identity)
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

export function fileStateFromStats(stats: BigintStatsLike): FileState {
  return {
    identity: { dev: stats.dev, ino: stats.ino }, size: stats.size,
    mtimeNs: stats.mtimeNs, ctimeNs: stats.ctimeNs,
  };
}

export async function pathIdentity(path: string): Promise<FileIdentity> {
  const stats = await lstat(path, { bigint: true });
  return { dev: stats.dev, ino: stats.ino };
}

export async function optionalPathIdentity(path: string): Promise<FileIdentity | undefined> {
  try {
    return await pathIdentity(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return undefined;
}

export class DescriptorPathUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Descriptor-anchored mutation requires Linux with procfs (/proc/self/fd)", { cause });
    this.name = "DescriptorPathUnavailableError";
  }
}

const pinnedDirectoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

export function descriptorPath(parent: FileHandle, name: string): string {
  return `/proc/self/fd/${parent.fd}/${name}`;
}

export async function openPinnedDirectory(path: string): Promise<FileHandle> {
  return await open(path, pinnedDirectoryFlags);
}

export async function openPinnedChildDirectory(parent: FileHandle, name: string): Promise<FileHandle> {
  return await open(descriptorPath(parent, name), pinnedDirectoryFlags);
}

async function probeDescriptorPaths(): Promise<void> {
  if (process.platform !== "linux") throw new DescriptorPathUnavailableError();
  let anchor: FileHandle | undefined;
  try {
    anchor = await openPinnedDirectory("/proc/self/fd");
    const roundTrip = await openPinnedChildDirectory(anchor, ".");
    await roundTrip.close();
  } catch (error) {
    if (error instanceof DescriptorPathUnavailableError) throw error;
    throw new DescriptorPathUnavailableError(error);
  } finally {
    await anchor?.close();
  }
}

let probeResult: Promise<void> | undefined;
let probeOverride: (() => Promise<void>) | undefined;

export function setDescriptorPathProbeOverrideForTests(override: (() => Promise<void>) | undefined): void {
  probeOverride = override;
}

export async function requireDescriptorPaths(): Promise<void> {
  if (probeOverride !== undefined) return await probeOverride();
  probeResult ??= probeDescriptorPaths();
  return await probeResult;
}

/**
 * A mutation's deepest ancestor, either pinned as a descriptor (guarded
 * default) or represented as a checked pathname (legacy fallback for
 * unguarded mutations on hosts without descriptor anchoring).
 */
export type MutationParentAnchor =
  | { readonly kind: "pinned"; readonly handle: FileHandle }
  | { readonly kind: "pathname"; readonly path: string };

export function anchoredEntryPath(anchor: MutationParentAnchor, name: string): string {
  return anchor.kind === "pinned" ? descriptorPath(anchor.handle, name) : join(anchor.path, name);
}

export async function closeMutationAnchor(anchor: MutationParentAnchor): Promise<void> {
  if (anchor.kind !== "pinned") return;
  try {
    await anchor.handle.close();
  } catch {
    // The mutation outcome is already decided; a close failure must not
    // redefine it (for example as an uncommitted write after a committed rename).
  }
}

export async function syncMutationAnchor(anchor: MutationParentAnchor): Promise<void> {
  try {
    if (anchor.kind === "pinned") {
      await anchor.handle.sync();
      return;
    }
    let handle: FileHandle | undefined;
    try {
      handle = await open(anchor.path, "r");
      await handle.sync();
    } finally {
      await handle?.close();
    }
  } catch {
    // Directory fsync is best-effort; some hosts/filesystems reject it, and a
    // sync failure must not redefine an already-committed mutation.
  }
}

/**
 * Legacy pathname parent walk for unguarded mutations where descriptor
 * anchoring is unavailable. Keeps the ancestor identity checks but performs
 * pathname syscalls, so it does not protect against a concurrent ancestor
 * swap; only callers outside the sandbox threat model may use it.
 */
export async function walkPathnameMutationParent(request: {
  readonly anchorPath: string;
  readonly anchorIdentity: FileIdentity;
  readonly components: readonly string[];
  readonly changedError: () => Error;
}): Promise<MutationParentAnchor> {
  let currentPath = request.anchorPath;
  let currentIdentity = request.anchorIdentity;
  for (const component of request.components) {
    if (!identityMatches(currentIdentity, await pathIdentity(currentPath))) {
      throw request.changedError();
    }
    const nextPath = join(currentPath, component);
    try {
      await mkdir(nextPath);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const stats = await lstat(nextPath, { bigint: true });
    if (!stats.isDirectory()) {
      throw new Error(`Mutation path ancestor is not a directory: ${nextPath}`);
    }
    currentPath = nextPath;
    currentIdentity = { dev: stats.dev, ino: stats.ino };
  }
  return { kind: "pathname", path: currentPath };
}
