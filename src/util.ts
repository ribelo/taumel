import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { appendFile, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, rmdir, symlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type {
  ChildSessionBridge,
  CoreBridge,
  PiLike,
  SessionInfo,
} from "./types.ts";
import {
  decodeThreadCatalogScansResult,
  decodeChildSessionStartPlan,
  decodeSandboxHostPathPlan,
  decodeWorkspaceMutationValidation,
  decodeToolNamesResult,
  type ThreadCatalogFacts,
  type ThreadCatalogScan,
  type ChildSessionStartPlan,
  type ChildSessionMetadata,
  type SandboxHostPathPlan,
  type PreparedToolAction,
  type WorkspaceMutationFacts,
} from "./bridge-contracts.ts";

type WorkspaceMetadataListing = { readonly metadataDir: string; readonly path: string; readonly children?: string[] };
type ExecHostFacts = {
  readonly platform: string; readonly tempRoots: string[]; readonly systemRoPaths: string[];
  readonly homeMount: string; readonly workspaceRoots: string[];
  readonly workspaceMetadataListings: WorkspaceMetadataListing[];
};
type ThreadSource =
  | { readonly kind: "sessionFile"; readonly path: string; readonly text: string }
  | { readonly kind: "diagnostic"; readonly path: string; readonly error: string };
type NodeError = { readonly code?: unknown };

function objectValue(value: unknown): object | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function property(source: object, name: string): unknown {
  return Reflect.get(source, name);
}

export function stringFieldOrUndefined(source: object, name: string): string | undefined {
  const value = property(source, name);
  return typeof value === "string" ? value : undefined;
}
export function numberFieldOrUndefined(source: object, name: string): number | undefined {
  const value = property(source, name);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function boolFieldOrUndefined(source: object, name: string): boolean | undefined {
  const value = property(source, name);
  return typeof value === "boolean" ? value : undefined;
}
export function recordFieldOrUndefined<T extends object = object>(source: object, name: string): T | undefined {
  return objectValue(property(source, name)) as T | undefined;
}
export function stringArrayFieldOrUndefined(source: object, name: string): string[] | undefined {
  const value = property(source, name);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}
export function stringArrayFieldOrEmpty(source: object, name: string): string[] {
  return stringArrayFieldOrUndefined(source, name) ?? [];
}
export function stringArrayField(source: object, name: string): string[] {
  const value = property(source, name);
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) throw new Error(`Invalid Taumel string array field: ${name}`);
  return value;
}
export function recordArrayFieldOrUndefined<T extends object = object>(source: object, name: string): T[] | undefined {
  const value = property(source, name);
  if (!Array.isArray(value)) return undefined;
  const records: T[] = [];
  for (const item of value) {
    const record = objectValue(item);
    if (record !== undefined) records.push(record as T);
  }
  return records;
}
export function recordArrayFieldOrEmpty<T extends object = object>(source: object, name: string): T[] {
  return recordArrayFieldOrUndefined<T>(source, name) ?? [];
}
export function contextWithOverrides(ctx: unknown, overrides: object): object {
  const context = objectValue(ctx);
  return context === undefined ? overrides : { ...context, ...overrides };
}
export function maybeCall(receiver: unknown, name: string, args: readonly unknown[] = []): unknown {
  const target = objectValue(receiver);
  if (target === undefined) return undefined;
  const method = property(target, name);
  return typeof method === "function" ? method.apply(receiver, args) : undefined;
}

export function isStaleContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ctx is stale") ||
    message.includes("This extension ctx is stale after session replacement or reload");
}

export function contextIsLive(ctx: unknown): boolean {
  try {
    const sessionManager = objectValue(ctx) === undefined ? undefined : property(ctx as object, "sessionManager");
    const manager = objectValue(sessionManager);
    if (manager === undefined) return true;
    const getSessionId = property(manager, "getSessionId");
    if (typeof getSessionId === "function") {
      getSessionId.call(sessionManager);
      return true;
    }
    const getSessionFile = property(manager, "getSessionFile");
    if (typeof getSessionFile === "function") {
      getSessionFile.call(sessionManager);
    }
    return true;
  } catch (error) {
    if (isStaleContextError(error)) return false;
    throw error;
  }
}

export function extensionRuntimeIsLive(pi: PiLike): boolean {
  try {
    if (typeof pi.getFlag === "function") {
      pi.getFlag("__taumel_liveness_probe__");
      return true;
    }
    if (typeof pi.getThinkingLevel === "function") {
      pi.getThinkingLevel();
      return true;
    }
    if (typeof pi.getActiveTools === "function") {
      pi.getActiveTools();
    }
    return true;
  } catch (error) {
    if (isStaleContextError(error)) return false;
    throw error;
  }
}

export function stringFromMethod(receiver: unknown, name: string): string | undefined {
  const target = objectValue(receiver);
  if (target === undefined) return undefined;
  const method = property(target, name);
  if (typeof method !== "function") return undefined;
  try {
    const value = method.call(receiver);
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function sessionInfoFromManager(sessionManager: unknown): SessionInfo {
  return {
    sessionId: stringFromMethod(sessionManager, "getSessionId"),
    sessionFile: stringFromMethod(sessionManager, "getSessionFile"),
  };
}

export function sessionInfoFromContext(ctx: unknown): SessionInfo {
  const context = objectValue(ctx);
  return context === undefined ? {} : sessionInfoFromManager(property(context, "sessionManager"));
}

export function cwdFromContext(ctx: unknown): string {
  const context = objectValue(ctx);
  const cwd = context === undefined ? undefined : property(context, "cwd");
  return typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export function isProjectTrusted(ctx: unknown): boolean {
  const context = objectValue(ctx) as { readonly isProjectTrusted?: () => unknown } | undefined;
  const trusted = context?.isProjectTrusted;
  return typeof trusted === "function" && trusted.call(ctx) === true;
}

export function splitProviderModelId(modelId: string | undefined): { readonly provider: string; readonly model: string } | undefined {
  if (modelId === undefined) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1) return undefined;
  return { provider: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
}

export function childBridgeFacts(bridge: ChildSessionBridge | undefined) {
  if (!bridge) return { available: false };
  return {
    available: true,
    cancelled: bridge.cancelled === true,
    ...(bridge.sessionId === undefined ? {} : { sessionId: bridge.sessionId }),
    ...(bridge.sessionFile === undefined ? {} : { sessionFile: bridge.sessionFile }),
    ...(bridge.error === undefined ? {} : { error: bridge.error }),
    missingSessionIdentifier: bridge.missingSessionIdentifier === true,
    ...(bridge.activeTools === undefined ? {} : { activeTools: [...bridge.activeTools] }),
    activeToolsApplied: bridge.activeToolsApplied === true,
    ...(bridge.modelId === undefined ? {} : { modelId: bridge.modelId }),
    modelApplied: bridge.modelApplied === true,
    ...(bridge.thinkingLevel === undefined ? {} : { thinkingLevel: bridge.thinkingLevel }),
    thinkingApplied: bridge.thinkingApplied === true,
  };
}

export function stringFlag(pi: PiLike, name: string): string | undefined {
  const value = typeof pi.getFlag === "function" ? pi.getFlag(name) : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function modelRegistryFrom(pi: PiLike, ctx: unknown): unknown {
  const context = objectValue(ctx);
  const registry = context === undefined ? undefined : property(context, "modelRegistry");
  if (registry !== undefined) return registry;
  return pi.modelRegistry;
}

export function liveToolNames(pi: PiLike, builtins: readonly string[]): string[] {
  const names = new Set<string>(builtins);
  if (typeof pi.getAllTools === "function") {
    for (const tool of pi.getAllTools()) {
      if (typeof tool === "string" && tool !== "") {
        names.add(tool);
        continue;
      }
      const value = objectValue(tool);
      const name = value === undefined ? undefined : property(value, "name");
      if (typeof name === "string" && name !== "") names.add(name);
    }
  }
  return [...names];
}

export function openAiCredentialRaw(registry: unknown, credentialKey: string): unknown {
  const target = objectValue(registry);
  if (target === undefined) return undefined;
  const authStorage = property(target, "authStorage");
  return maybeCall(authStorage, "get", [credentialKey]);
}

export async function openAiUsageTokenRaw(registry: unknown, providerKey: string): Promise<string> {
  const value = await maybeCall(registry, "getApiKeyForProvider", [providerKey]);
  return typeof value === "string" ? value : "";
}

export function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function existingPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  });
}

export function sandboxStringArrayField(sandbox: unknown, name: string): string[] {
  const config = objectValue(sandbox);
  if (config === undefined) throw new Error("Invalid Taumel sandbox config");
  return stringArrayField(config, name).filter((value) => value !== "");
}

export function sandboxMetadataDirNames(core: CoreBridge): string[] {
  return [...decodeToolNamesResult(core.call("sandboxMetadataDirNames", [])).names];
}

export function sandboxHostPathPlan(core: CoreBridge): SandboxHostPathPlan {
  return decodeSandboxHostPathPlan(core.call("sandboxHostPathPlan", [{
    tmpDir: tmpdir(),
    envTmpDir: process.env["TMPDIR"] ?? "",
  }]));
}

export function workspaceMetadataListings(
  core: CoreBridge,
  workspaceRoots: readonly string[],
): WorkspaceMetadataListing[] {
  const metadataDirNames = sandboxMetadataDirNames(core);
  const listings: WorkspaceMetadataListing[] = [];
  for (const root of workspaceRoots) {
    const normalizedRoot = root.replace(/\/+$/, "");
    for (const metadataDir of metadataDirNames) {
      const path = `${normalizedRoot}/${metadataDir}`;
      if (!existsSync(path)) continue;
      try {
        listings.push({ metadataDir, path, children: readdirSync(path) });
      } catch {
        listings.push({ metadataDir, path });
      }
    }
  }
  return listings;
}

export function execHostFacts(
  core: CoreBridge,
  prepared: Extract<PreparedToolAction, { action: "exec_command" }>,
): ExecHostFacts {
  const sandbox = prepared.sandbox;
  const hostPathPlan = sandboxHostPathPlan(core);
  const workspaceRoots = existingPaths(sandboxStringArrayField(sandbox, "workspaceRoots").map(realpathOrSelf));
  const home = realpathOrSelf(homedir());
  const homeParent = dirname(home);
  const homeMount = homeParent !== "/" && existsSync(homeParent) ? homeParent : home;
  return {
    platform: process.platform,
    tempRoots: existingPaths(hostPathPlan.tempRootCandidates.map(realpathOrSelf)),
    systemRoPaths: existingPaths(hostPathPlan.systemRoPathCandidates),
    homeMount,
    workspaceRoots,
    workspaceMetadataListings: workspaceMetadataListings(core, workspaceRoots),
  };
}

export function childSessionStartPlan(
  core: CoreBridge,
  metadata: ChildSessionMetadata,
  parent: SessionInfo,
): ChildSessionStartPlan {
  return decodeChildSessionStartPlan(core.call("planChildSessionStart", [{ metadata,
    parentSessionId: parent.sessionId ?? "",
    parentSessionFile: parent.sessionFile ?? "",
  }]));
}

export function setActiveToolsOn(receiver: unknown, toolNames: readonly string[]): boolean {
  const target = objectValue(receiver);
  if (target === undefined) return false;
  for (const methodName of ["setActiveToolsByName", "setActiveTools"]) {
    const method = property(target, methodName);
    if (typeof method !== "function") continue;
    method.call(receiver, [...toolNames]);
    return true;
  }
  return false;
}

export function applyChildActiveTools(ctx: unknown, toolNames: readonly string[]): boolean {
  if (setActiveToolsOn(ctx, toolNames)) return true;
  const context = objectValue(ctx);
  if (context !== undefined && setActiveToolsOn(property(context, "sessionManager"), toolNames)) return true;
  return false;
}

export async function discoverCatalogFiles(scan: ThreadCatalogScan): Promise<string[]> {
  const { root, maxDepth, maxFiles, suffix } = scan;
  const files: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (files.length >= maxFiles || depth < 0) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path, depth - 1);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        files.push(path);
      }
    }
  }
  await visit(root, maxDepth);
  return files;
}

export function threadCatalogFacts(ctx: unknown): ThreadCatalogFacts {
  const context = objectValue(ctx);
  const cwd = context === undefined ? undefined : property(context, "cwd");
  return {
    cwd: typeof cwd === "string" ? cwd : "",
    home: homedir(),
  };
}

export function sessionCatalogScans(core: CoreBridge, ctx: unknown): ThreadCatalogScan[] {
  return [...decodeThreadCatalogScansResult(
    core.call("planThreadCatalogScans", [threadCatalogFacts(ctx)]),
  ).scans];
}

export async function fileThreadSources(core: CoreBridge, ctx: unknown): Promise<ThreadSource[]> {
  const sources: ThreadSource[] = [];
  for (const scan of sessionCatalogScans(core, ctx)) {
    for (const file of await discoverCatalogFiles(scan)) {
      try {
        sources.push({
          kind: "sessionFile",
          path: file,
          text: await readFile(file, "utf8"),
        });
      } catch (error) {
        sources.push({
          kind: "diagnostic",
          path: file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return sources;
}

export async function threadSources(core: CoreBridge, ctx: unknown): Promise<ThreadSource[]> {
  return await fileThreadSources(core, ctx);
}

async function syncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Directory fsync is best-effort; some hosts/filesystems reject it.
  } finally {
    await handle?.close();
  }
}

export async function appendToFile(path: string, contents: string): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  await appendFile(path, contents, "utf8");
}

async function writeDataAtomically(path: string, contents: string | Uint8Array): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(tempPath, "w");
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, path);
    await syncDirectory(parent);
  } catch (error) {
    await handle?.close();
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function writeFileAtomically(path: string, contents: string): Promise<void> {
  await writeDataAtomically(path, contents);
}

type PatchWrite = {
  path: string;
  contents: string;
};
type PatchApplication = { readonly deletes: readonly string[]; readonly writes: readonly PatchWrite[] };

type PatchFileSnapshot =
  | { kind: "missing" }
  | { kind: "file"; contents: Uint8Array }
  | { kind: "symlink"; target: string }
  | { kind: "other" };

async function snapshotPatchFile(path: string): Promise<PatchFileSnapshot> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return { kind: "symlink", target: await readlink(path) };
    if (stats.isFile()) return { kind: "file", contents: await readFile(path) };
    return { kind: "other" };
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
    if (code === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

function missingParentDirs(path: string): string[] {
  const dirs: string[] = [];
  let parent = dirname(path);
  while (parent !== "." && parent !== "/" && !existsSync(parent)) {
    dirs.push(parent);
    parent = dirname(parent);
  }
  return dirs.reverse();
}

async function restorePatchFile(path: string, snapshot: PatchFileSnapshot): Promise<void> {
  switch (snapshot.kind) {
    case "missing":
      await rm(path, { force: true });
      return;
    case "file":
      await writeDataAtomically(path, snapshot.contents);
      return;
    case "symlink":
      await rm(path, { force: true });
      await mkdir(dirname(path), { recursive: true });
      await symlink(snapshot.target, path);
      await syncDirectory(dirname(path));
      return;
    case "other":
      return;
  }
}

async function rollbackPatchFiles(
  snapshots: Map<string, PatchFileSnapshot>,
  createdParentDirs: string[],
): Promise<void> {
  for (const [path, snapshot] of snapshots) {
    try {
      await restorePatchFile(path, snapshot);
    } catch {
      // Keep rollback best-effort so the original filesystem error remains visible.
    }
  }
  for (const dir of createdParentDirs.sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(dir);
    } catch {
      // Parent directories are removed only when they are still empty.
    }
  }
}

export async function writePatchFiles(application: PatchApplication): Promise<void> {
  const deletes = application.deletes;
  const parsedWrites = application.writes;
  if (deletes.some((path) => typeof path !== "string") || parsedWrites.some((write) =>
    typeof write !== "object" || write === null || typeof write.path !== "string" || write.path === "" || typeof write.contents !== "string"
  )) throw new Error("Invalid Taumel apply_patch result");

  const snapshots = new Map<string, PatchFileSnapshot>();
  for (const write of parsedWrites) {
    if (!snapshots.has(write.path)) snapshots.set(write.path, await snapshotPatchFile(write.path));
  }
  for (const path of deletes) {
    if (!snapshots.has(path)) snapshots.set(path, await snapshotPatchFile(path));
  }
  const createdParentDirs: string[] = [];
  const seenParentDirs = new Set<string>();
  for (const write of parsedWrites) {
    for (const dir of missingParentDirs(write.path)) {
      if (seenParentDirs.has(dir)) continue;
      seenParentDirs.add(dir);
      createdParentDirs.push(dir);
    }
  }

  try {
    for (const write of parsedWrites) {
      await writeFileAtomically(write.path, write.contents);
    }
    for (const path of deletes) {
      await rm(path, { force: true });
    }
  } catch (error) {
    await rollbackPatchFiles(snapshots, createdParentDirs);
    throw error;
  }
}

async function resolveRealPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
    if (code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    const resolvedParent = await resolveRealPath(parent);
    return `${resolvedParent}/${basename(path)}`;
  }
}

async function resolvedWorkspaceMutationPathFacts(
  paths: readonly string[],
  workspaceRoots: readonly string[],
): Promise<WorkspaceMutationFacts> {
  const resolvedRoots = await Promise.all(
    workspaceRoots.map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return root;
      }
    }),
  );
  const resolvedPaths = await Promise.all(
    paths.map(async (path) => ({ path, resolvedPath: await resolveRealPath(path) })),
  );
  return { workspaceRoots: resolvedRoots, paths: resolvedPaths };
}

export async function validateWorkspaceMutationPaths(
  core: CoreBridge,
  paths: readonly string[],
  workspaceRoots: readonly string[],
): Promise<void> {
  const result = decodeWorkspaceMutationValidation(core.call("validateWorkspaceMutationPaths", [
    await resolvedWorkspaceMutationPathFacts(paths, workspaceRoots),
  ]));
  if (result.kind === "invalid") throw new Error(result.message);
}
