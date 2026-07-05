import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import taumel from "../src/index.ts";
import { renderComposerInput, SkillAutocompleteProvider } from "../src/composer.ts";
import { applyChildSessionUpdate } from "../src/tool-executor.ts";

const cwd = await mkdtemp(join(tmpdir(), "taumel-entrypoint-"));
const originalFetch = globalThis.fetch;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalAgentProfileDir = process.env.TAUMEL_AGENT_PROFILE_DIR;
process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
process.env.TAUMEL_AGENT_PROFILE_DIR = join(cwd, "agent-profiles");
const globalSettingsPath = join(process.env.PI_CODING_AGENT_DIR, "settings.json");
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
await mkdir(process.env.TAUMEL_AGENT_PROFILE_DIR, { recursive: true });
await mkdir(join(cwd, ".pi", "skills", "foo"), { recursive: true });
await mkdir(join(cwd, ".pi", "skills", "bar"), { recursive: true });
await writeFile(join(cwd, ".pi", "skills", "foo", "SKILL.md"), ["---", "name: foo", "---", "Foo body"].join("\n"));
await writeFile(join(cwd, ".pi", "skills", "bar", "SKILL.md"), "Bar body\n");
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
  globalSettingsPath,
  `${JSON.stringify({
    taumel: {
      composer: { enabled: true },
      agents: {
        finder: {
          provider: "openai-codex",
          model: "gpt-override",
          thinking: "high",
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
const sentUserMessages = [];
const childSendResponses = [];
const childDispatchCalls = [];
const childLifecycleCalls = [];
const editorFactories = [];
const autocompleteFactories = [];
const childContexts = new Map();
const agentToolNames = [
  "agent_spawn",
  "agent_send",
  "agent_wait",
  "agent_list",
  "agent_close",
  "agent_profiles",
];
let activeTools = ["bash", "write", "usage", "bash"];
let sandboxMode = undefined;
let extensionLoading = true;
let childCounter = 0;
let pendingMessages = false;
// Models pi.isIdle(): when true, a child completion flushes immediately via a
// triggerTurn notification (background-while-idle). Set false to model the parent
// being mid-turn (e.g. about to call agent_wait), so the completion stays pending
// and an agent_wait can claim it before any turn_end flush.
let parentIdle = true;
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
const longAgentOutput = (label) => [
  `${label} completed with concrete implementation details.`,
  "The child reports the files inspected, the run-state changes it observed, the exact terminal status, and the parent-visible handoff details.",
  "This intentionally exceeds the too-brief handoff threshold so tests only trigger continuation when they are checking that behavior directly.",
].join(" ");

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
  sendUserMessage: (content, options) => {
    runtimeActionGuard();
    sentUserMessages.push({ content, options });
  },
  isIdle: () => parentIdle,
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
    const appendChildGoalStatus = (status) => {
      const current = childEntries
        .filter((entry) => entry.customType === "taumel.goal" && entry.data !== null && typeof entry.data === "object")
        .at(-1)?.data ?? {};
      childSessionManager.appendCustomEntry("taumel.goal", {
        ...current,
        status,
        updatedAt: typeof current.updatedAt === "number" ? current.updatedAt + 1 : Date.now(),
      });
    };
    const dispatchChildMessage = async (method, content, options = {}) => {
      childDispatchCalls.push({ sessionId: childId, method, content, options });
      const response = await childSendResponses.shift();
      if (response !== undefined) {
        if (typeof response.goalStatus === "string") {
          appendChildGoalStatus(response.goalStatus);
        }
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
  for (const name of agentToolNames) {
    if (tools.has(name)) throw new Error(`agent tool registered before profile validation: ${name}`);
  }

  const parentEntries = [];
  const parentBranch = [
    { type: "message", message: { role: "user", content: "bridge smoke" } },
    { type: "message", message: { role: "assistant", content: "bridge response" } },
  ];
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
      addAutocompleteProvider: (factory) => {
        autocompleteFactories.push(factory);
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
      getBranch: () => parentBranch,
    },
  };

  for (const handler of handlers.get("session_start") ?? []) {
    handler({ type: "session_start" }, ctx);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (editorFactories.length !== 1) {
    throw new Error(`composer editor was not installed on session_start: ${editorFactories.length}`);
  }
  if (autocompleteFactories.length !== 0) {
    throw new Error(`skill autocomplete should be installed through the custom editor, not ui wrappers: ${autocompleteFactories.length}`);
  }

  const fallbackProvider = {
    triggerCharacters: ["@"],
    getSuggestions: async () => ({ items: [{ value: "fallback", label: "fallback" }], prefix: "" }),
    applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
  };
  const skillProvider = new SkillAutocompleteProvider(fallbackProvider, () => [
    { name: "foo", location: join(cwd, ".pi", "skills", "foo", "SKILL.md") },
    { name: "bar", location: join(cwd, ".pi", "skills", "bar", "SKILL.md") },
  ]);
  const dollarSuggestions = await skillProvider.getSuggestions(["use $"], 0, 5, { signal: AbortSignal.timeout(100) });
  const dollarValues = new Set(dollarSuggestions?.items.map((item) => item.value));
  if (!dollarSuggestions || dollarSuggestions.prefix !== "$" || !dollarValues.has("$foo") || !dollarValues.has("$bar")) {
    throw new Error(`skill autocomplete did not list all skills after $: ${JSON.stringify(dollarSuggestions)}`);
  }
  const filteredSuggestions = await skillProvider.getSuggestions(["use $fo"], 0, 7, { signal: AbortSignal.timeout(100) });
  if (!filteredSuggestions || filteredSuggestions.items.length !== 1 || filteredSuggestions.items[0]?.value !== "$foo") {
    throw new Error(`skill autocomplete did not filter typed prefix: ${JSON.stringify(filteredSuggestions)}`);
  }
  const completedSkill = skillProvider.applyCompletion(["use $fo now"], 0, 7, { value: "$foo", label: "$foo" }, "$fo");
  if (completedSkill.lines[0] !== "use $foo now" || completedSkill.cursorCol !== 8) {
    throw new Error(`skill autocomplete did not replace token with trailing space: ${JSON.stringify(completedSkill)}`);
  }
  const completedAtEnd = skillProvider.applyCompletion(["use $fo"], 0, 7, { value: "$foo", label: "$foo" }, "$fo");
  if (completedAtEnd.lines[0] !== "use $foo " || completedAtEnd.cursorCol !== 9) {
    throw new Error(`skill autocomplete did not add a trailing space at end: ${JSON.stringify(completedAtEnd)}`);
  }

  const inputHandlers = handlers.get("input") ?? [];
  if (inputHandlers.length === 0) throw new Error("skill resolver did not register an input handler");
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  const skillReturns = await Promise.all(inputHandlers.map((handler) => handler({ type: "input", text: "$foo $bar explain both" }, ctx)));
  const handledSkill = skillReturns.find((result) => result?.action === "handled");
  if (
    handledSkill === undefined || sentMessages.length !== 2 || sentUserMessages.at(-1)?.content !== "$foo $bar explain both" ||
    sentMessages[0]?.message?.customType !== "taumel.skill" || !sentMessages[0]?.message?.content?.includes('name="foo"') ||
    sentMessages[0]?.message?.details?.trigger !== "$foo" ||
    sentMessages[1]?.message?.customType !== "taumel.skill" || !sentMessages[1]?.message?.content?.includes('name="bar"') ||
    sentMessages[1]?.message?.details?.trigger !== "$bar"
  ) {
    throw new Error(`skill resolver input handling failed: ${JSON.stringify({ skillReturns, sentMessages, sentUserMessages })}`);
  }
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  const reentryReturns = await Promise.all(inputHandlers.map((handler) => handler({ type: "input", text: "$foo $bar explain both" }, ctx)));
  if (sentMessages.length !== 0 || sentUserMessages.length !== 0 || reentryReturns.some((result) => result?.action === "handled")) {
    throw new Error(`skill resolver reentry should continue with literal mentions: ${JSON.stringify({ reentryReturns, sentMessages, sentUserMessages })}`);
  }
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  const noMentionReturns = await Promise.all(inputHandlers.map((handler) => handler({ type: "input", text: "no mentions here" }, ctx)));
  if (sentMessages.length !== 0 || sentUserMessages.length !== 0 || noMentionReturns.some((result) => result?.action === "handled")) {
    throw new Error(`skill resolver should continue without mentions: ${JSON.stringify({ noMentionReturns, sentMessages, sentUserMessages })}`);
  }
  sentMessages.length = 0;
  sentUserMessages.length = 0;

  for (const name of [
    "exec_command",
    "write_stdin",
    "apply_patch",
    "edit",
    "write",
    ...agentToolNames,
  ]) {
    if (!tools.has(name)) throw new Error(`missing registered tool: ${name}`);
  }
  if (tools.has("agent")) {
    throw new Error("legacy agent tool must not be registered");
  }
  for (const name of agentToolNames) {
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
    compactShell.startsWith("• exec_command · ls many-files") &&
    compactShell.includes("  └ ") &&
    compactShell.includes("more lines") &&
    !compactShellLines.includes("file-2") &&
    expandedShellLines.includes("file-2") &&
    expandedShell.length > compactShell.length,
    `shell renderer did not compact long output: ${JSON.stringify({ compactShell, expandedShell })}`,
  );
  if (tools.has("usage")) {
    throw new Error("usage was registered as a model-callable tool");
  }
  for (const name of ["permissions", "network", "composer", "usage", "ralph", "goal", "agents", "tools", "skills", "agent-runs"]) {
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
    !composerShow.message.includes(globalSettingsPath)
  ) {
    throw new Error(`composer show did not report global state and path: ${JSON.stringify(composerShow)}`);
  }
  const composerOff = await commands.get("composer").handler("off", ctx);
  const composerFile = JSON.parse(await readFile(globalSettingsPath, "utf8"));
  if (
    composerOff.action !== "command_result" ||
    !composerOff.message.includes("Composer: off") ||
    composerFile?.taumel?.composer?.enabled !== false ||
    composerFile?.taumel?.agents?.finder?.provider !== "openai-codex" ||
    composerFile?.taumel?.agents?.finder?.model !== "gpt-override" ||
    composerFile?.taumel?.agents?.finder?.thinking !== "high" ||
    composerFile?.taumel?.agents?.smart !== undefined ||
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
  const staleAgentEndCtx = {
    ...ctx,
    sessionManager: {
      getSessionId: () => {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
      getSessionFile: () => {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
      getEntries: () => {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
      getBranch: () => {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
    },
  };
  for (const handler of handlers.get("agent_end") ?? []) {
    await handler({ type: "agent_end", messages: [assistantMessage()] }, staleAgentEndCtx);
  }
  if (sentMessages.length !== 0) {
    throw new Error(`goal agent_end queued from stale ctx: ${JSON.stringify(sentMessages)}`);
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

  const accountingGoalResult = await commands.get("goal").handler("terminal accounting goal", ctx);
  if (
    accountingGoalResult.action !== "command_result" ||
    accountingGoalResult.details?.goal?.status !== "active"
  ) {
    throw new Error(`goal command did not create accounting test goal: ${JSON.stringify(accountingGoalResult)}`);
  }
  const realDateNow = Date.now;
  try {
    Date.now = () => 100_000;
    for (const handler of handlers.get("turn_start") ?? []) {
      await handler({ type: "turn_start" }, ctx);
    }
    Date.now = () => 104_000;
    const updateGoalResult = await tools.get("update_goal").execute(
      "update-goal-terminal-accounting",
      { status: "complete" },
      undefined,
      undefined,
      ctx,
    );
    if (
      updateGoalResult.details?.goal?.status !== "complete" ||
      updateGoalResult.details?.accountingPending !== true
    ) {
      throw new Error(`update_goal did not mark terminal accounting pending: ${JSON.stringify(updateGoalResult)}`);
    }
    parentBranch.push({
      type: "message",
      message: {
        role: "assistant",
        content: "terminal accounting response",
        usage: {
          input: 11,
          output: 9,
          cacheRead: 4,
          cacheWrite: 6,
          totalTokens: 30,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    });
    Date.now = () => 109_000;
    for (const handler of handlers.get("turn_end") ?? []) {
      await handler({ type: "turn_end" }, ctx);
    }
  } finally {
    Date.now = realDateNow;
  }
  const accountedGoalResult = await commands.get("goal").handler("status", ctx);
  if (
    accountedGoalResult.details?.goal?.status !== "complete" ||
    accountedGoalResult.details?.goal?.tokensUsed !== 26 ||
    accountedGoalResult.details?.goal?.timeUsedSeconds !== 9
  ) {
    throw new Error(`turn_end did not finalize pending update_goal accounting: ${JSON.stringify(accountedGoalResult)}`);
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
	    !defaultPermission.message.includes("approval=on-request") ||
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
	    initialEnvironment.content.includes("<approval_policy>on-request</approval_policy>") &&
	    initialEnvironment.content.includes("<network_access>enabled</network_access>"),
    `initial environment context was not injected before user input: ${JSON.stringify(initialContextMessages)}`,
  );
	const unchangedContext = await contextHandlers[0]({ type: "context", messages: [{ role: "user", content: "unchanged context" }] }, ctx);
	assert(unchangedContext === undefined, `unchanged environment context should not inject: ${JSON.stringify(unchangedContext)}`);
	confirmBehavior = async () => false;
	const dangerousConfirmCount = confirmations.length;
	const dangerousDefault = await tools.get("exec_command").execute(
	  "exec-dangerous-default",
	  { cmd: "rm -rf target" },
	  undefined,
	  undefined,
	  ctx,
	);
	confirmBehavior = async () => true;
	assert(
	  confirmations.length >= dangerousConfirmCount &&
	    dangerousDefault.content?.[0]?.text === "Sandbox: command blocked (approval denied by user)" &&
	    dangerousDefault.details?.approvalRequired === true,
	  `dangerous default command did not prompt under full-access/on-request: ${JSON.stringify({ dangerousDefault, confirmations: confirmations.at(-1) })}`,
	);
	const neverSetup = await commands.get("permissions").handler("approval never", ctx);
	assert(neverSetup.message.includes("approval=never"), `approval never did not apply: ${JSON.stringify(neverSetup)}`);
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
	const requestSetup = await commands.get("permissions").handler("approval on-request", ctx);
	assert(requestSetup.message.includes("approval=on-request"), `approval on-request did not apply: ${JSON.stringify(requestSetup)}`);
	const workspaceSetup = await commands.get("permissions").handler("sandbox workspace-write", ctx);
  if (
    workspaceSetup.action !== "command_result" ||
    !workspaceSetup.message.includes("sandbox=workspace-write") ||
    !workspaceSetup.message.includes("approval=on-request") ||
    !workspaceSetup.message.includes("network=disabled")
  ) {
    throw new Error(`workspace permissions did not apply preset defaults: ${JSON.stringify(workspaceSetup)}`);
  }
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }
  for (const name of agentToolNames) {
    if (!tools.has(name)) throw new Error(`valid catalog recovery did not register agent tool ${name}`);
    if (!activeTools.includes(name)) {
      throw new Error(`valid catalog recovery did not activate model-facing agent tool ${name}: ${JSON.stringify(activeTools)}`);
    }
  }
  const savedWorkspacePermission = parentEntries.filter((entry) => entry.customType === "taumel.permissions").at(-1);
  const changedContextMessages = await runContext([{ role: "user", content: "changed permissions" }]);
  const changedEnvironment = findEnvironmentMessage(changedContextMessages);
  assert(
    changedContextMessages[0] === changedEnvironment &&
	    changedContextMessages[1]?.role === "user" &&
	    changedEnvironment?.content?.includes("<sandbox_mode>workspace-write</sandbox_mode>") &&
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
  for (const handler of handlers.get("model_select") ?? []) {
    handler({ type: "model_select" }, ctx);
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
  for (const handler of handlers.get("model_select") ?? []) {
    handler({ type: "model_select" }, ctx);
  }
  const switchedTools = activeToolUpdates.at(-1) ?? [];
  if (
    switchedTools.includes("write") ||
    switchedTools.includes("edit") ||
    !switchedTools.includes("apply_patch")
  ) {
    throw new Error(`model_select to openai did not switch to apply_patch: ${JSON.stringify(activeToolUpdates)}`);
  }

  const execResult = await tools
    .get("exec_command")
    .execute("exec-call", { cmd: "printf exec-ready", workdir: cwd }, undefined, undefined, ctx);
  if (!execResult.content?.[0]?.text.includes("exec-ready")) {
    throw new Error(`exec_command did not run command: ${JSON.stringify({ execCalls, execResult })}`);
  }
  if (
    execResult.details?.stdout !== execResult.details?.output ||
    execResult.details?.stderr !== "" ||
    execResult.details?.truncation?.truncated !== false
  ) {
    throw new Error(`exec_command details missing stdout/stderr/truncation: ${JSON.stringify(execResult)}`);
  }

  const byteTruncatedExec = await tools
    .get("exec_command")
    .execute(
      "exec-byte-truncation",
      { cmd: "for i in $(seq 1 4000); do printf 'line-%04d abcdefghijklmnopqrstuvwxyz\\n' \"$i\"; done", workdir: cwd },
      undefined,
      undefined,
      ctx,
    );
  const byteTruncation = byteTruncatedExec.details?.truncation;
  const firstVisibleExecLine = byteTruncatedExec.details?.output?.split(/\r?\n/).find((line) => line.trim() !== "" && !line.startsWith("["));
  if (
    byteTruncation?.truncated !== true ||
    typeof byteTruncatedExec.details?.fullOutputPath !== "string" ||
    byteTruncation?.outputBytes > 50 * 1024 ||
    !/^line-\d{4} abcdefghijklmnopqrstuvwxyz$/.test(firstVisibleExecLine ?? "")
  ) {
    throw new Error(`exec byte truncation did not preserve complete first visible line: ${JSON.stringify({ firstVisibleExecLine, byteTruncatedExec })}`);
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

    // Background completion notification: an async command that exits while
    // unpolled is delivered through the same notification queue as subagents
    // (idle parent -> triggerTurn). No write_stdin poll consumes it.
    const bgExecNotifyCount = sentMessages.length;
    const bgExec = await tools.get("exec_command").execute(
      "exec-bg-notify",
      { cmd: "sleep 0.3; echo bg-complete", workdir: cwd, yield_time_ms: 25 },
      undefined,
      undefined,
      ctx,
    );
    const bgSessionId = bgExec.details?.sessionId;
    if (typeof bgSessionId !== "number") {
      throw new Error(`background exec did not yield a running session: ${JSON.stringify(bgExec)}`);
    }
    const bgNotification = await waitFor(() => {
      const message = sentMessages.at(-1);
      return sentMessages.length === bgExecNotifyCount + 1 &&
        message?.message?.customType === "notification" &&
        message?.message?.content?.includes(`Command session ${bgSessionId} has finished`) &&
        message?.message?.content?.includes(`write_stdin with session_id=${bgSessionId}`) &&
        !message?.message?.content?.includes("bg-complete")
        ? message
        : undefined;
    }, "background exec completion notification was not delivered", 3000);
    if (bgNotification?.options?.triggerTurn !== true) {
      throw new Error(`background exec notification should wake an idle parent via triggerTurn: ${JSON.stringify(bgNotification)}`);
    }
    // Delivered exactly once.
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (sentMessages.length !== bgExecNotifyCount + 1) {
      throw new Error(`background exec notification delivered more than once: ${JSON.stringify(sentMessages.slice(bgExecNotifyCount))}`);
    }
    // The notification does not consume the terminal result: the explicit poll reads it once.
    const bgRead = await tools
      .get("write_stdin")
      .execute("stdin-bg-after", { session_id: bgSessionId, chars: "", yield_time_ms: 5000 }, undefined, undefined, ctx);
    if (!bgRead.content?.[0]?.text?.includes("bg-complete") || bgRead.details?.exitCode !== 0) {
      throw new Error(`delivered background exec session was not readable after notification: ${JSON.stringify(bgRead)}`);
    }
    const bgReadAgain = await tools
      .get("write_stdin")
      .execute("stdin-bg-after-again", { session_id: bgSessionId, chars: "", yield_time_ms: 5000 }, undefined, undefined, ctx);
    if (
      !bgReadAgain.content?.[0]?.text?.includes(`session ${bgSessionId} already completed`) ||
      bgReadAgain.details?.alreadyCompleted !== true
    ) {
      throw new Error(`second background exec read should be status-only retained metadata: ${JSON.stringify(bgReadAgain)}`);
    }

    // read tool: line-numbered output, negative-offset tail, and missing-file error.
    const readPath = join(cwd, "read-sample.txt");
    await writeFile(readPath, "alpha\nbeta\ngamma\ndelta\n", "utf8");
    const readAll = await tools.get("read").execute("read-all", { path: readPath }, undefined, undefined, ctx);
    if (
      readAll.details?.ok !== true ||
      readAll.details?.totalLines !== 4 ||
      !readAll.content?.[0]?.text?.includes("1\talpha") ||
      !readAll.content?.[0]?.text?.includes("4\tdelta")
    ) {
      throw new Error(`read did not return line-numbered content: ${JSON.stringify(readAll)}`);
    }
    const readTail = await tools.get("read").execute("read-tail", { path: readPath, offset: -2 }, undefined, undefined, ctx);
    if (
      readTail.details?.startLine !== 3 ||
      !readTail.content?.[0]?.text?.includes("3\tgamma") ||
      readTail.content?.[0]?.text?.includes("1\talpha")
    ) {
      throw new Error(`read tail (negative offset) failed: ${JSON.stringify(readTail)}`);
    }
    const readMissing = await tools.get("read").execute("read-missing", { path: join(cwd, "nope.txt") }, undefined, undefined, ctx);
    if (readMissing.details?.ok !== false || !readMissing.content?.[0]?.text?.includes("does not exist")) {
      throw new Error(`read of a missing file should error: ${JSON.stringify(readMissing)}`);
    }

    // write append mode.
    const appendPath = join(cwd, "append-sample.txt");
    await tools.get("write").execute("write-initial", { path: appendPath, content: "one\n" }, undefined, undefined, ctx);
    const appendResult = await tools.get("write").execute("write-append", { path: appendPath, content: "two\n", mode: "append" }, undefined, undefined, ctx);
    if (appendResult.details?.mode !== "append" || (await readFile(appendPath, "utf8")) !== "one\ntwo\n") {
      throw new Error(`write append mode did not append: ${JSON.stringify(appendResult)}`);
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
    !agentProfiles.content?.[0]?.text?.includes('<profile name="scout" enabled="true"') ||
    !agentProfiles.content?.[0]?.text?.includes("Temporary smoke-test scanner") ||
    !agentProfiles.content?.[0]?.text?.includes('sandbox="read-only"') ||
    !agentProfiles.content?.[0]?.text?.includes('<tool name="exec_command"')
  ) {
    throw new Error(`agent_profiles did not return the PRD built-in catalog: ${JSON.stringify(agentProfiles)}`);
  }
  const agentsList = await commands.get("agents").handler("", ctx);
  if (
    agentsList.action !== "command_result" ||
    !agentsList.message.includes("scout [enabled]") ||
    !agentsList.message.includes("Temporary smoke-test scanner")
  ) {
    throw new Error(`agents list fallback did not show profile visibility: ${JSON.stringify(agentsList)}`);
  }
  let renderedVisibilityManagerLines = [];
  ctx.ui.custom = async (factory) => {
    const component = factory(
      { requestRender: () => undefined },
      {
        fg: (_color, text) => text,
        bg: (_color, text) => text,
        bold: (text) => text,
      },
      { matches: () => false },
      () => undefined,
    );
    renderedVisibilityManagerLines = component.render(120);
    return { kind: "exit" };
  };
  const agentsManager = await commands.get("agents").handler("", ctx);
  delete ctx.ui.custom;
  if (
    agentsManager.action !== "command_result" ||
    !renderedVisibilityManagerLines.some((line) => line.includes("Taumel agent profiles")) ||
    !renderedVisibilityManagerLines.some((line) => line.includes("enter toggle") && line.includes("ctrl+s save to project")) ||
    !renderedVisibilityManagerLines.some((line) => line.includes("scout") && line.includes("enabled"))
  ) {
    throw new Error(`agents manager did not render cron-style visibility rows: ${JSON.stringify({ agentsManager, renderedVisibilityManagerLines })}`);
  }
  let renderedToolsManagerLines = [];
  let renderedToolsSearchLines = [];
  ctx.ui.custom = async (factory) => {
    const component = factory(
      { requestRender: () => undefined },
      {
        fg: (_color, text) => text,
        bg: (_color, text) => text,
        bold: (text) => text,
      },
      { matches: () => false },
      () => undefined,
    );
    renderedToolsManagerLines = component.render(120);
    component.handleInput("e");
    const renderedAfterE = component.render(120);
    if (!renderedAfterE.some((line) => line.startsWith("  > e"))) {
      throw new Error(`tools manager did not route printable e to search input: ${JSON.stringify(renderedAfterE)}`);
    }
    component.handleInput("xec_command");
    renderedToolsSearchLines = component.render(120);
    return { kind: "exit" };
  };
  const toolsManager = await commands.get("tools").handler("", ctx);
  delete ctx.ui.custom;
  if (
    toolsManager.action !== "command_result" ||
    !renderedToolsManagerLines.some((line) => line.includes("Taumel tools")) ||
    !renderedToolsManagerLines.some((line) => line.startsWith("  > ")) ||
    !renderedToolsManagerLines.some((line) => line.includes("(1/")) ||
    !renderedToolsSearchLines.some((line) => line.includes("exec_command")) ||
    renderedToolsSearchLines.some((line) => line.includes("write_stdin"))
  ) {
    throw new Error(`tools manager did not render searchable scrolling visibility rows: ${JSON.stringify({ toolsManager, renderedToolsManagerLines, renderedToolsSearchLines })}`);
  }
  const disableScout = await commands.get("agents").handler("disable scout", ctx);
  const savedScoutDisabledState = parentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    disableScout.action !== "command_result" ||
    !disableScout.message.includes("scout disabled") ||
    !savedScoutDisabledState?.data?.agents?.disabled?.includes("scout")
  ) {
    throw new Error(`agents disable did not persist profile visibility: ${JSON.stringify({ disableScout, savedScoutDisabledState })}`);
  }
  const enableScout = await commands.get("agents").handler("enable scout", ctx);
  const savedScoutEnabledState = parentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    enableScout.action !== "command_result" ||
    !enableScout.message.includes("scout enabled") ||
    savedScoutEnabledState?.data?.agents?.disabled?.includes("scout")
  ) {
    throw new Error(`agents enable did not persist profile visibility cleanup: ${JSON.stringify({ enableScout, savedScoutEnabledState })}`);
  }
  const disableFinder = await commands.get("agents").handler("disable finder", ctx);
  const savedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    disableFinder.action !== "command_result" ||
    !disableFinder.message.includes("finder disabled") ||
    !savedAgentsState?.data?.agents?.disabled?.includes("finder")
  ) {
    throw new Error(`agents disable did not persist profile visibility: ${JSON.stringify({ disableFinder, savedAgentsState })}`);
  }
  const disabledProfiles = await tools.get("agent_profiles").execute(
    "agent-profiles-disabled",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    disabledProfiles.details?.profiles?.some((profile) => profile.name === "finder") ||
    disabledProfiles.content?.[0]?.text?.includes('<profile name="finder"')
  ) {
    throw new Error(`agent_profiles did not hide disabled profiles: ${JSON.stringify(disabledProfiles)}`);
  }
  const enableFinder = await commands.get("agents").handler("enable finder", ctx);
  if (
    enableFinder.action !== "command_result" ||
    !enableFinder.message.includes("finder enabled")
  ) {
    throw new Error(`agents enable did not update profile toggle: ${JSON.stringify(enableFinder)}`);
  }
  const legacyEntries = [
    {
      type: "custom",
      customType: "taumel.agents",
      data: {
        version: 1,
        profiles: [{ name: "scout", enabled: false }],
        agents: [],
        runs: [],
      },
    },
  ];
  const legacyCtx = {
    ...ctx,
    sessionManager: {
      getSessionId: () => "legacy-agent-visibility-session",
      getSessionFile: () => join(cwd, "legacy-agent-visibility-session.json"),
      appendCustomEntry: (type, value) => {
        legacyEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => legacyEntries,
      getBranch: () => [],
    },
  };
  const legacyHiddenProfiles = await tools.get("agent_profiles").execute(
    "agent-profiles-legacy-hidden",
    {},
    undefined,
    undefined,
    legacyCtx,
  );
  if (legacyHiddenProfiles.details?.profiles?.some((profile) => profile.name === "scout")) {
    throw new Error(`legacy disabled profile was not hidden by migrated visibility: ${JSON.stringify(legacyHiddenProfiles)}`);
  }
  const legacyEnableScout = await commands.get("agents").handler("enable scout", legacyCtx);
  const legacyEnabledProfiles = await tools.get("agent_profiles").execute(
    "agent-profiles-legacy-enabled",
    {},
    undefined,
    undefined,
    legacyCtx,
  );
  if (
    legacyEnableScout.action !== "command_result" ||
    !legacyEnableScout.message.includes("scout enabled") ||
    !legacyEnabledProfiles.details?.profiles?.some((profile) => profile.name === "scout" && profile.enabled === true) ||
    !legacyEnabledProfiles.content?.[0]?.text?.includes('<profile name="scout" enabled="true"') ||
    legacyEnabledProfiles.content?.[0]?.text?.includes('name="scout" enabled="false"')
  ) {
    throw new Error(`enabling migrated legacy profile did not render from visibility state: ${JSON.stringify({ legacyEnableScout, legacyEnabledProfiles })}`);
  }
  const disableTool = await commands.get("tools").handler("disable write_stdin", ctx);
  const savedToolDisabledState = parentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    disableTool.action !== "command_result" ||
    !disableTool.message.includes("write_stdin disabled") ||
    activeTools.includes("write_stdin") ||
    !savedToolDisabledState?.data?.tools?.disabled?.includes("write_stdin")
  ) {
    throw new Error(`tools disable did not hide active tool and persist visibility: ${JSON.stringify({ disableTool, activeTools, savedToolDisabledState })}`);
  }
  const unknownTool = await commands.get("tools").handler("disable missing_tool", ctx);
  const savedUnknownToolState = parentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    unknownTool.ok !== false ||
    !unknownTool.message.includes("Unknown tool") ||
    savedUnknownToolState?.data?.tools?.disabled?.includes("missing_tool")
  ) {
    throw new Error(`tools disable should warn and preserve state for unknown names: ${JSON.stringify({ unknownTool, savedUnknownToolState })}`);
  }
  const enableTool = await commands.get("tools").handler("enable write_stdin", ctx);
  if (
    enableTool.action !== "command_result" ||
    !enableTool.message.includes("write_stdin enabled") ||
    !activeTools.includes("write_stdin")
  ) {
    throw new Error(`tools enable did not restore active tool: ${JSON.stringify({ enableTool, activeTools })}`);
  }
  const disableSkill = await commands.get("skills").handler("disable foo", ctx);
  const savedSkillDisabledState = parentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  const visibleSkillsAfterDisable = globalThis.taumel.call("listSkills", [{ cwd }])?.skills ?? [];
  if (
    disableSkill.action !== "command_result" ||
    !disableSkill.message.includes("foo disabled") ||
    !savedSkillDisabledState?.data?.skills?.disabled?.includes("foo") ||
    visibleSkillsAfterDisable.some((skill) => skill.name === "foo") ||
    !visibleSkillsAfterDisable.some((skill) => skill.name === "bar")
  ) {
    throw new Error(`skills disable did not filter listSkills/autocomplete source: ${JSON.stringify({ disableSkill, savedSkillDisabledState, visibleSkillsAfterDisable })}`);
  }
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  const disabledSkillReturns = await Promise.all(inputHandlers.map((handler) => handler({ type: "input", text: "$foo $bar after disabling foo" }, ctx)));
  if (
    disabledSkillReturns.every((result) => result?.action !== "handled") ||
    sentMessages.length !== 1 ||
    !sentMessages[0]?.message?.content?.includes('name="bar"') ||
    sentMessages[0]?.message?.content?.includes('name="foo"')
  ) {
    throw new Error(`skill resolver did not ignore disabled skill mentions: ${JSON.stringify({ disabledSkillReturns, sentMessages })}`);
  }
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  await writeFile(
    projectSettingsPath,
    `${JSON.stringify({ unrelated: true, taumel: { otherSetting: 1, agents: { smart: { provider: "inherit", model: "inherit", thinking: "inherit" } } } }, null, 2)}\n`,
  );
  const trustedCtx = { ...ctx, isProjectTrusted: () => true };
  const saveSkills = await commands.get("skills").handler("save", trustedCtx);
  const savedProjectSettings = JSON.parse(await readFile(projectSettingsPath, "utf8"));
  if (
    saveSkills.action !== "command_result" ||
    saveSkills.ok !== true ||
    savedProjectSettings.unrelated !== true ||
    savedProjectSettings.taumel?.otherSetting !== 1 ||
    savedProjectSettings.taumel?.agents?.smart?.provider !== "inherit" ||
    savedProjectSettings.taumel?.agents?.smart?.model !== "inherit" ||
    savedProjectSettings.taumel?.agents?.smart?.thinking !== "inherit" ||
    !savedProjectSettings.taumel?.skills?.disabled?.includes("foo")
  ) {
    throw new Error(`skills save did not preserve project settings while writing disabled list: ${JSON.stringify({ saveSkills, savedProjectSettings })}`);
  }
  const enableSkill = await commands.get("skills").handler("enable foo", ctx);
  if (
    enableSkill.action !== "command_result" ||
    !enableSkill.message.includes("foo enabled")
  ) {
    throw new Error(`skills enable did not restore visibility: ${JSON.stringify(enableSkill)}`);
  }
  const unknownProfileSpawn = await tools.get("agent_spawn").execute(
    "agent-unknown-profile",
    { profile: "worker", message: "should be rejected" },
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
  const callerIdSpawn = await tools.get("agent_spawn").execute(
    "agent-caller-id",
    { profile: "finder", message: "invalid id", agent_id: "Bad_Id" },
    undefined,
    undefined,
    ctx,
  );
  if (
    callerIdSpawn.details?.ok === true ||
    !callerIdSpawn.content?.[0]?.text?.includes("additional properties")
  ) {
    throw new Error(`agent_spawn accepted caller-supplied agent_id: ${JSON.stringify(callerIdSpawn)}`);
  }
  const generatedAgent = await tools.get("agent_spawn").execute(
    "agent-generated-id",
    { profile: "finder", message: "spawn with generated id" },
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

  const otherParentEntries = [];
  const otherParentCtx = {
    ...ctx,
    taumelSessionId: "other-parent-session",
    sessionManager: {
      getSessionId: () => "other-parent-session",
      getSessionFile: () => join(cwd, "other-parent-session.json"),
      appendCustomEntry: (type, value) => {
        otherParentEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => otherParentEntries,
      getBranch: () => [],
    },
  };
  let resolveCrossSessionCompletion;
  childSendResponses.push(new Promise((resolve) => { resolveCrossSessionCompletion = resolve; }));
  const crossSessionSpawn = await tools.get("agent_spawn").execute(
    "agent-cross-session-async-spawn",
    { profile: "finder", message: "complete after parent session changed" },
    undefined,
    undefined,
    ctx,
  );
  const crossSessionAgentId = crossSessionSpawn.details?.agent_id;
  const crossSessionRunId = crossSessionSpawn.details?.run_id;
  const crossSessionStarted = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    crossSessionSpawn.details?.ok !== true ||
    typeof crossSessionAgentId !== "string" ||
    typeof crossSessionRunId !== "string" ||
    crossSessionStarted?.data?.runs?.find((run) => run.run_id === crossSessionRunId)?.status !== "running"
  ) {
    throw new Error(`cross-session async completion setup failed: ${JSON.stringify({ crossSessionSpawn, crossSessionStarted })}`);
  }
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, otherParentCtx);
  }
  const otherSessionCommand = await commands.get("agents").handler("disable finder", otherParentCtx);
  const otherSessionStateBeforeCompletion = otherParentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const otherSessionVisibilityBeforeCompletion = otherParentEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    otherSessionCommand.action !== "command_result" ||
    (otherSessionStateBeforeCompletion?.data?.agents?.length ?? 0) !== 0 ||
    !otherSessionVisibilityBeforeCompletion?.data?.agents?.disabled?.includes("finder")
  ) {
    throw new Error(`cross-session async completion did not switch global visibility state: ${JSON.stringify({ otherSessionCommand, otherSessionStateBeforeCompletion, otherSessionVisibilityBeforeCompletion })}`);
  }
  const crossSessionFinalOutput = longAgentOutput("cross-session async completion");
  const crossSessionNotificationCount = sentMessages.length;
  resolveCrossSessionCompletion({ output: crossSessionFinalOutput, status: "completed", goalStatus: "complete" });
  await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === crossSessionRunId);
    return run?.status === "completed" ? { state, run } : undefined;
  }, "async completion did not reload captured session agent state");
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, otherParentCtx);
  }
  const crossSessionNotification = await waitFor(() => {
    const message = sentMessages.at(-1);
    return sentMessages.length === crossSessionNotificationCount + 1 &&
      message?.message?.customType === "notification" &&
      message?.message?.content?.includes(crossSessionRunId) &&
      message?.message?.content?.includes("agent_wait with run_ids=") &&
      !message?.message?.content?.includes(crossSessionFinalOutput)
      ? message
      : undefined;
  }, "async completion notification did not reload captured session agent state", 2500);
  const crossSessionNotifiedState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const crossSessionNotifiedRun = crossSessionNotifiedState?.data?.runs?.find((run) => run.run_id === crossSessionRunId);
  if (
    crossSessionNotification?.options?.triggerTurn !== true ||
    crossSessionNotifiedRun?.background_notified !== true ||
    crossSessionNotifiedRun?.consumed !== false
  ) {
    throw new Error(`async completion notification did not update the captured parent session: ${JSON.stringify({ crossSessionNotification, crossSessionNotifiedState })}`);
  }
  const otherSessionStateAfterCompletion = otherParentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    (otherSessionStateAfterCompletion?.data?.agents?.length ?? 0) !== 0 ||
    (otherSessionStateAfterCompletion?.data?.runs?.length ?? 0) !== 0
  ) {
    throw new Error(`async completion updated the wrong parent session state: ${JSON.stringify(otherSessionStateAfterCompletion)}`);
  }
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }
  const crossSessionWait = await tools.get("agent_wait").execute(
    "agent-cross-session-async-wait",
    { run_ids: [crossSessionRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const crossSessionWaitRun = crossSessionWait.details?.runs?.find((run) => run.run_id === crossSessionRunId);
  if (
    crossSessionWaitRun?.status !== "completed" ||
    crossSessionWaitRun?.backgroundNotified !== true ||
    crossSessionWaitRun?.outputAvailable !== false
  ) {
    throw new Error(`agent_wait did not observe cross-session async completion: ${JSON.stringify(crossSessionWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-cross-session-async-close",
    { agent_ids: [crossSessionAgentId] },
    undefined,
    undefined,
    ctx,
  );

  const notificationCollisionAgentId = "finder-notification-collision";
  const notificationCollisionRunId = `${notificationCollisionAgentId}-run-1`;
  const notificationParentEntries = [{
    type: "custom",
    customType: "taumel.agents",
    data: {
      version: 1,
      profiles: [{ name: "finder", enabled: true }],
      agents: [],
      runs: [{
        run_id: notificationCollisionRunId,
        agent_id: notificationCollisionAgentId,
        initial_submission_kind: "objective",
        submissions: [{
          submission_id: `${notificationCollisionRunId}-submission-1`,
          kind: "objective",
          created_at: 1,
        }],
        status: "completed",
        reason: null,
        consumed: false,
        background_notified: false,
        created_at: 1,
        started_at: 1,
        completed_at: 2,
      }],
    },
  }];
  const notificationOtherEntries = [{
    type: "custom",
    customType: "taumel.agents",
    data: {
      version: 1,
      profiles: [{ name: "finder", enabled: true }],
      agents: [],
      runs: [{
        run_id: notificationCollisionRunId,
        agent_id: notificationCollisionAgentId,
        initial_submission_kind: "objective",
        submissions: [{
          submission_id: `${notificationCollisionRunId}-submission-1`,
          kind: "objective",
          created_at: 1,
        }],
        status: "running",
        reason: null,
        consumed: false,
        background_notified: false,
        created_at: 1,
        started_at: 1,
        completed_at: null,
      }],
    },
  }];
  const notificationParentCtx = {
    ...ctx,
    taumelSessionId: "notification-parent-session",
    sessionManager: {
      getSessionId: () => "notification-parent-session",
      getSessionFile: () => join(cwd, "notification-parent-session.json"),
      appendCustomEntry: (type, value) => {
        notificationParentEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => notificationParentEntries,
      getBranch: () => [],
    },
  };
  const notificationOtherCtx = {
    ...ctx,
    taumelSessionId: "notification-other-session",
    sessionManager: {
      getSessionId: () => "notification-other-session",
      getSessionFile: () => join(cwd, "notification-other-session.json"),
      appendCustomEntry: (type, value) => {
        notificationOtherEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => notificationOtherEntries,
      getBranch: () => [],
    },
  };
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, notificationOtherCtx);
  }
  const notificationOtherCompletion = globalThis.taumel.call("recordAgentDispatchCompletion", [{
    prepared: { run_id: notificationCollisionRunId },
    completion: {
      status: "failed",
      reason: "goal_blocked",
      finalOutput: longAgentOutput("wrong notification session"),
    },
  }, notificationOtherCtx]);
  if (notificationOtherCompletion?.ok !== true || notificationOtherCompletion?.notify !== true) {
    throw new Error(`notification collision setup did not complete other run: ${JSON.stringify(notificationOtherCompletion)}`);
  }
  const notificationMark = globalThis.taumel.call("recordAgentBackgroundNotification", [{
    prepared: { run_id: notificationCollisionRunId },
  }, notificationParentCtx]);
  const notificationParentState = notificationParentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const notificationParentRun = notificationParentState?.data?.runs?.find((run) => run.run_id === notificationCollisionRunId);
  if (
    notificationMark?.ok !== true ||
    notificationParentRun?.background_notified !== true ||
    notificationParentRun?.status !== "completed" ||
    notificationParentRun?.reason != null
  ) {
    throw new Error(`background notification merged volatile run data from another session: ${JSON.stringify({
      notificationMark,
      notificationParentRun,
      notificationOtherState: notificationOtherEntries.filter((entry) => entry.customType === "taumel.agents").at(-1),
    })}`);
  }
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }

  let resolveAsyncSpawn;
  childSendResponses.push(new Promise((resolve) => { resolveAsyncSpawn = resolve; }));
  const asyncSpawn = await tools.get("agent_spawn").execute(
    "agent-async-spawn",
    { profile: "finder", message: "finish later" },
    undefined,
    undefined,
    ctx,
  );
  const asyncAgentId = asyncSpawn.details?.agent_id;
  const asyncRunId = asyncSpawn.details?.run_id;
  const asyncSpawnState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const asyncSpawnRun = asyncSpawnState?.data?.runs?.find((run) => run.run_id === asyncRunId);
  if (
    asyncSpawn.details?.ok !== true ||
    typeof asyncAgentId !== "string" ||
    typeof asyncRunId !== "string" ||
    asyncSpawnRun?.status !== "running"
  ) {
    throw new Error(`agent_spawn did not return before delayed child completion: ${JSON.stringify({ asyncSpawn, asyncSpawnState })}`);
  }
  const asyncSpawnFinalOutput = longAgentOutput("async spawn final output");
  resolveAsyncSpawn({ output: asyncSpawnFinalOutput, status: "completed", goalStatus: "complete" });
  await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === asyncRunId);
    return run?.status === "completed";
  }, "agent_spawn delayed completion was not recorded");
  const asyncSpawnWait = await tools.get("agent_wait").execute(
    "agent-async-wait",
    { run_ids: [asyncRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    asyncSpawnWait.details?.runs?.find((run) => run.run_id === asyncRunId)?.finalOutput !== asyncSpawnFinalOutput ||
    asyncSpawnWait.details?.runs?.find((run) => run.run_id === asyncRunId)?.consumed !== true
  ) {
    throw new Error(`agent_wait did not consume async spawn completion: ${JSON.stringify(asyncSpawnWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-async-close",
    { agent_ids: [asyncAgentId] },
    undefined,
    undefined,
    ctx,
  );

  let resolveCloseStaleCompletion;
  childSendResponses.push(new Promise((resolve) => { resolveCloseStaleCompletion = resolve; }));
  const closeStaleSpawn = await tools.get("agent_spawn").execute(
    "agent-close-stale-completion-spawn",
    { profile: "finder", message: "ignore completion after close" },
    undefined,
    undefined,
    ctx,
  );
  const closeStaleAgentId = closeStaleSpawn.details?.agent_id;
  const closeStaleRunId = closeStaleSpawn.details?.run_id;
  if (
    closeStaleSpawn.details?.ok !== true ||
    typeof closeStaleAgentId !== "string" ||
    typeof closeStaleRunId !== "string"
  ) {
    throw new Error(`stale close completion setup failed: ${JSON.stringify(closeStaleSpawn)}`);
  }
  const closeStaleMessageCount = sentMessages.length;
  await tools.get("agent_close").execute(
    "agent-close-stale-completion-close",
    { agent_ids: [closeStaleAgentId] },
    undefined,
    undefined,
    ctx,
  );
  const closeStaleOutput = longAgentOutput("late close completion");
  resolveCloseStaleCompletion({ output: closeStaleOutput, status: "completed", goalStatus: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const closeStaleState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const closeStaleRun = closeStaleState?.data?.runs?.find((run) => run.run_id === closeStaleRunId);
  if (
    closeStaleRun?.status !== "cancelled" ||
    closeStaleRun?.reason !== "closed_by_parent" ||
    Object.hasOwn(closeStaleRun ?? {}, "final_output") ||
    closeStaleRun?.output_available === true ||
    closeStaleRun?.background_notified === true ||
    sentMessages.length !== closeStaleMessageCount
  ) {
    throw new Error(`late child completion after close was not ignored: ${JSON.stringify({
      closeStaleRun,
      messages: sentMessages.slice(closeStaleMessageCount),
    })}`);
  }

  let resolveStopStaleCompletion;
  childSendResponses.push(new Promise((resolve) => { resolveStopStaleCompletion = resolve; }));
  const stopStaleSpawn = await tools.get("agent_spawn").execute(
    "agent-stop-stale-completion-spawn",
    { profile: "finder", message: "ignore completion after stop" },
    undefined,
    undefined,
    ctx,
  );
  const stopStaleAgentId = stopStaleSpawn.details?.agent_id;
  const stopStaleRunId = stopStaleSpawn.details?.run_id;
  if (
    stopStaleSpawn.details?.ok !== true ||
    typeof stopStaleAgentId !== "string" ||
    typeof stopStaleRunId !== "string"
  ) {
    throw new Error(`stale stop completion setup failed: ${JSON.stringify(stopStaleSpawn)}`);
  }
  const stopStaleMessageCount = sentMessages.length;
  const stopStaleCommand = await commands.get("agent-runs").handler(`stop ${stopStaleAgentId}`, ctx);
  const stopStaleOutput = longAgentOutput("late stop completion");
  resolveStopStaleCompletion({ output: stopStaleOutput, status: "completed", goalStatus: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const stopStaleState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const stopStaleRun = stopStaleState?.data?.runs?.find((run) => run.run_id === stopStaleRunId);
  if (
    stopStaleCommand.action !== "command_result" ||
    !stopStaleCommand.message.includes(`Stopped ${stopStaleAgentId}`) ||
    stopStaleRun?.status !== "cancelled" ||
    stopStaleRun?.reason !== "stopped_by_parent" ||
    Object.hasOwn(stopStaleRun ?? {}, "final_output") ||
    stopStaleRun?.output_available === true ||
    stopStaleRun?.background_notified === true ||
    sentMessages.length !== stopStaleMessageCount
  ) {
    throw new Error(`late child completion after stop was not ignored: ${JSON.stringify({
      stopStaleCommand,
      stopStaleRun,
      messages: sentMessages.slice(stopStaleMessageCount),
    })}`);
  }
  await tools.get("agent_close").execute(
    "agent-stop-stale-completion-close",
    { agent_ids: [stopStaleAgentId] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push({ output: longAgentOutput("active child goal prose"), status: "completed" });
  childSendResponses.push(new Promise(() => undefined));
  const activeGoalProseSpawn = await tools.get("agent_spawn").execute(
    "agent-active-goal-prose-spawn",
    { profile: "finder", message: "do not complete from prose alone", create_goal: true },
    undefined,
    undefined,
    ctx,
  );
  const activeGoalProseAgentId = activeGoalProseSpawn.details?.agent_id;
  const activeGoalProseRunId = activeGoalProseSpawn.details?.run_id;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const activeGoalProseState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const activeGoalProseRun = activeGoalProseState?.data?.runs?.find((run) => run.run_id === activeGoalProseRunId);
  if (
    activeGoalProseSpawn.details?.ok !== true ||
    activeGoalProseRun?.status !== "running" ||
    activeGoalProseRun?.output_available === true
  ) {
    throw new Error(`agent_spawn inferred completion from child prose while goal remained active: ${JSON.stringify({ activeGoalProseSpawn, activeGoalProseState })}`);
  }
  await tools.get("agent_close").execute(
    "agent-active-goal-prose-close",
    { agent_ids: [activeGoalProseAgentId] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push(new Promise(() => undefined));
  const activeGoalSteeredSpawn = await tools.get("agent_spawn").execute(
    "agent-active-goal-steered-spawn",
    { profile: "finder", message: "do not complete from steered prose alone", create_goal: true },
    undefined,
    undefined,
    ctx,
  );
  const activeGoalSteeredAgentId = activeGoalSteeredSpawn.details?.agent_id;
  const activeGoalSteeredRunId = activeGoalSteeredSpawn.details?.run_id;
  childSendResponses.push({ output: longAgentOutput("active child goal steered prose"), status: "completed" });
  const activeGoalSteeredSend = await tools.get("agent_send").execute(
    "agent-active-goal-steered-send",
    { agent_id: activeGoalSteeredAgentId, message: "steer this spawned objective" },
    undefined,
    undefined,
    ctx,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const activeGoalSteeredState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const activeGoalSteeredRun = activeGoalSteeredState?.data?.runs?.find((run) => run.run_id === activeGoalSteeredRunId);
  if (
    activeGoalSteeredSpawn.details?.ok !== true ||
    activeGoalSteeredSend.details?.deliveryKind !== "steered" ||
    activeGoalSteeredRun?.status !== "running" ||
    activeGoalSteeredRun?.output_available === true
  ) {
    throw new Error(`agent_send completion bypassed spawned-run goal gating: ${JSON.stringify({ activeGoalSteeredSpawn, activeGoalSteeredSend, activeGoalSteeredState })}`);
  }
  await tools.get("agent_close").execute(
    "agent-active-goal-steered-close",
    { agent_ids: [activeGoalSteeredAgentId] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push(new Promise(() => undefined));
  const blockedGoalSteeredSpawn = await tools.get("agent_spawn").execute(
    "agent-blocked-goal-steered-spawn",
    { profile: "finder", message: "fail from steered blocked goal", create_goal: true },
    undefined,
    undefined,
    ctx,
  );
  const blockedGoalSteeredAgentId = blockedGoalSteeredSpawn.details?.agent_id;
  const blockedGoalSteeredRunId = blockedGoalSteeredSpawn.details?.run_id;
  const blockedGoalSteeredOutput = longAgentOutput("blocked steered child goal");
  childSendResponses.push({ output: blockedGoalSteeredOutput, status: "completed", goalStatus: "blocked" });
  const blockedGoalSteeredSend = await tools.get("agent_send").execute(
    "agent-blocked-goal-steered-send",
    { agent_id: blockedGoalSteeredAgentId, message: "steer into blocked goal" },
    undefined,
    undefined,
    ctx,
  );
  const blockedGoalSteered = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === blockedGoalSteeredRunId);
    return run?.status === "failed" ? { state, run } : undefined;
  }, "blocked goal after steered send did not fail the spawned run");
  if (
    blockedGoalSteeredSpawn.details?.ok !== true ||
    blockedGoalSteeredSend.details?.deliveryKind !== "steered" ||
    blockedGoalSteered.run?.reason !== "goal_blocked" ||
    Object.hasOwn(blockedGoalSteered.run ?? {}, "final_output")
  ) {
    throw new Error(`agent_send completion bypassed blocked spawned-run goal state: ${JSON.stringify({ blockedGoalSteeredSpawn, blockedGoalSteeredSend, blockedGoalSteered })}`);
  }
  const blockedGoalSteeredWait = await tools.get("agent_wait").execute(
    "agent-blocked-goal-steered-wait",
    { run_ids: [blockedGoalSteeredRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const blockedGoalSteeredWaitRun = blockedGoalSteeredWait.details?.runs?.find((run) => run.run_id === blockedGoalSteeredRunId);
  if (
    blockedGoalSteeredWaitRun?.status !== "failed" ||
    blockedGoalSteeredWaitRun?.error !== "goal_blocked" ||
    blockedGoalSteeredWaitRun?.finalOutput !== blockedGoalSteeredOutput ||
    blockedGoalSteeredWaitRun?.consumed !== true
  ) {
    throw new Error(`agent_wait did not expose blocked spawned-run state after steered send: ${JSON.stringify(blockedGoalSteeredWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-blocked-goal-steered-close",
    { agent_ids: [blockedGoalSteeredAgentId] },
    undefined,
    undefined,
    ctx,
  );

  childSendResponses.push({ stopReason: "timed_out", suppressAgentEndEvent: true });
  const hostTimeoutSpawn = await tools.get("agent_spawn").execute(
    "agent-host-timeout-spawn",
    { profile: "finder", message: "host timeout only" },
    undefined,
    undefined,
    ctx,
  );
  const hostTimeoutAgentId = hostTimeoutSpawn.details?.agent_id;
  const hostTimeoutRunId = hostTimeoutSpawn.details?.run_id;
  const hostTimeout = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === hostTimeoutRunId);
    return run?.status === "timed_out" ? { state, run } : undefined;
  }, "host-result child timeout stopReason was not recorded");
  if (
    hostTimeoutSpawn.details?.ok !== true ||
    hostTimeout.run?.reason !== "timed_out"
  ) {
    throw new Error(`agent_spawn classified host-result timed_out stopReason incorrectly: ${JSON.stringify({ hostTimeoutSpawn, hostTimeout })}`);
  }
  await tools.get("agent_wait").execute(
    "agent-host-timeout-wait",
    { run_ids: [hostTimeoutRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  await tools.get("agent_close").execute(
    "agent-host-timeout-close",
    { agent_ids: [hostTimeoutAgentId] },
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
    { profile: "finder", message: "event timeout only" },
    undefined,
    undefined,
    ctx,
  );
  const eventTimeoutAgentId = eventTimeoutSpawn.details?.agent_id;
  const eventTimeoutRunId = eventTimeoutSpawn.details?.run_id;
  const eventTimeout = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === eventTimeoutRunId);
    return run?.status === "timed_out" ? { state, run } : undefined;
  }, "agent_end child timeout stopReason was not recorded");
  if (
    eventTimeoutSpawn.details?.ok !== true ||
    eventTimeout.run?.reason !== "timed_out"
  ) {
    throw new Error(`agent_spawn classified agent_end timed_out stopReason incorrectly: ${JSON.stringify({ eventTimeoutSpawn, eventTimeout })}`);
  }
  await tools.get("agent_wait").execute(
    "agent-event-timeout-wait",
    { run_ids: [eventTimeoutRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  await tools.get("agent_close").execute(
    "agent-event-timeout-close",
    { agent_ids: [eventTimeoutAgentId] },
    undefined,
    undefined,
    ctx,
  );

  nextAgentSessionResult = {};
  const failedDispatchSpawn = await tools.get("agent_spawn").execute(
    "agent-dispatch-failed-spawn",
    { profile: "finder", message: "cannot start child" },
    undefined,
    undefined,
    ctx,
  );
  const failedDispatchAgentId = failedDispatchSpawn.details?.agent_id;
  const failedDispatchRunId = failedDispatchSpawn.details?.run_id;
  const failedDispatchSpawnState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const failedDispatchSpawnAgent = failedDispatchSpawnState?.data?.agents?.find((agent) => agent.agent_id === failedDispatchAgentId);
  const failedDispatchSpawnRun = failedDispatchSpawnState?.data?.runs?.find((run) => run.run_id === failedDispatchRunId);
  if (
    failedDispatchSpawn.details?.ok !== false ||
    failedDispatchSpawn.details?.dispatchFailed !== true ||
    failedDispatchSpawn.details?.dispatch?.dispatched !== false ||
    failedDispatchSpawn.details?.dispatch?.reason !== "createAgentSession did not return a session" ||
    !Array.isArray(failedDispatchSpawnAgent?.active_tools) ||
    !failedDispatchSpawnAgent.active_tools.includes("exec_command") ||
    failedDispatchSpawnRun?.status !== "failed" ||
    failedDispatchSpawnRun?.reason !== null
  ) {
    throw new Error(`agent_spawn dispatch failure did not fail the persisted run: ${JSON.stringify({ failedDispatchSpawn, failedDispatchSpawnState })}`);
  }
  const failedDispatchWait = await tools.get("agent_wait").execute(
    "agent-dispatch-failed-wait",
    { run_ids: [failedDispatchRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    failedDispatchWait.details?.runs?.find((run) => run.run_id === failedDispatchRunId)?.status !== "failed" ||
    failedDispatchWait.details?.runs?.find((run) => run.run_id === failedDispatchRunId)?.error !== "createAgentSession did not return a session" ||
    failedDispatchWait.details?.runs?.find((run) => run.run_id === failedDispatchRunId)?.consumed !== true
  ) {
    throw new Error(`agent_wait did not observe failed dispatch as terminal: ${JSON.stringify(failedDispatchWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-dispatch-failed-close",
    { agent_ids: [failedDispatchAgentId] },
    undefined,
    undefined,
    ctx,
  );

  const failedSendWorker = await tools.get("agent_spawn").execute(
    "agent-send-dispatch-failure-spawn",
    { profile: "finder", message: "start before failed send" },
    undefined,
    undefined,
    ctx,
  );
  const failedSendAgentId = failedSendWorker.details?.agent_id;
  const failedSendRunId = failedSendWorker.details?.run_id;
  if (failedSendWorker.details?.ok !== true || typeof failedSendRunId !== "string") {
    throw new Error(`agent_send dispatch failure setup spawn failed: ${JSON.stringify(failedSendWorker)}`);
  }
  childSendResponses.push(Promise.reject(new Error("send failed")));
  const failedDispatchSend = await tools.get("agent_send").execute(
    "agent-send-dispatch-failure",
    { agent_id: failedSendAgentId, message: "failed dispatch" },
    undefined,
    undefined,
    ctx,
  );
  const failedDispatchSendState = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === failedSendRunId);
    return run?.status === "failed" ? { state, run } : undefined;
  }, "agent_send dispatch failure was not recorded");
  if (
    failedDispatchSend.details?.ok !== true ||
    failedDispatchSend.details?.run_id !== failedSendRunId ||
    failedDispatchSend.details?.deliveryKind !== "steered" ||
    failedDispatchSendState.run?.reason !== null
  ) {
    throw new Error(`agent_send dispatch failure did not fail the replacement run: ${JSON.stringify({ failedDispatchSend, failedDispatchSendState })}`);
  }
  await tools.get("agent_wait").execute(
    "agent-send-dispatch-failure-wait",
    { run_ids: [failedSendRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  await tools.get("agent_close").execute(
    "agent-send-dispatch-failure-close",
    { agent_ids: [failedSendAgentId] },
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
    goalStatus: "complete",
  });
  const successfulNoOutputExpanded = longAgentOutput("successful no-output follow-up");
  childSendResponses.push({ output: successfulNoOutputExpanded, status: "completed" });
  const successfulNoOutputSpawn = await tools.get("agent_spawn").execute(
    "agent-successful-no-output-spawn",
    { profile: "finder", message: "successful no output", create_goal: true },
    undefined,
    undefined,
    ctx,
  );
  const successfulNoOutputAgentId = successfulNoOutputSpawn.details?.agent_id;
  const successfulNoOutputRunId = successfulNoOutputSpawn.details?.run_id;
  const successfulNoOutput = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === successfulNoOutputRunId);
    return run?.status === "completed" ? { state, run } : undefined;
  }, "successful terminal child without assistant output was not recorded");
  if (
    successfulNoOutputSpawn.details?.ok !== true ||
    Object.hasOwn(successfulNoOutput.run ?? {}, "final_output") ||
    successfulNoOutput.run?.reason !== null
  ) {
    throw new Error(`agent_spawn did not persist textless successful terminal child correctly: ${JSON.stringify({ successfulNoOutputSpawn, successfulNoOutput })}`);
  }
  const successfulNoOutputWait = await tools.get("agent_wait").execute(
    "agent-successful-no-output-wait",
    { run_ids: [successfulNoOutputRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const successfulNoOutputWaitRun = successfulNoOutputWait.details?.runs?.find((run) => run.run_id === successfulNoOutputRunId);
  if (
    successfulNoOutputWaitRun?.status !== "completed" ||
    successfulNoOutputWaitRun?.finalOutput !== successfulNoOutputExpanded ||
    successfulNoOutputWaitRun?.consumed !== true
  ) {
    throw new Error(`agent_wait did not surface textless successful terminal child: ${JSON.stringify(successfulNoOutputWait)}`);
  }
  const successfulNoOutputFollowUp = childDispatchCalls.find((call) =>
    call.sessionId === successfulNoOutputSpawn.details.childSession.sessionId &&
    call.content.includes("Your previous response was too brief")
  );
  if (successfulNoOutputFollowUp?.method !== "prompt") {
    throw new Error(`agent_spawn did not request a more complete handoff after a too-brief result: ${JSON.stringify(childDispatchCalls.slice(-5))}`);
  }
  await tools.get("agent_close").execute(
    "agent-successful-no-output-close",
    { agent_ids: [successfulNoOutputAgentId] },
    undefined,
    undefined,
    ctx,
  );

  const blockedGoalOutput = longAgentOutput("blocked child goal");
  childSendResponses.push({ output: blockedGoalOutput, status: "completed", goalStatus: "blocked" });
  const blockedGoalSpawn = await tools.get("agent_spawn").execute(
    "agent-blocked-goal-spawn",
    { profile: "finder", message: "blocked child goal", create_goal: true },
    undefined,
    undefined,
    ctx,
  );
  const blockedGoalAgentId = blockedGoalSpawn.details?.agent_id;
  const blockedGoalRunId = blockedGoalSpawn.details?.run_id;
  const blockedGoal = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === blockedGoalRunId);
    return run?.status === "failed" ? { state, run } : undefined;
  }, "blocked child goal did not fail the parent-visible run");
  if (
    blockedGoalSpawn.details?.ok !== true ||
    blockedGoal.run?.reason !== "goal_blocked" ||
    Object.hasOwn(blockedGoal.run ?? {}, "final_output")
  ) {
    throw new Error(`agent_spawn did not map blocked child goal to failed parent run metadata: ${JSON.stringify({ blockedGoalSpawn, blockedGoal })}`);
  }
  const blockedGoalWait = await tools.get("agent_wait").execute(
    "agent-blocked-goal-wait",
    { run_ids: [blockedGoalRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const blockedGoalWaitRun = blockedGoalWait.details?.runs?.find((run) => run.run_id === blockedGoalRunId);
  if (
    blockedGoalWaitRun?.status !== "failed" ||
    blockedGoalWaitRun?.error !== "goal_blocked" ||
    blockedGoalWaitRun?.finalOutput !== blockedGoalOutput ||
    blockedGoalWaitRun?.consumed !== true
  ) {
    throw new Error(`agent_wait did not expose blocked child goal failure: ${JSON.stringify(blockedGoalWait)}`);
  }
  await tools.get("agent_close").execute(
    "agent-blocked-goal-close",
    { agent_ids: [blockedGoalAgentId] },
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
    { profile: "finder", message: "terminal no output" },
    undefined,
    undefined,
    ctx,
  );
  const terminalNoOutputAgentId = terminalNoOutputSpawn.details?.agent_id;
  const terminalNoOutputRunId = terminalNoOutputSpawn.details?.run_id;
  const terminalNoOutput = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === terminalNoOutputRunId);
    return run?.status === "failed" ? { state, run } : undefined;
  }, "terminal child error without assistant output was not recorded");
  if (
    terminalNoOutputSpawn.details?.ok !== true ||
    Object.hasOwn(terminalNoOutput.run ?? {}, "final_output") ||
    terminalNoOutput.run?.reason !== null
  ) {
    throw new Error(`agent_spawn did not persist textless terminal child error correctly: ${JSON.stringify({ terminalNoOutputSpawn, terminalNoOutput })}`);
  }
  const terminalNoOutputWait = await tools.get("agent_wait").execute(
    "agent-terminal-no-output-wait",
    { run_ids: [terminalNoOutputRunId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  const terminalNoOutputWaitRun = terminalNoOutputWait.details?.runs?.find((run) => run.run_id === terminalNoOutputRunId);
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
    !terminalErrorList.content?.[0]?.text?.includes(`<run id="${terminalNoOutputRunId}" status="failed"`)
  ) {
    throw new Error(`agent_list did not expose terminal error in model-visible text: ${JSON.stringify(terminalErrorList)}`);
  }
  await tools.get("agent_close").execute(
    "agent-terminal-no-output-close",
    { agent_ids: [terminalNoOutputAgentId] },
    undefined,
    undefined,
    ctx,
  );

  const inheritedProfileSessionCountBefore = agentSessionCalls.length;
  const inheritedProfileResult = await tools.get("agent_spawn").execute(
    "agent-inherited-profile-call",
    { profile: "scout", message: "spawn inherited model worker" },
    undefined,
    undefined,
    ctx,
  );
  if (agentSessionCalls.length !== inheritedProfileSessionCountBefore + 1 || inheritedProfileResult.details?.childSession?.created !== true) {
    throw new Error(`agent spawn did not create inherited profile child session: ${JSON.stringify(inheritedProfileResult)}`);
  }
  const inheritedProfileOptions = agentSessionCalls.at(-1);
  const inheritedProfileSetupEntries =
    typeof inheritedProfileOptions?.sessionManager?.getEntries === "function"
      ? inheritedProfileOptions.sessionManager.getEntries()
      : [];
  if (
    inheritedProfileOptions?.model?.provider !== "openai-codex" ||
    inheritedProfileOptions?.model?.id !== "gpt-test" ||
    inheritedProfileResult.details?.childSession?.modelId !== null ||
    inheritedProfileResult.details?.childSession?.modelApplied !== true ||
    !inheritedProfileSetupEntries.some((entry) => entry?.type === "custom" && entry?.customType === "taumel.childSession")
  ) {
    throw new Error(`agent spawn did not inherit parent model or preseed child metadata: ${JSON.stringify({ inheritedProfileResult, inheritedProfileOptions, inheritedProfileSetupEntries })}`);
  }
  await tools.get("agent_close").execute(
    "agent-inherited-profile-close",
    { agent_ids: [inheritedProfileResult.details?.agent_id] },
    undefined,
    undefined,
    ctx,
  );

  const agentSessionCountBeforeSmoke = agentSessionCalls.length;
  const agentResult = await tools.get("agent_spawn").execute(
    "agent-call",
    { profile: "finder", message: "spawn smoke worker", create_goal: true },
    undefined,
    undefined,
    ctx,
  );
  if (agentSessionCalls.length !== agentSessionCountBeforeSmoke + 1 || agentResult.details?.childSession?.created !== true) {
    throw new Error(`agent spawn did not create a child session through SDK adapter: ${JSON.stringify(agentResult)}`);
  }
  const smokeAgentId = agentResult.details?.agent_id;
  const smokeRun1 = agentResult.details?.run_id;
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
  const agentChildGoal = agentChildEntries.find((entry) => entry.type === "taumel.goal")?.value;
  const agentChildGoalAutomation = agentChildEntries.find((entry) => entry.type === "taumel.goal_automation")?.value;
  if (
    agentChildMetadata?.kind !== "agent" ||
    !agentChildMetadata?.agentSystemPrompt?.includes("You are the finder Taumel subagent") ||
    agentChildGoal?.objective !== "spawn smoke worker" ||
    agentChildGoal?.status !== "active" ||
    agentChildGoalAutomation !== null
  ) {
    throw new Error(`agent child did not persist profile prompt and initial goal metadata: ${JSON.stringify(agentChildEntries)}`);
  }
  if (
    agentResult.details?.worker?.parentId !== "parent-session" ||
    agentResult.details?.worker?.depth !== 1 ||
    typeof smokeAgentId !== "string" ||
    typeof smokeRun1 !== "string" ||
    agentResult.details?.submission_id !== `${smokeRun1}-submission-1` ||
    agentResult.details?.deliveryKind !== "started"
  ) {
    throw new Error(`agent spawn did not record root ownership: ${JSON.stringify(agentResult)}`);
  }
  const spawnedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const persistedSmokeAgent = spawnedAgentsState?.data?.agents?.find((agent) => agent.agent_id === smokeAgentId);
  const persistedSmokeRun = spawnedAgentsState?.data?.runs?.find((run) => run.run_id === smokeRun1);
  if (
    persistedSmokeAgent?.profile !== "finder" ||
    persistedSmokeAgent?.child_session_id !== agentResult.details.childSession.sessionId ||
    persistedSmokeAgent?.profile_snapshot?.modelId !== "openai-codex/gpt-override" ||
    persistedSmokeAgent?.profile_snapshot?.thinkingLevel !== "high" ||
    persistedSmokeAgent?.sandbox_snapshot?.filesystemMode !== "workspace-write" ||
    Object.hasOwn(persistedSmokeAgent ?? {}, "system_prompt") ||
    !persistedSmokeAgent?.active_tools?.includes("exec_command") ||
    persistedSmokeRun?.status !== "running" ||
    persistedSmokeRun?.initial_submission_kind !== "objective" ||
    persistedSmokeRun?.submissions?.[0]?.kind !== "objective" ||
    Object.hasOwn(persistedSmokeRun ?? {}, "description")
  ) {
    throw new Error(`agent spawn did not persist agent/run metadata: ${JSON.stringify(spawnedAgentsState)}`);
  }
  const recreateAgentId = "finder-recreate";
  const recreateEntries = [
    {
      type: "custom",
      customType: "taumel.agents",
      data: {
        version: 1,
        profiles: [{ name: "finder", enabled: true }],
        agents: [{
          agent_id: recreateAgentId,
          parent_session_id: "recreate-session",
          profile: "finder",
          child_session_id: null,
          profile_snapshot: persistedSmokeAgent.profile_snapshot,
          sandbox_snapshot: persistedSmokeAgent.sandbox_snapshot,
          active_tools: persistedSmokeAgent.active_tools,
          created_at: 1,
          closed_at: null,
        }],
        runs: [],
      },
    },
  ];
  const recreateCtx = {
    ...ctx,
    taumelSessionId: "recreate-session",
    sessionManager: {
      getSessionId: () => "recreate-session",
      getSessionFile: () => join(cwd, "recreate-session.json"),
      appendCustomEntry: (type, value) => {
        recreateEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => recreateEntries,
      getBranch: () => [],
    },
  };
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, recreateCtx);
  }
  const idleInterruptChildBefore = childCounter;
  const idleInterruptDispatchBefore = childDispatchCalls.length;
  const idleInterruptRunCountBefore = recreateEntries
    .filter((entry) => entry.customType === "taumel.agents")
    .at(-1)?.data?.runs?.length ?? 0;
  const idleInterruptSend = await tools.get("agent_send").execute(
    "agent-send-idle-interrupt",
    { agent_id: recreateAgentId, interrupt: true },
    undefined,
    undefined,
    recreateCtx,
  );
  const idleInterruptState = recreateEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    idleInterruptSend.details?.ok !== true ||
    idleInterruptSend.details?.deliveryKind !== "no_active_run" ||
    Object.hasOwn(idleInterruptSend.details ?? {}, "run_id") ||
    idleInterruptSend.details?.status !== "no_active_run" ||
    !idleInterruptSend.content?.[0]?.text?.includes('<summary status="no_active_run"') ||
    childCounter !== idleInterruptChildBefore ||
    childDispatchCalls.length !== idleInterruptDispatchBefore ||
    (idleInterruptState?.data?.runs?.length ?? 0) !== idleInterruptRunCountBefore
  ) {
    throw new Error(`idle interrupt-only agent_send created work: ${JSON.stringify({ idleInterruptSend, idleInterruptState, childCounter, idleInterruptChildBefore, childDispatchCalls: childDispatchCalls.slice(idleInterruptDispatchBefore) })}`);
  }
  childSendResponses.push(new Promise(() => undefined));
  const recreatedChildBefore = childCounter;
  const recreateSend = await tools.get("agent_send").execute(
    "agent-send-recreate-child",
    { agent_id: recreateAgentId, message: "plain message after restart" },
    undefined,
    undefined,
    recreateCtx,
  );
  const recreatedChildId = `child-${childCounter}`;
  const recreatedChildEntries = customEntries.filter((entry) => entry.sessionId === recreatedChildId);
  if (
    recreateSend.details?.ok !== true ||
    recreateSend.details?.deliveryKind !== "started" ||
    childCounter !== recreatedChildBefore + 1 ||
    !recreatedChildEntries.some((entry) => entry.type === "taumel.childSession") ||
    recreatedChildEntries.some((entry) => entry.type === "taumel.goal") ||
    recreatedChildEntries.some((entry) => entry.type === "taumel.goal_automation")
  ) {
    throw new Error(`agent_send recreated child session with goal state for a normal message: ${JSON.stringify({ recreateSend, recreatedChildEntries })}`);
  }
  await tools.get("agent_close").execute(
    "agent-send-recreate-close",
    { agent_ids: [recreateAgentId] },
    undefined,
    undefined,
    recreateCtx,
  );
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, ctx);
  }
  const listedAgents = await tools.get("agent_list").execute(
    "agent-list",
    {},
    undefined,
    undefined,
    ctx,
  );
  if (
    listedAgents.details?.agents?.find((agent) => agent.agent_id === smokeAgentId)?.run_state !== "running" ||
    typeof listedAgents.details?.agents?.find((agent) => agent.agent_id === smokeAgentId)?.latestRun?.elapsedSeconds !== "number" ||
    !listedAgents.content?.[0]?.text?.includes(`<run id="${smokeRun1}" status="running"`)
  ) {
    throw new Error(`agent_list did not report durable run metadata: ${JSON.stringify(listedAgents)}`);
  }
  const sendAgent = await tools.get("agent_send").execute(
    "agent-send",
    { agent_id: smokeAgentId, message: "continue smoke worker" },
    undefined,
    undefined,
    ctx,
  );
  const sentAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const sentRun = sentAgentsState?.data?.runs?.find((run) => run.run_id === smokeRun1);
  if (
    sendAgent.details?.deliveryKind !== "steered" ||
    sendAgent.details?.submission_id !== `${smokeRun1}-submission-2` ||
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
    waitActive.details?.runs?.find((run) => run.run_id === smokeRun1)?.status !== "running"
  ) {
    throw new Error(`agent_wait did not report active persisted run: ${JSON.stringify(waitActive)}`);
  }
  const waitByRun = await tools.get("agent_wait").execute(
    "agent-wait-by-run",
    { run_ids: [smokeRun1], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitByRun.details?.runs?.find((run) => run.run_id === smokeRun1)?.consumed !== false
  ) {
    throw new Error(`agent_wait consumed a non-terminal run: ${JSON.stringify(waitByRun)}`);
  }
  const waitTimedOut = await tools.get("agent_wait").execute(
    "agent-wait-timeout",
    { run_ids: [smokeRun1], timeout_seconds: 0.01 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitTimedOut.details?.waitTimedOut !== true ||
    waitTimedOut.details?.status !== "timed_out" ||
    waitTimedOut.details?.runs?.find((run) => run.run_id === smokeRun1)?.status !== "running"
  ) {
    throw new Error(`agent_wait timeout did not return a non-cancelling wait result: ${JSON.stringify(waitTimedOut)}`);
  }
  const interruptController = new AbortController();
  const interruptedWait = tools.get("agent_wait").execute(
    "agent-wait-interrupted",
    { run_ids: [smokeRun1] },
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
    interruptedWaitResult.details?.runs?.find((run) => run.run_id === smokeRun1)?.status !== "running"
  ) {
    throw new Error(`agent_wait interruption did not return a non-cancelling wait result: ${JSON.stringify(interruptedWaitResult)}`);
  }
  const invalidWait = await tools.get("agent_wait").execute(
    "agent-wait-invalid",
    { run_ids: [smokeRun1], agent_ids: [smokeAgentId] },
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
    { profile: "finder", message: "wait loop worker" },
    undefined,
    undefined,
    ctx,
  );
  const waitWorkerAgentId = waitWorker.details?.agent_id;
  const waitWorkerRunId = waitWorker.details?.run_id;
  if (waitWorker.details?.ok !== true || typeof waitWorkerRunId !== "string") {
    throw new Error(`agent_wait setup spawn failed: ${JSON.stringify(waitWorker)}`);
  }
  const waitLoop = tools.get("agent_wait").execute(
    "agent-wait-loop",
    { run_ids: [waitWorkerRunId] },
    undefined,
    undefined,
    ctx,
  );
  setTimeout(() => {
    globalThis.taumel.call("recordAgentDispatchCompletion", [{
      prepared: { run_id: waitWorkerRunId },
      completion: { status: "completed", finalOutput: "wait loop final output" },
    }, ctx]);
  }, 20);
  const waitLoopResult = await Promise.race([
    waitLoop,
    new Promise((_, reject) => setTimeout(() => reject(new Error("agent_wait omitted timeout did not return after completion")), 1000)),
  ]);
  if (
    waitLoopResult.details?.runs?.find((run) => run.run_id === waitWorkerRunId)?.status !== "completed" ||
    waitLoopResult.details?.runs?.find((run) => run.run_id === waitWorkerRunId)?.finalOutput !== "wait loop final output" ||
    waitLoopResult.details?.runs?.find((run) => run.run_id === waitWorkerRunId)?.consumed !== true
  ) {
    throw new Error(`agent_wait did not wait for terminal run output: ${JSON.stringify(waitLoopResult)}`);
  }
  await tools.get("agent_close").execute(
    "agent-wait-loop-close",
    { agent_ids: [waitWorkerAgentId] },
    undefined,
    undefined,
    ctx,
  );
  let resolveWaitOwnedCompletion;
  childSendResponses.push(new Promise((resolve) => { resolveWaitOwnedCompletion = resolve; }));
  const waitOwnedSpawn = await tools.get("agent_spawn").execute(
    "agent-wait-owned-spawn",
    { profile: "finder", message: "complete while parent waits" },
    undefined,
    undefined,
    ctx,
  );
  const waitOwnedAgentId = waitOwnedSpawn.details?.agent_id;
  const waitOwnedRunId = waitOwnedSpawn.details?.run_id;
  if (waitOwnedSpawn.details?.ok !== true || typeof waitOwnedRunId !== "string") {
    throw new Error(`agent_wait owned completion setup spawn failed: ${JSON.stringify(waitOwnedSpawn)}`);
  }
  const waitOwnedCompletionMessageCount = sentMessages.length;
  const waitOwnedLoop = tools.get("agent_wait").execute(
    "agent-wait-owned-loop",
    { run_ids: [waitOwnedRunId] },
    undefined,
    undefined,
    ctx,
  );
  const waitOwnedFinalOutput = longAgentOutput("wait-owned final output");
  setTimeout(() => {
    resolveWaitOwnedCompletion({ output: waitOwnedFinalOutput, status: "completed", goalStatus: "complete" });
  }, 20);
  const waitOwnedResult = await Promise.race([
    waitOwnedLoop,
    new Promise((_, reject) => setTimeout(() => reject(new Error("agent_wait owned completion did not return")), 1000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (
    waitOwnedResult.details?.runs?.find((run) => run.run_id === waitOwnedRunId)?.status !== "completed" ||
    waitOwnedResult.details?.runs?.find((run) => run.run_id === waitOwnedRunId)?.finalOutput !== waitOwnedFinalOutput ||
    waitOwnedResult.details?.runs?.find((run) => run.run_id === waitOwnedRunId)?.consumed !== true ||
    sentMessages.length !== waitOwnedCompletionMessageCount
  ) {
    throw new Error(`agent_wait-owned completion produced duplicate notification: ${JSON.stringify({
      waitOwnedResult,
      messages: sentMessages.slice(waitOwnedCompletionMessageCount),
    })}`);
  }
  await tools.get("agent_close").execute(
    "agent-wait-owned-close",
    { agent_ids: [waitOwnedAgentId] },
    undefined,
    undefined,
    ctx,
  );
  const stoppedRun = await commands.get("agent-runs").handler(`stop ${smokeAgentId}`, ctx);
  const stoppedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const stoppedPersistedRun = stoppedAgentsState?.data?.runs?.find((run) => run.run_id === smokeRun1);
  if (
    stoppedRun.action !== "command_result" ||
    !stoppedRun.message.includes(`Stopped ${smokeAgentId}`) ||
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
  const outputRun = await commands.get("agent-runs").handler(`output ${smokeAgentId}`, ctx);
  if (
    outputRun.action !== "command_result" ||
    !outputRun.message.includes(`No final output for ${smokeRun1} [cancelled]`) ||
    outputRun.details?.run?.status !== "cancelled"
  ) {
    throw new Error(`agent-runs output did not report persisted run output/status: ${JSON.stringify(outputRun)}`);
  }
  const stopAgain = await commands.get("agent-runs").handler(`stop ${smokeAgentId}`, ctx);
  if (
    stopAgain.action !== "command_result" ||
    !stopAgain.message.includes(`No active run for ${smokeAgentId}`)
  ) {
    throw new Error(`agent-runs stop should be idempotent for inactive runs: ${JSON.stringify(stopAgain)}`);
  }
  childSendResponses.push({ output: "final smoke summary", status: "completed" });
  const completionMessageCount = sentMessages.length;
  const completedSend = await tools.get("agent_send").execute(
    "agent-send-completes",
    { agent_id: smokeAgentId, message: "finish with a summary" },
    undefined,
    undefined,
    ctx,
  );
  const completed = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === `${smokeAgentId}-run-2`);
    return run?.status === "completed"
      ? { state, run }
      : undefined;
  }, "agent_send did not persist host-returned final output");
  if (
    completedSend.details?.run_id !== `${smokeAgentId}-run-2` ||
    completed.run?.status !== "completed" ||
    Object.hasOwn(completed.run ?? {}, "final_output")
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
    !completedList.content?.[0]?.text?.includes(`<run id="${smokeAgentId}-run-2" status="completed"`)
  ) {
    throw new Error(`agent_list did not expose terminal final output in model-visible text: ${JSON.stringify(completedList)}`);
  }
  const completionMessage = await waitFor(() => {
    const message = sentMessages.at(-1);
    return sentMessages.length === completionMessageCount + 1 &&
      message?.message?.customType === "notification"
      ? message
      : undefined;
  }, "agent completion notification was not delivered", 2500);
  if (
    sentMessages.length !== completionMessageCount + 1 ||
    completionMessage?.message?.customType !== "notification" ||
    completionMessage?.message?.display !== true ||
    !completionMessage.message.content.includes(`${smokeAgentId}-run-2`) ||
    !completionMessage.message.content.includes("agent_wait with run_ids=") ||
    completionMessage.message.content.includes("final smoke summary") ||
    completionMessage?.options?.triggerTurn !== true
  ) {
    throw new Error(`agent completion was not delivered visibly to the parent: ${JSON.stringify(sentMessages.slice(completionMessageCount))}`);
  }
  const backgroundNotified = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === `${smokeAgentId}-run-2`);
    return run?.background_notified === true ? { state, run } : undefined;
  }, "agent completion delivery did not persist background notification metadata");
  if (backgroundNotified.run?.consumed !== false) {
    throw new Error(`background completion notification should not mark the run consumed: ${JSON.stringify(backgroundNotified)}`);
  }
  const waitCompleted = await tools.get("agent_wait").execute(
    "agent-wait-completed-run",
    { run_ids: [`${smokeAgentId}-run-2`], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    waitCompleted.details?.runs?.find((run) => run.run_id === `${smokeAgentId}-run-2`)?.finalOutput !== "final smoke summary" ||
    waitCompleted.details?.runs?.find((run) => run.run_id === `${smokeAgentId}-run-2`)?.consumed !== true ||
    waitCompleted.details?.runs?.find((run) => run.run_id === `${smokeAgentId}-run-2`)?.backgroundNotified !== true ||
    !waitCompleted.content?.[0]?.text?.includes("final smoke summary")
  ) {
    throw new Error(`agent_wait did not expose completed final output: ${JSON.stringify(waitCompleted)}`);
  }
  const afterExplicitNotifiedWait = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const afterExplicitNotifiedWaitRun = afterExplicitNotifiedWait?.data?.runs?.find((run) => run.run_id === `${smokeAgentId}-run-2`);
  if (
    afterExplicitNotifiedWaitRun?.consumed !== true ||
    afterExplicitNotifiedWaitRun?.background_notified !== true
  ) {
    throw new Error(`explicit agent_wait did not consume background-notified delivery state exactly once: ${JSON.stringify({
      waitCompleted,
      afterExplicitNotifiedWait,
    })}`);
  }
  childSendResponses.push({ output: "fast wait final output", status: "completed" });
  const fastCompletionMessageCount = sentMessages.length;
  parentIdle = false;
  const fastCompletedSend = await tools.get("agent_send").execute(
    "agent-send-fast-completes",
    { agent_id: smokeAgentId, message: "finish before the parent waits" },
    undefined,
    undefined,
    ctx,
  );
  const fastCompleted = await waitFor(() => {
    const state = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
    const run = state?.data?.runs?.find((candidate) => candidate.run_id === `${smokeAgentId}-run-3`);
    return run?.status === "completed"
      ? { state, run }
      : undefined;
  }, "fast agent_send completion was not recorded");
  const fastDefaultWait = await tools.get("agent_wait").execute(
    "agent-wait-fast-completed-run",
    {},
    undefined,
    undefined,
    ctx,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const fastWaitRun = fastDefaultWait.details?.runs?.find((run) => run.run_id === `${smokeAgentId}-run-3`);
  if (
    fastCompletedSend.details?.run_id !== `${smokeAgentId}-run-3` ||
    fastCompleted.run?.background_notified === true ||
    fastWaitRun?.status !== "completed" ||
    fastWaitRun?.finalOutput !== "fast wait final output" ||
    fastWaitRun?.consumed !== true ||
    sentMessages.length !== fastCompletionMessageCount
  ) {
    throw new Error(`default agent_wait missed or duplicated a fast completed run: ${JSON.stringify({
      fastCompletedSend,
      fastDefaultWait,
      messages: sentMessages.slice(fastCompletionMessageCount),
    })}`);
  }
  parentIdle = true;
  const defaultWaitSpawn = await tools.get("agent_spawn").execute(
    "agent-default-wait-spawn",
    { profile: "finder", message: "default wait worker" },
    undefined,
    undefined,
    ctx,
  );
  const defaultWaitAgentId = defaultWaitSpawn.details?.agent_id;
  const defaultWaitRunId = defaultWaitSpawn.details?.run_id;
  if (defaultWaitSpawn.details?.ok !== true || typeof defaultWaitRunId !== "string") {
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
      prepared: { run_id: defaultWaitRunId },
      completion: { status: "completed", finalOutput: "default wait final output" },
    }, ctx]);
  }, 20);
  const defaultWaitResult = await Promise.race([
    defaultWait,
    new Promise((_, reject) => setTimeout(() => reject(new Error("default agent_wait did not return after completion")), 1000)),
  ]);
  if (
    defaultWaitResult.details?.runs?.find((run) => run.run_id === defaultWaitRunId)?.status !== "completed" ||
    defaultWaitResult.details?.runs?.find((run) => run.run_id === defaultWaitRunId)?.finalOutput !== "default wait final output" ||
    defaultWaitResult.details?.runs?.find((run) => run.run_id === defaultWaitRunId)?.consumed !== true ||
    !defaultWaitResult.content?.[0]?.text?.includes("default wait final output")
  ) {
    throw new Error(`default agent_wait did not keep selected runs through completion: ${JSON.stringify(defaultWaitResult)}`);
  }
  await tools.get("agent_close").execute(
    "agent-default-wait-close",
    { agent_ids: [defaultWaitAgentId] },
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
    !confirmations.at(-1)?.title?.includes(`agent ${smokeAgentId} (finder)`) ||
    !confirmations.at(-1)?.prompt?.includes(`Requesting agent ${smokeAgentId} (finder)`)
  ) {
    throw new Error(`child approval prompt did not identify requesting agent/profile: ${JSON.stringify(confirmations.at(-1))}`);
  }
  const closeParentFromChild = await tools.get("agent_close").execute(
    "agent-child-close-parent",
    { agent_ids: [smokeAgentId] },
    undefined,
    undefined,
    agentChildCtx,
  );
  if (closeParentFromChild.details?.ok === true) {
    throw new Error(`agent child managed its parent worker: ${JSON.stringify(closeParentFromChild)}`);
  }
  const nestedAgentResult = await tools.get("agent_spawn").execute(
    "agent-child-spawn",
    { profile: "finder", message: "try to spawn nested worker" },
    undefined,
    undefined,
    agentChildCtx,
  );
  if (nestedAgentResult.details?.ok === true) {
    throw new Error(`agent child was allowed to spawn a nested agent: ${JSON.stringify(nestedAgentResult)}`);
  }
  const closedAgent = await tools.get("agent_close").execute(
    "agent-close-live-child",
    { agent_ids: [smokeAgentId] },
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
    { profile: "finder", message: "start interruptible work" },
    undefined,
    undefined,
    ctx,
  );
  const interruptAgentId = interruptSpawn.details?.agent_id;
  const interruptRunId = interruptSpawn.details?.run_id;
  const interruptSessionCount = agentSessionCalls.length;
  const interruptSend = await tools.get("agent_send").execute(
    "agent-interrupt-send",
    { agent_id: interruptAgentId, message: "priority steer the active run", interrupt: true },
    undefined,
    undefined,
    ctx,
  );
  const interruptedAgentsState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const interruptedRun = interruptedAgentsState?.data?.runs?.find((run) => run.run_id === interruptRunId);
  if (
    interruptSend.details?.run_id !== interruptRunId ||
    interruptSend.details?.deliveryKind !== "interrupted" ||
    interruptSend.details?.previousRunStatus !== "running" ||
    interruptedRun?.status !== "running" ||
    interruptedRun?.submissions?.length !== 2 ||
    agentSessionCalls.length !== interruptSessionCount ||
    !childLifecycleCalls.some((call) =>
      call.sessionId === interruptSpawn.details.childSession.sessionId &&
      call.method === "abort" &&
      call.reason === "interrupted_by_parent"
    )
  ) {
    throw new Error(`agent_send interrupt did not priority-steer the active run: ${JSON.stringify({ interruptSend, interruptedAgentsState, childLifecycleCalls })}`);
  }
  await tools.get("agent_close").execute(
    "agent-interrupt-close",
    { agent_ids: [interruptAgentId] },
    undefined,
    undefined,
    ctx,
  );
  if (
    !childLifecycleCalls.some((call) =>
      call.sessionId === interruptSpawn.details.childSession.sessionId &&
      call.method === "close" &&
      call.reason === "closed_by_parent"
    )
  ) {
    throw new Error(`agent_close did not close the interrupted child session: ${JSON.stringify({ interruptAgentId, childLifecycleCalls })}`);
  }
  const suspendSpawn = await tools.get("agent_spawn").execute(
    "agent-suspend-spawn",
    { profile: "finder", message: "start suspendable work" },
    undefined,
    undefined,
    ctx,
  );
  const suspendAgentId = suspendSpawn.details?.agent_id;
  const suspendRunId = suspendSpawn.details?.run_id;
  const suspendSend = await tools.get("agent_send").execute(
    "agent-suspend-send",
    { agent_id: suspendAgentId, interrupt: true },
    undefined,
    undefined,
    ctx,
  );
  const suspendedState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const suspendedRun = suspendedState?.data?.runs?.find((run) => run.run_id === suspendRunId);
  if (
    suspendSend.details?.run_id !== suspendRunId ||
    suspendSend.details?.deliveryKind !== "suspended" ||
    suspendedRun?.status !== "suspended" ||
    suspendedRun?.reason !== "interrupted_by_parent" ||
    !childLifecycleCalls.some((call) =>
      call.sessionId === suspendSpawn.details.childSession.sessionId &&
      call.method === "abort" &&
      call.reason === "interrupted_by_parent"
    )
  ) {
    throw new Error(`agent_send interrupt-only did not suspend the run: ${JSON.stringify({ suspendSend, suspendedState, childLifecycleCalls })}`);
  }
  const suspendedWait = await tools.get("agent_wait").execute(
    "agent-suspend-wait",
    { agent_ids: [suspendAgentId], timeout_seconds: 0 },
    undefined,
    undefined,
    ctx,
  );
  if (
    suspendedWait.details?.hasActiveRuns !== false ||
    suspendedWait.details?.runs?.find((run) => run.run_id === suspendRunId)?.status !== "suspended"
  ) {
    throw new Error(`agent_wait did not report suspended run immediately: ${JSON.stringify(suspendedWait)}`);
  }
  const resumedSend = await tools.get("agent_send").execute(
    "agent-resume-send",
    { agent_id: suspendAgentId, message: "resume suspended work" },
    undefined,
    undefined,
    ctx,
  );
  const resumedState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const resumedRun = resumedState?.data?.runs?.find((run) => run.run_id === suspendRunId);
  if (
    resumedSend.details?.run_id !== suspendRunId ||
    resumedSend.details?.deliveryKind !== "resumed" ||
    resumedRun?.status !== "running" ||
    resumedRun?.submissions?.length !== 2
  ) {
    throw new Error(`agent_send did not resume suspended run: ${JSON.stringify({ resumedSend, resumedState })}`);
  }
  await tools.get("agent_close").execute(
    "agent-suspend-close",
    { agent_ids: [suspendAgentId] },
    undefined,
    undefined,
    ctx,
  );
  const multiCloseA = await tools.get("agent_spawn").execute(
    "agent-multi-close-a",
    { profile: "finder", message: "multi close a" },
    undefined,
    undefined,
    ctx,
  );
  const multiCloseB = await tools.get("agent_spawn").execute(
    "agent-multi-close-b",
    { profile: "finder", message: "multi close b" },
    undefined,
    undefined,
    ctx,
  );
  const multiCloseAId = multiCloseA.details?.agent_id;
  const multiCloseBId = multiCloseB.details?.agent_id;
  const conflictingClose = await tools.get("agent_close").execute(
    "agent-close-conflicting-selectors",
    { all: true, agent_ids: [multiCloseAId] },
    undefined,
    undefined,
    ctx,
  );
  const conflictingCloseState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  if (
    conflictingClose.details?.ok === true ||
    !conflictingClose.content?.[0]?.text?.includes("exactly one selector") ||
    conflictingCloseState?.data?.agents?.find((agent) => agent.agent_id === multiCloseAId)?.closed_at !== null ||
    conflictingCloseState?.data?.agents?.find((agent) => agent.agent_id === multiCloseBId)?.closed_at !== null
  ) {
    throw new Error(`agent_close accepted conflicting selectors: ${JSON.stringify({ conflictingClose, conflictingCloseState })}`);
  }
  const multiClosed = await tools.get("agent_close").execute(
    "agent-multi-close",
    { agent_ids: [multiCloseAId, multiCloseBId] },
    undefined,
    undefined,
    ctx,
  );
  const multiClosedState = parentEntries.filter((entry) => entry.customType === "taumel.agents").at(-1);
  const multiClosedIds = new Set(multiClosed.details?.agent_ids ?? []);
  if (
    multiClosed.details?.ok !== true ||
    multiClosed.details?.closedCount !== 2 ||
    !multiClosedIds.has(multiCloseAId) ||
    !multiClosedIds.has(multiCloseBId) ||
    multiClosedState?.data?.agents?.find((agent) => agent.agent_id === multiCloseAId)?.closed_at === undefined ||
    multiClosedState?.data?.agents?.find((agent) => agent.agent_id === multiCloseBId)?.closed_at === undefined ||
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
    join(cwd, ".pi", "settings.json"),
    `${JSON.stringify({
      keepMe: true,
      taumel: {
        agents: { disabled: ["review", "ghost_agent"] },
        tools: { disabled: ["agent_wait", "write_stdin", "ghost_tool"] },
        skills: { disabled: ["bar", "ghost_skill"] },
      },
    }, null, 2)}\n`,
  );
  const defaultEntries = [
    {
      type: "custom",
      customType: "taumel.agents",
      data: {
        version: 1,
        profiles: [{ name: "scout", enabled: false }],
        agents: [],
        runs: [],
      },
    },
  ];
  const defaultCtx = {
    ...ctx,
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "visibility-default-session",
      getSessionFile: () => join(cwd, "visibility-default-session.json"),
      appendCustomEntry: (type, value) => {
        defaultEntries.push({ type: "custom", customType: type, data: value });
      },
      getEntries: () => defaultEntries,
      getBranch: () => [],
    },
  };
  notifications.length = 0;
  activeTools = ["agent_spawn", "agent_wait", "write_stdin", "apply_patch"];
  for (const handler of handlers.get("session_start") ?? []) {
    handler({ type: "session_start" }, defaultCtx);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  const seededVisibility = defaultEntries.find((entry) => entry.customType === "taumel.visibility");
  const defaultAgentProfiles = await tools.get("agent_profiles").execute(
    "agent-profiles-project-defaults",
    {},
    undefined,
    undefined,
    defaultCtx,
  );
  const defaultAgentsList = await commands.get("agents").handler("list", defaultCtx);
  const staleWarningCount = notifications.filter((entry) => entry.message.includes("unavailable disabled")).length;
  if (
    !seededVisibility?.data?.agents?.disabled?.includes("review") ||
    !seededVisibility?.data?.agents?.disabled?.includes("ghost_agent") ||
    !seededVisibility?.data?.agents?.disabled?.includes("scout") ||
    !seededVisibility?.data?.tools?.disabled?.includes("agent_wait") ||
    !seededVisibility?.data?.tools?.disabled?.includes("ghost_tool") ||
    !seededVisibility?.data?.skills?.disabled?.includes("bar") ||
    activeTools.includes("agent_wait") ||
    activeTools.includes("write_stdin") ||
    defaultAgentProfiles.details?.profiles?.some((profile) => profile.name === "review") ||
    !defaultAgentsList.message.includes("ghost_agent [unavailable]") ||
    staleWarningCount < 3
  ) {
    throw new Error(`trusted project visibility defaults were not applied: ${JSON.stringify({ seededVisibility, activeTools, defaultAgentProfiles, defaultAgentsList, notifications })}`);
  }
  const clearGhostTool = await commands.get("tools").handler("enable ghost_tool", defaultCtx);
  const clearGhostSkill = await commands.get("skills").handler("enable ghost_skill", defaultCtx);
  const clearGhostAgent = await commands.get("agents").handler("enable ghost_agent", defaultCtx);
  const clearedGhostVisibility = defaultEntries.filter((entry) => entry.customType === "taumel.visibility").at(-1);
  if (
    clearGhostTool.ok !== true ||
    clearGhostSkill.ok !== true ||
    clearGhostAgent.ok !== true ||
    clearedGhostVisibility?.data?.tools?.disabled?.includes("ghost_tool") ||
    clearedGhostVisibility?.data?.skills?.disabled?.includes("ghost_skill") ||
    clearedGhostVisibility?.data?.agents?.disabled?.includes("ghost_agent") ||
    activeTools.includes("ghost_tool")
  ) {
    throw new Error(`unavailable visibility rows were not cleared safely: ${JSON.stringify({ clearGhostTool, clearGhostSkill, clearGhostAgent, clearedGhostVisibility, activeTools })}`);
  }
  for (const handler of handlers.get("session_resume") ?? []) {
    handler({ type: "session_resume" }, defaultCtx);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  const staleWarningCountAfterResume = notifications.filter((entry) => entry.message.includes("unavailable disabled")).length;
  if (staleWarningCountAfterResume !== staleWarningCount) {
    throw new Error(`stale visibility warnings should be once per session/category: ${JSON.stringify(notifications)}`);
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
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  if (originalAgentProfileDir === undefined) {
    delete process.env.TAUMEL_AGENT_PROFILE_DIR;
  } else {
    process.env.TAUMEL_AGENT_PROFILE_DIR = originalAgentProfileDir;
  }
  await rm(cwd, { recursive: true, force: true });
}

process.exit(0);
