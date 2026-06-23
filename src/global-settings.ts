import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
  readonly composer: {
    readonly enabled: boolean;
  };
  readonly taumel: {
    readonly agents: {
      readonly builtins: Record<string, AgentBuiltinOverride>;
    };
  };
};

function defaultAgentBuiltinOverrides(): Record<string, AgentBuiltinOverride> {
  return Object.fromEntries(
    builtinAgentProfileNames.map((name) => [
      name,
      { provider: "inherit", model: "inherit", thinking: "inherit" },
    ]),
  );
}

export const defaultTaumelGlobalSettings: TaumelGlobalSettings = {
  composer: { enabled: true },
  taumel: {
    agents: {
      builtins: defaultAgentBuiltinOverrides(),
    },
  },
};

export function taumelGlobalSettingsPath(): string {
  return process.env.TAUMEL_SETTINGS_PATH ?? join(homedir(), ".pi", "agent", "taumel", "settings.json");
}

function parseAgentBuiltinOverrides(value: unknown): Record<string, AgentBuiltinOverride> {
  const defaults = defaultAgentBuiltinOverrides();
  if (!isRecord(value)) return defaults;
  const parsed: Record<string, AgentBuiltinOverride> = { ...defaults };
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      parsed[name] = {};
      continue;
    }
    const override: AgentBuiltinOverride = {};
    if (typeof raw["provider"] === "string") override.provider = raw["provider"];
    if (typeof raw["model"] === "string") override.model = raw["model"];
    if (typeof raw["thinking"] === "string") override.thinking = raw["thinking"];
    parsed[name] = override;
  }
  return parsed;
}

export function parseTaumelGlobalSettings(value: unknown): TaumelGlobalSettings {
  const composer = isRecord(value) && isRecord(value["composer"]) ? value["composer"] : {};
  const enabled = composer["enabled"];
  const taumel = isRecord(value) && isRecord(value["taumel"]) ? value["taumel"] : {};
  const agents = isRecord(taumel["agents"]) ? taumel["agents"] : {};
  return {
    composer: {
      enabled: typeof enabled === "boolean" ? enabled : defaultTaumelGlobalSettings.composer.enabled,
    },
    taumel: {
      agents: {
        builtins: parseAgentBuiltinOverrides(agents["builtins"]),
      },
    },
  };
}

export function requireTaumelGlobalSettings(value: unknown): TaumelGlobalSettings {
  if (!isRecord(value) || !isRecord(value["composer"]) || !isRecord(value["taumel"])) {
    throw new Error("Invalid Taumel global settings");
  }
  const enabled = value["composer"]["enabled"];
  const agents = isRecord(value["taumel"]["agents"]) ? value["taumel"]["agents"] : undefined;
  if (typeof enabled !== "boolean" || !isRecord(agents) || !isRecord(agents["builtins"])) {
    throw new Error("Invalid Taumel global settings");
  }
  return {
    composer: { enabled },
    taumel: {
      agents: {
        builtins: parseAgentBuiltinOverrides(agents["builtins"]),
      },
    },
  };
}

export async function readTaumelGlobalSettings(path = taumelGlobalSettingsPath()): Promise<TaumelGlobalSettings> {
  try {
    return parseTaumelGlobalSettings(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return defaultTaumelGlobalSettings;
  }
}

export async function ensureTaumelGlobalSettings(path = taumelGlobalSettingsPath()): Promise<TaumelGlobalSettings> {
  let raw: unknown;
  let missing = false;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    missing = true;
    raw = {};
  }
  const settings = parseTaumelGlobalSettings(raw);
  const hasAgentBuiltins =
    isRecord(raw) &&
    isRecord(raw["taumel"]) &&
    isRecord(raw["taumel"]["agents"]) &&
    isRecord(raw["taumel"]["agents"]["builtins"]);
  if (missing || !hasAgentBuiltins) {
    await writeTaumelGlobalSettings(path, settings);
  }
  return settings;
}

export async function writeTaumelGlobalSettings(path: string, settings: TaumelGlobalSettings): Promise<void> {
  await writeFileAtomically(path, `${JSON.stringify(settings, null, 2)}\n`);
}
