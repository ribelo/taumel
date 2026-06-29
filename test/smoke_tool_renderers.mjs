import { toolNames } from "../src/tool-contracts.ts";
import { notificationMessageRenderer, renderersForTool } from "../src/tool-renderer.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Identity theme: fg returns the value unchanged so assertions can read the
// rendered text directly (the `•` dot carries no inline color marker).
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
    case "find_thread":
      return { query: "renderer" };
    case "read_thread":
      return { threadID: "thread-1" };
    case "agent_spawn":
      return { profile: "finder", objective: "inspect renderer coverage" };
    case "agent_send":
      return { agent_id: "worker-1", message: "continue" };
    case "agent_wait":
      return { agent_ids: ["worker-1"], timeout_seconds: 0 };
    case "agent_list":
      return { include_closed: false };
    case "agent_close":
      return { agent_ids: ["worker-1"] };
    case "agent_profiles":
      return {};
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
    return { content: [{ type: "text", text: "wrote" }], details: { ok: true, displayPath: "src/example.txt", mode: "overwrite", contents: longLines, byteLength: 42 } };
  }
  if (name === "edit") {
    return { content: [{ type: "text", text: "edited" }], details: { ok: true, displayPath: "src/example.txt", editCount: 1, before: "line one\nline two\nline three", after: "line one\nline TWO\nline three" } };
  }
  if (name === "apply_patch") {
    return { content: [{ type: "text", text: "Patch applied." }], details: { ok: true, affectedPaths: ["a.txt"], writes: [{ path: "a.txt", before: "alpha\nbeta", contents: "alpha\nBETA\ngamma" }], deletes: [] } };
  }
  if (name === "get_goal" || name === "create_goal" || name === "update_goal") {
    return { content: [{ type: "text", text: "Goal updated." }], details: { ok: true, goal: { objective: "ship renderer coverage", status: "active", tokensUsed: 10, timeUsedSeconds: 2 } } };
  }
  if (name === "find_thread") {
    return { content: [{ type: "text", text: "threads" }], details: { ok: true, threads: threadSummaries } };
  }
  if (name === "read_thread") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, thread: { id: "thread-1", title: "Thread 1" } } };
  }
  if (name.startsWith("agent_")) {
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

// Structural invariants for every tool: yellow-dot in-flight call header, and a
// `• name · …` green/red-dot result header in both collapsed and expanded form.
for (const name of toolNames) {
  const renderers = renderersForTool(name);
  assert(typeof renderers.renderCall === "function", `${name} missing renderCall`);
  assert(typeof renderers.renderResult === "function", `${name} missing renderResult`);

  const args = argsFor(name);
  const call = renderText(renderers.renderCall(args, theme, { isPartial: true }));
  assert(call.startsWith("•"), `${name} call header should start with the • dot: ${call}`);
  assert(call.includes(name), `${name} call header should name the tool: ${call}`);
  assert(/\(running\)|\(searching threads\)|\(reading thread\)|\(reading\)|\(waiting\)|\(waiting for Exa\)/.test(call), `${name} call header should carry a dim progress suffix: ${call}`);

  const result = resultFor(name);
  const compact = renderText(renderers.renderResult(result, { expanded: false, isPartial: false }, theme, { args }));
  const expanded = renderText(renderers.renderResult(result, { expanded: true, isPartial: false }, theme, { args }));
  assert(compact.startsWith("•"), `${name} compact header should start with the • dot: ${compact}`);
  assert(compact.includes(name), `${name} compact header should name the tool: ${compact}`);
  assert(expanded.length >= compact.length, `${name} expanded renderer should be at least as informative`);
}

// exec_command / write_stdin — in-flight header and tail-oriented body.
assert(
  /• exec_command · ls many-files \(running\)/.test(renderText(renderersForTool("exec_command").renderCall({ cmd: "ls many-files" }, theme, { isPartial: true }))),
  "exec_command call should be `• exec_command · <cmd> (running)` with no $ prefix",
);
assert(
  /• write_stdin · poll session 7 \(running\)/.test(renderText(renderersForTool("write_stdin").renderCall({ session_id: 7 }, theme, { isPartial: true }))),
  "write_stdin poll call should be `• write_stdin · poll session N (running)`",
);

const shell = renderersForTool("exec_command");
const shellArgs = argsFor("exec_command");
const compactShell = renderText(shell.renderResult(resultFor("exec_command"), { expanded: false, isPartial: false }, theme, { args: shellArgs }));
const expandedShell = renderText(shell.renderResult(resultFor("exec_command"), { expanded: true, isPartial: false }, theme, { args: shellArgs }));
assert(compactShell.startsWith("• exec_command · ls many-files"), `exec compact header wrong: ${compactShell}`);
assert(compactShell.includes("  └ "), `exec compact body should use the └ connector: ${compactShell}`);
assert(compactShell.includes("… 19 more lines"), `exec tail body should show … N more lines at the top: ${compactShell}`);
assert(!/(^|\n)\s*line-1\s*(\n|$)/.test(compactShell), `exec tail body should clip the head: ${compactShell}`);
assert(/(^|\n)\s*line-24\s*(\n|$)/.test(compactShell), `exec tail body should keep the tail: ${compactShell}`);
assert(/(^|\n).*line-24\b/.test(expandedShell), `exec expanded body should include earlier output: ${expandedShell}`);

// Failed exec → red dot, no exit code repeated in the subject.
const failedShell = renderText(shell.renderResult({ content: [], details: { ok: false, output: "boom", exitCode: 2 } }, { expanded: false, isPartial: false }, theme, { args: shellArgs }));
assert(failedShell.startsWith("• exec_command · ls many-files"), `failed exec header should keep the command subject: ${failedShell}`);
assert(!/exit 2/.test(failedShell), `failed exec should not repeat the exit code in the subject (red dot signals it): ${failedShell}`);

// Running async session → yellow dot + `(session N)` in the subject, no body.
const runningSession = renderText(shell.renderResult({ content: [], details: { ok: true, sessionId: 4 } }, { expanded: false, isPartial: false }, theme, { args: shellArgs }));
assert(/• exec_command · ls many-files \(session 4\)/.test(runningSession) && !runningSession.includes("\n"), `running session should be a yellow-dot header with (session N) and no body: ${runningSession}`);

// Width-aware layout: a long command must clip to ONE physical header line when
// collapsed (the original wrapping nitpick), and wrap under the subject-start
// indent when expanded. Body lines clip (collapsed) / wrap (expanded) to width.
{
  const longCmd = 'cd /home/ribelo/projects/ribelo/taumel && git status --short && echo "=== recent log ===" && git log --oneline -8';
  const longTail = Array.from({ length: 12 }, (_, index) => `cf4af${index} Harden subagent notification delivery ${index}`).join("\n");
  const longRes = { content: [], details: { ok: true, output: longTail, exitCode: 0 } };
  for (const width of [64, 80, 120]) {
    const collapsed = renderersForTool("exec_command").renderResult(longRes, { expanded: false, isPartial: false }, theme, { args: { cmd: longCmd } }).render(width);
    assert(collapsed.length > 1 && visibleWidth(collapsed[0]) <= width && collapsed[0].includes("…"), `collapsed exec header must be one line clipped to width ${width}: ${JSON.stringify(collapsed[0])}`);
    assert(collapsed[1].startsWith("  └ "), `collapsed exec body must start with the └ rail: ${JSON.stringify(collapsed[1])}`);
    const expanded = renderersForTool("exec_command").renderResult(longRes, { expanded: true, isPartial: false }, theme, { args: { cmd: longCmd } }).render(width);
    // Expanded header wraps the full command across several lines, continuation
    // indented to the subject-start column, before the body rail.
    const subjectStart = visibleWidth(`• exec_command · `);
    const contIndent = expanded[1].match(/^ +/)?.[0].length ?? -1;
    assert(expanded.length > 3 && contIndent === subjectStart, `expanded exec header must wrap under the subject-start indent (${subjectStart}), got ${contIndent}: ${JSON.stringify(expanded.slice(0, 2))}`);
    assert(expanded[expanded.length - 1].startsWith("    "), `expanded exec body continuation must use the 4-space rail indent`);
  }
}

// write — content head + `(N lines)`.
const writeCompact = renderText(renderersForTool("write").renderResult(resultFor("write"), { expanded: false, isPartial: false }, theme, { args: argsFor("write") }));
assert(/• write · src\/example\.txt \(24 lines\)/.test(writeCompact), `write subject should be path (N lines): ${writeCompact}`);
assert(writeCompact.includes("  └ "), `write compact should preview the content head via └: ${writeCompact}`);

// edit — Codex-parity unified diff with line-number gutter and +/- markers.
const editCompact = renderText(renderersForTool("edit").renderResult(resultFor("edit"), { expanded: false, isPartial: false }, theme, { args: argsFor("edit") }));
const editExpanded = renderText(renderersForTool("edit").renderResult(resultFor("edit"), { expanded: true, isPartial: false }, theme, { args: argsFor("edit") }));
assert(/• edit · src\/example\.txt \(\+1 -1\)/.test(editCompact), `edit subject should carry (+N -M): ${editCompact}`);
assert(editCompact.includes("- line two"), `edit diff should show a removed (-) line: ${editCompact}`);
assert(editCompact.includes("+ line TWO"), `edit diff should show an added (+) line: ${editCompact}`);
assert(editExpanded.length >= editCompact.length, `edit expanded should be at least as informative`);
assert(!editCompact.includes("  └ "), `edit body should use the line-number gutter, not the └ connector`);

// Pure addition → 5 diff-body rows (2 context + 1 added + 2 context), excluding the header row.
const addEditResult = {
  content: [{ type: "text", text: "edited" }],
  details: { ok: true, displayPath: "src/mid.ts", before: "a\nb\nc\nd\ne", after: "a\nb\nNEW\nc\nd\ne" },
};
const addEditCompact = renderText(renderersForTool("edit").renderResult(addEditResult, { expanded: false, isPartial: false }, theme, { args: { path: "src/mid.ts" } }));
const addEditDiffLines = addEditCompact.split("\n").filter((line) => /^\s+\d+\s+[+\- ]/.test(line));
assert(addEditDiffLines.length === 5, `pure addition should render 5 diff-body rows (2 context + 1 added + 2 context), excluding the header row: ${addEditCompact}`);
assert(/• edit · src\/mid\.ts \(\+1 -0\)/.test(addEditCompact), `addition edit subject should be (+1 -0): ${addEditCompact}`);

// Single-line replacement (the common case) → 6 diff-body rows (2 context + 1 removed + 1 added + 2 context),
// because unified diff shows the old and new lines as separate rows.
const replaceEditResult = {
  content: [{ type: "text", text: "edited" }],
  details: { ok: true, displayPath: "src/mid.ts", before: "a\nb\nOLD\nc\nd\ne", after: "a\nb\nNEW\nc\nd\ne" },
};
const replaceEditCompact = renderText(renderersForTool("edit").renderResult(replaceEditResult, { expanded: false, isPartial: false }, theme, { args: { path: "src/mid.ts" } }));
const replaceEditDiffLines = replaceEditCompact.split("\n").filter((line) => /^\s+\d+\s+[+\- ]/.test(line));
assert(replaceEditDiffLines.length === 6, `single-line replacement should render 6 diff-body rows (2 context + 1 removed + 1 added + 2 context): ${replaceEditCompact}`);
assert(/• edit · src\/mid\.ts \(\+1 -1\)/.test(replaceEditCompact), `replacement edit subject should be (+1 -1): ${replaceEditCompact}`);
assert(replaceEditCompact.includes("- OLD"), `replacement edit should show the removed (-) line: ${replaceEditCompact}`);
assert(replaceEditCompact.includes("+ NEW"), `replacement edit should show the added (+) line: ${replaceEditCompact}`);

// apply_patch — single-file collapsed renders like edit (inline diff); expanded full diff.
const patchCompact = renderText(renderersForTool("apply_patch").renderResult(resultFor("apply_patch"), { expanded: false, isPartial: false }, theme, { args: argsFor("apply_patch") }));
const patchExpanded = renderText(renderersForTool("apply_patch").renderResult(resultFor("apply_patch"), { expanded: true, isPartial: false }, theme, { args: argsFor("apply_patch") }));
assert(/• apply_patch · a\.txt \(\+2 -1\)/.test(patchCompact), `apply_patch single-file subject should be the path (+A -R): ${patchCompact}`);
assert(patchCompact.includes("- beta"), `apply_patch collapsed should show the removed line: ${patchCompact}`);
assert(patchCompact.includes("+ BETA"), `apply_patch collapsed should show the added line: ${patchCompact}`);
assert(!patchCompact.includes("  └ "), `apply_patch single-file body should use the line-number gutter, not the └ connector: ${patchCompact}`);
assert(patchExpanded.includes("+ BETA") && patchExpanded.includes("- beta"), `apply_patch expanded should render the full diff: ${patchExpanded}`);

// read — collapsed is a single header line; expanded shows the body head-oriented.
const readResult = {
  content: [{ type: "text", text: "1\talpha\n2\tbeta\n3\tgamma" }],
  details: { ok: true, path: "src/x.ts", totalLines: 3, startLine: 1, shownLines: 3, truncated: false },
};
const readRenderer = renderersForTool("read");
const compactRead = renderText(readRenderer.renderResult(readResult, { expanded: false, isPartial: false }, theme, { args: { path: "src/x.ts" } }));
const expandedRead = renderText(readRenderer.renderResult(readResult, { expanded: true, isPartial: false }, theme, { args: { path: "src/x.ts" } }));
assert(/• read · src\/x\.ts \(3 lines\)/.test(compactRead) && !compactRead.includes("\n"), `read collapsed should be a single header line: ${compactRead}`);
assert(expandedRead.includes("alpha") && expandedRead.includes("gamma") && expandedRead.length > compactRead.length, `read expanded should show the body: ${expandedRead}`);
// Truncated read → `… N more lines` at the bottom.
const truncatedRead = renderText(readRenderer.renderResult(
  { content: [{ type: "text", text: "1\talpha\n2\tbeta" }], details: { ok: true, path: "big.ts", totalLines: 10, shownLines: 2 } },
  { expanded: true, isPartial: false }, theme, { args: { path: "big.ts" } },
));
assert(truncatedRead.includes("… 8 more lines"), `truncated read should append … N more lines at the bottom: ${truncatedRead}`);

// Collection — collapsed top 3 + `… N more`, `idx · title · meta` one line each.
const findCompact = renderText(renderersForTool("find_thread").renderResult(resultFor("find_thread"), { expanded: false, isPartial: false }, theme, { args: argsFor("find_thread") }));
const findExpanded = renderText(renderersForTool("find_thread").renderResult(resultFor("find_thread"), { expanded: true, isPartial: false }, theme, { args: argsFor("find_thread") }));
assert(/• find_thread · "renderer" \(12 results\)/.test(findCompact), `find_thread subject should be "query" (N results): ${findCompact}`);
assert(findCompact.includes("  └ 1 · Thread 1 · 3 msgs"), `find_thread collapsed first item should be idx · title · meta: ${findCompact}`);
assert(!findCompact.includes("Thread 4") && findCompact.includes("… 9 more"), `find_thread collapsed should clip to top 3 with … N more: ${findCompact}`);
assert(findExpanded.includes("Thread 4"), `find_thread expanded should include more results: ${findExpanded}`);

// Single-entity — header + dim facts line.
const goalCompact = renderText(renderersForTool("create_goal").renderResult(resultFor("create_goal"), { expanded: false, isPartial: false }, theme, { args: argsFor("create_goal") }));
assert(/• create_goal · ship renderer coverage/.test(goalCompact), `create_goal subject should be the objective: ${goalCompact}`);
assert(goalCompact.includes("  └ active · 10 tokens · 2s"), `create_goal facts line should be dim ·-joined: ${goalCompact}`);

const spawnCompact = renderText(renderersForTool("agent_spawn").renderResult(resultFor("agent_spawn"), { expanded: false, isPartial: false }, theme, { args: argsFor("agent_spawn") }));
assert(/• agent_spawn · finder/.test(spawnCompact) && spawnCompact.includes("  └ run worker-1 · running"), `agent_spawn facts should be run <id> · <lifecycle>: ${spawnCompact}`);

// Exa search — collapsed top 3 `idx · title · domain` (domain, not full URL).
const exa = renderersForTool("web_search_exa");
const compactExa = renderText(exa.renderResult(resultFor("web_search_exa"), { expanded: false, isPartial: false }, theme, { args: argsFor("web_search_exa") }));
const expandedExa = renderText(exa.renderResult(resultFor("web_search_exa"), { expanded: true, isPartial: false }, theme, { args: argsFor("web_search_exa") }));
assert(/• web_search_exa · "renderer test" \(12 results\)/.test(compactExa), `web_search_exa subject wrong: ${compactExa}`);
assert(compactExa.includes("  └ 1 · Result 1 · example.com"), `web_search_exa collapsed item should use the URL domain: ${compactExa}`);
assert(!compactExa.includes("Result 4") && compactExa.includes("… 9 more"), `web_search_exa collapsed should clip to top 3: ${compactExa}`);
assert(expandedExa.includes("Result 4") && expandedExa.includes("https://example.com/1"), `web_search_exa expanded should show more results with full url: ${expandedExa}`);

// get_code_context_exa — body tool (head-oriented), not a collection.
const codeCompact = renderText(renderersForTool("get_code_context_exa").renderResult(resultFor("get_code_context_exa"), { expanded: false, isPartial: false }, theme, { args: argsFor("get_code_context_exa") }));
assert(/• get_code_context_exa · "renderer test"/.test(codeCompact), `get_code_context_exa subject should be the quoted query: ${codeCompact}`);
assert(codeCompact.includes("  └ "), `get_code_context_exa should render a body block: ${codeCompact}`);

// exa_agent_get_run — single entity `<id> · <status>`; output.text full when expanded.
const runCompact = renderText(renderersForTool("exa_agent_get_run").renderResult(resultFor("exa_agent_get_run"), { expanded: false, isPartial: false }, theme, { args: argsFor("exa_agent_get_run") }));
const runExpanded = renderText(renderersForTool("exa_agent_get_run").renderResult(resultFor("exa_agent_get_run"), { expanded: true, isPartial: false }, theme, { args: argsFor("exa_agent_get_run") }));
assert(/• exa_agent_get_run · run_1 · completed/.test(runCompact), `exa_agent_get_run subject should be id · status: ${runCompact}`);
assert(!runCompact.includes("line-1") && runExpanded.includes("line-1"), `exa_agent_get_run should only show output.text when expanded: ${runExpanded}`);

// taumel.notification — exec_completion + agent_completion.
const renderNotification = notificationMessageRenderer();
const execNote = [
  '<taumel_notification kind="exec_completion" severity="info">',
  '  <session id="3" exit_code="0" />',
  "  <output>",
  longLines,
  "  </output>",
  "</taumel_notification>",
].join("\n");
const compactExecNote = renderText(renderNotification({ customType: "taumel.notification", content: execNote }, { expanded: false }, theme));
const expandedExecNote = renderText(renderNotification({ customType: "taumel.notification", content: execNote }, { expanded: true }, theme));
assert(/• exec_completion · session 3/.test(compactExecNote), `exec notification header wrong: ${compactExecNote}`);
assert(!/exit 0/.test(compactExecNote), `exec notification should not repeat the exit code (green dot signals it): ${compactExecNote}`);
assert(compactExecNote.includes("… 19 more lines"), `exec notification tail body was not compacted: ${compactExecNote}`);
assert(expandedExecNote.includes("line-1"), `expanded exec notification did not include full output: ${expandedExecNote}`);

const agentNote = [
  '<taumel_notification kind="agent_completion" severity="info">',
  '  <agent id="finder-7" profile="finder" />',
  '  <run id="finder-7-run-1" status="completed" />',
  "  <final_output>",
  "all done here",
  "  </final_output>",
  "</taumel_notification>",
].join("\n");
const compactAgentNote = renderText(renderNotification({ customType: "taumel.notification", content: agentNote }, { expanded: false }, theme));
assert(/• agent_completion · finder-7 \(finder\)/.test(compactAgentNote), `agent notification header wrong: ${compactAgentNote}`);
assert(compactAgentNote.includes("all done here"), `agent notification body missing: ${compactAgentNote}`);

assert(
  renderNotification({ customType: "taumel.notification", content: "" }, { expanded: false }, theme) === undefined,
  "empty notification content should render nothing",
);

console.log("tool renderer smoke: all assertions passed");
