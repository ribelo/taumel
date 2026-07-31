import { createRequire } from "node:module";
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { createRequire as createRequire2 } from "node:module";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { getAgentDir as getAgentDir4 } from "@earendil-works/pi-coding-agent";

// src/composer.ts
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
  visibleWidth
} from "@earendil-works/pi-tui";

// src/global-settings.ts
import { readFile } from "node:fs/promises";
import { join as join3 } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// src/util.ts
import { randomUUID } from "node:crypto";
import { constants as constants2, realpathSync } from "node:fs";
import { lstat as lstat2, mkdir as mkdir2, open as open2, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join as join2, relative, sep } from "node:path";

// src/descriptor-paths.ts
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
function identityMatches(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function stateMatches(left, right) {
  return identityMatches(left.identity, right.identity) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function fileStateFromStats(stats) {
  return {
    identity: { dev: stats.dev, ino: stats.ino },
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs
  };
}
async function pathIdentity(path) {
  const stats = await lstat(path, { bigint: true });
  return { dev: stats.dev, ino: stats.ino };
}
async function optionalPathIdentity(path) {
  try {
    return await pathIdentity(path);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT")
      throw error;
  }
  return;
}

class DescriptorPathUnavailableError extends Error {
  constructor(cause) {
    super("Descriptor-anchored mutation requires Linux with procfs (/proc/self/fd)", { cause });
    this.name = "DescriptorPathUnavailableError";
  }
}
var pinnedDirectoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
function descriptorPath(parent, name) {
  return `/proc/self/fd/${parent.fd}/${name}`;
}
async function openPinnedDirectory(path) {
  return await open(path, pinnedDirectoryFlags);
}
async function openPinnedChildDirectory(parent, name) {
  return await open(descriptorPath(parent, name), pinnedDirectoryFlags);
}
async function probeDescriptorPaths() {
  if (process.platform !== "linux")
    throw new DescriptorPathUnavailableError;
  let anchor;
  try {
    anchor = await openPinnedDirectory("/proc/self/fd");
    const roundTrip = await openPinnedChildDirectory(anchor, ".");
    await roundTrip.close();
  } catch (error) {
    if (error instanceof DescriptorPathUnavailableError)
      throw error;
    throw new DescriptorPathUnavailableError(error);
  } finally {
    await anchor?.close();
  }
}
var probeResult;
var probeOverride;
async function requireDescriptorPaths() {
  if (probeOverride !== undefined)
    return await probeOverride();
  probeResult ??= probeDescriptorPaths();
  return await probeResult;
}
function anchoredEntryPath(anchor, name) {
  return anchor.kind === "pinned" ? descriptorPath(anchor.handle, name) : join(anchor.path, name);
}
async function closeMutationAnchor(anchor) {
  if (anchor.kind !== "pinned")
    return;
  try {
    await anchor.handle.close();
  } catch {}
}
async function syncMutationAnchor(anchor) {
  try {
    if (anchor.kind === "pinned") {
      await anchor.handle.sync();
      return;
    }
    let handle;
    try {
      handle = await open(anchor.path, "r");
      await handle.sync();
    } finally {
      await handle?.close();
    }
  } catch {}
}
async function walkPathnameMutationParent(request) {
  let currentPath = request.anchorPath;
  let currentIdentity = request.anchorIdentity;
  for (const component of request.components) {
    if (!identityMatches(currentIdentity, await pathIdentity(currentPath))) {
      throw request.changedError();
    }
    const nextPath = join(currentPath, component);
    try {
      await mkdir(nextPath);
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST")
        throw error;
    }
    const stats = await lstat(nextPath, { bigint: true });
    if (!stats.isDirectory()) {
      throw new Error(`Mutation path ancestor is not a directory: ${nextPath}`);
    }
    currentPath = nextPath;
    currentIdentity = { dev: stats.dev, ino: stats.ino };
  }
  return { kind: "pathname", path: currentPath };
}

// src/bridge-core-contracts.ts
var exports_bridge_core_contracts = {};
__export(exports_bridge_core_contracts, {
  WriteStdinFactsSchema: () => WriteStdinFactsSchema,
  WorkspaceMutationValidationSchema: () => WorkspaceMutationValidationSchema,
  WorkspaceMutationValidSchema: () => WorkspaceMutationValidSchema,
  WorkspaceMutationInvalidSchema: () => WorkspaceMutationInvalidSchema,
  WorkspaceMutationFactsSchema: () => WorkspaceMutationFactsSchema,
  VisibilityWarningsResultSchema: () => VisibilityWarningsResultSchema,
  VisibilityWarningFactsSchema: () => VisibilityWarningFactsSchema,
  VisibilityToggleSuccessSchema: () => VisibilityToggleSuccessSchema,
  VisibilityToggleResultSchema: () => VisibilityToggleResultSchema,
  VisibilityToggleFactsSchema: () => VisibilityToggleFactsSchema,
  VisibilityToggleErrorSchema: () => VisibilityToggleErrorSchema,
  VisibilitySavePlanSchema: () => VisibilitySavePlanSchema,
  VisibilityRowsResultSchema: () => VisibilityRowsResultSchema,
  VisibilityRowsFactsSchema: () => VisibilityRowsFactsSchema,
  VisibilityRowSchema: () => VisibilityRowSchema,
  VisibilityMutationDetailsSchema: () => VisibilityMutationDetailsSchema,
  VisibilityListResultSchema: () => VisibilityListResultSchema,
  ViewMediaSuccessEnvelopeSchema: () => ViewMediaSuccessEnvelopeSchema,
  ViewMediaResultEnvelopeSchema: () => ViewMediaResultEnvelopeSchema,
  ViewMediaFactsSchema: () => ViewMediaFactsSchema,
  UsagePairHostParamsSchema: () => UsagePairHostParamsSchema,
  ToolResultTextContentSchema: () => ToolResultTextContentSchema,
  ToolResultImageContentSchema: () => ToolResultImageContentSchema,
  ToolResultEnvelopeSchema: () => ToolResultEnvelopeSchema,
  ToolNamesResultSchema: () => ToolNamesResultSchema,
  ThreadToolFactsSchema: () => ThreadToolFactsSchema,
  ThreadCatalogScansResultSchema: () => ThreadCatalogScansResultSchema,
  ThreadCatalogScanSchema: () => ThreadCatalogScanSchema,
  ThreadCatalogFactsSchema: () => ThreadCatalogFactsSchema,
  SkillResolveResultSchema: () => SkillResolveResultSchema,
  SkillResolveFactsSchema: () => SkillResolveFactsSchema,
  SkillListResultSchema: () => SkillListResultSchema,
  SkillListFactsSchema: () => SkillListFactsSchema,
  SkillInfoSchema: () => SkillInfoSchema,
  SkillBlockSchema: () => SkillBlockSchema,
  ResolvedMutationPathSchema: () => ResolvedMutationPathSchema,
  RefreshExecPolicyResultSchema: () => RefreshExecPolicyResultSchema,
  RefreshExecPolicyFactsSchema: () => RefreshExecPolicyFactsSchema,
  ReadFileFactsSchema: () => ReadFileFactsSchema,
  PlanRollbackResultSchema: () => PlanRollbackResultSchema,
  PlanRollbackFactsSchema: () => PlanRollbackFactsSchema,
  PlanPresentationDetailsSchema: () => PlanPresentationDetailsSchema,
  PlanContinuationSendSchema: () => PlanContinuationSendSchema,
  PlanContinuationPlanSchema: () => PlanContinuationPlanSchema,
  PlanContinuationNoneSchema: () => PlanContinuationNoneSchema,
  PlanContinuationFactsSchema: () => PlanContinuationFactsSchema,
  PermissionsStateV1Schema: () => PermissionsStateV1Schema,
  PermissionsSelectionSchema: () => PermissionsSelectionSchema,
  PermissionsPromptSelectSchema: () => PermissionsPromptSelectSchema,
  PermissionsPromptSchema: () => PermissionsPromptSchema,
  PermissionsPromptResultSchema: () => PermissionsPromptResultSchema,
  PermissionsPromptPlanSchema: () => PermissionsPromptPlanSchema,
  PermissionsPromptFinishFactsSchema: () => PermissionsPromptFinishFactsSchema,
  PermissionsPromptFactsSchema: () => PermissionsPromptFactsSchema,
  PermissionsMenuOptionSchema: () => PermissionsMenuOptionSchema,
  PermissionsCommandResultSchema: () => PermissionsCommandResultSchema,
  PendingExecNotificationsResultSchema: () => PendingExecNotificationsResultSchema,
  PatchWriteSchema: () => PatchWriteSchema,
  PatchAppliedSchema: () => PatchAppliedSchema,
  PatchApplicationResultSchema: () => PatchApplicationResultSchema,
  PatchApplicationFactsSchema: () => PatchApplicationFactsSchema,
  OpenAiUsageHostParamsSchema: () => OpenAiUsageHostParamsSchema,
  OpenAiUsageHostParamsPresentSchema: () => OpenAiUsageHostParamsPresentSchema,
  OpenAiUsageHostParamsMissingSchema: () => OpenAiUsageHostParamsMissingSchema,
  OpenAiUsageHostParamsErrorSchema: () => OpenAiUsageHostParamsErrorSchema,
  OpenAiUsageHostLookupFactsSchema: () => OpenAiUsageHostLookupFactsSchema,
  OpenAiUsageHostAuthSchema: () => OpenAiUsageHostAuthSchema,
  MutationErrorSchema: () => MutationErrorSchema,
  KimiUsageHostParamsSchema: () => KimiUsageHostParamsSchema,
  KimiUsageHostParamsPresentSchema: () => KimiUsageHostParamsPresentSchema,
  KimiUsageHostParamsMissingSchema: () => KimiUsageHostParamsMissingSchema,
  KimiUsageHostParamsErrorSchema: () => KimiUsageHostParamsErrorSchema,
  KimiUsageHostLookupFactsSchema: () => KimiUsageHostLookupFactsSchema,
  KimiUsageHostAuthSchema: () => KimiUsageHostAuthSchema,
  HostExecResultSchema: () => HostExecResultSchema,
  FinalizePlanErrorFactsSchema: () => FinalizePlanErrorFactsSchema,
  ExecTruncationSchema: () => ExecTruncationSchema,
  ExecToolResultSchema: () => ExecToolResultSchema,
  ExecResultDetailsSchema: () => ExecResultDetailsSchema,
  ExecPolicyScopeSchema: () => ExecPolicyScopeSchema,
  ExecPolicyAllowRuleResultSchema: () => ExecPolicyAllowRuleResultSchema,
  ExecPolicyAllowRuleFactsSchema: () => ExecPolicyAllowRuleFactsSchema,
  ExecNotificationUnavailableSchema: () => ExecNotificationUnavailableSchema,
  ExecNotificationSchema: () => ExecNotificationSchema,
  ExecNotificationClaimedSchema: () => ExecNotificationClaimedSchema,
  ExecNotificationClaimSchema: () => ExecNotificationClaimSchema,
  ExecCompletionWaitResultSchema: () => ExecCompletionWaitResultSchema,
  ExecApprovalUnavailableSchema: () => ExecApprovalUnavailableSchema,
  ExecApprovalRunSchema: () => ExecApprovalRunSchema,
  ExecApprovalResultSchema: () => ExecApprovalResultSchema,
  ExecApprovalPromptPlanSchema: () => ExecApprovalPromptPlanSchema,
  ExecApprovalPromptFactsSchema: () => ExecApprovalPromptFactsSchema,
  ExecApprovalOutcomeFactsSchema: () => ExecApprovalOutcomeFactsSchema,
  ExecApprovalDeniedSchema: () => ExecApprovalDeniedSchema,
  ExecApprovalConfirmSchema: () => ExecApprovalConfirmSchema,
  ExaExecutionFactsSchema: () => ExaExecutionFactsSchema,
  EnvironmentContextPlanSchema: () => EnvironmentContextPlanSchema,
  EnvironmentContextNoneSchema: () => EnvironmentContextNoneSchema,
  EnvironmentContextInjectSchema: () => EnvironmentContextInjectSchema,
  EnvironmentContextFactsSchema: () => EnvironmentContextFactsSchema,
  EditAppliedSchema: () => EditAppliedSchema,
  EditApplicationResultSchema: () => EditApplicationResultSchema,
  EditApplicationFactsSchema: () => EditApplicationFactsSchema,
  CronTaskUpdateFactsSchema: () => CronTaskUpdateFactsSchema,
  CronTaskSchema: () => CronTaskSchema2,
  CronTaskPatchSchema: () => CronTaskPatchSchema,
  CronStartupPlanSchema: () => CronStartupPlanSchema,
  CronStartupNotifySchema: () => CronStartupNotifySchema,
  CronStartupNoneSchema: () => CronStartupNoneSchema,
  CronStartupFactsSchema: () => CronStartupFactsSchema,
  CronPromptSchema: () => CronPromptSchema,
  CronPromptPlanSchema: () => CronPromptPlanSchema,
  CronPromptFactsSchema: () => CronPromptFactsSchema,
  CronPollPlanSchema: () => CronPollPlanSchema,
  CronPollNoneSchema: () => CronPollNoneSchema,
  CronPollFactsSchema: () => CronPollFactsSchema,
  CronPollDeliverySchema: () => CronPollDeliverySchema,
  CronPlanFactsSchema: () => CronPlanFactsSchema,
  CronManagerCommandFactsSchema: () => CronManagerCommandFactsSchema,
  CronListResultSchema: () => CronListResultSchema,
  CronListDetailsSchema: () => CronListDetailsSchema,
  CronDeliveredResultSchema: () => CronDeliveredResultSchema,
  CronDeliveredFactsSchema: () => CronDeliveredFactsSchema,
  CronContextFactsSchema: () => CronContextFactsSchema,
  CronCommandResultSchema: () => CronCommandResultSchema,
  CoreAckSchema: () => CoreAckSchema,
  CompactionUseModelSchema: () => CompactionUseModelSchema,
  CompactionShowSchema: () => CompactionShowSchema,
  CompactionSettingsSchema: () => CompactionSettingsSchema,
  CompactionSetProjectSchema: () => CompactionSetProjectSchema,
  CompactionSessionPlanSchema: () => CompactionSessionPlanSchema,
  CompactionPlanErrorSchema: () => CompactionPlanErrorSchema,
  CompactionOpenPickerSchema: () => CompactionOpenPickerSchema,
  CompactionDefaultSchema: () => CompactionDefaultSchema,
  CompactionCommandPlanSchema: () => CompactionCommandPlanSchema,
  CompactionCommandFactsSchema: () => CompactionCommandFactsSchema,
  CompactionClearProjectSchema: () => CompactionClearProjectSchema,
  CommandSpecsResultSchema: () => CommandSpecsResultSchema,
  CommandSpecSchema: () => CommandSpecSchema,
  CommandNotificationUnavailableSchema: () => CommandNotificationUnavailableSchema,
  CommandNotificationSendSchema: () => CommandNotificationSendSchema,
  CommandNotificationPlanSchema: () => CommandNotificationPlanSchema,
  CommandNotificationFactsSchema: () => CommandNotificationFactsSchema,
  CommandExecutionPlanSchema: () => CommandExecutionPlanSchema,
  CommandExecutionFactsSchema: () => CommandExecutionFactsSchema,
  CommandExecutionErrorSchema: () => CommandExecutionErrorSchema,
  CommandExecutionDirectSchema: () => CommandExecutionDirectSchema,
  CommandExecutionChildSchema: () => CommandExecutionChildSchema,
  CommandContextOverrideSchema: () => CommandContextOverrideSchema,
  CommandChildSessionPlanSchema: () => CommandChildSessionPlanSchema,
  CommandChildSessionFactsSchema: () => CommandChildSessionFactsSchema,
  CommandChildReturnSchema: () => CommandChildReturnSchema,
  CommandChildDispatchSchema: () => CommandChildDispatchSchema,
  CommandChildDispatchPlanSchema: () => CommandChildDispatchPlanSchema,
  CommandChildDispatchFinishFactsSchema: () => CommandChildDispatchFinishFactsSchema,
  CommandChildDispatchFactsSchema: () => CommandChildDispatchFactsSchema,
  CommandBridgeUpdateSchema: () => CommandBridgeUpdateSchema,
  ChildSessionStartPlanSchema: () => ChildSessionStartPlanSchema,
  ChildSessionStartFactsSchema: () => ChildSessionStartFactsSchema,
  ChildSessionSetupEntrySchema: () => ChildSessionSetupEntrySchema,
  ChildSessionMetadataSchema: () => ChildSessionMetadataSchema,
  ChildPlanContinuationSendSchema: () => ChildPlanContinuationSendSchema,
  ChildPlanContinuationFinalizeSchema: () => ChildPlanContinuationFinalizeSchema,
  ChildPermissionRefreshPlanSchema: () => ChildPermissionRefreshPlanSchema,
  ChildDispatchResultSchema: () => ChildDispatchResultSchema,
  ChildDispatchPlanSchema: () => ChildDispatchPlanSchema,
  ChildDispatchFactsSchema: () => ChildDispatchFactsSchema,
  ChildDispatchCompletionSchema: () => ChildDispatchCompletionSchema,
  BridgeWarningSchema: () => BridgeWarningSchema,
  BridgeToolResultSchema: () => BridgeToolResultSchema,
  BridgeToolExecutionResultSchema: () => BridgeToolExecutionResultSchema,
  BridgeErrorResultSchema: () => BridgeErrorResultSchema,
  BridgeCommandResultSchema: () => BridgeCommandResultSchema,
  AuthorizedMutationPathSchema: () => AuthorizedMutationPathSchema,
  AuthorityPlanRefSchema: () => AuthorityPlanRefSchema,
  AuthorityPlanIssuedSchema: () => AuthorityPlanIssuedSchema,
  AgentOwnerContextFactsSchema: () => AgentOwnerContextFactsSchema,
  AgentActionCapabilityFactsSchema: () => AgentActionCapabilityFactsSchema,
  ActiveToolsSyncFactsSchema: () => ActiveToolsSyncFactsSchema,
  ActiveToolsPlanSchema: () => ActiveToolsPlanSchema
});
import Type7 from "typebox";

// src/plan-presentation-contract.ts
import Type from "typebox";
var PlanBlockBaseSchema = {
  blockedAt: Type.Integer({ minimum: 0 }),
  reason: Type.String({ minLength: 1 }),
  source: Type.Union([Type.Literal("agent"), Type.Literal("system")])
};
var PlanBlockSchema = Type.Union([
  Type.Object(PlanBlockBaseSchema, { additionalProperties: false }),
  Type.Object({
    ...PlanBlockBaseSchema,
    clearedAt: Type.Integer({ minimum: 0 }),
    clearedBy: Type.Union([Type.Literal("agent"), Type.Literal("user")]),
    resolution: Type.String({ minLength: 1 })
  }, { additionalProperties: false })
]);
var PlanTaskBaseSchema = {
  taskId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  description: Type.Union([Type.String(), Type.Null()]),
  depends_on: Type.Array(Type.String({ minLength: 1 })),
  origin: Type.Union([Type.Literal("user"), Type.Literal("agent")])
};
var PlanTaskSchema = Type.Union([
  Type.Object({
    ...PlanTaskBaseSchema,
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("in_progress"),
      Type.Literal("completed")
    ])
  }, { additionalProperties: false }),
  Type.Object({
    ...PlanTaskBaseSchema,
    status: Type.Literal("cancelled"),
    cancellationReason: Type.String({ minLength: 1 })
  }, { additionalProperties: false })
]);
var PlanPresentationSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal("draft"),
    Type.Literal("active"),
    Type.Literal("paused"),
    Type.Literal("blocked"),
    Type.Literal("time_limited"),
    Type.Literal("complete")
  ]),
  statusLabel: Type.String({ minLength: 1 }),
  tasks: Type.Array(PlanTaskSchema, { minItems: 1 }),
  blocks: Type.Optional(Type.Array(PlanBlockSchema)),
  completedTasks: Type.Integer({ minimum: 0 }),
  totalTasks: Type.Integer({ minimum: 1 }),
  tokensUsed: Type.Integer({ minimum: 0 }),
  timeUsedSeconds: Type.Integer({ minimum: 0 }),
  timeUsage: Type.String({ minLength: 1 }),
  timeLimitSeconds: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  extensionUnlocked: Type.Boolean(),
  createdAt: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Integer({ minimum: 0 })
}, { additionalProperties: false });
var PlanPresentationDetailsSchema = Type.Object({
  plan: Type.Union([PlanPresentationSchema, Type.Null()]),
  automation: Type.Object({
    continuation: Type.Union([Type.Literal("enabled"), Type.Literal("interrupted")]),
    requiresUserInput: Type.Boolean()
  }, { additionalProperties: false }),
  createdTaskIds: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
}, { $id: "PlanPresentationDetails", additionalProperties: false });
// src/session-entry-contracts.ts
import Type2 from "typebox";
var ToolAllowlistSchema = Type2.Union([
  Type2.Object({ kind: Type2.Literal("none") }, { additionalProperties: false }),
  Type2.Object({ kind: Type2.Literal("all") }, { additionalProperties: false }),
  Type2.Object({ kind: Type2.Literal("only"), names: Type2.Array(Type2.String()) }, { additionalProperties: false })
], { $id: "ToolAllowlist" });
var CapabilityProfileSchema = Type2.Object({
  modelId: Type2.String(),
  thinkingLevel: Type2.String(),
  sandboxPreset: Type2.Union([
    Type2.Literal("read-only"),
    Type2.Literal("workspace-write"),
    Type2.Literal("danger-full-access")
  ]),
  approvalPolicy: Type2.Union([
    Type2.Literal("never"),
    Type2.Literal("on-request"),
    Type2.Literal("on-failure"),
    Type2.Literal("untrusted")
  ]),
  tools: ToolAllowlistSchema,
  noSandboxAllowed: Type2.Boolean()
}, { $id: "CapabilityProfile", additionalProperties: false });
var SharedWorkspaceBindingSchema = Type2.Object({ variant: Type2.Literal("shared"), source_root: Type2.String({ minLength: 1 }) }, { $id: "SharedWorkspaceBinding", additionalProperties: false });
var WorktreeWorkspaceBindingSchema = Type2.Object({
  variant: Type2.Literal("worktree"),
  source_origin: Type2.String({ minLength: 1 }),
  main_repository_root: Type2.String({ minLength: 1 }),
  main_repository_id: Type2.String({ minLength: 1 })
}, { $id: "WorktreeWorkspaceBinding", additionalProperties: false });
var ChildAgentMetadataFields = {
  kind: Type2.Literal("agent"),
  agentKind: Type2.Union([Type2.Literal("generic"), Type2.Literal("finder"), Type2.Literal("oracle")]),
  agentId: Type2.String({ minLength: 1 }),
  modelId: Type2.String({ minLength: 1 }),
  thinkingLevel: Type2.String({ minLength: 1 }),
  activeTools: Type2.Array(Type2.String({ minLength: 1 })),
  capabilityProfile: CapabilityProfileSchema,
  networkMode: Type2.Union([Type2.Literal("disabled"), Type2.Literal("enabled")]),
  isolated_child: Type2.Literal(true),
  workspaceDirectory: Type2.String({ minLength: 1 }),
  sourceWorkspace: Type2.String({ minLength: 1 }),
  childSessionFile: Type2.Optional(Type2.String({ minLength: 1 }))
};
var RalphMetadataFields = {
  kind: Type2.Literal("ralph"),
  objective: Type2.String({ minLength: 1 }),
  controllerSessionId: Type2.String({ minLength: 1 }),
  maxIterations: Type2.Union([Type2.Integer({ minimum: 1, maximum: 2147483647 }), Type2.Null()]),
  reflectionEvery: Type2.Union([Type2.Integer({ minimum: 1, maximum: 2147483647 }), Type2.Null()]),
  activeTools: Type2.Optional(Type2.Array(Type2.String({ minLength: 1 }))),
  capabilityProfile: Type2.Optional(CapabilityProfileSchema)
};
var OwnershipFields = {
  parentSessionId: Type2.Union([Type2.String(), Type2.Null()]),
  parentSessionFile: Type2.Union([Type2.String(), Type2.Null()])
};
var SharedAgentSessionMetadataSchema = Type2.Object({ ...ChildAgentMetadataFields, isolation: Type2.Literal("none"), workspaceBinding: SharedWorkspaceBindingSchema }, { $id: "SharedAgentSessionMetadata", additionalProperties: false });
var WorktreeAgentSessionMetadataSchema = Type2.Object({
  ...ChildAgentMetadataFields,
  isolation: Type2.Literal("worktree"),
  workspaceBinding: WorktreeWorkspaceBindingSchema,
  worktreePath: Type2.String({ minLength: 1 }),
  worktreeBranch: Type2.String({ minLength: 1 }),
  mainRepositoryRoot: Type2.String({ minLength: 1 })
}, { $id: "WorktreeAgentSessionMetadata", additionalProperties: false });
var RalphSessionMetadataSchema = Type2.Object(RalphMetadataFields, { $id: "RalphSessionMetadata", additionalProperties: false });
var AgentSessionMetadataSchema = Type2.Union([SharedAgentSessionMetadataSchema, WorktreeAgentSessionMetadataSchema], { $id: "AgentSessionMetadata" });
var ChildSessionMetadataSchema = Type2.Union([RalphSessionMetadataSchema, SharedAgentSessionMetadataSchema, WorktreeAgentSessionMetadataSchema], { $id: "ChildSessionMetadata" });
var SharedAgentSessionMarkerSchema = Type2.Object({ ...ChildAgentMetadataFields, isolation: Type2.Literal("none"), workspaceBinding: SharedWorkspaceBindingSchema, ...OwnershipFields }, { additionalProperties: false });
var WorktreeAgentSessionMarkerSchema = Type2.Object({
  ...ChildAgentMetadataFields,
  isolation: Type2.Literal("worktree"),
  workspaceBinding: WorktreeWorkspaceBindingSchema,
  worktreePath: Type2.String({ minLength: 1 }),
  worktreeBranch: Type2.String({ minLength: 1 }),
  mainRepositoryRoot: Type2.String({ minLength: 1 }),
  ...OwnershipFields
}, { additionalProperties: false });
var RalphSessionMarkerSchema = Type2.Object({ ...RalphMetadataFields, ...OwnershipFields }, { additionalProperties: false });
var ChildSessionMarkerSchema = Type2.Union([RalphSessionMarkerSchema, SharedAgentSessionMarkerSchema, WorktreeAgentSessionMarkerSchema], { $id: "ChildSessionMarker" });
var PermissionsStateV1Schema = Type2.Object({
  version: Type2.Literal(1),
  profile: CapabilityProfileSchema,
  networkMode: Type2.Union([Type2.Literal("disabled"), Type2.Literal("enabled")]),
  noSandbox: Type2.Boolean(),
  isolated_child: Type2.Boolean()
}, { $id: "PermissionsStateV1", additionalProperties: false });
var VisibilityCategorySchema = Type2.Object({ disabled: Type2.Array(Type2.String()) }, { additionalProperties: false });
var VisibilityStateV1Schema = Type2.Object({
  version: Type2.Literal(1),
  tools: VisibilityCategorySchema,
  skills: VisibilityCategorySchema
}, { $id: "VisibilityStateV1", additionalProperties: false });
var PlanStateSchema = Type2.Union([
  Type2.Null(),
  Type2.Object({
    planId: Type2.String({ minLength: 1 }),
    sessionId: Type2.String({ minLength: 1 }),
    status: Type2.Union([
      Type2.Literal("draft"),
      Type2.Literal("active"),
      Type2.Literal("paused"),
      Type2.Literal("blocked"),
      Type2.Literal("time_limited"),
      Type2.Literal("complete")
    ]),
    tasks: Type2.Array(PlanTaskSchema, { minItems: 1 }),
    blocks: Type2.Optional(Type2.Array(PlanBlockSchema)),
    tokensUsed: Type2.Integer({ minimum: 0 }),
    timeUsedSeconds: Type2.Integer({ minimum: 0 }),
    timeLimitSeconds: Type2.Union([Type2.Integer({ minimum: 1 }), Type2.Null()]),
    extensionUnlocked: Type2.Optional(Type2.Boolean()),
    createdAt: Type2.Integer({ minimum: 0 }),
    updatedAt: Type2.Integer({ minimum: 0 })
  }, { additionalProperties: false })
], { $id: "PlanState" });
var PlanAutomationStateSchema = Type2.Union([
  Type2.Null(),
  Type2.Object({ continuation: Type2.Literal("interrupted"), requiresUserInput: Type2.Literal(true) }, { additionalProperties: false })
], { $id: "PlanAutomationState" });
var RalphTaskSchema = Type2.Object({
  id: Type2.String(),
  objective: Type2.String(),
  controllerSession: Type2.String(),
  childSession: Type2.Union([Type2.String(), Type2.Null()]),
  iteration: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
  maxIterations: Type2.Union([Type2.Integer({ minimum: 1, maximum: 2147483647 }), Type2.Null()]),
  reflectionEvery: Type2.Union([Type2.Integer({ minimum: 1, maximum: 2147483647 }), Type2.Null()]),
  status: Type2.Union([
    Type2.Literal("running"),
    Type2.Literal("paused"),
    Type2.Literal("finished"),
    Type2.Literal("archived")
  ])
}, { additionalProperties: false });
var RalphStateV1Schema = Type2.Object({ version: Type2.Literal(1), tasks: Type2.Array(RalphTaskSchema) }, { $id: "RalphStateV1", additionalProperties: false });
var NullableString = Type2.Union([Type2.String(), Type2.Null()]);
var NullableInteger = Type2.Union([
  Type2.Integer({ minimum: -2147483648, maximum: 2147483647 }),
  Type2.Null()
]);
var AgentIdentitySchema = Type2.Object({
  agent_id: Type2.String(),
  owner_session_id: Type2.String(),
  issued_run_count: Type2.Integer({ minimum: 1, maximum: 2147483647 }),
  kind: Type2.Union([Type2.Literal("generic"), Type2.Literal("finder"), Type2.Literal("oracle")]),
  effort: Type2.Union([Type2.Literal("low"), Type2.Literal("medium"), Type2.Literal("high"), Type2.Null()]),
  model: Type2.String(),
  thinking: Type2.String(),
  active_tools: Type2.Array(Type2.String()),
  permission_ceiling: CapabilityProfileSchema,
  network_allowed: Type2.Boolean(),
  workspace_binding: Type2.Union([SharedWorkspaceBindingSchema, WorktreeWorkspaceBindingSchema]),
  child_session_file: NullableString,
  child_session_id: NullableString,
  created_at: Type2.Integer({ minimum: -2147483648, maximum: 2147483647 })
}, { additionalProperties: false });
var AgentRunSchema = Type2.Object({
  run_id: Type2.String(),
  agent_id: Type2.String(),
  status: Type2.Union([
    Type2.Literal("running"),
    Type2.Literal("suspended"),
    Type2.Literal("completed"),
    Type2.Literal("failed"),
    Type2.Literal("cancelled"),
    Type2.Literal("lost")
  ]),
  reason_code: Type2.Union([
    Type2.Literal("interrupted_by_parent"),
    Type2.Literal("parent_shutdown"),
    Type2.Literal("process_interrupted"),
    Type2.Literal("close_cleanup_failed"),
    Type2.Literal("host_cancelled"),
    Type2.Literal("dispatch_failed"),
    Type2.Literal("agent_failed"),
    Type2.Literal("internal_error"),
    Type2.Literal("child_session_lost"),
    Type2.Null()
  ]),
  error: NullableString,
  output_available: Type2.Boolean(),
  announcement: Type2.Union([
    Type2.Literal("pending"),
    Type2.Literal("observed_by_agent_wait"),
    Type2.Literal("notification_sent")
  ]),
  started_at: Type2.Integer({ minimum: -2147483648, maximum: 2147483647 }),
  ended_at: NullableInteger,
  suspended_at: NullableInteger,
  submission_id: Type2.String(),
  result_entry_id: NullableString,
  previous_assistant_entry_id: NullableString,
  description: Type2.String(),
  turn_count: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
  last_activity_at: NullableInteger,
  activity_state: Type2.Union([
    Type2.Literal("starting"),
    Type2.Literal("reasoning"),
    Type2.Literal("using_tool"),
    Type2.Literal("orphaned"),
    Type2.Literal("inactive")
  ]),
  active_tool_count: Type2.Integer({ minimum: 0, maximum: 2147483647 })
}, { additionalProperties: false });
var AgentCleanupPendingSchema = Type2.Object({
  owner_session_id: Type2.String(),
  agent_id: Type2.String(),
  cleanup_nonce: Type2.String(),
  remaining_artifacts: Type2.Array(Type2.String())
}, { additionalProperties: false });
var AgentsStateV6Schema = Type2.Object({
  version: Type2.Literal(6),
  issued_identity_counts: Type2.Object({
    agent: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
    finder: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
    oracle: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
    issued_ids: Type2.Array(Type2.String({
      pattern: "^(?:agent(?:-(?:low|medium|high))?|finder|oracle)-[abcdefghjkmnpqrstuvwxyz23456789]{4}$"
    }), { uniqueItems: true })
  }, { additionalProperties: false }),
  identities: Type2.Array(AgentIdentitySchema),
  runs: Type2.Array(AgentRunSchema),
  cleanup_pending: Type2.Array(AgentCleanupPendingSchema)
}, { $id: "AgentsStateV6", additionalProperties: false });
var AgentsPresenceMarkerSchema = Type2.Object({
  storage_schema_version: Type2.Literal(1),
  owner_session_id: Type2.String({ minLength: 1 })
}, { $id: "AgentsPresenceMarker", additionalProperties: false });
var CronTaskSchema = Type2.Object({
  id: Type2.String({ pattern: "^cron-[abcdefghjkmnpqrstuvwxyz23456789]{4}$" }),
  cron: Type2.String({ pattern: "^\\S+(?:\\s+\\S+){4}$" }),
  prompt: Type2.String({ pattern: "\\S" }),
  recurring: Type2.Boolean(),
  mode: Type2.Union([Type2.Literal("message"), Type2.Literal("plan")]),
  enabled: Type2.Boolean(),
  createdAt: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
  nextDue: Type2.Integer({ minimum: 0, maximum: 2147483647 }),
  pendingSince: Type2.Optional(Type2.Integer({ minimum: 0, maximum: 2147483647 }))
}, { additionalProperties: false });
var CronStateSchema = Type2.Object({ version: Type2.Literal(1), enabled: Type2.Boolean(), tasks: Type2.Array(CronTaskSchema) }, { $id: "CronState", additionalProperties: false });
var setupEntry = (customType, data) => Type2.Object({ customType: Type2.Literal(customType), data }, { additionalProperties: false });
var persistedEntry = (customType, data) => Type2.Object({ type: Type2.Literal("custom"), customType: Type2.Literal(customType), data }, { additionalProperties: false });
var ChildSessionSetupEntrySchema = Type2.Union([
  setupEntry("taumel.childSession", ChildSessionMarkerSchema),
  setupEntry("taumel.permissions", PermissionsStateV1Schema),
  setupEntry("taumel.plan", PlanStateSchema),
  setupEntry("taumel.plan_automation", PlanAutomationStateSchema)
], { $id: "ChildSessionSetupEntry" });
var TaumelPersistedCustomEntrySchema = Type2.Union([
  persistedEntry("taumel.childSession", ChildSessionMarkerSchema),
  persistedEntry("taumel.permissions", PermissionsStateV1Schema),
  persistedEntry("taumel.visibility", VisibilityStateV1Schema),
  persistedEntry("taumel.plan", PlanStateSchema),
  persistedEntry("taumel.plan_automation", PlanAutomationStateSchema),
  persistedEntry("taumel.ralph", RalphStateV1Schema),
  persistedEntry("taumel.agents.v4", AgentsStateV6Schema),
  persistedEntry("taumel.agents.presence", AgentsPresenceMarkerSchema),
  persistedEntry("taumel.cron", CronStateSchema)
], { $id: "TaumelPersistedCustomEntry" });

// src/tool-contracts.ts
import { Compile } from "typebox/compile";
import Type5 from "typebox";

// src/tool-exa-contracts.ts
import Type3 from "typebox";
var stringArray = Type3.Array(Type3.String());
var ExaSearchTypeSchema = Type3.Union([
  Type3.Literal("instant"),
  Type3.Literal("fast"),
  Type3.Literal("auto"),
  Type3.Literal("deep-lite"),
  Type3.Literal("deep"),
  Type3.Literal("deep-reasoning")
], { description: "Search mode controlling latency and depth. Omit to let Exa choose." });
var ExaComplianceSchema = Type3.Literal("hipaa", {
  description: "Compliance mode; currently only hipaa."
});
var ExaTextOptionsSchema = Type3.Object({
  maxCharacters: Type3.Optional(Type3.Integer({
    minimum: 1,
    description: "Maximum page-text characters to return."
  }))
}, { $id: "ExaTextOptions", additionalProperties: false });
var ExaHighlightsOptionsSchema = Type3.Object({
  query: Type3.Optional(Type3.String({
    minLength: 1,
    description: "Query used to select relevant highlights; defaults to the surrounding search query when available."
  })),
  maxCharacters: Type3.Optional(Type3.Integer({
    minimum: 1,
    description: "Maximum total highlight characters to return."
  }))
}, { $id: "ExaHighlightsOptions", additionalProperties: false });
var ExaSummaryOptionsSchema = Type3.Object({
  query: Type3.Optional(Type3.String({
    minLength: 1,
    description: "Question or focus for the generated summary."
  }))
}, {
  $id: "ExaSummaryOptions",
  additionalProperties: false,
  description: "Request a generated summary for each result."
});
var ExaContentOptionsSchema = Type3.Object({
  text: Type3.Optional(Type3.Union([Type3.Boolean(), ExaTextOptionsSchema], {
    description: "Whether to return page text. Use an options object to limit returned characters."
  })),
  highlights: Type3.Optional(Type3.Union([Type3.Boolean(), ExaHighlightsOptionsSchema], {
    description: "Whether to return relevant page excerpts. Use an options object to control excerpt selection."
  })),
  summary: Type3.Optional(ExaSummaryOptionsSchema),
  maxAgeHours: Type3.Optional(Type3.Integer({
    minimum: -1,
    maximum: 720,
    description: "Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching."
  })),
  subpages: Type3.Optional(Type3.Integer({
    minimum: 0,
    maximum: 100,
    description: "Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100."
  })),
  subpageTarget: Type3.Optional(Type3.Union([Type3.String({ minLength: 1, maxLength: 100 }), stringArray], {
    description: "Keyword or keywords used to prioritize which subpages to crawl."
  }))
}, {
  $id: "ExaContentOptions",
  additionalProperties: false,
  description: "Content extraction to include with each search result."
});
var WebSearchExaParamsSchema = Type3.Object({
  query: Type3.String({
    minLength: 1,
    maxLength: 2000,
    description: "Search query or question. Be specific about the desired facts, entities, sources, or time range. Maximum 2,000 characters."
  }),
  type: Type3.Optional(ExaSearchTypeSchema),
  includeDomains: Type3.Optional(Type3.Array(Type3.String({ minLength: 1 }), {
    maxItems: 1200,
    description: "Domains allowed in results; when set, results come only from these domains."
  })),
  excludeDomains: Type3.Optional(Type3.Array(Type3.String({ minLength: 1 }), {
    maxItems: 1200,
    description: "Domains excluded from results."
  })),
  startPublishedDate: Type3.Optional(Type3.String({ description: "Return pages published after this ISO 8601 timestamp." })),
  endPublishedDate: Type3.Optional(Type3.String({ description: "Return pages published before this ISO 8601 timestamp." })),
  numResults: Type3.Optional(Type3.Integer({
    minimum: 1,
    maximum: 100,
    description: "Number of results to return. Defaults to 10; accepts 1–100, with lower limits for some search modes."
  })),
  moderation: Type3.Optional(Type3.Boolean({ description: "Whether to filter unsafe content. Defaults to false." })),
  contents: Type3.Optional(ExaContentOptionsSchema),
  additionalQueries: Type3.Optional(Type3.Array(Type3.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: 10,
    description: "Additional query variants for deep search. Accepts 1–10."
  })),
  category: Type3.Optional(Type3.String({ minLength: 1, description: "Optional Exa result-category filter." })),
  userLocation: Type3.Optional(Type3.String({ minLength: 2, maxLength: 2, description: "Two-letter country code for location-aware search." })),
  compliance: Type3.Optional(ExaComplianceSchema),
  systemPrompt: Type3.Optional(Type3.String({ minLength: 1, description: "Additional instructions controlling deep-search behavior." }))
}, { $id: "WebSearchExaParams", additionalProperties: false });
var CrawlingExaParamsSchema = Type3.Object({
  ids: Type3.Optional(Type3.Array(Type3.String({ minLength: 1, maxLength: 2048 }), {
    minItems: 1,
    maxItems: 100,
    description: "Exa document IDs to fetch. Accepts 1–100."
  })),
  urls: Type3.Optional(Type3.Array(Type3.String({ minLength: 1, maxLength: 2048 }), {
    minItems: 1,
    maxItems: 100,
    description: "Page URLs to fetch. Accepts 1–100."
  })),
  compliance: Type3.Optional(ExaComplianceSchema),
  text: Type3.Optional(Type3.Union([Type3.Boolean(), ExaTextOptionsSchema], {
    description: "Whether to return page text. Use an options object to limit returned characters."
  })),
  highlights: Type3.Optional(Type3.Union([Type3.Boolean(), ExaHighlightsOptionsSchema], {
    description: "Whether to return relevant page excerpts. Use an options object to control excerpt selection."
  })),
  summary: Type3.Optional(ExaSummaryOptionsSchema),
  maxAgeHours: Type3.Optional(Type3.Integer({
    minimum: -1,
    maximum: 720,
    description: "Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching."
  })),
  subpages: Type3.Optional(Type3.Integer({
    minimum: 0,
    maximum: 100,
    description: "Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100."
  })),
  subpageTarget: Type3.Optional(Type3.Union([Type3.String({ minLength: 1, maxLength: 100 }), stringArray], {
    description: "Keyword or keywords used to prioritize which subpages to crawl."
  }))
}, { $id: "CrawlingExaParams", additionalProperties: false });
var GetCodeContextExaParamsSchema = Type3.Object({
  query: Type3.String({
    minLength: 1,
    maxLength: 2000,
    description: "Code or API question to research. Include relevant language, framework, library, symbols, and desired examples. Maximum 2,000 characters."
  }),
  tokensNum: Type3.Optional(Type3.Union([
    Type3.Literal("dynamic"),
    Type3.Integer({ minimum: 50, maximum: 1e5 })
  ], {
    description: "Approximate output-token budget, or dynamic to let Exa choose. Accepts 50–100,000."
  }))
}, { $id: "GetCodeContextExaParams", additionalProperties: false });
var ExaAgentCreateRunParamsSchema = Type3.Object({
  query: Type3.String({
    minLength: 1,
    description: "Research or extraction task for the Exa Agent. State the desired outcome, scope, source expectations, and completion criteria."
  }),
  systemPrompt: Type3.Optional(Type3.String({ minLength: 1, description: "Optional additional instructions governing the research run." })),
  input: Type3.Optional(Type3.Record(Type3.String(), Type3.Unknown(), { description: "Optional structured JSON input for the run." })),
  outputSchema: Type3.Optional(Type3.Record(Type3.String(), Type3.Unknown(), {
    description: "Optional JSON Schema constraining the run's structured output."
  })),
  effort: Type3.Optional(Type3.Union([
    Type3.Literal("minimal"),
    Type3.Literal("low"),
    Type3.Literal("medium"),
    Type3.Literal("high"),
    Type3.Literal("xhigh"),
    Type3.Literal("auto")
  ], { description: "Research effort tier. Prefer low or medium unless deep research is explicitly needed." })),
  previousRunId: Type3.Optional(Type3.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[A-Za-z0-9_.:-]+$",
    description: "Optional prior Exa Agent run ID to continue or refine."
  })),
  metadata: Type3.Optional(Type3.Record(Type3.String(), Type3.Unknown(), { description: "Optional JSON metadata to attach to the run." }))
}, { $id: "ExaAgentCreateRunParams", additionalProperties: false });
var ExaAgentRunIdParamsSchema = Type3.Object({
  id: Type3.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[A-Za-z0-9_.:-]+$",
    description: "Exa Agent run ID returned by exa_agent_create_run or exa_agent_list_runs."
  })
}, { $id: "ExaAgentRunIdParams", additionalProperties: false });
var ExaAgentListRunsParamsSchema = Type3.Object({
  limit: Type3.Optional(Type3.Integer({
    minimum: 1,
    maximum: 100,
    description: "Maximum runs to return. Accepts 1–100."
  })),
  cursor: Type3.Optional(Type3.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[A-Za-z0-9_.:-]+$",
    description: "Opaque cursor returned by a previous run-list response."
  }))
}, { $id: "ExaAgentListRunsParams", additionalProperties: false });
var ExaAgentListEventsParamsSchema = Type3.Object({
  id: Type3.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[A-Za-z0-9_.:-]+$",
    description: "Exa Agent run ID whose events to list."
  }),
  limit: Type3.Optional(Type3.Integer({
    minimum: 1,
    maximum: 100,
    description: "Maximum events to return. Accepts 1–100."
  })),
  cursor: Type3.Optional(Type3.String({ minLength: 1, description: "Opaque cursor returned by a previous event-list response." })),
  lastEventId: Type3.Optional(Type3.String({ minLength: 1, description: "Return events after this event ID for incremental reading." }))
}, { $id: "ExaAgentListEventsParams", additionalProperties: false });

// src/tool-agent-contracts.ts
import Type4 from "typebox";
var AgentTierSchema = Type4.Union([Type4.Literal("low"), Type4.Literal("medium"), Type4.Literal("high")], { description: "The generic agent's capacity tier. Defaults to medium." });
var AgentIsolationSchema = Type4.Union([Type4.Literal("none"), Type4.Literal("worktree")], {
  description: "Workspace isolation for the new identity: none (default) uses the bound parent workspace; worktree creates a dedicated Git worktree."
});
var AgentSpawnParamsSchema = Type4.Object({
  message: Type4.String({
    minLength: 1,
    description: "The agent's initial instruction. Include the desired outcome, scope, relevant context, constraints, validation, and expected result."
  }),
  description: Type4.String({
    minLength: 1,
    description: "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child."
  }),
  tier: Type4.Optional(AgentTierSchema),
  isolation: Type4.Optional(AgentIsolationSchema)
}, { $id: "AgentSpawnParams", additionalProperties: false });
var FinderParamsSchema = Type4.Object({
  query: Type4.String({
    minLength: 1,
    description: "The discovery query. Be specific and include relevant terms, file types, expected content or naming patterns, and clear success criteria."
  }),
  description: Type4.String({
    minLength: 1,
    description: "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child."
  }),
  isolation: Type4.Optional(AgentIsolationSchema)
}, { $id: "FinderParams", additionalProperties: false });
var OracleParamsSchema = Type4.Object({
  message: Type4.String({
    minLength: 1,
    description: "The Oracle's initial instruction. Include the guidance, decision, or review needed, relevant context and constraints, available evidence, and attempted approaches."
  }),
  description: Type4.String({
    minLength: 1,
    description: "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child."
  }),
  isolation: Type4.Optional(AgentIsolationSchema)
}, { $id: "OracleParams", additionalProperties: false });
var AgentSendParamsSchema = Type4.Object({
  agent_id: Type4.String({
    minLength: 1,
    description: "The owner-scoped agent handle returned by agent_spawn, finder, oracle, or agent_list."
  }),
  message: Type4.Optional(Type4.String({
    description: "The instruction to start idle work, steer active work, resume suspended work, or replace interrupted work. Omit only to interrupt without replacement."
  })),
  description: Type4.Optional(Type4.String({
    minLength: 1,
    description: "A required three-to-five-word user-facing label for the message, used in compact TUI display and not sent to the child."
  })),
  interrupt: Type4.Optional(Type4.Boolean({
    description: "When true, interrupt active work before sending a message, suspend active work when message is omitted, and have no additional effect when no active execution exists."
  }))
}, { $id: "AgentSendParams", additionalProperties: false });
var AgentWaitParamsSchema = Type4.Object({
  run_ids: Type4.Array(Type4.String({ minLength: 1 }), {
    minItems: 1,
    description: "Unique owner-scoped run IDs that all belong to the current session."
  }),
  timeout_seconds: Type4.Optional(Type4.Number({
    minimum: 0,
    description: "Maximum seconds to wait. Omit to wait indefinitely; use 0 to poll once. Timing out leaves all pending runs active."
  }))
}, { $id: "AgentWaitParams", additionalProperties: false });
var AgentCloseParamsSchema = Type4.Object({
  agent_id: Type4.String({ minLength: 1, description: "The owner-scoped handle of the identity to close permanently." }),
  delete_worktree: Type4.Optional(Type4.Boolean({
    description: "When true, remove the agent's clean, verified worktree while preserving its dedicated branch. Defaults to false."
  }))
}, { $id: "AgentCloseParams", additionalProperties: false });

// src/tool-contracts.ts
var EditReplacementSchema = Type5.Object({
  oldText: Type5.String({
    minLength: 1,
    description: "Exact, non-empty text to replace. It must occur exactly once in the original file."
  }),
  newText: Type5.String({
    description: "Replacement text. Use an empty string to delete oldText."
  })
}, { $id: "EditReplacement", additionalProperties: false });
var EmptyParamsSchema = Type5.Object({}, { $id: "EmptyParams", additionalProperties: false });
var ExecCommandParamsSchema = Type5.Object({
  cmd: Type5.String({ minLength: 1, pattern: "\\S", description: "The bash command to run." }),
  workdir: Type5.Optional(Type5.String({
    description: "Working directory for the command. Omit to use the current turn working directory."
  })),
  yield_time_ms: Type5.Optional(Type5.Number({
    description: "Milliseconds to wait for output before yielding. Defaults to 10000; rounded to an integer; minimum 250; maximum 30000. Yielding leaves a live command running."
  })),
  max_output_tokens: Type5.Optional(Type5.Integer({
    minimum: 0,
    description: "Approximate returned-output limit. Defaults to 10000 and truncates excess model-visible output without changing the command-output safety ceiling."
  })),
  with_escalated_permissions: Type5.Optional(Type5.Boolean({
    description: "When true, requests execution outside sandbox restrictions. May require approval or be denied."
  })),
  justification: Type5.Optional(Type5.String({
    description: "One-sentence explanation of why escalated permissions are needed. Supply only when with_escalated_permissions is true."
  }))
}, { $id: "ExecCommandParams", additionalProperties: false });
var WriteStdinParamsSchema = Type5.Object({
  session_id: Type5.Integer({
    description: "Exact session id returned by exec_command."
  }),
  chars: Type5.Optional(Type5.String({
    description: "Characters sent verbatim. Omit or use an empty string to poll without writing."
  })),
  yield_time_ms: Type5.Optional(Type5.Number({
    description: "Milliseconds to wait; yielding leaves the process running. Delta-mode writes and polls default to 250 and accept 250–30000. Empty status-mode waits default to 5000 and accept 5000–300000."
  })),
  max_output_tokens: Type5.Optional(Type5.Integer({
    minimum: 0,
    description: "Approximate returned-output limit. Defaults to 10000 and truncates excess model-visible output."
  })),
  output_mode: Type5.Optional(Type5.Union([Type5.Literal("delta"), Type5.Literal("status")], {
    description: "delta returns output to your context and permits interaction; status silently drains output during an empty-input passive wait. Omit to default to delta."
  }))
}, { $id: "WriteStdinParams", additionalProperties: false });
var ApplyPatchParamsSchema = Type5.Object({
  input: Type5.String({
    minLength: 1,
    description: "The complete patch in *** Begin Patch format."
  })
}, { $id: "ApplyPatchParams", additionalProperties: false });
var WriteParamsSchema = Type5.Object({
  path: Type5.String({
    minLength: 1,
    description: "Path to the file, relative to the current working directory or absolute."
  }),
  content: Type5.String({ description: "UTF-8 text to write exactly as provided." }),
  mode: Type5.Optional(Type5.Union([Type5.Literal("overwrite"), Type5.Literal("append")], {
    description: "Write behavior: overwrite (default) replaces the file; append adds content at the end without inserting a newline."
  }))
}, { $id: "WriteParams", additionalProperties: false });
var ReadParamsSchema = Type5.Object({
  path: Type5.String({
    minLength: 1,
    description: "Path to the UTF-8 text file to read, relative to the current working directory or absolute."
  }),
  offset: Type5.Optional(Type5.Integer({
    description: "1-indexed line at which to start. Omit to start at line 1; a negative value starts that many lines from the end of the file."
  })),
  limit: Type5.Optional(Type5.Integer({
    minimum: 1,
    description: "Maximum number of lines to return. Omit to read from offset to the end of the file, subject to the tool's truncation limits."
  }))
}, { $id: "ReadParams", additionalProperties: false });
var ViewMediaParamsSchema = Type5.Object({
  path: Type5.String({
    minLength: 1,
    description: "Path to the image, relative to the current working directory or absolute."
  })
}, { $id: "ViewMediaParams", additionalProperties: false });
var EditParamsSchema = Type5.Object({
  path: Type5.String({
    minLength: 1,
    description: "Path to the existing UTF-8 text file to edit, relative to the current working directory or absolute."
  }),
  edits: Type5.Array(EditReplacementSchema, {
    minItems: 1,
    description: "One or more non-overlapping replacements, all matched against the original file."
  })
}, { $id: "EditParams", additionalProperties: false });
var CreateTaskItemSchema = Type5.Object({
  id: Type5.Optional(Type5.String({ description: "Optional explicit task identity, unique within this plan. Omit to auto-generate a task- identity." })),
  title: Type5.String({ description: "Short statement of the work. Trimmed; must not be empty." }),
  description: Type5.Optional(Type5.String({ description: "Optional longer specification of this step." })),
  depends_on: Type5.Optional(Type5.Array(Type5.String(), {
    description: "Task identities that must reach completed or cancelled before this task may enter in_progress. May reference identities supplied earlier in this call."
  }))
}, { $id: "CreateTaskItem", additionalProperties: false });
var CreateTaskParamsSchema = Type5.Object({ tasks: Type5.Array(CreateTaskItemSchema, { minItems: 1 }) }, { $id: "CreateTaskParams", additionalProperties: false });
var UpdateTaskParamsSchema = Type5.Object({
  taskId: Type5.String(),
  status: Type5.Optional(Type5.Union([
    Type5.Literal("pending"),
    Type5.Literal("in_progress"),
    Type5.Literal("completed"),
    Type5.Literal("cancelled")
  ])),
  title: Type5.Optional(Type5.String()),
  description: Type5.Optional(Type5.String()),
  depends_on: Type5.Optional(Type5.Array(Type5.String())),
  reason: Type5.Optional(Type5.String({
    description: "Why this task is being cancelled. Required when setting status to cancelled."
  }))
}, { $id: "UpdateTaskParams", additionalProperties: false });
var UpdatePlanParamsSchema = Type5.Object({
  status: Type5.Union([Type5.Literal("active"), Type5.Literal("blocked")], {
    description: "Lifecycle status to set: active commits a draft plan's task list and starts continuation, or returns a blocked plan to active; blocked marks a genuine impasse requiring user input or an external-state change."
  }),
  reason: Type5.String({
    minLength: 1,
    description: "Why the plan is blocked, or what resolved the impasse when returning a blocked plan to active. Required for both transitions."
  })
}, { $id: "UpdatePlanParams", additionalProperties: false });
var CronCreateParamsSchema = Type5.Object({
  cron: Type5.String({
    minLength: 1,
    description: "Standard 5-field cron expression: minute, hour, day of month, month, and day of week. Evaluated in the host’s local timezone."
  }),
  prompt: Type5.String({
    minLength: 1,
    description: "Prompt delivered to the main session when the task fires. With plan = true, it becomes a user-authored plan task."
  }),
  recurring: Type5.Optional(Type5.Boolean({
    description: "Whether the task repeats. Defaults to true; false fires once and deletes the task after delivery."
  })),
  plan: Type5.Optional(Type5.Boolean({
    description: "Whether to deliver the prompt as a plan instead of a message. Defaults to false; a plan-mode fire waits while the session’s plan slot is occupied."
  }))
}, { $id: "CronCreateParams", additionalProperties: false });
var CronDeleteParamsSchema = Type5.Object({
  id: Type5.String({
    pattern: "^cron-[abcdefghjkmnpqrstuvwxyz23456789]{4}$",
    description: "Task ID returned by cron_create or cron_list, shaped cron-<nano-id>."
  })
}, { $id: "CronDeleteParams", additionalProperties: false });
var QueryThreadsParamsSchema = Type5.Object({
  query: Type5.String({
    minLength: 1,
    maxLength: 500,
    description: "Text to find in persisted conversations. Matching is case-insensitive substring search, not regex or a query language. Maximum 500 characters."
  }),
  limit: Type5.Optional(Type5.Integer({
    minimum: 1,
    maximum: 50,
    description: "Maximum number of threads to return. Defaults to 10; accepts 1–50."
  })),
  scope: Type5.Optional(Type5.Union([Type5.Literal("current_workspace"), Type5.Literal("all")], {
    description: "Where to search. current_workspace searches threads associated with your current workspace and is the default; all searches all persisted threads."
  })),
  includeTools: Type5.Optional(Type5.Boolean({
    description: "Whether to search tool calls, tool results, and notifications. Defaults to true."
  }))
}, { $id: "QueryThreadsParams", additionalProperties: false });
var ThreadLocatorSchema = Type5.Object({
  threadID: Type5.String({ minLength: 1, description: "Thread ID carried by the locator." }),
  sourcePath: Type5.Optional(Type5.String({
    minLength: 1,
    description: "Persisted source path carried by the locator for exact source recovery. Copy it unchanged."
  })),
  entryID: Type5.Optional(Type5.String({ minLength: 1, description: "Persisted entry ID identifying the matched event." })),
  line: Type5.Optional(Type5.Integer({
    minimum: 1,
    description: "Persisted JSONL line number used as a fallback locator for the matched event."
  }))
}, { $id: "ThreadLocator", additionalProperties: false });
var ReadThreadParamsSchema = Type5.Object({
  threadID: Type5.Optional(Type5.String({
    minLength: 1,
    description: "Exact thread ID or unique ID prefix. Required unless locator supplies the thread ID."
  })),
  locator: Type5.Optional(Type5.Object({
    threadID: Type5.String({ minLength: 1, description: "Thread ID carried by the locator." }),
    sourcePath: Type5.Optional(Type5.String({
      minLength: 1,
      description: "Persisted source path carried by the locator for exact source recovery. Copy it unchanged."
    })),
    entryID: Type5.Optional(Type5.String({ minLength: 1, description: "Persisted entry ID identifying the matched event." })),
    line: Type5.Optional(Type5.Integer({
      minimum: 1,
      description: "Persisted JSONL line number used as a fallback locator for the matched event."
    }))
  }, {
    description: "Exact hit locator returned by query_threads. Use with mode = window to read context around that hit.",
    additionalProperties: false
  })),
  entryID: Type5.Optional(Type5.String({ minLength: 1, description: "Entry ID to target when using mode = window without a locator." })),
  line: Type5.Optional(Type5.Integer({
    minimum: 1,
    description: "Persisted JSONL line number to target when using mode = window without a locator."
  })),
  mode: Type5.Optional(Type5.Union([Type5.Literal("overview"), Type5.Literal("window"), Type5.Literal("full")], {
    description: "What to read: overview returns bounded metadata, summaries, and recent entries and is the default; window returns context around a locator, entry ID, or line; full returns a paginated visible transcript."
  })),
  around: Type5.Optional(Type5.Integer({
    minimum: 0,
    maximum: 10,
    description: "Number of visible entries to include before and after a window target. Defaults to 3; accepts 0–10."
  })),
  cursor: Type5.Optional(Type5.String({
    minLength: 1,
    description: "Opaque cursor returned by a previous full response. Use only with mode = full; omit it for the first page."
  }))
}, { $id: "ReadThreadParams", additionalProperties: false });
var RalphTaskParamsSchema = Type5.Object({
  task_id: Type5.String({
    minLength: 1,
    description: "Ralph task ID from the Ralph session prompt."
  })
}, { $id: "RalphTaskParams", additionalProperties: false });
var toolParamSchemas = [
  { name: "exec_command", interfaceName: "ExecCommandParams", schema: ExecCommandParamsSchema },
  { name: "write_stdin", interfaceName: "WriteStdinParams", schema: WriteStdinParamsSchema },
  { name: "apply_patch", interfaceName: "ApplyPatchParams", schema: ApplyPatchParamsSchema },
  { name: "write", interfaceName: "WriteParams", schema: WriteParamsSchema },
  { name: "read", interfaceName: "ReadParams", schema: ReadParamsSchema },
  { name: "view_media", interfaceName: "ViewMediaParams", schema: ViewMediaParamsSchema },
  { name: "edit", interfaceName: "EditParams", schema: EditParamsSchema },
  { name: "get_plan", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "create_task", interfaceName: "CreateTaskParams", schema: CreateTaskParamsSchema },
  { name: "update_task", interfaceName: "UpdateTaskParams", schema: UpdateTaskParamsSchema },
  { name: "update_plan", interfaceName: "UpdatePlanParams", schema: UpdatePlanParamsSchema },
  { name: "cron_create", interfaceName: "CronCreateParams", schema: CronCreateParamsSchema },
  { name: "cron_list", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "cron_delete", interfaceName: "CronDeleteParams", schema: CronDeleteParamsSchema },
  { name: "query_threads", interfaceName: "QueryThreadsParams", schema: QueryThreadsParamsSchema },
  { name: "read_thread", interfaceName: "ReadThreadParams", schema: ReadThreadParamsSchema },
  { name: "ralph_continue", interfaceName: "RalphTaskParams", schema: RalphTaskParamsSchema },
  { name: "ralph_finish", interfaceName: "RalphTaskParams", schema: RalphTaskParamsSchema },
  { name: "web_search_exa", interfaceName: "WebSearchExaParams", schema: WebSearchExaParamsSchema },
  { name: "crawling_exa", interfaceName: "CrawlingExaParams", schema: CrawlingExaParamsSchema },
  { name: "get_code_context_exa", interfaceName: "GetCodeContextExaParams", schema: GetCodeContextExaParamsSchema },
  { name: "exa_agent_create_run", interfaceName: "ExaAgentCreateRunParams", schema: ExaAgentCreateRunParamsSchema },
  { name: "exa_agent_get_run", interfaceName: "ExaAgentRunIdParams", schema: ExaAgentRunIdParamsSchema },
  { name: "exa_agent_list_runs", interfaceName: "ExaAgentListRunsParams", schema: ExaAgentListRunsParamsSchema },
  { name: "exa_agent_cancel_run", interfaceName: "ExaAgentRunIdParams", schema: ExaAgentRunIdParamsSchema },
  { name: "exa_agent_list_events", interfaceName: "ExaAgentListEventsParams", schema: ExaAgentListEventsParamsSchema },
  { name: "agent_spawn", interfaceName: "AgentSpawnParams", schema: AgentSpawnParamsSchema },
  { name: "finder", interfaceName: "FinderParams", schema: FinderParamsSchema },
  { name: "oracle", interfaceName: "OracleParams", schema: OracleParamsSchema },
  { name: "agent_send", interfaceName: "AgentSendParams", schema: AgentSendParamsSchema },
  { name: "agent_wait", interfaceName: "AgentWaitParams", schema: AgentWaitParamsSchema },
  { name: "agent_list", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "agent_close", interfaceName: "AgentCloseParams", schema: AgentCloseParamsSchema }
];
var validators = new Map(toolParamSchemas.map((contract) => [contract.name, Compile(contract.schema)]));
var toolNames = toolParamSchemas.map((contract) => contract.name);
function formatValidationError(toolName, validator, value) {
  let first;
  for (const error of validator.Errors(value)) {
    first = error;
    break;
  }
  if (first === undefined)
    return `${toolName}: invalid parameters`;
  const path = typeof first.instancePath === "string" && first.instancePath !== "" ? first.instancePath.replaceAll("/", ".").replace(/^\./, ".") : "";
  return `${toolName}${path}: ${first.message}`;
}
function parseToolParams(toolName, rawParams) {
  const validator = validators.get(toolName);
  if (validator === undefined) {
    return { ok: false, error: `unknown tool contract: ${toolName}` };
  }
  const params = rawParams === undefined || rawParams === null ? {} : rawParams;
  if (!validator.Check(params)) {
    return { ok: false, error: formatValidationError(toolName, validator, params) };
  }
  if (toolName === "crawling_exa" && typeof params === "object" && params !== null && "ids" in params === "urls" in params) {
    return { ok: false, error: "crawling_exa: provide either ids or urls, but not both" };
  }
  if (toolName === "agent_send" && typeof params === "object" && params !== null) {
    const record = params;
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message === "" && record.interrupt !== true) {
      return { ok: false, error: "agent_send.message is required unless interrupt is true" };
    }
    if (message !== "" && (typeof record.description !== "string" || record.description.trim() === "")) {
      return { ok: false, error: "agent_send.description is required when message is supplied" };
    }
  }
  if ((toolName === "agent_spawn" || toolName === "oracle") && typeof params === "object" && params !== null) {
    const message = params.message;
    if (typeof message !== "string" || message.trim() === "") {
      return { ok: false, error: `${toolName}.message must not be empty` };
    }
  }
  if (toolName === "finder" && typeof params === "object" && params !== null) {
    const query = params.query;
    if (typeof query !== "string" || query.trim() === "") {
      return { ok: false, error: "finder.query must not be empty" };
    }
  }
  if (toolName === "agent_wait" && typeof params === "object" && params !== null) {
    const runIds = params.run_ids;
    if (Array.isArray(runIds)) {
      const trimmed = runIds.map((value) => typeof value === "string" ? value.trim() : "");
      if (trimmed.some((value) => value === "")) {
        return { ok: false, error: "agent_wait.run_ids must not contain empty ids" };
      }
      if (new Set(trimmed).size !== trimmed.length) {
        return { ok: false, error: "agent_wait.run_ids must not contain duplicate ids" };
      }
    }
  }
  if ((toolName === "agent_send" || toolName === "agent_close") && typeof params === "object" && params !== null) {
    const agentId = params.agent_id;
    if (typeof agentId !== "string" || agentId.trim() === "") {
      return { ok: false, error: `${toolName}.agent_id must not be empty` };
    }
  }
  return { ok: true, params };
}

// src/bridge-usage-contracts.ts
import Type6 from "typebox";
var OpenAiUsageHostAuthSchema = Type6.Object({
  providerKey: Type6.String({ minLength: 1 }),
  credentialKey: Type6.String({ minLength: 1 }),
  source: Type6.String({ minLength: 1 })
}, { $id: "OpenAiUsageHostAuth", additionalProperties: false });
var KimiUsageHostAuthSchema = Type6.Object({ providerKey: Type6.String({ minLength: 1 }), source: Type6.String({ minLength: 1 }) }, { $id: "KimiUsageHostAuth", additionalProperties: false });
var OpenAiUsageHostLookupFactsSchema = Type6.Object({
  apiKeyPresent: Type6.Boolean(),
  credential: Type6.Optional(Type6.Unknown()),
  token: Type6.Optional(Type6.String()),
  tokenError: Type6.Optional(Type6.String())
}, { $id: "OpenAiUsageHostLookupFacts", additionalProperties: false });
var KimiUsageHostLookupFactsSchema = Type6.Object({
  token: Type6.Optional(Type6.String()),
  tokenError: Type6.Optional(Type6.String())
}, { $id: "KimiUsageHostLookupFacts", additionalProperties: false });
var hostParamsBase = { apiKeyPresent: Type6.Boolean(), credential: Type6.Optional(Type6.Unknown()) };
var kimiHostParamsBase = { apiKeyPresent: Type6.Boolean() };
var OpenAiUsageHostParamsPresentSchema = Type6.Object({ ...hostParamsBase, tokenState: Type6.Literal("present"), token: Type6.String({ minLength: 1 }) }, { $id: "OpenAiUsageHostParamsPresent", additionalProperties: false });
var OpenAiUsageHostParamsMissingSchema = Type6.Object({ ...hostParamsBase, tokenState: Type6.Literal("missing") }, { $id: "OpenAiUsageHostParamsMissing", additionalProperties: false });
var OpenAiUsageHostParamsErrorSchema = Type6.Object({ ...hostParamsBase, tokenState: Type6.Literal("error"), tokenError: Type6.String({ minLength: 1 }) }, { $id: "OpenAiUsageHostParamsError", additionalProperties: false });
var OpenAiUsageHostParamsSchema = Type6.Union([
  OpenAiUsageHostParamsPresentSchema,
  OpenAiUsageHostParamsMissingSchema,
  OpenAiUsageHostParamsErrorSchema
], { $id: "OpenAiUsageHostParams" });
var KimiUsageHostParamsPresentSchema = Type6.Object({ ...kimiHostParamsBase, tokenState: Type6.Literal("present"), token: Type6.String({ minLength: 1 }) }, { $id: "KimiUsageHostParamsPresent", additionalProperties: false });
var KimiUsageHostParamsMissingSchema = Type6.Object({ ...kimiHostParamsBase, tokenState: Type6.Literal("missing") }, { $id: "KimiUsageHostParamsMissing", additionalProperties: false });
var KimiUsageHostParamsErrorSchema = Type6.Object({ ...kimiHostParamsBase, tokenState: Type6.Literal("error"), tokenError: Type6.String({ minLength: 1 }) }, { $id: "KimiUsageHostParamsError", additionalProperties: false });
var KimiUsageHostParamsSchema = Type6.Union([
  KimiUsageHostParamsPresentSchema,
  KimiUsageHostParamsMissingSchema,
  KimiUsageHostParamsErrorSchema
], { $id: "KimiUsageHostParams" });
var UsagePairHostParamsSchema = Type6.Object({ openai: OpenAiUsageHostParamsSchema, kimi: KimiUsageHostParamsSchema }, { $id: "UsagePairHostParams", additionalProperties: false });
// src/bridge-core-contracts.ts
var ActiveToolsSyncFactsSchema = Type7.Object({ tools: Type7.Array(Type7.String()), ctx: Type7.Optional(Type7.Unknown()) }, { $id: "ActiveToolsSyncFacts", additionalProperties: false });
var ActiveToolsPlanSchema = Type7.Object({
  changed: Type7.Boolean(),
  tools: Type7.Array(Type7.String())
}, { $id: "ActiveToolsPlan", additionalProperties: false });
var ChildPermissionRefreshPlanSchema = Type7.Object({ permissions: PermissionsStateV1Schema }, { $id: "ChildPermissionRefreshPlan", additionalProperties: false });
var CommandSpecSchema = Type7.Object({
  name: Type7.String({ minLength: 1 }),
  description: Type7.String()
}, { $id: "CommandSpec", additionalProperties: false });
var CommandSpecsResultSchema = Type7.Object({ specs: Type7.Array(CommandSpecSchema) }, { $id: "CommandSpecsResult", additionalProperties: false });
var ToolNamesResultSchema = Type7.Object({ names: Type7.Array(Type7.String({ minLength: 1 })) }, { $id: "ToolNamesResult", additionalProperties: false });
var ThreadCatalogFactsSchema = Type7.Object({ cwd: Type7.String(), home: Type7.String(), override: Type7.Optional(Type7.String()) }, { $id: "ThreadCatalogFacts", additionalProperties: false });
var ThreadCatalogScanSchema = Type7.Object({
  root: Type7.String({ minLength: 1 }),
  maxDepth: Type7.Integer({ minimum: 0 }),
  maxFiles: Type7.Integer({ minimum: 1 }),
  suffix: Type7.String({ minLength: 1 })
}, { $id: "ThreadCatalogScan", additionalProperties: false });
var ThreadCatalogScansResultSchema = Type7.Object({ scans: Type7.Array(ThreadCatalogScanSchema) }, { $id: "ThreadCatalogScansResult", additionalProperties: false });
var ExecNotificationSchema = Type7.Object({
  sessionId: Type7.Integer({ minimum: 0 }),
  customType: Type7.String({ minLength: 1 }),
  content: Type7.String({ minLength: 1 }),
  display: Type7.Boolean()
}, { $id: "ExecNotification", additionalProperties: false });
var PendingExecNotificationsResultSchema = Type7.Object({ notifications: Type7.Array(ExecNotificationSchema) }, { $id: "PendingExecNotificationsResult", additionalProperties: false });
var ExecNotificationClaimedSchema = Type7.Object({
  kind: Type7.Literal("claimed"),
  sessionId: Type7.Integer({ minimum: 0 }),
  customType: Type7.String({ minLength: 1 }),
  content: Type7.String({ minLength: 1 }),
  display: Type7.Boolean()
}, { $id: "ExecNotificationClaimed", additionalProperties: false });
var ExecNotificationUnavailableSchema = Type7.Object({ kind: Type7.Literal("unavailable") }, { $id: "ExecNotificationUnavailable", additionalProperties: false });
var ExecNotificationClaimSchema = Type7.Union([
  ExecNotificationClaimedSchema,
  ExecNotificationUnavailableSchema
]);
var ExecPolicyScopeSchema = Type7.Object({ scope: Type7.String({ minLength: 1 }), execPolicy: Type7.Unknown() }, { $id: "ExecPolicyScope", additionalProperties: false });
var RefreshExecPolicyFactsSchema = Type7.Object({ scopes: Type7.Array(ExecPolicyScopeSchema) }, { $id: "RefreshExecPolicyFacts", additionalProperties: false });
var RefreshExecPolicyResultSchema = Type7.Object({
  ok: Type7.Literal(true),
  activeRuleCount: Type7.Integer({ minimum: 0 }),
  scopes: Type7.Array(Type7.String()),
  errors: Type7.Array(Type7.String())
}, { $id: "RefreshExecPolicyResult", additionalProperties: false });
var SkillListFactsSchema = Type7.Object({ cwd: Type7.String(), includeDisabled: Type7.Optional(Type7.Boolean()) }, { $id: "SkillListFacts", additionalProperties: false });
var SkillInfoSchema = Type7.Object({
  name: Type7.String({ minLength: 1 }),
  location: Type7.String({ minLength: 1 }),
  baseDir: Type7.String(),
  description: Type7.String()
}, { $id: "SkillInfo", additionalProperties: false });
var SkillListResultSchema = Type7.Object({ skills: Type7.Array(SkillInfoSchema) }, { $id: "SkillListResult", additionalProperties: false });
var SkillResolveFactsSchema = Type7.Object({ prompt: Type7.String(), cwd: Type7.String(), ctx: Type7.Optional(Type7.Unknown()) }, { $id: "SkillResolveFacts", additionalProperties: false });
var SkillBlockSchema = Type7.Object({
  name: Type7.String({ minLength: 1 }),
  location: Type7.String({ minLength: 1 }),
  baseDir: Type7.String(),
  content: Type7.String({ minLength: 1 }),
  parent: Type7.Optional(Type7.String({ minLength: 1 }))
}, { $id: "SkillBlock", additionalProperties: false });
var BridgeWarningSchema = Type7.Object({ message: Type7.String({ minLength: 1 }) }, { $id: "BridgeWarning", additionalProperties: false });
var SkillResolveResultSchema = Type7.Object({ blocks: Type7.Array(SkillBlockSchema), warnings: Type7.Array(BridgeWarningSchema) }, { $id: "SkillResolveResult", additionalProperties: false });
var EnvironmentContextFactsSchema = Type7.Object({ shell: Type7.String() }, { $id: "EnvironmentContextFacts", additionalProperties: false });
var EnvironmentContextNoneSchema = Type7.Object({ kind: Type7.Literal("none") }, { $id: "EnvironmentContextNone", additionalProperties: false });
var EnvironmentContextInjectSchema = Type7.Object({
  kind: Type7.Literal("inject"),
  customType: Type7.String({ minLength: 1 }),
  content: Type7.String({ minLength: 1 }),
  display: Type7.Boolean()
}, { $id: "EnvironmentContextInject", additionalProperties: false });
var EnvironmentContextPlanSchema = Type7.Union([
  EnvironmentContextNoneSchema,
  EnvironmentContextInjectSchema
]);
var CommandNotificationFactsSchema = Type7.Object({
  commandName: Type7.String({ minLength: 1 }),
  ok: Type7.Boolean(),
  message: Type7.String(),
  error: Type7.String(),
  uiAvailable: Type7.Boolean()
}, { $id: "CommandNotificationFacts", additionalProperties: false });
var CommandNotificationUnavailableSchema = Type7.Object({ kind: Type7.Literal("unavailable") }, { $id: "CommandNotificationUnavailable", additionalProperties: false });
var CommandNotificationSendSchema = Type7.Object({
  kind: Type7.Literal("notify"),
  message: Type7.String({ minLength: 1 }),
  level: Type7.Union([Type7.Literal("info"), Type7.Literal("warning")])
}, { $id: "CommandNotificationSend", additionalProperties: false });
var CommandNotificationPlanSchema = Type7.Union([
  CommandNotificationUnavailableSchema,
  CommandNotificationSendSchema
]);
var PlanContinuationFactsSchema = Type7.Object({
  initial: Type7.Boolean(),
  hostIdle: Type7.Boolean(),
  hasPendingMessages: Type7.Boolean(),
  retrying: Type7.Boolean(),
  compacting: Type7.Boolean(),
  latestAssistantStopReason: Type7.Optional(Type7.String({ minLength: 1 })),
  ctx: Type7.Optional(Type7.Unknown())
}, { $id: "PlanContinuationFacts", additionalProperties: false });
var PlanContinuationNoneSchema = Type7.Object({ kind: Type7.Literal("none") }, { $id: "PlanContinuationNone", additionalProperties: false });
var PlanContinuationSendSchema = Type7.Object({
  kind: Type7.Literal("send"),
  customType: Type7.String({ minLength: 1 }),
  content: Type7.String({ minLength: 1 }),
  display: Type7.Boolean(),
  triggerTurn: Type7.Boolean(),
  deliverAs: Type7.String({ minLength: 1 }),
  details: PlanPresentationDetailsSchema
}, { $id: "PlanContinuationSend", additionalProperties: false });
var PlanContinuationPlanSchema = Type7.Union([
  PlanContinuationNoneSchema,
  PlanContinuationSendSchema
]);
var ChildPlanContinuationSendSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("send_plan_continuation"),
  customType: Type7.String({ minLength: 1 }),
  content: Type7.String({ minLength: 1 }),
  display: Type7.Boolean(),
  triggerTurn: Type7.Boolean(),
  deliverAs: Type7.String({ minLength: 1 })
}, { $id: "ChildPlanContinuationSend", additionalProperties: false });
var ChildPlanContinuationFinalizeSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("finalize"),
  status: Type7.String({ minLength: 1 }),
  reason: Type7.Optional(Type7.String({ minLength: 1 }))
}, { $id: "ChildPlanContinuationFinalize", additionalProperties: false });
var ChildSessionStartFactsSchema = Type7.Object({
  metadata: ChildSessionMetadataSchema,
  parentSessionId: Type7.Optional(Type7.String()),
  parentSessionFile: Type7.Optional(Type7.String())
}, { $id: "ChildSessionStartFacts", additionalProperties: false });
var ChildSessionStartPlanSchema = Type7.Object({
  parentSession: Type7.Optional(Type7.String({ minLength: 1 })),
  modelId: Type7.Optional(Type7.String({ minLength: 1 })),
  thinkingLevel: Type7.Optional(Type7.String({ minLength: 1 })),
  activeTools: Type7.Optional(Type7.Array(Type7.String({ minLength: 1 }))),
  privateSessionDirectory: Type7.Optional(Type7.String({ minLength: 1 })),
  setupEntries: Type7.Array(ChildSessionSetupEntrySchema)
}, { $id: "ChildSessionStartPlan", additionalProperties: false });
var ChildDispatchFactsSchema = Type7.Object({
  available: Type7.Boolean(),
  cancelled: Type7.Optional(Type7.Boolean()),
  sessionId: Type7.Optional(Type7.String()),
  sessionFile: Type7.Optional(Type7.String()),
  error: Type7.Optional(Type7.String()),
  missingSessionIdentifier: Type7.Optional(Type7.Boolean()),
  activeTools: Type7.Optional(Type7.Array(Type7.String())),
  activeToolsApplied: Type7.Optional(Type7.Boolean()),
  modelId: Type7.Optional(Type7.String()),
  modelApplied: Type7.Optional(Type7.Boolean()),
  thinkingLevel: Type7.Optional(Type7.String()),
  thinkingApplied: Type7.Optional(Type7.Boolean()),
  prompt: Type7.String(),
  emptyReason: Type7.String({ minLength: 1 }),
  sendAvailable: Type7.Boolean(),
  deliverAs: Type7.Optional(Type7.String())
}, { $id: "ChildDispatchFacts", additionalProperties: false });
var ChildDispatchCompletionSchema = Type7.Object({
  status: Type7.Union([
    Type7.Literal("completed"),
    Type7.Literal("failed"),
    Type7.Literal("cancelled"),
    Type7.Literal("timed_out")
  ]),
  finalOutput: Type7.Optional(Type7.String()),
  reason: Type7.Optional(Type7.String())
}, { $id: "ChildDispatchCompletion", additionalProperties: false });
var ChildDispatchResultSchema = Type7.Object({
  dispatched: Type7.Boolean(),
  reason: Type7.Optional(Type7.String()),
  sessionId: Type7.Optional(Type7.String()),
  completion: Type7.Optional(ChildDispatchCompletionSchema)
}, { $id: "ChildDispatchResult", additionalProperties: false });
var ChildDispatchPlanSchema = Type7.Object({
  send: Type7.Boolean(),
  prompt: Type7.String(),
  deliverAs: Type7.String(),
  result: ChildDispatchResultSchema
}, { $id: "ChildDispatchPlan", additionalProperties: false });
var ResolvedMutationPathSchema = Type7.Object({ path: Type7.String({ minLength: 1 }), resolvedPath: Type7.String({ minLength: 1 }) }, { $id: "ResolvedMutationPath", additionalProperties: false });
var WorkspaceMutationFactsSchema = Type7.Object({
  workspaceRoots: Type7.Array(Type7.String({ minLength: 1 })),
  paths: Type7.Array(ResolvedMutationPathSchema)
}, { $id: "WorkspaceMutationFacts", additionalProperties: false });
var WorkspaceMutationValidSchema = Type7.Object({ kind: Type7.Literal("valid") }, { $id: "WorkspaceMutationValid", additionalProperties: false });
var WorkspaceMutationInvalidSchema = Type7.Object({ kind: Type7.Literal("invalid"), message: Type7.String({ minLength: 1 }) }, { $id: "WorkspaceMutationInvalid", additionalProperties: false });
var WorkspaceMutationValidationSchema = Type7.Union([
  WorkspaceMutationValidSchema,
  WorkspaceMutationInvalidSchema
]);
var ExecPolicyAllowRuleFactsSchema = Type7.Object({ tokens: Type7.Array(Type7.String({ minLength: 1 }), { minItems: 1 }) }, { $id: "ExecPolicyAllowRuleFacts", additionalProperties: false });
var ExecPolicyAllowRuleResultSchema = Type7.Object({ activeRuleCount: Type7.Integer({ minimum: 0 }) }, { $id: "ExecPolicyAllowRuleResult", additionalProperties: false });
var ExecApprovalPromptFactsSchema = Type7.Object({
  approvalTitle: Type7.String(),
  approvalPrompt: Type7.String(),
  approvalTimeoutMs: Type7.Number({ minimum: 0 }),
  uiAvailable: Type7.Boolean()
}, { $id: "ExecApprovalPromptFacts", additionalProperties: false });
var ExecApprovalUnavailableSchema = Type7.Object({ kind: Type7.Literal("unavailable") }, { $id: "ExecApprovalUnavailable", additionalProperties: false });
var ExecApprovalConfirmSchema = Type7.Object({
  kind: Type7.Literal("confirm"),
  title: Type7.String(),
  prompt: Type7.String(),
  timeoutMs: Type7.Optional(Type7.Number({ exclusiveMinimum: 0 }))
}, { $id: "ExecApprovalConfirm", additionalProperties: false });
var ExecApprovalPromptPlanSchema = Type7.Union([
  ExecApprovalUnavailableSchema,
  ExecApprovalConfirmSchema
]);
var CommandExecutionFactsSchema = Type7.Object({ name: Type7.String({ minLength: 1 }), args: Type7.String(), ctx: Type7.Optional(Type7.Unknown()) }, { $id: "CommandExecutionFacts", additionalProperties: false });
var CommandContextOverrideSchema = Type7.Object({ name: Type7.String({ minLength: 1 }), value: Type7.String() }, { $id: "CommandContextOverride", additionalProperties: false });
var CommandExecutionErrorSchema = Type7.Object({ kind: Type7.Literal("error"), message: Type7.String({ minLength: 1 }) }, { $id: "CommandExecutionError", additionalProperties: false });
var CommandExecutionDirectSchema = Type7.Object({ kind: Type7.Literal("direct") }, { $id: "CommandExecutionDirect", additionalProperties: false });
var CommandExecutionChildSchema = Type7.Object({
  kind: Type7.Literal("child"),
  metadata: ChildSessionMetadataSchema,
  contextOverrides: Type7.Array(CommandContextOverrideSchema),
  activeToolsMode: Type7.String({ minLength: 1 }),
  childSessionContextKey: Type7.String()
}, { $id: "CommandExecutionChild", additionalProperties: false });
var CommandExecutionPlanSchema = Type7.Union([
  CommandExecutionErrorSchema,
  CommandExecutionDirectSchema,
  CommandExecutionChildSchema
]);
var CommandChildSessionFactsSchema = Type7.Object({
  metadata: ChildSessionMetadataSchema,
  activeToolsMode: Type7.String({ minLength: 1 }),
  currentActiveToolsAvailable: Type7.Boolean(),
  currentActiveTools: Type7.Array(Type7.String({ minLength: 1 }))
}, { $id: "CommandChildSessionFacts", additionalProperties: false });
var CommandChildSessionPlanSchema = Type7.Object({ metadata: ChildSessionMetadataSchema }, { $id: "CommandChildSessionPlan", additionalProperties: false });
var BridgeToolResultSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("tool_result"),
  text: Type7.String(),
  details: Type7.Unknown()
}, { $id: "BridgeToolResult", additionalProperties: false });
var BridgeErrorResultSchema = Type7.Object({ ok: Type7.Literal(false), error: Type7.String({ minLength: 1 }) }, { $id: "BridgeErrorResult", additionalProperties: false });
var CoreAckSchema = Type7.Object({ ok: Type7.Literal(true) }, { $id: "CoreAck", additionalProperties: false });
var AgentOwnerContextFactsSchema = Type7.Object({ ctx: Type7.Unknown() }, { $id: "AgentOwnerContextFacts", additionalProperties: false });
var AgentActionCapabilityFactsSchema = Type7.Object({ capabilityId: Type7.String({ minLength: 1 }), agentId: Type7.String({ minLength: 1 }), action: Type7.String({ pattern: "^agent_(start|send|close)$" }), runId: Type7.Optional(Type7.String({ minLength: 1 })), submissionId: Type7.Optional(Type7.String({ minLength: 1 })), ctx: Type7.Unknown() }, { $id: "AgentActionCapabilityFacts", additionalProperties: false });
var ExecCompletionWaitResultSchema = Type7.Object({ ok: Type7.Literal(true), exited: Type7.Boolean() }, { $id: "ExecCompletionWaitResult", additionalProperties: false });
var BridgeToolExecutionResultSchema = Type7.Union([BridgeToolResultSchema, BridgeErrorResultSchema]);
var ExaExecutionFactsSchema = Type7.Object({ planId: Type7.String({ minLength: 1 }), ctx: Type7.Unknown() }, { $id: "ExaExecutionFacts", additionalProperties: false });
var ToolResultTextContentSchema = Type7.Object({ type: Type7.Literal("text"), text: Type7.String() }, { $id: "ToolResultTextContent", additionalProperties: false });
var ToolResultEnvelopeSchema = Type7.Object({ content: Type7.Array(ToolResultTextContentSchema, { minItems: 1 }), details: Type7.Unknown() }, { $id: "ToolResultEnvelope", additionalProperties: false });
var BridgeCommandResultSchema = Type7.Object({
  ok: Type7.Boolean(),
  action: Type7.Literal("command_result"),
  message: Type7.String(),
  details: Type7.Unknown()
}, { $id: "BridgeCommandResult", additionalProperties: false });
var ReadFileFactsSchema = Type7.Object({
  path: Type7.String({ minLength: 1 }),
  offset: Type7.Optional(Type7.Integer({ minimum: 1 })),
  limit: Type7.Optional(Type7.Integer({ minimum: 1 })),
  defaultCwd: Type7.String()
}, { $id: "ReadFileFacts", additionalProperties: false });
var ViewMediaFactsSchema = Type7.Object({ path: Type7.String({ minLength: 1 }), defaultCwd: Type7.String() }, { $id: "ViewMediaFacts", additionalProperties: false });
var ToolResultImageContentSchema = Type7.Object({
  type: Type7.Literal("image"),
  data: Type7.String({ minLength: 1 }),
  mimeType: Type7.String({ pattern: "^image/" })
}, { $id: "ToolResultImageContent", additionalProperties: false });
var ViewMediaSuccessEnvelopeSchema = Type7.Object({
  content: Type7.Tuple([ToolResultTextContentSchema, ToolResultImageContentSchema]),
  details: Type7.Unknown()
}, { $id: "ViewMediaSuccessEnvelope", additionalProperties: false });
var ViewMediaResultEnvelopeSchema = Type7.Union([
  ToolResultEnvelopeSchema,
  ViewMediaSuccessEnvelopeSchema
]);
var WriteStdinFactsSchema = Type7.Object({
  sessionId: Type7.Integer({ minimum: 1 }),
  chars: Type7.String(),
  outputMode: Type7.Optional(Type7.Union([Type7.Literal("delta"), Type7.Literal("status")])),
  yieldTimeMs: Type7.Optional(Type7.Number({ minimum: 0 })),
  maxOutputTokens: Type7.Optional(Type7.Integer({ minimum: 0 })),
  ownerId: Type7.String({ minLength: 1 }),
  signal: Type7.Optional(Type7.Unknown())
}, { $id: "WriteStdinFacts", additionalProperties: false });
var ExecTruncationSchema = Type7.Object({
  truncated: Type7.Boolean(),
  truncatedBy: Type7.String(),
  totalLines: Type7.Integer(),
  totalBytes: Type7.Integer(),
  outputLines: Type7.Integer(),
  outputBytes: Type7.Integer(),
  maxLines: Type7.Integer(),
  maxBytes: Type7.Integer(),
  lastLinePartial: Type7.Boolean(),
  firstLineExceedsLimit: Type7.Boolean(),
  fullOutputPath: Type7.Optional(Type7.String())
}, { $id: "ExecTruncation", additionalProperties: false });
var ExecResultDetailsSchema = Type7.Object({
  ok: Type7.Boolean(),
  output: Type7.String(),
  stdout: Type7.String(),
  stderr: Type7.String(),
  truncation: ExecTruncationSchema,
  wallTimeMs: Type7.Number(),
  outputMode: Type7.String(),
  suppressedLines: Type7.Integer(),
  suppressedBytes: Type7.Integer(),
  reasonCode: Type7.Optional(Type7.String()),
  outputLimitBytes: Type7.Optional(Type7.Number()),
  truncated: Type7.Optional(Type7.Boolean()),
  fullOutputPath: Type7.Optional(Type7.String()),
  exitCode: Type7.Optional(Type7.Integer()),
  code: Type7.Optional(Type7.Integer()),
  sessionId: Type7.Optional(Type7.Integer()),
  session_id: Type7.Optional(Type7.Integer()),
  sandboxed: Type7.Optional(Type7.Boolean()),
  escalated: Type7.Optional(Type7.Boolean()),
  kind: Type7.Optional(Type7.String()),
  alreadyCompleted: Type7.Optional(Type7.Boolean())
}, { $id: "ExecResultDetails", additionalProperties: false });
var HostExecResultSchema = Type7.Object({ code: Type7.Integer(), stdout: Type7.String(), stderr: Type7.String() }, { $id: "HostExecResult", additionalProperties: false });
var ExecToolResultSchema = Type7.Object({ content: Type7.Array(ToolResultTextContentSchema, { minItems: 1 }), details: ExecResultDetailsSchema }, { $id: "ExecToolResult", additionalProperties: false });
var ExecApprovalOutcomeFactsSchema = Type7.Object({
  planId: Type7.String({ minLength: 1 }),
  ctx: Type7.Unknown(),
  outcome: Type7.Union([
    Type7.Literal("approved"),
    Type7.Literal("denied_by_user"),
    Type7.Literal("timed_out"),
    Type7.Literal("unavailable"),
    Type7.Literal("interrupted")
  ])
}, { $id: "ExecApprovalOutcomeFacts", additionalProperties: false });
var ExecApprovalRunSchema = Type7.Object({ kind: Type7.Literal("run"), forceUnsandboxed: Type7.Literal(true) }, { $id: "ExecApprovalRun", additionalProperties: false });
var ExecApprovalDeniedSchema = Type7.Object({ kind: Type7.Literal("denied"), result: ToolResultEnvelopeSchema }, { $id: "ExecApprovalDenied", additionalProperties: false });
var ExecApprovalResultSchema = Type7.Union([ExecApprovalRunSchema, ExecApprovalDeniedSchema]);
var AuthorityPlanRefSchema = Type7.Object({ planId: Type7.String({ minLength: 1 }), ctx: Type7.Unknown() }, { $id: "AuthorityPlanRef", additionalProperties: false });
var AuthorityPlanIssuedSchema = Type7.Object({ planId: Type7.String({ minLength: 1 }) }, { $id: "AuthorityPlanIssued", additionalProperties: false });
var CommandChildDispatchFactsSchema = Type7.Object({ result: BridgeCommandResultSchema, bridge: Type7.Unknown() }, { $id: "CommandChildDispatchFacts", additionalProperties: false });
var CommandBridgeUpdateSchema = Type7.Object({ action: Type7.String({ minLength: 1 }), key: Type7.String({ minLength: 1 }) }, { $id: "CommandBridgeUpdate", additionalProperties: false });
var CommandChildReturnSchema = Type7.Object({ kind: Type7.Literal("return"), result: BridgeCommandResultSchema }, { $id: "CommandChildReturn", additionalProperties: false });
var CommandChildDispatchSchema = Type7.Object({
  kind: Type7.Literal("dispatch"),
  result: BridgeCommandResultSchema,
  bridgeUpdate: CommandBridgeUpdateSchema,
  prompt: Type7.String({ minLength: 1 })
}, { $id: "CommandChildDispatch", additionalProperties: false });
var CommandChildDispatchPlanSchema = Type7.Union([CommandChildReturnSchema, CommandChildDispatchSchema]);
var CommandChildDispatchFinishFactsSchema = Type7.Object({ result: BridgeCommandResultSchema, dispatch: ChildDispatchResultSchema }, { $id: "CommandChildDispatchFinishFacts", additionalProperties: false });
var CronContextFactsSchema = Type7.Object({ ctx: Type7.Unknown() }, { $id: "CronContextFacts", additionalProperties: false });
var CronPlanFactsSchema = Type7.Object({ planSlotFree: Type7.Boolean(), planDriving: Type7.Boolean() }, { $id: "CronPlanFacts", additionalProperties: false });
var CronPollFactsSchema = Type7.Object({
  now: Type7.Number(),
  hostIdle: Type7.Boolean(),
  planDriving: Type7.Boolean(),
  planSlotFree: Type7.Boolean(),
  ctx: Type7.Unknown()
}, { $id: "CronPollFacts", additionalProperties: false });
var CronPollNoneSchema = Type7.Object({ kind: Type7.Literal("none") }, { $id: "CronPollNone", additionalProperties: false });
var CronPollDeliverySchema = Type7.Object({
  kind: Type7.Literal("deliver"),
  id: Type7.String({ minLength: 1 }),
  mode: Type7.Union([Type7.Literal("message"), Type7.Literal("plan")]),
  content: Type7.String({ minLength: 1 }),
  coalesced: Type7.Integer({ minimum: 1 }),
  cron: Type7.String({ minLength: 1 }),
  schedule: Type7.String()
}, { $id: "CronPollDelivery", additionalProperties: false });
var CronPollPlanSchema = Type7.Union([CronPollNoneSchema, CronPollDeliverySchema]);
var CronDeliveredFactsSchema = Type7.Object({ id: Type7.String({ minLength: 1 }), now: Type7.Number(), ctx: Type7.Unknown() }, { $id: "CronDeliveredFacts", additionalProperties: false });
var CronDeliveredResultSchema = Type7.Object({ acknowledged: Type7.Boolean() }, { $id: "CronDeliveredResult", additionalProperties: false });
var CronStartupFactsSchema = Type7.Object({ reason: Type7.String(), ctx: Type7.Unknown() }, { $id: "CronStartupFacts", additionalProperties: false });
var CronStartupNoneSchema = Type7.Object({ kind: Type7.Literal("none") }, { $id: "CronStartupNone", additionalProperties: false });
var CronStartupNotifySchema = Type7.Object({ kind: Type7.Literal("notify"), message: Type7.String({ minLength: 1 }) }, { $id: "CronStartupNotify", additionalProperties: false });
var CronStartupPlanSchema = Type7.Union([CronStartupNoneSchema, CronStartupNotifySchema]);
var ThreadToolFactsSchema = Type7.Object({
  name: Type7.Union([Type7.Literal("query_threads"), Type7.Literal("read_thread")]),
  params: Type7.Unknown(),
  catalog: Type7.Unknown(),
  ctx: Type7.Unknown()
}, { $id: "ThreadToolFacts", additionalProperties: false });
var PlanRollbackFactsSchema = Type7.Object({ snapshot: Type7.Unknown(), ctx: Type7.Unknown() }, { $id: "PlanRollbackFacts", additionalProperties: false });
var FinalizePlanErrorFactsSchema = Type7.Object({ status: Type7.String({ minLength: 1 }), ctx: Type7.Unknown() }, { $id: "FinalizePlanErrorFacts", additionalProperties: false });
var PlanRollbackResultSchema = Type7.Object({ completed: Type7.Literal(true) }, { $id: "PlanRollbackResult", additionalProperties: false });
var MutationErrorSchema = Type7.Object({ kind: Type7.Literal("error"), message: Type7.String({ minLength: 1 }) }, { $id: "MutationError", additionalProperties: false });
var EditApplicationFactsSchema = Type7.Object({ path: Type7.String({ minLength: 1 }), displayPath: Type7.String({ minLength: 1 }), edits: Type7.Array(EditReplacementSchema, { minItems: 1 }), contents: Type7.String() }, { $id: "EditApplicationFacts", additionalProperties: false });
var EditAppliedSchema = Type7.Object({
  kind: Type7.Literal("applied"),
  path: Type7.String({ minLength: 1 }),
  displayPath: Type7.String({ minLength: 1 }),
  contents: Type7.String(),
  editCount: Type7.Integer({ minimum: 1 })
}, { $id: "EditApplied", additionalProperties: false });
var EditApplicationResultSchema = Type7.Union([MutationErrorSchema, EditAppliedSchema]);
var PatchWriteSchema = Type7.Object({ path: Type7.String({ minLength: 1 }), contents: Type7.String() }, { $id: "PatchWrite", additionalProperties: false });
var AuthorizedMutationPathSchema = Type7.Object({ originalPath: Type7.String({ minLength: 1 }), resolvedPath: Type7.String({ minLength: 1 }) }, { $id: "AuthorizedMutationPath", additionalProperties: false });
var PatchApplicationFactsSchema = Type7.Object({
  params: ApplyPatchParamsSchema,
  files: Type7.Record(Type7.String(), Type7.String()),
  ctx: Type7.Unknown(),
  filesystemApproval: Type7.Boolean(),
  authorizedPaths: Type7.Array(AuthorizedMutationPathSchema, { minItems: 1 })
}, { $id: "PatchApplicationFacts", additionalProperties: false });
var PatchAppliedSchema = Type7.Object({
  kind: Type7.Literal("applied"),
  deletes: Type7.Array(Type7.String({ minLength: 1 })),
  writes: Type7.Array(PatchWriteSchema),
  affectedPaths: Type7.Array(Type7.String({ minLength: 1 }))
}, { $id: "PatchApplied", additionalProperties: false });
var PatchApplicationResultSchema = Type7.Union([MutationErrorSchema, PatchAppliedSchema]);
var VisibilityWarningFactsSchema = Type7.Object({
  tools: Type7.Array(Type7.String({ minLength: 1 })),
  skills: Type7.Array(Type7.String({ minLength: 1 }))
}, { $id: "VisibilityWarningFacts", additionalProperties: false });
var VisibilityWarningsResultSchema = Type7.Object({ messages: Type7.Array(Type7.String({ minLength: 1 })) }, { $id: "VisibilityWarningsResult", additionalProperties: false });
var VisibilityRowsFactsSchema = Type7.Object({
  category: Type7.Union([Type7.Literal("tools"), Type7.Literal("skills")]),
  ctx: Type7.Unknown()
}, { $id: "VisibilityRowsFacts", additionalProperties: false });
var VisibilityRowSchema = Type7.Object({
  name: Type7.String({ minLength: 1 }),
  state: Type7.String({ minLength: 1 }),
  available: Type7.Boolean(),
  description: Type7.String()
}, { $id: "VisibilityRow", additionalProperties: false });
var VisibilityRowsResultSchema = Type7.Object({
  category: Type7.Union([Type7.Literal("tools"), Type7.Literal("skills")]),
  title: Type7.String({ minLength: 1 }),
  rows: Type7.Array(VisibilityRowSchema),
  disabled: Type7.Array(Type7.String({ minLength: 1 })),
  unavailable: Type7.Array(Type7.String({ minLength: 1 }))
}, { $id: "VisibilityRowsResult", additionalProperties: false });
var VisibilityToggleFactsSchema = Type7.Object({
  category: Type7.Union([Type7.Literal("tools"), Type7.Literal("skills")]),
  name: Type7.String({ minLength: 1 }),
  ctx: Type7.Unknown()
}, { $id: "VisibilityToggleFacts", additionalProperties: false });
var VisibilityMutationDetailsSchema = Type7.Object({
  category: Type7.Union([Type7.Literal("tools"), Type7.Literal("skills")]),
  title: Type7.String({ minLength: 1 }),
  rows: Type7.Array(VisibilityRowSchema),
  disabled: Type7.Array(Type7.String({ minLength: 1 })),
  unavailable: Type7.Array(Type7.String({ minLength: 1 })),
  visibilityChanged: Type7.Literal(true),
  enabledName: Type7.Optional(Type7.String({ minLength: 1 })),
  disabledName: Type7.Optional(Type7.String({ minLength: 1 }))
}, { $id: "VisibilityMutationDetails", additionalProperties: false });
var VisibilityToggleSuccessSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("command_result"),
  message: Type7.String(),
  details: VisibilityMutationDetailsSchema
}, { $id: "VisibilityToggleSuccess", additionalProperties: false });
var VisibilityToggleErrorSchema = Type7.Object({
  ok: Type7.Literal(false),
  action: Type7.Literal("command_result"),
  message: Type7.String(),
  error: Type7.String({ minLength: 1 }),
  details: VisibilityRowsResultSchema
}, { $id: "VisibilityToggleError", additionalProperties: false });
var VisibilityToggleResultSchema = Type7.Union([VisibilityToggleSuccessSchema, VisibilityToggleErrorSchema]);
var VisibilitySavePlanSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("visibility_save_project"),
  category: Type7.Union([Type7.Literal("tools"), Type7.Literal("skills")]),
  disabled: Type7.Array(Type7.String({ minLength: 1 })),
  details: VisibilityRowsResultSchema
}, { $id: "VisibilitySavePlan", additionalProperties: false });
var VisibilityListResultSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("command_result"),
  message: Type7.String(),
  details: VisibilityRowsResultSchema
}, { $id: "VisibilityListResult", additionalProperties: false });
var CompactionSettingsSchema = Type7.Object({
  session: Type7.Optional(Type7.String()),
  global: Type7.Optional(Type7.String()),
  project: Type7.Optional(Type7.String())
}, { $id: "CompactionSettings", additionalProperties: false });
var CompactionCommandFactsSchema = Type7.Object({ args: Type7.String(), settings: CompactionSettingsSchema }, { $id: "CompactionCommandFacts", additionalProperties: false });
var CompactionPlanErrorSchema = Type7.Object({ kind: Type7.Literal("error"), message: Type7.String({ minLength: 1 }) }, { $id: "CompactionPlanError", additionalProperties: false });
var CompactionShowSchema = Type7.Object({ kind: Type7.Literal("show"), model: Type7.String(), source: Type7.String({ minLength: 1 }) }, { $id: "CompactionShow", additionalProperties: false });
var CompactionSetProjectSchema = Type7.Object({ kind: Type7.Literal("set_project"), model: Type7.String({ minLength: 1 }) }, { $id: "CompactionSetProject", additionalProperties: false });
var CompactionClearProjectSchema = Type7.Object({ kind: Type7.Literal("clear_project") }, { $id: "CompactionClearProject", additionalProperties: false });
var CompactionOpenPickerSchema = Type7.Object({ kind: Type7.Literal("open_picker"), current: Type7.String() }, { $id: "CompactionOpenPicker", additionalProperties: false });
var CompactionCommandPlanSchema = Type7.Union([
  CompactionPlanErrorSchema,
  CompactionShowSchema,
  CompactionSetProjectSchema,
  CompactionClearProjectSchema,
  CompactionOpenPickerSchema
]);
var CompactionDefaultSchema = Type7.Object({ kind: Type7.Literal("default") }, { $id: "CompactionDefault", additionalProperties: false });
var CompactionUseModelSchema = Type7.Object({ kind: Type7.Literal("compact"), model: Type7.String({ minLength: 1 }) }, { $id: "CompactionUseModel", additionalProperties: false });
var CompactionSessionPlanSchema = Type7.Union([CompactionDefaultSchema, CompactionUseModelSchema]);
var PermissionsMenuOptionSchema = Type7.Object({
  label: Type7.String({ minLength: 1 }),
  value: Type7.String({ minLength: 1 }),
  description: Type7.String(),
  selected: Type7.Boolean()
}, { $id: "PermissionsMenuOption", additionalProperties: false });
var PermissionsPromptSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("permissions_prompt"),
  title: Type7.String({ minLength: 1 }),
  message: Type7.String(),
  options: Type7.Array(PermissionsMenuOptionSchema)
}, { $id: "PermissionsPrompt", additionalProperties: false });
var PermissionsPromptFactsSchema = Type7.Object({ prompt: PermissionsPromptSchema, uiAvailable: Type7.Boolean() }, { $id: "PermissionsPromptFacts", additionalProperties: false });
var PermissionsCommandResultSchema = Type7.Object({
  ok: Type7.Boolean(),
  action: Type7.Literal("command_result"),
  message: Type7.String(),
  error: Type7.Optional(Type7.String()),
  details: Type7.Optional(Type7.Unknown())
}, { $id: "PermissionsCommandResult", additionalProperties: false });
var PermissionsPromptSelectSchema = Type7.Object({
  kind: Type7.Literal("select"),
  title: Type7.String({ minLength: 1 }),
  labels: Type7.Array(Type7.String({ minLength: 1 }), { minItems: 1 })
}, { $id: "PermissionsPromptSelect", additionalProperties: false });
var PermissionsPromptResultSchema = Type7.Object({ kind: Type7.Literal("result"), result: PermissionsCommandResultSchema }, { $id: "PermissionsPromptResult", additionalProperties: false });
var PermissionsPromptPlanSchema = Type7.Union([PermissionsPromptSelectSchema, PermissionsPromptResultSchema]);
var PermissionsSelectionSchema = Type7.Object({
  status: Type7.Union([Type7.Literal("selected"), Type7.Literal("cancelled")]),
  selected: Type7.Optional(Type7.String())
}, { $id: "PermissionsSelection", additionalProperties: false });
var PermissionsPromptFinishFactsSchema = Type7.Object({ prompt: PermissionsPromptSchema, selection: PermissionsSelectionSchema, ctx: Type7.Unknown() }, { $id: "PermissionsPromptFinishFacts", additionalProperties: false });
var CronTaskSchema2 = Type7.Object({
  id: Type7.String({ minLength: 1 }),
  schedule: Type7.String(),
  cron: Type7.String({ minLength: 1 }),
  prompt: Type7.String(),
  recurring: Type7.Boolean(),
  mode: Type7.Union([Type7.Literal("message"), Type7.Literal("plan")]),
  enabled: Type7.Boolean(),
  nextDue: Type7.Integer(),
  nextDueText: Type7.String(),
  pending: Type7.Boolean()
}, { $id: "CronTask", additionalProperties: false });
var CronListDetailsSchema = Type7.Object({ enabled: Type7.Boolean(), tasks: Type7.Array(CronTaskSchema2) }, { $id: "CronListDetails", additionalProperties: false });
var CronListResultSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("tool_result"),
  text: Type7.String(),
  details: CronListDetailsSchema
}, { $id: "CronListResult", additionalProperties: false });
var CronTaskPatchSchema = Type7.Object({
  id: Type7.String({ minLength: 1 }),
  prompt: Type7.Optional(Type7.String()),
  cron: Type7.Optional(Type7.String({ minLength: 1 })),
  recurring: Type7.Optional(Type7.Boolean()),
  mode: Type7.Optional(Type7.Union([Type7.Literal("message"), Type7.Literal("plan")]))
}, { $id: "CronTaskPatch", additionalProperties: false });
var CronTaskUpdateFactsSchema = Type7.Object({ patch: CronTaskPatchSchema, ctx: Type7.Unknown() }, { $id: "CronTaskUpdateFacts", additionalProperties: false });
var CronManagerCommandFactsSchema = Type7.Object({ args: Type7.String(), ctx: Type7.Unknown() }, { $id: "CronManagerCommandFacts", additionalProperties: false });
var CronCommandResultSchema = Type7.Object({
  ok: Type7.Boolean(),
  action: Type7.Literal("command_result"),
  message: Type7.String(),
  details: Type7.Unknown(),
  error: Type7.Optional(Type7.String())
}, { $id: "CronCommandResult", additionalProperties: false });
var CronPromptSchema = Type7.Object({
  ok: Type7.Literal(true),
  action: Type7.Literal("cron_prompt"),
  enabled: Type7.Boolean(),
  tasks: Type7.Array(CronTaskSchema2)
}, { $id: "CronPrompt", additionalProperties: false });
var CronPromptFactsSchema = Type7.Object({ prompt: CronPromptSchema, uiAvailable: Type7.Boolean() }, { $id: "CronPromptFacts", additionalProperties: false });
var CronPromptPlanSchema = Type7.Object({ kind: Type7.Literal("result"), result: CronCommandResultSchema }, { $id: "CronPromptPlan", additionalProperties: false });
// src/bridge-action-contracts.ts
var exports_bridge_action_contracts = {};
__export(exports_bridge_action_contracts, {
  WriteStdinHostResultSchema: () => WriteStdinHostResultSchema,
  WriteStdinHostOptionsSchema: () => WriteStdinHostOptionsSchema,
  WriteStdinHostCallSchema: () => WriteStdinHostCallSchema,
  VisibilityPromptSchema: () => VisibilityPromptSchema,
  UsagePairFetchSchema: () => UsagePairFetchSchema,
  ToolResultConstructionFactsSchema: () => ToolResultConstructionFactsSchema,
  SandboxConfigSchema: () => SandboxConfigSchema,
  RollbackUnacceptedAgentStartFactsSchema: () => RollbackUnacceptedAgentStartFactsSchema,
  RollbackFailedAgentInterruptionFactsSchema: () => RollbackFailedAgentInterruptionFactsSchema,
  RollbackAgentSendPreflightFactsSchema: () => RollbackAgentSendPreflightFactsSchema,
  RecordAgentSendDispatchFailureFactsSchema: () => RecordAgentSendDispatchFailureFactsSchema,
  RecordAgentChildSessionStartFactsSchema: () => RecordAgentChildSessionStartFactsSchema,
  ProcessManagerSnapshotSchema: () => ProcessManagerSnapshotSchema,
  ProcessManagerSessionFactsSchema: () => ProcessManagerSessionFactsSchema,
  ProcessManagerOwnerFactsSchema: () => ProcessManagerOwnerFactsSchema,
  ProcessManagerOutputSchema: () => ProcessManagerOutputSchema,
  ProcessManagerEntrySchema: () => ProcessManagerEntrySchema,
  PreparedWriteStdinSchema: () => PreparedWriteStdinSchema,
  PreparedWriteSchema: () => PreparedWriteSchema,
  PreparedWriteApprovalSchema: () => PreparedWriteApprovalSchema,
  PreparedViewMediaSchema: () => PreparedViewMediaSchema,
  PreparedToolActionSchema: () => PreparedToolActionSchema,
  PreparedThreadReadSchema: () => PreparedThreadReadSchema,
  PreparedThreadQuerySchema: () => PreparedThreadQuerySchema,
  PreparedThreadLocatorSchema: () => PreparedThreadLocatorSchema,
  PreparedReadSchema: () => PreparedReadSchema,
  PreparedPatchSchema: () => PreparedPatchSchema,
  PreparedPatchApprovalSchema: () => PreparedPatchApprovalSchema,
  PreparedExecSchema: () => PreparedExecSchema,
  PreparedExecInputSchema: () => PreparedExecInputSchema,
  PreparedExecApprovalSchema: () => PreparedExecApprovalSchema,
  PreparedExaSchema: () => PreparedExaSchema,
  PreparedExaApprovalSchema: () => PreparedExaApprovalSchema,
  PreparedEditSchema: () => PreparedEditSchema,
  PreparedEditApprovalSchema: () => PreparedEditApprovalSchema,
  PreparedAgentWaitSchema: () => PreparedAgentWaitSchema,
  PreparedAgentStartSchema: () => PreparedAgentStartSchema,
  PreparedAgentSendSchema: () => PreparedAgentSendSchema,
  PreparedAgentCloseSchema: () => PreparedAgentCloseSchema,
  PrepareToolFactsSchema: () => PrepareToolFactsSchema,
  PendingAgentNotificationsResultSchema: () => PendingAgentNotificationsResultSchema,
  OpenAiUsageFetchSchema: () => OpenAiUsageFetchSchema,
  LiveAgentDispatchesFactsSchema: () => LiveAgentDispatchesFactsSchema,
  HostToolResultFactsSchema: () => HostToolResultFactsSchema,
  HandleCommandFactsSchema: () => HandleCommandFactsSchema,
  GatewayCommandResultSchema: () => GatewayCommandResultSchema,
  GatewayCommandOutputSchema: () => GatewayCommandOutputSchema,
  GatewayCommandErrorSchema: () => GatewayCommandErrorSchema,
  FinishAgentWaitFactsSchema: () => FinishAgentWaitFactsSchema,
  ExecHostOptionsSchema: () => ExecHostOptionsSchema,
  ExecHostCallSchema: () => ExecHostCallSchema,
  CronPromptSelectionSchema: () => CronPromptSelectionSchema,
  CronPlanCreationResultSchema: () => CronPlanCreationResultSchema,
  CronPlanCreationFactsSchema: () => CronPlanCreationFactsSchema,
  ComposerSettingsSchema: () => ComposerSettingsSchema,
  ComposerCommandSuccessSchema: () => ComposerCommandSuccessSchema,
  ComposerCommandResultSchema: () => ComposerCommandResultSchema,
  ComposerCommandFactsSchema: () => ComposerCommandFactsSchema,
  ComposerCommandErrorSchema: () => ComposerCommandErrorSchema,
  AgentWorktreeLineDeltaUpdateSchema: () => AgentWorktreeLineDeltaUpdateSchema,
  AgentWorktreeLineDeltaUnavailableSchema: () => AgentWorktreeLineDeltaUnavailableSchema,
  AgentWorktreeLineDeltaReadySchema: () => AgentWorktreeLineDeltaReadySchema,
  AgentWaitDetailsSchema: () => AgentWaitDetailsSchema,
  AgentStartDetailsSchema: () => AgentStartDetailsSchema,
  AgentSessionMetadataSchema: () => AgentSessionMetadataSchema,
  AgentSendDetailsSchema: () => AgentSendDetailsSchema,
  AgentRunIdFactsSchema: () => AgentRunIdFactsSchema,
  AgentRoutingDiagnosticsResultSchema: () => AgentRoutingDiagnosticsResultSchema,
  AgentNotificationSchema: () => AgentNotificationSchema,
  AgentNotificationDetailsSchema: () => AgentNotificationDetailsSchema,
  AgentNotificationClaimValidationSchema: () => AgentNotificationClaimValidationSchema,
  AgentManagerSnapshotSchema: () => AgentManagerSnapshotSchema,
  AgentManagerRunSchema: () => AgentManagerRunSchema,
  AgentManagerIdentitySchema: () => AgentManagerIdentitySchema,
  AgentIdFactsSchema: () => AgentIdFactsSchema,
  AgentDispatchCompletionSchema: () => AgentDispatchCompletionSchema,
  AgentDispatchCompletionFactsSchema: () => AgentDispatchCompletionFactsSchema,
  AgentDispatchBoundaryFactsSchema: () => AgentDispatchBoundaryFactsSchema,
  AgentCloseDetailsSchema: () => AgentCloseDetailsSchema,
  AgentCleanupPlanSchema: () => AgentCleanupPlanSchema,
  AgentCleanupItemSchema: () => AgentCleanupItemSchema,
  AgentChildSessionUpdateSchema: () => AgentChildSessionUpdateSchema,
  AgentActivityFactsSchema: () => AgentActivityFactsSchema,
  AgentActiveCountResultSchema: () => AgentActiveCountResultSchema
});
import Type8 from "typebox";
var ComposerSettingsSchema = Type8.Object({
  taumel: Type8.Object({ composer: Type8.Object({ enabled: Type8.Boolean() }, { additionalProperties: false }) }, { additionalProperties: false })
}, { $id: "ComposerSettings", additionalProperties: false });
var ComposerCommandFactsSchema = Type8.Object({
  args: Type8.String(),
  path: Type8.String({ minLength: 1 }),
  settings: ComposerSettingsSchema
}, { $id: "ComposerCommandFacts", additionalProperties: false });
var ComposerCommandErrorSchema = Type8.Object({ kind: Type8.Literal("error"), message: Type8.String({ minLength: 1 }) }, { $id: "ComposerCommandError", additionalProperties: false });
var ComposerCommandSuccessSchema = Type8.Object({
  kind: Type8.Literal("result"),
  message: Type8.String(),
  settings: ComposerSettingsSchema,
  writeSettings: Type8.Boolean()
}, { $id: "ComposerCommandSuccess", additionalProperties: false });
var ComposerCommandResultSchema = Type8.Union([ComposerCommandErrorSchema, ComposerCommandSuccessSchema]);
var CronPlanCreationFactsSchema = Type8.Object({ title: Type8.String({ minLength: 1 }), ctx: Type8.Unknown() }, { $id: "CronPlanCreationFacts", additionalProperties: false });
var CronPlanCreationResultSchema = Type8.Object({ created: Type8.Boolean() }, { $id: "CronPlanCreationResult", additionalProperties: false });
var HandleCommandFactsSchema = Type8.Object({ name: Type8.String({ minLength: 1 }), args: Type8.String(), ctx: Type8.Unknown() }, { $id: "HandleCommandFacts", additionalProperties: false });
var GatewayCommandErrorSchema = Type8.Object({ ok: Type8.Literal(false), error: Type8.String({ minLength: 1 }) }, { $id: "GatewayCommandError", additionalProperties: false });
var GatewayCommandResultSchema = Type8.Object({
  ok: Type8.Boolean(),
  action: Type8.Literal("command_result"),
  message: Type8.String(),
  error: Type8.Optional(Type8.String()),
  details: Type8.Optional(Type8.Unknown()),
  planFollowup: Type8.Optional(Type8.Boolean()),
  planSubmitUserMessage: Type8.Optional(Type8.String()),
  planRollback: Type8.Optional(Type8.Unknown()),
  planInspection: Type8.Optional(Type8.Boolean())
}, { $id: "GatewayCommandResult", additionalProperties: false });
var VisibilityPromptSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("visibility_prompt"),
  category: Type8.Union([Type8.Literal("tools"), Type8.Literal("skills")]),
  title: Type8.String({ minLength: 1 })
}, { $id: "VisibilityPrompt", additionalProperties: false });
var OpenAiUsageFetchSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("openai_usage_fetch"), apiKeyPresent: Type8.Boolean() }, { $id: "OpenAiUsageFetch", additionalProperties: false });
var UsagePairFetchSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("usage_pair_fetch"),
  openaiApiKeyPresent: Type8.Boolean()
}, { $id: "UsagePairFetch", additionalProperties: false });
var GatewayCommandOutputSchema = Type8.Union([
  GatewayCommandErrorSchema,
  GatewayCommandResultSchema,
  PermissionsPromptSchema,
  CronPromptSchema,
  VisibilityPromptSchema,
  VisibilitySavePlanSchema,
  OpenAiUsageFetchSchema,
  UsagePairFetchSchema
]);
var PrepareToolFactsSchema = Type8.Object({ name: Type8.String({ minLength: 1 }), params: Type8.Unknown(), ctx: Type8.Unknown() }, { $id: "PrepareToolFacts", additionalProperties: false });
var SandboxConfigSchema = Type8.Object({
  filesystemMode: Type8.Union([
    Type8.Literal("read-only"),
    Type8.Literal("workspace-write"),
    Type8.Literal("danger-full-access")
  ]),
  networkMode: Type8.Union([Type8.Literal("disabled"), Type8.Literal("enabled")]),
  workspaceRoots: Type8.Array(Type8.String({ minLength: 1 })),
  noSandbox: Type8.Boolean(),
  isolatedChild: Type8.Boolean(),
  approvalPolicy: Type8.Union([
    Type8.Literal("never"),
    Type8.Literal("on-request"),
    Type8.Literal("on-failure"),
    Type8.Literal("untrusted")
  ])
}, { $id: "SandboxConfig", additionalProperties: false });
var ExecHostOptionsSchema = Type8.Object({
  cwd: Type8.String(),
  timeout: Type8.Optional(Type8.Number({ minimum: 0 })),
  yieldTimeMs: Type8.Optional(Type8.Number({ minimum: 0 })),
  tty: Type8.Optional(Type8.Boolean())
}, { $id: "ExecHostOptions", additionalProperties: false });
var ExecHostCallSchema = Type8.Object({
  ok: Type8.Literal(true),
  command: Type8.String({ minLength: 1 }),
  args: Type8.Array(Type8.String()),
  options: ExecHostOptionsSchema,
  sandboxed: Type8.Boolean(),
  escalated: Type8.Boolean()
}, { $id: "ExecHostCall", additionalProperties: false });
var WriteStdinHostOptionsSchema = Type8.Object({ yieldTimeMs: Type8.Optional(Type8.Number({ minimum: 0 })) }, { $id: "WriteStdinHostOptions", additionalProperties: false });
var WriteStdinHostResultSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("result"), result: ToolResultEnvelopeSchema }, { $id: "WriteStdinHostResult", additionalProperties: false });
var WriteStdinHostCallSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("call"),
  sessionId: Type8.Integer({ minimum: 1 }),
  chars: Type8.String(),
  options: WriteStdinHostOptionsSchema
}, { $id: "WriteStdinHostCall", additionalProperties: false });
var approvalFields = {
  approvalTitle: Type8.String({ minLength: 1 }),
  approvalPrompt: Type8.String({ minLength: 1 }),
  approvalTimeoutMs: Type8.Number({ minimum: 0 })
};
var PreparedReadSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("read"), path: Type8.String({ minLength: 1 }), offset: Type8.Optional(Type8.Integer()), limit: Type8.Optional(Type8.Integer({ minimum: 1 })) }, { $id: "PreparedRead", additionalProperties: false });
var PreparedViewMediaSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("view_media"), path: Type8.String({ minLength: 1 }) }, { $id: "PreparedViewMedia", additionalProperties: false });
var PreparedWriteStdinSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("write_stdin"), sessionId: Type8.Integer({ minimum: 1 }), chars: Type8.String(), yieldTimeMs: Type8.Optional(Type8.Number({ minimum: 0 })), maxOutputTokens: Type8.Optional(Type8.Integer({ minimum: 0 })), outputMode: Type8.Union([Type8.Literal("delta"), Type8.Literal("status")]) }, { $id: "PreparedWriteStdin", additionalProperties: false });
var PreparedExecSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("exec_command"),
  planId: Type8.String({ minLength: 1 }),
  cmd: Type8.String({ minLength: 1 }),
  workdir: Type8.String(),
  yieldTimeMs: Type8.Optional(Type8.Number({ minimum: 0 })),
  maxOutputTokens: Type8.Optional(Type8.Integer({ minimum: 0 })),
  tty: Type8.Boolean(),
  sandbox: SandboxConfigSchema,
  brokeredGit: Type8.Optional(Type8.Boolean())
}, { $id: "PreparedExec", additionalProperties: false });
var PreparedExecApprovalSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("exec_command_approval"),
  planId: Type8.String({ minLength: 1 }),
  cmd: Type8.String({ minLength: 1 }),
  workdir: Type8.String(),
  yieldTimeMs: Type8.Optional(Type8.Number({ minimum: 0 })),
  maxOutputTokens: Type8.Optional(Type8.Integer({ minimum: 0 })),
  tty: Type8.Boolean(),
  sandbox: SandboxConfigSchema,
  approvalMessage: Type8.String(),
  ...approvalFields,
  execPolicyAllowAlwaysTokens: Type8.Optional(Type8.Array(Type8.String({ minLength: 1 })))
}, { $id: "PreparedExecApproval", additionalProperties: false });
var PreparedExecInputSchema = Type8.Union([PreparedExecSchema, PreparedExecApprovalSchema], { $id: "PreparedExecInput" });
var mutationBase = {
  ok: Type8.Literal(true),
  workspaceRoots: Type8.Array(Type8.String({ minLength: 1 })),
  validateWorkspacePaths: Type8.Boolean(),
  path: Type8.String({ minLength: 1 }),
  displayPath: Type8.String({ minLength: 1 })
};
var WriteModeSchema = Type8.Union([Type8.Literal("overwrite"), Type8.Literal("append")]);
var PreparedWriteSchema = Type8.Object({ ...mutationBase, action: Type8.Literal("write"), contents: Type8.String(), mode: WriteModeSchema, filesystemApproval: Type8.Optional(Type8.Boolean()) }, { $id: "PreparedWrite", additionalProperties: false });
var PreparedWriteApprovalSchema = Type8.Object({ ...mutationBase, action: Type8.Literal("write_approval"), contents: Type8.String(), mode: WriteModeSchema, approvalAction: Type8.Literal("write"), ...approvalFields }, { $id: "PreparedWriteApproval", additionalProperties: false });
var PreparedEditSchema = Type8.Object({ ...mutationBase, action: Type8.Literal("edit"), edits: Type8.Array(EditReplacementSchema, { minItems: 1 }), filesystemApproval: Type8.Optional(Type8.Boolean()) }, { $id: "PreparedEdit", additionalProperties: false });
var PreparedEditApprovalSchema = Type8.Object({ ...mutationBase, action: Type8.Literal("edit_approval"), edits: Type8.Array(EditReplacementSchema, { minItems: 1 }), approvalAction: Type8.Literal("edit"), ...approvalFields }, { $id: "PreparedEditApproval", additionalProperties: false });
var authorizedPatchPaths = { authorizedPaths: Type8.Array(AuthorizedMutationPathSchema, { minItems: 1 }) };
var PreparedPatchSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("apply_patch"), workspaceRoots: Type8.Array(Type8.String({ minLength: 1 })), validateWorkspacePaths: Type8.Boolean(), affectedPaths: Type8.Array(Type8.String({ minLength: 1 })), ...authorizedPatchPaths, patch: Type8.String(), filesystemApproval: Type8.Optional(Type8.Boolean()) }, { $id: "PreparedPatch", additionalProperties: false });
var PreparedPatchApprovalSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("apply_patch_approval"), workspaceRoots: Type8.Array(Type8.String({ minLength: 1 })), validateWorkspacePaths: Type8.Boolean(), affectedPaths: Type8.Array(Type8.String({ minLength: 1 })), ...authorizedPatchPaths, patch: Type8.String(), approvalAction: Type8.Literal("apply_patch"), ...approvalFields }, { $id: "PreparedPatchApproval", additionalProperties: false });
var PreparedThreadQuerySchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("query_threads"), query: Type8.String({ minLength: 1, maxLength: 500 }), limit: Type8.Integer({ minimum: 1, maximum: 50 }), scope: Type8.Union([Type8.Literal("current_workspace"), Type8.Literal("all")]), includeTools: Type8.Boolean() }, { $id: "PreparedThreadQuery", additionalProperties: false });
var PreparedThreadLocatorSchema = Type8.Object({
  threadID: Type8.String({ minLength: 1 }),
  sourcePath: Type8.Optional(Type8.String({ minLength: 1 })),
  entryID: Type8.Optional(Type8.String({ minLength: 1 })),
  line: Type8.Optional(Type8.Integer({ minimum: 1 }))
}, { $id: "PreparedThreadLocator", additionalProperties: false });
var PreparedThreadReadSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("read_thread"),
  threadID: Type8.String({ minLength: 1 }),
  mode: Type8.Union([Type8.Literal("overview"), Type8.Literal("window"), Type8.Literal("full")]),
  around: Type8.Integer({ minimum: 0, maximum: 10 }),
  entryID: Type8.Optional(Type8.String({ minLength: 1 })),
  line: Type8.Optional(Type8.Integer({ minimum: 1 })),
  cursor: Type8.Optional(Type8.String({ minLength: 1 })),
  locator: Type8.Optional(PreparedThreadLocatorSchema)
}, { $id: "PreparedThreadRead", additionalProperties: false });
var PreparedExaSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("exa_fetch"), planId: Type8.String({ minLength: 1 }), toolName: Type8.String({ minLength: 1 }) }, { $id: "PreparedExa", additionalProperties: false });
var PreparedExaApprovalSchema = Type8.Object({ ok: Type8.Literal(true), action: Type8.Literal("exa_agent_create_run_approval"), planId: Type8.String({ minLength: 1 }), toolName: Type8.String({ minLength: 1 }), ...approvalFields }, { $id: "PreparedExaApproval", additionalProperties: false });
var AgentKindSchema = Type8.Union([
  Type8.Literal("generic"),
  Type8.Literal("finder"),
  Type8.Literal("oracle")
]);
var AgentRunStatusSchema = Type8.Union([
  Type8.Literal("running"),
  Type8.Literal("suspended"),
  Type8.Literal("completed"),
  Type8.Literal("failed"),
  Type8.Literal("cancelled"),
  Type8.Literal("lost")
]);
var AgentSendOutcomeSchema = Type8.Union([
  Type8.Literal("message_sent"),
  Type8.Literal("interrupted_and_sent"),
  Type8.Literal("suspended"),
  Type8.Literal("already_suspended"),
  Type8.Literal("resumed"),
  Type8.Literal("started"),
  Type8.Literal("no_active_run")
]);
var AgentReasonCodeSchema = Type8.Union([
  Type8.Literal("interrupted_by_parent"),
  Type8.Literal("parent_shutdown"),
  Type8.Literal("process_interrupted"),
  Type8.Literal("close_cleanup_failed"),
  Type8.Literal("host_cancelled"),
  Type8.Literal("dispatch_failed"),
  Type8.Literal("agent_failed"),
  Type8.Literal("internal_error"),
  Type8.Literal("child_session_lost")
]);
var AgentSuspensionReasonCodeSchema = Type8.Union([
  Type8.Literal("interrupted_by_parent"),
  Type8.Literal("parent_shutdown"),
  Type8.Literal("process_interrupted"),
  Type8.Literal("close_cleanup_failed")
]);
var AgentStartDetailsSchema = Type8.Object({
  ok: Type8.Literal(true),
  runId: Type8.String({ minLength: 1 }),
  kind: AgentKindSchema,
  model: Type8.String({ minLength: 1 }),
  thinking: Type8.String({ minLength: 1 }),
  status: Type8.Literal("running"),
  prompt: Type8.String(),
  agentId: Type8.String({ minLength: 1 }),
  activeTools: Type8.Array(Type8.String({ minLength: 1 })),
  workspace: Type8.String({ minLength: 1 }),
  isolation: Type8.Union([Type8.Literal("none"), Type8.Literal("worktree")]),
  tier: Type8.Optional(Type8.Union([Type8.Literal("low"), Type8.Literal("medium"), Type8.Literal("high")]))
}, { $id: "AgentStartDetails", additionalProperties: false });
var AgentSendDetailsSchema = Type8.Object({
  agentId: Type8.String({ minLength: 1 }),
  outcome: AgentSendOutcomeSchema,
  runId: Type8.Optional(Type8.String({ minLength: 1 })),
  status: Type8.Optional(AgentRunStatusSchema),
  submissionId: Type8.Optional(Type8.String({ minLength: 1 }))
}, { $id: "AgentSendDetails", additionalProperties: false });
var AgentWaitUnusedResultSchema = Type8.Object({ unused: Type8.Literal(true) }, { additionalProperties: false });
var AgentWaitDetailsSchema = Type8.Object({
  ok: Type8.Literal(true),
  timedOut: Type8.Literal(false),
  results: Type8.Array(AgentWaitUnusedResultSchema, { maxItems: 0 }),
  pendingRunIds: Type8.Array(Type8.String({ minLength: 1 }), { minItems: 1 }),
  timeoutSeconds: Type8.Optional(Type8.Number({ minimum: 0 }))
}, { $id: "AgentWaitDetails", additionalProperties: false });
var AgentCloseDetailsSchema = Type8.Object({
  agentId: Type8.String({ minLength: 1 }),
  status: Type8.Literal("closed")
}, { $id: "AgentCloseDetails", additionalProperties: false });
var RecordAgentChildSessionStartFactsSchema = Type8.Object({
  agent_id: Type8.String({ minLength: 1 }),
  sessionId: Type8.Optional(Type8.String({ minLength: 1 })),
  sessionFile: Type8.Optional(Type8.String({ minLength: 1 }))
}, { $id: "RecordAgentChildSessionStartFacts", additionalProperties: false });
var RollbackUnacceptedAgentStartFactsSchema = Type8.Object({
  agent_id: Type8.String({ minLength: 1 }),
  run_id: Type8.String({ minLength: 1 }),
  submission_id: Type8.String({ minLength: 1 })
}, { $id: "RollbackUnacceptedAgentStartFacts", additionalProperties: false });
var RollbackAgentSendPreflightFactsSchema = Type8.Object({
  agent_id: Type8.String({ minLength: 1 }),
  run_id: Type8.String({ minLength: 1 }),
  submission_id: Type8.String({ minLength: 1 }),
  previous_submission_id: Type8.String(),
  outcome: AgentSendOutcomeSchema,
  previous_reason_code: Type8.Optional(AgentSuspensionReasonCodeSchema)
}, { $id: "RollbackAgentSendPreflightFacts", additionalProperties: false });
var RecordAgentSendDispatchFailureFactsSchema = Type8.Object({
  run_id: Type8.String({ minLength: 1 }),
  submission_id: Type8.Optional(Type8.String({ minLength: 1 })),
  error: Type8.Optional(Type8.String())
}, { $id: "RecordAgentSendDispatchFailureFacts", additionalProperties: false });
var RollbackFailedAgentInterruptionFactsSchema = Type8.Object({
  agent_id: Type8.String({ minLength: 1 }),
  run_id: Type8.String({ minLength: 1 })
}, { $id: "RollbackFailedAgentInterruptionFacts", additionalProperties: false });
var AgentDispatchCompletionSchema = Type8.Object({
  status: Type8.Union([Type8.Literal("completed"), Type8.Literal("failed"), Type8.Literal("cancelled"), Type8.Literal("timed_out")]),
  finalOutput: Type8.Optional(Type8.String()),
  resultEntryId: Type8.Optional(Type8.String({ minLength: 1 })),
  reason: Type8.Optional(Type8.String())
}, { $id: "AgentDispatchCompletion", additionalProperties: false });
var AgentDispatchCompletionFactsSchema = Type8.Object({
  run_id: Type8.String({ minLength: 1 }),
  submission_id: Type8.Optional(Type8.String({ minLength: 1 })),
  completion: AgentDispatchCompletionSchema
}, { $id: "AgentDispatchCompletionFacts", additionalProperties: false });
var AgentActivityFactsSchema = Type8.Object({
  run_id: Type8.String({ minLength: 1 }),
  submission_id: Type8.String({ minLength: 1 }),
  event: Type8.Union([
    Type8.Literal("agent_start"),
    Type8.Literal("turn_start"),
    Type8.Literal("turn_end"),
    Type8.Literal("tool_execution_start"),
    Type8.Literal("tool_execution_update"),
    Type8.Literal("tool_execution_end")
  ])
}, { $id: "AgentActivityFacts", additionalProperties: false });
var AgentDispatchBoundaryFactsSchema = Type8.Object({
  run_id: Type8.String({ minLength: 1 }),
  submission_id: Type8.String({ minLength: 1 }),
  previous_assistant_entry_id: Type8.Optional(Type8.String({ minLength: 1 }))
}, { $id: "AgentDispatchBoundaryFacts", additionalProperties: false });
var LiveAgentDispatchesFactsSchema = Type8.Object({
  live_agent_ids: Type8.Array(Type8.String({ minLength: 1 }))
}, { $id: "LiveAgentDispatchesFacts", additionalProperties: false });
var AgentRunIdFactsSchema = Type8.Object({ run_id: Type8.String({ minLength: 1 }) }, { $id: "AgentRunIdFacts", additionalProperties: false });
var FinishAgentWaitFactsSchema = Type8.Object({
  run_ids: Type8.Array(Type8.String({ minLength: 1 }), { minItems: 1 })
}, { $id: "FinishAgentWaitFacts", additionalProperties: false });
var AgentIdFactsSchema = Type8.Object({ agent_id: Type8.String({ minLength: 1 }) }, { $id: "AgentIdFacts", additionalProperties: false });
var CronPromptSelectionSchema = Type8.Union([
  Type8.Object({ status: Type8.Literal("cancelled") }, { additionalProperties: false }),
  Type8.Object({ status: Type8.Literal("selected"), selected: Type8.String({ minLength: 1 }) }, { additionalProperties: false })
], { $id: "CronPromptSelection" });
var HostToolResultFactsSchema = Type8.Object({ action: Type8.String({ pattern: "^(write_stdin|apply_patch|write|edit)$" }), details: Type8.Unknown() }, { $id: "HostToolResultFacts", additionalProperties: false });
var PreparedTextResultInputSchema = Type8.Object({ text: Type8.String(), details: Type8.Unknown() });
var ToolResultConstructionFactsSchema = Type8.Object({ prepared: Type8.Optional(PreparedTextResultInputSchema), extraDetails: Type8.Optional(Type8.Unknown()), error: Type8.Optional(Type8.String()), text: Type8.Optional(Type8.String()), details: Type8.Optional(Type8.Unknown()) }, { $id: "ToolResultConstructionFacts", additionalProperties: false });
var AgentNotificationDetailsSchema = Type8.Object({ notificationId: Type8.String({ pattern: "^agent_completion:.+" }) }, { $id: "AgentNotificationDetails", additionalProperties: false });
var PreparedAgentStartSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("agent_start"),
  text: Type8.String(),
  details: AgentStartDetailsSchema,
  prompt: Type8.String(),
  agentId: Type8.String({ minLength: 1 }),
  runId: Type8.String({ minLength: 1 }),
  submissionId: Type8.String({ minLength: 1 }),
  capabilityId: Type8.String({ minLength: 1 }),
  metadata: AgentSessionMetadataSchema
}, { $id: "PreparedAgentStart", additionalProperties: false });
var PreparedAgentSendSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("agent_send"),
  text: Type8.String(),
  details: AgentSendDetailsSchema,
  prompt: Type8.String(),
  agentId: Type8.String({ minLength: 1 }),
  dispatch: Type8.Boolean(),
  interrupt: Type8.Boolean(),
  dispatchDeliverAs: Type8.Union([Type8.Literal("steer"), Type8.Literal("followUp")]),
  runId: Type8.Optional(Type8.String({ minLength: 1 })),
  submissionId: Type8.Optional(Type8.String({ minLength: 1 })),
  previousSubmissionId: Type8.Optional(Type8.String({ minLength: 1 })),
  previousReasonCode: Type8.Optional(AgentSuspensionReasonCodeSchema),
  outcome: AgentSendOutcomeSchema,
  capabilityId: Type8.String({ minLength: 1 }),
  metadata: AgentSessionMetadataSchema
}, { $id: "PreparedAgentSend", additionalProperties: false });
var PreparedAgentWaitSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("agent_wait"),
  text: Type8.String(),
  details: AgentWaitDetailsSchema,
  runIds: Type8.Array(Type8.String({ minLength: 1 }), { minItems: 1 }),
  timeoutSeconds: Type8.Optional(Type8.Number({ minimum: 0 }))
}, { $id: "PreparedAgentWait", additionalProperties: false });
var PreparedAgentCloseSchema = Type8.Object({
  ok: Type8.Literal(true),
  action: Type8.Literal("agent_close"),
  text: Type8.String(),
  details: AgentCloseDetailsSchema,
  agentId: Type8.String({ minLength: 1 }),
  runIds: Type8.Array(Type8.String({ minLength: 1 })),
  deleteWorktree: Type8.Optional(Type8.Boolean()),
  worktreePath: Type8.Optional(Type8.String()),
  worktreeBranch: Type8.Optional(Type8.String()),
  mainRepositoryRoot: Type8.Optional(Type8.String()),
  isolation: Type8.Optional(Type8.Union([Type8.Literal("none"), Type8.Literal("worktree")])),
  capabilityId: Type8.String({ minLength: 1 })
}, { $id: "PreparedAgentClose", additionalProperties: false });
var AgentRoutingDiagnosticsResultSchema = Type8.Object({ diagnostics: Type8.Array(Type8.String()) }, { $id: "AgentRoutingDiagnosticsResult", additionalProperties: false });
var AgentNotificationSchema = Type8.Object({
  runId: Type8.String({ minLength: 1 }),
  customType: Type8.Literal("notification"),
  content: Type8.String({ minLength: 1 }),
  display: Type8.Literal(true),
  details: AgentNotificationDetailsSchema
}, { $id: "AgentNotification", additionalProperties: false });
var PendingAgentNotificationsResultSchema = Type8.Object({ notifications: Type8.Array(AgentNotificationSchema) }, { $id: "PendingAgentNotificationsResult", additionalProperties: false });
var AgentNotificationClaimValidationSchema = Type8.Object({ valid: Type8.Boolean() }, { $id: "AgentNotificationClaimValidation", additionalProperties: false });
var AgentActiveCountResultSchema = Type8.Object({ count: Type8.Integer({ minimum: 0 }) }, { $id: "AgentActiveCountResult", additionalProperties: false });
var AgentCleanupItemSchema = Type8.Object({ agentId: Type8.String({ minLength: 1 }) }, { $id: "AgentCleanupItem", additionalProperties: false });
var AgentCleanupPlanSchema = Type8.Object({ agents: Type8.Array(AgentCleanupItemSchema) }, { $id: "AgentCleanupPlan", additionalProperties: false });
var AgentManagerIdentitySchema = Type8.Object({
  agentId: Type8.String({ minLength: 1 }),
  kind: AgentKindSchema,
  model: Type8.String({ minLength: 1 }),
  thinking: Type8.String({ minLength: 1 }),
  workspace: Type8.String({ minLength: 1 }),
  isolation: Type8.Optional(Type8.Union([Type8.Literal("none"), Type8.Literal("worktree")])),
  effectiveWorkspace: Type8.Optional(Type8.String({ minLength: 1 })),
  tier: Type8.Optional(Type8.Union([Type8.Literal("low"), Type8.Literal("medium"), Type8.Literal("high")])),
  createdAt: Type8.Integer(),
  childSessionFile: Type8.Optional(Type8.String({ minLength: 1 }))
}, { $id: "AgentManagerIdentity", additionalProperties: false });
var AgentManagerRunSchema = Type8.Object({
  runId: Type8.String({ minLength: 1 }),
  agentId: Type8.String({ minLength: 1 }),
  status: AgentRunStatusSchema,
  reasonCode: Type8.Optional(AgentReasonCodeSchema),
  startedAt: Type8.Integer(),
  endedAt: Type8.Optional(Type8.Integer()),
  suspendedAt: Type8.Optional(Type8.Integer()),
  description: Type8.String(),
  turnCount: Type8.Integer({ minimum: 0 }),
  lastActivityAt: Type8.Optional(Type8.Integer()),
  activityState: Type8.Union([
    Type8.Literal("starting"),
    Type8.Literal("reasoning"),
    Type8.Literal("using_tool"),
    Type8.Literal("orphaned"),
    Type8.Literal("inactive")
  ]),
  recommendation: Type8.Union([
    Type8.Literal("wait"),
    Type8.Literal("interrupt_or_close"),
    Type8.Literal("call_agent_wait"),
    Type8.Literal("resume_or_close")
  ]),
  submissionId: Type8.String({ minLength: 1 }),
  error: Type8.Optional(Type8.String()),
  announcement: Type8.Union([
    Type8.Literal("pending"),
    Type8.Literal("observed_by_agent_wait"),
    Type8.Literal("notification_sent")
  ])
}, { $id: "AgentManagerRun", additionalProperties: false });
var AgentManagerSnapshotSchema = Type8.Object({
  agents: Type8.Array(AgentManagerIdentitySchema),
  runs: Type8.Array(AgentManagerRunSchema)
}, { $id: "AgentManagerSnapshot", additionalProperties: false });
var AgentWorktreeLineDeltaReadySchema = Type8.Object({
  kind: Type8.Literal("ready"),
  added: Type8.Integer({ minimum: 0 }),
  removed: Type8.Integer({ minimum: 0 })
}, { $id: "AgentWorktreeLineDeltaReady", additionalProperties: false });
var AgentWorktreeLineDeltaUnavailableSchema = Type8.Object({ kind: Type8.Literal("unavailable") }, { $id: "AgentWorktreeLineDeltaUnavailable", additionalProperties: false });
var AgentWorktreeLineDeltaUpdateSchema = Type8.Union([AgentWorktreeLineDeltaReadySchema, AgentWorktreeLineDeltaUnavailableSchema], { $id: "AgentWorktreeLineDeltaUpdate" });
var AgentChildSessionUpdateSchema = Type8.Object({
  action: Type8.Union([
    Type8.Literal("stop_child_session"),
    Type8.Literal("delete_child_session")
  ]),
  key: Type8.String({ minLength: 1 }),
  reason: Type8.String({ minLength: 1 })
}, { $id: "AgentChildSessionUpdate", additionalProperties: false });
var ProcessManagerEntrySchema = Type8.Object({
  sessionId: Type8.Integer({ minimum: 0 }),
  command: Type8.String(),
  runState: Type8.Union([Type8.Literal("running"), Type8.Literal("exited")]),
  exitCode: Type8.Optional(Type8.Integer()),
  ageSeconds: Type8.Integer({ minimum: 0 }),
  retained: Type8.Boolean()
}, { $id: "ProcessManagerEntry", additionalProperties: false });
var ProcessManagerSnapshotSchema = Type8.Object({ sessions: Type8.Array(ProcessManagerEntrySchema) }, { $id: "ProcessManagerSnapshot", additionalProperties: false });
var ProcessManagerOutputSchema = Type8.Object({ available: Type8.Boolean(), text: Type8.String() }, { $id: "ProcessManagerOutput", additionalProperties: false });
var ProcessManagerOwnerFactsSchema = Type8.Object({ ownerId: Type8.String({ minLength: 1 }) }, { $id: "ProcessManagerOwnerFacts", additionalProperties: false });
var ProcessManagerSessionFactsSchema = Type8.Object({
  ownerId: Type8.String({ minLength: 1 }),
  sessionId: Type8.Integer({ minimum: 0 })
}, { $id: "ProcessManagerSessionFacts", additionalProperties: false });
var PreparedToolActionSchema = Type8.Union([
  GatewayCommandErrorSchema,
  BridgeToolResultSchema,
  OpenAiUsageFetchSchema,
  UsagePairFetchSchema,
  PreparedReadSchema,
  PreparedViewMediaSchema,
  PreparedWriteStdinSchema,
  PreparedExecSchema,
  PreparedExecApprovalSchema,
  PreparedWriteSchema,
  PreparedWriteApprovalSchema,
  PreparedEditSchema,
  PreparedEditApprovalSchema,
  PreparedPatchSchema,
  PreparedPatchApprovalSchema,
  PreparedThreadQuerySchema,
  PreparedThreadReadSchema,
  PreparedExaSchema,
  PreparedExaApprovalSchema,
  PreparedAgentStartSchema,
  PreparedAgentSendSchema,
  PreparedAgentWaitSchema,
  PreparedAgentCloseSchema
]);
// src/bridge-decoders.ts
import { Compile as Compile2 } from "typebox/compile";
var activeToolsPlanDecoder = Compile2(ActiveToolsPlanSchema);
var commandSpecsResultDecoder = Compile2(CommandSpecsResultSchema);
var toolNamesResultDecoder = Compile2(ToolNamesResultSchema);
var threadCatalogScansResultDecoder = Compile2(ThreadCatalogScansResultSchema);
var pendingExecNotificationsResultDecoder = Compile2(PendingExecNotificationsResultSchema);
var processManagerSnapshotDecoder = Compile2(ProcessManagerSnapshotSchema);
var processManagerOutputDecoder = Compile2(ProcessManagerOutputSchema);
var execNotificationClaimDecoder = Compile2(ExecNotificationClaimSchema);
var openAiUsageHostAuthDecoder = Compile2(OpenAiUsageHostAuthSchema);
var kimiUsageHostAuthDecoder = Compile2(KimiUsageHostAuthSchema);
var openAiUsageHostParamsDecoder = Compile2(OpenAiUsageHostParamsSchema);
var kimiUsageHostParamsDecoder = Compile2(KimiUsageHostParamsSchema);
var usagePairHostParamsDecoder = Compile2(UsagePairHostParamsSchema);
var refreshExecPolicyResultDecoder = Compile2(RefreshExecPolicyResultSchema);
var skillListResultDecoder = Compile2(SkillListResultSchema);
var skillResolveResultDecoder = Compile2(SkillResolveResultSchema);
var environmentContextPlanDecoder = Compile2(EnvironmentContextPlanSchema);
var commandNotificationPlanDecoder = Compile2(CommandNotificationPlanSchema);
var planContinuationPlanDecoder = Compile2(PlanContinuationPlanSchema);
var childSessionStartPlanDecoder = Compile2(ChildSessionStartPlanSchema);
var childPermissionRefreshPlanDecoder = Compile2(ChildPermissionRefreshPlanSchema);
var sessionCustomEntryDecoder = Compile2(TaumelPersistedCustomEntrySchema);
var childSessionMetadataDecoder = Compile2(ChildSessionMetadataSchema);
var childDispatchPlanDecoder = Compile2(ChildDispatchPlanSchema);
var workspaceMutationValidationDecoder = Compile2(WorkspaceMutationValidationSchema);
var execPolicyAllowRuleResultDecoder = Compile2(ExecPolicyAllowRuleResultSchema);
var execApprovalPromptPlanDecoder = Compile2(ExecApprovalPromptPlanSchema);
var commandExecutionPlanDecoder = Compile2(CommandExecutionPlanSchema);
var commandChildSessionPlanDecoder = Compile2(CommandChildSessionPlanSchema);
var bridgeToolResultDecoder = Compile2(BridgeToolResultSchema);
var bridgeToolExecutionResultDecoder = Compile2(BridgeToolExecutionResultSchema);
var toolResultEnvelopeDecoder = Compile2(ToolResultEnvelopeSchema);
var bridgeCommandResultDecoder = Compile2(BridgeCommandResultSchema);
var viewMediaResultEnvelopeDecoder = Compile2(ViewMediaResultEnvelopeSchema);
var execToolResultDecoder = Compile2(ExecToolResultSchema);
var execApprovalResultDecoder = Compile2(ExecApprovalResultSchema);
var authorityPlanIssuedDecoder = Compile2(AuthorityPlanIssuedSchema);
var commandChildDispatchPlanDecoder = Compile2(CommandChildDispatchPlanSchema);
var cronPlanFactsDecoder = Compile2(CronPlanFactsSchema);
var cronPollPlanDecoder = Compile2(CronPollPlanSchema);
var cronDeliveredResultDecoder = Compile2(CronDeliveredResultSchema);
var cronStartupPlanDecoder = Compile2(CronStartupPlanSchema);
var planRollbackResultDecoder = Compile2(PlanRollbackResultSchema);
var editApplicationResultDecoder = Compile2(EditApplicationResultSchema);
var patchApplicationResultDecoder = Compile2(PatchApplicationResultSchema);
var visibilityWarningsResultDecoder = Compile2(VisibilityWarningsResultSchema);
var visibilityRowsResultDecoder = Compile2(VisibilityRowsResultSchema);
var visibilityToggleResultDecoder = Compile2(VisibilityToggleResultSchema);
var visibilitySavePlanDecoder = Compile2(VisibilitySavePlanSchema);
var visibilityListResultDecoder = Compile2(VisibilityListResultSchema);
var compactionCommandPlanDecoder = Compile2(CompactionCommandPlanSchema);
var compactionSessionPlanDecoder = Compile2(CompactionSessionPlanSchema);
var permissionsPromptPlanDecoder = Compile2(PermissionsPromptPlanSchema);
var permissionsPromptDecoder = Compile2(PermissionsPromptSchema);
var permissionsCommandResultDecoder = Compile2(PermissionsCommandResultSchema);
var cronListResultDecoder = Compile2(CronListResultSchema);
var cronCommandResultDecoder = Compile2(CronCommandResultSchema);
var cronPromptDecoder = Compile2(CronPromptSchema);
var cronPromptPlanDecoder = Compile2(CronPromptPlanSchema);
var composerCommandResultDecoder = Compile2(ComposerCommandResultSchema);
var cronPlanCreationResultDecoder = Compile2(CronPlanCreationResultSchema);
var gatewayCommandOutputDecoder = Compile2(GatewayCommandOutputSchema);
var preparedToolActionDecoder = Compile2(PreparedToolActionSchema);
var coreAckDecoder = Compile2(CoreAckSchema);
var bridgeErrorResultDecoder = Compile2(BridgeErrorResultSchema);
var agentRoutingDiagnosticsResultDecoder = Compile2(AgentRoutingDiagnosticsResultSchema);
var pendingAgentNotificationsResultDecoder = Compile2(PendingAgentNotificationsResultSchema);
var agentNotificationClaimValidationDecoder = Compile2(AgentNotificationClaimValidationSchema);
var agentActiveCountResultDecoder = Compile2(AgentActiveCountResultSchema);
var agentCleanupPlanDecoder = Compile2(AgentCleanupPlanSchema);
var agentManagerSnapshotDecoder = Compile2(AgentManagerSnapshotSchema);
var agentWorktreeLineDeltaUpdateDecoder = Compile2(AgentWorktreeLineDeltaUpdateSchema);
function decodeActiveToolsPlan(value) {
  try {
    return activeToolsPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml active-tools plan response");
  }
}
function decodeCommandSpecsResult(value) {
  try {
    return commandSpecsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command-specs response");
  }
}
function decodeToolNamesResult(value) {
  try {
    return toolNamesResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml tool-names response");
  }
}
function decodeThreadCatalogScansResult(value) {
  try {
    return threadCatalogScansResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml thread-catalog scans response");
  }
}
function decodePendingExecNotificationsResult(value) {
  try {
    return pendingExecNotificationsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml pending-exec-notifications response");
  }
}
function decodeProcessManagerSnapshot(value) {
  try {
    return processManagerSnapshotDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml process-manager snapshot response");
  }
}
function decodeProcessManagerOutput(value) {
  try {
    return processManagerOutputDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml process-manager output response");
  }
}
function decodeExecNotificationClaim(value) {
  try {
    return execNotificationClaimDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml exec-notification claim response");
  }
}
function decodeOpenAiUsageHostAuth(value) {
  try {
    return openAiUsageHostAuthDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml OpenAI usage host-auth response");
  }
}
function decodeKimiUsageHostAuth(value) {
  try {
    return kimiUsageHostAuthDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml Kimi usage host-auth response");
  }
}
function decodeOpenAiUsageHostParams(value) {
  try {
    return openAiUsageHostParamsDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml OpenAI usage host-params response");
  }
}
function decodeKimiUsageHostParams(value) {
  try {
    return kimiUsageHostParamsDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml Kimi usage host-params response");
  }
}
function decodeRefreshExecPolicyResult(value) {
  try {
    return refreshExecPolicyResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml refresh-exec-policy response");
  }
}
function decodeSkillListResult(value) {
  try {
    return skillListResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml skill-list response");
  }
}
function decodeSkillResolveResult(value) {
  try {
    return skillResolveResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml skill-resolve response");
  }
}
function decodeEnvironmentContextPlan(value) {
  try {
    return environmentContextPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml environment-context plan response");
  }
}
function decodeCommandNotificationPlan(value) {
  try {
    return commandNotificationPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command-notification plan response");
  }
}
function decodePlanContinuationPlan(value) {
  try {
    return planContinuationPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml plan-continuation plan response");
  }
}
function decodeChildSessionStartPlan(value) {
  try {
    return childSessionStartPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml child-session start plan response");
  }
}
function decodeChildPermissionRefreshPlan(value) {
  try {
    return childPermissionRefreshPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml child-permission refresh plan response");
  }
}
function decodeSessionCustomEntry(value) {
  try {
    const entry = sessionCustomEntryDecoder.Decode(value);
    if (entry.customType === "taumel.cron") {
      const ids = new Set;
      for (const task of entry.data.tasks) {
        if (ids.has(task.id))
          throw new Error("duplicate cron task id");
        ids.add(task.id);
        if (task.nextDue <= task.createdAt)
          throw new Error("invalid cron timestamps");
        if (task.pendingSince !== undefined && task.pendingSince !== task.nextDue) {
          throw new Error("invalid pending cron timestamp");
        }
      }
    }
    return entry;
  } catch {
    throw new Error("Invalid Taumel custom session entry");
  }
}
function decodeChildSessionMetadata(value) {
  try {
    return childSessionMetadataDecoder.Decode(value);
  } catch {
    throw new Error("Invalid child-session metadata");
  }
}
function decodeChildDispatchPlan(value) {
  try {
    return childDispatchPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml child-dispatch plan response");
  }
}
function decodeWorkspaceMutationValidation(value) {
  try {
    return workspaceMutationValidationDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml workspace-mutation validation response");
  }
}
function decodeExecPolicyAllowRuleResult(value) {
  try {
    return execPolicyAllowRuleResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml exec-policy amendment response");
  }
}
function decodeExecApprovalPromptPlan(value) {
  try {
    return execApprovalPromptPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml exec-approval prompt plan response");
  }
}
function decodeCommandExecutionPlan(value) {
  try {
    return commandExecutionPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command-execution plan response");
  }
}
function decodeCommandChildSessionPlan(value) {
  try {
    return commandChildSessionPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command child-session plan response");
  }
}
function decodeBridgeToolResult(value) {
  try {
    return bridgeToolResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml tool-result response");
  }
}
function decodeBridgeToolExecutionResult(value) {
  try {
    return bridgeToolExecutionResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml tool-execution response");
  }
}
function decodeToolResultEnvelope(value) {
  try {
    return toolResultEnvelopeDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml tool-result envelope response");
  }
}
function decodeBridgeCommandResult(value) {
  try {
    return bridgeCommandResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command-result response");
  }
}
function decodeViewMediaResultEnvelope(value) {
  try {
    return viewMediaResultEnvelopeDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml view-media response");
  }
}
function decodeExecToolResult(value) {
  try {
    return execToolResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml exec result response");
  }
}
function decodeExecApprovalResult(value) {
  try {
    return execApprovalResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml exec-approval result response");
  }
}
function decodeCommandChildDispatchPlan(value) {
  try {
    return commandChildDispatchPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml command child-dispatch plan response");
  }
}
function decodeCronPlanFacts(value) {
  try {
    return cronPlanFactsDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron plan-facts response");
  }
}
function decodeCronPollPlan(value) {
  try {
    return cronPollPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron-poll response");
  }
}
function decodeCronDeliveredResult(value) {
  try {
    return cronDeliveredResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron-delivered response");
  }
}
function decodeCronStartupPlan(value) {
  try {
    return cronStartupPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron-startup response");
  }
}
function decodePlanRollbackResult(value) {
  try {
    return planRollbackResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml plan-rollback response");
  }
}
function decodeEditApplicationResult(value) {
  try {
    return editApplicationResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml edit-application response");
  }
}
function decodePatchApplicationResult(value) {
  try {
    return patchApplicationResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml patch-application response");
  }
}
function decodeVisibilityWarningsResult(value) {
  try {
    return visibilityWarningsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml visibility-warnings response");
  }
}
function decodeVisibilityRowsResult(value) {
  try {
    return visibilityRowsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml visibility-rows response");
  }
}
function decodeVisibilityToggleResult(value) {
  try {
    return visibilityToggleResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml visibility-toggle response");
  }
}
function decodeVisibilitySavePlan(value) {
  try {
    return visibilitySavePlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml visibility-save plan response");
  }
}
function decodeVisibilityListResult(value) {
  try {
    return visibilityListResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml visibility-list response");
  }
}
function decodeCompactionCommandPlan(value) {
  try {
    return compactionCommandPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml compaction command plan response");
  }
}
function decodeCompactionSessionPlan(value) {
  try {
    return compactionSessionPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml compaction session plan response");
  }
}
function decodePermissionsPromptPlan(value) {
  try {
    return permissionsPromptPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml permissions prompt plan response");
  }
}
function decodePermissionsPrompt(value) {
  try {
    return permissionsPromptDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml permissions prompt");
  }
}
function decodePermissionsCommandResult(value) {
  try {
    return permissionsCommandResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml permissions command response");
  }
}
function decodeCronListResult(value) {
  try {
    return cronListResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron-list response");
  }
}
function decodeCronCommandResult(value) {
  try {
    return cronCommandResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron command response");
  }
}
function decodeCronPrompt(value) {
  try {
    return cronPromptDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron prompt");
  }
}
function decodeCronPromptPlan(value) {
  try {
    return cronPromptPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron prompt plan response");
  }
}
function decodeComposerCommandResult(value) {
  try {
    return composerCommandResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml composer command response");
  }
}
function decodeCronPlanCreationResult(value) {
  try {
    return cronPlanCreationResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml cron plan-creation response");
  }
}
function decodeGatewayCommandOutput(value) {
  try {
    return gatewayCommandOutputDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml gateway command response");
  }
}
function decodePreparedToolAction(value) {
  try {
    return preparedToolActionDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml prepared tool action");
  }
}
function decodeCoreAck(value) {
  try {
    return coreAckDecoder.Decode(value);
  } catch {
    let failure;
    try {
      failure = bridgeErrorResultDecoder.Decode(value);
    } catch {
      throw new Error("Invalid OCaml acknowledgement");
    }
    throw new Error(failure.error);
  }
}
function decodeAuthorityPlanIssued(value) {
  try {
    return authorityPlanIssuedDecoder.Decode(value);
  } catch {
    throw new Error("Invalid OCaml authority plan response");
  }
}
function decodeAgentRoutingDiagnosticsResult(value) {
  try {
    return agentRoutingDiagnosticsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid agent routing diagnostics result");
  }
}
function decodePendingAgentNotificationsResult(value) {
  try {
    return pendingAgentNotificationsResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid pending agent notifications result");
  }
}
function decodeAgentNotificationClaimValidation(value) {
  try {
    return agentNotificationClaimValidationDecoder.Decode(value);
  } catch {
    throw new Error("Invalid agent notification claim validation");
  }
}
function decodeAgentActiveCountResult(value) {
  try {
    return agentActiveCountResultDecoder.Decode(value);
  } catch {
    throw new Error("Invalid agent active count result");
  }
}
function decodeAgentCleanupPlan(value) {
  try {
    return agentCleanupPlanDecoder.Decode(value);
  } catch {
    throw new Error("Invalid agent cleanup plan");
  }
}
function decodeAgentManagerSnapshot(value) {
  try {
    return agentManagerSnapshotDecoder.Decode(value);
  } catch {
    throw new Error("Invalid agent manager snapshot");
  }
}
function decodeAgentWorktreeLineDeltaUpdate(value) {
  try {
    return agentWorktreeLineDeltaUpdateDecoder.Decode(value);
  } catch {
    throw new Error("Invalid agent worktree line-delta update");
  }
}
// src/bridge-contract-catalog.ts
var schemas = { ...exports_bridge_core_contracts, ...exports_bridge_action_contracts };
var bridgeDtsSchemas = [
  ["AgentStartDetails", schemas.AgentStartDetailsSchema],
  ["AgentSendDetails", schemas.AgentSendDetailsSchema],
  ["AgentWaitDetails", schemas.AgentWaitDetailsSchema],
  ["AgentCloseDetails", schemas.AgentCloseDetailsSchema],
  ["RecordAgentChildSessionStartFacts", schemas.RecordAgentChildSessionStartFactsSchema],
  ["RollbackUnacceptedAgentStartFacts", schemas.RollbackUnacceptedAgentStartFactsSchema],
  ["RollbackAgentSendPreflightFacts", schemas.RollbackAgentSendPreflightFactsSchema],
  ["RecordAgentSendDispatchFailureFacts", schemas.RecordAgentSendDispatchFailureFactsSchema],
  ["RollbackFailedAgentInterruptionFacts", schemas.RollbackFailedAgentInterruptionFactsSchema],
  ["AgentDispatchCompletion", schemas.AgentDispatchCompletionSchema],
  ["AgentDispatchCompletionFacts", schemas.AgentDispatchCompletionFactsSchema],
  ["AgentActivityFacts", schemas.AgentActivityFactsSchema],
  ["AgentDispatchBoundaryFacts", schemas.AgentDispatchBoundaryFactsSchema],
  ["LiveAgentDispatchesFacts", schemas.LiveAgentDispatchesFactsSchema],
  ["AgentRunIdFacts", schemas.AgentRunIdFactsSchema],
  ["FinishAgentWaitFacts", schemas.FinishAgentWaitFactsSchema],
  ["AgentIdFacts", schemas.AgentIdFactsSchema],
  ["CronPromptSelection", schemas.CronPromptSelectionSchema],
  ["HostToolResultFacts", schemas.HostToolResultFactsSchema],
  ["ToolResultConstructionFacts", schemas.ToolResultConstructionFactsSchema],
  ["AgentNotificationDetails", schemas.AgentNotificationDetailsSchema],
  ["PreparedThreadLocator", schemas.PreparedThreadLocatorSchema],
  ["AgentRoutingDiagnosticsResult", schemas.AgentRoutingDiagnosticsResultSchema],
  ["AgentNotification", schemas.AgentNotificationSchema],
  ["PendingAgentNotificationsResult", schemas.PendingAgentNotificationsResultSchema],
  ["AgentNotificationClaimValidation", schemas.AgentNotificationClaimValidationSchema],
  ["AgentActiveCountResult", schemas.AgentActiveCountResultSchema],
  ["AgentCleanupItem", schemas.AgentCleanupItemSchema],
  ["AgentCleanupPlan", schemas.AgentCleanupPlanSchema],
  ["AgentManagerIdentity", schemas.AgentManagerIdentitySchema],
  ["AgentManagerRun", schemas.AgentManagerRunSchema],
  ["AgentManagerSnapshot", schemas.AgentManagerSnapshotSchema],
  ["AgentWorktreeLineDeltaReady", schemas.AgentWorktreeLineDeltaReadySchema],
  ["AgentWorktreeLineDeltaUnavailable", schemas.AgentWorktreeLineDeltaUnavailableSchema],
  ["AgentWorktreeLineDeltaUpdate", schemas.AgentWorktreeLineDeltaUpdateSchema],
  ["AgentChildSessionUpdate", schemas.AgentChildSessionUpdateSchema],
  ["PreparedAgentStart", schemas.PreparedAgentStartSchema],
  ["AgentSessionMetadata", schemas.AgentSessionMetadataSchema],
  ["PreparedAgentSend", schemas.PreparedAgentSendSchema],
  ["PreparedAgentWait", schemas.PreparedAgentWaitSchema],
  ["PreparedAgentClose", schemas.PreparedAgentCloseSchema],
  ["ActiveToolsSyncFacts", schemas.ActiveToolsSyncFactsSchema],
  ["ActiveToolsPlan", schemas.ActiveToolsPlanSchema],
  ["ChildPermissionRefreshPlan", schemas.ChildPermissionRefreshPlanSchema],
  ["PermissionsStateV1", schemas.PermissionsStateV1Schema],
  ["CommandSpec", schemas.CommandSpecSchema],
  ["CommandSpecsResult", schemas.CommandSpecsResultSchema],
  ["ToolNamesResult", schemas.ToolNamesResultSchema],
  ["ThreadCatalogFacts", schemas.ThreadCatalogFactsSchema],
  ["ThreadCatalogScan", schemas.ThreadCatalogScanSchema],
  ["ThreadCatalogScansResult", schemas.ThreadCatalogScansResultSchema],
  ["ExecNotification", schemas.ExecNotificationSchema],
  ["PendingExecNotificationsResult", schemas.PendingExecNotificationsResultSchema],
  ["ExecNotificationClaimed", schemas.ExecNotificationClaimedSchema],
  ["ExecNotificationUnavailable", schemas.ExecNotificationUnavailableSchema],
  ["ProcessManagerEntry", schemas.ProcessManagerEntrySchema],
  ["ProcessManagerSnapshot", schemas.ProcessManagerSnapshotSchema],
  ["ProcessManagerOutput", schemas.ProcessManagerOutputSchema],
  ["ProcessManagerOwnerFacts", schemas.ProcessManagerOwnerFactsSchema],
  ["ProcessManagerSessionFacts", schemas.ProcessManagerSessionFactsSchema],
  ["OpenAiUsageHostAuth", schemas.OpenAiUsageHostAuthSchema],
  ["KimiUsageHostAuth", schemas.KimiUsageHostAuthSchema],
  ["OpenAiUsageHostLookupFacts", schemas.OpenAiUsageHostLookupFactsSchema],
  ["KimiUsageHostLookupFacts", schemas.KimiUsageHostLookupFactsSchema],
  ["OpenAiUsageHostParamsPresent", schemas.OpenAiUsageHostParamsPresentSchema],
  ["OpenAiUsageHostParamsMissing", schemas.OpenAiUsageHostParamsMissingSchema],
  ["OpenAiUsageHostParamsError", schemas.OpenAiUsageHostParamsErrorSchema],
  ["OpenAiUsageHostParams", schemas.OpenAiUsageHostParamsSchema],
  ["KimiUsageHostParamsPresent", schemas.KimiUsageHostParamsPresentSchema],
  ["KimiUsageHostParamsMissing", schemas.KimiUsageHostParamsMissingSchema],
  ["KimiUsageHostParamsError", schemas.KimiUsageHostParamsErrorSchema],
  ["KimiUsageHostParams", schemas.KimiUsageHostParamsSchema],
  ["UsagePairHostParams", schemas.UsagePairHostParamsSchema],
  ["ExecPolicyScope", schemas.ExecPolicyScopeSchema],
  ["RefreshExecPolicyFacts", schemas.RefreshExecPolicyFactsSchema],
  ["RefreshExecPolicyResult", schemas.RefreshExecPolicyResultSchema],
  ["SkillListFacts", schemas.SkillListFactsSchema],
  ["SkillInfo", schemas.SkillInfoSchema],
  ["SkillListResult", schemas.SkillListResultSchema],
  ["SkillResolveFacts", schemas.SkillResolveFactsSchema],
  ["SkillBlock", schemas.SkillBlockSchema],
  ["BridgeWarning", schemas.BridgeWarningSchema],
  ["SkillResolveResult", schemas.SkillResolveResultSchema],
  ["EnvironmentContextFacts", schemas.EnvironmentContextFactsSchema],
  ["EnvironmentContextNone", schemas.EnvironmentContextNoneSchema],
  ["EnvironmentContextInject", schemas.EnvironmentContextInjectSchema],
  ["CommandNotificationFacts", schemas.CommandNotificationFactsSchema],
  ["CommandNotificationUnavailable", schemas.CommandNotificationUnavailableSchema],
  ["CommandNotificationSend", schemas.CommandNotificationSendSchema],
  ["PlanContinuationFacts", schemas.PlanContinuationFactsSchema],
  ["PlanContinuationNone", schemas.PlanContinuationNoneSchema],
  ["PlanPresentationDetails", schemas.PlanPresentationDetailsSchema],
  ["PlanContinuationSend", schemas.PlanContinuationSendSchema],
  ["ChildPlanContinuationSend", schemas.ChildPlanContinuationSendSchema],
  ["ChildPlanContinuationFinalize", schemas.ChildPlanContinuationFinalizeSchema],
  ["ChildSessionStartFacts", schemas.ChildSessionStartFactsSchema],
  ["ChildSessionMetadata", schemas.ChildSessionMetadataSchema],
  ["ChildSessionSetupEntry", schemas.ChildSessionSetupEntrySchema],
  ["ChildSessionStartPlan", schemas.ChildSessionStartPlanSchema],
  ["ChildDispatchFacts", schemas.ChildDispatchFactsSchema],
  ["ChildDispatchCompletion", schemas.ChildDispatchCompletionSchema],
  ["ChildDispatchResult", schemas.ChildDispatchResultSchema],
  ["ChildDispatchPlan", schemas.ChildDispatchPlanSchema],
  ["ResolvedMutationPath", schemas.ResolvedMutationPathSchema],
  ["WorkspaceMutationFacts", schemas.WorkspaceMutationFactsSchema],
  ["WorkspaceMutationValid", schemas.WorkspaceMutationValidSchema],
  ["WorkspaceMutationInvalid", schemas.WorkspaceMutationInvalidSchema],
  ["ExecPolicyAllowRuleFacts", schemas.ExecPolicyAllowRuleFactsSchema],
  ["ExecPolicyAllowRuleResult", schemas.ExecPolicyAllowRuleResultSchema],
  ["ExecApprovalPromptFacts", schemas.ExecApprovalPromptFactsSchema],
  ["ExecApprovalUnavailable", schemas.ExecApprovalUnavailableSchema],
  ["ExecApprovalConfirm", schemas.ExecApprovalConfirmSchema],
  ["CommandExecutionFacts", schemas.CommandExecutionFactsSchema],
  ["CommandContextOverride", schemas.CommandContextOverrideSchema],
  ["CommandExecutionError", schemas.CommandExecutionErrorSchema],
  ["CommandExecutionDirect", schemas.CommandExecutionDirectSchema],
  ["CommandExecutionChild", schemas.CommandExecutionChildSchema],
  ["CommandChildSessionFacts", schemas.CommandChildSessionFactsSchema],
  ["CommandChildSessionPlan", schemas.CommandChildSessionPlanSchema],
  ["BridgeToolResult", schemas.BridgeToolResultSchema],
  ["BridgeErrorResult", schemas.BridgeErrorResultSchema],
  ["CoreAck", schemas.CoreAckSchema],
  ["AgentOwnerContextFacts", schemas.AgentOwnerContextFactsSchema],
  ["AgentActionCapabilityFacts", schemas.AgentActionCapabilityFactsSchema],
  ["ExecCompletionWaitResult", schemas.ExecCompletionWaitResultSchema],
  ["ExaExecutionFacts", schemas.ExaExecutionFactsSchema],
  ["ToolResultTextContent", schemas.ToolResultTextContentSchema],
  ["ToolResultEnvelope", schemas.ToolResultEnvelopeSchema],
  ["BridgeCommandResult", schemas.BridgeCommandResultSchema],
  ["ReadFileFacts", schemas.ReadFileFactsSchema],
  ["ViewMediaFacts", schemas.ViewMediaFactsSchema],
  ["ToolResultImageContent", schemas.ToolResultImageContentSchema],
  ["ViewMediaSuccessEnvelope", schemas.ViewMediaSuccessEnvelopeSchema],
  ["WriteStdinFacts", schemas.WriteStdinFactsSchema],
  ["ExecTruncation", schemas.ExecTruncationSchema],
  ["ExecResultDetails", schemas.ExecResultDetailsSchema],
  ["HostExecResult", schemas.HostExecResultSchema],
  ["ExecToolResult", schemas.ExecToolResultSchema],
  ["ExecApprovalOutcomeFacts", schemas.ExecApprovalOutcomeFactsSchema],
  ["ExecApprovalRun", schemas.ExecApprovalRunSchema],
  ["ExecApprovalDenied", schemas.ExecApprovalDeniedSchema],
  ["AuthorityPlanRef", schemas.AuthorityPlanRefSchema],
  ["AuthorityPlanIssued", schemas.AuthorityPlanIssuedSchema],
  ["CommandChildDispatchFacts", schemas.CommandChildDispatchFactsSchema],
  ["CommandBridgeUpdate", schemas.CommandBridgeUpdateSchema],
  ["CommandChildReturn", schemas.CommandChildReturnSchema],
  ["CommandChildDispatch", schemas.CommandChildDispatchSchema],
  ["CommandChildDispatchFinishFacts", schemas.CommandChildDispatchFinishFactsSchema],
  ["CronContextFacts", schemas.CronContextFactsSchema],
  ["CronPlanFacts", schemas.CronPlanFactsSchema],
  ["CronPollFacts", schemas.CronPollFactsSchema],
  ["CronPollNone", schemas.CronPollNoneSchema],
  ["CronPollDelivery", schemas.CronPollDeliverySchema],
  ["CronDeliveredFacts", schemas.CronDeliveredFactsSchema],
  ["CronDeliveredResult", schemas.CronDeliveredResultSchema],
  ["CronStartupFacts", schemas.CronStartupFactsSchema],
  ["CronStartupNone", schemas.CronStartupNoneSchema],
  ["CronStartupNotify", schemas.CronStartupNotifySchema],
  ["ThreadToolFacts", schemas.ThreadToolFactsSchema],
  ["PlanRollbackFacts", schemas.PlanRollbackFactsSchema],
  ["FinalizePlanErrorFacts", schemas.FinalizePlanErrorFactsSchema],
  ["PlanRollbackResult", schemas.PlanRollbackResultSchema],
  ["MutationError", schemas.MutationErrorSchema],
  ["EditApplicationFacts", schemas.EditApplicationFactsSchema],
  ["EditApplied", schemas.EditAppliedSchema],
  ["PatchWrite", schemas.PatchWriteSchema],
  ["PatchApplicationFacts", schemas.PatchApplicationFactsSchema],
  ["AuthorizedMutationPath", schemas.AuthorizedMutationPathSchema],
  ["PatchApplied", schemas.PatchAppliedSchema],
  ["VisibilityWarningFacts", schemas.VisibilityWarningFactsSchema],
  ["VisibilityWarningsResult", schemas.VisibilityWarningsResultSchema],
  ["VisibilityRowsFacts", schemas.VisibilityRowsFactsSchema],
  ["VisibilityRow", schemas.VisibilityRowSchema],
  ["VisibilityRowsResult", schemas.VisibilityRowsResultSchema],
  ["VisibilityToggleFacts", schemas.VisibilityToggleFactsSchema],
  ["VisibilityMutationDetails", schemas.VisibilityMutationDetailsSchema],
  ["VisibilityToggleSuccess", schemas.VisibilityToggleSuccessSchema],
  ["VisibilityToggleError", schemas.VisibilityToggleErrorSchema],
  ["VisibilitySavePlan", schemas.VisibilitySavePlanSchema],
  ["VisibilityListResult", schemas.VisibilityListResultSchema],
  ["CompactionSettings", schemas.CompactionSettingsSchema],
  ["CompactionCommandFacts", schemas.CompactionCommandFactsSchema],
  ["CompactionPlanError", schemas.CompactionPlanErrorSchema],
  ["CompactionShow", schemas.CompactionShowSchema],
  ["CompactionSetProject", schemas.CompactionSetProjectSchema],
  ["CompactionClearProject", schemas.CompactionClearProjectSchema],
  ["CompactionOpenPicker", schemas.CompactionOpenPickerSchema],
  ["CompactionDefault", schemas.CompactionDefaultSchema],
  ["CompactionUseModel", schemas.CompactionUseModelSchema],
  ["PermissionsMenuOption", schemas.PermissionsMenuOptionSchema],
  ["PermissionsPrompt", schemas.PermissionsPromptSchema],
  ["PermissionsPromptFacts", schemas.PermissionsPromptFactsSchema],
  ["PermissionsCommandResult", schemas.PermissionsCommandResultSchema],
  ["PermissionsPromptSelect", schemas.PermissionsPromptSelectSchema],
  ["PermissionsPromptResult", schemas.PermissionsPromptResultSchema],
  ["PermissionsSelection", schemas.PermissionsSelectionSchema],
  ["PermissionsPromptFinishFacts", schemas.PermissionsPromptFinishFactsSchema],
  ["CronTask", schemas.CronTaskSchema],
  ["CronListDetails", schemas.CronListDetailsSchema],
  ["CronListResult", schemas.CronListResultSchema],
  ["CronTaskPatch", schemas.CronTaskPatchSchema],
  ["CronTaskUpdateFacts", schemas.CronTaskUpdateFactsSchema],
  ["CronManagerCommandFacts", schemas.CronManagerCommandFactsSchema],
  ["CronCommandResult", schemas.CronCommandResultSchema],
  ["CronPrompt", schemas.CronPromptSchema],
  ["CronPromptFacts", schemas.CronPromptFactsSchema],
  ["CronPromptPlan", schemas.CronPromptPlanSchema],
  ["ComposerSettings", schemas.ComposerSettingsSchema],
  ["ComposerCommandFacts", schemas.ComposerCommandFactsSchema],
  ["ComposerCommandError", schemas.ComposerCommandErrorSchema],
  ["ComposerCommandSuccess", schemas.ComposerCommandSuccessSchema],
  ["CronPlanCreationFacts", schemas.CronPlanCreationFactsSchema],
  ["CronPlanCreationResult", schemas.CronPlanCreationResultSchema],
  ["HandleCommandFacts", schemas.HandleCommandFactsSchema],
  ["GatewayCommandError", schemas.GatewayCommandErrorSchema],
  ["GatewayCommandResult", schemas.GatewayCommandResultSchema],
  ["VisibilityPrompt", schemas.VisibilityPromptSchema],
  ["OpenAiUsageFetch", schemas.OpenAiUsageFetchSchema],
  ["UsagePairFetch", schemas.UsagePairFetchSchema],
  ["PrepareToolFacts", schemas.PrepareToolFactsSchema],
  ["SandboxConfig", schemas.SandboxConfigSchema],
  ["ExecHostOptions", schemas.ExecHostOptionsSchema],
  ["ExecHostCall", schemas.ExecHostCallSchema],
  ["WriteStdinHostOptions", schemas.WriteStdinHostOptionsSchema],
  ["WriteStdinHostResult", schemas.WriteStdinHostResultSchema],
  ["WriteStdinHostCall", schemas.WriteStdinHostCallSchema],
  ["PreparedRead", schemas.PreparedReadSchema],
  ["PreparedViewMedia", schemas.PreparedViewMediaSchema],
  ["PreparedWriteStdin", schemas.PreparedWriteStdinSchema],
  ["PreparedExec", schemas.PreparedExecSchema],
  ["PreparedExecApproval", schemas.PreparedExecApprovalSchema],
  ["PreparedExecInput", schemas.PreparedExecInputSchema],
  ["PreparedWrite", schemas.PreparedWriteSchema],
  ["PreparedWriteApproval", schemas.PreparedWriteApprovalSchema],
  ["PreparedEdit", schemas.PreparedEditSchema],
  ["PreparedEditApproval", schemas.PreparedEditApprovalSchema],
  ["PreparedPatch", schemas.PreparedPatchSchema],
  ["PreparedPatchApproval", schemas.PreparedPatchApprovalSchema],
  ["PreparedThreadQuery", schemas.PreparedThreadQuerySchema],
  ["PreparedThreadRead", schemas.PreparedThreadReadSchema],
  ["PreparedExa", schemas.PreparedExaSchema],
  ["PreparedExaApproval", schemas.PreparedExaApprovalSchema]
];
// src/util.ts
function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
function recordValue(value) {
  return objectValue(value) !== undefined;
}
function objectLikeValue(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function isObjectLike(value) {
  return objectLikeValue(value) !== undefined;
}
function property(source, name) {
  return Reflect.get(source, name);
}
function nodeErrorCode(error) {
  const value = objectLikeValue(error);
  return value === undefined ? undefined : property(value, "code");
}
function stringFieldOrUndefined(source, name) {
  const value = property(source, name);
  return typeof value === "string" ? value : undefined;
}
function numberFieldOrUndefined(source, name) {
  const value = property(source, name);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function boolFieldOrUndefined(source, name) {
  const value = property(source, name);
  return typeof value === "boolean" ? value : undefined;
}
function recordFieldOrUndefined(source, name) {
  return objectValue(property(source, name));
}
function stringArrayFieldOrUndefined(source, name) {
  const value = property(source, name);
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}
function stringArrayFieldOrEmpty(source, name) {
  return stringArrayFieldOrUndefined(source, name) ?? [];
}
function recordArrayFieldOrUndefined(source, name) {
  const value = property(source, name);
  if (!Array.isArray(value))
    return;
  const records = [];
  for (const item of value) {
    const record = objectValue(item);
    if (record !== undefined)
      records.push(record);
  }
  return records;
}
function recordArrayFieldOrEmpty(source, name) {
  return recordArrayFieldOrUndefined(source, name) ?? [];
}
function contextWithOverrides(ctx, overrides) {
  const context = objectValue(ctx);
  return context === undefined ? overrides : { ...context, ...overrides };
}
function maybeCall(receiver, name, args = []) {
  const target = objectValue(receiver);
  if (target === undefined)
    return;
  const method = property(target, name);
  return typeof method === "function" ? method.apply(receiver, args) : undefined;
}
function isStaleContextError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ctx is stale") || message.includes("This extension ctx is stale after session replacement or reload");
}
function contextIsLive(ctx) {
  try {
    const sessionManager = objectValue(ctx) === undefined ? undefined : property(ctx, "sessionManager");
    const manager = objectValue(sessionManager);
    if (manager === undefined)
      return true;
    const getSessionId = property(manager, "getSessionId");
    if (typeof getSessionId === "function") {
      getSessionId.call(sessionManager);
      return true;
    }
    const getSessionFile = property(manager, "getSessionFile");
    if (typeof getSessionFile === "function") {
      getSessionFile.call(sessionManager);
    }
    return true;
  } catch (error) {
    if (isStaleContextError(error))
      return false;
    throw error;
  }
}
function extensionRuntimeIsLive(pi) {
  try {
    if (typeof pi.getFlag === "function") {
      pi.getFlag("__taumel_liveness_probe__");
      return true;
    }
    if (typeof pi.getThinkingLevel === "function") {
      pi.getThinkingLevel();
      return true;
    }
    if (typeof pi.getActiveTools === "function") {
      pi.getActiveTools();
    }
    return true;
  } catch (error) {
    if (isStaleContextError(error))
      return false;
    throw error;
  }
}
function stringFromMethod(receiver, name) {
  const target = objectValue(receiver);
  if (target === undefined)
    return;
  const method = property(target, name);
  if (typeof method !== "function")
    return;
  try {
    const value = method.call(receiver);
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return;
  }
}
function sessionInfoFromManager(sessionManager) {
  return {
    sessionId: stringFromMethod(sessionManager, "getSessionId"),
    sessionFile: stringFromMethod(sessionManager, "getSessionFile")
  };
}
function sessionInfoFromContext(ctx) {
  const context = objectValue(ctx);
  return context === undefined ? {} : sessionInfoFromManager(property(context, "sessionManager"));
}
function cwdFromContext(ctx) {
  const context = objectValue(ctx);
  const cwd = context === undefined ? undefined : property(context, "cwd");
  return typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
}
function projectSettingsPath(cwd) {
  return join2(cwd, ".pi", "settings.json");
}
function isProjectTrusted(ctx) {
  const context = objectValue(ctx);
  const trusted = context?.isProjectTrusted;
  return typeof trusted === "function" && trusted.call(ctx) === true;
}
function splitProviderModelId(modelId) {
  if (modelId === undefined)
    return;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1)
    return;
  return { provider: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
}
function childBridgeFacts(bridge) {
  if (!bridge)
    return { available: false };
  return {
    available: true,
    cancelled: bridge.cancelled === true,
    ...bridge.sessionId === undefined ? {} : { sessionId: bridge.sessionId },
    ...bridge.sessionFile === undefined ? {} : { sessionFile: bridge.sessionFile },
    ...bridge.error === undefined ? {} : { error: bridge.error },
    missingSessionIdentifier: bridge.missingSessionIdentifier === true,
    ...bridge.activeTools === undefined ? {} : { activeTools: [...bridge.activeTools] },
    activeToolsApplied: bridge.activeToolsApplied === true,
    ...bridge.modelId === undefined ? {} : { modelId: bridge.modelId },
    modelApplied: bridge.modelApplied === true,
    ...bridge.thinkingLevel === undefined ? {} : { thinkingLevel: bridge.thinkingLevel },
    thinkingApplied: bridge.thinkingApplied === true
  };
}
function stringFlag(pi, name) {
  const value = typeof pi.getFlag === "function" ? pi.getFlag(name) : undefined;
  if (typeof value !== "string")
    return;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
function modelRegistryFrom(pi, ctx) {
  const context = objectValue(ctx);
  const registry = context === undefined ? undefined : property(context, "modelRegistry");
  if (registry !== undefined)
    return registry;
  return pi.modelRegistry;
}
function liveToolNames(pi, builtins) {
  const names = new Set(builtins);
  if (typeof pi.getAllTools === "function") {
    for (const tool of pi.getAllTools()) {
      if (typeof tool === "string" && tool !== "") {
        names.add(tool);
        continue;
      }
      const value = objectValue(tool);
      const name = value === undefined ? undefined : property(value, "name");
      if (typeof name === "string" && name !== "")
        names.add(name);
    }
  }
  return [...names];
}
function openAiCredentialRaw(registry, credentialKey) {
  const target = objectValue(registry);
  if (target === undefined)
    return;
  const authStorage = property(target, "authStorage");
  return maybeCall(authStorage, "get", [credentialKey]);
}
async function usageTokenRaw(registry, providerKey) {
  const value = await maybeCall(registry, "getApiKeyForProvider", [providerKey]);
  return typeof value === "string" ? value : "";
}
function resolveAuthorizationPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code !== "ENOENT")
      throw error;
    const parent = dirname(path);
    if (parent === path)
      return path;
    return join2(resolveAuthorizationPath(parent), basename(path));
  }
}
function childSessionStartPlan(core, metadata, parent, ctx) {
  return decodeChildSessionStartPlan(core.call("planChildSessionStart", [{
    metadata,
    parentSessionId: parent.sessionId ?? "",
    parentSessionFile: parent.sessionFile ?? ""
  }, ctx]));
}
function setActiveToolsOn(receiver, toolNames2) {
  const target = objectValue(receiver);
  if (target === undefined)
    return false;
  for (const methodName of ["setActiveToolsByName", "setActiveTools"]) {
    const method = property(target, methodName);
    if (typeof method !== "function")
      continue;
    method.call(receiver, [...toolNames2]);
    return true;
  }
  return false;
}
function applyChildActiveTools(ctx, toolNames2) {
  if (setActiveToolsOn(ctx, toolNames2))
    return true;
  const context = objectValue(ctx);
  if (context !== undefined && setActiveToolsOn(property(context, "sessionManager"), toolNames2))
    return true;
  return false;
}
function mutationChangedError(authorization) {
  return new Error(`Mutation path changed after authorization: ${authorization.path}`);
}
async function optionalFileState(path) {
  try {
    const stats = await lstat2(path, { bigint: true });
    if (!stats.isFile())
      throw new Error(`Mutation target is not a regular file: ${path}`);
    return fileStateFromStats(stats);
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code === "ENOENT")
      return;
    throw error;
  }
}
async function existingPathAnchor(path) {
  let candidate = dirname(path);
  while (true) {
    const identity = await optionalPathIdentity(candidate);
    if (identity !== undefined) {
      const stats = await lstat2(candidate, { bigint: true });
      if (!stats.isDirectory())
        throw new Error(`Mutation path ancestor is not a directory: ${candidate}`);
      return { path: candidate, identity };
    }
    const parent = dirname(candidate);
    if (parent === candidate)
      throw new Error(`No existing ancestor for mutation path: ${path}`);
    candidate = parent;
  }
}
async function captureMutationPathAuthorization(path) {
  const resolvedPath = await resolveRealPath(path);
  const anchor = await existingPathAnchor(resolvedPath);
  return {
    path,
    resolvedPath,
    anchorPath: anchor.path,
    anchorIdentity: anchor.identity,
    targetState: await optionalFileState(resolvedPath)
  };
}
async function authorizeMutationPaths(paths) {
  return await Promise.all(paths.map(captureMutationPathAuthorization));
}
async function authorizeCanonicalMutationPaths(paths) {
  const authorizations = await authorizeMutationPaths(paths);
  for (const authorization of authorizations) {
    if (authorization.resolvedPath !== authorization.path) {
      throw new Error(`Mutation path changed after authorization: ${authorization.path}`);
    }
  }
  return authorizations;
}
async function assertMutationPathAuthorization(authorization) {
  const currentResolvedPath = await resolveRealPath(authorization.path);
  const currentAnchorIdentity = await optionalPathIdentity(authorization.anchorPath);
  const currentTargetState = await optionalFileState(authorization.resolvedPath);
  const targetMatches = authorization.targetState === undefined ? currentTargetState === undefined : currentTargetState !== undefined && stateMatches(authorization.targetState, currentTargetState);
  if (currentResolvedPath !== authorization.resolvedPath || currentAnchorIdentity === undefined || !identityMatches(authorization.anchorIdentity, currentAnchorIdentity) || !targetMatches) {
    throw new Error(`Mutation path changed after authorization: ${authorization.path}`);
  }
}
async function optionalAnchoredFileState(parent, name, displayPath) {
  try {
    const stats = await lstat2(anchoredEntryPath(parent, name), { bigint: true });
    if (!stats.isFile())
      throw new Error(`Mutation target is not a regular file: ${displayPath}`);
    return fileStateFromStats(stats);
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code === "ENOENT")
      return;
    throw error;
  }
}
async function anchorMutationParent(authorization, allowPathnameFallback) {
  let pinned;
  try {
    await requireDescriptorPaths();
    pinned = true;
  } catch (error) {
    if (!allowPathnameFallback)
      throw error;
    pinned = false;
  }
  await assertMutationPathAuthorization(authorization);
  const parent = dirname(authorization.resolvedPath);
  const suffix = relative(authorization.anchorPath, parent);
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) {
    throw mutationChangedError(authorization);
  }
  const components = suffix.split(/[\\/]/u).filter(Boolean);
  if (!pinned) {
    return await walkPathnameMutationParent({
      anchorPath: authorization.anchorPath,
      anchorIdentity: authorization.anchorIdentity,
      components,
      changedError: () => mutationChangedError(authorization)
    });
  }
  let current = await openPinnedDirectory(authorization.anchorPath);
  try {
    const anchorStats = await current.stat({ bigint: true });
    if (!identityMatches(authorization.anchorIdentity, { dev: anchorStats.dev, ino: anchorStats.ino })) {
      throw mutationChangedError(authorization);
    }
    for (const component of components) {
      const handle = current;
      current = undefined;
      try {
        let next;
        try {
          next = await openPinnedChildDirectory(handle, component);
        } catch (error) {
          const code = nodeErrorCode(error);
          if (code !== "ENOENT")
            throw error;
          try {
            await mkdir2(descriptorPath(handle, component));
          } catch (mkdirError) {
            const mkdirCode = nodeErrorCode(mkdirError);
            if (mkdirCode !== "EEXIST")
              throw mkdirError;
          }
          next = await openPinnedChildDirectory(handle, component);
        }
        current = next;
      } finally {
        await handle.close();
      }
    }
    const anchored = current;
    current = undefined;
    return { kind: "pinned", handle: anchored };
  } finally {
    await current?.close();
  }
}
async function appendToFile(authorization, contents) {
  const parent = await anchorMutationParent(authorization, false);
  try {
    const handle = await open2(anchoredEntryPath(parent, basename(authorization.resolvedPath)), constants2.O_APPEND | constants2.O_WRONLY | constants2.O_NOFOLLOW | (authorization.targetState === undefined ? constants2.O_CREAT | constants2.O_EXCL : 0), 438);
    try {
      const openedStats = await handle.stat({ bigint: true });
      if (authorization.targetState !== undefined && (!openedStats.isFile() || !stateMatches(authorization.targetState, fileStateFromStats(openedStats))))
        throw mutationChangedError(authorization);
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
  } finally {
    await closeMutationAnchor(parent);
  }
}
async function readAuthorizedFile(authorization, allowPathnameFallback = false) {
  if (authorization.targetState === undefined) {
    throw new Error(`Mutation target does not exist: ${authorization.path}`);
  }
  const parent = await anchorMutationParent(authorization, allowPathnameFallback);
  try {
    const handle = await open2(anchoredEntryPath(parent, basename(authorization.resolvedPath)), constants2.O_RDONLY | constants2.O_NOFOLLOW);
    try {
      const beforeStats = await handle.stat({ bigint: true });
      const before = fileStateFromStats(beforeStats);
      if (!beforeStats.isFile() || !stateMatches(authorization.targetState, before)) {
        throw new Error(`Mutation path changed after authorization: ${authorization.path}`);
      }
      const contents = await handle.readFile();
      const afterStats = await handle.stat({ bigint: true });
      const after = fileStateFromStats(afterStats);
      if (!afterStats.isFile() || !stateMatches(before, after)) {
        throw new Error(`Mutation target changed while reading: ${authorization.path}`);
      }
      return { contents, authorization: { ...authorization, targetState: after } };
    } finally {
      await handle.close();
    }
  } finally {
    await closeMutationAnchor(parent);
  }
}
async function readJsonObjectForAtomicUpdate(path, allowPathnameFallback = false) {
  const authorization = await captureMutationPathAuthorization(path);
  if (authorization.targetState === undefined)
    return { settings: {}, authorization };
  const read = await readAuthorizedFile(authorization, allowPathnameFallback);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(read.contents));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return { settings: parsed, authorization: read.authorization };
}
async function writeDataAtomically(authorization, contents, allowPathnameFallback) {
  const target = authorization.resolvedPath;
  const name = basename(target);
  const parent = await anchorMutationParent(authorization, allowPathnameFallback);
  const tempName = `.${name}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  let handle;
  let tempState;
  try {
    handle = await open2(anchoredEntryPath(parent, tempName), constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL | constants2.O_NOFOLLOW, 438);
    await handle.writeFile(contents);
    await handle.sync();
    tempState = fileStateFromStats(await handle.stat({ bigint: true }));
    await handle.close();
    handle = undefined;
    await assertMutationPathAuthorization(authorization);
    const currentTempState = await optionalAnchoredFileState(parent, tempName, target);
    if (currentTempState === undefined || !stateMatches(tempState, currentTempState)) {
      throw mutationChangedError(authorization);
    }
    await rename(anchoredEntryPath(parent, tempName), anchoredEntryPath(parent, name));
    let committedAuthorization;
    try {
      const committedState = await optionalAnchoredFileState(parent, name, target);
      if (committedState === undefined || !identityMatches(tempState.identity, committedState.identity)) {
        throw new Error(`Mutation target identity changed during rename: ${authorization.path}`);
      }
      committedAuthorization = { ...authorization, targetState: committedState };
    } catch (error) {
      throw new MutationCommittedError({ ...authorization, targetState: tempState }, error);
    }
    await syncMutationAnchor(parent);
    return committedAuthorization;
  } catch (error) {
    const cleanupFailures = [];
    try {
      await handle?.close();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    try {
      const currentTempState = await optionalAnchoredFileState(parent, tempName, target);
      if (tempState !== undefined && currentTempState !== undefined && stateMatches(tempState, currentTempState))
        await unlink(anchoredEntryPath(parent, tempName));
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (cleanupFailures.length > 0) {
      const cause = new AggregateError([error, ...cleanupFailures], "Mutation cleanup incomplete", { cause: error });
      if (error instanceof MutationCommittedError) {
        throw new MutationCommittedError(error.authorization, cause);
      }
      throw cause;
    }
    throw error;
  } finally {
    await closeMutationAnchor(parent);
  }
}
async function writeFileAtomically(pathOrAuthorization, contents, allowPathnameFallback = false) {
  const authorization = typeof pathOrAuthorization === "string" ? await captureMutationPathAuthorization(pathOrAuthorization) : pathOrAuthorization;
  await writeDataAtomically(authorization, contents, allowPathnameFallback);
}

class MutationCommittedError extends Error {
  authorization;
  constructor(authorization, cause) {
    super(`Mutation committed but its resulting identity could not be verified: ${authorization.path}`, { cause });
    this.authorization = authorization;
  }
}
async function snapshotPatchFile(authorization) {
  if (authorization.targetState === undefined)
    return { authorization, snapshot: { kind: "missing" } };
  const read = await readAuthorizedFile(authorization);
  return { authorization: read.authorization, snapshot: { kind: "file", contents: read.contents } };
}
async function restorePatchFile(entry) {
  const { authorization, snapshot } = entry;
  switch (snapshot.kind) {
    case "missing": {
      if (authorization.targetState !== undefined) {
        const parent = await anchorMutationParent(authorization, false);
        try {
          await unlink(anchoredEntryPath(parent, basename(authorization.resolvedPath)));
        } finally {
          await closeMutationAnchor(parent);
        }
      }
      return;
    }
    case "file":
      await writeDataAtomically(authorization, snapshot.contents, false);
      return;
  }
}
async function rollbackPatchFiles(journal) {
  const failures = [];
  for (const entry of [...journal].reverse()) {
    try {
      await restorePatchFile(entry);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}
async function writePatchFiles(application) {
  const deletes = application.deletes;
  const parsedWrites = application.writes;
  if (deletes.some((path) => typeof path !== "string") || parsedWrites.some((write) => typeof write !== "object" || write === null || typeof write.path !== "string" || write.path === "" || typeof write.contents !== "string"))
    throw new Error("Invalid Taumel apply_patch result");
  const authorizationByPath = new Map;
  for (const authorization of application.authorizations) {
    if (authorizationByPath.has(authorization.path)) {
      throw new Error(`Duplicate mutation authorization for path: ${authorization.path}`);
    }
    authorizationByPath.set(authorization.path, authorization);
  }
  const authorizationFor = (path) => {
    const authorization = authorizationByPath.get(path);
    if (authorization === undefined)
      throw new Error(`Missing mutation authorization for path: ${path}`);
    return authorization;
  };
  const snapshots = new Map;
  for (const path of [...parsedWrites.map((write) => write.path), ...deletes]) {
    const authorization = authorizationFor(path);
    if (snapshots.has(authorization.resolvedPath)) {
      throw new Error(`Duplicate canonical mutation target: ${authorization.resolvedPath}`);
    }
    const captured = await snapshotPatchFile(authorization);
    snapshots.set(authorization.resolvedPath, captured.snapshot);
    authorizationByPath.set(path, captured.authorization);
  }
  const journal = [];
  try {
    for (const write of parsedWrites) {
      const authorization = authorizationFor(write.path);
      let produced;
      try {
        produced = await writeDataAtomically(authorization, write.contents, false);
      } catch (error) {
        if (error instanceof MutationCommittedError) {
          journal.push({
            authorization: error.authorization,
            snapshot: snapshots.get(authorization.resolvedPath)
          });
        }
        throw error;
      }
      journal.push({ authorization: produced, snapshot: snapshots.get(authorization.resolvedPath) });
      authorizationByPath.set(write.path, produced);
    }
    for (const path of deletes) {
      const authorization = authorizationFor(path);
      if (authorization.targetState === undefined)
        continue;
      const parent = await anchorMutationParent(authorization, false);
      try {
        await unlink(anchoredEntryPath(parent, basename(authorization.resolvedPath)));
      } finally {
        await closeMutationAnchor(parent);
      }
      const produced = { ...authorization, targetState: undefined };
      journal.push({ authorization: produced, snapshot: snapshots.get(authorization.resolvedPath) });
      authorizationByPath.set(path, produced);
    }
  } catch (error) {
    const rollbackFailures = await rollbackPatchFiles(journal);
    if (rollbackFailures.length > 0) {
      throw new AggregateError([error, ...rollbackFailures], "Patch partially applied; rollback incomplete", { cause: error });
    }
    throw error;
  }
}
async function resolveRealPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code !== "ENOENT")
      throw error;
    const parent = dirname(path);
    if (parent === path)
      return path;
    const resolvedParent = await resolveRealPath(parent);
    return `${resolvedParent}/${basename(path)}`;
  }
}
async function resolvedWorkspaceMutationPathFacts(paths, workspaceRoots) {
  const resolvedRoots = await Promise.all(workspaceRoots.map((root) => realpath(root)));
  const authorizations = await Promise.all(paths.map(captureMutationPathAuthorization));
  return {
    facts: {
      workspaceRoots: resolvedRoots,
      paths: authorizations.map(({ path, resolvedPath }) => ({ path, resolvedPath }))
    },
    authorizations
  };
}
async function validateWorkspaceMutationPaths(core, paths, workspaceRoots) {
  const resolved = await resolvedWorkspaceMutationPathFacts(paths, workspaceRoots);
  const result = decodeWorkspaceMutationValidation(core.call("validateWorkspaceMutationPaths", [
    resolved.facts
  ]));
  if (result.kind === "invalid")
    throw new Error(result.message);
  return resolved.authorizations;
}
function formatRelativeDuration(seconds) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  if (totalMinutes < 1)
    return "under 1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  if (days > 0)
    return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0)
    return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `${minutes}m`;
}
function formatWaitDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)
    return "";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60)
    return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60)
    return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24)
    return `${hours}h${restMinutes > 0 ? ` ${restMinutes}m` : ""}`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return `${days}d${restHours > 0 ? ` ${restHours}h` : ""}`;
}
function formatLocalTime(targetSeconds, nowMs) {
  const target = new Date(targetSeconds * 1000);
  const now = new Date(nowMs);
  const time = target.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth() && target.getDate() === now.getDate();
  if (sameDay)
    return time;
  if (target.getTime() - nowMs <= 7 * 86400 * 1000) {
    return `${target.toLocaleDateString("en", { weekday: "short" })} ${time}`;
  }
  return `${target.toLocaleDateString("en", { day: "2-digit", month: "short" })} ${time}`;
}

// src/version.ts
var taumelVersion = "0.0.345-g2d2ed83907a3";

// src/global-settings.ts
var defaultTaumelGlobalSettings = { taumel: { composer: { enabled: true } } };
var settingsBlocks = ["composer", "tools", "skills"];
var visibilityBlocks = ["tools", "skills"];
function taumelGlobalSettingsPath() {
  return join3(getAgentDir(), "settings.json");
}
function diagnostic(path, key, message) {
  return { path, key, message };
}
function nestedDiagnostics(root, path) {
  const diagnostics = [];
  const taumel = root["taumel"];
  if (taumel !== undefined && !recordValue(taumel)) {
    return [diagnostic(path, "taumel", "taumel must be an object")];
  }
  if (!recordValue(taumel))
    return diagnostics;
  for (const name of settingsBlocks) {
    const value = taumel[name];
    if (value !== undefined && !recordValue(value)) {
      diagnostics.push(diagnostic(path, `taumel.${name}`, `taumel.${name} must be an object`));
    }
  }
  const composer = recordValue(taumel["composer"]) ? taumel["composer"] : undefined;
  if (composer?.["enabled"] !== undefined && typeof composer["enabled"] !== "boolean") {
    diagnostics.push(diagnostic(path, "taumel.composer.enabled", "composer enabled must be a boolean"));
  }
  for (const name of visibilityBlocks) {
    const block = recordValue(taumel[name]) ? taumel[name] : undefined;
    const disabled = block?.["disabled"];
    if (disabled !== undefined && (!Array.isArray(disabled) || !disabled.every((item) => typeof item === "string"))) {
      diagnostics.push(diagnostic(path, `taumel.${name}.disabled`, `taumel.${name}.disabled must be an array of strings`));
    }
  }
  return diagnostics;
}
async function readRoot(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return recordValue(parsed) ? { exists: true, root: parsed, diagnostics: [] } : { exists: true, root: {}, diagnostics: [diagnostic(path, "<root>", "global Pi settings must be a JSON object")] };
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT")
      return { exists: false, root: {}, diagnostics: [] };
    return { exists: true, root: {}, diagnostics: [diagnostic(path, "<root>", `global Pi settings could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`)] };
  }
}
async function readRootForUpdate(path) {
  return readJsonObjectForAtomicUpdate(path, true);
}
function parseTaumelGlobalSettings(value, path = taumelGlobalSettingsPath()) {
  const root = recordValue(value) ? value : undefined;
  const diagnostics = root !== undefined ? nestedDiagnostics(root, path) : [diagnostic(path, "<root>", "global Pi settings must be a JSON object")];
  const taumel = recordValue(root?.["taumel"]) ? root["taumel"] : {};
  const composer = recordValue(taumel["composer"]) ? taumel["composer"] : {};
  const enabled = composer["enabled"];
  return { settings: { taumel: { composer: { enabled: typeof enabled === "boolean" ? enabled : true } } }, diagnostics };
}
async function readTaumelGlobalSettings(path = taumelGlobalSettingsPath()) {
  return parseTaumelGlobalSettings((await readRoot(path)).root, path).settings;
}
function result(ok, message, path, initialized, missing, diagnostics) {
  return { ok, action: "command_result", message, details: { path, initialized, missing, diagnostics } };
}
async function initializeTaumelGlobalConfig(path = taumelGlobalSettingsPath()) {
  let read;
  try {
    read = await readRootForUpdate(path);
  } catch (error) {
    const message = `global Pi settings could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`;
    return result(false, `Taumel global config is malformed: ${path}`, path, [], [], [diagnostic(path, "<root>", message)]);
  }
  const diagnostics = nestedDiagnostics(read.settings, path);
  if (diagnostics.length > 0) {
    return result(false, `Taumel global config is malformed: ${path}`, path, [], [], diagnostics);
  }
  const root = read.settings;
  const initialized = [];
  const taumel = recordValue(root["taumel"]) ? root["taumel"] : root["taumel"] = {};
  const composer = recordValue(taumel["composer"]) ? taumel["composer"] : taumel["composer"] = {};
  if (composer["enabled"] === undefined) {
    composer["enabled"] = true;
    initialized.push("taumel.composer.enabled");
  }
  for (const name of visibilityBlocks) {
    const block = recordValue(taumel[name]) ? taumel[name] : taumel[name] = {};
    if (block["disabled"] === undefined) {
      block["disabled"] = [];
      initialized.push(`taumel.${name}.disabled`);
    }
  }
  await writeFileAtomically(read.authorization, `${JSON.stringify(root, null, 2)}
`, true);
  return result(true, initialized.length ? `Initialized Taumel global config: ${path}` : `Taumel global config already initialized: ${path}`, path, initialized, [], []);
}
async function writeTaumelComposerEnabled(path, enabled) {
  let read;
  try {
    read = await readRootForUpdate(path);
  } catch {
    throw new Error(`Cannot write Taumel composer config because global Pi settings are malformed: ${path}`);
  }
  if (nestedDiagnostics(read.settings, path).length) {
    throw new Error(`Cannot write Taumel composer config because global Pi settings are malformed: ${path}`);
  }
  const root = read.settings;
  const taumel = recordValue(root["taumel"]) ? root["taumel"] : root["taumel"] = {};
  const composer = recordValue(taumel["composer"]) ? taumel["composer"] : taumel["composer"] = {};
  composer["enabled"] = enabled;
  await writeFileAtomically(read.authorization, `${JSON.stringify(root, null, 2)}
`, true);
}
async function taumelStatus(path = taumelGlobalSettingsPath(), version = taumelVersion) {
  const read = await readRoot(path);
  const missing = [];
  const taumel = recordValue(read.root["taumel"]) ? read.root["taumel"] : {};
  const composer = recordValue(taumel["composer"]) ? taumel["composer"] : undefined;
  if (composer?.["enabled"] === undefined)
    missing.push("taumel.composer.enabled");
  for (const name of visibilityBlocks) {
    const block = recordValue(taumel[name]) ? taumel[name] : undefined;
    if (block?.["disabled"] === undefined)
      missing.push(`taumel.${name}.disabled`);
  }
  const message = [
    ...version === "" ? [] : [`Taumel version: ${version}`],
    `Taumel global config: ${read.exists ? path : `${path} (missing)`}`,
    `Missing defaults: ${missing.length}`,
    `Diagnostics: ${read.diagnostics.length}`,
    "Commands: taumel, composer, tools, skills, cron, compaction-model, execpolicy"
  ].join(`
`);
  const status = result(read.diagnostics.length === 0, message, path, [], missing, read.diagnostics);
  return version === "" ? status : { ...status, details: { ...status.details, version } };
}

// src/composer.ts
var COMPOSER_BACKGROUND = "\x1B[48;2;42;50;54m";
var ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
var SKILL_TOKEN_PATTERN = /(^|[\s])\$([a-z0-9-]*)$/;
var RESOLVABLE_SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, "");
}
function isHorizontalBorderLine(line) {
  const plain = stripAnsi(line);
  return plain.length > 0 && /^[─]+$/.test(plain);
}
function withBackground(line, width) {
  const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
  const patched = padded.replaceAll("\x1B[0m", `\x1B[0m${COMPOSER_BACKGROUND}`);
  return `${COMPOSER_BACKGROUND}${patched}\x1B[0m`;
}
function skillTokenPrefix(textBeforeCursor) {
  const match = SKILL_TOKEN_PATTERN.exec(textBeforeCursor);
  return match ? `$${match[2] ?? ""}` : null;
}
function shouldAutoTriggerSkillAutocomplete(editor, data) {
  if (data.length !== 1)
    return false;
  if (editor.isShowingAutocomplete())
    return false;
  if (data !== "$" && !/[a-z0-9-]/.test(data))
    return false;
  const { line, col } = editor.getCursor();
  const currentLine = editor.getLines()[line] ?? "";
  return skillTokenPrefix(currentLine.slice(0, col)) !== null;
}
function skillItems(skills, prefix) {
  const query = prefix.slice(1);
  const items = [];
  for (const skill of skills) {
    if (!RESOLVABLE_SKILL_NAME_PATTERN.test(skill.name) || !skill.name.startsWith(query))
      continue;
    const description = skill.description || skill.location;
    items.push({
      value: `$${skill.name}`,
      label: `$${skill.name}`,
      ...description ? { description } : {}
    });
  }
  return items;
}
function skillTriggerCharacters(current) {
  const characters = new Set(current.triggerCharacters ?? []);
  characters.add("$");
  return [...characters];
}
function renderComposerInput(width, next, enabled) {
  if (!enabled)
    return next(width);
  const promptPrefix = "\x1B[1m›\x1B[0m ";
  const continuationPrefix = "  ";
  const prefixWidth = 2;
  if (width <= prefixWidth)
    return next(width);
  const contentWidth = Math.max(1, width - prefixWidth);
  const base = next(contentWidth);
  if (base.length < 2)
    return base;
  let bottomBorderIndex = -1;
  for (let index = base.length - 1;index >= 1; index -= 1) {
    if (isHorizontalBorderLine(base[index] ?? "")) {
      bottomBorderIndex = index;
      break;
    }
  }
  if (bottomBorderIndex === -1) {
    return base.map((line, index) => withBackground(`${index === 0 ? promptPrefix : continuationPrefix}${line}`, width));
  }
  const contentLines = base.slice(1, bottomBorderIndex);
  const autocompleteLines = base.slice(bottomBorderIndex + 1);
  const result2 = [];
  result2.push(withBackground("", width));
  for (let index = 0;index < contentLines.length; index += 1) {
    const prefix = index === 0 ? promptPrefix : continuationPrefix;
    result2.push(withBackground(prefix + (contentLines[index] ?? ""), width));
  }
  result2.push(withBackground("", width));
  for (const line of autocompleteLines) {
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
    result2.push(continuationPrefix + line + padding);
  }
  return result2;
}

class SkillAutocompleteProvider {
  current;
  skills;
  triggerCharacters;
  constructor(current, skills) {
    this.current = current;
    this.skills = skills;
    this.triggerCharacters = skillTriggerCharacters(current);
  }
  setBase(current) {
    this.current = current;
    this.triggerCharacters = skillTriggerCharacters(current);
  }
  async getSuggestions(lines, cursorLine, cursorCol, options) {
    if (options.force !== true) {
      const currentLine = lines[cursorLine] || "";
      const prefix = skillTokenPrefix(currentLine.slice(0, cursorCol));
      if (prefix !== null) {
        const items = skillItems(this.skills(), prefix);
        return items.length === 0 ? null : { items, prefix };
      }
    }
    return this.current.getSuggestions(lines, cursorLine, cursorCol, options);
  }
  applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
    if (prefix.startsWith("$")) {
      const currentLine = lines[cursorLine] || "";
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      const suffix = afterCursor.startsWith(" ") ? "" : " ";
      const newLine = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + suffix.length };
    }
    return this.current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }
  shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
    return this.current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
  }
}

class TaumelComposerEditor extends CustomEditor {
  controller;
  skillAutocompleteProvider;
  constructor(tui, theme, keybindings, controller) {
    super(tui, theme, keybindings);
    this.controller = controller;
    this.controller.latestTui = tui;
  }
  render(width) {
    return renderComposerInput(width, (innerWidth) => super.render(innerWidth), this.controller.settings.taumel.composer.enabled);
  }
  handleInput(data) {
    super.handleInput(data);
    if (shouldAutoTriggerSkillAutocomplete(this, data)) {
      this.tryTriggerAutocomplete?.(false);
    }
  }
  setAutocompleteProvider(provider) {
    const skillEntries = this.controller.skillEntries;
    if (!skillEntries) {
      super.setAutocompleteProvider(provider);
      return;
    }
    if (!this.skillAutocompleteProvider) {
      this.skillAutocompleteProvider = new SkillAutocompleteProvider(provider, skillEntries);
    } else {
      this.skillAutocompleteProvider.setBase(provider);
    }
    super.setAutocompleteProvider(this.skillAutocompleteProvider);
  }
}
function uiFromContext(ctx) {
  if (typeof ctx !== "object" || ctx === null)
    return;
  const context = ctx;
  if (context.hasUI !== true || typeof context.ui !== "object" || context.ui === null)
    return;
  return context.ui;
}
function requestRender(controller, ctx) {
  maybeCall(controller.latestTui, "requestRender");
  maybeCall(uiFromContext(ctx), "requestRender");
}
function listSkills(core, controller) {
  const result2 = decodeSkillListResult(core.call("listSkills", [{
    cwd: controller.latestCwd ?? process.cwd(),
    includeDisabled: false
  }]));
  return result2.skills.map(({ name, description, location }) => ({ name, description, location }));
}
function installSkillAutocomplete(_pi, core, controller) {
  controller.skillEntries = () => listSkills(core, controller);
}
function installComposerForContext(controller, ctx) {
  const context = typeof ctx === "object" && ctx !== null ? ctx : undefined;
  if (typeof context?.cwd === "string" && context.cwd !== "")
    controller.latestCwd = context.cwd;
  const ui = uiFromContext(ctx);
  if (!ui)
    return;
  const setEditorComponent = ui.setEditorComponent;
  if (typeof setEditorComponent !== "function")
    return;
  setTimeout(() => {
    setEditorComponent.call(ui, (tui, theme, keybindings) => new TaumelComposerEditor(tui, theme, keybindings, controller));
  }, 1);
}
async function createComposerController(pi) {
  const path = taumelGlobalSettingsPath();
  const controller = {
    path,
    settings: await readTaumelGlobalSettings(path)
  };
  const install = (_event, ctx) => installComposerForContext(controller, ctx);
  pi.on("session_start", install);
  pi.on("session_resume", install);
  pi.on("session_switch", install);
  return controller;
}
async function executeComposerCommand(core, controller, args, ctx) {
  if (!controller) {
    controller = { path: taumelGlobalSettingsPath(), settings: defaultTaumelGlobalSettings };
  }
  const result2 = decodeComposerCommandResult(core.call("handleComposerCommand", [{
    args,
    path: controller.path,
    settings: controller.settings
  }]));
  if (result2.kind === "error")
    return { ok: false, action: "command_result", message: result2.message, error: result2.message };
  if (result2.writeSettings) {
    const nextSettings = result2.settings;
    controller.settings = nextSettings;
    await writeTaumelComposerEnabled(controller.path, nextSettings.taumel.composer.enabled);
    requestRender(controller, ctx);
  }
  return { ok: true, action: "command_result", message: result2.message };
}

// src/host.ts
function makeHost(pi) {
  return {
    isExtensionActive: () => {
      try {
        pi.getThinkingLevel?.();
        return true;
      } catch {
        return false;
      }
    },
    resolveAuthorizationPath,
    on: (event, handler) => {
      pi.on(event, handler);
    },
    eventsOn: (event, handler) => pi.events.on(event, handler),
    emit: (event, payload) => {
      pi.events.emit(event, payload);
    },
    exec: (command, args, options) => pi.exec(command, args, options),
    setFooter: (ctx, factory) => {
      const context = objectLikeValue(ctx);
      const ui = objectLikeValue(context?.ui);
      const setFooter = ui?.setFooter;
      if (typeof setFooter !== "function")
        return;
      setFooter.call(ui, factory);
    },
    sessionSnapshot: (ctx) => {
      const context = objectLikeValue(ctx);
      const model = objectLikeValue(context?.model);
      const getContextUsage = context?.getContextUsage;
      const usage = typeof getContextUsage === "function" ? getContextUsage.call(ctx) : undefined;
      const usageRecord = objectLikeValue(usage);
      const noSandboxFlag = typeof pi.getFlag === "function" ? pi.getFlag("no-sandbox") : undefined;
      const thinking = pi.getThinkingLevel?.();
      return {
        cwd: typeof context?.cwd === "string" ? context.cwd : process.cwd(),
        provider: typeof model?.provider === "string" ? model.provider : "",
        ...typeof model?.id === "string" ? { model: model.id } : {},
        ...typeof thinking === "string" ? { thinking } : {},
        ...usageRecord?.percent !== undefined ? { contextPercent: usageRecord.percent } : {},
        ...usageRecord?.contextWindow !== undefined ? { contextWindow: usageRecord.contextWindow } : {},
        sandboxMode: stringFlag(pi, "sandbox-mode") ?? "",
        networkMode: stringFlag(pi, "network-mode") ?? "",
        ...noSandboxFlag !== undefined && noSandboxFlag !== null ? { noSandboxFlag: String(noSandboxFlag) } : {}
      };
    },
    getGitBranch: (footerData) => {
      const getGitBranch = objectLikeValue(footerData)?.getGitBranch;
      if (typeof getGitBranch !== "function")
        return "";
      const branch = getGitBranch.call(footerData);
      return typeof branch === "string" ? branch : "";
    },
    onBranchChange: (footerData, handler) => {
      const onBranchChange = objectLikeValue(footerData)?.onBranchChange;
      if (typeof onBranchChange !== "function")
        return () => {
          return;
        };
      const unsubscribe = onBranchChange.call(footerData, handler);
      return typeof unsubscribe === "function" ? () => {
        unsubscribe();
      } : () => {
        return;
      };
    },
    requestRender: (tui) => {
      const requestRender2 = objectLikeValue(tui)?.requestRender;
      if (typeof requestRender2 === "function")
        requestRender2.call(tui);
    },
    themeFg: (theme, color, value) => {
      const fg = objectLikeValue(theme)?.fg;
      if (typeof fg !== "function")
        return value;
      const rendered = fg.call(theme, color, value);
      return typeof rendered === "string" ? rendered : value;
    }
  };
}

// src/tool-executor.ts
import { join as join4 } from "node:path";
import { getAgentDir as getAgentDir3 } from "@earendil-works/pi-coding-agent";

// src/apply_patch.lark
var apply_patch_default = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

// src/tool-contract-model.ts
var schemaMetaKeys = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions"
]);
function primitiveType(value) {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    default:
      return;
  }
}
function collapseAnyOfEnum(anyOf) {
  if (!Array.isArray(anyOf) || anyOf.length === 0)
    return;
  const values = [];
  const types = new Set;
  for (const item of anyOf) {
    const schema = objectValue(item);
    if (schema === undefined || !Array.isArray(schema.enum) || schema.enum.length !== 1) {
      return;
    }
    const value = schema.enum[0];
    const type = typeof schema.type === "string" ? schema.type : primitiveType(value);
    if (type === undefined)
      return;
    values.push(value);
    types.add(type);
  }
  if (types.size !== 1)
    return;
  return { type: [...types][0], enum: values };
}
function modelToolSchema(value) {
  if (Array.isArray(value)) {
    return value.map((item) => modelToolSchema(item));
  }
  const schema = objectValue(value);
  if (schema !== undefined) {
    const result2 = {};
    const constValue = schema["const"];
    for (const [key, item] of Object.entries(schema)) {
      if (schemaMetaKeys.has(key) || key === "const")
        continue;
      result2[key] = modelToolSchema(item);
    }
    if (constValue !== undefined) {
      result2["enum"] = [constValue];
      if (result2["type"] === undefined) {
        const type = primitiveType(constValue);
        if (type !== undefined)
          result2["type"] = type;
      }
    }
    const collapsedAnyOf = collapseAnyOfEnum(result2["anyOf"]);
    if (collapsedAnyOf !== undefined) {
      delete result2["anyOf"];
      result2["type"] = collapsedAnyOf["type"];
      result2["enum"] = collapsedAnyOf["enum"];
    }
    return result2;
  }
  return value;
}
function toolParameters(schema) {
  const modeled = modelToolSchema(schema);
  return typeof modeled === "object" && modeled !== null ? modeled : {};
}

// src/tool-contract-catalog.ts
var toolContracts = [
  {
    name: "exec_command",
    label: "exec_command",
    description: "Run a shell command in a PTY. Returns completed output, or a session ID when the command is still running so it can be continued with write_stdin. Yielding does not stop the command.",
    promptSnippet: "Run shell commands in a PTY; continue live sessions with write_stdin.",
    promptGuidelines: [
      "Use exec_command for file operations like ls, rg, find, builds, tests, and development commands.",
      "Call write_stdin only when exec_command returns `Process running with session ID N`, and use that exact ID.",
      "If exec_command returns `Process exited with code N`, the command is complete; do not call write_stdin for it.",
      "Use write_stdin output_mode=status for quiet passive waits; use delta only to inspect output or send input."
    ],
    parameters: toolParameters(ExecCommandParamsSchema)
  },
  {
    name: "write_stdin",
    label: "write_stdin",
    description: "Send characters to or wait on an exec_command session and return recent output. Use output_mode=status for passive waits that should not add process output to your context; use delta only when you need to inspect the process’s progress or interact with it.",
    promptSnippet: "Send input to or wait on an exec_command session.",
    parameters: toolParameters(WriteStdinParamsSchema)
  },
  {
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply a patch to add, update, move, or delete one or more workspace files. Use the *** Begin Patch format.",
    promptSnippet: "Add, update, move, or delete workspace files with one patch.",
    parameters: toolParameters(ApplyPatchParamsSchema),
    constrainedSampling: { type: "grammar", variants: { openai_lark: apply_patch_default } }
  },
  {
    name: "read",
    label: "read",
    description: "Read a UTF-8 text file. Output is line-numbered and truncated to 2000 lines, 50KB total, and 2000 characters per line.",
    promptSnippet: "Read a line-numbered UTF-8 text file.",
    parameters: toolParameters(ReadParamsSchema)
  },
  {
    name: "view_media",
    label: "view_media",
    description: "View a PNG, JPEG, GIF, or WebP image.",
    promptSnippet: "View an image file.",
    parameters: toolParameters(ViewMediaParamsSchema)
  },
  {
    name: "write",
    label: "write",
    description: "Create, overwrite, or append to a UTF-8 text file. Parent directories are created as needed.",
    promptSnippet: "Create, overwrite, or append to a text file.",
    parameters: toolParameters(WriteParamsSchema)
  },
  {
    name: "edit",
    label: "edit",
    description: "Edit an existing text file with one or more exact text replacements.",
    promptSnippet: "Make one or more exact replacements in a text file.",
    parameters: toolParameters(EditParamsSchema)
  },
  {
    name: "get_plan",
    label: "get_plan",
    description: "Get the current plan for this thread, including status, automation state, tasks, token telemetry, elapsed active time, and optional time limit.",
    promptSnippet: "Inspect the current plan, tasks, status, usage, and automation state.",
    parameters: toolParameters(EmptyParamsSchema)
  },
  {
    name: "create_task",
    label: "create_task",
    description: "Create one or more tasks for the current plan. Tasks are the living breakdown of the work: order, dependencies, and completion state drive continuation and complete the plan when every task is completed or cancelled. Creating a task while no plan exists creates a draft plan; activate it with update_plan to start continuation. Tasks may be created while the plan is in draft, or to extend a completed plan once the turn in which it completed has ended; extending a completed plan reopens it to active.",
    promptSnippet: "Create one or more plan tasks while the plan is in draft or a completed plan is extension-unlocked.",
    parameters: toolParameters(CreateTaskParamsSchema)
  },
  {
    name: "update_task",
    label: "update_task",
    description: "Update one task's status, title, description, or dependencies. Content edits require a draft plan; status changes require an active or draft plan. Setting in_progress requires every depended task to be completed or cancelled. Mark a task completed only when its work is verifiably done; cancel tasks that are no longer needed, stating why. User-authored task text and cancellation are reserved to the user.",
    promptSnippet: "Update one plan task's status or content within editability rules.",
    parameters: toolParameters(UpdateTaskParamsSchema)
  },
  {
    name: "update_plan",
    label: "update_plan",
    description: "Update the plan lifecycle: activate a draft plan to commit its task list and start continuation, mark an active plan genuinely blocked, or return a blocked plan to active once its impasse is resolved. A plan completes automatically when every task is completed or cancelled.",
    promptSnippet: "Activate the plan, mark it genuinely blocked, or unblock it once the impasse is resolved.",
    parameters: toolParameters(UpdatePlanParamsSchema)
  },
  {
    name: "cron_create",
    label: "cron.create",
    description: "Schedule a prompt in this Pi session with a standard 5-field cron expression evaluated in the host’s local timezone. Tasks run only while the session is open.",
    promptSnippet: "Create a recurring or one-shot cron task. Tell the user the returned task id and that /cron manages crons.",
    parameters: toolParameters(CronCreateParamsSchema)
  },
  {
    name: "cron_list",
    label: "cron.list",
    description: "List this Pi session’s cron tasks and scheduling state.",
    promptSnippet: "List cron tasks.",
    parameters: toolParameters(EmptyParamsSchema)
  },
  {
    name: "cron_delete",
    label: "cron.delete",
    description: "Delete a scheduled cron task by ID.",
    promptSnippet: "Delete a cron task.",
    parameters: toolParameters(CronDeleteParamsSchema)
  },
  {
    name: "query_threads",
    label: "query_threads",
    description: "Search persisted Pi conversations by thread ID, title, visible messages, summaries, tool calls, tool results, and notifications. Use it to find relevant context from earlier threads before reading a specific thread with read_thread.",
    promptSnippet: "Search persisted Pi conversations for relevant prior context.",
    parameters: toolParameters(QueryThreadsParamsSchema)
  },
  {
    name: "read_thread",
    label: "read_thread",
    description: "Read a persisted Pi conversation by exact thread ID, unique ID prefix, or a locator returned by query_threads. Use overview for orientation, window for context around a hit, or full for paginated transcript recovery.",
    promptSnippet: "Read context from a specific persisted Pi conversation.",
    parameters: toolParameters(ReadThreadParamsSchema)
  },
  {
    name: "ralph_continue",
    label: "ralph_continue",
    description: "Advance Ralph session by one iteration.",
    promptSnippet: "Advance Ralph session to the next iteration.",
    parameters: toolParameters(RalphTaskParamsSchema)
  },
  {
    name: "ralph_finish",
    label: "ralph_finish",
    description: "Finish Ralph session.",
    promptSnippet: "Finish Ralph session.",
    parameters: toolParameters(RalphTaskParamsSchema)
  },
  {
    name: "web_search_exa",
    label: "exa.web_search",
    description: "Search Exa's web index and optionally extract highlights, summaries, or text from the results.",
    promptSnippet: "Search Exa's web index for current web, paper, company, people, and news results.",
    promptGuidelines: [
      "Keep numResults small unless broad coverage is necessary.",
      "Use contents.highlights or contents.summary before requesting full text.",
      "Use crawling_exa when you already have URLs or Exa document IDs."
    ],
    parameters: toolParameters(WebSearchExaParamsSchema)
  },
  {
    name: "crawling_exa",
    label: "exa.contents",
    description: "Fetch page contents, summaries, highlights, and metadata for URLs or Exa document IDs.",
    promptSnippet: "Fetch page contents with Exa when URLs or document IDs are already known.",
    promptGuidelines: [
      "Provide either urls or ids, not both.",
      "Request only the content fields needed for the task."
    ],
    parameters: toolParameters(CrawlingExaParamsSchema)
  },
  {
    name: "get_code_context_exa",
    label: "exa.code_context",
    description: "Get relevant code snippets and examples from Exa Code Context.",
    promptSnippet: "Search code, docs, GitHub, and Stack Overflow examples with Exa Code Context.",
    parameters: toolParameters(GetCodeContextExaParamsSchema)
  },
  {
    name: "exa_agent_create_run",
    label: "exa.agent.create_run",
    description: "Create an asynchronous Exa Agent research run. This always requires explicit user approval before the request is sent.",
    promptSnippet: "Create a long-running Exa Agent research or extraction run after user approval.",
    promptGuidelines: [
      "Use this only when a normal Exa search or contents fetch is not enough.",
      "Prefer low or medium effort unless the user explicitly needs deep research."
    ],
    parameters: toolParameters(ExaAgentCreateRunParamsSchema)
  },
  {
    name: "exa_agent_get_run",
    label: "exa.agent.get_run",
    description: "Retrieve an Exa Agent run by ID.",
    promptSnippet: "Poll or inspect an Exa Agent run by ID.",
    parameters: toolParameters(ExaAgentRunIdParamsSchema)
  },
  {
    name: "exa_agent_list_runs",
    label: "exa.agent.list_runs",
    description: "List Exa Agent runs for the configured team.",
    promptSnippet: "List recent Exa Agent runs.",
    parameters: toolParameters(ExaAgentListRunsParamsSchema)
  },
  {
    name: "exa_agent_cancel_run",
    label: "exa.agent.cancel_run",
    description: "Cancel a queued or running Exa Agent run.",
    promptSnippet: "Cancel an Exa Agent run by ID.",
    parameters: toolParameters(ExaAgentRunIdParamsSchema)
  },
  {
    name: "exa_agent_list_events",
    label: "exa.agent.list_events",
    description: "List stored events for an Exa Agent run.",
    promptSnippet: "List Exa Agent run events.",
    parameters: toolParameters(ExaAgentListEventsParamsSchema)
  },
  {
    name: "agent_spawn",
    label: "agent.spawn",
    description: "Create a durable generic agent for substantial delegated execution and start its first asynchronous run. The identity retains its conversation across later agent_send calls. The call returns after the initial instruction is accepted, without waiting for completion.",
    promptSnippet: "Start a durable generic agent for substantial asynchronous execution.",
    promptGuidelines: [
      "For agent_spawn, choose tier by task complexity and scope. Use low for straightforward, well-defined work: a one-file change or simple mechanical refactor across the codebase; bounded delegated internet research; or one known check or bounded evidence collection. Use medium for well-scoped work requiring reasoning across several files; focused independent research across multiple sources; or reproducing and verifying a workflow across several components. Use high for difficult, open-ended, or repository-wide work: broad cross-cutting changes; comprehensive independent research requiring broad source synthesis; or repository-wide failure investigation and validation. Medium is the default.",
      "Use agent_spawn for substantial delegated execution that does not fit finder or oracle, especially independent multi-step work, parallel disjoint work, or work with extensive intermediate output that the parent does not need.",
      "Use agent_spawn to create a new identity when substantial delegated execution has a materially different objective, files, component, or constraints and an existing agent's retained context would not help.",
      "When using agent_spawn, remember that the child has its own conversation and does not inherit the parent conversation. Include all relevant decisions, context, constraints, and validation instructions in message, or reference paths to files that contain them."
    ],
    parameters: toolParameters(AgentSpawnParamsSchema)
  },
  {
    name: "finder",
    label: "finder",
    description: "Create a durable, read-only Finder specialist and start an asynchronous run for conceptual, behavior-based, or multi-step discovery that correlates findings across files. The identity can be continued with agent_send; the call returns after the query is accepted, without waiting for completion.",
    promptSnippet: "Start a read-only Finder for conceptual, multi-file discovery.",
    promptGuidelines: [
      "Use finder for conceptual, behavior-based, or multi-file discovery that requires correlating findings across files. Do not use finder when the path, symbol, or exact text is known; use direct read or search tools instead."
    ],
    parameters: toolParameters(FinderParamsSchema)
  },
  {
    name: "oracle",
    label: "oracle",
    description: "Create a durable, read-only Oracle advisory specialist and start an asynchronous run for independent technical reasoning, judgment, critique, diagnosis, planning, review, or recommendations. The identity can be continued with agent_send; the call returns after the instruction is accepted, without waiting for completion.",
    promptSnippet: "Start a read-only Oracle for independent technical reasoning and advice.",
    promptGuidelines: [
      "Use oracle when the primary outcome is independent reasoning, judgment, critique, diagnosis, planning, review, or a recommendation rather than carrying out the resulting action."
    ],
    parameters: toolParameters(OracleParamsSchema)
  },
  {
    name: "agent_send",
    label: "agent.send",
    description: "Send an instruction to an existing open agent in its retained conversation. Depending on current state, the call starts new work, steers active work, resumes suspended work, interrupts and replaces active execution, or interrupts without replacement. A message requires a short user-facing description.",
    promptSnippet: "Continue, steer, resume, or interrupt an existing agent.",
    promptGuidelines: [
      "Use agent_send when new instructions, steering, interruption, or resumed work should target an existing open agent and retain its context.",
      "Prefer agent_send over starting a new agent when an existing agent's retained context is relevant to the next task, such as work on the same objective, files, component, or constraints."
    ],
    parameters: toolParameters(AgentSendParamsSchema)
  },
  {
    name: "agent_wait",
    label: "agent.wait",
    description: "Race selected agent runs and return every result ready at the observation point. Omitted timeout waits indefinitely; a timeout bounds only this call and never stops the runs. Call again with returned pending_run_ids to await later completions.",
    promptSnippet: "Wait for selected agent runs and retrieve ready outcomes.",
    promptGuidelines: [
      "Use agent_wait to retrieve outcomes and child output from selected runs, or to pause until at least one selected run is ready.",
      "Prefer one indefinite agent_wait call over repeated polling or agent_list checks when no useful work can proceed until a selected run finishes."
    ],
    parameters: toolParameters(AgentWaitParamsSchema)
  },
  {
    name: "agent_list",
    label: "agent.list",
    description: "List all open agent identities owned by the current session, including lifecycle status, per-run turn count, and observable activity phase, timing, and recommended next action.",
    promptSnippet: "Inspect open agent identities and their latest run activity.",
    promptGuidelines: [
      "Use agent_list when you need an overview of open agents before deciding which identity or run to wait for, continue, interrupt, resume, or close. Treat activity as observed progress, not a health or stall judgment."
    ],
    parameters: toolParameters(EmptyParamsSchema)
  },
  {
    name: "agent_close",
    label: "agent.close",
    description: "Permanently close one agent identity, interrupt active execution, and remove all of its runs from current Taumel state. By default, an agent worktree and its dedicated branch are preserved; optional worktree deletion removes only a clean, verified worktree and preserves its branch. Closed identities cannot be resumed; use agent_send interruption for a reversible stop.",
    promptSnippet: "Close and forget one agent identity.",
    promptGuidelines: [
      "Use agent_close when an open agent is no longer expected to receive related follow-up work."
    ],
    parameters: toolParameters(AgentCloseParamsSchema)
  }
];

// src/agent-run-registry.ts
var descriptions = new Map;
function rememberAgentDescription(agentId, description) {
  const cleaned = description?.trim() ?? "";
  if (agentId === "" || cleaned === "")
    return;
  descriptions.set(agentId, cleaned);
}
function agentDescriptionFor(agentId) {
  return descriptions.get(agentId);
}
function agentIdFromRunId(runId) {
  const match = /^(.*)-run-\d+$/.exec(runId);
  return match?.[1] ?? runId;
}

// src/tool-renderer-kit.ts
function isToolRenderFields(value) {
  return objectValue(value) !== undefined;
}
function themeFg(theme, color, value) {
  if (!isToolRenderFields(theme))
    return value;
  const fg = theme["fg"];
  if (typeof fg !== "function")
    return value;
  const rendered = fg.call(theme, color, value);
  return typeof rendered === "string" ? rendered : value;
}
function oneLine(value) {
  return value.replace(/\s+/g, " ").trim();
}
function textContent(result2) {
  if (!isToolRenderFields(result2) || !Array.isArray(result2["content"]))
    return "";
  const parts = [];
  for (const item of result2["content"]) {
    if (isToolRenderFields(item) && item["type"] === "text" && typeof item["text"] === "string") {
      parts.push(item["text"]);
    }
  }
  return parts.join(`
`);
}
function detailsRecord(result2) {
  return isToolRenderFields(result2) && isToolRenderFields(result2["details"]) ? result2["details"] : {};
}
function expandedFromOptions(options) {
  return isToolRenderFields(options) && options["expanded"] === true;
}
function headerSpec(name, subject, dotColor, theme, trailing = "") {
  const lead = `${themeFg(theme, dotColor, "•")} ${themeFg(theme, "toolTitle", name)} ${themeFg(theme, "dim", "·")} `;
  return { lead, subject, trailing };
}
function dotFromDetails(details) {
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");
  if (code !== undefined)
    return code === 0 ? "success" : "error";
  return boolFieldOrUndefined(details, "ok") === false ? "error" : "success";
}
function fullTextEntries(text, theme) {
  const cleaned = text.trimEnd();
  return cleaned === "" ? [] : cleaned.split(/\r?\n/).map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
}
function agentRunStatusColor(status) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "lost":
      return "error";
    case "suspended":
      return "warning";
    default:
      return "dim";
  }
}
function quotedQuery(args) {
  return `"${oneLine(stringFieldOrUndefined(args, "query") ?? "")}"`;
}
function planTaskStatusColor(status) {
  switch (status) {
    case "completed":
      return "success";
    case "in_progress":
      return "warning";
    case "cancelled":
      return "error";
    case "pending":
    default:
      return "dim";
  }
}
function planTaskCancellationDetail(task) {
  if (task.status !== "cancelled" || typeof task.cancellationReason !== "string")
    return;
  const reason = oneLine(task.cancellationReason);
  return reason === "" ? undefined : `Reason: ${reason}`;
}
function labeled(label, value, theme) {
  if (value === undefined || value.trim() === "")
    return [];
  return [{ text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", value)}` }];
}
function labeledText(label, value, theme) {
  if (value === undefined || value.trim() === "")
    return [];
  const lines = value.trimEnd().split(/\r?\n/);
  return [
    { text: `${themeFg(theme, "dim", `${label}:`)} ${themeFg(theme, "toolOutput", lines[0])}` },
    ...lines.slice(1).map((line) => ({ text: themeFg(theme, "toolOutput", line) }))
  ];
}
function formatTimestampValue(value, nowMs = Date.now()) {
  if (value === undefined || value === null)
    return;
  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = value > 1000000000000 ? value / 1000 : value;
    return formatLocalTime(seconds, nowMs);
  }
  if (typeof value !== "string")
    return;
  const trimmed = value.trim();
  if (trimmed === "")
    return;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric))
      return;
    const seconds = numeric > 1000000000000 ? numeric / 1000 : numeric;
    return formatLocalTime(seconds, nowMs);
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms))
    return;
  return formatLocalTime(ms / 1000, nowMs);
}
function labeledTimestamp(label, value, theme) {
  return labeled(label, formatTimestampValue(value), theme);
}
function planTaskRow(task, theme) {
  const id = stringFieldOrUndefined(task, "taskId") ?? "task";
  const title = stringFieldOrUndefined(task, "title") ?? "";
  const taskStatus = stringFieldOrUndefined(task, "status") ?? "unknown";
  const origin = stringFieldOrUndefined(task, "origin") ?? "unknown";
  const cancellation = planTaskCancellationDetail(task);
  const statusText = themeFg(theme, planTaskStatusColor(taskStatus), taskStatus);
  const entries = [{
    text: `${themeFg(theme, "dim", id)} ${themeFg(theme, "dim", "[")}${statusText}${themeFg(theme, "dim", `/${origin}]:`)} ${themeFg(theme, "toolOutput", title)}${cancellation === undefined ? "" : themeFg(theme, "dim", ` · ${cancellation}`)}`
  }];
  const dependencies = task["depends_on"];
  if (Array.isArray(dependencies) && dependencies.length > 0) {
    const deps = dependencies.filter((value) => typeof value === "string").join(", ");
    if (deps !== "")
      entries.push({ text: `  ${themeFg(theme, "dim", "Depends on:")} ${themeFg(theme, "toolOutput", deps)}` });
  }
  return entries;
}

// src/thread-sources.ts
import { constants as constants3 } from "node:fs";
import { open as open3, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute2, relative as relative2, resolve, sep as sep2 } from "node:path";
var THREAD_SCAN_BYTE_BUDGET = 512 * 1024 * 1024;
var THREAD_SOURCE_BYTE_LIMIT = 32 * 1024 * 1024;
var THREAD_CATALOG_BYTE_BUDGET = 64 * 1024 * 1024;
var THREAD_SCAN_CHUNK_BYTES = 64 * 1024;
var THREAD_DIAGNOSTIC_LIMIT = 20;
async function discoverCatalogFiles(scan) {
  const { root, maxDepth, maxFiles, suffix } = scan;
  const files = [];
  let visited = 0;
  const maxVisited = Math.max(1000, maxFiles * 20);
  async function visit(dir, depth) {
    if (files.length >= maxFiles || visited >= maxVisited || depth < 0)
      return;
    let directory;
    try {
      directory = await opendir(dir);
    } catch {
      return;
    }
    for await (const entry of directory) {
      visited += 1;
      if (files.length >= maxFiles || visited >= maxVisited)
        return;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path, depth - 1);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        files.push(path);
      }
    }
  }
  await visit(root, maxDepth);
  return files;
}
function threadCatalogFacts(ctx) {
  const context = objectValue(ctx);
  const cwd = context === undefined ? undefined : property(context, "cwd");
  const sessionManager = context === undefined ? undefined : objectValue(property(context, "sessionManager"));
  const getSessionDir = sessionManager === undefined ? undefined : property(sessionManager, "getSessionDir");
  const sessionDir = typeof getSessionDir === "function" ? getSessionDir.call(sessionManager) : undefined;
  return {
    cwd: typeof cwd === "string" ? cwd : "",
    home: homedir(),
    ...typeof sessionDir === "string" && sessionDir !== "" ? { override: sessionDir } : {}
  };
}
function sessionCatalogScans(core, ctx) {
  return [...decodeThreadCatalogScansResult(core.call("planThreadCatalogScans", [threadCatalogFacts(ctx)])).scans];
}
function diagnosticMessage(path, error) {
  return { kind: "diagnostic", path, error };
}
function boundedDiagnosticPush(sources, diagnostic2) {
  const count = sources.reduce((total, source) => total + (source.kind === "diagnostic" ? 1 : 0), 0);
  if (count < THREAD_DIAGNOSTIC_LIMIT)
    sources.push(diagnostic2);
}
function isRawJsonSearchSafe(query) {
  return /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/.test(query);
}
async function openRegularFile(path) {
  const handle = await open3(path, constants3.O_RDONLY | (constants3.O_NOFOLLOW ?? 0));
  const info = await handle.stat();
  if (!info.isFile()) {
    await handle.close();
    throw new Error("thread source is not a regular file");
  }
  return { handle, info };
}
async function fileContainsQuery(path, query, maxBytes) {
  const needle = query.toLowerCase();
  const { handle } = await openRegularFile(path);
  const buffer = Buffer.allocUnsafe(THREAD_SCAN_CHUNK_BYTES);
  let carry = "";
  let scanned = 0;
  try {
    while (scanned < maxBytes) {
      const length = Math.min(buffer.length, maxBytes - scanned);
      const { bytesRead } = await handle.read(buffer, 0, length, null);
      if (bytesRead === 0)
        return false;
      scanned += bytesRead;
      const text = (carry + buffer.subarray(0, bytesRead).toString("utf8")).toLowerCase();
      if (text.includes(needle))
        return true;
      carry = needle.length <= 1 ? "" : text.slice(-(needle.length - 1));
    }
    return false;
  } finally {
    await handle.close();
  }
}
async function sessionHeader(path) {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let handle;
  try {
    ({ handle } = await openRegularFile(path));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(`
`, 1)[0];
    if (!firstLine)
      return {};
    const header = JSON.parse(firstLine);
    const object = objectValue(header);
    const id = object === undefined ? undefined : property(object, "id");
    return {
      ...typeof id === "string" && id !== "" ? { id } : {},
      text: `${firstLine}
`
    };
  } catch {
    return {};
  } finally {
    await handle?.close();
  }
}
function pathIsWithin(path, root) {
  const offset = relative2(resolve(root), resolve(path));
  return offset === "" || offset !== ".." && !offset.startsWith(`..${sep2}`) && !isAbsolute2(offset);
}
async function catalogFiles(core, ctx, request) {
  const facts = threadCatalogFacts(ctx);
  const scans = sessionCatalogScans(core, ctx).filter((scan) => request.action !== "query_threads" || request.scope !== "current_workspace" || facts.override === undefined ? true : resolve(scan.root) === resolve(facts.override) || pathIsWithin(scan.root, facts.cwd));
  const paths = new Set;
  for (const scan of scans) {
    for (const path of await discoverCatalogFiles(scan))
      paths.add(path);
  }
  const files = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      files.push({ path, size: info.size, modifiedMs: info.mtimeMs });
    } catch {}
  }
  files.sort((left, right) => right.modifiedMs - left.modifiedMs || left.path.localeCompare(right.path));
  return files;
}
async function selectQueryFiles(files, request, diagnostics) {
  if (!isRawJsonSearchSafe(request.query))
    return [...files];
  const selected = [];
  let scannedBytes = 0;
  for (const file of files) {
    if (scannedBytes + file.size > THREAD_SCAN_BYTE_BUDGET) {
      boundedDiagnosticPush(diagnostics, diagnosticMessage(file.path, `thread scan exceeded ${THREAD_SCAN_BYTE_BUDGET} byte safety budget`));
      continue;
    }
    scannedBytes += file.size;
    try {
      const metadataMatches = file.path.toLowerCase().includes(request.query.toLowerCase());
      if (metadataMatches || await fileContainsQuery(file.path, request.query, file.size))
        selected.push(file);
    } catch (error) {
      boundedDiagnosticPush(diagnostics, diagnosticMessage(file.path, error instanceof Error ? error.message : String(error)));
    }
  }
  return selected;
}
async function selectReadFiles(files, request) {
  const sourcePath = request.locator?.sourcePath;
  if (sourcePath !== undefined)
    return files.filter((file) => file.path === sourcePath);
  const threadID = request.threadID.toLowerCase();
  const selected = [];
  for (const file of files) {
    const header = await sessionHeader(file.path);
    const fallback = file.path.split("/").at(-1)?.replace(/\.(jsonl|json)$/i, "");
    const id = header.id ?? fallback;
    if (id?.toLowerCase().startsWith(threadID))
      selected.push({ file, id });
  }
  const exact = selected.filter((candidate) => candidate.id.toLowerCase() === threadID);
  return (exact.length > 0 ? exact : selected).map((candidate) => candidate.file);
}
async function readSourceWithinLimit(file) {
  const { handle, info } = await openRegularFile(file.path);
  try {
    if (info.size > THREAD_SOURCE_BYTE_LIMIT)
      return { oversized: true };
    const buffer = Buffer.allocUnsafe(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0)
        break;
      offset += bytesRead;
    }
    return { text: buffer.subarray(0, offset).toString("utf8"), oversized: false };
  } finally {
    await handle.close();
  }
}
async function threadSources(core, ctx, request) {
  const sources = [];
  const files = await catalogFiles(core, ctx, request);
  const selected = request.action === "query_threads" ? await selectQueryFiles(files, request, sources) : await selectReadFiles(files, request);
  let loadedBytes = 0;
  for (const file of selected) {
    if (loadedBytes + file.size > THREAD_CATALOG_BYTE_BUDGET) {
      boundedDiagnosticPush(sources, diagnosticMessage(file.path, `thread catalog exceeded ${THREAD_CATALOG_BYTE_BUDGET} byte safety budget`));
      continue;
    }
    try {
      const read = await readSourceWithinLimit(file);
      if (read.oversized || read.text === undefined) {
        const header = await sessionHeader(file.path);
        if (request.action === "read_thread" && header.text !== undefined) {
          sources.push({ kind: "sessionFile", path: file.path, text: header.text });
        }
        boundedDiagnosticPush(sources, diagnosticMessage(file.path, `thread source exceeds ${THREAD_SOURCE_BYTE_LIMIT} byte safety limit`));
      } else {
        sources.push({ kind: "sessionFile", path: file.path, text: read.text });
        loadedBytes += read.text.length;
      }
    } catch (error) {
      boundedDiagnosticPush(sources, diagnosticMessage(file.path, error instanceof Error ? error.message : String(error)));
    }
  }
  return sources;
}

// src/tool-renderer.ts
import { structuredPatch } from "diff";
import { parseSkillBlock, SkillInvocationMessageComponent } from "@earendil-works/pi-coding-agent";

// src/render-layout.ts
import { truncateToWidth, visibleWidth as visibleWidth2, wrapTextWithAnsi } from "@earendil-works/pi-tui";
var RAIL_FIRST = "  └ ";
var RAIL_CONT = "    ";
var ELLIPSIS = "…";
var RESET_TEXT_STYLE = "\x1B[22;23;24;25;27;28;29;39m";
function normalizeTabs(value) {
  return value.replace(/\t/g, "   ");
}
function normalizeBlockTabs(block) {
  const lead = normalizeTabs(block.header.lead);
  const subject = normalizeTabs(block.header.subject);
  const trailing = normalizeTabs(block.header.trailing);
  const header = lead === block.header.lead && subject === block.header.subject && trailing === block.header.trailing ? block.header : { ...block.header, lead, subject, trailing };
  if (block.body === undefined)
    return header === block.header ? block : { header, body: undefined };
  const needsEntryNormalization = block.body.entries.some((entry) => entry.text.includes("\t"));
  if (!needsEntryNormalization) {
    return header === block.header ? block : { header, body: block.body };
  }
  const entries = block.body.entries.map((entry) => ({ ...entry, text: normalizeTabs(entry.text) }));
  const body = block.body.mode === "rail" ? { mode: "rail", entries } : { mode: "flush", entries, clip: block.body.clip };
  return { header, body };
}
function terminalSafeWidth(width) {
  const targetWidth = Math.max(1, width);
  return targetWidth > 1 ? targetWidth - 1 : targetWidth;
}
function truncateMiddlePlain(value, width) {
  if (visibleWidth2(value) <= width)
    return value;
  if (width <= 1)
    return truncateToWidth(value, width, ELLIPSIS);
  const chars = [...value];
  const keep = Math.max(0, width - visibleWidth2(ELLIPSIS));
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return `${chars.slice(0, left).join("")}${ELLIPSIS}${right === 0 ? "" : chars.slice(-right).join("")}`;
}
function layoutCollapsedHeader(header, width) {
  const trailing = header.trailing === "" ? "" : ` ${header.trailing}`;
  const full = header.subject === "" ? header.lead + header.trailing : header.lead + header.subject + trailing;
  if (visibleWidth2(full) <= width || header.subject === "" || trailing === "")
    return truncateToWidth(full, width, ELLIPSIS);
  const subjectWidth = Math.max(1, width - visibleWidth2(header.lead) - visibleWidth2(trailing));
  const subject = header.subjectClip === "middle" ? truncateMiddlePlain(header.subject, subjectWidth) : truncateToWidth(header.subject, subjectWidth, ELLIPSIS);
  return truncateToWidth(header.lead + subject + trailing, width, ELLIPSIS);
}
function layoutHeader(header, expanded, width) {
  const full = header.subject === "" ? header.lead + header.trailing : header.lead + header.subject + (header.trailing === "" ? "" : " " + header.trailing);
  if (!expanded) {
    return [layoutCollapsedHeader(header, width)];
  }
  if (visibleWidth2(full) <= width) {
    return [truncateToWidth(full, width, ELLIPSIS)];
  }
  const subjectStart = visibleWidth2(header.lead);
  const avail = Math.max(1, width - subjectStart);
  const indent = " ".repeat(subjectStart);
  const tail = header.subject === "" ? header.trailing : header.subject + (header.trailing === "" ? "" : " " + header.trailing);
  const wrapped = wrapTextWithAnsi(tail, avail);
  const lines = [header.lead + wrapped[0]];
  for (let index = 1;index < wrapped.length; index += 1) {
    lines.push(indent + wrapped[index]);
  }
  return lines;
}
function clampLine(line, width) {
  const clamped = visibleWidth2(line) > width ? truncateToWidth(line, width, ELLIPSIS) : line;
  return clamped.replace(/\x1b\[(?:0)?m/g, RESET_TEXT_STYLE);
}
function layoutRail(entries, expanded, width) {
  const contentWidth = Math.max(1, width - visibleWidth2(RAIL_FIRST));
  const lines = [];
  for (const entry of entries) {
    if (entry.exempt) {
      lines.push((lines.length === 0 ? RAIL_FIRST : RAIL_CONT) + entry.text);
    } else if (expanded) {
      for (const line of wrapTextWithAnsi(entry.text, contentWidth)) {
        lines.push((lines.length === 0 ? RAIL_FIRST : RAIL_CONT) + line);
      }
    } else {
      for (const line of entry.text.split(/\r?\n/)) {
        lines.push((lines.length === 0 ? RAIL_FIRST : RAIL_CONT) + truncateToWidth(line, contentWidth, ELLIPSIS));
      }
    }
  }
  return lines;
}
function layoutFlush(entries, clip, width) {
  const lines = [];
  for (const entry of entries) {
    if (entry.exempt || !clip) {
      lines.push(entry.text);
      continue;
    }
    for (const line of entry.text.split(/\r?\n/)) {
      lines.push(truncateToWidth(line, width, ELLIPSIS));
    }
  }
  return lines;
}
function renderBlock(block, expanded) {
  const normalizedBlock = normalizeBlockTabs(block);
  let cache;
  return {
    render(width) {
      if (cache !== undefined && cache.width === width)
        return cache.lines;
      const targetWidth = Math.max(1, width);
      const safeWidth = terminalSafeWidth(targetWidth);
      const lines = layoutHeader(normalizedBlock.header, expanded, safeWidth);
      if (normalizedBlock.body !== undefined) {
        if (normalizedBlock.body.mode === "rail") {
          lines.push(...layoutRail(normalizedBlock.body.entries, expanded, safeWidth));
        } else {
          lines.push(...layoutFlush(normalizedBlock.body.entries, normalizedBlock.body.clip, safeWidth));
        }
      }
      const clamped = lines.map((line) => clampLine(line, safeWidth));
      cache = { width, lines: clamped };
      return clamped;
    },
    invalidate() {
      cache = undefined;
    }
  };
}
function emptyComponent() {
  return {
    render(_width) {
      return [];
    },
    invalidate() {}
  };
}

// src/tool-renderer-domains.ts
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function boolState(value, trueText, falseText) {
  if (value === undefined)
    return;
  return value ? trueText : falseText;
}
function resultDescription(item) {
  const summary = stringFieldOrUndefined(item, "summary") ?? stringFieldOrUndefined(item, "text") ?? stringFieldOrUndefined(item, "content") ?? stringFieldOrUndefined(item, "description");
  if (summary !== undefined)
    return summary;
  const highlights = item["highlights"];
  return Array.isArray(highlights) ? highlights.find((part) => typeof part === "string") : undefined;
}
function buildPlan(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const plan = recordFieldOrUndefined(details, "plan");
  const planTasks = plan !== undefined ? recordArrayFieldOrEmpty(plan, "tasks") : [];
  const status = plan !== undefined ? stringFieldOrUndefined(plan, "statusLabel") ?? stringFieldOrUndefined(plan, "status") : undefined;
  const argTasks = recordArrayFieldOrEmpty(args, "tasks");
  const taskId = stringFieldOrUndefined(args, "taskId");
  const completed = plan !== undefined ? numberFieldOrUndefined(plan, "completedTasks") : undefined;
  const total = plan !== undefined ? numberFieldOrUndefined(plan, "totalTasks") : undefined;
  const progress = completed === undefined || total === undefined ? undefined : `${completed}/${total} tasks`;
  const createdTaskIds = Array.isArray(details["createdTaskIds"]) ? details["createdTaskIds"].filter((value) => typeof value === "string" && value !== "") : [];
  const createdTaskIdSet = new Set(createdTaskIds);
  let subject;
  if (name === "update_task" && taskId !== undefined) {
    const touched = planTasks.find((task) => stringFieldOrUndefined(task, "taskId") === taskId);
    const title = (touched !== undefined ? stringFieldOrUndefined(touched, "title") : undefined) ?? stringFieldOrUndefined(args, "title");
    subject = oneLine(title === undefined || title === "" ? taskId : `${taskId} · ${title}`);
  } else if (name === "create_task") {
    const createdParts = argTasks.map((task, index) => {
      const title = stringFieldOrUndefined(task, "title") ?? "";
      const explicitId = stringFieldOrUndefined(task, "id");
      const id = explicitId ?? createdTaskIds[index];
      if (title === "")
        return id ?? "";
      return id === undefined ? title : `${id} · ${title}`;
    }).filter(Boolean);
    subject = oneLine(createdParts.join(", ") || progress || name);
  } else {
    subject = oneLine(progress ?? stringFieldOrUndefined(args, "status") ?? name);
  }
  const header = headerSpec(name, subject, dotFromDetails(details), theme, status !== undefined ? themeFg(theme, "dim", `(${status})`) : "");
  if (!expanded)
    return { header, body: undefined };
  const entries = [];
  entries.push(...labeled("Status", status, theme));
  entries.push(...labeled("Progress", progress, theme));
  const automation = recordFieldOrUndefined(details, "automation");
  entries.push(...labeled("Automation", automation !== undefined ? stringFieldOrUndefined(automation, "continuation") : undefined, theme));
  if (details["accountingPending"] === true)
    entries.push(...labeled("Accounting", "final accounting pending", theme));
  const tokens = plan !== undefined ? numberFieldOrUndefined(plan, "tokensUsed") : undefined;
  const seconds = plan !== undefined ? numberFieldOrUndefined(plan, "timeUsedSeconds") : undefined;
  const timeUsage = plan !== undefined ? stringFieldOrUndefined(plan, "timeUsage") : undefined;
  const timeLimit = plan !== undefined ? numberFieldOrUndefined(plan, "timeLimitSeconds") : undefined;
  if (tokens !== undefined)
    entries.push(...labeled("Tokens", String(tokens), theme));
  if (timeUsage !== undefined)
    entries.push(...labeled("Active time", timeUsage, theme));
  else if (seconds !== undefined)
    entries.push(...labeled("Active time", `${seconds}s`, theme));
  if (timeLimit !== undefined)
    entries.push(...labeled("Time limit", `${timeLimit}s`, theme));
  const affectedTasks = (() => {
    if (name === "get_plan" || name === "update_plan")
      return planTasks;
    if (name === "create_task") {
      if (createdTaskIdSet.size > 0) {
        return planTasks.filter((task) => createdTaskIdSet.has(stringFieldOrUndefined(task, "taskId") ?? ""));
      }
      return planTasks.slice(Math.max(0, planTasks.length - argTasks.length));
    }
    if (name === "update_task" && taskId !== undefined) {
      return planTasks.filter((task) => stringFieldOrUndefined(task, "taskId") === taskId);
    }
    return planTasks;
  })();
  for (const task of affectedTasks)
    entries.push(...planTaskRow(task, theme));
  entries.push(...fullTextEntries(textContent(result2), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}
function cronTaskLine(task, theme) {
  const id = stringFieldOrUndefined(task, "id") ?? "task";
  const schedule = stringFieldOrUndefined(task, "schedule") ?? stringFieldOrUndefined(task, "cron") ?? "";
  const mode = stringFieldOrUndefined(task, "mode");
  const enabled = boolState(boolFieldOrUndefined(task, "enabled"), "enabled", "disabled");
  return [themeFg(theme, "toolOutput", id), schedule, mode, enabled].filter((part) => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `);
}
function cronTaskEntries(task, theme) {
  const entries = [{ text: cronTaskLine(task, theme) }];
  entries.push(...labeled("Cron", stringFieldOrUndefined(task, "cron"), theme));
  entries.push(...labeled("Recurrence", boolState(boolFieldOrUndefined(task, "recurring"), "recurring", "one-shot"), theme));
  entries.push(...labeled("Next due", stringFieldOrUndefined(task, "nextDueText"), theme));
  entries.push(...labeled("Prompt", stringFieldOrUndefined(task, "prompt"), theme));
  return entries;
}
function buildCron(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  if (name === "cron_delete") {
    const id2 = stringFieldOrUndefined(details, "id") ?? stringFieldOrUndefined(args, "id") ?? "";
    const deleted = boolFieldOrUndefined(details, "deleted") === true;
    const outcome = deleted ? "deleted" : "not found";
    const header2 = headerSpec(name, id2, dotFromDetails(details), theme, themeFg(theme, "dim", `(${outcome})`));
    return expanded ? { header: header2, body: { mode: "rail", entries: [...labeled("Task ID", id2, theme), ...labeled("Outcome", outcome, theme)] } } : { header: header2, body: undefined };
  }
  if (name === "cron_list") {
    const tasks = recordArrayFieldOrEmpty(details, "tasks");
    const enabled2 = boolFieldOrUndefined(details, "enabled") === true;
    const header2 = headerSpec(name, `${tasks.length} task${tasks.length === 1 ? "" : "s"}`, dotFromDetails(details), theme, themeFg(theme, "dim", `(${enabled2 ? "enabled" : "disabled"})`));
    if (!expanded)
      return { header: header2, body: undefined };
    const entries = [...labeled("Master switch", enabled2 ? "enabled" : "disabled", theme)];
    if (tasks.length === 0)
      entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
    tasks.forEach((task2, index) => {
      if (index > 0)
        entries.push({ text: "" });
      entries.push(...cronTaskEntries(task2, theme));
    });
    return { header: header2, body: { mode: "rail", entries } };
  }
  const task = recordFieldOrUndefined(details, "task") ?? details;
  const id = stringFieldOrUndefined(task, "id") ?? stringFieldOrUndefined(details, "id") ?? "";
  const schedule = stringFieldOrUndefined(task, "schedule") ?? stringFieldOrUndefined(task, "cron") ?? stringFieldOrUndefined(details, "schedule") ?? "";
  const enabled = boolState(boolFieldOrUndefined(task, "enabled") ?? boolFieldOrUndefined(details, "enabled"), "enabled", "disabled");
  const header = headerSpec(name, [id, schedule].filter((part) => part !== "").join(" · "), dotFromDetails(details), theme, enabled === undefined ? "" : themeFg(theme, "dim", `(${enabled})`));
  return expanded ? { header, body: { mode: "rail", entries: cronTaskEntries(task, theme) } } : { header, body: undefined };
}
function subjectFromThreadArgs(args) {
  const locator = recordFieldOrUndefined(args, "locator");
  const threadID = stringFieldOrUndefined(args, "threadID") ?? (locator !== undefined ? stringFieldOrUndefined(locator, "threadID") : undefined) ?? "";
  const mode = stringFieldOrUndefined(args, "mode") ?? "overview";
  return `${threadID} (${mode})`;
}
function buildQueryThreads(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const threads = recordArrayFieldOrEmpty(details, "threads");
  const hits = threads.reduce((total, thread) => total + recordArrayFieldOrEmpty(thread, "hits").length, 0);
  const header = headerSpec(name, quotedQuery(args), dotFromDetails(details), theme, themeFg(theme, "dim", `(${threads.length} thread${threads.length === 1 ? "" : "s"}, ${hits} hit${hits === 1 ? "" : "s"})`));
  if (!expanded)
    return { header, body: undefined };
  const entries = [];
  threads.slice(0, 30).forEach((thread, index) => {
    if (index > 0)
      entries.push({ text: "" });
    const title = stringFieldOrUndefined(thread, "title") ?? stringFieldOrUndefined(thread, "id") ?? `thread ${index + 1}`;
    const id = stringFieldOrUndefined(thread, "id");
    const workspace = stringFieldOrUndefined(thread, "workspace");
    const threadHits = recordArrayFieldOrEmpty(thread, "hits");
    const meta = [workspace, `${threadHits.length} hit${threadHits.length === 1 ? "" : "s"}`].filter((part) => part !== undefined && part !== "");
    entries.push({ text: `${themeFg(theme, "accent", String(index + 1))} ${themeFg(theme, "dim", "·")} ${themeFg(theme, "toolOutput", title)}${meta.length === 0 ? "" : ` ${themeFg(theme, "dim", "·")} ${themeFg(theme, "dim", meta.join(" · "))}`}` });
    entries.push(...labeled("ID", id, theme));
    for (const hit of threadHits) {
      const label = [stringFieldOrUndefined(hit, "kind") ?? "", stringFieldOrUndefined(hit, "role"), stringFieldOrUndefined(hit, "toolName")].filter((part) => part !== undefined && part !== "").join("/");
      entries.push({ text: themeFg(theme, "dim", `${label}: ${oneLine(stringFieldOrUndefined(hit, "snippet") ?? "")}`) });
    }
  });
  if (threads.length === 0)
    entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  if (threads.length > 30)
    entries.push({ text: themeFg(theme, "dim", `… ${threads.length - 30} more`), exempt: true });
  return { header, body: { mode: "rail", entries } };
}
function buildReadThread(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const diagnostics = recordArrayFieldOrEmpty(details, "diagnostics");
  const cursor = stringFieldOrUndefined(details, "cursor");
  const facts = [diagnostics.length > 0 ? `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}` : undefined, cursor !== undefined ? "more available" : undefined].filter((part) => part !== undefined);
  const baseSubject = subjectFromThreadArgs(args);
  const subject = facts.length === 0 ? baseSubject : baseSubject.replace(/\)$/, `, ${facts.join(", ")})`);
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  if (!expanded)
    return { header, body: undefined };
  const entries = [];
  const thread = recordFieldOrUndefined(details, "thread");
  if (thread !== undefined) {
    entries.push(...labeled("Title", stringFieldOrUndefined(thread, "title"), theme));
    const messages = numberFieldOrUndefined(thread, "messageCount") ?? numberFieldOrUndefined(thread, "message_count");
    entries.push(...labeled("Messages", messages === undefined ? undefined : String(messages), theme));
  }
  entries.push(...fullTextEntries(textContent(result2), theme));
  if (diagnostics.length > 0) {
    entries.push({ text: "" });
    entries.push(...labeled("Diagnostics", String(diagnostics.length), theme));
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}
function buildRalph(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const taskId = stringFieldOrUndefined(details, "taskId") ?? stringFieldOrUndefined(args, "task_id") ?? "";
  const iteration = numberFieldOrUndefined(details, "iteration");
  const maxIterations = numberFieldOrUndefined(details, "maxIterations") ?? numberFieldOrUndefined(details, "max_iterations");
  const reflectionEvery = numberFieldOrUndefined(details, "reflectionEvery") ?? numberFieldOrUndefined(details, "reflection_every");
  const facts = [iteration !== undefined ? `iteration ${iteration}` : undefined, stringFieldOrUndefined(details, "status")].filter((part) => part !== undefined && part !== "");
  const header = headerSpec(name, taskId, dotFromDetails(details), theme, facts.length > 0 ? themeFg(theme, "dim", `(${facts.join(" · ")})`) : "");
  if (!expanded)
    return { header, body: undefined };
  const entries = [
    ...labeled("Iteration", iteration === undefined ? undefined : String(iteration), theme),
    ...labeled("Status", stringFieldOrUndefined(details, "status"), theme)
  ];
  if (boolFieldOrUndefined(details, "reflection") === true)
    entries.push(...labeled("Reflection", "true", theme));
  entries.push(...labeled("Max iterations", maxIterations === undefined ? undefined : String(maxIterations), theme));
  entries.push(...labeled("Reflection every", reflectionEvery === undefined ? undefined : String(reflectionEvery), theme));
  entries.push(...fullTextEntries(textContent(result2), theme));
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}
function exaResults(details) {
  const response = recordFieldOrUndefined(details, "response") ?? {};
  return recordArrayFieldOrEmpty(response, "results");
}
function buildExaSearch(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const results = exaResults(details);
  const urls = args["urls"];
  const ids = args["ids"];
  const subject = name === "crawling_exa" ? `${Array.isArray(urls) ? urls.length : Array.isArray(ids) ? ids.length : results.length} ${Array.isArray(urls) ? "urls" : "ids"}` : quotedQuery(args);
  const header = headerSpec(name, subject, dotFromDetails(details), theme, themeFg(theme, "dim", `(${results.length} result${results.length === 1 ? "" : "s"})`));
  if (!expanded)
    return { header, body: undefined };
  const entries = [];
  results.slice(0, 10).forEach((item, index) => {
    if (index > 0)
      entries.push({ text: "" });
    const title = stringFieldOrUndefined(item, "title") ?? stringFieldOrUndefined(item, "url") ?? `result ${index + 1}`;
    const url = stringFieldOrUndefined(item, "url") ?? "";
    entries.push({ text: `${themeFg(theme, "accent", String(index + 1))} ${themeFg(theme, "dim", "·")} ${themeFg(theme, "toolOutput", title)}${url === "" ? "" : ` ${themeFg(theme, "dim", "·")} ${themeFg(theme, "dim", domainOf(url))}`}` });
    entries.push(...labeled("URL", url, theme));
    entries.push(...labeled("Summary", resultDescription(item), theme));
  });
  if (entries.length === 0)
    entries.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}
function buildCodeContext(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const response = recordFieldOrUndefined(details, "response") ?? {};
  const text = stringFieldOrUndefined(response, "response") ?? textContent(result2);
  const lineCount = text === "" ? 0 : text.trimEnd().split(/\r?\n/).length;
  const header = headerSpec(name, quotedQuery(args), dotFromDetails(details), theme, lineCount > 0 ? themeFg(theme, "dim", `(${lineCount} lines)`) : "");
  return expanded ? { header, body: { mode: "rail", entries: fullTextEntries(text, theme) } } : { header, body: undefined };
}
function responseObject(details) {
  return recordFieldOrUndefined(details, "response") ?? {};
}
function buildExaAgent(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const response = responseObject(details);
  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    const data = recordArrayFieldOrEmpty(response, "data");
    const items = data.length > 0 ? data : recordArrayFieldOrEmpty(response, "results");
    const subject = name === "exa_agent_list_events" ? `${stringFieldOrUndefined(args, "id") ?? "run"} (${items.length} event${items.length === 1 ? "" : "s"})` : `recent runs (${items.length})`;
    const header2 = headerSpec(name, subject, dotFromDetails(details), theme);
    if (!expanded)
      return { header: header2, body: undefined };
    const entries2 = [];
    items.forEach((item, index) => {
      if (index > 0)
        entries2.push({ text: "" });
      const title = stringFieldOrUndefined(item, "title") ?? stringFieldOrUndefined(item, "type") ?? stringFieldOrUndefined(item, "id") ?? `item ${index + 1}`;
      const when = formatTimestampValue(item["createdAt"] ?? item["updatedAt"] ?? item["timestamp"] ?? item["created_at"] ?? item["updated_at"]);
      entries2.push({ text: [themeFg(theme, "toolOutput", title), stringFieldOrUndefined(item, "status"), when].filter((part) => part !== undefined && part !== "").join(` ${themeFg(theme, "dim", "·")} `) });
      entries2.push(...labeled("Summary", resultDescription(item), theme));
    });
    if (entries2.length === 0)
      entries2.push({ text: themeFg(theme, "dim", "(none)"), exempt: true });
    return { header: header2, body: { mode: "rail", entries: entries2 } };
  }
  if (name === "exa_agent_cancel_run")
    return { header: headerSpec(name, `${stringFieldOrUndefined(args, "id") ?? ""} (cancelled)`, dotFromDetails(details), theme), body: undefined };
  const id = stringFieldOrUndefined(response, "id") ?? stringFieldOrUndefined(args, "id") ?? "";
  const status = stringFieldOrUndefined(response, "status");
  const header = headerSpec(name, status !== undefined ? `${id} · ${status}` : id, dotFromDetails(details), theme);
  if (!expanded)
    return { header, body: undefined };
  const output = recordFieldOrUndefined(response, "output");
  const text = output !== undefined ? stringFieldOrUndefined(output, "text") ?? "" : stringFieldOrUndefined(response, "response") ?? "";
  const entries = [
    ...labeled("Run ID", id, theme),
    ...labeled("Status", status, theme),
    ...labeledTimestamp("Created", response["createdAt"] ?? response["created_at"], theme),
    ...labeledTimestamp("Updated", response["updatedAt"] ?? response["updated_at"], theme),
    ...labeled("Error", stringFieldOrUndefined(response, "error"), theme),
    ...fullTextEntries(text, theme)
  ];
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}
function agentListEntries(item, theme) {
  const status = stringFieldOrUndefined(item, "status") ?? stringFieldOrUndefined(item, "latest_run_status");
  const activity = recordFieldOrUndefined(item, "activity");
  const activityState = activity === undefined ? undefined : stringFieldOrUndefined(activity, "state");
  const showActivity = status === "running" && activityState !== undefined && activityState !== "" && activityState !== "inactive";
  const turns = numberFieldOrUndefined(item, "turn_count") ?? numberFieldOrUndefined(item, "turnCount");
  return [
    ...labeled("Agent", stringFieldOrUndefined(item, "agent_id"), theme),
    ...labeled("Kind", stringFieldOrUndefined(item, "kind"), theme),
    ...labeled("Status", status, theme),
    ...labeled("Activity", showActivity ? activityState : undefined, theme),
    ...labeled("Description", stringFieldOrUndefined(item, "description"), theme),
    ...labeled("Run ID", stringFieldOrUndefined(item, "run_id") ?? stringFieldOrUndefined(item, "latest_run_id"), theme),
    ...labeled("Turns", turns === undefined ? undefined : String(turns), theme),
    ...labeled("Model", stringFieldOrUndefined(item, "model"), theme),
    ...labeled("Thinking", stringFieldOrUndefined(item, "thinking"), theme),
    ...labeled("Workspace", stringFieldOrUndefined(item, "workspace"), theme)
  ];
}
function agentResultEntries(item, theme) {
  const duration = formatWaitDuration(item["duration_ms"]);
  return [
    ...labeled("Agent", stringFieldOrUndefined(item, "agent_id"), theme),
    ...labeled("Run ID", stringFieldOrUndefined(item, "run_id"), theme),
    ...labeled("Kind", stringFieldOrUndefined(item, "kind"), theme),
    ...labeled("Model", stringFieldOrUndefined(item, "model"), theme),
    ...labeled("Thinking", stringFieldOrUndefined(item, "thinking"), theme),
    ...labeled("Status", stringFieldOrUndefined(item, "status"), theme),
    ...labeled("Turns", numberFieldOrUndefined(item, "turn_count")?.toString(), theme),
    ...labeled("Tool calls", numberFieldOrUndefined(item, "tool_call_count")?.toString(), theme),
    ...labeled("Failed tool calls", numberFieldOrUndefined(item, "failed_tool_call_count")?.toString(), theme),
    ...labeled("Duration", duration === "" ? undefined : duration, theme)
  ];
}
function buildAgent(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const agents = recordArrayFieldOrEmpty(details, "agents");
  const results = recordArrayFieldOrEmpty(details, "results");
  const agentId = stringFieldOrUndefined(details, "agentId") ?? stringFieldOrUndefined(args, "agent_id") ?? "";
  const runId = stringFieldOrUndefined(details, "runId") ?? "";
  const kind = stringFieldOrUndefined(details, "kind") ?? (name === "finder" || name === "oracle" ? name : "generic");
  const status = stringFieldOrUndefined(details, "status") ?? stringFieldOrUndefined(details, "outcome");
  let dotColor = dotFromDetails(details);
  let subject;
  let trailing = "";
  if (name === "agent_list")
    subject = `${agents.length} agent${agents.length === 1 ? "" : "s"}`;
  else if (name === "agent_wait") {
    const pending = Array.isArray(details["pending_run_ids"]) ? details["pending_run_ids"].length : 0;
    const total = results.length + pending;
    const singleRun = results.length === 1 && pending === 0 ? results[0] : undefined;
    if (singleRun !== undefined) {
      const runStatus = stringFieldOrUndefined(singleRun, "status") ?? "";
      const runReason = stringFieldOrUndefined(singleRun, "reason");
      const statusText = runReason !== undefined && runStatus !== "completed" ? `${runStatus} (${runReason})` : runStatus;
      const duration = formatWaitDuration(singleRun["duration_ms"]);
      dotColor = agentRunStatusColor(runStatus);
      subject = [
        stringFieldOrUndefined(singleRun, "agent_id") ?? agentId,
        statusText,
        duration
      ].filter((part) => part !== "").join(" · ");
    } else {
      subject = `${total} run${total === 1 ? "" : "s"}`;
      trailing = themeFg(theme, "dim", `(${results.length} ready, ${pending} pending)`);
    }
  } else if (name === "agent_spawn") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "finder" || name === "oracle") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "agent_send") {
    subject = [agentId, stringFieldOrUndefined(args, "description")].filter((part) => part !== undefined && part !== "").join(" · ");
  } else if (name === "agent_close") {
    subject = agentId;
    trailing = status === undefined ? "" : themeFg(theme, "dim", `(${status})`);
  } else {
    subject = [agentId, runId, kind, status].filter((part) => part !== "").join(" · ");
  }
  const header = headerSpec(name, subject, dotColor, theme, trailing);
  if (!expanded)
    return { header, body: undefined };
  const entries = [];
  if (agents.length > 0) {
    agents.forEach((agent, index) => {
      if (index > 0)
        entries.push({ text: "" });
      entries.push(...agentListEntries(agent, theme));
    });
  } else if (results.length > 0) {
    results.forEach((run, index) => {
      if (index > 0)
        entries.push({ text: "" });
      entries.push(...agentResultEntries(run, theme));
      entries.push(...labeledTimestamp("Started", run["started_at"] ?? run["startedAt"], theme));
      entries.push(...labeledTimestamp("Ended", run["ended_at"] ?? run["endedAt"] ?? run["suspended_at"] ?? run["suspendedAt"], theme));
      entries.push(...labeled("Reason", stringFieldOrUndefined(run, "reason"), theme));
      entries.push(...labeled("Error", stringFieldOrUndefined(run, "error"), theme));
      entries.push(...labeledText("Response", stringFieldOrUndefined(run, "output"), theme));
      entries.push(...labeledText("Partial response", stringFieldOrUndefined(run, "partial_output"), theme));
    });
  } else if (name === "agent_close") {
    entries.push(...labeled("Agent", agentId, theme));
    entries.push(...labeled("Status", status, theme));
    entries.push(...labeled("Permanent closure", "confirmed", theme));
  } else {
    entries.push(...agentResultEntries({
      agent_id: agentId,
      run_id: runId,
      kind,
      model: details["model"],
      thinking: details["thinking"],
      status
    }, theme));
    entries.push(...labeled("Description", stringFieldOrUndefined(args, "description"), theme));
    if (name === "finder") {
      entries.push(...labeledText("Query", stringFieldOrUndefined(args, "query"), theme));
    } else {
      entries.push(...labeledText("Message", stringFieldOrUndefined(args, "message"), theme));
    }
  }
  return { header, body: entries.length === 0 ? undefined : { mode: "rail", entries } };
}
function buildDomainResult(name, result2, options, theme, args) {
  if (["agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close", "finder", "oracle"].includes(name)) {
    return buildAgent(name, result2, options, theme, args);
  }
  if (name === "get_plan" || name === "create_task" || name === "update_task" || name === "update_plan")
    return buildPlan(name, result2, options, theme, args);
  if (name.startsWith("cron_"))
    return buildCron(name, result2, options, theme, args);
  if (name === "query_threads")
    return buildQueryThreads(name, result2, options, theme, args);
  if (name === "read_thread")
    return buildReadThread(name, result2, options, theme, args);
  if (name === "ralph_continue" || name === "ralph_finish")
    return buildRalph(name, result2, options, theme, args);
  if (name === "get_code_context_exa")
    return buildCodeContext(name, result2, options, theme, args);
  if (name === "web_search_exa" || name === "crawling_exa")
    return buildExaSearch(name, result2, options, theme, args);
  if (name.startsWith("exa_agent_"))
    return buildExaAgent(name, result2, options, theme, args);
  return;
}
// src/tool-renderer.ts
function sentCharsSubject(value) {
  let escaped = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32)
      escaped += `^${String.fromCharCode(code + 64)}`;
    else if (code === 127)
      escaped += "^?";
    else
      escaped += char;
  }
  return oneLine(escaped) || JSON.stringify(value);
}
function argsFromContext(context) {
  return isToolRenderFields(context) && isToolRenderFields(context["args"]) ? context["args"] : {};
}
var agentToolNames = ["agent_spawn", "finder", "oracle", "agent_send", "agent_wait", "agent_list", "agent_close"];
var agentResultRenderedKey = "taumelAgentResultRendered";
function agentRenderState(name, context) {
  if (!agentToolNames.includes(name) || !isToolRenderFields(context))
    return;
  const state = context["state"];
  return isToolRenderFields(state) ? state : undefined;
}
function hideAfterAgentResult(component, state) {
  return {
    render(width) {
      return state[agentResultRenderedKey] === true ? [] : component.render(width);
    },
    invalidate() {
      component.invalidate();
    }
  };
}
function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function pathHeaderSpec(name, subject, dotColor, theme, trailing = "") {
  return { ...headerSpec(name, subject, dotColor, theme, trailing), subjectClip: "middle" };
}
function moreLine(count, theme, unit) {
  return themeFg(theme, "dim", `… ${count} ${unit}`);
}
function appendDiffLines(entries, lines, limit = lines.length) {
  for (let index = 0;index < Math.min(lines.length, limit); index += 1) {
    entries.push({ text: lines[index] });
  }
}
function subjectFromArgs(name, args) {
  switch (name) {
    case "exec_command":
      return oneLine(stringFieldOrUndefined(args, "cmd") ?? "exec_command");
    case "write_stdin": {
      const chars = stringFieldOrUndefined(args, "chars") ?? "";
      if (chars !== "")
        return sentCharsSubject(chars);
      const sid = numberFieldOrUndefined(args, "session_id");
      const verb = stringFieldOrUndefined(args, "output_mode") === "status" ? "wait" : "poll";
      return sid === undefined ? verb : `${verb} session ${sid}`;
    }
    case "write":
    case "edit":
    case "read":
    case "view_media":
      return stringFieldOrUndefined(args, "path") ?? "";
    case "apply_patch":
      return oneLine(stringFieldOrUndefined(args, "input") ?? stringFieldOrUndefined(args, "patch") ?? "patch");
    case "create_task": {
      const tasks = recordArrayFieldOrEmpty(args, "tasks");
      return oneLine(tasks.map((task) => {
        const title = stringFieldOrUndefined(task, "title") ?? "";
        const id = stringFieldOrUndefined(task, "id");
        if (title === "")
          return id ?? "";
        return id === undefined ? title : `${id} · ${title}`;
      }).filter(Boolean).join(", "));
    }
    case "update_task": {
      const taskId = stringFieldOrUndefined(args, "taskId") ?? "";
      const title = stringFieldOrUndefined(args, "title");
      return title === undefined || title === "" ? taskId : `${taskId} · ${title}`;
    }
    case "update_plan":
      return stringFieldOrUndefined(args, "status") ?? "";
    case "query_threads":
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return quotedQuery(args);
    case "read_thread": {
      const locator = recordFieldOrUndefined(args, "locator");
      const threadID = stringFieldOrUndefined(args, "threadID") ?? (locator !== undefined ? stringFieldOrUndefined(locator, "threadID") : undefined) ?? "";
      const mode = stringFieldOrUndefined(args, "mode") ?? "overview";
      return `${threadID} (${mode})`;
    }
    case "ralph_continue":
    case "ralph_finish":
      return stringFieldOrUndefined(args, "task_id") ?? "";
    case "crawling_exa": {
      const urls = Array.isArray(args["urls"]) ? args["urls"].length : 0;
      const ids = Array.isArray(args["ids"]) ? args["ids"].length : 0;
      return urls > 0 ? `${urls} url${urls === 1 ? "" : "s"}` : `${ids} id${ids === 1 ? "" : "s"}`;
    }
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return stringFieldOrUndefined(args, "id") ?? "";
    case "exa_agent_list_runs":
      return args["limit"] === undefined ? "recent runs" : `limit ${args["limit"]}`;
    case "agent_spawn": {
      const handle = stringFieldOrUndefined(args, "agent_id") ?? "";
      const description = stringFieldOrUndefined(args, "description") ?? "";
      return [handle, description].filter((part) => part !== "").join(" · ");
    }
    case "finder":
    case "oracle":
      return oneLine(stringFieldOrUndefined(args, "message") ?? name);
    case "agent_send":
    case "agent_close":
      return stringFieldOrUndefined(args, "agent_id") ?? "";
    case "agent_wait": {
      const runIds = stringArrayFieldOrEmpty(args, "run_ids");
      const first = runIds[0];
      if (runIds.length === 1 && first !== undefined) {
        const awaitedAgentId = agentIdFromRunId(first);
        const awaitedDescription = agentDescriptionFor(awaitedAgentId);
        return [awaitedAgentId, awaitedDescription ?? ""].filter((part) => part !== "").join(" · ");
      }
      return `${runIds.length} run${runIds.length === 1 ? "" : "s"}`;
    }
    case "agent_list":
      return "agents";
    default:
      return "";
  }
}
function countChanges(hunks) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const raw of hunk.lines) {
      if (raw[0] === "+")
        added += 1;
      else if (raw[0] === "-")
        removed += 1;
    }
  }
  return { added, removed };
}
function renderDiff(before, after, expanded, theme) {
  const context = expanded ? 3 : 2;
  let patch;
  try {
    patch = structuredPatch("", "", before ?? "", after ?? "", "", "", { context });
  } catch {
    patch = { hunks: [] };
  }
  const { added, removed } = countChanges(patch.hunks);
  let maxLine = 0;
  for (const hunk of patch.hunks) {
    maxLine = Math.max(maxLine, hunk.newStart + hunk.newLines, hunk.oldStart + hunk.oldLines);
  }
  const width = Math.max(2, String(maxLine).length);
  const codeAt = (marker, _oldLine, _newLine, raw) => {
    const plain = raw.slice(1);
    if (marker === "+")
      return themeFg(theme, "toolDiffAdded", plain);
    if (marker === "-")
      return themeFg(theme, "toolDiffRemoved", plain);
    return themeFg(theme, "toolOutput", plain);
  };
  const lines = [];
  const markers = [];
  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      if (raw[0] === "\\")
        continue;
      const marker = raw[0];
      const num = marker === "+" ? newLine : marker === "-" ? oldLine : newLine;
      const codeStr = codeAt(marker, oldLine, newLine, raw);
      if (marker === "+")
        newLine += 1;
      else if (marker === "-")
        oldLine += 1;
      else {
        oldLine += 1;
        newLine += 1;
      }
      const gutter = themeFg(theme, "dim", `  ${String(num).padStart(width)}`);
      const markColor = marker === "+" ? "toolDiffAdded" : marker === "-" ? "toolDiffRemoved" : "dim";
      const mark = themeFg(theme, markColor, marker);
      lines.push(`${gutter} ${mark} ${codeStr}`);
      markers.push(marker);
    }
  }
  return { added, removed, lines, markers };
}
function diffCounts(before, after) {
  if (before === after)
    return { added: 0, removed: 0 };
  try {
    const patch = structuredPatch("", "", before ?? "", after ?? "", "", "", { context: 0 });
    return countChanges(patch.hunks);
  } catch {
    return { added: 0, removed: 0 };
  }
}
function tailEntries(text, expanded, theme, cap, expandedCap) {
  const cleaned = (text ?? "").trimEnd();
  if (cleaned === "")
    return [{ text: themeFg(theme, "dim", "(no output)") }];
  const all = cleaned.split(/\r?\n/);
  const limit = expanded ? expandedCap : cap;
  if (all.length <= limit)
    return all.map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
  const entries = [{ text: moreLine(all.length - limit, theme, "more lines"), exempt: true }];
  for (let index = all.length - limit;index < all.length; index += 1) {
    entries.push({ text: themeFg(theme, "toolOutput", all[index]) });
  }
  return entries;
}
function buildShell(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const subject = subjectFromArgs(name, args);
  const sid = numberFieldOrUndefined(details, "sessionId") ?? numberFieldOrUndefined(details, "session_id");
  const code = numberFieldOrUndefined(details, "exitCode") ?? numberFieldOrUndefined(details, "code");
  const outputMode = stringFieldOrUndefined(details, "outputMode") ?? stringFieldOrUndefined(args, "output_mode") ?? "delta";
  if (name === "write_stdin" && outputMode === "status") {
    const suppressedLines = numberFieldOrUndefined(details, "suppressedLines") ?? 0;
    const suppressedBytes = numberFieldOrUndefined(details, "suppressedBytes") ?? 0;
    const state = sid !== undefined ? "running" : code !== undefined ? `exit ${code}` : "completed";
    const trailing = themeFg(theme, "dim", `(${state}, suppressed ${suppressedLines} line${suppressedLines === 1 ? "" : "s"} / ${suppressedBytes} bytes)`);
    return {
      header: headerSpec(name, subjectFromArgs(name, args), sid !== undefined ? "warning" : dotFromDetails(details), theme, trailing),
      body: undefined
    };
  }
  if (name === "exec_command" && sid !== undefined && code === undefined) {
    return { header: headerSpec(name, subject, "warning", theme, themeFg(theme, "dim", `(session ${sid})`)), body: undefined };
  }
  const header = headerSpec(name, subject, dotFromDetails(details), theme);
  const output = stringFieldOrUndefined(details, "output") ?? textContent(result2);
  if (name === "write_stdin") {
    const chars = stringFieldOrUndefined(args, "chars") ?? "";
    if (chars.trim() === "" && output.trim() === "") {
      return { header, body: { mode: "rail", entries: [{ text: themeFg(theme, "dim", "(still running, no new output)"), exempt: true }] } };
    }
  }
  return { header, body: { mode: "rail", entries: tailEntries(output, expanded, theme, 5, 1e5) } };
}
function buildRead(result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const path = stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const total = numberFieldOrUndefined(details, "totalLines");
  const start = numberFieldOrUndefined(details, "startLine");
  const shown = numberFieldOrUndefined(details, "shownLines");
  const lineFact = total === undefined ? "" : start !== undefined && shown !== undefined && shown < total ? `(lines ${start}–${start + shown - 1} of ${total})` : `(${total} line${total === 1 ? "" : "s"})`;
  const header = pathHeaderSpec("read", path, dotFromDetails(details), theme, lineFact === "" ? "" : themeFg(theme, "dim", lineFact));
  if (!expanded)
    return { header, body: undefined };
  const rawText = textContent(result2);
  const physical = rawText.trimEnd().split(/\r?\n/);
  const entries = physical.map((line) => ({ text: themeFg(theme, "toolOutput", line) }));
  if (entries.length === 0)
    return { header, body: undefined };
  return { header, body: { mode: "rail", entries } };
}
function buildViewMedia(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const path = stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const width = numberFieldOrUndefined(details, "width");
  const height = numberFieldOrUndefined(details, "height");
  const originalWidth = numberFieldOrUndefined(details, "originalWidth");
  const originalHeight = numberFieldOrUndefined(details, "originalHeight");
  const wasResized = boolFieldOrUndefined(details, "wasResized") === true;
  const dimensions = width === undefined || height === undefined ? "" : wasResized && originalWidth !== undefined && originalHeight !== undefined ? `(${originalWidth}x${originalHeight} → ${width}x${height})` : `(${width}x${height})`;
  const header = pathHeaderSpec(name, path, dotFromDetails(details), theme, dimensions === "" ? "" : themeFg(theme, "dim", dimensions));
  if (!expanded)
    return { header, body: undefined };
  const mime = stringFieldOrUndefined(details, "mime") ?? stringFieldOrUndefined(details, "mimeType") ?? stringFieldOrUndefined(details, "type");
  const payloadBytes = numberFieldOrUndefined(details, "payloadBytes") ?? numberFieldOrUndefined(details, "base64Bytes") ?? numberFieldOrUndefined(details, "encodedBytes");
  const entries = [
    ...labeled("Path", path, theme),
    ...labeled("Type", mime, theme),
    ...labeled("Original", originalWidth !== undefined && originalHeight !== undefined ? `${originalWidth}x${originalHeight}` : undefined, theme),
    ...labeled("Processed", width !== undefined && height !== undefined ? `${width}x${height}` : undefined, theme),
    ...labeled("Resized", wasResized ? "yes" : "no", theme),
    ...labeled("Payload", payloadBytes !== undefined ? `${payloadBytes} bytes` : undefined, theme)
  ];
  for (const entry of fullTextEntries(textContent(result2), theme))
    entries.push(entry);
  return { header, body: { mode: "rail", entries } };
}
function buildWrite(result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const path = stringFieldOrUndefined(details, "displayPath") ?? stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const mode = stringFieldOrUndefined(details, "mode");
  const contents = stringFieldOrUndefined(details, "contents") ?? "";
  const lines = contents === "" ? [] : contents.trimEnd().split(/\r?\n/);
  const lineCount = lines.length;
  const trailing = themeFg(theme, "dim", mode === "append" ? `(append, ${lineCount} line${lineCount === 1 ? "" : "s"})` : `(${lineCount} line${lineCount === 1 ? "" : "s"})`);
  const header = pathHeaderSpec("write", path, dotFromDetails(details), theme, trailing);
  if (contents.trim() === "")
    return { header, body: undefined };
  const limit = expanded ? lines.length : Math.min(lines.length, 3);
  const entries = [];
  for (let index = 0;index < limit; index += 1) {
    entries.push({ text: themeFg(theme, "toolOutput", lines[index]) });
  }
  if (lines.length > limit)
    entries.push({ text: moreLine(lines.length - limit, theme, "more lines"), exempt: true });
  return { header, body: { mode: "rail", entries } };
}
function buildEdit(result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const path = stringFieldOrUndefined(details, "displayPath") ?? stringFieldOrUndefined(details, "path") ?? stringFieldOrUndefined(args, "path") ?? "";
  const before = stringFieldOrUndefined(details, "before");
  const after = stringFieldOrUndefined(details, "after");
  if (before === undefined || after === undefined) {
    const editCount = numberFieldOrUndefined(details, "editCount");
    const summary = editCount !== undefined ? `${editCount} replacement${editCount === 1 ? "" : "s"}` : "";
    return {
      header: pathHeaderSpec("edit", path, dotFromDetails(details), theme),
      body: summary === "" ? undefined : { mode: "rail", entries: [{ text: themeFg(theme, "dim", summary), exempt: true }] }
    };
  }
  const diff = renderDiff(before, after, expanded, theme);
  const header = pathHeaderSpec("edit", path, dotFromDetails(details), theme, themeFg(theme, "dim", `(+${diff.added} -${diff.removed})`));
  if (!expanded && diff.lines.length > 6) {
    const entries2 = [];
    appendDiffLines(entries2, diff.lines, 6);
    entries2.push({ text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true });
    return {
      header,
      body: { mode: "flush", clip: true, entries: entries2 }
    };
  }
  const entries = [];
  appendDiffLines(entries, diff.lines);
  return { header, body: { mode: "flush", clip: true, entries } };
}
function buildApplyPatch(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const writes = recordArrayFieldOrEmpty(details, "writes").map((write) => ({
    path: stringFieldOrUndefined(write, "path") ?? "",
    before: stringFieldOrUndefined(write, "before") ?? "",
    after: stringFieldOrUndefined(write, "contents") ?? stringFieldOrUndefined(write, "after") ?? ""
  }));
  const deletes = stringArrayFieldOrEmpty(details, "deletes");
  const deletedFiles = recordArrayFieldOrEmpty(details, "deletedFiles").map((file) => ({
    path: stringFieldOrUndefined(file, "path") ?? "",
    before: stringFieldOrUndefined(file, "before") ?? "",
    after: ""
  }));
  const dotColor = dotFromDetails(details);
  if (boolFieldOrUndefined(details, "ok") === false && writes.length === 0 && deletes.length === 0) {
    const errorText = textContent(result2) || stringFieldOrUndefined(details, "error") || compactJson(details);
    const entries2 = expanded ? fullTextEntries(errorText, theme) : [{ text: themeFg(theme, "toolOutput", oneLine(errorText) || "apply_patch failed") }];
    return {
      header: headerSpec(name, subjectFromArgs(name, args), dotColor, theme),
      body: { mode: "rail", entries: entries2 }
    };
  }
  if (writes.length === 0 && deletes.length === 0) {
    return { header: headerSpec(name, subjectFromArgs(name, args), dotColor, theme), body: undefined };
  }
  const files = [...writes];
  const deletedPathsWithContents = new Set;
  for (const file of deletedFiles) {
    deletedPathsWithContents.add(file.path);
    files.push(file);
  }
  for (const path of deletes) {
    if (!deletedPathsWithContents.has(path))
      files.push({ path, before: "", after: "" });
  }
  let totalAdded = 0;
  let totalRemoved = 0;
  const perFile = files.map((file) => {
    const { added, removed } = diffCounts(file.before, file.after);
    totalAdded += added;
    totalRemoved += removed;
    return { ...file, added, removed };
  });
  const fileCount = perFile.length;
  const header = headerSpec(name, `${fileCount} file${fileCount === 1 ? "" : "s"}`, dotColor, theme, themeFg(theme, "dim", `(+${totalAdded} -${totalRemoved})`));
  if (!expanded) {
    if (perFile.length === 1) {
      const file = perFile[0];
      const diff = renderDiff(file.before, file.after, false, theme);
      const singleHeader = pathHeaderSpec(name, file.path, dotColor, theme, themeFg(theme, "dim", `(+${diff.added} -${diff.removed})`));
      const entries3 = [];
      if (diff.lines.length > 6) {
        appendDiffLines(entries3, diff.lines, 6);
        entries3.push({ text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true });
        return {
          header: singleHeader,
          body: { mode: "flush", clip: true, entries: entries3 }
        };
      }
      appendDiffLines(entries3, diff.lines);
      return { header: singleHeader, body: { mode: "flush", clip: true, entries: entries3 } };
    }
    const entries2 = [];
    perFile.forEach((file, index) => {
      if (index > 0)
        entries2.push({ text: "", exempt: true });
      entries2.push({ text: `${themeFg(theme, "dim", "  └ ")}${themeFg(theme, "toolOutput", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}` });
      const diff = renderDiff(file.before, file.after, false, theme);
      appendDiffLines(entries2, diff.lines, 6);
      if (diff.lines.length > 6) {
        entries2.push({ text: `  ${moreLine(diff.lines.length - 6, theme, "more lines")}`, exempt: true });
      }
    });
    return { header, body: { mode: "flush", clip: true, entries: entries2 } };
  }
  const entries = [];
  perFile.forEach((file, index) => {
    if (index > 0)
      entries.push({ text: "", exempt: true });
    entries.push({ text: `${themeFg(theme, "dim", "  └ ")}${themeFg(theme, "toolOutput", file.path)} ${themeFg(theme, "dim", `(+${file.added} -${file.removed})`)}` });
    const diff = renderDiff(file.before, file.after, true, theme);
    appendDiffLines(entries, diff.lines);
  });
  return { header, body: { mode: "flush", clip: true, entries } };
}
function buildGeneric(name, result2, options, theme, args) {
  const expanded = expandedFromOptions(options);
  const details = detailsRecord(result2);
  const text = textContent(result2);
  const header = headerSpec(name, subjectFromArgs(name, args), dotFromDetails(details), theme);
  const body = expanded ? text === "" ? compactJson(details) : text : text;
  return { header, body: { mode: "rail", entries: tailEntries(body, expanded, theme, 5, 200) } };
}
function attrValue(content, pattern) {
  const match = pattern.exec(content);
  return match ? match[1] : undefined;
}
function parseSkillAttrs(rawAttrs) {
  const name = attrValue(rawAttrs, /\bname="([^"]*)"/);
  const location = attrValue(rawAttrs, /\blocation="([^"]*)"/);
  return name !== undefined && location !== undefined ? { name, location } : undefined;
}
function parseSkillBlocks(content) {
  const re = /<skill\b([^>]*)>\s*References are relative to [^\n]*\.\s*\n\n([\s\S]*?)\n<\/skill>/g;
  const blocks = [];
  let match;
  while ((match = re.exec(content)) !== null) {
    const attrs = parseSkillAttrs(match[1]);
    if (attrs !== undefined)
      blocks.push({ ...attrs, body: match[2] });
  }
  const childTag = /<skill>\s*<name>([\s\S]*?)<\/name>\s*<path>([\s\S]*?)<\/path>\s*([\s\S]*?)\s*<\/skill>/g;
  while ((match = childTag.exec(content)) !== null) {
    const name = match[1].trim();
    const location = match[2].trim();
    const body = match[3].trim();
    if (name !== "" && location !== "" && body !== "")
      blocks.push({ name, location, body });
  }
  return blocks;
}
function skillMessageRenderer() {
  return (message, options, theme) => {
    const content = isToolRenderFields(message) ? stringFieldOrUndefined(message, "content") ?? "" : "";
    const parsed = parseSkillBlock(content);
    if (parsed !== null) {
      try {
        const component = new SkillInvocationMessageComponent(parsed);
        if (typeof component.setExpanded === "function")
          component.setExpanded(expandedFromOptions(options));
        return component;
      } catch {}
    }
    const skills = parseSkillBlocks(content);
    if (skills.length === 0)
      return;
    const expanded = expandedFromOptions(options);
    const skill = skills[0];
    const details = detailsRecord(message);
    const trigger = stringFieldOrUndefined(details, "trigger") ?? `$${skill.name}`;
    const parent = stringFieldOrUndefined(details, "parent");
    const provenance = parent === undefined ? `Skill "${skill.name}" was injected automatically by the harness because the user mentioned ${trigger}.` : `Skill "${skill.name}" was injected automatically by the harness because $${parent} mentions $${skill.name}.`;
    const origin = parent === undefined ? `auto from ${trigger}` : `auto via $${parent}`;
    return renderBlock({
      header: {
        lead: themeFg(theme, "info", "• skill: "),
        subject: skill.name,
        trailing: themeFg(theme, "dim", expanded ? skill.location : `${origin} (expand)`)
      },
      body: expanded ? { mode: "rail", entries: tailEntries(`${provenance}

${skill.body}`, true, theme, 5, 1e5) } : undefined
    }, expanded);
  };
}
function buildNotificationBlock(message, options, theme) {
  const content = isToolRenderFields(message) ? stringFieldOrUndefined(message, "content") ?? "" : "";
  if (content === "")
    return;
  const expanded = expandedFromOptions(options);
  const execMatch = /^Command session ([0-9]+) has finished\./.exec(content);
  let agent;
  try {
    const value = JSON.parse(content);
    if (isToolRenderFields(value) && value.event === "agent_completion")
      agent = value;
  } catch {
    agent = undefined;
  }
  const name = execMatch !== null ? "exec_completion" : agent !== undefined ? "agent_completion" : "notification";
  const subject = execMatch !== null ? `session ${execMatch[1]}` : agent !== undefined ? [stringFieldOrUndefined(agent, "agent_id"), stringFieldOrUndefined(agent, "description")].filter((part) => part !== undefined && part !== "").join(" · ") : "ready";
  const trailing = execMatch !== null ? themeFg(theme, "dim", "(ready)") : "";
  const status = agent === undefined ? undefined : stringFieldOrUndefined(agent, "status");
  const dot = agent === undefined ? "muted" : status === "completed" ? "success" : status === "failed" || status === "lost" ? "error" : "muted";
  const execEntries = execMatch === null ? [] : [
    ...labeled("Session", execMatch[1], theme),
    ...labeled("Status", "finished", theme)
  ];
  const agentEntries = agent === undefined ? [] : [
    ...labeled("Agent", stringFieldOrUndefined(agent, "agent_id"), theme),
    ...labeled("Run ID", stringFieldOrUndefined(agent, "run_id"), theme),
    ...labeled("Description", stringFieldOrUndefined(agent, "description"), theme),
    ...labeled("Status", status, theme)
  ];
  return {
    header: headerSpec(name, subject, dot, theme, trailing),
    body: expanded ? { mode: "rail", entries: agent !== undefined ? agentEntries : execMatch !== null ? execEntries : tailEntries(content, true, theme, 6, 1e5) } : undefined
  };
}
function notificationMessageRenderer() {
  return (message, options, theme) => {
    const block = buildNotificationBlock(message, options, theme);
    return block === undefined ? undefined : renderBlock(block, expandedFromOptions(options));
  };
}
function planContinuationDot(status) {
  if (status === "complete")
    return "success";
  if (status === "blocked")
    return "error";
  return "warning";
}
function planContinuationMessageRenderer() {
  return (message, options, theme) => {
    if (!isToolRenderFields(message))
      return;
    const details = detailsRecord(message);
    const plan = recordFieldOrUndefined(details, "plan");
    const content = stringFieldOrUndefined(message, "content") ?? "";
    if (plan === undefined || content === "")
      return;
    const lifecycleStatus = stringFieldOrUndefined(plan, "status");
    const statusLabel = stringFieldOrUndefined(plan, "statusLabel") ?? lifecycleStatus ?? "";
    const completed = numberFieldOrUndefined(plan, "completedTasks");
    const total = numberFieldOrUndefined(plan, "totalTasks");
    const time = stringFieldOrUndefined(plan, "timeUsage") ?? "";
    const progress = completed === undefined || total === undefined ? "" : `${completed}/${total} tasks`;
    const summary = [progress, statusLabel, time].filter((part) => part !== "").join(" · ");
    const expanded = expandedFromOptions(options);
    let body = undefined;
    if (expanded) {
      const entries = [];
      entries.push(...labeled("Status", statusLabel === "" ? undefined : statusLabel, theme));
      entries.push(...labeled("Progress", progress === "" ? undefined : progress, theme));
      const automation = recordFieldOrUndefined(details, "automation");
      const continuation = automation !== undefined ? stringFieldOrUndefined(automation, "continuation") : undefined;
      entries.push(...labeled("Automation", continuation, theme));
      entries.push(...labeled("Active time", time === "" ? undefined : time, theme));
      const tasks = recordArrayFieldOrEmpty(plan, "tasks");
      const unfinished = tasks.filter((task) => {
        const taskStatus = stringFieldOrUndefined(task, "status");
        return taskStatus === "pending" || taskStatus === "in_progress";
      });
      if (unfinished.length > 0) {
        if (entries.length > 0)
          entries.push({ text: "" });
        for (const task of unfinished)
          entries.push(...planTaskRow(task, theme));
      }
      entries.push({ text: themeFg(theme, "dim", "── sent to agent ──") });
      entries.push(...fullTextEntries(content, theme));
      body = { mode: "rail", entries };
    }
    const block = {
      header: headerSpec("plan.continue", summary, planContinuationDot(lifecycleStatus), theme),
      body
    };
    return renderBlock(block, expanded);
  };
}
function buildCronFireBlock(message, options, theme) {
  const expanded = expandedFromOptions(options);
  const details = isToolRenderFields(message) ? detailsRecord(message) : {};
  const id = stringFieldOrUndefined(details, "id") ?? "";
  const schedule = stringFieldOrUndefined(details, "schedule") ?? "";
  const coalesced = numberFieldOrUndefined(details, "coalesced") ?? 1;
  const prompt = stringFieldOrUndefined(details, "prompt") ?? (isToolRenderFields(message) ? stringFieldOrUndefined(message, "content") : undefined) ?? "";
  if (id === "" && prompt === "")
    return;
  const subject = schedule === "" ? id : `${id} · ${schedule}`;
  const trailing = coalesced > 1 ? themeFg(theme, "dim", `(${coalesced} coalesced)`) : "";
  const header = headerSpec("cron.fire", subject, "muted", theme, trailing);
  if (!expanded)
    return { header, body: undefined };
  const cronExpr = stringFieldOrUndefined(details, "cron");
  const entries = [
    ...labeled("Task ID", id === "" ? undefined : id, theme),
    ...labeled("Cron", cronExpr, theme),
    ...labeled("Schedule", schedule === "" ? undefined : schedule, theme),
    ...labeled("Coalesced", coalesced > 1 ? String(coalesced) : undefined, theme)
  ];
  if (prompt !== "") {
    entries.push({ text: "" });
    entries.push({ text: themeFg(theme, "dim", "Prompt:"), exempt: true });
    entries.push(...fullTextEntries(prompt, theme));
  }
  return { header, body: { mode: "rail", entries } };
}
function cronFireMessageRenderer() {
  return (message, options, theme) => {
    const block = buildCronFireBlock(message, options, theme);
    return block === undefined ? undefined : renderBlock(block, expandedFromOptions(options));
  };
}
function progressText(name) {
  if (name === "agent_wait")
    return "waiting for agents";
  if (name === "agent_spawn" || name === "finder" || name === "oracle")
    return "starting agent";
  if (name.startsWith("exa_") || name.endsWith("_exa"))
    return "waiting for Exa";
  if (name === "query_threads")
    return "searching threads";
  if (name === "read_thread")
    return "reading thread";
  if (name === "read")
    return "reading";
  if (name === "view_media")
    return "viewing image";
  return "running";
}
function buildResult(name, result2, options, theme, args) {
  if (name === "exec_command" || name === "write_stdin")
    return buildShell(name, result2, options, theme, args);
  if (name === "read")
    return buildRead(result2, options, theme, args);
  if (name === "view_media")
    return buildViewMedia(name, result2, options, theme, args);
  if (name === "write")
    return buildWrite(result2, options, theme, args);
  if (name === "edit")
    return buildEdit(result2, options, theme, args);
  if (name === "apply_patch")
    return buildApplyPatch(name, result2, options, theme, args);
  const domain = buildDomainResult(name, result2, options, theme, args);
  if (domain !== undefined)
    return domain;
  return buildGeneric(name, result2, options, theme, args);
}
function renderersForTool(name) {
  return {
    renderCall(args, theme, context) {
      if (isToolRenderFields(context) && context["isPartial"] === false)
        return emptyComponent();
      const callArgs = isToolRenderFields(args) ? args : {};
      const header = headerSpec(name, subjectFromArgs(name, callArgs), "warning", theme, themeFg(theme, "dim", `(${progressText(name)})`));
      const component = renderBlock({ header, body: undefined }, false);
      const state = agentRenderState(name, context);
      return state === undefined ? component : hideAfterAgentResult(component, state);
    },
    renderResult(result2, options, theme, context) {
      const state = agentRenderState(name, context);
      if (state !== undefined)
        state[agentResultRenderedKey] = true;
      const expanded = expandedFromOptions(options);
      if (isToolRenderFields(options) && options["isPartial"] === true) {
        const args2 = argsFromContext(context);
        const header = headerSpec(name, subjectFromArgs(name, args2), "warning", theme, themeFg(theme, "dim", `(${progressText(name)})`));
        return renderBlock({ header, body: undefined }, false);
      }
      const args = argsFromContext(context);
      const renderedResult = isToolRenderFields(context) && context["isError"] === true && isToolRenderFields(result2) ? { ...result2, details: { ...detailsRecord(result2), ok: false } } : result2;
      return renderBlock(buildResult(name, renderedResult, options, theme, args), expanded);
    }
  };
}

// src/approval-coordinator.ts
var binding;
var active;
var topLevelQueue = [];
var agentQueue = [];
function removeQueued(request) {
  const queue = request.origin === "top-level" ? topLevelQueue : agentQueue;
  const index = queue.indexOf(request);
  if (index < 0)
    return false;
  queue.splice(index, 1);
  return true;
}
function settle(request, outcome) {
  if (request.settled === true)
    return;
  request.settled = true;
  if (request.abortListener !== undefined) {
    request.sourceSignal?.removeEventListener("abort", request.abortListener);
  }
  request.resolve(outcome);
}
function fail(request, error) {
  if (request.settled === true)
    return;
  request.settled = true;
  if (request.abortListener !== undefined) {
    request.sourceSignal?.removeEventListener("abort", request.abortListener);
  }
  request.reject(error);
}
function settleQueued(outcome) {
  for (const queue of [topLevelQueue, agentQueue]) {
    for (const request of queue.splice(0))
      settle(request, outcome);
  }
}
function drain() {
  if (active !== undefined || binding === undefined)
    return;
  const request = topLevelQueue.shift() ?? agentQueue.shift();
  if (request === undefined)
    return;
  if (request.ownerSessionId !== binding.ownerSessionId) {
    settle(request, "unavailable");
    drain();
    return;
  }
  if (!request.validate()) {
    settle(request, "replan");
    drain();
    return;
  }
  active = request;
  (async () => {
    let outcome;
    try {
      outcome = await request.run(binding.ui, request.controller.signal);
    } catch (error) {
      if (active === request)
        active = undefined;
      fail(request, error);
      drain();
      return;
    }
    if (active !== request)
      return;
    if ((outcome === "approved" || outcome === "approved_always") && !request.validate()) {
      active = undefined;
      settle(request, "replan");
      drain();
      return;
    }
    if ((outcome === "approved" || outcome === "approved_always") && request.commit !== undefined) {
      try {
        await request.commit(outcome);
      } catch (error) {
        if (active === request)
          active = undefined;
        fail(request, error);
        drain();
        return;
      }
    }
    if (active !== request)
      return;
    active = undefined;
    settle(request, outcome);
    drain();
  })();
}
function bindHarnessApprovalUi(ownerSessionId, hasUi, rawUi) {
  if (ownerSessionId === undefined || !hasUi || typeof rawUi !== "object" || rawUi === null) {
    clearHarnessApprovalUi();
    return;
  }
  const ui = rawUi;
  if (typeof ui.confirm !== "function") {
    clearHarnessApprovalUi();
    return;
  }
  if (binding !== undefined && binding.ownerSessionId !== ownerSessionId)
    clearHarnessApprovalUi();
  binding = { ownerSessionId, ui };
  drain();
}
function clearHarnessApprovalUi(ownerSessionId) {
  if (ownerSessionId !== undefined && binding?.ownerSessionId !== ownerSessionId)
    return;
  binding = undefined;
  settleQueued("unavailable");
  if (active !== undefined) {
    const request = active;
    active = undefined;
    request.controller.abort();
    settle(request, "unavailable");
  }
}
function requestHarnessApproval(options) {
  const ownerSessionId = options.ownerSessionId;
  if (ownerSessionId === undefined || binding?.ownerSessionId !== ownerSessionId) {
    return Promise.resolve("unavailable");
  }
  if (options.signal?.aborted === true)
    return Promise.resolve("interrupted");
  return new Promise((resolve2, reject) => {
    const request = {
      ownerSessionId,
      origin: options.origin,
      agentId: options.agentId,
      run: options.run,
      commit: options.commit,
      validate: options.validate ?? (() => true),
      resolve: resolve2,
      reject,
      controller: new AbortController,
      sourceSignal: options.signal
    };
    const abort = () => {
      if (removeQueued(request)) {
        settle(request, "interrupted");
        return;
      }
      if (active === request) {
        active = undefined;
        request.controller.abort();
        settle(request, "interrupted");
        drain();
      }
    };
    request.abortListener = abort;
    options.signal?.addEventListener("abort", abort, { once: true });
    (options.origin === "top-level" ? topLevelQueue : agentQueue).push(request);
    drain();
  });
}
function cancelAgentApprovals(ownerSessionId, agentId) {
  if (ownerSessionId === undefined || agentId === "")
    return;
  for (const queue of [topLevelQueue, agentQueue]) {
    for (let index = queue.length - 1;index >= 0; index -= 1) {
      const request = queue[index];
      if (request.ownerSessionId !== ownerSessionId || request.agentId !== agentId)
        continue;
      queue.splice(index, 1);
      settle(request, "interrupted");
    }
  }
  if (active?.ownerSessionId === ownerSessionId && active.agentId === agentId) {
    const request = active;
    active = undefined;
    request.controller.abort();
    settle(request, "interrupted");
    drain();
  }
}

// src/child-sessions.ts
import {
  createAgentSession as createPiAgentSession,
  DefaultResourceLoader,
  getAgentDir as getAgentDir2,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import { realpathSync as realpathSync2, statSync } from "node:fs";
import { isAbsolute as isAbsolute3, relative as relative3, sep as sep3 } from "node:path";
import { fileURLToPath } from "node:url";

// resources/agents/finder.md
var finder_default = `# Finder

You are Finder, a parallel discovery agent.

## Task

Find files and line ranges relevant to the current query.

## Execution Strategy

- Search through the workspace with the tools available to you.
- Return relevant filenames and ranges. Do not explore the complete workspace to construct an essay.
- Locate the relevant files and sections; do not recommend changes or solve the broader engineering task.
- Follow any explicit scope and success criteria in the query when deciding what to search and when to stop.
- Parallelize independent searches with diverse, scoped strategies.
- Minimize iterations and return as soon as you have enough information. Do not continue searching once you have sufficient results.
- **Be exhaustive when completeness is implied**: When the task asks for "all", "every", "each", or otherwise implies a complete list, find every occurrence rather than only the first match. Search breadth-first across the workspace.
- **Scope searches aggressively**: Prefer searches limited to likely directories and file types over broad root-level traversal.
- **Avoid repeated repository-wide scans**: Do not spend multiple searches repeating broad root-level filename scans. Prefer content search first or narrow to likely directories.

## Output Format

- **Ultra concise**: Give a brief summary of at most 1–2 lines, followed by the relevant files.
- Format each file using its resolved absolute path and line range: \`/actual/workspace/path/file.ts:12-58\`. Never invent or assume a workspace root.
- Include line ranges when you can identify relevant sections, especially for large files. For small files or when the entire file is relevant, the range may be omitted.
- **Use generous ranges**: Extend ranges to capture complete relevant sections such as functions, classes, or blocks. Include 5–10 lines of context above and below the match.`;

// resources/agents/oracle.md
var oracle_default = `# Oracle

You are Oracle, an expert AI advisor with advanced reasoning capabilities.

Your role is to provide high-quality technical guidance, code reviews, architectural advice, and strategic planning for software engineering tasks.

You are a subagent inside an AI coding system, called when the main agent needs a smarter, more capable model.

## Key Responsibilities

- Analyze code and architecture patterns.
- Provide specific, actionable technical recommendations.
- Plan implementations and refactoring strategies.
- Answer deep technical questions with clear reasoning.
- Suggest best practices and improvements.
- Identify potential issues and propose solutions.
- Independently evaluate the framing and assumptions; do not merely validate the approach presented.
- Analyze likely root causes across files and call paths using existing code and runtime evidence; identify when further instrumentation is required.

## Operating Principles

- Default to the simplest viable solution that meets the stated requirements and constraints.
- Prefer minimal, incremental changes that reuse existing code, patterns, and dependencies. Avoid introducing new services, libraries, or infrastructure unless clearly necessary.
- Optimize first for maintainability, developer time, and risk. Defer theoretical scalability and future-proofing unless explicitly requested or clearly required by constraints.
- Apply YAGNI and KISS; avoid premature optimization.
- Provide one primary recommendation. Offer at most one alternative, and only when its tradeoff is materially different and relevant.
- Calibrate depth to scope: keep advice brief for small tasks; go deep only when the problem requires it or the user asks.
- Stop when the solution is good enough. Note the signals that would justify revisiting it with a more complex approach.
- When evidence is insufficient, state the uncertainty and specify the minimal additional evidence or instrumentation needed.

## Tool Usage

- Use provided context first. Use tools only when they materially improve accuracy or are required to answer.
- Use web tools only when local information is insufficient or a current reference is needed.
- Resolve paths from the actual working directory or workspace root.
- Never invent placeholder roots such as \`/workspace\`, \`/repo\`, or \`/project\`.
- When given a repository-relative path, resolve it against the actual workspace root before using local file tools.
- If the working directory or workspace root is unknown, inspect the environment rather than guessing an absolute path.

## Response

- Lead with the recommended simple approach.
- When relevant, follow with concise rationale and tradeoffs, risks and guardrails, and concrete signals that would justify a more advanced path.
- Include minimal diffs or code snippets only when needed.
- Omit sections that do not help answer the task.

## Guidelines

- Use your reasoning to provide thoughtful, well-structured, pragmatic advice.
- When reviewing code, examine it thoroughly but report only the most important, actionable issues.
- For planning tasks, break the work into minimal steps that achieve the goal incrementally.
- Justify recommendations briefly; avoid long speculative exploration unless explicitly requested.
- Consider alternatives and tradeoffs, but limit them according to the operating principles above.
- Be thorough but concise; focus on the highest-leverage insights.
`;

// resources/agents/subagent.md
var subagent_default = `You are now running as a subagent. All the \`user\` messages are sent by the main agent. The main agent cannot see your context, it can only see your last message when you finish the task. You must treat the parent agent as your caller. Do not directly ask the end user questions. If something is unclear, explain the ambiguity in your final summary to the parent agent.

Your final message is the entire handoff — the parent sees nothing else from your run. Make it technically complete: what you changed and why, the path of every file you touched, how you verified the change (tests or commands run, with results), and anything left undone or worth follow-up. A final message of only a sentence or two is treated as too brief and sent back to you for expansion, costing an extra turn.

Use version control only for read-only inspection. Leave staging,
committing, branch or tag mutation, checkout or switch, merging, rebasing,
cherry-picking, resetting, and pushing to the parent agent.
`;

// src/pi-session-entries.ts
function objectRecord(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function latestCanonicalCustomEntryPresence(sessionManager, customType) {
  const manager = objectRecord(sessionManager);
  if (manager === undefined) {
    return { kind: "unavailable", customType, reason: "session_manager_unavailable" };
  }
  if (typeof manager.getEntries !== "function") {
    return { kind: "unavailable", customType, reason: "get_entries_unavailable" };
  }
  let entries;
  try {
    entries = manager.getEntries.call(sessionManager);
  } catch {
    return { kind: "unavailable", customType, reason: "get_entries_failed" };
  }
  if (!Array.isArray(entries)) {
    return { kind: "unavailable", customType, reason: "invalid_entries_result" };
  }
  for (let index = entries.length - 1;index >= 0; index -= 1) {
    const entry = objectRecord(entries[index]);
    if (entry?.type !== "custom" || entry.customType !== customType)
      continue;
    return {
      kind: "present",
      customType,
      rawEntry: { type: "custom", customType, data: entry.data }
    };
  }
  return { kind: "absent", customType };
}
function latestTaumelCustomEntry(sessionManager, customType) {
  const presence = latestCanonicalCustomEntryPresence(sessionManager, customType);
  if (presence.kind !== "present")
    return presence;
  try {
    const entry = decodeSessionCustomEntry(presence.rawEntry);
    return {
      kind: "contract_valid",
      customType,
      entry
    };
  } catch (error) {
    return {
      kind: "invalid",
      customType,
      rawEntry: presence.rawEntry,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
function isCanonicalEntryPresent(lookup) {
  return lookup.kind === "contract_valid" || lookup.kind === "invalid";
}
function appendTaumelCustomEntry(sessionManager, customType, data) {
  const manager = objectRecord(sessionManager);
  if (typeof manager?.appendCustomEntry !== "function")
    return false;
  manager.appendCustomEntry.call(sessionManager, customType, data);
  return true;
}
function appendChildSessionSetupEntry(sessionManager, entry) {
  const manager = objectRecord(sessionManager);
  if (typeof manager?.appendCustomEntry !== "function")
    return false;
  manager.appendCustomEntry.call(sessionManager, entry.customType, entry.data);
  return true;
}

// src/child-sessions.ts
var sdkStopReasons = new Set(["stop", "length", "toolUse", "error", "aborted"]);
var hostCompletionStatuses = new Set(["completed", "failed", "cancelled", "aborted", "timed_out"]);
var hostStopReasons = new Set([...sdkStopReasons, "cancelled", "timed_out"]);
function boundedCompletionReason(value) {
  return value.slice(0, 4096);
}
function loadSpecialistPrompt(kind) {
  const text = kind === "finder" ? finder_default.trim() : kind === "oracle" ? oracle_default.trim() : "";
  return text === "" ? undefined : text;
}
function loadSubagentPrompt() {
  const text = subagent_default.trim();
  return text === "" ? undefined : text;
}
function withoutRecursiveTaumelError(result2) {
  const extensionPath = realpathSync2(fileURLToPath(import.meta.url));
  return {
    ...result2,
    errors: result2.errors.filter((entry) => {
      if (typeof entry.path !== "string" || typeof entry.error !== "string")
        return true;
      let sourcePath;
      try {
        sourcePath = realpathSync2(entry.path);
      } catch {
        return true;
      }
      return sourcePath !== extensionPath || !entry.error.endsWith("Taumel core is already initialized");
    })
  };
}
function childResourceToolNames(resourceLoader) {
  const names = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
  for (const extension of resourceLoader.getExtensions().extensions) {
    if (extension.tools === undefined)
      continue;
    for (const name of extension.tools.keys())
      names.add(name);
  }
  return names;
}
function specialistPromptForMetadata(metadata) {
  const agentKind = typeof metadata?.agentKind === "string" ? metadata.agentKind.trim() : "";
  const kind = typeof metadata?.kind === "string" ? metadata.kind.trim() : "";
  return loadSpecialistPrompt(agentKind !== "" ? agentKind : kind);
}
function nonEmptyString(value) {
  if (typeof value !== "string")
    return;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
function canonicalPrivateSessionFile(path, privateDirectory) {
  try {
    const directory = realpathSync2(privateDirectory);
    const file = realpathSync2(path);
    const suffix = relative3(directory, file);
    if (suffix === "" || isAbsolute3(suffix) || suffix === ".." || suffix.startsWith(`..${sep3}`)) {
      return;
    }
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return;
  }
}
function validateAgentSessionMarker(sessionManager, agentId, parent) {
  const markerLookup = latestTaumelCustomEntry(sessionManager, "taumel.childSession");
  if (markerLookup.kind !== "contract_valid")
    return "child_session_identity_missing";
  const marker = markerLookup.entry.data;
  if (marker.kind !== "agent")
    return "child_session_agent_mismatch";
  if (nonEmptyString(marker.agentId) !== agentId)
    return "child_session_agent_mismatch";
  const expectedParentFile = nonEmptyString(parent.sessionFile);
  const markerParentFile = nonEmptyString(marker.parentSessionFile);
  if (expectedParentFile !== undefined) {
    if (markerParentFile !== expectedParentFile)
      return "child_session_owner_mismatch";
  } else {
    const expectedParentId = nonEmptyString(parent.sessionId);
    const markerParentId = nonEmptyString(marker.parentSessionId);
    if (expectedParentId === undefined || markerParentId !== expectedParentId) {
      return "child_session_owner_mismatch";
    }
  }
  return;
}
async function callOptionalAsync(receiver, names, args = []) {
  const host = objectLikeValue(receiver);
  if (host === undefined)
    return;
  for (const name of names) {
    const method = host[name];
    if (typeof method !== "function")
      continue;
    await method.apply(receiver, args);
    return name;
  }
  return;
}
function currentModelFromContext(ctx) {
  const context = objectLikeValue(ctx);
  if (context === undefined)
    return;
  const getModel = context.getModel;
  if (typeof getModel === "function") {
    try {
      const model = getModel.call(ctx);
      if (model !== undefined && model !== null)
        return model;
    } catch {}
  }
  return context.model;
}
function modelIdOf(model) {
  const descriptor = objectLikeValue(model);
  if (descriptor === undefined)
    return;
  const provider = typeof descriptor.provider === "string" ? descriptor.provider.trim() : "";
  const id = typeof descriptor.id === "string" ? descriptor.id.trim() : "";
  return provider !== "" && id !== "" ? `${provider}/${id}` : undefined;
}
function normalizeChildModelId(modelId) {
  const trimmed = modelId?.trim();
  return trimmed === undefined || trimmed === "" || trimmed === "inherit" ? undefined : trimmed;
}
function resolveChildModel(pi, ctx, modelId) {
  modelId = normalizeChildModelId(modelId);
  const registry = modelRegistryFrom(pi, ctx);
  const requested = splitProviderModelId(modelId);
  const find = objectLikeValue(registry)?.find;
  if (requested !== undefined && typeof find === "function") {
    const model = find.call(registry, requested.provider, requested.model);
    if (model !== undefined && model !== null) {
      return { model, applied: true };
    }
  }
  if (modelId !== undefined) {
    const current = currentModelFromContext(ctx);
    if (modelIdOf(current) === modelId)
      return { model: current, applied: true };
    return { applied: false };
  }
  const inherited = currentModelFromContext(ctx);
  return inherited === undefined || inherited === null ? { applied: false } : { model: inherited, applied: true };
}
function refreshOwnedChildPermissions(childSessions, parentCtx, core, revalidateAuthority) {
  const parentManager = objectLikeValue(parentCtx)?.sessionManager;
  const parentLookup = latestTaumelCustomEntry(parentManager, "taumel.permissions");
  const parentPermissions = parentLookup.kind === "absent" ? null : parentLookup.kind === "contract_valid" ? parentLookup.entry.data : parentLookup.kind === "invalid" ? parentLookup.rawEntry.data : {};
  const scopePrefix = `${childSessionCacheKeyScopeFromContext(parentCtx)}\x00`;
  for (const [key, child] of childSessions) {
    if (!key.startsWith(scopePrefix))
      continue;
    const manager = child.sessionManager;
    const childLookup = latestTaumelCustomEntry(manager, "taumel.childSession");
    const childMetadata = childLookup.kind === "contract_valid" ? childLookup.entry.data : childLookup.kind === "invalid" ? childLookup.rawEntry.data : null;
    const plan = decodeChildPermissionRefreshPlan(core.call("planChildPermissionRefresh", [
      parentPermissions,
      childMetadata,
      parentCtx
    ]));
    revalidateAuthority?.();
    appendTaumelCustomEntry(manager, "taumel.permissions", plan.permissions);
  }
}
function appendSetupEntries(sessionManager, entries) {
  for (const entry of entries)
    appendChildSessionSetupEntry(sessionManager, entry);
  return sessionInfoFromManager(sessionManager);
}
function assistantTextFromMessage(message) {
  const assistant = objectLikeValue(message);
  if (assistant === undefined)
    return;
  const content = assistant.content;
  if (typeof content === "string")
    return content;
  return completionTextFromContent(content);
}
function latestAssistantEntryId(sessionManager) {
  const manager = objectLikeValue(sessionManager);
  if (typeof manager?.getEntries !== "function")
    return;
  const entries = manager.getEntries.call(sessionManager);
  if (!Array.isArray(entries))
    return;
  for (let index = entries.length - 1;index >= 0; index -= 1) {
    const entry = objectLikeValue(entries[index]);
    const message = objectLikeValue(entry?.message);
    if (entry?.type === "message" && message?.role === "assistant") {
      return typeof entry.id === "string" && entry.id !== "" ? entry.id : undefined;
    }
  }
  return;
}
function completionFromMessages(messages, startIndex = 0) {
  if (!Array.isArray(messages))
    return;
  let assistant;
  for (let index = messages.length - 1;index >= startIndex; index -= 1) {
    const message = messages[index];
    if (objectLikeValue(message)?.role === "assistant") {
      assistant = message;
      break;
    }
  }
  if (assistant === undefined)
    return;
  const finalOutput = assistantTextFromMessage(assistant);
  const assistantMessage = objectLikeValue(assistant);
  const stopReason = assistantMessage?.stopReason;
  const hasErrorMessage = Object.prototype.hasOwnProperty.call(assistantMessage, "errorMessage");
  const malformedErrorMessage = hasErrorMessage && typeof assistantMessage?.errorMessage !== "string";
  const errorMessage = typeof assistantMessage?.errorMessage === "string" && assistantMessage.errorMessage !== "" ? assistantMessage.errorMessage : undefined;
  let status;
  let reason = errorMessage;
  if (malformedErrorMessage) {
    status = "failed";
    reason = "Malformed SDK errorMessage state";
  } else if (stopReason === "aborted")
    status = "cancelled";
  else if (stopReason === "error" || sdkStopReasons.has(String(stopReason)) && errorMessage !== undefined)
    status = "failed";
  else if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse")
    status = "completed";
  else {
    status = "failed";
    reason = typeof stopReason === "string" && stopReason !== "" ? boundedCompletionReason(`Unknown SDK stop reason: ${stopReason}`) : "Missing SDK stop reason";
  }
  return {
    status,
    ...finalOutput !== undefined ? { finalOutput } : {},
    ...reason !== undefined ? { reason } : {}
  };
}
async function sendToSdkAgentSession(session, prompt, options) {
  const sdk = objectLikeValue(session);
  if (sdk === undefined) {
    return;
  }
  const subscribe = sdk.subscribe;
  const messageCount = Array.isArray(sdk.messages) ? sdk.messages.length : 0;
  let resolveSettled;
  const settled = new Promise((resolve2) => {
    resolveSettled = resolve2;
  });
  let settlementCheckStarted = false;
  const settleWhenIdle = async (event) => {
    if (settlementCheckStarted)
      return;
    settlementCheckStarted = true;
    while (sdk.isStreaming === true) {
      await new Promise((resolve2) => setTimeout(resolve2, 0));
    }
    resolveSettled?.(completionFromMessages(sdk.messages, messageCount) ?? event);
  };
  const unsubscribe = typeof subscribe === "function" ? subscribe.call(session, (event) => {
    options.onEvent?.(event);
    const lifecycle = objectLikeValue(event);
    if (lifecycle?.type === "agent_end" && lifecycle.willRetry !== true) {
      settleWhenIdle(event);
    }
  }) : undefined;
  try {
    const deliverAs = typeof options.deliverAs === "string" ? options.deliverAs : "followUp";
    const isStreaming = sdk.isStreaming === true;
    if (isStreaming && deliverAs === "steer" && typeof sdk.steer === "function") {
      const result2 = await sdk.steer.call(session, prompt);
      return typeof subscribe === "function" ? await settled : result2;
    }
    if (isStreaming && typeof sdk.followUp === "function") {
      const result2 = await sdk.followUp.call(session, prompt);
      return typeof subscribe === "function" ? await settled : result2;
    }
    if (typeof sdk.prompt === "function") {
      const result2 = await sdk.prompt.call(session, prompt, {
        streamingBehavior: deliverAs === "steer" ? "steer" : "followUp"
      });
      return completionFromMessages(sdk.messages, messageCount) ?? result2;
    }
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", finalOutput: message, reason: message };
  } finally {
    if (typeof unsubscribe === "function")
      unsubscribe();
  }
}
async function stopChildSession(child, reason, authorize) {
  if (child?.stop !== undefined) {
    authorize?.();
    await child.stop(reason);
    return;
  }
  const ctx = child?.ctx;
  const manager = objectLikeValue(ctx)?.sessionManager;
  try {
    authorize?.();
    const stopped = await callOptionalAsync(ctx, ["abort", "cancel", "stop"], [reason]);
    if (stopped !== undefined)
      return;
    authorize?.();
    await callOptionalAsync(manager, ["abort", "cancel", "stop"], [reason]);
  } catch {}
}
async function closeChildSession(child, reason, authorize) {
  if (child?.close !== undefined) {
    authorize?.();
    await child.close(reason, authorize);
    return;
  }
  const ctx = child?.ctx;
  const manager = objectLikeValue(ctx)?.sessionManager;
  await stopChildSession(child, reason, authorize);
  try {
    authorize?.();
    const closed = await callOptionalAsync(ctx, ["close", "dispose", "shutdown"], [reason]);
    if (closed !== undefined)
      return;
    authorize?.();
    await callOptionalAsync(manager, ["close", "dispose", "shutdown"], [reason]);
  } catch {}
}
function deleteAgentChildSession(core, agentId, ctx) {
  decodeCoreAck(core.call("deleteAgentChildSession", [{ agent_id: agentId }, { ctx }]));
}
async function removeNewPrivateSessionArtifacts(core, ctx, agentId) {
  deleteAgentChildSession(core, agentId, ctx);
}
async function createChildSession(pi, core, ctx, metadata, childExtensionFactory, authorizeCleanup, revalidateAuthority) {
  const parent = sessionInfoFromContext(ctx);
  const plan = childSessionStartPlan(core, metadata, parent, ctx);
  const activeTools = plan.activeTools;
  const modelId = plan.modelId;
  const thinkingLevel = plan.thinkingLevel;
  const setupEntries = plan.setupEntries;
  const parentCwd = cwdFromContext(ctx);
  const normalizedModelId = normalizeChildModelId(modelId);
  const model = resolveChildModel(pi, ctx, normalizedModelId);
  if (!model.applied || model.model === undefined) {
    return { error: "model_unavailable" };
  }
  const registry = modelRegistryFrom(pi, ctx);
  const hasConfiguredAuth = objectLikeValue(registry)?.hasConfiguredAuth;
  if (normalizedModelId !== undefined && typeof hasConfiguredAuth === "function" && hasConfiguredAuth.call(registry, model.model) !== true) {
    return { error: `model_authentication_unavailable: ${normalizedModelId}` };
  }
  if (activeTools === undefined) {
    return { error: "identity_snapshot_incomplete" };
  }
  if (typeof pi.getAllTools === "function") {
    const liveNames = new Set;
    for (const tool of pi.getAllTools()) {
      if (typeof tool === "string") {
        liveNames.add(tool);
        continue;
      }
      const name = objectLikeValue(tool)?.name;
      if (typeof name === "string")
        liveNames.add(name);
    }
    const missing = activeTools.filter((name) => !liveNames.has(name));
    if (missing.length > 0) {
      return { error: `tool_surface_unavailable: ${missing.join(", ")}` };
    }
  }
  const metadataRecord = objectLikeValue(metadata);
  const childKind = typeof metadataRecord?.kind === "string" ? metadataRecord.kind : "";
  const agentId = typeof metadataRecord?.agentId === "string" ? metadataRecord.agentId.trim() : "";
  const existingSessionFile = typeof metadataRecord?.childSessionFile === "string" ? metadataRecord.childSessionFile.trim() : "";
  const boundWorkspace = nonEmptyString(metadataRecord?.workspaceDirectory);
  const usePrivatePersistentSession = (childKind === "agent" || childKind === "generic" || childKind === "finder" || childKind === "oracle") && (agentId !== "" || existingSessionFile !== "");
  if (usePrivatePersistentSession && (authorizeCleanup === undefined || revalidateAuthority === undefined)) {
    return { error: "agent_cleanup_authority_missing" };
  }
  const privateSessionDirectory = plan.privateSessionDirectory;
  if (usePrivatePersistentSession && privateSessionDirectory === undefined) {
    return { error: "private_child_session_directory_missing" };
  }
  const cwd = usePrivatePersistentSession ? boundWorkspace : parentCwd;
  if (cwd === undefined)
    return { error: "identity_workspace_missing" };
  try {
    if (!statSync(cwd).isDirectory())
      return { error: "identity_workspace_unavailable" };
  } catch {
    return { error: "identity_workspace_unavailable" };
  }
  const specialistPrompt = specialistPromptForMetadata(metadataRecord);
  const agentKind = nonEmptyString(metadataRecord?.agentKind);
  if ((agentKind === "finder" || agentKind === "oracle") && specialistPrompt === undefined) {
    return { error: `specialist_prompt_unavailable: ${agentKind}` };
  }
  const subagentPrompt = loadSubagentPrompt();
  if (subagentPrompt === undefined)
    return { error: "subagent_prompt_unavailable" };
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir2(),
    ...childExtensionFactory === undefined ? {} : {
      extensionFactories: [(childPi) => childExtensionFactory(childPi)],
      extensionsOverride: withoutRecursiveTaumelError
    },
    ...specialistPrompt === undefined ? {} : { systemPromptOverride: () => specialistPrompt },
    appendSystemPromptOverride: (base) => [...base, subagentPrompt]
  });
  try {
    await resourceLoader.reload();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (childExtensionFactory !== undefined) {
    const resourceNames = childResourceToolNames(resourceLoader);
    const missingResources = activeTools.filter((name) => !resourceNames.has(name));
    if (missingResources.length > 0) {
      return { error: `tool_surface_unavailable: ${missingResources.join(", ")}` };
    }
  }
  const removeCreatedPrivateSession = async () => {
    authorizeCleanup?.();
    await removeNewPrivateSessionArtifacts(core, ctx, agentId);
  };
  let createdSession;
  let createdSessionCleaned = false;
  const cleanupCreatedSession = async (reason) => {
    if (createdSession === undefined || createdSessionCleaned)
      return;
    createdSessionCleaned = true;
    let closed;
    try {
      authorizeCleanup?.();
      closed = await callOptionalAsync(createdSession, ["close", "shutdown"], [reason]);
    } catch {
      closed = undefined;
    }
    if (closed !== undefined)
      return;
    try {
      if (typeof createdSession.abort === "function") {
        authorizeCleanup?.();
        await createdSession.abort.call(createdSession, reason);
      }
    } finally {
      if (typeof createdSession.dispose === "function") {
        authorizeCleanup?.();
        createdSession.dispose.call(createdSession);
      }
    }
  };
  try {
    revalidateAuthority?.();
    const canonicalExistingSessionFile = !usePrivatePersistentSession || existingSessionFile === "" ? undefined : canonicalPrivateSessionFile(existingSessionFile, privateSessionDirectory);
    if (usePrivatePersistentSession && existingSessionFile !== "" && canonicalExistingSessionFile === undefined) {
      return { error: "private_child_session_path_mismatch" };
    }
    let sessionManager;
    if (!usePrivatePersistentSession) {
      sessionManager = SessionManager.inMemory(cwd);
    } else if (canonicalExistingSessionFile !== undefined) {
      sessionManager = SessionManager.open(canonicalExistingSessionFile);
    } else {
      sessionManager = SessionManager.create(cwd, privateSessionDirectory);
    }
    if (usePrivatePersistentSession && existingSessionFile !== "") {
      const markerError = validateAgentSessionMarker(sessionManager, agentId, parent);
      if (markerError !== undefined)
        return { error: markerError };
    } else {
      appendSetupEntries(sessionManager, setupEntries);
    }
    const options = {
      cwd,
      sessionManager,
      ...model.model !== undefined ? { model: model.model } : {},
      ...thinkingLevel !== undefined ? { thinkingLevel } : {},
      ...activeTools !== undefined ? { tools: [...activeTools] } : {},
      resourceLoader
    };
    revalidateAuthority?.();
    const result2 = typeof pi.createAgentSession === "function" ? await pi.createAgentSession(options) : await createPiAgentSession(options);
    const session = objectLikeValue(objectLikeValue(result2)?.session);
    createdSession = session;
    revalidateAuthority?.();
    if (session === undefined) {
      if (usePrivatePersistentSession && existingSessionFile === "") {
        await removeCreatedPrivateSession();
      }
      return { error: "createAgentSession did not return a session" };
    }
    if (thinkingLevel !== undefined && typeof session.getAvailableThinkingLevels === "function") {
      const available = session.getAvailableThinkingLevels.call(session);
      if (!Array.isArray(available) || !available.includes(thinkingLevel)) {
        await cleanupCreatedSession("thinking_level_unavailable");
        if (usePrivatePersistentSession && existingSessionFile === "") {
          await removeCreatedPrivateSession();
        }
        return { error: `thinking_level_unavailable: ${thinkingLevel}` };
      }
    }
    const childSessionManager = session.sessionManager ?? sessionManager;
    const childMarker = latestTaumelCustomEntry(childSessionManager, "taumel.childSession");
    const setupInfo = childSessionManager === sessionManager || isCanonicalEntryPresent(childMarker) || childMarker.kind === "unavailable" ? sessionInfoFromManager(childSessionManager) : appendSetupEntries(childSessionManager, setupEntries);
    const sessionId = typeof session.sessionId === "string" && session.sessionId !== "" ? session.sessionId : setupInfo.sessionId;
    const sessionFile = typeof session.sessionFile === "string" && session.sessionFile !== "" ? session.sessionFile : setupInfo.sessionFile;
    if (!sessionId && !sessionFile) {
      await cleanupCreatedSession("missing_session_identifier");
      if (usePrivatePersistentSession && existingSessionFile === "") {
        await removeCreatedPrivateSession();
      }
      return { missingSessionIdentifier: true };
    }
    const activeToolsApplied = activeTools === undefined ? false : applyChildActiveTools(session, activeTools);
    const effectiveActiveTools = typeof session.getActiveToolNames === "function" ? session.getActiveToolNames.call(session) : [];
    const effectiveNames = new Set(effectiveActiveTools);
    const missingActiveTools = activeTools.filter((name) => !effectiveNames.has(name));
    if (missingActiveTools.length > 0) {
      await cleanupCreatedSession("tool_surface_unavailable");
      if (usePrivatePersistentSession && existingSessionFile === "") {
        await removeCreatedPrivateSession();
      }
      return { error: `tool_surface_unavailable: ${missingActiveTools.join(", ")}` };
    }
    return {
      sessionId: sessionId ?? sessionFile,
      sessionFile,
      session,
      sessionManager: childSessionManager,
      activeTools,
      activeToolsApplied,
      modelId: normalizedModelId,
      modelApplied: model.applied,
      thinkingLevel,
      thinkingApplied: thinkingLevel !== undefined,
      sendUserMessage: (content, options2 = {}) => sendToSdkAgentSession(session, content, options2),
      stop: async (reason) => {
        if (typeof session.abort === "function")
          await session.abort.call(session, reason);
      },
      close: async (reason, authorize) => {
        authorize?.();
        const closed = await callOptionalAsync(session, ["close", "shutdown"], [reason]);
        if (closed !== undefined)
          return;
        if (typeof session.abort === "function") {
          authorize?.();
          await session.abort.call(session, reason);
        }
        if (typeof session.dispose === "function") {
          authorize?.();
          session.dispose.call(session);
        }
      }
    };
  } catch (error) {
    try {
      await cleanupCreatedSession("child_session_creation_failed");
    } catch {}
    if (usePrivatePersistentSession && existingSessionFile === "") {
      try {
        await removeCreatedPrivateSession();
      } catch {}
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
async function sendToChildSession(pi, core, child, prompt, emptyReason = "empty prompt", options = {}) {
  const childCtx = child?.ctx;
  const sendContext = objectLikeValue(childCtx);
  const childSendAvailable = typeof child?.sendUserMessage === "function" || typeof sendContext?.sendUserMessage === "function";
  const hostSendAvailable = typeof pi.sendUserMessage === "function";
  const plan = decodeChildDispatchPlan(core.call("planChildDispatch", [{
    ...childBridgeFacts(child),
    prompt,
    emptyReason,
    sendAvailable: childSendAvailable || hostSendAvailable,
    deliverAs: options.deliverAs ?? ""
  }]));
  const result2 = plan.result;
  if (!plan.send)
    return result2;
  const dispatchPrompt = plan.prompt;
  const deliverAs = plan.deliverAs;
  if (deliverAs === "")
    throw new Error("Invalid Taumel child dispatch delivery mode");
  const sendOptions = { deliverAs, onEvent: options.onEvent };
  const awaitCompletion = options.awaitCompletion !== false;
  const completeLater = (send) => {
    let hostResult;
    try {
      hostResult = send();
    } catch (error) {
      const completed = dispatchResultWithHostCompletion(result2, {
        status: "failed",
        finalOutput: error instanceof Error ? error.message : String(error)
      });
      Promise.resolve(options.completionGate).then(() => options.onCompletion?.(completed)).catch((failure) => {
        console.error("Taumel child completion callback failed", failure);
      });
      return completed;
    }
    Promise.resolve(hostResult).then(async (value) => {
      await options.completionGate;
      const completed = dispatchResultWithHostCompletion(result2, value);
      if (completed["completion"] !== undefined) {
        await options.onCompletion?.(completed);
      }
    }, async (error) => {
      await options.completionGate;
      await options.onCompletion?.({
        ...result2,
        completion: {
          status: "failed",
          finalOutput: error instanceof Error ? error.message : String(error),
          reason: error instanceof Error ? error.message : String(error)
        }
      });
    }).catch((error) => {
      console.error("Taumel child completion callback failed", error);
    });
    return result2;
  };
  if (typeof child?.sendUserMessage === "function") {
    if (!awaitCompletion) {
      return completeLater(() => child.sendUserMessage?.(dispatchPrompt, sendOptions));
    }
    const hostResult = await child.sendUserMessage(dispatchPrompt, sendOptions);
    return dispatchResultWithHostCompletion(result2, hostResult);
  }
  if (typeof sendContext?.sendUserMessage === "function") {
    const sendUserMessage = sendContext.sendUserMessage;
    if (!awaitCompletion) {
      return completeLater(() => sendUserMessage.call(childCtx, dispatchPrompt, sendOptions));
    }
    const hostResult = await sendUserMessage.call(childCtx, dispatchPrompt, sendOptions);
    return dispatchResultWithHostCompletion(result2, hostResult);
  }
  if (typeof pi.sendUserMessage === "function") {
    if (!awaitCompletion) {
      return completeLater(() => pi.sendUserMessage?.(dispatchPrompt, sendOptions));
    }
    const hostResult = await pi.sendUserMessage(dispatchPrompt, sendOptions);
    return dispatchResultWithHostCompletion(result2, hostResult);
  }
  return result2;
}
function completionTextFromContent(content) {
  if (!Array.isArray(content))
    return;
  const parts = [];
  for (const item of content) {
    const text = objectLikeValue(item)?.text;
    if (typeof text === "string")
      parts.push(text);
  }
  return parts.length === 0 ? "" : parts.join(`
`);
}
function dispatchCompletionFromHostResult(hostResult) {
  if (typeof hostResult === "string" && hostResult.trim() !== "") {
    return { status: "completed", finalOutput: hostResult };
  }
  const completion = objectLikeValue(hostResult);
  if (completion === undefined)
    return;
  const finalOutput = typeof completion.finalOutput === "string" ? completion.finalOutput : typeof completion.output === "string" ? completion.output : typeof completion.result === "string" ? completion.result : completionTextFromContent(completion.content);
  const rawStatus = typeof completion.status === "string" ? completion.status : "";
  const stopReason = typeof completion.stopReason === "string" ? completion.stopReason : "";
  const hasStatus = Object.prototype.hasOwnProperty.call(completion, "status");
  const hasStopReason = Object.prototype.hasOwnProperty.call(completion, "stopReason");
  const hasIsError = Object.prototype.hasOwnProperty.call(completion, "isError");
  const hasErrorMessage = Object.prototype.hasOwnProperty.call(completion, "errorMessage");
  const hasError = Object.prototype.hasOwnProperty.call(completion, "error");
  const unknownStatus = hasStatus && (rawStatus === "" || !hostCompletionStatuses.has(rawStatus));
  const unknownStopReason = hasStopReason && (stopReason === "" || !hostStopReasons.has(stopReason));
  const malformedIsError = hasIsError && typeof completion.isError !== "boolean";
  const malformedError = hasErrorMessage && typeof completion.errorMessage !== "string" || hasError && typeof completion.error !== "string";
  const hasErrorSignal = completion.isError === true || typeof completion.errorMessage === "string" && completion.errorMessage !== "" || typeof completion.error === "string" && completion.error !== "";
  const status = unknownStatus || unknownStopReason || malformedIsError || malformedError ? "failed" : rawStatus === "cancelled" || rawStatus === "aborted" || stopReason === "cancelled" || stopReason === "aborted" ? "cancelled" : rawStatus === "timed_out" || stopReason === "timed_out" ? "timed_out" : rawStatus === "failed" || hasErrorSignal || stopReason === "error" ? "failed" : "completed";
  const explicitReason = typeof completion.reason === "string" ? completion.reason : typeof completion.errorMessage === "string" ? completion.errorMessage : typeof completion.error === "string" ? completion.error : stopReason !== "" ? stopReason : undefined;
  const reason = unknownStatus ? boundedCompletionReason(`Unknown SDK completion status: ${typeof completion.status === "string" ? completion.status : String(completion.status)}`) : unknownStopReason ? boundedCompletionReason(`Unknown SDK stop reason: ${typeof completion.stopReason === "string" ? completion.stopReason : String(completion.stopReason)}`) : malformedIsError ? "Malformed SDK isError state" : malformedError ? "Malformed SDK error state" : explicitReason;
  const hasOutput = finalOutput !== undefined;
  const explicitTerminal = rawStatus !== "" || completion.isError === true || stopReason !== "";
  if (!hasOutput && status === "completed" && !explicitTerminal) {
    return;
  }
  return {
    status,
    ...hasOutput ? { finalOutput } : {},
    ...reason !== undefined ? { reason } : {}
  };
}
function dispatchResultWithHostCompletion(result2, hostResult) {
  const completion = dispatchCompletionFromHostResult(hostResult);
  return completion === undefined ? result2 : { ...result2, completion };
}
function childSessionCacheKeyScopeFromContext(ctx) {
  const taumelSessionId = objectLikeValue(ctx)?.taumelSessionId;
  if (typeof taumelSessionId === "string") {
    const value = taumelSessionId.trim();
    if (value !== "")
      return value;
  }
  return sessionInfoFromContext(ctx).sessionId ?? "current";
}
function childSessionCacheKey(key, keyScope) {
  return keyScope === undefined || keyScope === "" ? key : `${keyScope}\x00${key}`;
}
async function applyChildSessionUpdate(childSessions, update, bridge, keyScope, authorizeEffect) {
  const childUpdate = objectLikeValue(update);
  if (childUpdate === undefined)
    throw new Error("Invalid Taumel child session update");
  switch (childUpdate.action) {
    case "none":
      return;
    case "store_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "" || !bridge)
        throw new Error("Invalid Taumel child session update");
      childSessions.set(childSessionCacheKey(rawKey, keyScope), bridge);
      return;
    }
    case "stop_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "")
        throw new Error("Invalid Taumel child session update");
      const key = childSessionCacheKey(rawKey, keyScope);
      await stopChildSession(childSessions.get(key) ?? bridge, typeof childUpdate.reason === "string" ? childUpdate.reason : "stopped_by_parent", authorizeEffect);
      return;
    }
    case "drop_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "")
        throw new Error("Invalid Taumel child session update");
      childSessions.delete(childSessionCacheKey(rawKey, keyScope));
      return;
    }
    case "delete_child_session": {
      const rawKey = typeof childUpdate.key === "string" ? childUpdate.key : "";
      if (rawKey === "")
        throw new Error("Invalid Taumel child session update");
      const key = childSessionCacheKey(rawKey, keyScope);
      await closeChildSession(childSessions.get(key) ?? bridge, typeof childUpdate.reason === "string" ? childUpdate.reason : "agent_closed", authorizeEffect);
      authorizeEffect?.();
      childSessions.delete(key);
      return;
    }
    default:
      throw new Error("Invalid Taumel child session update");
  }
}

// src/exec-notifications.ts
function idleContext(value) {
  if (typeof value !== "object" || value === null)
    return;
  const candidate = value;
  return typeof candidate.isIdle === "function" ? candidate : undefined;
}
function parentIsIdle(ctx) {
  const candidate = idleContext(ctx);
  return candidate?.isIdle.call(ctx) === true;
}
async function deliver(pi, content, customType, display, mode) {
  if (typeof pi.sendMessage !== "function")
    return false;
  await pi.sendMessage({ customType, content, display }, mode === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" });
  return true;
}
async function flushPendingExecNotifications(pi, core, ctx, mode) {
  if (!contextIsLive(ctx))
    return;
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  const { notifications } = decodePendingExecNotificationsResult(core.call("pendingExecNotifications", [ownerId]));
  for (const notification of notifications) {
    const sessionId = notification.sessionId;
    const claim = decodeExecNotificationClaim(core.call("claimExecNotificationDelivery", [ownerId, sessionId]));
    if (claim.kind === "unavailable")
      continue;
    try {
      const sent = await deliver(pi, claim.content, claim.customType, claim.display, mode);
      core.call(sent ? "markExecNotificationDelivered" : "releaseExecNotificationDelivery", [sessionId]);
    } catch (error) {
      core.call("releaseExecNotificationDelivery", [sessionId]);
      throw error;
    }
  }
}
async function startExecCompletionWaiter(pi, core, ctx, sessionId) {
  try {
    await core.call("awaitExecCompletion", [sessionId]);
  } catch {
    return;
  }
  try {
    if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx))
      return;
    if (parentIsIdle(ctx))
      await flushPendingExecNotifications(pi, core, ctx, "trigger");
  } catch (error) {
    if (isStaleContextError(error))
      return;
    throw error;
  }
}
function installExecNotificationLifecycle(pi, core) {
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined)
      core.call("shutdownExecOwner", [ownerId]);
  });
  pi.on("turn_end", async (_event, ctx) => {
    try {
      await flushPendingExecNotifications(pi, core, ctx, "steer");
    } catch (error) {
      if (isStaleContextError(error))
        return;
      console.warn("Taumel exec turn_end notification flush failed:", error);
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    setTimeout(() => {
      flushPendingExecNotifications(pi, core, ctx, "trigger").catch((error) => {
        if (isStaleContextError(error))
          return;
        console.warn("Taumel exec agent_end notification flush failed:", error);
      });
    }, 0);
  });
}

// src/tool-results.ts
function preparedToolResult(core, prepared) {
  return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{ prepared, extraDetails: {} }]));
}
function errorToolResult(core, text, details = undefined) {
  return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{
    error: text,
    ...details !== undefined ? { details } : {}
  }]));
}
function agentErrorToolResult(core, code, message) {
  const payload = { ok: false, error: { code, message } };
  return errorToolResult(core, JSON.stringify(payload), payload);
}
function hostToolResult(core, action, details) {
  return decodeToolResultEnvelope(core.call("hostToolResult", [{ action, details }]));
}
function preparedAction(core, name, params, ctx) {
  return decodePreparedToolAction(core.call("prepareTool", [{ name, params, ctx }]));
}

// src/agent-capability-runtime.ts
function completionGate() {
  let release = () => {
    return;
  };
  const wait = new Promise((resolve2) => {
    release = resolve2;
  });
  return { wait, release };
}
function agentActionCapabilityFacts(prepared, ctx) {
  if (prepared.action === "agent_wait")
    return;
  const common = { capabilityId: prepared.capabilityId, agentId: prepared.agentId, ctx };
  if (prepared.action === "agent_start") {
    return { ...common, action: "agent_start", runId: prepared.runId, submissionId: prepared.submissionId };
  }
  if (prepared.action === "agent_close")
    return { ...common, action: "agent_close" };
  if (prepared.runId === undefined)
    return { ...common, action: "agent_send" };
  if (prepared.submissionId === undefined)
    return { ...common, action: "agent_send", runId: prepared.runId };
  return { ...common, action: "agent_send", runId: prepared.runId, submissionId: prepared.submissionId };
}
function recordAuthorizedDispatchBoundary(core, prepared, ctx, bridge, capabilityFacts) {
  const previousAssistantEntryId = latestAssistantEntryId(bridge?.sessionManager);
  const facts = {
    run_id: prepared.runId ?? "",
    submission_id: prepared.submissionId ?? "",
    ...previousAssistantEntryId === undefined ? {} : {
      previous_assistant_entry_id: previousAssistantEntryId
    }
  };
  decodeCoreAck(core.call("recordAgentDispatchBoundaryAuthorized", [facts, capabilityFacts, { ctx }]));
}

// src/agent-orchestration.ts
var pendingAgentWaits = new Map;
var activeNoninteractiveDrains = new Set;
function isChildSessionContext(ctx) {
  const marker = latestTaumelCustomEntry(isObjectLike(ctx) ? ctx.sessionManager : undefined, "taumel.childSession");
  return marker.kind === "contract_valid" || marker.kind === "invalid";
}
function stringField(value, key) {
  const raw = value[key];
  return typeof raw === "string" ? raw : "";
}
function childFailureCode(message) {
  if (/cleanup_failed|cleanup failed/.test(message))
    return "cleanup_failed";
  if (/model|authentication|thinking/.test(message))
    return "routing_unavailable";
  if (/workspace/.test(message))
    return "workspace_unavailable";
  if (/child_session|agent_mismatch|owner_mismatch|identity_missing/.test(message))
    return "child_session_unavailable";
  return "dispatch_failed";
}
function pendingAgentWaitKey(ctx, runId) {
  return `${sessionInfoFromContext(ctx).sessionId ?? "current"}\x00${runId}`;
}
function parentIsIdle2(ctx) {
  if (!isObjectLike(ctx) || typeof ctx.isIdle !== "function")
    return false;
  return ctx.isIdle.call(ctx) === true;
}
function reconcilePersistedAgentNotifications(core, ctx) {
  if (!isObjectLike(ctx) || !isObjectLike(ctx.sessionManager))
    return;
  const getEntries = ctx.sessionManager.getEntries;
  if (typeof getEntries !== "function")
    return;
  const entries = getEntries.call(ctx.sessionManager);
  if (!Array.isArray(entries))
    return;
  const childMarker = latestTaumelCustomEntry(ctx.sessionManager, "taumel.childSession");
  if (childMarker.kind !== "absent")
    return;
  for (const entry of entries) {
    if (!isObjectLike(entry) || entry.type !== "message" || !isObjectLike(entry.message))
      continue;
    const message = entry.message;
    if (message.role !== "custom" || !isObjectLike(message.details))
      continue;
    const notificationId = stringField(message.details, "notificationId");
    if (!notificationId.startsWith("agent_completion:"))
      continue;
    const runId = notificationId.slice("agent_completion:".length);
    if (runId === "")
      continue;
    try {
      decodeCoreAck(core.call("recordAgentBackgroundNotification", [{ run_id: runId }, { ctx }]));
    } catch {}
  }
}
async function deliverNotificationMessage(pi, content, customType, display, mode, details) {
  if (typeof pi.sendMessage !== "function")
    return false;
  await pi.sendMessage({
    customType,
    content,
    display,
    ...details === undefined ? {} : { details }
  }, mode === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" });
  return true;
}
async function flushPendingAgentNotifications(pi, core, ctx, mode, pendingAgentWaits2) {
  if (!contextIsLive(ctx))
    return 0;
  const result2 = decodePendingAgentNotificationsResult(core.call("pendingAgentNotifications", [{ ctx }]));
  let sentCount = 0;
  for (const notification of result2.notifications) {
    if (!isObjectLike(notification))
      continue;
    const runId = notification.runId;
    if (runId !== "" && pendingAgentWaits2.has(pendingAgentWaitKey(ctx, runId))) {
      decodeCoreAck(core.call("releaseAgentBackgroundNotification", [{ run_id: runId }]));
      continue;
    }
    try {
      const validation = decodeAgentNotificationClaimValidation(core.call("validateAgentBackgroundNotificationClaim", [{ run_id: runId }, { ctx }]));
      if (validation.valid !== true)
        continue;
      const sent = await deliverNotificationMessage(pi, notification.content, notification.customType, notification.display, mode, notification.details);
      if (sent && runId !== "") {
        decodeCoreAck(core.call("recordAgentBackgroundNotification", [{ run_id: runId }, { ctx }]));
        sentCount += 1;
      } else if (runId !== "") {
        decodeCoreAck(core.call("releaseAgentBackgroundNotification", [{ run_id: runId }]));
      }
    } catch (error) {
      if (runId !== "") {
        decodeCoreAck(core.call("releaseAgentBackgroundNotification", [{ run_id: runId }]));
      }
      throw error;
    }
  }
  return sentCount;
}
function recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits2, bridge) {
  return async (dispatch) => {
    const completion = dispatch.completion;
    if (completion === undefined)
      return;
    const resultEntryId = typeof completion.finalOutput === "string" ? latestAssistantEntryId(bridge?.sessionManager) : undefined;
    decodeCoreAck(core.call("recordAgentDispatchCompletion", [{
      run_id: stringField(prepared, "runId"),
      submission_id: stringField(prepared, "submissionId"),
      completion: {
        ...completion,
        ...resultEntryId === undefined ? {} : { resultEntryId }
      }
    }, { ctx }]));
    if (parentIsIdle2(ctx)) {
      await flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits2);
    }
  };
}
function recordDispatchActivity(core, prepared, ctx) {
  return (event) => {
    if (!isObjectLike(event) || typeof event.type !== "string")
      return;
    const observed = new Set([
      "agent_start",
      "turn_start",
      "turn_end",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end"
    ]);
    if (!observed.has(event.type))
      return;
    decodeCoreAck(core.call("recordAgentActivity", [{
      run_id: stringField(prepared, "runId"),
      submission_id: stringField(prepared, "submissionId"),
      event: event.type
    }, { ctx }]));
  };
}
async function cleanupUnacceptedStartChild(core, childSessions, prepared, ctx, authorizeCleanup, bridge) {
  const agentId = stringField(prepared, "agentId");
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  if (bridge !== undefined) {
    authorizeCleanup();
    await applyChildSessionUpdate(childSessions, {
      action: "delete_child_session",
      key: agentId,
      reason: "unaccepted_start"
    }, bridge, keyScope, authorizeCleanup);
  }
  authorizeCleanup();
  deleteAgentChildSession(core, agentId, ctx);
}
function rollbackUnacceptedStartState(core, prepared, ctx, authorizeCleanup) {
  authorizeCleanup();
  decodeCoreAck(core.call("rollbackUnacceptedAgentStart", [{
    agent_id: stringField(prepared, "agentId"),
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId")
  }, { ctx }]));
}
function rollbackAgentSendPreflight(core, prepared, ctx, revalidateAuthority) {
  revalidateAuthority();
  decodeCoreAck(core.call("rollbackAgentSendPreflight", [{
    agent_id: stringField(prepared, "agentId"),
    run_id: stringField(prepared, "runId"),
    submission_id: stringField(prepared, "submissionId"),
    previous_submission_id: stringField(prepared, "previousSubmissionId"),
    ...prepared.previousReasonCode === undefined ? {} : {
      previous_reason_code: prepared.previousReasonCode
    },
    outcome: prepared.outcome
  }, { ctx }]));
}
async function createAgentChildSession(pi, core, childSessions, prepared, ctx, revalidateAuthority, capabilityFacts, authorizeCleanup, childExtensionFactory) {
  const metadata = prepared.metadata;
  if (!isObjectLike(metadata))
    return { error: "missing agent metadata" };
  let typedMetadata;
  try {
    typedMetadata = decodeChildSessionMetadata(metadata);
  } catch {
    return { error: "invalid agent metadata" };
  }
  const bridge = await createChildSession(pi, core, ctx, typedMetadata, childExtensionFactory, authorizeCleanup, revalidateAuthority);
  if (bridge === undefined || bridge.error !== undefined || bridge.missingSessionIdentifier) {
    return bridge;
  }
  const agentId = stringField(prepared, "agentId");
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  const cacheKey = childSessionCacheKey(agentId, keyScope);
  try {
    revalidateAuthority();
    childSessions.set(cacheKey, bridge);
    refreshOwnedChildPermissions(childSessions, ctx, core, revalidateAuthority);
    revalidateAuthority();
    const childSessionFacts = {
      agent_id: agentId,
      ...bridge.sessionId === undefined ? {} : { sessionId: bridge.sessionId },
      ...bridge.sessionFile === undefined ? {} : { sessionFile: bridge.sessionFile }
    };
    decodeCoreAck(core.call("recordAgentChildSessionStartAuthorized", [childSessionFacts, capabilityFacts, { ctx }]));
    return bridge;
  } catch (error) {
    authorizeCleanup();
    childSessions.delete(cacheKey);
    let closeError;
    try {
      authorizeCleanup();
      await bridge.close?.("stale_agent_action", authorizeCleanup);
    } catch (failure) {
      closeError = failure;
    } finally {
      authorizeCleanup();
      deleteAgentChildSession(core, agentId, ctx);
    }
    throw closeError ?? error;
  }
}
async function executeAgentPrepared(pi, core, childSessions, pendingAgentWaits2, prepared, ctx, signal, childExtensionFactory) {
  const action = prepared.action;
  let dispatchDeliverAs;
  if (action === "agent_start") {
    const details = prepared.details;
    const metadata = prepared.metadata;
    const activeTools = Array.isArray(details.activeTools) ? details.activeTools : [];
    const metadataTools = Array.isArray(metadata.activeTools) ? metadata.activeTools : [];
    if (stringField(prepared, "agentId") !== stringField(details, "agentId") || stringField(prepared, "agentId") !== stringField(metadata, "agentId") || stringField(prepared, "runId") !== stringField(details, "runId") || stringField(prepared, "prompt") !== stringField(details, "prompt") || stringField(prepared, "prompt").trim() === "" || stringField(details, "kind") !== stringField(metadata, "agentKind") || stringField(details, "model") !== stringField(metadata, "modelId") || stringField(details, "thinking") !== stringField(metadata, "thinkingLevel") || stringField(details, "workspace") !== stringField(metadata, "sourceWorkspace") || stringField(details, "isolation") !== stringField(metadata, "isolation") || JSON.stringify(activeTools) !== JSON.stringify(metadataTools)) {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent start state");
    }
  }
  if (action === "agent_send") {
    const rawDeliverAs = prepared.dispatchDeliverAs;
    if (rawDeliverAs !== "steer" && rawDeliverAs !== "followUp") {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent delivery mode");
    }
    dispatchDeliverAs = rawDeliverAs;
    const dispatch = prepared.dispatch === true;
    const outcome = stringField(prepared, "outcome");
    const prompt = stringField(prepared, "prompt");
    const runId = stringField(prepared, "runId");
    const submissionId = stringField(prepared, "submissionId");
    const details = isObjectLike(prepared.details) ? prepared.details : {};
    const allowedOutcomes = dispatch ? ["message_sent", "interrupted_and_sent", "resumed", "started"] : ["suspended", "already_suspended", "no_active_run"];
    const metadata = prepared.metadata;
    if (!allowedOutcomes.includes(outcome) || typeof metadata !== "object" || metadata === null || stringField(prepared, "agentId") !== stringField(details, "agentId") || stringField(prepared, "agentId") !== stringField(metadata, "agentId") || outcome !== stringField(details, "outcome") || runId !== stringField(details, "runId") || submissionId !== stringField(details, "submissionId") || dispatch && (runId === "" || submissionId === "" || prompt.trim() === "" || stringField(details, "status") !== "running") || (outcome === "suspended" || outcome === "already_suspended") && (runId === "" || submissionId !== "" || prompt !== "" || prepared.interrupt !== true || stringField(details, "status") !== "suspended") || outcome === "no_active_run" && (runId !== "" || submissionId !== "" || prompt !== "" || prepared.interrupt !== true || stringField(details, "status") !== "") || outcome === "message_sent" && (prepared.interrupt !== false || rawDeliverAs !== "steer") || outcome === "interrupted_and_sent" && prepared.interrupt !== true || (outcome === "message_sent" || outcome === "interrupted_and_sent" || outcome === "resumed") && stringField(prepared, "previousSubmissionId") === "" || outcome === "resumed" && !["interrupted_by_parent", "parent_shutdown", "process_interrupted", "close_cleanup_failed"].includes(stringField(prepared, "previousReasonCode")) || outcome === "started" && stringField(prepared, "previousSubmissionId") !== "" || outcome !== "message_sent" && dispatch && rawDeliverAs !== "followUp") {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent send state");
    }
  }
  if (action === "agent_close") {
    const details = isObjectLike(prepared.details) ? prepared.details : {};
    const agentId = stringField(prepared, "agentId");
    const runIds = Array.isArray(prepared.runIds) ? prepared.runIds : [];
    const snapshot = decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [{ ctx }]));
    const authoritativeRunIds = snapshot.runs.filter((run) => run.agentId === agentId).map((run) => run.runId).sort();
    const suppliedRunIds = runIds.filter((runId) => typeof runId === "string").sort();
    if (agentId !== stringField(details, "agentId") || JSON.stringify(suppliedRunIds) !== JSON.stringify(authoritativeRunIds)) {
      return agentErrorToolResult(core, "internal_error", "invalid prepared agent close state");
    }
  }
  if (action === "agent_close" && prepared.deleteWorktree === true && (stringField(prepared, "worktreePath") === "" || stringField(prepared, "worktreeBranch") === "" || stringField(prepared, "mainRepositoryRoot") === "" || prepared.isolation !== "worktree")) {
    return agentErrorToolResult(core, "internal_error", "invalid prepared agent worktree cleanup");
  }
  const capabilityFacts = agentActionCapabilityFacts(prepared, ctx);
  const capabilityGuarded = capabilityFacts !== undefined;
  if (capabilityGuarded) {
    try {
      decodeCoreAck(core.call("claimAgentAction", [capabilityFacts]));
    } catch (error) {
      return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
    }
  }
  const revalidateCapability = () => {
    if (capabilityGuarded) {
      decodeCoreAck(core.call("revalidateAgentAction", [capabilityFacts]));
    }
  };
  const ratchetCapability = () => {
    if (capabilityGuarded)
      decodeCoreAck(core.call("ratchetAgentAction", [capabilityFacts]));
  };
  const performCapabilityEffect = (effect) => {
    revalidateCapability();
    effect();
    ratchetCapability();
  };
  const authorizeCapabilityCleanup = () => {
    if (capabilityGuarded) {
      decodeCoreAck(core.call("authorizeAgentActionCleanup", [capabilityFacts]));
    }
  };
  try {
    switch (action) {
      case "agent_start": {
        let bridge;
        const rollbackWorktreeThenState = async () => {
          try {
            await cleanupUnacceptedStartChild(core, childSessions, prepared, ctx, authorizeCapabilityCleanup, bridge);
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
          try {
            authorizeCapabilityCleanup();
            decodeCoreAck(core.call("rollbackAgentWorktreeStart", [{ agent_id: prepared.agentId }, { ctx }]));
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
          try {
            rollbackUnacceptedStartState(core, prepared, ctx, authorizeCapabilityCleanup);
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
          return;
        };
        try {
          bridge = await createAgentChildSession(pi, core, childSessions, prepared, ctx, revalidateCapability, capabilityFacts, authorizeCapabilityCleanup, childExtensionFactory);
          revalidateCapability();
        } catch (error) {
          const cleanupError = await rollbackWorktreeThenState();
          const message = cleanupError ?? (error instanceof Error ? error.message : String(error));
          return agentErrorToolResult(core, childFailureCode(message), message);
        }
        if (bridge?.error !== undefined || bridge?.missingSessionIdentifier) {
          const cleanupError = await rollbackWorktreeThenState();
          const message = cleanupError ?? bridge?.error ?? "failed to create child session";
          return agentErrorToolResult(core, childFailureCode(message), message);
        }
        try {
          recordAuthorizedDispatchBoundary(core, prepared, ctx, bridge, capabilityFacts);
        } catch (error) {
          const cleanupError = await rollbackWorktreeThenState();
          const message = cleanupError ?? (error instanceof Error ? error.message : String(error));
          return agentErrorToolResult(core, cleanupError ? childFailureCode(cleanupError) : "persistence_failed", message);
        }
        const startCompletion = completionGate();
        const dispatch = await sendToChildSession(pi, core, bridge, stringField(prepared, "prompt"), "no initial prompt", {
          awaitCompletion: false,
          completionGate: startCompletion.wait,
          onEvent: recordDispatchActivity(core, prepared, ctx),
          onCompletion: recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits2, bridge)
        });
        if (dispatch.dispatched !== true) {
          startCompletion.release();
          const cleanupError = await rollbackWorktreeThenState();
          const reason = cleanupError ?? (typeof dispatch.reason === "string" ? dispatch.reason : "initial message was not accepted");
          return agentErrorToolResult(core, cleanupError ? childFailureCode(cleanupError) : "dispatch_failed", reason);
        }
        try {
          performCapabilityEffect(() => decodeCoreAck(core.call("acceptAgentWorktreeStart", [{ agent_id: prepared.agentId }, { ctx }])));
          startCompletion.release();
        } catch (error) {
          const cleanupError = await rollbackWorktreeThenState();
          startCompletion.release();
          const message = cleanupError ?? (error instanceof Error ? error.message : String(error)) ?? "failed to accept agent worktree";
          return agentErrorToolResult(core, childFailureCode(message), message);
        }
        return preparedToolResult(core, {
          text: stringField(prepared, "text"),
          details: prepared.details
        });
      }
      case "agent_send": {
        const agentId = stringField(prepared, "agentId");
        const keyScope = childSessionCacheKeyScopeFromContext(ctx);
        const interrupt = prepared.interrupt === true;
        let bridge = childSessions.get(childSessionCacheKey(agentId, keyScope));
        if (interrupt && stringField(prepared, "prompt") === "") {
          try {
            if (bridge?.stop !== undefined) {
              revalidateCapability();
              await bridge.stop("interrupted_by_parent");
              revalidateCapability();
              ratchetCapability();
            }
          } catch (error) {
            authorizeCapabilityCleanup();
            decodeCoreAck(core.call("rollbackFailedAgentInterruption", [{
              agent_id: agentId,
              run_id: stringField(prepared, "runId")
            }, { ctx }]));
            const message = error instanceof Error ? error.message : String(error);
            return agentErrorToolResult(core, "dispatch_failed", `agent interruption failed: ${message}`);
          }
          revalidateCapability();
          return preparedToolResult(core, {
            text: stringField(prepared, "text"),
            details: prepared.details
          });
        }
        const metadata = isObjectLike(prepared.metadata) ? prepared.metadata : undefined;
        const workspace = metadata === undefined ? "" : stringField(metadata, "workspaceDirectory");
        if (workspace === "") {
          rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          return agentErrorToolResult(core, "workspace_unavailable", "identity workspace is missing");
        }
        try {
          const fs = await import("node:fs/promises");
          if (!(await fs.stat(workspace)).isDirectory())
            throw new Error("not a directory");
        } catch {
          rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          return agentErrorToolResult(core, "workspace_unavailable", "identity workspace is unavailable");
        }
        revalidateCapability();
        if (bridge === undefined) {
          try {
            bridge = await createAgentChildSession(pi, core, childSessions, prepared, ctx, revalidateCapability, capabilityFacts, authorizeCapabilityCleanup, childExtensionFactory);
            revalidateCapability();
          } catch (error) {
            rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
            return agentErrorToolResult(core, "child_session_unavailable", error instanceof Error ? error.message : String(error));
          }
        }
        if (bridge === undefined || bridge.error !== undefined || bridge.missingSessionIdentifier) {
          rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          return agentErrorToolResult(core, "child_session_unavailable", bridge?.error ?? "failed to reopen child session");
        }
        try {
          recordAuthorizedDispatchBoundary(core, prepared, ctx, bridge, capabilityFacts);
        } catch (error) {
          rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
          return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
        }
        if (interrupt && bridge.stop !== undefined) {
          try {
            revalidateCapability();
            await bridge.stop("interrupted_by_parent");
          } catch (error) {
            rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
            return agentErrorToolResult(core, "dispatch_failed", `agent interruption failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          try {
            revalidateCapability();
          } catch (error) {
            authorizeCapabilityCleanup();
            decodeCoreAck(core.call("recordAgentSendDispatchFailure", [{
              run_id: stringField(prepared, "runId"),
              submission_id: stringField(prepared, "submissionId"),
              error: error instanceof Error ? error.message : String(error)
            }, { ctx }]));
            return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
          }
        }
        if (prepared.dispatch === true) {
          revalidateCapability();
          const sendCompletion = completionGate();
          const dispatch = await sendToChildSession(pi, core, bridge, stringField(prepared, "prompt"), "empty prompt", {
            awaitCompletion: false,
            completionGate: sendCompletion.wait,
            deliverAs: dispatchDeliverAs,
            onEvent: recordDispatchActivity(core, prepared, ctx),
            onCompletion: recordDispatchCompletionInBackground(pi, core, prepared, ctx, pendingAgentWaits2, bridge)
          });
          if (dispatch.dispatched !== true) {
            sendCompletion.release();
            const reason = typeof dispatch.reason === "string" ? dispatch.reason : "agent message was not accepted";
            if (interrupt && stringField(prepared, "outcome") === "interrupted_and_sent") {
              authorizeCapabilityCleanup();
              decodeCoreAck(core.call("recordAgentSendDispatchFailure", [{
                run_id: stringField(prepared, "runId"),
                submission_id: stringField(prepared, "submissionId"),
                error: reason
              }, { ctx }]));
            } else {
              rollbackAgentSendPreflight(core, prepared, ctx, authorizeCapabilityCleanup);
            }
            return agentErrorToolResult(core, "dispatch_failed", reason);
          }
          try {
            revalidateCapability();
            ratchetCapability();
          } finally {
            sendCompletion.release();
          }
        }
        return preparedToolResult(core, {
          text: stringField(prepared, "text"),
          details: prepared.details
        });
      }
      case "agent_wait": {
        const runIds = Array.isArray(prepared.runIds) ? prepared.runIds.filter((value) => typeof value === "string") : [];
        const waitSnapshot = decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [{ ctx }]));
        for (const run of waitSnapshot.runs) {
          if (runIds.includes(run.runId))
            rememberAgentDescription(run.agentId, run.description);
        }
        const timeoutSeconds = typeof prepared.timeoutSeconds === "number" ? prepared.timeoutSeconds : undefined;
        const controllers = [];
        for (const runId of runIds) {
          const controller = new AbortController;
          controllers.push(controller);
          const key = pendingAgentWaitKey(ctx, runId);
          const claims = pendingAgentWaits2.get(key) ?? new Set;
          claims.add(controller);
          pendingAgentWaits2.set(key, claims);
        }
        const clearClaims = () => {
          for (let index = 0;index < runIds.length; index += 1) {
            const key = pendingAgentWaitKey(ctx, runIds[index]);
            const claims = pendingAgentWaits2.get(key);
            if (claims === undefined)
              continue;
            claims.delete(controllers[index]);
            if (claims.size === 0)
              pendingAgentWaits2.delete(key);
          }
        };
        const closed = () => controllers.some((controller) => controller.signal.aborted);
        const cancelledByClose = () => agentErrorToolResult(core, "run_not_found", "one or more selected runs no longer exist");
        try {
          if (closed())
            return cancelledByClose();
          if (signal?.aborted) {
            clearClaims();
            return agentErrorToolResult(core, "internal_error", "agent_wait was interrupted");
          }
          const started = Date.now();
          while (true) {
            const finished = decodePreparedToolAction(core.call("finishAgentWait", [{ run_ids: runIds }, { ctx }]));
            if (finished.ok === false) {
              if (closed())
                return cancelledByClose();
              return agentErrorToolResult(core, "run_not_found", finished.error);
            }
            if (finished.ok === true && finished.action === "tool_result") {
              clearClaims();
              return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{ prepared: finished, extraDetails: {} }]));
            }
            if (timeoutSeconds !== undefined) {
              const elapsed = (Date.now() - started) / 1000;
              if (elapsed >= timeoutSeconds) {
                clearClaims();
                const payload = { timed_out: true, results: [], pending_run_ids: runIds };
                return preparedToolResult(core, { text: JSON.stringify(payload), details: payload });
              }
            }
            await new Promise((resolve2) => setTimeout(resolve2, 50));
            if (closed())
              return cancelledByClose();
            if (signal?.aborted) {
              clearClaims();
              return agentErrorToolResult(core, "internal_error", "agent_wait was interrupted");
            }
          }
        } finally {
          clearClaims();
        }
      }
      case "agent_close": {
        const agentId = stringField(prepared, "agentId");
        cancelAgentApprovals(sessionInfoFromContext(ctx).sessionId, agentId);
        const runIds = Array.isArray(prepared.runIds) ? prepared.runIds.filter((value) => typeof value === "string") : [];
        for (const runId of runIds) {
          const waitKey = pendingAgentWaitKey(ctx, runId);
          for (const controller of pendingAgentWaits2.get(waitKey) ?? []) {
            controller.abort();
          }
          pendingAgentWaits2.delete(waitKey);
        }
        const keyScope = childSessionCacheKeyScopeFromContext(ctx);
        const key = childSessionCacheKey(agentId, keyScope);
        const bridge = childSessions.get(key);
        let childExecutionInterrupted = false;
        const failClose = (code, message) => {
          let transitionError = "";
          if (childExecutionInterrupted && !/unknown agent:/.test(message)) {
            try {
              authorizeCapabilityCleanup();
              decodeCoreAck(core.call("recordAgentCloseCleanupFailure", [{ agent_id: agentId }, { ctx }]));
            } catch (error) {
              transitionError = error instanceof Error ? error.message : String(error);
            }
          }
          const fullMessage = transitionError === "" ? message : `${message}; ${transitionError}`;
          return agentErrorToolResult(core, code, fullMessage);
        };
        try {
          revalidateCapability();
          try {
            decodeCoreAck(await core.call("cancelAgentBrokerSessions", [{ agent_id: agentId }]));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return agentErrorToolResult(core, "cleanup_failed", message || "broker session cancellation failed");
          }
          if (bridge?.stop !== undefined) {
            try {
              decodeCoreAck(core.call("prepareAgentCloseStop", [capabilityFacts]));
              childExecutionInterrupted = true;
              await bridge.stop("agent_closed");
              decodeCoreAck(core.call("completeAgentCloseStop", [capabilityFacts]));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return failClose("cleanup_failed", `agent stop failed: ${message}`);
            }
          }
          if (prepared.deleteWorktree === true) {
            try {
              revalidateCapability();
              decodeCoreAck(core.call("deleteAgentWorktree", [{ agent_id: agentId }, { ctx }]));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return failClose("cleanup_failed", message || "worktree deletion failed");
            }
          }
          if (bridge !== undefined)
            childExecutionInterrupted = true;
          revalidateCapability();
          await applyChildSessionUpdate(childSessions, {
            action: "delete_child_session",
            key: agentId,
            reason: "agent_closed"
          }, bridge, keyScope, revalidateCapability);
          revalidateCapability();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return failClose("cleanup_failed", `agent_close cleanup failed: ${message}`);
        }
        let finished;
        try {
          revalidateCapability();
          finished = decodeCoreAck(core.call("finishAgentClose", [{ agent_id: agentId }, { ctx }]));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return failClose(/cleanup_failed/.test(message) ? "cleanup_failed" : "persistence_failed", message);
        }
        if (finished.ok !== true) {
          return failClose("persistence_failed", "agent close state removal failed");
        }
        return preparedToolResult(core, {
          text: stringField(prepared, "text"),
          details: prepared.details
        });
      }
      default:
        return agentErrorToolResult(core, "internal_error", `unknown agent action: ${action}`);
    }
  } catch (error) {
    return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
  } finally {
    if (capabilityGuarded) {
      try {
        decodeCoreAck(core.call("releaseAgentAction", [capabilityFacts]));
      } catch {}
    }
  }
}
function countActiveChildRuns(core, ctx) {
  try {
    return decodeAgentActiveCountResult(core.call("countActiveChildRuns", [{ ctx }])).count;
  } catch {
    return 0;
  }
}
async function noninteractiveTurnDrain(pi, core, ctx, pendingAgentWaits2) {
  if (!isObjectLike(ctx))
    return;
  if (ctx.mode !== "print" && ctx.mode !== "json")
    return;
  if (typeof pi.sendMessage !== "function")
    return;
  const drainKey = sessionInfoFromContext(ctx).sessionId ?? "current";
  if (activeNoninteractiveDrains.has(drainKey))
    return;
  activeNoninteractiveDrains.add(drainKey);
  try {
    while (true) {
      const sent = await flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits2);
      if (sent > 0)
        return;
      if (countActiveChildRuns(core, ctx) === 0)
        return;
      await new Promise((resolve2) => setTimeout(resolve2, 100));
    }
  } finally {
    activeNoninteractiveDrains.delete(drainKey);
  }
}
function installAgentLifecycle(pi, core, childSessions, pendingAgentWaits2) {
  const reconcileAfterLoad = (_event, ctx) => {
    if (isChildSessionContext(ctx))
      return;
    setTimeout(() => {
      try {
        decodeCoreAck(core.call("reconcileProvisionalAgentWorktrees", []));
      } catch {}
      reconcilePersistedAgentNotifications(core, ctx);
      if (!isObjectLike(ctx) || ctx.hasUI !== true || !isObjectLike(ctx.ui))
        return;
      const notify = ctx.ui.notify;
      if (typeof notify !== "function")
        return;
      const diagnostics = decodeAgentRoutingDiagnosticsResult(core.call("agentRoutingDiagnostics", [])).diagnostics;
      for (const diagnostic2 of diagnostics) {
        notify.call(ctx.ui, diagnostic2, "warning");
      }
    }, 0);
  };
  pi.on("session_start", reconcileAfterLoad);
  pi.on("session_switch", reconcileAfterLoad);
  pi.on("session_fork", reconcileAfterLoad);
  pi.on("session_shutdown", async (_event, ctx) => {
    if (isChildSessionContext(ctx))
      return;
    const shutdown = async () => {
      const info = sessionInfoFromContext(ctx);
      const agents = decodeAgentCleanupPlan(core.call("ephemeralAgentCleanupPlan", [{ ctx }])).agents;
      const keyScope = childSessionCacheKeyScopeFromContext(ctx);
      if (info.sessionFile === undefined) {
        for (const agent of agents) {
          const agentId = agent.agentId;
          if (agentId === "")
            continue;
          await applyChildSessionUpdate(childSessions, {
            action: "delete_child_session",
            key: agentId,
            reason: "parent_shutdown"
          }, undefined, keyScope);
        }
        try {
          decodeCoreAck(core.call("finishEphemeralAgentCleanup", [{ ctx }]));
        } finally {
          decodeCoreAck(core.call("releaseEphemeralAgentCleanupLease", [{ ctx }]));
        }
        return;
      }
      decodeCoreAck(core.call("suspendOwnerAgentsOnShutdown", [{ ctx }]));
      for (const agent of agents) {
        const agentId = agent.agentId;
        if (agentId === "")
          continue;
        await applyChildSessionUpdate(childSessions, {
          action: "stop_child_session",
          key: agentId,
          reason: "parent_shutdown"
        }, undefined, keyScope);
      }
    };
    try {
      await shutdown();
    } catch (error) {
      if (!isStaleContextError(error)) {
        console.warn("Taumel agent shutdown suspend failed:", error);
      }
    }
  });
  pi.on("turn_end", async (_event, ctx) => {
    if (isChildSessionContext(ctx))
      return;
    try {
      await flushPendingAgentNotifications(pi, core, ctx, "steer", pendingAgentWaits2);
      await noninteractiveTurnDrain(pi, core, ctx, pendingAgentWaits2);
    } catch (error) {
      if (isStaleContextError(error))
        return;
      console.warn("Taumel agent turn_end notification flush failed:", error);
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    if (isChildSessionContext(ctx))
      return;
    setTimeout(() => {
      flushPendingAgentNotifications(pi, core, ctx, "trigger", pendingAgentWaits2).catch((error) => {
        if (isStaleContextError(error))
          return;
        console.warn("Taumel agent agent_end notification flush failed:", error);
      });
      noninteractiveTurnDrain(pi, core, ctx, pendingAgentWaits2).catch((error) => {
        if (isStaleContextError(error))
          return;
        console.warn("Taumel agent noninteractive drain failed:", error);
      });
    }, 0);
  });
}

// src/authority-plans.ts
async function executeExaInCore(core, prepared, ctx) {
  const rendered = decodeBridgeToolExecutionResult(await core.call("executeExa", [{
    planId: prepared.planId,
    ctx
  }]));
  if (!rendered.ok)
    return errorToolResult(core, rendered.error, { ...rendered });
  return preparedToolResult(core, { ...rendered });
}
function approveExaPlan(core, prepared, ctx) {
  decodeCoreAck(core.call("approveExaPlan", [{ planId: prepared.planId, ctx }]));
}
async function executeApprovedExaInCore(core, prepared, ctx) {
  approveExaPlan(core, prepared, ctx);
  return executeExaInCore(core, prepared, ctx);
}
function authorityPlanId(prepared) {
  return "planId" in prepared && typeof prepared.planId === "string" ? prepared.planId : undefined;
}
function discardPreparedAuthorityPlan(core, prepared, ctx) {
  const planId = authorityPlanId(prepared);
  if (planId === undefined)
    return;
  try {
    decodeCoreAck(core.call("discardAuthorityPlan", [{ planId, ctx }]));
  } catch {}
}

// src/usage-host.ts
function openAiUsageHostAuth(core) {
  return decodeOpenAiUsageHostAuth(core.call("openAiUsageHostAuth", []));
}
function kimiUsageHostAuth(core) {
  return decodeKimiUsageHostAuth(core.call("kimiUsageHostAuth", []));
}
function openAiUsageHostParams(core, facts) {
  return decodeOpenAiUsageHostParams(core.call("openAiUsageHostParams", [facts]));
}
function kimiUsageHostParams(core, facts) {
  return decodeKimiUsageHostParams(core.call("kimiUsageHostParams", [facts]));
}
async function executeOpenAiUsageInCore(core, ctx, params) {
  const rendered = decodeBridgeToolResult(await core.call("executeOpenAiUsage", [params, ctx]));
  return preparedToolResult(core, { ...rendered });
}
async function executeUsagePairInCore(core, ctx, openai, kimi) {
  const rendered = decodeBridgeToolResult(await core.call("executeUsagePair", [{ openai, kimi }, ctx]));
  return preparedToolResult(core, { ...rendered });
}
async function resolveOpenAiUsageParams(pi, core, apiKeyPresent, ctx) {
  const registry = modelRegistryFrom(pi, ctx);
  const auth = openAiUsageHostAuth(core);
  const credential = openAiCredentialRaw(registry, auth.credentialKey);
  let tokenFacts;
  try {
    tokenFacts = { token: await usageTokenRaw(registry, auth.providerKey) };
  } catch (error) {
    tokenFacts = { tokenError: error instanceof Error ? error.message : String(error) };
  }
  return openAiUsageHostParams(core, {
    apiKeyPresent,
    ...credential !== undefined ? { credential } : {},
    ...tokenFacts
  });
}
async function resolveKimiUsageParams(pi, core, ctx) {
  const registry = modelRegistryFrom(pi, ctx);
  const auth = kimiUsageHostAuth(core);
  let tokenFacts;
  try {
    tokenFacts = { token: await usageTokenRaw(registry, auth.providerKey) };
  } catch (error) {
    tokenFacts = { tokenError: error instanceof Error ? error.message : String(error) };
  }
  return kimiUsageHostParams(core, tokenFacts);
}
async function executeOpenAiUsageWithHostAuth(pi, core, prepared, ctx) {
  return executeOpenAiUsageInCore(core, ctx, await resolveOpenAiUsageParams(pi, core, prepared["apiKeyPresent"] === true, ctx));
}
async function executeUsagePairWithHostAuth(pi, core, prepared, ctx) {
  const [openai, kimi] = await Promise.all([
    resolveOpenAiUsageParams(pi, core, prepared.openaiApiKeyPresent === true, ctx),
    resolveKimiUsageParams(pi, core, ctx)
  ]);
  return executeUsagePairInCore(core, ctx, openai, kimi);
}

// src/tool-executor.ts
var agentToolNames2 = new Set(["agent_spawn", "finder", "oracle", "agent_send", "agent_wait", "agent_list", "agent_close"]);
var invalidChildSafeToolNames = new Set([
  "read",
  "view_media",
  "get_plan",
  "query_threads",
  "read_thread",
  "ralph_continue",
  "ralph_finish",
  "cron_list",
  "agent_wait",
  "agent_list"
]);
function agentFailureText(name, result2) {
  if (!agentToolNames2.has(name))
    return;
  const details = objectValue(result2.details);
  const error = objectValue(details?.["error"]);
  if (details?.["ok"] !== false || typeof error?.["code"] !== "string" || typeof error["message"] !== "string") {
    return;
  }
  return result2.content.flatMap((item) => item.type === "text" ? [item.text] : []).join(`
`);
}
async function withPlanClockPaused(core, run) {
  core.call("planClockPauseStart", []);
  try {
    return await run();
  } finally {
    core.call("planClockPauseEnd", []);
  }
}
function approvalOutcomeMessage(action, outcome) {
  switch (outcome) {
    case "denied_by_user":
      return `Error: ${action} approval denied by user`;
    case "timed_out":
      return `Error: ${action} approval timed out`;
    case "unavailable":
      return `Error: approval_unavailable: ${action} approval is unavailable`;
    case "interrupted":
      return `Error: ${action} approval interrupted`;
    case "approved_always":
    case "approved":
      return "";
  }
}
async function appendExecPolicyAllowRule(core, tokens) {
  const settingsPath = join4(getAgentDir3(), "settings.json");
  const { settings: root, authorization } = await readJsonObjectForAtomicUpdate(settingsPath, true);
  const existingTaumel = root["taumel"], taumel = existingTaumel === undefined ? {} : objectValue(existingTaumel);
  if (taumel === undefined)
    throw new Error(`${settingsPath}: taumel must be a JSON object`);
  const existingExecPolicy = taumel["execPolicy"], execPolicy = existingExecPolicy === undefined ? {} : objectValue(existingExecPolicy);
  if (execPolicy === undefined)
    throw new Error(`${settingsPath}: taumel.execPolicy must be a JSON object`);
  const existingRules = execPolicy["rules"];
  if (existingRules !== undefined && !Array.isArray(existingRules))
    throw new Error(`${settingsPath}: taumel.execPolicy.rules must be an array`);
  const rules = existingRules ?? [];
  const pattern = [...tokens];
  rules.push({ pattern, decision: "allow", match: [pattern] });
  execPolicy["rules"] = rules;
  taumel["execPolicy"] = execPolicy;
  root["taumel"] = taumel;
  await writeFileAtomically(authorization, `${JSON.stringify(root, null, 2)}
`, true);
  decodeExecPolicyAllowRuleResult(core.call("appendExecPolicyAllowRule", [{ tokens: pattern }]));
}
function mutationApprovalDenied(core, action, outcome) {
  return errorToolResult(core, approvalOutcomeMessage(action, outcome), {
    ok: false,
    approvalRequired: true,
    approvalOutcome: outcome,
    ...outcome === "unavailable" ? { reason: "approval_unavailable" } : {}
  });
}
function childSessionMarkerFromContext(ctx) {
  return latestTaumelCustomEntry(objectLikeValue(ctx)?.sessionManager, "taumel.childSession");
}
function childSessionMetadataFromContext(ctx) {
  const marker = childSessionMarkerFromContext(ctx);
  return marker.kind === "contract_valid" ? marker.entry.data : undefined;
}
function childMutationConfinement(ctx) {
  const marker = childSessionMarkerFromContext(ctx);
  if (marker.kind === "absent")
    return "none";
  if (marker.kind !== "contract_valid")
    return "invalid";
  const metadata = marker.entry.data;
  return metadata.kind === "agent" && metadata.isolation === "worktree" ? "worktree" : "none";
}
var loadedMainSessionId;
function childApprovalOwnerIsLoaded(ctx) {
  const marker = childSessionMarkerFromContext(ctx);
  if (marker.kind === "absent")
    return true;
  if (marker.kind !== "contract_valid")
    return false;
  const metadata = marker.entry.data;
  const parentSessionId = typeof metadata.parentSessionId === "string" ? metadata.parentSessionId.trim() : "";
  return parentSessionId !== "" && parentSessionId === loadedMainSessionId;
}
function approvalOwnerId(ctx) {
  const metadata = childSessionMetadataFromContext(ctx);
  if (metadata !== undefined) {
    const owner = typeof metadata.parentSessionId === "string" ? metadata.parentSessionId.trim() : "";
    return owner === "" ? undefined : owner;
  }
  return sessionInfoFromContext(ctx).sessionId;
}
function installIsolatedChildOwnershipLifecycle(pi, core, childSessions) {
  const loadParent = (ctx) => {
    if (childSessionMarkerFromContext(ctx).kind !== "absent")
      return;
    loadedMainSessionId = sessionInfoFromContext(ctx).sessionId;
    bindHarnessApprovalUi(loadedMainSessionId, objectLikeValue(ctx)?.hasUI === true, objectLikeValue(ctx)?.ui);
    refreshOwnedChildPermissions(childSessions, ctx, core);
  };
  pi.on("session_start", (_event, ctx) => loadParent(ctx));
  const replaceLoadedSession = (_event, ctx) => {
    if (childSessionMarkerFromContext(ctx).kind !== "absent") {
      loadedMainSessionId = undefined;
      clearHarnessApprovalUi();
      return;
    }
    loadParent(ctx);
  };
  pi.on("session_resume", replaceLoadedSession);
  pi.on("session_switch", replaceLoadedSession);
  pi.on("session_shutdown", (_event, ctx) => {
    const ownerId = sessionInfoFromContext(ctx).sessionId;
    if (ownerId !== undefined && ownerId === loadedMainSessionId) {
      loadedMainSessionId = undefined;
      clearHarnessApprovalUi(ownerId);
    }
  });
}
function boundedApprovalEvidence(prepared) {
  const limit = 4000;
  const action = prepared.action;
  const lines = [];
  const sandbox = "sandbox" in prepared ? prepared.sandbox : undefined;
  if (sandbox !== undefined) {
    lines.push(`Sandbox boundary: ${sandbox.filesystemMode}; roots: ${sandbox.workspaceRoots.join(", ")}`);
  } else {
    const roots = "workspaceRoots" in prepared ? prepared.workspaceRoots : undefined;
    if (roots !== undefined)
      lines.push(`Sandbox boundary: workspace roots: ${roots.join(", ")}`);
  }
  if (action === "exec_command_approval") {
    lines.push(`Command: ${prepared.cmd}`);
    lines.push(`Working directory: ${prepared.workdir}`);
  } else {
    const paths = "affectedPaths" in prepared ? prepared.affectedPaths : undefined;
    if (paths !== undefined)
      lines.push(`Paths: ${paths.join(", ")}`);
    else {
      const path = "path" in prepared ? prepared.path : "";
      if (path !== "")
        lines.push(`Path: ${path}`);
    }
    const patch = "patch" in prepared ? prepared.patch : undefined;
    const contents = "contents" in prepared ? prepared.contents : undefined;
    const edits = "edits" in prepared ? prepared.edits : [];
    const effect = patch ?? (contents === undefined ? undefined : contents.split(/\r?\n/).map((line) => `+${line}`).join(`
`)) ?? edits.map((edit) => `-${edit.oldText}
+${edit.newText}`).join(`
`);
    if (effect !== undefined && effect !== "")
      lines.push(`Bounded effect diff:
${effect}`);
  }
  const evidence = lines.join(`

`);
  return evidence.length <= limit ? evidence : `${evidence.slice(0, limit)}
… effect diff truncated`;
}
async function requestSandboxRetryApproval(core, prepared, ctx, signal, validate) {
  if (!childApprovalOwnerIsLoaded(ctx))
    return "unavailable";
  const metadata = childSessionMetadataFromContext(ctx);
  const agentId = metadata?.kind === "agent" ? metadata.agentId.trim() : "";
  const requester = agentId !== "" ? `Agent ${agentId}: ` : "";
  return requestHarnessApproval({
    ownerSessionId: approvalOwnerId(ctx),
    origin: requester === "" ? "top-level" : "agent",
    ...agentId === "" ? {} : { agentId },
    signal,
    validate,
    run: async (ui, requestSignal) => {
      const approved = await withPlanClockPaused(core, async () => await ui.confirm(`${requester}Command requires approval`, `command failed; retry without sandbox?

${prepared.cmd}`, { signal: requestSignal }));
      if (requestSignal.aborted)
        return "interrupted";
      return approved === true ? "approved" : "denied_by_user";
    }
  });
}
async function runPreparedExec(pi, core, prepared, ctx, signal, forceUnsandboxed = false, validateApproval, replan) {
  const ownerId = sessionInfoFromContext(ctx).sessionId ?? "current";
  let result2;
  try {
    result2 = decodeExecToolResult(await core.call("runExecCommand", [
      prepared,
      ownerId,
      signal ?? null,
      ctx
    ]));
  } catch (error) {
    discardPreparedAuthorityPlan(core, prepared, ctx);
    throw error;
  }
  if (!forceUnsandboxed && shouldOfferSandboxRetry(prepared, result2)) {
    const outcome = await requestSandboxRetryApproval(core, prepared, ctx, signal, validateApproval);
    if (outcome === "replan") {
      discardPreparedAuthorityPlan(core, prepared, ctx);
      if (replan !== undefined)
        return replan();
      throw new Error("approval policy changed; retry the command");
    }
    if (outcome === "approved") {
      const retry = decodeAuthorityPlanIssued(core.call("reissueExecPlan", [{
        planId: prepared.planId,
        ctx
      }]));
      return runPreparedExec(pi, core, { ...prepared, planId: retry.planId }, ctx, signal, true);
    }
    discardPreparedAuthorityPlan(core, prepared, ctx);
    if (outcome === "denied_by_user")
      throw new Error("rejected by user");
    throw new Error(approvalOutcomeMessage("command retry", outcome));
  }
  discardPreparedAuthorityPlan(core, prepared, ctx);
  const sessionId = result2.details.sessionId;
  if (sessionId !== undefined) {
    startExecCompletionWaiter(pi, core, ctx, sessionId).catch((error) => {
      console.warn("Taumel exec completion waiter failed:", error);
    });
  }
  return result2;
}
var networkSandboxEvidence = [
  "temporary failure",
  "could not resolve",
  "name resolution",
  "network is unreachable",
  "no route to host",
  "failed to connect",
  "connection timed out",
  "dns"
];
var filesystemSandboxEvidence = [
  "permission denied",
  "operation not permitted",
  "read-only file system",
  "erofs",
  "eacces",
  "eperm"
];
function shouldOfferSandboxRetry(prepared, result2) {
  if (prepared.sandbox.approvalPolicy !== "on-failure" && prepared.sandbox.approvalPolicy !== "untrusted")
    return false;
  if (result2.details.sandboxed !== true || result2.details.escalated === true || result2.details.exitCode === undefined || result2.details.exitCode === 0)
    return false;
  const output = result2.details.output.toLowerCase();
  if (prepared.sandbox.networkMode !== "enabled" && networkSandboxEvidence.some((value) => output.includes(value)))
    return true;
  return prepared.sandbox.filesystemMode !== "danger-full-access" && filesystemSandboxEvidence.some((value) => output.includes(value));
}
async function runPreparedRead(core, prepared, ctx) {
  const { offset, limit } = prepared;
  return decodeToolResultEnvelope(await core.call("readFile", [{
    path: prepared.path,
    defaultCwd: cwdFromContext(ctx),
    ...offset === undefined ? {} : { offset },
    ...limit === undefined ? {} : { limit }
  }]));
}
async function runPreparedViewMedia(core, prepared, ctx) {
  return decodeViewMediaResultEnvelope(await core.call("viewMedia", [{
    path: prepared.path,
    defaultCwd: cwdFromContext(ctx)
  }]));
}
function contextModelSupportsImages(ctx) {
  const rawModel = objectLikeValue(ctx)?.model;
  if (typeof rawModel !== "object" || rawModel === null)
    return false;
  const input = rawModel.input;
  return Array.isArray(input) && input.includes("image");
}
async function writePreparedStdin(core, prepared, ctx, signal) {
  const { sessionId, outputMode, yieldTimeMs, maxOutputTokens } = prepared;
  return decodeExecToolResult(await core.call("writeExecStdin", [{
    sessionId,
    chars: prepared.chars,
    ownerId: sessionInfoFromContext(ctx).sessionId ?? "current",
    ...outputMode === undefined ? {} : { outputMode },
    ...yieldTimeMs === undefined ? {} : { yieldTimeMs },
    ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
    ...signal === undefined ? {} : { signal }
  }]));
}
async function confirmExecApproval(core, prepared, ctx, signal, validate) {
  const childMetadata = childSessionMetadataFromContext(ctx);
  const agentId = childMetadata?.kind === "agent" ? childMetadata.agentId.trim() : "";
  const requester = agentId !== "" ? `Agent ${agentId}: ` : "";
  if (!childApprovalOwnerIsLoaded(ctx))
    return "unavailable";
  const outcome = await requestHarnessApproval({
    ownerSessionId: approvalOwnerId(ctx),
    origin: requester === "" ? "top-level" : "agent",
    ...agentId === "" ? {} : { agentId },
    signal,
    validate,
    commit: async (committedOutcome) => {
      if (committedOutcome !== "approved_always")
        return;
      const allowAlwaysTokens = prepared.action === "exec_command_approval" ? prepared.execPolicyAllowAlwaysTokens : undefined;
      if (allowAlwaysTokens !== undefined)
        await appendExecPolicyAllowRule(core, allowAlwaysTokens);
    },
    run: async (ui, requestSignal) => {
      const plan = decodeExecApprovalPromptPlan(core.call("planExecApprovalPrompt", [{
        approvalTitle: `${requester}${prepared.approvalTitle}`,
        approvalPrompt: `${requester}${prepared.approvalPrompt}`,
        approvalTimeoutMs: prepared.approvalTimeoutMs,
        uiAvailable: true
      }]));
      if (plan.kind === "unavailable")
        return "unavailable";
      const allowAlwaysTokens = prepared.action === "exec_command_approval" ? prepared.execPolicyAllowAlwaysTokens : undefined;
      const timeoutMs = plan.timeoutMs;
      const controller = new AbortController;
      let outcome2;
      const abort = () => {
        if (outcome2 === undefined)
          outcome2 = "interrupted";
        controller.abort();
      };
      requestSignal.addEventListener("abort", abort, { once: true });
      const timeoutId = timeoutMs !== undefined && timeoutMs > 0 ? setTimeout(() => {
        outcome2 = "timed_out";
        controller.abort();
      }, timeoutMs) : undefined;
      try {
        const prompt = `${plan.prompt}

${boundedApprovalEvidence(prepared)}`;
        if (allowAlwaysTokens !== undefined && allowAlwaysTokens.length > 0 && typeof ui.select === "function") {
          const selected = await withPlanClockPaused(core, async () => await ui.select?.(`${plan.title}

${prompt}`, ["Deny", "Allow once", "Allow always"], { signal: controller.signal }));
          if (selected === "Allow once")
            return "approved";
          if (selected === "Allow always")
            return "approved_always";
          return controller.signal.aborted ? outcome2 ?? "interrupted" : "denied_by_user";
        }
        const approved = await withPlanClockPaused(core, async () => await ui.confirm(plan.title, prompt, { signal: controller.signal }));
        if (approved === true)
          return "approved";
        return controller.signal.aborted ? outcome2 ?? "interrupted" : "denied_by_user";
      } catch (error) {
        if (controller.signal.aborted)
          return outcome2 ?? "interrupted";
        throw error;
      } finally {
        if (timeoutId !== undefined)
          clearTimeout(timeoutId);
        requestSignal.removeEventListener("abort", abort);
      }
    }
  });
  return outcome;
}
async function withMutationApproval(core, action, prepared, ctx, signal, validate, replan, run) {
  const outcome = await confirmExecApproval(core, prepared, ctx, signal, validate);
  if (outcome === "replan") {
    discardPreparedAuthorityPlan(core, prepared, ctx);
    return replan();
  }
  if (outcome !== "approved") {
    discardPreparedAuthorityPlan(core, prepared, ctx);
    return mutationApprovalDenied(core, action, outcome);
  }
  return run();
}
async function authorizePreparedMutationPaths(core, prepared, paths) {
  try {
    const authorizations = prepared.validateWorkspacePaths ? await validateWorkspaceMutationPaths(core, paths, prepared.workspaceRoots) : await authorizeCanonicalMutationPaths(paths);
    return { kind: "authorized", paths: authorizations };
  } catch (error) {
    return { kind: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
}
async function runThreadTool(core, name, prepared, ctx) {
  if (name !== "query_threads" && name !== "read_thread")
    throw new Error(`Invalid thread tool: ${name}`);
  return decodeToolResultEnvelope(core.call("runThreadTool", [{
    name,
    params: prepared,
    catalog: await threadSources(core, ctx, prepared),
    ctx
  }]));
}
async function executeLegacyWrite(core, prepared) {
  const { path, contents } = prepared;
  const displayPath = prepared.displayPath;
  const mode = prepared.mode;
  const authorization = await authorizePreparedMutationPaths(core, prepared, [path]);
  if (authorization.kind === "invalid") {
    return errorToolResult(core, authorization.error, { ok: false, error: authorization.error });
  }
  if (mode === "append") {
    await appendToFile(authorization.paths[0], contents);
  } else {
    await writePatchFiles({ deletes: [], writes: [{ path, contents }], authorizations: authorization.paths });
  }
  return hostToolResult(core, "write", {
    ok: true,
    action: "write",
    path,
    displayPath,
    mode,
    contents,
    byteLength: contents.length
  });
}
async function executeLegacyEdit(core, prepared) {
  const { path } = prepared;
  const displayPath = prepared.displayPath;
  const authorization = await authorizePreparedMutationPaths(core, prepared, [path]);
  if (authorization.kind === "invalid") {
    return errorToolResult(core, authorization.error, { ok: false, error: authorization.error });
  }
  let content;
  let editAuthorization = authorization.paths[0];
  try {
    const read = await readAuthorizedFile(editAuthorization);
    editAuthorization = read.authorization;
    content = new TextDecoder().decode(read.contents);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? error.code : undefined;
    const errorMessage = typeof code === "string" ? `Error code: ${code}` : String(error);
    return errorToolResult(core, `Could not edit file: ${displayPath}. ${errorMessage}.`, {
      ok: false,
      error: errorMessage
    });
  }
  const application = decodeEditApplicationResult(core.call("applyEditToFile", [{
    path,
    displayPath,
    edits: prepared.edits,
    contents: content
  }]));
  if (application.kind === "error")
    return errorToolResult(core, application.message, { ...application });
  const nextContent = application.contents;
  const editCount = application.editCount;
  await writePatchFiles({
    deletes: [],
    writes: [{ path, contents: nextContent }],
    authorizations: [editAuthorization]
  });
  return hostToolResult(core, "edit", {
    ok: true,
    action: "edit",
    path,
    displayPath,
    editCount,
    before: content,
    after: nextContent
  });
}
async function executeApplyPatch(core, prepared, ctx) {
  const files = {};
  const { affectedPaths } = prepared;
  const readAuthorization = await authorizePreparedMutationPaths(core, prepared, affectedPaths);
  if (readAuthorization.kind === "invalid") {
    return errorToolResult(core, readAuthorization.error, { ok: false, error: readAuthorization.error });
  }
  const authorizedResolvedPaths = new Set;
  for (const authorizedPath of prepared.authorizedPaths) {
    if (authorizedResolvedPaths.has(authorizedPath.resolvedPath)) {
      const error = `Duplicate canonical patch authorization: ${authorizedPath.resolvedPath}`;
      return errorToolResult(core, error, { ok: false, error });
    }
    authorizedResolvedPaths.add(authorizedPath.resolvedPath);
  }
  if (authorizedResolvedPaths.size !== affectedPaths.length || affectedPaths.some((path) => !authorizedResolvedPaths.has(path))) {
    const error = "Patch authorization mapping does not match affected paths";
    return errorToolResult(core, error, { ok: false, error });
  }
  const patchAuthorizations = new Map;
  for (const authorization of readAuthorization.paths) {
    if (authorization.targetState === undefined) {
      patchAuthorizations.set(authorization.path, authorization);
      continue;
    }
    const read = await readAuthorizedFile(authorization);
    patchAuthorizations.set(authorization.path, read.authorization);
    files[authorization.path] = new TextDecoder().decode(read.contents);
  }
  const application = decodePatchApplicationResult(core.call("applyPatchToFiles", [{
    params: { input: prepared.patch },
    files,
    ctx,
    filesystemApproval: prepared.filesystemApproval === true,
    authorizedPaths: prepared.authorizedPaths
  }]));
  if (application.kind === "error")
    return errorToolResult(core, application.message, { ...application });
  const deletes = application.deletes;
  const writes = application.writes;
  const writesWithBefore = [];
  const writePaths = [];
  for (const write of writes) {
    writePaths.push(write.path);
    writesWithBefore.push({ ...write, before: files[write.path] ?? "" });
  }
  const deletedFiles = deletes.map((path) => ({ path, before: files[path] ?? "" }));
  const outputPaths = [...deletes, ...writePaths];
  const outputAuthorizations = [];
  const seenOutputPaths = new Set;
  for (const path of outputPaths) {
    const authorization = patchAuthorizations.get(path);
    if (authorization === undefined || seenOutputPaths.has(path)) {
      const error = `Patch output path was not authorized: ${path}`;
      return errorToolResult(core, error, { ok: false, error });
    }
    seenOutputPaths.add(path);
    outputAuthorizations.push(authorization);
  }
  await writePatchFiles({ deletes, writes, authorizations: outputAuthorizations });
  return hostToolResult(core, "apply_patch", { ...application, writes: writesWithBefore, deletedFiles });
}
async function executeTool(pi, core, childSessions, name, rawParams, ctx, signal, childExtensionFactory) {
  const parsed = parseToolParams(name, rawParams);
  if (!parsed.ok) {
    if (agentToolNames2.has(name)) {
      return agentErrorToolResult(core, "invalid_arguments", parsed.error);
    }
    return errorToolResult(core, parsed.error, { ok: false, error: parsed.error });
  }
  const childMarker = childSessionMarkerFromContext(ctx);
  if (!invalidChildSafeToolNames.has(name) && (childMarker.kind === "invalid" || childMarker.kind === "unavailable")) {
    return errorToolResult(core, "invalid child session authority metadata", {
      ok: false,
      error: "invalid child session authority metadata",
      childMarker: childMarker.kind
    });
  }
  if (name === "view_media" && !contextModelSupportsImages(ctx)) {
    const error = "Current model does not support image input";
    return errorToolResult(core, error, { ok: false, error, modelSupportsImages: false });
  }
  const agentTool = name === "agent_spawn" || name === "finder" || name === "oracle";
  if (name === "agent_list") {
    const prefix = `${childSessionCacheKeyScopeFromContext(ctx)}\x00`;
    const liveAgentIds = [...childSessions.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    try {
      decodeCoreAck(core.call("reconcileLiveAgentDispatches", [{ live_agent_ids: liveAgentIds }, { ctx }]));
    } catch (error) {
      return agentErrorToolResult(core, "persistence_failed", error instanceof Error ? error.message : String(error));
    }
  }
  const prepareCtx = agentTool && typeof pi.getActiveTools === "function" ? contextWithOverrides(ctx, { activeTools: pi.getActiveTools() }) : ctx;
  let prepared;
  try {
    prepared = preparedAction(core, name, parsed.params, prepareCtx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (agentToolNames2.has(name)) {
      return agentErrorToolResult(core, "persistence_failed", message);
    }
    throw error;
  }
  if (!prepared.ok) {
    if (agentToolNames2.has(name)) {
      const message = prepared.error;
      const code = /unknown run|not owned.*run/.test(message) ? "run_not_found" : /unknown agent|not owned.*agent|closing/.test(message) ? "agent_not_found" : /64 agents|namespace is exhausted/.test(message) ? "agent_limit_reached" : /routing|model|thinking|authentication/.test(message) ? "routing_unavailable" : /delete_worktree is only valid|invalid_arguments/.test(message) ? "invalid_arguments" : /workspace_unavailable|workspace|Git repository|HEAD commit|isolated agent worktree/.test(message) ? "workspace_unavailable" : /state is unavailable|persistence_failed/.test(message) ? "persistence_failed" : /cleanup_failed|cleanup|worktree has uncommitted|worktree deletion|provisional worktree cleanup/.test(message) ? "cleanup_failed" : "internal_error";
      const safeMessage = code === "run_not_found" ? "run not found" : code === "agent_not_found" ? "agent not found" : message;
      return agentErrorToolResult(core, code, safeMessage);
    }
    return errorToolResult(core, prepared.error, { ...prepared });
  }
  if (name === "agent_spawn" || name === "finder" || name === "oracle" || name === "agent_send") {
    const params = isToolRenderFields(parsed.params) ? parsed.params : {};
    rememberAgentDescription(typeof params["agent_id"] === "string" ? params["agent_id"] : "", typeof params["description"] === "string" ? params["description"] : undefined);
  }
  const approvalStillCurrent = () => {
    try {
      const candidate = preparedAction(core, name, parsed.params, ctx);
      const candidatePlanId = authorityPlanId(candidate);
      const currentPlanId = authorityPlanId(prepared);
      if (candidatePlanId !== undefined) {
        discardPreparedAuthorityPlan(core, candidate, ctx);
      }
      const withoutPlanId = (value) => {
        if (!("planId" in value))
          return value;
        const { planId: _planId, ...rest } = value;
        return rest;
      };
      return JSON.stringify(withoutPlanId(candidate)) === JSON.stringify(withoutPlanId(prepared)) && candidatePlanId === undefined === (currentPlanId === undefined);
    } catch {
      return false;
    }
  };
  const replan = () => executeTool(pi, core, childSessions, name, parsed.params, ctx, signal, childExtensionFactory);
  switch (prepared.action) {
    case "tool_result":
      return preparedToolResult(core, prepared);
    case "agent_start":
    case "agent_send":
    case "agent_wait":
    case "agent_close":
      return executeAgentPrepared(pi, core, childSessions, pendingAgentWaits, prepared, ctx, signal, childExtensionFactory);
    case "openai_usage_fetch":
      return executeOpenAiUsageWithHostAuth(pi, core, prepared, ctx);
    case "usage_pair_fetch":
      return executeUsagePairWithHostAuth(pi, core, prepared, ctx);
    case "exa_fetch":
      return executeExaInCore(core, prepared, ctx);
    case "exa_agent_create_run_approval":
      return withMutationApproval(core, "exa_agent_create_run", prepared, ctx, signal, approvalStillCurrent, replan, () => executeApprovedExaInCore(core, prepared, ctx));
    case "query_threads":
    case "read_thread": {
      const result2 = await runThreadTool(core, name, prepared, ctx);
      return result2;
    }
    case "exec_command":
      return runPreparedExec(pi, core, prepared, ctx, signal, false, approvalStillCurrent, replan);
    case "exec_command_approval": {
      let outcome;
      try {
        outcome = await confirmExecApproval(core, prepared, ctx, signal, approvalStillCurrent);
      } catch (error) {
        discardPreparedAuthorityPlan(core, prepared, ctx);
        throw error;
      }
      if (outcome === "replan") {
        discardPreparedAuthorityPlan(core, prepared, ctx);
        return replan();
      }
      const approvalPlan = decodeExecApprovalResult(core.call("finishExecApproval", [{
        planId: prepared.planId,
        ctx,
        outcome: outcome === "approved_always" ? "approved" : outcome
      }]));
      if (approvalPlan.kind === "denied")
        return approvalPlan.result;
      return runPreparedExec(pi, core, { ...prepared, action: "exec_command" }, ctx, signal, false);
    }
    case "write_stdin":
      return writePreparedStdin(core, prepared, ctx, signal);
    case "write_approval":
      if (childMutationConfinement(ctx) !== "none") {
        return errorToolResult(core, "worktree-isolated child filesystem approval is forbidden", { ok: false });
      }
      return withMutationApproval(core, "write", prepared, ctx, signal, approvalStillCurrent, replan, () => executeLegacyWrite(core, {
        ...prepared,
        action: "write",
        filesystemApproval: true,
        validateWorkspacePaths: false
      }));
    case "edit_approval":
      if (childMutationConfinement(ctx) !== "none") {
        return errorToolResult(core, "worktree-isolated child filesystem approval is forbidden", { ok: false });
      }
      return withMutationApproval(core, "edit", prepared, ctx, signal, approvalStillCurrent, replan, () => executeLegacyEdit(core, {
        ...prepared,
        action: "edit",
        filesystemApproval: true,
        validateWorkspacePaths: false
      }));
    case "apply_patch_approval":
      if (childMutationConfinement(ctx) !== "none") {
        return errorToolResult(core, "worktree-isolated child filesystem approval is forbidden", { ok: false });
      }
      return withMutationApproval(core, "apply_patch", prepared, ctx, signal, approvalStillCurrent, replan, () => executeApplyPatch(core, {
        ...prepared,
        action: "apply_patch",
        filesystemApproval: true,
        validateWorkspacePaths: false
      }, ctx));
    case "write":
      return executeLegacyWrite(core, prepared);
    case "read":
      return runPreparedRead(core, prepared, ctx);
    case "view_media":
      return runPreparedViewMedia(core, prepared, ctx);
    case "edit":
      return executeLegacyEdit(core, prepared);
    case "apply_patch":
      return executeApplyPatch(core, prepared, ctx);
    default:
      throw new Error(`${name} is registered by Taumel, but its executor is not connected yet.`);
  }
}
function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}
function assertToolCatalogMatchesCore(core) {
  const coreToolNames = decodeToolNamesResult(core.call("toolPolicyNames", [])).names;
  const expected = sorted(toolNames);
  const actual = sorted(coreToolNames);
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new Error(`Taumel tool catalog drift: TS=[${expected.join(", ")}] OCaml=[${actual.join(", ")}]`);
  }
}
function registerGatewayTools(pi, core, childSessions) {
  if (typeof pi.registerTool !== "function")
    return;
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("notification", notificationMessageRenderer());
    pi.registerMessageRenderer("taumel.plan.continue", planContinuationMessageRenderer());
  }
  installExecNotificationLifecycle(pi, core);
  installAgentLifecycle(pi, core, childSessions, pendingAgentWaits);
  installIsolatedChildOwnershipLifecycle(pi, core, childSessions);
  assertToolCatalogMatchesCore(core);
  const allowed = new Set(decodeToolNamesResult(core.call("allowedToolNames", [])).names);
  for (const contract of toolContracts) {
    const name = contract.name;
    if (!allowed.has(name))
      continue;
    pi.registerTool({
      name,
      label: contract.label,
      description: contract.description,
      parameters: contract.parameters,
      promptSnippet: contract.promptSnippet ?? "",
      ...contract.promptGuidelines !== undefined ? { promptGuidelines: contract.promptGuidelines } : {},
      ...contract.constrainedSampling !== undefined ? { constrainedSampling: contract.constrainedSampling } : {},
      execute: async (...args) => {
        const childExtensionFactory = (childPi) => registerGatewayTools(childPi, core, childSessions);
        const result2 = await executeTool(pi, core, childSessions, name, args[1], args[4], args[2] instanceof AbortSignal ? args[2] : undefined, childExtensionFactory);
        const failure = agentFailureText(name, result2);
        if (failure !== undefined)
          throw new Error(failure);
        return result2;
      },
      ...renderersForTool(name) ?? {},
      renderShell: "self"
    });
  }
}

// src/compaction-model.ts
import { readFile as readFile2 } from "node:fs/promises";
import {
  compact,
  generateBranchSummary,
  ModelSelectorComponent,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
function stringFromUnknown(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}
function stringRecordFromUnknown(value) {
  const object = objectValue(value);
  if (object === undefined)
    return;
  const result2 = {};
  for (const key of Object.keys(object)) {
    const entry = object[key];
    if (typeof entry !== "string")
      return;
    result2[key] = entry;
  }
  return result2;
}
var sessionCompactionModels = new Map;
function sessionKey(ctx) {
  return sessionInfoFromContext(ctx).sessionId ?? "current";
}
async function readSettingsJson(path) {
  try {
    const raw = JSON.parse(await readFile2(path, "utf8"));
    return objectValue(raw) ?? {};
  } catch {
    return {};
  }
}
function readCompactionModelFromSettings(settings) {
  const taumel = objectValue(settings["taumel"]) ?? {};
  const compaction = objectValue(taumel["compaction"]) ?? {};
  return stringFromUnknown(compaction["model"]);
}
async function readGlobalCompactionModel() {
  return readCompactionModelFromSettings(await readSettingsJson(taumelGlobalSettingsPath()));
}
async function readProjectCompactionModel(cwd) {
  return readCompactionModelFromSettings(await readSettingsJson(projectSettingsPath(cwd)));
}
async function writeProjectCompactionModel(cwd, model) {
  const path = projectSettingsPath(cwd);
  const { settings, authorization } = await readJsonObjectForAtomicUpdate(path, true);
  const existingTaumel = settings["taumel"];
  const taumel = existingTaumel === undefined ? {} : objectValue(existingTaumel);
  if (taumel === undefined)
    throw new Error(`${path}: taumel must be a JSON object`);
  const existingCompaction = taumel["compaction"];
  const compaction = existingCompaction === undefined ? {} : objectValue(existingCompaction);
  if (compaction === undefined)
    throw new Error(`${path}: taumel.compaction must be a JSON object`);
  if (model === undefined) {
    delete compaction["model"];
  } else {
    compaction["model"] = model;
  }
  if (Object.keys(compaction).length === 0) {
    delete taumel["compaction"];
  } else {
    taumel["compaction"] = compaction;
  }
  if (Object.keys(taumel).length === 0) {
    delete settings["taumel"];
  } else {
    settings["taumel"] = taumel;
  }
  await writeFileAtomically(authorization, `${JSON.stringify(settings, null, 2)}
`, true);
}
function notifyWarning(ctx, message) {
  const rawUi = objectLikeValue(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi : undefined;
  const notify = ui?.notify;
  if (typeof notify === "function") {
    notify.call(ui, message, "warning");
  }
}
function cancelWithWarning(ctx, message) {
  notifyWarning(ctx, message);
  return { cancel: true };
}
function currentThinkingLevelFromContext(ctx) {
  const context = objectLikeValue(ctx);
  if (typeof context?.thinkingLevel === "string" && context.thinkingLevel !== "")
    return context.thinkingLevel;
  const rawSessionManager = context?.sessionManager;
  if (typeof rawSessionManager !== "object" || rawSessionManager === null)
    return;
  const sessionManager = rawSessionManager;
  const getThinkingLevel = sessionManager.getThinkingLevel;
  const value = sessionManager.thinkingLevel ?? (typeof getThinkingLevel === "function" ? getThinkingLevel.call(sessionManager) : undefined);
  return typeof value === "string" && value !== "" ? value : undefined;
}
function findModelByProviderModelId(registry, modelId) {
  const requested = splitProviderModelId(modelId);
  if (requested === undefined || typeof registry !== "object" || registry === null)
    return;
  const find = registry.find;
  if (typeof find !== "function")
    return;
  return find.call(registry, requested.provider, requested.model);
}
function providerModelIdFromModel(model) {
  if (typeof model !== "object" || model === null)
    return;
  const descriptor = model;
  const provider = stringFromUnknown(descriptor.provider);
  const id = stringFromUnknown(descriptor.id);
  return provider === undefined || id === undefined ? undefined : `${provider}/${id}`;
}
function compactionSettingsForContext(ctx) {
  const cwd = cwdFromContext(ctx);
  const project = isProjectTrusted(ctx) ? readProjectCompactionModel(cwd) : Promise.resolve(undefined);
  return Promise.all([readGlobalCompactionModel(), project]).then(([global, project2]) => ({
    session: sessionCompactionModels.get(sessionKey(ctx)),
    global,
    project: project2
  }));
}
function hasConfiguredCompactionModel(settings) {
  const winning = settings.session ?? settings.project ?? settings.global;
  return winning !== undefined && winning !== "inherit";
}
async function resolveConfiguredModel(pi, core, ctx) {
  const settings = await compactionSettingsForContext(ctx);
  const configured = hasConfiguredCompactionModel(settings);
  let plan;
  try {
    plan = decodeCompactionSessionPlan(core.call("planSessionBeforeCompact", [{
      session: settings.session ?? "",
      global: settings.global ?? "",
      project: settings.project ?? ""
    }]));
  } catch (error) {
    return configured ? {
      ok: false,
      result: cancelWithWarning(ctx, `Taumel compaction model planning failed: ${error instanceof Error ? error.message : String(error)}`)
    } : { ok: true, value: undefined };
  }
  if (plan.kind !== "compact") {
    return configured ? { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model planning returned no compact action.") } : { ok: true, value: undefined };
  }
  const modelId = plan.model;
  const requested = splitProviderModelId(modelId);
  if (requested === undefined) {
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model is invalid: ${modelId}`) };
  }
  const registry = modelRegistryFrom(pi, ctx);
  if (typeof registry !== "object" || registry === null) {
    return { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model cannot resolve the model registry.") };
  }
  const modelRegistry = registry;
  if (typeof modelRegistry.find !== "function" || typeof modelRegistry.getApiKeyAndHeaders !== "function") {
    return { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model cannot resolve the model registry.") };
  }
  const model = modelRegistry.find.call(registry, requested.provider, requested.model);
  if (model === undefined || model === null) {
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model is not available: ${modelId}`) };
  }
  let auth;
  try {
    auth = await modelRegistry.getApiKeyAndHeaders.call(registry, model);
  } catch (error) {
    return {
      ok: false,
      result: cancelWithWarning(ctx, `Taumel compaction model auth failed for ${modelId}: ${error instanceof Error ? error.message : String(error)}`)
    };
  }
  const modelAuth = typeof auth === "object" && auth !== null ? auth : undefined;
  if (modelAuth?.ok !== true) {
    const detail = typeof modelAuth?.error === "string" && modelAuth.error !== "" ? `: ${modelAuth.error}` : "";
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model lacks auth: ${modelId}${detail}`) };
  }
  return {
    ok: true,
    value: {
      modelId,
      model,
      apiKey: typeof modelAuth.apiKey === "string" ? modelAuth.apiKey : undefined,
      headers: stringRecordFromUnknown(modelAuth.headers),
      env: stringRecordFromUnknown(modelAuth.env)
    }
  };
}
function installCompactionModelHookWithCompact(pi, core, compactRunner, branchSummaryRunner = generateBranchSummary) {
  pi.on("session_before_compact", async (event, ctx) => {
    if (typeof event !== "object" || event === null)
      return;
    const compactEvent = event;
    const resolved = await resolveConfiguredModel(pi, core, ctx);
    if (!resolved.ok)
      return resolved.result;
    if (resolved.value === undefined)
      return;
    const preparation = compactEvent.preparation;
    if (preparation === undefined || preparation === null) {
      return cancelWithWarning(ctx, "Taumel compaction hook received no preparation.");
    }
    try {
      const result2 = await compactRunner(preparation, resolved.value.model, resolved.value.apiKey, resolved.value.headers, stringFromUnknown(compactEvent.customInstructions), compactEvent.signal instanceof AbortSignal ? compactEvent.signal : undefined, currentThinkingLevelFromContext(ctx), undefined, resolved.value.env);
      return { compaction: result2 };
    } catch (error) {
      return cancelWithWarning(ctx, `Taumel compaction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  pi.on("session_before_tree", async (event, ctx) => {
    if (typeof event !== "object" || event === null)
      return;
    const treeEvent = event;
    if (typeof treeEvent.preparation !== "object" || treeEvent.preparation === null)
      return;
    const preparation = treeEvent.preparation;
    if (preparation.userWantsSummary !== true)
      return;
    const entries = Array.isArray(preparation.entriesToSummarize) ? preparation.entriesToSummarize : [];
    if (entries.length === 0)
      return;
    const resolved = await resolveConfiguredModel(pi, core, ctx);
    if (!resolved.ok)
      return resolved.result;
    if (resolved.value === undefined)
      return;
    try {
      const result2 = await branchSummaryRunner(entries, {
        model: resolved.value.model,
        apiKey: resolved.value.apiKey,
        headers: resolved.value.headers,
        env: resolved.value.env,
        signal: treeEvent.signal instanceof AbortSignal ? treeEvent.signal : undefined,
        customInstructions: stringFromUnknown(preparation.customInstructions),
        replaceInstructions: preparation.replaceInstructions === true
      });
      if (result2.aborted)
        return { cancel: true };
      if (result2.error)
        return cancelWithWarning(ctx, `Taumel branch summary failed: ${result2.error}`);
      return {
        summary: {
          summary: result2.summary,
          details: {
            readFiles: result2.readFiles ?? [],
            modifiedFiles: result2.modifiedFiles ?? []
          }
        }
      };
    } catch (error) {
      return cancelWithWarning(ctx, `Taumel branch summary failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
function installCompactionModelHook(pi, core) {
  installCompactionModelHookWithCompact(pi, core, compact);
}
async function openCompactionModelPicker(pi, currentModelId, ctx) {
  const rawUi = objectLikeValue(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi : undefined;
  const custom = ui?.custom;
  if (typeof custom !== "function") {
    return { ok: false, action: "command_result", message: "Picker is not available.", error: "Picker is not available." };
  }
  const registry = modelRegistryFrom(pi, ctx);
  const currentModel = currentModelId === "" ? undefined : findModelByProviderModelId(registry, currentModelId);
  const model = await custom.call(ui, (tui, _theme, _keybindings, done) => new ModelSelectorComponent(tui, currentModel, SettingsManager.inMemory(), registry, [], (selected) => done(selected), () => done(undefined)), { title: "Choose compaction model" });
  if (model === undefined || model === null) {
    return { ok: true, action: "command_result", message: "Compaction model selection cancelled." };
  }
  const modelId = providerModelIdFromModel(model);
  if (modelId === undefined || modelId === "") {
    return { ok: false, action: "command_result", message: "No model selected.", error: "No model selected." };
  }
  return setSessionCompactionModel(ctx, modelId);
}
async function setSessionCompactionModel(ctx, modelId) {
  if (isProjectTrusted(ctx)) {
    try {
      await writeProjectCompactionModel(cwdFromContext(ctx), modelId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, action: "command_result", message: `Compaction model was not changed: ${message}`, error: message };
    }
    sessionCompactionModels.set(sessionKey(ctx), modelId);
    return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (session and project).` };
  }
  sessionCompactionModels.set(sessionKey(ctx), modelId);
  notifyWarning(ctx, "Project is untrusted; compaction model was set for this session only and project persistence was skipped.");
  return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (session only; project persistence skipped because the project is untrusted).` };
}
async function clearSessionCompactionModel(ctx) {
  if (isProjectTrusted(ctx)) {
    try {
      await writeProjectCompactionModel(cwdFromContext(ctx), undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, action: "command_result", message: `Compaction model was not changed: ${message}`, error: message };
    }
    sessionCompactionModels.delete(sessionKey(ctx));
    return { ok: true, action: "command_result", message: "Compaction model cleared for this session and project; inheriting." };
  }
  sessionCompactionModels.delete(sessionKey(ctx));
  notifyWarning(ctx, "Project is untrusted; compaction model was cleared for this session only and project persistence was skipped.");
  return { ok: true, action: "command_result", message: "Compaction model cleared for this session; project persistence skipped because the project is untrusted." };
}
async function executeCompactionModelCommand(pi, core, args, ctx) {
  const { session, global, project } = await compactionSettingsForContext(ctx);
  const plan = decodeCompactionCommandPlan(core.call("planCompactionModelCommand", [{
    args,
    settings: { session: session ?? "", global: global ?? "", project: project ?? "" }
  }]));
  if (plan.kind === "error")
    return { ok: false, action: "command_result", message: plan.message, error: plan.message };
  if (plan.kind === "show") {
    const model = plan.model;
    const source = plan.source;
    const message = model === "" ? `Compaction model: ${source}` : `Compaction model: ${model} (${source})`;
    return { ok: true, action: "command_result", message };
  }
  if (plan.kind === "set_project") {
    return setSessionCompactionModel(ctx, plan.model);
  }
  if (plan.kind === "clear_project") {
    return clearSessionCompactionModel(ctx);
  }
  if (plan.kind === "open_picker") {
    return openCompactionModelPicker(pi, plan.current, ctx);
  }
  throw new Error("Invalid Taumel compaction-model command plan");
}

// src/cron-manager.ts
import { DynamicBorder, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Key, SelectList, truncateToWidth as truncateToWidth3, wrapTextWithAnsi as wrapTextWithAnsi2 } from "@earendil-works/pi-tui";

// src/manager-kit.ts
import { matchesKey, truncateToWidth as truncateToWidth2, visibleWidth as visibleWidth3 } from "@earendil-works/pi-tui";
function uiFromContext2(ctx) {
  const ui = objectLikeValue(ctx)?.ui;
  return typeof ui === "object" && ui !== null ? ui : undefined;
}
function notify(ui, message, level = "info") {
  const fn = ui?.notify;
  if (typeof fn === "function")
    fn.call(ui, message, level);
}
function fg(theme, color, text) {
  return typeof theme.fg === "function" ? theme.fg(color, text) : text;
}
function bold(theme, text) {
  return typeof theme.bold === "function" ? theme.bold(text) : text;
}
function keybindingMatches(keybindings, data, id) {
  const matches = objectLikeValue(keybindings)?.matches;
  if (typeof matches !== "function")
    return false;
  try {
    return matches.call(keybindings, data, id) === true;
  } catch {
    return false;
  }
}
function matchesSelect(keybindings, data, id, fallback) {
  return keybindingMatches(keybindings, data, id) || matchesKey(data, fallback);
}
function commandResult(ok, message, details) {
  return { ok, action: "command_result", message, ...ok ? {} : { error: message }, details };
}
function resultMessage(result2, fallback) {
  return typeof result2.message === "string" ? result2.message : fallback;
}
function mutationOk(result2) {
  return result2.ok === true;
}
function requestRenderFromTui(tui) {
  return () => {
    const requestRender2 = objectLikeValue(tui)?.requestRender;
    if (typeof requestRender2 === "function")
      requestRender2.call(tui);
  };
}

// src/cron-manager.ts
function stateDetails(state) {
  return { enabled: state.enabled, tasks: state.tasks };
}
function loadCronState(core, ctx) {
  return decodeCronListResult(core.call("prepareTool", [{ name: "cron_list", params: {}, ctx }])).details;
}
function normalizeCronInput(input) {
  return input.trim().split(/\s+/).join(" ");
}
function taskModeLabel(task) {
  return task.mode === "plan" ? "plan" : "message";
}
function taskTypeLabel(task) {
  return task.recurring ? "recurring" : "one-shot";
}
function taskStatusLabel(task) {
  return task.enabled ? "enabled" : "disabled";
}
function taskById(state, id) {
  return state.tasks.find((task) => task.id === id);
}

class CronManagerComponent {
  state;
  theme;
  keybindings;
  callbacks;
  selected = 0;
  view = "list";
  busy;
  status;
  selectList;
  frame;
  constructor(state, theme, keybindings, callbacks, selectedId) {
    this.state = state;
    this.theme = theme;
    this.keybindings = keybindings;
    this.callbacks = callbacks;
    this.frame = new DynamicBorder((text) => fg(this.theme, "accent", text));
    if (selectedId) {
      const index = state.tasks.findIndex((task) => task.id === selectedId);
      if (index >= 0)
        this.selected = index + 1;
    }
    this.selectList = this.createSelectList();
  }
  invalidate() {
    this.frame.invalidate();
    this.selectList.invalidate();
  }
  render(width) {
    if (this.view === "details")
      return this.renderDetails(width);
    if (this.view === "confirm_cancel")
      return this.renderConfirmCancel(width);
    return this.renderList(width);
  }
  handleInput(data) {
    if (this.busy !== undefined)
      return;
    if (this.view === "confirm_cancel") {
      this.handleConfirmInput(data);
      return;
    }
    if (this.view === "details") {
      if (this.isCancel(data)) {
        this.view = "list";
        this.callbacks.requestRender();
      } else {
        this.handleTaskShortcut(data);
      }
      return;
    }
    if (data === "m") {
      this.runMutation({ kind: "toggle_master" });
      return;
    }
    if (["e", "c", "p", "i", "s", "r", "g"].includes(data)) {
      this.handleTaskShortcut(data);
      return;
    }
    this.selectList.handleInput(data);
    this.callbacks.requestRender();
  }
  renderList(width) {
    const lines = this.baseHeader(width);
    lines.push(...this.selectList.render(width));
    this.addStatus(lines, width);
    lines.push("");
    lines.push(this.line(this.dim("  ↑↓ select • enter details • e toggle • c cancel • p prompt • s schedule"), width));
    lines.push(this.line(this.dim("  r recurring • g plan/message • m master • esc close"), width));
    lines.push(this.border(width));
    return lines;
  }
  renderDetails(width) {
    const task = this.selectedTask();
    if (!task)
      return this.renderList(width);
    const lines = this.baseHeader(width, `Cron task ${task.id}`);
    lines.push(this.line(`  id:        ${task.id}`, width));
    lines.push(this.line(`  enabled:   ${taskStatusLabel(task)}`, width));
    lines.push(this.line(`  schedule:  ${task.cron}`, width));
    lines.push(this.line(`  next:      ${task.nextDueText}${task.pending ? " (pending)" : ""}`, width));
    lines.push(this.line(`  mode:      ${taskModeLabel(task)}`, width));
    lines.push(this.line(`  type:      ${taskTypeLabel(task)}`, width));
    lines.push("");
    lines.push(this.line(this.accent("  Prompt"), width));
    const promptLines = wrapTextWithAnsi2(task.prompt || "(empty)", Math.max(1, width - 4));
    for (const line of promptLines)
      lines.push(this.line(`  ${line}`, width));
    this.addStatus(lines, width);
    lines.push("");
    lines.push(this.line(this.dim("  p edit prompt • s edit schedule • e toggle • c cancel • r recurring"), width));
    lines.push(this.line(this.dim("  g plan/message • esc back"), width));
    lines.push(this.border(width));
    return lines;
  }
  createSelectList() {
    const items = [
      {
        value: "master",
        label: "Master switch:",
        description: this.state.enabled ? "enabled" : "disabled"
      },
      ...this.state.tasks.map((task) => ({
        value: task.id,
        label: task.id,
        description: [
          taskStatusLabel(task),
          task.cron,
          taskModeLabel(task),
          taskTypeLabel(task),
          `${task.nextDueText}${task.pending ? " pending" : ""}`
        ].join(" • ")
      }))
    ];
    const list = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
    list.setSelectedIndex(this.selected);
    list.onSelectionChange = (item) => {
      this.selected = item.value === "master" ? 0 : Math.max(1, this.state.tasks.findIndex((task) => task.id === item.value) + 1);
    };
    list.onSelect = (item) => {
      if (item.value === "master") {
        this.runMutation({ kind: "toggle_master" });
      } else {
        this.selected = Math.max(1, this.state.tasks.findIndex((task) => task.id === item.value) + 1);
        this.openDetails();
      }
    };
    list.onCancel = () => this.callbacks.onDone({ kind: "exit" });
    return list;
  }
  renderConfirmCancel(width) {
    const task = this.selectedTask();
    if (!task)
      return this.renderList(width);
    const lines = this.baseHeader(width, "Confirm cancel");
    lines.push(this.line(`  Cancel cron task ${task.id}?`, width));
    lines.push(this.line(this.dim(`  ${task.cron} • ${taskModeLabel(task)} • next=${task.nextDueText}`), width));
    lines.push("");
    lines.push(this.line(this.dim("  y/enter/c confirm • n/esc back"), width));
    lines.push(this.border(width));
    return lines;
  }
  baseHeader(width, subtitle = "Manage cron tasks") {
    return [
      this.border(width),
      this.line(this.accent(bold(this.theme, subtitle)), width),
      this.line(`  Cron master: ${this.state.enabled ? "enabled" : "disabled"}`, width),
      ""
    ];
  }
  addStatus(lines, width) {
    if (this.busy) {
      lines.push("");
      lines.push(this.line(this.dim(`  ${this.busy}`), width));
    } else if (this.status) {
      lines.push("");
      lines.push(this.line(this.dim(`  ${this.status}`), width));
    }
  }
  line(text, width) {
    return truncateToWidth3(text, Math.max(0, width), "");
  }
  border(width) {
    return this.frame.render(width)[0] ?? "";
  }
  accent(text) {
    return fg(this.theme, "accent", text);
  }
  dim(text) {
    return fg(this.theme, "dim", text);
  }
  selectedTask() {
    return this.selected > 0 ? this.state.tasks[this.selected - 1] : undefined;
  }
  openDetails() {
    if (this.selectedTask()) {
      this.view = "details";
      this.callbacks.requestRender();
    }
  }
  handleTaskShortcut(data) {
    const task = this.selectedTask();
    if (!task) {
      if (data === "e")
        this.runMutation({ kind: "toggle_master" });
      return;
    }
    if (data === "e")
      this.runMutation({ kind: "toggle_task", id: task.id });
    else if (data === "c") {
      this.view = "confirm_cancel";
      this.callbacks.requestRender();
    } else if (data === "p" || data === "i")
      this.callbacks.onDone({ kind: "edit_prompt", id: task.id });
    else if (data === "s")
      this.callbacks.onDone({ kind: "edit_schedule", id: task.id });
    else if (data === "r")
      this.runMutation({ kind: "toggle_recurring", id: task.id });
    else if (data === "g")
      this.runMutation({ kind: "toggle_mode", id: task.id });
  }
  handleConfirmInput(data) {
    const task = this.selectedTask();
    if (!task)
      return;
    if (this.isCancel(data) || data === "n") {
      this.view = "list";
      this.callbacks.requestRender();
    } else if (this.isConfirm(data) || data === "y" || data === "c") {
      this.runMutation({ kind: "cancel_task", id: task.id });
    }
  }
  runMutation(action) {
    this.busy = "Updating cron task…";
    this.status = undefined;
    this.callbacks.requestRender();
    this.callbacks.onMutate(action).then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.clampSelection();
      if (action.kind === "cancel_task")
        this.view = "list";
      this.selectList = this.createSelectList();
      this.callbacks.requestRender();
    });
  }
  clampSelection() {
    this.selected = Math.max(0, Math.min(this.selected, this.state.tasks.length));
    if (this.view === "details" && this.selected === 0)
      this.view = "list";
  }
  isConfirm(data) {
    return matchesSelect(this.keybindings, data, "tui.select.confirm", Key.enter);
  }
  isCancel(data) {
    return matchesSelect(this.keybindings, data, "tui.select.cancel", Key.escape);
  }
}
function command(core, args, ctx) {
  return decodeCronCommandResult(core.call("handleCronManagerCommand", [{ args, ctx }]));
}
function updateTask(core, patch, ctx) {
  return decodeCronCommandResult(core.call("cronUpdateTask", [{ patch, ctx }]));
}
async function runMutation(core, action, state, ctx, ui) {
  const task = "id" in action ? taskById(state, action.id) : undefined;
  const result2 = (() => {
    switch (action.kind) {
      case "toggle_master":
        return command(core, state.enabled ? "disable" : "enable", ctx);
      case "toggle_task":
        return command(core, task?.enabled ? `disable ${action.id}` : `enable ${action.id}`, ctx);
      case "cancel_task":
        return command(core, `cancel ${action.id}`, ctx);
      case "toggle_recurring":
        return updateTask(core, { id: action.id, recurring: !(task?.recurring ?? true) }, ctx);
      case "toggle_mode":
        return updateTask(core, { id: action.id, mode: task?.mode === "plan" ? "message" : "plan" }, ctx);
    }
  })();
  const nextState = loadCronState(core, ctx);
  const ok = mutationOk(result2);
  const message = resultMessage(result2, "Cron updated.");
  notify(ui, message, ok ? "info" : "warning");
  return { ok, message, state: nextState };
}
async function editTaskPrompt(core, ctx, ui, task) {
  const editor = ui?.["editor"];
  if (typeof editor !== "function") {
    notify(ui, "Prompt editing requires Pi TUI editor support.", "warning");
    return false;
  }
  const edited = await editor.call(ui, `Edit cron prompt ${task.id}`, task.prompt);
  if (typeof edited !== "string")
    return false;
  const result2 = updateTask(core, { id: task.id, prompt: edited }, ctx);
  notify(ui, resultMessage(result2, "Cron updated."), mutationOk(result2) ? "info" : "warning");
  return mutationOk(result2);
}
async function editTaskSchedule(core, ctx, ui, task) {
  const editor = ui?.["editor"];
  if (typeof editor !== "function") {
    notify(ui, "Schedule editing requires Pi TUI editor support.", "warning");
    return false;
  }
  const edited = await editor.call(ui, `Edit cron schedule ${task.id}`, task.cron);
  if (typeof edited !== "string")
    return false;
  const result2 = updateTask(core, { id: task.id, cron: normalizeCronInput(edited) }, ctx);
  notify(ui, resultMessage(result2, "Cron updated."), mutationOk(result2) ? "info" : "warning");
  return mutationOk(result2);
}
function fallbackCronPrompt(core, prompt) {
  return decodeCronPromptPlan(core.call("planCronPrompt", [{ prompt, uiAvailable: false }])).result;
}
function parseManagerAction(value) {
  if (typeof value !== "object" || value === null)
    return { kind: "exit" };
  const candidate = value;
  if ((candidate.kind === "edit_prompt" || candidate.kind === "edit_schedule") && typeof candidate.id === "string") {
    return { kind: candidate.kind, id: candidate.id };
  }
  return { kind: "exit" };
}
async function executeCronManager(core, rawPrompt, ctx) {
  const prompt = decodeCronPrompt(rawPrompt);
  const ui = uiFromContext2(ctx);
  const custom = ui?.["custom"];
  if (typeof custom !== "function")
    return fallbackCronPrompt(core, prompt);
  let state = loadCronState(core, ctx);
  let selectedId;
  let dirty = false;
  while (true) {
    if (state.tasks.length === 0)
      return commandResult(true, "No cron tasks.", stateDetails(state));
    const action = parseManagerAction(await custom.call(ui, (tui, theme, keybindings, done) => {
      const requestRender2 = requestRenderFromTui(tui);
      return new CronManagerComponent(state, theme, keybindings, {
        onDone: done,
        requestRender: requestRender2,
        onMutate: async (mutation) => {
          const outcome = await runMutation(core, mutation, state, ctx, ui);
          dirty = dirty || outcome.ok;
          state = outcome.state;
          return outcome;
        }
      }, selectedId);
    }));
    if (action.kind === "exit") {
      const message = dirty ? "Cron tasks updated." : "Cron manager closed.";
      return commandResult(true, message, stateDetails(state));
    }
    selectedId = action.id;
    const task = taskById(state, action.id);
    if (!task) {
      notify(ui, `No cron task matched ${action.id}.`, "warning");
      state = loadCronState(core, ctx);
      continue;
    }
    dirty = action.kind === "edit_prompt" ? await editTaskPrompt(core, ctx, ui, task) || dirty : await editTaskSchedule(core, ctx, ui, task) || dirty;
    state = loadCronState(core, ctx);
  }
}

// src/agent-inspection.ts
import { truncateToWidth as truncateToWidth5 } from "@earendil-works/pi-tui";

// src/modal.ts
import { Key as Key2, matchesKey as matchesKey2, truncateToWidth as truncateToWidth4 } from "@earendil-works/pi-tui";
var defaultPageSize = 30;
function modalTheme(rawTheme) {
  const candidate = typeof rawTheme === "object" && rawTheme !== null ? rawTheme : undefined;
  if (candidate !== undefined && typeof candidate.fg === "function") {
    const fg2 = candidate.fg;
    return { fg: (color, text) => fg2.call(candidate, color, text) };
  }
  return { fg: (_color, text) => text };
}
function wrapModalText(text, width) {
  const limit = Math.max(1, width);
  const lines = [];
  for (const rawLine of text.split(`
`)) {
    let remaining = rawLine;
    while (remaining.length > limit) {
      const breakAt = remaining.lastIndexOf(" ", limit);
      const cut = breakAt > 0 ? breakAt : limit;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}
function requestRenderFrom(tui) {
  return () => {
    const host = typeof tui === "object" && tui !== null ? tui : undefined;
    if (typeof host?.requestRender === "function") {
      host.requestRender.call(host);
    }
  };
}
async function showScrollModal(ui, content, options = {}) {
  const custom = ui?.custom;
  if (typeof custom !== "function")
    return;
  let offset = 0;
  const controller = new AbortController;
  let activityFailure;
  let activityPromise;
  try {
    await custom.call(ui, (tui, rawTheme, _keys, done) => {
      const theme = modalTheme(rawTheme);
      const pageSize = options.pageSize ?? defaultPageSize;
      const requestRender2 = requestRenderFrom(tui);
      if (options.activity !== undefined) {
        activityPromise = options.activity({ signal: controller.signal, requestRender: requestRender2 }).catch((error) => {
          activityFailure = error;
        });
      }
      const close = () => {
        controller.abort();
        done();
      };
      return {
        render: (width) => {
          const w = Math.max(1, width);
          const lines = content(w, theme);
          offset = Math.min(offset, Math.max(0, lines.length - 1));
          const visible = lines.slice(offset, offset + pageSize);
          const footer = options.footer ?? " ↑↓ scroll · Esc/q/Enter close";
          return [...visible, theme.fg("dim", footer)].map((line) => truncateToWidth4(line, w, "..."));
        },
        invalidate: () => {
          return;
        },
        handleInput: (input) => {
          if (matchesKey2(input, Key2.up)) {
            offset = Math.max(0, offset - 1);
            requestRender2();
            return;
          }
          if (matchesKey2(input, Key2.down)) {
            offset += 1;
            requestRender2();
            return;
          }
          if (input === "q" || matchesKey2(input, Key2.escape) || matchesKey2(input, Key2.enter))
            close();
        }
      };
    });
  } finally {
    controller.abort();
    await activityPromise;
  }
  if (activityFailure !== undefined)
    throw activityFailure;
}
async function confirmSelection(ui, title, confirmLabel) {
  const select = ui?.select;
  if (typeof select !== "function")
    return false;
  const selected = await select.call(ui, title, [confirmLabel, "Cancel"]);
  return selected === confirmLabel;
}
async function showInteractiveList(ui, options) {
  const custom = ui?.custom;
  if (typeof custom !== "function")
    return;
  let cursor = Math.max(0, options.initialIndex ?? 0);
  let offset = 0;
  const pageSize = options.pageSize ?? defaultPageSize;
  const actionKeys = new Set(options.actionKeys ?? []);
  return await new Promise((resolve2) => {
    let settled = false;
    const settle2 = (value) => {
      if (settled)
        return;
      settled = true;
      resolve2(value);
    };
    custom.call(ui, (tui, rawTheme, _keys, done) => {
      const theme = modalTheme(rawTheme);
      const requestRender2 = requestRenderFrom(tui);
      const finish = (value) => {
        settle2(value);
        done();
      };
      const clampCursor = () => {
        if (options.items.length === 0) {
          cursor = 0;
          return;
        }
        cursor = Math.max(0, Math.min(cursor, options.items.length - 1));
      };
      return {
        render: (width) => {
          clampCursor();
          const w = Math.max(1, width);
          const body = options.items.length === 0 ? options.emptyLines?.(theme, w) ?? [theme.fg("dim", " No items.")] : options.items.flatMap((item, index) => options.renderRow(item, index, index === cursor, theme, w));
          if (options.items.length > 0) {
            const sample = options.renderRow(options.items[0], 0, false, theme, w);
            const rowHeight = Math.max(1, sample.length);
            const selectedTop = cursor * rowHeight;
            if (selectedTop < offset)
              offset = selectedTop;
            if (selectedTop + rowHeight > offset + pageSize) {
              offset = Math.max(0, selectedTop + rowHeight - pageSize);
            }
          } else {
            offset = 0;
          }
          const visible = body.slice(offset, offset + pageSize);
          const footer = typeof options.footer === "function" ? options.footer(theme) : options.footer ?? " ↑↓ move · q close";
          const header = typeof options.header === "function" ? options.header(theme) : options.header;
          return [
            ...header === undefined ? [] : [header],
            ...visible,
            "",
            theme.fg("dim", footer)
          ].map((line) => truncateToWidth4(line, w, "..."));
        },
        invalidate: () => {
          return;
        },
        handleInput: (input) => {
          if (matchesKey2(input, Key2.up) || input === "k" && !actionKeys.has("k")) {
            if (options.items.length > 0) {
              cursor = Math.max(0, cursor - 1);
              requestRender2();
            }
            return;
          }
          if (matchesKey2(input, Key2.down) || input === "j" && !actionKeys.has("j")) {
            if (options.items.length > 0) {
              cursor = Math.min(options.items.length - 1, cursor + 1);
              requestRender2();
            }
            return;
          }
          if (input === "q" || matchesKey2(input, Key2.escape)) {
            finish(undefined);
            return;
          }
          if (actionKeys.has("enter") && matchesKey2(input, Key2.enter)) {
            finish({ key: "enter", index: cursor });
            return;
          }
          if (!actionKeys.has(input))
            return;
          finish({ key: input, index: cursor });
        }
      };
    }).then(() => {
      settle2(undefined);
    }, () => {
      settle2(undefined);
    });
  });
}
async function promptModalText(ui, title, placeholder) {
  const input = ui?.input;
  if (typeof input !== "function")
    return;
  const result2 = await input.call(ui, title, placeholder);
  return typeof result2 === "string" ? result2 : undefined;
}

// src/agent-inspection.ts
function statusColor(status) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "lost":
      return "error";
    case "running":
    case "suspended":
      return "warning";
    case "cancelled":
      return "dim";
  }
}
function fieldLines(fields, width) {
  const labelWidth = fields.reduce((max, [label]) => Math.max(max, label.length), 0);
  return fields.map(([label, value]) => truncateToWidth5(` ${label.padEnd(labelWidth)}   ${value}`, width, "..."));
}
function renderAgentInspection(agent, run, instruction, worktreeLineDelta, theme, width, nowMs = Date.now()) {
  const w = Math.max(1, width);
  const line = (value) => truncateToWidth5(value, w, "...");
  const lines = [];
  const header = ` ${agent.agentId} · ${agent.kind}`;
  lines.push(line(run === undefined ? theme.fg("accent", header) : `${theme.fg("accent", header)} · ${theme.fg(statusColor(run.status), run.status)}`));
  lines.push("");
  lines.push(theme.fg("accent", " Identity"));
  const identityFields = [
    ["Model", agent.model],
    ["Thinking", agent.thinking]
  ];
  if (agent.tier !== undefined)
    identityFields.push(["Tier", agent.tier]);
  identityFields.push(["Isolation", agent.isolation ?? "none"]);
  identityFields.push(["Workspace", agent.workspace]);
  if (agent.effectiveWorkspace !== undefined && agent.effectiveWorkspace !== agent.workspace) {
    identityFields.push(["Effective", agent.effectiveWorkspace]);
  }
  if (agent.isolation === "worktree") {
    const changes = worktreeLineDelta?.kind === "ready" ? `${theme.fg("success", `+${worktreeLineDelta.added}`)}/${theme.fg("error", `-${worktreeLineDelta.removed}`)}` : theme.fg("dim", worktreeLineDelta?.kind === "unavailable" ? "unavailable" : "measuring…");
    identityFields.push(["Changes", changes]);
  }
  identityFields.push(["Created", formatLocalTime(agent.createdAt, nowMs)]);
  if (agent.childSessionFile !== undefined)
    identityFields.push(["Session", agent.childSessionFile]);
  lines.push(...fieldLines(identityFields, w));
  if (run !== undefined) {
    lines.push("");
    lines.push(theme.fg("accent", ` Run ${run.runId}`));
    const runFields = [
      ["Status", theme.fg(statusColor(run.status), run.status)],
      ["Activity", run.activityState],
      ["Recommendation", run.recommendation],
      ["Started", formatLocalTime(run.startedAt, nowMs)]
    ];
    if (run.lastActivityAt !== undefined)
      runFields.push(["Last active", formatLocalTime(run.lastActivityAt, nowMs)]);
    if (run.endedAt !== undefined)
      runFields.push(["Ended", formatLocalTime(run.endedAt, nowMs)]);
    if (run.suspendedAt !== undefined)
      runFields.push(["Suspended", formatLocalTime(run.suspendedAt, nowMs)]);
    runFields.push(["Turns", String(run.turnCount)]);
    runFields.push(["Description", run.description]);
    if (run.reasonCode !== undefined)
      runFields.push(["Reason", run.reasonCode]);
    if (run.error !== undefined)
      runFields.push(["Error", run.error]);
    runFields.push(["Notification", run.announcement]);
    lines.push(...fieldLines(runFields, w));
  }
  lines.push("");
  lines.push(theme.fg("accent", " Instruction"));
  if (instruction === undefined) {
    lines.push(theme.fg("dim", " Instruction unavailable."));
  } else {
    for (const wrapped of wrapModalText(instruction, Math.max(1, w - 2))) {
      lines.push(` ${wrapped}`);
    }
  }
  return lines;
}
async function showAgentInspection(ui, agent, run, instruction, watchWorktreeLineDelta) {
  let worktreeLineDelta = agent.isolation === "worktree" ? { kind: "measuring" } : undefined;
  await showScrollModal(ui, (width, theme) => renderAgentInspection(agent, run, instruction, worktreeLineDelta, theme, width), agent.isolation === "worktree" && watchWorktreeLineDelta !== undefined ? {
    activity: async (context) => {
      const update = (next) => {
        if (context.signal.aborted)
          return;
        worktreeLineDelta = next;
        context.requestRender();
      };
      try {
        await watchWorktreeLineDelta(context, update);
      } catch {
        update({ kind: "unavailable" });
        return;
      }
      update({ kind: "unavailable" });
    }
  } : {});
}

// src/agent-runs-manager.ts
import { truncateToWidth as truncateToWidth6 } from "@earendil-works/pi-tui";
function loadSnapshot(core, ctx) {
  return decodeAgentManagerSnapshot(core.call("agentManagerSnapshot", [{ ctx }]));
}
var TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "lost"]);
function pickerItems(snapshot) {
  const items = snapshot.agents.map((agent) => {
    const latest = snapshot.runs.find((run) => run.agentId === agent.agentId);
    const baseline = latest === undefined ? agent.createdAt : latest.lastActivityAt ?? latest.startedAt;
    return { agent, latest, baseline };
  });
  const rank = (item) => item.latest !== undefined && TERMINAL_RUN_STATUSES.has(item.latest.status) ? 1 : 0;
  return [...items].sort((a, b) => rank(a) - rank(b) || b.baseline - a.baseline);
}
function pickerRow(item, selected, theme, width, nowMs) {
  const cursor = selected ? theme.fg("accent", "→ ") : "  ";
  const header = `${item.agent.agentId} · ${item.agent.kind}`;
  if (item.latest === undefined)
    return [truncateToWidth6(`${cursor}${header}`, width, "...")];
  const run = item.latest;
  const activity = run.status === "running" ? ` · ${run.activityState}` : "";
  const status = theme.fg(statusColor(run.status), `${run.status}${activity}`);
  const ageSeconds = Math.max(0, Math.floor(nowMs / 1000) - item.baseline);
  const line = `${cursor}${header} · ${status} · ${run.description} · ${run.turnCount} turns · ${formatRelativeDuration(ageSeconds)}`;
  return [truncateToWidth6(line, width, "...")];
}
function runLabel(run) {
  const activity = run.status === "running" ? ` · ${run.activityState}` : "";
  const baseline = run.lastActivityAt ?? run.startedAt;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - baseline);
  return `${run.runId} · ${run.status}${activity} · ${run.description} · ${run.turnCount} turns · ${formatRelativeDuration(age)}`;
}
function resultOk(result2) {
  return isObjectLike(result2) && result2.ok === true;
}
function resultErrorMessage(result2, fallback) {
  if (isObjectLike(result2)) {
    if (typeof result2.error === "string" && result2.error !== "")
      return result2.error;
    if (typeof result2.message === "string" && result2.message !== "")
      return result2.message;
  }
  return fallback;
}
function notifyOutcome(ui, result2, successMessage) {
  if (resultOk(result2))
    notify(ui, successMessage, "info");
  else
    notify(ui, resultErrorMessage(result2, "Action failed."), "warning");
}
async function fetchLatestInstruction(core, ctx, agentId) {
  const result2 = await runAgentRunsCommand(core, ctx, `instruction ${agentId}`);
  if (!("action" in result2) || result2.action !== "command_result" || result2.ok !== true)
    return;
  const details = isObjectLike(result2.details) ? result2.details : undefined;
  if (details?.available !== true)
    return;
  return result2.message.trim() === "" ? undefined : result2.message;
}
async function runAgentRunsCommand(core, ctx, args) {
  return decodeGatewayCommandOutput(core.call("handleCommand", [{ name: "agent-runs", args, ctx }]));
}
async function applyChildUpdates(childSessions, result2, ctx) {
  if (!isObjectLike(result2))
    return;
  const details = isObjectLike(result2.details) ? result2.details : {};
  const updates = Array.isArray(details.childSessionUpdates) ? details.childSessionUpdates : [];
  const keyScope = childSessionCacheKeyScopeFromContext(ctx);
  for (const update of updates) {
    if (isObjectLike(update)) {
      await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
    }
  }
}
async function closeAgent(pi, core, childSessions, agentId, ctx) {
  const prepared = decodePreparedToolAction(core.call("prepareTool", [{
    name: "agent_close",
    params: { agent_id: agentId },
    ctx
  }]));
  if (prepared.ok !== true || prepared.action !== "agent_close")
    return prepared;
  const result2 = await executeAgentPrepared(pi, core, childSessions, pendingAgentWaits, prepared, ctx);
  const details = isObjectLike(result2.details) ? result2.details : {};
  const error = typeof details.error === "string" ? details.error : isObjectLike(details.error) && typeof details.error.message === "string" ? details.error.message : undefined;
  return error === undefined ? commandResult(true, `Closed ${agentId}.`, { agent_id: agentId, status: "closed" }) : commandResult(false, `Agent close failed: ${error}`, { agent_id: agentId, error });
}
async function showRunOutput(core, ui, ctx, runId) {
  const result2 = await runAgentRunsCommand(core, ctx, `output ${runId}`);
  if (!("action" in result2) || result2.action !== "command_result" || result2.ok !== true) {
    notify(ui, resultErrorMessage(result2, `No output for ${runId}.`), "warning");
    return;
  }
  const output = result2.message;
  await showScrollModal(ui, (width, theme) => [
    theme.fg("accent", ` Output ${runId}`),
    "",
    ...output.trim() === "" ? [theme.fg("dim", " No output.")] : wrapModalText(output, Math.max(1, width - 2)).map((line) => ` ${line}`)
  ]);
}
async function pickRunAndShowOutput(core, ui, ctx, snapshot, agentId) {
  const agentRuns = snapshot.runs.filter((run2) => run2.agentId === agentId);
  if (agentRuns.length === 0) {
    notify(ui, `No runs for ${agentId}.`, "info");
    return;
  }
  const select = ui?.select;
  if (typeof select !== "function") {
    await showRunOutput(core, ui, ctx, agentRuns[0].runId);
    return;
  }
  const labels = agentRuns.map(runLabel);
  const selected = await select.call(ui, `Runs for ${agentId}`, labels);
  const index = typeof selected === "string" ? labels.indexOf(selected) : -1;
  const run = index >= 0 ? agentRuns[index] : undefined;
  if (run === undefined)
    return;
  await showRunOutput(core, ui, ctx, run.runId);
}
async function executeAgentRunsManager(pi, core, childSessions, args, ctx) {
  const trimmed = args.trim();
  if (trimmed !== "") {
    if (trimmed.startsWith("close ")) {
      const agentId = trimmed.slice("close ".length).trim();
      if (agentId !== "") {
        const ui2 = uiFromContext2(ctx);
        if (typeof ui2?.select !== "function") {
          return commandResult(false, "Closing an agent requires interactive confirmation.", {
            agent_id: agentId
          });
        }
        if (!await confirmSelection(ui2, `Close ${agentId}?`, "Confirm close")) {
          return commandResult(true, "Agent close cancelled.", { cancelled: true, agent_id: agentId });
        }
        return closeAgent(pi, core, childSessions, agentId, ctx);
      }
    }
    const result2 = await runAgentRunsCommand(core, ctx, trimmed);
    await applyChildUpdates(childSessions, result2, ctx);
    return result2;
  }
  const ui = uiFromContext2(ctx);
  const prefix = `${childSessionCacheKeyScopeFromContext(ctx)}\x00`;
  const liveAgentIds = [...childSessions.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  decodeCoreAck(core.call("reconcileLiveAgentDispatches", [{ live_agent_ids: liveAgentIds }, { ctx }]));
  const snapshot = loadSnapshot(core, ctx);
  const agents = snapshot.agents;
  if (agents.length === 0) {
    return commandResult(true, "No agents.", { agents: [] });
  }
  if (typeof ui?.custom !== "function") {
    return runAgentRunsCommand(core, ctx, "list");
  }
  let lastAgentId;
  for (;; ) {
    const items = pickerItems(loadSnapshot(core, ctx));
    if (items.length === 0)
      return commandResult(true, "No agents.", { agents: [] });
    const selection = await showInteractiveList(ui, {
      items,
      header: (theme) => theme.fg("accent", ` Agent runs (${items.length})`),
      renderRow: (item2, _index, selected, theme, width) => pickerRow(item2, selected, theme, width, Date.now()),
      footer: " ↑↓/jk move · i inspect · o output · r runs · s stop · c close · x prune · q close",
      actionKeys: ["enter", "i", "o", "r", "s", "c", "x"],
      initialIndex: Math.max(0, items.findIndex((item2) => item2.agent.agentId === lastAgentId))
    });
    if (selection === undefined) {
      return { ...commandResult(true, "Agent runs unchanged.", { cancelled: true }), inspection: true };
    }
    const item = items[selection.index];
    if (item === undefined)
      continue;
    const agentId = item.agent.agentId;
    lastAgentId = agentId;
    if (selection.key === "enter" || selection.key === "i") {
      const instruction = await fetchLatestInstruction(core, ctx, agentId);
      await showAgentInspection(ui, item.agent, item.latest, instruction, item.agent.isolation === "worktree" ? async ({ signal }, onUpdate) => {
        await core.call("watchAgentWorktreeLineDelta", [
          { agent_id: agentId },
          signal,
          (rawUpdate) => onUpdate(decodeAgentWorktreeLineDeltaUpdate(rawUpdate)),
          { ctx }
        ]);
      } : undefined);
      continue;
    }
    if (selection.key === "o") {
      if (item.latest === undefined)
        notify(ui, `No runs for ${agentId}.`, "info");
      else
        await showRunOutput(core, ui, ctx, item.latest.runId);
      continue;
    }
    if (selection.key === "r") {
      await pickRunAndShowOutput(core, ui, ctx, loadSnapshot(core, ctx), agentId);
      continue;
    }
    if (selection.key === "s") {
      const result2 = await runAgentRunsCommand(core, ctx, `stop ${agentId}`);
      await applyChildUpdates(childSessions, result2, ctx);
      notifyOutcome(ui, result2, `Stopped ${agentId}.`);
      continue;
    }
    if (selection.key === "c") {
      if (await confirmSelection(ui, `Close ${agentId}?`, "Confirm close")) {
        const result2 = await closeAgent(pi, core, childSessions, agentId, ctx);
        notifyOutcome(ui, result2, `Closed ${agentId}.`);
      }
      continue;
    }
    if (selection.key === "x") {
      const terminal = items.filter((candidate) => candidate.latest !== undefined && TERMINAL_RUN_STATUSES.has(candidate.latest.status));
      if (terminal.length === 0) {
        notify(ui, "No terminal identities to prune.", "info");
        continue;
      }
      const noun = terminal.length === 1 ? "identity" : "identities";
      if (await confirmSelection(ui, `Close ${terminal.length} terminal ${noun}?`, "Confirm prune")) {
        let closed = 0;
        let failed = 0;
        for (const candidate of terminal) {
          const result2 = await closeAgent(pi, core, childSessions, candidate.agent.agentId, ctx);
          if (resultOk(result2))
            closed += 1;
          else
            failed += 1;
        }
        if (closed > 0 && terminal.some((candidate) => candidate.agent.agentId === lastAgentId)) {
          lastAgentId = undefined;
        }
        notify(ui, failed === 0 ? `Pruned ${closed} ${closed === 1 ? "identity" : "identities"}.` : `Pruned ${closed} ${noun}; ${failed} failed.`, failed === 0 ? "info" : "warning");
      }
      continue;
    }
  }
}

// src/visibility.ts
import { existsSync, readFileSync } from "node:fs";
import { DynamicBorder as DynamicBorder2, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList, truncateToWidth as truncateToWidth7 } from "@earendil-works/pi-tui";
function stringArray2(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item !== "") : [];
}
function visibilityFromSettings(settings) {
  const root = objectValue(settings);
  const taumel = objectValue(root?.["taumel"]);
  const category = (name) => {
    const block = objectValue(taumel?.[name]);
    if (block?.["disabled"] === undefined)
      return;
    return stringArray2(block["disabled"]);
  };
  return { tools: category("tools"), skills: category("skills") };
}
function readVisibilityFile(path) {
  if (!existsSync(path))
    return {};
  try {
    return visibilityFromSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}
function readConfigVisibilityDefaults(ctx) {
  const global = readVisibilityFile(taumelGlobalSettingsPath());
  const project = isProjectTrusted(ctx) ? readVisibilityFile(projectSettingsPath(cwdFromContext(ctx))) : {};
  return {
    tools: project.tools ?? global.tools ?? [],
    skills: project.skills ?? global.skills ?? []
  };
}
function hasSessionVisibilityEntry(ctx) {
  const sessionManager = objectValue(objectValue(ctx)?.sessionManager);
  return latestTaumelCustomEntry(sessionManager, "taumel.visibility").kind !== "absent";
}
function appendSessionVisibilityEntry(ctx, disabled) {
  const sessionManager = objectValue(objectValue(ctx)?.sessionManager);
  appendTaumelCustomEntry(sessionManager, "taumel.visibility", {
    version: 1,
    tools: { disabled: disabled.tools },
    skills: { disabled: disabled.skills }
  });
}
function seedVisibilityFromProject(ctx) {
  if (hasSessionVisibilityEntry(ctx))
    return false;
  const projectDisabled = readConfigVisibilityDefaults(ctx);
  if (projectDisabled.tools.length === 0 && projectDisabled.skills.length === 0) {
    return false;
  }
  appendSessionVisibilityEntry(ctx, projectDisabled);
  return true;
}
function isCtrlS(data) {
  return data === "\x13";
}
var toolDescriptions = new Map(toolContracts.map((contract) => [contract.name, contract.description]));
function withManagerDescriptions(state) {
  if (state.category !== "tools")
    return state;
  return {
    ...state,
    rows: state.rows.map((row) => ({
      ...row,
      description: row.available ? toolDescriptions.get(row.name) ?? "" : ""
    }))
  };
}
function loadVisibilityState(core, category, ctx) {
  return withManagerDescriptions(decodeVisibilityRowsResult(core.call("visibilityRows", [{ category, ctx }])));
}
var MAX_VISIBLE_ROWS = 10;

class VisibilityManagerComponent {
  state;
  theme;
  callbacks;
  busy;
  status;
  settingsList;
  frame;
  constructor(state, theme, callbacks) {
    this.state = state;
    this.theme = theme;
    this.callbacks = callbacks;
    this.frame = new DynamicBorder2((text) => fg(this.theme, "accent", text));
    this.settingsList = this.createSettingsList();
  }
  invalidate() {
    this.frame.invalidate();
    this.settingsList.invalidate();
  }
  render(width) {
    const lines = this.baseHeader(width);
    lines.push(...this.settingsList.render(width));
    this.addStatus(lines, width);
    lines.push(this.line(this.dim("  Ctrl+S save to project"), width));
    lines.push(this.border(width));
    return lines;
  }
  handleInput(data) {
    if (this.busy !== undefined)
      return;
    if (isCtrlS(data)) {
      this.runSave();
      return;
    }
    this.settingsList.handleInput(data);
    this.callbacks.requestRender();
  }
  createSettingsList() {
    const items = this.state.rows.map((row) => ({
      id: row.name,
      label: row.name,
      description: row.description || undefined,
      currentValue: row.available ? row.state : "unavailable",
      values: row.available ? ["enabled", "disabled"] : ["unavailable", "enabled"]
    }));
    return new SettingsList(items, Math.min(Math.max(items.length, 1), MAX_VISIBLE_ROWS), getSettingsListTheme(), (name) => this.runToggle(name), () => this.callbacks.onDone({ kind: "exit" }), { enableSearch: true });
  }
  baseHeader(width) {
    const disabled = `${this.state.disabled.length} disabled`;
    const stale = this.state.unavailable.length === 0 ? "" : ` • ${this.state.unavailable.length} unavailable`;
    return [
      this.border(width),
      this.line(this.accent(bold(this.theme, this.state.title)), width),
      this.line(`  ${disabled}${stale}`, width),
      ""
    ];
  }
  addStatus(lines, width) {
    if (this.busy) {
      lines.push("");
      lines.push(this.line(this.dim(`  ${this.busy}`), width));
    } else if (this.status) {
      lines.push("");
      lines.push(this.line(this.dim(`  ${this.status}`), width));
    }
  }
  line(text, width) {
    return truncateToWidth7(text, Math.max(0, width), "");
  }
  border(width) {
    return this.frame.render(width)[0] ?? "";
  }
  accent(text) {
    return fg(this.theme, "accent", text);
  }
  dim(text) {
    return fg(this.theme, "dim", text);
  }
  runToggle(name) {
    this.busy = "Updating visibility…";
    this.status = undefined;
    this.callbacks.requestRender();
    this.callbacks.onToggle(name).then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.settingsList = this.createSettingsList();
      this.callbacks.requestRender();
    });
  }
  runSave() {
    this.busy = "Saving visibility…";
    this.status = undefined;
    this.callbacks.requestRender();
    this.callbacks.onSave().then((outcome) => {
      this.state = outcome.state;
      this.busy = undefined;
      this.status = outcome.message;
      this.settingsList = this.createSettingsList();
      this.callbacks.requestRender();
    });
  }
}
async function saveProjectVisibility(category, disabled, details, ctx) {
  const state = details;
  if (!isProjectTrusted(ctx)) {
    const message = `Cannot save ${category} visibility: project is not trusted.`;
    return commandResult(false, message, { ...state, category });
  }
  const path = projectSettingsPath(cwdFromContext(ctx));
  let root, authorization;
  try {
    ({ settings: root, authorization } = await readJsonObjectForAtomicUpdate(path, true));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandResult(false, `Cannot save ${category} visibility: ${message}`, { ...state, category, path });
  }
  const existingTaumel = root["taumel"];
  const taumel = existingTaumel === undefined ? {} : objectValue(existingTaumel);
  if (taumel === undefined) {
    return commandResult(false, `Cannot save ${category} visibility: taumel must be a JSON object.`, { ...state, category, path });
  }
  const existingBlock = taumel[category];
  const block = existingBlock === undefined ? {} : objectValue(existingBlock);
  if (block === undefined) {
    return commandResult(false, `Cannot save ${category} visibility: taumel.${category} must be a JSON object.`, { ...state, category, path });
  }
  block["disabled"] = disabled;
  taumel[category] = block;
  root["taumel"] = taumel;
  await writeFileAtomically(authorization, `${JSON.stringify(root, null, 2)}
`, true);
  const stale = state.unavailable.length === 0 ? "" : ` Unavailable names remain: ${state.unavailable.join(", ")}.`;
  return commandResult(true, `Saved ${category} visibility to ${path}.${stale}`, { ...state, category, path });
}
async function saveFromCore(core, category, ctx) {
  const plan = decodeVisibilitySavePlan(core.call("visibilitySaveProjectPlan", [{ category, ctx }]));
  return saveProjectVisibility(category, plan.disabled, plan.details, ctx);
}
async function executeVisibilityManager(core, prompt, ctx, syncTools) {
  const category = prompt.category;
  const ui = uiFromContext2(ctx);
  const custom = ui?.["custom"];
  if (typeof custom !== "function") {
    return decodeVisibilityListResult(core.call("visibilityListCommand", [{ category, ctx }]));
  }
  let state = loadVisibilityState(core, category, ctx);
  let dirty = false;
  const action = await custom.call(ui, (tui, theme, _keybindings, done) => {
    const requestRender2 = requestRenderFromTui(tui);
    return new VisibilityManagerComponent(state, theme, {
      onDone: done,
      requestRender: requestRender2,
      onToggle: async (name) => {
        const result2 = decodeVisibilityToggleResult(core.call("toggleVisibilityRow", [{ category, name, ctx }]));
        const ok = result2.ok;
        if (ok)
          dirty = true;
        const enabledName = result2.ok ? result2.details.enabledName : undefined;
        if (category === "tools")
          syncTools(enabledName);
        state = loadVisibilityState(core, category, ctx);
        const message = resultMessage(result2, "Visibility updated.");
        notify(ui, message, ok ? "info" : "warning");
        return { ok, message, state };
      },
      onSave: async () => {
        const result2 = await saveFromCore(core, category, ctx);
        const ok = mutationOk(result2);
        state = loadVisibilityState(core, category, ctx);
        const message = resultMessage(result2, "Visibility updated.");
        notify(ui, message, ok ? "info" : "warning");
        return { ok, message, state };
      }
    });
  });
  if (typeof action === "object" && action !== null && action.kind === "exit") {
    return commandResult(true, dirty ? "Visibility updated." : "Visibility manager closed.", {
      ...state,
      category
    });
  }
  return commandResult(true, "Visibility manager closed.", { ...state, category });
}
function listSkillNames(core, ctx) {
  return decodeSkillListResult(core.call("listSkills", [{
    cwd: cwdFromContext(ctx),
    includeDisabled: true
  }])).skills.map((skill) => skill.name);
}
function notifyVisibilityWarnings(pi, core, ctx) {
  const result2 = decodeVisibilityWarningsResult(core.call("visibilityWarnings", [{
    tools: liveToolNames(pi, toolNames),
    skills: listSkillNames(core, ctx)
  }]));
  const messages = result2.messages;
  const ui = uiFromContext2(ctx);
  for (const message of messages)
    notify(ui, message, "warning");
}
function installVisibilityLifecycle(pi, core) {
  const sync = (_event, ctx) => {
    if (seedVisibilityFromProject(ctx)) {
      core.call("reloadSessionState", [ctx]);
    }
    setTimeout(() => notifyVisibilityWarnings(pi, core, ctx), 0);
  };
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
  pi.on("session_switch", sync);
}

// src/usage-inspection.ts
import { Key as Key3, matchesKey as matchesKey3, truncateToWidth as truncateToWidth8 } from "@earendil-works/pi-tui";
function record(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function decodeProviderUsage(value) {
  const details = record(value) ?? {};
  const rateLimits = Array.isArray(details["rateLimits"]) ? details["rateLimits"].flatMap((raw) => {
    const row = record(raw);
    const label = optionalString(row?.["label"]);
    if (row === undefined || label === undefined)
      return [];
    return [{
      label,
      ...optionalNumber(row["durationSeconds"]) === undefined ? {} : { durationSeconds: optionalNumber(row["durationSeconds"]) },
      ...optionalNumber(row["percentLeft"]) === undefined ? {} : { percentLeft: optionalNumber(row["percentLeft"]) },
      ...optionalNumber(row["resetsAt"]) === undefined ? {} : { resetsAt: optionalNumber(row["resetsAt"]) },
      ...optionalNumber(row["burnRatePerHour"]) === undefined ? {} : { burnRatePerHour: optionalNumber(row["burnRatePerHour"]) },
      ...optionalNumber(row["exhaustsAt"]) === undefined ? {} : { exhaustsAt: optionalNumber(row["exhaustsAt"]) },
      ...optionalNumber(row["exhaustsInSeconds"]) === undefined ? {} : { exhaustsInSeconds: optionalNumber(row["exhaustsInSeconds"]) },
      ...typeof row["exhaustsBeforeReset"] === "boolean" ? { exhaustsBeforeReset: row["exhaustsBeforeReset"] } : {}
    }];
  }) : [];
  return {
    notConfigured: details["notConfigured"] === true,
    rateLimits: [...rateLimits].sort((a, b) => (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity)),
    ...optionalString(details["accountLabel"]) === undefined ? {} : { accountLabel: optionalString(details["accountLabel"]) },
    ...optionalString(details["plan"]) === undefined ? {} : { plan: optionalString(details["plan"]) },
    ...optionalNumber(details["creditsBalance"]) === undefined ? {} : { creditsBalance: optionalNumber(details["creditsBalance"]) },
    ...optionalString(details["creditsCurrency"]) === undefined ? {} : { creditsCurrency: optionalString(details["creditsCurrency"]) },
    ...optionalString(details["error"]) === undefined ? {} : { error: optionalString(details["error"]) }
  };
}
function decodeUsageInspection(value) {
  const details = record(value) ?? {};
  if (record(details["openai"]) !== undefined || record(details["kimi"]) !== undefined) {
    return {
      openai: decodeProviderUsage(details["openai"]),
      kimi: decodeProviderUsage(details["kimi"])
    };
  }
  return {
    openai: decodeProviderUsage(details),
    kimi: {
      notConfigured: true,
      rateLimits: []
    }
  };
}
function timedEvent(prefix, targetSeconds, nowMs) {
  return `${prefix} in ${formatRelativeDuration((targetSeconds * 1000 - nowMs) / 1000)} · ${formatLocalTime(targetSeconds, nowMs)}`;
}
function quotaColor(percentLeft) {
  if (percentLeft === undefined)
    return "dim";
  if (percentLeft <= 10)
    return "error";
  if (percentLeft <= 25)
    return "warning";
  return "success";
}
function sanitizeError(error) {
  return error.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, 240);
}
function renderProviderSection(title, data, theme, width, nowMs, notConfiguredLines) {
  const w = Math.max(1, width);
  const line = (value) => truncateToWidth8(value, w, "...");
  const lines = [theme.fg("accent", ` ${title}`), ""];
  if (data.notConfigured) {
    lines.push(` ${notConfiguredLines[0]}`, ` ${notConfiguredLines[1]}`);
  } else if (data.error !== undefined) {
    lines.push(theme.fg("error", " Unable to fetch usage"), ` ${sanitizeError(data.error)}`);
  } else {
    const metadata = [];
    if (data.accountLabel !== undefined)
      metadata.push(["Account", data.accountLabel]);
    if (data.plan !== undefined)
      metadata.push(["Plan", data.plan]);
    if (data.creditsBalance !== undefined) {
      const credits = data.creditsCurrency === undefined ? data.creditsBalance.toFixed(2) : `${data.creditsCurrency} ${data.creditsBalance.toFixed(2)}`;
      metadata.push(["Credits", credits]);
    }
    const labelWidth = metadata.reduce((max, [label]) => Math.max(max, label.length), 0);
    for (const [label, value] of metadata)
      lines.push(line(` ${label.padEnd(labelWidth)}   ${value}`));
    if (metadata.length > 0 && data.rateLimits.length > 0)
      lines.push("");
    if (data.rateLimits.length === 0)
      lines.push(theme.fg("dim", " No quota windows returned"));
    for (let index = 0;index < data.rateLimits.length; index += 1) {
      const row = data.rateLimits[index];
      if (index > 0)
        lines.push("");
      const label = row.label.replace(/\bLimit\b/, "limit");
      lines.push(line(` ${label}`));
      const barWidth = Math.max(6, Math.min(20, w - 15));
      const percent = row.percentLeft === undefined ? undefined : Math.max(0, Math.min(100, Math.round(row.percentLeft)));
      const filled = percent === undefined ? 0 : Math.round(percent / 100 * barWidth);
      const bar = `[${"█".repeat(filled)}${"░".repeat(barWidth - filled)}]`;
      lines.push(line(` ${theme.fg(quotaColor(percent), bar)} ${percent === undefined ? "?" : percent}% left`));
      if (row.resetsAt !== undefined) {
        const reset = timedEvent("Resets", row.resetsAt, nowMs);
        const parts = reset.split(" · ");
        if (` ${reset}`.length <= w || parts.length !== 2)
          lines.push(line(` ${reset}`));
        else {
          lines.push(line(` ${parts[0]}`));
          lines.push(line(` at ${parts[1]}`));
        }
      }
      if (row.burnRatePerHour !== undefined && row.burnRatePerHour >= 0.01) {
        const burn = `Burn ${row.burnRatePerHour.toFixed(1)}%/h`;
        const exhaustionTarget = row.exhaustsInSeconds !== undefined ? Math.floor(nowMs / 1000 + row.exhaustsInSeconds) : row.exhaustsAt !== undefined && row.exhaustsAt * 1000 > nowMs ? row.exhaustsAt : undefined;
        const estimate = row.exhaustsBeforeReset === false ? "Safe until reset" : exhaustionTarget === undefined ? undefined : timedEvent("Est. empty", exhaustionTarget, nowMs);
        const burnLine = `${burn}${estimate === undefined ? "" : ` · ${estimate}`}`;
        if (` ${burnLine}`.length <= w || estimate === undefined)
          lines.push(line(` ${burnLine}`));
        else {
          lines.push(line(` ${burn}`));
          lines.push(line(` ${estimate}`));
        }
      }
    }
  }
  return lines.map(line);
}
function renderUsageInspection(data, theme, width, nowMs = Date.now()) {
  const openai = renderProviderSection("OpenAI Codex Usage", data.openai, theme, width, nowMs, ["OpenAI Codex is not configured.", "Sign in with /login and try again."]);
  const kimi = renderProviderSection("Kimi Code Usage", data.kimi, theme, width, nowMs, ["Kimi Code is not configured in Pi.", "Configure the moonshot provider and try again."]);
  return [...openai, "", ...kimi, "", theme.fg("dim", " Esc/q/Enter close")];
}
async function showUsageInspection(details, ctx) {
  const commandCtx = record(ctx);
  const ui = record(commandCtx?.["ui"]);
  const custom = ui?.["custom"];
  if (typeof custom !== "function")
    return;
  const data = decodeUsageInspection(details);
  await custom.call(ui, (_tui, rawTheme, _keys, done) => {
    const theme = record(rawTheme);
    const effectiveTheme = theme !== undefined && typeof theme.fg === "function" ? theme : { fg: (_color, text) => text };
    return {
      render: (width) => renderUsageInspection(data, effectiveTheme, width),
      invalidate: () => {
        return;
      },
      handleInput: (input) => {
        if (input === "q" || matchesKey3(input, Key3.escape) || matchesKey3(input, Key3.enter))
          done();
      }
    };
  });
}

// src/tasks-modal.ts
var footer = " ↑↓ move · a add · e edit · s advance · x cancel · d delete · q close";
var statusPad = "in_progress".length;
function planStatusColor(status) {
  switch (status) {
    case "complete":
      return "success";
    case "blocked":
      return "error";
    case "time_limited":
      return "warning";
    case "active":
      return "accent";
    default:
      return "dim";
  }
}
function planHeader(plan, theme) {
  const label = theme.fg(planStatusColor(plan.status), `Plan ${plan.statusLabel}`);
  const time = plan.timeUsage === "" ? "" : ` · ${plan.timeUsage}`;
  return `${label} ${theme.fg("dim", `· ${plan.completedTasks}/${plan.totalTasks} tasks${time}`)}`;
}
function asPlanDetails(value) {
  if (!isObjectLike(value)) {
    return { plan: null };
  }
  const plan = value.plan;
  if (plan === null || plan === undefined)
    return { plan: null };
  if (!isObjectLike(plan) || !Array.isArray(plan.tasks)) {
    return { plan: null };
  }
  return { plan };
}
function runPlanCommand(core, ctx, args) {
  return decodeGatewayCommandOutput(core.call("handleCommand", [{ name: "plan", args, ctx }]));
}
function loadPlan(core, ctx) {
  const result2 = runPlanCommand(core, ctx, "");
  if (!("action" in result2) || result2.action !== "command_result") {
    return { plan: null };
  }
  return asPlanDetails(result2.details);
}
function notify2(ui, message, level = "warning") {
  const fn = ui?.notify;
  if (typeof fn === "function") {
    fn.call(ui, message, level);
  }
}
function mutationError(result2) {
  if (!("ok" in result2))
    return "plan command failed";
  if (result2.ok === true && "action" in result2 && result2.action === "command_result") {
    return;
  }
  if ("error" in result2 && typeof result2.error === "string" && result2.error !== "") {
    return result2.error;
  }
  if ("message" in result2 && typeof result2.message === "string" && result2.message !== "") {
    return result2.message;
  }
  return "plan command failed";
}
function applyMutation(core, ui, ctx, args) {
  const result2 = runPlanCommand(core, ctx, args);
  const error = mutationError(result2);
  if (error !== undefined) {
    notify2(ui, error, "warning");
    return;
  }
  if (!("action" in result2) || result2.action !== "command_result") {
    notify2(ui, "plan command failed", "warning");
    return;
  }
  if (result2.message === "Plan complete.") {
    notify2(ui, result2.message, "info");
  }
  return asPlanDetails(result2.details);
}
function renderTaskRow(task, _index, selected, theme, width) {
  const deps = task.depends_on.length === 0 ? "" : ` · after ${task.depends_on.join(", ")}`;
  const cancellation = planTaskCancellationDetail(task);
  const cancellationSuffix = cancellation === undefined ? "" : ` · ${cancellation}`;
  const suffixes = [
    ` · ${task.taskId} · ${task.origin}${deps}${cancellationSuffix}`,
    ` · ${task.taskId}${deps}${cancellationSuffix}`,
    ` · ${task.taskId}${cancellationSuffix}`,
    cancellationSuffix
  ];
  const prefix = `  ${task.status.padEnd(statusPad)}  `;
  const minTitle = 8;
  let suffix;
  for (const candidate of suffixes) {
    if (width - prefix.length - candidate.length >= task.title.length) {
      suffix = candidate;
      break;
    }
  }
  if (suffix === undefined) {
    suffix = "";
    for (const candidate of suffixes) {
      if (width - prefix.length - candidate.length >= minTitle) {
        suffix = candidate;
        break;
      }
    }
  }
  const titleBudget = Math.max(1, width - prefix.length - suffix.length);
  const title = task.title.length <= titleBudget ? task.title : `${task.title.slice(0, Math.max(1, titleBudget - 1))}…`;
  const marker = selected ? theme.fg("accent", "›") : " ";
  const statusText = theme.fg(planTaskStatusColor(task.status), task.status.padEnd(statusPad));
  return [`${marker} ${statusText}  ${theme.fg("toolOutput", title)}${theme.fg("dim", suffix)}`];
}
function emptyLines(theme, _width) {
  return [
    theme.fg("dim", " No plan yet."),
    theme.fg("dim", " Press a to add the first task.")
  ];
}
async function promptNewTask(ui) {
  const titleRaw = await promptModalText(ui, "Task title", "required");
  if (titleRaw === undefined)
    return;
  const title = titleRaw.trim();
  if (title === "")
    return;
  const descriptionRaw = await promptModalText(ui, "Task description", "optional");
  const description = descriptionRaw?.trim() ?? "";
  return description === "" ? { title } : { title, description };
}
async function promptEditTask(ui, task) {
  const titleRaw = await promptModalText(ui, "Task title", task.title);
  if (titleRaw === undefined)
    return;
  const titleTrimmed = titleRaw.trim();
  const title = titleTrimmed === "" ? undefined : titleTrimmed;
  const descriptionPlaceholder = task.description ?? "";
  const descriptionRaw = await promptModalText(ui, "Task description", descriptionPlaceholder);
  if (descriptionRaw === undefined)
    return;
  const descriptionTrimmed = descriptionRaw.trim();
  if (descriptionTrimmed === "") {
    return title === undefined ? {} : { title };
  }
  return title === undefined ? { description: descriptionTrimmed } : { title, description: descriptionTrimmed };
}
function jsonPayload(fields) {
  return JSON.stringify(fields);
}
async function executeTasksModal(core, ctx) {
  const ui = typeof ctx === "object" && ctx !== null ? ctx.ui : undefined;
  let details = loadPlan(core, ctx);
  let cursor = 0;
  while (true) {
    const tasks = details.plan?.tasks ?? [];
    const plan = details.plan;
    const selection = await showInteractiveList(ui, {
      items: tasks,
      renderRow: renderTaskRow,
      emptyLines,
      ...plan === null ? {} : { header: (theme) => planHeader(plan, theme) },
      footer,
      actionKeys: ["a", "e", "s", "x", "d"],
      initialIndex: cursor
    });
    if (selection === undefined) {
      return {
        ok: true,
        action: "command_result",
        message: "Tasks unchanged.",
        details,
        inspection: true
      };
    }
    cursor = selection.index;
    const selected = tasks[selection.index];
    if (selection.key === "a") {
      const created = await promptNewTask(ui);
      if (created === undefined)
        continue;
      const payload = created.description === undefined ? { title: created.title } : { title: created.title, description: created.description };
      const next = applyMutation(core, ui, ctx, `task add ${jsonPayload(payload)}`);
      if (next !== undefined) {
        details = next;
        cursor = Math.max(0, (next.plan?.tasks.length ?? 1) - 1);
      }
      continue;
    }
    if (selected === undefined)
      continue;
    if (selection.key === "e") {
      const edited = await promptEditTask(ui, selected);
      if (edited === undefined)
        continue;
      if (edited.title === undefined && edited.description === undefined)
        continue;
      const next = applyMutation(core, ui, ctx, `task edit ${selected.taskId} ${jsonPayload(edited)}`);
      if (next !== undefined)
        details = next;
      continue;
    }
    if (selection.key === "s") {
      if (selected.status === "completed" || selected.status === "cancelled") {
        notify2(ui, `cannot advance a ${selected.status} task`, "warning");
        continue;
      }
      const next = applyMutation(core, ui, ctx, `task advance ${selected.taskId}`);
      if (next !== undefined)
        details = next;
      continue;
    }
    if (selection.key === "x") {
      if (selected.status === "completed" || selected.status === "cancelled") {
        notify2(ui, `cannot cancel a ${selected.status} task`, "warning");
        continue;
      }
      if (!await confirmSelection(ui, `Cancel ${selected.taskId}?`, "Confirm cancel")) {
        continue;
      }
      const next = applyMutation(core, ui, ctx, `task cancel ${selected.taskId}`);
      if (next !== undefined)
        details = next;
      continue;
    }
    if (selection.key === "d") {
      if (!await confirmSelection(ui, `Delete ${selected.taskId}?`, "Confirm delete")) {
        continue;
      }
      const next = applyMutation(core, ui, ctx, `task delete ${selected.taskId}`);
      if (next !== undefined) {
        details = next;
        const remaining = next.plan?.tasks.length ?? 0;
        cursor = Math.min(cursor, Math.max(0, remaining - 1));
      }
      continue;
    }
  }
}

// src/ps-modal.ts
var footer2 = " ↑↓ move · o output · k kill · q close";
function ownerIdFromContext(ctx) {
  if (typeof ctx !== "object" || ctx === null)
    return "current";
  const record2 = ctx;
  if (typeof record2.taumelSessionId === "string" && record2.taumelSessionId.trim() !== "") {
    return record2.taumelSessionId.trim();
  }
  const sessionManager = record2.sessionManager;
  if (typeof sessionManager === "object" && sessionManager !== null) {
    const getSessionId = sessionManager.getSessionId;
    if (typeof getSessionId === "function") {
      const value = getSessionId.call(sessionManager);
      if (typeof value === "string" && value.trim() !== "")
        return value.trim();
    }
  }
  return "current";
}
function notify3(ui, message, level = "warning") {
  const fn = ui?.notify;
  if (typeof fn === "function") {
    fn.call(ui, message, level);
  }
}
function loadSnapshot2(core, ownerId) {
  return decodeProcessManagerSnapshot(core.call("processManagerSnapshot", [{ ownerId }]));
}
function formatAge(seconds) {
  if (seconds < 60)
    return `${seconds}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
function runStateLabel(entry) {
  if (entry.runState === "running")
    return "running";
  if (entry.exitCode === undefined)
    return "exited";
  return `exit ${entry.exitCode}`;
}
function runStateColor(entry) {
  return entry.runState === "running" ? "accent" : "dim";
}
function renderSessionRow(entry, _index, selected, theme, width) {
  const marker = selected ? theme.fg("accent", "›") : " ";
  const id = String(entry.sessionId).padStart(3, " ");
  const state = runStateLabel(entry);
  const age = formatAge(entry.ageSeconds);
  const meta = ` · ${age}${entry.retained ? " · retained" : ""}`;
  const prefix = `${marker} ${id}  ${state.padEnd(10)}  `;
  const commandBudget = Math.max(1, width - prefix.length - meta.length);
  const command2 = entry.command.length <= commandBudget ? entry.command : `${entry.command.slice(0, Math.max(1, commandBudget - 1))}…`;
  return [
    `${marker} ${theme.fg("dim", id)}  ${theme.fg(runStateColor(entry), state.padEnd(10))}  ${theme.fg("toolOutput", command2)}${theme.fg("dim", meta)}`
  ];
}
function emptyLines2(theme, _width) {
  return [theme.fg("dim", " No command sessions.")];
}
async function showOutput(core, ui, ownerId, entry) {
  const output = decodeProcessManagerOutput(core.call("processManagerOutput", [{
    ownerId,
    sessionId: entry.sessionId
  }]));
  const body = output.available ? output.text : "Output is no longer available.";
  await showScrollModal(ui, (width, theme) => {
    const header = theme.fg("dim", `Session ${entry.sessionId} · ${entry.command}`);
    const lines = wrapModalText(body, Math.max(1, width)).map((line) => theme.fg("toolOutput", line));
    return [header, "", ...lines];
  });
}
async function killSession(core, ui, ownerId, entry) {
  if (entry.runState !== "running") {
    return `session ${entry.sessionId} already completed; cannot kill`;
  }
  if (!await confirmSelection(ui, `Kill session ${entry.sessionId}?`, "Confirm kill")) {
    return;
  }
  try {
    decodeCoreAck(core.call("processManagerKill", [{ ownerId, sessionId: entry.sessionId }]));
    return;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
async function executePsModal(core, ctx) {
  const ui = typeof ctx === "object" && ctx !== null ? ctx.ui : undefined;
  const ownerId = ownerIdFromContext(ctx);
  let snapshot = loadSnapshot2(core, ownerId);
  let cursor = 0;
  while (true) {
    const sessions = snapshot.sessions;
    const selection = await showInteractiveList(ui, {
      items: sessions,
      renderRow: renderSessionRow,
      emptyLines: emptyLines2,
      footer: footer2,
      actionKeys: ["o", "k"],
      initialIndex: cursor
    });
    if (selection === undefined) {
      return {
        ok: true,
        action: "command_result",
        message: "Process manager closed.",
        details: snapshot,
        inspection: true
      };
    }
    cursor = selection.index;
    const selected = sessions[selection.index];
    if (selected === undefined)
      continue;
    if (selection.key === "o") {
      await showOutput(core, ui, ownerId, selected);
      snapshot = loadSnapshot2(core, ownerId);
      continue;
    }
    if (selection.key === "k") {
      const error = await killSession(core, ui, ownerId, selected);
      if (error !== undefined)
        notify3(ui, error, "warning");
      snapshot = loadSnapshot2(core, ownerId);
      cursor = Math.min(cursor, Math.max(0, snapshot.sessions.length - 1));
      continue;
    }
  }
}

// src/command-executor.ts
function commandContext(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function commandResult2(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function commandResultFromToolResult(core, result2) {
  return decodeBridgeCommandResult(core.call("toolResultToCommandResult", [result2]));
}
function hasPendingMessages(ctx) {
  const hasPending = commandContext(ctx)?.hasPendingMessages;
  if (typeof hasPending !== "function")
    return false;
  return hasPending.call(ctx) === true;
}
function syncActiveTools(pi, core, ctx, enabledName) {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function")
    return;
  const current = [...pi.getActiveTools()];
  if (enabledName !== undefined && enabledName !== "" && !current.includes(enabledName) && liveToolNames(pi, toolNames).includes(enabledName)) {
    current.push(enabledName);
    pi.setActiveTools(current);
  }
  const plan = decodeActiveToolsPlan(core.call("planActiveToolsSync", [{ tools: current, ctx }]));
  if (plan.changed)
    pi.setActiveTools([...plan.tools]);
}
function applyVisibilityCommandSideEffects(pi, core, result2, ctx) {
  const rawDetails = commandResult2(result2)?.details;
  const details = typeof rawDetails === "object" && rawDetails !== null ? rawDetails : undefined;
  if (details?.visibilityChanged !== true || details.category !== "tools")
    return;
  const enabledName = typeof details.enabledName === "string" ? details.enabledName : undefined;
  syncActiveTools(pi, core, ctx, enabledName);
}
function latestAssistantStopReason(event) {
  const messages = typeof event === "object" && event !== null ? event.messages : undefined;
  if (!Array.isArray(messages))
    return "";
  for (let index = messages.length - 1;index >= 0; index -= 1) {
    const rawMessage = messages[index];
    const message = typeof rawMessage === "object" && rawMessage !== null ? rawMessage : undefined;
    if (message?.role !== "assistant")
      continue;
    return typeof message.stopReason === "string" ? message.stopReason : "";
  }
  return "";
}
async function sendPlanMessage(pi, customType, content, display, options, details) {
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType, content, display, ...details === undefined ? {} : { details } }, options);
    return;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(content, { deliverAs: options.deliverAs });
  }
}
async function showPlanInspection(result2, ctx) {
  const rawUi = commandContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi : undefined;
  if (typeof ui?.custom !== "function")
    return;
  const details = typeof result2.details === "object" && result2.details !== null ? result2.details : {};
  const plan = typeof details.plan === "object" && details.plan !== null ? details.plan : undefined;
  const automation = typeof details.automation === "object" && details.automation !== null ? details.automation : undefined;
  const status = typeof plan?.statusLabel === "string" ? plan.statusLabel : "none";
  const time = typeof plan?.timeUsage === "string" ? plan.timeUsage : "";
  const completed = typeof plan?.completedTasks === "number" ? plan.completedTasks : 0;
  const total = typeof plan?.totalTasks === "number" ? plan.totalTasks : 0;
  const progress = plan === undefined ? "" : `${completed}/${total} tasks`;
  const candidate = ["Plan", status, progress, time].filter((part) => part !== "").join(" · ");
  const blockRows = Array.isArray(plan?.blocks) ? plan.blocks.flatMap((rawBlock, index) => {
    const block = typeof rawBlock === "object" && rawBlock !== null ? rawBlock : {};
    const blockedAt = typeof block.blockedAt === "number" ? new Date(block.blockedAt * 1000).toISOString() : "unknown time";
    const clearedAt = typeof block.clearedAt === "number" ? new Date(block.clearedAt * 1000).toISOString() : "open";
    const source = typeof block.source === "string" ? block.source : "unknown";
    const reason = typeof block.reason === "string" ? block.reason : "";
    const clearedBy = typeof block.clearedBy === "string" ? block.clearedBy : "unresolved";
    const resolution = typeof block.resolution === "string" ? block.resolution : "unresolved";
    return [
      `Block ${index + 1}: ${blockedAt} · source ${source}`,
      `  Reason: ${reason}`,
      `  Cleared: ${clearedAt} · by ${clearedBy}`,
      `  Resolution: ${resolution}`
    ];
  }) : [];
  let expanded = false;
  await ui.custom((tui, theme, _keys, done) => ({
    render: (width) => {
      const rawLines = expanded && plan !== undefined ? [
        candidate,
        `Status: ${status}`,
        `Automation: ${String(automation?.continuation ?? "enabled")}`,
        `Tokens: ${String(plan.tokensUsed ?? 0)}`,
        `Active time: ${time}`,
        `Time limit: ${plan.timeLimitSeconds == null ? "none" : String(plan.timeLimitSeconds)}`,
        ...blockRows,
        ...Array.isArray(plan.tasks) ? plan.tasks.map((rawTask) => {
          const task = typeof rawTask === "object" && rawTask !== null ? rawTask : {};
          const id = typeof task.taskId === "string" ? task.taskId : "task";
          const title = typeof task.title === "string" ? task.title : "";
          const taskStatus = typeof task.status === "string" ? task.status : "unknown";
          const origin = typeof task.origin === "string" ? task.origin : "unknown";
          const dependencies = Array.isArray(task.depends_on) ? task.depends_on.filter((value) => typeof value === "string") : [];
          const cancellation = planTaskCancellationDetail(task);
          return `${id} [${taskStatus}/${origin}] ${title}${dependencies.length === 0 ? "" : ` (depends on ${dependencies.join(", ")})`}${cancellation === undefined ? "" : ` · ${cancellation}`}`;
        }) : []
      ] : [candidate];
      const lines = rawLines.map((raw) => raw.length <= width ? raw : `${raw.slice(0, Math.max(0, width - 3))}...`);
      const themed = typeof theme === "object" && theme !== null && typeof theme.fg === "function" ? lines.map((line) => theme.fg("customMessageLabel", line)) : lines;
      return themed;
    },
    invalidate: () => {
      return;
    },
    handleInput: (data) => {
      if (data === "\x0F") {
        expanded = !expanded;
        if (typeof tui === "object" && tui !== null && typeof tui.requestRender === "function") {
          tui.requestRender();
        }
      } else
        done();
    }
  }));
}
async function showSystemPromptInspection(ctx) {
  const commandCtx = commandContext(ctx);
  const getSystemPrompt = commandCtx?.getSystemPrompt;
  const rawUi = commandCtx?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi : undefined;
  if (typeof getSystemPrompt !== "function" || typeof ui?.custom !== "function")
    return;
  const prompt = String(getSystemPrompt.call(ctx));
  let offset = 0;
  await ui.custom((tui, theme, _keys, done) => ({
    render: (width) => {
      const contentWidth = Math.max(1, width);
      const lines = prompt.split(`
`).flatMap((line) => {
        if (line.length === 0)
          return [""];
        const wrapped = [];
        for (let index = 0;index < line.length; index += contentWidth) {
          wrapped.push(line.slice(index, index + contentWidth));
        }
        return wrapped;
      });
      offset = Math.min(offset, Math.max(0, lines.length - 1));
      const visible = lines.slice(offset, offset + 30);
      const footer3 = `[${offset + 1}-${offset + visible.length}/${lines.length}] ↑↓ scroll · any other key closes`;
      const themed = typeof theme === "object" && theme !== null && typeof theme.fg === "function" ? theme : undefined;
      return [
        themed ? themed.fg("customMessageLabel", "System prompt") : "System prompt",
        ...visible,
        themed ? themed.fg("dim", footer3.slice(0, contentWidth)) : footer3.slice(0, contentWidth)
      ];
    },
    invalidate: () => {
      return;
    },
    handleInput: (data) => {
      if (data === "\x1B[A")
        offset = Math.max(0, offset - 1);
      else if (data === "\x1B[B")
        offset += 1;
      else
        return done();
      if (typeof tui === "object" && tui !== null && typeof tui.requestRender === "function") {
        tui.requestRender();
      }
    }
  }));
}
async function sendPlanContinuation(pi, core, ctx, initial, facts, event) {
  if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx))
    return;
  const stopReason = latestAssistantStopReason(event);
  const plan = decodePlanContinuationPlan(core.call("planPlanContinuation", [{
    ...facts,
    initial,
    ...stopReason === "" ? {} : { latestAssistantStopReason: stopReason },
    ctx
  }]));
  if (plan.kind === "none")
    return;
  try {
    if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx))
      return;
    await sendPlanMessage(pi, plan.customType, plan.content, plan.display, {
      triggerTurn: plan.triggerTurn,
      deliverAs: plan.deliverAs
    }, plan.details);
  } catch (error) {
    if (isStaleContextError(error))
      return;
    throw error;
  }
}
async function executePlanCommandSideEffects(pi, core, name, result2, ctx) {
  const command2 = commandResult2(result2);
  if (name !== "plan" || command2?.action !== "command_result") {
    return;
  }
  const submittedMessage = typeof command2.planSubmitUserMessage === "string" ? command2.planSubmitUserMessage : "";
  if (submittedMessage !== "") {
    try {
      if (typeof pi.sendUserMessage !== "function") {
        throw new Error("Pi sendUserMessage is unavailable");
      }
      await pi.sendUserMessage(submittedMessage);
    } catch (error) {
      if (typeof command2.planRollback === "object" && command2.planRollback !== null) {
        decodePlanRollbackResult(core.call("rollbackPlanCommand", [{ snapshot: command2.planRollback, ctx }]));
      }
      throw error;
    }
    return;
  }
  if (command2.planInspection === true) {
    await showPlanInspection(command2, ctx);
    return;
  }
  if (command2.planFollowup === true) {
    await sendPlanContinuation(pi, core, ctx, true, {
      hostIdle: true,
      hasPendingMessages: false,
      retrying: false,
      compacting: false
    }, {});
  }
}
async function executePermissionsPrompt(core, rawPrompt, ctx) {
  const prompt = decodePermissionsPrompt(rawPrompt);
  const finish = (selection) => decodePermissionsCommandResult(core.call("finishPermissionsPrompt", [{ prompt, selection, ctx }]));
  const rawUi = commandContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi : undefined;
  const select = ui?.select;
  const plan = decodePermissionsPromptPlan(core.call("planPermissionsPrompt", [{
    prompt,
    uiAvailable: typeof select === "function"
  }]));
  if (plan.kind === "result")
    return plan.result;
  if (typeof select !== "function")
    throw new Error("Invalid Taumel permissions prompt plan");
  const selected = await select.call(ui, plan.title, [...plan.labels]);
  if (selected === undefined || selected === null)
    return finish({ status: "cancelled" });
  return finish({ status: "selected", selected: String(selected) });
}
async function executeCronPrompt(core, prompt, ctx) {
  return executeCronManager(core, prompt, ctx);
}
async function executeVisibilityPrompt(pi, core, prompt, ctx) {
  return executeVisibilityManager(core, prompt, ctx, (enabledName) => syncActiveTools(pi, core, ctx, enabledName));
}
async function executeCommandAction(pi, core, result2, ctx) {
  if (!("action" in result2))
    return result2;
  switch (result2.action) {
    case "permissions_prompt":
      return executePermissionsPrompt(core, result2, ctx);
    case "cron_prompt":
      return executeCronPrompt(core, result2, ctx);
    case "visibility_prompt":
      return executeVisibilityPrompt(pi, core, result2, ctx);
    case "visibility_save_project": {
      return saveProjectVisibility(result2.category, result2.disabled, result2.details, ctx);
    }
    case "openai_usage_fetch":
      return commandResultFromToolResult(core, await executeOpenAiUsageWithHostAuth(pi, core, { ...result2 }, ctx));
    case "usage_pair_fetch":
      return commandResultFromToolResult(core, await executeUsagePairWithHostAuth(pi, core, { ...result2 }, ctx));
    default:
      return result2;
  }
}
async function applyChildSessionUpdatesFromCommandResult(childSessions, result2, keyScope) {
  const rawDetails = commandResult2(result2)?.details;
  const details = typeof rawDetails === "object" && rawDetails !== null ? rawDetails : undefined;
  const updates = Array.isArray(details?.childSessionUpdates) ? details.childSessionUpdates : [];
  for (const update of updates) {
    if (typeof update === "object" && update !== null) {
      await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
    }
  }
}
async function executeGatewayCommand(pi, core, childSessions, composer, name, args, ctx, childExtensionFactory) {
  refreshOwnedChildPermissions(childSessions, ctx, core);
  if (name === "taumel") {
    const trimmed = args.trim();
    if (trimmed === "")
      return taumelStatus();
    if (trimmed === "init")
      return initializeTaumelGlobalConfig();
    const message = "Usage: /taumel [init]";
    return { ok: false, action: "command_result", message, error: message, details: { ok: false, error: message } };
  }
  if (name === "composer") {
    return executeComposerCommand(core, composer, args, ctx);
  }
  if (name === "compaction-model") {
    return executeCompactionModelCommand(pi, core, args, ctx);
  }
  if (name === "agent-runs") {
    return executeAgentRunsManager(pi, core, childSessions, args, ctx);
  }
  if (name === "tasks") {
    return executeTasksModal(core, ctx);
  }
  if (name === "ps") {
    return executePsModal(core, ctx);
  }
  if (name === "execpolicy") {
    const trimmed = args.trim();
    const valid = trimmed === "" || trimmed.startsWith("check ") && trimmed.slice("check ".length).trim() !== "";
    if (!valid) {
      const message = "Usage: /execpolicy [check <command>]";
      return { ok: false, action: "command_result", message, error: message, details: { ok: false, error: message } };
    }
  }
  const callCore = (commandCtx2) => decodeGatewayCommandOutput(core.call("handleCommand", [{ name, args, ctx: commandCtx2 }]));
  const plan = decodeCommandExecutionPlan(core.call("planCommandExecution", [{ name, args, ctx }]));
  if (plan.kind === "error")
    return { ok: false, error: plan.message };
  if (plan.kind === "direct") {
    const result3 = await executeCommandAction(pi, core, callCore(ctx), ctx);
    applyVisibilityCommandSideEffects(pi, core, result3, ctx);
    await applyChildSessionUpdatesFromCommandResult(childSessions, result3);
    await executePlanCommandSideEffects(pi, core, name, result3, ctx);
    if (name === "permissions" || name === "sandbox" || name === "approval" || name === "network") {
      refreshOwnedChildPermissions(childSessions, ctx, core);
    }
    return result3;
  }
  const contextOverrides = {};
  for (const override of plan.contextOverrides) {
    contextOverrides[override.name] = override.value;
  }
  let commandCtx = contextWithOverrides(ctx, contextOverrides);
  const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
  const childSessionPlan = decodeCommandChildSessionPlan(core.call("planCommandChildSession", [{
    metadata: plan.metadata,
    activeToolsMode: plan.activeToolsMode,
    currentActiveToolsAvailable: currentActiveToolNames !== undefined,
    currentActiveTools: [...currentActiveToolNames ?? []]
  }]));
  const metadata = childSessionPlan.metadata;
  const bridge = await createChildSession(pi, core, ctx, metadata, childExtensionFactory);
  const childContextKey = plan.childSessionContextKey;
  if (childContextKey !== "" && bridge?.sessionId && !bridge.cancelled && !bridge.error) {
    commandCtx = contextWithOverrides(commandCtx, { [childContextKey]: bridge.sessionId });
  }
  const result2 = decodeBridgeCommandResult(callCore(commandCtx));
  const dispatchPlan = decodeCommandChildDispatchPlan(core.call("planCommandChildDispatch", [{
    result: result2,
    bridge: childBridgeFacts(bridge)
  }]));
  const plannedResult = dispatchPlan.result;
  if (dispatchPlan.kind === "return")
    return plannedResult;
  await applyChildSessionUpdate(childSessions, dispatchPlan.bridgeUpdate, bridge);
  const dispatch = await sendToChildSession(pi, core, bridge, dispatchPlan.prompt);
  if (name === "ralph") {
    decodeCoreAck(core.call("persistRalphControllerState", [ctx]));
  }
  const finished = decodeBridgeCommandResult(core.call("finishCommandChildDispatch", [{
    result: plannedResult,
    dispatch
  }]));
  return finished;
}
function registerGatewayCommands(pi, core, childSessions, composer, childExtensionFactory) {
  if (typeof pi.registerCommand !== "function")
    return;
  pi.registerCommand("system-prompt", {
    description: "Inspect the current effective system prompt",
    handler: async (_args, ctx) => showSystemPromptInspection(ctx)
  });
  const { specs } = decodeCommandSpecsResult(core.call("commandSpecs", []));
  for (const spec of specs) {
    const name = spec.name;
    pi.registerCommand(name, {
      description: spec.description,
      handler: async (_args, ctx) => {
        const rawUi = commandContext(ctx)?.ui;
        const ui = typeof rawUi === "object" && rawUi !== null ? rawUi : undefined;
        if (name === "usage" && typeof ui?.setStatus === "function") {
          ui.setStatus.call(ui, "taumel:usage", "Fetching account usage...");
        }
        let result2;
        try {
          result2 = await executeGatewayCommand(pi, core, childSessions, composer, name, _args, ctx, childExtensionFactory);
        } finally {
          if (name === "usage" && typeof ui?.setStatus === "function") {
            ui.setStatus.call(ui, "taumel:usage", undefined);
          }
        }
        if (name === "usage") {
          const usageResult = commandResult2(result2);
          const usageDetails = usageResult?.details ?? {
            openai: {
              error: typeof usageResult?.error === "string" ? usageResult.error : "OpenAI Codex usage fetch failed",
              notConfigured: false,
              rateLimits: []
            },
            kimi: {
              error: typeof usageResult?.error === "string" ? usageResult.error : "Kimi Code usage fetch failed",
              notConfigured: false,
              rateLimits: []
            }
          };
          await showUsageInspection(usageDetails, ctx);
          return result2;
        }
        const notify4 = ui?.notify;
        const currentResult = commandResult2(result2);
        const suppressPlanNotification = name === "plan" && (typeof currentResult?.planSubmitUserMessage === "string" || currentResult?.planFollowup === true || currentResult?.planInspection === true);
        const suppressInspectionNotification = (name === "agent-runs" || name === "tasks" || name === "ps") && currentResult?.inspection === true;
        if (suppressPlanNotification || suppressInspectionNotification)
          return result2;
        const notification = decodeCommandNotificationPlan(core.call("planCommandNotification", [{
          commandName: name,
          ok: currentResult?.ok === true,
          message: typeof currentResult?.message === "string" ? currentResult.message : "",
          error: typeof currentResult?.error === "string" ? currentResult.error : "",
          uiAvailable: typeof notify4 === "function"
        }]));
        if (notification.kind === "notify" && typeof notify4 === "function") {
          notify4.call(ui, notification.message, notification.level);
        }
        return result2;
      }
    });
  }
}
function installPlanContinuationLoop(pi, core) {
  let retrying = false;
  let compacting = false;
  const observeSessionEvent = (event) => {
    if (typeof event !== "object" || event === null)
      return;
    const lifecycle = event;
    switch (lifecycle.type) {
      case "auto_retry_start":
        retrying = true;
        break;
      case "auto_retry_end":
        retrying = false;
        break;
      case "compaction_start":
        compacting = true;
        break;
      case "compaction_end":
        compacting = false;
        if (lifecycle.willRetry === true)
          retrying = true;
        break;
    }
  };
  if (typeof pi.subscribe === "function") {
    pi.subscribe(observeSessionEvent);
  }
  pi.on("input", (event, ctx) => {
    const source = typeof event === "object" && event !== null ? event.source : undefined;
    if (source !== "extension")
      core.call("clearInterruptedPlanAutomation", [ctx]);
  });
  pi.on("agent_end", async (event, ctx) => {
    try {
      observeSessionEvent(event);
      if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx))
        return;
      const stopReason = latestAssistantStopReason(event);
      if (stopReason === "aborted") {
        core.call("interruptPlanAutomation", [ctx]);
      }
      if (stopReason === "error" && typeof event === "object" && event !== null && event.willRetry === false) {
        core.call("finalizePlanError", [{ status: "blocked", ctx }]);
      }
      await sendPlanContinuation(pi, core, ctx, false, {
        hostIdle: true,
        hasPendingMessages: hasPendingMessages(ctx),
        retrying: retrying || typeof event === "object" && event !== null && event.willRetry === true,
        compacting
      }, event);
    } catch (error) {
      if (isStaleContextError(error))
        return;
      throw error;
    }
  });
}

// src/cron.ts
function canSend(pi) {
  return typeof pi.sendMessage === "function";
}
async function sendCronMessage(pi, content, deliveryKind, coalesced, details) {
  const prefix = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]
` : `[cron]
`;
  const options = deliveryKind === "trigger" ? { triggerTurn: true } : { deliverAs: "steer" };
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({
      customType: "taumel.cron.fire",
      content: `${prefix}${content}`,
      display: true,
      ...details === undefined ? {} : { details }
    }, options);
    return true;
  }
  return false;
}
async function deliverCron(pi, core, delivery, ctx, deliveryKind) {
  if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx))
    return false;
  const mode = delivery.mode;
  const content = delivery.content;
  const coalesced = delivery.coalesced;
  const cronDetails = {
    id: delivery.id,
    cron: delivery.cron,
    schedule: delivery.schedule,
    coalesced,
    prompt: content
  };
  if (mode !== "plan") {
    return sendCronMessage(pi, content, deliveryKind, coalesced, cronDetails);
  }
  const title = coalesced > 1 ? `[cron: ${coalesced} coalesced fires]
${content}` : content;
  const result2 = decodeCronPlanCreationResult(core.call("createCronPlan", [{ title, ctx }]));
  if (!result2.created) {
    return sendCronMessage(pi, content, deliveryKind, coalesced, cronDetails);
  }
  return sendCronMessage(pi, content, deliveryKind, coalesced, {
    ...cronDetails,
    planCreated: true
  });
}
function notify4(ctx, message) {
  if (typeof ctx !== "object" || ctx === null)
    return;
  const ui = ctx.ui;
  if (typeof ui !== "object" || ui === null)
    return;
  const candidate = ui;
  if (typeof candidate.notify === "function")
    candidate.notify.call(ui, message, "warning");
}
function installCronLoop(pi, core) {
  if (!canSend(pi))
    return;
  let latestCtx;
  let pollInFlight = false;
  let stopped = false;
  let generation = 0;
  const rememberCtx = (ctx) => {
    generation += 1;
    if (!contextIsLive(ctx)) {
      latestCtx = undefined;
      return false;
    }
    latestCtx = ctx;
    return true;
  };
  const poll = async (deliveryKind = "trigger") => {
    if (stopped)
      return;
    if (pollInFlight)
      return;
    pollInFlight = true;
    const ctx = latestCtx;
    const pollGeneration = generation;
    try {
      if (ctx === undefined)
        return;
      if (!extensionRuntimeIsLive(pi))
        return;
      if (!contextIsLive(ctx)) {
        if (latestCtx === ctx)
          latestCtx = undefined;
        return;
      }
      const planFacts = decodeCronPlanFacts(core.call("cronPlanFacts", [{ ctx }]));
      const planSlotFree = planFacts.planSlotFree;
      const planDriving = planFacts.planDriving;
      const plan = decodeCronPollPlan(core.call("cronPoll", [{
        now: Date.now(),
        hostIdle: typeof pi.isIdle === "function" ? pi.isIdle() : true,
        planDriving,
        planSlotFree,
        ctx
      }]));
      if (stopped || generation !== pollGeneration)
        return;
      if (plan.kind === "deliver") {
        const delivered = await deliverCron(pi, core, plan, ctx, deliveryKind);
        if (stopped || generation !== pollGeneration)
          return;
        if (!delivered)
          return;
        decodeCronDeliveredResult(core.call("cronDelivered", [{ id: plan.id, now: Date.now(), ctx }]));
      }
    } catch (error) {
      if (isStaleContextError(error)) {
        if (latestCtx === ctx)
          latestCtx = undefined;
        return;
      }
      throw error;
    } finally {
      pollInFlight = false;
    }
  };
  const timer = setInterval(() => void poll().catch((error) => console.warn("Taumel cron poll failed:", error)), 30000);
  timer.unref?.();
  pi.on("session_start", (event, ctx) => {
    if (stopped)
      return;
    if (!extensionRuntimeIsLive(pi))
      return;
    if (!rememberCtx(ctx))
      return;
    const source = typeof event === "object" && event !== null ? event : undefined;
    const reason = typeof source?.reason === "string" ? source.reason : "";
    const result2 = decodeCronStartupPlan(core.call("cronStartup", [{ reason, ctx }]));
    if (result2.kind === "notify")
      notify4(ctx, result2.message);
  });
  pi.on("turn_start", (_event, ctx) => {
    if (!stopped && extensionRuntimeIsLive(pi))
      rememberCtx(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    if (stopped)
      return;
    if (!extensionRuntimeIsLive(pi))
      return;
    rememberCtx(ctx);
    const scheduledGeneration = generation;
    setTimeout(() => {
      if (stopped || generation !== scheduledGeneration)
        return;
      poll("trigger").catch((error) => console.warn("Taumel cron agent_end poll failed:", error));
    }, 0);
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    latestCtx = undefined;
    generation += 1;
    clearInterval(timer);
  });
}

// src/skills.ts
function notificationUi(value) {
  const candidate = objectValue(value);
  return typeof candidate?.notify === "function" ? candidate : undefined;
}
function promptFromEvent(event) {
  const source = objectValue(event);
  if (source === undefined)
    return "";
  for (const key of ["text", "prompt", "content", "message", "input"]) {
    const value = source[key];
    if (typeof value === "string")
      return value;
  }
  const messages = source.messages;
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1;index >= 0; index -= 1) {
      const message = messages[index];
      const candidate = objectValue(message);
      if (candidate?.role === "user" && typeof candidate.content === "string") {
        return candidate.content;
      }
    }
  }
  return "";
}
function notifyWarnings(result2, ctx) {
  const warnings = result2.warnings;
  const context = objectValue(ctx);
  const ui = notificationUi(context?.ui);
  if (warnings.length === 0 || ui === undefined)
    return;
  for (const warning of warnings) {
    ui.notify(warning.message, "warning");
  }
}
function installSkillResolver(pi, core) {
  const bypassOnce = new Map;
  pi.on("input", async (event, ctx) => {
    const prompt = promptFromEvent(event);
    const bypassCount = bypassOnce.get(prompt) ?? 0;
    if (bypassCount > 0) {
      if (bypassCount === 1)
        bypassOnce.delete(prompt);
      else
        bypassOnce.set(prompt, bypassCount - 1);
      return { action: "continue" };
    }
    const context = objectValue(ctx);
    const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
    const result2 = decodeSkillResolveResult(core.call("resolveSkillMentions", [{ prompt, cwd, ctx }]));
    notifyWarnings(result2, ctx);
    const blocks = result2.blocks;
    if (blocks.length === 0)
      return { action: "continue" };
    if (typeof pi.sendMessage !== "function" || typeof pi.sendUserMessage !== "function") {
      return { action: "continue" };
    }
    let sentCount = 0;
    for (const block of blocks) {
      const { content, name, parent } = block;
      sentCount += 1;
      await pi.sendMessage({
        customType: "skill",
        content,
        display: true,
        details: {
          source: "auto-skill-mention",
          trigger: `$${name}`,
          name,
          ...parent === undefined ? {} : { parent }
        }
      });
    }
    if (sentCount === 0)
      return { action: "continue" };
    bypassOnce.set(prompt, (bypassOnce.get(prompt) ?? 0) + 1);
    await pi.sendUserMessage(prompt);
    return { action: "handled" };
  });
}

// src/thinking-shortcuts.ts
var thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function isThinkingLevel(value) {
  return typeof value === "string" && thinkingLevels.includes(value);
}
function currentThinkingLevel(pi) {
  const level = pi.getThinkingLevel?.();
  return isThinkingLevel(level) ? level : "off";
}
function updateFooterThinking(core, level, ctx) {
  core.call("updateFooterThinking", [level, ctx]);
}
function stepThinkingLevel(pi, core, ctx, delta) {
  if (typeof pi.setThinkingLevel !== "function")
    return;
  const before = currentThinkingLevel(pi);
  const index = thinkingLevels.indexOf(before);
  const nextIndex = Math.max(0, Math.min(thinkingLevels.length - 1, index + delta));
  pi.setThinkingLevel(thinkingLevels[nextIndex]);
  const after = currentThinkingLevel(pi);
  updateFooterThinking(core, after, ctx);
  const context = typeof ctx === "object" && ctx !== null ? ctx : undefined;
  const ui = context?.ui;
  const notify5 = ui?.notify;
  if (typeof notify5 === "function")
    notify5.call(ui, `Thinking level: ${after}`, "info");
}
function installThinkingFooterRefresh(pi, core) {
  pi.on("thinking_level_select", (event, ctx) => {
    const level = typeof event === "object" && event !== null ? event.level : undefined;
    if (isThinkingLevel(level))
      updateFooterThinking(core, level, ctx);
  });
}
function registerThinkingShortcuts(pi, core) {
  if (typeof pi.registerShortcut !== "function")
    return;
  pi.registerShortcut("alt+,", {
    description: "Decrease thinking level",
    handler: (ctx) => stepThinkingLevel(pi, core, ctx, -1)
  });
  pi.registerShortcut("shift+down", {
    description: "Decrease thinking level",
    handler: (ctx) => stepThinkingLevel(pi, core, ctx, -1)
  });
  pi.registerShortcut("alt+.", {
    description: "Increase thinking level",
    handler: (ctx) => stepThinkingLevel(pi, core, ctx, 1)
  });
  pi.registerShortcut("shift+up", {
    description: "Increase thinking level",
    handler: (ctx) => stepThinkingLevel(pi, core, ctx, 1)
  });
}

// src/index.ts
function requireCoreBootstrap(bootstrap) {
  if (!bootstrap) {
    throw new Error("taumel artifact did not export globalThis.taumel; run `npm run build:ocaml`");
  }
  if (typeof bootstrap.init !== "function") {
    throw new Error("taumel artifact did not export the core bridge; run `npm run build:ocaml`");
  }
  return bootstrap;
}
function syncSandboxToolActivation(pi, core, ctx) {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") {
    return;
  }
  const plan = decodeActiveToolsPlan(core.call("planActiveToolsSync", [{
    tools: [...pi.getActiveTools()],
    ctx
  }]));
  if (!plan.changed) {
    return;
  }
  pi.setActiveTools([...plan.tools]);
}
function installSandboxToolActivation(pi, core) {
  const sync = (_event, ctx) => syncSandboxToolActivation(pi, core, ctx);
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
  pi.on("model_select", sync);
}
function execPolicyBlockFromSettings(settings) {
  const root = objectValue(settings);
  return objectValue(root?.taumel)?.execPolicy;
}
function readExecPolicyScope(scope, path) {
  if (!existsSync2(path))
    return;
  try {
    const settings = JSON.parse(readFileSync2(path, "utf8"));
    const execPolicy = execPolicyBlockFromSettings(settings);
    return execPolicy === undefined ? undefined : { scope, execPolicy };
  } catch (error) {
    return { scope, execPolicy: `malformed settings: ${error instanceof Error ? error.message : String(error)}` };
  }
}
function notifyExecPolicyErrors(errors, ctx) {
  if (errors.length === 0)
    return;
  const ui = objectValue(objectValue(ctx)?.ui);
  const notify5 = ui?.notify;
  if (typeof notify5 !== "function")
    return;
  notify5.call(ui, `Taumel exec policy has validation errors:
${errors.join(`
`)}`, "warning");
}
function refreshExecPolicy(core, ctx) {
  const scopes = [];
  const globalScope = readExecPolicyScope("global", join5(getAgentDir4(), "settings.json"));
  if (globalScope !== undefined)
    scopes.push(globalScope);
  if (isProjectTrusted(ctx)) {
    const candidate = objectValue(ctx)?.cwd;
    const cwd = typeof candidate === "string" && candidate !== "" ? candidate : process.cwd();
    const projectScope = readExecPolicyScope("project", join5(cwd, ".pi", "settings.json"));
    if (projectScope !== undefined)
      scopes.push(projectScope);
  }
  const result2 = decodeRefreshExecPolicyResult(core.call("refreshExecPolicy", [{ scopes }]));
  notifyExecPolicyErrors(result2.errors, ctx);
}
function installExecPolicyLoader(pi, core) {
  const sync = (_event, ctx) => refreshExecPolicy(core, ctx);
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
}
function insertBeforeCurrentUserMessage(messages, message) {
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (objectValue(last)?.role === "user") {
    return [...messages.slice(0, lastIndex), message, last];
  }
  return [...messages, message];
}
function installEnvironmentContext(pi, core) {
  pi.on("context", async (event, ctx) => {
    const messages = objectValue(event)?.messages;
    if (!Array.isArray(messages))
      return;
    const plan = decodeEnvironmentContextPlan(core.call("planEnvironmentContext", [
      ctx,
      { shell: process.env.SHELL ?? "" }
    ]));
    if (plan.kind === "none")
      return;
    const message = {
      role: "custom",
      customType: plan.customType,
      content: plan.content,
      display: plan.display
    };
    return { messages: insertBeforeCurrentUserMessage(messages, message) };
  });
}
async function taumel(pi) {
  const artifact = new URL("../dist/taumel.cjs", import.meta.url);
  const require2 = createRequire2(import.meta.url);
  const photon = await import("@silvia-odwyer/photon-node");
  const globals = globalThis;
  globals.require = require2;
  globals.taumelPhoton = photon;
  require2(fileURLToPath2(artifact));
  const coreGlobal = globalThis;
  const core = requireCoreBootstrap(coreGlobal.taumel).init(makeHost(pi));
  installThinkingFooterRefresh(pi, core);
  registerThinkingShortcuts(pi, core);
  installVisibilityLifecycle(pi, core);
  const childSessions = new Map;
  const composer = await createComposerController(pi);
  installSkillAutocomplete(pi, core, composer);
  const registerChildGateway = (childPi) => registerGatewayTools(childPi, core, childSessions);
  registerGatewayTools(pi, core, childSessions);
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("skill", skillMessageRenderer());
    pi.registerMessageRenderer("taumel.cron.fire", cronFireMessageRenderer());
  }
  registerGatewayCommands(pi, core, childSessions, composer, registerChildGateway);
  installPlanContinuationLoop(pi, core);
  installCronLoop(pi, core);
  installSandboxToolActivation(pi, core);
  installExecPolicyLoader(pi, core);
  installEnvironmentContext(pi, core);
  installCompactionModelHook(pi, core);
  installSkillResolver(pi, core);
}
export {
  taumel as default
};
