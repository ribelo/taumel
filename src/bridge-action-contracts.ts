import Type, { type Static } from "typebox";
import { AgentSessionMetadataSchema } from "./session-entry-contracts.ts";
import { EditReplacementSchema } from "./tool-contracts.ts";
export { AgentSessionMetadataSchema };
import { AuthorizedMutationPathSchema, BridgeToolResultSchema, CronPromptSchema, PermissionsPromptSchema, ToolResultEnvelopeSchema, VisibilitySavePlanSchema } from "./bridge-core-contracts.ts";

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
export const UsagePairFetchSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("usage_pair_fetch"),
    openaiApiKeyPresent: Type.Boolean(),
  },
  { $id: "UsagePairFetch", additionalProperties: false },
);
export const GatewayCommandOutputSchema = Type.Union([
  GatewayCommandErrorSchema, GatewayCommandResultSchema, PermissionsPromptSchema,
  CronPromptSchema, VisibilityPromptSchema, VisibilitySavePlanSchema, OpenAiUsageFetchSchema,
  UsagePairFetchSchema,
]);
export type GatewayCommandOutput = Static<typeof GatewayCommandOutputSchema>;
export const PrepareToolFactsSchema = Type.Object(
  { name: Type.String({ minLength: 1 }), params: Type.Unknown(), ctx: Type.Unknown() },
  { $id: "PrepareToolFacts", additionalProperties: false },
);
export const SandboxConfigSchema = Type.Object(
  {
    filesystemMode: Type.Union([
      Type.Literal("read-only"), Type.Literal("workspace-write"), Type.Literal("danger-full-access"),
    ]),
    networkMode: Type.Union([Type.Literal("disabled"), Type.Literal("enabled")]),
    workspaceRoots: Type.Array(Type.String({ minLength: 1 })), noSandbox: Type.Boolean(),
    // bridge-7m4k: generated builders camel-case OCaml labels, so this bridge-only
    // field must remain `isolatedChild`; persisted session state uses `isolated_child`.
    isolatedChild: Type.Boolean(), approvalPolicy: Type.Union([
      Type.Literal("never"), Type.Literal("on-request"),
      Type.Literal("on-failure"), Type.Literal("untrusted"),
    ]),
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
  { ok: Type.Literal(true), action: Type.Literal("read"), path: Type.String({ minLength: 1 }), offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer({ minimum: 1 })) },
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
export const PreparedExecInputSchema = Type.Union(
  [PreparedExecSchema, PreparedExecApprovalSchema],
  { $id: "PreparedExecInput" },
);
const mutationBase = {
  ok: Type.Literal(true), workspaceRoots: Type.Array(Type.String({ minLength: 1 })),
  validateWorkspacePaths: Type.Boolean(), path: Type.String({ minLength: 1 }),
  displayPath: Type.String({ minLength: 1 }),
};
const WriteModeSchema = Type.Union([Type.Literal("overwrite"), Type.Literal("append")]);
export const PreparedWriteSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("write"), contents: Type.String(), mode: WriteModeSchema, filesystemApproval: Type.Optional(Type.Boolean()) },
  { $id: "PreparedWrite", additionalProperties: false },
);
export const PreparedWriteApprovalSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("write_approval"), contents: Type.String(), mode: WriteModeSchema, approvalAction: Type.Literal("write"), ...approvalFields },
  { $id: "PreparedWriteApproval", additionalProperties: false },
);
export const PreparedEditSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("edit"), edits: Type.Array(EditReplacementSchema, { minItems: 1 }), filesystemApproval: Type.Optional(Type.Boolean()) },
  { $id: "PreparedEdit", additionalProperties: false },
);
export const PreparedEditApprovalSchema = Type.Object(
  { ...mutationBase, action: Type.Literal("edit_approval"), edits: Type.Array(EditReplacementSchema, { minItems: 1 }), approvalAction: Type.Literal("edit"), ...approvalFields },
  { $id: "PreparedEditApproval", additionalProperties: false },
);
const authorizedPatchPaths = { authorizedPaths: Type.Array(AuthorizedMutationPathSchema, { minItems: 1 }) };
export const PreparedPatchSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("apply_patch"), workspaceRoots: Type.Array(Type.String({ minLength: 1 })), validateWorkspacePaths: Type.Boolean(), affectedPaths: Type.Array(Type.String({ minLength: 1 })), ...authorizedPatchPaths, patch: Type.String(), filesystemApproval: Type.Optional(Type.Boolean()) },
  { $id: "PreparedPatch", additionalProperties: false },
);
export const PreparedPatchApprovalSchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("apply_patch_approval"), workspaceRoots: Type.Array(Type.String({ minLength: 1 })), validateWorkspacePaths: Type.Boolean(), affectedPaths: Type.Array(Type.String({ minLength: 1 })), ...authorizedPatchPaths, patch: Type.String(), approvalAction: Type.Literal("apply_patch"), ...approvalFields },
  { $id: "PreparedPatchApproval", additionalProperties: false },
);
export const PreparedThreadQuerySchema = Type.Object(
  { ok: Type.Literal(true), action: Type.Literal("query_threads"), query: Type.String({ minLength: 1, maxLength: 500 }), limit: Type.Integer({ minimum: 1, maximum: 50 }), scope: Type.Union([Type.Literal("current_workspace"), Type.Literal("all")]), includeTools: Type.Boolean() },
  { $id: "PreparedThreadQuery", additionalProperties: false },
);
export const PreparedThreadLocatorSchema = Type.Object({
  threadID: Type.String({ minLength: 1 }),
  sourcePath: Type.Optional(Type.String({ minLength: 1 })),
  entryID: Type.Optional(Type.String({ minLength: 1 })),
  line: Type.Optional(Type.Integer({ minimum: 1 })),
}, { $id: "PreparedThreadLocator", additionalProperties: false });
export const PreparedThreadReadSchema = Type.Object(
  {
    ok: Type.Literal(true), action: Type.Literal("read_thread"), threadID: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal("overview"), Type.Literal("window"), Type.Literal("full")]),
    around: Type.Integer({ minimum: 0, maximum: 10 }),
    entryID: Type.Optional(Type.String({ minLength: 1 })),
    line: Type.Optional(Type.Integer({ minimum: 1 })),
    cursor: Type.Optional(Type.String({ minLength: 1 })),
    locator: Type.Optional(PreparedThreadLocatorSchema),
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
const AgentKindSchema = Type.Union([
  Type.Literal("generic"), Type.Literal("finder"), Type.Literal("oracle"),
]);
const AgentRunStatusSchema = Type.Union([
  Type.Literal("running"), Type.Literal("suspended"), Type.Literal("completed"),
  Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("lost"),
]);
const AgentSendOutcomeSchema = Type.Union([
  Type.Literal("message_sent"), Type.Literal("interrupted_and_sent"),
  Type.Literal("suspended"), Type.Literal("already_suspended"), Type.Literal("resumed"),
  Type.Literal("started"), Type.Literal("no_active_run"),
]);
const AgentReasonCodeSchema = Type.Union([
  Type.Literal("interrupted_by_parent"), Type.Literal("parent_shutdown"),
  Type.Literal("process_interrupted"), Type.Literal("close_cleanup_failed"),
  Type.Literal("host_cancelled"), Type.Literal("dispatch_failed"),
  Type.Literal("agent_failed"), Type.Literal("internal_error"),
  Type.Literal("child_session_lost"),
]);
const AgentSuspensionReasonCodeSchema = Type.Union([
  Type.Literal("interrupted_by_parent"), Type.Literal("parent_shutdown"),
  Type.Literal("process_interrupted"), Type.Literal("close_cleanup_failed"),
]);
export const AgentStartDetailsSchema = Type.Object({
  ok: Type.Literal(true), runId: Type.String({ minLength: 1 }),
  kind: AgentKindSchema, model: Type.String({ minLength: 1 }), thinking: Type.String({ minLength: 1 }),
  status: Type.Literal("running"), prompt: Type.String(), agentId: Type.String({ minLength: 1 }),
  activeTools: Type.Array(Type.String({ minLength: 1 })), workspace: Type.String({ minLength: 1 }),
  isolation: Type.Union([Type.Literal("none"), Type.Literal("worktree")]),
  tier: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
}, { $id: "AgentStartDetails", additionalProperties: false });
export const AgentSendDetailsSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }), outcome: AgentSendOutcomeSchema,
  runId: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Optional(AgentRunStatusSchema),
  submissionId: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "AgentSendDetails", additionalProperties: false });
const AgentWaitUnusedResultSchema = Type.Object(
  { unused: Type.Literal(true) }, { additionalProperties: false },
);
export const AgentWaitDetailsSchema = Type.Object({
  ok: Type.Literal(true), timedOut: Type.Literal(false),
  results: Type.Array(AgentWaitUnusedResultSchema, { maxItems: 0 }),
  pendingRunIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
}, { $id: "AgentWaitDetails", additionalProperties: false });
export const AgentCloseDetailsSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }), status: Type.Literal("closed"),
}, { $id: "AgentCloseDetails", additionalProperties: false });
export const RecordAgentChildSessionStartFactsSchema = Type.Object({
  agent_id: Type.String({ minLength: 1 }), sessionId: Type.Optional(Type.String({ minLength: 1 })),
  sessionFile: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "RecordAgentChildSessionStartFacts", additionalProperties: false });
export const RollbackUnacceptedAgentStartFactsSchema = Type.Object({
  agent_id: Type.String({ minLength: 1 }), run_id: Type.String({ minLength: 1 }),
  submission_id: Type.String({ minLength: 1 }),
}, { $id: "RollbackUnacceptedAgentStartFacts", additionalProperties: false });
export const RollbackAgentSendPreflightFactsSchema = Type.Object({
  agent_id: Type.String({ minLength: 1 }), run_id: Type.String({ minLength: 1 }),
  submission_id: Type.String({ minLength: 1 }), previous_submission_id: Type.String(),
  outcome: AgentSendOutcomeSchema, previous_reason_code: Type.Optional(AgentSuspensionReasonCodeSchema),
}, { $id: "RollbackAgentSendPreflightFacts", additionalProperties: false });
export const RecordAgentSendDispatchFailureFactsSchema = Type.Object({
  run_id: Type.String({ minLength: 1 }), submission_id: Type.Optional(Type.String({ minLength: 1 })),
  error: Type.Optional(Type.String()),
}, { $id: "RecordAgentSendDispatchFailureFacts", additionalProperties: false });
export const RollbackFailedAgentInterruptionFactsSchema = Type.Object({
  agent_id: Type.String({ minLength: 1 }), run_id: Type.String({ minLength: 1 }),
}, { $id: "RollbackFailedAgentInterruptionFacts", additionalProperties: false });
export const AgentDispatchCompletionSchema = Type.Object({
  status: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("timed_out")]),
  finalOutput: Type.Optional(Type.String()), resultEntryId: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.Optional(Type.String()),
}, { $id: "AgentDispatchCompletion", additionalProperties: false });
export const AgentDispatchCompletionFactsSchema = Type.Object({
  run_id: Type.String({ minLength: 1 }), submission_id: Type.Optional(Type.String({ minLength: 1 })),
  completion: AgentDispatchCompletionSchema,
}, { $id: "AgentDispatchCompletionFacts", additionalProperties: false });
export const AgentActivityFactsSchema = Type.Object({
  run_id: Type.String({ minLength: 1 }), submission_id: Type.String({ minLength: 1 }),
  event: Type.Union([
    Type.Literal("agent_start"), Type.Literal("turn_start"), Type.Literal("turn_end"),
    Type.Literal("tool_execution_start"), Type.Literal("tool_execution_update"), Type.Literal("tool_execution_end"),
  ]),
}, { $id: "AgentActivityFacts", additionalProperties: false });
export const AgentDispatchBoundaryFactsSchema = Type.Object({
  run_id: Type.String({ minLength: 1 }), submission_id: Type.String({ minLength: 1 }),
  previous_assistant_entry_id: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "AgentDispatchBoundaryFacts", additionalProperties: false });
export const LiveAgentDispatchesFactsSchema = Type.Object({
  live_agent_ids: Type.Array(Type.String({ minLength: 1 })),
}, { $id: "LiveAgentDispatchesFacts", additionalProperties: false });
export const AgentRunIdFactsSchema = Type.Object({ run_id: Type.String({ minLength: 1 }) }, { $id: "AgentRunIdFacts", additionalProperties: false });
export const FinishAgentWaitFactsSchema = Type.Object({
  run_ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
}, { $id: "FinishAgentWaitFacts", additionalProperties: false });
export const AgentIdFactsSchema = Type.Object({ agent_id: Type.String({ minLength: 1 }) }, { $id: "AgentIdFacts", additionalProperties: false });
export const CronPromptSelectionSchema = Type.Union([
  Type.Object({ status: Type.Literal("cancelled") }, { additionalProperties: false }),
  Type.Object({ status: Type.Literal("selected"), selected: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
], { $id: "CronPromptSelection" });
export const HostToolResultFactsSchema = Type.Object({ action: Type.String({ pattern: "^(write_stdin|apply_patch|write|edit)$" }), details: Type.Unknown() }, { $id: "HostToolResultFacts", additionalProperties: false });
export type HostToolResultFacts = { readonly action: "write_stdin" | "apply_patch" | "write" | "edit"; readonly details: unknown };
const PreparedTextResultInputSchema = Type.Object({ text: Type.String(), details: Type.Unknown() });
export const ToolResultConstructionFactsSchema = Type.Object({ prepared: Type.Optional(PreparedTextResultInputSchema), extraDetails: Type.Optional(Type.Unknown()), error: Type.Optional(Type.String()), text: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()) }, { $id: "ToolResultConstructionFacts", additionalProperties: false });
export type ToolResultConstructionFacts =
  | { readonly prepared: Static<typeof PreparedTextResultInputSchema>; readonly extraDetails: unknown; readonly error?: never; readonly text?: never; readonly details?: never }
  | { readonly error: string; readonly details?: unknown; readonly prepared?: never; readonly extraDetails?: never; readonly text?: never }
  | { readonly text: string; readonly details?: unknown; readonly prepared?: never; readonly extraDetails?: never; readonly error?: never };
export const AgentNotificationDetailsSchema = Type.Object(
  { notificationId: Type.String({ pattern: "^agent_completion:.+" }) },
  { $id: "AgentNotificationDetails", additionalProperties: false },
);
export const PreparedAgentStartSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_start"),
    text: Type.String(),
    details: AgentStartDetailsSchema,
    prompt: Type.String(),
    agentId: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    submissionId: Type.String({ minLength: 1 }),
    capabilityId: Type.String({ minLength: 1 }),
    metadata: AgentSessionMetadataSchema,
  },
  { $id: "PreparedAgentStart", additionalProperties: false },
);
export const PreparedAgentSendSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_send"),
    text: Type.String(),
    details: AgentSendDetailsSchema,
    prompt: Type.String(),
    agentId: Type.String({ minLength: 1 }),
    dispatch: Type.Boolean(),
    interrupt: Type.Boolean(),
    dispatchDeliverAs: Type.Union([Type.Literal("steer"), Type.Literal("followUp")]),
    runId: Type.Optional(Type.String({ minLength: 1 })),
    submissionId: Type.Optional(Type.String({ minLength: 1 })),
    previousSubmissionId: Type.Optional(Type.String({ minLength: 1 })),
    previousReasonCode: Type.Optional(AgentSuspensionReasonCodeSchema),
    outcome: AgentSendOutcomeSchema,
    capabilityId: Type.String({ minLength: 1 }),
    metadata: AgentSessionMetadataSchema,
  },
  { $id: "PreparedAgentSend", additionalProperties: false },
);
export const PreparedAgentWaitSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_wait"),
    text: Type.String(),
    details: AgentWaitDetailsSchema,
    runIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: "PreparedAgentWait", additionalProperties: false },
);
export const PreparedAgentCloseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    action: Type.Literal("agent_close"),
    text: Type.String(),
    details: AgentCloseDetailsSchema,
    agentId: Type.String({ minLength: 1 }),
    runIds: Type.Array(Type.String({ minLength: 1 })),
    deleteWorktree: Type.Optional(Type.Boolean()),
    worktreePath: Type.Optional(Type.String()),
    worktreeBranch: Type.Optional(Type.String()),
    mainRepositoryRoot: Type.Optional(Type.String()),
    isolation: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("worktree")])),
    capabilityId: Type.String({ minLength: 1 }),
  },
  { $id: "PreparedAgentClose", additionalProperties: false },
);
export const AgentRoutingDiagnosticsResultSchema = Type.Object(
  { diagnostics: Type.Array(Type.String()) },
  { $id: "AgentRoutingDiagnosticsResult", additionalProperties: false },
);
export const AgentNotificationSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1 }), customType: Type.Literal("notification"),
    content: Type.String({ minLength: 1 }), display: Type.Literal(true),
    details: AgentNotificationDetailsSchema,
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
    agentId: Type.String({ minLength: 1 }), kind: AgentKindSchema,
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
    status: AgentRunStatusSchema, reasonCode: Type.Optional(AgentReasonCodeSchema),
    startedAt: Type.Integer(), endedAt: Type.Optional(Type.Integer()),
    suspendedAt: Type.Optional(Type.Integer()), description: Type.String(), turnCount: Type.Integer({ minimum: 0 }),
    lastActivityAt: Type.Optional(Type.Integer()), activityState: Type.Union([
      Type.Literal("starting"), Type.Literal("reasoning"), Type.Literal("using_tool"),
      Type.Literal("orphaned"), Type.Literal("inactive"),
    ]),
    recommendation: Type.Union([
      Type.Literal("wait"), Type.Literal("interrupt_or_close"),
      Type.Literal("call_agent_wait"), Type.Literal("resume_or_close"),
    ]), submissionId: Type.String({ minLength: 1 }),
    error: Type.Optional(Type.String()), announcement: Type.Union([
      Type.Literal("pending"), Type.Literal("observed_by_agent_wait"), Type.Literal("notification_sent"),
    ]),
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
  GatewayCommandErrorSchema, BridgeToolResultSchema, OpenAiUsageFetchSchema, UsagePairFetchSchema, PreparedReadSchema,
  PreparedViewMediaSchema, PreparedWriteStdinSchema, PreparedExecSchema, PreparedExecApprovalSchema,
  PreparedWriteSchema, PreparedWriteApprovalSchema, PreparedEditSchema, PreparedEditApprovalSchema,
  PreparedPatchSchema, PreparedPatchApprovalSchema, PreparedThreadQuerySchema, PreparedThreadReadSchema,
  PreparedExaSchema, PreparedExaApprovalSchema,
  PreparedAgentStartSchema, PreparedAgentSendSchema, PreparedAgentWaitSchema, PreparedAgentCloseSchema,
]);
export type PreparedToolAction = Static<typeof PreparedToolActionSchema>;
