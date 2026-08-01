import Type from "typebox";
import {
  WebSearchExaParamsSchema,
  CrawlingExaParamsSchema,
  GetCodeContextExaParamsSchema,
  ExaAgentCreateRunParamsSchema,
  ExaAgentRunIdParamsSchema,
  ExaAgentListRunsParamsSchema,
  ExaAgentListEventsParamsSchema,
} from "./tool-exa-contracts.ts";
import {
  agentDtsSchemas,
  agentToolParamSchemas,
} from "./tool-agent-contracts.ts";

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

export const CreateTaskItemSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ description: "Optional explicit task identity, unique within this plan. Omit to auto-generate a task- identity." })),
    title: Type.String({ description: "Short statement of the work. Trimmed; must not be empty." }),
    description: Type.Optional(Type.String({ description: "Optional longer specification of this step." })),
    depends_on: Type.Optional(Type.Array(Type.String(), {
      description: "Task identities that must reach completed or cancelled before this task may enter in_progress. May reference identities supplied earlier in this call.",
    })),
  },
  { $id: "CreateTaskItem", additionalProperties: false },
);

export const CreateTaskParamsSchema = Type.Object(
  { tasks: Type.Array(CreateTaskItemSchema, { minItems: 1 }) },
  { $id: "CreateTaskParams", additionalProperties: false },
);

export const UpdateTaskParamsSchema = Type.Object(
  {
    taskId: Type.String(),
    status: Type.Optional(Type.Union([
      Type.Literal("pending"), Type.Literal("in_progress"),
      Type.Literal("completed"), Type.Literal("cancelled"),
    ])),
    title: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    depends_on: Type.Optional(Type.Array(Type.String())),
    reason: Type.Optional(Type.String({
      description: "Why this task is being cancelled. Required when setting status to cancelled.",
    })),
  },
  { $id: "UpdateTaskParams", additionalProperties: false },
);

export const UpdatePlanParamsSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("active"), Type.Literal("blocked")], {
      description: "Lifecycle status to set: active commits a draft plan's task list and starts continuation, or returns a blocked plan to active; blocked marks a genuine impasse requiring user input or an external-state change.",
    }),
    reason: Type.String({ minLength: 1,
      description: "Why the plan is blocked, or what resolved the impasse when returning a blocked plan to active. Required for both transitions.",
    }),
  },
  { $id: "UpdatePlanParams", additionalProperties: false },
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
        "Prompt delivered to the main session when the task fires. With plan = true, it becomes a user-authored plan task.",
    }),
    recurring: Type.Optional(
      Type.Boolean({
        description:
          "Whether the task repeats. Defaults to true; false fires once and deletes the task after delivery.",
      }),
    ),
    plan: Type.Optional(
      Type.Boolean({
        description:
          "Whether to deliver the prompt as a plan instead of a message. Defaults to false; a plan-mode fire waits while the session\u2019s plan slot is occupied.",
      }),
    ),
  },
  { $id: "CronCreateParams", additionalProperties: false },
);

export const CronDeleteParamsSchema = Type.Object(
  {
    id: Type.String({
      pattern: "^cron-[abcdefghjkmnpqrstuvwxyz23456789]{4}$",
      description: "Task ID returned by cron_create or cron_list, shaped cron-<nano-id>.",
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
  ["CreateTaskItem", CreateTaskItemSchema],
  ["CreateTaskParams", CreateTaskParamsSchema],
  ["UpdateTaskParams", UpdateTaskParamsSchema],
  ["UpdatePlanParams", UpdatePlanParamsSchema],
  ["CronCreateParams", CronCreateParamsSchema],
  ["CronDeleteParams", CronDeleteParamsSchema],
  ["ThreadLocator", ThreadLocatorSchema],
  ["QueryThreadsParams", QueryThreadsParamsSchema],
  ["ReadThreadParams", ReadThreadParamsSchema],
  ["RalphTaskParams", RalphTaskParamsSchema],
  ["WebSearchExaParams", WebSearchExaParamsSchema],
  ["CrawlingExaParams", CrawlingExaParamsSchema],
  ["GetCodeContextExaParams", GetCodeContextExaParamsSchema],
  ["ExaAgentCreateRunParams", ExaAgentCreateRunParamsSchema],
  ["ExaAgentRunIdParams", ExaAgentRunIdParamsSchema],
  ["ExaAgentListRunsParams", ExaAgentListRunsParamsSchema],
  ["ExaAgentListEventsParams", ExaAgentListEventsParamsSchema],
  ...agentDtsSchemas,
] as const;

export const toolParamSchemas = [
  { name: "exec_command", interfaceName: "ExecCommandParams", schema: ExecCommandParamsSchema },
  { name: "write_stdin", interfaceName: "WriteStdinParams", schema: WriteStdinParamsSchema },
  { name: "apply_patch", interfaceName: "ApplyPatchParams", schema: ApplyPatchParamsSchema },
  { name: "write", interfaceName: "WriteParams", schema: WriteParamsSchema },
  { name: "read", interfaceName: "ReadParams", schema: ReadParamsSchema },
  { name: "view_media", interfaceName: "ViewMediaParams", schema: ViewMediaParamsSchema },
  { name: "edit", interfaceName: "EditParams", schema: EditParamsSchema },
  { name: "get_plan", interfaceName: "EmptyParams", schema: EmptyParamsSchema },
  { name: "create_task", interfaceName: "CreateTaskParams", schema: CreateTaskParamsSchema },
  { name: "update_task", interfaceName: "UpdateTaskParams", schema: UpdateTaskParamsSchema },
  { name: "update_plan", interfaceName: "UpdatePlanParams", schema: UpdatePlanParamsSchema },
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
  ...agentToolParamSchemas,
] as const;
