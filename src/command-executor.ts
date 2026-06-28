import type {
  ChildSessionBridge,
  ComposerController,
  CoreBridge,
  PiLike,
} from "./types.ts";

import { executeComposerCommand } from "./composer.ts";
import {
  applyChildSessionUpdate,
  childSessionCacheKeyScopeFromContext,
  createChildSession,
  executeOpenAiUsageWithHostAuth,
  sendToChildSession,
} from "./tool-executor.ts";

import {
  childBridgeFacts,
  contextWithOverrides,
  coreCall,
  isRecord,
  stringArrayField,
  stringField,
} from "./util.ts";

function commandResultFromToolResult(core: CoreBridge, result: unknown): Record<string, unknown> {
  const converted = coreCall(core, "toolResultToCommandResult", [result]);
  if (!isRecord(converted)) throw new Error("Invalid Taumel command result conversion");
  return converted;
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
  const plan = coreCall(core, "planGoalContinuation", [initial, facts, event, ctx]);
  if (!isRecord(plan)) throw new Error("Invalid Taumel goal continuation plan");
  const action = stringField(plan, "action");
  if (action === "none") return;
  if (action !== "send_goal_continuation") {
    throw new Error("Invalid Taumel goal continuation plan");
  }
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
}

async function executeGoalCommandSideEffects(
  pi: PiLike,
  core: CoreBridge,
  name: string,
  result: unknown,
  ctx: unknown,
): Promise<void> {
  if (name !== "goal" || !isRecord(result) || stringField(result, "action") !== "command_result") {
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
    return coreCall(core, finishMethod, [prompt, selection, ctx]);
  };

  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : {};
  const select = ui["select"];
  const plan = coreCall(core, planMethod, [prompt, {
    uiAvailable: typeof select === "function",
  }]);
  if (!isRecord(plan)) throw new Error(`Invalid Taumel ${label} prompt plan`);
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
  if (name === "composer") {
    return executeComposerCommand(core, composer, args, ctx);
  }
  if (name === "execpolicy") {
    const trimmed = args.trim();
    const valid = trimmed === "" || (trimmed.startsWith("check ") && trimmed.slice("check ".length).trim() !== "");
    if (!valid) {
      const message = "Usage: /execpolicy [check <command>]";
      return { ok: false, action: "command_result", message, error: message, details: { ok: false, error: message } };
    }
  }

  const callCore = (commandCtx: unknown) => coreCall(core, "handleCommand", [name, args, commandCtx]);
  const plan = coreCall(core, "planCommandExecution", [name, args, ctx]);
  if (!isRecord(plan)) throw new Error("Invalid Taumel command execution plan");
  if (plan["ok"] !== true) return plan;

  if (stringField(plan, "action") !== "command_child_session") {
    const result = await executeCommandAction(pi, core, callCore(ctx), ctx);
    await applyChildSessionUpdatesFromCommandResult(
      childSessions,
      result,
      name === "agent-runs" ? childSessionCacheKeyScopeFromContext(ctx) : undefined,
    );
    await executeGoalCommandSideEffects(pi, core, name, result, ctx);
    return result;
  }

  const contextOverrides = isRecord(plan["contextOverrides"]) ? plan["contextOverrides"] : {};
  let commandCtx = contextWithOverrides(ctx, contextOverrides);
  const currentActiveToolNames = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : undefined;
  const childSessionPlan = coreCall(core, "planCommandChildSession", [{
    plan,
    currentActiveToolsAvailable: currentActiveToolNames !== undefined,
    currentActiveTools: currentActiveToolNames ?? [],
  }]);
  if (!isRecord(childSessionPlan)) throw new Error("Invalid Taumel command child session plan");
  if (childSessionPlan["ok"] !== true) return childSessionPlan;
  const metadata = isRecord(childSessionPlan["metadata"]) ? childSessionPlan["metadata"] : {};
  const bridge = await createChildSession(pi, core, ctx, metadata);

  const childContextKey = stringField(plan, "childSessionContextKey");
  if (childContextKey !== "" && bridge?.sessionId && !bridge.cancelled && !bridge.error) {
    commandCtx = contextWithOverrides(commandCtx, { [childContextKey]: bridge.sessionId });
  }

  const result = callCore(commandCtx);
  const dispatchPlan = coreCall(core, "planCommandChildDispatch", [{
    result,
    bridge: childBridgeFacts(bridge),
  }]);
  if (!isRecord(dispatchPlan)) throw new Error("Invalid Taumel command child dispatch plan");
  const plannedResult = dispatchPlan["result"];
  if (!isRecord(plannedResult)) throw new Error("Invalid Taumel command child dispatch result");
  if (stringField(dispatchPlan, "action") !== "command_child_dispatch") {
    return plannedResult;
  }

  await applyChildSessionUpdate(childSessions, dispatchPlan["bridgeUpdate"], bridge);
  const dispatch = await sendToChildSession(pi, core, bridge, stringField(dispatchPlan, "prompt"));
  const finished = coreCall(core, "finishCommandChildDispatch", [{
    result: plannedResult,
    dispatch,
  }]);
  if (!isRecord(finished)) throw new Error("Invalid Taumel command child dispatch result");
  return finished;
}

export function registerGatewayCommands(
  pi: PiLike,
  core: CoreBridge,
  childSessions: Map<string, ChildSessionBridge>,
  composer?: ComposerController,
): void {
  if (typeof pi.registerCommand !== "function") return;
  const specs = coreCall(core, "commandSpecs");
  if (!Array.isArray(specs) || !specs.every(isRecord)) {
    throw new Error("Invalid Taumel command specs");
  }
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
        const notification = coreCall(core, "planCommandNotification", [name, result, {
          uiAvailable: typeof notify === "function",
        }]);
        if (!isRecord(notification)) throw new Error("Invalid Taumel command notification plan");
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
    observeSessionEvent(event);
    const stopReason = latestAssistantStopReason(event);
    if (stopReason === "aborted") {
      coreCall(core, "interruptGoalAutomation", [ctx]);
    }
    await sendGoalContinuation(pi, core, ctx, false, {
      hostIdle: hostIdle(ctx),
      hasPendingMessages: hasPendingMessages(ctx),
      retrying: retrying || (isRecord(event) && event["willRetry"] === true),
      compacting,
    }, event);
  });
}
