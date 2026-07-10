import type {
  ChildSessionBridge,
  ComposerController,
  CoreBridge,
  PiLike,
} from "./types.ts";

import { executeComposerCommand } from "./composer.ts";
import { executeCompactionModelCommand } from "./compaction-model.ts";
import { executeCronManager } from "./cron-manager.ts";
import { initializeTaumelGlobalConfig, taumelStatus } from "./global-settings.ts";
import { executeVisibilityManager, saveProjectVisibility } from "./visibility.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  executeOpenAiUsageWithHostAuth,
  refreshOwnedChildPermissions,
  sendToChildSession,
} from "./tool-executor.ts";

import {
  childBridgeFacts,
  contextIsLive,
  contextWithOverrides,
  coreCallRecord,
  coreCallRecordArray,
  extensionRuntimeIsLive,
  isRecord,
  isStaleContextError,
  stringArrayFromUnknown,
  stringArrayField,
  stringField,
} from "./util.ts";
import { toolNames } from "./tool-contracts.ts";

function commandResultFromToolResult(core: CoreBridge, result: unknown): Record<string, unknown> {
  return coreCallRecord(core, "toolResultToCommandResult", [result], "command result conversion");
}

function hasPendingMessages(ctx: unknown): boolean {
  if (!isRecord(ctx)) return false;
  const hasPending = ctx["hasPendingMessages"];
  if (typeof hasPending !== "function") return false;
  return hasPending.call(ctx) === true;
}

function hostIdle(_ctx: unknown): boolean {
  // Pi emits agent_end before some host surfaces report idle; this lifecycle event
  // is Taumel's idle boundary for goal continuation gating.
  return true;
}

function toolNameFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (isRecord(value) && typeof value["name"] === "string" && value["name"] !== "") return value["name"];
  return undefined;
}

function liveToolNames(pi: PiLike): string[] {
  const fromRegistry =
    typeof pi.getAllTools === "function"
      ? pi.getAllTools().map(toolNameFromUnknown).filter((name): name is string => name !== undefined)
      : [];
  return [...new Set([...toolNames, ...fromRegistry])];
}

function syncActiveTools(pi: PiLike, core: CoreBridge, ctx: unknown, enabledName?: string): void {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") return;
  let current = [...pi.getActiveTools()];
  if (enabledName !== undefined && enabledName !== "" && !current.includes(enabledName) && liveToolNames(pi).includes(enabledName)) {
    current = [...current, enabledName];
    pi.setActiveTools(current);
  }
  const plan = coreCallRecord(core, "planActiveToolsSync", [current, ctx], "active tools sync plan");
  const tools = stringArrayFromUnknown(plan["tools"]);
  if (tools === undefined) throw new Error("Invalid Taumel active tools sync plan");
  if (plan["changed"] === true) pi.setActiveTools(tools);
}

function applyVisibilityCommandSideEffects(pi: PiLike, core: CoreBridge, result: unknown, ctx: unknown): void {
  if (!isRecord(result) || !isRecord(result["details"])) return;
  const details = result["details"];
  if (details["visibilityChanged"] !== true || details["category"] !== "tools") return;
  const enabledName = typeof details["enabledName"] === "string" ? details["enabledName"] : undefined;
  syncActiveTools(pi, core, ctx, enabledName);
}

function latestAssistantStopReason(event: unknown): string {
  if (!isRecord(event) || !Array.isArray(event["messages"])) return "";
  for (let index = event["messages"].length - 1; index >= 0; index -= 1) {
    const message = event["messages"][index];
    if (!isRecord(message) || message["role"] !== "assistant") continue;
    return typeof message["stopReason"] === "string" ? message["stopReason"] : "";
  }
  return "";
}

async function sendGoalMessage(
  pi: PiLike,
  customType: string,
  content: string,
  display: boolean,
  options: Record<string, unknown>,
): Promise<void> {
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType, content, display }, options);
    return;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(content, { deliverAs: options["deliverAs"] });
  }
}

async function sendVisibleGoalResult(pi: PiLike, result: Record<string, unknown>): Promise<void> {
  const message = stringField(result, "message");
  if (message === "") return;
  await sendGoalMessage(
    pi,
    "taumel.goal.summary",
    message,
    true,
    { triggerTurn: false },
  );
}

async function sendGoalContinuation(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
  initial: boolean,
  facts: Record<string, unknown>,
  event: unknown,
): Promise<void> {
  if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return;
  const plan = coreCallRecord(core, "planGoalContinuation", [initial, facts, event, ctx], "goal continuation plan");
  const action = stringField(plan, "action");
  if (action === "none") return;
  if (action !== "send_goal_continuation") {
    throw new Error("Invalid Taumel goal continuation plan");
  }
  try {
    if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return;
    await sendGoalMessage(
      pi,
      stringField(plan, "customType"),
      stringField(plan, "content"),
      plan["display"] === true,
      {
        triggerTurn: plan["triggerTurn"] === true,
        deliverAs: stringField(plan, "deliverAs"),
      },
    );
  } catch (error) {
    if (isStaleContextError(error)) return;
    throw error;
  }
}

async function executeGoalCommandSideEffects(
  pi: PiLike,
  core: CoreBridge,
  name: string,
  result: unknown,
  ctx: unknown,
): Promise<void> {
  if (name !== "goal" || !isRecord(result) || result["action"] !== "command_result") {
    return;
  }
  const startObjective =
    typeof result["goalStartObjective"] === "string" ? result["goalStartObjective"] : "";
  if (startObjective !== "") {
    try {
      if (typeof pi.sendUserMessage !== "function") {
        throw new Error("Pi sendUserMessage is unavailable");
      }
      await pi.sendUserMessage(startObjective);
    } catch (error) {
      if (isRecord(result["goalRollback"])) {
        coreCallRecord(core, "rollbackGoalCommand", [result["goalRollback"], ctx], "goal command rollback");
      }
      throw error;
    }
    return;
  }
  await sendVisibleGoalResult(pi, result);
  if (result["goalFollowup"] === true) {
    await sendGoalContinuation(pi, core, ctx, true, {
      hostIdle: true,
      hasPendingMessages: false,
      retrying: false,
      compacting: false,
    }, {});
  }
}

async function executeSelectionPrompt(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
  planMethod: string,
  finishMethod: string,
  label: string,
): Promise<unknown> {
  const finish = (selection: Record<string, unknown>) => {
    return coreCallRecord(core, finishMethod, [prompt, selection, ctx], `${label} prompt result`);
  };

  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : {};
  const select = ui["select"];
  const plan = coreCallRecord(core, planMethod, [prompt, {
    uiAvailable: typeof select === "function",
  }], `${label} prompt plan`);
  if (stringField(plan, "action") === "result") {
    const result = plan["result"];
    if (!isRecord(result)) throw new Error(`Invalid Taumel ${label} prompt result`);
    return result;
  }
  if (stringField(plan, "action") !== "select" || typeof select !== "function") {
    throw new Error(`Invalid Taumel ${label} prompt plan`);
  }
  const selected = await select.call(ui, stringField(plan, "title"), stringArrayField(plan, "labels"));
  if (selected === undefined || selected === null) {
    return finish({ status: "cancelled" });
  }

  return finish({ status: "selected", selected: String(selected) });
}

async function executePermissionsPrompt(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  return executeSelectionPrompt(core, prompt, ctx, "planPermissionsPrompt", "finishPermissionsPrompt", "permissions");
}

async function executeAgentsPrompt(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  return executeSelectionPrompt(core, prompt, ctx, "planAgentsPrompt", "finishAgentsPrompt", "agents");
}

async function executeAgentRunsPrompt(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  return executeSelectionPrompt(core, prompt, ctx, "planAgentRunsPrompt", "finishAgentRunsPrompt", "agent runs");
}

async function executeCronPrompt(
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  return executeCronManager(core, prompt, ctx);
}

async function executeVisibilityPrompt(
  pi: PiLike,
  core: CoreBridge,
  prompt: Record<string, unknown>,
  ctx: unknown,
): Promise<unknown> {
  return executeVisibilityManager(core, prompt, ctx, (enabledName) => syncActiveTools(pi, core, ctx, enabledName));
}

async function executeCommandAction(
  pi: PiLike,
  core: CoreBridge,
  result: unknown,
  ctx: unknown,
): Promise<unknown> {
  if (!isRecord(result)) return result;
  switch (stringField(result, "action")) {
    case "permissions_prompt":
      return executePermissionsPrompt(core, result, ctx);
    case "agents_prompt":
      return executeAgentsPrompt(core, result, ctx);
    case "agent_runs_prompt":
      return executeAgentRunsPrompt(core, result, ctx);
    case "cron_prompt":
      return executeCronPrompt(core, result, ctx);
    case "visibility_prompt":
      return executeVisibilityPrompt(pi, core, result, ctx);
    case "visibility_save_project": {
      const category = stringField(result, "category");
      if (category !== "agents" && category !== "tools" && category !== "skills") {
        throw new Error("Invalid Taumel visibility save category");
      }
      return saveProjectVisibility(category, stringArrayFromUnknown(result["disabled"]) ?? [], result["details"], ctx);
    }
    case "openai_usage_fetch":
      return commandResultFromToolResult(core, await executeOpenAiUsageWithHostAuth(pi, core, result, ctx));
    default:
      return result;
  }
}

async function applyChildSessionUpdatesFromCommandResult(
  childSessions: Map<string, ChildSessionBridge>,
  result: unknown,
  keyScope?: string,
): Promise<void> {
  if (!isRecord(result)) return;
  const details = isRecord(result["details"]) ? result["details"] : undefined;
  const updates = Array.isArray(details?.["childSessionUpdates"])
    ? details["childSessionUpdates"]
    : [];
  for (const update of updates) {
    if (isRecord(update)) {
      await applyChildSessionUpdate(childSessions, update, undefined, keyScope);
    }
  }
}

export async function executeGatewayCommand(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  composer: ComposerController | undefined,
  name: string,
  args: string,
  ctx: unknown,
): Promise<unknown> {
  refreshOwnedChildPermissions(childSessions, ctx);
  if (name === "taumel") {
    const trimmed = args.trim();
    if (trimmed === "") return taumelStatus();
    if (trimmed === "init") return initializeTaumelGlobalConfig();
    const message = "Usage: /taumel [init]";
    return { ok: false, action: "command_result", message, error: message, details: { ok: false, error: message } };
  }
  if (name === "composer") {
    return executeComposerCommand(core, composer, args, ctx);
  }
  if (name === "compaction-model") {
    return executeCompactionModelCommand(pi, core, args, ctx);
  }
  if (name === "execpolicy") {
    const trimmed = args.trim();
    const valid = trimmed === "" || (trimmed.startsWith("check ") && trimmed.slice("check ".length).trim() !== "");
    if (!valid) {
      const message = "Usage: /execpolicy [check <command>]";
      return { ok: false, action: "command_result", message, error: message, details: { ok: false, error: message } };
    }
  }

  const callCore = (commandCtx: unknown) => coreCallRecord(core, "handleCommand", [name, args, commandCtx], "command result");
  const plan = coreCallRecord(core, "planCommandExecution", [name, args, ctx], "command execution plan");
  if (plan["ok"] !== true) return plan;

  if (stringField(plan, "action") !== "command_child_session") {
    const result = await executeCommandAction(pi, core, callCore(ctx), ctx);
    applyVisibilityCommandSideEffects(pi, core, result, ctx);
    await applyChildSessionUpdatesFromCommandResult(
      childSessions,
      result,
      name === "agent-runs" ? childSessionCacheKeyScopeFromContext(ctx) : undefined,
    );
    await executeGoalCommandSideEffects(pi, core, name, result, ctx);
    if (name === "permissions" || name === "sandbox" || name === "approval" || name === "network") {
      refreshOwnedChildPermissions(childSessions, ctx);
    }
    return result;
  }

  const contextOverrides = isRecord(plan["contextOverrides"]) ? plan["contextOverrides"] : {};
  let commandCtx = contextWithOverrides(ctx, contextOverrides);
  const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
  const childSessionPlan = coreCallRecord(core, "planCommandChildSession", [{
    plan,
    currentActiveToolsAvailable: currentActiveToolNames !== undefined,
    currentActiveTools: currentActiveToolNames ?? [],
  }], "command child session plan");
  if (childSessionPlan["ok"] !== true) return childSessionPlan;
  const metadata = isRecord(childSessionPlan["metadata"]) ? childSessionPlan["metadata"] : {};
  const bridge = await createChildSession(pi, core, ctx, metadata);

  const childContextKey = stringField(plan, "childSessionContextKey");
  if (childContextKey !== "" && bridge?.sessionId && !bridge.cancelled && !bridge.error) {
    commandCtx = contextWithOverrides(commandCtx, { [childContextKey]: bridge.sessionId });
  }

  const result = callCore(commandCtx);
  const dispatchPlan = coreCallRecord(core, "planCommandChildDispatch", [{
    result,
    bridge: childBridgeFacts(bridge),
  }], "command child dispatch plan");
  const plannedResult = dispatchPlan["result"];
  if (!isRecord(plannedResult)) throw new Error("Invalid Taumel command child dispatch result");
  if (stringField(dispatchPlan, "action") !== "command_child_dispatch") {
    return plannedResult;
  }

  await applyChildSessionUpdate(childSessions, dispatchPlan["bridgeUpdate"], bridge);
  const dispatch = await sendToChildSession(pi, core, bridge, stringField(dispatchPlan, "prompt"));
  const finished = coreCallRecord(core, "finishCommandChildDispatch", [{
    result: plannedResult,
    dispatch,
  }], "command child dispatch result");
  return finished;
}

export function registerGatewayCommands(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  composer?: ComposerController,
): void {
  if (typeof pi.registerCommand !== "function") return;
  const specs = coreCallRecordArray(core, "commandSpecs", [], "command specs");
  for (const spec of specs) {
    const name = stringField(spec, "name");
    pi.registerCommand(name, {
      description: stringField(spec, "description"),
      handler: async (_args, ctx) => {
        const result = await executeGatewayCommand(
          pi,
          core,
          childSessions,
          composer,
          name,
          _args,
          ctx,
        );
        const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : {};
        const notify = ui["notify"];
        const notification = coreCallRecord(core, "planCommandNotification", [name, result, {
          uiAvailable: typeof notify === "function",
        }], "command notification plan");
        const action = stringField(notification, "action");
        if (action === "notify" && typeof notify === "function") {
          notify.call(
            ui,
            stringField(notification, "message"),
            stringField(notification, "level"),
          );
        } else if (action !== "unavailable") {
          throw new Error("Invalid Taumel command notification plan");
        }
        return result;
      },
    });
  }
}

export function installGoalContinuationLoop(pi: PiLike, core: CoreBridge): void {
  let retrying = false;
  let compacting = false;

  const observeSessionEvent = (event: unknown) => {
    if (!isRecord(event)) return;
    switch (event["type"]) {
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
        if (event["willRetry"] === true) retrying = true;
        break;
    }
  };

  if (typeof pi.subscribe === "function") {
    pi.subscribe(observeSessionEvent);
  }

  pi.on("agent_end", async (event, ctx) => {
    try {
      observeSessionEvent(event);
      if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return;
      const stopReason = latestAssistantStopReason(event);
      if (stopReason === "aborted") {
        core.call("interruptGoalAutomation", [ctx]);
      }
      await sendGoalContinuation(pi, core, ctx, false, {
        hostIdle: hostIdle(ctx),
        hasPendingMessages: hasPendingMessages(ctx),
        retrying: retrying || (isRecord(event) && event["willRetry"] === true),
        compacting,
      }, event);
    } catch (error) {
      if (isStaleContextError(error)) return;
      throw error;
    }
  });
}
