import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type {
  ChildSessionBridge,
  CoreBridge,
  PiLike,
  SessionInfo,
} from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringField(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string") {
    throw new Error(`Invalid Taumel string field: ${name}`);
  }
  return value;
}

export function optionalStringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Invalid Taumel string field: ${name}`);
  }
  return value;
}

export function numberField(record: Record<string, unknown>, name: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid Taumel number field: ${name}`);
  }
  return value;
}

export function optionalNumberField(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid Taumel number field: ${name}`);
  }
  return value;
}

export function stringArrayFromUnknown(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item): item is string => typeof item === "string" && item !== "")) return undefined;
  return value;
}

export function stringArrayField(record: Record<string, unknown>, name: string): string[] {
  const value = record[name];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new Error(`Invalid Taumel string array field: ${name}`);
  }
  return value;
}

export function recordArrayField(record: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const value = record[name];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Invalid Taumel record array field: ${name}`);
  }
  return value;
}

export function requiredError(record: Record<string, unknown>, source: string): string {
  const error = stringField(record, "error");
  if (error === "") throw new Error(`Invalid Taumel ${source} error`);
  return error;
}

export function contextWithOverrides(ctx: unknown, overrides: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ctx) ? { ...ctx, ...overrides } : overrides;
}

export function maybeCall(receiver: unknown, name: string, args: readonly unknown[] = []): unknown {
  if (!isRecord(receiver)) return undefined;
  const method = receiver[name];
  if (typeof method !== "function") return undefined;
  return method.apply(receiver, args);
}

export function coreCall(core: CoreBridge, name: string, args: readonly unknown[] = []): unknown {
  return core.call(name, args);
}

export function stringFromMethod(receiver: unknown, name: string): string | undefined {
  if (!isRecord(receiver)) return undefined;
  const method = receiver[name];
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
  if (!isRecord(ctx)) return {};
  return sessionInfoFromManager(ctx["sessionManager"]);
}

export function childBridgeFacts(bridge: ChildSessionBridge | undefined): Record<string, unknown> {
  if (!bridge) return { available: false };
  return {
    available: true,
    cancelled: bridge.cancelled === true,
    sessionId: bridge.sessionId ?? null,
    sessionFile: bridge.sessionFile ?? null,
    error: bridge.error ?? null,
    missingSessionIdentifier: bridge.missingSessionIdentifier === true,
    activeTools: bridge.activeTools ?? null,
    activeToolsApplied: bridge.activeToolsApplied === true,
    modelId: bridge.modelId ?? null,
    modelApplied: bridge.modelApplied === true,
    thinkingLevel: bridge.thinkingLevel ?? null,
    thinkingApplied: bridge.thinkingApplied === true,
  };
}

export function stringFlag(pi: PiLike, name: string): string | undefined {
  const value = typeof pi.getFlag === "function" ? pi.getFlag(name) : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function modelRegistryFrom(pi: PiLike, ctx: unknown): unknown {
  if (isRecord(ctx) && ctx["modelRegistry"] !== undefined) return ctx["modelRegistry"];
  return pi.modelRegistry;
}

export function openAiCredentialRaw(registry: unknown, credentialKey: string): unknown {
  if (!isRecord(registry)) return undefined;
  const authStorage = registry["authStorage"];
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
  if (!isRecord(sandbox)) throw new Error("Invalid Taumel sandbox config");
  return stringArrayField(sandbox, name).filter((value) => value !== "");
}

export function sandboxMetadataDirNames(core: CoreBridge): string[] {
  const names = stringArrayFromUnknown(coreCall(core, "sandboxMetadataDirNames"));
  if (names === undefined) throw new Error("Invalid Taumel sandbox metadata dir names");
  return names;
}

export function sandboxHostPathPlan(core: CoreBridge): Record<string, unknown> {
  const plan = coreCall(core, "sandboxHostPathPlan", [{
    tmpDir: tmpdir(),
    envTmpDir: process.env["TMPDIR"] ?? "",
  }]);
  if (!isRecord(plan)) {
    throw new Error("Invalid Taumel sandbox host path plan");
  }
  return plan;
}

export function workspaceMetadataListings(
  core: CoreBridge,
  workspaceRoots: readonly string[],
): Record<string, unknown>[] {
  const metadataDirNames = sandboxMetadataDirNames(core);
  const listings: Record<string, unknown>[] = [];
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

export function execHostFacts(core: CoreBridge, prepared: Record<string, unknown>): Record<string, unknown> {
  const sandbox = prepared["sandbox"];
  const hostPathPlan = sandboxHostPathPlan(core);
  const workspaceRoots = existingPaths(sandboxStringArrayField(sandbox, "workspaceRoots").map(realpathOrSelf));
  const home = realpathOrSelf(homedir());
  const homeParent = dirname(home);
  const homeMount = homeParent !== "/" && existsSync(homeParent) ? homeParent : home;
  return {
    platform: process.platform,
    tempRoots: existingPaths(stringArrayField(hostPathPlan, "tempRootCandidates").map(realpathOrSelf)),
    systemRoPaths: existingPaths(stringArrayField(hostPathPlan, "systemRoPathCandidates")),
    homeMount,
    workspaceRoots,
    workspaceMetadataListings: workspaceMetadataListings(core, workspaceRoots),
  };
}

export function childSessionStartPlan(
  core: CoreBridge,
  metadata: Record<string, unknown>,
  parent: SessionInfo,
): Record<string, unknown> {
  const plan = coreCall(core, "planChildSessionStart", [metadata, {
    parentSessionId: parent.sessionId ?? "",
    parentSessionFile: parent.sessionFile ?? "",
  }]);
  if (!isRecord(plan)) {
    throw new Error("Invalid Taumel child session start plan");
  }
  return plan;
}

export function setActiveToolsOn(receiver: unknown, toolNames: readonly string[]): boolean {
  if (!isRecord(receiver)) return false;
  for (const methodName of ["setActiveToolsByName", "setActiveTools"]) {
    const method = receiver[methodName];
    if (typeof method !== "function") continue;
    method.call(receiver, [...toolNames]);
    return true;
  }
  return false;
}

export function applyChildActiveTools(ctx: unknown, toolNames: readonly string[]): boolean {
  if (setActiveToolsOn(ctx, toolNames)) return true;
  if (isRecord(ctx) && setActiveToolsOn(ctx["sessionManager"], toolNames)) return true;
  return false;
}

export function applyValueOn(receiver: unknown, methodNames: readonly string[], value: string | undefined): boolean {
  if (!isRecord(receiver) || value === undefined) return false;
  for (const methodName of methodNames) {
    const method = receiver[methodName];
    if (typeof method !== "function") continue;
    method.call(receiver, value);
    return true;
  }
  return false;
}

export function applyChildModelThinking(
  ctx: unknown,
  modelId: string | undefined,
  thinkingLevel: string | undefined,
): { readonly modelApplied: boolean; readonly thinkingApplied: boolean } {
  const modelMethods = ["setModelById", "setModel", "selectModel"];
  const thinkingMethods = ["setThinkingLevel", "setThinking"];
  const sessionManager = isRecord(ctx) ? ctx["sessionManager"] : undefined;
  return {
    modelApplied:
      applyValueOn(ctx, modelMethods, modelId) || applyValueOn(sessionManager, modelMethods, modelId),
    thinkingApplied:
      applyValueOn(ctx, thinkingMethods, thinkingLevel) ||
      applyValueOn(sessionManager, thinkingMethods, thinkingLevel),
  };
}

export function currentThreadFacts(ctx: unknown): Record<string, unknown> {
  const context = isRecord(ctx) ? ctx : {};
  const cwd = typeof context["cwd"] === "string" ? context["cwd"] : process.cwd();
  const sessionManager = isRecord(context["sessionManager"]) ? context["sessionManager"] : {};
  const getSessionId = sessionManager["getSessionId"];
  const sessionId =
    typeof getSessionId === "function" ? String(getSessionId.call(sessionManager)) : "";
  const getBranch = sessionManager["getBranch"];
  const branch = typeof getBranch === "function" ? getBranch.call(sessionManager) : [];
  const getEntries = sessionManager["getEntries"];
  const entries = typeof getEntries === "function" ? getEntries.call(sessionManager) : [];
  return { cwd, sessionId, branch, entries };
}

export function currentThreadSource(core: CoreBridge, ctx: unknown): Record<string, unknown> {
  const source = coreCall(core, "currentThreadSource", [currentThreadFacts(ctx)]);
  if (!isRecord(source)) throw new Error("Invalid Taumel current thread source");
  return source;
}

export async function discoverCatalogFiles(scan: Record<string, unknown>): Promise<string[]> {
  const root = stringField(scan, "root");
  const maxDepth = numberField(scan, "maxDepth");
  const maxFiles = numberField(scan, "maxFiles");
  const suffix = stringField(scan, "suffix");
  if (root === "" || maxFiles <= 0 || suffix === "") {
    throw new Error("Invalid Taumel thread catalog scan");
  }
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

export function threadCatalogFacts(ctx: unknown): Record<string, unknown> {
  return {
    override: process.env.TAUMEL_THREAD_CATALOG_DIR ?? "",
    cwd: isRecord(ctx) && typeof ctx["cwd"] === "string" ? ctx["cwd"] : "",
    home: homedir(),
  };
}

export function sessionCatalogScans(core: CoreBridge, ctx: unknown): Record<string, unknown>[] {
  const planned = coreCall(core, "planThreadCatalogScans", [threadCatalogFacts(ctx)]);
  if (!Array.isArray(planned) || !planned.every(isRecord)) {
    throw new Error("Invalid Taumel thread catalog scans");
  }
  return planned;
}

export async function fileThreadSources(core: CoreBridge, ctx: unknown): Promise<Record<string, unknown>[]> {
  const sources: Record<string, unknown>[] = [];
  for (const scan of sessionCatalogScans(core, ctx)) {
    for (const file of await discoverCatalogFiles(scan)) {
      try {
        sources.push({
          kind: "sessionFile",
          path: file,
          data: JSON.parse(await readFile(file, "utf8")) as unknown,
        });
      } catch {
        // Best-effort catalog discovery: ignore unreadable or unrelated JSON.
      }
    }
  }
  return sources;
}

export async function threadSources(core: CoreBridge, ctx: unknown): Promise<Record<string, unknown>[]> {
  return [currentThreadSource(core, ctx), ...(await fileThreadSources(core, ctx))];
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

async function writeFileAtomically(path: string, contents: string): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(tempPath, "w");
    await handle.writeFile(contents, "utf8");
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

export async function writePatchFiles(application: Record<string, unknown>): Promise<void> {
  const deletes = stringArrayFromUnknown(application["deletes"]);
  if (deletes === undefined) throw new Error("Invalid Taumel apply_patch result");
  const writes = application["writes"];
  if (!Array.isArray(writes) || !writes.every(isRecord)) {
    throw new Error("Invalid Taumel apply_patch result");
  }
  for (const write of writes) {
    const path = stringField(write, "path");
    const contents = write["contents"];
    if (path === "" || typeof contents !== "string") {
      throw new Error("Invalid Taumel apply_patch result");
    }
    await writeFileAtomically(path, contents);
  }
  for (const path of deletes) {
    await rm(path, { force: true });
  }
}

async function resolveRealPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isRecord(error) || error["code"] !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    const resolvedParent = await resolveRealPath(parent);
    return `${resolvedParent}/${basename(path)}`;
  }
}

async function resolvedWorkspaceMutationPathFacts(
  paths: readonly string[],
  workspaceRoots: readonly string[],
): Promise<Record<string, unknown>> {
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
  const result = coreCall(core, "validateWorkspaceMutationPaths", [
    await resolvedWorkspaceMutationPathFacts(paths, workspaceRoots),
  ]);
  if (!isRecord(result)) {
    throw new Error("Invalid Taumel workspace mutation path validation");
  }
  if (result["ok"] !== true) {
    throw new Error(requiredError(result, "workspace mutation path validation"));
  }
}
