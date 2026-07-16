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
      "Create a durable generic agent for substantial delegated execution and start its first asynchronous run. The identity retains its conversation across later agent_send calls. The call returns after the initial instruction is accepted, without waiting for completion.",
    promptSnippet: "Start a durable generic agent for substantial asynchronous execution.",
    promptGuidelines: [
      "For agent_spawn, choose tier by task complexity and scope. Use low for straightforward, well-defined work: a one-file change or simple mechanical refactor across the codebase; bounded delegated internet research; or one known check or bounded evidence collection. Use medium for well-scoped work requiring reasoning across several files; focused independent research across multiple sources; or reproducing and verifying a workflow across several components. Use high for difficult, open-ended, or repository-wide work: broad cross-cutting changes; comprehensive independent research requiring broad source synthesis; or repository-wide failure investigation and validation. Medium is the default.",
      "Use agent_spawn for substantial delegated execution that does not fit finder or oracle, especially independent multi-step work, parallel disjoint work, or work with extensive intermediate output that the parent does not need.",
      "Use agent_spawn to create a new identity when substantial delegated execution has a materially different objective, files, component, or constraints and an existing agent's retained context would not help.",
      "When using agent_spawn, remember that the child has its own conversation and does not inherit the parent conversation. Include all relevant decisions, context, constraints, and validation instructions in message, or reference paths to files that contain them.",
    ],
    parameters: toolParameters(AgentSpawnParamsSchema),
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
    parameters: toolParameters(FinderParamsSchema),
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
    parameters: toolParameters(OracleParamsSchema),
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
    parameters: toolParameters(AgentSendParamsSchema),
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
    parameters: toolParameters(AgentWaitParamsSchema),
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
    parameters: toolParameters(EmptyParamsSchema),
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
    parameters: toolParameters(AgentCloseParamsSchema),
  },
];