import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compact,
  getAgentDir,
  ModelSelectorComponent,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { CoreBridge, PiLike } from "./types.ts";
import { coreCall, isRecord, stringField, writeFileAtomically } from "./util.ts";

function splitProviderModelId(modelId: string | undefined): { readonly provider: string; readonly model: string } | undefined {
  if (modelId === undefined) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1) return undefined;
  return { provider: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function globalSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

async function readSettingsJson(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(raw) ? raw : {};
  } catch {
    return {};
  }
}

function readCompactionModelFromSettings(settings: Record<string, unknown>): string | undefined {
  const taumel = isRecord(settings["taumel"]) ? settings["taumel"] : {};
  const compaction = isRecord(taumel["compaction"]) ? taumel["compaction"] : {};
  return stringFromUnknown(compaction["model"]);
}

async function readGlobalCompactionModel(): Promise<string | undefined> {
  return readCompactionModelFromSettings(await readSettingsJson(globalSettingsPath()));
}

async function readProjectCompactionModel(cwd: string): Promise<string | undefined> {
  return readCompactionModelFromSettings(await readSettingsJson(projectSettingsPath(cwd)));
}

async function writeProjectCompactionModel(cwd: string, model: string | undefined): Promise<void> {
  const path = projectSettingsPath(cwd);
  const settings = await readSettingsJson(path);
  const taumel = isRecord(settings["taumel"]) ? { ...settings["taumel"] } : {};
  const compaction = isRecord(taumel["compaction"]) ? { ...taumel["compaction"] } : {};
  if (model === undefined) {
    delete compaction["model"];
  } else {
    compaction["model"] = model;
  }
  const nextTaumel = { ...taumel, compaction };
  if (Object.keys(compaction).length === 0) {
    delete nextTaumel["compaction"];
  }
  const next = { ...settings, taumel: nextTaumel };
  if (Object.keys(nextTaumel).length === 0) {
    delete next["taumel"];
  }
  await writeFileAtomically(path, `${JSON.stringify(next, null, 2)}\n`);
}

function cwdFromContext(ctx: unknown): string {
  return isRecord(ctx) && typeof ctx["cwd"] === "string" && ctx["cwd"] !== "" ? ctx["cwd"] : process.cwd();
}

function notifyWarning(ctx: unknown, message: string): void {
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
  const notify = isRecord(ui) ? ui["notify"] : undefined;
  if (typeof notify === "function") {
    notify.call(ui, message, "warning");
  }
}

function currentThinkingLevelFromContext(ctx: unknown): string | undefined {
  if (!isRecord(ctx)) return undefined;
  if (typeof ctx["thinkingLevel"] === "string" && ctx["thinkingLevel"] !== "") return ctx["thinkingLevel"];
  const sessionManager = ctx["sessionManager"];
  if (!isRecord(sessionManager)) return undefined;
  const value = sessionManager["thinkingLevel"] ?? sessionManager["getThinkingLevel"]?.call(sessionManager);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function modelRegistryFromContext(pi: PiLike, ctx: unknown): unknown {
  if (isRecord(ctx) && ctx["modelRegistry"] !== undefined) return ctx["modelRegistry"];
  return pi.modelRegistry;
}

function compactionSettingsForContext(ctx: unknown): Promise<{ readonly global: string | undefined; readonly project: string | undefined }> {
  const cwd = cwdFromContext(ctx);
  return Promise.all([readGlobalCompactionModel(), readProjectCompactionModel(cwd)]).then(([global, project]) => ({ global, project }));
}

export function installCompactionModelHook(pi: PiLike, core: CoreBridge): void {
  pi.on("session_before_compact", async (event, ctx) => {
    if (!isRecord(event)) return undefined;
    const { global, project } = await compactionSettingsForContext(ctx);
    const plan = coreCall(core, "planSessionBeforeCompact", [{
      global: global ?? "",
      project: project ?? "",
    }]);
    if (!isRecord(plan)) return undefined;
    if (stringField(plan, "action") !== "compact") return undefined;
    const modelId = stringField(plan, "model");
    const requested = splitProviderModelId(modelId);
    if (requested === undefined) {
      notifyWarning(ctx, `Taumel compaction model is invalid: ${modelId}`);
      return undefined;
    }
    const registry = modelRegistryFromContext(pi, ctx);
    if (!isRecord(registry) || typeof registry["find"] !== "function" || typeof registry["getApiKeyAndHeaders"] !== "function") {
      notifyWarning(ctx, "Taumel compaction model cannot resolve the model registry.");
      return undefined;
    }
    const model = registry["find"].call(registry, requested.provider, requested.model);
    if (model === undefined || model === null) {
      notifyWarning(ctx, `Taumel compaction model is not available: ${modelId}`);
      return undefined;
    }
    const auth = registry["getApiKeyAndHeaders"].call(registry, model);
    if (!isRecord(auth) || auth["ok"] !== true || typeof auth["apiKey"] !== "string") {
      notifyWarning(ctx, `Taumel compaction model lacks auth: ${modelId}`);
      return undefined;
    }
    const preparation = event["preparation"];
    if (preparation === undefined || preparation === null) {
      notifyWarning(ctx, "Taumel compaction hook received no preparation.");
      return undefined;
    }
    try {
      const result = await compact(
        preparation,
        model,
        auth["apiKey"],
        isRecord(auth["headers"]) ? auth["headers"] : undefined,
        event["customInstructions"],
        event["signal"],
        currentThinkingLevelFromContext(ctx),
        undefined,
        undefined,
      );
      return { compaction: result };
    } catch (error) {
      notifyWarning(ctx, `Taumel compaction failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  });
}

async function openCompactionModelPicker(
  pi: PiLike,
  currentModelId: string,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  const ui = isRecord(ctx) && isRecord(ctx["ui"]) ? ctx["ui"] : undefined;
  const custom = isRecord(ui) ? ui["custom"] : undefined;
  if (typeof custom !== "function") {
    return { ok: false, action: "command_result", message: "Picker is not available.", error: "Picker is not available." };
  }
  const registry = modelRegistryFromContext(pi, ctx);
  const model = await new Promise<unknown>((resolve) => {
    custom.call(
      ui,
      (tui: unknown, _theme: unknown, _keybindings: unknown, done: (value: unknown) => void) => {
        return new ModelSelectorComponent(
          tui,
          currentModelId,
          SettingsManager.inMemory(),
          registry,
          [],
          (selected) => done(selected),
          () => done(undefined),
        );
      },
      { title: "Choose compaction model" },
    );
  });
  if (model === undefined || model === null) {
    return { ok: true, action: "command_result", message: "Compaction model selection cancelled." };
  }
  const modelId = isRecord(model) && typeof model["id"] === "string" ? model["id"] : undefined;
  if (modelId === undefined || modelId === "") {
    return { ok: false, action: "command_result", message: "No model selected.", error: "No model selected." };
  }
  await writeProjectCompactionModel(cwdFromContext(ctx), modelId);
  return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (project).` };
}

export async function executeCompactionModelCommand(
  pi: PiLike,
  core: CoreBridge,
  args: string,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  const { global, project } = await compactionSettingsForContext(ctx);
  const plan = coreCall(core, "planCompactionModelCommand", [
    args,
    { global: global ?? "", project: project ?? "" },
  ]);
  if (!isRecord(plan)) throw new Error("Invalid Taumel compaction-model command plan");
  const action = stringField(plan, "action");
  if (action === "show") {
    const model = stringField(plan, "model");
    const source = stringField(plan, "source");
    const message = model === "" ? `Compaction model: ${source}` : `Compaction model: ${model} (${source})`;
    return { ok: true, action: "command_result", message };
  }
  if (action === "set_project") {
    const model = stringField(plan, "model");
    await writeProjectCompactionModel(cwdFromContext(ctx), model);
    return { ok: true, action: "command_result", message: `Compaction model set to ${model} (project).` };
  }
  if (action === "clear_project") {
    await writeProjectCompactionModel(cwdFromContext(ctx), undefined);
    return { ok: true, action: "command_result", message: "Compaction model cleared; inheriting." };
  }
  if (action === "open_picker") {
    return openCompactionModelPicker(pi, stringField(plan, "current"), ctx);
  }
  throw new Error("Invalid Taumel compaction-model command plan");
}
