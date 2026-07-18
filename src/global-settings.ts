import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJsonObjectForAtomicUpdate, writeFileAtomically } from "./util.ts";

type SettingsObject = { [key: string]: unknown };
type NodeError = { readonly code?: unknown };
function settingsObject(value: unknown): value is SettingsObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as NodeError).code : undefined;
}

export type TaumelGlobalSettings = { readonly taumel: { readonly composer: { readonly enabled: boolean } } };
export type TaumelConfigDiagnostic = { readonly path: string; readonly key: string; readonly message: string };
export type TaumelInitResult = { readonly ok: boolean; readonly action: "command_result"; readonly message: string; readonly details: { readonly path: string; readonly initialized: readonly string[]; readonly missing: readonly string[]; readonly diagnostics: readonly TaumelConfigDiagnostic[] } };
export const defaultTaumelGlobalSettings: TaumelGlobalSettings = { taumel: { composer: { enabled: true } } };
const settingsBlocks = ["composer", "tools", "skills"] as const;
const visibilityBlocks = ["tools", "skills"] as const;
export function taumelGlobalSettingsPath(): string { return join(getAgentDir(), "settings.json"); }
function diagnostic(path: string, key: string, message: string): TaumelConfigDiagnostic { return { path, key, message }; }

function nestedDiagnostics(root: SettingsObject, path: string): TaumelConfigDiagnostic[] {
  const diagnostics: TaumelConfigDiagnostic[] = [];
  const taumel = root["taumel"];
  if (taumel !== undefined && !settingsObject(taumel)) {
    return [diagnostic(path, "taumel", "taumel must be an object")];
  }
  if (!settingsObject(taumel)) return diagnostics;
  for (const name of settingsBlocks) {
    const value = taumel[name];
    if (value !== undefined && !settingsObject(value)) {
      diagnostics.push(diagnostic(path, `taumel.${name}`, `taumel.${name} must be an object`));
    }
  }
  const composer = settingsObject(taumel["composer"]) ? taumel["composer"] : undefined;
  if (composer?.["enabled"] !== undefined && typeof composer["enabled"] !== "boolean") {
    diagnostics.push(diagnostic(path, "taumel.composer.enabled", "composer enabled must be a boolean"));
  }
  for (const name of visibilityBlocks) {
    const block = settingsObject(taumel[name]) ? taumel[name] : undefined;
    const disabled = block?.["disabled"];
    if (disabled !== undefined && (!Array.isArray(disabled) || !disabled.every((item) => typeof item === "string"))) {
      diagnostics.push(diagnostic(path, `taumel.${name}.disabled`, `taumel.${name}.disabled must be an array of strings`));
    }
  }
  return diagnostics;
}

async function readRoot(path: string): Promise<{ exists: boolean; root: SettingsObject; diagnostics: TaumelConfigDiagnostic[] }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return settingsObject(parsed) ? { exists: true, root: parsed, diagnostics: [] } : { exists: true, root: {}, diagnostics: [diagnostic(path, "<root>", "global Pi settings must be a JSON object")] };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { exists: false, root: {}, diagnostics: [] };
    return { exists: true, root: {}, diagnostics: [diagnostic(path, "<root>", `global Pi settings could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`)] };
  }
}
async function readRootForUpdate(path: string) {
  return readJsonObjectForAtomicUpdate(path, true);
}
export function parseTaumelGlobalSettings(value: unknown, path = taumelGlobalSettingsPath()) {
  const root = settingsObject(value) ? value : undefined;
  const diagnostics: TaumelConfigDiagnostic[] = root !== undefined
    ? nestedDiagnostics(root, path)
    : [diagnostic(path, "<root>", "global Pi settings must be a JSON object")];
  const taumel = settingsObject(root?.["taumel"]) ? root["taumel"] : {};
  const composer = settingsObject(taumel["composer"]) ? taumel["composer"] : {};
  const enabled = composer["enabled"];
  return { settings: { taumel: { composer: { enabled: typeof enabled === "boolean" ? enabled : true } } }, diagnostics };
}
export function requireTaumelGlobalSettings(value: unknown): TaumelGlobalSettings { return parseTaumelGlobalSettings(value).settings; }
export async function readTaumelGlobalSettings(path = taumelGlobalSettingsPath()): Promise<TaumelGlobalSettings> { return parseTaumelGlobalSettings((await readRoot(path)).root, path).settings; }
export async function readTaumelGlobalConfigDiagnostics(path = taumelGlobalSettingsPath()): Promise<TaumelConfigDiagnostic[]> {
  const read = await readRoot(path);
  read.diagnostics.push(...parseTaumelGlobalSettings(read.root, path).diagnostics);
  return read.diagnostics;
}
function result(ok: boolean, message: string, path: string, initialized: string[], missing: string[], diagnostics: TaumelConfigDiagnostic[]): TaumelInitResult {
  return { ok, action: "command_result", message, details: { path, initialized, missing, diagnostics } };
}
export async function initializeTaumelGlobalConfig(path = taumelGlobalSettingsPath()): Promise<TaumelInitResult> {
  let read;
  try {
    read = await readRootForUpdate(path);
  } catch (error) {
    const message = `global Pi settings could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`;
    return result(false, `Taumel global config is malformed: ${path}`, path, [], [], [diagnostic(path, "<root>", message)]);
  }
  const diagnostics = nestedDiagnostics(read.settings, path);
  if (diagnostics.length > 0) {
    return result(false, `Taumel global config is malformed: ${path}`, path, [], [], diagnostics);
  }
  const root = read.settings;
  const initialized: string[] = [];
  const taumel = settingsObject(root["taumel"]) ? root["taumel"] : (root["taumel"] = {} as SettingsObject);
  const composer = settingsObject(taumel["composer"]) ? taumel["composer"] : (taumel["composer"] = {} as SettingsObject);
  if (composer["enabled"] === undefined) {
    composer["enabled"] = true;
    initialized.push("taumel.composer.enabled");
  }
  for (const name of visibilityBlocks) {
    const block = settingsObject(taumel[name]) ? taumel[name] : (taumel[name] = {} as SettingsObject);
    if (block["disabled"] === undefined) {
      block["disabled"] = [];
      initialized.push(`taumel.${name}.disabled`);
    }
  }
  await writeFileAtomically(read.authorization, `${JSON.stringify(root, null, 2)}\n`, true);
  return result(true, initialized.length ? `Initialized Taumel global config: ${path}` : `Taumel global config already initialized: ${path}`, path, initialized, [], []);
}
export async function writeTaumelComposerEnabled(path: string, enabled: boolean): Promise<void> {
  let read;
  try {
    read = await readRootForUpdate(path);
  } catch {
    throw new Error(`Cannot write Taumel composer config because global Pi settings are malformed: ${path}`);
  }
  if (nestedDiagnostics(read.settings, path).length) {
    throw new Error(`Cannot write Taumel composer config because global Pi settings are malformed: ${path}`);
  }
  const root = read.settings;
  const taumel = settingsObject(root["taumel"]) ? root["taumel"] : (root["taumel"] = {} as SettingsObject);
  const composer = settingsObject(taumel["composer"]) ? taumel["composer"] : (taumel["composer"] = {} as SettingsObject);
  composer["enabled"] = enabled;
  await writeFileAtomically(read.authorization, `${JSON.stringify(root, null, 2)}\n`, true);
}
export async function taumelStatus(path = taumelGlobalSettingsPath()): Promise<TaumelInitResult> {
  const read = await readRoot(path);
  const missing: string[] = [];
  const taumel = settingsObject(read.root["taumel"]) ? read.root["taumel"] : {};
  const composer = settingsObject(taumel["composer"]) ? taumel["composer"] : undefined;
  if (composer?.["enabled"] === undefined) missing.push("taumel.composer.enabled");
  for (const name of visibilityBlocks) {
    const block = settingsObject(taumel[name]) ? taumel[name] : undefined;
    if (block?.["disabled"] === undefined) missing.push(`taumel.${name}.disabled`);
  }
  const message = [
    `Taumel global config: ${read.exists ? path : `${path} (missing)`}`,
    `Missing defaults: ${missing.length}`,
    `Diagnostics: ${read.diagnostics.length}`,
    "Commands: taumel, composer, tools, skills, cron, compaction-model, execpolicy",
  ].join("\n");
  return result(read.diagnostics.length === 0, message, path, [], missing, read.diagnostics);
}
