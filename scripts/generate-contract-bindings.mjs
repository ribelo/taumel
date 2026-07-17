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

const ocamlKeywords = new Set([
  "and", "as", "assert", "begin", "class", "constraint", "do", "done", "downto",
  "else", "end", "exception", "external", "false", "for", "fun", "function",
  "functor", "if", "in", "include", "inherit", "initializer", "lazy", "let",
  "match", "method", "module", "mutable", "new", "nonrec", "object", "of", "open",
  "or", "private", "rec", "sig", "struct", "then", "to", "true", "try", "type",
  "val", "virtual", "when", "while", "with",
]);

function ocamlIdentifier(name) {
  return ocamlKeywords.has(name) ? `${name}_` : name;
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
  if (!schema || typeof schema !== "object") {
    throw new Error(`${name} must be a TypeBox schema`);
  }
  if (Array.isArray(schema.anyOf)) {
    return `export type ${name} = ${schemaToTs(schema, namedSchemas, name)};`;
  }
  if (schema.type !== "object") {
    throw new Error(`${name} must be a TypeBox object or union schema`);
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
      const localFieldName = ocamlIdentifier(
        fieldName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(),
      );
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

function publicTs2ocamlInterface() {
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)

type unknown
val unknown_to_js : unknown -> Ojs.t
val unknown_of_js : Ojs.t -> unknown

module Primitive : sig
  type +'cases t
end

module Union : sig
  type +'cases t
end

type ('t1, 't2) union2 = [ \`U1 of 't1 | \`U2 of 't2 ] Union.t

module Dom : sig end
`;
}

function internalTs2ocamlInterface() {
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)

module Primitive : sig
  type 'cases t = 'cases Ts2ocaml.Primitive.t
  val t_of_js : (Ojs.t -> 'cases) -> Ojs.t -> 'cases t
  val t_to_js : ('cases -> Ojs.t) -> 'cases t -> Ojs.t
end

val union2_of_js :
  (Ojs.t -> 't1) -> (Ojs.t -> 't2) -> Ojs.t -> ('t1, 't2) Ts2ocaml.union2
val union2_to_js :
  ('t1 -> Ojs.t) -> ('t2 -> Ojs.t) -> ('t1, 't2) Ts2ocaml.union2 -> Ojs.t
`;
}

function internalTs2ocamlImplementation() {
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)

module Primitive = struct
  type 'cases t = 'cases Ts2ocaml.Primitive.t
  let t_of_js _ value : 'cases t = Obj.magic value
  let t_to_js _ (value : 'cases t) : Ojs.t = Obj.magic value
end

let union2_of_js _ _ value : ('t1, 't2) Ts2ocaml.union2 = Obj.magic value
let union2_to_js _ _ (value : ('t1, 't2) Ts2ocaml.union2) : Ojs.t =
  Obj.magic value
`;
}

function internalToolContractsInterface(generatedMli) {
  return generatedMli.replace(
    /^open Ts2ocaml\.Dom$/m,
    "open Ts2ocaml.Dom\nopen Ts2ocaml_internal",
  );
}

const supportedSchemaKeys = new Set([
  "$id",
  "additionalItems",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "exclusiveMinimum",
  "items",
  "maximum",
  "maxItems",
  "maxLength",
  "minimum",
  "minItems",
  "minLength",
  "pattern",
  "patternProperties",
  "properties",
  "required",
  "type",
]);

function ocamlString(value) {
  return JSON.stringify(value);
}

function ocamlOption(value, render = String) {
  return value === undefined ? "None" : `Some (${render(value)})`;
}

function ocamlFloat(value) {
  return Number.isInteger(value) ? `${value}.` : String(value);
}

function schemaValueName(name) {
  return `schema_${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
}

function schemaExpression(schema, path) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`${path}: contract schema must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (!supportedSchemaKeys.has(key)) {
      throw new Error(`${path}: unsupported runtime contract keyword ${key}`);
    }
  }
  if (Array.isArray(schema.anyOf)) {
    if (schema.anyOf.length === 0) throw new Error(`${path}.anyOf must not be empty`);
    return `Any_of [ ${schema.anyOf.map((item, index) => schemaExpression(item, `${path}.anyOf[${index}]`)).join("; ")} ]`;
  }
  if (schema.type === undefined) {
    if (Object.keys(schema).every((key) => ["$id", "description"].includes(key))) return "Any";
    throw new Error(`${path}: schema without type or anyOf is not runtime-decodable`);
  }
  switch (schema.type) {
    case "string":
      return `String { string_const = ${ocamlOption(schema.const, ocamlString)}; min_length = ${ocamlOption(schema.minLength)}; max_length = ${ocamlOption(schema.maxLength)}; pattern = ${ocamlOption(schema.pattern, ocamlString)} }`;
    case "number":
    case "integer":
      return `Number { integer = ${schema.type === "integer"}; number_const = ${ocamlOption(schema.const, ocamlFloat)}; minimum = ${ocamlOption(schema.minimum, ocamlFloat)}; maximum = ${ocamlOption(schema.maximum, ocamlFloat)}; exclusive_minimum = ${ocamlOption(schema.exclusiveMinimum, ocamlFloat)} }`;
    case "boolean":
      return `Boolean (${ocamlOption(schema.const, String)})`;
    case "null":
      return "Null";
    case "array": { // TypeBox represents tuples with an array-valued `items`.
      const items = Array.isArray(schema.items)
        ? `Tuple ([ ${schema.items.map((item, index) => schemaExpression(item, `${path}.items[${index}]`)).join("; ")} ], ${schema.additionalItems !== false})`
        : `Items (${schemaExpression(schema.items ?? {}, `${path}.items`)})`;
      return `Array { items = ${items}; min_items = ${ocamlOption(schema.minItems)}; max_items = ${ocamlOption(schema.maxItems)} }`;
    }
    case "object": {
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const properties = Object.entries(schema.properties ?? {}).map(([name, property]) =>
        `(${ocamlString(name)}, ${required.has(name)}, ${schemaExpression(property, `${path}.${name}`)})`
      );
      for (const name of required) {
        if (!(name in (schema.properties ?? {}))) {
          throw new Error(`${path}: required property ${name} has no schema`);
        }
      }
      const patterns = Object.entries(schema.patternProperties ?? {}).map(([pattern, property]) =>
        `(${ocamlString(pattern)}, ${schemaExpression(property, `${path}.patternProperties[${JSON.stringify(pattern)}]`)})`
      );
      const additional = schema.additionalProperties === false
        ? "Reject"
        : schema.additionalProperties && typeof schema.additionalProperties === "object"
          ? `Validate (${schemaExpression(schema.additionalProperties, `${path}.additionalProperties`)})`
          : "Allow";
      return `Object { properties = [ ${properties.join("; ")} ]; pattern_properties = [ ${patterns.join("; ")} ]; additional = ${additional} }`;
    }
    default:
      throw new Error(`${path}: unsupported runtime contract type ${JSON.stringify(schema.type)}`);
  }
}

function generatedContractSchemas(dtsSchemas) {
  const schemas = dtsSchemas.map(([name, schema]) =>
    `let ${schemaValueName(name)} = ${schemaExpression(schema, name)}`
  );
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)

type string_schema = {
  string_const : string option;
  min_length : int option;
  max_length : int option;
  pattern : string option;
}

type number_schema = {
  integer : bool;
  number_const : float option;
  minimum : float option;
  maximum : float option;
  exclusive_minimum : float option;
}

type schema =
  | Any
  | Any_of of schema list
  | String of string_schema
  | Number of number_schema
  | Boolean of bool option
  | Null
  | Array of array_schema
  | Object of object_schema

and array_items = Items of schema | Tuple of schema list * bool

and array_schema = {
  items : array_items;
  min_items : int option;
  max_items : int option;
}

and additional_properties = Allow | Reject | Validate of schema

and object_schema = {
  properties : (string * bool * schema) list;
  pattern_properties : (string * schema) list;
  additional : additional_properties;
}

${schemas.join("\n")}
`;
}

function generatedSafeContracts(dtsSchemas) {
  const modules = dtsSchemas.map(([name]) => {
    const schemaName = schemaValueName(name);
    return `module ${name} = struct
  include Raw_tool_contracts.${name}
  let t_of_js value =
    try
      Contract_decoder.decode Contract_schemas.${schemaName} ${ocamlString(name)} value
      |> Result.map Raw_tool_contracts.${name}.t_of_js
    with error ->
      Error (${ocamlString(`${name}: runtime decoding failed: `)} ^ Printexc.to_string error)
  let t_to_js value =
    let raw = Raw_tool_contracts.${name}.t_to_js value in
    Contract_decoder.freeze Contract_schemas.${schemaName} raw;
    raw
end`;
  });
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)\n\n${modules.join("\n\n")}\n`;
}

function generatedToolParamDecoders(toolParamSchemas) {
  const cases = toolParamSchemas.map(({ name, interfaceName }) =>
    `  | ${ocamlString(name)} ->
      Tool_contracts.${interfaceName}.t_of_js value
      |> Result.map Tool_contracts.${interfaceName}.t_to_js`
  );
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)

let decode name value =
  match name with
${cases.join("\n")}
  | _ -> Error ("no TS-to-OCaml parameter contract for tool " ^ name)
`;
}

function generatedSafeMli(rawMli) {
  const publicMli = rawMli.split("\nmodule Export : sig")[0];
  return publicMli
    .replace(/^(\s*)type t(?: =.*)?$/gm, "$1type t")
    .replace(/^  val t_of_js: Ojs\.t -> t$/gm, "  val t_of_js: Ojs.t -> (t, string) result")
    .replace(/^ {4,}val t_of_js: Ojs\.t -> t\n/gm, "");
}

function privateRawContracts(rawMl) {
  const withoutAssertions = rawMl.replaceAll("assert false", "raise Raw_contract_invariant");
  if (withoutAssertions.includes("assert false")) {
    throw new Error("generated raw contracts still contain assert false");
  }
  const headerEnd = withoutAssertions.indexOf("\n", withoutAssertions.indexOf("\n") + 1) + 1;
  return `${withoutAssertions.slice(0, headerEnd)}exception Raw_contract_invariant\n${withoutAssertions.slice(headerEnd)}`;
}

function contractDecoderSource() {
  return `(* generated by scripts/generate-contract-bindings.mjs; do not edit *)

open Contract_schemas

let object_constructor = Ojs.get_prop_ascii Ojs.global "Object"
let number_constructor = Ojs.get_prop_ascii Ojs.global "Number"
let regexp_constructor = Ojs.get_prop_ascii Ojs.global "RegExp"

let error path message = Error (path ^ ": " ^ message)

let object_keys value =
  Ojs.call object_constructor "keys" [| value |]
  |> Ojs.list_of_js Ojs.string_of_js

let empty_decoded_object () =
  Ojs.call object_constructor "create" [| Ojs.null |]

let is_array value = Ojs.obj_type value = "[object Array]"

let freeze_value value =
  ignore (Ojs.call object_constructor "freeze" [| value |])

let regexp_matches pattern value =
  let regexp = Ojs.new_obj regexp_constructor [| Ojs.string_to_js pattern |] in
  Ojs.call regexp "test" [| Ojs.string_to_js value |] |> Ojs.bool_of_js

let number_predicate name value =
  Ojs.call number_constructor name [| value |] |> Ojs.bool_of_js

let option_holds predicate = function None -> true | Some value -> predicate value

let rec decode schema path value =
  match schema with
  | Any -> Ok value
  | Any_of alternatives -> decode_any_of alternatives path value
  | String constraints -> decode_string constraints path value
  | Number constraints -> decode_number constraints path value
  | Boolean expected -> decode_boolean expected path value
  | Null -> if Ojs.is_null value then Ok value else error path "expected null"
  | Array constraints -> decode_array constraints path value
  | Object constraints -> decode_object constraints path value

and decode_any_of alternatives path value =
  let rec loop = function
    | [] -> error path "did not match any allowed schema"
    | schema :: rest -> (
        match decode schema path value with Ok _ as decoded -> decoded | Error _ -> loop rest)
  in
  loop alternatives

and decode_string constraints path value =
  if Ojs.type_of value <> "string" then error path "expected string"
  else
    let text = Ojs.string_of_js value in
    let length = Ojs.get_prop_ascii value "length" |> Ojs.int_of_js in
    if not (option_holds (( = ) text) constraints.string_const) then
      error path "has an unrecognized value"
    else if not (option_holds (fun minimum -> length >= minimum) constraints.min_length) then
      error path "is shorter than the minimum length"
    else if not (option_holds (fun maximum -> length <= maximum) constraints.max_length) then
      error path "is longer than the maximum length"
    else if not (option_holds (fun pattern -> regexp_matches pattern text) constraints.pattern) then
      error path "does not match the required pattern"
    else Ok value

and decode_number constraints path value =
  if Ojs.type_of value <> "number" || not (number_predicate "isFinite" value) then
    error path (if constraints.integer then "expected integer" else "expected finite number")
  else if constraints.integer && not (number_predicate "isInteger" value) then
    error path "expected integer"
  else
    let number = Ojs.float_of_js value in
    if not (option_holds (( = ) number) constraints.number_const) then
      error path "has an unrecognized value"
    else if not (option_holds (fun minimum -> number >= minimum) constraints.minimum) then
      error path "is below the minimum"
    else if not (option_holds (fun maximum -> number <= maximum) constraints.maximum) then
      error path "is above the maximum"
    else if not (option_holds (fun minimum -> number > minimum) constraints.exclusive_minimum) then
      error path "must be greater than the exclusive minimum"
    else Ok value

and decode_boolean expected path value =
  if Ojs.type_of value <> "boolean" then error path "expected boolean"
  else
    let boolean = Ojs.bool_of_js value in
    if option_holds (( = ) boolean) expected then Ok value
    else error path "has an unrecognized value"

and decode_array constraints path value =
  if not (is_array value) then error path "expected array"
  else
    let length = Ojs.get_prop_ascii value "length" |> Ojs.int_of_js in
    if not (option_holds (fun minimum -> length >= minimum) constraints.min_items) then
      error path "has fewer than the minimum number of items"
    else if not (option_holds (fun maximum -> length <= maximum) constraints.max_items) then
      error path "has more than the maximum number of items"
    else
      let output = Ojs.array_make length in
      let rec loop index =
        if index = length then (freeze_value output; Ok output)
        else
          match array_item_schema constraints.items index with
          | None -> error (path ^ "[" ^ string_of_int index ^ "]") "is not allowed"
          | Some item_schema -> (
              match decode item_schema (path ^ "[" ^ string_of_int index ^ "]") (Ojs.array_get value index) with
              | Error _ as failure -> failure
              | Ok item -> Ojs.array_set output index item; loop (index + 1))
      in
      loop 0

and array_item_schema items index =
  match items with
  | Items schema -> Some schema
  | Tuple (schemas, additional) -> (
      match List.nth_opt schemas index with
      | Some schema -> Some schema
      | None -> if additional then Some Any else None)

and decode_object constraints path value =
  if Ojs.type_of value <> "object" || Ojs.is_null value || is_array value then
    error path "expected object"
  else
    let keys = object_keys value in
    match missing_required constraints.properties keys with
    | Some name -> error (path ^ "." ^ name) "is required"
    | None ->
        let output = empty_decoded_object () in
        let rec loop = function
          | [] -> freeze_value output; Ok output
          | name :: rest -> (
              match object_property_schemas constraints name with
              | None -> error (path ^ "." ^ name) "is not allowed"
              | Some property_schemas -> (
                  let property = Ojs.get_prop_ascii value name in
                  match decode_all property_schemas (path ^ "." ^ name) property with
                  | Error _ as failure -> failure
                  | Ok decoded -> Ojs.set_prop_ascii output name decoded; loop rest))
        in
        loop keys

and decode_all schemas path value =
  match schemas with
  | [] -> Ok value
  | schema :: rest -> (
      match decode schema path value with
      | Error _ as failure -> failure
      | Ok decoded -> decode_all rest path decoded)

and missing_required properties keys =
  properties
  |> List.find_map (fun (name, required, _) ->
         if required && not (List.mem name keys) then Some name else None)

and object_property_schemas constraints name =
  let explicit =
    constraints.properties
    |> List.filter_map (fun (property, _, schema) ->
           if property = name then Some schema else None)
  in
  let patterned =
    constraints.pattern_properties
    |> List.filter_map (fun (pattern, schema) ->
           if regexp_matches pattern name then Some schema else None)
  in
  match explicit @ patterned with
  | _ :: _ as schemas -> Some schemas
  | [] -> (
      match constraints.additional with
      | Allow -> Some [ Any ]
      | Reject -> None
      | Validate schema -> Some [ schema ])

let rec freeze schema value =
  match schema with
  | Any | String _ | Number _ | Boolean _ | Null -> ()
  | Any_of alternatives -> freeze_first_matching alternatives value
  | Array constraints ->
      let length = Ojs.get_prop_ascii value "length" |> Ojs.int_of_js in
      for index = 0 to length - 1 do
        match array_item_schema constraints.items index with
        | Some item_schema -> freeze item_schema (Ojs.array_get value index)
        | None -> ()
      done;
      freeze_value value
  | Object constraints ->
      object_keys value
      |> List.iter (fun name ->
             match object_property_schemas constraints name with
             | Some property_schemas ->
                 let property = Ojs.get_prop_ascii value name in
                 List.iter (fun property_schema -> freeze property_schema property)
                   property_schemas
             | None -> ());
      freeze_value value

and freeze_first_matching alternatives value =
  match alternatives with
  | [] -> ()
  | schema :: rest -> (
      match decode schema "$" value with
      | Ok _ -> freeze schema value
      | Error _ -> freeze_first_matching rest value)
`;
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
  const toolParamSchemas = modules.flatMap((contracts) => contracts.toolParamSchemas ?? []);
  for (const { interfaceName } of toolParamSchemas) {
    if (!namedSchemas.has(interfaceName)) {
      throw new Error(`model-facing tool contract ${interfaceName} has no TS-to-OCaml runtime decoder`);
    }
  }
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
  await writeFile(join(outputDir, "ts2ocaml.mli"), publicTs2ocamlInterface(), "utf8");
  await writeFile(
    join(outputDir, "ts2ocaml_internal.mli"),
    internalTs2ocamlInterface(),
    "utf8",
  );
  await writeFile(
    join(outputDir, "ts2ocaml_internal.ml"),
    internalTs2ocamlImplementation(),
    "utf8",
  );
  await rm(join(outputDir, "raw_ts2ocaml.ml"), { force: true });
  await rm(join(outputDir, "raw_ts2ocaml.mli"), { force: true });
  const generatedMli = await readFile(join(outputDir, "tool_contracts.mli"), "utf8");
  await writeFile(
    join(outputDir, "raw_tool_contracts.mli"),
    internalToolContractsInterface(generatedMli),
    "utf8",
  );
  await rm(join(outputDir, "tool_contracts.mli"), { force: true });
  run("gen_js_api", ["-o", "raw_tool_contracts.ml", "raw_tool_contracts.mli"], { cwd: outputDir });
  const rawMlPath = join(outputDir, "raw_tool_contracts.ml");
  await writeFile(rawMlPath, privateRawContracts(await readFile(rawMlPath, "utf8")), "utf8");
  await writeFile(join(outputDir, "contract_schemas.ml"), generatedContractSchemas(dtsSchemas), "utf8");
  await writeFile(join(outputDir, "contract_decoder.ml"), contractDecoderSource(), "utf8");
  await writeFile(join(outputDir, "tool_contracts.ml"), generatedSafeContracts(dtsSchemas), "utf8");
  await writeFile(join(outputDir, "tool_contracts.mli"), generatedSafeMli(generatedMli), "utf8");
  await writeFile(
    join(outputDir, "tool_param_decoders.ml"),
    generatedToolParamDecoders(toolParamSchemas),
    "utf8",
  );
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
