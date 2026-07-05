import { toolNames } from "../src/tool-contracts.ts";
import { notificationMessageRenderer, renderersForTool, skillMessageRenderer } from "../src/tool-renderer.ts";
import { Box, visibleWidth } from "@earendil-works/pi-tui";

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
const renderInDefaultToolShell = (component, width) => {
  const shell = new Box(1, 1, (value) => value);
  shell.addChild(component);
  return shell.render(width);
};
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
  hits: [
    {
      kind: "message",
      role: "assistant",
      snippet: `renderer hit ${index + 1}`,
      locator: { threadID: `thread-${index + 1}`, entryID: `entry-${index + 1}` },
    },
  ],
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
    case "query_threads":
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
  if (name === "query_threads") {
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
assert(
  renderersForTool("exec_command").renderCall({ cmd: "ls" }, theme, { isPartial: false }).render(120).length === 0,
  "completed exec_command call placeholder should render zero lines, not a blank top-margin row",
);
assert(
  renderersForTool("write_stdin").renderCall({ session_id: 7 }, theme, { isPartial: false }).render(120).length === 0,
  "completed write_stdin call placeholder should render zero lines, not a blank top-margin row",
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
const failedPatchResult = { content: [{ type: "text", text: "Patch failed: expected context not found\nat line 3" }], details: { ok: false, error: "expected context not found" } };
const failedPatchCompact = renderText(renderersForTool("apply_patch").renderResult(failedPatchResult, { expanded: false, isPartial: false }, theme, { args: argsFor("apply_patch") }));
const failedPatchExpanded = renderText(renderersForTool("apply_patch").renderResult(failedPatchResult, { expanded: true, isPartial: false }, theme, { args: argsFor("apply_patch") }));
assert(failedPatchCompact.includes("Patch failed: expected context not found"), `failed apply_patch compact should show error reason: ${failedPatchCompact}`);
assert(failedPatchExpanded.includes("at line 3"), `failed apply_patch expanded should show full error text: ${failedPatchExpanded}`);

// Mutation renderers must fit inside Pi's default tool shell. If an extension
// renderer returns a line wider than the child width Pi gave it, the terminal
// physically wraps and footer/status rows can paint inside the tool output.
{
  const mutationPath = "/home/ribelo/projects/shareablee/csai/airflow/src/core/airflow-client.ts";
  const mutationBefore = [
    "        // authenticated dispatch so anonymous probes track v2<->v3 deploy flips",
    "        // without a sqlite read per call.",
    "        const cachedAnonymousApiVersions = yield* Ref.make<",
    "            ReadonlyMap<string, AirflowSession[\"apiVersion\"]>",
    "        >(new Map());",
    "        const detectedAnonymousApiVersions = yield* Ref.make<ReadonlySet<string>>(new Set());",
  ].join("\n");
  const mutationAfter = mutationBefore.replace(
    "        >(new Map());",
    "        >(new Map([[\"very-long-airflow-host-name-that-forces-the-line-to-hit-the-terminal-edge.example.com\", \"v3\"]]));",
  );
  const mutationCases = [
    {
      name: "edit",
      result: { content: [{ type: "text", text: "edited" }], details: { ok: true, displayPath: mutationPath, before: mutationBefore, after: mutationAfter } },
      args: { path: mutationPath },
    },
    {
      name: "write",
      result: { content: [{ type: "text", text: "wrote" }], details: { ok: true, displayPath: mutationPath, contents: mutationAfter } },
      args: { path: mutationPath },
    },
    {
      name: "apply_patch",
      result: { content: [{ type: "text", text: "patched" }], details: { ok: true, writes: [{ path: mutationPath, before: mutationBefore, contents: mutationAfter }] } },
      args: { input: "*** Begin Patch\n*** Update File: src/core/airflow-client.ts\n*** End Patch" },
    },
  ];
  for (const { name, result, args } of mutationCases) {
    for (const expanded of [false, true]) {
      for (const width of [32, 40, 60, 80, 120]) {
        const component = renderersForTool(name).renderResult(result, { expanded, isPartial: false }, theme, { args });
        const lines = renderInDefaultToolShell(component, width);
        const overflow = lines
          .map((line, index) => ({ index, width: visibleWidth(line), line }))
          .filter((line) => line.width > width);
        assert(
          overflow.length === 0,
          `${name} renderer overflowed Pi default shell at width ${width}, expanded=${expanded}: ${JSON.stringify(overflow[0])}`,
        );
      }
    }
  }
}

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

// Thread query — collapsed top 3 + `… N more`, expanded hit snippets.
const queryCompact = renderText(renderersForTool("query_threads").renderResult(resultFor("query_threads"), { expanded: false, isPartial: false }, theme, { args: argsFor("query_threads") }));
const queryExpanded = renderText(renderersForTool("query_threads").renderResult(resultFor("query_threads"), { expanded: true, isPartial: false }, theme, { args: argsFor("query_threads") }));
assert(/• query_threads · "renderer" \(12 threads, 12 hits\)/.test(queryCompact), `query_threads subject should be "query" (N threads, M hits): ${queryCompact}`);
assert(queryCompact.includes("  └ 1 · Thread 1 · thread-1 · 1 hit"), `query_threads collapsed first item should be idx · title · id · hits: ${queryCompact}`);
assert(!queryCompact.includes("Thread 4") && queryCompact.includes("… 9 more"), `query_threads collapsed should clip to top 3 with … N more: ${queryCompact}`);
assert(queryExpanded.includes("Thread 4") && queryExpanded.includes("message/assistant: renderer hit 1"), `query_threads expanded should include more threads and hit snippets: ${queryExpanded}`);

// Single-entity — header + dim facts line.
const goalCompact = renderText(renderersForTool("create_goal").renderResult(resultFor("create_goal"), { expanded: false, isPartial: false }, theme, { args: argsFor("create_goal") }));
assert(/• create_goal · ship renderer coverage/.test(goalCompact), `create_goal subject should be the objective: ${goalCompact}`);
assert(goalCompact.includes("  └ active · 10 tokens · 2s"), `create_goal facts line should be dim ·-joined: ${goalCompact}`);
const pendingGoalCompact = renderText(renderersForTool("update_goal").renderResult({
  content: [{ type: "text", text: "Goal updated." }],
  details: {
    ok: true,
    accountingPending: true,
    goal: {
      objective: "ship renderer coverage",
      status: "complete",
      tokensUsed: 0,
      timeUsedSeconds: 0,
    },
  },
}, { expanded: false, isPartial: false }, theme, { args: argsFor("update_goal") }));
assert(pendingGoalCompact.includes("  └ complete · final accounting pending"), `update_goal should not render zero counters while final accounting is pending: ${pendingGoalCompact}`);
assert(!pendingGoalCompact.includes("0 tokens · 0s"), `update_goal pending accounting should suppress zero counters: ${pendingGoalCompact}`);

const spawnCompact = renderText(renderersForTool("agent_spawn").renderResult(resultFor("agent_spawn"), { expanded: false, isPartial: false }, theme, { args: argsFor("agent_spawn") }));
assert(/• agent_spawn · finder/.test(spawnCompact) && spawnCompact.includes("  └ run worker-1 · running"), `agent_spawn facts should be run <id> · <lifecycle>: ${spawnCompact}`);
const spawnExpanded = renderText(renderersForTool("agent_spawn").renderResult(
  { content: [{ type: "text", text: "<taumel_agent_spawn>raw xml</taumel_agent_spawn>" }], details: { ok: true, profile: "finder", agent_id: "finder-1", run_id: "finder-1-run-1", status: "running" } },
  { expanded: true, isPartial: false },
  theme,
  { args: { profile: "finder", message: "inspect every file", create_goal: true } },
));
assert(spawnExpanded.includes("Objective sent:") && spawnExpanded.includes("inspect every file") && !spawnExpanded.includes("<taumel_agent_spawn>"), `agent_spawn expanded should render fields and sent objective, not XML: ${spawnExpanded}`);
const waitPoll = renderText(renderersForTool("agent_wait").renderCall({ timeout_seconds: 0 }, theme, { isPartial: true }));
const waitBounded = renderText(renderersForTool("agent_wait").renderCall({ agent_ids: ["finder-1"], timeout_seconds: 5 }, theme, { isPartial: true }));
const waitForever = renderText(renderersForTool("agent_wait").renderCall({}, theme, { isPartial: true }));
assert(waitPoll.includes("poll now") && waitBounded.includes("up to 5s") && waitForever.includes("until completion"), `agent_wait call labels should show poll/bounded/indefinite modes: ${JSON.stringify({ waitPoll, waitBounded, waitForever })}`);
const waitExpanded = renderText(renderersForTool("agent_wait").renderResult(
  { content: [{ type: "text", text: "<taumel_agent_wait>raw xml</taumel_agent_wait>" }], details: { ok: true, runs: [
    { agent_id: "finder-1", run_id: "finder-1-run-1", status: "completed", finalOutput: "first child done", outputAvailable: true },
    { agent_id: "review-2", run_id: "review-2-run-1", status: "failed", error: "review failed", outputAvailable: true },
  ] } },
  { expanded: true, isPartial: false },
  theme,
  { args: { run_ids: ["finder-1-run-1", "review-2-run-1"] } },
));
assert(waitExpanded.includes("finder-1 · finder-1-run-1 · completed") && waitExpanded.includes("first child done") && waitExpanded.includes("review failed") && !waitExpanded.includes("<taumel_agent_wait>"), `agent_wait expanded should group child responses without XML: ${waitExpanded}`);

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

// notification — opaque exec_completion + agent_completion ready signals.
const renderNotification = notificationMessageRenderer();
const execNote = 'Command session 3 has finished. To read and consume the result, call write_stdin with session_id=3, chars="", yield_time_ms=5000.';
const compactExecNote = renderText(renderNotification({ customType: "notification", content: execNote }, { expanded: false }, theme));
const expandedExecNote = renderText(renderNotification({ customType: "notification", content: execNote }, { expanded: true }, theme));
assert(compactExecNote.startsWith(" • exec_completion"), `exec notification should include custom-message left gutter: ${compactExecNote}`);
assert(/• exec_completion · session 3 ready/.test(compactExecNote), `exec notification header wrong: ${compactExecNote}`);
assert(!/exit|code|line-1/.test(compactExecNote), `exec notification should not include terminal status or output: ${compactExecNote}`);
assert(compactExecNote.includes("write_stdin"), `exec notification instruction missing from collapsed body: ${compactExecNote}`);
assert(expandedExecNote.includes("Command session 3 has finished") && expandedExecNote.includes("yield_time_ms=5000"), `expanded exec notification should preserve visible body: ${expandedExecNote}`);

const agentNote = "Agent run finder-7-run-1 for finder-7 (finder) has finished. To read and consume the result, call agent_wait with run_ids=[finder-7-run-1], timeout_seconds=0.";
const compactAgentNote = renderText(renderNotification({ customType: "notification", content: agentNote }, { expanded: false }, theme));
assert(/• agent_completion · finder-7 \(finder\) ready/.test(compactAgentNote), `agent notification header wrong: ${compactAgentNote}`);
assert(!compactAgentNote.includes("all done here"), `agent notification must not include final output: ${compactAgentNote}`);
assert(compactAgentNote.includes("agent_wait"), `agent notification instruction missing from collapsed body: ${compactAgentNote}`);

assert(
  renderNotification({ customType: "notification", content: "" }, { expanded: false }, theme) === undefined,
  "empty notification content should render nothing",
);

const renderSkill = skillMessageRenderer();
const skillBlock = [
  '<skill name="foo" location="/skills/foo/SKILL.md">',
  "References are relative to /skills/foo.",
  "",
  longLines,
  "</skill>",
].join("\n");
const skillMessage = { customType: "skill", content: skillBlock, details: { trigger: "$foo" } };
const compactSkill = renderText(renderSkill(skillMessage, { expanded: false }, theme));
const expandedSkill = renderText(renderSkill(skillMessage, { expanded: true }, theme));
assert(/• skill: foo/.test(compactSkill), `skill renderer header wrong: ${compactSkill}`);
assert(compactSkill.includes("auto from $foo") && compactSkill.includes("(expand)") && !compactSkill.includes("line-1"), `skill renderer should default collapsed: ${compactSkill}`);
assert(expandedSkill.includes("because the user mentioned $foo"), `expanded skill renderer should show provenance: ${expandedSkill}`);
assert(expandedSkill.includes("line-24"), `expanded skill renderer should show full body: ${expandedSkill}`);
assert(!expandedSkill.includes("<skill") && !expandedSkill.includes("</skill>"), `expanded skill renderer leaked XML: ${expandedSkill}`);
const multilineSkillBlock = [
  '<skill name="grill-me"',
  ' location="/skills/grill-me/SKILL.md">',
  "References are relative to /skills/grill-me.",
  "",
  "Run a `/grilling` session.",
  "</skill>",
].join("\n");
const compactMultilineSkill = renderText(renderSkill(
  { customType: "skill", content: multilineSkillBlock, details: { trigger: "$grill-me" } },
  { expanded: false },
  theme,
));
const expandedMultilineSkill = renderText(renderSkill(
  { customType: "skill", content: multilineSkillBlock, details: { trigger: "$grill-me" } },
  { expanded: true },
  theme,
));
assert(compactMultilineSkill.includes("grill-me") && compactMultilineSkill.includes("auto from $grill-me"), `multiline skill compact render failed: ${compactMultilineSkill}`);
assert(expandedMultilineSkill.includes("Run a `/grilling` session."), `multiline skill expanded body missing: ${expandedMultilineSkill}`);
assert(!compactMultilineSkill.includes("<skill") && !expandedMultilineSkill.includes("<skill"), `multiline skill renderer leaked XML: ${JSON.stringify({ compactMultilineSkill, expandedMultilineSkill })}`);
const childTagSkillBlock = [
  "<skill>",
  "<name>grill-me</name>",
  "<path>/skills/grill-me/SKILL.md</path>",
  "---",
  "name: grill-me",
  "---",
  "",
  "Run a `/grilling` session.",
  "</skill>",
].join("\n");
const expandedChildTagSkill = renderText(renderSkill(
  { customType: "skill", content: childTagSkillBlock, details: { trigger: "$grill-me" } },
  { expanded: true },
  theme,
));
assert(expandedChildTagSkill.includes("grill-me") && expandedChildTagSkill.includes("Run a `/grilling` session."), `child-tag skill render failed: ${expandedChildTagSkill}`);
assert(!expandedChildTagSkill.includes("<name>") && !expandedChildTagSkill.includes("<path>"), `child-tag skill renderer leaked XML: ${expandedChildTagSkill}`);
assert(
  renderSkill({ customType: "skill", content: "<skill>bad</skill>" }, { expanded: false }, theme) === undefined,
  "invalid skill markup should render nothing",
);

console.log("tool renderer smoke: all assertions passed");
