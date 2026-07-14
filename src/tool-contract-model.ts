export type ToolContract = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines?: readonly string[];
  readonly parameters: object;
};

type JsonSchemaObject = {
  [key: string]: unknown;
  type?: unknown;
  enum?: unknown;
  anyOf?: unknown;
};

function schemaObject(value: unknown): JsonSchemaObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchemaObject)
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

export function toolParameters(schema: unknown): object {
  const modeled = modelToolSchema(schema);
  return typeof modeled === "object" && modeled !== null ? modeled : {};
}