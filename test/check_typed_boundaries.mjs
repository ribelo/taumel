import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url);
const projectRoot = new URL("../", import.meta.url);
const forbidden = [
  ["Record<string, unknown>", /Record\s*<\s*string\s*,\s*unknown\s*>/g],
  ["isRecord", /\bisRecord\s*\(/g],
  ["temporary interop object", /\b(?:InteropObject|isInteropObject)\b/g],
  ["generic core-call helper", /\b(?:coreCallRecord|coreCallOptionalRecord)\b/g],
  ["unvalidated core.call assignment", /=\s*(?:await\s+)?core\.call\s*\(/g],
  ["unvalidated core.call return", /return\s+(?:await\s+)?core\.call\s*\(/g],
];

const failures = [];
function visit(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) visit(file);
    else if (name.endsWith(".ts")) {
      const source = readFileSync(file, "utf8");
      for (const [label, pattern] of forbidden) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split("\n").length;
          failures.push(`${relative(root.pathname, file)}:${line}: ${label}`);
        }
      }
    }
  }
}

visit(root.pathname);

const binRoot = new URL("../bin/", import.meta.url);

function visitOcaml(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) {
      if (name !== "generated") visitOcaml(file);
    } else if (name.endsWith(".ml")) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bok_obj\b/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        failures.push(`${relative(binRoot.pathname, file)}:${line}: untyped core-call result helper`);
      }
      for (const match of source.matchAll(/Tool_contracts\.[A-Za-z0-9_]+\.create\b[\s\S]*?\(\)/g)) {
        if (!/~(?:ok|completed|forceUnsandboxed):(?:true|false)\b|~(?:action|kind|type_|tokenState):"[^"]+"/.test(match[0])) continue;
        const line = source.slice(0, match.index).split("\n").length;
        failures.push(`${relative(binRoot.pathname, file)}:${line}: caller-controlled contract discriminant`);
      }
      for (const match of source.matchAll(/`L_[A-Za-z0-9_]+/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        failures.push(`${relative(binRoot.pathname, file)}:${line}: unstable generated enum tag`);
      }
      for (const match of source.matchAll(/\("action",\s*js_string\b/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        failures.push(`${relative(binRoot.pathname, file)}:${line}: ad hoc boundary action`);
      }
    }
  }
}

visitOcaml(binRoot.pathname);

const generation = spawnSync(process.execPath, ["scripts/generate-contract-bindings.mjs"], {
  cwd: projectRoot.pathname,
  encoding: "utf8",
});
if (generation.status !== 0) {
  failures.push(`contract decoder generation failed: ${generation.stderr || generation.stdout}`);
}

const generatedRoot = join(binRoot.pathname, "generated");
// shared-qaqr: generation must preserve the private, Result-decoded boundary.
const safeImplementation = readFileSync(join(generatedRoot, "tool_contracts.ml"), "utf8");
const safeInterface = readFileSync(join(generatedRoot, "tool_contracts.mli"), "utf8");
const toolParamDecoders = readFileSync(join(generatedRoot, "tool_param_decoders.ml"), "utf8");
const generatedDune = readFileSync(join(generatedRoot, "dune"), "utf8");
const generatedModules = [...safeImplementation.matchAll(/^module ([A-Za-z0-9_]+) = struct$/gm)];
const resultDecoders = [...safeInterface.matchAll(/^  val t_of_js: Ojs\.t -> \(t, string\) result$/gm)];
if (generatedModules.length === 0 || resultDecoders.length !== generatedModules.length) {
  failures.push("generated public contract modules must each expose a Result-returning runtime decoder");
}
if (/^  type t =/m.test(safeInterface)) {
  failures.push("generated public contract types must hide their Ojs representation");
}
if (/let (?:rec )?t_of_js\s*:\s*Ojs\.t -> t\s*=\s*fun/.test(safeImplementation)) {
  failures.push("generated public contract decoder is an identity cast");
}
if (!/\(private_modules raw_tool_contracts contract_decoder contract_schemas\)/.test(generatedDune)) {
  failures.push("generated raw contract representation is not private");
}
if (!/Tool_contracts\.[A-Za-z0-9_]+\.t_of_js value\s+\|> Result\.map/g.test(toolParamDecoders)) {
  failures.push("model-facing tools do not have generated reverse-boundary decoders");
}
if (!/Tool_param_decoders\.decode name/.test(readFileSync(join(binRoot.pathname, "tool_dispatch.ml"), "utf8"))) {
  failures.push("model-facing tool dispatch bypasses generated parameter decoding");
}
for (const name of readdirSync(generatedRoot).filter((entry) => entry.endsWith(".ml"))) {
  if (/\bassert false\b/.test(readFileSync(join(generatedRoot, name), "utf8"))) {
    failures.push(`generated/${name}: generated assertions are forbidden`);
  }
}

for (const name of readdirSync(binRoot.pathname).filter((entry) => entry.endsWith(".ml"))) {
  const source = readFileSync(join(binRoot.pathname, name), "utf8");
  if (/\bRaw_tool_contracts\b/.test(source)) {
    failures.push(`${name}: private raw contract representation used outside generated façade`);
  }
  for (const [index, line] of source.split("\n").entries()) {
    if (
      /Tool_contracts\.[A-Za-z0-9_]+\.t_of_js/.test(line) &&
      !/decode_(?:ojs_)?contract|prepare_body_tool/.test(line)
    ) {
      failures.push(`${name}:${index + 1}: generated input decoder result is not handled`);
    }
  }
  if (name !== "jsoo_bridge.ml" && name !== "agent_worktree_host.ml" && /\bObj\.magic\b/.test(source)) {
    failures.push(`${name}: Obj.magic is forbidden outside the narrow JS adapters`);
  }
  if (/Ts2ocaml\.(?:Any|Unknown|Union|Intersection)\.(?:unsafe|cast|get)/.test(source)) {
    failures.push(`${name}: unsafe generated representation helper bypasses contract decoding`);
  }
}

if (failures.length > 0) {
  throw new Error(`Untyped production boundaries are forbidden:\n${failures.join("\n")}`);
}
