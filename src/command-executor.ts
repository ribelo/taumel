import type {
  ChildSessionBridge,
  ComposerController,
  CoreBridge,
  MessageDeliveryOptions,
  PiLike,
} from "./types.ts";

import { executeComposerCommand } from "./composer.ts";
import { executeCompactionModelCommand } from "./compaction-model.ts";
import { executeCronManager } from "./cron-manager.ts";
import { initializeTaumelGlobalConfig, taumelStatus } from "./global-settings.ts";
import { executeVisibilityManager, saveProjectVisibility } from "./visibility.ts";
import {
  applyChildSessionUpdate,
  createChildSession,
  executeOpenAiUsageWithHostAuth,
  refreshOwnedChildPermissions,
  sendToChildSession,
} from "./tool-executor.ts";

import {
  childBridgeFacts,
  contextIsLive,
  contextWithOverrides,
  extensionRuntimeIsLive,
  isStaleContextError,
  liveToolNames,
} from "./util.ts";
import { toolNames } from "./tool-contracts.ts";
import { decodeActiveToolsPlan, decodeCommandChildSessionPlan, decodeCommandExecutionPlan, decodeCommandNotificationPlan, decodeCommandSpecsResult } from "./bridge-contracts.ts";
import { decodeBridgeCommandResult, decodeCommandChildDispatchPlan, decodeGatewayCommandOutput, decodeGoalContinuationPlan, decodeGoalRollbackResult, decodePermissionsCommandResult, decodePermissionsPrompt, decodePermissionsPromptPlan, type GatewayCommandOutput, type GoalContinuationFacts, type ToolResultEnvelope } from "./bridge-contracts.ts";

type CommandContext = { readonly hasPendingMessages?: () => unknown; readonly ui?: unknown };
type CommandUi = {
  readonly notify?: (message: string, level: string) => unknown;
  readonly select?: (title: string, labels: readonly string[]) => unknown;
};
type AssistantMessage = { readonly role?: unknown; readonly stopReason?: unknown };
type AssistantEvent = { readonly messages?: unknown; readonly willRetry?: unknown };
type CommandResultLike = {
  readonly ok?: unknown; readonly action?: unknown; readonly message?: unknown; readonly error?: unknown;
  readonly details?: unknown; readonly goalStartObjective?: unknown; readonly goalRollback?: unknown;
  readonly goalFollowup?: unknown;
};
type VisibilityCommandDetails = { readonly visibilityChanged?: unknown; readonly category?: unknown; readonly enabledName?: unknown };
type ChildUpdateDetails = { readonly childSessionUpdates?: unknown };
type SessionLifecycleEvent = { readonly type?: unknown; readonly willRetry?: unknown };

function commandContext(value: unknown): Partial<CommandContext> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<CommandContext> : undefined;
}
function commandResult(value: unknown): Partial<CommandResultLike> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<CommandResultLike> : undefined;
}

function commandResultFromToolResult(core: CoreBridge, result: ToolResultEnvelope) {
  return decodeBridgeCommandResult(core.call("toolResultToCommandResult", [result]));
}

function hasPendingMessages(ctx: unknown): boolean {
  const hasPending = commandContext(ctx)?.hasPendingMessages;
  if (typeof hasPending !== "function") return false;
  return hasPending.call(ctx) === true;
}

function hostIdle(_ctx: unknown): boolean {
  // Pi emits agent_end before some host surfaces report idle; this lifecycle event
  // is Taumel's idle boundary for goal continuation gating.
  return true;
}

function syncActiveTools(pi: PiLike, core: CoreBridge, ctx: unknown, enabledName?: string): void {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") return;
  const current = [...pi.getActiveTools()];
  if (enabledName !== undefined && enabledName !== "" && !current.includes(enabledName) && liveToolNames(pi, toolNames).includes(enabledName)) {
    current.push(enabledName);
    pi.setActiveTools(current);
  }
  const plan = decodeActiveToolsPlan(core.call("planActiveToolsSync", [{ tools: current, ctx }]));
  if (plan.changed) pi.setActiveTools([...plan.tools]);
}

function applyVisibilityCommandSideEffects(pi: PiLike, core: CoreBridge, result: unknown, ctx: unknown): void {
  const rawDetails = commandResult(result)?.details;
  const details = typeof rawDetails === "object" && rawDetails !== null ? rawDetails as VisibilityCommandDetails : undefined;
  if (details?.visibilityChanged !== true || details.category !== "tools") return;
  const enabledName = typeof details.enabledName === "string" ? details.enabledName : undefined;
  syncActiveTools(pi, core, ctx, enabledName);
}

function latestAssistantStopReason(event: unknown): string {
  const messages = typeof event === "object" && event !== null ? (event as AssistantEvent).messages : undefined;
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rawMessage = messages[index];
    const message = typeof rawMessage === "object" && rawMessage !== null ? rawMessage as AssistantMessage : undefined;
    if (message?.role !== "assistant") continue;
    return typeof message.stopReason === "string" ? message.stopReason : "";
  }
  return "";
}

async function sendGoalMessage(
  pi: PiLike,
  customType: string,
  content: string,
  display: boolean,
  options: MessageDeliveryOptions,
): Promise<void> {
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType, content, display }, options);
    return;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(content, { deliverAs: options.deliverAs });
  }
}

async function sendVisibleGoalResult(pi: PiLike, result: CommandResultLike): Promise<void> {
  const message = typeof result.message === "string" ? result.message : "";
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
  facts: Omit<GoalContinuationFacts, "initial" | "latestAssistantStopReason" | "ctx">,
  event: unknown,
): Promise<void> {
  if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return;
  const stopReason = latestAssistantStopReason(event);
  const plan = decodeGoalContinuationPlan(core.call("planGoalContinuation", [{
    ...facts, initial, ...(stopReason === "" ? {} : { latestAssistantStopReason: stopReason }), ctx,
  }]));
  if (plan.kind === "none") return;
  try {
    if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return;
    await sendGoalMessage(
      pi,
      plan.customType,
      plan.content,
      plan.display,
      {
        triggerTurn: plan.triggerTurn,
        deliverAs: plan.deliverAs,
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
  const command = commandResult(result);
  if (name !== "goal" || command?.action !== "command_result") {
    return;
  }
  const startObjective =
    typeof command.goalStartObjective === "string" ? command.goalStartObjective : "";
  if (startObjective !== "") {
    try {
      if (typeof pi.sendUserMessage !== "function") {
        throw new Error("Pi sendUserMessage is unavailable");
      }
      await pi.sendUserMessage(startObjective);
    } catch (error) {
      if (typeof command.goalRollback === "object" && command.goalRollback !== null) {
        decodeGoalRollbackResult(core.call("rollbackGoalCommand", [{ snapshot: command.goalRollback, ctx }]));
      }
      throw error;
    }
    return;
  }
  await sendVisibleGoalResult(pi, command);
  if (command.goalFollowup === true) {
    await sendGoalContinuation(pi, core, ctx, true, {
      hostIdle: true,
      hasPendingMessages: false,
      retrying: false,
      compacting: false,
    }, {});
  }
}

async function executePermissionsPrompt(
  core: CoreBridge,
  rawPrompt: unknown,
  ctx: unknown,
): Promise<unknown> {
  const prompt = decodePermissionsPrompt(rawPrompt);
  const finish = (selection: { status: "selected" | "cancelled"; selected?: string }) =>
    decodePermissionsCommandResult(core.call("finishPermissionsPrompt", [{ prompt, selection, ctx }]));

  const rawUi = commandContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CommandUi : undefined;
  const select = ui?.select;
  const plan = decodePermissionsPromptPlan(core.call("planPermissionsPrompt", [{
    prompt, uiAvailable: typeof select === "function",
  }]));
  if (plan.kind === "result") return plan.result;
  if (typeof select !== "function") throw new Error("Invalid Taumel permissions prompt plan");
  const selected = await select.call(ui, plan.title, [...plan.labels]);
  if (selected === undefined || selected === null) return finish({ status: "cancelled" });
  return finish({ status: "selected", selected: String(selected) });
}

async function executeCronPrompt(
  core: CoreBridge,
  prompt: Extract<GatewayCommandOutput, { action: "cron_prompt" }>,
  ctx: unknown,
): Promise<unknown> {
  return executeCronManager(core, prompt, ctx);
}

async function executeVisibilityPrompt(
  pi: PiLike,
  core: CoreBridge,
  prompt: Extract<GatewayCommandOutput, { action: "visibility_prompt" }>,
  ctx: unknown,
): Promise<unknown> {
  return executeVisibilityManager(core, prompt, ctx, (enabledName) => syncActiveTools(pi, core, ctx, enabledName));
}

async function executeCommandAction(
  pi: PiLike,
  core: CoreBridge,
  result: GatewayCommandOutput,
  ctx: unknown,
): Promise<unknown> {
  if (!("action" in result)) return result;
  switch (result.action) {
    case "permissions_prompt":
      return executePermissionsPrompt(core, result, ctx);
    case "cron_prompt":
      return executeCronPrompt(core, result, ctx);
    case "visibility_prompt":
      return executeVisibilityPrompt(pi, core, result, ctx);
    case "visibility_save_project": {
      return saveProjectVisibility(result.category, result.disabled, result.details, ctx);
    }
    case "openai_usage_fetch":
      return commandResultFromToolResult(core, await executeOpenAiUsageWithHostAuth(pi, core, { ...result }, ctx));
    default:
      return result;
  }
}

async function applyChildSessionUpdatesFromCommandResult(
  childSessions: Map<string, ChildSessionBridge>,
  result: unknown,
  keyScope?: string,
): Promise<void> {
  const rawDetails = commandResult(result)?.details;
  const details = typeof rawDetails === "object" && rawDetails !== null ? rawDetails as ChildUpdateDetails : undefined;
  const updates = Array.isArray(details?.childSessionUpdates)
    ? details.childSessionUpdates
    : [];
  for (const update of updates) {
    if (typeof update === "object" && update !== null) {
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

  const callCore = (commandCtx: unknown) =>
    decodeGatewayCommandOutput(core.call("handleCommand", [{ name, args, ctx: commandCtx }]));
  const plan = decodeCommandExecutionPlan(core.call("planCommandExecution", [{ name, args, ctx }]));
  if (plan.kind === "error") return { ok: false, error: plan.message };

  if (plan.kind === "direct") {
    const result = await executeCommandAction(pi, core, callCore(ctx), ctx);
    applyVisibilityCommandSideEffects(pi, core, result, ctx);
    await applyChildSessionUpdatesFromCommandResult(
      childSessions,
      result,
    );
    await executeGoalCommandSideEffects(pi, core, name, result, ctx);
    if (name === "permissions" || name === "sandbox" || name === "approval" || name === "network") {
      refreshOwnedChildPermissions(childSessions, ctx);
    }
    return result;
  }

  const contextOverrides: { [name: string]: unknown } = {};
  for (const override of plan.contextOverrides) {
    contextOverrides[override.name] = override.value;
  }
  let commandCtx = contextWithOverrides(ctx, contextOverrides);
  const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
  const childSessionPlan = decodeCommandChildSessionPlan(core.call("planCommandChildSession", [{
    metadata: plan.metadata,
    activeToolsMode: plan.activeToolsMode,
    currentActiveToolsAvailable: currentActiveToolNames !== undefined,
    currentActiveTools: currentActiveToolNames ?? [],
  }]));
  const metadata = childSessionPlan.metadata;
  const bridge = await createChildSession(pi, core, ctx, metadata);

  const childContextKey = plan.childSessionContextKey;
  if (childContextKey !== "" && bridge?.sessionId && !bridge.cancelled && !bridge.error) {
    commandCtx = contextWithOverrides(commandCtx, { [childContextKey]: bridge.sessionId });
  }

  const result = decodeBridgeCommandResult(callCore(commandCtx));
  const dispatchPlan = decodeCommandChildDispatchPlan(core.call("planCommandChildDispatch", [{
    result,
    bridge: childBridgeFacts(bridge),
  }]));
  const plannedResult = dispatchPlan.result;
  if (dispatchPlan.kind === "return") return plannedResult;

  await applyChildSessionUpdate(childSessions, dispatchPlan.bridgeUpdate, bridge);
  const dispatch = await sendToChildSession(pi, core, bridge, dispatchPlan.prompt);
  const finished = decodeBridgeCommandResult(core.call("finishCommandChildDispatch", [{
    result: plannedResult,
    dispatch,
  }]));
  return finished;
}

export function registerGatewayCommands(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  composer?: ComposerController,
): void {
  if (typeof pi.registerCommand !== "function") return;
  const { specs } = decodeCommandSpecsResult(core.call("commandSpecs", []));
  for (const spec of specs) {
    const name = spec.name;
    pi.registerCommand(name, {
      description: spec.description,
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
        const rawUi = commandContext(ctx)?.ui;
        const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CommandUi : undefined;
        const notify = ui?.notify;
        const currentResult = commandResult(result);
        const notification = decodeCommandNotificationPlan(core.call("planCommandNotification", [{
          commandName: name,
          ok: currentResult?.ok === true,
          message: typeof currentResult?.message === "string" ? currentResult.message : "",
          error: typeof currentResult?.error === "string" ? currentResult.error : "",
          uiAvailable: typeof notify === "function",
        }]));
        if (notification.kind === "notify" && typeof notify === "function") {
          notify.call(
            ui,
            notification.message,
            notification.level,
          );
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
    if (typeof event !== "object" || event === null) return;
    const lifecycle = event as SessionLifecycleEvent;
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
        if (lifecycle.willRetry === true) retrying = true;
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
        retrying: retrying || (typeof event === "object" && event !== null && (event as SessionLifecycleEvent).willRetry === true),
        compacting,
      }, event);
    } catch (error) {
      if (isStaleContextError(error)) return;
      throw error;
    }
  });
}
