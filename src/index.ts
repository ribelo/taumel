import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { ChildSessionBridge, CoreBridge, PiLike, TaumelGlobal } from "./types.ts";
import { coreCallRecord, isRecord, stringArrayFromUnknown } from "./util.ts";
import { createComposerController, installSkillAutocomplete } from "./composer.ts";
import { makeHost } from "./host.ts";
import { agentGatewayToolNames, registerGatewayTools, type GatewayToolRegistration } from "./tool-executor.ts";
import { installGoalContinuationLoop, registerGatewayCommands } from "./command-executor.ts";
import { installCompactionModelHook } from "./compaction-model.ts";
import { installCronLoop } from "./cron.ts";
import { toolNames } from "./tool-contracts.ts";
import { installSkillResolver } from "./skills.ts";
import { skillMessageRenderer } from "./tool-renderer.ts";
import { installVisibilityLifecycle } from "./visibility.ts";

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
  const plan = coreCallRecord(core, "planActiveToolsSync", [pi.getActiveTools(), ctx], "active tools sync plan");
  if (plan["changed"] !== true) {
    return;
  }
  const tools = stringArrayFromUnknown(plan["tools"]);
  if (tools === undefined) throw new Error("Invalid Taumel active tools sync plan");
  pi.setActiveTools(tools);
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
  return isRecord(settings) && isRecord(settings["taumel"]) ? settings["taumel"]["execPolicy"] : undefined;
}

function readExecPolicyScope(scope: string, path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const execPolicy = execPolicyBlockFromSettings(settings);
    return execPolicy === undefined ? undefined : { scope, execPolicy };
  } catch (error) {
    return { scope, execPolicy: `malformed settings: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function isProjectTrusted(ctx: unknown): boolean {
  if (!isRecord(ctx)) return false;
  const trusted = ctx["isProjectTrusted"];
  return typeof trusted === "function" ? trusted.call(ctx) === true : false;
}

function notifyExecPolicyErrors(result: Record<string, unknown>, ctx?: unknown): void {
  const errors = Array.isArray(result["errors"])
    ? result["errors"].filter((error): error is string => typeof error === "string" && error !== "")
    : [];
  if (errors.length === 0) return;
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
  const notify = isRecord(ui) ? ui["notify"] : undefined;
  if (typeof notify !== "function") return;
  notify.call(ui, `Taumel exec policy has validation errors:\n${errors.join("\n")}`, "warning");
}

function refreshExecPolicy(core: CoreBridge, ctx?: unknown): void {
  const scopes: Record<string, unknown>[] = [];
  const globalScope = readExecPolicyScope("global", join(getAgentDir(), "settings.json"));
  if (globalScope !== undefined) scopes.push(globalScope);
  if (isProjectTrusted(ctx)) {
    const cwd = isRecord(ctx) && typeof ctx["cwd"] === "string" && ctx["cwd"] !== "" ? ctx["cwd"] : process.cwd();
    const projectScope = readExecPolicyScope("project", join(cwd, ".pi", "settings.json"));
    if (projectScope !== undefined) scopes.push(projectScope);
  }
  const result = coreCallRecord(core, "refreshExecPolicy", [{ scopes }], "exec policy refresh result");
  notifyExecPolicyErrors(result, ctx);
}

function installExecPolicyLoader(pi: PiLike, core: CoreBridge): void {
  const sync = (_event: unknown, ctx?: unknown) => refreshExecPolicy(core, ctx);
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
}

function userAgentProfileDir(): string {
  return process.env.TAUMEL_AGENT_PROFILE_DIR ?? join(homedir(), ".pi", "agent", "taumel", "agents");
}

function readUserAgentProfiles(): Record<string, unknown>[] {
  const root = userAgentProfileDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const path = join(root, entry.name);
      return { path, text: readFileSync(path, "utf8") };
    });
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

function removeActiveAgentTools(pi: PiLike): string[] {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") return [];
  const current = pi.getActiveTools();
  const removed = current.filter((name) => agentGatewayToolNames.includes(name as typeof agentGatewayToolNames[number]));
  const next = current.filter((name) => !agentGatewayToolNames.includes(name as typeof agentGatewayToolNames[number]));
  pi.setActiveTools([...next]);
  return [...new Set(removed)];
}

function childSessionMetadataFromContext(ctx: unknown): Record<string, unknown> | undefined {
  if (!isRecord(ctx) || !isRecord(ctx["sessionManager"])) return undefined;
  const getEntries = ctx["sessionManager"]["getEntries"];
  if (typeof getEntries !== "function") return undefined;
  try {
    const entries = getEntries.call(ctx["sessionManager"]);
    if (!Array.isArray(entries)) return undefined;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== "taumel.childSession") {
        continue;
      }
      return isRecord(entry["data"]) ? entry["data"] : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isSubagentContext(ctx: unknown): boolean {
  const metadata = childSessionMetadataFromContext(ctx);
  if (metadata === undefined) return false;
  return metadata["subagent"] === true || metadata["kind"] === "agent" || metadata["kind"] === "ralph";
}

function activateAgentTools(pi: PiLike, restoredTools: Set<string>): void {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") return;
  const current = pi.getActiveTools();
  const restored = [...restoredTools].filter((name) => agentGatewayToolNames.includes(name as typeof agentGatewayToolNames[number]));
  const next = [...new Set([...current, ...restored, ...agentGatewayToolNames])];
  if (next.length !== current.length || next.some((name, index) => current[index] !== name)) {
    pi.setActiveTools(next);
  }
  restoredTools.clear();
}

function notifyInvalidAgentProfileCatalog(result: Record<string, unknown>, ctx?: unknown): void {
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
  const notify = isRecord(ui) ? ui["notify"] : undefined;
  if (typeof notify !== "function") return;
  const errors = Array.isArray(result["errors"])
    ? result["errors"].filter((error): error is string => typeof error === "string" && error !== "")
    : [];
  const message = errors.length === 0
    ? "Taumel agent profile catalog is invalid."
    : `Taumel agent profile catalog is invalid:\n${errors.join("\n")}`;
  notify.call(ui, message, "warning");
}

function refreshAgentProfileCatalog(
  pi: PiLike,
  core: CoreBridge,
  settings: unknown,
  tools: GatewayToolRegistration,
  removedActiveAgentTools: Set<string>,
  ctx?: unknown,
): void {
  const builtins =
    isRecord(settings) &&
    isRecord(settings["taumel"]) &&
    isRecord(settings["taumel"]["agents"]) &&
    isRecord(settings["taumel"]["agents"]["builtins"])
      ? settings["taumel"]["agents"]["builtins"]
      : {};
  const result = coreCallRecord(core, "refreshAgentProfileCatalog", [{
    liveTools: liveToolNames(pi),
    profiles: readUserAgentProfiles(),
    builtinOverrides: builtins,
  }], "agent profile catalog result");
  if (result["valid"] !== true) {
    for (const name of removeActiveAgentTools(pi)) removedActiveAgentTools.add(name);
    notifyInvalidAgentProfileCatalog(result, ctx);
    return;
  }
  tools.registerAgentTools();
  if (!isSubagentContext(ctx)) activateAgentTools(pi, removedActiveAgentTools);
}

function installAgentProfileCatalog(
  pi: PiLike,
  core: CoreBridge,
  settings: unknown,
  tools: GatewayToolRegistration,
): void {
  const removedActiveAgentTools = new Set<string>();
  const sync = (_event: unknown, ctx?: unknown) => refreshAgentProfileCatalog(pi, core, settings, tools, removedActiveAgentTools, ctx);
  pi.on("session_start", sync);
  pi.on("session_resume", sync);
}

function insertBeforeCurrentUserMessage(
  messages: readonly unknown[],
  message: Record<string, unknown>,
): unknown[] {
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (isRecord(last) && last["role"] === "user") {
    return [...messages.slice(0, lastIndex), message, last];
  }
  return [...messages, message];
}

function installEnvironmentContext(pi: PiLike, core: CoreBridge): void {
  pi.on("context", async (event, ctx) => {
    if (!isRecord(event) || !Array.isArray(event["messages"])) return undefined;
    const plan = coreCallRecord(core, "planEnvironmentContext", [
      ctx,
      { shell: process.env.SHELL ?? "" },
    ], "environment context plan");
    const action = plan["action"];
    if (action === "none") return undefined;
    if (action !== "inject") throw new Error("Invalid Taumel environment context plan");
    const message = {
      role: "custom",
      customType: typeof plan["customType"] === "string" ? plan["customType"] : "taumel.environment_context",
      content: typeof plan["content"] === "string" ? plan["content"] : "",
      display: plan["display"] === true,
    };
    return { messages: insertBeforeCurrentUserMessage(event["messages"], message) };
  });
}

export default async function taumel(pi: PiLike) {
  const artifact = new URL("../dist/taumel.cjs", import.meta.url);
  const require = createRequire(import.meta.url);
  (globalThis as typeof globalThis & { require?: NodeRequire }).require = require;
  require(fileURLToPath(artifact));

  const coreGlobal = globalThis as typeof globalThis & TaumelGlobal;
  const core = requireCoreBridge(coreGlobal.taumel);

  core.init(makeHost(pi));
  installVisibilityLifecycle(pi, core);
  const childSessions = new Map<string, ChildSessionBridge>();
  const composer = await createComposerController(pi);
  installSkillAutocomplete(pi, core, composer);
  const gatewayTools = registerGatewayTools(pi, core, childSessions);
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("taumel.skill", skillMessageRenderer());
  }
  registerGatewayCommands(pi, core, childSessions, composer);
  installGoalContinuationLoop(pi, core);
  installCronLoop(pi, core);
  installAgentProfileCatalog(pi, core, composer?.settings, gatewayTools);
  installSandboxToolActivation(pi, core);
  installExecPolicyLoader(pi, core);
  installEnvironmentContext(pi, core);
  installCompactionModelHook(pi, core);
  installSkillResolver(pi, core);
}
