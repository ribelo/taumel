import Type, { type Static } from "typebox";

export const OpenAiUsageHostAuthSchema = Type.Object(
  {
    providerKey: Type.String({ minLength: 1 }),
    credentialKey: Type.String({ minLength: 1 }),
    source: Type.String({ minLength: 1 }),
  },
  { $id: "OpenAiUsageHostAuth", additionalProperties: false },
);

export const KimiUsageHostAuthSchema = Type.Object(
  { providerKey: Type.String({ minLength: 1 }), source: Type.String({ minLength: 1 }) },
  { $id: "KimiUsageHostAuth", additionalProperties: false },
);
export const OpenAiUsageHostLookupFactsSchema = Type.Object(
  {
    apiKeyPresent: Type.Boolean(), credential: Type.Optional(Type.Unknown()),
    token: Type.Optional(Type.String()), tokenError: Type.Optional(Type.String()),
  },
  { $id: "OpenAiUsageHostLookupFacts", additionalProperties: false },
);
export const KimiUsageHostLookupFactsSchema = Type.Object(
  {
    token: Type.Optional(Type.String()), tokenError: Type.Optional(Type.String()),
  },
  { $id: "KimiUsageHostLookupFacts", additionalProperties: false },
);
const hostParamsBase = { apiKeyPresent: Type.Boolean(), credential: Type.Optional(Type.Unknown()) };
const kimiHostParamsBase = { apiKeyPresent: Type.Boolean() };
export const OpenAiUsageHostParamsPresentSchema = Type.Object(
  { ...hostParamsBase, tokenState: Type.Literal("present"), token: Type.String({ minLength: 1 }) },
  { $id: "OpenAiUsageHostParamsPresent", additionalProperties: false },
);
export const OpenAiUsageHostParamsMissingSchema = Type.Object(
  { ...hostParamsBase, tokenState: Type.Literal("missing") },
  { $id: "OpenAiUsageHostParamsMissing", additionalProperties: false },
);
export const OpenAiUsageHostParamsErrorSchema = Type.Object(
  { ...hostParamsBase, tokenState: Type.Literal("error"), tokenError: Type.String({ minLength: 1 }) },
  { $id: "OpenAiUsageHostParamsError", additionalProperties: false },
);
export const OpenAiUsageHostParamsSchema = Type.Union([
  OpenAiUsageHostParamsPresentSchema, OpenAiUsageHostParamsMissingSchema, OpenAiUsageHostParamsErrorSchema,
], { $id: "OpenAiUsageHostParams" });
export const KimiUsageHostParamsPresentSchema = Type.Object(
  { ...kimiHostParamsBase, tokenState: Type.Literal("present"), token: Type.String({ minLength: 1 }) },
  { $id: "KimiUsageHostParamsPresent", additionalProperties: false },
);
export const KimiUsageHostParamsMissingSchema = Type.Object(
  { ...kimiHostParamsBase, tokenState: Type.Literal("missing") },
  { $id: "KimiUsageHostParamsMissing", additionalProperties: false },
);
export const KimiUsageHostParamsErrorSchema = Type.Object(
  { ...kimiHostParamsBase, tokenState: Type.Literal("error"), tokenError: Type.String({ minLength: 1 }) },
  { $id: "KimiUsageHostParamsError", additionalProperties: false },
);
export const KimiUsageHostParamsSchema = Type.Union([
  KimiUsageHostParamsPresentSchema, KimiUsageHostParamsMissingSchema, KimiUsageHostParamsErrorSchema,
], { $id: "KimiUsageHostParams" });
export const UsagePairHostParamsSchema = Type.Object(
  { openai: OpenAiUsageHostParamsSchema, kimi: KimiUsageHostParamsSchema },
  { $id: "UsagePairHostParams", additionalProperties: false },
);
export type OpenAiUsageHostAuth = Static<typeof OpenAiUsageHostAuthSchema>;
export type KimiUsageHostAuth = Static<typeof KimiUsageHostAuthSchema>;
export type OpenAiUsageHostLookupFacts = Static<typeof OpenAiUsageHostLookupFactsSchema>;
export type KimiUsageHostLookupFacts = Static<typeof KimiUsageHostLookupFactsSchema>;
export type OpenAiUsageHostParams = Static<typeof OpenAiUsageHostParamsSchema>;
export type KimiUsageHostParams = Static<typeof KimiUsageHostParamsSchema>;
export type UsagePairHostParams = Static<typeof UsagePairHostParamsSchema>;
