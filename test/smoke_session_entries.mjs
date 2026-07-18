import assert from "node:assert/strict";
import { decodeSessionCustomEntry } from "../src/bridge-decoders.ts";
import {
  isCanonicalEntryPresent,
  latestTaumelCustomEntry,
} from "../src/pi-session-entries.ts";

const profile = {
  modelId: "inherit",
  thinkingLevel: "medium",
  sandboxPreset: "workspace-write",
  approvalPolicy: "never",
  tools: { kind: "all" },
  noSandboxAllowed: false,
};
const permissions = {
  version: 1,
  profile,
  networkMode: "enabled",
  noSandbox: false,
  isolated_child: false,
};
const persisted = (customType, data, extra = {}) => ({
  type: "custom",
  customType,
  data,
  id: "entry-id",
  timestamp: 1,
  ...extra,
});
const manager = (entries) => ({ getEntries: () => entries });
const wire = ({ type, customType, data }) => ({ type, customType, data });

for (const persistedEntry of [
  persisted("taumel.childSession", {
    kind: "ralph", objective: "work", controllerSessionId: "parent",
    maxIterations: null, reflectionEvery: null,
    parentSessionId: "parent", parentSessionFile: null,
  }),
  persisted("taumel.permissions", permissions),
  persisted("taumel.visibility", {
    version: 1, tools: { disabled: [] }, skills: { disabled: [] },
  }),
  persisted("taumel.goal", null),
  persisted("taumel.goal_automation", null),
  persisted("taumel.ralph", { version: 1, tasks: [] }),
  persisted("taumel.agents.v4", {
    version: 6,
    issued_identity_counts: { agent: 0, finder: 0, oracle: 0, issued_ids: [] },
    identities: [], runs: [], cleanup_pending: [],
  }),
  persisted("taumel.agents.presence", {
    storage_schema_version: 1,
    owner_session_id: "session-entry-smoke",
  }),
  persisted("taumel.cron", { version: 1, enabled: true, tasks: [] }),
]) {
  const entry = {
    type: persistedEntry.type,
    customType: persistedEntry.customType,
    data: persistedEntry.data,
  };
  try {
    assert.equal(decodeSessionCustomEntry(entry).customType, entry.customType);
  } catch (error) {
    throw new Error(`shared-cyen valid ${entry.customType} entry was rejected`, { cause: error });
  }
}

const valid = latestTaumelCustomEntry(
  manager([persisted("taumel.permissions", permissions)]),
  "taumel.permissions",
);
assert.equal(valid.kind, "contract_valid");
assert.equal(valid.kind === "contract_valid" && valid.entry.data.profile.tools.kind, "all");

const invalidLatest = latestTaumelCustomEntry(
  manager([
    persisted("taumel.permissions", permissions),
    persisted("taumel.permissions", { ...permissions, profile: { ...profile, tools: undefined } }),
  ]),
  "taumel.permissions",
);
assert.equal(invalidLatest.kind, "invalid", "shared-bu9p latest malformed entry must not resurrect older state");
assert.equal(invalidLatest.kind === "invalid" && invalidLatest.rawEntry.data.networkMode, "enabled");

const latestValid = latestTaumelCustomEntry(
  manager([
    persisted("taumel.permissions", { ...permissions, networkMode: "disabled" }),
    persisted("taumel.permissions", permissions),
  ]),
  "taumel.permissions",
);
assert.equal(latestValid.kind, "contract_valid", "latest entry wins over older same-type entries");
assert.equal(
  latestValid.kind === "contract_valid" && latestValid.entry.data.networkMode,
  "enabled",
  "latest entry must not select the oldest same-type entry",
);

const presenceLatest = latestTaumelCustomEntry(
  manager([
    persisted("taumel.agents.presence", {
      storage_schema_version: 1,
      owner_session_id: "older-owner",
    }),
    persisted("taumel.agents.presence", {
      storage_schema_version: 1,
      owner_session_id: "session-entry-smoke",
    }),
  ]),
  "taumel.agents.presence",
);
assert.equal(presenceLatest.kind, "contract_valid");
assert.equal(
  presenceLatest.kind === "contract_valid" && presenceLatest.entry.data.owner_session_id,
  "session-entry-smoke",
  "presence marker lookup must use the latest entry",
);

const legacy = latestTaumelCustomEntry(
  manager([{ type: "taumel.permissions", value: permissions }]),
  "taumel.permissions",
);
assert.equal(legacy.kind, "absent");

const tombstone = latestTaumelCustomEntry(
  manager([persisted("taumel.goal", null)]),
  "taumel.goal",
);
assert.equal(tombstone.kind, "contract_valid");
assert.equal(tombstone.kind === "contract_valid" && tombstone.entry.data, null);

const unavailable = latestTaumelCustomEntry(
  { getEntries: () => { throw new Error("stale"); } },
  "taumel.childSession",
);
assert.equal(unavailable.kind, "unavailable");

const malformedMarker = latestTaumelCustomEntry(
  manager([persisted("taumel.childSession", { kind: "agent" })]),
  "taumel.childSession",
);
assert.equal(malformedMarker.kind, "invalid");
assert.equal(isCanonicalEntryPresent(malformedMarker), true);

for (const invalid of [
  { type: "custom", customType: "taumel.unknown", data: {} },
  { type: "custom", customType: "taumel.permissions", data: { kind: "ralph" } },
  { customType: "taumel.goal", data: null },
  wire(persisted("taumel.cron", {
    version: 1, enabled: true,
    tasks: [{
      id: "x", cron: "bad", prompt: "", recurring: true, mode: "message",
      enabled: true, createdAt: -1, nextDue: 1,
    }],
  })),
  wire(persisted("taumel.cron", {
    version: 1, enabled: true,
    tasks: [
      { id: "aaaaaaaa", cron: "* * * * *", prompt: "one", recurring: true, mode: "message", enabled: true, createdAt: 0, nextDue: 60 },
      { id: "aaaaaaaa", cron: "* * * * *", prompt: "two", recurring: true, mode: "message", enabled: true, createdAt: 0, nextDue: 60 },
    ],
  })),
  wire(persisted("taumel.cron", {
    version: 1, enabled: true,
    tasks: [{
      id: "aaaaaaaa", cron: "* * * * *", prompt: "one", recurring: true,
      mode: "message", enabled: true, createdAt: 60, nextDue: 60,
    }],
  })),
]) {
  assert.throws(() => decodeSessionCustomEntry(invalid));
}

console.log("session entry contract smoke: all assertions passed");
