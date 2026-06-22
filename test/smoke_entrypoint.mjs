import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import taumel from "../src/index.ts";
import { renderComposerInput } from "../src/composer.ts";

const cwd = await mkdtemp(join(tmpdir(), "taumel-entrypoint-"));
const originalFetch = globalThis.fetch;
const originalSettingsPath = process.env.TAUMEL_SETTINGS_PATH;
process.env.TAUMEL_SETTINGS_PATH = join(cwd, "taumel-settings.json");

const handlers = new Map();
const internalHandlers = new Map();
const tools = new Map();
const commands = new Map();
const execCalls = [];
const stdinCalls = [];
const newSessionCalls = [];
const customEntries = [];
const notifications = [];
const confirmations = [];
const activeToolUpdates = [];
const fetchCalls = [];
const sentMessages = [];
const editorFactories = [];
const childContexts = new Map();
let activeTools = ["bash", "write", "usage", "bash"];
let sandboxMode = undefined;
let extensionLoading = true;
let childCounter = 0;
let pendingMessages = false;
let renderRequests = 0;
let confirmBehavior = async () => true;

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
};

try {
  await taumel(pi);
  extensionLoading = false;

  if (activeToolUpdates.length !== 0) {
    throw new Error(`runtime action methods were called during extension loading: ${JSON.stringify(activeToolUpdates)}`);
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
    },
    model: { provider: "openai-codex", id: "gpt-test" },
    getContextUsage: () => ({ percent: 1, contextWindow: 1000 }),
    hasPendingMessages: () => pendingMessages,
    modelRegistry: {
      authStorage: {
        get: (provider) =>
          provider === "openai-codex"
            ? { type: "chatgpt", accountId: "acct-test", email: "person@example.com" }
            : undefined,
      },
      getApiKeyForProvider: async (provider) =>
        provider === "openai-codex" ? "chatgpt-access-token" : undefined,
    },
    newSession: async (options = {}) => {
      newSessionCalls.push(options);
      childCounter += 1;
      const childId = `child-${childCounter}`;
      const childEntries = [];
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
      await options.setup?.(childSessionManager);
      const childCtx = {
        ...ctx,
        sessionManager: childSessionManager,
        setActiveToolsByName: () => undefined,
        setModelById: () => undefined,
        setThinkingLevel: () => undefined,
        sendUserMessage: async () => undefined,
      };
      childContexts.set(childId, childCtx);
      await options.withSession?.(childCtx);
      return { cancelled: false };
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

  for (const name of ["exec_command", "write_stdin", "apply_patch", "edit", "write", "agent", "request_user_input"]) {
    if (!tools.has(name)) throw new Error(`missing registered tool: ${name}`);
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
  for (const name of ["permissions", "network", "composer", "usage", "ralph", "goal"]) {
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

  if (activeToolUpdates.length !== 1) {
    throw new Error(`active tool sync did not run after session_start: ${JSON.stringify(activeToolUpdates)}`);
  }
  if (
    activeToolUpdates[0].includes("write") ||
    activeToolUpdates[0].includes("usage") ||
    !activeToolUpdates[0].includes("apply_patch")
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

  const agentResult = await tools.get("agent").execute(
    "agent-call",
    { action: "spawn", id: "smoke-worker", agent: "worker" },
    undefined,
    undefined,
    ctx,
  );
  if (newSessionCalls.length !== 1 || agentResult.details?.childSession?.created !== true) {
    throw new Error(`agent spawn did not create a child session through host adapter: ${JSON.stringify(agentResult)}`);
  }
  if (
    agentResult.details?.worker?.parentId !== "parent-session" ||
    agentResult.details?.worker?.depth !== 1
  ) {
    throw new Error(`agent spawn did not record root ownership: ${JSON.stringify(agentResult)}`);
  }
  const agentChildCtx = childContexts.get(agentResult.details.childSession.sessionId);
  if (agentChildCtx === undefined) {
    throw new Error(`agent child context was not captured: ${JSON.stringify(agentResult.details.childSession)}`);
  }
  const closeParentFromChild = await tools.get("agent").execute(
    "agent-child-close-parent",
    { action: "close", id: "smoke-worker" },
    undefined,
    undefined,
    agentChildCtx,
  );
  if (closeParentFromChild.details?.ok === true) {
    throw new Error(`agent child managed its parent worker: ${JSON.stringify(closeParentFromChild)}`);
  }
  const nestedAgentResult = await tools.get("agent").execute(
    "agent-child-spawn",
    { action: "spawn", id: "nested-worker", agent: "worker" },
    undefined,
    undefined,
    agentChildCtx,
  );
  if (
    nestedAgentResult.details?.ok !== true ||
    nestedAgentResult.details?.worker?.parentId !== "smoke-worker" ||
    nestedAgentResult.details?.worker?.depth !== 2
  ) {
    throw new Error(`agent child spawn did not preserve ownership depth: ${JSON.stringify(nestedAgentResult)}`);
  }
  const nestedAgentCtx = childContexts.get(nestedAgentResult.details.childSession.sessionId);
  if (nestedAgentCtx === undefined) {
    throw new Error(`nested agent child context was not captured: ${JSON.stringify(nestedAgentResult)}`);
  }
  const deepAgentResult = await tools.get("agent").execute(
    "agent-nested-spawn",
    { action: "spawn", id: "deep-worker", agent: "worker" },
    undefined,
    undefined,
    nestedAgentCtx,
  );
  if (
    deepAgentResult.details?.ok !== true ||
    deepAgentResult.details?.worker?.parentId !== "nested-worker" ||
    deepAgentResult.details?.worker?.depth !== 3
  ) {
    throw new Error(`nested agent spawn did not preserve ownership depth: ${JSON.stringify(deepAgentResult)}`);
  }
  const deepAgentCtx = childContexts.get(deepAgentResult.details.childSession.sessionId);
  if (deepAgentCtx === undefined) {
    throw new Error(`deep agent child context was not captured: ${JSON.stringify(deepAgentResult)}`);
  }
  const tooDeepAgentResult = await tools.get("agent").execute(
    "agent-too-deep-spawn",
    { action: "spawn", id: "too-deep-worker", agent: "worker" },
    undefined,
    undefined,
    deepAgentCtx,
  );
  if (tooDeepAgentResult.details?.ok === true) {
    throw new Error(`nested agent limit was not enforced: ${JSON.stringify(tooDeepAgentResult)}`);
  }
  const ralphEntryOffset = customEntries.length;
  const ralphSessionCount = newSessionCalls.length;
  const ralphResult = await commands.get("ralph").handler("start inspect child profile", ctx);
  if (
    ralphResult.ok !== true ||
    ralphResult.action !== "command_result" ||
    newSessionCalls.length !== ralphSessionCount + 1
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
    ralphToolNames.includes("agent")
  ) {
    throw new Error(`ralph child did not persist a restricted tool profile: ${JSON.stringify(ralphChildEntries)}`);
  }
} finally {
  globalThis.fetch = originalFetch;
  if (originalSettingsPath === undefined) {
    delete process.env.TAUMEL_SETTINGS_PATH;
  } else {
    process.env.TAUMEL_SETTINGS_PATH = originalSettingsPath;
  }
  await rm(cwd, { recursive: true, force: true });
}

process.exit(0);
