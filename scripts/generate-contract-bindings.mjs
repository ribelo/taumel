#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);
const sourcePaths = [
  join(projectRoot, "src", "tool-contracts.ts"),
  join(projectRoot, "src", "bridge-contract-catalog.ts"),
];
const outputDir = join(projectRoot, "bin", "generated");
const ts2ocamlBin = join(projectRoot, "node_modules", ".bin", "ts2ocaml");
const opaqueDtsSchemaIds = new Set([
  "ExaTextOptions",
  "ExaHighlightsOptions",
  "ExaSummaryOptions",
  "ExaContentOptions",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function isIdentifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function propertyName(name) {
  return isIdentifier(name) ? name : JSON.stringify(name);
}

function literalType(value) {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return String(value);
    case "boolean":
      return String(value);
    default:
      return "unknown";
  }
}

function schemaToTs(schema, namedSchemas, currentName) {
  if (schema && typeof schema === "object") {
    if (
      typeof schema.$id === "string" &&
      schema.$id !== currentName &&
      namedSchemas.has(schema.$id)
    ) {
      return schema.$id;
    }
    if (typeof schema.$id === "string" && opaqueDtsSchemaIds.has(schema.$id)) {
      return "unknown";
    }
    if ("const" in schema) return literalType(schema.const);
    if (Array.isArray(schema.anyOf)) {
      const mapped = schema.anyOf.map((item) => schemaToTs(item, namedSchemas, currentName));
      return [...new Set(mapped)].join(" | ") || "unknown";
    }
    switch (schema.type) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return `readonly ${schemaToTs(schema.items, namedSchemas, currentName)}[]`;
      case "object":
        if (schema.patternProperties && typeof schema.patternProperties === "object") {
          return "unknown";
        }
        if (schema.properties && typeof schema.properties === "object") {
          const required = new Set(Array.isArray(schema.required) ? schema.required : []);
          const fields = Object.entries(schema.properties).map(([name, property]) => {
            const optional = required.has(name) ? "" : "?";
            return `readonly ${propertyName(name)}${optional}: ${schemaToTs(property, namedSchemas, currentName)};`;
          });
          return fields.length === 0 ? "Record<string, never>" : `{ ${fields.join(" ")} }`;
        }
        return "Record<string, unknown>";
      default:
        return "unknown";
    }
  }
  return "unknown";
}

function interfaceText(name, schema, namedSchemas) {
  if (!schema || typeof schema !== "object" || schema.type !== "object") {
    throw new Error(`${name} must be a TypeBox object schema`);
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const fields = Object.entries(schema.properties ?? {}).map(([fieldName, property]) => {
    const optional = required.has(fieldName) ? "" : "?";
    return `  readonly ${propertyName(fieldName)}${optional}: ${schemaToTs(property, namedSchemas, name)};`;
  });
  return [`export interface ${name} {`, ...fields, "}"].join("\n");
}

function generatedBuilders(dtsSchemas, generatedMli) {
  const modules = [];
  for (const [name, schema] of dtsSchemas) {
    const properties = Object.entries(schema?.properties ?? {});
    const literalProperties = properties.filter(([, property]) =>
      property && typeof property === "object" && "const" in property
    );
    const enumProperties = properties.filter(([, property]) =>
      Array.isArray(property?.anyOf) &&
      property.anyOf.length > 0 &&
      property.anyOf.every((item) => item && typeof item === "object" && typeof item.const === "string")
    );
    if (literalProperties.length === 0 && enumProperties.length === 0) {
      continue;
    }
    const moduleMatch = generatedMli.match(
      new RegExp(`module ${name} : sig[\\s\\S]*?\\n  val create: ([^\\n]+)\\nend`),
    );
    if (moduleMatch === null) throw new Error(`missing generated create signature for ${name}`);
    const arguments_ = [...moduleMatch[1].matchAll(/(\??)([A-Za-z_][A-Za-z0-9_]*):/g)];
    if (arguments_.length !== properties.length) {
      throw new Error(`generated create signature for ${name} does not match its schema`);
    }
    const body = [
      `module ${name} = struct`,
      `  type t = Tool_contracts.${name}.t`,
      `  let t_to_js = Tool_contracts.${name}.t_to_js`,
      `  let t_of_js = Tool_contracts.${name}.t_of_js`,
    ];
    if (literalProperties.length > 0) {
      const parameters = [];
      const forwarded = [];
      for (let index = 0; index < properties.length; index += 1) {
        const [, property] = properties[index];
        const [match, optional, label] = arguments_[index];
        if (property && typeof property === "object" && "const" in property) {
          const tail = moduleMatch[1].slice(arguments_[index].index + match.length);
          const variant = tail.match(/`([A-Za-z0-9_]+)/)?.[1];
          if (variant === undefined) throw new Error(`missing literal variant for ${name}.${label}`);
          forwarded.push(`~${label}:\`${variant}`);
        } else {
          parameters.push(`${optional === "?" ? "?" : "~"}${label}`);
          forwarded.push(`${optional === "?" ? "?" : "~"}${label}`);
        }
      }
      body.push(
        `  let create ${parameters.join(" ")} () =`,
        `    Tool_contracts.${name}.create ${forwarded.join(" ")} ()`,
      );
    }
    for (const [fieldName, property] of enumProperties) {
      const localFieldName = fieldName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      const getterMatch = generatedMli.match(
        new RegExp(`module ${name} : sig[\\s\\S]*?\\n  val get_${fieldName}: t -> ([^\\n]+)`),
      );
      if (getterMatch === null) throw new Error(`missing generated getter for ${name}.${fieldName}`);
      const generatedVariants = new Map(
        [...getterMatch[1].matchAll(/`([A-Za-z0-9_]+)\[@js ("(?:[^"\\]|\\.)*")\]/g)]
          .map((match) => [JSON.parse(match[2]), match[1]]),
      );
      const values = property.anyOf.map((item) => item.const);
      const stable = (value) => `V_${value.replace(/[^A-Za-z0-9_]/g, "_")}`;
      const mappings = values.map((value) => {
        const generated = generatedVariants.get(value);
        if (generated === undefined) throw new Error(`missing generated enum variant for ${name}.${fieldName}=${value}`);
        return { generated, stable: stable(value) };
      });
      body.push(
        `  type ${localFieldName} = [ ${mappings.map(({ stable }) => `\`${stable}`).join(" | ")} ]`,
        `  let ${localFieldName}_to_contract = function`,
        ...mappings.map(({ generated, stable }) => `    | \`${stable} -> \`${generated}`),
        `  let get_${localFieldName} value =`,
      );
      const optional = /\boption\b/.test(getterMatch[1]);
      if (optional) {
        body.push(
          `    match Tool_contracts.${name}.get_${fieldName} value with`,
          "    | None -> None",
          ...mappings.map(({ generated, stable }) => `    | Some \`${generated} -> Some \`${stable}`),
        );
      } else {
        body.push(
          `    match Tool_contracts.${name}.get_${fieldName} value with`,
          ...mappings.map(({ generated, stable }) => `    | \`${generated} -> \`${stable}`),
        );
      }
    }
    body.push("end");
    modules.push(body.join("\n"));
  }
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)\n\n${modules.join("\n\n")}\n`;
}

async function loadContracts(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      sourceMap: false,
    },
    fileName: sourcePath,
  });
  const tempPath = join(dirname(sourcePath), `${basename(sourcePath, ".ts")}.generated.mjs`);
  await writeFile(tempPath, transpiled.outputText, "utf8");
  try {
    return await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const modules = await Promise.all(sourcePaths.map(loadContracts));
  const dtsSchemas = modules.flatMap((contracts) => [
    ...(Array.isArray(contracts.dtsSchemas) ? contracts.dtsSchemas : []),
    ...(Array.isArray(contracts.bridgeDtsSchemas) ? contracts.bridgeDtsSchemas : []),
  ]);
  if (!Array.isArray(dtsSchemas)) throw new Error("tool-contracts.ts must export dtsSchemas");
  const namedSchemas = new Map(dtsSchemas.map(([name, schema]) => [name, schema]));
  const dts = [
    "/* generated by scripts/generate-contract-bindings.mjs; do not edit */",
    ...dtsSchemas.map(([name, schema]) => interfaceText(name, schema, namedSchemas)),
    "",
  ].join("\n\n");
  await writeFile(join(outputDir, "tool_contracts.d.ts"), dts, "utf8");

  run(ts2ocamlBin, [
    "jsoo",
    "--preset",
    "minimal",
    "--create-minimal-stdlib",
    "--output-dir",
    outputDir,
    join(outputDir, "tool_contracts.d.ts"),
  ]);

  const minimalMli = await readFile(join(outputDir, "ts2ocaml_min.mli"), "utf8");
  await writeFile(
    join(outputDir, "ts2ocaml.mli"),
    `${minimalMli}\nmodule Dom : sig end\n`,
    "utf8",
  );
  await rm(join(outputDir, "ts2ocaml_min.mli"), { force: true });

  run("gen_js_api", ["-o", "ts2ocaml.ml", "ts2ocaml.mli"], { cwd: outputDir });
  run("gen_js_api", ["-o", "tool_contracts.ml", "tool_contracts.mli"], { cwd: outputDir });
  const generatedMli = await readFile(join(outputDir, "tool_contracts.mli"), "utf8");
  await writeFile(
    join(outputDir, "boundary_contracts.ml"),
    generatedBuilders(dtsSchemas, generatedMli),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
