import type { CoreBridge } from "./core-methods.ts";
export type { CoreBridge } from "./core-methods.ts";

export type EventHandler = (event: unknown, ctx?: unknown) => unknown;
export type InternalHandler = (payload: unknown) => unknown;
export type Unsubscribe = () => void;

export type HostExecResult = {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

export type HostExecOptions = {
  readonly cwd?: string;
  readonly timeout?: number;
  readonly yieldTimeMs?: number;
  readonly maxOutputTokens?: number;
  readonly tty?: boolean;
};

export type ExtensionHost = {
  readonly resolveAuthorizationPath: (path: string) => string;
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
    readonly model?: string;
    readonly thinking?: string;
    readonly totalCost?: number;
    readonly contextPercent?: unknown;
    readonly contextWindow?: unknown;
    readonly sandboxMode?: string;
    readonly networkMode?: string;
    readonly noSandboxFlag?: string;
  };
  readonly getGitBranch: (footerData: unknown) => string;
  readonly onBranchChange: (footerData: unknown, handler: () => void) => Unsubscribe;
  readonly requestRender: (tui: unknown) => void;
  readonly themeFg: (theme: unknown, color: string, value: string) => string;
};

export type ToolDefinition = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines?: readonly string[];
  readonly parameters: unknown;
  readonly execute: (...args: unknown[]) => Promise<unknown>;
  readonly renderCall?: (...args: unknown[]) => unknown;
  readonly renderResult?: (...args: unknown[]) => unknown;
  readonly renderShell?: "default" | "self";
};

export type MessageDeliveryOptions = {
  readonly triggerTurn?: boolean;
  readonly deliverAs?: string;
  readonly onEvent?: (event: unknown) => void;
};

export type AgentSessionOptions = {
  readonly cwd?: string;
  readonly sessionManager?: unknown;
  readonly model?: unknown;
  readonly thinkingLevel?: string;
  readonly tools?: readonly string[];
};

export type CommandDefinition = {
  readonly description: string;
  readonly handler: (args: string, ctx: unknown) => unknown | Promise<unknown>;
};

export type ShortcutDefinition = {
  readonly description: string;
  readonly handler: (ctx: unknown) => unknown | Promise<unknown>;
};

export type PiLike = {
  readonly on: (event: string, handler: EventHandler) => void;
  readonly subscribe?: (handler: EventHandler) => Unsubscribe;
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
  readonly setThinkingLevel?: (level: string) => void;
  readonly getFlag?: (name: string) => unknown;
  readonly getAllTools?: () => readonly unknown[];
  readonly getActiveTools?: () => readonly string[];
  readonly setActiveTools?: (toolNames: string[]) => void;
  readonly registerTool?: (tool: ToolDefinition) => void;
  readonly registerMessageRenderer?: (
    customType: string,
    renderer: (message: unknown, options: unknown, theme: unknown) => unknown,
    options?: { readonly background?: "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" },
  ) => void;
  readonly registerCommand?: (name: string, command: CommandDefinition) => void;
  readonly registerShortcut?: (shortcut: string, shortcutDefinition: ShortcutDefinition) => void;
  readonly writeStdin?: (
    sessionId: number,
    chars: string,
    options?: { readonly yieldTimeMs?: number; readonly maxOutputTokens?: number },
  ) => Promise<unknown>;
  readonly sendUserMessage?: (
    content: string,
    options?: MessageDeliveryOptions,
  ) => Promise<unknown> | unknown;
  readonly sendMessage?: (
    message: {
      readonly customType: string;
      readonly content: string;
      readonly display?: boolean;
      readonly details?: unknown;
    },
    options?: MessageDeliveryOptions,
  ) => Promise<unknown> | unknown;
  readonly modelRegistry?: unknown;
  readonly isIdle?: () => boolean;
  readonly createAgentSession?: (options?: AgentSessionOptions) => Promise<{ readonly session?: unknown }>;
};

export type SessionInfo = {
  readonly sessionId?: string;
  readonly sessionFile?: string;
};

export type ChildSessionBridge = SessionInfo & {
  readonly ctx?: unknown;
  readonly session?: unknown;
  readonly sessionManager?: unknown;
  readonly cancelled?: boolean;
  readonly error?: string;
  readonly missingSessionIdentifier?: boolean;
  readonly activeTools?: readonly string[];
  readonly activeToolsApplied?: boolean;
  readonly modelId?: string;
  readonly modelApplied?: boolean;
  readonly thinkingLevel?: string;
  readonly thinkingApplied?: boolean;
  readonly sendUserMessage?: (content: string, options?: MessageDeliveryOptions) => Promise<unknown>;
  readonly stop?: (reason: string) => Promise<void>;
  readonly close?: (reason: string, authorizeCleanup?: () => void) => Promise<void>;
};

export type ComposerController = {
  readonly path: string;
  settings: {
    readonly taumel: {
      readonly composer: {
        readonly enabled: boolean;
      };
    };
  };
  latestTui?: unknown;
  latestCwd?: string;
  skillEntries?: () => readonly { readonly name: string; readonly description?: string; readonly location?: string }[];
};

export type CoreBootstrap = {
  readonly init: (host: ExtensionHost) => CoreBridge;
};

export type TaumelGlobal = {
  readonly taumel?: CoreBootstrap;
};
