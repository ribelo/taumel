export type ApprovalOutcome =
  | "approved"
  | "approved_always"
  | "denied_by_user"
  | "timed_out"
  | "unavailable"
  | "interrupted";
export type ApprovalResolution = ApprovalOutcome | "replan";

export type ApprovalUi = {
  readonly confirm: (...args: unknown[]) => Promise<unknown>;
  readonly select?: (...args: unknown[]) => Promise<unknown>;
};

type HarnessBinding = { readonly ownerSessionId: string; readonly ui: ApprovalUi };
type ApprovalRequest = {
  readonly ownerSessionId: string;
  readonly origin: "top-level" | "agent";
  readonly agentId?: string;
  readonly run: (ui: ApprovalUi, signal: AbortSignal) => Promise<ApprovalOutcome>;
  readonly commit?: (outcome: ApprovalOutcome) => Promise<void>;
  readonly validate: () => boolean;
  readonly resolve: (outcome: ApprovalResolution) => void;
  readonly reject: (error: unknown) => void;
  readonly controller: AbortController;
  readonly sourceSignal?: AbortSignal;
  abortListener?: () => void;
  settled?: boolean;
};

let binding: HarnessBinding | undefined;
let active: ApprovalRequest | undefined;
const topLevelQueue: ApprovalRequest[] = [];
const agentQueue: ApprovalRequest[] = [];

function removeQueued(request: ApprovalRequest): boolean {
  const queue = request.origin === "top-level" ? topLevelQueue : agentQueue;
  const index = queue.indexOf(request);
  if (index < 0) return false;
  queue.splice(index, 1);
  return true;
}

function settle(request: ApprovalRequest, outcome: ApprovalResolution): void {
  if (request.settled === true) return;
  request.settled = true;
  if (request.abortListener !== undefined) {
    request.sourceSignal?.removeEventListener("abort", request.abortListener);
  }
  request.resolve(outcome);
}

function fail(request: ApprovalRequest, error: unknown): void {
  if (request.settled === true) return;
  request.settled = true;
  if (request.abortListener !== undefined) {
    request.sourceSignal?.removeEventListener("abort", request.abortListener);
  }
  request.reject(error);
}

function settleQueued(outcome: ApprovalOutcome): void {
  for (const queue of [topLevelQueue, agentQueue]) {
    for (const request of queue.splice(0)) settle(request, outcome);
  }
}

function drain(): void {
  if (active !== undefined || binding === undefined) return;
  const request = topLevelQueue.shift() ?? agentQueue.shift();
  if (request === undefined) return;
  if (request.ownerSessionId !== binding.ownerSessionId) {
    settle(request, "unavailable");
    drain();
    return;
  }
  if (!request.validate()) {
    settle(request, "replan");
    drain();
    return;
  }
  active = request;
  void (async () => {
    let outcome: ApprovalOutcome;
    try {
      outcome = await request.run(binding!.ui, request.controller.signal);
    } catch (error) {
      if (active === request) active = undefined;
      fail(request, error);
      drain();
      return;
    }
    if (active !== request) return;
    if ((outcome === "approved" || outcome === "approved_always") && !request.validate()) {
      active = undefined;
      settle(request, "replan");
      drain();
      return;
    }
    if ((outcome === "approved" || outcome === "approved_always") && request.commit !== undefined) {
      try {
        await request.commit(outcome);
      } catch (error) {
        if (active === request) active = undefined;
        fail(request, error);
        drain();
        return;
      }
    }
    if (active !== request) return;
    active = undefined;
    settle(request, outcome);
    drain();
  })();
}

export function bindHarnessApprovalUi(ownerSessionId: string | undefined, hasUi: boolean, rawUi: unknown): void {
  if (ownerSessionId === undefined || !hasUi || typeof rawUi !== "object" || rawUi === null) {
    clearHarnessApprovalUi();
    return;
  }
  const ui = rawUi as Partial<ApprovalUi>;
  if (typeof ui.confirm !== "function") {
    clearHarnessApprovalUi();
    return;
  }
  if (binding !== undefined && binding.ownerSessionId !== ownerSessionId) clearHarnessApprovalUi();
  binding = { ownerSessionId, ui: ui as ApprovalUi };
  drain();
}

export function clearHarnessApprovalUi(ownerSessionId?: string): void {
  if (ownerSessionId !== undefined && binding?.ownerSessionId !== ownerSessionId) return;
  binding = undefined;
  settleQueued("unavailable");
  if (active !== undefined) {
    const request = active;
    active = undefined;
    request.controller.abort();
    settle(request, "unavailable");
  }
}

export function requestHarnessApproval(options: {
  readonly ownerSessionId: string | undefined;
  readonly origin: "top-level" | "agent";
  readonly agentId?: string;
  readonly signal?: AbortSignal;
  readonly validate?: () => boolean;
  readonly run: (ui: ApprovalUi, signal: AbortSignal) => Promise<ApprovalOutcome>;
  readonly commit?: (outcome: ApprovalOutcome) => Promise<void>;
}): Promise<ApprovalResolution> {
  const ownerSessionId = options.ownerSessionId;
  if (ownerSessionId === undefined || binding?.ownerSessionId !== ownerSessionId) {
    return Promise.resolve("unavailable");
  }
  if (options.signal?.aborted === true) return Promise.resolve("interrupted");
  return new Promise((resolve, reject) => {
    const request: ApprovalRequest = {
      ownerSessionId,
      origin: options.origin,
      agentId: options.agentId,
      run: options.run,
      commit: options.commit,
      validate: options.validate ?? (() => true),
      resolve,
      reject,
      controller: new AbortController(),
      sourceSignal: options.signal,
    };
    const abort = () => {
      if (removeQueued(request)) {
        settle(request, "interrupted");
        return;
      }
      if (active === request) {
        active = undefined;
        request.controller.abort();
        settle(request, "interrupted");
        drain();
      }
    };
    request.abortListener = abort;
    options.signal?.addEventListener("abort", abort, { once: true });
    (options.origin === "top-level" ? topLevelQueue : agentQueue).push(request);
    drain();
  });
}

export function cancelAgentApprovals(ownerSessionId: string | undefined, agentId: string): void {
  if (ownerSessionId === undefined || agentId === "") return;
  for (const queue of [topLevelQueue, agentQueue]) {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const request = queue[index];
      if (request.ownerSessionId !== ownerSessionId || request.agentId !== agentId) continue;
      queue.splice(index, 1);
      settle(request, "interrupted");
    }
  }
  if (active?.ownerSessionId === ownerSessionId && active.agentId === agentId) {
    const request = active;
    active = undefined;
    request.controller.abort();
    settle(request, "interrupted");
    drain();
  }
}
