import { constants } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  decodeThreadCatalogScansResult,
  type ThreadCatalogFacts,
  type ThreadCatalogScan,
} from "./bridge-contracts.ts";
import type { CoreBridge } from "./types.ts";
import { objectValue, property } from "./util.ts";

type ThreadSource =
  | { readonly kind: "sessionFile"; readonly path: string; readonly text: string }
  | { readonly kind: "diagnostic"; readonly path: string; readonly error: string };
type ThreadSourceRequest =
  | { readonly action: "query_threads"; readonly query: string; readonly scope: "current_workspace" | "all" }
  | {
      readonly action: "read_thread";
      readonly threadID: string;
      readonly locator?: { readonly sourcePath?: string };
    };
type CatalogFile = { readonly path: string; readonly size: number; readonly modifiedMs: number };

const THREAD_SCAN_BYTE_BUDGET = 512 * 1024 * 1024;
const THREAD_SOURCE_BYTE_LIMIT = 32 * 1024 * 1024;
const THREAD_CATALOG_BYTE_BUDGET = 64 * 1024 * 1024;
const THREAD_SCAN_CHUNK_BYTES = 64 * 1024;
const THREAD_DIAGNOSTIC_LIMIT = 20;

export async function discoverCatalogFiles(scan: ThreadCatalogScan): Promise<string[]> {
  const { root, maxDepth, maxFiles, suffix } = scan;
  const files: string[] = [];
  let visited = 0;
  const maxVisited = Math.max(1000, maxFiles * 20);
  async function visit(dir: string, depth: number): Promise<void> {
    if (files.length >= maxFiles || visited >= maxVisited || depth < 0) return;
    let directory;
    try {
      directory = await opendir(dir);
    } catch {
      return;
    }
    for await (const entry of directory) {
      visited += 1;
      if (files.length >= maxFiles || visited >= maxVisited) return;
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
  const sessionManager = context === undefined ? undefined : objectValue(property(context, "sessionManager"));
  const getSessionDir = sessionManager === undefined ? undefined : property(sessionManager, "getSessionDir");
  const sessionDir = typeof getSessionDir === "function" ? getSessionDir.call(sessionManager) : undefined;
  return {
    cwd: typeof cwd === "string" ? cwd : "",
    home: homedir(),
    ...(typeof sessionDir === "string" && sessionDir !== "" ? { override: sessionDir } : {}),
  };
}

export function sessionCatalogScans(core: CoreBridge, ctx: unknown): ThreadCatalogScan[] {
  return [...decodeThreadCatalogScansResult(
    core.call("planThreadCatalogScans", [threadCatalogFacts(ctx)]),
  ).scans];
}

function diagnosticMessage(path: string, error: string): ThreadSource {
  return { kind: "diagnostic", path, error };
}

function boundedDiagnosticPush(sources: ThreadSource[], diagnostic: ThreadSource): void {
  const count = sources.reduce((total, source) => total + (source.kind === "diagnostic" ? 1 : 0), 0);
  if (count < THREAD_DIAGNOSTIC_LIMIT) sources.push(diagnostic);
}

function isRawJsonSearchSafe(query: string): boolean {
  return /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/.test(query);
}

async function openRegularFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const info = await handle.stat();
  if (!info.isFile()) {
    await handle.close();
    throw new Error("thread source is not a regular file");
  }
  return { handle, info };
}

async function fileContainsQuery(path: string, query: string, maxBytes: number): Promise<boolean> {
  const needle = query.toLowerCase();
  const { handle } = await openRegularFile(path);
  const buffer = Buffer.allocUnsafe(THREAD_SCAN_CHUNK_BYTES);
  let carry = "";
  let scanned = 0;
  try {
    while (scanned < maxBytes) {
      const length = Math.min(buffer.length, maxBytes - scanned);
      const { bytesRead } = await handle.read(buffer, 0, length, null);
      if (bytesRead === 0) return false;
      scanned += bytesRead;
      const text = (carry + buffer.subarray(0, bytesRead).toString("utf8")).toLowerCase();
      if (text.includes(needle)) return true;
      carry = needle.length <= 1 ? "" : text.slice(-(needle.length - 1));
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function sessionHeader(path: string): Promise<{ readonly id?: string; readonly text?: string }> {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let handle;
  try {
    ({ handle } = await openRegularFile(path));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0];
    if (!firstLine) return {};
    const header = JSON.parse(firstLine) as unknown;
    const object = objectValue(header);
    const id = object === undefined ? undefined : property(object, "id");
    return {
      ...(typeof id === "string" && id !== "" ? { id } : {}),
      text: `${firstLine}\n`,
    };
  } catch {
    return {};
  } finally {
    await handle?.close();
  }
}

function pathIsWithin(path: string, root: string): boolean {
  const offset = relative(resolve(root), resolve(path));
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

async function catalogFiles(core: CoreBridge, ctx: unknown, request: ThreadSourceRequest): Promise<CatalogFile[]> {
  const facts = threadCatalogFacts(ctx);
  const scans = sessionCatalogScans(core, ctx).filter((scan) =>
    request.action !== "query_threads" || request.scope !== "current_workspace" || facts.override === undefined
      ? true
      : resolve(scan.root) === resolve(facts.override) || pathIsWithin(scan.root, facts.cwd)
  );
  const paths = new Set<string>();
  for (const scan of scans) {
    for (const path of await discoverCatalogFiles(scan)) paths.add(path);
  }
  const files: CatalogFile[] = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      files.push({ path, size: info.size, modifiedMs: info.mtimeMs });
    } catch {
      // Files removed during discovery do not remain catalog candidates.
    }
  }
  files.sort((left, right) => right.modifiedMs - left.modifiedMs || left.path.localeCompare(right.path));
  return files;
}

async function selectQueryFiles(
  files: readonly CatalogFile[],
  request: Extract<ThreadSourceRequest, { readonly action: "query_threads" }>,
  diagnostics: ThreadSource[],
): Promise<CatalogFile[]> {
  if (!isRawJsonSearchSafe(request.query)) return [...files];
  const selected: CatalogFile[] = [];
  let scannedBytes = 0;
  for (const file of files) {
    if (scannedBytes + file.size > THREAD_SCAN_BYTE_BUDGET) {
      boundedDiagnosticPush(diagnostics, diagnosticMessage(file.path, `thread scan exceeded ${THREAD_SCAN_BYTE_BUDGET} byte safety budget`));
      continue;
    }
    scannedBytes += file.size;
    try {
      const metadataMatches = file.path.toLowerCase().includes(request.query.toLowerCase());
      if (metadataMatches || await fileContainsQuery(file.path, request.query, file.size)) selected.push(file);
    } catch (error) {
      boundedDiagnosticPush(diagnostics, diagnosticMessage(file.path, error instanceof Error ? error.message : String(error)));
    }
  }
  return selected;
}

async function selectReadFiles(
  files: readonly CatalogFile[],
  request: Extract<ThreadSourceRequest, { readonly action: "read_thread" }>,
): Promise<CatalogFile[]> {
  const sourcePath = request.locator?.sourcePath;
  if (sourcePath !== undefined) return files.filter((file) => file.path === sourcePath);
  const threadID = request.threadID.toLowerCase();
  const selected: Array<{ readonly file: CatalogFile; readonly id: string }> = [];
  for (const file of files) {
    const header = await sessionHeader(file.path);
    const fallback = file.path.split("/").at(-1)?.replace(/\.(jsonl|json)$/i, "");
    const id = header.id ?? fallback;
    if (id?.toLowerCase().startsWith(threadID)) selected.push({ file, id });
  }
  const exact = selected.filter((candidate) => candidate.id.toLowerCase() === threadID);
  return (exact.length > 0 ? exact : selected).map((candidate) => candidate.file);
}

async function readSourceWithinLimit(file: CatalogFile): Promise<{ readonly text?: string; readonly oversized: boolean }> {
  const { handle, info } = await openRegularFile(file.path);
  try {
    if (info.size > THREAD_SOURCE_BYTE_LIMIT) return { oversized: true };
    const buffer = Buffer.allocUnsafe(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return { text: buffer.subarray(0, offset).toString("utf8"), oversized: false };
  } finally {
    await handle.close();
  }
}

export async function threadSources(
  core: CoreBridge,
  ctx: unknown,
  request: ThreadSourceRequest,
): Promise<ThreadSource[]> {
  const sources: ThreadSource[] = [];
  const files = await catalogFiles(core, ctx, request);
  const selected = request.action === "query_threads"
    ? await selectQueryFiles(files, request, sources)
    : await selectReadFiles(files, request);
  let loadedBytes = 0;
  for (const file of selected) {
    if (loadedBytes + file.size > THREAD_CATALOG_BYTE_BUDGET) {
      boundedDiagnosticPush(sources, diagnosticMessage(file.path, `thread catalog exceeded ${THREAD_CATALOG_BYTE_BUDGET} byte safety budget`));
      continue;
    }
    try {
      const read = await readSourceWithinLimit(file);
      if (read.oversized || read.text === undefined) {
        const header = await sessionHeader(file.path);
        if (request.action === "read_thread" && header.text !== undefined) {
          sources.push({ kind: "sessionFile", path: file.path, text: header.text });
        }
        boundedDiagnosticPush(sources, diagnosticMessage(file.path, `thread source exceeds ${THREAD_SOURCE_BYTE_LIMIT} byte safety limit`));
      } else {
        sources.push({ kind: "sessionFile", path: file.path, text: read.text });
        loadedBytes += read.text.length;
      }
    } catch (error) {
      boundedDiagnosticPush(sources, diagnosticMessage(file.path, error instanceof Error ? error.message : String(error)));
    }
  }
  return sources;
}
