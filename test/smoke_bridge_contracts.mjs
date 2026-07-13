import {
  decodeActiveToolsPlan,
  decodeCommandSpecsResult,
  decodeCommandNotificationPlan,
  decodeChildSessionStartPlan,
  decodeChildDispatchPlan,
  decodeSandboxHostPathPlan,
  decodeWorkspaceMutationValidation,
  decodeExecPolicyAllowRuleResult,
  decodeExecApprovalPromptPlan,
  decodeCommandExecutionPlan,
  decodeBridgeToolResult,
  decodeBridgeToolExecutionResult,
  decodeToolResultEnvelope,
  decodeBridgeCommandResult,
  decodeViewMediaResultEnvelope,
  decodeExecToolResult,
  decodeExecApprovalResult,
  decodeCommandChildDispatchPlan,
  decodeCronGoalFacts,
  decodeCronPollPlan,
  decodeCronDeliveredResult,
  decodeCronStartupPlan,
  decodeGoalRollbackResult,
  decodeEditApplicationResult,
  decodePatchApplicationResult,
  decodeVisibilityWarningsResult,
  decodeVisibilityRowsResult,
  decodeVisibilityToggleResult,
  decodeVisibilitySavePlan,
  decodeVisibilityListResult,
  decodeCompactionCommandPlan,
  decodeCompactionSessionPlan,
  decodePermissionsPrompt,
  decodePermissionsPromptPlan,
  decodePermissionsCommandResult,
  decodeCronListResult,
  decodeCronCommandResult,
  decodeCronPrompt,
  decodeCronPromptPlan,
  decodeComposerCommandResult,
  decodeCronGoalCreationResult,
  decodeGatewayCommandOutput,
  decodePreparedToolAction,
  decodeExecNotificationClaim,
  decodeEnvironmentContextPlan,
  decodeGoalContinuationPlan,
  decodeOpenAiUsageHostAuth,
  decodeOpenAiUsageHostParams,
  decodePendingExecNotificationsResult,
  decodeRefreshExecPolicyResult,
  decodeSkillListResult,
  decodeSkillResolveResult,
  decodeThreadCatalogScansResult,
  decodeToolNamesResult,
} from "../src/bridge-contracts.ts";

const valid = decodeActiveToolsPlan({ changed: true, tools: ["read", "exec_command"] });
if (!valid.changed || valid.tools.join(",") !== "read,exec_command") {
  throw new Error(`active-tools bridge decoder changed a valid response: ${JSON.stringify(valid)}`);
}

for (const invalid of [
  null,
  {},
  { changed: "yes", tools: [] },
  { changed: false, tools: [1] },
  { changed: false, tools: [], uncontracted: true },
]) {
  let rejected = false;
  try {
    decodeActiveToolsPlan(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`active-tools bridge decoder accepted ${JSON.stringify(invalid)}`);
}

console.log("bridge contract smoke: all assertions passed");

const commandSpecs = decodeCommandSpecsResult({
  specs: [{ name: "goal", description: "Manage the active goal" }],
});
if (commandSpecs.specs[0]?.name !== "goal") throw new Error("command specs did not decode");
for (const invalid of [
  [],
  { specs: [{ name: "", description: "bad" }] },
  { specs: [{ name: "goal" }] },
  { specs: [], extra: true },
]) {
  let rejected = false;
  try {
    decodeCommandSpecsResult(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`command-specs bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const names = decodeToolNamesResult({ names: ["read", "exec_command"] });
if (names.names.length !== 2) throw new Error("tool names did not decode");
for (const invalid of [{ names: [""] }, { names: [1] }, ["read"]]) {
  let rejected = false;
  try {
    decodeToolNamesResult(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`tool-names bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const scans = decodeThreadCatalogScansResult({
  scans: [{ root: "/repo", maxDepth: 3, maxFiles: 100, suffix: ".jsonl" }],
});
if (scans.scans[0]?.root !== "/repo") throw new Error("thread catalog scans did not decode");
for (const invalid of [
  [],
  { scans: [{ root: "", maxDepth: 3, maxFiles: 100, suffix: ".jsonl" }] },
  { scans: [{ root: "/repo", maxDepth: -1, maxFiles: 100, suffix: ".jsonl" }] },
  { scans: [{ root: "/repo", maxDepth: 3, maxFiles: 0, suffix: ".jsonl" }] },
]) {
  let rejected = false;
  try {
    decodeThreadCatalogScansResult(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`thread-catalog bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const pending = decodePendingExecNotificationsResult({
  notifications: [{ sessionId: 7, customType: "notification", content: "done", display: true }],
});
if (pending.notifications[0]?.sessionId !== 7) throw new Error("pending exec notification did not decode");
const claimed = decodeExecNotificationClaim({
  kind: "claimed",
  sessionId: 7,
  customType: "notification",
  content: "done",
  display: true,
});
if (claimed.kind !== "claimed" || claimed.content !== "done") throw new Error("exec claim did not decode");
if (decodeExecNotificationClaim({ kind: "unavailable" }).kind !== "unavailable") {
  throw new Error("unavailable exec claim did not decode");
}
for (const invalid of [
  { notifications: [{ sessionId: -1, customType: "notification", content: "done", display: true }] },
  { kind: "claimed", sessionId: 7 },
  { kind: "other" },
  { kind: "unavailable", content: "unexpected" },
]) {
  let rejected = false;
  try {
    if ("notifications" in invalid) decodePendingExecNotificationsResult(invalid);
    else decodeExecNotificationClaim(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`exec-notification bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const usageAuth = decodeOpenAiUsageHostAuth({
  providerKey: "openai-codex",
  credentialKey: "openai-codex",
  source: "host",
});
if (usageAuth.providerKey !== "openai-codex") throw new Error("usage auth did not decode");
for (const value of [
  { apiKeyPresent: false, tokenState: "missing" },
  { apiKeyPresent: false, tokenState: "present", token: "token" },
  { apiKeyPresent: false, tokenState: "error", tokenError: "failed" },
]) {
  if (decodeOpenAiUsageHostParams(value).tokenState !== value.tokenState) {
    throw new Error("usage host params did not decode");
  }
}
for (const invalid of [
  { providerKey: "", credentialKey: "x", source: "host" },
  { apiKeyPresent: false, tokenState: "present" },
  { apiKeyPresent: false, tokenState: "missing", token: "unexpected" },
  { apiKeyPresent: false, tokenState: "unknown" },
]) {
  let rejected = false;
  try {
    if ("providerKey" in invalid) decodeOpenAiUsageHostAuth(invalid);
    else decodeOpenAiUsageHostParams(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`usage bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const policy = decodeRefreshExecPolicyResult({
  ok: true,
  activeRuleCount: 2,
  scopes: ["global"],
  errors: [],
});
if (policy.activeRuleCount !== 2) throw new Error("exec policy result did not decode");
for (const invalid of [
  { ok: true, activeRuleCount: -1, scopes: [], errors: [] },
  { ok: true, activeRuleCount: 0, scopes: [1], errors: [] },
  { ok: true, activeRuleCount: 0, scopes: [], errors: [], extra: true },
]) {
  let rejected = false;
  try {
    decodeRefreshExecPolicyResult(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`exec-policy bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const skillList = decodeSkillListResult({
  skills: [{ name: "review", location: "/skills/review.md", baseDir: "/skills", description: "Review code" }],
});
if (skillList.skills[0]?.name !== "review") throw new Error("skill list did not decode");
const skillResolution = decodeSkillResolveResult({
  blocks: [{ name: "review", location: "/skills/review.md", baseDir: "/skills", content: "Review this" }],
  warnings: [{ message: "warning" }],
});
if (skillResolution.blocks[0]?.content !== "Review this") throw new Error("skill resolution did not decode");
for (const invalid of [
  { skills: [{ name: "", location: "/x", baseDir: "/", description: "" }] },
  { blocks: [{ name: "x", location: "/x", baseDir: "/", content: "" }], warnings: [] },
  { blocks: [], warnings: [{ message: "" }] },
]) {
  let rejected = false;
  try {
    if ("skills" in invalid) decodeSkillListResult(invalid);
    else decodeSkillResolveResult(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`skill bridge decoder accepted ${JSON.stringify(invalid)}`);
}

if (decodeEnvironmentContextPlan({ kind: "none" }).kind !== "none") {
  throw new Error("empty environment-context plan did not decode");
}
const environmentPlan = decodeEnvironmentContextPlan({
  kind: "inject", customType: "taumel.environment_context", content: "<environment/>", display: false,
});
if (environmentPlan.kind !== "inject" || environmentPlan.content !== "<environment/>") {
  throw new Error("environment-context injection did not decode");
}
for (const invalid of [
  { kind: "none", content: "unexpected" },
  { kind: "inject", customType: "", content: "x", display: false },
  { kind: "inject", customType: "x", content: "", display: false },
]) {
  let rejected = false;
  try { decodeEnvironmentContextPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`environment-context bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const notifyPlan = decodeCommandNotificationPlan({ kind: "notify", message: "Done", level: "info" });
if (notifyPlan.kind !== "notify" || notifyPlan.message !== "Done") {
  throw new Error("command notification did not decode");
}
if (decodeCommandNotificationPlan({ kind: "unavailable" }).kind !== "unavailable") {
  throw new Error("unavailable command notification did not decode");
}
for (const invalid of [
  { kind: "notify", message: "", level: "info" },
  { kind: "notify", message: "Done", level: "error" },
  { kind: "unavailable", message: "unexpected" },
]) {
  let rejected = false;
  try { decodeCommandNotificationPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`command-notification bridge decoder accepted ${JSON.stringify(invalid)}`);
}

if (decodeGoalContinuationPlan({ kind: "none" }).kind !== "none") {
  throw new Error("empty goal continuation did not decode");
}
const continuation = decodeGoalContinuationPlan({
  kind: "send", customType: "taumel.goal.continue", content: "Continue", display: true,
  triggerTurn: true, deliverAs: "followUp", details: { goal: { objective: "ship" } },
});
if (continuation.kind !== "send" || continuation.content !== "Continue") {
  throw new Error("goal continuation did not decode");
}
for (const invalid of [
  { kind: "none", content: "unexpected" },
  { kind: "send", customType: "", content: "Continue", display: false, triggerTurn: true, deliverAs: "followUp" },
  { kind: "send", customType: "goal", content: "", display: false, triggerTurn: true, deliverAs: "followUp" },
]) {
  let rejected = false;
  try { decodeGoalContinuationPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`goal-continuation bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const childStart = decodeChildSessionStartPlan({
  parentSession: "parent", modelId: "openai/gpt", thinkingLevel: "high",
  activeTools: ["read"], setupEntries: [{ customType: "taumel.childSession", data: { kind: "ralph" } }],
});
if (childStart.activeTools?.[0] !== "read") throw new Error("child-session start plan did not decode");
for (const invalid of [
  { activeTools: [""], setupEntries: [] },
  { activeTools: [1], setupEntries: [] },
  { setupEntries: [{ customType: "", data: {} }] },
  { setupEntries: [], extra: true },
]) {
  let rejected = false;
  try { decodeChildSessionStartPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`child-session start bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const childDispatch = decodeChildDispatchPlan({
  send: true, prompt: "Continue", deliverAs: "followUp", result: { dispatched: true, sessionId: "child" },
});
if (!childDispatch.send || childDispatch.prompt !== "Continue") {
  throw new Error("child dispatch did not decode");
}
for (const invalid of [
  { send: true, prompt: "Continue", result: {} },
  { send: "yes", prompt: "Continue", deliverAs: "followUp", result: {} },
  { send: false, prompt: "", deliverAs: "", result: {}, extra: true },
  { send: false, prompt: "", deliverAs: "followUp", result: { dispatched: false, completion: { status: "pending" } } },
]) {
  let rejected = false;
  try { decodeChildDispatchPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`child-dispatch bridge decoder accepted ${JSON.stringify(invalid)}`);
}

const hostPaths = decodeSandboxHostPathPlan({
  tempRootCandidates: ["/tmp"], systemRoPathCandidates: ["/usr"],
});
if (hostPaths.tempRootCandidates[0] !== "/tmp") throw new Error("sandbox host paths did not decode");
for (const invalid of [
  { tempRootCandidates: [""], systemRoPathCandidates: ["/usr"] },
  { tempRootCandidates: ["/tmp"], systemRoPathCandidates: [1] },
  { tempRootCandidates: [], systemRoPathCandidates: [], extra: true },
]) {
  let rejected = false;
  try { decodeSandboxHostPathPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`sandbox-host-path bridge decoder accepted ${JSON.stringify(invalid)}`);
}

if (decodeWorkspaceMutationValidation({ kind: "valid" }).kind !== "valid") {
  throw new Error("valid workspace mutation response did not decode");
}
const invalidMutation = decodeWorkspaceMutationValidation({ kind: "invalid", message: "outside workspace" });
if (invalidMutation.kind !== "invalid" || invalidMutation.message !== "outside workspace") {
  throw new Error("invalid workspace mutation response did not decode");
}
for (const invalid of [
  { kind: "valid", message: "unexpected" },
  { kind: "invalid", message: "" },
  { kind: "error", message: "outside workspace" },
]) {
  let rejected = false;
  try { decodeWorkspaceMutationValidation(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`workspace-mutation bridge decoder accepted ${JSON.stringify(invalid)}`);
}

if (decodeExecPolicyAllowRuleResult({ activeRuleCount: 3 }).activeRuleCount !== 3) {
  throw new Error("exec-policy amendment did not decode");
}
for (const invalid of [
  { activeRuleCount: -1 }, { activeRuleCount: 1.5 },
  { activeRuleCount: 1, extra: true },
]) {
  let rejected = false;
  try { decodeExecPolicyAllowRuleResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`exec-policy amendment decoder accepted ${JSON.stringify(invalid)}`);
}

if (decodeExecApprovalPromptPlan({ kind: "unavailable" }).kind !== "unavailable") {
  throw new Error("unavailable exec approval did not decode");
}
const approvalPrompt = decodeExecApprovalPromptPlan({
  kind: "confirm", title: "Approve", prompt: "Run command?", timeoutMs: 30000,
});
if (approvalPrompt.kind !== "confirm" || approvalPrompt.timeoutMs !== 30000) {
  throw new Error("exec approval prompt did not decode");
}
for (const invalid of [
  { kind: "unavailable", title: "unexpected" },
  { kind: "confirm", title: "Approve", prompt: "Run?", timeoutMs: 0 },
  { kind: "confirm", title: "Approve" },
]) {
  let rejected = false;
  try { decodeExecApprovalPromptPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`exec-approval prompt decoder accepted ${JSON.stringify(invalid)}`);
}

if (decodeCommandExecutionPlan({ kind: "direct" }).kind !== "direct") {
  throw new Error("direct command plan did not decode");
}
const childCommand = decodeCommandExecutionPlan({
  kind: "child", metadata: {
    kind: "ralph", objective: "Finish task", controllerSessionId: "parent",
    maxIterations: null, reflectionEvery: null,
  },
  contextOverrides: [{ name: "taumelControllerSessionId", value: "parent" }],
  activeToolsMode: "current", childSessionContextKey: "ralphSessionId",
});
if (childCommand.kind !== "child" || childCommand.contextOverrides[0]?.value !== "parent") {
  throw new Error("child command plan did not decode");
}
for (const invalid of [
  { kind: "error", message: "" },
  { kind: "direct", extra: true },
  { kind: "child", metadata: {}, contextOverrides: [{ name: "", value: "x" }], activeToolsMode: "current", childSessionContextKey: "key" },
]) {
  let rejected = false;
  try { decodeCommandExecutionPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`command-execution decoder accepted ${JSON.stringify(invalid)}`);
}

const bridgeToolResult = decodeBridgeToolResult({
  ok: true, action: "tool_result", text: "Usage", details: { account: "default" },
});
if (bridgeToolResult.text !== "Usage") throw new Error("bridge tool result did not decode");
for (const invalid of [
  { ok: false, action: "tool_result", text: "Usage", details: {} },
  { ok: true, action: "command_result", text: "Usage", details: {} },
  { ok: true, action: "tool_result", text: "Usage", details: {}, extra: true },
]) {
  let rejected = false;
  try { decodeBridgeToolResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`bridge-tool-result decoder accepted ${JSON.stringify(invalid)}`);
}
const bridgeError = decodeBridgeToolExecutionResult({ ok: false, error: "gateway denied" });
if (bridgeError.ok || bridgeError.error !== "gateway denied") {
  throw new Error("bridge execution error did not decode");
}
for (const invalid of [
  { ok: false, error: "" },
  { ok: false, error: "denied", details: {} },
  { ok: true, action: "tool_result", text: "missing details" },
]) {
  let rejected = false;
  try { decodeBridgeToolExecutionResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`bridge-tool-execution decoder accepted ${JSON.stringify(invalid)}`);
}
const envelope = decodeToolResultEnvelope({
  content: [{ type: "text", text: "done" }], details: { ok: true },
});
if (envelope.content[0]?.text !== "done") throw new Error("tool-result envelope did not decode");
for (const invalid of [
  { content: [], details: {} },
  { content: [{ type: "image", text: "done" }], details: {} },
  { content: [{ type: "text", text: "done", extra: true }], details: {} },
]) {
  let rejected = false;
  try { decodeToolResultEnvelope(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`tool-result envelope decoder accepted ${JSON.stringify(invalid)}`);
}
const commandResult = decodeBridgeCommandResult({
  ok: true, action: "command_result", message: "done", details: { id: 1 },
});
if (!commandResult.ok || commandResult.message !== "done") throw new Error("command result did not decode");
for (const invalid of [
  { ok: true, action: "tool_result", message: "done", details: {} },
  { ok: "yes", action: "command_result", message: "done", details: {} },
  { ok: true, action: "command_result", message: "done", details: {}, extra: true },
]) {
  let rejected = false;
  try { decodeBridgeCommandResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`bridge-command-result decoder accepted ${JSON.stringify(invalid)}`);
}
const mediaResult = decodeViewMediaResultEnvelope({
  content: [
    { type: "text", text: "Viewed image" },
    { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
  ],
  details: { ok: true },
});
if (mediaResult.content[1]?.type !== "image") throw new Error("view-media result did not decode");
for (const invalid of [
  { content: [{ type: "image", data: "", mimeType: "image/png" }], details: {} },
  { content: [{ type: "image", data: "abc", mimeType: "text/plain" }], details: {} },
  { content: [{ type: "video", data: "abc", mimeType: "image/png" }], details: {} },
]) {
  let rejected = false;
  try { decodeViewMediaResultEnvelope(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`view-media decoder accepted ${JSON.stringify(invalid)}`);
}
const execResultFixture = {
  content: [{ type: "text", text: "done" }],
  details: {
    ok: true, output: "done", stdout: "done", stderr: "", wallTimeMs: 12,
    outputMode: "delta", suppressedLines: 0, suppressedBytes: 0,
    truncation: {
      truncated: false, truncatedBy: "none", totalLines: 1, totalBytes: 4,
      outputLines: 1, outputBytes: 4, maxLines: 2000, maxBytes: 50000,
      lastLinePartial: false, firstLineExceedsLimit: false,
    },
  },
};
if (!decodeExecToolResult(execResultFixture).details.ok) throw new Error("exec result did not decode");
for (const invalid of [
  { ...execResultFixture, details: { ...execResultFixture.details, session_id: "1" } },
  { ...execResultFixture, details: { ...execResultFixture.details, extra: true } },
  { ...execResultFixture, details: { ...execResultFixture.details, truncation: {} } },
]) {
  let rejected = false;
  try { decodeExecToolResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`exec-result decoder accepted ${JSON.stringify(invalid)}`);
}
if (decodeExecApprovalResult({ kind: "run", forceUnsandboxed: true }).kind !== "run") {
  throw new Error("granted exec approval did not decode");
}
const deniedExec = decodeExecApprovalResult({
  kind: "denied", result: { content: [{ type: "text", text: "denied" }], details: { ok: false } },
});
if (deniedExec.kind !== "denied") throw new Error("denied exec approval did not decode");
for (const invalid of [
  { kind: "run", forceUnsandboxed: false },
  { kind: "denied", result: { content: [], details: {} } },
  { kind: "denied", result: { content: [{ type: "text", text: "no" }], details: {} }, extra: true },
]) {
  let rejected = false;
  try { decodeExecApprovalResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`exec-approval result decoder accepted ${JSON.stringify(invalid)}`);
}
const childDispatchResult = {
  ok: true, action: "command_result", message: "started", details: { taskId: "task-1" },
};
const commandDispatch = decodeCommandChildDispatchPlan({
  kind: "dispatch", result: childDispatchResult,
  bridgeUpdate: { action: "set", key: "task-1" }, prompt: "work",
});
if (commandDispatch.kind !== "dispatch" || commandDispatch.prompt !== "work") {
  throw new Error("command child dispatch did not decode");
}
for (const invalid of [
  { kind: "return", result: { ...childDispatchResult, action: "tool_result" } },
  { kind: "dispatch", result: childDispatchResult, bridgeUpdate: { action: "", key: "task" }, prompt: "work" },
  { kind: "dispatch", result: childDispatchResult, bridgeUpdate: { action: "set", key: "task" }, prompt: "" },
]) {
  let rejected = false;
  try { decodeCommandChildDispatchPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`command-child-dispatch decoder accepted ${JSON.stringify(invalid)}`);
}
const cronGoalFacts = decodeCronGoalFacts({ goalSlotFree: true, goalDriving: false });
if (!cronGoalFacts.goalSlotFree || cronGoalFacts.goalDriving) throw new Error("cron goal facts did not decode");
const cronDelivery = decodeCronPollPlan({
  kind: "deliver", id: "task-1", mode: "message", content: "check status",
  coalesced: 2, cron: "*/5 * * * *", schedule: "every five minutes",
});
if (cronDelivery.kind !== "deliver" || cronDelivery.coalesced !== 2) {
  throw new Error("cron delivery did not decode");
}
for (const invalid of [
  { kind: "none", extra: true },
  { kind: "deliver", id: "task", mode: "other", content: "run", coalesced: 1, cron: "* * * * *", schedule: "" },
  { kind: "deliver", id: "task", mode: "goal", content: "run", coalesced: 0, cron: "* * * * *", schedule: "" },
]) {
  let rejected = false;
  try { decodeCronPollPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`cron-poll decoder accepted ${JSON.stringify(invalid)}`);
}
if (!decodeCronDeliveredResult({ acknowledged: true }).acknowledged) {
  throw new Error("cron delivery acknowledgement did not decode");
}
const cronStartup = decodeCronStartupPlan({ kind: "notify", message: "Cron disabled." });
if (cronStartup.kind !== "notify") throw new Error("cron startup notification did not decode");
for (const invalid of [
  { kind: "none", message: "unexpected" },
  { kind: "notify", message: "" },
  { kind: "notification", message: "Cron disabled." },
]) {
  let rejected = false;
  try { decodeCronStartupPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`cron-startup decoder accepted ${JSON.stringify(invalid)}`);
}
if (!decodeGoalRollbackResult({ completed: true }).completed) {
  throw new Error("goal rollback did not decode");
}
for (const invalid of [{ completed: false }, {}, { completed: true, extra: true }]) {
  let rejected = false;
  try { decodeGoalRollbackResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`goal-rollback decoder accepted ${JSON.stringify(invalid)}`);
}
const editApplied = decodeEditApplicationResult({
  kind: "applied", path: "/tmp/a", displayPath: "a", contents: "next", editCount: 1,
});
if (editApplied.kind !== "applied" || editApplied.editCount !== 1) throw new Error("edit result did not decode");
const patchApplied = decodePatchApplicationResult({
  kind: "applied", deletes: ["old"], writes: [{ path: "new", contents: "text" }], affectedPaths: ["old", "new"],
});
if (patchApplied.kind !== "applied" || patchApplied.writes[0]?.path !== "new") throw new Error("patch result did not decode");
for (const invalid of [
  { kind: "error", message: "" },
  { kind: "applied", path: "a", displayPath: "a", contents: "", editCount: 0 },
  { kind: "applied", deletes: [], writes: [{ path: "", contents: "" }], affectedPaths: [] },
]) {
  let rejected = false;
  try { decodeEditApplicationResult(invalid); decodePatchApplicationResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`mutation decoder accepted ${JSON.stringify(invalid)}`);
}
const warnings = decodeVisibilityWarningsResult({ messages: ["Tool unavailable"] });
if (warnings.messages[0] !== "Tool unavailable") throw new Error("visibility warnings did not decode");
for (const invalid of [
  { messages: [""] }, { messages: [1] }, { messages: [], extra: true },
]) {
  let rejected = false;
  try { decodeVisibilityWarningsResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`visibility-warnings decoder accepted ${JSON.stringify(invalid)}`);
}
const visibilityRows = decodeVisibilityRowsResult({
  category: "tools", title: "Taumel tools",
  rows: [{ name: "read", state: "enabled", available: true, description: "pure" }],
  disabled: [], unavailable: [],
});
if (visibilityRows.rows[0]?.name !== "read") throw new Error("visibility rows did not decode");
for (const invalid of [
  { category: "other", title: "Other", rows: [], disabled: [], unavailable: [] },
  { category: "tools", title: "", rows: [], disabled: [], unavailable: [] },
  { category: "tools", title: "Tools", rows: [{ name: "", state: "enabled", available: true, description: "" }], disabled: [], unavailable: [] },
]) {
  let rejected = false;
  try { decodeVisibilityRowsResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`visibility-rows decoder accepted ${JSON.stringify(invalid)}`);
}
const toggleDetails = {
  category: "tools", title: "Taumel tools", rows: [], disabled: ["exec_command"],
  unavailable: [], visibilityChanged: true, disabledName: "exec_command",
};
const toggle = decodeVisibilityToggleResult({
  ok: true, action: "command_result", message: "Tool disabled.", details: toggleDetails,
});
if (!toggle.ok || toggle.details.disabledName !== "exec_command") {
  throw new Error("visibility toggle did not decode");
}
for (const invalid of [
  { ok: true, action: "command_result", message: "done", details: { ...toggleDetails, visibilityChanged: false } },
  { ok: false, action: "command_result", message: "unknown", error: "unknown", details: toggleDetails },
  { ok: true, action: "command_result", message: "done", details: toggleDetails, extra: true },
]) {
  let rejected = false;
  try { decodeVisibilityToggleResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`visibility-toggle decoder accepted ${JSON.stringify(invalid)}`);
}
const visibilityDetails = {
  category: "tools", title: "Taumel tools", rows: [], disabled: ["exec_command"], unavailable: [],
};
const saveVisibility = decodeVisibilitySavePlan({
  ok: true, action: "visibility_save_project", category: "tools",
  disabled: ["exec_command"], details: visibilityDetails,
});
const listVisibility = decodeVisibilityListResult({
  ok: true, action: "command_result", message: "Tools listed.", details: visibilityDetails,
});
if (saveVisibility.category !== "tools" || !listVisibility.ok) throw new Error("visibility save/list did not decode");
for (const invalid of [
  { ok: true, action: "visibility_save_project", category: "tools", disabled: [""], details: visibilityDetails },
  { ok: true, action: "command_result", message: "listed" },
  { ok: true, action: "visibility_save_project", category: "other", disabled: [], details: visibilityDetails },
]) {
  let rejected = false;
  try { decodeVisibilitySavePlan(invalid); decodeVisibilityListResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`visibility save/list decoder accepted ${JSON.stringify(invalid)}`);
}
const compactPlan = decodeCompactionSessionPlan({ kind: "compact", model: "openai/gpt-4.1" });
if (compactPlan.kind !== "compact") throw new Error("compaction session plan did not decode");
const showCompaction = decodeCompactionCommandPlan({ kind: "show", model: "", source: "inherited" });
if (showCompaction.kind !== "show") throw new Error("compaction command plan did not decode");
for (const invalid of [
  { kind: "compact", model: "" },
  { kind: "error", message: "" },
  { kind: "set_project", model: "", extra: true },
]) {
  let rejected = false;
  try { decodeCompactionCommandPlan(invalid); decodeCompactionSessionPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`compaction decoder accepted ${JSON.stringify(invalid)}`);
}
const permissionsPrompt = decodePermissionsPrompt({
  ok: true, action: "permissions_prompt", title: "Permissions", message: "Current",
  options: [{ label: "Read only", value: "read-only", description: "Safe", selected: true }],
});
const permissionsPlan = decodePermissionsPromptPlan({
  kind: "select", title: "Permissions", labels: ["Read only"],
});
if (permissionsPrompt.options.length !== 1 || permissionsPlan.kind !== "select") {
  throw new Error("permissions prompt did not decode");
}
if (!decodePermissionsCommandResult({ ok: true, action: "command_result", message: "Updated" }).ok) {
  throw new Error("permissions command result did not decode");
}
for (const invalid of [
  { kind: "select", title: "Permissions", labels: [] },
  { kind: "result", result: { ok: true, action: "tool_result", message: "Updated" } },
  { ok: true, action: "permissions_prompt", title: "", message: "", options: [] },
]) {
  let rejected = false;
  try { decodePermissionsPromptPlan(invalid); decodePermissionsPrompt(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`permissions prompt decoder accepted ${JSON.stringify(invalid)}`);
}
const cronList = decodeCronListResult({
  ok: true, action: "tool_result", text: "Cron tasks listed.",
  details: {
    enabled: true,
    tasks: [{ id: "task-1", schedule: "every minute", cron: "* * * * *", prompt: "check",
      recurring: true, mode: "message", enabled: true, nextDue: 1, nextDueText: "soon", pending: false }],
  },
});
if (cronList.details.tasks[0]?.mode !== "message") throw new Error("cron list did not decode");
for (const invalid of [
  { ok: true, action: "tool_result", text: "list", details: { enabled: true, tasks: [{ id: "", schedule: "", cron: "*", prompt: "", recurring: true, mode: "message", enabled: true, nextDue: 1, nextDueText: "", pending: false }] } },
  { ok: true, action: "tool_result", text: "list", details: { enabled: true, tasks: [{ id: "task", schedule: "", cron: "*", prompt: "", recurring: true, mode: "prompt", enabled: true, nextDue: 1, nextDueText: "", pending: false }] } },
]) {
  let rejected = false;
  try { decodeCronListResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`cron-list decoder accepted ${JSON.stringify(invalid)}`);
}
const cronCommand = decodeCronCommandResult({
  ok: true, action: "command_result", message: "Cron enabled.", details: { enabled: true },
});
if (!cronCommand.ok) throw new Error("cron command did not decode");
for (const invalid of [
  { ok: true, action: "tool_result", message: "Cron enabled.", details: {} },
  { ok: false, action: "command_result", message: "failed" },
  { ok: true, action: "command_result", message: "done", details: {}, extra: true },
]) {
  let rejected = false;
  try { decodeCronCommandResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`cron-command decoder accepted ${JSON.stringify(invalid)}`);
}
const cronPrompt = decodeCronPrompt({ ok: true, action: "cron_prompt", enabled: false, tasks: [] });
const cronPromptPlan = decodeCronPromptPlan({
  kind: "result", result: { ok: true, action: "command_result", message: "No cron tasks.", details: { tasks: [] } },
});
if (cronPrompt.enabled || cronPromptPlan.kind !== "result") throw new Error("cron prompt did not decode");
for (const invalid of [
  { ok: true, action: "cron_prompt", enabled: false },
  { kind: "result", result: { ok: true, action: "command_result", message: "No cron tasks." } },
  { kind: "select", labels: [] },
]) {
  let rejected = false;
  try { decodeCronPrompt(invalid); decodeCronPromptPlan(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`cron-prompt decoder accepted ${JSON.stringify(invalid)}`);
}
const composerResult = decodeComposerCommandResult({
  kind: "result", message: "Composer disabled.",
  settings: { taumel: { composer: { enabled: false } } }, writeSettings: true,
});
if (composerResult.kind !== "result" || composerResult.settings.taumel.composer.enabled) {
  throw new Error("composer command did not decode");
}
for (const invalid of [
  { kind: "error", message: "" },
  { kind: "result", message: "done", settings: { taumel: { composer: { enabled: "yes" } } }, writeSettings: true },
  { kind: "result", message: "done", settings: { taumel: { composer: { enabled: true }, extra: true } }, writeSettings: false },
]) {
  let rejected = false;
  try { decodeComposerCommandResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`composer-command decoder accepted ${JSON.stringify(invalid)}`);
}
if (!decodeCronGoalCreationResult({ created: true }).created) {
  throw new Error("cron goal creation did not decode");
}
for (const invalid of [{ created: "yes" }, {}, { created: false, extra: true }]) {
  let rejected = false;
  try { decodeCronGoalCreationResult(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`cron-goal-creation decoder accepted ${JSON.stringify(invalid)}`);
}
const gatewayCommand = decodeGatewayCommandOutput({
  ok: true, action: "command_result", message: "Done.", details: { ok: true },
});
if (!("action" in gatewayCommand) || gatewayCommand.action !== "command_result") {
  throw new Error("gateway command did not decode");
}
for (const invalid of [
  { ok: false, error: "", extra: true },
  { ok: true, action: "unknown", message: "Done." },
  { ok: true, action: "visibility_prompt", category: "other", title: "Other" },
]) {
  let rejected = false;
  try { decodeGatewayCommandOutput(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`gateway-command decoder accepted ${JSON.stringify(invalid)}`);
}
const preparedRead = decodePreparedToolAction({ ok: true, action: "read", path: "README.md", limit: 10 });
const preparedExec = decodePreparedToolAction({
  ok: true, action: "exec_command", cmd: "pwd", workdir: "", tty: false,
  sandbox: { filesystemMode: "workspace-write", networkMode: "disabled", workspaceRoots: ["/workspace"], noSandbox: false, isolatedChild: false },
});
const preparedExecWithYield = decodePreparedToolAction({
  ok: true, action: "exec_command", cmd: "pwd", workdir: "", yieldTimeMs: 250, tty: false,
  sandbox: { filesystemMode: "workspace-write", networkMode: "disabled", workspaceRoots: ["/workspace"], noSandbox: false, isolatedChild: false },
});
const preparedExa = decodePreparedToolAction({
  ok: true, action: "exa_fetch", toolName: "web_search_exa", method: "POST", path: "/search",
  bodyJson: '{"query":"test"}',
});
const preparedExaApproval = decodePreparedToolAction({
  ok: true, action: "exa_agent_create_run_approval", toolName: "exa_agent_create_run",
  method: "POST", path: "/agent/runs", bodyJson: '{"query":"test"}',
  approvalTitle: "Approve Exa Agent run", approvalPrompt: "Create run?", approvalTimeoutMs: 30000,
});
if (!("action" in preparedRead) || preparedRead.action !== "read" || !("action" in preparedExec) || !("action" in preparedExecWithYield) || preparedExa.action !== "exa_fetch" || preparedExaApproval.action !== "exa_agent_create_run_approval") {
  throw new Error("prepared tool action did not decode");
}
for (const invalid of [
  { ok: true, action: "read", path: "", extra: true },
  { ok: true, action: "write_stdin", sessionId: 0, chars: "", outputMode: "delta" },
  { ok: true, action: "exec_command", cmd: "pwd", workdir: "", tty: false, sandbox: { filesystemMode: "workspace-write" } },
  { ok: true, action: "exec_command", cmd: "pwd", workdir: "", yieldTimeMs: null, tty: false, sandbox: { filesystemMode: "workspace-write", networkMode: "disabled", workspaceRoots: ["/workspace"], noSandbox: false, isolatedChild: false } },
  { ok: true, action: "exa_fetch", toolName: "web_search_exa", method: "POST", path: "/search", apiKeyPresent: true },
  { ok: true, action: "exa_agent_create_run_approval", toolName: "exa_agent_create_run", method: "POST", path: "/agent/runs", approvalTitle: "Approve", approvalPrompt: "Create?", approvalTimeoutMs: 30000, apiKeyPresent: true },
  { ok: true, action: "unregistered" },
]) {
  let rejected = false;
  try { decodePreparedToolAction(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error(`prepared-tool decoder accepted ${JSON.stringify(invalid)}`);
}
