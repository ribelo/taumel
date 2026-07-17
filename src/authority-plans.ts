import type { CoreBridge } from "./types.ts";
import {
  decodeBridgeToolExecutionResult,
  decodeCoreAck,
  type PreparedToolAction,
} from "./bridge-contracts.ts";
import { errorToolResult, preparedToolResult } from "./tool-results.ts";

type PreparedSuccess = Exclude<PreparedToolAction, { ok: false }>;
type PreparedExaAction = Extract<PreparedSuccess, {
  action: "exa_fetch" | "exa_agent_create_run_approval";
}>;

export async function executeExaInCore(
  core: CoreBridge,
  prepared: PreparedExaAction,
  ctx: unknown,
) {
  const rendered = decodeBridgeToolExecutionResult(await core.call("executeExa", [{
    planId: prepared.planId,
    ctx,
  }]));
  if (!rendered.ok) return errorToolResult(core, rendered.error, { ...rendered });
  return preparedToolResult(core, { ...rendered });
}

export function approveExaPlan(
  core: CoreBridge,
  prepared: PreparedExaAction,
  ctx: unknown,
): void {
  decodeCoreAck(core.call("approveExaPlan", [{ planId: prepared.planId, ctx }]));
}

export async function executeApprovedExaInCore(
  core: CoreBridge,
  prepared: PreparedExaAction,
  ctx: unknown,
) {
  approveExaPlan(core, prepared, ctx);
  return executeExaInCore(core, prepared, ctx);
}

export function authorityPlanId(prepared: PreparedSuccess): string | undefined {
  return "planId" in prepared && typeof prepared.planId === "string" ? prepared.planId : undefined;
}

export function discardPreparedAuthorityPlan(
  core: CoreBridge,
  prepared: PreparedSuccess,
  ctx: unknown,
): void {
  const planId = authorityPlanId(prepared);
  if (planId === undefined) return;
  try {
    decodeCoreAck(core.call("discardAuthorityPlan", [{ planId, ctx }]));
  } catch {
    // Execution may already have atomically consumed the plan.
  }
}
