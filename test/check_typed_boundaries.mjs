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
const jsooBridge = readFileSync(join(binRoot.pathname, "jsoo_bridge.ml"), "utf8");
if (!/let get_string[\s\S]*?\| None -> invalid_field name "string"/.test(jsooBridge)) {
  failures.push("legacy string field access must reject instead of silently defaulting");
}
if (!/let get_bool[\s\S]*?\| _ -> invalid_field name "boolean"/.test(jsooBridge)) {
  failures.push("legacy boolean field access must reject instead of silently defaulting");
}
// shared-qaqr: generation must preserve the private, Result-decoded boundary.
const safeImplementation = readFileSync(join(generatedRoot, "tool_contracts.ml"), "utf8");
const safeInterface = readFileSync(join(generatedRoot, "tool_contracts.mli"), "utf8");
const ts2ocamlInterface = readFileSync(join(generatedRoot, "ts2ocaml.mli"), "utf8");
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
if (!/\(private_modules ts2ocaml_internal raw_tool_contracts contract_decoder contract_schemas\)/.test(generatedDune)) {
  failures.push("generated raw contract representation is not private");
}
if (/\b(?:unsafe_cast|cast_from|absurd|intersection[2-8]_of_js|union[2-8]_of_js)\b|\bval t_of_js\b/.test(ts2ocamlInterface)) {
  failures.push("public ts2ocaml representation helpers can forge a decoded contract");
}
if (!/Tool_contracts\.[A-Za-z0-9_]+\.t_of_js value\s+\|> Result\.map/g.test(toolParamDecoders)) {
  failures.push("model-facing tools do not have generated reverse-boundary decoders");
}
if (!/Tool_param_decoders\.decode name/.test(readFileSync(join(binRoot.pathname, "tool_dispatch.ml"), "utf8"))) {
  failures.push("model-facing tool dispatch bypasses generated parameter decoding");
}
// eng-ds01: the static bridge must exactly cover the runtime dispatcher without a string fallback.
const coreMethods = readFileSync(join(root.pathname, "core-methods.ts"), "utf8");
const runtimeDispatcher = readFileSync(join(binRoot.pathname, "taumel_main.ml"), "utf8");
const typedNames = [...coreMethods.matchAll(/^  readonly ([A-Za-z0-9_]+): readonly \[/gm)].map((match) => match[1]).sort();
const runtimeBranches = [...runtimeDispatcher.matchAll(/\|\s*"([^"]+)"\s*->/g)];
const runtimeNames = runtimeBranches.map((match) => match[1]).sort();
if (JSON.stringify(typedNames) !== JSON.stringify(runtimeNames)) {
  failures.push("CoreBridge method catalog does not exactly match the OCaml runtime dispatcher");
}
if (/name:\s*string|args\??:\s*readonly unknown\[\]/.test(coreMethods)) {
  failures.push("CoreBridge retains a stringly typed fallback call signature");
}
for (let index = 0; index < runtimeBranches.length; index += 1) {
  const branch = runtimeBranches[index];
  const end = runtimeBranches[index + 1]?.index ?? runtimeDispatcher.length;
  const body = runtimeDispatcher.slice(branch.index, end);
  const argumentIndexes = [...body.matchAll(/(?:\barg|\bstring_arg args|\bint_arg args)\s+(\d+)/g)].map((match) => Number(match[1]));
  const runtimeArity = argumentIndexes.length === 0 ? 0 : Math.max(...argumentIndexes) + 1;
  const tuple = coreMethods.match(new RegExp(`^  readonly ${branch[1]}: readonly \\[(.*)\\];$`, "m"))?.[1];
  const typedArity = tuple === "" ? 0 : (tuple?.split(",").length ?? -1);
  if (typedArity !== runtimeArity) failures.push(`${branch[1]}: CoreBridge arity ${typedArity} does not match dispatcher arity ${runtimeArity}`);
}
const schemaBackedCoreArgument = /^(?:Static<typeof (?:Action|Core)\.[A-Za-z0-9_]+Schema>|Core\.AgentActionCapabilityFacts|Action\.(?:ToolResultConstructionFacts|HostToolResultFacts))$/;
const schemaBackedCoreModules = new Map([
  ["Core.AgentActionCapabilityFacts", "AgentActionCapabilityFacts"],
  ["Action.HostToolResultFacts", "HostToolResultFacts"],
  ["Action.ToolResultConstructionFacts", "ToolResultConstructionFacts"],
]);
const auditedOpaqueCoreArguments = new Set([
  "planEnvironmentContext:0:HostContext", "planChildSessionStart:1:HostContext",
  "planChildPermissionRefresh:0:PersistedPermissionsEntry", "planChildPermissionRefresh:1:ChildMetadataHostValue",
  "planChildPermissionRefresh:2:HostContext", "planExecHostCall:1:HostContext",
  "formatExecResult:2:boolean", "formatExecResult:3:boolean",
  "planWriteStdinHostCall:1:HostContext", "runExecCommand:1:string", "runExecCommand:2:HostAbortSignal",
  "runExecCommand:3:HostContext", "shutdownExecOwner:0:string", "pendingExecNotifications:0:string",
  "claimExecNotificationDelivery:0:string", "claimExecNotificationDelivery:1:number",
  "releaseExecNotificationDelivery:0:number", "markExecNotificationDelivered:0:number", "awaitExecCompletion:0:number",
  "refreshFooterState:0:HostContext",
  'updateFooterThinking:0:"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"',
  "updateFooterThinking:1:HostContext", "planChildGoalContinuation:0:HostGoalEntry",
  "interruptGoalAutomation:0:HostContext", "clearInterruptedGoalAutomation:0:HostContext",
  "persistRalphControllerState:0:HostContext", "reloadSessionState:0:HostContext",
  "finishCronPrompt:2:HostContext", "executeOpenAiUsage:1:HostContext", "executeUsagePair:1:HostContext",
]);
const observedOpaqueCoreArguments = new Set();
for (const method of typedNames) {
  const tuple = coreMethods.match(new RegExp(`^  readonly ${method}: readonly \\[(.*)\\];$`, "m"))?.[1] ?? "";
  const arguments_ = tuple === "" ? [] : tuple.split(",").map((value) => value.trim());
  for (const [index, argument] of arguments_.entries()) {
    if (!schemaBackedCoreArgument.test(argument)) {
      const key = `${method}:${index}:${argument}`;
      if (!auditedOpaqueCoreArguments.has(key)) {
        failures.push(`${method}: core argument ${index} is neither generated nor an audited opaque host value: ${argument}`);
      } else {
        observedOpaqueCoreArguments.add(key);
      }
      continue;
    }
    const moduleName = schemaBackedCoreModules.get(argument)
      ?? argument.match(/\.([A-Za-z0-9_]+)Schema>/)?.[1];
    if (moduleName === undefined || !new RegExp(`^module ${moduleName} : sig$`, "m").test(safeInterface)) {
      failures.push(`${method}: generated core argument decoder is missing: ${moduleName ?? argument}`);
    }
  }
}
for (const key of auditedOpaqueCoreArguments) {
  if (!observedOpaqueCoreArguments.has(key)) failures.push(`${key}: stale opaque core argument audit exception`);
}
const agentTools = readFileSync(join(binRoot.pathname, "agent_tools.ml"), "utf8");
if (!/let agent_owner_context[\s\S]*?AgentOwnerContextFacts\.t_of_js/.test(agentTools)) {
  failures.push("agent owner context wrapper does not use its generated runtime decoder");
}
for (let index = 0; index < runtimeBranches.length; index += 1) {
  const branch = runtimeBranches[index];
  const end = runtimeBranches[index + 1]?.index ?? runtimeDispatcher.length;
  const body = runtimeDispatcher.slice(branch.index, end);
  const tuple = coreMethods.match(new RegExp(`^  readonly ${branch[1]}: readonly \\[(.*)\\];$`, "m"))?.[1] ?? "";
  const arguments_ = tuple === "" ? [] : tuple.split(",").map((value) => value.trim());
  for (const [argumentIndex, argument] of arguments_.entries()) {
    if (argument !== "Static<typeof Core.AgentOwnerContextFactsSchema>") continue;
    if (!body.includes(`Agent_tools.agent_owner_context (arg ${argumentIndex})`)) {
      failures.push(`${branch[1]}: agent owner context bypasses its generated runtime decoder`);
    }
  }
}
const usageBridge = readFileSync(join(binRoot.pathname, "usage_bridge.ml"), "utf8");
if (!/let execute_openai[\s\S]*?OpenAiUsageHostParams\.t_of_js/.test(usageBridge)) {
  failures.push("executeOpenAiUsage bypasses its generated runtime decoder");
}
if (!/let execute_pair[\s\S]*?UsagePairHostParams\.t_of_js/.test(usageBridge)) {
  failures.push("executeUsagePair bypasses its generated runtime decoder");
}
const sandboxBridge = readFileSync(join(binRoot.pathname, "sandbox_bridge.ml"), "utf8");
for (const [handler, decoder] of [
  ["plan_exec_host_call", "PreparedExecInput.t_of_js"],
  ["format_exec_result", "PreparedExecInput.t_of_js"],
  ["format_exec_result", "HostExecResult.t_of_js"],
]) {
  const start = sandboxBridge.indexOf(`let ${handler}`);
  const end = sandboxBridge.indexOf("\nlet ", start + 1);
  if (start < 0 || !sandboxBridge.slice(start, end < 0 ? sandboxBridge.length : end).includes(decoder)) {
    failures.push(`sandbox_bridge.ml:${handler} does not use ${decoder}`);
  }
}
const lifecycleMethodSchemas = {
  recordAgentChildSessionStartAuthorized: "RecordAgentChildSessionStartFactsSchema",
  rollbackUnacceptedAgentStart: "RollbackUnacceptedAgentStartFactsSchema",
  rollbackAgentSendPreflight: "RollbackAgentSendPreflightFactsSchema",
  recordAgentSendDispatchFailure: "RecordAgentSendDispatchFailureFactsSchema",
  rollbackFailedAgentInterruption: "RollbackFailedAgentInterruptionFactsSchema",
  recordAgentDispatchCompletion: "AgentDispatchCompletionFactsSchema",
  recordAgentActivity: "AgentActivityFactsSchema",
  recordAgentDispatchBoundaryAuthorized: "AgentDispatchBoundaryFactsSchema",
  reconcileLiveAgentDispatches: "LiveAgentDispatchesFactsSchema",
  recordAgentBackgroundNotification: "AgentRunIdFactsSchema",
  releaseAgentBackgroundNotification: "AgentRunIdFactsSchema",
  validateAgentBackgroundNotificationClaim: "AgentRunIdFactsSchema",
  finishAgentWait: "FinishAgentWaitFactsSchema",
  finishAgentClose: "AgentIdFactsSchema",
  acceptAgentWorktreeStart: "AgentIdFactsSchema",
  rollbackAgentWorktreeStart: "AgentIdFactsSchema",
  deleteAgentWorktree: "AgentIdFactsSchema",
  cancelAgentBrokerSessions: "AgentIdFactsSchema",
  deleteAgentChildSession: "AgentIdFactsSchema",
  recordAgentCloseCleanupFailure: "AgentIdFactsSchema",
};
for (const [method, schema] of Object.entries(lifecycleMethodSchemas)) {
  if (!new RegExp(`readonly ${method}: readonly \\[Static<typeof Action\\.${schema}>`).test(coreMethods)) {
    failures.push(`${method}: lifecycle CoreBridge argument is not ${schema}`);
  }
}
const agentLifecycle = readFileSync(join(binRoot.pathname, "agent_lifecycle.ml"), "utf8");
if (/\b(?:get_string|optional_string_field|optional_string_array) facts\b|Unsafe\.get facts/.test(agentLifecycle)) {
  failures.push("agent_lifecycle facts bypass generated runtime contracts");
}
for (const handler of [
  "record_child_session_start_authorized", "record_dispatch_boundary_authorized",
]) {
  const body = agentLifecycle.slice(
    agentLifecycle.indexOf(`let ${handler}`),
    agentLifecycle.indexOf("\nlet ", agentLifecycle.indexOf(`let ${handler}`) + 1),
  );
  if (!body.includes("revalidate_transition_result") || !body.includes("complete_transition_result")) {
    failures.push(`${handler}: expected state transition is not capability-bound and atomic`);
  }
}
for (const name of ["agent_close.ml", "agent_worktree_ops.ml"]) {
  const source = readFileSync(join(binRoot.pathname, name), "utf8");
  if (/\bget_string facts\b|Unsafe\.get facts/.test(source)) failures.push(`${name}: lifecycle facts bypass generated runtime contracts`);
}
for (const name of ["agent_lifecycle.ml", "agent_close.ml", "agent_worktree_ops.ml"]) {
  const source = readFileSync(join(binRoot.pathname, name), "utf8");
  const handlers = [...source.matchAll(/^let ([a-z_]+) (?:raw_)?facts ctx =/gm)];
  for (let index = 0; index < handlers.length; index += 1) {
    const body = source.slice(handlers[index].index, handlers[index + 1]?.index ?? source.length);
    const syncAt = body.indexOf("Session_sync.require_agent_owner ctx");
    const decodeAt = [body.indexOf("decode_ojs_contract"), body.indexOf("agent_id_from_facts")]
      .filter((position) => position >= 0).sort((left, right) => left - right)[0] ?? -1;
    if (syncAt >= 0 && (decodeAt < 0 || decodeAt > syncAt)) {
      failures.push(`${name}:${handlers[index][1]} synchronizes authority state before decoding facts`);
    }
  }
}
const lifecycleOcamlDecoders = {
  "agent_lifecycle.ml": {
    record_child_session_start_result: "RecordAgentChildSessionStartFacts.t_of_js",
    rollback_unaccepted_start: "RollbackUnacceptedAgentStartFacts.t_of_js",
    rollback_send_preflight: "RollbackAgentSendPreflightFacts.t_of_js",
    record_send_dispatch_failure: "RecordAgentSendDispatchFailureFacts.t_of_js",
    rollback_failed_interruption: "RollbackFailedAgentInterruptionFacts.t_of_js",
    record_dispatch_completion: "AgentDispatchCompletionFacts.t_of_js",
    record_activity: "AgentActivityFacts.t_of_js",
    record_dispatch_boundary_result: "AgentDispatchBoundaryFacts.t_of_js",
    reconcile_live_dispatches: "LiveAgentDispatchesFacts.t_of_js",
    record_background_notification: "AgentRunIdFacts.t_of_js",
    release_background_notification: "AgentRunIdFacts.t_of_js",
    validate_background_notification_claim: "AgentRunIdFacts.t_of_js",
    finish_wait: "FinishAgentWaitFacts.t_of_js",
  },
  "agent_close.ml": { finish_close: "agent_id_from_facts", delete_child_session: "agent_id_from_facts", record_close_cleanup_failure: "agent_id_from_facts" },
  "agent_worktree_ops.ml": { accept_worktree_start: "agent_id_from_facts", rollback_worktree_start: "agent_id_from_facts", delete_worktree: "agent_id_from_facts" },
};
for (const [name, handlers] of Object.entries(lifecycleOcamlDecoders)) {
  const source = readFileSync(join(binRoot.pathname, name), "utf8");
  const definitions = [...source.matchAll(/^let ([a-z_]+)\b/gm)];
  for (const [handler, decoder] of Object.entries(handlers)) {
    const index = definitions.findIndex((definition) => definition[1] === handler);
    const body = index < 0 ? "" : source.slice(definitions[index].index, definitions[index + 1]?.index ?? source.length);
    if (!body.includes(decoder)) failures.push(`${name}:${handler} does not use ${decoder}`);
  }
}
for (const name of ["agent_close.ml", "agent_worktree_ops.ml"]) {
  const source = readFileSync(join(binRoot.pathname, name), "utf8");
  if (!/let agent_id_from_facts[\s\S]*?AgentIdFacts\.t_of_js/.test(source)) {
    failures.push(`${name}: agent_id_from_facts does not use AgentIdFacts.t_of_js`);
  }
}
const cancelBranch = runtimeDispatcher.slice(
  runtimeDispatcher.indexOf('| "cancelAgentBrokerSessions"'),
  runtimeDispatcher.indexOf('| "deleteAgentChildSession"'),
);
if (!cancelBranch.includes("AgentIdFacts.t_of_js")) failures.push("cancelAgentBrokerSessions does not use AgentIdFacts.t_of_js");
const agentActionCapability = readFileSync(join(binRoot.pathname, "agent_action_capability.ml"), "utf8");
if (!/let decode raw_facts =[\s\S]*?AgentActionCapabilityFacts\.t_of_js/.test(agentActionCapability)) {
  failures.push("agent action capability checks do not use AgentActionCapabilityFacts.t_of_js");
}
for (const method of [
  "claimAgentAction", "revalidateAgentAction", "ratchetAgentAction",
  "authorizeAgentActionCleanup", "prepareAgentCloseStop",
  "completeAgentCloseStop", "releaseAgentAction",
]) {
  if (!new RegExp(`readonly ${method}: readonly \\[Core\\.AgentActionCapabilityFacts\\]`).test(coreMethods)) {
    failures.push(`${method}: CoreBridge argument is not AgentActionCapabilityFacts`);
  }
}
const authorityPlans = readFileSync(join(binRoot.pathname, "authority_plans.ml"), "utf8");
if (!/let authorize_agent_cleanup[\s\S]*?validate_agent_action[\s\S]*?Agent_claimed/.test(authorityPlans)) {
  failures.push("agent cleanup authorization bypasses full claimed-capability validation");
}
if (!/let claim_agent_action[\s\S]*?Agent_state_epochs\.advance[\s\S]*?entry\.state_epoch/.test(authorityPlans)) {
  failures.push("claim transition does not advance and ratchet the agent-state epoch");
}
const agentOrchestration = readFileSync(join(root.pathname, "agent-orchestration.ts"), "utf8");
if (!/performCapabilityEffect\(\(\) =>[\s\S]{0,100}core\.call\(\s*"acceptAgentWorktreeStart"/.test(agentOrchestration)) {
  failures.push("post-dispatch worktree acceptance does not fully revalidate its agent capability");
}
if (/authorizeCapabilityCleanup\(\);[\s\S]{0,160}return preparedToolResult/.test(agentOrchestration)) {
  failures.push("cleanup-only capability authorization controls a successful forward result");
}
for (const name of readdirSync(binRoot.pathname).filter((entry) => entry.endsWith(".ml") && entry !== "app_state.ml")) {
  const source = readFileSync(join(binRoot.pathname, name), "utf8");
  if (/\bagent_state\s*:=/.test(source)) {
    failures.push(`${name}: agent authority state transition bypasses App_state.set_agent_state`);
  }
}
const requiredAuthorityInterfaces = [
  ["bin/authority_plans.mli", /type exec_state|type exec_entry|type agent_action_entry/],
  ["lib/capability_profile.mli", /type t = private \{/],
  ["lib/permissions.mli", /type state = private \{/],
  ["lib/sandbox.mli", /type config = private \{/],
];
for (const [path, expectedOrForbidden] of requiredAuthorityInterfaces) {
  const source = readFileSync(join(projectRoot.pathname, path), "utf8");
  if (path === "bin/authority_plans.mli" ? expectedOrForbidden.test(source) : !expectedOrForbidden.test(source)) {
    failures.push(`${path}: authority representation is not appropriately hidden`);
  }
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
