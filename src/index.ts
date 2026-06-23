import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ChildSessionBridge, CoreBridge, PiLike, TaumelGlobal } from "./types.ts";
import { coreCall, isRecord, stringArrayFromUnknown } from "./util.ts";
import { createComposerController } from "./composer.ts";
import { makeHost } from "./host.ts";
import { agentGatewayToolNames, registerGatewayTools, type GatewayToolRegistration } from "./tool-executor.ts";
import { installGoalContinuationLoop, registerGatewayCommands } from "./command-executor.ts";
import { toolNames } from "./tool-contracts.ts";

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
  const plan = coreCall(core, "planActiveToolsSync", [pi.getActiveTools(), ctx]);
  if (!isRecord(plan)) throw new Error("Invalid Taumel active tools sync plan");
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

function removeActiveAgentTools(pi: PiLike): void {
  if (typeof pi.getActiveTools !== "function" || typeof pi.setActiveTools !== "function") return;
  const next = pi.getActiveTools().filter((name) => !agentGatewayToolNames.includes(name as typeof agentGatewayToolNames[number]));
  pi.setActiveTools([...next]);
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
  ctx?: unknown,
): void {
  const builtins =
    isRecord(settings) &&
    isRecord(settings["taumel"]) &&
    isRecord(settings["taumel"]["agents"]) &&
    isRecord(settings["taumel"]["agents"]["builtins"])
      ? settings["taumel"]["agents"]["builtins"]
      : {};
  const result = coreCall(core, "refreshAgentProfileCatalog", [{
    liveTools: liveToolNames(pi),
    profiles: readUserAgentProfiles(),
    builtinOverrides: builtins,
  }]);
  if (!isRecord(result)) throw new Error("Invalid Taumel agent profile catalog result");
  if (result["valid"] !== true) {
    removeActiveAgentTools(pi);
    notifyInvalidAgentProfileCatalog(result, ctx);
    return;
  }
  tools.registerAgentTools();
}

function installAgentProfileCatalog(
  pi: PiLike,
  core: CoreBridge,
  settings: unknown,
  tools: GatewayToolRegistration,
): void {
  const sync = (_event: unknown, ctx?: unknown) => refreshAgentProfileCatalog(pi, core, settings, tools, ctx);
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
    const plan = coreCall(core, "planEnvironmentContext", [
      ctx,
      { shell: process.env.SHELL ?? "" },
    ]);
    if (!isRecord(plan)) throw new Error("Invalid Taumel environment context plan");
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
  require(fileURLToPath(artifact));

  const coreGlobal = globalThis as typeof globalThis & TaumelGlobal;
  const core = requireCoreBridge(coreGlobal.taumel);

  core.init(makeHost(pi));
  const childSessions = new Map<string, ChildSessionBridge>();
  const composer = await createComposerController(pi);
  const gatewayTools = registerGatewayTools(pi, core, childSessions);
  registerGatewayCommands(pi, core, childSessions, composer);
  installGoalContinuationLoop(pi, core);
  installAgentProfileCatalog(pi, core, composer?.settings, gatewayTools);
  installSandboxToolActivation(pi, core);
  installEnvironmentContext(pi, core);
}
