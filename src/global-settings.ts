import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord, writeFileAtomically } from "./util.ts";

export type TaumelGlobalSettings = {
  readonly composer: {
    readonly enabled: boolean;
  };
};

export const defaultTaumelGlobalSettings: TaumelGlobalSettings = {
  composer: { enabled: true },
};

export function taumelGlobalSettingsPath(): string {
  return process.env.TAUMEL_SETTINGS_PATH ?? join(homedir(), ".pi", "agent", "taumel", "settings.json");
}

export function parseTaumelGlobalSettings(value: unknown): TaumelGlobalSettings {
  if (!isRecord(value) || !isRecord(value["composer"])) {
    return defaultTaumelGlobalSettings;
  }
  const enabled = value["composer"]["enabled"];
  return {
    composer: {
      enabled: typeof enabled === "boolean" ? enabled : defaultTaumelGlobalSettings.composer.enabled,
    },
  };
}

export function requireTaumelGlobalSettings(value: unknown): TaumelGlobalSettings {
  if (!isRecord(value) || !isRecord(value["composer"])) {
    throw new Error("Invalid Taumel global settings");
  }
  const enabled = value["composer"]["enabled"];
  if (typeof enabled !== "boolean") {
    throw new Error("Invalid Taumel global settings");
  }
  return { composer: { enabled } };
}

export async function readTaumelGlobalSettings(path = taumelGlobalSettingsPath()): Promise<TaumelGlobalSettings> {
  try {
    return parseTaumelGlobalSettings(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return defaultTaumelGlobalSettings;
  }
}

export async function writeTaumelGlobalSettings(path: string, settings: TaumelGlobalSettings): Promise<void> {
  await writeFileAtomically(path, `${JSON.stringify(settings, null, 2)}\n`);
}
