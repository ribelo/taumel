import { Compile } from "typebox/compile";
import type { TSchema } from "typebox";

export type ParsedToolParams = object;

export type ParseToolParamsResult =
  | { readonly ok: true; readonly params: ParsedToolParams }
  | { readonly ok: false; readonly error: string };

export type ToolParamsRefinement = (params: ParsedToolParams) => string | undefined;

export type AdditionalInstruction = {
  readonly text: string;
  readonly requiredSkill: string;
  readonly unavailable: {
    readonly code: string;
    readonly message: string;
  };
};

export type AgentToolExecution = {
  readonly domain: "agent";
  readonly preparedAction: "agent_start" | "agent_send" | "agent_wait" | "agent_close";
  readonly parentActiveTools: boolean;
  readonly allowInvalidChildMetadata: boolean;
  readonly rememberDescription: boolean;
  readonly reconcileLiveDispatches: boolean;
  readonly additionalInstruction?: AdditionalInstruction;
};

export type ToolContract = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines?: readonly string[];
  readonly parameters: object;
  readonly parseParams: (rawParams: unknown) => ParseToolParamsResult;
  readonly execution?: AgentToolExecution;
  readonly constrainedSampling?:
    | false
    | { readonly type: "json_schema"; readonly strict: "prefer" | "require" }
    | { readonly type: "grammar"; readonly variants: { readonly openai_lark?: string; readonly openai_regex?: string } };
};

export type AgentToolContract = ToolContract & { readonly execution: AgentToolExecution };

export function isAgentToolContract(contract: ToolContract): contract is AgentToolContract {
  return contract.execution?.domain === "agent";
}

type JsonSchemaObject = {
  [key: string]: unknown;
  type?: unknown;
  enum?: unknown;
  anyOf?: unknown;
};

function schemaObject(value: unknown): JsonSchemaObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonSchemaObject
    : undefined;
}

const schemaMetaKeys = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
]);

function primitiveType(value: unknown): string | undefined {
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    default:
      return undefined;
  }
}

function collapseAnyOfEnum(anyOf: unknown): { type: string; enum: unknown[] } | undefined {
  if (!Array.isArray(anyOf) || anyOf.length === 0) return undefined;
  const values: unknown[] = [];
  const types = new Set<string>();
  for (const item of anyOf) {
    const schema = schemaObject(item);
    if (schema === undefined || !Array.isArray(schema.enum) || schema.enum.length !== 1) {
      return undefined;
    }
    const value = schema.enum[0];
    const type = typeof schema.type === "string" ? schema.type : primitiveType(value);
    if (type === undefined) return undefined;
    values.push(value);
    types.add(type);
  }
  if (types.size !== 1) return undefined;
  return { type: [...types][0], enum: values };
}

function modelToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => modelToolSchema(item));
  }
  const schema = schemaObject(value);
  if (schema !== undefined) {
    const result: JsonSchemaObject = {};
    const constValue = schema["const"];
    for (const [key, item] of Object.entries(schema)) {
      if (schemaMetaKeys.has(key) || key === "const") continue;
      result[key] = modelToolSchema(item);
    }
    if (constValue !== undefined) {
      result["enum"] = [constValue];
      if (result["type"] === undefined) {
        const type = primitiveType(constValue);
        if (type !== undefined) result["type"] = type;
      }
    }
    const collapsedAnyOf = collapseAnyOfEnum(result["anyOf"]);
    if (collapsedAnyOf !== undefined) {
      delete result["anyOf"];
      result["type"] = collapsedAnyOf["type"];
      result["enum"] = collapsedAnyOf["enum"];
    }
    return result;
  }
  return value;
}

function toolParameters(schema: unknown): object {
  const modeled = modelToolSchema(schema);
  return typeof modeled === "object" && modeled !== null ? modeled : {};
}

function firstValidationError(validator: ReturnType<typeof Compile>, value: unknown): string {
  let first;
  for (const error of validator.Errors(value)) {
    first = error;
    break;
  }
  if (first === undefined) return "invalid parameters";
  const path = typeof first.instancePath === "string" && first.instancePath !== ""
    ? first.instancePath.replaceAll("/", ".").replace(/^\./, ".")
    : "";
  return path === "" ? first.message : `${path}: ${first.message}`;
}

export function toolInput(
  schema: TSchema,
  refine?: ToolParamsRefinement,
): Pick<ToolContract, "parameters" | "parseParams"> {
  const validator = Compile(schema);
  return {
    parameters: toolParameters(schema),
    parseParams: (rawParams) => {
      const params = rawParams === undefined || rawParams === null ? {} : rawParams;
      if (!validator.Check(params)) {
        return { ok: false, error: firstValidationError(validator, params) };
      }
      const parsed = params as ParsedToolParams;
      const refinementError = refine?.(parsed);
      return refinementError === undefined
        ? { ok: true, params: parsed }
        : { ok: false, error: refinementError };
    },
  };
}

export function parseContractParams(
  contract: ToolContract,
  rawParams: unknown,
): ParseToolParamsResult {
  const result = contract.parseParams(rawParams);
  if (result.ok) return result;
  const separator = result.error.startsWith(".") ? "" : ": ";
  return { ok: false, error: `${contract.name}${separator}${result.error}` };
}
