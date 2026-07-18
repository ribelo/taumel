import { readFile } from "node:fs/promises";
import {
  compact,
  generateBranchSummary,
  ModelSelectorComponent,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { CoreBridge, PiLike } from "./types.ts";
import { taumelGlobalSettingsPath } from "./global-settings.ts";
import { cwdFromContext, isProjectTrusted, modelRegistryFrom, projectSettingsPath, readJsonObjectForAtomicUpdate, sessionInfoFromContext, splitProviderModelId, writeFileAtomically } from "./util.ts";
import { decodeCompactionCommandPlan, decodeCompactionSessionPlan } from "./bridge-contracts.ts";

type SettingsObject = { [key: string]: unknown };
type CompactionContext = {
  readonly ui?: unknown; readonly thinkingLevel?: unknown; readonly sessionManager?: unknown;
};
type CompactionUi = { readonly notify?: (message: string, level: "warning") => unknown; readonly custom?: (...args: unknown[]) => Promise<unknown> };
type ThinkingSessionManager = { readonly thinkingLevel?: unknown; readonly getThinkingLevel?: () => unknown };
type ModelRegistry = { readonly find: (provider: string, model: string) => unknown; readonly getApiKeyAndHeaders: (model: unknown) => Promise<unknown> };
type ModelDescriptor = { readonly provider?: unknown; readonly id?: unknown };
type ModelAuth = { readonly ok?: unknown; readonly error?: unknown; readonly apiKey?: unknown; readonly headers?: unknown; readonly env?: unknown };
type CompactEvent = { readonly preparation?: unknown; readonly customInstructions?: unknown; readonly signal?: unknown };
type TreePreparation = { readonly userWantsSummary?: unknown; readonly entriesToSummarize?: unknown; readonly customInstructions?: unknown; readonly replaceInstructions?: unknown };
type TreeEvent = { readonly preparation?: unknown; readonly signal?: unknown };
type CompactionCommandResult = { readonly ok: boolean; readonly action: "command_result"; readonly message: string; readonly error?: string };

function settingsObject(value: unknown): SettingsObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as SettingsObject : undefined;
}
function compactionContext(value: unknown): Partial<CompactionContext> | undefined {
  return typeof value === "object" && value !== null ? value as Partial<CompactionContext> : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringRecordFromUnknown(value: unknown): Record<string, string> | undefined {
  const object = settingsObject(value);
  if (object === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const key of Object.keys(object)) {
    const entry = object[key];
    if (typeof entry !== "string") return undefined;
    result[key] = entry;
  }
  return result;
}

const sessionCompactionModels = new Map<string, string>();

type ModelSelectorCurrentModel = ConstructorParameters<typeof ModelSelectorComponent>[1];
type ModelSelectorRegistry = ConstructorParameters<typeof ModelSelectorComponent>[3];

function sessionKey(ctx: unknown): string {
  return sessionInfoFromContext(ctx).sessionId ?? "current";
}

async function readSettingsJson(path: string): Promise<SettingsObject> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return settingsObject(raw) ?? {};
  } catch {
    return {};
  }
}

function readCompactionModelFromSettings(settings: SettingsObject): string | undefined {
  const taumel = settingsObject(settings["taumel"]) ?? {};
  const compaction = settingsObject(taumel["compaction"]) ?? {};
  return stringFromUnknown(compaction["model"]);
}

async function readGlobalCompactionModel(): Promise<string | undefined> {
  return readCompactionModelFromSettings(await readSettingsJson(taumelGlobalSettingsPath()));
}

async function readProjectCompactionModel(cwd: string): Promise<string | undefined> {
  return readCompactionModelFromSettings(await readSettingsJson(projectSettingsPath(cwd)));
}

async function writeProjectCompactionModel(cwd: string, model: string | undefined): Promise<void> {
  const path = projectSettingsPath(cwd);
  const { settings, authorization } = await readJsonObjectForAtomicUpdate(path);
  const existingTaumel = settings["taumel"];
  const taumel = existingTaumel === undefined ? {} : settingsObject(existingTaumel);
  if (taumel === undefined) throw new Error(`${path}: taumel must be a JSON object`);
  const existingCompaction = taumel["compaction"];
  const compaction = existingCompaction === undefined ? {} : settingsObject(existingCompaction);
  if (compaction === undefined) throw new Error(`${path}: taumel.compaction must be a JSON object`);
  if (model === undefined) {
    delete compaction["model"];
  } else {
    compaction["model"] = model;
  }
  if (Object.keys(compaction).length === 0) {
    delete taumel["compaction"];
  } else {
    taumel["compaction"] = compaction;
  }
  if (Object.keys(taumel).length === 0) {
    delete settings["taumel"];
  } else {
    settings["taumel"] = taumel;
  }
  await writeFileAtomically(authorization, `${JSON.stringify(settings, null, 2)}\n`);
}

function notifyWarning(ctx: unknown, message: string): void {
  const rawUi = compactionContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CompactionUi : undefined;
  const notify = ui?.notify;
  if (typeof notify === "function") {
    notify.call(ui, message, "warning");
  }
}

function cancelWithWarning(ctx: unknown, message: string): { readonly cancel: true } {
  notifyWarning(ctx, message);
  return { cancel: true };
}

function currentThinkingLevelFromContext(ctx: unknown): string | undefined {
  const context = compactionContext(ctx);
  if (typeof context?.thinkingLevel === "string" && context.thinkingLevel !== "") return context.thinkingLevel;
  const rawSessionManager = context?.sessionManager;
  if (typeof rawSessionManager !== "object" || rawSessionManager === null) return undefined;
  const sessionManager = rawSessionManager as ThinkingSessionManager;
  const getThinkingLevel = sessionManager.getThinkingLevel;
  const value = sessionManager.thinkingLevel ??
    (typeof getThinkingLevel === "function" ? getThinkingLevel.call(sessionManager) : undefined);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function findModelByProviderModelId(registry: unknown, modelId: string): ModelSelectorCurrentModel {
  const requested = splitProviderModelId(modelId);
  if (requested === undefined || typeof registry !== "object" || registry === null) return undefined;
  const find = (registry as Partial<ModelRegistry>).find;
  if (typeof find !== "function") return undefined;
  return find.call(registry, requested.provider, requested.model) as ModelSelectorCurrentModel;
}

function providerModelIdFromModel(model: unknown): string | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const descriptor = model as ModelDescriptor;
  const provider = stringFromUnknown(descriptor.provider);
  const id = stringFromUnknown(descriptor.id);
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
  let plan;
  try {
    plan = decodeCompactionSessionPlan(core.call("planSessionBeforeCompact", [{
      session: settings.session ?? "",
      global: settings.global ?? "",
      project: settings.project ?? "",
    }]));
  } catch (error) {
    return configured
      ? {
          ok: false,
          result: cancelWithWarning(ctx, `Taumel compaction model planning failed: ${error instanceof Error ? error.message : String(error)}`),
        }
      : { ok: true, value: undefined };
  }
  if (plan.kind !== "compact") {
    return configured
      ? { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model planning returned no compact action.") }
      : { ok: true, value: undefined };
  }
  const modelId = plan.model;
  const requested = splitProviderModelId(modelId);
  if (requested === undefined) {
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model is invalid: ${modelId}`) };
  }
  const registry = modelRegistryFrom(pi, ctx);
  if (typeof registry !== "object" || registry === null) {
    return { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model cannot resolve the model registry.") };
  }
  const modelRegistry = registry as Partial<ModelRegistry>;
  if (typeof modelRegistry.find !== "function" || typeof modelRegistry.getApiKeyAndHeaders !== "function") {
    return { ok: false, result: cancelWithWarning(ctx, "Taumel compaction model cannot resolve the model registry.") };
  }
  const model = modelRegistry.find.call(registry, requested.provider, requested.model);
  if (model === undefined || model === null) {
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model is not available: ${modelId}`) };
  }
  let auth: unknown;
  try {
    auth = await modelRegistry.getApiKeyAndHeaders.call(registry, model);
  } catch (error) {
    return {
      ok: false,
      result: cancelWithWarning(ctx, `Taumel compaction model auth failed for ${modelId}: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
  const modelAuth = typeof auth === "object" && auth !== null ? auth as ModelAuth : undefined;
  if (modelAuth?.ok !== true) {
    const detail = typeof modelAuth?.error === "string" && modelAuth.error !== "" ? `: ${modelAuth.error}` : "";
    return { ok: false, result: cancelWithWarning(ctx, `Taumel compaction model lacks auth: ${modelId}${detail}`) };
  }
  return {
    ok: true,
    value: {
      modelId,
      model,
      apiKey: typeof modelAuth.apiKey === "string" ? modelAuth.apiKey : undefined,
      headers: stringRecordFromUnknown(modelAuth.headers),
      env: stringRecordFromUnknown(modelAuth.env),
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
    if (typeof event !== "object" || event === null) return undefined;
    const compactEvent = event as CompactEvent;
    const resolved = await resolveConfiguredModel(pi, core, ctx);
    if (!resolved.ok) return resolved.result;
    if (resolved.value === undefined) return undefined;
    const preparation = compactEvent.preparation as Parameters<CompactionRunner>[0] | undefined | null;
    if (preparation === undefined || preparation === null) {
      return cancelWithWarning(ctx, "Taumel compaction hook received no preparation.");
    }
    try {
      const result = await compactRunner(
        preparation,
        resolved.value.model as Parameters<CompactionRunner>[1],
        resolved.value.apiKey,
        resolved.value.headers,
        stringFromUnknown(compactEvent.customInstructions),
        compactEvent.signal instanceof AbortSignal ? compactEvent.signal : undefined,
        currentThinkingLevelFromContext(ctx) as Parameters<CompactionRunner>[6],
        undefined,
        resolved.value.env,
      );
      return { compaction: result };
    } catch (error) {
      return cancelWithWarning(ctx, `Taumel compaction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  pi.on("session_before_tree", async (event, ctx) => {
    if (typeof event !== "object" || event === null) return undefined;
    const treeEvent = event as TreeEvent;
    if (typeof treeEvent.preparation !== "object" || treeEvent.preparation === null) return undefined;
    const preparation = treeEvent.preparation as TreePreparation;
    if (preparation.userWantsSummary !== true) return undefined;
    const entries = Array.isArray(preparation.entriesToSummarize) ? preparation.entriesToSummarize : [];
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
        signal: treeEvent.signal instanceof AbortSignal ? treeEvent.signal : undefined,
        customInstructions: stringFromUnknown(preparation.customInstructions),
        replaceInstructions: preparation.replaceInstructions === true,
      } as Parameters<BranchSummaryRunner>[1]);
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
): Promise<CompactionCommandResult> {
  const rawUi = compactionContext(ctx)?.ui;
  const ui = typeof rawUi === "object" && rawUi !== null ? rawUi as CompactionUi : undefined;
  const custom = ui?.custom;
  if (typeof custom !== "function") {
    return { ok: false, action: "command_result", message: "Picker is not available.", error: "Picker is not available." };
  }
  const registry = modelRegistryFrom(pi, ctx);
  const currentModel = currentModelId === "" ? undefined : findModelByProviderModelId(registry, currentModelId);
  const model = await custom.call(
    ui,
    (tui: unknown, _theme: unknown, _keybindings: unknown, done: (value: unknown) => void) =>
      new ModelSelectorComponent(
        tui as ConstructorParameters<typeof ModelSelectorComponent>[0],
        currentModel,
        SettingsManager.inMemory(),
        registry as ModelSelectorRegistry,
        [],
        (selected) => done(selected),
        () => done(undefined),
      ),
    { title: "Choose compaction model" },
  );
  if (model === undefined || model === null) {
    return { ok: true, action: "command_result", message: "Compaction model selection cancelled." };
  }
  const modelId = providerModelIdFromModel(model);
  if (modelId === undefined || modelId === "") {
    return { ok: false, action: "command_result", message: "No model selected.", error: "No model selected." };
  }
  return setSessionCompactionModel(ctx, modelId);
}

async function setSessionCompactionModel(ctx: unknown, modelId: string): Promise<CompactionCommandResult> {
  if (isProjectTrusted(ctx)) {
    try {
      await writeProjectCompactionModel(cwdFromContext(ctx), modelId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, action: "command_result", message: `Compaction model was not changed: ${message}`, error: message };
    }
    sessionCompactionModels.set(sessionKey(ctx), modelId);
    return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (session and project).` };
  }
  sessionCompactionModels.set(sessionKey(ctx), modelId);
  notifyWarning(ctx, "Project is untrusted; compaction model was set for this session only and project persistence was skipped.");
  return { ok: true, action: "command_result", message: `Compaction model set to ${modelId} (session only; project persistence skipped because the project is untrusted).` };
}

async function clearSessionCompactionModel(ctx: unknown): Promise<CompactionCommandResult> {
  if (isProjectTrusted(ctx)) {
    try {
      await writeProjectCompactionModel(cwdFromContext(ctx), undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, action: "command_result", message: `Compaction model was not changed: ${message}`, error: message };
    }
    sessionCompactionModels.delete(sessionKey(ctx));
    return { ok: true, action: "command_result", message: "Compaction model cleared for this session and project; inheriting." };
  }
  sessionCompactionModels.delete(sessionKey(ctx));
  notifyWarning(ctx, "Project is untrusted; compaction model was cleared for this session only and project persistence was skipped.");
  return { ok: true, action: "command_result", message: "Compaction model cleared for this session; project persistence skipped because the project is untrusted." };
}

export async function executeCompactionModelCommand(
  pi: PiLike,
  core: CoreBridge,
  args: string,
  ctx: unknown,
): Promise<CompactionCommandResult> {
  const { session, global, project } = await compactionSettingsForContext(ctx);
  const plan = decodeCompactionCommandPlan(core.call("planCompactionModelCommand", [{
    args, settings: { session: session ?? "", global: global ?? "", project: project ?? "" },
  }]));
  if (plan.kind === "error") return { ok: false, action: "command_result", message: plan.message, error: plan.message };
  if (plan.kind === "show") {
    const model = plan.model;
    const source = plan.source;
    const message = model === "" ? `Compaction model: ${source}` : `Compaction model: ${model} (${source})`;
    return { ok: true, action: "command_result", message };
  }
  if (plan.kind === "set_project") {
    return setSessionCompactionModel(ctx, plan.model);
  }
  if (plan.kind === "clear_project") {
    return clearSessionCompactionModel(ctx);
  }
  if (plan.kind === "open_picker") {
    return openCompactionModelPicker(pi, plan.current, ctx);
  }
  throw new Error("Invalid Taumel compaction-model command plan");
}
