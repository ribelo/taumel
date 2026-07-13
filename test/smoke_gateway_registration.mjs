import { executeTool, registerGatewayTools } from "../src/tool-executor.ts";
import { toolNames } from "../src/tool-contracts.ts";

const registered = [];
const renderers = [];
const handlers = new Map();
const pi = {
  registerTool: (tool) => registered.push(tool.name),
  registerMessageRenderer: (name) => renderers.push(name),
  on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
};
const core = {
  call(method) {
    if (method === "toolPolicyNames") return { names: [...toolNames] };
    if (method === "allowedToolNames") return { names: ["read"] };
    throw new Error(`unexpected core call: ${method}`);
  },
};

registerGatewayTools(pi, core, new Map());

if (JSON.stringify(registered) !== JSON.stringify(["read"])) {
  throw new Error(`gateway registration ignored OCaml exposure policy: ${JSON.stringify(registered)}`);
}
if (!renderers.includes("notification")) {
  throw new Error("notification renderer was not registered");
}
if (!renderers.includes("taumel.goal.continue")) {
  throw new Error("goal continuation renderer was not registered");
}
for (const event of ["session_start", "session_resume", "session_switch", "session_shutdown", "turn_end", "agent_end"]) {
  if ((handlers.get(event) ?? []).length === 0) throw new Error(`missing gateway lifecycle handler: ${event}`);
}

const parentCtx = {
  sessionManager: { getSessionId: () => "parent-a", getEntries: () => [] },
};
const childCtx = {
  sessionManager: {
    getSessionId: () => "child-a",
    getEntries: () => [{
      type: "custom",
      customType: "taumel.childSession",
      data: { kind: "ralph", isolated_child: true, parentSessionId: "parent-a" },
    }],
  },
  ui: { confirm: async () => true },
};
for (const handler of handlers.get("session_start") ?? []) handler({}, parentCtx);
for (const handler of handlers.get("session_switch") ?? []) handler({}, childCtx);

let promptPlans = 0;
const ownershipCore = {
  call(method) {
    if (method === "prepareTool") return {
      ok: true,
      action: "exec_command_approval",
      cmd: "echo test",
      workdir: "/tmp",
      tty: false,
      sandbox: { filesystemMode: "workspace-write", networkMode: "disabled", workspaceRoots: ["/tmp"], noSandbox: false, isolatedChild: true },
      approvalMessage: "approval required",
      approvalTitle: "Approve",
      approvalPrompt: "Run command?",
      approvalTimeoutMs: 0,
    };
    if (method === "planExecApprovalPrompt") {
      promptPlans += 1;
      return { kind: "confirm", title: "Approve", prompt: "Run command?" };
    }
    if (method === "finishExecApproval") return {
      kind: "denied",
      result: { content: [{ type: "text", text: "owner unavailable" }], details: {} },
    };
    throw new Error(`unexpected ownership core call: ${method}`);
  },
};
await executeTool(pi, ownershipCore, new Map(), "exec_command", { cmd: "echo test" }, childCtx);
if (promptPlans !== 0) {
  throw new Error("switching into an isolated child retained stale parent approval ownership");
}
