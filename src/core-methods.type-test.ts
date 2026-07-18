import type { CoreBridge } from "./core-methods.ts";

declare const core: CoreBridge;
declare const acceptString: (value: string) => void;

// @ts-expect-error unknown core methods are not representable
core.call("notACoreMethod", []);
// @ts-expect-error method arity is part of the bridge type
core.call("recordAgentActivity", []);
// @ts-expect-error lifecycle facts reject unknown activity variants statically
core.call("recordAgentActivity", [{ run_id: "run", submission_id: "submission", event: "future_event" }, { ctx: {} }]);
// @ts-expect-error start capabilities always bind their run and submission
core.call("claimAgentAction", [{ capabilityId: "cap", agentId: "agent", action: "agent_start", ctx: {} }]);
// @ts-expect-error close capabilities cannot carry run/submission authority
core.call("claimAgentAction", [{ capabilityId: "cap", agentId: "agent", action: "agent_close", runId: "run", ctx: {} }]);
const invalidCloseCapability = { capabilityId: "cap", agentId: "agent", action: "agent_close" as const, runId: "run", ctx: {} };
// @ts-expect-error forbidden authority fields remain rejected through variables
core.call("claimAgentAction", [invalidCloseCapability]);
const invalidSendCapability = { capabilityId: "cap", agentId: "agent", action: "agent_send" as const, submissionId: "submission", ctx: {} };
// @ts-expect-error submission authority requires run authority
core.call("claimAgentAction", [invalidSendCapability]);
// @ts-expect-error host tool result actions are closed
core.call("hostToolResult", [{ action: "exec_command", details: {} }]);
// @ts-expect-error tool-result construction selects exactly one branch
core.call("toolResultEnvelope", [{ error: "failed", text: "also text" }]);
// @ts-expect-error bridge results remain untrusted until runtime-decoded
acceptString(core.call("toolPolicyNames", []));
