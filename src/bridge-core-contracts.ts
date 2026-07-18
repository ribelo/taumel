import Type, { type Static } from "typebox";
import { ChildSessionMetadataSchema, ChildSessionSetupEntrySchema, PermissionsStateV1Schema, type ChildSessionMetadata } from "./session-entry-contracts.ts";
import { ApplyPatchParamsSchema, EditReplacementSchema } from "./tool-contracts.ts";
export { ChildSessionMetadataSchema, ChildSessionSetupEntrySchema, PermissionsStateV1Schema, type ChildSessionMetadata };
/** Transport contracts for values returned by OCaml to the Pi adapter. */
export const ActiveToolsSyncFactsSchema = Type.Object(
  { tools: Type.Array(Type.String()), ctx: Type.Optional(Type.Unknown()) },
  { $id: "ActiveToolsSyncFacts", additionalProperties: false },
);
export const ActiveToolsPlanSchema = Type.Object(
  {
    changed: Type.Boolean(),
    tools: Type.Array(Type.String()),
  },
  { $id: "ActiveToolsPlan", additionalProperties: false },
);

export type ActiveToolsPlan = Static<typeof ActiveToolsPlanSchema>;

export const ChildPermissionRefreshPlanSchema = Type.Object(
  { permissions: PermissionsStateV1Schema },
  { $id: "ChildPermissionRefreshPlan", additionalProperties: false },
);
export type ChildPermissionRefreshPlan = Static<typeof ChildPermissionRefreshPlanSchema>;

export const CommandSpecSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.String(),
  },
  { $id: "CommandSpec", additionalProperties: false },
);

export const CommandSpecsResultSchema = Type.Object(
  { specs: Type.Array(CommandSpecSchema) },
  { $id: "CommandSpecsResult", additionalProperties: false },
);

export type CommandSpecsResult = Static<typeof CommandSpecsResultSchema>;

export const ToolNamesResultSchema = Type.Object(
  { names: Type.Array(Type.String({ minLength: 1 })) },
  { $id: "ToolNamesResult", additionalProperties: false },
);

export type ToolNamesResult = Static<typeof ToolNamesResultSchema>;

export const ThreadCatalogFactsSchema = Type.Object(
  { cwd: Type.String(), home: Type.String(), override: Type.Optional(Type.String()) },
  { $id: "ThreadCatalogFacts", additionalProperties: false },
);

export const ThreadCatalogScanSchema = Type.Object(
  {
    root: Type.String({ minLength: 1 }),
    maxDepth: Type.Integer({ minimum: 0 }),
    maxFiles: Type.Integer({ minimum: 1 }),
    suffix: Type.String({ minLength: 1 }),
  },
  { $id: "ThreadCatalogScan", additionalProperties: false },
);

export const ThreadCatalogScansResultSchema = Type.Object(
  { scans: Type.Array(ThreadCatalogScanSchema) },
  { $id: "ThreadCatalogScansResult", additionalProperties: false },
);

export type ThreadCatalogFacts = Static<typeof ThreadCatalogFactsSchema>;
export type ThreadCatalogScan = Static<typeof ThreadCatalogScanSchema>;
export type ThreadCatalogScansResult = Static<typeof ThreadCatalogScansResultSchema>;

export const ExecNotificationSchema = Type.Object(
  {
    sessionId: Type.Integer({ minimum: 0 }),
    customType: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
    display: Type.Boolean(),
  },
  { $id: "ExecNotification", additionalProperties: false },
);

export const PendingExecNotificationsResultSchema = Type.Object(
  { notifications: Type.Array(ExecNotificationSchema) },
  { $id: "PendingExecNotificationsResult", additionalProperties: false },
);

export const ExecNotificationClaimedSchema = Type.Object(
  {
    kind: Type.Literal("claimed"),
    sessionId: Type.Integer({ minimum: 0 }),
    customType: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
    display: Type.Boolean(),
  },
  { $id: "ExecNotificationClaimed", additionalProperties: false },
);

export const ExecNotificationUnavailableSchema = Type.Object(
  { kind: Type.Literal("unavailable") },
  { $id: "ExecNotificationUnavailable", additionalProperties: false },
);

export const ExecNotificationClaimSchema = Type.Union([
  ExecNotificationClaimedSchema,
  ExecNotificationUnavailableSchema,
]);

export type PendingExecNotificationsResult = Static<typeof PendingExecNotificationsResultSchema>;
export type ExecNotificationClaim = Static<typeof ExecNotificationClaimSchema>;

export const OpenAiUsageHostAuthSchema = Type.Object(
  {
    providerKey: Type.String({ minLength: 1 }),
    credentialKey: Type.String({ minLength: 1 }),
    source: Type.String({ minLength: 1 }),
  },
  { $id: "OpenAiUsageHostAuth", additionalProperties: false },
);

export const OpenAiUsageHostLookupFactsSchema = Type.Object(
  {
    apiKeyPresent: Type.Boolean(),
    credential: Type.Optional(Type.Unknown()),
    token: Type.Optional(Type.String()),
    tokenError: Type.Optional(Type.String()),
  },
  { $id: "OpenAiUsageHostLookupFacts", additionalProperties: false },
);

const hostParamsBase = {
  apiKeyPresent: Type.Boolean(),
  credential: Type.Optional(Type.Unknown()),
};

export const OpenAiUsageHostParamsPresentSchema = Type.Object(
  { ...hostParamsBase, tokenState: Type.Literal("present"), token: Type.String({ minLength: 1 }) },
  { $id: "OpenAiUsageHostParamsPresent", additionalProperties: false },
);
export const OpenAiUsageHostParamsMissingSchema = Type.Object(
  { ...hostParamsBase, tokenState: Type.Literal("missing") },
  { $id: "OpenAiUsageHostParamsMissing", additionalProperties: false },
);
export const OpenAiUsageHostParamsErrorSchema = Type.Object(
  { ...hostParamsBase, tokenState: Type.Literal("error"), tokenError: Type.String({ minLength: 1 }) },
  { $id: "OpenAiUsageHostParamsError", additionalProperties: false },
);
export const OpenAiUsageHostParamsSchema = Type.Union([
  OpenAiUsageHostParamsPresentSchema,
  OpenAiUsageHostParamsMissingSchema,
  OpenAiUsageHostParamsErrorSchema,
], { $id: "OpenAiUsageHostParams" });

export type OpenAiUsageHostAuth = Static<typeof OpenAiUsageHostAuthSchema>;
export type OpenAiUsageHostLookupFacts = Static<typeof OpenAiUsageHostLookupFactsSchema>;
export type OpenAiUsageHostParams = Static<typeof OpenAiUsageHostParamsSchema>;

export const ExecPolicyScopeSchema = Type.Object(
  { scope: Type.String({ minLength: 1 }), execPolicy: Type.Unknown() },
  { $id: "ExecPolicyScope", additionalProperties: false },
);
export const RefreshExecPolicyFactsSchema = Type.Object(
  { scopes: Type.Array(ExecPolicyScopeSchema) },
  { $id: "RefreshExecPolicyFacts", additionalProperties: false },
);
export const RefreshExecPolicyResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    activeRuleCount: Type.Integer({ minimum: 0 }),
    scopes: Type.Array(Type.String()),
    errors: Type.Array(Type.String()),
  },
  { $id: "RefreshExecPolicyResult", additionalProperties: false },
);
export type ExecPolicyScope = Static<typeof ExecPolicyScopeSchema>;
export type RefreshExecPolicyFacts = Static<typeof RefreshExecPolicyFactsSchema>;
export type RefreshExecPolicyResult = Static<typeof RefreshExecPolicyResultSchema>;

export const SkillListFactsSchema = Type.Object(
  { cwd: Type.String(), includeDisabled: Type.Optional(Type.Boolean()) },
  { $id: "SkillListFacts", additionalProperties: false },
);
export const SkillInfoSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }), location: Type.String({ minLength: 1 }),
    baseDir: Type.String(), description: Type.String(),
  },
  { $id: "SkillInfo", additionalProperties: false },
);
export const SkillListResultSchema = Type.Object(
  { skills: Type.Array(SkillInfoSchema) },
  { $id: "SkillListResult", additionalProperties: false },
);
export const SkillResolveFactsSchema = Type.Object(
  { prompt: Type.String(), cwd: Type.String(), ctx: Type.Optional(Type.Unknown()) },
  { $id: "SkillResolveFacts", additionalProperties: false },
);
export const SkillBlockSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }), location: Type.String({ minLength: 1 }),
    baseDir: Type.String(), content: Type.String({ minLength: 1 }),
  },
  { $id: "SkillBlock", additionalProperties: false },
);
export const BridgeWarningSchema = Type.Object(
  { message: Type.String({ minLength: 1 }) },
  { $id: "BridgeWarning", additionalProperties: false },
);
export const SkillResolveResultSchema = Type.Object(
  { blocks: Type.Array(SkillBlockSchema), warnings: Type.Array(BridgeWarningSchema) },
  { $id: "SkillResolveResult", additionalProperties: false },
);
export type SkillListResult = Static<typeof SkillListResultSchema>;
export type SkillResolveResult = Static<typeof SkillResolveResultSchema>;

export const EnvironmentContextFactsSchema = Type.Object(
  { shell: Type.String() },
  { $id: "EnvironmentContextFacts", additionalProperties: false },
);
export const EnvironmentContextNoneSchema = Type.Object(
  { kind: Type.Literal("none") },
  { $id: "EnvironmentContextNone", additionalProperties: false },
);
export const EnvironmentContextInjectSchema = Type.Object(
  {
    kind: Type.Literal("inject"), customType: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }), display: Type.Boolean(),
  },
  { $id: "EnvironmentContextInject", additionalProperties: false },
);
export const EnvironmentContextPlanSchema = Type.Union([
  EnvironmentContextNoneSchema,
  EnvironmentContextInjectSchema,
]);
export type EnvironmentContextPlan = Static<typeof EnvironmentContextPlanSchema>;

export const CommandNotificationFactsSchema = Type.Object(
  {
    commandName: Type.String({ minLength: 1 }), ok: Type.Boolean(),
    message: Type.String(), error: Type.String(), uiAvailable: Type.Boolean(),
  },
  { $id: "CommandNotificationFacts", additionalProperties: false },
);
export const CommandNotificationUnavailableSchema = Type.Object(
  { kind: Type.Literal("unavailable") },
  { $id: "CommandNotificationUnavailable", additionalProperties: false },
);
export const CommandNotificationSendSchema = Type.Object(
  {
    kind: Type.Literal("notify"), message: Type.String({ minLength: 1 }),
    level: Type.Union([Type.Literal("info"), Type.Literal("warning")]),
  },
  { $id: "CommandNotificationSend", additionalProperties: false },
);
export const CommandNotificationPlanSchema = Type.Union([
  CommandNotificationUnavailableSchema, CommandNotificationSendSchema,
]);
export type CommandNotificationPlan = Static<typeof CommandNotificationPlanSchema>;

export const GoalContinuationFactsSchema = Type.Object(
  {
    initial: Type.Boolean(), hostIdle: Type.Boolean(), hasPendingMessages: Type.Boolean(),
    retrying: Type.Boolean(), compacting: Type.Boolean(), latestAssistantStopReason: Type.Optional(Type.String({ minLength: 1 })),
    ctx: Type.Optional(Type.Unknown()),
  },
  { $id: "GoalContinuationFacts", additionalProperties: false },
);
export const GoalContinuationNoneSchema = Type.Object(
  { kind: Type.Literal("none") },
  { $id: "GoalContinuationNone", additionalProperties: false },
);
export const GoalContinuationSendSchema = Type.Object(
  {
    kind: Type.Literal("send"), customType: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }), display: Type.Boolean(),
    triggerTurn: Type.Boolean(), deliverAs: Type.String({ minLength: 1 }),
    details: Type.Unknown(),
  },
  { $id: "GoalContinuationSend", additionalProperties: false },
);
export const GoalContinuationPlanSchema = Type.Union([
  GoalContinuationNoneSchema, GoalContinuationSendSchema,
]);
export type GoalContinuationFacts = Static<typeof GoalContinuationFactsSchema>;
export type GoalContinuationPlan = Static<typeof GoalContinuationPlanSchema>;
export const ChildGoalContinuationSendSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("send_goal_continuation"),
    customType: Type.String({ minLength: 1 }), content: Type.String({ minLength: 1 }),
    display: Type.Boolean(), triggerTurn: Type.Boolean(), deliverAs: Type.String({ minLength: 1 }),
  },
  { $id: "ChildGoalContinuationSend", additionalProperties: false },
);
export const ChildGoalContinuationFinalizeSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("finalize"),
    status: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "ChildGoalContinuationFinalize", additionalProperties: false },
);

export const ChildSessionStartFactsSchema = Type.Object(
  {
    metadata: ChildSessionMetadataSchema, parentSessionId: Type.Optional(Type.String()),
    parentSessionFile: Type.Optional(Type.String()),
  },
  { $id: "ChildSessionStartFacts", additionalProperties: false },
);
export const ChildSessionStartPlanSchema = Type.Object(
  {
    parentSession: Type.Optional(Type.String({ minLength: 1 })),
    modelId: Type.Optional(Type.String({ minLength: 1 })),
    thinkingLevel: Type.Optional(Type.String({ minLength: 1 })),
    activeTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    privateSessionDirectory: Type.Optional(Type.String({ minLength: 1 })),
    setupEntries: Type.Array(ChildSessionSetupEntrySchema),
  },
  { $id: "ChildSessionStartPlan", additionalProperties: false },
);
export type ChildSessionStartPlan = Static<typeof ChildSessionStartPlanSchema>;
export type ChildSessionSetupEntry = Static<typeof ChildSessionSetupEntrySchema>;

export const ChildDispatchFactsSchema = Type.Object(
  {
    available: Type.Boolean(), cancelled: Type.Optional(Type.Boolean()),
    sessionId: Type.Optional(Type.String()), sessionFile: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()), missingSessionIdentifier: Type.Optional(Type.Boolean()),
    activeTools: Type.Optional(Type.Array(Type.String())), activeToolsApplied: Type.Optional(Type.Boolean()),
    modelId: Type.Optional(Type.String()), modelApplied: Type.Optional(Type.Boolean()),
    thinkingLevel: Type.Optional(Type.String()), thinkingApplied: Type.Optional(Type.Boolean()),
    prompt: Type.String(), emptyReason: Type.String({ minLength: 1 }),
    sendAvailable: Type.Boolean(), deliverAs: Type.Optional(Type.String()),
  },
  { $id: "ChildDispatchFacts", additionalProperties: false },
);
export const ChildDispatchCompletionSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("completed"), Type.Literal("failed"),
      Type.Literal("cancelled"), Type.Literal("timed_out"),
    ]),
    finalOutput: Type.Optional(Type.String()), reason: Type.Optional(Type.String()),
  },
  { $id: "ChildDispatchCompletion", additionalProperties: false },
);
export const ChildDispatchResultSchema = Type.Object(
  {
    dispatched: Type.Boolean(), reason: Type.Optional(Type.String()),
    sessionId: Type.Optional(Type.String()), completion: Type.Optional(ChildDispatchCompletionSchema),
  },
  { $id: "ChildDispatchResult", additionalProperties: false },
);
export const ChildDispatchPlanSchema = Type.Object(
  {
    send: Type.Boolean(), prompt: Type.String(), deliverAs: Type.String(), result: ChildDispatchResultSchema,
  },
  { $id: "ChildDispatchPlan", additionalProperties: false },
);
export type ChildDispatchFacts = Static<typeof ChildDispatchFactsSchema>;
export type ChildDispatchPlan = Static<typeof ChildDispatchPlanSchema>;
export type ChildDispatchResult = Static<typeof ChildDispatchResultSchema>;
export type ChildDispatchCompletion = Static<typeof ChildDispatchCompletionSchema>;

export const SandboxHostPathFactsSchema = Type.Object(
  { tmpDir: Type.String(), envTmpDir: Type.String() },
  { $id: "SandboxHostPathFacts", additionalProperties: false },
);
export const SandboxHostPathPlanSchema = Type.Object(
  {
    tempRootCandidates: Type.Array(Type.String({ minLength: 1 })),
    systemRoPathCandidates: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: "SandboxHostPathPlan", additionalProperties: false },
);
export type SandboxHostPathPlan = Static<typeof SandboxHostPathPlanSchema>;

export const ResolvedMutationPathSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), resolvedPath: Type.String({ minLength: 1 }) },
  { $id: "ResolvedMutationPath", additionalProperties: false },
);
export const WorkspaceMutationFactsSchema = Type.Object(
  {
    workspaceRoots: Type.Array(Type.String({ minLength: 1 })),
    paths: Type.Array(ResolvedMutationPathSchema),
  },
  { $id: "WorkspaceMutationFacts", additionalProperties: false },
);
export const WorkspaceMutationValidSchema = Type.Object(
  { kind: Type.Literal("valid") },
  { $id: "WorkspaceMutationValid", additionalProperties: false },
);
export const WorkspaceMutationInvalidSchema = Type.Object(
  { kind: Type.Literal("invalid"), message: Type.String({ minLength: 1 }) },
  { $id: "WorkspaceMutationInvalid", additionalProperties: false },
);
export const WorkspaceMutationValidationSchema = Type.Union([
  WorkspaceMutationValidSchema, WorkspaceMutationInvalidSchema,
]);
export type WorkspaceMutationFacts = Static<typeof WorkspaceMutationFactsSchema>;
export type WorkspaceMutationValidation = Static<typeof WorkspaceMutationValidationSchema>;

export const ExecPolicyAllowRuleFactsSchema = Type.Object(
  { tokens: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) },
  { $id: "ExecPolicyAllowRuleFacts", additionalProperties: false },
);
export const ExecPolicyAllowRuleResultSchema = Type.Object(
  { activeRuleCount: Type.Integer({ minimum: 0 }) },
  { $id: "ExecPolicyAllowRuleResult", additionalProperties: false },
);
export type ExecPolicyAllowRuleResult = Static<typeof ExecPolicyAllowRuleResultSchema>;

export const ExecApprovalPromptFactsSchema = Type.Object(
  {
    approvalTitle: Type.String(), approvalPrompt: Type.String(),
    approvalTimeoutMs: Type.Number({ minimum: 0 }), uiAvailable: Type.Boolean(),
  },
  { $id: "ExecApprovalPromptFacts", additionalProperties: false },
);
export const ExecApprovalUnavailableSchema = Type.Object(
  { kind: Type.Literal("unavailable") },
  { $id: "ExecApprovalUnavailable", additionalProperties: false },
);
export const ExecApprovalConfirmSchema = Type.Object(
  {
    kind: Type.Literal("confirm"), title: Type.String(), prompt: Type.String(),
    timeoutMs: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  },
  { $id: "ExecApprovalConfirm", additionalProperties: false },
);
export const ExecApprovalPromptPlanSchema = Type.Union([
  ExecApprovalUnavailableSchema, ExecApprovalConfirmSchema,
]);
export type ExecApprovalPromptPlan = Static<typeof ExecApprovalPromptPlanSchema>;

export const CommandExecutionFactsSchema = Type.Object(
  { name: Type.String({ minLength: 1 }), args: Type.String(), ctx: Type.Optional(Type.Unknown()) },
  { $id: "CommandExecutionFacts", additionalProperties: false },
);
export const CommandContextOverrideSchema = Type.Object(
  { name: Type.String({ minLength: 1 }), value: Type.String() },
  { $id: "CommandContextOverride", additionalProperties: false },
);
export const CommandExecutionErrorSchema = Type.Object(
  { kind: Type.Literal("error"), message: Type.String({ minLength: 1 }) },
  { $id: "CommandExecutionError", additionalProperties: false },
);
export const CommandExecutionDirectSchema = Type.Object(
  { kind: Type.Literal("direct") },
  { $id: "CommandExecutionDirect", additionalProperties: false },
);
export const CommandExecutionChildSchema = Type.Object(
  {
    kind: Type.Literal("child"), metadata: ChildSessionMetadataSchema,
    contextOverrides: Type.Array(CommandContextOverrideSchema),
    activeToolsMode: Type.String({ minLength: 1 }),
    childSessionContextKey: Type.String(),
  },
  { $id: "CommandExecutionChild", additionalProperties: false },
);
export const CommandExecutionPlanSchema = Type.Union([
  CommandExecutionErrorSchema, CommandExecutionDirectSchema, CommandExecutionChildSchema,
]);
export type CommandExecutionPlan = Static<typeof CommandExecutionPlanSchema>;

export const CommandChildSessionFactsSchema = Type.Object(
  {
    metadata: ChildSessionMetadataSchema, activeToolsMode: Type.String({ minLength: 1 }),
    currentActiveToolsAvailable: Type.Boolean(),
    currentActiveTools: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: "CommandChildSessionFacts", additionalProperties: false },
);
export const CommandChildSessionPlanSchema = Type.Object(
  { metadata: ChildSessionMetadataSchema },
  { $id: "CommandChildSessionPlan", additionalProperties: false },
);
export type CommandChildSessionPlan = Static<typeof CommandChildSessionPlanSchema>;

export const BridgeToolResultSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("tool_result"),
    text: Type.String(), details: Type.Unknown(),
  },
  { $id: "BridgeToolResult", additionalProperties: false },
);
export type BridgeToolResult = Static<typeof BridgeToolResultSchema>;
export const BridgeErrorResultSchema = Type.Object(
  { ok: Type.Literal(false), error: Type.String({ minLength: 1 }) },
  { $id: "BridgeErrorResult", additionalProperties: false },
);
export const CoreAckSchema = Type.Object(
  { ok: Type.Literal(true) },
  { $id: "CoreAck", additionalProperties: false },
);
export const AgentOwnerContextFactsSchema = Type.Object({ ctx: Type.Unknown() }, { $id: "AgentOwnerContextFacts", additionalProperties: false });
export const AgentActionCapabilityFactsSchema = Type.Object({ capabilityId: Type.String({ minLength: 1 }), agentId: Type.String({ minLength: 1 }), action: Type.String({ pattern: "^agent_(start|send|close)$" }), runId: Type.Optional(Type.String({ minLength: 1 })), submissionId: Type.Optional(Type.String({ minLength: 1 })), ctx: Type.Unknown() }, { $id: "AgentActionCapabilityFacts", additionalProperties: false });
type AgentActionCapabilityBase = { readonly capabilityId: string; readonly agentId: string; readonly ctx: unknown };
export type AgentActionCapabilityFacts = AgentActionCapabilityBase & ({ readonly action: "agent_start"; readonly runId: string; readonly submissionId: string } | { readonly action: "agent_send"; readonly runId: string; readonly submissionId: string } | { readonly action: "agent_send"; readonly runId: string; readonly submissionId?: never } | { readonly action: "agent_send"; readonly runId?: never; readonly submissionId?: never } | { readonly action: "agent_close"; readonly runId?: never; readonly submissionId?: never });
export type CoreAck = Static<typeof CoreAckSchema>;
export const ExecCompletionWaitResultSchema = Type.Object(
  { ok: Type.Literal(true), exited: Type.Boolean() },
  { $id: "ExecCompletionWaitResult", additionalProperties: false },
);
export const BridgeToolExecutionResultSchema = Type.Union([BridgeToolResultSchema, BridgeErrorResultSchema]);
export const ExaExecutionFactsSchema = Type.Object(
  { planId: Type.String({ minLength: 1 }), ctx: Type.Unknown() },
  { $id: "ExaExecutionFacts", additionalProperties: false },
);
export type BridgeToolExecutionResult = Static<typeof BridgeToolExecutionResultSchema>;
export const ToolResultTextContentSchema = Type.Object(
  { type: Type.Literal("text"), text: Type.String() },
  { $id: "ToolResultTextContent", additionalProperties: false },
);
export const ToolResultEnvelopeSchema = Type.Object(
  { content: Type.Array(ToolResultTextContentSchema, { minItems: 1 }), details: Type.Unknown() },
  { $id: "ToolResultEnvelope", additionalProperties: false },
);
export type ToolResultEnvelope = Static<typeof ToolResultEnvelopeSchema>;
export const BridgeCommandResultSchema = Type.Object(
  {
    ok: Type.Boolean(), action: Type.Literal("command_result"),
    message: Type.String(), details: Type.Unknown(),
  },
  { $id: "BridgeCommandResult", additionalProperties: false },
);
export type BridgeCommandResult = Static<typeof BridgeCommandResultSchema>;
export const ReadFileFactsSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }), offset: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1 })), defaultCwd: Type.String(),
  },
  { $id: "ReadFileFacts", additionalProperties: false },
);
export const ViewMediaFactsSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), defaultCwd: Type.String() },
  { $id: "ViewMediaFacts", additionalProperties: false },
);
export const ToolResultImageContentSchema = Type.Object(
  {
    type: Type.Literal("image"), data: Type.String({ minLength: 1 }),
    mimeType: Type.String({ pattern: "^image/" }),
  },
  { $id: "ToolResultImageContent", additionalProperties: false },
);
export const ViewMediaSuccessEnvelopeSchema = Type.Object(
  {
    content: Type.Tuple([ToolResultTextContentSchema, ToolResultImageContentSchema]),
    details: Type.Unknown(),
  },
  { $id: "ViewMediaSuccessEnvelope", additionalProperties: false },
);
export const ViewMediaResultEnvelopeSchema = Type.Union([
  ToolResultEnvelopeSchema, ViewMediaSuccessEnvelopeSchema,
]);
export type ViewMediaResultEnvelope = Static<typeof ViewMediaResultEnvelopeSchema>;
export const WriteStdinFactsSchema = Type.Object(
  {
    sessionId: Type.Integer({ minimum: 1 }), chars: Type.String(),
    outputMode: Type.Optional(Type.Union([Type.Literal("delta"), Type.Literal("status")])),
    yieldTimeMs: Type.Optional(Type.Number({ minimum: 0 })),
    maxOutputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    ownerId: Type.String({ minLength: 1 }), signal: Type.Optional(Type.Unknown()),
  },
  { $id: "WriteStdinFacts", additionalProperties: false },
);
export const ExecTruncationSchema = Type.Object(
  {
    truncated: Type.Boolean(), truncatedBy: Type.String(), totalLines: Type.Integer(),
    totalBytes: Type.Integer(), outputLines: Type.Integer(), outputBytes: Type.Integer(),
    maxLines: Type.Integer(), maxBytes: Type.Integer(), lastLinePartial: Type.Boolean(),
    firstLineExceedsLimit: Type.Boolean(), fullOutputPath: Type.Optional(Type.String()),
  },
  { $id: "ExecTruncation", additionalProperties: false },
);
export const ExecResultDetailsSchema = Type.Object(
  {
    ok: Type.Boolean(), output: Type.String(), stdout: Type.String(), stderr: Type.String(),
    truncation: ExecTruncationSchema, wallTimeMs: Type.Number(), outputMode: Type.String(),
    suppressedLines: Type.Integer(), suppressedBytes: Type.Integer(),
    reasonCode: Type.Optional(Type.String()), outputLimitBytes: Type.Optional(Type.Number()),
    truncated: Type.Optional(Type.Boolean()), fullOutputPath: Type.Optional(Type.String()),
    exitCode: Type.Optional(Type.Integer()), code: Type.Optional(Type.Integer()),
    sessionId: Type.Optional(Type.Integer()), session_id: Type.Optional(Type.Integer()),
    sandboxed: Type.Optional(Type.Boolean()), escalated: Type.Optional(Type.Boolean()),
    kind: Type.Optional(Type.String()), alreadyCompleted: Type.Optional(Type.Boolean()),
  },
  { $id: "ExecResultDetails", additionalProperties: false },
);
export const HostExecResultSchema = Type.Object({ code: Type.Integer(), stdout: Type.String(), stderr: Type.String() }, { $id: "HostExecResult", additionalProperties: false });
export const ExecToolResultSchema = Type.Object(
  { content: Type.Array(ToolResultTextContentSchema, { minItems: 1 }), details: ExecResultDetailsSchema },
  { $id: "ExecToolResult", additionalProperties: false },
);
export type ExecToolResult = Static<typeof ExecToolResultSchema>;
export const ExecApprovalOutcomeFactsSchema = Type.Object(
  {
    planId: Type.String({ minLength: 1 }), ctx: Type.Unknown(),
    outcome: Type.Union([
      Type.Literal("approved"), Type.Literal("denied_by_user"),
      Type.Literal("timed_out"), Type.Literal("unavailable"), Type.Literal("interrupted"),
    ]),
  },
  { $id: "ExecApprovalOutcomeFacts", additionalProperties: false },
);
export const ExecApprovalRunSchema = Type.Object(
  { kind: Type.Literal("run"), forceUnsandboxed: Type.Literal(true) },
  { $id: "ExecApprovalRun", additionalProperties: false },
);
export const ExecApprovalDeniedSchema = Type.Object(
  { kind: Type.Literal("denied"), result: ToolResultEnvelopeSchema },
  { $id: "ExecApprovalDenied", additionalProperties: false },
);
export const ExecApprovalResultSchema = Type.Union([ExecApprovalRunSchema, ExecApprovalDeniedSchema]);
export type ExecApprovalResult = Static<typeof ExecApprovalResultSchema>;
export const AuthorityPlanRefSchema = Type.Object(
  { planId: Type.String({ minLength: 1 }), ctx: Type.Unknown() },
  { $id: "AuthorityPlanRef", additionalProperties: false },
);
export const AuthorityPlanIssuedSchema = Type.Object(
  { planId: Type.String({ minLength: 1 }) },
  { $id: "AuthorityPlanIssued", additionalProperties: false },
);
export type AuthorityPlanIssued = Static<typeof AuthorityPlanIssuedSchema>;
export const CommandChildDispatchFactsSchema = Type.Object(
  { result: BridgeCommandResultSchema, bridge: Type.Unknown() },
  { $id: "CommandChildDispatchFacts", additionalProperties: false },
);
export const CommandBridgeUpdateSchema = Type.Object(
  { action: Type.String({ minLength: 1 }), key: Type.String({ minLength: 1 }) },
  { $id: "CommandBridgeUpdate", additionalProperties: false },
);
export const CommandChildReturnSchema = Type.Object(
  { kind: Type.Literal("return"), result: BridgeCommandResultSchema },
  { $id: "CommandChildReturn", additionalProperties: false },
);
export const CommandChildDispatchSchema = Type.Object(
  {
    kind: Type.Literal("dispatch"), result: BridgeCommandResultSchema,
    bridgeUpdate: CommandBridgeUpdateSchema, prompt: Type.String({ minLength: 1 }),
  },
  { $id: "CommandChildDispatch", additionalProperties: false },
);
export const CommandChildDispatchPlanSchema = Type.Union([CommandChildReturnSchema, CommandChildDispatchSchema]);
export type CommandChildDispatchPlan = Static<typeof CommandChildDispatchPlanSchema>;
export const CommandChildDispatchFinishFactsSchema = Type.Object(
  { result: BridgeCommandResultSchema, dispatch: ChildDispatchResultSchema },
  { $id: "CommandChildDispatchFinishFacts", additionalProperties: false },
);
export const CronContextFactsSchema = Type.Object(
  { ctx: Type.Unknown() }, { $id: "CronContextFacts", additionalProperties: false },
);
export const CronGoalFactsSchema = Type.Object(
  { goalSlotFree: Type.Boolean(), goalDriving: Type.Boolean() },
  { $id: "CronGoalFacts", additionalProperties: false },
);
export const CronPollFactsSchema = Type.Object(
  {
    now: Type.Number(), hostIdle: Type.Boolean(), goalDriving: Type.Boolean(),
    goalSlotFree: Type.Boolean(), ctx: Type.Unknown(),
  },
  { $id: "CronPollFacts", additionalProperties: false },
);
export const CronPollNoneSchema = Type.Object(
  { kind: Type.Literal("none") }, { $id: "CronPollNone", additionalProperties: false },
);
export const CronPollDeliverySchema = Type.Object(
  {
    kind: Type.Literal("deliver"), id: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal("message"), Type.Literal("goal")]),
    content: Type.String({ minLength: 1 }), coalesced: Type.Integer({ minimum: 1 }),
    cron: Type.String({ minLength: 1 }), schedule: Type.String(),
  },
  { $id: "CronPollDelivery", additionalProperties: false },
);
export const CronPollPlanSchema = Type.Union([CronPollNoneSchema, CronPollDeliverySchema]);
export type CronGoalFacts = Static<typeof CronGoalFactsSchema>;
export type CronPollPlan = Static<typeof CronPollPlanSchema>;
export const CronDeliveredFactsSchema = Type.Object(
  { id: Type.String({ minLength: 1 }), now: Type.Number(), ctx: Type.Unknown() },
  { $id: "CronDeliveredFacts", additionalProperties: false },
);
export const CronDeliveredResultSchema = Type.Object(
  { acknowledged: Type.Boolean() },
  { $id: "CronDeliveredResult", additionalProperties: false },
);
export const CronStartupFactsSchema = Type.Object(
  { reason: Type.String(), ctx: Type.Unknown() },
  { $id: "CronStartupFacts", additionalProperties: false },
);
export const CronStartupNoneSchema = Type.Object(
  { kind: Type.Literal("none") }, { $id: "CronStartupNone", additionalProperties: false },
);
export const CronStartupNotifySchema = Type.Object(
  { kind: Type.Literal("notify"), message: Type.String({ minLength: 1 }) },
  { $id: "CronStartupNotify", additionalProperties: false },
);
export const CronStartupPlanSchema = Type.Union([CronStartupNoneSchema, CronStartupNotifySchema]);
export type CronDeliveredResult = Static<typeof CronDeliveredResultSchema>;
export type CronStartupPlan = Static<typeof CronStartupPlanSchema>;
export const ThreadToolFactsSchema = Type.Object(
  {
    name: Type.Union([Type.Literal("query_threads"), Type.Literal("read_thread")]),
    params: Type.Unknown(), catalog: Type.Unknown(), ctx: Type.Unknown(),
  },
  { $id: "ThreadToolFacts", additionalProperties: false },
);
export const GoalRollbackFactsSchema = Type.Object(
  { snapshot: Type.Unknown(), ctx: Type.Unknown() },
  { $id: "GoalRollbackFacts", additionalProperties: false },
);
export const FinalizeGoalErrorFactsSchema = Type.Object({ status: Type.String({ minLength: 1 }), ctx: Type.Unknown() }, { $id: "FinalizeGoalErrorFacts", additionalProperties: false });
export const GoalRollbackResultSchema = Type.Object(
  { completed: Type.Literal(true) },
  { $id: "GoalRollbackResult", additionalProperties: false },
);
export type GoalRollbackResult = Static<typeof GoalRollbackResultSchema>;
export const MutationErrorSchema = Type.Object(
  { kind: Type.Literal("error"), message: Type.String({ minLength: 1 }) },
  { $id: "MutationError", additionalProperties: false },
);
export const EditApplicationFactsSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), displayPath: Type.String({ minLength: 1 }), edits: Type.Array(EditReplacementSchema, { minItems: 1 }), contents: Type.String() },
  { $id: "EditApplicationFacts", additionalProperties: false },
);
export const EditAppliedSchema = Type.Object(
  {
    kind: Type.Literal("applied"), path: Type.String({ minLength: 1 }),
    displayPath: Type.String({ minLength: 1 }), contents: Type.String(),
    editCount: Type.Integer({ minimum: 1 }),
  },
  { $id: "EditApplied", additionalProperties: false },
);
export const EditApplicationResultSchema = Type.Union([MutationErrorSchema, EditAppliedSchema]);
export const PatchWriteSchema = Type.Object(
  { path: Type.String({ minLength: 1 }), contents: Type.String() },
  { $id: "PatchWrite", additionalProperties: false },
);
export const AuthorizedMutationPathSchema = Type.Object({ originalPath: Type.String({ minLength: 1 }), resolvedPath: Type.String({ minLength: 1 }) }, { $id: "AuthorizedMutationPath", additionalProperties: false });
export const PatchApplicationFactsSchema = Type.Object(
  {
    params: ApplyPatchParamsSchema, files: Type.Record(Type.String(), Type.String()), ctx: Type.Unknown(),
    filesystemApproval: Type.Boolean(), authorizedPaths: Type.Array(AuthorizedMutationPathSchema, { minItems: 1 }),
  },
  { $id: "PatchApplicationFacts", additionalProperties: false },
);
export const PatchAppliedSchema = Type.Object(
  {
    kind: Type.Literal("applied"), deletes: Type.Array(Type.String({ minLength: 1 })),
    writes: Type.Array(PatchWriteSchema), affectedPaths: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: "PatchApplied", additionalProperties: false },
);
export const PatchApplicationResultSchema = Type.Union([MutationErrorSchema, PatchAppliedSchema]);
export type EditApplicationResult = Static<typeof EditApplicationResultSchema>;
export type PatchApplicationResult = Static<typeof PatchApplicationResultSchema>;
export const VisibilityWarningFactsSchema = Type.Object(
  {
    tools: Type.Array(Type.String({ minLength: 1 })),
    skills: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: "VisibilityWarningFacts", additionalProperties: false },
);
export const VisibilityWarningsResultSchema = Type.Object(
  { messages: Type.Array(Type.String({ minLength: 1 })) },
  { $id: "VisibilityWarningsResult", additionalProperties: false },
);
export type VisibilityWarningsResult = Static<typeof VisibilityWarningsResultSchema>;
export const VisibilityRowsFactsSchema = Type.Object(
  {
    category: Type.Union([Type.Literal("tools"), Type.Literal("skills")]),
    ctx: Type.Unknown(),
  },
  { $id: "VisibilityRowsFacts", additionalProperties: false },
);
export const VisibilityRowSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }), state: Type.String({ minLength: 1 }),
    available: Type.Boolean(), description: Type.String(),
  },
  { $id: "VisibilityRow", additionalProperties: false },
);
export const VisibilityRowsResultSchema = Type.Object(
  {
    category: Type.Union([Type.Literal("tools"), Type.Literal("skills")]),
    title: Type.String({ minLength: 1 }), rows: Type.Array(VisibilityRowSchema),
    disabled: Type.Array(Type.String({ minLength: 1 })),
    unavailable: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: "VisibilityRowsResult", additionalProperties: false },
);
export type VisibilityRowsResult = Static<typeof VisibilityRowsResultSchema>;
export const VisibilityToggleFactsSchema = Type.Object(
  {
    category: Type.Union([Type.Literal("tools"), Type.Literal("skills")]),
    name: Type.String({ minLength: 1 }), ctx: Type.Unknown(),
  },
  { $id: "VisibilityToggleFacts", additionalProperties: false },
);
export const VisibilityMutationDetailsSchema = Type.Object(
  {
    category: Type.Union([Type.Literal("tools"), Type.Literal("skills")]),
    title: Type.String({ minLength: 1 }), rows: Type.Array(VisibilityRowSchema),
    disabled: Type.Array(Type.String({ minLength: 1 })),
    unavailable: Type.Array(Type.String({ minLength: 1 })),
    visibilityChanged: Type.Literal(true), enabledName: Type.Optional(Type.String({ minLength: 1 })),
    disabledName: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "VisibilityMutationDetails", additionalProperties: false },
);
export const VisibilityToggleSuccessSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("command_result"), message: Type.String(),
    details: VisibilityMutationDetailsSchema,
  },
  { $id: "VisibilityToggleSuccess", additionalProperties: false },
);
export const VisibilityToggleErrorSchema = Type.Object(
  {
    ok: Type.Literal(false), action: Type.Literal("command_result"), message: Type.String(),
    error: Type.String({ minLength: 1 }), details: VisibilityRowsResultSchema,
  },
  { $id: "VisibilityToggleError", additionalProperties: false },
);
export const VisibilityToggleResultSchema = Type.Union([VisibilityToggleSuccessSchema, VisibilityToggleErrorSchema]);
export type VisibilityToggleResult = Static<typeof VisibilityToggleResultSchema>;
export const VisibilitySavePlanSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("visibility_save_project"),
    category: Type.Union([Type.Literal("tools"), Type.Literal("skills")]),
    disabled: Type.Array(Type.String({ minLength: 1 })), details: VisibilityRowsResultSchema,
  },
  { $id: "VisibilitySavePlan", additionalProperties: false },
);
export const VisibilityListResultSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("command_result"),
    message: Type.String(), details: VisibilityRowsResultSchema,
  },
  { $id: "VisibilityListResult", additionalProperties: false },
);
export type VisibilitySavePlan = Static<typeof VisibilitySavePlanSchema>;
export type VisibilityListResult = Static<typeof VisibilityListResultSchema>;
export const CompactionSettingsSchema = Type.Object(
  {
    session: Type.Optional(Type.String()), global: Type.Optional(Type.String()),
    project: Type.Optional(Type.String()),
  },
  { $id: "CompactionSettings", additionalProperties: false },
);
export const CompactionCommandFactsSchema = Type.Object(
  { args: Type.String(), settings: CompactionSettingsSchema },
  { $id: "CompactionCommandFacts", additionalProperties: false },
);
export const CompactionPlanErrorSchema = Type.Object(
  { kind: Type.Literal("error"), message: Type.String({ minLength: 1 }) },
  { $id: "CompactionPlanError", additionalProperties: false },
);
export const CompactionShowSchema = Type.Object(
  { kind: Type.Literal("show"), model: Type.String(), source: Type.String({ minLength: 1 }) },
  { $id: "CompactionShow", additionalProperties: false },
);
export const CompactionSetProjectSchema = Type.Object(
  { kind: Type.Literal("set_project"), model: Type.String({ minLength: 1 }) },
  { $id: "CompactionSetProject", additionalProperties: false },
);
export const CompactionClearProjectSchema = Type.Object(
  { kind: Type.Literal("clear_project") },
  { $id: "CompactionClearProject", additionalProperties: false },
);
export const CompactionOpenPickerSchema = Type.Object(
  { kind: Type.Literal("open_picker"), current: Type.String() },
  { $id: "CompactionOpenPicker", additionalProperties: false },
);
export const CompactionCommandPlanSchema = Type.Union([
  CompactionPlanErrorSchema, CompactionShowSchema, CompactionSetProjectSchema,
  CompactionClearProjectSchema, CompactionOpenPickerSchema,
]);
export const CompactionDefaultSchema = Type.Object(
  { kind: Type.Literal("default") }, { $id: "CompactionDefault", additionalProperties: false },
);
export const CompactionUseModelSchema = Type.Object(
  { kind: Type.Literal("compact"), model: Type.String({ minLength: 1 }) },
  { $id: "CompactionUseModel", additionalProperties: false },
);
export const CompactionSessionPlanSchema = Type.Union([CompactionDefaultSchema, CompactionUseModelSchema]);
export type CompactionCommandPlan = Static<typeof CompactionCommandPlanSchema>;
export type CompactionSessionPlan = Static<typeof CompactionSessionPlanSchema>;
export const PermissionsMenuOptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }), value: Type.String({ minLength: 1 }),
    description: Type.String(), selected: Type.Boolean(),
  },
  { $id: "PermissionsMenuOption", additionalProperties: false },
);
export const PermissionsPromptSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("permissions_prompt"), title: Type.String({ minLength: 1 }),
    message: Type.String(), options: Type.Array(PermissionsMenuOptionSchema),
  },
  { $id: "PermissionsPrompt", additionalProperties: false },
);
export const PermissionsPromptFactsSchema = Type.Object(
  { prompt: PermissionsPromptSchema, uiAvailable: Type.Boolean() },
  { $id: "PermissionsPromptFacts", additionalProperties: false },
);
export const PermissionsCommandResultSchema = Type.Object(
  {
    ok: Type.Boolean(), action: Type.Literal("command_result"), message: Type.String(),
    error: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()),
  },
  { $id: "PermissionsCommandResult", additionalProperties: false },
);
export const PermissionsPromptSelectSchema = Type.Object(
  {
    kind: Type.Literal("select"), title: Type.String({ minLength: 1 }),
    labels: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { $id: "PermissionsPromptSelect", additionalProperties: false },
);
export const PermissionsPromptResultSchema = Type.Object(
  { kind: Type.Literal("result"), result: PermissionsCommandResultSchema },
  { $id: "PermissionsPromptResult", additionalProperties: false },
);
export const PermissionsPromptPlanSchema = Type.Union([PermissionsPromptSelectSchema, PermissionsPromptResultSchema]);
export const PermissionsSelectionSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("selected"), Type.Literal("cancelled")]),
    selected: Type.Optional(Type.String()),
  },
  { $id: "PermissionsSelection", additionalProperties: false },
);
export const PermissionsPromptFinishFactsSchema = Type.Object(
  { prompt: PermissionsPromptSchema, selection: PermissionsSelectionSchema, ctx: Type.Unknown() },
  { $id: "PermissionsPromptFinishFacts", additionalProperties: false },
);
export type PermissionsPrompt = Static<typeof PermissionsPromptSchema>;
export type PermissionsPromptPlan = Static<typeof PermissionsPromptPlanSchema>;
export type PermissionsCommandResult = Static<typeof PermissionsCommandResultSchema>;
export const CronTaskSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }), schedule: Type.String(), cron: Type.String({ minLength: 1 }),
    prompt: Type.String(), recurring: Type.Boolean(),
    mode: Type.Union([Type.Literal("message"), Type.Literal("goal")]),
    enabled: Type.Boolean(), nextDue: Type.Integer(), nextDueText: Type.String(), pending: Type.Boolean(),
  },
  { $id: "CronTask", additionalProperties: false },
);
export const CronListDetailsSchema = Type.Object(
  { enabled: Type.Boolean(), tasks: Type.Array(CronTaskSchema) },
  { $id: "CronListDetails", additionalProperties: false },
);
export const CronListResultSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("tool_result"), text: Type.String(),
    details: CronListDetailsSchema,
  },
  { $id: "CronListResult", additionalProperties: false },
);
export type CronListResult = Static<typeof CronListResultSchema>;
export const CronTaskPatchSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }), prompt: Type.Optional(Type.String()),
    cron: Type.Optional(Type.String({ minLength: 1 })), recurring: Type.Optional(Type.Boolean()),
    mode: Type.Optional(Type.Union([Type.Literal("message"), Type.Literal("goal")])),
  },
  { $id: "CronTaskPatch", additionalProperties: false },
);
export const CronTaskUpdateFactsSchema = Type.Object(
  { patch: CronTaskPatchSchema, ctx: Type.Unknown() },
  { $id: "CronTaskUpdateFacts", additionalProperties: false },
);
export const CronManagerCommandFactsSchema = Type.Object(
  { args: Type.String(), ctx: Type.Unknown() },
  { $id: "CronManagerCommandFacts", additionalProperties: false },
);
export const CronCommandResultSchema = Type.Object(
  {
    ok: Type.Boolean(), action: Type.Literal("command_result"), message: Type.String(),
    details: Type.Unknown(), error: Type.Optional(Type.String()),
  },
  { $id: "CronCommandResult", additionalProperties: false },
);
export type CronTaskPatch = Static<typeof CronTaskPatchSchema>;
export type CronCommandResult = Static<typeof CronCommandResultSchema>;
export const CronPromptSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("cron_prompt"),
    enabled: Type.Boolean(), tasks: Type.Array(CronTaskSchema),
  },
  { $id: "CronPrompt", additionalProperties: false },
);
export const CronPromptFactsSchema = Type.Object(
  { prompt: CronPromptSchema, uiAvailable: Type.Boolean() },
  { $id: "CronPromptFacts", additionalProperties: false },
);
export const CronPromptPlanSchema = Type.Object(
  { kind: Type.Literal("result"), result: CronCommandResultSchema },
  { $id: "CronPromptPlan", additionalProperties: false },
);
export type CronPrompt = Static<typeof CronPromptSchema>;
export type CronPromptPlan = Static<typeof CronPromptPlanSchema>;
