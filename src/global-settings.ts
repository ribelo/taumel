import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { isRecord, writeFileAtomically } from "./util.ts";

export const builtinAgentProfileNames = [
  "smart",
  "deep",
  "rush",
  "finder",
  "librarian",
  "oracle",
  "painter",
  "review",
] as const;

export type AgentBuiltinOverride = {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
};

export type TaumelGlobalSettings = {
  readonly taumel: {
    readonly composer: {
      readonly enabled: boolean;
    };
    readonly agents: Record<string, AgentBuiltinOverride>;
  };
};

export type TaumelConfigDiagnostic = {
  readonly path: string;
  readonly key: string;
  readonly message: string;
};

export type TaumelInitResult = {
  readonly ok: true;
  readonly action: "command_result";
  readonly message: string;
  readonly details: {
    readonly ok: true;
    readonly path: string;
    readonly initialized: readonly string[];
    readonly diagnostics: readonly TaumelConfigDiagnostic[];
  };
};

const inheritedAgentOverride: AgentBuiltinOverride = {
  provider: "inherit",
  model: "inherit",
  thinking: "inherit",
};

function defaultAgentOverrides(): Record<string, AgentBuiltinOverride> {
  return Object.fromEntries(builtinAgentProfileNames.map((name) => [name, inheritedAgentOverride]));
}

export const defaultTaumelGlobalSettings: TaumelGlobalSettings = {
  taumel: {
    composer: { enabled: true },
    agents: defaultAgentOverrides(),
  },
};

export function taumelGlobalSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function diagnostic(path: string, key: string, message: string): TaumelConfigDiagnostic {
  return { path, key, message };
}

async function readSettingsRoot(path: string): Promise<{ readonly exists: boolean; readonly root: Record<string, unknown>; readonly diagnostics: TaumelConfigDiagnostic[] }> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return {
        exists: true,
        root: {},
        diagnostics: [diagnostic(path, "<root>", "global Pi settings must be a JSON object")],
      };
    }
    return { exists: true, root: parsed, diagnostics: [] };
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { exists: false, root: {}, diagnostics: [] };
    }
    return {
      exists: true,
      root: {},
      diagnostics: [diagnostic(path, "<root>", `global Pi settings could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`)],
    };
  }
}

function parseOverride(path: string, key: string, value: unknown, diagnostics: TaumelConfigDiagnostic[]): AgentBuiltinOverride | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic(path, key, "built-in agent routing entry must be an object"));
    return undefined;
  }
  const provider = value["provider"];
  const model = value["model"];
  const thinking = value["thinking"];
  if (typeof provider !== "string" || typeof model !== "string" || typeof thinking !== "string") {
    diagnostics.push(diagnostic(path, key, "built-in agent routing entry requires string provider, model, and thinking"));
    return undefined;
  }
  const providerInherits = provider === "inherit";
  const modelInherits = model === "inherit";
  if (providerInherits !== modelInherits) {
    diagnostics.push(diagnostic(path, key, "provider and model must both be inherit or both be concrete"));
    return undefined;
  }
  return { provider, model, thinking };
}

export function parseTaumelGlobalSettings(value: unknown, path = taumelGlobalSettingsPath()): { readonly settings: TaumelGlobalSettings; readonly diagnostics: TaumelConfigDiagnostic[] } {
  const diagnostics: TaumelConfigDiagnostic[] = [];
  const root = isRecord(value) ? value : {};
  if (!isRecord(value)) diagnostics.push(diagnostic(path, "<root>", "global Pi settings must be a JSON object"));
  const taumel = isRecord(root["taumel"]) ? root["taumel"] : {};
  if (root["taumel"] !== undefined && !isRecord(root["taumel"])) {
    diagnostics.push(diagnostic(path, "taumel", "taumel must be an object"));
  }
  const composer = isRecord(taumel["composer"]) ? taumel["composer"] : {};
  if (taumel["composer"] !== undefined && !isRecord(taumel["composer"])) {
    diagnostics.push(diagnostic(path, "taumel.composer", "composer must be an object"));
  }
  const enabled = composer["enabled"];
  if (enabled !== undefined && typeof enabled !== "boolean") {
    diagnostics.push(diagnostic(path, "taumel.composer.enabled", "composer enabled must be a boolean"));
  }
  const agents = isRecord(taumel["agents"]) ? taumel["agents"] : {};
  if (taumel["agents"] !== undefined && !isRecord(taumel["agents"])) {
    diagnostics.push(diagnostic(path, "taumel.agents", "agents must be an object"));
  }
  const overrides: Record<string, AgentBuiltinOverride> = {};
  for (const name of builtinAgentProfileNames) {
    const value = agents[name];
    const parsed = value === undefined ? undefined : parseOverride(path, `taumel.agents.${name}`, value, diagnostics);
    overrides[name] = parsed ?? inheritedAgentOverride;
  }
  return {
    settings: {
      taumel: {
        composer: {
          enabled: typeof enabled === "boolean" ? enabled : defaultTaumelGlobalSettings.taumel.composer.enabled,
        },
        agents: overrides,
      },
    },
    diagnostics,
  };
}

export function requireTaumelGlobalSettings(value: unknown): TaumelGlobalSettings {
  const parsed = parseTaumelGlobalSettings(value);
  return parsed.settings;
}

export async function readTaumelGlobalSettings(path = taumelGlobalSettingsPath()): Promise<TaumelGlobalSettings> {
  const { root } = await readSettingsRoot(path);
  return parseTaumelGlobalSettings(root, path).settings;
}

export async function readTaumelGlobalConfigDiagnostics(path = taumelGlobalSettingsPath()): Promise<TaumelConfigDiagnostic[]> {
  const { root, diagnostics } = await readSettingsRoot(path);
  return [...diagnostics, ...parseTaumelGlobalSettings(root, path).diagnostics];
}

function cloneRoot(root: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
}

function objectAt(root: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = root[key];
  return isRecord(value) ? value : undefined;
}

function ensureObject(root: Record<string, unknown>, key: string, filePath: string, configKey: string, initialized: string[], diagnostics: TaumelConfigDiagnostic[]): Record<string, unknown> | undefined {
  const value = root[key];
  if (value === undefined) {
    const created: Record<string, unknown> = {};
    root[key] = created;
    initialized.push(configKey);
    return created;
  }
  if (!isRecord(value)) {
    diagnostics.push(diagnostic(filePath, configKey, `${configKey} must be an object`));
    return undefined;
  }
  return value;
}

function putMissingArray(parent: Record<string, unknown>, key: string, configKey: string, initialized: string[], diagnostics: TaumelConfigDiagnostic[], path: string): void {
  const current = parent[key];
  if (current === undefined) {
    parent[key] = [];
    initialized.push(configKey);
  } else if (!Array.isArray(current) || !current.every((item) => typeof item === "string")) {
    diagnostics.push(diagnostic(path, configKey, `${configKey} must be an array of strings`));
  }
}

export async function initializeTaumelGlobalConfig(path = taumelGlobalSettingsPath()): Promise<TaumelInitResult> {
  const read = await readSettingsRoot(path);
  if (read.exists && read.diagnostics.some((item) => item.key === "<root>")) {
    const message = `Taumel global config is malformed: ${path}`;
    return {
      ok: true,
      action: "command_result",
      message,
      details: { ok: true, path, initialized: [], diagnostics: read.diagnostics },
    };
  }
  const root = cloneRoot(read.root);
  const initialized: string[] = [];
  const diagnostics: TaumelConfigDiagnostic[] = [...read.diagnostics];
  const taumel = ensureObject(root, "taumel", path, "taumel", initialized, diagnostics);
  if (taumel !== undefined) {
    const composer = ensureObject(taumel, "composer", path, "taumel.composer", initialized, diagnostics);
    if (composer !== undefined) {
      const enabled = composer["enabled"];
      if (enabled === undefined) {
        composer["enabled"] = true;
        initialized.push("taumel.composer.enabled");
      } else if (typeof enabled !== "boolean") {
        diagnostics.push(diagnostic(path, "taumel.composer.enabled", "composer enabled must be a boolean"));
      }
    }

    const agents = ensureObject(taumel, "agents", path, "taumel.agents", initialized, diagnostics);
    if (agents !== undefined) {
      putMissingArray(agents, "disabled", "taumel.agents.disabled", initialized, diagnostics, path);
      for (const name of builtinAgentProfileNames) {
        const current = agents[name];
        if (current === undefined) {
          agents[name] = { ...inheritedAgentOverride };
          initialized.push(`taumel.agents.${name}`);
        } else {
          parseOverride(path, `taumel.agents.${name}`, current, diagnostics);
        }
      }
    }

    const tools = ensureObject(taumel, "tools", path, "taumel.tools", initialized, diagnostics);
    if (tools !== undefined) putMissingArray(tools, "disabled", "taumel.tools.disabled", initialized, diagnostics, path);
    const skills = ensureObject(taumel, "skills", path, "taumel.skills", initialized, diagnostics);
    if (skills !== undefined) putMissingArray(skills, "disabled", "taumel.skills.disabled", initialized, diagnostics, path);
  }

  if (initialized.length > 0) {
    await writeFileAtomically(path, `${JSON.stringify(root, null, 2)}\n`);
  }
  const status = initialized.length === 0 ? "already initialized" : `initialized ${initialized.join(", ")}`;
  const diagnosticText = diagnostics.length === 0 ? "" : `\nWarnings:\n${diagnostics.map((item) => `${item.key}: ${item.message}`).join("\n")}`;
  return {
    ok: true,
    action: "command_result",
    message: `Taumel global config ${status}: ${path}${diagnosticText}`,
    details: { ok: true, path, initialized, diagnostics },
  };
}

export async function writeTaumelComposerEnabled(path: string, enabled: boolean): Promise<void> {
  const read = await readSettingsRoot(path);
  if (read.exists && read.diagnostics.some((item) => item.key === "<root>")) {
    throw new Error(`Cannot write Taumel composer config because global Pi settings are malformed: ${path}`);
  }
  const root = cloneRoot(read.root);
  const taumel = objectAt(root, "taumel") ?? {};
  root["taumel"] = taumel;
  const composer = objectAt(taumel, "composer") ?? {};
  taumel["composer"] = composer;
  composer["enabled"] = enabled;
  await writeFileAtomically(path, `${JSON.stringify(root, null, 2)}\n`);
}

export async function taumelStatus(path = taumelGlobalSettingsPath()): Promise<TaumelInitResult> {
  const read = await readSettingsRoot(path);
  const diagnostics = [...read.diagnostics, ...parseTaumelGlobalSettings(read.root, path).diagnostics];
  const missing: string[] = [];
  const root = read.root;
  const taumel = isRecord(root["taumel"]) ? root["taumel"] : undefined;
  const composer = isRecord(taumel?.["composer"]) ? taumel["composer"] : undefined;
  if (composer?.["enabled"] === undefined) missing.push("taumel.composer.enabled");
  const agents = isRecord(taumel?.["agents"]) ? taumel["agents"] : undefined;
  if (agents?.["disabled"] === undefined) missing.push("taumel.agents.disabled");
  for (const name of builtinAgentProfileNames) {
    if (agents?.[name] === undefined) missing.push(`taumel.agents.${name}`);
  }
  const tools = isRecord(taumel?.["tools"]) ? taumel["tools"] : undefined;
  if (tools?.["disabled"] === undefined) missing.push("taumel.tools.disabled");
  const skills = isRecord(taumel?.["skills"]) ? taumel["skills"] : undefined;
  if (skills?.["disabled"] === undefined) missing.push("taumel.skills.disabled");
  const message = [
    `Taumel global config: ${path}`,
    missing.length === 0 ? "Initialization: complete" : `Initialization: missing ${missing.join(", ")}`,
    "Commands: taumel, composer, agents, tools, skills, agent-runs, compaction-model, execpolicy",
    "Tool groups: shell, files, agents, threads, goals, cron, ralph, exa",
    ...(diagnostics.length === 0 ? [] : ["Warnings:", ...diagnostics.map((item) => `${item.key}: ${item.message}`)]),
    ...(missing.length === 0 ? [] : ['Run "/taumel init" to create missing global defaults.']),
  ].join("\n");
  return {
    ok: true,
    action: "command_result",
    message,
    details: { ok: true, path, initialized: [], diagnostics },
  };
}
