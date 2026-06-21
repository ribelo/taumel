import type { ExtensionHost, PiLike } from "./types.ts";
import { isRecord, stringFlag } from "./util.ts";

export function makeHost(pi: PiLike): ExtensionHost {
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
      const noSandboxFlag = typeof pi.getFlag === "function" ? pi.getFlag("no-sandbox") : undefined;
      const thinking = pi.getThinkingLevel?.();
      return {
        cwd: typeof record["cwd"] === "string" ? record["cwd"] : process.cwd(),
        provider:
          typeof modelRecord["provider"] === "string" ? modelRecord["provider"] : "",
        ...(typeof modelRecord["id"] === "string" ? { model: modelRecord["id"] } : {}),
        ...(typeof thinking === "string" ? { thinking } : {}),
        ...(usageRecord["percent"] !== undefined ? { contextPercent: usageRecord["percent"] } : {}),
        ...(usageRecord["contextWindow"] !== undefined ? { contextWindow: usageRecord["contextWindow"] } : {}),
        sandboxMode: stringFlag(pi, "sandbox-mode") ?? "",
        networkMode: stringFlag(pi, "network-mode") ?? "",
        ...(noSandboxFlag !== undefined && noSandboxFlag !== null ? { noSandboxFlag: String(noSandboxFlag) } : {}),
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
