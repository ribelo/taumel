// Synced byte-identical from openai/codex codex-rs/core/src/tools/handlers/apply_patch.lark (2026-07-24). Re-sync: cp + diff.
import applyPatchGrammar from "./apply_patch.lark" with { type: "text" };
import type { ParseToolParamsResult, ToolContract } from "./tool-contract-model.ts";
import { parseContractParams, toolInput } from "./tool-contract-model.ts";
import {
  agentToolContracts,
} from "./tool-agent-contracts.ts";
import {
  CrawlingExaParamsSchema,
  ExaAgentCreateRunParamsSchema,
  ExaAgentListEventsParamsSchema,
  ExaAgentListRunsParamsSchema,
  ExaAgentRunIdParamsSchema,
  GetCodeContextExaParamsSchema,
  WebSearchExaParamsSchema,
} from "./tool-exa-contracts.ts";
import {
  ApplyPatchParamsSchema,
  CreateTaskParamsSchema,
  CronCreateParamsSchema,
  CronDeleteParamsSchema,
  EditParamsSchema,
  EmptyParamsSchema,
  ExecCommandParamsSchema,
  QueryThreadsParamsSchema,
  RalphTaskParamsSchema,
  ReadParamsSchema,
  ReadThreadParamsSchema,
  UpdateTaskParamsSchema,
  UpdatePlanParamsSchema,
  ViewMediaParamsSchema,
  WriteParamsSchema,
  WriteStdinParamsSchema,
} from "./tool-contracts.ts";

export const toolContracts: readonly ToolContract[] = [
  {
    name: "exec_command",
    label: "exec_command",
    description:
      "Run a shell command in a PTY. Returns completed output, or a session ID when the command is still running so it can be continued with write_stdin. Yielding does not stop the command.",
    promptSnippet: "Run shell commands in a PTY; continue live sessions with write_stdin.",
    promptGuidelines: [
      "Use exec_command for file operations like ls, rg, find, builds, tests, and development commands.",
      "Call write_stdin only when exec_command returns `Process running with session ID N`, and use that exact ID.",
      "If exec_command returns `Process exited with code N`, the command is complete; do not call write_stdin for it.",
      "Use write_stdin output_mode=status for quiet passive waits; use delta only to inspect output or send input.",
    ],
    ...toolInput(ExecCommandParamsSchema),
  },
  {
    name: "write_stdin",
    label: "write_stdin",
    description:
      "Send characters to or wait on an exec_command session and return recent output. Use output_mode=status for passive waits that should not add process output to your context; use delta only when you need to inspect the process\u2019s progress or interact with it.",
    promptSnippet: "Send input to or wait on an exec_command session.",
    ...toolInput(WriteStdinParamsSchema),
  },
  {
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply a patch to add, update, move, or delete one or more workspace files. Use the *** Begin Patch format.",
    promptSnippet: "Add, update, move, or delete workspace files with one patch.",
    ...toolInput(ApplyPatchParamsSchema),
    constrainedSampling: { type: "grammar", variants: { openai_lark: applyPatchGrammar } },
  },
  {
    name: "read",
    label: "read",
    description:
      "Read a UTF-8 text file. Output is line-numbered and truncated to 2000 lines, 50KB total, and 2000 characters per line.",
    promptSnippet: "Read a line-numbered UTF-8 text file.",
    ...toolInput(ReadParamsSchema),
  },
  {
    name: "view_media",
    label: "view_media",
    description: "View a PNG, JPEG, GIF, or WebP image.",
    promptSnippet: "View an image file.",
    ...toolInput(ViewMediaParamsSchema),
  },
  {
    name: "write",
    label: "write",
    description: "Create, overwrite, or append to a UTF-8 text file. Parent directories are created as needed.",
    promptSnippet: "Create, overwrite, or append to a text file.",
    ...toolInput(WriteParamsSchema),
  },
  {
    name: "edit",
    label: "edit",
    description: "Edit an existing text file with one or more exact text replacements.",
    promptSnippet: "Make one or more exact replacements in a text file.",
    ...toolInput(EditParamsSchema),
  },
  {
    name: "get_plan",
    label: "get_plan",
    description:
      "Get the current plan for this thread, including status, automation state, tasks, token telemetry, elapsed active time, and optional time limit.",
    promptSnippet: "Inspect the current plan, tasks, status, usage, and automation state.",
    ...toolInput(EmptyParamsSchema),
  },
  {
    name: "create_task",
    label: "create_task",
    description:
      "Create one or more tasks for the current plan. Tasks are the living breakdown of the work: order, dependencies, and completion state drive continuation and complete the plan when every task is completed or cancelled. Creating a task while no plan exists creates a draft plan; activate it with update_plan to start continuation. Tasks may be created while the plan is in draft, or to extend a completed plan once the turn in which it completed has ended; extending a completed plan reopens it to active.",
    promptSnippet: "Create one or more plan tasks while the plan is in draft or a completed plan is extension-unlocked.",
    ...toolInput(CreateTaskParamsSchema),
  },
  {
    name: "update_task",
    label: "update_task",
    description:
      "Update one task's status, title, description, or dependencies. Content edits require a draft plan; status changes require an active or draft plan. Setting in_progress requires every depended task to be completed or cancelled. Mark a task completed only when its work is verifiably done; cancel tasks that are no longer needed, stating why. User-authored task text and cancellation are reserved to the user.",
    promptSnippet: "Update one plan task's status or content within editability rules.",
    ...toolInput(UpdateTaskParamsSchema),
  },
  {
    name: "update_plan",
    label: "update_plan",
    description: "Update the plan lifecycle: activate a draft plan to commit its task list and start continuation, mark an active plan genuinely blocked, or return a blocked plan to active once its impasse is resolved. A plan completes automatically when every task is completed or cancelled.",
    promptSnippet: "Activate the plan, mark it genuinely blocked, or unblock it once the impasse is resolved.",
    ...toolInput(UpdatePlanParamsSchema),
  },
  {
    name: "cron_create",
    label: "cron.create",
    description:
      "Schedule a prompt in this Pi session with a standard 5-field cron expression evaluated in the host\u2019s local timezone. Tasks run only while the session is open.",
    promptSnippet:
      "Create a recurring or one-shot cron task. Tell the user the returned task id and that /cron manages crons.",
    ...toolInput(CronCreateParamsSchema),
  },
  {
    name: "cron_list",
    label: "cron.list",
    description: "List this Pi session\u2019s cron tasks and scheduling state.",
    promptSnippet: "List cron tasks.",
    ...toolInput(EmptyParamsSchema),
  },
  {
    name: "cron_delete",
    label: "cron.delete",
    description: "Delete a scheduled cron task by ID.",
    promptSnippet: "Delete a cron task.",
    ...toolInput(CronDeleteParamsSchema),
  },
  {
    name: "query_threads",
    label: "query_threads",
    description:
      "Search persisted Pi conversations by thread ID, title, visible messages, summaries, tool calls, tool results, and notifications. Use it to find relevant context from earlier threads before reading a specific thread with read_thread.",
    promptSnippet: "Search persisted Pi conversations for relevant prior context.",
    ...toolInput(QueryThreadsParamsSchema),
  },
  {
    name: "read_thread",
    label: "read_thread",
    description:
      "Read a persisted Pi conversation by exact thread ID, unique ID prefix, or a locator returned by query_threads. Use overview for orientation, window for context around a hit, or full for paginated transcript recovery.",
    promptSnippet: "Read context from a specific persisted Pi conversation.",
    ...toolInput(ReadThreadParamsSchema),
  },
  {
    name: "ralph_continue",
    label: "ralph_continue",
    description: "Advance Ralph session by one iteration.",
    promptSnippet: "Advance Ralph session to the next iteration.",
    ...toolInput(RalphTaskParamsSchema),
  },
  {
    name: "ralph_finish",
    label: "ralph_finish",
    description: "Finish Ralph session.",
    promptSnippet: "Finish Ralph session.",
    ...toolInput(RalphTaskParamsSchema),
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
    ...toolInput(WebSearchExaParamsSchema),
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
    ...toolInput(CrawlingExaParamsSchema, (params) =>
      ("ids" in params) === ("urls" in params)
        ? "provide either ids or urls, but not both"
        : undefined),
  },
  {
    name: "get_code_context_exa",
    label: "exa.code_context",
    description: "Get relevant code snippets and examples from Exa Code Context.",
    promptSnippet: "Search code, docs, GitHub, and Stack Overflow examples with Exa Code Context.",
    ...toolInput(GetCodeContextExaParamsSchema),
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
    ...toolInput(ExaAgentCreateRunParamsSchema),
  },
  {
    name: "exa_agent_get_run",
    label: "exa.agent.get_run",
    description: "Retrieve an Exa Agent run by ID.",
    promptSnippet: "Poll or inspect an Exa Agent run by ID.",
    ...toolInput(ExaAgentRunIdParamsSchema),
  },
  {
    name: "exa_agent_list_runs",
    label: "exa.agent.list_runs",
    description: "List Exa Agent runs for the configured team.",
    promptSnippet: "List recent Exa Agent runs.",
    ...toolInput(ExaAgentListRunsParamsSchema),
  },
  {
    name: "exa_agent_cancel_run",
    label: "exa.agent.cancel_run",
    description: "Cancel a queued or running Exa Agent run.",
    promptSnippet: "Cancel an Exa Agent run by ID.",
    ...toolInput(ExaAgentRunIdParamsSchema),
  },
  {
    name: "exa_agent_list_events",
    label: "exa.agent.list_events",
    description: "List stored events for an Exa Agent run.",
    promptSnippet: "List Exa Agent run events.",
    ...toolInput(ExaAgentListEventsParamsSchema),
  },
  ...agentToolContracts,
];

const toolContractIndex = new Map(toolContracts.map((contract) => [contract.name, contract]));
export const toolNames = toolContracts.map((contract) => contract.name);

export function toolContractByName(name: string): ToolContract {
  const contract = toolContractIndex.get(name);
  if (contract === undefined) throw new Error(`unknown Taumel tool contract: ${name}`);
  return contract;
}

export function parseToolParams(name: string, rawParams: unknown): ParseToolParamsResult {
  const contract = toolContractIndex.get(name);
  return contract === undefined
    ? { ok: false, error: `unknown tool contract: ${name}` }
    : parseContractParams(contract, rawParams);
}
