import type { CoreBridge } from "./types.ts";
import { coreCallRecord } from "./util.ts";

export function preparedToolResult(core: CoreBridge, prepared: Record<string, unknown>, extraDetails: Record<string, unknown> = {}) {
  return coreCallRecord(core, "toolResultEnvelope", [{ prepared, extraDetails }], "prepared tool result envelope");
}

export function errorToolResult(core: CoreBridge, text: string, details: unknown = undefined) {
  return coreCallRecord(core, "toolResultEnvelope", [{
    error: text,
    ...(details !== undefined ? { details } : {}),
  }], "error tool result envelope");
}

export function hostToolResult(core: CoreBridge, action: string, details: unknown): Record<string, unknown> {
  return coreCallRecord(core, "hostToolResult", [{ action, details }], "host tool result");
}

export function preparedAction(core: CoreBridge, name: string, params: unknown, ctx: unknown) {
  return coreCallRecord(core, "prepareTool", [name, params, ctx], "tool preparation result");
}
