import type { CoreBridge } from "./types.ts";
import { decodePreparedToolAction, decodeToolResultEnvelope, type PreparedToolAction, type ToolResultEnvelope } from "./bridge-contracts.ts";

type PreparedTextResult = { readonly text: string; readonly details: unknown };

export function preparedToolResult(core: CoreBridge, prepared: PreparedTextResult) {
  return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{ prepared, extraDetails: {} }]));
}

export function errorToolResult(core: CoreBridge, text: string, details: unknown = undefined) {
  return decodeToolResultEnvelope(core.call("toolResultEnvelope", [{
    error: text,
    ...(details !== undefined ? { details } : {}),
  }]));
}

export function agentErrorToolResult(core: CoreBridge, code: string, message: string) {
  const payload = { ok: false, error: { code, message } };
  return errorToolResult(core, JSON.stringify(payload), payload);
}

export function hostToolResult(core: CoreBridge, action: "write_stdin" | "apply_patch" | "write" | "edit", details: unknown): ToolResultEnvelope {
  return decodeToolResultEnvelope(core.call("hostToolResult", [{ action, details }]));
}

export function preparedAction(core: CoreBridge, name: string, params: unknown, ctx: unknown): PreparedToolAction {
  return decodePreparedToolAction(core.call("prepareTool", [{ name, params, ctx }]));
}
