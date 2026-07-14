import type { ToolContract } from "./tool-contract-model.ts";
import { toolParameters } from "./tool-contract-model.ts";
import {
  AgentCloseParamsSchema,
  AgentSendParamsSchema,
  AgentSpawnParamsSchema,
  AgentWaitParamsSchema,
  ApplyPatchParamsSchema,
  CreateGoalParamsSchema,
  CronCreateParamsSchema,
  CronDeleteParamsSchema,
  CrawlingExaParamsSchema,
  EditParamsSchema,
  EmptyParamsSchema,
  ExaAgentCreateRunParamsSchema,
  ExaAgentListEventsParamsSchema,
  ExaAgentListRunsParamsSchema,
  ExaAgentRunIdParamsSchema,
  ExecCommandParamsSchema,
  FinderParamsSchema,
  GetCodeContextExaParamsSchema,
  OracleParamsSchema,
  QueryThreadsParamsSchema,
  RalphTaskParamsSchema,
  ReadParamsSchema,
  ReadThreadParamsSchema,
  UpdateGoalParamsSchema,
  ViewMediaParamsSchema,
  WebSearchExaParamsSchema,
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
    parameters: toolParameters(ExecCommandParamsSchema),
  },
  {
    name: "write_stdin",
    label: "write_stdin",
    description:
      "Send characters to or wait on an exec_command session and return recent output. Use output_mode=status for passive waits that should not add process output to your context; use delta only when you need to inspect the process\u2019s progress or interact with it.",
    promptSnippet: "Send input to or wait on an exec_command session.",
    parameters: toolParameters(WriteStdinParamsSchema),
  },
  {
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply a patch to add, update, move, or delete one or more workspace files. Use the *** Begin Patch format.",
    promptSnippet: "Add, update, move, or delete workspace files with one patch.",
    parameters: toolParameters(ApplyPatchParamsSchema),
  },
  {
    name: "read",
    label: "read",
    description:
      "Read a UTF-8 text file. Output is line-numbered and truncated to 2000 lines, 50KB total, and 2000 characters per line.",
    promptSnippet: "Read a line-numbered UTF-8 text file.",
    parameters: toolParameters(ReadParamsSchema),
  },
  {
    name: "view_media",
    label: "view_media",
    description: "View a PNG, JPEG, GIF, or WebP image.",
    promptSnippet: "View an image file.",
    parameters: toolParameters(ViewMediaParamsSchema),
  },
  {
    name: "write",
    label: "write",
    description: "Create, overwrite, or append to a UTF-8 text file. Parent directories are created as needed.",
    promptSnippet: "Create, overwrite, or append to a text file.",
    parameters: toolParameters(WriteParamsSchema),
  },
  {
    name: "edit",
    label: "edit",
    description: "Edit an existing text file with one or more exact text replacements.",
    promptSnippet: "Make one or more exact replacements in a text file.",
    parameters: toolParameters(EditParamsSchema),
  },
  {
    name: "get_goal",
    label: "get_goal",
    description:
      "Get the current goal for this thread, including status, automation state, token telemetry, elapsed active time, and optional time limit.",
    promptSnippet: "Inspect the current goal, status, usage, and automation state.",
    parameters: toolParameters(EmptyParamsSchema),
  },
  {
    name: "create_goal",
    label: "create_goal",
    description:
      "Create a goal only when explicitly requested by the user or system/developer instructions. Set time_limit_seconds only when the user explicitly requests a time limit; do not invent or extend a time limit yourself.",
    promptSnippet: "Create an explicitly requested goal for continued work across turns.",
    parameters: toolParameters(CreateGoalParamsSchema),
  },
  {
    name: "update_goal",
    label: "update_goal",
    description: "Update the existing goal only to mark it complete or genuinely blocked.",
    promptSnippet: "Mark the active goal complete or genuinely blocked.",
    parameters: toolParameters(UpdateGoalParamsSchema),
  },
  {
    name: "cron_create",
    label: "cron.create",
    description:
      "Schedule a prompt in this Pi session with a standard 5-field cron expression evaluated in the host\u2019s local timezone. Tasks run only while the session is open.",
    promptSnippet:
      "Create a recurring or one-shot cron task. Tell the user the returned task id and that /cron manages crons.",
    parameters: toolParameters(CronCreateParamsSchema),
  },
  {
    name: "cron_list",
    label: "cron.list",
    description: "List this Pi session\u2019s cron tasks and scheduling state.",
    promptSnippet: "List cron tasks.",
    parameters: toolParameters(EmptyParamsSchema),
  },
  {
    name: "cron_delete",
    label: "cron.delete",
    description: "Delete a scheduled cron task by ID.",
    promptSnippet: "Delete a cron task.",
    parameters: toolParameters(CronDeleteParamsSchema),
  },
  {
    name: "query_threads",
    label: "query_threads",
    description:
      "Search persisted Pi conversations by thread ID, title, visible messages, summaries, tool calls, tool results, and notifications. Use it to find relevant context from earlier threads before reading a specific thread with read_thread.",
    promptSnippet: "Search persisted Pi conversations for relevant prior context.",
    parameters: toolParameters(QueryThreadsParamsSchema),
  },
  {
    name: "read_thread",
    label: "read_thread",
    description:
      "Read a persisted Pi conversation by exact thread ID, unique ID prefix, or a locator returned by query_threads. Use overview for orientation, window for context around a hit, or full for paginated transcript recovery.",
    promptSnippet: "Read context from a specific persisted Pi conversation.",
    parameters: toolParameters(ReadThreadParamsSchema),
  },
  {
    name: "ralph_continue",
    label: "ralph_continue",
    description: "Advance Ralph session by one iteration.",
    promptSnippet: "Advance Ralph session to the next iteration.",
    parameters: toolParameters(RalphTaskParamsSchema),
  },
  {
    name: "ralph_finish",
    label: "ralph_finish",
    description: "Finish Ralph session.",
    promptSnippet: "Finish Ralph session.",
    parameters: toolParameters(RalphTaskParamsSchema),
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
    parameters: toolParameters(WebSearchExaParamsSchema),
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
    parameters: toolParameters(CrawlingExaParamsSchema),
  },
  {
    name: "get_code_context_exa",
    label: "exa.code_context",
    description: "Get relevant code snippets and examples from Exa Code Context.",
    promptSnippet: "Search code, docs, GitHub, and Stack Overflow examples with Exa Code Context.",
    parameters: toolParameters(GetCodeContextExaParamsSchema),
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
    parameters: toolParameters(ExaAgentCreateRunParamsSchema),
  },
  {
    name: "exa_agent_get_run",
    label: "exa.agent.get_run",
    description: "Retrieve an Exa Agent run by ID.",
    promptSnippet: "Poll or inspect an Exa Agent run by ID.",
    parameters: toolParameters(ExaAgentRunIdParamsSchema),
  },
  {
    name: "exa_agent_list_runs",
    label: "exa.agent.list_runs",
    description: "List Exa Agent runs for the configured team.",
    promptSnippet: "List recent Exa Agent runs.",
    parameters: toolParameters(ExaAgentListRunsParamsSchema),
  },
  {
    name: "exa_agent_cancel_run",
    label: "exa.agent.cancel_run",
    description: "Cancel a queued or running Exa Agent run.",
    promptSnippet: "Cancel an Exa Agent run by ID.",
    parameters: toolParameters(ExaAgentRunIdParamsSchema),
  },
  {
    name: "exa_agent_list_events",
    label: "exa.agent.list_events",
    description: "List stored events for an Exa Agent run.",
    promptSnippet: "List Exa Agent run events.",
    parameters: toolParameters(ExaAgentListEventsParamsSchema),
  },
  {
    name: "agent_spawn",
    label: "agent.spawn",
    description:
      "Create a durable agent and start an asynchronous run for substantial delegated work that benefits from independent execution. The agent can be steered later with `agent_send`.",
    promptSnippet: "Spawn a durable, steerable agent for substantial asynchronous work.",
    parameters: toolParameters(AgentSpawnParamsSchema),
  },
  {
    name: "finder",
    label: "finder",
    description:
      "Start an asynchronous Finder specialist for conceptual, behavior-based, or multi-step codebase searches that require correlating findings across files. Use direct read or search tools when you already know the path, symbol, or exact text.",
    promptSnippet: "Start an asynchronous Finder for conceptual or multi-step codebase search.",
    parameters: toolParameters(FinderParamsSchema),
  },
  {
    name: "oracle",
    label: "oracle",
    description:
      "Start an asynchronous Oracle specialist for architecture or code review, root-cause analysis from code and runtime evidence, complex planning, or a second opinion on technical decisions. Use Oracle selectively when the problem warrants expensive independent reasoning.",
    promptSnippet:
      "Start an asynchronous Oracle for architecture, planning, review, or a technical second opinion. Use it selectively when the problem warrants expensive independent reasoning.",
    parameters: toolParameters(OracleParamsSchema),
  },
  {
    name: "agent_send",
    label: "agent.send",
    description:
      "Send an instruction to an existing open agent, resume a suspended run, steer or replace active work, or interrupt execution. A message requires a short user-facing description.",
    promptSnippet: "Send, steer, resume, or interrupt a durable agent.",
    parameters: toolParameters(AgentSendParamsSchema),
  },
  {
    name: "agent_wait",
    label: "agent.wait",
    description:
      "Race selected agent runs and return every result ready at the observation point. Omitted timeout waits indefinitely; a timeout bounds only this call and never stops the runs. Call again with returned pending_run_ids to await later completions.",
    promptSnippet: "Wait for one or more agent runs by run_id.",
    parameters: toolParameters(AgentWaitParamsSchema),
  },
  {
    name: "agent_list",
    label: "agent.list",
    description:
      "List all open agent identities owned by the current session. Returns lifecycle status, per-run turn count, and observable activity phase and timing for progress inspection. Activity describes observable execution, not inferred health or a time-based stall.",
    promptSnippet: "List owned agent identities.",
    parameters: toolParameters(EmptyParamsSchema),
  },
  {
    name: "agent_close",
    label: "agent.close",
    description:
      "Permanently close one agent identity, interrupt active execution, and remove all of its runs from current Taumel state. Closed identities cannot be resumed; use agent_send interruption for a reversible stop.",
    promptSnippet: "Close and forget one agent identity.",
    parameters: toolParameters(AgentCloseParamsSchema),
  },
];