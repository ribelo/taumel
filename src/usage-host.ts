import type { CoreBridge, PiLike } from "./types.ts";
import {
  modelRegistryFrom,
  openAiCredentialRaw,
  usageTokenRaw,
} from "./util.ts";
import {
  decodeBridgeToolResult,
  decodeKimiUsageHostAuth,
  decodeKimiUsageHostParams,
  decodeOpenAiUsageHostAuth,
  decodeOpenAiUsageHostParams,
  type KimiUsageHostLookupFacts,
  type KimiUsageHostParams,
  type OpenAiUsageHostLookupFacts,
  type OpenAiUsageHostParams,
  type PreparedToolAction,
} from "./bridge-contracts.ts";
import { preparedToolResult } from "./tool-results.ts";

type PreparedSuccess = Exclude<PreparedToolAction, { ok: false }>;
type PreparedOpenAiAction = Extract<PreparedSuccess, { action: "openai_usage_fetch" }>;
type PreparedUsagePairAction = Extract<PreparedSuccess, { action: "usage_pair_fetch" }>;

function openAiUsageHostAuth(core: CoreBridge) {
  return decodeOpenAiUsageHostAuth(core.call("openAiUsageHostAuth", []));
}

function kimiUsageHostAuth(core: CoreBridge) {
  return decodeKimiUsageHostAuth(core.call("kimiUsageHostAuth", []));
}

function openAiUsageHostParams(core: CoreBridge, facts: OpenAiUsageHostLookupFacts): OpenAiUsageHostParams {
  return decodeOpenAiUsageHostParams(core.call("openAiUsageHostParams", [facts]));
}

function kimiUsageHostParams(core: CoreBridge, facts: KimiUsageHostLookupFacts): KimiUsageHostParams {
  return decodeKimiUsageHostParams(core.call("kimiUsageHostParams", [facts]));
}

async function executeOpenAiUsageInCore(
  core: CoreBridge,
  ctx: unknown,
  params: OpenAiUsageHostParams,
) {
  const rendered = decodeBridgeToolResult(await core.call("executeOpenAiUsage", [params, ctx]));
  return preparedToolResult(core, { ...rendered });
}

async function executeUsagePairInCore(
  core: CoreBridge,
  ctx: unknown,
  openai: OpenAiUsageHostParams,
  kimi: KimiUsageHostParams,
) {
  const rendered = decodeBridgeToolResult(await core.call("executeUsagePair", [{ openai, kimi }, ctx]));
  return preparedToolResult(core, { ...rendered });
}

async function resolveOpenAiUsageParams(
  pi: PiLike,
  core: CoreBridge,
  apiKeyPresent: boolean,
  ctx: unknown,
): Promise<OpenAiUsageHostParams> {
  const registry = modelRegistryFrom(pi, ctx);
  const auth = openAiUsageHostAuth(core);
  const credential = openAiCredentialRaw(registry, auth.credentialKey);
  let tokenFacts: Omit<OpenAiUsageHostLookupFacts, "apiKeyPresent">;
  try {
    tokenFacts = { token: await usageTokenRaw(registry, auth.providerKey) };
  } catch (error) {
    tokenFacts = { tokenError: error instanceof Error ? error.message : String(error) };
  }
  return openAiUsageHostParams(core, {
    apiKeyPresent,
    ...(credential !== undefined ? { credential } : {}),
    ...tokenFacts,
  });
}

async function resolveKimiUsageParams(
  pi: PiLike,
  core: CoreBridge,
  ctx: unknown,
): Promise<KimiUsageHostParams> {
  const registry = modelRegistryFrom(pi, ctx);
  const auth = kimiUsageHostAuth(core);
  let tokenFacts: KimiUsageHostLookupFacts;
  try {
    tokenFacts = { token: await usageTokenRaw(registry, auth.providerKey) };
  } catch (error) {
    tokenFacts = { tokenError: error instanceof Error ? error.message : String(error) };
  }
  return kimiUsageHostParams(core, tokenFacts);
}

export async function executeOpenAiUsageWithHostAuth(
  pi: PiLike,
  core: CoreBridge,
  prepared: PreparedOpenAiAction,
  ctx: unknown,
) {
  return executeOpenAiUsageInCore(
    core,
    ctx,
    await resolveOpenAiUsageParams(pi, core, prepared["apiKeyPresent"] === true, ctx),
  );
}

export async function executeUsagePairWithHostAuth(
  pi: PiLike,
  core: CoreBridge,
  prepared: PreparedUsagePairAction,
  ctx: unknown,
) {
  const [openai, kimi] = await Promise.all([
    resolveOpenAiUsageParams(pi, core, prepared.openaiApiKeyPresent === true, ctx),
    resolveKimiUsageParams(pi, core, ctx),
  ]);
  return executeUsagePairInCore(core, ctx, openai, kimi);
}
