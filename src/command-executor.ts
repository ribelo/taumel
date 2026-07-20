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
import { executeAgentRunsManager } from "./agent-runs-manager.ts";
import { initializeTaumelGlobalConfig, taumelStatus } from "./global-settings.ts";
import { executeVisibilityManager, saveProjectVisibility } from "./visibility.ts";
import { showUsageInspection } from "./usage-inspection.ts";
import {
  applyChildSessionUpdate,
  createChildSession,
  executeOpenAiUsageWithHostAuth,
  executeUsagePairWithHostAuth,
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
import { decodeActiveToolsPlan, decodeCommandChildSessionPlan, decodeCommandExecutionPlan, decodeCommandNotificationPlan, decodeCommandSpecsResult, decodeCoreAck } from "./bridge-contracts.ts";
import { decodeBridgeCommandResult, decodeCommandChildDispatchPlan, decodeGatewayCommandOutput, decodeGoalContinuationPlan, decodeGoalRollbackResult, decodePermissionsCommandResult, decodePermissionsPrompt, decodePermissionsPromptPlan, type GatewayCommandOutput, type GoalContinuationFacts, type ToolResultEnvelope } from "./bridge-contracts.ts";

type CommandContext = {
  readonly getSystemPrompt?: () => unknown;
  readonly hasPendingMessages?: () => unknown;
  readonly ui?: unknown;
};
type CommandUi = {
  readonly notify?: (message: string, level: string) => unknown;
  readonly select?: (title: string, labels: readonly string[]) => unknown;
  readonly custom?: (factory: unknown) => Promise<unknown>;
  readonly setStatus?: (key: string, value: string | undefined) => unknown;
};
type AssistantMessage = { readonly role?: unknown; readonly stopReason?: unknown; readonly errorMessage?: unknown };
type AssistantEvent = { readonly messages?: unknown; readonly willRetry?: unknown };
type CommandResultLike = {
  readonly ok?: unknown; readonly action?: unknown; readonly message?: unknown; readonly error?: unknown;
  readonly details?: unknown; readonly goalStartObjective?: unknown; readonly goalRollback?: unknown;
  readonly goalFollowup?: unknown;
  readonly goalInspection?: unknown;
};
type VisibilityCommandDetails = { readonly visibilityChanged?: unknown; readonly category?: unknown; readonly enabledName?: unknown };
type ChildUpdateDetails = { readonly childSessionUpdates?: unknown };
type GoalCommandDetails = { readonly goal?: unknown; readonly automation?: unknown };
type GoalAutomationView = { readonly continuation?: unknown };
type GoalView = {
  readonly statusLabel?: unknown; readonly objective?: unknown; readonly timeUsage?: unknown;
  readonly tokensUsed?: unknown; readonly timeUsedSeconds?: unknown; readonly timeLimitSeconds?: unknown;
};
type SessionLifecycleEvent = { readonly type?: unknown; readonly willRetry?: unknown };
type InputEvent = { readonly source?: unknown };

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

function latestAssistantErrorMessage(event: unknown): string {
  const messages = typeof event === "object" && event !== null ? (event as AssistantEvent).messages : undefined;
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rawMessage = messages[index];
    const message = typeof rawMessage === "object" && rawMessage !== null ? rawMessage as AssistantMessage : undefined;
    if (message?.role !== "assistant") continue;
    return typeof message.errorMessage === "string" ? message.errorMessage : "";
  }
  return "";
}

function isUsageLimitedError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "gousagelimiterror",
    "freeusagelimiterror",
    "monthly usage limit reached",
    "available balance",
    "insufficient_quota",
    "out of budget",
    "quota exceeded",
    "billing",
  ].some((marker) => normalized.includes(marker));
}

async function sendGoalMessage(
  pi: PiLike,
  customType: string,
  content: string,
  display: boolean,
  options: MessageDeliveryOptions,
  details?: unknown,
): Promise<void> {
  if (typeof pi.sendMessage === "function") {
    await pi.sendMessage({ customType, content, display, ...(details === undefined ? {} : { details }) }, options);
    return;
  }
  if (typeof pi.sendUserMessage === "function") {
    await pi.sendUserMessage(content, { deliverAs: options.deliverAs });
  }
}

async function showGoalInspection(result: CommandResultLike, ctx: unknown): Promise<void> {
  const rawUi = commandContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CommandUi : undefined;
  if (typeof ui?.custom !== "function") return;
  const details = typeof result.details === "object" && result.details !== null ? result.details as GoalCommandDetails : {};
  const goal = typeof details.goal === "object" && details.goal !== null ? details.goal as GoalView : undefined;
  const automation = typeof details.automation === "object" && details.automation !== null
    ? details.automation as GoalAutomationView
    : undefined;
  const status = typeof goal?.statusLabel === "string" ? goal.statusLabel : "none";
  const objective = typeof goal?.objective === "string" ? goal.objective : "";
  const time = typeof goal?.timeUsage === "string" ? goal.timeUsage : "";
  const candidate = ["Goal", status, objective, time].filter((part) => part !== "").join(" · ");
  let expanded = false;
  await ui.custom((tui: unknown, theme: unknown, _keys: unknown, done: () => void) => ({
    render: (width: number) => {
      const rawLines = expanded && goal !== undefined
        ? [candidate, `Objective: ${objective}`, `Status: ${status}`, `Automation: ${String(automation?.continuation ?? "enabled")}`, `Tokens: ${String(goal.tokensUsed ?? 0)}`, `Active time: ${time}`, `Time limit: ${goal.timeLimitSeconds == null ? "none" : String(goal.timeLimitSeconds)}`]
        : [candidate];
      const lines = rawLines.map((raw) => raw.length <= width ? raw : `${raw.slice(0, Math.max(0, width - 3))}...`);
      const themed = typeof theme === "object" && theme !== null && typeof (theme as { fg?: unknown }).fg === "function"
        ? lines.map((line) => (theme as { fg: (color: string, text: string) => string }).fg("customMessageLabel", line))
        : lines;
      return themed;
    },
    invalidate: () => undefined,
    handleInput: (data: string) => {
      if (data === "\x0f") {
        expanded = !expanded;
        if (typeof tui === "object" && tui !== null && typeof (tui as { requestRender?: unknown }).requestRender === "function") {
          (tui as { requestRender: () => void }).requestRender();
        }
      } else done();
    },
  }));
}

async function showSystemPromptInspection(ctx: unknown): Promise<void> {
  const commandCtx = commandContext(ctx);
  const getSystemPrompt = commandCtx?.getSystemPrompt;
  const rawUi = commandCtx?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CommandUi : undefined;
  if (typeof getSystemPrompt !== "function" || typeof ui?.custom !== "function") return;
  const prompt = String(getSystemPrompt.call(ctx));
  let offset = 0;
  await ui.custom((tui: unknown, theme: unknown, _keys: unknown, done: () => void) => ({
    render: (width: number) => {
      const contentWidth = Math.max(1, width);
      const lines = prompt.split("\n").flatMap((line) => {
        if (line.length === 0) return [""];
        const wrapped: string[] = [];
        for (let index = 0; index < line.length; index += contentWidth) {
          wrapped.push(line.slice(index, index + contentWidth));
        }
        return wrapped;
      });
      offset = Math.min(offset, Math.max(0, lines.length - 1));
      const visible = lines.slice(offset, offset + 30);
      const footer = `[${offset + 1}-${offset + visible.length}/${lines.length}] ↑↓ scroll · any other key closes`;
      const themed = typeof theme === "object" && theme !== null && typeof (theme as { fg?: unknown }).fg === "function"
        ? theme as { fg: (color: string, text: string) => string }
        : undefined;
      return [
        themed ? themed.fg("customMessageLabel", "System prompt") : "System prompt",
        ...visible,
        themed ? themed.fg("dim", footer.slice(0, contentWidth)) : footer.slice(0, contentWidth),
      ];
    },
    invalidate: () => undefined,
    handleInput: (data: string) => {
      if (data === "\x1b[A") offset = Math.max(0, offset - 1);
      else if (data === "\x1b[B") offset += 1;
      else return done();
      if (typeof tui === "object" && tui !== null && typeof (tui as { requestRender?: unknown }).requestRender === "function") {
        (tui as { requestRender: () => void }).requestRender();
      }
    },
  }));
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
      plan.details,
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
  if (command.goalInspection === true) {
    await showGoalInspection(command, ctx);
    return;
  }
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
    case "usage_pair_fetch":
      return commandResultFromToolResult(core, await executeUsagePairWithHostAuth(pi, core, { ...result }, ctx));
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
  childExtensionFactory?: (pi: PiLike) => void,
): Promise<unknown> {
  refreshOwnedChildPermissions(childSessions, ctx, core);
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
  if (name === "agent-runs") {
    return executeAgentRunsManager(pi, core, childSessions, args, ctx);
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
      refreshOwnedChildPermissions(childSessions, ctx, core);
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
    currentActiveTools: [...(currentActiveToolNames ?? [])],
  }]));
  const metadata = childSessionPlan.metadata;
  const bridge = await createChildSession(pi, core, ctx, metadata, childExtensionFactory);

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
  if (name === "ralph") {
    decodeCoreAck(core.call("persistRalphControllerState", [ctx]));
  }
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
  childExtensionFactory?: (pi: PiLike) => void,
): void {
  if (typeof pi.registerCommand !== "function") return;
  pi.registerCommand("system-prompt", {
    description: "Inspect the current effective system prompt",
    handler: async (_args, ctx) => showSystemPromptInspection(ctx),
  });
  const { specs } = decodeCommandSpecsResult(core.call("commandSpecs", []));
  for (const spec of specs) {
    const name = spec.name;
    pi.registerCommand(name, {
      description: spec.description,
      handler: async (_args, ctx) => {
        const rawUi = commandContext(ctx)?.ui;
        const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CommandUi : undefined;
        if (name === "usage" && typeof ui?.setStatus === "function") {
          ui.setStatus.call(ui, "taumel:usage", "Fetching account usage...");
        }
        let result: unknown;
        try {
          result = await executeGatewayCommand(
            pi,
            core,
            childSessions,
            composer,
            name,
            _args,
            ctx,
            childExtensionFactory,
          );
        } finally {
          if (name === "usage" && typeof ui?.setStatus === "function") {
            ui.setStatus.call(ui, "taumel:usage", undefined);
          }
        }
        if (name === "usage") {
          const usageResult = commandResult(result);
          const usageDetails = usageResult?.details ?? {
            openai: {
              error: typeof usageResult?.error === "string" ? usageResult.error : "OpenAI Codex usage fetch failed",
              notConfigured: false,
              rateLimits: [],
            },
            kimi: {
              error: typeof usageResult?.error === "string" ? usageResult.error : "Kimi Code usage fetch failed",
              notConfigured: false,
              rateLimits: [],
            },
          };
          await showUsageInspection(usageDetails, ctx);
          return result;
        }
        const notify = ui?.notify;
        const currentResult = commandResult(result);
        const suppressGoalNotification = name === "goal" && (
          typeof currentResult?.goalStartObjective === "string"
          || currentResult?.goalFollowup === true
          || currentResult?.goalInspection === true
        );
        if (suppressGoalNotification) return result;
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

  pi.on("input", (event, ctx) => {
    const source = typeof event === "object" && event !== null
      ? (event as InputEvent).source
      : undefined;
    if (source !== "extension") core.call("clearInterruptedGoalAutomation", [ctx]);
  });

  pi.on("agent_end", async (event, ctx) => {
    try {
      observeSessionEvent(event);
      if (!extensionRuntimeIsLive(pi) || !contextIsLive(ctx)) return;
      const stopReason = latestAssistantStopReason(event);
      if (stopReason === "aborted") {
        core.call("interruptGoalAutomation", [ctx]);
      }
      if (
        stopReason === "error"
        && typeof event === "object"
        && event !== null
        && (event as SessionLifecycleEvent).willRetry === false
      ) {
        const status = isUsageLimitedError(latestAssistantErrorMessage(event))
          ? "usage_limited"
          : "blocked";
        core.call("finalizeGoalError", [{ status, ctx }]);
      }
      await sendGoalContinuation(pi, core, ctx, false, {
        // Pi emits agent_end before some host surfaces report idle; this event is
        // Taumel's idle boundary for goal continuation gating.
        hostIdle: true,
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
