import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compact,
  generateBranchSummary,
  getAgentDir,
  ModelSelectorComponent,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { CoreBridge, PiLike } from "./types.ts";
import { coreCallOptionalRecord, coreCallRecord, isRecord, sessionInfoFromContext, stringField, writeFileAtomically } from "./util.ts";

function splitProviderModelId(modelId: string | undefined): { readonly provider: string; readonly model: string } | undefined {
  if (modelId === undefined) return undefined;
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1) return undefined;
  return { provider: modelId.slice(0, separator), model: modelId.slice(separator + 1) };
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringRecordFromUnknown(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return undefined;
  return Object.fromEntries(entries);
}

function globalSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function isProjectTrusted(ctx: unknown): boolean {
  if (!isRecord(ctx)) return false;
  const trusted = ctx["isProjectTrusted"];
  return typeof trusted === "function" ? trusted.call(ctx) === true : false;
}

const sessionCompactionModels = new Map<string, string>();

type ModelSelectorCurrentModel = ConstructorParameters<typeof ModelSelectorComponent>[1];
type ModelSelectorRegistry = ConstructorParameters<typeof ModelSelectorComponent>[3];

function sessionKey(ctx: unknown): string {
  return sessionInfoFromContext(ctx).sessionId ?? "current";
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

function cancelWithWarning(ctx: unknown, message: string): { readonly cancel: true } {
  notifyWarning(ctx, message);
  return { cancel: true };
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

function findModelByProviderModelId(registry: unknown, modelId: string): ModelSelectorCurrentModel {
  const requested = splitProviderModelId(modelId);
  if (requested === undefined || !isRecord(registry) || typeof registry["find"] !== "function") return undefined;
  return registry["find"].call(registry, requested.provider, requested.model) as ModelSelectorCurrentModel;
}

function providerModelIdFromModel(model: unknown): string | undefined {
  if (!isRecord(model)) return undefined;
  const provider = stringFromUnknown(model["provider"]);
  const id = stringFromUnknown(model["id"]);
  return provider === undefined || id === undefined ? undefined : `${provider}/${id}`;
}

function compactionSettingsForContext(ctx: unknown): Promise<{ readonly session: string | undefined; readonly global: string | undefined; readonly project: string | undefined }> {
  const cwd = cwdFromContext(ctx);
  const project = isProjectTrusted(ctx) ? readProjectCompactionModel(cwd) : Promise.resolve(undefined);
  return Promise.all([readGlobalCompactionModel(), project]).then(([global, project]) => ({
    session: sessionCompactionModels.get(sessionKey(ctx)),
    global,
    project,
  }));
}

function hasConfiguredCompactionModel(settings: { readonly session: string | undefined; readonly global: string | undefined; readonly project: string | undefined }): boolean {
  return settings.session !== undefined || settings.project !== undefined || settings.global !== undefined;
}

type CompactionRunner = typeof compact;
type BranchSummaryRunner = typeof generateBranchSummary;

type ResolvedConfiguredModel = {
  readonly modelId: string;
  readonly model: unknown;
  readonly apiKey: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly env: Record<string, string> | undefined;
};

async function resolveConfiguredModel(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
): Promise<
  | { readonly ok: true; readonly value: ResolvedConfiguredModel | undefined }
  | { readonly ok: false; readonly result: { readonly cancel: true } }
> {
  const settings = await compactionSettingsForContext(ctx);
  const configured = hasConfiguredCompactionModel(settings);
  let plan: Record<string, unknown> | undefined;
  try {
    plan = coreCallOptionalRecord(core, "planSessionBeforeCompact", [{
      session: settings.session ?? "",
      global: settings.global ?? "",
      project: settings.project ?? "",
    }]);
  } catch (error) {
    return configured
      ? {
          ok: false,
          result: cancelWithWarning(ctx, `Taumel compaction model planning failed: ${error instanceof Error ? error.message : String(error)}`),
        }
      : { ok: true, value: undefined };
  }
  if (plan === undefined) {
    return configured
      ? { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model planning returned no plan.") }
      : { ok: true, value: undefined };
  }
  const action = typeof plan["action"] === "string" ? plan["action"] : "";
  if (action !== "compact") {
    return configured
      ? { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model planning returned no compact action.") }
      : { ok: true, value: undefined };
  }
  const modelId = typeof plan["model"] === "string" ? plan["model"] : "";
  const requested = splitProviderModelId(modelId);
  if (requested === undefined) {
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model is invalid: ${modelId}`) };
  }
  const registry = modelRegistryFromContext(pi, ctx);
  if (!isRecord(registry) || typeof registry["find"] !== "function" || typeof registry["getApiKeyAndHeaders"] !== "function") {
    return { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model cannot resolve the model registry.") };
  }
  const model = registry["find"].call(registry, requested.provider, requested.model);
  if (model === undefined || model === null) {
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model is not available: ${modelId}`) };
  }
  let auth: unknown;
  try {
    auth = await registry["getApiKeyAndHeaders"].call(registry, model);
  } catch (error) {
    return {
      ok: false,
      result: cancelWithWarning(ctx, `Taumel compaction model auth failed for ${modelId}: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
  if (!isRecord(auth) || auth["ok"] !== true) {
    const detail = isRecord(auth) && typeof auth["error"] === "string" && auth["error"] !== "" ? `: ${auth["error"]}` : "";
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model lacks auth: ${modelId}${detail}`) };
  }
  return {
    ok: true,
    value: {
      modelId,
      model,
      apiKey: typeof auth["apiKey"] === "string" ? auth["apiKey"] : undefined,
      headers: stringRecordFromUnknown(auth["headers"]),
      env: stringRecordFromUnknown(auth["env"]),
    },
  };
}

export function installCompactionModelHookWithCompact(
  pi: PiLike,
  core: CoreBridge,
  compactRunner: CompactionRunner,
  branchSummaryRunner: BranchSummaryRunner = generateBranchSummary,
): void {
  pi.on("session_before_compact", async (event, ctx) => {
    if (!isRecord(event)) return undefined;
    const resolved = await resolveConfiguredModel(pi, core, ctx);
    if (!resolved.ok) return resolved.result;
    if (resolved.value === undefined) return undefined;
    const preparation = event["preparation"];
    if (preparation === undefined || preparation === null) {
      return cancelWithWarning(ctx, "Taumel compaction hook received no preparation.");
    }
    try {
      const result = await compactRunner(
        preparation,
        resolved.value.model,
        resolved.value.apiKey,
        resolved.value.headers,
        event["customInstructions"],
        event["signal"],
        currentThinkingLevelFromContext(ctx),
        undefined,
        resolved.value.env,
      );
      return { compaction: result };
    } catch (error) {
      return cancelWithWarning(ctx, `Taumel compaction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  pi.on("session_before_tree", async (event, ctx) => {
    if (!isRecord(event) || !isRecord(event["preparation"])) return undefined;
    const preparation = event["preparation"];
    if (preparation["userWantsSummary"] !== true) return undefined;
    const entries = Array.isArray(preparation["entriesToSummarize"]) ? preparation["entriesToSummarize"] : [];
    if (entries.length === 0) return undefined;
    const resolved = await resolveConfiguredModel(pi, core, ctx);
    if (!resolved.ok) return resolved.result;
    if (resolved.value === undefined) return undefined;
    try {
      const result = await branchSummaryRunner(entries as never, {
        model: resolved.value.model as never,
        apiKey: resolved.value.apiKey,
        headers: resolved.value.headers,
        env: resolved.value.env,
        signal: event["signal"] instanceof AbortSignal ? event["signal"] : undefined,
        customInstructions: stringFromUnknown(preparation["customInstructions"]),
        replaceInstructions: preparation["replaceInstructions"] === true,
      });
      if (result.aborted) return { cancel: true };
      if (result.error) return cancelWithWarning(ctx, `Taumel branch summary failed: ${result.error}`);
      return {
        summary: {
          summary: result.summary,
          details: {
            readFiles: result.readFiles ?? [],
            modifiedFiles: result.modifiedFiles ?? [],
          },
        },
      };
    } catch (error) {
      return cancelWithWarning(ctx, `Taumel branch summary failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function installCompactionModelHook(pi: PiLike, core: CoreBridge): void {
  installCompactionModelHookWithCompact(pi, core, compact);
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
  const currentModel = currentModelId === "" ? undefined : findModelByProviderModelId(registry, currentModelId);
  const model = await new Promise<unknown>((resolve) => {
    custom.call(
      ui,
      (tui: unknown, _theme: unknown, _keybindings: unknown, done: (value: unknown) => void) => {
        return new ModelSelectorComponent(
          tui,
          currentModel,
          SettingsManager.inMemory(),
          registry as ModelSelectorRegistry,
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
  const modelId = providerModelIdFromModel(model);
  if (modelId === undefined || modelId === "") {
    return { ok: false, action: "command_result", message: "No model selected.", error: "No model selected." };
  }
  return setSessionCompactionModel(ctx, modelId);
}

async function setSessionCompactionModel(ctx: unknown, modelId: string): Promise<Record<string, unknown>> {
  sessionCompactionModels.set(sessionKey(ctx), modelId);
  if (isProjectTrusted(ctx)) {
    await writeProjectCompactionModel(cwdFromContext(ctx), modelId);
    return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (session and project).` };
  }
  notifyWarning(ctx, "Project is untrusted; compaction model was set for this session only and project persistence was skipped.");
  return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (session only; project persistence skipped because the project is untrusted).` };
}

async function clearSessionCompactionModel(ctx: unknown): Promise<Record<string, unknown>> {
  sessionCompactionModels.delete(sessionKey(ctx));
  if (isProjectTrusted(ctx)) {
    await writeProjectCompactionModel(cwdFromContext(ctx), undefined);
    return { ok: true, action: "command_result", message: "Compaction model cleared for this session and project; inheriting." };
  }
  notifyWarning(ctx, "Project is untrusted; compaction model was cleared for this session only and project persistence was skipped.");
  return { ok: true, action: "command_result", message: "Compaction model cleared for this session; project persistence skipped because the project is untrusted." };
}

export async function executeCompactionModelCommand(
  pi: PiLike,
  core: CoreBridge,
  args: string,
  ctx: unknown,
): Promise<Record<string, unknown>> {
  const { session, global, project } = await compactionSettingsForContext(ctx);
  const plan = coreCallRecord(core, "planCompactionModelCommand", [
    args,
    { session: session ?? "", global: global ?? "", project: project ?? "" },
  ], "compaction-model command plan");
  const action = stringField(plan, "action");
  if (action === "show") {
    const model = stringField(plan, "model");
    const source = stringField(plan, "source");
    const message = model === "" ? `Compaction model: ${source}` : `Compaction model: ${model} (${source})`;
    return { ok: true, action: "command_result", message };
  }
  if (action === "set_project") {
    const model = stringField(plan, "model");
    return setSessionCompactionModel(ctx, model);
  }
  if (action === "clear_project") {
    return clearSessionCompactionModel(ctx);
  }
  if (action === "open_picker") {
    return openCompactionModelPicker(pi, stringField(plan, "current"), ctx);
  }
  throw new Error("Invalid Taumel compaction-model command plan");
}
