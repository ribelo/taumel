import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import taumel from "../src/index.ts";
import { renderComposerInput } from "../src/composer.ts";
import { applyChildSessionUpdate } from "../src/tool-executor.ts";

const cwd = await mkdtemp(join(tmpdir(), "taumel-entrypoint-"));
const originalFetch = globalThis.fetch;
const originalSettingsPath = process.env.TAUMEL_SETTINGS_PATH;
const originalAgentProfileDir = process.env.TAUMEL_AGENT_PROFILE_DIR;
process.env.TAUMEL_SETTINGS_PATH = join(cwd, "taumel-settings.json");
process.env.TAUMEL_AGENT_PROFILE_DIR = join(cwd, "agent-profiles");
await mkdir(process.env.TAUMEL_AGENT_PROFILE_DIR, { recursive: true });
await writeFile(
  join(process.env.TAUMEL_AGENT_PROFILE_DIR, "scout.md"),
  [
    "---",
    "name: scout",
    "description: Temporary smoke-test scanner",
    "provider: inherit",
    "model: inherit",
    "thinking: inherit",
    "sandbox: read-only",
    "tools:",
    "  - exec_command",
    "---",
    "Inspect directly without delegating to other agents.",
  ].join("\n"),
  "utf8",
);
await writeFile(
  process.env.TAUMEL_SETTINGS_PATH,
  `${JSON.stringify({
    composer: { enabled: true },
    taumel: {
      agents: {
        builtins: {
          finder: {
            provider: "openai-codex",
            model: "gpt-override",
            thinking: "high",
          },
        },
      },
    },
  }, null, 2)}\n`,
  "utf8",
);

const handlers = new Map();
const internalHandlers = new Map();
const tools = new Map();
const commands = new Map();
const execCalls = [];
const stdinCalls = [];
const agentSessionCalls = [];
const customEntries = [];
const notifications = [];
const confirmations = [];
const selections = [];
const activeToolUpdates = [];
const fetchCalls = [];
const sentMessages = [];
const childSendResponses = [];
const childDispatchCalls = [];
const childLifecycleCalls = [];
const editorFactories = [];
const childContexts = new Map();
let activeTools = ["bash", "write", "usage", "bash"];
let sandboxMode = undefined;
let extensionLoading = true;
let childCounter = 0;
let pendingMessages = false;
let renderRequests = 0;
let confirmBehavior = async () => true;
let selectBehavior = async (_title, labels) => labels[0];
let nextAgentSessionResult = undefined;

const pushHandler = (map, event, handler) => {
  const list = map.get(event) ?? [];
  list.push(handler);
  map.set(event, list);
};

const runtimeActionGuard = () => {
  if (extensionLoading) {
    throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
  }
};

const assistantMessage = (stopReason = "stop", errorMessage = undefined) => ({
  role: "assistant",
  content: [{ type: "text", text: stopReason }],
  stopReason,
  ...(errorMessage === undefined ? {} : { errorMessage }),
});
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const patchInput = (input) => ({ input });
const waitFor = async (predicate, message, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
};

globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), options });
  return new Response(
    JSON.stringify({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18000,
          reset_at: Math.floor(Date.now() / 1000) + 18000,
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

const pi = {
  on: (event, handler) => pushHandler(handlers, event, handler),
  events: {
    on: (event, handler) => {
      pushHandler(internalHandlers, event, handler);
      return () => undefined;
    },
    emit: (event, payload) => {
      for (const handler of internalHandlers.get(event) ?? []) handler(payload);
    },
  },
  exec: async (command, args, options) => {
    execCalls.push({ command, args, options });
    return { code: 0, stdout: `ran ${command} ${args.join(" ")}\n`, stderr: "" };
  },
  writeStdin: async (sessionId, chars, options) => {
    stdinCalls.push({ sessionId, chars, options });
    return { ok: true };
  },
  getFlag: (name) => {
    runtimeActionGuard();
    return name === "sandbox-mode" ? sandboxMode : undefined;
  },
  getThinkingLevel: () => {
    runtimeActionGuard();
    return "medium";
  },
  getActiveTools: () => {
    runtimeActionGuard();
    return activeTools;
  },
  setActiveTools: (nextTools) => {
    runtimeActionGuard();
    activeTools = [...nextTools];
    activeToolUpdates.push(activeTools);
  },
  registerTool: (tool) => {
    tools.set(tool.name, tool);
  },
  registerCommand: (name, command) => {
    commands.set(name, command);
  },
  sendMessage: (message, options) => {
    runtimeActionGuard();
    sentMessages.push({ message, options });
  },
  createAgentSession: async (options = {}) => {
    agentSessionCalls.push(options);
    if (nextAgentSessionResult !== undefined) {
      const result = nextAgentSessionResult;
      nextAgentSessionResult = undefined;
      if (result instanceof Error) throw result;
      return result;
    }
    childCounter += 1;
    const childId = `child-${childCounter}`;
    const childEntries = [];
    const listeners = [];
    let childActiveTools = Array.isArray(options.tools) ? [...options.tools] : [];
    const childSessionManager = {
      getSessionId: () => childId,
      getSessionFile: () => join(cwd, `${childId}.json`),
      appendCustomEntry: (type, value) => {
        childEntries.push({ type: "custom", customType: type, data: value });
        customEntries.push({ sessionId: childId, type, value });
      },
      getEntries: () => childEntries,
      getBranch: () => [],
    };
    const dispatchChildMessage = async (method, content, options = {}) => {
      childDispatchCalls.push({ sessionId: childId, method, content, options });
      const response = await childSendResponses.shift();
      if (response !== undefined) {
        if (response.suppressAgentEndEvent !== true) {
          const message = response.agentEndMessage ?? assistantMessage(
            response.output ?? response.finalOutput ?? "stop",
            response.errorMessage,
          );
          for (const listener of listeners) {
            listener({ type: "agent_end", messages: [message] });
          }
        }
      }
      return response;
    };
    const session = {
      sessionId: childId,
      sessionFile: join(cwd, `${childId}.json`),
      sessionManager: childSessionManager,
      isStreaming: false,
      subscribe: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
      getActiveToolNames: () => childActiveTools,
      setActiveToolsByName: (toolNames) => {
        childActiveTools = [...toolNames];
      },
      prompt: (content, options) => dispatchChildMessage("prompt", content, options),
      followUp: (content, options) => dispatchChildMessage("followUp", content, options),
      steer: (content, options) => dispatchChildMessage("steer", content, options),
      abort: async (reason) => {
        childLifecycleCalls.push({ sessionId: childId, method: "abort", reason });
      },
      close: async (reason) => {
        childLifecycleCalls.push({ sessionId: childId, method: "close", reason });
      },
      dispose: () => {
        childLifecycleCalls.push({ sessionId: childId, method: "dispose" });
      },
    };
    childContexts.set(childId, { session, sessionManager: childSessionManager });
    return { session };
  },
};

const scopedCacheCalls = [];
const scopedCache = new Map();
await applyChildSessionUpdate(
  scopedCache,
  { action: "store_child_session", key: "shared-worker" },
  { sessionId: "scoped-child-a", close: async (reason) => scopedCacheCalls.push({ sessionId: "scoped-child-a", reason }) },
  "parent-a",
);
await applyChildSessionUpdate(
  scopedCache,
  { action: "store_child_session", key: "shared-worker" },
  { sessionId: "scoped-child-b", close: async (reason) => scopedCacheCalls.push({ sessionId: "scoped-child-b", reason }) },
  "parent-b",
);
await applyChildSessionUpdate(
  scopedCache,
  { action: "delete_child_session", key: "shared-worker", reason: "closed_by_parent" },
  undefined,
  "parent-b",
);
await applyChildSessionUpdate(
  scopedCache,
  { action: "delete_child_session", key: "shared-worker", reason: "closed_by_parent" },
  undefined,
  "parent-a",
);
if (
  scopedCacheCalls.length !== 2 ||
  scopedCacheCalls[0]?.sessionId !== "scoped-child-b" ||
  scopedCacheCalls[1]?.sessionId !== "scoped-child-a"
) {
  throw new Error(`child session cache keys are not parent scoped: ${JSON.stringify(scopedCacheCalls)}`);
}

try {
  await taumel(pi);
  extensionLoading = false;

  if (activeToolUpdates.length !== 0) {
    throw new Error(`runtime action methods were called during extension loading: ${JSON.stringify(activeToolUpdates)}`);
  }
  for (const name of [
    "agent_spawn",
    "agent_send",
    "agent_wait",
    "agent_list",
    "agent_close",
    "agent_profiles",
  ]) {
    if (tools.has(name)) throw new Error(`agent tool registered before profile validation: ${name}`);
  }

  const parentEntries = [];
  const ctx = {
    cwd,
    hasUI: true,
    ui: {
      setFooter: () => undefined,
      notify: (message, type) => notifications.push({ message, type }),
      requestRender: () => {
        renderRequests += 1;
      },
      setEditorComponent: (factory) => {
        editorFactories.push(factory);
      },
      confirm: async (title, prompt, options) => {
        confirmations.push({ title, prompt, options });
        return confirmBehavior(title, prompt, options);
      },
      select: async (title, labels) => {
        selections.push({ title, labels });
        return selectBehavior(title, labels);
      },
    },
    model: { provider: "openai-codex", id: "gpt-test" },
    getContextUsage: () => ({ percent: 1, contextWindow: 1000 }),
    hasPendingMessages: () => pendingMessages,
    modelRegistry: {
      find: (provider, model) => ({ provider, id: model }),
      authStorage: {
        get: (provider) =>
          provider === "openai-codex"
            ? { type: "chatgpt", accountId: "acct-test", email: "person@example.com" }
            : undefined,
      },
      getApiKeyForProvider: async (provider) =>
        provider === "openai-codex" ? "chatgpt-access-token" : undefined,
    },
    sendUserMessage: async () => undefined,
    sessionManager: {
      getSessionId: () => "parent-session",
      getSessionFile: () => join(cwd, "parent-session.json"),
      appendCustomEntry: (type, value) => {
        const entry = { type: "custom", customType: type, data: value };
        parentEntries.push(entry);
        customEntries.push({ sessionId: "parent-session", type, value });
      },
      getEntries: () => parentEntries,
      getBranch: () => [
        { type: "message", message: { role: "user", content: "bridge smoke" } },
        { type: "message", message: { role: "assistant", content: "bridge response" } },
      ],
    },
  };

  for (const handler of handlers.get("session_start") ?? []) {
    handler({ type: "session_start" }, ctx);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (editorFactories.length !== 1) {
    throw new Error(`composer editor was not installed on session_start: ${editorFactories.length}`);
  }

  for (const name of [
    "exec_command",
    "write_stdin",
    "apply_patch",
    "edit",
    "write",
    "agent_spawn",
    "agent_send",
    "agent_wait",
    "agent_list",
    "agent_close",
    "agent_profiles",
  ]) {
    if (!tools.has(name)) throw new Error(`missing registered tool: ${name}`);
  }
  if (tools.has("agent")) {
    throw new Error("legacy agent tool must not be registered");
  }
  for (const name of ["agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close", "agent_profiles"]) {
    if (!activeTools.includes(name)) {
      throw new Error(`valid agent catalog did not activate model-facing agent tool ${name}: ${JSON.stringify(activeTools)}`);
    }
  }
  for (const name of ["exec_command", "write_stdin"]) {
    assert(typeof tools.get(name).renderCall === "function" && typeof tools.get(name).renderResult === "function", `${name} did not register compact shell renderers`);
  }
  const plainTheme = { fg: (_color, value) => value, bold: (value) => value };
  const longShellOutput = Array.from({ length: 20 }, (_, index) => `file-${index + 1}`).join("\n");
  const shellResult = { content: [{ type: "text", text: longShellOutput }], details: { ok: true, output: longShellOutput, exitCode: 0 } };
  const renderShell = (expanded) => tools.get("exec_command").renderResult(shellResult, { expanded, isPartial: false }, plainTheme, { args: { cmd: "ls many-files" } }).render(120).join("\n");
  const compactShell = renderShell(false);
  const expandedShell = renderShell(true);
  const compactShellLines = compactShell.split("\n").map((line) => line.trim());
  const expandedShellLines = expandedShell.split("\n").map((line) => line.trim());
  assert(
    !compactShellLines.includes("file-1") &&
    compactShell.includes("earlier lines") &&
    compactShell.includes("ls many-files") &&
    expandedShellLines.includes("file-1") &&
    expandedShell.length > compactShell.length,
    `shell renderer did not compact long output: ${JSON.stringify({ compactShell, expandedShell })}`,
  );
  if (tools.has("usage")) {
    throw new Error("usage was registered as a model-callable tool");
  }
  for (const name of ["permissions", "network", "composer", "usage", "ralph", "goal", "agents", "agent-runs"]) {
    if (!commands.has(name)) throw new Error(`missing registered command: ${name}`);
  }
  const contextHandlers = handlers.get("context") ?? [];
  assert(contextHandlers.length === 1, `environment context handler was not registered: ${contextHandlers.length}`);
  const runContext = async (messages, context = ctx) => {
    const result = await contextHandlers[0]({ type: "context", messages }, context);
    return result?.messages ?? messages;
  };
  const findEnvironmentMessage = (messages) =>
    messages.find((message) => message?.role === "custom" && message?.customType === "taumel.environment_context");

  const composerRendered = renderComposerInput(
    16,
    (width) => ["─".repeat(width), "hello" + " ".repeat(Math.max(0, width - 5)), "─".repeat(width), "complete"],
    true,
  );
  if (
    composerRendered.length !== 4 ||
    !composerRendered[0].startsWith("\x1b[48;2;46;56;60m") ||
    !composerRendered[1].includes("›") ||
    composerRendered[3].startsWith("\x1b[48;2;46;56;60m")
  ) {
    throw new Error(`composer render wrapper did not match expected Tau look: ${JSON.stringify(composerRendered)}`);
  }

  const composerShow = await commands.get("composer").handler("show", ctx);
  if (
    composerShow.action !== "command_result" ||
    !composerShow.message.includes("Composer: on") ||
    !composerShow.message.includes(process.env.TAUMEL_SETTINGS_PATH)
  ) {
    throw new Error(`composer show did not report global state and path: ${JSON.stringify(composerShow)}`);
  }
  const composerOff = await commands.get("composer").handler("off", ctx);
  const composerFile = JSON.parse(await readFile(process.env.TAUMEL_SETTINGS_PATH, "utf8"));
  if (
    composerOff.action !== "command_result" ||
    !composerOff.message.includes("Composer: off") ||
    composerFile?.composer?.enabled !== false ||
    composerFile?.taumel?.agents?.builtins?.finder?.provider !== "openai-codex" ||
    composerFile?.taumel?.agents?.builtins?.finder?.model !== "gpt-override" ||
    composerFile?.taumel?.agents?.builtins?.finder?.thinking !== "high" ||
    composerFile?.taumel?.agents?.builtins?.smart?.provider !== "inherit" ||
    renderRequests === 0
  ) {
    throw new Error(`composer off did not persist and rerender: ${JSON.stringify({ composerOff, composerFile, renderRequests })}`);
  }

  const noGoalResult = await commands.get("goal").handler("", ctx);
  if (
    noGoalResult.action !== "command_result" ||
    noGoalResult.message !== "No active goal."
  ) {
    throw new Error(`goal command did not report empty state: ${JSON.stringify(noGoalResult)}`);
  }

  const setGoalResult = await commands.get("goal").handler("ship slash command", ctx);
  if (
    setGoalResult.action !== "command_result" ||
    setGoalResult.details?.goal?.objective !== "ship slash command" ||
    setGoalResult.details?.goal?.status !== "active"
  ) {
    throw new Error(`goal command did not set goal: ${JSON.stringify(setGoalResult)}`);
  }
  const initialGoalMessage = sentMessages.at(-1);
  if (
    initialGoalMessage?.message?.customType !== "taumel.goal.continue" ||
    initialGoalMessage?.message?.display !== false ||
    !initialGoalMessage.message.content.includes("ship slash command") ||
    initialGoalMessage?.options?.triggerTurn !== true ||
    initialGoalMessage?.options?.deliverAs !== "followUp"
  ) {
    throw new Error(`goal command did not queue initial continuation: ${JSON.stringify(sentMessages)}`);
  }

  sentMessages.length = 0;
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage()] }, ctx);
  }
  const nextGoalMessage = sentMessages.at(-1);
  if (
    nextGoalMessage?.message?.customType !== "taumel.goal.continue" ||
    nextGoalMessage?.message?.display !== false ||
    !nextGoalMessage.message.content.includes("Continue the active goal") ||
    nextGoalMessage?.options?.triggerTurn !== true ||
    nextGoalMessage?.options?.deliverAs !== "followUp"
  ) {
    throw new Error(`goal agent_end did not queue continuation: ${JSON.stringify(sentMessages)}`);
  }

  sentMessages.length = 0;
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage("aborted", "User interrupted")] }, ctx);
  }
  if (sentMessages.length !== 0) {
    throw new Error(`goal agent_end queued after interrupt: ${JSON.stringify(sentMessages)}`);
  }
  const interruptedGoalResult = await commands.get("goal").handler("status", ctx);
  if (interruptedGoalResult.details?.goal?.status !== "active") {
    throw new Error(`goal interrupt changed goal status: ${JSON.stringify(interruptedGoalResult)}`);
  }

  sentMessages.length = 0;
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage("error", "provider returned error: 503")] }, ctx);
  }
  if (sentMessages.length !== 0) {
    throw new Error(`goal agent_end queued after assistant error: ${JSON.stringify(sentMessages)}`);
  }

  sentMessages.length = 0;
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage()], willRetry: true }, ctx);
  }
  if (sentMessages.length !== 0) {
    throw new Error(`goal agent_end queued while host retry is expected: ${JSON.stringify(sentMessages)}`);
  }

  sentMessages.length = 0;
  pendingMessages = true;
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage()] }, ctx);
  }
  pendingMessages = false;
  if (sentMessages.length !== 0) {
    throw new Error(`goal agent_end queued while pending messages exist: ${JSON.stringify(sentMessages)}`);
  }

  const completeGoalResult = await commands.get("goal").handler("complete", ctx);
  if (
    completeGoalResult.action !== "command_result" ||
    completeGoalResult.details?.goal?.status !== "complete"
  ) {
    throw new Error(`goal command did not complete goal: ${JSON.stringify(completeGoalResult)}`);
  }
  sentMessages.length = 0;
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage()] }, ctx);
  }
  if (sentMessages.length !== 0) {
    throw new Error(`goal agent_end queued after complete: ${JSON.stringify(sentMessages)}`);
  }

  if (activeToolUpdates.length === 0) {
    throw new Error(`active tool sync did not run after session_start: ${JSON.stringify(activeToolUpdates)}`);
  }
  const startupActiveTools = activeToolUpdates.at(-1) ?? [];
  if (
    startupActiveTools.includes("write") ||
    startupActiveTools.includes("usage") ||
    !startupActiveTools.includes("apply_patch") ||
    !startupActiveTools.includes("agent_spawn") ||
    !startupActiveTools.includes("agent_wait")
  ) {
    throw new Error(`openai active tool sync did not select apply_patch: ${JSON.stringify(activeToolUpdates)}`);
  }

  const defaultPermission = await commands.get("permissions").handler("show", ctx);
  if (
    defaultPermission.action !== "command_result" ||
    !defaultPermission.message.includes("sandbox=danger-full-access") ||
    !defaultPermission.message.includes("approval=never") ||
    !defaultPermission.message.includes("network=enabled")
  ) {
    throw new Error(`default permissions were not full access: ${JSON.stringify(defaultPermission)}`);
  }
  const initialContextMessages = await runContext([{ role: "user", content: "initial context" }]);
  const initialEnvironment = findEnvironmentMessage(initialContextMessages);
  assert(
    initialContextMessages[0] === initialEnvironment &&
    initialContextMessages[1]?.role === "user" &&
    initialEnvironment?.content?.includes("<sandbox_mode>danger-full-access</sandbox_mode>") &&
    initialEnvironment.content.includes("<approval_policy>never</approval_policy>") &&
    initialEnvironment.content.includes("<network_access>enabled</network_access>"),
    `initial environment context was not injected before user input: ${JSON.stringify(initialContextMessages)}`,
  );
  const unchangedContext = await contextHandlers[0]({ type: "context", messages: [{ role: "user", content: "unchanged context" }] }, ctx);
  assert(unchangedContext === undefined, `unchanged environment context should not inject: ${JSON.stringify(unchangedContext)}`);
  const rejectedEscalationConfirmCount = confirmations.length;
  const rejectedEscalation = await tools.get("exec_command").execute(
    "exec-escalation-rejected",
    {
      cmd: "echo should-not-run",
      sandbox_permissions: "require_escalated",
      justification: "need host",
    },
    undefined,
    undefined,
    ctx,
  );
  if (
    confirmations.length !== rejectedEscalationConfirmCount ||
    !rejectedEscalation.content?.[0]?.text.includes("approval policy is Never; reject command") ||
    rejectedEscalation.content?.[0]?.text === "need host"
  ) {
    throw new Error(`exec escalation rejection did not match Codex: ${JSON.stringify({ rejectedEscalation, confirmations })}`);
  }
  const workspaceSetup = await commands.get("permissions").handler("sandbox workspace-write", ctx);
  if (
    workspaceSetup.action !== "command_result" ||
    !workspaceSetup.message.includes("sandbox=workspace-write") ||
    !workspaceSetup.message.includes("approval=on-request") ||
    !workspaceSetup.message.includes("network=disabled")
  ) {
    throw new Error(`workspace permissions did not apply preset defaults: ${JSON.stringify(workspaceSetup)}`);
  }
  const savedWorkspacePermission = parentEntries.filter((entry) => entry.customType === "taumel.permissions").at(-1);
  const changedContextMessages = await runContext([{ role: "user", content: "changed permissions" }]);
  const changedEnvironment = findEnvironmentMessage(changedContextMessages);
  assert(
    changedContextMessages[0] === changedEnvironment &&
    changedContextMessages[1]?.role === "user" &&
    changedEnvironment?.content?.includes("<sandbox_mode>workspace-write</sandbox_mode>") &&
    changedEnvironment.content.includes("<approval_policy>on-request</approval_policy>") &&
    changedEnvironment.content.includes("<network_access>restricted</network_access>") &&
    changedEnvironment.content.includes("<root>") &&
    !changedEnvironment.content.includes("<shell>"),
    `changed environment context was not injected as a diff: ${JSON.stringify(changedContextMessages)}`,
  );
  const directTimedOutApproval = globalThis.taumel.call("finishExecApproval", [{ outcome: "timed_out" }]);
  const directUnavailableApproval = globalThis.taumel.call("finishExecApproval", [{ outcome: "unavailable" }]);
  assert(
    directTimedOutApproval?.result?.content?.[0]?.text === "Sandbox: command blocked (approval timed out)" &&
    directTimedOutApproval?.result?.details?.approvalOutcome === "timed_out" &&
    directUnavailableApproval?.result?.content?.[0]?.text === "Sandbox: command blocked (approval unavailable)" &&
    directUnavailableApproval?.result?.details?.approvalOutcome === "unavailable",
    `approval outcome bridge did not preserve timeout/unavailable: ${JSON.stringify({ directTimedOutApproval, directUnavailableApproval })}`,
  );
  confirmBehavior = async () => false;
  const deniedExecCallCount = execCalls.length;
  const deniedExecConfirmCount = confirmations.length;
  const deniedParams = { cmd: "echo denied", sandbox_permissions: "require_escalated", justification: "test denial" };
  const deniedExec = await tools.get("exec_command").execute("exec-escalation-denied", deniedParams, undefined, undefined, ctx);
  confirmBehavior = async () => true;
  assert(
    execCalls.length === deniedExecCallCount &&
    confirmations.length === deniedExecConfirmCount + 1 &&
    confirmations.at(-1)?.options?.signal !== undefined &&
    !("timeout" in confirmations.at(-1).options) &&
    deniedExec.content?.[0]?.text === "Sandbox: command blocked (approval denied by user)" &&
    deniedExec.details?.approvalOutcome === "denied_by_user",
    `explicit approval denial was not classified: ${JSON.stringify({ deniedExec, confirmations: confirmations.at(-1) })}`,
  );
  const interruptedSignal = new AbortController();
  interruptedSignal.abort();
  const interruptedConfirmCount = confirmations.length;
  const interruptedParams = { cmd: "echo interrupted", sandbox_permissions: "require_escalated", justification: "test interruption" };
  const interruptedExec = await tools.get("exec_command").execute("exec-escalation-interrupted", interruptedParams, interruptedSignal.signal, undefined, ctx);
  assert(
    confirmations.length === interruptedConfirmCount &&
    interruptedExec.content?.[0]?.text === "Sandbox: command blocked (approval interrupted)" &&
    interruptedExec.details?.approvalOutcome === "interrupted",
    `interrupted approval was not classified: ${JSON.stringify({ interruptedExec, confirmations })}`,
  );
  const networkPermission = await commands.get("network").handler("enabled", ctx);
  const networkEntry = parentEntries.filter((entry) => entry.customType === "taumel.permissions").at(-1);
  if (
    networkPermission.action !== "command_result" ||
    !networkPermission.message.includes("network=enabled") ||
    networkEntry?.data?.networkMode !== "enabled"
  ) {
    throw new Error(`network command did not persist shared permissions state: ${JSON.stringify({ networkPermission, networkEntry })}`);
  }
  const resumedEntries = [
    { type: "custom", customType: "taumel.permissions", data: savedWorkspacePermission.data },
  ];
  const resumedCtx = {
    ...ctx,
    sessionManager: {
      getSessionId: () => "resumed-session",
      getSessionFile: () => join(cwd, "resumed-session.json"),
      appendCustomEntry: (type, value) => {
        resumedEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => resumedEntries,
      getBranch: () => [],
    },
  };
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume", previousSessionFile: join(cwd, "parent-session.json") }, resumedCtx);
  }
  const resumedPermission = await commands.get("permissions").handler("show", resumedCtx);
  if (
    resumedPermission.action !== "command_result" ||
    !resumedPermission.message.includes("sandbox=workspace-write") ||
    !resumedPermission.message.includes("network=disabled")
  ) {
    throw new Error(`resume did not load saved permissions: ${JSON.stringify({ resumedPermission, resumedEntries })}`);
  }

  ctx.model.provider = "anthropic";
  activeTools = ["bash", "apply_patch", "usage"];
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }
  const nonOpenAiTools = activeToolUpdates.at(-1) ?? [];
  if (
    nonOpenAiTools.includes("apply_patch") ||
    nonOpenAiTools.includes("usage") ||
    !nonOpenAiTools.includes("edit") ||
    !nonOpenAiTools.includes("write")
  ) {
    throw new Error(`non-openai active tool sync did not select legacy wrappers: ${JSON.stringify(activeToolUpdates)}`);
  }
  ctx.model.provider = "openai-codex";
  activeTools = ["bash", "write", "usage", "bash"];
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }

  const execResult = await tools
    .get("exec_command")
    .execute("exec-call", { cmd: "printf exec-ready", workdir: cwd }, undefined, undefined, ctx);
  if (!execResult.content?.[0]?.text.includes("exec-ready")) {
    throw new Error(`exec_command did not run command: ${JSON.stringify({ execCalls, execResult })}`);
  }

  const legacyWriteTarget = join(cwd, "legacy-write.txt");
  const legacyWriteResult = await tools.get("write").execute(
    "write-call",
    { path: "legacy-write.txt", content: "legacy\n" },
    undefined,
    undefined,
    ctx,
  );
  if (legacyWriteResult.details?.ok !== true || (await readFile(legacyWriteTarget, "utf8")) !== "legacy\n") {
    throw new Error(`write wrapper did not mutate through host adapter: ${JSON.stringify(legacyWriteResult)}`);
  }
  const legacyEditResult = await tools.get("edit").execute(
    "edit-call",
    { path: "legacy-write.txt", edits: [{ oldText: "legacy", newText: "edited" }] },
    undefined,
    undefined,
    ctx,
  );
  if (legacyEditResult.details?.ok !== true || (await readFile(legacyWriteTarget, "utf8")) !== "edited\n") {
    throw new Error(`edit wrapper did not mutate through host adapter: ${JSON.stringify(legacyEditResult)}`);
  }
  const deniedWriteResult = await tools.get("write").execute(
    "write-git-denied",
    { path: ".git/config", content: "bad\n" },
    undefined,
    undefined,
    ctx,
  );
  if (deniedWriteResult.details?.ok === true) {
    throw new Error(`write wrapper bypassed sandbox metadata denial: ${JSON.stringify(deniedWriteResult)}`);
  }
  const metadataDir = join(cwd, ".git");
  await mkdir(metadataDir, { recursive: true });
  const metadataConfig = join(metadataDir, "config");
  await writeFile(metadataConfig, "safe metadata\n", "utf8");
  await symlink(metadataDir, join(cwd, "gitlink"), "dir");
  const metadataSymlinkPatchResult = await tools.get("apply_patch").execute(
    "patch-metadata-symlink",
    patchInput([
      "*** Begin Patch",
      "*** Update File: gitlink/config",
      "@@",
      "-safe metadata",
      "+pwned metadata",
      "*** End Patch",
    ].join("\n")),
    undefined,
    undefined,
    ctx,
  );
  if (
    metadataSymlinkPatchResult.details?.ok === true ||
    (await readFile(metadataConfig, "utf8")) !== "safe metadata\n"
  ) {
    throw new Error(
      `apply_patch bypassed sandbox metadata symlink denial: ${JSON.stringify(metadataSymlinkPatchResult)}`,
    );
  }

  const escalationDir = await mkdtemp(join(tmpdir(), "taumel-escalation-"));
  try {
    const outsideWriteTarget = join(escalationDir, "approved-write.txt");
    const writeConfirmCount = confirmations.length;
    const approvedWriteResult = await tools.get("write").execute(
      "write-outside-approved",
      { path: outsideWriteTarget, content: "outside write\n" },
      undefined,
      undefined,
      ctx,
    );
    if (
      approvedWriteResult.details?.ok !== true ||
      (await readFile(outsideWriteTarget, "utf8")) !== "outside write\n" ||
      confirmations.length !== writeConfirmCount + 1 ||
      confirmations.at(-1)?.title !== "write: path outside workspace"
    ) {
      throw new Error(
        `write wrapper escalation did not approve outside workspace mutation: ${JSON.stringify({ approvedWriteResult, confirmations })}`,
      );
    }

    const outsideEditTarget = join(escalationDir, "approved-edit.txt");
    await writeFile(outsideEditTarget, "before edit\n", "utf8");
    const editConfirmCount = confirmations.length;
    const approvedEditResult = await tools.get("edit").execute(
      "edit-outside-approved",
      { path: outsideEditTarget, edits: [{ oldText: "before", newText: "after" }] },
      undefined,
      undefined,
      ctx,
    );
    if (
      approvedEditResult.details?.ok !== true ||
      (await readFile(outsideEditTarget, "utf8")) !== "after edit\n" ||
      confirmations.length !== editConfirmCount + 1 ||
      confirmations.at(-1)?.title !== "edit: path outside workspace"
    ) {
      throw new Error(
        `edit wrapper escalation did not approve outside workspace mutation: ${JSON.stringify({ approvedEditResult, confirmations })}`,
      );
    }

    const outsidePatchTarget = join(escalationDir, "approved-patch.txt");
    const patchConfirmCount = confirmations.length;
    const approvedPatchResult = await tools.get("apply_patch").execute(
      "patch-outside-approved",
      patchInput(["*** Begin Patch", `*** Add File: ${outsidePatchTarget}`, "+outside patch", "*** End Patch"].join("\n")),
      undefined,
      undefined,
      ctx,
    );
    if (
      approvedPatchResult.details?.ok !== true ||
      (await readFile(outsidePatchTarget, "utf8")) !== "outside patch\n" ||
      confirmations.length !== patchConfirmCount + 1 ||
      confirmations.at(-1)?.title !== "apply_patch: path outside workspace"
    ) {
      throw new Error(
        `apply_patch escalation did not approve outside workspace mutation: ${JSON.stringify({ approvedPatchResult, confirmations })}`,
      );
    }
  } finally {
    await rm(escalationDir, { recursive: true, force: true });
  }

  const target = join(cwd, "patched.txt");
  const patchResult = await tools.get("apply_patch").execute(
    "patch-call",
    patchInput(["*** Begin Patch", `*** Add File: ${target}`, "+patched", "*** End Patch"].join("\n")),
    undefined,
    undefined,
    ctx,
  );
  if (patchResult.details?.ok !== true || (await readFile(target, "utf8")) !== "patched\n") {
    throw new Error(`apply_patch did not apply through host adapter: ${JSON.stringify(patchResult)}`);
  }

  const relativeTarget = join(cwd, "relative.txt");
  const relativePatchResult = await tools.get("apply_patch").execute(
    "patch-relative",
    patchInput(["*** Begin Patch", "*** Add File: relative.txt", "+relative content", "*** End Patch"].join("\n")),
    undefined,
    undefined,
    ctx,
  );
  if (relativePatchResult.details?.ok !== true) {
    throw new Error(`relative apply_patch was denied: ${JSON.stringify(relativePatchResult)}`);
  }
  const relativeWritten = await readFile(relativeTarget, "utf8");
  if (relativeWritten !== "relative content\n") {
    throw new Error(
      `relative apply_patch wrote to wrong location: expected ${relativeTarget}, content was ${JSON.stringify(relativeWritten)}`,
    );
  }

  // Relative update: modify the relative file in place.
  const relativeUpdateResult = await tools.get("apply_patch").execute(
    "patch-relative-update",
    patchInput([
      "*** Begin Patch",
      "*** Update File: relative.txt",
      "@@",
      "-relative content",
      "+updated relative content",
      "*** End Patch",
    ].join("\n")),
    undefined,
    undefined,
    ctx,
  );
  if (relativeUpdateResult.details?.ok !== true) {
    throw new Error(`relative update apply_patch was denied: ${JSON.stringify(relativeUpdateResult)}`);
  }
  if ((await readFile(relativeTarget, "utf8")) !== "updated relative content\n") {
    throw new Error(`relative update did not modify the file: ${JSON.stringify(relativeUpdateResult)}`);
  }

  // Relative move: rename within the workspace.
  const movedTarget = join(cwd, "moved.txt");
  const relativeMoveResult = await tools.get("apply_patch").execute(
    "patch-relative-move",
    patchInput([
      "*** Begin Patch",
      "*** Update File: relative.txt",
      "*** Move to: moved.txt",
      "@@",
      "-updated relative content",
      "+moved content",
      "*** End Patch",
    ].join("\n")),
    undefined,
    undefined,
    ctx,
  );
  if (relativeMoveResult.details?.ok !== true) {
    throw new Error(`relative move apply_patch was denied: ${JSON.stringify(relativeMoveResult)}`);
  }
  if ((await readFile(movedTarget, "utf8")) !== "moved content\n") {
    throw new Error(`relative move did not create moved file: ${JSON.stringify(relativeMoveResult)}`);
  }
  try {
    await readFile(relativeTarget, "utf8");
    throw new Error(`relative move did not delete source file: ${relativeTarget}`);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  // Relative delete: remove a file via relative path.
  const deleteTarget = join(cwd, "to-delete.txt");
  await writeFile(deleteTarget, "delete me\n", "utf8");
  const relativeDeleteResult = await tools.get("apply_patch").execute(
    "patch-relative-delete",
    patchInput(["*** Begin Patch", "*** Delete File: to-delete.txt", "*** End Patch"].join("\n")),
    undefined,
    undefined,
    ctx,
  );
  if (relativeDeleteResult.details?.ok !== true) {
    throw new Error(`relative delete apply_patch was denied: ${JSON.stringify(relativeDeleteResult)}`);
  }
  try {
    await readFile(deleteTarget, "utf8");
    throw new Error(`relative delete did not remove file: ${deleteTarget}`);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }


  // Symlink escape: a symlink inside the workspace pointing outside must not be followed.
  const outsideDir = await mkdtemp(join(tmpdir(), "taumel-outside-"));
  try {
    const linkPath = join(cwd, "outside-link");
    await symlink(outsideDir, linkPath, "dir");
    const escapePatchResult = await tools.get("apply_patch").execute(
      "patch-symlink-escape",
      patchInput(["*** Begin Patch", "*** Add File: outside-link/pwned.txt", "+escaped", "*** End Patch"].join("\n")),
      undefined,
      undefined,
      ctx,
    );
    if (escapePatchResult.details?.ok === true) {
      throw new Error(`symlink escape apply_patch was allowed: ${JSON.stringify(escapePatchResult)}`);
    }
    const escapeWriteResult = await tools.get("write").execute(
      "write-symlink-escape",
      { path: "outside-link/write-pwned.txt", content: "escaped" },
      undefined,
      undefined,
      ctx,
    );
    if (escapeWriteResult.details?.ok === true) {
      throw new Error(`symlink escape write was allowed: ${JSON.stringify(escapeWriteResult)}`);
    }
    const outsideEditFile = join(outsideDir, "edit-target.txt");
    await writeFile(outsideEditFile, "safe\n", "utf8");
    const escapeEditResult = await tools.get("edit").execute(
      "edit-symlink-escape",
      { path: "outside-link/edit-target.txt", edits: [{ oldText: "safe", newText: "escaped" }] },
      undefined,
      undefined,
      ctx,
    );
    if (escapeEditResult.details?.ok === true || (await readFile(outsideEditFile, "utf8")) !== "safe\n") {
      throw new Error(`symlink escape edit was allowed: ${JSON.stringify(escapeEditResult)}`);
    }
    try {
      await readFile(join(outsideDir, "pwned.txt"), "utf8");
      throw new Error("symlink escape wrote outside the workspace");
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    try {
      await readFile(join(outsideDir, "write-pwned.txt"), "utf8");
      throw new Error("symlink escape write wrote outside the workspace");
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }

    const fullAccessPermission = await commands.get("permissions").handler("sandbox full-access", ctx);
    if (
      fullAccessPermission.action !== "command_result" ||
      !fullAccessPermission.message.includes("sandbox=danger-full-access") ||
      !fullAccessPermission.message.includes("network=enabled")
    ) {
      throw new Error(`full-access permissions did not enable network: ${JSON.stringify(fullAccessPermission)}`);
    }

    const asyncExecResult = await tools.get("exec_command").execute(
      "exec-async",
      { cmd: "sleep 0.5; echo delayed-output", workdir: cwd, yield_time_ms: 25 },
      undefined,
      undefined,
      ctx,
    );
    const sessionId = asyncExecResult.details?.sessionId;
    if (typeof sessionId !== "number" || asyncExecResult.content?.[0]?.text.includes("delayed-output")) {
      throw new Error(`exec_command did not yield a running session: ${JSON.stringify(asyncExecResult)}`);
    }
    const stdinResult = await tools
      .get("write_stdin")
      .execute("stdin-call", { session_id: sessionId, chars: "", yield_time_ms: 10 }, undefined, undefined, ctx);
    if (stdinResult.details?.exitCode !== 0 || !stdinResult.content?.[0]?.text.includes("delayed-output")) {
      throw new Error(`write_stdin did not poll session output: ${JSON.stringify({ stdinCalls, stdinResult })}`);
    }

    const fullAccessTarget = join(outsideDir, "full-access.txt");
    const fullAccessResult = await tools.get("apply_patch").execute(
      "patch-full-access-outside",
      patchInput(["*** Begin Patch", `*** Add File: ${fullAccessTarget}`, "+allowed", "*** End Patch"].join("\n")),
      undefined,
      undefined,
      ctx,
    );
    if (fullAccessResult.details?.ok !== true || (await readFile(fullAccessTarget, "utf8")) !== "allowed\n") {
      throw new Error(`full-access apply_patch was denied: ${JSON.stringify(fullAccessResult)}`);
    }
    const workspacePermission = await commands.get("permissions").handler("sandbox workspace-write", ctx);
    if (!workspacePermission.message.includes("network=disabled")) {
      throw new Error(`workspace permissions did not reset network: ${JSON.stringify(workspacePermission)}`);
    }
  } finally {
    await commands.get("permissions").handler("sandbox workspace-write", ctx);
    await rm(outsideDir, { recursive: true, force: true });
  }

  const usageResult = await commands.get("usage").handler("", ctx);
  if (
    usageResult.ok !== true ||
    usageResult.action !== "command_result" ||
    fetchCalls.length !== 1
  ) {
    throw new Error(`usage command did not reach OCaml Eta HTTP client: ${JSON.stringify({ usageResult, fetchCalls })}`);
  }

  const agentProfiles = await tools.get("agent_profiles").execute(
    "agent-profiles",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    agentProfiles.details?.ok !== true ||
    !agentProfiles.details?.profiles?.some((profile) => profile.name === "finder") ||
    !agentProfiles.details?.profiles?.some((profile) => profile.name === "scout") ||
    agentProfiles.details?.profiles?.some((profile) => profile.name === "plan") ||
    !agentProfiles.content?.[0]?.text?.includes("scout [enabled=true]") ||
    !agentProfiles.content?.[0]?.text?.includes("Temporary smoke-test scanner") ||
    !agentProfiles.content?.[0]?.text?.includes("sandbox=read-only") ||
    !agentProfiles.content?.[0]?.text?.includes("tools=exec_command")
  ) {
    throw new Error(`agent_profiles did not return the PRD built-in catalog: ${JSON.stringify(agentProfiles)}`);
  }
  selectBehavior = async (_title, labels) => labels.find((label) => label.startsWith("Disable scout ")) ?? null;
  const menuDisableScout = await commands.get("agents").handler("", ctx);
  const savedScoutMenuState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    menuDisableScout.action !== "command_result" ||
    !menuDisableScout.message.includes("scout disabled") ||
    !selections.at(-1)?.title.includes("Taumel agent profiles") ||
    !selections.at(-1)?.labels.some((label) => label.includes("Temporary smoke-test scanner")) ||
    savedScoutMenuState?.data?.profiles?.find((profile) => profile.name === "scout")?.enabled !== false
  ) {
    throw new Error(`agents menu did not toggle and persist a user profile: ${JSON.stringify({ menuDisableScout, savedScoutMenuState, selections })}`);
  }
  selectBehavior = async (_title, labels) => labels[0];
  const disableScout = await commands.get("agents").handler("disable scout", ctx);
  const savedScoutDisabledState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    disableScout.action !== "command_result" ||
    !disableScout.message.includes("scout disabled") ||
    savedScoutDisabledState?.data?.profiles?.find((profile) => profile.name === "scout")?.enabled !== false
  ) {
    throw new Error(`agents disable did not persist user profile toggle: ${JSON.stringify({ disableScout, savedScoutDisabledState })}`);
  }
  const enableScout = await commands.get("agents").handler("enable scout", ctx);
  const savedScoutEnabledState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    enableScout.action !== "command_result" ||
    !enableScout.message.includes("scout enabled") ||
    savedScoutEnabledState?.data?.profiles?.find((profile) => profile.name === "scout")?.enabled !== true
  ) {
    throw new Error(`agents enable did not persist user profile toggle: ${JSON.stringify({ enableScout, savedScoutEnabledState })}`);
  }
  const disableFinder = await commands.get("agents").handler("disable finder", ctx);
  const savedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    disableFinder.action !== "command_result" ||
    !disableFinder.message.includes("finder disabled") ||
    savedAgentsState?.data?.profiles?.find((profile) => profile.name === "finder")?.enabled !== false
  ) {
    throw new Error(`agents disable did not persist profile toggle: ${JSON.stringify({ disableFinder, savedAgentsState })}`);
  }
  const disabledProfiles = await tools.get("agent_profiles").execute(
    "agent-profiles-disabled",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    disabledProfiles.details?.profiles?.find((profile) => profile.name === "finder")?.enabled !== false ||
    !disabledProfiles.content?.[0]?.text?.includes("finder [enabled=false]") ||
    !disabledProfiles.content?.[0]?.text?.includes("disabledReason=disabled for this session")
  ) {
    throw new Error(`agent_profiles did not expose disabled profile state: ${JSON.stringify(disabledProfiles)}`);
  }
  const disabledSpawn = await tools.get("agent_spawn").execute(
    "agent-disabled-spawn",
    { profile: "finder", objective: "should be blocked", agent_id: "finder-disabled" },
    undefined,
    undefined,
    ctx,
  );
  if (
    disabledSpawn.details?.ok === true ||
    !disabledSpawn.content?.[0]?.text?.includes("/agents enable finder")
  ) {
    throw new Error(`agent_spawn did not reject disabled profile: ${JSON.stringify(disabledSpawn)}`);
  }
  const enableFinder = await commands.get("agents").handler("enable finder", ctx);
  if (
    enableFinder.action !== "command_result" ||
    !enableFinder.message.includes("finder enabled")
  ) {
    throw new Error(`agents enable did not update profile toggle: ${JSON.stringify(enableFinder)}`);
  }
  const unknownProfileSpawn = await tools.get("agent_spawn").execute(
    "agent-unknown-profile",
    { profile: "worker", objective: "should be rejected", agent_id: "unknown-profile" },
    undefined,
    undefined,
    ctx,
  );
  if (
    unknownProfileSpawn.details?.ok === true ||
    !unknownProfileSpawn.content?.[0]?.text?.includes("unknown agent profile: worker")
  ) {
    throw new Error(`agent_spawn accepted an unknown profile: ${JSON.stringify(unknownProfileSpawn)}`);
  }
  const invalidAgentIdSpawn = await tools.get("agent_spawn").execute(
    "agent-invalid-id",
    { profile: "finder", objective: "invalid id", agent_id: "Bad_Id" },
    undefined,
    undefined,
    ctx,
  );
  if (
    invalidAgentIdSpawn.details?.ok === true ||
    !invalidAgentIdSpawn.content?.[0]?.text?.includes("invalid agent_id")
  ) {
    throw new Error(`agent_spawn accepted an invalid agent id: ${JSON.stringify(invalidAgentIdSpawn)}`);
  }
  const generatedAgent = await tools.get("agent_spawn").execute(
    "agent-generated-id",
    { profile: "finder", objective: "spawn with generated id" },
    undefined,
    undefined,
    ctx,
  );
  const generatedAgentId = generatedAgent.details?.agent_id;
  if (
    generatedAgent.details?.ok !== true ||
    typeof generatedAgentId !== "string" ||
    !/^finder-[a-z0-9]{4}$/.test(generatedAgentId) ||
    generatedAgent.details?.run_id !== `${generatedAgentId}-run-1`
  ) {
    throw new Error(`agent_spawn did not generate a PRD-shaped agent id: ${JSON.stringify(generatedAgent)}`);
  }
  selectBehavior = async (_title, labels) => labels.find((label) => label.startsWith(`Close ${generatedAgentId} `)) ?? null;
  const closeGeneratedFromMenu = await commands.get("agent-runs").handler("", ctx);
  const closedGeneratedState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    closeGeneratedFromMenu.action !== "command_result" ||
    !closeGeneratedFromMenu.message.includes(`Closed ${generatedAgentId}`) ||
    !selections.at(-1)?.title.includes("Taumel agent runs") ||
    closedGeneratedState?.data?.agents?.find((agent) => agent.agent_id === generatedAgentId)?.closed_at === undefined
  ) {
    throw new Error(`agent-runs menu did not close generated agent: ${JSON.stringify({ closeGeneratedFromMenu, closedGeneratedState, selections })}`);
  }
  const openRunList = await commands.get("agent-runs").handler("list", ctx);
  const allRunList = await commands.get("agent-runs").handler("list all", ctx);
  if (
    openRunList.message.includes(generatedAgentId) ||
    !allRunList.message.includes(generatedAgentId)
  ) {
    throw new Error(`agent-runs list did not keep closed history behind explicit filter: ${JSON.stringify({ openRunList, allRunList })}`);
  }
  selectBehavior = async (_title, labels) => labels[0];

  let resolveAsyncSpawn;
  childSendResponses.push(new Promise((resolve) => { resolveAsyncSpawn = resolve; }));
  const asyncSpawn = await tools.get("agent_spawn").execute(
    "agent-async-spawn",
    { profile: "finder", objective: "finish later", agent_id: "async-worker" },
    undefined,
    undefined,
    ctx,
  );
  const asyncSpawnState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const asyncSpawnRun = asyncSpawnState?.data?.runs?.find((run) => run.run_id === "async-worker-run-1");
  if (
    asyncSpawn.details?.ok !== true ||
    asyncSpawn.details?.run_id !== "async-worker-run-1" ||
    asyncSpawnRun?.status !== "running"
  ) {
    throw new Error(`agent_spawn did not return before delayed child completion: ${JSON.stringify({ asyncSpawn, asyncSpawnState })}`);
  }
  resolveAsyncSpawn({ output: "async spawn final output", status: "completed" });
  await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "async-worker-run-1");
    return run?.status === "completed" && run?.final_output === "async spawn final output";
  }, "agent_spawn delayed completion was not recorded");
  await tools.get("agent_close").execute(
    "agent-async-close",
    { agent_ids: ["async-worker"] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push({ stopReason: "timed_out", suppressAgentEndEvent: true });
  const hostTimeoutSpawn = await tools.get("agent_spawn").execute(
    "agent-host-timeout-spawn",
    { profile: "finder", objective: "host timeout only", agent_id: "host-timeout-worker" },
    undefined,
    undefined,
    ctx,
  );
  const hostTimeout = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "host-timeout-worker-run-1");
    return run?.status === "timed_out" ? { state, run } : undefined;
  }, "host-result child timeout stopReason was not recorded");
  if (
    hostTimeoutSpawn.details?.ok !== true ||
    hostTimeout.run?.reason !== "timed_out"
  ) {
    throw new Error(`agent_spawn classified host-result timed_out stopReason incorrectly: ${JSON.stringify({ hostTimeoutSpawn, hostTimeout })}`);
  }
  await tools.get("agent_close").execute(
    "agent-host-timeout-close",
    { agent_ids: ["host-timeout-worker"] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push({
    agentEndMessage: {
      role: "assistant",
      content: [],
      stopReason: "timed_out",
    },
  });
  const eventTimeoutSpawn = await tools.get("agent_spawn").execute(
    "agent-event-timeout-spawn",
    { profile: "finder", objective: "event timeout only", agent_id: "event-timeout-worker" },
    undefined,
    undefined,
    ctx,
  );
  const eventTimeout = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "event-timeout-worker-run-1");
    return run?.status === "timed_out" ? { state, run } : undefined;
  }, "agent_end child timeout stopReason was not recorded");
  if (
    eventTimeoutSpawn.details?.ok !== true ||
    eventTimeout.run?.reason !== "timed_out"
  ) {
    throw new Error(`agent_spawn classified agent_end timed_out stopReason incorrectly: ${JSON.stringify({ eventTimeoutSpawn, eventTimeout })}`);
  }
  await tools.get("agent_close").execute(
    "agent-event-timeout-close",
    { agent_ids: ["event-timeout-worker"] },
    undefined,
    undefined,
    ctx,
  );

  nextAgentSessionResult = {};
  const failedDispatchSpawn = await tools.get("agent_spawn").execute(
    "agent-dispatch-failed-spawn",
    { profile: "finder", objective: "cannot start child", agent_id: "failed-dispatch-worker" },
    undefined,
    undefined,
    ctx,
  );
  const failedDispatchSpawnState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const failedDispatchSpawnAgent = failedDispatchSpawnState?.data?.agents?.find((agent) => agent.agent_id === "failed-dispatch-worker");
  const failedDispatchSpawnRun = failedDispatchSpawnState?.data?.runs?.find((run) => run.run_id === "failed-dispatch-worker-run-1");
  if (
    failedDispatchSpawn.details?.ok !== false ||
    failedDispatchSpawn.details?.dispatchFailed !== true ||
    failedDispatchSpawn.details?.dispatch?.dispatched !== false ||
    failedDispatchSpawn.details?.dispatch?.reason !== "createAgentSession did not return a session" ||
    !Array.isArray(failedDispatchSpawnAgent?.active_tools) ||
    !failedDispatchSpawnAgent.active_tools.includes("exec_command") ||
    failedDispatchSpawnRun?.status !== "failed" ||
    failedDispatchSpawnRun?.reason !== "createAgentSession did not return a session"
  ) {
    throw new Error(`agent_spawn dispatch failure did not fail the persisted run: ${JSON.stringify({ failedDispatchSpawn, failedDispatchSpawnState })}`);
  }
  const failedDispatchWait = await tools.get("agent_wait").execute(
    "agent-dispatch-failed-wait",
    { run_ids: ["failed-dispatch-worker-run-1"], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    failedDispatchWait.details?.runs?.find((run) => run.run_id === "failed-dispatch-worker-run-1")?.status !== "failed" ||
    failedDispatchWait.details?.runs?.find((run) => run.run_id === "failed-dispatch-worker-run-1")?.error !== "createAgentSession did not return a session" ||
    failedDispatchWait.details?.runs?.find((run) => run.run_id === "failed-dispatch-worker-run-1")?.consumed !== true
  ) {
    throw new Error(`agent_wait did not observe failed dispatch as terminal: ${JSON.stringify(failedDispatchWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-dispatch-failed-close",
    { agent_ids: ["failed-dispatch-worker"] },
    undefined,
    undefined,
    ctx,
  );

  const failedSendWorker = await tools.get("agent_spawn").execute(
    "agent-send-dispatch-failure-spawn",
    { profile: "finder", objective: "start before failed send", agent_id: "failed-send-worker" },
    undefined,
    undefined,
    ctx,
  );
  if (failedSendWorker.details?.ok !== true || failedSendWorker.details?.run_id !== "failed-send-worker-run-1") {
    throw new Error(`agent_send dispatch failure setup spawn failed: ${JSON.stringify(failedSendWorker)}`);
  }
  nextAgentSessionResult = {};
  const failedDispatchSend = await tools.get("agent_send").execute(
    "agent-send-dispatch-failure",
    { agent_id: "failed-send-worker", objective: "replace with failed dispatch", interrupt: true },
    undefined,
    undefined,
    ctx,
  );
  const failedDispatchSendState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const failedDispatchOldRun = failedDispatchSendState?.data?.runs?.find((run) => run.run_id === "failed-send-worker-run-1");
  const failedDispatchNewRun = failedDispatchSendState?.data?.runs?.find((run) => run.run_id === "failed-send-worker-run-2");
  if (
    failedDispatchSend.details?.ok !== false ||
    failedDispatchSend.details?.run_id !== "failed-send-worker-run-2" ||
    failedDispatchSend.details?.dispatchFailed !== true ||
    failedDispatchSend.details?.dispatch?.dispatched !== false ||
    failedDispatchOldRun?.status !== "cancelled" ||
    failedDispatchNewRun?.status !== "failed" ||
    failedDispatchNewRun?.reason !== "createAgentSession did not return a session"
  ) {
    throw new Error(`agent_send dispatch failure did not fail the replacement run: ${JSON.stringify({ failedDispatchSend, failedDispatchSendState })}`);
  }
  await tools.get("agent_close").execute(
    "agent-send-dispatch-failure-close",
    { agent_ids: ["failed-send-worker"] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push({
    agentEndMessage: {
      role: "assistant",
      content: [],
      stopReason: "stop",
    },
  });
  const successfulNoOutputSpawn = await tools.get("agent_spawn").execute(
    "agent-successful-no-output-spawn",
    { profile: "finder", objective: "successful no output", agent_id: "successful-no-output-worker" },
    undefined,
    undefined,
    ctx,
  );
  const successfulNoOutput = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "successful-no-output-worker-run-1");
    return run?.status === "completed" ? { state, run } : undefined;
  }, "successful terminal child without assistant output was not recorded");
  if (
    successfulNoOutputSpawn.details?.ok !== true ||
    successfulNoOutput.run?.final_output !== null ||
    successfulNoOutput.run?.reason !== null
  ) {
    throw new Error(`agent_spawn did not persist textless successful terminal child correctly: ${JSON.stringify({ successfulNoOutputSpawn, successfulNoOutput })}`);
  }
  const successfulNoOutputWait = await tools.get("agent_wait").execute(
    "agent-successful-no-output-wait",
    { run_ids: ["successful-no-output-worker-run-1"], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const successfulNoOutputWaitRun = successfulNoOutputWait.details?.runs?.find((run) => run.run_id === "successful-no-output-worker-run-1");
  if (
    successfulNoOutputWaitRun?.status !== "completed" ||
    successfulNoOutputWaitRun?.finalOutput !== null ||
    successfulNoOutputWaitRun?.consumed !== true
  ) {
    throw new Error(`agent_wait did not surface textless successful terminal child: ${JSON.stringify(successfulNoOutputWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-successful-no-output-close",
    { agent_ids: ["successful-no-output-worker"] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push({
    agentEndMessage: {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "provider returned error without assistant output",
    },
  });
  const terminalNoOutputSpawn = await tools.get("agent_spawn").execute(
    "agent-terminal-no-output-spawn",
    { profile: "finder", objective: "terminal no output", agent_id: "terminal-no-output-worker" },
    undefined,
    undefined,
    ctx,
  );
  const terminalNoOutput = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "terminal-no-output-worker-run-1");
    return run?.status === "failed" &&
      run?.reason === "provider returned error without assistant output"
      ? { state, run }
      : undefined;
  }, "terminal child error without assistant output was not recorded");
  if (
    terminalNoOutputSpawn.details?.ok !== true ||
    terminalNoOutput.run?.final_output !== null
  ) {
    throw new Error(`agent_spawn did not persist textless terminal child error correctly: ${JSON.stringify({ terminalNoOutputSpawn, terminalNoOutput })}`);
  }
  const terminalNoOutputWait = await tools.get("agent_wait").execute(
    "agent-terminal-no-output-wait",
    { run_ids: ["terminal-no-output-worker-run-1"], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const terminalNoOutputWaitRun = terminalNoOutputWait.details?.runs?.find((run) => run.run_id === "terminal-no-output-worker-run-1");
  if (
    terminalNoOutputWaitRun?.status !== "failed" ||
    terminalNoOutputWaitRun?.error !== "provider returned error without assistant output" ||
    terminalNoOutputWaitRun?.consumed !== true
  ) {
    throw new Error(`agent_wait did not surface textless terminal child error: ${JSON.stringify(terminalNoOutputWait)}`);
  }
  const terminalErrorList = await tools.get("agent_list").execute(
    "agent-list-terminal-error",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    !terminalErrorList.content?.[0]?.text?.includes("terminal-no-output-worker-run-1 [failed] elapsed=") ||
    !terminalErrorList.content?.[0]?.text?.includes("error=provider returned error without assistant output")
  ) {
    throw new Error(`agent_list did not expose terminal error in model-visible text: ${JSON.stringify(terminalErrorList)}`);
  }
  await tools.get("agent_close").execute(
    "agent-terminal-no-output-close",
    { agent_ids: ["terminal-no-output-worker"] },
    undefined,
    undefined,
    ctx,
  );

  const agentSessionCountBeforeSmoke = agentSessionCalls.length;
  const agentResult = await tools.get("agent_spawn").execute(
    "agent-call",
    { profile: "finder", objective: "spawn smoke worker", description: "Smoke worker label", agent_id: "smoke-worker" },
    undefined,
    undefined,
    ctx,
  );
  if (agentSessionCalls.length !== agentSessionCountBeforeSmoke + 1 || agentResult.details?.childSession?.created !== true) {
    throw new Error(`agent spawn did not create a child session through SDK adapter: ${JSON.stringify(agentResult)}`);
  }
  const smokeSessionOptions = agentSessionCalls.at(-1);
  if (
    smokeSessionOptions?.model?.provider !== "openai-codex" ||
    smokeSessionOptions?.model?.id !== "gpt-override" ||
    smokeSessionOptions?.thinkingLevel !== "high"
  ) {
    throw new Error(`agent spawn did not apply built-in profile override: ${JSON.stringify(smokeSessionOptions)}`);
  }
  const agentChildSessionId = `child-${childCounter}`;
  const agentChildEntries = customEntries.filter((entry) => entry.sessionId === agentChildSessionId);
  const agentChildMetadata = agentChildEntries.find((entry) => entry.type === "taumel.childSession")?.value;
  if (
    agentChildMetadata?.kind !== "agent" ||
    !agentChildMetadata?.agentSystemPrompt?.includes("You are the finder Taumel subagent")
  ) {
    throw new Error(`agent child did not persist the profile prompt in child metadata: ${JSON.stringify(agentChildEntries)}`);
  }
  if (
    agentResult.details?.worker?.parentId !== "parent-session" ||
    agentResult.details?.worker?.depth !== 1 ||
    agentResult.details?.run_id !== "smoke-worker-run-1" ||
    agentResult.details?.submission_id !== "smoke-worker-run-1-submission-1" ||
    agentResult.details?.deliveryKind !== "started"
  ) {
    throw new Error(`agent spawn did not record root ownership: ${JSON.stringify(agentResult)}`);
  }
  const spawnedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const persistedSmokeAgent = spawnedAgentsState?.data?.agents?.find((agent) => agent.agent_id === "smoke-worker");
  const persistedSmokeRun = spawnedAgentsState?.data?.runs?.find((run) => run.run_id === "smoke-worker-run-1");
  if (
    persistedSmokeAgent?.profile !== "finder" ||
    persistedSmokeAgent?.child_session_id !== agentResult.details.childSession.sessionId ||
    persistedSmokeAgent?.profile_snapshot?.modelId !== "openai-codex/gpt-override" ||
    persistedSmokeAgent?.profile_snapshot?.thinkingLevel !== "high" ||
    persistedSmokeAgent?.sandbox_snapshot?.filesystemMode !== "workspace-write" ||
    !persistedSmokeAgent?.system_prompt?.includes("You are the finder Taumel subagent") ||
    !persistedSmokeAgent?.active_tools?.includes("exec_command") ||
    persistedSmokeRun?.status !== "running" ||
    persistedSmokeRun?.description !== "Smoke worker label"
  ) {
    throw new Error(`agent spawn did not persist agent/run metadata: ${JSON.stringify(spawnedAgentsState)}`);
  }
  const listedAgents = await tools.get("agent_list").execute(
    "agent-list",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    listedAgents.details?.agents?.find((agent) => agent.agent_id === "smoke-worker")?.run_state !== "running" ||
    typeof listedAgents.details?.agents?.find((agent) => agent.agent_id === "smoke-worker")?.latestRun?.elapsedSeconds !== "number" ||
    !listedAgents.content?.[0]?.text?.includes("smoke-worker-run-1 [running] elapsed=")
  ) {
    throw new Error(`agent_list did not report durable run metadata: ${JSON.stringify(listedAgents)}`);
  }
  const sendAgent = await tools.get("agent_send").execute(
    "agent-send",
    { agent_id: "smoke-worker", objective: "continue smoke worker" },
    undefined,
    undefined,
    ctx,
  );
  const sentAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const sentRun = sentAgentsState?.data?.runs?.find((run) => run.run_id === "smoke-worker-run-1");
  if (
    sendAgent.details?.deliveryKind !== "steered" ||
    sendAgent.details?.submission_id !== "smoke-worker-run-1-submission-2" ||
    sentRun?.submissions?.length !== 2
  ) {
    throw new Error(`agent_send did not steer and persist a submission: ${JSON.stringify({ sendAgent, sentAgentsState })}`);
  }
  if (
    !childDispatchCalls.some((call) =>
      call.sessionId === agentResult.details.childSession.sessionId &&
      call.options?.streamingBehavior === "steer"
    )
  ) {
    throw new Error(`agent_send did not dispatch the active send as steer: ${JSON.stringify(childDispatchCalls)}`);
  }
  const waitActive = await tools.get("agent_wait").execute(
    "agent-wait-active",
    { timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitActive.details?.status !== "ok" ||
    waitActive.details?.runs?.find((run) => run.run_id === "smoke-worker-run-1")?.status !== "running"
  ) {
    throw new Error(`agent_wait did not report active persisted run: ${JSON.stringify(waitActive)}`);
  }
  const waitByRun = await tools.get("agent_wait").execute(
    "agent-wait-by-run",
    { run_ids: ["smoke-worker-run-1"], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitByRun.details?.runs?.find((run) => run.run_id === "smoke-worker-run-1")?.consumed !== false
  ) {
    throw new Error(`agent_wait consumed a non-terminal run: ${JSON.stringify(waitByRun)}`);
  }
  const waitTimedOut = await tools.get("agent_wait").execute(
    "agent-wait-timeout",
    { run_ids: ["smoke-worker-run-1"], timeout_seconds: 0.01 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitTimedOut.details?.waitTimedOut !== true ||
    waitTimedOut.details?.status !== "timed_out" ||
    waitTimedOut.details?.runs?.find((run) => run.run_id === "smoke-worker-run-1")?.status !== "running"
  ) {
    throw new Error(`agent_wait timeout did not return a non-cancelling wait result: ${JSON.stringify(waitTimedOut)}`);
  }
  const interruptController = new AbortController();
  const interruptedWait = tools.get("agent_wait").execute(
    "agent-wait-interrupted",
    { run_ids: ["smoke-worker-run-1"] },
    interruptController.signal,
    undefined,
    ctx,
  );
  setTimeout(() => interruptController.abort(), 20);
  const interruptedWaitResult = await Promise.race([
    interruptedWait,
    new Promise((_, reject) => setTimeout(() => reject(new Error("agent_wait did not return after interruption")), 1000)),
  ]);
  if (
    interruptedWaitResult.details?.waitInterrupted !== true ||
    interruptedWaitResult.details?.status !== "interrupted" ||
    interruptedWaitResult.details?.runs?.find((run) => run.run_id === "smoke-worker-run-1")?.status !== "running"
  ) {
    throw new Error(`agent_wait interruption did not return a non-cancelling wait result: ${JSON.stringify(interruptedWaitResult)}`);
  }
  const invalidWait = await tools.get("agent_wait").execute(
    "agent-wait-invalid",
    { run_ids: ["smoke-worker-run-1"], agent_ids: ["smoke-worker"] },
    undefined,
    undefined,
    ctx,
  );
  if (
    invalidWait.details?.ok === true ||
    !invalidWait.content?.[0]?.text?.includes("exactly one selector")
  ) {
    throw new Error(`agent_wait accepted conflicting selectors: ${JSON.stringify(invalidWait)}`);
  }
  const waitWorker = await tools.get("agent_spawn").execute(
    "agent-wait-loop-spawn",
    { profile: "finder", objective: "wait loop worker", agent_id: "wait-worker" },
    undefined,
    undefined,
    ctx,
  );
  if (waitWorker.details?.ok !== true || waitWorker.details?.run_id !== "wait-worker-run-1") {
    throw new Error(`agent_wait setup spawn failed: ${JSON.stringify(waitWorker)}`);
  }
  const waitLoop = tools.get("agent_wait").execute(
    "agent-wait-loop",
    { run_ids: ["wait-worker-run-1"] },
    undefined,
    undefined,
    ctx,
  );
  setTimeout(() => {
    globalThis.taumel.call("recordAgentDispatchCompletion", [{
      prepared: { run_id: "wait-worker-run-1" },
      completion: { status: "completed", finalOutput: "wait loop final output" },
    }, ctx]);
  }, 20);
  const waitLoopResult = await Promise.race([
    waitLoop,
    new Promise((_, reject) => setTimeout(() => reject(new Error("agent_wait omitted timeout did not return after completion")), 1000)),
  ]);
  if (
    waitLoopResult.details?.runs?.find((run) => run.run_id === "wait-worker-run-1")?.status !== "completed" ||
    waitLoopResult.details?.runs?.find((run) => run.run_id === "wait-worker-run-1")?.finalOutput !== "wait loop final output" ||
    waitLoopResult.details?.runs?.find((run) => run.run_id === "wait-worker-run-1")?.consumed !== true
  ) {
    throw new Error(`agent_wait did not wait for terminal run output: ${JSON.stringify(waitLoopResult)}`);
  }
  await tools.get("agent_close").execute(
    "agent-wait-loop-close",
    { agent_ids: ["wait-worker"] },
    undefined,
    undefined,
    ctx,
  );
  const stoppedRun = await commands.get("agent-runs").handler("stop smoke-worker", ctx);
  const stoppedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const stoppedPersistedRun = stoppedAgentsState?.data?.runs?.find((run) => run.run_id === "smoke-worker-run-1");
  if (
    stoppedRun.action !== "command_result" ||
    !stoppedRun.message.includes("Stopped smoke-worker") ||
    stoppedPersistedRun?.status !== "cancelled" ||
    stoppedPersistedRun?.reason !== "stopped_by_parent"
  ) {
    throw new Error(`agent-runs stop did not cancel persisted active run: ${JSON.stringify({ stoppedRun, stoppedAgentsState })}`);
  }
  if (
    !childLifecycleCalls.some((call) =>
      call.sessionId === agentResult.details.childSession.sessionId &&
      call.method === "abort" &&
      call.reason === "stopped_by_parent"
    )
  ) {
    throw new Error(`agent-runs stop did not abort the live child session: ${JSON.stringify(childLifecycleCalls)}`);
  }
  const outputRun = await commands.get("agent-runs").handler("output smoke-worker", ctx);
  if (
    outputRun.action !== "command_result" ||
    !outputRun.message.includes("No final output for smoke-worker-run-1 [cancelled]") ||
    outputRun.details?.run?.status !== "cancelled"
  ) {
    throw new Error(`agent-runs output did not report persisted run output/status: ${JSON.stringify(outputRun)}`);
  }
  const stopAgain = await commands.get("agent-runs").handler("stop smoke-worker", ctx);
  if (
    stopAgain.action !== "command_result" ||
    !stopAgain.message.includes("No active run for smoke-worker")
  ) {
    throw new Error(`agent-runs stop should be idempotent for inactive runs: ${JSON.stringify(stopAgain)}`);
  }
  childSendResponses.push({ output: "final smoke summary", status: "completed" });
  const completionMessageCount = sentMessages.length;
  const completedSend = await tools.get("agent_send").execute(
    "agent-send-completes",
    { agent_id: "smoke-worker", objective: "finish with a summary" },
    undefined,
    undefined,
    ctx,
  );
  const completed = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "smoke-worker-run-2");
    return run?.status === "completed" && run?.final_output === "final smoke summary"
      ? { state, run }
      : undefined;
  }, "agent_send did not persist host-returned final output");
  if (
    completedSend.details?.run_id !== "smoke-worker-run-2" ||
    completed.run?.status !== "completed" ||
    completed.run?.final_output !== "final smoke summary"
  ) {
    throw new Error(`agent_send did not persist host-returned final output: ${JSON.stringify({ completedSend, completedAgentsState: completed.state })}`);
  }
  const completedList = await tools.get("agent_list").execute(
    "agent-list-completed-run",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    !completedList.content?.[0]?.text?.includes("smoke-worker-run-2 [completed] elapsed=") ||
    !completedList.content?.[0]?.text?.includes("final=final smoke summary")
  ) {
    throw new Error(`agent_list did not expose terminal final output in model-visible text: ${JSON.stringify(completedList)}`);
  }
  const completionMessage = await waitFor(() => {
    const message = sentMessages.at(-1);
    return sentMessages.length === completionMessageCount + 1 &&
      message?.message?.customType === "taumel.agent.completion"
      ? message
      : undefined;
  }, "agent completion notification was not delivered");
  if (
    sentMessages.length !== completionMessageCount + 1 ||
    completionMessage?.message?.customType !== "taumel.agent.completion" ||
    completionMessage?.message?.display !== true ||
    !completionMessage.message.content.includes("smoke-worker-run-2") ||
    !completionMessage.message.content.includes("final smoke summary") ||
    completionMessage?.options?.triggerTurn !== true ||
    completionMessage?.options?.deliverAs !== "followUp"
  ) {
    throw new Error(`agent completion was not delivered visibly to the parent: ${JSON.stringify(sentMessages.slice(completionMessageCount))}`);
  }
  const backgroundNotified = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === "smoke-worker-run-2");
    return run?.background_notified === true ? { state, run } : undefined;
  }, "agent completion delivery did not persist background notification metadata");
  if (backgroundNotified.run?.consumed !== false) {
    throw new Error(`background completion notification should not mark the run consumed: ${JSON.stringify(backgroundNotified)}`);
  }
  const waitCompleted = await tools.get("agent_wait").execute(
    "agent-wait-completed-run",
    { run_ids: ["smoke-worker-run-2"], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitCompleted.details?.runs?.find((run) => run.run_id === "smoke-worker-run-2")?.finalOutput !== "final smoke summary" ||
    waitCompleted.details?.runs?.find((run) => run.run_id === "smoke-worker-run-2")?.consumed !== true ||
    waitCompleted.details?.runs?.find((run) => run.run_id === "smoke-worker-run-2")?.backgroundNotified !== true ||
    !waitCompleted.content?.[0]?.text?.includes("final smoke summary")
  ) {
    throw new Error(`agent_wait did not expose completed final output: ${JSON.stringify(waitCompleted)}`);
  }
  const defaultWaitSpawn = await tools.get("agent_spawn").execute(
    "agent-default-wait-spawn",
    { profile: "finder", objective: "default wait worker", agent_id: "default-wait-worker" },
    undefined,
    undefined,
    ctx,
  );
  if (defaultWaitSpawn.details?.ok !== true || defaultWaitSpawn.details?.run_id !== "default-wait-worker-run-1") {
    throw new Error(`default agent_wait setup spawn failed: ${JSON.stringify(defaultWaitSpawn)}`);
  }
  const defaultWait = tools.get("agent_wait").execute(
    "agent-default-wait-loop",
    {},
    undefined,
    undefined,
    ctx,
  );
  setTimeout(() => {
    globalThis.taumel.call("recordAgentDispatchCompletion", [{
      prepared: { run_id: "default-wait-worker-run-1" },
      completion: { status: "completed", finalOutput: "default wait final output" },
    }, ctx]);
  }, 20);
  const defaultWaitResult = await Promise.race([
    defaultWait,
    new Promise((_, reject) => setTimeout(() => reject(new Error("default agent_wait did not return after completion")), 1000)),
  ]);
  if (
    defaultWaitResult.details?.runs?.find((run) => run.run_id === "default-wait-worker-run-1")?.status !== "completed" ||
    defaultWaitResult.details?.runs?.find((run) => run.run_id === "default-wait-worker-run-1")?.finalOutput !== "default wait final output" ||
    defaultWaitResult.details?.runs?.find((run) => run.run_id === "default-wait-worker-run-1")?.consumed !== true ||
    !defaultWaitResult.content?.[0]?.text?.includes("default wait final output")
  ) {
    throw new Error(`default agent_wait did not keep selected runs through completion: ${JSON.stringify(defaultWaitResult)}`);
  }
  await tools.get("agent_close").execute(
    "agent-default-wait-close",
    { agent_ids: ["default-wait-worker"] },
    undefined,
    undefined,
    ctx,
  );
  const agentChildCtx = childContexts.get(agentResult.details.childSession.sessionId);
  if (agentChildCtx === undefined) {
    throw new Error(`agent child context was not captured: ${JSON.stringify(agentResult.details.childSession)}`);
  }
  const childContextMessages = await runContext([{ role: "user", content: "child context" }], agentChildCtx);
  const childEnvironment = findEnvironmentMessage(childContextMessages);
  if (
    childEnvironment?.content?.includes("<agent_profile_prompt>") !== true ||
    !childEnvironment.content.includes("You are the finder Taumel subagent")
  ) {
    throw new Error(`agent child context did not include the profile prompt: ${JSON.stringify(childContextMessages)}`);
  }
  const agentApprovalConfirmCount = confirmations.length;
  const agentApprovalCtx = { ...ctx, sessionManager: agentChildCtx.sessionManager };
  await tools.get("exec_command").execute(
    "agent-approval",
    {
      cmd: "echo child-approval",
      sandbox_permissions: "require_escalated",
      justification: "child needs host",
    },
    undefined,
    undefined,
    agentApprovalCtx,
  );
  if (
    confirmations.length !== agentApprovalConfirmCount + 1 ||
    !confirmations.at(-1)?.title?.includes("agent smoke-worker (finder)") ||
    !confirmations.at(-1)?.prompt?.includes("Requesting agent smoke-worker (finder)")
  ) {
    throw new Error(`child approval prompt did not identify requesting agent/profile: ${JSON.stringify(confirmations.at(-1))}`);
  }
  const closeParentFromChild = await tools.get("agent_close").execute(
    "agent-child-close-parent",
    { agent_ids: ["smoke-worker"] },
    undefined,
    undefined,
    agentChildCtx,
  );
  if (closeParentFromChild.details?.ok === true) {
    throw new Error(`agent child managed its parent worker: ${JSON.stringify(closeParentFromChild)}`);
  }
  const nestedAgentResult = await tools.get("agent_spawn").execute(
    "agent-child-spawn",
    { profile: "finder", objective: "try to spawn nested worker", agent_id: "nested-worker" },
    undefined,
    undefined,
    agentChildCtx,
  );
  if (nestedAgentResult.details?.ok === true) {
    throw new Error(`agent child was allowed to spawn a nested agent: ${JSON.stringify(nestedAgentResult)}`);
  }
  const closedAgent = await tools.get("agent_close").execute(
    "agent-close-live-child",
    { agent_ids: ["smoke-worker"] },
    undefined,
    undefined,
    ctx,
  );
  if (
    closedAgent.details?.ok !== true ||
    !childLifecycleCalls.some((call) =>
      call.sessionId === agentResult.details.childSession.sessionId &&
      call.method === "close" &&
      call.reason === "closed_by_parent"
    )
  ) {
    throw new Error(`agent_close did not close the live child session: ${JSON.stringify({ closedAgent, childLifecycleCalls })}`);
  }
  const interruptSpawn = await tools.get("agent_spawn").execute(
    "agent-interrupt-spawn",
    { profile: "finder", objective: "start interruptible work", agent_id: "interrupt-worker" },
    undefined,
    undefined,
    ctx,
  );
  const interruptSessionCount = agentSessionCalls.length;
  const interruptSend = await tools.get("agent_send").execute(
    "agent-interrupt-send",
    { agent_id: "interrupt-worker", objective: "replace the active run", interrupt: true },
    undefined,
    undefined,
    ctx,
  );
  const interruptedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const interruptedOldRun = interruptedAgentsState?.data?.runs?.find((run) => run.run_id === "interrupt-worker-run-1");
  const interruptedNewRun = interruptedAgentsState?.data?.runs?.find((run) => run.run_id === "interrupt-worker-run-2");
  if (
    interruptSend.details?.run_id !== "interrupt-worker-run-2" ||
    interruptSend.details?.deliveryKind !== "started" ||
    interruptSend.details?.previousRunStatus !== "running" ||
    interruptedOldRun?.status !== "cancelled" ||
    interruptedOldRun?.reason !== "interrupted_by_parent" ||
    interruptedNewRun?.status !== "running" ||
    agentSessionCalls.length !== interruptSessionCount + 1 ||
    !childLifecycleCalls.some((call) =>
      call.sessionId === interruptSpawn.details.childSession.sessionId &&
      call.method === "abort" &&
      call.reason === "interrupted_by_parent"
    )
  ) {
    throw new Error(`agent_send interrupt did not cancel and replace the active run: ${JSON.stringify({ interruptSend, interruptedAgentsState, childLifecycleCalls })}`);
  }
  const interruptReplacementSessionId = `child-${childCounter}`;
  await tools.get("agent_close").execute(
    "agent-interrupt-close",
    { agent_ids: ["interrupt-worker"] },
    undefined,
    undefined,
    ctx,
  );
  if (
    !childLifecycleCalls.some((call) =>
      call.sessionId === interruptReplacementSessionId &&
      call.method === "close" &&
      call.reason === "closed_by_parent"
    )
  ) {
    throw new Error(`agent_close did not close the child session created by agent_send: ${JSON.stringify({ interruptReplacementSessionId, childLifecycleCalls })}`);
  }
  const multiCloseA = await tools.get("agent_spawn").execute(
    "agent-multi-close-a",
    { profile: "finder", objective: "multi close a", agent_id: "multi-close-a" },
    undefined,
    undefined,
    ctx,
  );
  const multiCloseB = await tools.get("agent_spawn").execute(
    "agent-multi-close-b",
    { profile: "finder", objective: "multi close b", agent_id: "multi-close-b" },
    undefined,
    undefined,
    ctx,
  );
  const conflictingClose = await tools.get("agent_close").execute(
    "agent-close-conflicting-selectors",
    { all: true, agent_ids: ["multi-close-a"] },
    undefined,
    undefined,
    ctx,
  );
  const conflictingCloseState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    conflictingClose.details?.ok === true ||
    !conflictingClose.content?.[0]?.text?.includes("exactly one selector") ||
    conflictingCloseState?.data?.agents?.find((agent) => agent.agent_id === "multi-close-a")?.closed_at !== null ||
    conflictingCloseState?.data?.agents?.find((agent) => agent.agent_id === "multi-close-b")?.closed_at !== null
  ) {
    throw new Error(`agent_close accepted conflicting selectors: ${JSON.stringify({ conflictingClose, conflictingCloseState })}`);
  }
  const multiClosed = await tools.get("agent_close").execute(
    "agent-multi-close",
    { agent_ids: ["multi-close-a", "multi-close-b"] },
    undefined,
    undefined,
    ctx,
  );
  const multiClosedState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const multiClosedIds = new Set(multiClosed.details?.agent_ids ?? []);
  if (
    multiClosed.details?.ok !== true ||
    multiClosed.details?.closedCount !== 2 ||
    !multiClosedIds.has("multi-close-a") ||
    !multiClosedIds.has("multi-close-b") ||
    multiClosedState?.data?.agents?.find((agent) => agent.agent_id === "multi-close-a")?.closed_at === undefined ||
    multiClosedState?.data?.agents?.find((agent) => agent.agent_id === "multi-close-b")?.closed_at === undefined ||
    !childLifecycleCalls.some((call) =>
      call.sessionId === multiCloseA.details.childSession.sessionId &&
      call.method === "close" &&
      call.reason === "closed_by_parent"
    ) ||
    !childLifecycleCalls.some((call) =>
      call.sessionId === multiCloseB.details.childSession.sessionId &&
      call.method === "close" &&
      call.reason === "closed_by_parent"
    )
  ) {
    throw new Error(`agent_close did not close multiple agents: ${JSON.stringify({ multiClosed, multiClosedState, childLifecycleCalls })}`);
  }
  const ralphEntryOffset = customEntries.length;
  const ralphSessionCount = agentSessionCalls.length;
  const ralphResult = await commands.get("ralph").handler("start inspect child profile", ctx);
  if (
    ralphResult.ok !== true ||
    ralphResult.action !== "command_result" ||
    agentSessionCalls.length !== ralphSessionCount + 1
  ) {
    throw new Error(`ralph start did not create a child session: ${JSON.stringify(ralphResult)}`);
  }
  const ralphChildSessionId = `child-${childCounter}`;
  const ralphChildEntries = customEntries
    .slice(ralphEntryOffset)
    .filter((entry) => entry.sessionId === ralphChildSessionId);
  const ralphPermissions = ralphChildEntries.find((entry) => entry.type === "taumel.permissions");
  const ralphToolProfile = ralphPermissions?.value?.profile?.tools;
  const ralphToolNames = Array.isArray(ralphToolProfile?.names) ? ralphToolProfile.names : [];
  if (
    ralphToolProfile?.kind !== "only" ||
    !ralphToolNames.includes("ralph_continue") ||
    !ralphToolNames.includes("ralph_finish") ||
    ralphToolNames.includes("usage") ||
    ralphToolNames.some((name) => name === "agent" || name.startsWith("agent_"))
  ) {
    throw new Error(`ralph child did not persist a restricted tool profile: ${JSON.stringify(ralphChildEntries)}`);
  }
  await writeFile(
    join(process.env.TAUMEL_AGENT_PROFILE_DIR, "broken.md"),
    [
      "---",
      "name: broken",
      "description: Invalid profile for diagnostics",
      "provider: inherit",
      "model: inherit",
      "thinking: inherit",
      "sandbox: inherit",
      "tools:",
      "  - not_a_real_tool",
      "---",
      "This profile should fail startup validation.",
    ].join("\n"),
    "utf8",
  );
  notifications.length = 0;
  activeTools = ["agent_spawn", "agent_wait", "apply_patch"];
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }
  const invalidCatalogNotification = notifications.find((entry) =>
    entry.type === "warning" &&
    entry.message.includes("Taumel agent profile catalog is invalid") &&
    entry.message.includes("not_a_real_tool")
  );
  if (
    invalidCatalogNotification === undefined ||
    activeTools.includes("agent_spawn") ||
    activeTools.includes("agent_wait")
  ) {
    throw new Error(`invalid agent catalog did not notify and remove active agent tools: ${JSON.stringify({ notifications, activeTools, activeToolUpdates })}`);
  }
  await writeFile(
    join(process.env.TAUMEL_AGENT_PROFILE_DIR, "broken.md"),
    [
      "---",
      "name: broken",
      "description: Fixed profile for recovery",
      "provider: inherit",
      "model: inherit",
      "thinking: inherit",
      "sandbox: inherit",
      "tools:",
      "  - exec_command",
      "---",
      "This profile should pass startup validation.",
    ].join("\n"),
    "utf8",
  );
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }
  if (!activeTools.includes("agent_spawn") || !activeTools.includes("agent_wait")) {
    throw new Error(`valid agent catalog recovery did not restore active agent tools: ${JSON.stringify({ activeTools, activeToolUpdates })}`);
  }
  await writeFile(
    join(process.env.TAUMEL_AGENT_PROFILE_DIR, "broken.md"),
    [
      "---",
      "name: broken",
      "description: Invalid profile for diagnostics",
      "provider: inherit",
      "model: inherit",
      "thinking: inherit",
      "sandbox: inherit",
      "tools:",
      "  - not_a_real_tool",
      "---",
      "This profile should fail startup validation.",
    ].join("\n"),
    "utf8",
  );

  const invalidHandlers = new Map();
  const invalidInternalHandlers = new Map();
  const invalidTools = new Map();
  const invalidNotifications = [];
  let invalidActiveTools = ["agent_spawn", "agent_wait", "apply_patch"];
  const invalidPi = {
    on: (event, handler) => pushHandler(invalidHandlers, event, handler),
    events: {
      on: (event, handler) => {
        pushHandler(invalidInternalHandlers, event, handler);
        return () => undefined;
      },
      emit: () => undefined,
    },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    getFlag: () => undefined,
    getThinkingLevel: () => "medium",
    getActiveTools: () => invalidActiveTools,
    setActiveTools: (nextTools) => {
      invalidActiveTools = [...nextTools];
    },
    getAllTools: () => [...invalidTools.values()].map((tool) => ({ name: tool.name })),
    registerTool: (tool) => {
      invalidTools.set(tool.name, tool);
    },
    registerCommand: () => undefined,
  };
  await taumel(invalidPi);
  for (const name of ["agent_spawn", "agent_send", "agent_wait", "agent_list", "agent_close", "agent_profiles"]) {
    if (invalidTools.has(name)) throw new Error(`invalid first-start registered agent tool before validation: ${name}`);
  }
  const invalidCtx = {
    cwd,
    hasUI: true,
    ui: {
      notify: (message, type) => invalidNotifications.push({ message, type }),
    },
    model: { provider: "openai-codex", id: "gpt-test" },
    getContextUsage: () => ({ percent: 1, contextWindow: 1000 }),
    sessionManager: {
      getSessionId: () => "invalid-first-start",
      getSessionFile: () => join(cwd, "invalid-first-start.json"),
      getEntries: () => [],
      appendCustomEntry: () => undefined,
      getBranch: () => [],
    },
  };
  for (const handler of invalidHandlers.get("session_start") ?? []) {
    handler({ type: "session_start" }, invalidCtx);
  }
  if (
    invalidTools.has("agent_spawn") ||
    invalidTools.has("agent_wait") ||
    invalidActiveTools.includes("agent_spawn") ||
    invalidActiveTools.includes("agent_wait") ||
    !invalidNotifications.some((entry) => entry.type === "warning" && entry.message.includes("not_a_real_tool"))
  ) {
    throw new Error(`invalid first-start did not keep agent tools unregistered/inactive: ${JSON.stringify({
      invalidTools: [...invalidTools.keys()],
      invalidActiveTools,
      invalidNotifications,
    })}`);
  }
} finally {
  globalThis.fetch = originalFetch;
  if (originalSettingsPath === undefined) {
    delete process.env.TAUMEL_SETTINGS_PATH;
  } else {
    process.env.TAUMEL_SETTINGS_PATH = originalSettingsPath;
  }
  if (originalAgentProfileDir === undefined) {
    delete process.env.TAUMEL_AGENT_PROFILE_DIR;
  } else {
    process.env.TAUMEL_AGENT_PROFILE_DIR = originalAgentProfileDir;
  }
  await rm(cwd, { recursive: true, force: true });
}

process.exit(0);
