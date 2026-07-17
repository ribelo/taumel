import Type, { type Static } from "typebox";
import { BridgeToolResultSchema, CronPromptSchema, PermissionsPromptSchema, ToolResultEnvelopeSchema, VisibilitySavePlanSchema } from "./bridge-core-contracts.ts";

export const ComposerSettingsSchema = Type.Object(
  {
    taumel: Type.Object({ composer: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }) },
      { additionalProperties: false }),
  },
  { $id: "ComposerSettings", additionalProperties: false },
);
export const ComposerCommandFactsSchema = Type.Object(
  {
    args: Type.String(), path: Type.String({ minLength: 1 }), settings: ComposerSettingsSchema,
  },
  { $id: "ComposerCommandFacts", additionalProperties: false },
);
export const ComposerCommandErrorSchema = Type.Object(
  { kind: Type.Literal("error"), message: Type.String({ minLength: 1 }) },
  { $id: "ComposerCommandError", additionalProperties: false },
);
export const ComposerCommandSuccessSchema = Type.Object(
  {
    kind: Type.Literal("result"), message: Type.String(), settings: ComposerSettingsSchema,
    writeSettings: Type.Boolean(),
  },
  { $id: "ComposerCommandSuccess", additionalProperties: false },
);
export const ComposerCommandResultSchema = Type.Union([ComposerCommandErrorSchema, ComposerCommandSuccessSchema]);
export type ComposerSettings = Static<typeof ComposerSettingsSchema>;
export type ComposerCommandResult = Static<typeof ComposerCommandResultSchema>;
export const CronGoalCreationFactsSchema = Type.Object(
  { objective: Type.String({ minLength: 1 }), ctx: Type.Unknown() },
  { $id: "CronGoalCreationFacts", additionalProperties: false },
);
export const CronGoalCreationResultSchema = Type.Object(
  { created: Type.Boolean() },
  { $id: "CronGoalCreationResult", additionalProperties: false },
);
export type CronGoalCreationResult = Static<typeof CronGoalCreationResultSchema>;
export const HandleCommandFactsSchema = Type.Object(
  { name: Type.String({ minLength: 1 }), args: Type.String(), ctx: Type.Unknown() },
  { $id: "HandleCommandFacts", additionalProperties: false },
);
export const GatewayCommandErrorSchema = Type.Object(
  { ok: Type.Literal(false), error: Type.String({ minLength: 1 }) },
  { $id: "GatewayCommandError", additionalProperties: false },
);
export const GatewayCommandResultSchema = Type.Object(
  {
    ok: Type.Boolean(), action: Type.Literal("command_result"), message: Type.String(),
    error: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()),
    goalFollowup: Type.Optional(Type.Boolean()), goalStartObjective: Type.Optional(Type.String()),
    goalRollback: Type.Optional(Type.Unknown()), goalInspection: Type.Optional(Type.Boolean()),
  },
  { $id: "GatewayCommandResult", additionalProperties: false },
);
export const VisibilityPromptSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("visibility_prompt"),
    category: Type.Union([Type.Literal("tools"), Type.Literal("skills")]),
    title: Type.String({ minLength: 1 }),
  },
  { $id: "VisibilityPrompt", additionalProperties: false },
);
export type VisibilityPrompt = Static<typeof VisibilityPromptSchema>;
export const OpenAiUsageFetchSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("openai_usage_fetch"), apiKeyPresent: Type.Boolean() },
  { $id: "OpenAiUsageFetch", additionalProperties: false },
);
export const GatewayCommandOutputSchema = Type.Union([
  GatewayCommandErrorSchema, GatewayCommandResultSchema, PermissionsPromptSchema,
  CronPromptSchema, VisibilityPromptSchema, VisibilitySavePlanSchema, OpenAiUsageFetchSchema,
]);
export type GatewayCommandOutput = Static<typeof GatewayCommandOutputSchema>;
export const PrepareToolFactsSchema = Type.Object(
  { name: Type.String({ minLength: 1 }), params: Type.Unknown(), ctx: Type.Unknown() },
  { $id: "PrepareToolFacts", additionalProperties: false },
);
export const SandboxConfigSchema = Type.Object(
  {
    filesystemMode: Type.String({ minLength: 1 }), networkMode: Type.String({ minLength: 1 }),
    workspaceRoots: Type.Array(Type.String({ minLength: 1 })), noSandbox: Type.Boolean(),
    // bridge-7m4k: generated builders camel-case OCaml labels, so this bridge-only
    // field must remain `isolatedChild`; persisted session state uses `isolated_child`.
    isolatedChild: Type.Boolean(), approvalPolicy: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "SandboxConfig", additionalProperties: false },
);
export const ExecHostOptionsSchema = Type.Object(
  {
    cwd: Type.String(), timeout: Type.Optional(Type.Number({ minimum: 0 })),
    yieldTimeMs: Type.Optional(Type.Number({ minimum: 0 })), tty: Type.Optional(Type.Boolean()),
  },
  { $id: "ExecHostOptions", additionalProperties: false },
);
export const ExecHostCallSchema = Type.Object(
  {
    ok: Type.Literal(true), command: Type.String({ minLength: 1 }),
    args: Type.Array(Type.String()), options: ExecHostOptionsSchema,
    sandboxed: Type.Boolean(), escalated: Type.Boolean(),
  },
  { $id: "ExecHostCall", additionalProperties: false },
);
export const WriteStdinHostOptionsSchema = Type.Object(
  { yieldTimeMs: Type.Optional(Type.Number({ minimum: 0 })) },
  { $id: "WriteStdinHostOptions", additionalProperties: false },
);
export const WriteStdinHostResultSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("result"), result: ToolResultEnvelopeSchema },
  { $id: "WriteStdinHostResult", additionalProperties: false },
);
export const WriteStdinHostCallSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("call"), sessionId: Type.Integer({ minimum: 1 }),
    chars: Type.String(), options: WriteStdinHostOptionsSchema,
  },
  { $id: "WriteStdinHostCall", additionalProperties: false },
);
const approvalFields = {
  approvalTitle: Type.String({ minLength: 1 }), approvalPrompt: Type.String({ minLength: 1 }),
  approvalTimeoutMs: Type.Number({ minimum: 0 }),
};
export const PreparedReadSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("read"), path: Type.String({ minLength: 1 }), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1 })) },
  { $id: "PreparedRead", additionalProperties: false },
);
export const PreparedViewMediaSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("view_media"), path: Type.String({ minLength: 1 }) },
  { $id: "PreparedViewMedia", additionalProperties: false },
);
export const PreparedWriteStdinSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("write_stdin"), sessionId: Type.Integer({ minimum: 1 }), chars: Type.String(), yieldTimeMs: Type.Optional(Type.Number({ minimum: 0 })), maxOutputTokens: Type.Optional(Type.Integer({ minimum: 0 })), outputMode: Type.Union([Type.Literal("delta"), Type.Literal("status")]) },
  { $id: "PreparedWriteStdin", additionalProperties: false },
);
export const PreparedExecSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("exec_command"), planId: Type.String({ minLength: 1 }), cmd: Type.String({ minLength: 1 }),
    workdir: Type.String(), yieldTimeMs: Type.Optional(Type.Number({ minimum: 0 })), maxOutputTokens: Type.Optional(Type.Integer({ minimum: 0 })), tty: Type.Boolean(),
    sandbox: SandboxConfigSchema,
    brokeredGit: Type.Optional(Type.Boolean()),
  },
  { $id: "PreparedExec", additionalProperties: false },
);
export const PreparedExecApprovalSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("exec_command_approval"), planId: Type.String({ minLength: 1 }), cmd: Type.String({ minLength: 1 }),
    workdir: Type.String(), yieldTimeMs: Type.Optional(Type.Number({ minimum: 0 })), maxOutputTokens: Type.Optional(Type.Integer({ minimum: 0 })), tty: Type.Boolean(),
    sandbox: SandboxConfigSchema, approvalMessage: Type.String(), ...approvalFields,
    execPolicyAllowAlwaysTokens: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { $id: "PreparedExecApproval", additionalProperties: false },
);
const mutationBase = {
  ok: Type.Literal(true), workspaceRoots: Type.Array(Type.String({ minLength: 1 })),
  validateWorkspacePaths: Type.Boolean(), path: Type.String({ minLength: 1 }),
  displayPath: Type.String({ minLength: 1 }),
};
export const PreparedWriteSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("write"), contents: Type.String(), mode: Type.String({ minLength: 1 }), filesystemApproval: Type.Optional(Type.Boolean()) },
  { $id: "PreparedWrite", additionalProperties: false },
);
export const PreparedWriteApprovalSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("write_approval"), contents: Type.String(), mode: Type.String({ minLength: 1 }), approvalAction: Type.String(), ...approvalFields },
  { $id: "PreparedWriteApproval", additionalProperties: false },
);
export const PreparedEditSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("edit"), edits: Type.Array(Type.Unknown()), filesystemApproval: Type.Optional(Type.Boolean()) },
  { $id: "PreparedEdit", additionalProperties: false },
);
export const PreparedEditApprovalSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("edit_approval"), edits: Type.Array(Type.Unknown()), approvalAction: Type.String(), ...approvalFields },
  { $id: "PreparedEditApproval", additionalProperties: false },
);
export const PreparedPatchSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("apply_patch"), workspaceRoots: Type.Array(Type.String({ minLength: 1 })), validateWorkspacePaths: Type.Boolean(), affectedPaths: Type.Array(Type.String({ minLength: 1 })), patch: Type.String(), filesystemApproval: Type.Optional(Type.Boolean()) },
  { $id: "PreparedPatch", additionalProperties: false },
);
export const PreparedPatchApprovalSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("apply_patch_approval"), workspaceRoots: Type.Array(Type.String({ minLength: 1 })), validateWorkspacePaths: Type.Boolean(), affectedPaths: Type.Array(Type.String({ minLength: 1 })), patch: Type.String(), approvalAction: Type.String(), ...approvalFields },
  { $id: "PreparedPatchApproval", additionalProperties: false },
);
export const PreparedThreadQuerySchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("query_threads"), query: Type.String({ minLength: 1 }), limit: Type.Integer({ minimum: 1 }), scope: Type.String(), includeTools: Type.Boolean() },
  { $id: "PreparedThreadQuery", additionalProperties: false },
);
export const PreparedThreadReadSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("read_thread"), threadID: Type.String({ minLength: 1 }),
    mode: Type.String(), around: Type.Integer({ minimum: 0 }), entryID: Type.Union([Type.String(), Type.Null()]),
    line: Type.Union([Type.Integer(), Type.Null()]), cursor: Type.Union([Type.String(), Type.Null()]),
    locator: Type.Optional(Type.Unknown()),
  },
  { $id: "PreparedThreadRead", additionalProperties: false },
);
export const PreparedExaSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("exa_fetch"), planId: Type.String({ minLength: 1 }), toolName: Type.String({ minLength: 1 }) },
  { $id: "PreparedExa", additionalProperties: false },
);
export const PreparedExaApprovalSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("exa_agent_create_run_approval"), planId: Type.String({ minLength: 1 }), toolName: Type.String({ minLength: 1 }), ...approvalFields },
  { $id: "PreparedExaApproval", additionalProperties: false },
);
export const PreparedAgentStartSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_start"),
    text: Type.String(),
    details: Type.Unknown(),
    prompt: Type.String(),
    agentId: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    submissionId: Type.String({ minLength: 1 }),
    metadata: Type.Unknown(),
  },
  { $id: "PreparedAgentStart", additionalProperties: false },
);
export const PreparedAgentSendSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_send"),
    text: Type.String(),
    details: Type.Unknown(),
    prompt: Type.String(),
    agentId: Type.String({ minLength: 1 }),
    dispatch: Type.Boolean(),
    interrupt: Type.Boolean(),
    dispatchDeliverAs: Type.String(),
    runId: Type.Optional(Type.String()),
    submissionId: Type.Optional(Type.String()),
    previousSubmissionId: Type.Optional(Type.String()),
    previousReasonCode: Type.Optional(Type.String()),
    outcome: Type.String({ minLength: 1 }),
    metadata: Type.Optional(Type.Unknown()),
  },
  { $id: "PreparedAgentSend", additionalProperties: false },
);
export const PreparedAgentWaitSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_wait"),
    text: Type.String(),
    details: Type.Unknown(),
    runIds: Type.Array(Type.String()),
    timeoutSeconds: Type.Optional(Type.Number()),
  },
  { $id: "PreparedAgentWait", additionalProperties: false },
);
export const PreparedAgentCloseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_close"),
    text: Type.String(),
    details: Type.Unknown(),
    agentId: Type.String({ minLength: 1 }),
    runIds: Type.Array(Type.String({ minLength: 1 })),
    deleteWorktree: Type.Optional(Type.Boolean()),
    worktreePath: Type.Optional(Type.String()),
    worktreeBranch: Type.Optional(Type.String()),
    mainRepositoryRoot: Type.Optional(Type.String()),
    isolation: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("worktree")])),
  },
  { $id: "PreparedAgentClose", additionalProperties: false },
);
export const AgentRoutingDiagnosticsResultSchema = Type.Object(
  { diagnostics: Type.Array(Type.String()) },
  { $id: "AgentRoutingDiagnosticsResult", additionalProperties: false },
);
export const AgentNotificationSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }), customType: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }), display: Type.Boolean(), details: Type.Unknown(),
  },
  { $id: "AgentNotification", additionalProperties: false },
);
export const PendingAgentNotificationsResultSchema = Type.Object(
  { notifications: Type.Array(AgentNotificationSchema) },
  { $id: "PendingAgentNotificationsResult", additionalProperties: false },
);
export const AgentNotificationClaimValidationSchema = Type.Object(
  { valid: Type.Boolean() },
  { $id: "AgentNotificationClaimValidation", additionalProperties: false },
);
export const AgentActiveCountResultSchema = Type.Object(
  { count: Type.Integer({ minimum: 0 }) },
  { $id: "AgentActiveCountResult", additionalProperties: false },
);
export const AgentCleanupItemSchema = Type.Object(
  { agentId: Type.String({ minLength: 1 }) },
  { $id: "AgentCleanupItem", additionalProperties: false },
);
export const AgentCleanupPlanSchema = Type.Object(
  { agents: Type.Array(AgentCleanupItemSchema) },
  { $id: "AgentCleanupPlan", additionalProperties: false },
);
export const AgentManagerIdentitySchema = Type.Object(
  {
    agentId: Type.String({ minLength: 1 }), kind: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }), thinking: Type.String({ minLength: 1 }),
    workspace: Type.String({ minLength: 1 }),
    isolation: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("worktree")])),
    effectiveWorkspace: Type.Optional(Type.String({ minLength: 1 })),
    tier: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
    createdAt: Type.Integer(), childSessionFile: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "AgentManagerIdentity", additionalProperties: false },
);
export const AgentManagerRunSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }), agentId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }), reasonCode: Type.Optional(Type.String({ minLength: 1 })),
    startedAt: Type.Integer(), endedAt: Type.Optional(Type.Integer()),
    suspendedAt: Type.Optional(Type.Integer()), description: Type.String(), turnCount: Type.Integer({ minimum: 0 }),
    lastActivityAt: Type.Optional(Type.Integer()), activityState: Type.String({ minLength: 1 }),
    recommendation: Type.String({ minLength: 1 }), submissionId: Type.String({ minLength: 1 }),
    error: Type.Optional(Type.String()), announcement: Type.String({ minLength: 1 }),
  },
  { $id: "AgentManagerRun", additionalProperties: false },
);
export const AgentManagerSnapshotSchema = Type.Object(
  {
    agents: Type.Array(AgentManagerIdentitySchema),
    runs: Type.Array(AgentManagerRunSchema),
  },
  { $id: "AgentManagerSnapshot", additionalProperties: false },
);
export const AgentChildSessionUpdateSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("stop_child_session"), Type.Literal("delete_child_session"),
    ]),
    key: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 1 }),
  },
  { $id: "AgentChildSessionUpdate", additionalProperties: false },
);
export type AgentRoutingDiagnosticsResult = Static<typeof AgentRoutingDiagnosticsResultSchema>;
export type PendingAgentNotificationsResult = Static<typeof PendingAgentNotificationsResultSchema>;
export type AgentNotificationClaimValidation = Static<typeof AgentNotificationClaimValidationSchema>;
export type AgentActiveCountResult = Static<typeof AgentActiveCountResultSchema>;
export type AgentCleanupPlan = Static<typeof AgentCleanupPlanSchema>;
export type AgentManagerSnapshot = Static<typeof AgentManagerSnapshotSchema>;
export const PreparedToolActionSchema = Type.Union([
  GatewayCommandErrorSchema, BridgeToolResultSchema, OpenAiUsageFetchSchema, PreparedReadSchema,
  PreparedViewMediaSchema, PreparedWriteStdinSchema, PreparedExecSchema, PreparedExecApprovalSchema,
  PreparedWriteSchema, PreparedWriteApprovalSchema, PreparedEditSchema, PreparedEditApprovalSchema,
  PreparedPatchSchema, PreparedPatchApprovalSchema, PreparedThreadQuerySchema, PreparedThreadReadSchema,
  PreparedExaSchema, PreparedExaApprovalSchema,
  PreparedAgentStartSchema, PreparedAgentSendSchema, PreparedAgentWaitSchema, PreparedAgentCloseSchema,
]);
export type PreparedToolAction = Static<typeof PreparedToolActionSchema>;
