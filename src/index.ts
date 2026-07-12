import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { ChildSessionBridge, CoreBridge, PiLike, TaumelGlobal } from "./types.ts";
import { createComposerController, installSkillAutocomplete } from "./composer.ts";
import { makeHost } from "./host.ts";
import { registerGatewayTools } from "./tool-executor.ts";
import { installGoalContinuationLoop, registerGatewayCommands } from "./command-executor.ts";
import { installCompactionModelHook } from "./compaction-model.ts";
import { installCronLoop } from "./cron.ts";
import { installSkillResolver } from "./skills.ts";
import { installThinkingFooterRefresh, registerThinkingShortcuts } from "./thinking-shortcuts.ts";
import { cronFireMessageRenderer, skillMessageRenderer } from "./tool-renderer.ts";
import { installVisibilityLifecycle } from "./visibility.ts";
import { isProjectTrusted } from "./util.ts";
import { decodeActiveToolsPlan } from "./bridge-contracts.ts";
import {
  decodeEnvironmentContextPlan,
  decodeRefreshExecPolicyResult,
  type ExecPolicyScope,
} from "./bridge-contracts.ts";

type SettingsRoot = { taumel?: unknown };
type TaumelSettingsBlock = { execPolicy?: unknown };
type ExtensionContext = { cwd?: unknown; ui?: unknown };
type WarningUi = { notify?: (message: string, level: "warning") => unknown };
type ContextEvent = { messages?: unknown };
type ChatMessage = { role?: unknown };
type EnvironmentMessage = {
  readonly role: "custom"; readonly customType: string;
  readonly content: string; readonly display: boolean;
};

function objectAdapter<T extends object>(value: unknown): Partial<T> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Partial<T>
    : undefined;
}

function requireCoreBridge(core: CoreBridge | undefined): CoreBridge {
  if (!core) {
    throw new Error("taumel artifact did not export globalThis.taumel; run `npm run build:ocaml`");
  }
  if (typeof core.init !== "function" || typeof core.call !== "function") {
    throw new Error("taumel artifact did not export the core bridge; run `npm run build:ocaml`");
  }
  return core;
}

function syncSandboxToolActivation(pi: PiLike, core: CoreBridge, ctx?: unknown): void {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") {
    return;
  }
  const plan = decodeActiveToolsPlan(core.call("planActiveToolsSync", [{
    tools: [...pi.getActiveTools()], ctx,
  }]));
  if (!plan.changed) {
    return;
  }
  pi.setActiveTools([...plan.tools]);
}

function installSandboxToolActivation(pi: PiLike, core: CoreBridge): void {
  const sync = (_event: unknown, ctx?: unknown) => syncSandboxToolActivation(pi, core, ctx);
  pi.on("session_start", sync);
  // Pi does not emit session_resume in production (resume arrives via
  // session_start with reason "resume"); retained because the test harness
  // drives the sync through it.
  pi.on("session_resume", sync);
  // Re-derive the mutation tool set when the model changes mid-session.
  // model_select fires on set/cycle/restore after ctx.model is updated, so a
  // switch to/from an OpenAI provider flips between apply_patch and edit/write.
  pi.on("model_select", sync);
}

function execPolicyBlockFromSettings(settings: unknown): unknown {
  const root = objectAdapter<SettingsRoot>(settings);
  return objectAdapter<TaumelSettingsBlock>(root?.taumel)?.execPolicy;
}

function readExecPolicyScope(scope: string, path: string): ExecPolicyScope | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const execPolicy = execPolicyBlockFromSettings(settings);
    return execPolicy === undefined ? undefined : { scope, execPolicy };
  } catch (error) {
    return { scope, execPolicy: `malformed settings: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function notifyExecPolicyErrors(errors: readonly string[], ctx?: unknown): void {
  if (errors.length === 0) return;
  const ui = objectAdapter<WarningUi>(objectAdapter<ExtensionContext>(ctx)?.ui);
  const notify = ui?.notify;
  if (typeof notify !== "function") return;
  notify.call(ui, `Taumel exec policy has validation errors:\n${errors.join("\n")}`, "warning");
}

function refreshExecPolicy(core: CoreBridge, ctx?: unknown): void {
  const scopes: ExecPolicyScope[] = [];
  const globalScope = readExecPolicyScope("global", join(getAgentDir(), "settings.json"));
  if (globalScope !== undefined) scopes.push(globalScope);
  if (isProjectTrusted(ctx)) {
    const candidate = objectAdapter<ExtensionContext>(ctx)?.cwd;
    const cwd = typeof candidate === "string" && candidate !== "" ? candidate : process.cwd();
    const projectScope = readExecPolicyScope("project", join(cwd, ".pi", "settings.json"));
    if (projectScope !== undefined) scopes.push(projectScope);
  }
  const result = decodeRefreshExecPolicyResult(core.call("refreshExecPolicy", [{ scopes }]));
  notifyExecPolicyErrors(result.errors, ctx);
}

function installExecPolicyLoader(pi: PiLike, core: CoreBridge): void {
  const sync = (_event: unknown, ctx?: unknown) => refreshExecPolicy(core, ctx);
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
}

function insertBeforeCurrentUserMessage(
  messages: readonly unknown[],
  message: EnvironmentMessage,
): unknown[] {
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (objectAdapter<ChatMessage>(last)?.role === "user") {
    return [...messages.slice(0, lastIndex), message, last];
  }
  return [...messages, message];
}

function installEnvironmentContext(pi: PiLike, core: CoreBridge): void {
  pi.on("context", async (event, ctx) => {
    const messages = objectAdapter<ContextEvent>(event)?.messages;
    if (!Array.isArray(messages)) return undefined;
    const plan = decodeEnvironmentContextPlan(core.call("planEnvironmentContext", [
      ctx,
      { shell: process.env.SHELL ?? "" },
    ]));
    if (plan.kind === "none") return undefined;
    const message: EnvironmentMessage = {
      role: "custom",
      customType: plan.customType,
      content: plan.content,
      display: plan.display,
    };
    return { messages: insertBeforeCurrentUserMessage(messages, message) };
  });
}

export default async function taumel(pi: PiLike) {
  const artifact = new URL("../dist/taumel.cjs", import.meta.url);
  const require = createRequire(import.meta.url);
  const photon = await import("@silvia-odwyer/photon-node");
  const globals = globalThis as typeof globalThis & {
    require?: NodeRequire;
    taumelPhoton?: typeof import("@silvia-odwyer/photon-node");
  };
  globals.require = require;
  globals.taumelPhoton = photon;
  require(fileURLToPath(artifact));

  const coreGlobal = globalThis as typeof globalThis & TaumelGlobal;
  const core = requireCoreBridge(coreGlobal.taumel);

  core.init(makeHost(pi));
  installThinkingFooterRefresh(pi, core);
  registerThinkingShortcuts(pi);
  installVisibilityLifecycle(pi, core);
  const childSessions = new Map<string, ChildSessionBridge>();
  const composer = await createComposerController(pi);
  installSkillAutocomplete(pi, core, composer);
  registerGatewayTools(pi, core, childSessions);
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("skill", skillMessageRenderer());
    pi.registerMessageRenderer("taumel.cron.fire", cronFireMessageRenderer());
  }
  registerGatewayCommands(pi, core, childSessions, composer);
  installGoalContinuationLoop(pi, core);
  installCronLoop(pi, core);
  installSandboxToolActivation(pi, core);
  installExecPolicyLoader(pi, core);
  installEnvironmentContext(pi, core);
  installCompactionModelHook(pi, core);
  installSkillResolver(pi, core);
}
