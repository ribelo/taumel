import Type, { type TSchema } from "typebox";
import type { AgentToolContract, ToolParamsRefinement } from "./tool-contract-model.ts";
import { toolInput } from "./tool-contract-model.ts";

export const AgentTierSchema = Type.Union(
  [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
  { description: "The generic agent's capacity tier. Defaults to medium." },
);

export const AgentIsolationSchema = Type.Union(
  [Type.Literal("none"), Type.Literal("worktree")],
  {
    description:
      "Workspace isolation for the new identity: none (default) uses the bound parent workspace; worktree creates a dedicated Git worktree.",
  },
);

export const AgentSpawnParamsSchema = Type.Object(
  {
    message: Type.String({
      minLength: 1,
      description:
        "The agent's initial instruction. Include the desired outcome, scope, relevant context, constraints, validation, and expected result.",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    tier: Type.Optional(AgentTierSchema),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "AgentSpawnParams", additionalProperties: false },
);

export const FinderParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description:
        "The discovery query. Be specific and include relevant terms, file types, expected content or naming patterns, and clear success criteria.",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "FinderParams", additionalProperties: false },
);

export const OracleParamsSchema = Type.Object(
  {
    message: Type.String({
      minLength: 1,
      description:
        "The Oracle's initial instruction. Include the guidance, decision, or review needed, relevant context and constraints, available evidence, and attempted approaches.",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "OracleParams", additionalProperties: false },
);

const reviewRequestDescription =
  "The review request. Identify the exact changes to review as commit SHAs, a commit range, or explicit paths, and state the expected outcome and any constraints.";

export const CodeReviewerParamsSchema = Type.Object(
  {
    message: Type.String({ minLength: 1, description: reviewRequestDescription }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "CodeReviewerParams", additionalProperties: false },
);

export const CodeQualityReviewerParamsSchema = Type.Object(
  {
    message: Type.String({ minLength: 1, description: reviewRequestDescription }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "CodeQualityReviewerParams", additionalProperties: false },
);

export const AgentSendParamsSchema = Type.Object(
  {
    agent_id: Type.String({
      minLength: 1,
      description:
        "The owner-scoped agent handle returned by agent_spawn, finder, oracle, code_reviewer, code_quality_reviewer, or agent_list.",
    }),
    message: Type.Optional(Type.String({
      description:
        "The instruction to start idle work, steer active work, resume suspended work, or replace interrupted work. Omit only to interrupt without replacement.",
    })),
    description: Type.Optional(Type.String({
      minLength: 1,
      description:
        "A required three-to-five-word user-facing label for the message, used in compact TUI display and not sent to the child.",
    })),
    interrupt: Type.Optional(Type.Boolean({
      description:
        "When true, interrupt active work before sending a message, suspend active work when message is omitted, and have no additional effect when no active execution exists.",
    })),
  },
  { $id: "AgentSendParams", additionalProperties: false },
);

export const AgentWaitParamsSchema = Type.Object(
  {
    run_ids: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description: "Unique owner-scoped run IDs that all belong to the current session.",
    }),
    timeout_seconds: Type.Optional(Type.Number({
      minimum: 0,
      description:
        "Maximum seconds to wait. Omit to wait indefinitely; use 0 to poll once. Timing out leaves all pending runs active.",
    })),
  },
  { $id: "AgentWaitParams", additionalProperties: false },
);

export const AgentCloseParamsSchema = Type.Object(
  {
    agent_id: Type.String({ minLength: 1, description: "The owner-scoped handle of the identity to close permanently." }),
    delete_worktree: Type.Optional(Type.Boolean({
      description:
        "When true, remove the agent's clean, verified worktree while preserving its dedicated branch. Defaults to false.",
    })),
  },
  { $id: "AgentCloseParams", additionalProperties: false },
);

export const AgentListParamsSchema = Type.Object(
  {},
  { $id: "AgentListParams", additionalProperties: false },
);

type Params = { readonly [key: string]: unknown };

function requireNonBlank(field: string) {
  return (params: object): string | undefined => {
    const fields = params as Params;
    return typeof fields[field] === "string" && fields[field].trim() !== ""
      ? undefined
      : `.${field} must not be empty`;
  };
}

function validateAgentSend(params: object): string | undefined {
  const fields = params as Params;
  const agentIdError = requireNonBlank("agent_id")(fields);
  if (agentIdError !== undefined) return agentIdError;
  const message = typeof fields["message"] === "string" ? fields["message"].trim() : "";
  if (message === "" && fields["interrupt"] !== true) {
    return ".message is required unless interrupt is true";
  }
  if (message !== "" && (typeof fields["description"] !== "string" || fields["description"].trim() === "")) {
    return ".description is required when message is supplied";
  }
  return undefined;
}

function validateAgentWait(params: object): string | undefined {
  const runIds = (params as Params)["run_ids"];
  if (!Array.isArray(runIds)) return undefined;
  const trimmed = runIds.map((value) => typeof value === "string" ? value.trim() : "");
  if (trimmed.some((value) => value === "")) return ".run_ids must not contain empty ids";
  return new Set(trimmed).size === trimmed.length
    ? undefined
    : ".run_ids must not contain duplicate ids";
}

type AgentToolDefinition = Omit<AgentToolContract, "parameters" | "parseParams"> & {
  readonly interfaceName: string;
  readonly paramsSchema: TSchema;
  readonly refineParams?: ToolParamsRefinement;
};

type DefinedAgentToolContract = AgentToolContract & {
  readonly interfaceName: string;
  readonly paramsSchema: TSchema;
};

function defineAgentTool(definition: AgentToolDefinition): DefinedAgentToolContract {
  const { refineParams, ...contract } = definition;
  return { ...contract, ...toolInput(contract.paramsSchema, refineParams) };
}

const agentToolDefinitions = [
  {
    name: "agent_spawn",
    label: "agent.spawn",
    description:
      "Create a durable generic agent for substantial delegated execution and start its first asynchronous run. The identity retains its conversation across later agent_send calls. The call returns after the initial instruction is accepted, without waiting for completion.",
    promptSnippet: "Start a durable generic agent for substantial asynchronous execution.",
    promptGuidelines: [
      "For agent_spawn, choose tier by task complexity and scope. Use low for straightforward, well-defined work: a one-file change or simple mechanical refactor across the codebase; bounded delegated internet research; or one known check or bounded evidence collection. Use medium for well-scoped work requiring reasoning across several files; focused independent research across multiple sources; or reproducing and verifying a workflow across several components. Use high for difficult, open-ended, or repository-wide work: broad cross-cutting changes; comprehensive independent research requiring broad source synthesis; or repository-wide failure investigation and validation. Medium is the default.",
      "Use agent_spawn for substantial delegated execution that does not fit finder, oracle, code_reviewer, or code_quality_reviewer, especially independent multi-step work, parallel disjoint work, or work with extensive intermediate output that the parent does not need.",
      "Use agent_spawn to create a new identity when substantial delegated execution has a materially different objective, files, component, or constraints and an existing agent's retained context would not help.",
      "When using agent_spawn, remember that the child has its own conversation and does not inherit the parent conversation. Include all relevant decisions, context, constraints, and validation instructions in message, or reference paths to files that contain them.",
    ],
    interfaceName: "AgentSpawnParams", paramsSchema: AgentSpawnParamsSchema, refineParams: requireNonBlank("message"),
    execution: {
      domain: "agent", preparedAction: "agent_start", parentActiveTools: true,
      allowInvalidChildMetadata: false, rememberDescription: true, reconcileLiveDispatches: false,
    },
  },
  {
    name: "finder",
    label: "finder",
    description:
      "Create a durable, read-only Finder specialist and start an asynchronous run for conceptual, behavior-based, or multi-step discovery that correlates findings across files. The identity can be continued with agent_send; the call returns after the query is accepted, without waiting for completion.",
    promptSnippet: "Start a read-only Finder for conceptual, multi-file discovery.",
    promptGuidelines: [
      "Use finder for conceptual, behavior-based, or multi-file discovery that requires correlating findings across files. Do not use finder when the path, symbol, or exact text is known; use direct read or search tools instead.",
    ],
    interfaceName: "FinderParams", paramsSchema: FinderParamsSchema, refineParams: requireNonBlank("query"),
    execution: {
      domain: "agent", preparedAction: "agent_start", parentActiveTools: true,
      allowInvalidChildMetadata: false, rememberDescription: true, reconcileLiveDispatches: false,
    },
  },
  {
    name: "oracle",
    label: "oracle",
    description:
      "Create a durable, read-only Oracle advisory specialist and start an asynchronous run for independent technical reasoning, judgment, critique, diagnosis, planning, review, or recommendations. The identity can be continued with agent_send; the call returns after the instruction is accepted, without waiting for completion.",
    promptSnippet: "Start a read-only Oracle for independent technical reasoning and advice.",
    promptGuidelines: [
      "Use oracle when the primary outcome is independent reasoning, judgment, critique, diagnosis, planning, review, or a recommendation rather than carrying out the resulting action.",
    ],
    interfaceName: "OracleParams", paramsSchema: OracleParamsSchema, refineParams: requireNonBlank("message"),
    execution: {
      domain: "agent", preparedAction: "agent_start", parentActiveTools: true,
      allowInvalidChildMetadata: false, rememberDescription: true, reconcileLiveDispatches: false,
    },
  },
  {
    name: "code_reviewer",
    label: "code reviewer",
    description:
      "Create a durable, read-only code reviewer and start an asynchronous run that reviews caller-identified changes against the correctness, security, and developer-experience rubric. The identity can be continued with agent_send; the call returns after the review request is accepted, without waiting for completion.",
    promptSnippet: "Start a read-only code reviewer for correctness, security, and developer experience.",
    promptGuidelines: [
      "Use code_reviewer when the deliverable is a review of identified changes for correctness, security, and developer experience.",
    ],
    interfaceName: "CodeReviewerParams", paramsSchema: CodeReviewerParamsSchema, refineParams: requireNonBlank("message"),
    execution: {
      domain: "agent", preparedAction: "agent_start", parentActiveTools: true,
      allowInvalidChildMetadata: false, rememberDescription: true, reconcileLiveDispatches: false,
      // ^agent-qkil: this tool carries its complete additional instruction.
      additionalInstruction: {
        text: "Your rubric: $code-review. Follow it exactly.",
        requiredSkill: "code-review",
        unavailable: {
          code: "rubric_unavailable",
          message: "reviewer rubric skill is unavailable: code-review",
        },
      },
    },
  },
  {
    name: "code_quality_reviewer",
    label: "code quality reviewer",
    description:
      "Create a durable, read-only code quality reviewer and start an asynchronous run that reviews caller-identified changes against the maintainability rubric. The identity can be continued with agent_send; the call returns after the review request is accepted, without waiting for completion.",
    promptSnippet: "Start a read-only code quality reviewer for maintainability and structure.",
    promptGuidelines: [
      "Use code_quality_reviewer when the deliverable is a review of identified changes for maintainability, structure, abstraction quality, and test quality.",
    ],
    interfaceName: "CodeQualityReviewerParams", paramsSchema: CodeQualityReviewerParamsSchema, refineParams: requireNonBlank("message"),
    execution: {
      domain: "agent", preparedAction: "agent_start", parentActiveTools: true,
      allowInvalidChildMetadata: false, rememberDescription: true, reconcileLiveDispatches: false,
      // ^agent-ecr0: this tool carries its complete additional instruction.
      additionalInstruction: {
        text: "Your rubric: $code-quality-review. Follow it exactly.",
        requiredSkill: "code-quality-review",
        unavailable: {
          code: "rubric_unavailable",
          message: "reviewer rubric skill is unavailable: code-quality-review",
        },
      },
    },
  },
  {
    name: "agent_send",
    label: "agent.send",
    description:
      "Send an instruction to an existing open agent in its retained conversation. Depending on current state, the call starts new work, steers active work, resumes suspended work, interrupts and replaces active execution, or interrupts without replacement. A message requires a short user-facing description.",
    promptSnippet: "Continue, steer, resume, or interrupt an existing agent.",
    promptGuidelines: [
      "Use agent_send when new instructions, steering, interruption, or resumed work should target an existing open agent and retain its context.",
      "Prefer agent_send over starting a new agent when an existing agent's retained context is relevant to the next task, such as work on the same objective, files, component, or constraints.",
    ],
    interfaceName: "AgentSendParams", paramsSchema: AgentSendParamsSchema, refineParams: validateAgentSend,
    execution: {
      domain: "agent", preparedAction: "agent_send", parentActiveTools: false,
      allowInvalidChildMetadata: false, rememberDescription: true, reconcileLiveDispatches: false,
    },
  },
  {
    name: "agent_wait",
    label: "agent.wait",
    description:
      "Race selected agent runs and return every result ready at the observation point. Omitted timeout waits indefinitely; a timeout bounds only this call and never stops the runs. Call again with returned pending_run_ids to await later completions.",
    promptSnippet: "Wait for selected agent runs and retrieve ready outcomes.",
    promptGuidelines: [
      "Use agent_wait to retrieve outcomes and child output from selected runs, or to pause until at least one selected run is ready.",
      "Prefer one indefinite agent_wait call over repeated polling or agent_list checks when no useful work can proceed until a selected run finishes.",
    ],
    interfaceName: "AgentWaitParams", paramsSchema: AgentWaitParamsSchema, refineParams: validateAgentWait,
    execution: {
      domain: "agent", preparedAction: "agent_wait", parentActiveTools: false,
      allowInvalidChildMetadata: true, rememberDescription: false, reconcileLiveDispatches: false,
    },
  },
  {
    name: "agent_list",
    label: "agent.list",
    description:
      "List all open agent identities owned by the current session, including lifecycle status, per-run turn count, and observable activity phase, timing, and recommended next action.",
    promptSnippet: "Inspect open agent identities and their latest run activity.",
    promptGuidelines: [
      "Use agent_list when you need an overview of open agents before deciding which identity or run to wait for, continue, interrupt, resume, or close. Treat activity as observed progress, not a health or stall judgment.",
    ],
    interfaceName: "AgentListParams", paramsSchema: AgentListParamsSchema,
    execution: {
      domain: "agent", preparedAction: "agent_wait", parentActiveTools: false,
      allowInvalidChildMetadata: true, rememberDescription: false, reconcileLiveDispatches: true,
    },
  },
  {
    name: "agent_close",
    label: "agent.close",
    description:
      "Permanently close one agent identity, interrupt active execution, and remove all of its runs from current Taumel state. By default, an agent worktree and its dedicated branch are preserved; optional worktree deletion removes only a clean, verified worktree and preserves its branch. Closed identities cannot be resumed; use agent_send interruption for a reversible stop.",
    promptSnippet: "Close and forget one agent identity.",
    promptGuidelines: [
      "Use agent_close when an open agent is no longer expected to receive related follow-up work.",
    ],
    interfaceName: "AgentCloseParams", paramsSchema: AgentCloseParamsSchema, refineParams: requireNonBlank("agent_id"),
    execution: {
      domain: "agent", preparedAction: "agent_close", parentActiveTools: false,
      allowInvalidChildMetadata: false, rememberDescription: false, reconcileLiveDispatches: false,
    },
  },
] satisfies readonly AgentToolDefinition[];

export const agentToolContracts: readonly DefinedAgentToolContract[] =
  agentToolDefinitions.map(defineAgentTool);

export const agentDtsSchemas = agentToolDefinitions.map(
  (definition) => [definition.interfaceName, definition.paramsSchema] as const,
);

export const agentToolParamSchemas = agentToolDefinitions.map((definition) => ({
  name: definition.name,
  interfaceName: definition.interfaceName,
  schema: definition.paramsSchema,
}));
