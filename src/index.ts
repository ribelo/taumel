import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { ChildSessionBridge, CoreBridge, PiLike, TaumelGlobal } from "./types.ts";
import { coreCall, isRecord, stringArrayFromUnknown } from "./util.ts";
import { createComposerController } from "./composer.ts";
import { makeHost } from "./host.ts";
import { registerGatewayTools } from "./tool-executor.ts";
import { installGoalContinuationLoop, registerGatewayCommands } from "./command-executor.ts";

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
  registerGatewayTools(pi, core, childSessions);
  registerGatewayCommands(pi, core, childSessions, composer);
  installGoalContinuationLoop(pi, core);
  installSandboxToolActivation(pi, core);
  installEnvironmentContext(pi, core);
}
