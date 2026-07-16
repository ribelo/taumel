import { Compile } from "typebox/compile";
import { ActiveToolsPlanSchema, BridgeCommandResultSchema, BridgeToolExecutionResultSchema, BridgeToolResultSchema, ChildDispatchPlanSchema, ChildSessionStartPlanSchema, CommandChildDispatchPlanSchema, CommandChildSessionPlanSchema, CommandExecutionPlanSchema, CommandNotificationPlanSchema, CommandSpecsResultSchema, CompactionCommandPlanSchema, CompactionSessionPlanSchema, CoreAckSchema, CronCommandResultSchema, CronDeliveredResultSchema, CronGoalFactsSchema, CronListResultSchema, CronPollPlanSchema, CronPromptPlanSchema, CronPromptSchema, CronStartupPlanSchema, EditApplicationResultSchema, EnvironmentContextPlanSchema, ExecApprovalPromptPlanSchema, ExecApprovalResultSchema, ExecNotificationClaimSchema, ExecPolicyAllowRuleResultSchema, ExecToolResultSchema, GoalContinuationPlanSchema, GoalRollbackResultSchema, OpenAiUsageHostAuthSchema, OpenAiUsageHostParamsSchema, PatchApplicationResultSchema, PendingExecNotificationsResultSchema, PermissionsCommandResultSchema, PermissionsPromptPlanSchema, PermissionsPromptSchema, RefreshExecPolicyResultSchema, SandboxHostPathPlanSchema, SkillListResultSchema, SkillResolveResultSchema, ThreadCatalogScansResultSchema, ToolNamesResultSchema, ToolResultEnvelopeSchema, ViewMediaResultEnvelopeSchema, VisibilityListResultSchema, VisibilityRowsResultSchema, VisibilitySavePlanSchema, VisibilityToggleResultSchema, VisibilityWarningsResultSchema, WorkspaceMutationValidationSchema, type ActiveToolsPlan, type BridgeCommandResult, type BridgeToolExecutionResult, type BridgeToolResult, type ChildDispatchPlan, type ChildSessionStartPlan, type CommandChildDispatchPlan, type CommandChildSessionPlan, type CommandExecutionPlan, type CommandNotificationPlan, type CommandSpecsResult, type CompactionCommandPlan, type CompactionSessionPlan, type CoreAck, type CronCommandResult, type CronDeliveredResult, type CronGoalFacts, type CronListResult, type CronPollPlan, type CronPrompt, type CronPromptPlan, type CronStartupPlan, type EditApplicationResult, type EnvironmentContextPlan, type ExecApprovalPromptPlan, type ExecApprovalResult, type ExecNotificationClaim, type ExecPolicyAllowRuleResult, type ExecToolResult, type GoalContinuationPlan, type GoalRollbackResult, type OpenAiUsageHostAuth, type OpenAiUsageHostParams, type PatchApplicationResult, type PendingExecNotificationsResult, type PermissionsCommandResult, type PermissionsPrompt, type PermissionsPromptPlan, type RefreshExecPolicyResult, type SandboxHostPathPlan, type SkillListResult, type SkillResolveResult, type ThreadCatalogScansResult, type ToolNamesResult, type ToolResultEnvelope, type ViewMediaResultEnvelope, type VisibilityListResult, type VisibilityRowsResult, type VisibilitySavePlan, type VisibilityToggleResult, type VisibilityWarningsResult, type WorkspaceMutationValidation } from "./bridge-core-contracts.ts";
import { AgentActiveCountResultSchema, AgentCleanupPlanSchema, AgentManagerSnapshotSchema, AgentNotificationClaimValidationSchema, AgentRoutingDiagnosticsResultSchema, ComposerCommandResultSchema, CronGoalCreationResultSchema, GatewayCommandOutputSchema, PendingAgentNotificationsResultSchema, PreparedToolActionSchema, type AgentActiveCountResult, type AgentCleanupPlan, type AgentManagerSnapshot, type AgentNotificationClaimValidation, type AgentRoutingDiagnosticsResult, type ComposerCommandResult, type CronGoalCreationResult, type GatewayCommandOutput, type PendingAgentNotificationsResult, type PreparedToolAction } from "./bridge-action-contracts.ts";
import { ChildSessionMetadataSchema, type ChildSessionMetadata } from "./bridge-child-session-contracts.ts";

const activeToolsPlanDecoder = Compile(ActiveToolsPlanSchema);
const commandSpecsResultDecoder = Compile(CommandSpecsResultSchema);
const toolNamesResultDecoder = Compile(ToolNamesResultSchema);
const threadCatalogScansResultDecoder = Compile(ThreadCatalogScansResultSchema);
const pendingExecNotificationsResultDecoder = Compile(PendingExecNotificationsResultSchema);
const execNotificationClaimDecoder = Compile(ExecNotificationClaimSchema);
const openAiUsageHostAuthDecoder = Compile(OpenAiUsageHostAuthSchema);
const openAiUsageHostParamsDecoder = Compile(OpenAiUsageHostParamsSchema);
const refreshExecPolicyResultDecoder = Compile(RefreshExecPolicyResultSchema);
const skillListResultDecoder = Compile(SkillListResultSchema);
const skillResolveResultDecoder = Compile(SkillResolveResultSchema);
const environmentContextPlanDecoder = Compile(EnvironmentContextPlanSchema);
const commandNotificationPlanDecoder = Compile(CommandNotificationPlanSchema);
const goalContinuationPlanDecoder = Compile(GoalContinuationPlanSchema);
const childSessionStartPlanDecoder = Compile(ChildSessionStartPlanSchema);
const childSessionMetadataDecoder = Compile(ChildSessionMetadataSchema);
const childDispatchPlanDecoder = Compile(ChildDispatchPlanSchema);
const sandboxHostPathPlanDecoder = Compile(SandboxHostPathPlanSchema);
const workspaceMutationValidationDecoder = Compile(WorkspaceMutationValidationSchema);
const execPolicyAllowRuleResultDecoder = Compile(ExecPolicyAllowRuleResultSchema);
const execApprovalPromptPlanDecoder = Compile(ExecApprovalPromptPlanSchema);
const commandExecutionPlanDecoder = Compile(CommandExecutionPlanSchema);
const commandChildSessionPlanDecoder = Compile(CommandChildSessionPlanSchema);
const bridgeToolResultDecoder = Compile(BridgeToolResultSchema);
const bridgeToolExecutionResultDecoder = Compile(BridgeToolExecutionResultSchema);
const toolResultEnvelopeDecoder = Compile(ToolResultEnvelopeSchema);
const bridgeCommandResultDecoder = Compile(BridgeCommandResultSchema);
const viewMediaResultEnvelopeDecoder = Compile(ViewMediaResultEnvelopeSchema);
const execToolResultDecoder = Compile(ExecToolResultSchema);
const execApprovalResultDecoder = Compile(ExecApprovalResultSchema);
const commandChildDispatchPlanDecoder = Compile(CommandChildDispatchPlanSchema);
const cronGoalFactsDecoder = Compile(CronGoalFactsSchema);
const cronPollPlanDecoder = Compile(CronPollPlanSchema);
const cronDeliveredResultDecoder = Compile(CronDeliveredResultSchema);
const cronStartupPlanDecoder = Compile(CronStartupPlanSchema);
const goalRollbackResultDecoder = Compile(GoalRollbackResultSchema);
const editApplicationResultDecoder = Compile(EditApplicationResultSchema);
const patchApplicationResultDecoder = Compile(PatchApplicationResultSchema);
const visibilityWarningsResultDecoder = Compile(VisibilityWarningsResultSchema);
const visibilityRowsResultDecoder = Compile(VisibilityRowsResultSchema);
const visibilityToggleResultDecoder = Compile(VisibilityToggleResultSchema);
const visibilitySavePlanDecoder = Compile(VisibilitySavePlanSchema);
const visibilityListResultDecoder = Compile(VisibilityListResultSchema);
const compactionCommandPlanDecoder = Compile(CompactionCommandPlanSchema);
const compactionSessionPlanDecoder = Compile(CompactionSessionPlanSchema);
const permissionsPromptPlanDecoder = Compile(PermissionsPromptPlanSchema);
const permissionsPromptDecoder = Compile(PermissionsPromptSchema);
const permissionsCommandResultDecoder = Compile(PermissionsCommandResultSchema);
const cronListResultDecoder = Compile(CronListResultSchema);
const cronCommandResultDecoder = Compile(CronCommandResultSchema);
const cronPromptDecoder = Compile(CronPromptSchema);
const cronPromptPlanDecoder = Compile(CronPromptPlanSchema);
const composerCommandResultDecoder = Compile(ComposerCommandResultSchema);
const cronGoalCreationResultDecoder = Compile(CronGoalCreationResultSchema);
const gatewayCommandOutputDecoder = Compile(GatewayCommandOutputSchema);
const preparedToolActionDecoder = Compile(PreparedToolActionSchema);
const coreAckDecoder = Compile(CoreAckSchema);
const agentRoutingDiagnosticsResultDecoder = Compile(AgentRoutingDiagnosticsResultSchema);
const pendingAgentNotificationsResultDecoder = Compile(PendingAgentNotificationsResultSchema);
const agentNotificationClaimValidationDecoder = Compile(AgentNotificationClaimValidationSchema);
const agentActiveCountResultDecoder = Compile(AgentActiveCountResultSchema);
const agentCleanupPlanDecoder = Compile(AgentCleanupPlanSchema);
const agentManagerSnapshotDecoder = Compile(AgentManagerSnapshotSchema);

export function decodeActiveToolsPlan(value: unknown): ActiveToolsPlan {
  try {
    return activeToolsPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml active-tools plan response");
  }
}

export function decodeCommandSpecsResult(value: unknown): CommandSpecsResult {
  try {
    return commandSpecsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command-specs response");
  }
}

export function decodeToolNamesResult(value: unknown): ToolNamesResult {
  try {
    return toolNamesResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml tool-names response");
  }
}

export function decodeThreadCatalogScansResult(value: unknown): ThreadCatalogScansResult {
  try {
    return threadCatalogScansResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml thread-catalog scans response");
  }
}

export function decodePendingExecNotificationsResult(value: unknown): PendingExecNotificationsResult {
  try {
    return pendingExecNotificationsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml pending-exec-notifications response");
  }
}

export function decodeExecNotificationClaim(value: unknown): ExecNotificationClaim {
  try {
    return execNotificationClaimDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml exec-notification claim response");
  }
}

export function decodeOpenAiUsageHostAuth(value: unknown): OpenAiUsageHostAuth {
  try {
    return openAiUsageHostAuthDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml OpenAI usage host-auth response");
  }
}

export function decodeOpenAiUsageHostParams(value: unknown): OpenAiUsageHostParams {
  try {
    return openAiUsageHostParamsDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml OpenAI usage host-params response");
  }
}

export function decodeRefreshExecPolicyResult(value: unknown): RefreshExecPolicyResult {
  try {
    return refreshExecPolicyResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml refresh-exec-policy response");
  }
}

export function decodeSkillListResult(value: unknown): SkillListResult {
  try { return skillListResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml skill-list response"); }
}

export function decodeSkillResolveResult(value: unknown): SkillResolveResult {
  try { return skillResolveResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml skill-resolve response"); }
}

export function decodeEnvironmentContextPlan(value: unknown): EnvironmentContextPlan {
  try { return environmentContextPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml environment-context plan response"); }
}

export function decodeCommandNotificationPlan(value: unknown): CommandNotificationPlan {
  try { return commandNotificationPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml command-notification plan response"); }
}

export function decodeGoalContinuationPlan(value: unknown): GoalContinuationPlan {
  try { return goalContinuationPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml goal-continuation plan response"); }
}

export function decodeChildSessionStartPlan(value: unknown): ChildSessionStartPlan {
  try { return childSessionStartPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml child-session start plan response"); }
}

export function decodeChildSessionMetadata(value: unknown): ChildSessionMetadata {
  try { return childSessionMetadataDecoder.Decode(value); }
  catch { throw new Error("Invalid child-session metadata"); }
}

export function decodeChildDispatchPlan(value: unknown): ChildDispatchPlan {
  try { return childDispatchPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml child-dispatch plan response"); }
}

export function decodeSandboxHostPathPlan(value: unknown): SandboxHostPathPlan {
  try { return sandboxHostPathPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml sandbox host-path plan response"); }
}

export function decodeWorkspaceMutationValidation(value: unknown): WorkspaceMutationValidation {
  try { return workspaceMutationValidationDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml workspace-mutation validation response"); }
}

export function decodeExecPolicyAllowRuleResult(value: unknown): ExecPolicyAllowRuleResult {
  try { return execPolicyAllowRuleResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml exec-policy amendment response"); }
}

export function decodeExecApprovalPromptPlan(value: unknown): ExecApprovalPromptPlan {
  try { return execApprovalPromptPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml exec-approval prompt plan response"); }
}

export function decodeCommandExecutionPlan(value: unknown): CommandExecutionPlan {
  try { return commandExecutionPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml command-execution plan response"); }
}

export function decodeCommandChildSessionPlan(value: unknown): CommandChildSessionPlan {
  try { return commandChildSessionPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml command child-session plan response"); }
}

export function decodeBridgeToolResult(value: unknown): BridgeToolResult {
  try { return bridgeToolResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml tool-result response"); }
}
export function decodeBridgeToolExecutionResult(value: unknown): BridgeToolExecutionResult {
  try { return bridgeToolExecutionResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml tool-execution response"); }
}
export function decodeToolResultEnvelope(value: unknown): ToolResultEnvelope {
  try { return toolResultEnvelopeDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml tool-result envelope response"); }
}
export function decodeBridgeCommandResult(value: unknown): BridgeCommandResult {
  try { return bridgeCommandResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml command-result response"); }
}
export function decodeViewMediaResultEnvelope(value: unknown): ViewMediaResultEnvelope {
  try { return viewMediaResultEnvelopeDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml view-media response"); }
}
export function decodeExecToolResult(value: unknown): ExecToolResult {
  try { return execToolResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml exec result response"); }
}
export function decodeExecApprovalResult(value: unknown): ExecApprovalResult {
  try { return execApprovalResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml exec-approval result response"); }
}
export function decodeCommandChildDispatchPlan(value: unknown): CommandChildDispatchPlan {
  try { return commandChildDispatchPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml command child-dispatch plan response"); }
}
export function decodeCronGoalFacts(value: unknown): CronGoalFacts {
  try { return cronGoalFactsDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron goal-facts response"); }
}
export function decodeCronPollPlan(value: unknown): CronPollPlan {
  try { return cronPollPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron-poll response"); }
}
export function decodeCronDeliveredResult(value: unknown): CronDeliveredResult {
  try { return cronDeliveredResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron-delivered response"); }
}
export function decodeCronStartupPlan(value: unknown): CronStartupPlan {
  try { return cronStartupPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron-startup response"); }
}
export function decodeGoalRollbackResult(value: unknown): GoalRollbackResult {
  try { return goalRollbackResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml goal-rollback response"); }
}
export function decodeEditApplicationResult(value: unknown): EditApplicationResult {
  try { return editApplicationResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml edit-application response"); }
}
export function decodePatchApplicationResult(value: unknown): PatchApplicationResult {
  try { return patchApplicationResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml patch-application response"); }
}
export function decodeVisibilityWarningsResult(value: unknown): VisibilityWarningsResult {
  try { return visibilityWarningsResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml visibility-warnings response"); }
}
export function decodeVisibilityRowsResult(value: unknown): VisibilityRowsResult {
  try { return visibilityRowsResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml visibility-rows response"); }
}
export function decodeVisibilityToggleResult(value: unknown): VisibilityToggleResult {
  try { return visibilityToggleResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml visibility-toggle response"); }
}
export function decodeVisibilitySavePlan(value: unknown): VisibilitySavePlan {
  try { return visibilitySavePlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml visibility-save plan response"); }
}
export function decodeVisibilityListResult(value: unknown): VisibilityListResult {
  try { return visibilityListResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml visibility-list response"); }
}
export function decodeCompactionCommandPlan(value: unknown): CompactionCommandPlan {
  try { return compactionCommandPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml compaction command plan response"); }
}
export function decodeCompactionSessionPlan(value: unknown): CompactionSessionPlan {
  try { return compactionSessionPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml compaction session plan response"); }
}
export function decodePermissionsPromptPlan(value: unknown): PermissionsPromptPlan {
  try { return permissionsPromptPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml permissions prompt plan response"); }
}
export function decodePermissionsPrompt(value: unknown): PermissionsPrompt {
  try { return permissionsPromptDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml permissions prompt"); }
}
export function decodePermissionsCommandResult(value: unknown): PermissionsCommandResult {
  try { return permissionsCommandResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml permissions command response"); }
}
export function decodeCronListResult(value: unknown): CronListResult {
  try { return cronListResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron-list response"); }
}
export function decodeCronCommandResult(value: unknown): CronCommandResult {
  try { return cronCommandResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron command response"); }
}
export function decodeCronPrompt(value: unknown): CronPrompt {
  try { return cronPromptDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron prompt"); }
}
export function decodeCronPromptPlan(value: unknown): CronPromptPlan {
  try { return cronPromptPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron prompt plan response"); }
}
export function decodeComposerCommandResult(value: unknown): ComposerCommandResult {
  try { return composerCommandResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml composer command response"); }
}
export function decodeCronGoalCreationResult(value: unknown): CronGoalCreationResult {
  try { return cronGoalCreationResultDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml cron goal-creation response"); }
}
export function decodeGatewayCommandOutput(value: unknown): GatewayCommandOutput {
  try { return gatewayCommandOutputDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml gateway command response"); }
}
export function decodePreparedToolAction(value: unknown): PreparedToolAction {
  try { return preparedToolActionDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml prepared tool action"); }
}
export function decodeCoreAck(value: unknown): CoreAck {
  try { return coreAckDecoder.Decode(value); }
  catch { throw new Error("Invalid OCaml acknowledgement"); }
}
export function decodeAgentRoutingDiagnosticsResult(value: unknown): AgentRoutingDiagnosticsResult {
  try { return agentRoutingDiagnosticsResultDecoder.Decode(value); }
  catch { throw new Error("Invalid agent routing diagnostics result"); }
}
export function decodePendingAgentNotificationsResult(value: unknown): PendingAgentNotificationsResult {
  try { return pendingAgentNotificationsResultDecoder.Decode(value); }
  catch { throw new Error("Invalid pending agent notifications result"); }
}
export function decodeAgentNotificationClaimValidation(value: unknown): AgentNotificationClaimValidation {
  try { return agentNotificationClaimValidationDecoder.Decode(value); }
  catch { throw new Error("Invalid agent notification claim validation"); }
}
export function decodeAgentActiveCountResult(value: unknown): AgentActiveCountResult {
  try { return agentActiveCountResultDecoder.Decode(value); }
  catch { throw new Error("Invalid agent active count result"); }
}
export function decodeAgentCleanupPlan(value: unknown): AgentCleanupPlan {
  try { return agentCleanupPlanDecoder.Decode(value); }
  catch { throw new Error("Invalid agent cleanup plan"); }
}
export function decodeAgentManagerSnapshot(value: unknown): AgentManagerSnapshot {
  try { return agentManagerSnapshotDecoder.Decode(value); }
  catch { throw new Error("Invalid agent manager snapshot"); }
}
