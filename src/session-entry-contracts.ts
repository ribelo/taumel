import Type, { type Static, type TSchema } from "typebox";

export const ToolAllowlistSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("all") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("only"), names: Type.Array(Type.String()) },
    { additionalProperties: false },
  ),
], { $id: "ToolAllowlist" });

export const CapabilityProfileSchema = Type.Object({
  modelId: Type.String(),
  thinkingLevel: Type.String(),
  sandboxPreset: Type.Union([
    Type.Literal("read-only"), Type.Literal("workspace-write"), Type.Literal("danger-full-access"),
  ]),
  approvalPolicy: Type.Union([
    Type.Literal("never"), Type.Literal("on-request"), Type.Literal("on-failure"), Type.Literal("untrusted"),
  ]),
  tools: ToolAllowlistSchema,
  noSandboxAllowed: Type.Boolean(),
}, { $id: "CapabilityProfile", additionalProperties: false });
export type CapabilityProfile = Static<typeof CapabilityProfileSchema>;

export const SharedWorkspaceBindingSchema = Type.Object(
  { variant: Type.Literal("shared"), source_root: Type.String({ minLength: 1 }) },
  { $id: "SharedWorkspaceBinding", additionalProperties: false },
);
export const WorktreeWorkspaceBindingSchema = Type.Object(
  {
    variant: Type.Literal("worktree"),
    source_origin: Type.String({ minLength: 1 }),
    main_repository_root: Type.String({ minLength: 1 }),
    main_repository_id: Type.String({ minLength: 1 }),
  },
  { $id: "WorktreeWorkspaceBinding", additionalProperties: false },
);

const ChildAgentMetadataFields = {
  kind: Type.Literal("agent"),
  agentKind: Type.Union([Type.Literal("generic"), Type.Literal("finder"), Type.Literal("oracle")]),
  agentId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  thinkingLevel: Type.String({ minLength: 1 }),
  activeTools: Type.Array(Type.String({ minLength: 1 })),
  capabilityProfile: CapabilityProfileSchema,
  networkMode: Type.Union([Type.Literal("disabled"), Type.Literal("enabled")]),
  isolated_child: Type.Literal(true),
  workspaceDirectory: Type.String({ minLength: 1 }),
  sourceWorkspace: Type.String({ minLength: 1 }),
  childSessionFile: Type.Optional(Type.String({ minLength: 1 })),
};
const RalphMetadataFields = {
  kind: Type.Literal("ralph"),
  objective: Type.String({ minLength: 1 }),
  controllerSessionId: Type.String({ minLength: 1 }),
  maxIterations: Type.Union([Type.Integer({ minimum: 1, maximum: 2147483647 }), Type.Null()]),
  reflectionEvery: Type.Union([Type.Integer({ minimum: 1, maximum: 2147483647 }), Type.Null()]),
  activeTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  capabilityProfile: Type.Optional(CapabilityProfileSchema),
};
const OwnershipFields = {
  parentSessionId: Type.Union([Type.String(), Type.Null()]),
  parentSessionFile: Type.Union([Type.String(), Type.Null()]),
};

export const SharedAgentSessionMetadataSchema = Type.Object(
  { ...ChildAgentMetadataFields, isolation: Type.Literal("none"), workspaceBinding: SharedWorkspaceBindingSchema },
  { $id: "SharedAgentSessionMetadata", additionalProperties: false },
);
export const WorktreeAgentSessionMetadataSchema = Type.Object(
  {
    ...ChildAgentMetadataFields,
    isolation: Type.Literal("worktree"),
    workspaceBinding: WorktreeWorkspaceBindingSchema,
    worktreePath: Type.String({ minLength: 1 }),
    worktreeBranch: Type.String({ minLength: 1 }),
    mainRepositoryRoot: Type.String({ minLength: 1 }),
  },
  { $id: "WorktreeAgentSessionMetadata", additionalProperties: false },
);
export const RalphSessionMetadataSchema = Type.Object(
  RalphMetadataFields,
  { $id: "RalphSessionMetadata", additionalProperties: false },
);
export const AgentSessionMetadataSchema = Type.Union(
  [SharedAgentSessionMetadataSchema, WorktreeAgentSessionMetadataSchema],
  { $id: "AgentSessionMetadata" },
);
export const ChildSessionMetadataSchema = Type.Union(
  [RalphSessionMetadataSchema, SharedAgentSessionMetadataSchema, WorktreeAgentSessionMetadataSchema],
  { $id: "ChildSessionMetadata" },
);
export type ChildSessionMetadata = Static<typeof ChildSessionMetadataSchema>;

const SharedAgentSessionMarkerSchema = Type.Object(
  { ...ChildAgentMetadataFields, isolation: Type.Literal("none"), workspaceBinding: SharedWorkspaceBindingSchema, ...OwnershipFields },
  { additionalProperties: false },
);
const WorktreeAgentSessionMarkerSchema = Type.Object(
  {
    ...ChildAgentMetadataFields,
    isolation: Type.Literal("worktree"),
    workspaceBinding: WorktreeWorkspaceBindingSchema,
    worktreePath: Type.String({ minLength: 1 }),
    worktreeBranch: Type.String({ minLength: 1 }),
    mainRepositoryRoot: Type.String({ minLength: 1 }),
    ...OwnershipFields,
  },
  { additionalProperties: false },
);
const RalphSessionMarkerSchema = Type.Object(
  { ...RalphMetadataFields, ...OwnershipFields },
  { additionalProperties: false },
);
export const ChildSessionMarkerSchema = Type.Union(
  [RalphSessionMarkerSchema, SharedAgentSessionMarkerSchema, WorktreeAgentSessionMarkerSchema],
  { $id: "ChildSessionMarker" },
);
export type ChildSessionMarker = Static<typeof ChildSessionMarkerSchema>;

export const PermissionsStateV1Schema = Type.Object({
  version: Type.Literal(1),
  profile: CapabilityProfileSchema,
  networkMode: Type.Union([Type.Literal("disabled"), Type.Literal("enabled")]),
  noSandbox: Type.Boolean(),
  isolated_child: Type.Boolean(),
}, { $id: "PermissionsStateV1", additionalProperties: false });
export type PermissionsStateV1 = Static<typeof PermissionsStateV1Schema>;

const VisibilityCategorySchema = Type.Object(
  { disabled: Type.Array(Type.String()) },
  { additionalProperties: false },
);
export const VisibilityStateV1Schema = Type.Object({
  version: Type.Literal(1), tools: VisibilityCategorySchema, skills: VisibilityCategorySchema,
}, { $id: "VisibilityStateV1", additionalProperties: false });
export type VisibilityStateV1 = Static<typeof VisibilityStateV1Schema>;

export const GoalStateSchema = Type.Union([
  Type.Null(),
  Type.Object({
    goalId: Type.String({ minLength: 1 }),
    sessionId: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("active"), Type.Literal("paused"), Type.Literal("blocked"),
      Type.Literal("usage_limited"), Type.Literal("time_limited"), Type.Literal("complete"),
    ]),
    tokensUsed: Type.Integer({ minimum: 0 }),
    timeUsedSeconds: Type.Integer({ minimum: 0 }),
    timeLimitSeconds: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
], { $id: "GoalState" });
export type GoalState = Static<typeof GoalStateSchema>;

export const GoalAutomationStateSchema = Type.Union([
  Type.Null(),
  Type.Object(
    { continuation: Type.Literal("interrupted"), requiresUserInput: Type.Literal(true) },
    { additionalProperties: false },
  ),
], { $id: "GoalAutomationState" });
export type GoalAutomationState = Static<typeof GoalAutomationStateSchema>;

const RalphTaskSchema = Type.Object({
  id: Type.String(), objective: Type.String(), controllerSession: Type.String(),
  childSession: Type.Union([Type.String(), Type.Null()]),
  iteration: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  maxIterations: Type.Union([Type.Integer({ minimum: 1, maximum: 2147483647 }), Type.Null()]),
  reflectionEvery: Type.Union([Type.Integer({ minimum: 1, maximum: 2147483647 }), Type.Null()]),
  status: Type.Union([
    Type.Literal("running"), Type.Literal("paused"), Type.Literal("finished"), Type.Literal("archived"),
  ]),
}, { additionalProperties: false });
export const RalphStateV1Schema = Type.Object(
  { version: Type.Literal(1), tasks: Type.Array(RalphTaskSchema) },
  { $id: "RalphStateV1", additionalProperties: false },
);
export type RalphStateV1 = Static<typeof RalphStateV1Schema>;

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInteger = Type.Union([
  Type.Integer({ minimum: -2147483648, maximum: 2147483647 }), Type.Null(),
]);
const AgentIdentitySchema = Type.Object({
  agent_id: Type.String(), owner_session_id: Type.String(), issued_run_count: Type.Integer({ minimum: 1, maximum: 2147483647 }),
  kind: Type.Union([Type.Literal("generic"), Type.Literal("finder"), Type.Literal("oracle")]),
  effort: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Null()]),
  model: Type.String(), thinking: Type.String(), active_tools: Type.Array(Type.String()),
  permission_ceiling: CapabilityProfileSchema, network_allowed: Type.Boolean(),
  workspace_binding: Type.Union([SharedWorkspaceBindingSchema, WorktreeWorkspaceBindingSchema]),
  child_session_file: NullableString, child_session_id: NullableString,
  created_at: Type.Integer({ minimum: -2147483648, maximum: 2147483647 }),
}, { additionalProperties: false });
const AgentRunSchema = Type.Object({
  run_id: Type.String(), agent_id: Type.String(),
  status: Type.Union([
    Type.Literal("running"), Type.Literal("suspended"), Type.Literal("completed"),
    Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("lost"),
  ]),
  reason_code: Type.Union([
    Type.Literal("interrupted_by_parent"), Type.Literal("parent_shutdown"),
    Type.Literal("process_interrupted"), Type.Literal("close_cleanup_failed"),
    Type.Literal("host_cancelled"), Type.Literal("dispatch_failed"), Type.Literal("agent_failed"),
    Type.Literal("internal_error"), Type.Literal("child_session_lost"), Type.Null(),
  ]),
  error: NullableString, output_available: Type.Boolean(),
  announcement: Type.Union([
    Type.Literal("pending"), Type.Literal("observed_by_agent_wait"), Type.Literal("notification_sent"),
  ]),
  started_at: Type.Integer({ minimum: -2147483648, maximum: 2147483647 }),
  ended_at: NullableInteger, suspended_at: NullableInteger,
  submission_id: Type.String(), result_entry_id: NullableString,
  previous_assistant_entry_id: NullableString, description: Type.String(),
  turn_count: Type.Integer({ minimum: 0, maximum: 2147483647 }), last_activity_at: NullableInteger,
  activity_state: Type.Union([
    Type.Literal("starting"), Type.Literal("reasoning"), Type.Literal("using_tool"),
    Type.Literal("orphaned"), Type.Literal("inactive"),
  ]),
  active_tool_count: Type.Integer({ minimum: 0, maximum: 2147483647 }),
}, { additionalProperties: false });
const AgentCleanupPendingSchema = Type.Object({
  owner_session_id: Type.String(), agent_id: Type.String(), cleanup_nonce: Type.String(),
  remaining_artifacts: Type.Array(Type.String()),
}, { additionalProperties: false });
export const AgentsStateV6Schema = Type.Object({
  version: Type.Literal(6),
  issued_identity_counts: Type.Object(
    {
      agent: Type.Integer({ minimum: 0, maximum: 2147483647 }),
      finder: Type.Integer({ minimum: 0, maximum: 2147483647 }),
      oracle: Type.Integer({ minimum: 0, maximum: 2147483647 }),
      issued_ids: Type.Array(
        Type.String({ pattern: "^(?:agent|finder|oracle)-[abcdefghjkmnpqrstuvwxyz23456789]{4}$" }),
        { uniqueItems: true },
      ),
    },
    { additionalProperties: false },
  ),
  identities: Type.Array(AgentIdentitySchema), runs: Type.Array(AgentRunSchema),
  cleanup_pending: Type.Array(AgentCleanupPendingSchema),
}, { $id: "AgentsStateV6", additionalProperties: false });
export type AgentsStateV6 = Static<typeof AgentsStateV6Schema>;

export const AgentsPresenceMarkerSchema = Type.Object({
  storage_schema_version: Type.Literal(1),
  owner_session_id: Type.String({ minLength: 1 }),
}, { $id: "AgentsPresenceMarker", additionalProperties: false });
export type AgentsPresenceMarker = Static<typeof AgentsPresenceMarkerSchema>;

const CronTaskSchema = Type.Object({
  id: Type.String({ pattern: "^[0-9a-f]{8}$" }),
  cron: Type.String({ pattern: "^\\S+(?:\\s+\\S+){4}$" }),
  prompt: Type.String({ pattern: "\\S" }), recurring: Type.Boolean(),
  mode: Type.Union([Type.Literal("message"), Type.Literal("goal")]), enabled: Type.Boolean(),
  createdAt: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  nextDue: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  pendingSince: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
}, { additionalProperties: false });
export const CronStateSchema = Type.Object(
  { version: Type.Literal(1), enabled: Type.Boolean(), tasks: Type.Array(CronTaskSchema) },
  { $id: "CronState", additionalProperties: false },
);
export type CronState = Static<typeof CronStateSchema>;

const setupEntry = <K extends string, S extends TSchema>(customType: K, data: S) =>
  Type.Object({ customType: Type.Literal(customType), data }, { additionalProperties: false });
const persistedEntry = <K extends string, S extends TSchema>(customType: K, data: S) =>
  Type.Object({ type: Type.Literal("custom"), customType: Type.Literal(customType), data }, { additionalProperties: false });

export const ChildSessionSetupEntrySchema = Type.Union([
  setupEntry("taumel.childSession", ChildSessionMarkerSchema),
  setupEntry("taumel.permissions", PermissionsStateV1Schema),
  setupEntry("taumel.goal", GoalStateSchema),
  setupEntry("taumel.goal_automation", GoalAutomationStateSchema),
], { $id: "ChildSessionSetupEntry" });
export type ChildSessionSetupEntry = Static<typeof ChildSessionSetupEntrySchema>;

export const TaumelPersistedCustomEntrySchema = Type.Union([
  persistedEntry("taumel.childSession", ChildSessionMarkerSchema),
  persistedEntry("taumel.permissions", PermissionsStateV1Schema),
  persistedEntry("taumel.visibility", VisibilityStateV1Schema),
  persistedEntry("taumel.goal", GoalStateSchema),
  persistedEntry("taumel.goal_automation", GoalAutomationStateSchema),
  persistedEntry("taumel.ralph", RalphStateV1Schema),
  persistedEntry("taumel.agents.v4", AgentsStateV6Schema),
  persistedEntry("taumel.agents.presence", AgentsPresenceMarkerSchema),
  persistedEntry("taumel.cron", CronStateSchema),
], { $id: "TaumelPersistedCustomEntry" });
export type AnyPersistedTaumelCustomEntry = Static<typeof TaumelPersistedCustomEntrySchema>;

export interface TaumelCustomEntryDataMap {
  readonly "taumel.childSession": ChildSessionMarker;
  readonly "taumel.permissions": PermissionsStateV1;
  readonly "taumel.visibility": VisibilityStateV1;
  readonly "taumel.goal": GoalState;
  readonly "taumel.goal_automation": GoalAutomationState;
  readonly "taumel.ralph": RalphStateV1;
  readonly "taumel.agents.v4": AgentsStateV6;
  readonly "taumel.agents.presence": AgentsPresenceMarker;
  readonly "taumel.cron": CronState;
}
export type TaumelCustomType = keyof TaumelCustomEntryDataMap;
export type PersistedTaumelCustomEntry<K extends TaumelCustomType> = Readonly<{
  type: "custom";
  customType: K;
  data: TaumelCustomEntryDataMap[K];
}>;
