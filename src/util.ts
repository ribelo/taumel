import { randomUUID } from "node:crypto";
import { constants, existsSync, readdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import {
  anchoredEntryPath,
  closeMutationAnchor,
  descriptorPath,
  fileStateFromStats,
  identityMatches,
  openPinnedChildDirectory,
  openPinnedDirectory,
  optionalPathIdentity,
  requireDescriptorPaths,
  stateMatches,
  syncMutationAnchor,
  walkPathnameMutationParent,
  type FileIdentity,
  type FileState,
  type MutationParentAnchor,
} from "./descriptor-paths.ts";
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
  readonly homeMount: string; readonly workspaceRoots: string[]; readonly authorizationCwd: string;
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

export function resolveAuthorizationPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
    if (code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(resolveAuthorizationPath(parent), basename(path));
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

function existingRealPaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  for (const path of paths) {
    const resolved = realpathOrSelf(path);
    try {
      if (existsSync(resolved)) result.push(resolved);
    } catch {
      // Ignore invalid or inaccessible host paths, matching existingPaths.
    }
  }
  return result;
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
  const workspaceRoots = existingRealPaths(sandboxStringArrayField(sandbox, "workspaceRoots"));
  const home = realpathOrSelf(homedir());
  const homeParent = dirname(home);
  const homeMount = homeParent !== "/" && existsSync(homeParent) ? homeParent : home;
  return {
    platform: process.platform,
    tempRoots: existingRealPaths(hostPathPlan.tempRootCandidates),
    systemRoPaths: existingPaths(hostPathPlan.systemRoPathCandidates),
    homeMount,
    workspaceRoots,
    authorizationCwd: resolveAuthorizationPath(prepared.workdir),
    workspaceMetadataListings: workspaceMetadataListings(core, workspaceRoots),
  };
}

export function childSessionStartPlan(
  core: CoreBridge,
  metadata: ChildSessionMetadata,
  parent: SessionInfo,
  ctx?: unknown,
): ChildSessionStartPlan {
  return decodeChildSessionStartPlan(core.call("planChildSessionStart", [{ metadata,
    parentSessionId: parent.sessionId ?? "",
    parentSessionFile: parent.sessionFile ?? "",
  }, ctx]));
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
  return fileThreadSources(core, ctx);
}

export type MutationPathAuthorization = Readonly<{
  path: string;
  resolvedPath: string;
  anchorPath: string;
  anchorIdentity: FileIdentity;
  targetState?: FileState;
}>;

function mutationChangedError(authorization: MutationPathAuthorization): Error {
  return new Error(`Mutation path changed after authorization: ${authorization.path}`);
}

async function optionalFileState(path: string): Promise<FileState | undefined> {
  try {
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile()) throw new Error(`Mutation target is not a regular file: ${path}`);
    return fileStateFromStats(stats);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

async function existingPathAnchor(path: string): Promise<Readonly<{ path: string; identity: FileIdentity }>> {
  let candidate = dirname(path);
  while (true) {
    const identity = await optionalPathIdentity(candidate);
    if (identity !== undefined) {
      const stats = await lstat(candidate, { bigint: true });
      if (!stats.isDirectory()) throw new Error(`Mutation path ancestor is not a directory: ${candidate}`);
      return { path: candidate, identity };
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`No existing ancestor for mutation path: ${path}`);
    candidate = parent;
  }
}

async function captureMutationPathAuthorization(path: string): Promise<MutationPathAuthorization> {
  const resolvedPath = await resolveRealPath(path);
  const anchor = await existingPathAnchor(resolvedPath);
  return {
    path,
    resolvedPath,
    anchorPath: anchor.path,
    anchorIdentity: anchor.identity,
    targetState: await optionalFileState(resolvedPath),
  };
}

export async function authorizeMutationPaths(
  paths: readonly string[],
): Promise<MutationPathAuthorization[]> {
  return await Promise.all(paths.map(captureMutationPathAuthorization));
}

export async function authorizeCanonicalMutationPaths(
  paths: readonly string[],
): Promise<MutationPathAuthorization[]> {
  const authorizations = await authorizeMutationPaths(paths);
  for (const authorization of authorizations) {
    if (authorization.resolvedPath !== authorization.path) {
      throw new Error(`Mutation path changed after authorization: ${authorization.path}`);
    }
  }
  return authorizations;
}

async function assertMutationPathAuthorization(
  authorization: MutationPathAuthorization,
): Promise<void> {
  const currentResolvedPath = await resolveRealPath(authorization.path);
  const currentAnchorIdentity = await optionalPathIdentity(authorization.anchorPath);
  const currentTargetState = await optionalFileState(authorization.resolvedPath);
  const targetMatches = authorization.targetState === undefined
    ? currentTargetState === undefined
    : currentTargetState !== undefined && stateMatches(authorization.targetState, currentTargetState);
  if (
    currentResolvedPath !== authorization.resolvedPath
    || currentAnchorIdentity === undefined
    || !identityMatches(authorization.anchorIdentity, currentAnchorIdentity)
    || !targetMatches
  ) {
    throw new Error(`Mutation path changed after authorization: ${authorization.path}`);
  }
}

async function optionalAnchoredFileState(
  parent: MutationParentAnchor,
  name: string,
  displayPath: string,
): Promise<FileState | undefined> {
  try {
    const stats = await lstat(anchoredEntryPath(parent, name), { bigint: true });
    if (!stats.isFile()) throw new Error(`Mutation target is not a regular file: ${displayPath}`);
    return fileStateFromStats(stats);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

async function anchorMutationParent(
  authorization: MutationPathAuthorization,
  allowPathnameFallback: boolean,
): Promise<MutationParentAnchor> {
  let pinned: boolean;
  try {
    await requireDescriptorPaths();
    pinned = true;
  } catch (error) {
    if (!allowPathnameFallback) throw error;
    pinned = false;
  }
  await assertMutationPathAuthorization(authorization);
  const parent = dirname(authorization.resolvedPath);
  const suffix = relative(authorization.anchorPath, parent);
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) {
    throw mutationChangedError(authorization);
  }
  const components = suffix.split(/[\\/]/u).filter(Boolean);
  if (!pinned) {
    return await walkPathnameMutationParent({
      anchorPath: authorization.anchorPath,
      anchorIdentity: authorization.anchorIdentity,
      components,
      changedError: () => mutationChangedError(authorization),
    });
  }
  let current: FileHandle | undefined = await openPinnedDirectory(authorization.anchorPath);
  try {
    const anchorStats = await current.stat({ bigint: true });
    if (!identityMatches(authorization.anchorIdentity, { dev: anchorStats.dev, ino: anchorStats.ino })) {
      throw mutationChangedError(authorization);
    }
    for (const component of components) {
      const handle = current;
      current = undefined;
      try {
        let next: FileHandle;
        try {
          next = await openPinnedChildDirectory(handle, component);
        } catch (error) {
          const code = typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
          if (code !== "ENOENT") throw error;
          try {
            await mkdir(descriptorPath(handle, component));
          } catch (mkdirError) {
            const mkdirCode = typeof mkdirError === "object" && mkdirError !== null
              ? (mkdirError as NodeError).code : undefined;
            if (mkdirCode !== "EEXIST") throw mkdirError;
          }
          next = await openPinnedChildDirectory(handle, component);
        }
        current = next;
      } finally {
        await handle.close();
      }
    }
    const anchored = current;
    current = undefined;
    return { kind: "pinned", handle: anchored };
  } finally {
    await current?.close();
  }
}

export async function appendToFile(
  authorization: MutationPathAuthorization,
  contents: string,
): Promise<void> {
  const parent = await anchorMutationParent(authorization, false);
  try {
    const handle = await open(
      anchoredEntryPath(parent, basename(authorization.resolvedPath)),
      constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW
        | (authorization.targetState === undefined ? constants.O_CREAT | constants.O_EXCL : 0),
      0o666,
    );
    try {
      const openedStats = await handle.stat({ bigint: true });
      if (
        authorization.targetState !== undefined
        && (!openedStats.isFile() || !stateMatches(authorization.targetState, fileStateFromStats(openedStats)))
      ) throw mutationChangedError(authorization);
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
  } finally {
    await closeMutationAnchor(parent);
  }
}

export async function readAuthorizedFile(
  authorization: MutationPathAuthorization,
  allowPathnameFallback = false,
): Promise<Readonly<{ contents: Uint8Array; authorization: MutationPathAuthorization }>> {
  if (authorization.targetState === undefined) {
    throw new Error(`Mutation target does not exist: ${authorization.path}`);
  }
  const parent = await anchorMutationParent(authorization, allowPathnameFallback);
  try {
    const handle = await open(
      anchoredEntryPath(parent, basename(authorization.resolvedPath)),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
    const beforeStats = await handle.stat({ bigint: true });
    const before = fileStateFromStats(beforeStats);
    if (!beforeStats.isFile() || !stateMatches(authorization.targetState, before)) {
      throw new Error(`Mutation path changed after authorization: ${authorization.path}`);
    }
    const contents = await handle.readFile();
    const afterStats = await handle.stat({ bigint: true });
    const after = fileStateFromStats(afterStats);
    if (!afterStats.isFile() || !stateMatches(before, after)) {
      throw new Error(`Mutation target changed while reading: ${authorization.path}`);
    }
      return { contents, authorization: { ...authorization, targetState: after } };
    } finally {
      await handle.close();
    }
  } finally {
    await closeMutationAnchor(parent);
  }
}

export async function readJsonObjectForAtomicUpdate(
  path: string,
  allowPathnameFallback = false,
): Promise<Readonly<{
  settings: { [key: string]: unknown };
  authorization: MutationPathAuthorization;
}>> {
  const authorization = await captureMutationPathAuthorization(path);
  if (authorization.targetState === undefined) return { settings: {}, authorization };
  const read = await readAuthorizedFile(authorization, allowPathnameFallback);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(read.contents)) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return { settings: parsed as { [key: string]: unknown }, authorization: read.authorization };
}

async function writeDataAtomically(
  authorization: MutationPathAuthorization,
  contents: string | Uint8Array,
  allowPathnameFallback: boolean,
): Promise<MutationPathAuthorization> {
  const target = authorization.resolvedPath;
  const name = basename(target);
  const parent = await anchorMutationParent(authorization, allowPathnameFallback);
  const tempName = `.${name}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  let tempState: FileState | undefined;
  try {
    handle = await open(
      anchoredEntryPath(parent, tempName),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o666,
    );
    await handle.writeFile(contents);
    await handle.sync();
    tempState = fileStateFromStats(await handle.stat({ bigint: true }));
    await handle.close();
    handle = undefined;
    await assertMutationPathAuthorization(authorization);
    const currentTempState = await optionalAnchoredFileState(parent, tempName, target);
    if (currentTempState === undefined || !stateMatches(tempState, currentTempState)) {
      throw mutationChangedError(authorization);
    }
    await rename(anchoredEntryPath(parent, tempName), anchoredEntryPath(parent, name));
    let committedAuthorization: MutationPathAuthorization;
    try {
      const committedState = await optionalAnchoredFileState(parent, name, target);
      if (committedState === undefined || !identityMatches(tempState.identity, committedState.identity)) {
        throw new Error(`Mutation target identity changed during rename: ${authorization.path}`);
      }
      committedAuthorization = { ...authorization, targetState: committedState };
    } catch (error) {
      throw new MutationCommittedError({ ...authorization, targetState: tempState }, error);
    }
    await syncMutationAnchor(parent);
    return committedAuthorization;
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    try {
      await handle?.close();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    try {
      const currentTempState = await optionalAnchoredFileState(parent, tempName, target);
      if (
        tempState !== undefined
        && currentTempState !== undefined
        && stateMatches(tempState, currentTempState)
      ) await unlink(anchoredEntryPath(parent, tempName));
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (cleanupFailures.length > 0) {
      const cause = new AggregateError([error, ...cleanupFailures], "Mutation cleanup incomplete", { cause: error });
      if (error instanceof MutationCommittedError) {
        throw new MutationCommittedError(error.authorization, cause);
      }
      throw cause;
    }
    throw error;
  } finally {
    await closeMutationAnchor(parent);
  }
}

export async function writeFileAtomically(
  pathOrAuthorization: string | MutationPathAuthorization,
  contents: string,
  allowPathnameFallback = false,
): Promise<void> {
  const authorization = typeof pathOrAuthorization === "string"
    ? await captureMutationPathAuthorization(pathOrAuthorization)
    : pathOrAuthorization;
  await writeDataAtomically(authorization, contents, allowPathnameFallback);
}

type PatchWrite = {
  path: string;
  contents: string;
};
type PatchApplication = {
  readonly deletes: readonly string[];
  readonly writes: readonly PatchWrite[];
  readonly authorizations: readonly MutationPathAuthorization[];
};

class MutationCommittedError extends Error {
  readonly authorization: MutationPathAuthorization;

  constructor(authorization: MutationPathAuthorization, cause: unknown) {
    super(`Mutation committed but its resulting identity could not be verified: ${authorization.path}`, { cause });
    this.authorization = authorization;
  }
}

type PatchFileSnapshot =
  | { kind: "missing" }
  | { kind: "file"; contents: Uint8Array };

type PatchJournalEntry = Readonly<{
  authorization: MutationPathAuthorization;
  snapshot: PatchFileSnapshot;
}>;

async function snapshotPatchFile(
  authorization: MutationPathAuthorization,
): Promise<Readonly<{ authorization: MutationPathAuthorization; snapshot: PatchFileSnapshot }>> {
  if (authorization.targetState === undefined) return { authorization, snapshot: { kind: "missing" } };
  const read = await readAuthorizedFile(authorization);
  return { authorization: read.authorization, snapshot: { kind: "file", contents: read.contents } };
}

async function restorePatchFile(entry: PatchJournalEntry): Promise<void> {
  const { authorization, snapshot } = entry;
  switch (snapshot.kind) {
    case "missing": {
      if (authorization.targetState !== undefined) {
        const parent = await anchorMutationParent(authorization, false);
        try {
          await unlink(anchoredEntryPath(parent, basename(authorization.resolvedPath)));
        } finally {
          await closeMutationAnchor(parent);
        }
      }
      return;
    }
    case "file":
      await writeDataAtomically(authorization, snapshot.contents, false);
      return;
  }
}

async function rollbackPatchFiles(journal: readonly PatchJournalEntry[]): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const entry of [...journal].reverse()) {
    try {
      await restorePatchFile(entry);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export async function writePatchFiles(application: PatchApplication): Promise<void> {
  const deletes = application.deletes;
  const parsedWrites = application.writes;
  if (deletes.some((path) => typeof path !== "string") || parsedWrites.some((write) =>
    typeof write !== "object" || write === null || typeof write.path !== "string" || write.path === "" || typeof write.contents !== "string"
  )) throw new Error("Invalid Taumel apply_patch result");

  const authorizationByPath = new Map<string, MutationPathAuthorization>();
  for (const authorization of application.authorizations) {
    if (authorizationByPath.has(authorization.path)) {
      throw new Error(`Duplicate mutation authorization for path: ${authorization.path}`);
    }
    authorizationByPath.set(authorization.path, authorization);
  }
  const authorizationFor = (path: string): MutationPathAuthorization => {
    const authorization = authorizationByPath.get(path);
    if (authorization === undefined) throw new Error(`Missing mutation authorization for path: ${path}`);
    return authorization;
  };
  const snapshots = new Map<string, PatchFileSnapshot>();
  for (const path of [...parsedWrites.map((write) => write.path), ...deletes]) {
    const authorization = authorizationFor(path);
    if (snapshots.has(authorization.resolvedPath)) {
      throw new Error(`Duplicate canonical mutation target: ${authorization.resolvedPath}`);
    }
    const captured = await snapshotPatchFile(authorization);
    snapshots.set(authorization.resolvedPath, captured.snapshot);
    authorizationByPath.set(path, captured.authorization);
  }

  const journal: PatchJournalEntry[] = [];
  try {
    for (const write of parsedWrites) {
      const authorization = authorizationFor(write.path);
      let produced: MutationPathAuthorization;
      try {
        produced = await writeDataAtomically(authorization, write.contents, false);
      } catch (error) {
        if (error instanceof MutationCommittedError) {
          journal.push({
            authorization: error.authorization,
            snapshot: snapshots.get(authorization.resolvedPath)!,
          });
        }
        throw error;
      }
      journal.push({ authorization: produced, snapshot: snapshots.get(authorization.resolvedPath)! });
      authorizationByPath.set(write.path, produced);
    }
    for (const path of deletes) {
      const authorization = authorizationFor(path);
      if (authorization.targetState === undefined) continue;
      const parent = await anchorMutationParent(authorization, false);
      try {
        await unlink(anchoredEntryPath(parent, basename(authorization.resolvedPath)));
      } finally {
        await closeMutationAnchor(parent);
      }
      const produced = { ...authorization, targetState: undefined };
      journal.push({ authorization: produced, snapshot: snapshots.get(authorization.resolvedPath)! });
      authorizationByPath.set(path, produced);
    }
  } catch (error) {
    const rollbackFailures = await rollbackPatchFiles(journal);
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        "Patch partially applied; rollback incomplete",
        { cause: error },
      );
    }
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
): Promise<Readonly<{
  facts: WorkspaceMutationFacts;
  authorizations: readonly MutationPathAuthorization[];
}>> {
  const resolvedRoots = await Promise.all(
    workspaceRoots.map((root) => realpath(root)),
  );
  const authorizations = await Promise.all(paths.map(captureMutationPathAuthorization));
  return {
    facts: {
      workspaceRoots: resolvedRoots,
      paths: authorizations.map(({ path, resolvedPath }) => ({ path, resolvedPath })),
    },
    authorizations,
  };
}

export async function validateWorkspaceMutationPaths(
  core: CoreBridge,
  paths: readonly string[],
  workspaceRoots: readonly string[],
): Promise<readonly MutationPathAuthorization[]> {
  const resolved = await resolvedWorkspaceMutationPathFacts(paths, workspaceRoots);
  const result = decodeWorkspaceMutationValidation(core.call("validateWorkspaceMutationPaths", [
    resolved.facts,
  ]));
  if (result.kind === "invalid") throw new Error(result.message);
  return resolved.authorizations;
}
