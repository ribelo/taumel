/** Exact model-facing strings from plans/ (baseline 15dccb6). */
export const TOOL_DESCRIPTIONS = {
  "exec_command":
    "Run a shell command in a PTY. Returns completed output, or a session ID when the command is still running so it can be continued with write_stdin. Yielding does not stop the command.",
  "write_stdin":
    "Send characters to or wait on an exec_command session and return recent output. Use output_mode=status for passive waits that should not add process output to your context; use delta only when you need to inspect the process\u2019s progress or interact with it.",
  "apply_patch":
    "Apply a patch to add, update, move, or delete one or more workspace files. Use the *** Begin Patch format.",
  "read": "Read a UTF-8 text file. Output is line-numbered and truncated to 2000 lines, 50KB total, and 2000 characters per line.",
  "view_media": "View a PNG, JPEG, GIF, or WebP image.",
  "write": "Create, overwrite, or append to a UTF-8 text file. Parent directories are created as needed.",
  "edit": "Edit an existing text file with one or more exact text replacements.",
  "get_goal":
    "Get the current goal for this thread, including status, automation state, token telemetry, elapsed active time, and optional time limit.",
  "create_goal":
    "Create a goal only when explicitly requested by the user or system/developer instructions. Set time_limit_seconds only when the user explicitly requests a time limit; do not invent or extend a time limit yourself.",
  "update_goal": "Update the existing goal only to mark it complete or genuinely blocked.",
  "cron_create":
    "Schedule a prompt in this Pi session with a standard 5-field cron expression evaluated in the host\u2019s local timezone. Tasks run only while the session is open.",
  "cron_list": "List this Pi session\u2019s cron tasks and scheduling state.",
  "cron_delete": "Delete a scheduled cron task by ID.",
  "query_threads":
    "Search persisted Pi conversations by thread ID, title, visible messages, summaries, tool calls, tool results, and notifications. Use it to find relevant context from earlier threads before reading a specific thread with read_thread.",
  "read_thread":
    "Read a persisted Pi conversation by exact thread ID, unique ID prefix, or a locator returned by query_threads. Use overview for orientation, window for context around a hit, or full for paginated transcript recovery.",
  "ralph_continue": "Advance Ralph session by one iteration.",
  "ralph_finish": "Finish Ralph session.",
  "web_search_exa":
    "Search Exa's web index and optionally extract highlights, summaries, or text from the results.",
};

export const PROMPT_SNIPPETS = {
  "exec_command": "Run shell commands in a PTY; continue live sessions with write_stdin.",
  "write_stdin": "Send input to or wait on an exec_command session.",
  "apply_patch": "Add, update, move, or delete workspace files with one patch.",
  "read": "Read a line-numbered UTF-8 text file.",
  "view_media": "View an image file.",
  "write": "Create, overwrite, or append to a text file.",
  "edit": "Make one or more exact replacements in a text file.",
  "get_goal": "Inspect the current goal, status, usage, and automation state.",
  "create_goal": "Create an explicitly requested goal for continued work across turns.",
  "update_goal": "Mark the active goal complete or genuinely blocked.",
  "cron_create":
    "Create a recurring or one-shot cron task. Tell the user the returned task id and that /cron manages crons.",
  "cron_list": "List cron tasks.",
  "cron_delete": "Delete a cron task.",
  "query_threads": "Search persisted Pi conversations for relevant prior context.",
  "read_thread": "Read context from a specific persisted Pi conversation.",
  "ralph_continue": "Advance Ralph session to the next iteration.",
  "ralph_finish": "Finish Ralph session.",
  "web_search_exa": "Search Exa's web index for current web, paper, company, people, and news results.",
};

export const PARAM_DESCRIPTIONS = {
  "query_threads.query":
    "Text to find in persisted conversations. Matching is case-insensitive substring search, not regex or a query language. Maximum 500 characters.",
  "query_threads.limit": "Maximum number of threads to return. Defaults to 10; accepts 1\u201350.",
  "query_threads.scope":
    "Where to search. current_workspace searches threads associated with your current workspace and is the default; all searches all persisted threads.",
  "query_threads.includeTools":
    "Whether to search tool calls, tool results, and notifications. Defaults to true.",
  "read_thread.threadID":
    "Exact thread ID or unique ID prefix. Required unless locator supplies the thread ID.",
  "read_thread.locator":
    "Exact hit locator returned by query_threads. Use with mode = window to read context around that hit.",
  "read_thread.locator.threadID": "Thread ID carried by the locator.",
  "read_thread.locator.sourcePath":
    "Persisted source path carried by the locator for exact source recovery. Copy it unchanged.",
  "read_thread.locator.entryID": "Persisted entry ID identifying the matched event.",
  "read_thread.locator.line":
    "Persisted JSONL line number used as a fallback locator for the matched event.",
  "read_thread.entryID": "Entry ID to target when using mode = window without a locator.",
  "read_thread.line":
    "Persisted JSONL line number to target when using mode = window without a locator.",
  "read_thread.mode":
    "What to read: overview returns bounded metadata, summaries, and recent entries and is the default; window returns context around a locator, entry ID, or line; full returns a paginated visible transcript.",
  "read_thread.around":
    "Number of visible entries to include before and after a window target. Defaults to 3; accepts 0\u201310.",
  "read_thread.cursor":
    "Opaque cursor returned by a previous full response. Use only with mode = full; omit it for the first page.",
  "cron_create.cron":
    "Standard 5-field cron expression: minute, hour, day of month, month, and day of week. Evaluated in the host\u2019s local timezone.",
  "cron_create.prompt":
    "Prompt delivered to the main session when the task fires. With goal = true, it becomes the goal objective.",
  "cron_create.recurring":
    "Whether the task repeats. Defaults to true; false fires once and deletes the task after delivery.",
  "cron_create.goal":
    "Whether to deliver the prompt as a goal instead of a message. Defaults to false; a goal-mode fire waits while the session\u2019s goal slot is occupied.",
  "cron_delete.id":
    "Eight-character lowercase hexadecimal task ID returned by cron_create or cron_list.",
  "create_goal.objective":
    "The objective to pursue across turns. Preserve the user\u2019s full requested outcome, scope, constraints, and completion criteria.",
  "create_goal.time_limit_seconds":
    "User-requested active-time limit in seconds. Minimum 1. Omit unless the user explicitly requested it.",
  "update_goal.status":
    "Terminal status to set. Use complete only when every required outcome is satisfied; use blocked only at a genuine impasse requiring user input or an external-state change.",
  "ralph_continue.task_id": "Ralph task ID from the Ralph session prompt.",
  "ralph_finish.task_id": "Ralph task ID from the Ralph session prompt.",
  "exec_command.workdir": "Working directory for the command. Omit to use the current turn working directory.",
  "exec_command.yield_time_ms":
    "Milliseconds to wait for output before yielding. Defaults to 10000; rounded to an integer; minimum 250; maximum 30000. Yielding leaves a live command running.",
  "exec_command.max_output_tokens":
    "Approximate returned-output limit. Defaults to 10000 and truncates excess model-visible output without changing the command-output safety ceiling.",
  "exec_command.with_escalated_permissions":
    "When true, requests execution outside sandbox restrictions. May require approval or be denied.",
  "exec_command.justification":
    "One-sentence explanation of why escalated permissions are needed. Supply only when with_escalated_permissions is true.",
  "write_stdin.session_id": "Exact session id returned by exec_command.",
  "write_stdin.chars": "Characters sent verbatim. Omit or use an empty string to poll without writing.",
  "write_stdin.yield_time_ms":
    "Milliseconds to wait; yielding leaves the process running. Delta-mode writes and polls default to 250 and accept 250\u201330000. Empty status-mode waits default to 5000 and accept 5000\u2013300000.",
  "write_stdin.max_output_tokens":
    "Approximate returned-output limit. Defaults to 10000 and truncates excess model-visible output.",
  "write_stdin.output_mode":
    "delta returns output to your context and permits interaction; status silently drains output during an empty-input passive wait. Omit to default to delta.",
  "web_search_exa.query":
    "Search query or question. Be specific about the desired facts, entities, sources, or time range. Maximum 2,000 characters.",
  "web_search_exa.type": "Search mode controlling latency and depth. Omit to let Exa choose.",
  "web_search_exa.numResults":
    "Number of results to return. Defaults to 10; accepts 1\u2013100, with lower limits for some search modes.",
  "web_search_exa.includeDomains":
    "Domains allowed in results; when set, results come only from these domains.",
  "web_search_exa.additionalQueries": "Additional query variants for deep search. Accepts 1\u201310.",
  "web_search_exa.systemPrompt": "Additional instructions controlling deep-search behavior.",
  "crawling_exa.ids": "Exa document IDs to fetch. Accepts 1\u2013100.",
  "crawling_exa.urls": "Page URLs to fetch. Accepts 1\u2013100.",
  "get_code_context_exa.query":
    "Code or API question to research. Include relevant language, framework, library, symbols, and desired examples. Maximum 2,000 characters.",
  "get_code_context_exa.tokensNum":
    "Approximate output-token budget, or dynamic to let Exa choose. Accepts 50\u2013100,000.",
  "exa_agent_create_run.query":
    "Research or extraction task for the Exa Agent. State the desired outcome, scope, source expectations, and completion criteria.",
  "exa_agent_get_run.id": "Exa Agent run ID returned by exa_agent_create_run or exa_agent_list_runs.",
  "edit.edits": "One or more non-overlapping replacements, all matched against the original file.",
  "apply_patch.input": "The complete patch in *** Begin Patch format.",
  "read.path":
    "Path to the UTF-8 text file to read, relative to the current working directory or absolute.",
  "read.offset":
    "1-indexed line at which to start. Omit to start at line 1; a negative value starts that many lines from the end of the file.",
  "read.limit":
    "Maximum number of lines to return. Omit to read from offset to the end of the file, subject to the tool's truncation limits.",
  "view_media.path": "Path to the image, relative to the current working directory or absolute.",
  "edit.path":
    "Path to the existing UTF-8 text file to edit, relative to the current working directory or absolute.",
  "write.path": "Path to the file, relative to the current working directory or absolute.",
  "write.content": "UTF-8 text to write exactly as provided.",
  "write.mode":
    "Write behavior: overwrite (default) replaces the file; append adds content at the end without inserting a newline.",
};

/** requirement ID -> key in TOOL_DESCRIPTIONS, PROMPT_SNIPPETS, or PARAM_DESCRIPTIONS */
export const REQUIREMENT_CHECKS = [
  ["exec-tc10", "tool", "exec_command"],
  ["exec-tc20", "snippet", "exec_command"],
  ["exec-tc11", "tool", "write_stdin"],
  ["exec-tc26", "snippet", "write_stdin"],
  ["sandbox-tl07", "tool", "apply_patch"],
  ["sandbox-tl10", "snippet", "apply_patch"],
  ["sandbox-tl08", "param", "apply_patch.input"],
  ["sandbox-tl11", "tool", "read"],
  ["sandbox-tl16", "snippet", "read"],
  ["sandbox-tl17", "tool", "view_media"],
  ["sandbox-tl20", "snippet", "view_media"],
  ["sandbox-tl21", "tool", "edit"],
  ["sandbox-tl27", "snippet", "edit"],
  ["sandbox-tl28", "tool", "write"],
  ["sandbox-tl33", "snippet", "write"],
  ["goal-gt04", "tool", "get_goal"],
  ["goal-gt05", "snippet", "get_goal"],
  ["goal-gt06", "tool", "create_goal"],
  ["goal-gt09", "snippet", "create_goal"],
  ["goal-gt07", "param", "create_goal.objective"],
  ["goal-gt08", "param", "create_goal.time_limit_seconds"],
  ["goal-gt10", "tool", "update_goal"],
  ["goal-gt12", "snippet", "update_goal"],
  ["goal-gt11", "param", "update_goal.status"],
  ["cron-tl05", "tool", "cron_create"],
  ["cron-tl10", "snippet", "cron_create"],
  ["cron-tl06", "param", "cron_create.cron"],
  ["cron-tl07", "param", "cron_create.prompt"],
  ["cron-tl08", "param", "cron_create.recurring"],
  ["cron-tl09", "param", "cron_create.goal"],
  ["cron-tl11", "tool", "cron_list"],
  ["cron-tl12", "tool", "cron_delete"],
  ["cron-tl13", "param", "cron_delete.id"],
  ["cron-tl14", "snippet", "cron_delete"],
  ["threads-tl04", "tool", "query_threads"],
  ["threads-tl09", "snippet", "query_threads"],
  ["threads-tl05", "param", "query_threads.query"],
  ["threads-tl06", "param", "query_threads.limit"],
  ["threads-tl07", "param", "query_threads.scope"],
  ["threads-tl08", "param", "query_threads.includeTools"],
  ["threads-tl10", "tool", "read_thread"],
  ["threads-tl22", "snippet", "read_thread"],
  ["threads-tl11", "param", "read_thread.threadID"],
  ["threads-tl12", "param", "read_thread.locator"],
  ["threads-tl13", "param", "read_thread.locator.threadID"],
  ["threads-tl14", "param", "read_thread.locator.sourcePath"],
  ["threads-tl15", "param", "read_thread.locator.entryID"],
  ["threads-tl16", "param", "read_thread.locator.line"],
  ["threads-tl17", "param", "read_thread.entryID"],
  ["threads-tl18", "param", "read_thread.line"],
  ["threads-tl19", "param", "read_thread.mode"],
  ["threads-tl20", "param", "read_thread.around"],
  ["threads-tl21", "param", "read_thread.cursor"],
  ["ralph-tl01", "tool", "ralph_continue"],
  ["ralph-tl02", "tool", "ralph_finish"],
  ["ralph-tl03", "param", "ralph_continue.task_id"],
  ["ralph-tl03", "param", "ralph_finish.task_id"],
  ["exa-tl03", "tool", "web_search_exa"],
  ["exa-tl03", "snippet", "web_search_exa"],
  ["sandbox-tl12", "param", "read.path"],
  ["sandbox-tl13", "param", "read.offset"],
  ["sandbox-tl14", "param", "read.limit"],
  ["sandbox-tl18", "param", "view_media.path"],
  ["sandbox-tl22", "param", "edit.path"],
  ["sandbox-tl29", "param", "write.path"],
  ["sandbox-tl30", "param", "write.content"],
  ["sandbox-tl31", "param", "write.mode"],
  ["sandbox-tl23", "param", "edit.edits"],
  ["exec-tc16", "param", "exec_command.workdir"],
  ["exec-tc17", "param", "exec_command.yield_time_ms"],
  ["exec-tc18", "param", "exec_command.max_output_tokens"],
  ["exec-tc19", "param", "exec_command.with_escalated_permissions"],
  ["exec-tc19", "param", "exec_command.justification"],
  ["exec-tc21", "param", "write_stdin.session_id"],
  ["exec-tc22", "param", "write_stdin.chars"],
  ["exec-tc23", "param", "write_stdin.yield_time_ms"],
  ["exec-tc24", "param", "write_stdin.max_output_tokens"],
  ["exec-tc25", "param", "write_stdin.output_mode"],
  ["exa-tl04", "param", "web_search_exa.query"],
  ["exa-tl04", "param", "web_search_exa.type"],
  ["exa-tl04", "param", "web_search_exa.numResults"],
  ["exa-tl05", "param", "web_search_exa.includeDomains"],
  ["exa-tl06", "param", "web_search_exa.additionalQueries"],
  ["exa-tl06", "param", "web_search_exa.systemPrompt"],
  ["exa-tl09", "param", "crawling_exa.ids"],
  ["exa-tl09", "param", "crawling_exa.urls"],
  ["exa-tl10", "param", "get_code_context_exa.query"],
  ["exa-tl10", "param", "get_code_context_exa.tokensNum"],
  ["exa-tl11", "param", "exa_agent_create_run.query"],
  ["exa-tl12", "param", "exa_agent_get_run.id"],
];