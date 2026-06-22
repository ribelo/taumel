import { Compile } from "typebox/compile";
import Type from "typebox";

const stringArray = Type.Array(Type.String());

const ExaSearchTypeSchema = Type.Union([
  Type.Literal("instant"),
  Type.Literal("fast"),
  Type.Literal("auto"),
  Type.Literal("deep-lite"),
  Type.Literal("deep"),
  Type.Literal("deep-reasoning"),
]);

const ExaComplianceSchema = Type.Literal("hipaa");

const ExaJsonObjectSchema = Type.Record(Type.String(), Type.Unknown());

const ExaTextOptionsSchema = Type.Object(
  {
    maxCharacters: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { $id: "ExaTextOptions", additionalProperties: false },
);

const ExaHighlightsOptionsSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1 })),
    numSentences: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    highlightsPerUrl: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  },
  { $id: "ExaHighlightsOptions", additionalProperties: false },
);

const ExaSummaryOptionsSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "ExaSummaryOptions", additionalProperties: false },
);

const ExaContentOptionsSchema = Type.Object(
  {
    text: Type.Optional(Type.Union([Type.Boolean(), ExaTextOptionsSchema])),
    highlights: Type.Optional(Type.Union([Type.Boolean(), ExaHighlightsOptionsSchema])),
    summary: Type.Optional(ExaSummaryOptionsSchema),
    maxAgeHours: Type.Optional(Type.Integer({ minimum: -1, maximum: 720 })),
    subpages: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    subpageTarget: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), stringArray])),
  },
  { $id: "ExaContentOptions", additionalProperties: false },
);

const ExaRunIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9_.:-]+$",
});

const EditReplacementSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({
      description: "Replacement text for this targeted edit.",
    }),
  },
  { $id: "EditReplacement", additionalProperties: false },
);

const RequestInputOptionSchema = Type.Object(
  {
    label: Type.String(),
    description: Type.String(),
  },
  { $id: "RequestInputOption", additionalProperties: false },
);

const RequestInputQuestionSchema = Type.Object(
  {
    id: Type.String(),
    header: Type.String({ maxLength: 12 }),
    question: Type.String(),
    options: Type.Array(RequestInputOptionSchema, { minItems: 2, maxItems: 3 }),
  },
  { $id: "RequestInputQuestion", additionalProperties: false },
);

const EmptyParamsSchema = Type.Object({}, { $id: "EmptyParams", additionalProperties: false });

const ExecCommandParamsSchema = Type.Object(
  {
    cmd: Type.String({ description: "Shell command to execute." }),
    workdir: Type.Optional(Type.String({ description: "Working directory for the command." })),
    yield_time_ms: Type.Optional(
      Type.Number({
        description: "How long to wait (in milliseconds) for output before yielding.",
      }),
    ),
    max_output_tokens: Type.Optional(Type.Number({ description: "Maximum output token budget." })),
    tty: Type.Optional(Type.Boolean({ description: "Allocate a terminal session for interactive commands." })),
    shell: Type.Optional(Type.String({ description: "Shell binary to launch." })),
    login: Type.Optional(Type.Boolean({ description: "Use shell login semantics." })),
    sandbox_permissions: Type.Optional(
      Type.Literal("require_escalated", {
        description: "Request approval to run outside the default sandbox.",
      }),
    ),
    justification: Type.Optional(Type.String()),
    prefix_rule: Type.Optional(stringArray),
  },
  { $id: "ExecCommandParams", additionalProperties: false },
);

const WriteStdinParamsSchema = Type.Object(
  {
    session_id: Type.Integer(),
    chars: Type.Optional(Type.String()),
    yield_time_ms: Type.Optional(Type.Number()),
    max_output_tokens: Type.Optional(Type.Number()),
  },
  { $id: "WriteStdinParams", additionalProperties: false },
);

const ApplyPatchParamsSchema = Type.Object(
  {
    input: Type.Optional(Type.String()),
    patch: Type.Optional(Type.String()),
  },
  { $id: "ApplyPatchParams", additionalProperties: false },
);

const WriteParamsSchema = Type.Object(
  {
    path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
    content: Type.String({ description: "Content to write to the file" }),
  },
  { $id: "WriteParams", additionalProperties: false },
);

const EditParamsSchema = Type.Object(
  {
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
    edits: Type.Array(EditReplacementSchema, {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits.",
    }),
  },
  { $id: "EditParams", additionalProperties: false },
);

const CreateGoalParamsSchema = Type.Object(
  {
    objective: Type.String(),
    token_budget: Type.Optional(Type.Integer()),
  },
  { $id: "CreateGoalParams", additionalProperties: false },
);

const UpdateGoalParamsSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")]),
  },
  { $id: "UpdateGoalParams", additionalProperties: false },
);

const RequestUserInputParamsSchema = Type.Object(
  {
    questions: Type.Array(RequestInputQuestionSchema, { minItems: 1, maxItems: 3 }),
    autoResolutionMs: Type.Optional(Type.Integer()),
  },
  { $id: "RequestUserInputParams", additionalProperties: false },
);

const FindThreadParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { $id: "FindThreadParams", additionalProperties: false },
);

const ReadThreadParamsSchema = Type.Object(
  {
    threadID: Type.String({ minLength: 1 }),
    goal: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { $id: "ReadThreadParams", additionalProperties: false },
);

const AgentParamsSchema = Type.Object(
  {
    action: Type.Optional(Type.Union([
      Type.Literal("spawn"),
      Type.Literal("send"),
      Type.Literal("wait"),
      Type.Literal("close"),
      Type.Literal("list"),
    ])),
    id: Type.Optional(Type.String()),
    agent: Type.Optional(Type.String()),
    prompt: Type.Optional(Type.String()),
    model_id: Type.Optional(Type.String()),
    thinking_level: Type.Optional(Type.String()),
    sandbox_preset: Type.Optional(
      Type.Union([
        Type.Literal("read-only"),
        Type.Literal("workspace-write"),
        Type.Literal("danger-full-access"),
        Type.Literal("full-access"),
      ]),
    ),
    tools: Type.Optional(stringArray),
    no_sandbox: Type.Optional(Type.Boolean()),
  },
  { $id: "AgentParams", additionalProperties: false },
);

const RalphTaskParamsSchema = Type.Object(
  {
    task_id: Type.String(),
  },
  { $id: "RalphTaskParams", additionalProperties: false },
);

const WebSearchExaParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 2000 }),
    type: Type.Optional(ExaSearchTypeSchema),
    includeDomains: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 1200 })),
    excludeDomains: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 1200 })),
    startCrawlDate: Type.Optional(Type.String()),
    endCrawlDate: Type.Optional(Type.String()),
    startPublishedDate: Type.Optional(Type.String()),
    endPublishedDate: Type.Optional(Type.String()),
    numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    moderation: Type.Optional(Type.Boolean()),
    contents: Type.Optional(ExaContentOptionsSchema),
    additionalQueries: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10 })),
    category: Type.Optional(Type.String({ minLength: 1 })),
    userLocation: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
    compliance: Type.Optional(ExaComplianceSchema),
    systemPrompt: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "WebSearchExaParams", additionalProperties: false },
);

const CrawlingExaParamsSchema = Type.Object(
  {
    ids: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { minItems: 1, maxItems: 100 })),
    urls: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { minItems: 1, maxItems: 100 })),
    compliance: Type.Optional(ExaComplianceSchema),
    text: Type.Optional(Type.Union([Type.Boolean(), ExaTextOptionsSchema])),
    highlights: Type.Optional(Type.Union([Type.Boolean(), ExaHighlightsOptionsSchema])),
    summary: Type.Optional(ExaSummaryOptionsSchema),
    maxAgeHours: Type.Optional(Type.Integer({ minimum: -1, maximum: 720 })),
    subpages: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    subpageTarget: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), stringArray])),
  },
  { $id: "CrawlingExaParams", additionalProperties: false },
);

const GetCodeContextExaParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 2000 }),
    tokensNum: Type.Optional(Type.Union([
      Type.Literal("dynamic"),
      Type.Integer({ minimum: 50, maximum: 100000 }),
    ])),
  },
  { $id: "GetCodeContextExaParams", additionalProperties: false },
);

const ExaAgentCreateRunParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    systemPrompt: Type.Optional(Type.String({ minLength: 1 })),
    input: Type.Optional(ExaJsonObjectSchema),
    outputSchema: Type.Optional(ExaJsonObjectSchema),
    effort: Type.Optional(Type.Union([
      Type.Literal("minimal"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
      Type.Literal("auto"),
    ])),
    previousRunId: Type.Optional(ExaRunIdSchema),
    metadata: Type.Optional(ExaJsonObjectSchema),
  },
  { $id: "ExaAgentCreateRunParams", additionalProperties: false },
);

const ExaAgentRunIdParamsSchema = Type.Object(
  {
    id: ExaRunIdSchema,
  },
  { $id: "ExaAgentRunIdParams", additionalProperties: false },
);

const ExaAgentListRunsParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(ExaRunIdSchema),
  },
  { $id: "ExaAgentListRunsParams", additionalProperties: false },
);

const ExaAgentListEventsParamsSchema = Type.Object(
  {
    id: ExaRunIdSchema,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1 })),
    lastEventId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: "ExaAgentListEventsParams", additionalProperties: false },
);

export const dtsSchemas = [
  ["EmptyParams", EmptyParamsSchema],
  ["EditReplacement", EditReplacementSchema],
  ["RequestInputOption", RequestInputOptionSchema],
  ["RequestInputQuestion", RequestInputQuestionSchema],
  ["ExecCommandParams", ExecCommandParamsSchema],
  ["WriteStdinParams", WriteStdinParamsSchema],
  ["ApplyPatchParams", ApplyPatchParamsSchema],
  ["WriteParams", WriteParamsSchema],
  ["EditParams", EditParamsSchema],
  ["CreateGoalParams", CreateGoalParamsSchema],
  ["UpdateGoalParams", UpdateGoalParamsSchema],
  ["RequestUserInputParams", RequestUserInputParamsSchema],
  ["FindThreadParams", FindThreadParamsSchema],
  ["ReadThreadParams", ReadThreadParamsSchema],
  ["AgentParams", AgentParamsSchema],
  ["RalphTaskParams", RalphTaskParamsSchema],
  ["ExaAgentCreateRunParams", ExaAgentCreateRunParamsSchema],
  ["ExaAgentRunIdParams", ExaAgentRunIdParamsSchema],
  ["ExaAgentListRunsParams", ExaAgentListRunsParamsSchema],
  ["ExaAgentListEventsParams", ExaAgentListEventsParamsSchema],
] as const;

export const toolParamSchemas = [
  { name: "exec_command", interfaceName: "ExecCommandParams", schema: ExecCommandParamsSchema },
  { name: "write_stdin", interfaceName: "WriteStdinParams", schema: WriteStdinParamsSchema },
  { name: "apply_patch", interfaceName: "ApplyPatchParams", schema: ApplyPatchParamsSchema },
  { name: "write", interfaceName: "WriteParams", schema: WriteParamsSchema },
  { name: "edit", interfaceName: "EditParams", schema: EditParamsSchema },
  { name: "agent", interfaceName: "AgentParams", schema: AgentParamsSchema },
  { name: "get_goal", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "create_goal", interfaceName: "CreateGoalParams", schema: CreateGoalParamsSchema },
  { name: "update_goal", interfaceName: "UpdateGoalParams", schema: UpdateGoalParamsSchema },
  { name: "request_user_input", interfaceName: "RequestUserInputParams", schema: RequestUserInputParamsSchema },
  { name: "find_thread", interfaceName: "FindThreadParams", schema: FindThreadParamsSchema },
  { name: "read_thread", interfaceName: "ReadThreadParams", schema: ReadThreadParamsSchema },
  { name: "ralph_continue", interfaceName: "RalphTaskParams", schema: RalphTaskParamsSchema },
  { name: "ralph_finish", interfaceName: "RalphTaskParams", schema: RalphTaskParamsSchema },
  { name: "web_search_exa", interfaceName: "WebSearchExaParams", schema: WebSearchExaParamsSchema },
  { name: "crawling_exa", interfaceName: "CrawlingExaParams", schema: CrawlingExaParamsSchema },
  { name: "get_code_context_exa", interfaceName: "GetCodeContextExaParams", schema: GetCodeContextExaParamsSchema },
  { name: "exa_agent_create_run", interfaceName: "ExaAgentCreateRunParams", schema: ExaAgentCreateRunParamsSchema },
  { name: "exa_agent_get_run", interfaceName: "ExaAgentRunIdParams", schema: ExaAgentRunIdParamsSchema },
  { name: "exa_agent_list_runs", interfaceName: "ExaAgentListRunsParams", schema: ExaAgentListRunsParamsSchema },
  { name: "exa_agent_cancel_run", interfaceName: "ExaAgentRunIdParams", schema: ExaAgentRunIdParamsSchema },
  { name: "exa_agent_list_events", interfaceName: "ExaAgentListEventsParams", schema: ExaAgentListEventsParamsSchema },
] as const;

type Validator = ReturnType<typeof Compile>;

const validators = new Map<string, Validator>(
  toolParamSchemas.map((contract) => [contract.name, Compile(contract.schema)]),
);

export const toolNames = toolParamSchemas.map((contract) => contract.name);

export type ParsedToolParams = Record<string, unknown>;

export type ParseToolParamsResult =
  | { readonly ok: true; readonly params: ParsedToolParams }
  | { readonly ok: false; readonly error: string };

function formatValidationError(toolName: string, validator: Validator, value: unknown): string {
  const first = [...validator.Errors(value)][0];
  if (first === undefined) return `${toolName}: invalid parameters`;
  const path = typeof first.instancePath === "string" && first.instancePath !== ""
    ? first.instancePath.replaceAll("/", ".").replace(/^\./, ".")
    : "";
  return `${toolName}${path}: ${first.message}`;
}

export function parseToolParams(toolName: string, rawParams: unknown): ParseToolParamsResult {
  const validator = validators.get(toolName);
  if (validator === undefined) {
    return { ok: false, error: `unknown tool contract: ${toolName}` };
  }
  const params = rawParams === undefined || rawParams === null ? {} : rawParams;
  if (!validator.Check(params)) {
    return { ok: false, error: formatValidationError(toolName, validator, params) };
  }
  if (
    toolName === "crawling_exa" &&
    typeof params === "object" &&
    params !== null &&
    ("ids" in params) === ("urls" in params)
  ) {
    return { ok: false, error: "crawling_exa: provide either ids or urls, but not both" };
  }
  return { ok: true, params: params as ParsedToolParams };
}

export type ToolContract = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines?: readonly string[];
  readonly parameters: Record<string, unknown>;
};

export const toolContracts: readonly ToolContract[] = [
  {
    name: "exec_command",
    label: "exec_command",
    description: "Runs a command in a PTY, returning output or a session ID for ongoing interaction.",
    promptSnippet: "Run shell commands, returning output or a session ID for ongoing interaction.",
    promptGuidelines: [
      "Use exec_command for file operations like ls, rg, find, builds, tests, and development commands.",
      "Use tty=true for interactive commands or commands that need terminal behavior, then use write_stdin to send input.",
      "Use write_stdin with empty chars to poll or wait for an active session.",
    ],
    parameters: ExecCommandParamsSchema,
  },
  {
    name: "write_stdin",
    label: "write_stdin",
    description: "Writes characters to an existing unified exec session and returns recent output.",
    promptSnippet: "Send input to or poll an active shell session.",
    parameters: WriteStdinParamsSchema,
  },
  {
    name: "apply_patch",
    label: "apply_patch",
    description: "Use the apply_patch tool to edit files.",
    promptSnippet: "Apply a patch to files in the workspace.",
    parameters: ApplyPatchParamsSchema,
  },
  {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: WriteParamsSchema,
  },
  {
    name: "edit",
    label: "edit",
    description: "Edit a single file using exact text replacement.",
    promptSnippet: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText must match exactly)",
      "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
      "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ],
    parameters: EditParamsSchema,
  },
  {
    name: "agent",
    label: "agent",
    description: "Spawn, send to, wait for, list, or close a sandbox-clamped Taumel sub-agent.",
    promptSnippet: "",
    parameters: AgentParamsSchema,
  },
  {
    name: "get_goal",
    label: "get_goal",
    description: "Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget.",
    promptSnippet: "",
    parameters: EmptyParamsSchema,
  },
  {
    name: "create_goal",
    label: "create_goal",
    description: "Create a goal only when explicitly requested by the user or system/developer instructions.",
    promptSnippet: "",
    parameters: CreateGoalParamsSchema,
  },
  {
    name: "update_goal",
    label: "update_goal",
    description: "Update the existing goal only to mark it complete or genuinely blocked.",
    promptSnippet: "",
    parameters: UpdateGoalParamsSchema,
  },
  {
    name: "request_user_input",
    label: "request_user_input",
    description: "Ask the user one to three structured questions and return structured answers.",
    promptSnippet: "",
    parameters: RequestUserInputParamsSchema,
  },
  {
    name: "find_thread",
    label: "find_thread",
    description: "Search thread ids, titles, and transcript content.",
    promptSnippet: "",
    parameters: FindThreadParamsSchema,
  },
  {
    name: "read_thread",
    label: "read_thread",
    description: "Read a thread by exact id or unique id prefix.",
    promptSnippet: "",
    parameters: ReadThreadParamsSchema,
  },
  {
    name: "ralph_continue",
    label: "ralph_continue",
    description: "Advance an owned Ralph child session by one iteration.",
    promptSnippet: "",
    parameters: RalphTaskParamsSchema,
  },
  {
    name: "ralph_finish",
    label: "ralph_finish",
    description: "Finish an owned Ralph child session.",
    promptSnippet: "",
    parameters: RalphTaskParamsSchema,
  },
  {
    name: "web_search_exa",
    label: "exa.web_search",
    description:
      "Search Exa's web index and optionally extract highlights, summaries, or text from the results.",
    promptSnippet: "Search Exa's web index for current web, paper, company, people, and news results.",
    promptGuidelines: [
      "Keep numResults small unless broad coverage is necessary.",
      "Use contents.highlights or contents.summary before requesting full text.",
      "Use crawling_exa when you already have URLs or Exa document IDs.",
    ],
    parameters: WebSearchExaParamsSchema,
  },
  {
    name: "crawling_exa",
    label: "exa.contents",
    description:
      "Fetch page contents, summaries, highlights, and metadata for URLs or Exa document IDs.",
    promptSnippet: "Fetch page contents with Exa when URLs or document IDs are already known.",
    promptGuidelines: [
      "Provide either urls or ids, not both.",
      "Request only the content fields needed for the task.",
    ],
    parameters: CrawlingExaParamsSchema,
  },
  {
    name: "get_code_context_exa",
    label: "exa.code_context",
    description:
      "Get relevant code snippets and examples from Exa Code Context.",
    promptSnippet: "Search code, docs, GitHub, and Stack Overflow examples with Exa Code Context.",
    parameters: GetCodeContextExaParamsSchema,
  },
  {
    name: "exa_agent_create_run",
    label: "exa.agent.create_run",
    description:
      "Create an asynchronous Exa Agent research run. This always requires explicit user approval before the request is sent.",
    promptSnippet: "Create a long-running Exa Agent research or extraction run after user approval.",
    promptGuidelines: [
      "Use this only when a normal Exa search or contents fetch is not enough.",
      "Prefer low or medium effort unless the user explicitly needs deep research.",
    ],
    parameters: ExaAgentCreateRunParamsSchema,
  },
  {
    name: "exa_agent_get_run",
    label: "exa.agent.get_run",
    description: "Retrieve an Exa Agent run by ID.",
    promptSnippet: "Poll or inspect an Exa Agent run by ID.",
    parameters: ExaAgentRunIdParamsSchema,
  },
  {
    name: "exa_agent_list_runs",
    label: "exa.agent.list_runs",
    description: "List Exa Agent runs for the configured team.",
    promptSnippet: "List recent Exa Agent runs.",
    parameters: ExaAgentListRunsParamsSchema,
  },
  {
    name: "exa_agent_cancel_run",
    label: "exa.agent.cancel_run",
    description: "Cancel a queued or running Exa Agent run.",
    promptSnippet: "Cancel an Exa Agent run by ID.",
    parameters: ExaAgentRunIdParamsSchema,
  },
  {
    name: "exa_agent_list_events",
    label: "exa.agent.list_events",
    description: "List stored events for an Exa Agent run.",
    promptSnippet: "List Exa Agent run events.",
    parameters: ExaAgentListEventsParamsSchema,
  },
];
