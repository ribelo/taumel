import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type EventHandler = (event: unknown, ctx?: unknown) => unknown;
type InternalHandler = (payload: unknown) => unknown;
type Unsubscribe = () => void;

type HostExecResult = {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

type HostExecOptions = {
  readonly cwd?: string;
  readonly timeout?: number;
};

type ExtensionHost = {
  readonly on: (event: string, handler: EventHandler) => void;
  readonly eventsOn: (event: string, handler: InternalHandler) => Unsubscribe;
  readonly emit: (event: string, payload: unknown) => void;
  readonly exec: (
    command: string,
    args: readonly string[],
    options: HostExecOptions,
  ) => Promise<HostExecResult>;
  readonly setFooter: (ctx: unknown, factory: unknown) => void;
  readonly sessionSnapshot: (ctx: unknown) => {
    readonly cwd: string;
    readonly provider: string;
    readonly model: string;
    readonly thinking: string;
    readonly totalCost: number;
    readonly contextPercent: number;
    readonly contextWindow: number;
  };
  readonly getGitBranch: (footerData: unknown) => string;
  readonly onBranchChange: (footerData: unknown, handler: () => void) => Unsubscribe;
  readonly requestRender: (tui: unknown) => void;
  readonly themeFg: (theme: unknown, color: string, value: string) => string;
};

type PiLike = {
  readonly on: (event: string, handler: EventHandler) => void;
  readonly events: {
    readonly on: (event: string, handler: InternalHandler) => Unsubscribe;
    readonly emit: (event: string, payload: unknown) => void;
  };
  readonly exec: (
    command: string,
    args: readonly string[],
    options: HostExecOptions,
  ) => Promise<HostExecResult>;
  readonly getThinkingLevel?: () => string | null | undefined;
};

type TaumelFooterGlobal = {
  readonly taumelFooter?: {
    readonly init?: (host: ExtensionHost) => void;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumberOrSentinel(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function computeTotalCost(ctx: unknown): number {
  if (!isRecord(ctx)) return 0;
  const sessionManager = ctx["sessionManager"];
  if (!isRecord(sessionManager)) return 0;
  const getBranch = sessionManager["getBranch"];
  if (typeof getBranch !== "function") return 0;

  let branch: unknown;
  try {
    branch = getBranch.call(sessionManager);
  } catch {
    return 0;
  }
  if (!Array.isArray(branch)) return 0;

  let totalCost = 0;
  for (const entry of branch) {
    if (!isRecord(entry) || entry["type"] !== "message") continue;
    const message = entry["message"];
    if (!isRecord(message) || message["role"] !== "assistant") continue;
    const usage = message["usage"];
    if (!isRecord(usage)) continue;
    const cost = usage["cost"];
    if (!isRecord(cost)) continue;
    const total = cost["total"];
    if (typeof total === "number" && Number.isFinite(total)) {
      totalCost += total;
    }
  }
  return totalCost;
}

function makeHost(pi: PiLike): ExtensionHost {
  return {
    on: (event, handler) => {
      pi.on(event, handler);
    },
    eventsOn: (event, handler) => pi.events.on(event, handler),
    emit: (event, payload) => {
      pi.events.emit(event, payload);
    },
    exec: (command, args, options) => pi.exec(command, args, options),
    setFooter: (ctx, factory) => {
      if (!isRecord(ctx)) return;
      const ui = ctx["ui"];
      if (!isRecord(ui)) return;
      const setFooter = ui["setFooter"];
      if (typeof setFooter !== "function") return;
      setFooter.call(ui, factory);
    },
    sessionSnapshot: (ctx) => {
      const record = isRecord(ctx) ? ctx : {};
      const modelRecord = isRecord(record["model"]) ? record["model"] : {};
      const getContextUsage = record["getContextUsage"];
      const usage =
        typeof getContextUsage === "function" ? getContextUsage.call(record) : undefined;
      const usageRecord = isRecord(usage) ? usage : {};
      return {
        cwd: typeof record["cwd"] === "string" ? record["cwd"] : process.cwd(),
        provider:
          typeof modelRecord["provider"] === "string" ? modelRecord["provider"] : "",
        model: typeof modelRecord["id"] === "string" ? modelRecord["id"] : "no-model",
        thinking: pi.getThinkingLevel?.() ?? "off",
        totalCost: computeTotalCost(ctx),
        contextPercent: finiteNumberOrSentinel(usageRecord["percent"]),
        contextWindow: finiteNumberOrSentinel(usageRecord["contextWindow"]),
      };
    },
    getGitBranch: (footerData) => {
      if (!isRecord(footerData)) return "";
      const getGitBranch = footerData["getGitBranch"];
      if (typeof getGitBranch !== "function") return "";
      const branch = getGitBranch.call(footerData);
      return typeof branch === "string" ? branch : "";
    },
    onBranchChange: (footerData, handler) => {
      if (!isRecord(footerData)) return () => undefined;
      const onBranchChange = footerData["onBranchChange"];
      if (typeof onBranchChange !== "function") return () => undefined;
      const unsubscribe = onBranchChange.call(footerData, handler);
      return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
    },
    requestRender: (tui) => {
      if (!isRecord(tui)) return;
      const requestRender = tui["requestRender"];
      if (typeof requestRender === "function") requestRender.call(tui);
    },
    themeFg: (theme, color, value) => {
      if (!isRecord(theme)) return value;
      const fg = theme["fg"];
      if (typeof fg !== "function") return value;
      const rendered = fg.call(theme, color, value);
      return typeof rendered === "string" ? rendered : value;
    },
  };
}

export default async function taumel(pi: PiLike) {
  const artifact = new URL("../dist/taumel_footer.cjs", import.meta.url);
  const require = createRequire(import.meta.url);
  require(fileURLToPath(artifact));

  const footer = (globalThis as typeof globalThis & TaumelFooterGlobal).taumelFooter;
  if (footer?.init === undefined) {
    throw new Error(
      "taumel footer artifact did not export globalThis.taumelFooter.init; run `npm run build:ocaml`",
    );
  }

  footer.init(makeHost(pi));
}
