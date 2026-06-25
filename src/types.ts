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
  readonly parameters: Record<string, unknown>;
  readonly execute: (...args: unknown[]) => Promise<unknown>;
  readonly renderCall?: (...args: unknown[]) => unknown;
  readonly renderResult?: (...args: unknown[]) => unknown;
};

export type CommandDefinition = {
  readonly description: string;
  readonly handler: (args: string, ctx: unknown) => unknown | Promise<unknown>;
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
  readonly getFlag?: (name: string) => unknown;
  readonly getAllTools?: () => readonly unknown[];
  readonly getActiveTools?: () => readonly string[];
  readonly setActiveTools?: (toolNames: string[]) => void;
  readonly registerTool?: (tool: ToolDefinition) => void;
  readonly registerCommand?: (name: string, command: CommandDefinition) => void;
  readonly writeStdin?: (
    sessionId: number,
    chars: string,
    options?: { readonly yieldTimeMs?: number; readonly maxOutputTokens?: number },
  ) => Promise<unknown>;
  readonly sendUserMessage?: (
    content: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  readonly sendMessage?: (
    message: {
      readonly customType: string;
      readonly content: string;
      readonly display?: boolean;
      readonly details?: unknown;
    },
    options?: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  readonly modelRegistry?: unknown;
  readonly createAgentSession?: (options?: Record<string, unknown>) => Promise<{ readonly session?: unknown }>;
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
  readonly sendUserMessage?: (content: string, options?: Record<string, unknown>) => Promise<unknown>;
  readonly stop?: (reason: string) => Promise<void>;
  readonly close?: (reason: string) => Promise<void>;
};

export type ComposerController = {
  readonly path: string;
  settings: {
    readonly composer: {
      readonly enabled: boolean;
    };
    readonly taumel: {
      readonly agents: {
        readonly builtins: Record<string, unknown>;
      };
    };
  };
  latestTui?: unknown;
};

export type CoreBridge = {
  readonly init: (host: ExtensionHost) => void;
  readonly call: (name: string, args?: readonly unknown[]) => unknown;
};

export type TaumelGlobal = {
  readonly taumel?: CoreBridge;
};
