import { decodeSessionCustomEntry } from "./bridge-decoders.ts";
import type {
  ChildSessionSetupEntry,
  PersistedTaumelCustomEntry,
  TaumelCustomEntryDataMap,
  TaumelCustomType,
} from "./session-entry-contracts.ts";

type SessionManagerHost = { readonly getEntries?: () => unknown };
type WritableSessionManagerHost = {
  readonly appendCustomEntry?: (customType: string, data: unknown) => unknown;
};
type UnknownRecord = { readonly [key: string]: unknown };

function objectRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? value as UnknownRecord
    : undefined;
}

export type RawCustomEntryEnvelope<K extends string> = Readonly<{
  type: "custom";
  customType: K;
  data: unknown;
}>;

type UnavailableReason =
  | "session_manager_unavailable"
  | "get_entries_unavailable"
  | "invalid_entries_result"
  | "get_entries_failed";

export type CustomEntryPresence<K extends string> =
  | Readonly<{ kind: "absent"; customType: K }>
  | Readonly<{ kind: "unavailable"; customType: K; reason: UnavailableReason }>
  | Readonly<{ kind: "present"; customType: K; rawEntry: RawCustomEntryEnvelope<K> }>;

export type TaumelEntryLookup<K extends TaumelCustomType> =
  | Readonly<{ kind: "absent"; customType: K }>
  | Readonly<{ kind: "unavailable"; customType: K; reason: UnavailableReason }>
  | Readonly<{
      kind: "invalid";
      customType: K;
      rawEntry: RawCustomEntryEnvelope<K>;
      error: string;
    }>
  | Readonly<{
      kind: "contract_valid";
      customType: K;
      entry: PersistedTaumelCustomEntry<K>;
    }>;

export function latestCanonicalCustomEntryPresence<K extends string>(
  sessionManager: unknown,
  customType: K,
): CustomEntryPresence<K> {
  const manager = objectRecord(sessionManager) as Partial<SessionManagerHost> | undefined;
  if (manager === undefined) {
    return { kind: "unavailable", customType, reason: "session_manager_unavailable" };
  }
  if (typeof manager.getEntries !== "function") {
    return { kind: "unavailable", customType, reason: "get_entries_unavailable" };
  }
  let entries: unknown;
  try {
    entries = manager.getEntries.call(sessionManager);
  } catch {
    return { kind: "unavailable", customType, reason: "get_entries_failed" };
  }
  if (!Array.isArray(entries)) {
    return { kind: "unavailable", customType, reason: "invalid_entries_result" };
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = objectRecord(entries[index]);
    if (entry?.type !== "custom" || entry.customType !== customType) continue;
    return {
      kind: "present",
      customType,
      rawEntry: { type: "custom", customType, data: entry.data },
    };
  }
  return { kind: "absent", customType };
}

export function latestTaumelCustomEntry<K extends TaumelCustomType>(
  sessionManager: unknown,
  customType: K,
): TaumelEntryLookup<K> {
  const presence = latestCanonicalCustomEntryPresence(sessionManager, customType);
  if (presence.kind !== "present") return presence;
  try {
    const entry = decodeSessionCustomEntry(presence.rawEntry);
    return {
      kind: "contract_valid",
      customType,
      entry: entry as PersistedTaumelCustomEntry<K>,
    };
  } catch (error) {
    return {
      kind: "invalid",
      customType,
      rawEntry: presence.rawEntry,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isCanonicalEntryPresent<K extends TaumelCustomType>(
  lookup: TaumelEntryLookup<K>,
): lookup is Extract<TaumelEntryLookup<K>, { kind: "contract_valid" | "invalid" }> {
  return lookup.kind === "contract_valid" || lookup.kind === "invalid";
}

export function appendTaumelCustomEntry<K extends TaumelCustomType>(
  sessionManager: unknown,
  customType: K,
  data: TaumelCustomEntryDataMap[K],
): boolean {
  const manager = objectRecord(sessionManager) as Partial<WritableSessionManagerHost> | undefined;
  if (typeof manager?.appendCustomEntry !== "function") return false;
  manager.appendCustomEntry.call(sessionManager, customType, data);
  return true;
}

export function appendChildSessionSetupEntry(
  sessionManager: unknown,
  entry: ChildSessionSetupEntry,
): boolean {
  const manager = objectRecord(sessionManager) as Partial<WritableSessionManagerHost> | undefined;
  if (typeof manager?.appendCustomEntry !== "function") return false;
  manager.appendCustomEntry.call(sessionManager, entry.customType, entry.data);
  return true;
}

export type { TaumelCustomEntryDataMap, TaumelCustomType };
