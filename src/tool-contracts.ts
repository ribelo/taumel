import { Compile } from "typebox/compile";
import Type from "typebox";

const stringArray = Type.Array(Type.String());

export const ExaSearchTypeSchema = Type.Union(
  [
    Type.Literal("instant"),
    Type.Literal("fast"),
    Type.Literal("auto"),
    Type.Literal("deep-lite"),
    Type.Literal("deep"),
    Type.Literal("deep-reasoning"),
  ],
  { description: "Search mode controlling latency and depth. Omit to let Exa choose." },
);

export const ExaComplianceSchema = Type.Literal("hipaa", {
  description: "Compliance mode; currently only hipaa.",
});

export const ExaTextOptionsSchema = Type.Object(
  {
    maxCharacters: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum page-text characters to return.",
      }),
    ),
  },
  { $id: "ExaTextOptions", additionalProperties: false },
);

export const ExaHighlightsOptionsSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Query used to select relevant highlights; defaults to the surrounding search query when available.",
      }),
    ),
    maxCharacters: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum total highlight characters to return.",
      }),
    ),
  },
  { $id: "ExaHighlightsOptions", additionalProperties: false },
);

export const ExaSummaryOptionsSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Question or focus for the generated summary.",
      }),
    ),
  },
  {
    $id: "ExaSummaryOptions",
    additionalProperties: false,
    description: "Request a generated summary for each result.",
  },
);

export const ExaContentOptionsSchema = Type.Object(
  {
    text: Type.Optional(
      Type.Union([Type.Boolean(), ExaTextOptionsSchema], {
        description: "Whether to return page text. Use an options object to limit returned characters.",
      }),
    ),
    highlights: Type.Optional(
      Type.Union([Type.Boolean(), ExaHighlightsOptionsSchema], {
        description:
          "Whether to return relevant page excerpts. Use an options object to control excerpt selection.",
      }),
    ),
    summary: Type.Optional(ExaSummaryOptionsSchema),
    maxAgeHours: Type.Optional(
      Type.Integer({
        minimum: -1,
        maximum: 720,
        description:
          "Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching.",
      }),
    ),
    subpages: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 100,
        description: "Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100.",
      }),
    ),
    subpageTarget: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 100 }), stringArray], {
        description: "Keyword or keywords used to prioritize which subpages to crawl.",
      }),
    ),
  },
  {
    $id: "ExaContentOptions",
    additionalProperties: false,
    description: "Content extraction to include with each search result.",
  },
);

export const EditReplacementSchema = Type.Object(
  {
    oldText: Type.String({
      minLength: 1,
      description: "Exact, non-empty text to replace. It must occur exactly once in the original file.",
    }),
    newText: Type.String({
      description: "Replacement text. Use an empty string to delete oldText.",
    }),
  },
  { $id: "EditReplacement", additionalProperties: false },
);

export const EmptyParamsSchema = Type.Object({}, { $id: "EmptyParams", additionalProperties: false });

export const ExecCommandParamsSchema = Type.Object(
  {
    cmd: Type.String({ minLength: 1, pattern: "\\S", description: "The bash command to run." }),
    workdir: Type.Optional(
      Type.String({
        description: "Working directory for the command. Omit to use the current turn working directory.",
      }),
    ),
    yield_time_ms: Type.Optional(
      Type.Number({
        description:
          "Milliseconds to wait for output before yielding. Defaults to 10000; rounded to an integer; minimum 250; maximum 30000. Yielding leaves a live command running.",
      }),
    ),
    max_output_tokens: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Approximate returned-output limit. Defaults to 10000 and truncates excess model-visible output without changing the command-output safety ceiling.",
      }),
    ),
    with_escalated_permissions: Type.Optional(
      Type.Boolean({
        description:
          "When true, requests execution outside sandbox restrictions. May require approval or be denied.",
      }),
    ),
    justification: Type.Optional(
      Type.String({
        description:
          "One-sentence explanation of why escalated permissions are needed. Supply only when with_escalated_permissions is true.",
      }),
    ),
  },
  { $id: "ExecCommandParams", additionalProperties: false },
);

export const WriteStdinParamsSchema = Type.Object(
  {
    session_id: Type.Integer({
      description: "Exact session id returned by exec_command.",
    }),
    chars: Type.Optional(
      Type.String({
        description: "Characters sent verbatim. Omit or use an empty string to poll without writing.",
      }),
    ),
    yield_time_ms: Type.Optional(
      Type.Number({
        description:
          "Milliseconds to wait; yielding leaves the process running. Delta-mode writes and polls default to 250 and accept 250–30000. Empty status-mode waits default to 5000 and accept 5000–300000.",
      }),
    ),
    max_output_tokens: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Approximate returned-output limit. Defaults to 10000 and truncates excess model-visible output.",
      }),
    ),
    output_mode: Type.Optional(
      Type.Union([Type.Literal("delta"), Type.Literal("status")], {
        description:
          "delta returns output to your context and permits interaction; status silently drains output during an empty-input passive wait. Omit to default to delta.",
      }),
    ),
  },
  { $id: "WriteStdinParams", additionalProperties: false },
);

export const ApplyPatchParamsSchema = Type.Object(
  {
    input: Type.String({
      minLength: 1,
      description: "The complete patch in *** Begin Patch format.",
    }),
  },
  { $id: "ApplyPatchParams", additionalProperties: false },
);

export const WriteParamsSchema = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      description: "Path to the file, relative to the current working directory or absolute.",
    }),
    content: Type.String({ description: "UTF-8 text to write exactly as provided." }),
    mode: Type.Optional(
      Type.Union([Type.Literal("overwrite"), Type.Literal("append")], {
        description:
          "Write behavior: overwrite (default) replaces the file; append adds content at the end without inserting a newline.",
      }),
    ),
  },
  { $id: "WriteParams", additionalProperties: false },
);

export const ReadParamsSchema = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      description: "Path to the UTF-8 text file to read, relative to the current working directory or absolute.",
    }),
    offset: Type.Optional(
      Type.Integer({
        description:
          "1-indexed line at which to start. Omit to start at line 1; a negative value starts that many lines from the end of the file.",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Maximum number of lines to return. Omit to read from offset to the end of the file, subject to the tool's truncation limits.",
      }),
    ),
  },
  { $id: "ReadParams", additionalProperties: false },
);

export const ViewMediaParamsSchema = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      description: "Path to the image, relative to the current working directory or absolute.",
    }),
  },
  { $id: "ViewMediaParams", additionalProperties: false },
);

export const EditParamsSchema = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      description: "Path to the existing UTF-8 text file to edit, relative to the current working directory or absolute.",
    }),
    edits: Type.Array(EditReplacementSchema, {
      minItems: 1,
      description: "One or more non-overlapping replacements, all matched against the original file.",
    }),
  },
  { $id: "EditParams", additionalProperties: false },
);

export const CreateGoalParamsSchema = Type.Object(
  {
    objective: Type.String({
      minLength: 1,
      description:
        "The objective to pursue across turns. Preserve the user\u2019s full requested outcome, scope, constraints, and completion criteria.",
    }),
    time_limit_seconds: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "User-requested active-time limit in seconds. Minimum 1. Omit unless the user explicitly requested it.",
      }),
    ),
  },
  { $id: "CreateGoalParams", additionalProperties: false },
);

export const UpdateGoalParamsSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")], {
      description:
        "Terminal status to set. Use complete only when every required outcome is satisfied; use blocked only at a genuine impasse requiring user input or an external-state change.",
    }),
  },
  { $id: "UpdateGoalParams", additionalProperties: false },
);

export const CronCreateParamsSchema = Type.Object(
  {
    cron: Type.String({
      minLength: 1,
      description:
        "Standard 5-field cron expression: minute, hour, day of month, month, and day of week. Evaluated in the host\u2019s local timezone.",
    }),
    prompt: Type.String({
      minLength: 1,
      description:
        "Prompt delivered to the main session when the task fires. With goal = true, it becomes the goal objective.",
    }),
    recurring: Type.Optional(
      Type.Boolean({
        description:
          "Whether the task repeats. Defaults to true; false fires once and deletes the task after delivery.",
      }),
    ),
    goal: Type.Optional(
      Type.Boolean({
        description:
          "Whether to deliver the prompt as a goal instead of a message. Defaults to false; a goal-mode fire waits while the session\u2019s goal slot is occupied.",
      }),
    ),
  },
  { $id: "CronCreateParams", additionalProperties: false },
);

export const CronDeleteParamsSchema = Type.Object(
  {
    id: Type.String({
      pattern: "^[0-9a-f]{8}$",
      description: "Eight-character lowercase hexadecimal task ID returned by cron_create or cron_list.",
    }),
  },
  { $id: "CronDeleteParams", additionalProperties: false },
);

export const QueryThreadsParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 500,
      description:
        "Text to find in persisted conversations. Matching is case-insensitive substring search, not regex or a query language. Maximum 500 characters.",
    }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        description: "Maximum number of threads to return. Defaults to 10; accepts 1\u201350.",
      }),
    ),
    scope: Type.Optional(
      Type.Union([Type.Literal("current_workspace"), Type.Literal("all")], {
        description:
          "Where to search. current_workspace searches threads associated with your current workspace and is the default; all searches all persisted threads.",
      }),
    ),
    includeTools: Type.Optional(
      Type.Boolean({
        description: "Whether to search tool calls, tool results, and notifications. Defaults to true.",
      }),
    ),
  },
  { $id: "QueryThreadsParams", additionalProperties: false },
);

export const ThreadLocatorSchema = Type.Object(
  {
    threadID: Type.String({ minLength: 1, description: "Thread ID carried by the locator." }),
    sourcePath: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Persisted source path carried by the locator for exact source recovery. Copy it unchanged.",
      }),
    ),
    entryID: Type.Optional(
      Type.String({ minLength: 1, description: "Persisted entry ID identifying the matched event." }),
    ),
    line: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Persisted JSONL line number used as a fallback locator for the matched event.",
      }),
    ),
  },
  { $id: "ThreadLocator", additionalProperties: false },
);

export const ReadThreadParamsSchema = Type.Object(
  {
    threadID: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Exact thread ID or unique ID prefix. Required unless locator supplies the thread ID.",
      }),
    ),
    locator: Type.Optional(
      Type.Object(
        {
          threadID: Type.String({ minLength: 1, description: "Thread ID carried by the locator." }),
          sourcePath: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Persisted source path carried by the locator for exact source recovery. Copy it unchanged.",
            }),
          ),
          entryID: Type.Optional(
            Type.String({ minLength: 1, description: "Persisted entry ID identifying the matched event." }),
          ),
          line: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Persisted JSONL line number used as a fallback locator for the matched event.",
            }),
          ),
        },
        {
          description: "Exact hit locator returned by query_threads. Use with mode = window to read context around that hit.",
          additionalProperties: false,
        },
      ),
    ),
    entryID: Type.Optional(
      Type.String({ minLength: 1, description: "Entry ID to target when using mode = window without a locator." }),
    ),
    line: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Persisted JSONL line number to target when using mode = window without a locator.",
      }),
    ),
    mode: Type.Optional(
      Type.Union([Type.Literal("overview"), Type.Literal("window"), Type.Literal("full")], {
        description:
          "What to read: overview returns bounded metadata, summaries, and recent entries and is the default; window returns context around a locator, entry ID, or line; full returns a paginated visible transcript.",
      }),
    ),
    around: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 10,
        description: "Number of visible entries to include before and after a window target. Defaults to 3; accepts 0\u201310.",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Opaque cursor returned by a previous full response. Use only with mode = full; omit it for the first page.",
      }),
    ),
  },
  { $id: "ReadThreadParams", additionalProperties: false },
);

export const RalphTaskParamsSchema = Type.Object(
  {
    task_id: Type.String({
      minLength: 1,
      description: "Ralph task ID from the Ralph session prompt.",
    }),
  },
  { $id: "RalphTaskParams", additionalProperties: false },
);

export const WebSearchExaParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "Search query or question. Be specific about the desired facts, entities, sources, or time range. Maximum 2,000 characters.",
    }),
    type: Type.Optional(ExaSearchTypeSchema),
    includeDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        maxItems: 1200,
        description: "Domains allowed in results; when set, results come only from these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        maxItems: 1200,
        description: "Domains excluded from results.",
      }),
    ),
    startPublishedDate: Type.Optional(
      Type.String({ description: "Return pages published after this ISO 8601 timestamp." }),
    ),
    endPublishedDate: Type.Optional(
      Type.String({ description: "Return pages published before this ISO 8601 timestamp." }),
    ),
    numResults: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Number of results to return. Defaults to 10; accepts 1–100, with lower limits for some search modes.",
      }),
    ),
    moderation: Type.Optional(
      Type.Boolean({ description: "Whether to filter unsafe content. Defaults to false." }),
    ),
    contents: Type.Optional(ExaContentOptionsSchema),
    additionalQueries: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 10,
        description: "Additional query variants for deep search. Accepts 1–10.",
      }),
    ),
    category: Type.Optional(
      Type.String({ minLength: 1, description: "Optional Exa result-category filter." }),
    ),
    userLocation: Type.Optional(
      Type.String({ minLength: 2, maxLength: 2, description: "Two-letter country code for location-aware search." }),
    ),
    compliance: Type.Optional(ExaComplianceSchema),
    systemPrompt: Type.Optional(
      Type.String({ minLength: 1, description: "Additional instructions controlling deep-search behavior." }),
    ),
  },
  { $id: "WebSearchExaParams", additionalProperties: false },
);

export const CrawlingExaParamsSchema = Type.Object(
  {
    ids: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
        minItems: 1,
        maxItems: 100,
        description: "Exa document IDs to fetch. Accepts 1–100.",
      }),
    ),
    urls: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
        minItems: 1,
        maxItems: 100,
        description: "Page URLs to fetch. Accepts 1–100.",
      }),
    ),
    compliance: Type.Optional(ExaComplianceSchema),
    text: Type.Optional(
      Type.Union([Type.Boolean(), ExaTextOptionsSchema], {
        description: "Whether to return page text. Use an options object to limit returned characters.",
      }),
    ),
    highlights: Type.Optional(
      Type.Union([Type.Boolean(), ExaHighlightsOptionsSchema], {
        description:
          "Whether to return relevant page excerpts. Use an options object to control excerpt selection.",
      }),
    ),
    summary: Type.Optional(ExaSummaryOptionsSchema),
    maxAgeHours: Type.Optional(
      Type.Integer({
        minimum: -1,
        maximum: 720,
        description:
          "Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching.",
      }),
    ),
    subpages: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 100,
        description: "Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100.",
      }),
    ),
    subpageTarget: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 100 }), stringArray], {
        description: "Keyword or keywords used to prioritize which subpages to crawl.",
      }),
    ),
  },
  { $id: "CrawlingExaParams", additionalProperties: false },
);

export const GetCodeContextExaParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "Code or API question to research. Include relevant language, framework, library, symbols, and desired examples. Maximum 2,000 characters.",
    }),
    tokensNum: Type.Optional(
      Type.Union(
        [
          Type.Literal("dynamic"),
          Type.Integer({ minimum: 50, maximum: 100000 }),
        ],
        {
          description: "Approximate output-token budget, or dynamic to let Exa choose. Accepts 50–100,000.",
        },
      ),
    ),
  },
  { $id: "GetCodeContextExaParams", additionalProperties: false },
);

export const ExaAgentCreateRunParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description:
        "Research or extraction task for the Exa Agent. State the desired outcome, scope, source expectations, and completion criteria.",
    }),
    systemPrompt: Type.Optional(
      Type.String({ minLength: 1, description: "Optional additional instructions governing the research run." }),
    ),
    input: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), { description: "Optional structured JSON input for the run." }),
    ),
    outputSchema: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: "Optional JSON Schema constraining the run's structured output.",
      }),
    ),
    effort: Type.Optional(
      Type.Union(
        [
          Type.Literal("minimal"),
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
          Type.Literal("xhigh"),
          Type.Literal("auto"),
        ],
        { description: "Research effort tier. Prefer low or medium unless deep research is explicitly needed." },
      ),
    ),
    previousRunId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^[A-Za-z0-9_.:-]+$",
        description: "Optional prior Exa Agent run ID to continue or refine.",
      }),
    ),
    metadata: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), { description: "Optional JSON metadata to attach to the run." }),
    ),
  },
  { $id: "ExaAgentCreateRunParams", additionalProperties: false },
);

export const ExaAgentRunIdParamsSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[A-Za-z0-9_.:-]+$",
      description: "Exa Agent run ID returned by exa_agent_create_run or exa_agent_list_runs.",
    }),
  },
  { $id: "ExaAgentRunIdParams", additionalProperties: false },
);

export const ExaAgentListRunsParamsSchema = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Maximum runs to return. Accepts 1–100.",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^[A-Za-z0-9_.:-]+$",
        description: "Opaque cursor returned by a previous run-list response.",
      }),
    ),
  },
  { $id: "ExaAgentListRunsParams", additionalProperties: false },
);

export const ExaAgentListEventsParamsSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[A-Za-z0-9_.:-]+$",
      description: "Exa Agent run ID whose events to list.",
    }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Maximum events to return. Accepts 1–100.",
      }),
    ),
    cursor: Type.Optional(
      Type.String({ minLength: 1, description: "Opaque cursor returned by a previous event-list response." }),
    ),
    lastEventId: Type.Optional(
      Type.String({ minLength: 1, description: "Return events after this event ID for incremental reading." }),
    ),
  },
  { $id: "ExaAgentListEventsParams", additionalProperties: false },
);

export const AgentTierSchema = Type.Union(
  [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
  { description: "The generic agent's capacity tier. Defaults to medium." },
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
  },
  { $id: "OracleParams", additionalProperties: false },
);

export const AgentSendParamsSchema = Type.Object(
  {
    agent_id: Type.String({
      minLength: 1,
      description: "The owner-scoped agent handle returned by agent_spawn, finder, oracle, or agent_list.",
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
  },
  { $id: "AgentCloseParams", additionalProperties: false },
);

export const dtsSchemas = [
  ["EmptyParams", EmptyParamsSchema],
  ["EditReplacement", EditReplacementSchema],
  ["ExecCommandParams", ExecCommandParamsSchema],
  ["WriteStdinParams", WriteStdinParamsSchema],
  ["ApplyPatchParams", ApplyPatchParamsSchema],
  ["WriteParams", WriteParamsSchema],
  ["ReadParams", ReadParamsSchema],
  ["ViewMediaParams", ViewMediaParamsSchema],
  ["EditParams", EditParamsSchema],
  ["CreateGoalParams", CreateGoalParamsSchema],
  ["UpdateGoalParams", UpdateGoalParamsSchema],
  ["CronCreateParams", CronCreateParamsSchema],
  ["CronDeleteParams", CronDeleteParamsSchema],
  ["ThreadLocator", ThreadLocatorSchema],
  ["QueryThreadsParams", QueryThreadsParamsSchema],
  ["ReadThreadParams", ReadThreadParamsSchema],
  ["RalphTaskParams", RalphTaskParamsSchema],
  ["ExaAgentCreateRunParams", ExaAgentCreateRunParamsSchema],
  ["ExaAgentRunIdParams", ExaAgentRunIdParamsSchema],
  ["ExaAgentListRunsParams", ExaAgentListRunsParamsSchema],
  ["ExaAgentListEventsParams", ExaAgentListEventsParamsSchema],
  ["AgentSpawnParams", AgentSpawnParamsSchema],
  ["FinderParams", FinderParamsSchema],
  ["OracleParams", OracleParamsSchema],
  ["AgentSendParams", AgentSendParamsSchema],
  ["AgentWaitParams", AgentWaitParamsSchema],
  ["AgentCloseParams", AgentCloseParamsSchema],
] as const;

export const toolParamSchemas = [
  { name: "exec_command", interfaceName: "ExecCommandParams", schema: ExecCommandParamsSchema },
  { name: "write_stdin", interfaceName: "WriteStdinParams", schema: WriteStdinParamsSchema },
  { name: "apply_patch", interfaceName: "ApplyPatchParams", schema: ApplyPatchParamsSchema },
  { name: "write", interfaceName: "WriteParams", schema: WriteParamsSchema },
  { name: "read", interfaceName: "ReadParams", schema: ReadParamsSchema },
  { name: "view_media", interfaceName: "ViewMediaParams", schema: ViewMediaParamsSchema },
  { name: "edit", interfaceName: "EditParams", schema: EditParamsSchema },
  { name: "get_goal", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "create_goal", interfaceName: "CreateGoalParams", schema: CreateGoalParamsSchema },
  { name: "update_goal", interfaceName: "UpdateGoalParams", schema: UpdateGoalParamsSchema },
  { name: "cron_create", interfaceName: "CronCreateParams", schema: CronCreateParamsSchema },
  { name: "cron_list", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "cron_delete", interfaceName: "CronDeleteParams", schema: CronDeleteParamsSchema },
  { name: "query_threads", interfaceName: "QueryThreadsParams", schema: QueryThreadsParamsSchema },
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
  { name: "agent_spawn", interfaceName: "AgentSpawnParams", schema: AgentSpawnParamsSchema },
  { name: "finder", interfaceName: "FinderParams", schema: FinderParamsSchema },
  { name: "oracle", interfaceName: "OracleParams", schema: OracleParamsSchema },
  { name: "agent_send", interfaceName: "AgentSendParams", schema: AgentSendParamsSchema },
  { name: "agent_wait", interfaceName: "AgentWaitParams", schema: AgentWaitParamsSchema },
  { name: "agent_list", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "agent_close", interfaceName: "AgentCloseParams", schema: AgentCloseParamsSchema },
] as const;

type Validator = ReturnType<typeof Compile>;

const validators = new Map<string, Validator>(
  toolParamSchemas.map((contract) => [contract.name, Compile(contract.schema)]),
);

export const toolNames = toolParamSchemas.map((contract) => contract.name);

export type ParsedToolParams = object;

export type ParseToolParamsResult =
  | { readonly ok: true; readonly params: ParsedToolParams }
  | { readonly ok: false; readonly error: string };

function formatValidationError(toolName: string, validator: Validator, value: unknown): string {
  let first;
  for (const error of validator.Errors(value)) {
    first = error;
    break;
  }
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
  if (
    toolName === "agent_send" &&
    typeof params === "object" &&
    params !== null
  ) {
    const record = params as { message?: unknown; description?: unknown; interrupt?: unknown };
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message === "" && record.interrupt !== true) {
      return { ok: false, error: "agent_send.message is required unless interrupt is true" };
    }
    if (message !== "" && (typeof record.description !== "string" || record.description.trim() === "")) {
      return { ok: false, error: "agent_send.description is required when message is supplied" };
    }
  }
  if (
    (toolName === "agent_spawn" || toolName === "oracle") &&
    typeof params === "object" && params !== null
  ) {
    const message = (params as { message?: unknown }).message;
    if (typeof message !== "string" || message.trim() === "") {
      return { ok: false, error: `${toolName}.message must not be empty` };
    }
  }
  if (toolName === "finder" && typeof params === "object" && params !== null) {
    const query = (params as { query?: unknown }).query;
    if (typeof query !== "string" || query.trim() === "") {
      return { ok: false, error: "finder.query must not be empty" };
    }
  }
  if (toolName === "agent_wait" && typeof params === "object" && params !== null) {
    const runIds = (params as { run_ids?: unknown }).run_ids;
    if (Array.isArray(runIds)) {
      const trimmed = runIds.map((value) => typeof value === "string" ? value.trim() : "");
      if (trimmed.some((value) => value === "")) {
        return { ok: false, error: "agent_wait.run_ids must not contain empty ids" };
      }
      if (new Set(trimmed).size !== trimmed.length) {
        return { ok: false, error: "agent_wait.run_ids must not contain duplicate ids" };
      }
    }
  }
  if (
    (toolName === "agent_send" || toolName === "agent_close") &&
    typeof params === "object" && params !== null
  ) {
    const agentId = (params as { agent_id?: unknown }).agent_id;
    if (typeof agentId !== "string" || agentId.trim() === "") {
      return { ok: false, error: `${toolName}.agent_id must not be empty` };
    }
  }
  return { ok: true, params: params as ParsedToolParams };
}

export type { ToolContract } from "./tool-contract-model.ts";
