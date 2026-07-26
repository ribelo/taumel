import type { ExtensionHost, PiLike } from "./types.ts";
import { objectLikeValue, resolveAuthorizationPath, stringFlag } from "./util.ts";

type HostUi = { setFooter?: (factory: unknown) => unknown };
type HostModel = { provider?: unknown; id?: unknown };
type ContextUsage = { percent?: unknown; contextWindow?: unknown };
type HostContext = {
  ui?: unknown; model?: unknown; cwd?: unknown;
  getContextUsage?: () => unknown;
};
type FooterData = {
  getGitBranch?: () => unknown;
  onBranchChange?: (handler: () => void) => unknown;
};
type RenderTarget = { requestRender?: () => unknown };
type HostTheme = { fg?: (color: string, value: string) => unknown };

export function makeHost(pi: PiLike): ExtensionHost {
  return {
    isExtensionActive: () => {
      try {
        pi.getThinkingLevel?.();
        return true;
      } catch {
        return false;
      }
    },
    resolveAuthorizationPath,
    on: (event, handler) => {
      pi.on(event, handler);
    },
    eventsOn: (event, handler) => pi.events.on(event, handler),
    emit: (event, payload) => {
      pi.events.emit(event, payload);
    },
    exec: (command, args, options) => pi.exec(command, args, options),
    setFooter: (ctx, factory) => {
      const context = objectLikeValue<HostContext>(ctx);
      const ui = objectLikeValue<HostUi>(context?.ui);
      const setFooter = ui?.setFooter;
      if (typeof setFooter !== "function") return;
      setFooter.call(ui, factory);
    },
    sessionSnapshot: (ctx) => {
      const context = objectLikeValue<HostContext>(ctx);
      const model = objectLikeValue<HostModel>(context?.model);
      const getContextUsage = context?.getContextUsage;
      const usage =
        typeof getContextUsage === "function" ? getContextUsage.call(ctx) : undefined;
      const usageRecord = objectLikeValue<ContextUsage>(usage);
      const noSandboxFlag = typeof pi.getFlag === "function" ? pi.getFlag("no-sandbox") : undefined;
      const thinking = pi.getThinkingLevel?.();
      return {
        cwd: typeof context?.cwd === "string" ? context.cwd : process.cwd(),
        provider:
          typeof model?.provider === "string" ? model.provider : "",
        ...(typeof model?.id === "string" ? { model: model.id } : {}),
        ...(typeof thinking === "string" ? { thinking } : {}),
        ...(usageRecord?.percent !== undefined ? { contextPercent: usageRecord.percent } : {}),
        ...(usageRecord?.contextWindow !== undefined ? { contextWindow: usageRecord.contextWindow } : {}),
        sandboxMode: stringFlag(pi, "sandbox-mode") ?? "",
        networkMode: stringFlag(pi, "network-mode") ?? "",
        ...(noSandboxFlag !== undefined && noSandboxFlag !== null ? { noSandboxFlag: String(noSandboxFlag) } : {}),
      };
    },
    getGitBranch: (footerData) => {
      const getGitBranch = objectLikeValue<FooterData>(footerData)?.getGitBranch;
      if (typeof getGitBranch !== "function") return "";
      const branch = getGitBranch.call(footerData);
      return typeof branch === "string" ? branch : "";
    },
    onBranchChange: (footerData, handler) => {
      const onBranchChange = objectLikeValue<FooterData>(footerData)?.onBranchChange;
      if (typeof onBranchChange !== "function") return () => undefined;
      const unsubscribe = onBranchChange.call(footerData, handler);
      return typeof unsubscribe === "function" ? () => { unsubscribe(); } : () => undefined;
    },
    requestRender: (tui) => {
      const requestRender = objectLikeValue<RenderTarget>(tui)?.requestRender;
      if (typeof requestRender === "function") requestRender.call(tui);
    },
    themeFg: (theme, color, value) => {
      const fg = objectLikeValue<HostTheme>(theme)?.fg;
      if (typeof fg !== "function") return value;
      const rendered = fg.call(theme, color, value);
      return typeof rendered === "string" ? rendered : value;
    },
  };
}
