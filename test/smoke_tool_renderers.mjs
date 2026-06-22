import { toolNames } from "../src/tool-contracts.ts";
import { renderersForTool } from "../src/tool-renderer.ts";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const theme = {
  fg: (_color, value) => value,
  bold: (value) => value,
};

const renderText = (value) => value.render(120).join("\n");
const longLines = Array.from({ length: 24 }, (_, index) => `line-${index + 1}`).join("\n");
const exaResults = Array.from({ length: 12 }, (_, index) => ({
  title: `Result ${index + 1}`,
  url: `https://example.com/${index + 1}`,
  summary: `Summary ${index + 1}`,
}));
const threadSummaries = Array.from({ length: 12 }, (_, index) => ({
  id: `thread-${index + 1}`,
  title: `Thread ${index + 1}`,
  messageCount: index + 3,
}));

function argsFor(name) {
  switch (name) {
    case "exec_command":
      return { cmd: "ls many-files" };
    case "write_stdin":
      return { session_id: 7 };
    case "apply_patch":
      return { input: "*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch" };
    case "write":
    case "edit":
      return { path: "src/example.txt", edits: [{ oldText: "a", newText: "b" }] };
    case "create_goal":
      return { objective: "ship renderer coverage" };
    case "update_goal":
      return { status: "complete" };
    case "request_user_input":
      return { questions: [{ id: "choice", header: "Choice", question: "Pick?", options: [] }] };
    case "find_thread":
      return { query: "renderer" };
    case "read_thread":
      return { threadID: "thread-1" };
    case "agent":
      return { action: "spawn", id: "worker-1" };
    case "ralph_continue":
    case "ralph_finish":
      return { task_id: "task-1" };
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return { query: "renderer test" };
    case "crawling_exa":
      return { urls: ["https://example.com"] };
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return { id: "run_1" };
    case "exa_agent_list_runs":
      return { limit: 10 };
    default:
      return {};
  }
}

function resultFor(name) {
  if (name === "exec_command" || name === "write_stdin") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, output: longLines, exitCode: 0 } };
  }
  if (name === "write") {
    return { content: [{ type: "text", text: "wrote" }], details: { ok: true, displayPath: "src/example.txt", byteLength: 42 } };
  }
  if (name === "edit") {
    return { content: [{ type: "text", text: "edited" }], details: { ok: true, displayPath: "src/example.txt", editCount: 2 } };
  }
  if (name === "apply_patch") {
    return { content: [{ type: "text", text: "Patch applied." }], details: { ok: true, affectedPaths: ["a.txt"], writes: [{ path: "a.txt", contents: "hello" }], deletes: [] } };
  }
  if (name === "get_goal" || name === "create_goal" || name === "update_goal") {
    return { content: [{ type: "text", text: "Goal updated." }], details: { ok: true, goal: { objective: "ship renderer coverage", status: "active", tokensUsed: 10, timeUsedSeconds: 2 } } };
  }
  if (name === "request_user_input") {
    return { content: [{ type: "text", text: "{}" }], details: { ok: true, answers: { choice: { answer: "Yes" } } } };
  }
  if (name === "find_thread") {
    return { content: [{ type: "text", text: "threads" }], details: { ok: true, threads: threadSummaries } };
  }
  if (name === "read_thread") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, thread: { id: "thread-1", title: "Thread 1" } } };
  }
  if (name === "agent") {
    return { content: [{ type: "text", text: "Spawned worker" }], details: { ok: true, worker: { id: "worker-1", lifecycle: "running", sandbox: "workspace-write" } } };
  }
  if (name === "ralph_continue" || name === "ralph_finish") {
    return { content: [{ type: "text", text: `${name} accepted` }], details: { ok: true, taskId: "task-1", iteration: 2, status: "running", reflection: false } };
  }
  if (name === "web_search_exa" || name === "crawling_exa") {
    return { content: [{ type: "text", text: "exa results" }], details: { ok: true, response: { results: exaResults } } };
  }
  if (name === "get_code_context_exa") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, response: { response: longLines } } };
  }
  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    return { content: [{ type: "text", text: "agent list" }], details: { ok: true, response: { data: exaResults.map((item, index) => ({ ...item, id: `run_${index + 1}`, status: "completed" })) } } };
  }
  return { content: [{ type: "text", text: "agent run" }], details: { ok: true, response: { id: "run_1", status: "completed", output: { text: longLines } } } };
}

for (const name of toolNames) {
  const renderers = renderersForTool(name);
  assert(typeof renderers.renderCall === "function", `${name} missing renderCall`);
  assert(typeof renderers.renderResult === "function", `${name} missing renderResult`);

  const args = argsFor(name);
  const call = renderText(renderers.renderCall(args, theme, { isPartial: true }));
  assert(call.includes(name), `${name} call renderer did not include name: ${call}`);

  const result = resultFor(name);
  const compact = renderText(renderers.renderResult(result, { expanded: false, isPartial: false }, theme, { args }));
  const expanded = renderText(renderers.renderResult(result, { expanded: true, isPartial: false }, theme, { args }));
  assert(compact.includes(name) || name === "write_stdin", `${name} compact renderer did not include a title: ${compact}`);
  assert(expanded.length >= compact.length, `${name} expanded renderer should be at least as informative`);
}

const shell = renderersForTool("exec_command");
const shellArgs = argsFor("exec_command");
const compactShell = renderText(shell.renderResult(resultFor("exec_command"), { expanded: false, isPartial: false }, theme, { args: shellArgs }));
const expandedShell = renderText(shell.renderResult(resultFor("exec_command"), { expanded: true, isPartial: false }, theme, { args: shellArgs }));
assert(!/(^|\n)\s*line-1\s*(\n|$)/.test(compactShell) && compactShell.includes("earlier lines"), `shell output was not compacted: ${compactShell}`);
assert(/(^|\n)\s*line-1\s*(\n|$)/.test(expandedShell), `expanded shell output did not include earlier output: ${expandedShell}`);

const exa = renderersForTool("web_search_exa");
const compactExa = renderText(exa.renderResult(resultFor("web_search_exa"), { expanded: false, isPartial: false }, theme, { args: argsFor("web_search_exa") }));
const expandedExa = renderText(exa.renderResult(resultFor("web_search_exa"), { expanded: true, isPartial: false }, theme, { args: argsFor("web_search_exa") }));
assert(!compactExa.includes("Result 10") && compactExa.includes("more"), `Exa output was not compacted: ${compactExa}`);
assert(expandedExa.includes("Result 10"), `expanded Exa output did not include more results: ${expandedExa}`);
